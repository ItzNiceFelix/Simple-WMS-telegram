"use client"

// components/dashboard/aksi-gudang.tsx
// F1 tombol per baris master gudang: Aktifkan / Nonaktifkan (owner only).
// Nonaktif gudang yang masih dirujuk TETAP sukses; server mengembalikan
// `peringatan_referensi` -> ditampilkan sebagai toast peringatan (PRD v5 113-116).
import { useState } from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { useData } from "@/lib/dashboard/sumber-data"
import type { GudangDoc } from "@/lib/dashboard/types"

interface Props {
  gudang: GudangDoc
  onSukses?: () => void
}

export function AksiGudang({ gudang, onSukses }: Props) {
  const data = useData()
  const [open, setOpen] = useState(false)
  const [mengirim, setMengirim] = useState(false)
  const menonaktifkan = gudang.aktif

  async function kirim() {
    setMengirim(true)
    try {
      const res = await data.ubahGudang({
        aksi: menonaktifkan ? "nonaktif" : "aktifkan",
        gudang_id: gudang.gudang_id,
      })
      if (res.ok) {
        if (menonaktifkan) {
          toast.success(`Gudang ${gudang.nama} dinonaktifkan.`)
          if ((res.peringatan_referensi ?? 0) > 0) {
            toast.warning(
              `Masih dirujuk ${res.peringatan_referensi} data (user/stok). Referensi lama tetap valid.`
            )
          }
        } else {
          toast.success(`Gudang ${gudang.nama} diaktifkan.`)
        }
        setOpen(false)
        onSukses?.()
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa && res.error.includes("tidak ditemukan")) {
          setOpen(false)
          onSukses?.()
        }
      }
    } catch {
      toast.error("Gagal mengubah status gudang. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-11 md:h-8"
        data-testid={`${menonaktifkan ? "nonaktifkan" : "aktifkan"}-gudang-${gudang.gudang_id}`}
        onClick={() => setOpen(true)}
      >
        {menonaktifkan ? "Nonaktifkan" : "Aktifkan"}
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!mengirim) setOpen(v)
        }}
      >
        <AlertDialogContent data-testid="dialog-status-gudang">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {menonaktifkan ? `Nonaktifkan ${gudang.nama}?` : `Aktifkan ${gudang.nama}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {menonaktifkan
                ? "Gudang tidak akan muncul di pilihan filter dan tidak bisa dipakai untuk stok baru. Data lama tetap tersimpan. Tindakan ini bisa dibatalkan."
                : "Gudang akan muncul kembali di pilihan filter dan bisa dipakai untuk stok baru."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="batal-status-gudang"
              onClick={() => setOpen(false)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="konfirmasi-status-gudang"
              onClick={() => void kirim()}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim
                ? "Memproses..."
                : menonaktifkan
                  ? "Ya, nonaktifkan"
                  : "Ya, aktifkan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}