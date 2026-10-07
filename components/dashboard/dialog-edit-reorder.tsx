"use client"

// components/dashboard/dialog-edit-reorder.tsx
// F2 Edit reorder point (owner + admin). PRD v2 §3.5/§3.6, ui-spec §4.
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { formatAngka, statusStok } from "@/lib/dashboard/format"
import { useData } from "@/lib/dashboard/sumber-data"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  kode: string
  nama: string | null
  saldo: number | null
  reorderSekarang: number | null
  /** Dipanggil setelah sukses agar halaman refetch. */
  onSukses?: () => void
}

function teksAwal(nilai: number | null): string {
  return nilai == null ? "" : String(nilai)
}

export function DialogEditReorder({
  open,
  onOpenChange,
  kode,
  nama,
  saldo,
  reorderSekarang,
  onSukses,
}: Props) {
  const data = useData()
  const [reorderText, setReorderText] = useState(() => teksAwal(reorderSekarang))
  const [error, setError] = useState<string | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const sinkronSaatBuka = useRef(false)

  // Sinkronkan isian hanya saat dialog TRANSISI tertutup -> buka. Tidak menyentuh isian
  // saat open tetap true (user sedang mengetik) atau saat tulis gagal (401 mid-write:
  // dialog & isian dipertahankan, PRD v1 §11.2).
  useEffect(() => {
    if (open && !sinkronSaatBuka.current) {
      setReorderText(teksAwal(reorderSekarang))
      setError(null)
    }
    sinkronSaatBuka.current = open
  }, [open, reorderSekarang])

  const teks = reorderText.trim()
  const kosong = teks === ""
  const valid = kosong || /^\d+$/.test(teks)
  const reorderBaru = kosong ? null : Number(teks)
  const statusBaru = statusStok(saldo, reorderBaru)

  function reset() {
    setReorderText(teksAwal(reorderSekarang))
    setError(null)
    setMengirim(false)
  }

  function tutup(v: boolean) {
    if (mengirim) return
    if (!v) reset()
    onOpenChange(v)
  }

  async function kirim() {
    if (!valid) {
      setError("Reorder point harus bilangan bulat >= 0.")
      return
    }
    setError(null)
    setMengirim(true)
    try {
      const res = await data.ubahReorderPoint({ kode_barang: kode, reorder_point: reorderBaru })
      if (res.ok) {
        toast.success("Reorder point diperbarui")
        // B1 sudah diperbaiki server: notifikasi_terkirim dapat dipercaya.
        if (res.notifikasi_terkirim) {
          toast.info("Notifikasi stok menipis terkirim ke owner & admin.")
        }
        reset()
        onOpenChange(false)
        onSukses?.()
      } else {
        // 401 mid-write: form dipertahankan, dialog tetap terbuka.
        tampilkanGagalTulis(res.error)
        setMengirim(false)
      }
    } catch {
      toast.error("Gagal menyimpan. Coba lagi.")
      setMengirim(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-reorder">
        <DialogHeader>
          <DialogTitle>Edit Reorder Point</DialogTitle>
          <DialogDescription>
            Ambang peringatan stok menipis untuk produk ini.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm font-medium">{nama ?? "Produk"}</p>
          <p className="text-xs text-muted-foreground">{kode}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Stok saat ini:{" "}
            <span className="font-semibold text-foreground tabular-nums">{formatAngka(saldo)}</span>
          </p>
        </div>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void kirim()
          }}
        >
          <Field data-invalid={error ? true : undefined} data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="input-reorder">Reorder point</FieldLabel>
            <Input
              id="input-reorder"
              inputMode="numeric"
              autoComplete="off"
              value={reorderText}
              aria-invalid={error ? true : undefined}
              disabled={mengirim}
              placeholder="Kosong = tanpa reorder point"
              data-testid="input-reorder"
              onChange={(e) => {
                setReorderText(e.target.value)
                setError(null)
              }}
            />
            {error ? (
              <FieldError data-testid="error-reorder">{error}</FieldError>
            ) : (
              <FieldDescription>
                Kosong berarti reorder point dihapus. Notifikasi dikirim bila stok &le; reorder point.
              </FieldDescription>
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Status setelah perubahan:</span>
            <span data-testid="preview-status-reorder">
              <StatusBadge status={statusBaru} />
            </span>
          </div>

          <div>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 md:h-8"
              disabled={mengirim || kosong}
              data-testid="hapus-reorder"
              onClick={() => {
                setReorderText("")
                setError(null)
              }}
            >
              Hapus reorder point
            </Button>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 md:h-9"
              disabled={mengirim}
              onClick={() => tutup(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              size="lg"
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="submit-reorder"
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}