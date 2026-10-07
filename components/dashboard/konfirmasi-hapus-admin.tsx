"use client"

// components/dashboard/konfirmasi-hapus-admin.tsx
// F4b Konfirmasi hapus admin (owner only). PRD v2 §5.5/§5.6 (Q5).
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
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { labelRole } from "@/lib/dashboard/format"
import { useData } from "@/lib/dashboard/sumber-data"
import type { AdminDoc } from "@/lib/dashboard/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  admin: AdminDoc | null
  /** Dipanggil setelah sukses agar daftar admin refetch. */
  onSukses?: () => void
}

export function KonfirmasiHapusAdmin({ open, onOpenChange, admin, onSukses }: Props) {
  const data = useData()
  const [mengirim, setMengirim] = useState(false)
  if (!admin) return null

  const nama = admin.name ?? admin.telegram_user_id

  async function kirim() {
    if (!admin) return
    setMengirim(true)
    try {
      const res = await data.hapusAdmin({ telegram_user_id: admin.telegram_user_id })
      if (res.ok) {
        toast.success(`Admin ${nama} dihapus.`)
        if (res.peringatan_audit) toast.warning("Admin dihapus, tetapi audit gagal dicatat.")
        if (res.peringatan_revoke) toast.warning("Permintaan akses lama gagal ditutup.")
        onOpenChange(false)
        onSukses?.()
      } else {
        // 401: dialog konfirmasi tetap terbuka (PRD v1 §11.2).
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa) onOpenChange(false)
      }
    } catch {
      toast.error("Gagal menghapus admin.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!mengirim) onOpenChange(v) }}>
      <AlertDialogContent data-testid="konfirmasi-hapus-admin">
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus {nama}?</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-1">
            <span>
              {nama} · <span className="tabular-nums">{admin.telegram_user_id}</span> ·{" "}
              {labelRole(admin.role)}
            </span>
            <span>
              Akses tulis berhenti seketika. Akses baca bisa berlaku sampai 1 jam (cookie sesi
              lama). User bisa mengajukan akses ulang.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            className="h-11 md:h-9"
            disabled={mengirim}
            data-testid="batal-hapus-admin"
            onClick={() => onOpenChange(false)}
          >
            Batal
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-11 md:h-9"
            disabled={mengirim}
            data-testid="konfirmasi-hapus-ok"
            onClick={() => void kirim()}
          >
            {mengirim ? <Spinner data-icon="inline-start" /> : null}
            {mengirim ? "Menghapus…" : "Ya, hapus"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}