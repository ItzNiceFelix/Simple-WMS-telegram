"use client"

// components/dashboard/dialog-edit-hpp.tsx
// F1 Edit HPP + HPP baru (owner only). PRD v2 §2.5/§2.6, ui-spec §4.
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
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { formatRupiah } from "@/lib/dashboard/format"
import { useData } from "@/lib/dashboard/sumber-data"
import type { ProdukDoc } from "@/lib/dashboard/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  produk: ProdukDoc
  /** Dipanggil setelah sukses agar halaman refetch. */
  onSukses?: () => void
}

type HasilValidasi = { ok: true; nilai: number } | { ok: false; error: string }

/** Bilangan bulat >= 0; kosong = tidak dikirim (undefined). */
function validasiOpsional(mentah: string, pesan: string): HasilValidasi {
  const teks = mentah.trim()
  if (!/^\d+$/.test(teks)) return { ok: false, error: pesan }
  return { ok: true, nilai: Number(teks) }
}

function teksAwal(nilai: number | null): string {
  return nilai == null ? "" : String(nilai)
}

export function DialogEditHpp({ open, onOpenChange, produk, onSukses }: Props) {
  const data = useData()
  const [hppText, setHppText] = useState(() => teksAwal(produk.hpp))
  const [hppBaruText, setHppBaruText] = useState(() => teksAwal(produk.hpp_baru))
  const [error, setError] = useState<string | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const sinkronSaatBuka = useRef(false)

  // Sinkronkan isian hanya saat dialog TRANSISI tertutup -> buka. Tidak menyentuh isian
  // saat open tetap true (user sedang mengetik) atau saat tulis gagal (401 mid-write:
  // dialog & isian dipertahankan, PRD v1 §11.2).
  useEffect(() => {
    if (open && !sinkronSaatBuka.current) {
      setHppText(teksAwal(produk.hpp))
      setHppBaruText(teksAwal(produk.hpp_baru))
      setError(null)
    }
    sinkronSaatBuka.current = open
  }, [open, produk.hpp, produk.hpp_baru])

  function reset() {
    setHppText(teksAwal(produk.hpp))
    setHppBaruText(teksAwal(produk.hpp_baru))
    setError(null)
    setMengirim(false)
  }

  function tutup(v: boolean) {
    if (mengirim) return // form terkunci saat submit
    if (!v) reset()
    onOpenChange(v)
  }

  async function kirim() {
    const hpp = validasiOpsional(hppText, "HPP harus bilangan bulat >= 0.")
    if (!hpp.ok) {
      setError(hpp.error)
      return
    }
    // HPP baru: kosong = null (hapus HPP baru).
    let hppBaru: number | null = null
    if (hppBaruText.trim() !== "") {
      const v = validasiOpsional(hppBaruText, "HPP baru harus bilangan bulat >= 0.")
      if (!v.ok) {
        setError(v.error)
        return
      }
      hppBaru = v.nilai
    }
    setError(null)
    setMengirim(true)
    try {
      const res = await data.ubahHpp({ kode_barang: produk.kode_barang, hpp: hpp.nilai, hpp_baru: hppBaru })
      if (res.ok) {
        toast.success("HPP diperbarui")
        reset()
        onOpenChange(false)
        onSukses?.()
      } else {
        // 401 mid-write: pesan khusus + dialog & isian DIPERTAHANKAN (PRD v1 §11.2).
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
      <DialogContent className="sm:max-w-md" data-testid="dialog-hpp">
        <DialogHeader>
          <DialogTitle>Edit HPP</DialogTitle>
          <DialogDescription>
            Perbarui harga pokok produk. Kosongkan HPP baru untuk menghapusnya.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm font-medium">{produk.nama_accurate}</p>
          <p className="text-xs text-muted-foreground">{produk.kode_barang}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            HPP saat ini:{" "}
            <span className="font-semibold text-foreground tabular-nums">{formatRupiah(produk.hpp)}</span>
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
            <FieldLabel htmlFor="input-hpp">HPP</FieldLabel>
            <Input
              id="input-hpp"
              inputMode="numeric"
              autoComplete="off"
              value={hppText}
              aria-invalid={error ? true : undefined}
              disabled={mengirim}
              placeholder="0"
              data-testid="input-hpp"
              onChange={(e) => {
                setHppText(e.target.value)
                setError(null)
              }}
            />
          </Field>

          <Field data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="input-hpp-baru">HPP baru (opsional)</FieldLabel>
            <Input
              id="input-hpp-baru"
              inputMode="numeric"
              autoComplete="off"
              value={hppBaruText}
              disabled={mengirim}
              placeholder="Kosongkan untuk menghapus"
              data-testid="input-hpp-baru"
              onChange={(e) => {
                setHppBaruText(e.target.value)
                setError(null)
              }}
            />
            <FieldDescription>Kosong berarti HPP baru dihapus (null).</FieldDescription>
          </Field>

          {error ? <FieldError data-testid="error-hpp">{error}</FieldError> : null}

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
              data-testid="submit-hpp"
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