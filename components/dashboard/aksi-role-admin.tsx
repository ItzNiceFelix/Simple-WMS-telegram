"use client"

// components/dashboard/aksi-role-admin.tsx
// F3 Ubah role per baris admin (owner only). PRD v2 §4.5/§4.6.
// Promosi ke owner & penurunan owner WAJIB AlertDialog konfirmasi ekstra (Q5).
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { labelRole } from "@/lib/dashboard/format"
import { useData } from "@/lib/dashboard/sumber-data"
import type { AdminDoc, Role } from "@/lib/dashboard/types"

const PILIHAN: Role[] = ["owner", "admin", "guest"]

interface Props {
  admin: AdminDoc
  /** uid owner yang sedang login (baris sendiri -> aksi disabled). */
  uid: string
  /** Dipanggil setelah sukses agar halaman refetch daftar admin + timeline. */
  onSukses?: () => void
}

export function AksiRoleAdmin({ admin, uid, onSukses }: Props) {
  const data = useData()
  const [pilihan, setPilihan] = useState<Role>(admin.role)
  const [mengirim, setMengirim] = useState(false)
  const [konfirmasi, setKonfirmasi] = useState(false)

  const sendiri = admin.telegram_user_id === uid
  const berubah = pilihan !== admin.role
  const perluKonfirmasi = pilihan === "owner" || admin.role === "owner"

  const nama = admin.name ?? admin.telegram_user_id

  async function kirim() {
    setMengirim(true)
    try {
      const res = await data.ubahRoleAdmin({
        target_user_id: admin.telegram_user_id,
        role_baru: pilihan,
      })
      if (res.ok) {
        toast.success(`Role ${nama} diubah menjadi ${labelRole(pilihan)}.`)
        if (res.peringatan_audit) toast.warning("Perubahan tersimpan, tetapi audit gagal dicatat.")
        onSukses?.()
      } else {
        // 401: dropdown DIPERTAHANKAN (tidak dikembalikan ke nilai lama).
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa) setPilihan(admin.role)
      }
    } catch {
      toast.error("Gagal mengubah role.")
      setPilihan(admin.role)
    } finally {
      setMengirim(false)
    }
  }

  function onClickSimpan() {
    if (!berubah || mengirim || sendiri) return
    if (perluKonfirmasi) {
      setKonfirmasi(true)
      return
    }
    void kirim()
  }

  const judulKonfirmasi =
    pilihan === "owner"
      ? `Jadikan ${nama} Owner?`
      : `Turunkan ${nama} dari Owner menjadi ${labelRole(pilihan)}?`
  const deskripsiKonfirmasi =
    pilihan === "owner"
      ? "Owner punya hak setara Anda, termasuk kemungkinan menurunkan atau menghapus admin lain."
      : "Setelah diturunkan, user ini kehilangan hak owner."

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`aksi-role-${admin.telegram_user_id}`}>
      <Select
        value={pilihan}
        onValueChange={(v) => setPilihan(v as Role)}
        disabled={sendiri || mengirim}
      >
        <SelectTrigger
          size="sm"
          className="h-11 data-[size=sm]:h-11 md:h-8 md:data-[size=sm]:h-8"
          aria-label={`Role ${nama}`}
          data-testid={`pilih-role-${admin.telegram_user_id}`}
        >
          <SelectValue>
            {(v: string | null) => (v ? labelRole(v as Role) : "Pilih role")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {PILIHAN.map((r) => (
              <SelectItem key={r} value={r}>
                {labelRole(r)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Button
        size="sm"
        className="h-11 md:h-8"
        disabled={sendiri || mengirim || !berubah}
        title={sendiri ? "Tidak boleh mengubah role diri sendiri" : undefined}
        data-testid={`simpan-role-${admin.telegram_user_id}`}
        onClick={onClickSimpan}
      >
        {mengirim ? <Spinner data-icon="inline-start" /> : null}
        {mengirim ? "Menyimpan…" : "Simpan"}
      </Button>

      <AlertDialog open={konfirmasi} onOpenChange={setKonfirmasi}>
        <AlertDialogContent data-testid={`konfirmasi-role-${admin.telegram_user_id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>{judulKonfirmasi}</AlertDialogTitle>
            <AlertDialogDescription>{deskripsiKonfirmasi}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              data-testid={`batal-role-${admin.telegram_user_id}`}
              onClick={() => setKonfirmasi(false)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              data-testid={`konfirmasi-role-ok-${admin.telegram_user_id}`}
              onClick={() => {
                setKonfirmasi(false)
                void kirim()
              }}
            >
              Ya, ubah role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}