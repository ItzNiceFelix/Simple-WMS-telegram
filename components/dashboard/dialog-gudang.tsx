"use client"

// components/dashboard/dialog-gudang.tsx
// F1 Master gudang (owner only): satu dialog untuk Tambah / Edit (PRD v5 79-105).
// Validasi client 1-60 karakter (paritas validasiNamaGudang). Pesan server tampil inline;
// dialog TIDAK ditutup saat gagal agar isian dipertahankan (409 nama / 401 sesi).
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
import { useData } from "@/lib/dashboard/sumber-data"
import type { GudangDoc } from "@/lib/dashboard/types"

const MAKS_NAMA = 60

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = mode Tambah; gudang = mode Edit. */
  gudang?: GudangDoc | null
  onSukses?: () => void
}

export function DialogGudang({ open, onOpenChange, gudang = null, onSukses }: Props) {
  const data = useData()
  const [nama, setNama] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const sinkronSaatBuka = useRef(false)
  const edit = gudang !== null

  // Sinkronkan isian hanya saat transisi tertutup -> buka; tulis gagal tidak mengosongkan isian.
  useEffect(() => {
    if (open && !sinkronSaatBuka.current) {
      setNama(gudang?.nama ?? "")
      setError(null)
      setMengirim(false)
    }
    sinkronSaatBuka.current = open
  }, [open, gudang])

  function tutup(v: boolean) {
    if (mengirim) return
    if (!v) setError(null)
    onOpenChange(v)
  }

  async function kirim() {
    const teks = nama.trim()
    if (!teks) {
      setError("Nama gudang wajib diisi.")
      return
    }
    if (teks.length > MAKS_NAMA) {
      setError("Nama gudang maksimal 60 karakter.")
      return
    }
    setError(null)
    setMengirim(true)
    try {
      const res = edit
        ? await data.ubahGudang({ aksi: "edit", gudang_id: gudang!.gudang_id, nama: teks })
        : await data.tambahGudang({ aksi: "tambah", nama: teks })
      if (res.ok) {
        toast.success(edit ? `Gudang ${teks} diperbarui.` : `Gudang ${teks} ditambahkan.`)
        onOpenChange(false)
        onSukses?.()
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa) setError(res.error)
      }
    } catch {
      toast.error("Gagal menyimpan gudang. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-gudang">
        <DialogHeader>
          <DialogTitle>{edit ? "Edit Gudang" : "Tambah Lokasi Gudang"}</DialogTitle>
          <DialogDescription>
            {edit
              ? "Ubah nama lokasi gudang. ID gudang tidak berubah."
              : "Buat lokasi gudang baru untuk memisahkan stok per tempat."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void kirim()
          }}
        >
          <Field
            data-invalid={error ? true : undefined}
            data-disabled={mengirim ? true : undefined}
          >
            <FieldLabel htmlFor="gudang-nama">Nama gudang</FieldLabel>
            <Input
              id="gudang-nama"
              autoComplete="off"
              maxLength={MAKS_NAMA}
              value={nama}
              aria-invalid={error ? true : undefined}
              disabled={mengirim}
              placeholder="mis. Gudang D12"
              data-testid="input-nama-gudang"
              onChange={(e) => {
                setNama(e.target.value)
                setError(null)
              }}
            />
            {error ? (
              <FieldError data-testid="error-gudang">{error}</FieldError>
            ) : (
              <FieldDescription>1 sampai 60 karakter. Nama harus unik.</FieldDescription>
            )}
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="batal-gudang"
              onClick={() => tutup(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              size="lg"
              className="h-11 md:h-9"
              disabled={mengirim || nama.trim() === ""}
              data-testid="simpan-gudang"
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}