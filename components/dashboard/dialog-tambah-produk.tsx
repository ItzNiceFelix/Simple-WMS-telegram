"use client"

// components/dashboard/dialog-tambah-produk.tsx
// A5 Tambah produk (owner + admin). PRD v3b §10.2/§10.4 B6.
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
import { formatAngka } from "@/lib/dashboard/format"
import { useData } from "@/lib/dashboard/sumber-data"

const MAKS_KODE = 60
const MAKS_NAMA = 120
const MAKS_STOK_AWAL = 1_000_000

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dipanggil setelah sukses agar daftar stok refetch. */
  onSukses?: () => void
}

/** Pola 409 server: `kode "X" sudah dipakai produk lain`. */
function kodeSudahDipakai(error: string): boolean {
  return error.startsWith('kode "') && error.endsWith("sudah dipakai produk lain")
}

/** Bilangan bulat >= 0 opsional; kosong = tidak dikirim (undefined). */
function validasiOpsional(mentah: string, pesan: string): number | string | undefined {
  const teks = mentah.trim()
  if (teks === "") return undefined
  if (!/^\d+$/.test(teks)) return pesan
  return Number(teks)
}

export function DialogTambahProduk({ open, onOpenChange, onSukses }: Props) {
  const data = useData()
  const [kode, setKode] = useState("")
  const [nama, setNama] = useState("")
  const [hppText, setHppText] = useState("")
  const [stokText, setStokText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [errorKode, setErrorKode] = useState<string | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const sinkronSaatBuka = useRef(false)

  // Sinkronkan isian hanya saat dialog TRANSISI tertutup -> buka (dialog tetap ter-mount
  // saat open=false, jadi hasil reset() sesi sebelumnya bisa tertinggal). TIDAK menyentuh
  // isian saat open tetap true atau saat tulis gagal (409/401/400: isian DIPERTAHANKAN).
  useEffect(() => {
    if (open && !sinkronSaatBuka.current) reset()
    sinkronSaatBuka.current = open
  }, [open])

  function reset() {
    setKode("")
    setNama("")
    setHppText("")
    setStokText("")
    setError(null)
    setErrorKode(null)
    setMengirim(false)
  }

  function tutup(v: boolean) {
    if (mengirim) return // form terkunci saat submit (cegah double-tap)
    if (!v) reset()
    onOpenChange(v)
  }

  async function kirim() {
    const kodeTrim = kode.trim()
    const namaTrim = nama.trim()

    if (!kodeTrim) {
      setErrorKode("Kode barang wajib diisi.")
      return
    }
    if (kodeTrim.length > MAKS_KODE) {
      setErrorKode("Kode barang maksimal 60 karakter.")
      return
    }
    setErrorKode(null)

    if (!namaTrim) {
      setError("Nama produk wajib diisi.")
      return
    }
    if (namaTrim.length > MAKS_NAMA) {
      setError("Nama produk maksimal 120 karakter.")
      return
    }

    const hpp = validasiOpsional(hppText, "HPP harus bilangan bulat >= 0.")
    if (typeof hpp === "string") {
      setError(hpp)
      return
    }
    const stok = validasiOpsional(stokText, "Stok awal harus bilangan bulat >= 0.")
    if (typeof stok === "string") {
      setError(stok)
      return
    }
    if (stok !== undefined && stok > MAKS_STOK_AWAL) {
      setError("Stok awal maksimal 1.000.000.")
      return
    }

    setError(null)
    setMengirim(true)
    try {
      const res = await data.tambahProduk({
        kode_barang: kodeTrim,
        nama_produk: namaTrim,
        hpp,
        stok_awal: stok,
      })
      if (res.ok) {
        const stokAkhir = res.stok_awal
        toast.success(
          stokAkhir > 0
            ? `Produk ${kodeTrim} ditambahkan dengan stok awal ${formatAngka(stokAkhir)}.`
            : `Produk ${kodeTrim} ditambahkan.`
        )
        reset()
        onOpenChange(false)
        onSukses?.()
      } else if (kodeSudahDipakai(res.error)) {
        // 409 kode duplikat: pesan inline pada field kode, dialog tetap terbuka,
        // isian lain DIPERTAHANKAN.
        setErrorKode(res.error)
        setMengirim(false)
      } else {
        // 401 mid-write (B6): pesan khusus, dialog & isian DIPERTAHANKAN.
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (kedaluwarsa) {
          setMengirim(false)
        } else {
          // 400 validasi server: pesan inline, isian DIPERTAHANKAN.
          setError(res.error)
          setMengirim(false)
        }
      }
    } catch {
      toast.error("Gagal menambah produk. Coba lagi.")
      setMengirim(false)
    }
  }

  const tombolNonaktif = mengirim || kode.trim() === "" || nama.trim() === ""

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-tambah-produk">
        <DialogHeader>
          <DialogTitle>Tambah Produk</DialogTitle>
          <DialogDescription>Daftarkan produk online baru beserta stok awalnya.</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void kirim()
          }}
        >
          <Field data-invalid={errorKode ? true : undefined} data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="produk-kode">Kode barang</FieldLabel>
            <Input
              id="produk-kode"
              autoComplete="off"
              maxLength={MAKS_KODE}
              value={kode}
              aria-invalid={errorKode ? true : undefined}
              disabled={mengirim}
              placeholder="mis. BRG-999"
              data-testid="input-kode-produk"
              onChange={(e) => {
                setKode(e.target.value)
                setErrorKode(null)
              }}
            />
            {errorKode ? (
              <FieldError data-testid="error-kode-produk">{errorKode}</FieldError>
            ) : (
              <FieldDescription>Kode barang harus sama persis dengan kode di Accurate.</FieldDescription>
            )}
          </Field>

          <Field data-invalid={error ? true : undefined} data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="produk-nama">Nama produk</FieldLabel>
            <Input
              id="produk-nama"
              autoComplete="off"
              maxLength={MAKS_NAMA}
              value={nama}
              aria-invalid={error ? true : undefined}
              disabled={mengirim}
              placeholder="mis. Kemeja Flanel"
              data-testid="input-nama-produk"
              onChange={(e) => {
                setNama(e.target.value)
                setError(null)
              }}
            />
          </Field>

          <Field data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="produk-hpp">HPP (opsional)</FieldLabel>
            <Input
              id="produk-hpp"
              inputMode="numeric"
              autoComplete="off"
              value={hppText}
              disabled={mengirim}
              placeholder="0"
              data-testid="input-hpp-produk"
              onChange={(e) => {
                setHppText(e.target.value)
                setError(null)
              }}
            />
            <FieldDescription>Kosong berarti HPP belum diset.</FieldDescription>
          </Field>

          <Field data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="produk-stok-awal">Stok awal (opsional)</FieldLabel>
            <Input
              id="produk-stok-awal"
              inputMode="numeric"
              autoComplete="off"
              value={stokText}
              disabled={mengirim}
              placeholder="0"
              data-testid="input-stok-awal-produk"
              onChange={(e) => {
                setStokText(e.target.value)
                setError(null)
              }}
            />
            <FieldDescription>Kosong berarti 0. Maksimal 1.000.000.</FieldDescription>
          </Field>

          {error ? <FieldError data-testid="error-tambah-produk">{error}</FieldError> : null}

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
              disabled={tombolNonaktif}
              data-testid="simpan-produk"
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
