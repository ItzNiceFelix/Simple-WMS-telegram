"use client"

// components/dashboard/dialog-user-gudang-jabatan.tsx
// v5 F3/F4: satu dialog gabungan untuk GUDANG KERJA (scope) + JABATAN (label kosmetik)
// satu user. Owner-only. Gudang harus aktif; jabatan maks 40 code point, boleh kosong.
// Bila salah satu aksi gagal, dialog TIDAK ditutup dan pesan server ditampilkan apa adanya.
import { useCallback, useEffect, useRef, useState } from "react"
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
import { Badge } from "@/components/ui/badge"
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
import type { AdminDoc, GudangDoc } from "@/lib/dashboard/types"

const MAKS_JABATAN = 40
/** Sentinel Select: Base UI tidak andal dengan value string kosong. */
const TANPA_GUDANG = "__tanpa__"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  admin: AdminDoc
  onSukses?: (admin: AdminDoc) => void
}

export function DialogUserGudangJabatan({ open, onOpenChange, admin, onSukses }: Props) {
  const data = useData()
  const [gudang, setGudang] = useState<GudangDoc[] | null>(null)
  const [gudangError, setGudangError] = useState(false)
  const [pilihanGudang, setPilihanGudang] = useState<string>(TANPA_GUDANG)
  const [jabatan, setJabatan] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [mengirim, setMengirim] = useState(false)
  // Baseline tersimpan: ikut diperbarui saat salah satu aksi sukses sebagian supaya retry
  // tidak mengirim ulang aksi yang sudah berhasil.
  const [tersimpan, setTersimpan] = useState<{ gudang: string | null; jabatan: string | null }>({
    gudang: null,
    jabatan: null,
  })
  const sinkronSaatBuka = useRef(false)

  const muatGudang = useCallback(async () => {
    setGudangError(false)
    setGudang(null)
    try {
      // Default listGudang hanya mengembalikan gudang aktif.
      setGudang(await data.listGudang())
    } catch {
      setGudangError(true)
    }
  }, [data])

  // Isian disinkronkan hanya saat transisi tertutup -> buka. Tulis gagal mempertahankan isian.
  useEffect(() => {
    if (open && !sinkronSaatBuka.current) {
      setPilihanGudang(admin.gudang_id ? admin.gudang_id : TANPA_GUDANG)
      setJabatan(admin.jabatan ?? "")
      setTersimpan({ gudang: admin.gudang_id ?? null, jabatan: admin.jabatan ?? null })
      setError(null)
      setMengirim(false)
      void muatGudang()
    }
    sinkronSaatBuka.current = open
  }, [open, admin, muatGudang])

  const nama = admin.name ?? admin.telegram_user_id
  const gudangDipilih = pilihanGudang === TANPA_GUDANG ? null : pilihanGudang
  const jabatanBaru = jabatan.trim() === "" ? null : jabatan.trim()
  const berubahGudang = gudangDipilih !== tersimpan.gudang
  const berubahJabatan = jabatanBaru !== tersimpan.jabatan
  const berubah = berubahGudang || berubahJabatan

  function tutup(v: boolean) {
    if (mengirim) return
    if (!v) setError(null)
    onOpenChange(v)
  }

  async function kirim() {
    const hitungJabatan = [...jabatan.trim()].length
    if (hitungJabatan > MAKS_JABATAN) {
      setError(`Jabatan maksimal ${MAKS_JABATAN} karakter.`)
      return
    }
    if (!berubah) return
    setError(null)
    setMengirim(true)
    let terbaru: AdminDoc = admin
    try {
      if (berubahGudang) {
        const res = await data.setGudangUser({
          target_user_id: admin.telegram_user_id,
          gudang_id: gudangDipilih,
        })
        if (!res.ok) {
          const kedaluwarsa = tampilkanGagalTulis(res.error)
          if (!kedaluwarsa) setError(res.error)
          setMengirim(false)
          return
        }
        terbaru = res.admin
        setTersimpan((t) => ({ ...t, gudang: gudangDipilih }))
      }
      if (berubahJabatan) {
        const res = await data.setJabatan({
          target_user_id: admin.telegram_user_id,
          jabatan: jabatanBaru,
        })
        if (!res.ok) {
          const kedaluwarsa = tampilkanGagalTulis(res.error)
          if (!kedaluwarsa) setError(res.error)
          setMengirim(false)
          return
        }
        terbaru = res.admin
        setTersimpan((t) => ({ ...t, jabatan: jabatanBaru }))
      }
      toast.success(`Data ${nama} disimpan.`)
      onOpenChange(false)
      onSukses?.(terbaru)
    } catch {
      toast.error("Gagal menyimpan. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  const kosongGudang = gudang !== null && gudang.length === 0

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-user-gudang-jabatan">
        <DialogHeader>
          <DialogTitle>Gudang &amp; Jabatan</DialogTitle>
          <DialogDescription>
            Atur gudang kerja dan jabatan untuk {nama}.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void kirim()
          }}
        >
          <Field>
            <FieldLabel>Role saat ini</FieldLabel>
            <div className="flex items-center gap-2">
              <Badge variant={admin.role === "owner" ? "default" : "secondary"}>
                {labelRole(admin.role)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Jabatan tidak mengubah hak akses.
              </span>
            </div>
          </Field>

          <Field data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="user-gudang">Gudang kerja</FieldLabel>
            <Select
              value={pilihanGudang}
              onValueChange={(v) => {
                setPilihanGudang(v as string)
                setError(null)
              }}
              disabled={mengirim || gudang === null}
            >
              <SelectTrigger
                id="user-gudang"
                className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                data-testid="pilih-gudang-user"
              >
                <SelectValue>
                  {(v: string | null) =>
                    !v || v === TANPA_GUDANG
                      ? "Tanpa gudang"
                      : ((gudang ?? []).find((g) => g.gudang_id === v)?.nama ?? v)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={TANPA_GUDANG}>Tanpa gudang</SelectItem>
                  {(gudang ?? []).map((g) => (
                    <SelectItem key={g.gudang_id} value={g.gudang_id}>
                      {g.nama}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {gudangError ? (
              <FieldError data-testid="error-gudang-user">
                Gagal memuat daftar gudang.{" "}
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => void muatGudang()}
                >
                  Coba lagi
                </button>
              </FieldError>
            ) : gudang === null ? (
              <FieldDescription>Memuat daftar gudang...</FieldDescription>
            ) : kosongGudang ? (
              <FieldDescription>
                Belum ada gudang aktif. Tambahkan gudang di Pengaturan terlebih dahulu.
              </FieldDescription>
            ) : (
              <FieldDescription>
                Gudang menentukan scope stok user. Pilih "Tanpa gudang" untuk menghapus.
              </FieldDescription>
            )}
          </Field>

          <Field
            data-invalid={error ? true : undefined}
            data-disabled={mengirim ? true : undefined}
          >
            <FieldLabel htmlFor="user-jabatan">Jabatan</FieldLabel>
            <Input
              id="user-jabatan"
              autoComplete="off"
              value={jabatan}
              aria-invalid={error ? true : undefined}
              disabled={mengirim}
              placeholder="mis. Staff Gudang D12"
              data-testid="input-jabatan-user"
              onChange={(e) => {
                setJabatan(e.target.value)
                setError(null)
              }}
            />
            <FieldDescription>Label bebas, maksimal {MAKS_JABATAN} karakter.</FieldDescription>
          </Field>

          {error ? (
            <FieldError data-testid="error-user-gudang-jabatan">{error}</FieldError>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="batal-user-gudang-jabatan"
              onClick={() => tutup(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              size="lg"
              className="h-11 md:h-9"
              disabled={mengirim || !berubah}
              data-testid="simpan-user-gudang-jabatan"
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
