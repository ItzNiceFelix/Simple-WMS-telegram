"use client"

// components/dashboard/aksi-nama-admin.tsx
// Perbaiki nama tampilan user (owner only). Dipakai untuk membetulkan user yang
// terdaftar dengan display_name = telegramId (alur lama tanpa tanya-nama).
import { useState } from "react"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { useData } from "@/lib/dashboard/sumber-data"
import type { AdminDoc } from "@/lib/dashboard/types"

interface Props {
  admin: AdminDoc
  onSukses?: () => void
}

export function AksiNamaAdmin({ admin, onSukses }: Props) {
  const data = useData()
  const [buka, setBuka] = useState(false)
  const [nama, setNama] = useState(admin.name ?? "")
  const [mengirim, setMengirim] = useState(false)

  async function simpan() {
    const bersih = nama.trim()
    if (!bersih) {
      toast.error("Nama wajib diisi.")
      return
    }
    setMengirim(true)
    try {
      const r = await data.ubahNamaAdmin({ target_user_id: admin.telegram_user_id, nama: bersih })
      if (!r.ok) throw new Error(r.error)
      toast.success("Nama diperbarui.")
      setBuka(false)
      onSukses?.()
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal mengubah nama.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-9 md:h-7"
        onClick={() => {
          setNama(admin.name ?? "")
          setBuka(true)
        }}
        data-testid={`ubah-nama-${admin.telegram_user_id}`}
      >
        Ubah nama
      </Button>
      <Dialog open={buka} onOpenChange={setBuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah nama</DialogTitle>
            <DialogDescription>
              Nama tampilan untuk <span className="tabular-nums">{admin.telegram_user_id}</span>.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`nama-${admin.telegram_user_id}`}>Nama</FieldLabel>
            <Input
              id={`nama-${admin.telegram_user_id}`}
              className="h-11 md:h-8"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="mis. Bagus"
              data-testid={`input-nama-${admin.telegram_user_id}`}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuka(false)} disabled={mengirim}>
              Batal
            </Button>
            <Button onClick={() => void simpan()} disabled={mengirim} data-testid={`simpan-nama-${admin.telegram_user_id}`}>
              {mengirim ? <Spinner /> : null} Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
