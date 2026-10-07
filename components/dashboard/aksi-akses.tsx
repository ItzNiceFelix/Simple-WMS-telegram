"use client"

// components/dashboard/aksi-akses.tsx
// A7 Proses permintaan akses per baris (owner only): Setujui / Tolak.
// Dua AlertDialog terpisah (satu per keputusan), pola F3/F4b. PRD v3b §10.1/§10.4 B6.
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
import type { AccessRequestDoc } from "@/lib/dashboard/types"

type JenisKeputusan = "setujui" | "tolak"

interface Props {
  permintaan: AccessRequestDoc
  jenis: JenisKeputusan
  /** Dipanggil setelah sukses (atau baris basi 409/404) agar halaman refetch. */
  onSukses?: () => void
}

/** Baris basi: server bilang sudah diproses / tidak ada -> tutup dialog + refetch. */
function barisBasi(error: string): boolean {
  return error.includes("sudah diproses") || error.includes("tidak ditemukan")
}

export function AksiAkses({ permintaan, jenis, onSukses }: Props) {
  const data = useData()
  const [open, setOpen] = useState(false)
  const [mengirim, setMengirim] = useState(false)

  const id = permintaan.telegram_user_id
  const nama = permintaan.telegram_display_name ?? id
  const setujui = jenis === "setujui"

  async function kirim() {
    setMengirim(true)
    try {
      const res = setujui
        ? await data.setujuiAkses({ target_user_id: id })
        : await data.tolakAkses({ target_user_id: id })
      if (res.ok) {
        toast.success(
          setujui ? `Akses ${nama} disetujui.` : `Akses ${nama} ditolak.`
        )
        if (!res.notifikasi_terkirim) {
          toast.warning("Status tersimpan, tapi notifikasi ke user gagal terkirim")
        }
        setOpen(false)
        onSukses?.()
      } else {
        // 401: dialog konfirmasi tetap terbuka (PRD v1 §11.2).
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa && barisBasi(res.error)) {
          // 409/404: baris basi -> tutup + refetch agar baris hilang.
          setOpen(false)
          onSukses?.()
        }
      }
    } catch {
      toast.error("Gagal memproses permintaan akses.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <>
      <Button
        variant={setujui ? "default" : "outline"}
        size="sm"
        className="h-11 md:h-8"
        data-testid={`${setujui ? "setujui" : "tolak"}-akses-${id}`}
        onClick={() => setOpen(true)}
      >
        {setujui ? "Setujui" : "Tolak"}
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!mengirim) setOpen(v)
        }}
      >
        <AlertDialogContent data-testid={setujui ? "dialog-setujui-akses" : "dialog-tolak-akses"}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {setujui ? `Setujui akses ${nama}?` : `Tolak akses ${nama}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-1">
              <span>
                {nama} · <span className="tabular-nums">{id}</span>
              </span>
              <span>
                {setujui
                  ? "User harus tetap «kenalan» di Telegram sebelum benar-benar menjadi admin."
                  : "Permintaan ditolak. User tidak bisa mengajukan akses lagi selama 1 jam."}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={`batal-${jenis}-akses`}
              onClick={() => setOpen(false)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={`konfirmasi-${jenis}-akses-ok`}
              onClick={() => void kirim()}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Memproses..." : setujui ? "Ya, setujui" : "Ya, tolak"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
