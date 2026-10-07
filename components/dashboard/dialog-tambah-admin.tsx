"use client"

// components/dashboard/dialog-tambah-admin.tsx
// F4a Tambah admin (owner only). PRD v2 §5.5/§5.6.
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
import type { Role } from "@/lib/dashboard/types"

const PILIHAN: Role[] = ["owner", "admin", "guest"]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dipanggil setelah sukses agar daftar admin refetch. */
  onSukses?: () => void
}

export function DialogTambahAdmin({ open, onOpenChange, onSukses }: Props) {
  const data = useData()
  const [userId, setUserId] = useState("")
  const [nama, setNama] = useState("")
  const [username, setUsername] = useState("")
  const [role, setRole] = useState<Role>("guest")
  const [error, setError] = useState<string | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const sinkronSaatBuka = useRef(false)

  // Sinkronkan isian hanya saat dialog TRANSISI tertutup -> buka (dialog tetap ter-mount
  // saat open=false, jadi hasil reset() dari sesi sebelumnya bisa tertinggal). Tidak
  // menyentuh isian saat open tetap true atau saat tulis gagal (409/401: isian dipertahankan).
  useEffect(() => {
    if (open && !sinkronSaatBuka.current) reset()
    sinkronSaatBuka.current = open
  }, [open])

  function reset() {
    setUserId("")
    setNama("")
    setUsername("")
    setRole("guest")
    setError(null)
    setMengirim(false)
  }

  function tutup(v: boolean) {
    if (mengirim) return
    if (!v) reset()
    onOpenChange(v)
  }

  async function kirim() {
    if (!/^\d+$/.test(userId.trim())) {
      setError("User ID Telegram tidak valid.")
      return
    }
    if (nama.trim().length < 1 || nama.trim().length > 80) {
      setError("Nama wajib diisi (maks 80 karakter).")
      return
    }
    const u = username.trim()
    if (u !== "" && (u.startsWith("@") || /\s/.test(u))) {
      setError("Username tidak valid.")
      return
    }
    setError(null)
    setMengirim(true)
    try {
      const res = await data.tambahAdmin({
        telegram_user_id: userId.trim(),
        name: nama.trim(),
        telegram_username: u === "" ? null : u,
        role,
      })
      if (res.ok) {
        toast.success(`Admin ${nama.trim()} ditambahkan.`)
        if (res.peringatan_audit) toast.warning("Admin ditambahkan, tetapi audit gagal dicatat.")
        reset()
        onOpenChange(false)
        onSukses?.()
      } else {
        // 409 & 401: pesan inline, dialog tetap terbuka, isian DIPERTAHANKAN.
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (kedaluwarsa) {
          setMengirim(false)
        } else {
          setError(res.error)
          setMengirim(false)
        }
      }
    } catch {
      toast.error("Gagal menambah admin.")
      setMengirim(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-tambah-admin">
        <DialogHeader>
          <DialogTitle>Tambah Admin</DialogTitle>
          <DialogDescription>Daftarkan akun Telegram sebagai admin dashboard.</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void kirim()
          }}
        >
          <Field data-invalid={error ? true : undefined} data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="admin-user-id">User ID Telegram</FieldLabel>
            <Input
              id="admin-user-id"
              inputMode="numeric"
              autoComplete="off"
              value={userId}
              aria-invalid={error ? true : undefined}
              disabled={mengirim}
              placeholder="mis. 900123"
              data-testid="input-user-id"
              onChange={(e) => {
                setUserId(e.target.value)
                setError(null)
              }}
            />
          </Field>

          <Field data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="admin-nama">Nama</FieldLabel>
            <Input
              id="admin-nama"
              autoComplete="off"
              value={nama}
              disabled={mengirim}
              placeholder="mis. Budi Baru"
              data-testid="input-nama-admin"
              onChange={(e) => {
                setNama(e.target.value)
                setError(null)
              }}
            />
          </Field>

          <Field data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="admin-username">Username Telegram (opsional)</FieldLabel>
            <Input
              id="admin-username"
              autoComplete="off"
              value={username}
              disabled={mengirim}
              placeholder="tanpa @"
              data-testid="input-username-admin"
              onChange={(e) => {
                setUsername(e.target.value)
                setError(null)
              }}
            />
            <FieldDescription>Tanpa tanda @ dan tanpa spasi.</FieldDescription>
          </Field>

          <Field data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="admin-role">Role</FieldLabel>
            <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={mengirim}>
              <SelectTrigger
                id="admin-role"
                className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                data-testid="pilih-role-baru"
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
          </Field>

          {error ? <FieldError data-testid="error-tambah-admin">{error}</FieldError> : null}

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
              data-testid="submit-tambah-admin"
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