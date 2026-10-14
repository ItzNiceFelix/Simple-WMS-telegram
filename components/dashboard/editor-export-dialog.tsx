"use client"

// components/dashboard/editor-export-dialog.tsx — Dialog ekspor kanvas editor (rencana §Editor Fase 6).
// Komponen ini TIDAK meng-import fabric: ia hanya meminta Blob lewat callback `buatBlob`
// supaya bundel kanvas tetap satu titik muat dan dialog bisa diuji terpisah.
import { useEffect, useState } from "react"
import type { JSX } from "react"
import { toast } from "sonner"
import { Download, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

/** Format ekspor yang ditawarkan. JPEG default: foto produk hampir selalu butuh latar padat. */
export type FormatEkspor = "jpeg" | "png"

/** Rentang mutu JPEG; 1 tidak ditawarkan karena hanya membengkakkan berkas. */
const KUALITAS = [
  { id: "0.8", label: "Kecil (0.8)" },
  { id: "0.9", label: "Sedang (0.9)" },
  { id: "0.95", label: "Tinggi (0.95)" },
] as const

/** Batas unggah gambar Shopee; nama merek dipakai karena user yang tahu angka ini. */
const BATAS_SHOPEE = 2 * 1024 * 1024

/** Ukuran berkas dalam satuan yang mudah dibaca (KB di bawah 1 MB). */
function ukuranTeks(byte: number): string {
  return byte >= 1024 * 1024 ? `${(byte / 1024 / 1024).toFixed(2)} MB` : `${Math.round(byte / 1024)} KB`
}

/** Blob → base64 tanpa prefix data URL (route Telegram menolak prefix). */
function blobKeBase64(blob: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const baca = new FileReader()
  baca.onload = () => {
    const hasil = typeof baca.result === "string" ? baca.result : ""
    const koma = hasil.indexOf(",")
    if (koma < 0) reject(new Error("Gagal membaca hasil ekspor."))
    else resolve(hasil.slice(koma + 1))
  }
  baca.onerror = () => reject(new Error("Gagal membaca hasil ekspor."))
  baca.readAsDataURL(blob)
  return promise
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Menghasilkan berkas dari kanvas. null = kanvas belum siap / gagal render. */
  buatBlob: (format: FormatEkspor, kualitas: number, transparan: boolean) => Promise<Blob | null>
  /** Ukuran dokumen asli (piksel preset), dipakai untuk pratinjau nama berkas. */
  lebar: number
  tinggi: number
}

export function EditorExportDialog({ open, onOpenChange, buatBlob, lebar, tinggi }: Props): JSX.Element {
  const [format, setFormat] = useState<FormatEkspor>("jpeg")
  const [kualitas, setKualitas] = useState(0.9)
  const [transparan, setTransparan] = useState(false)
  const [nama, setNama] = useState("desain")
  const [blob, setBlob] = useState<Blob | null>(null)
  const [memuat, setMemuat] = useState(false)
  const [mengirim, setMengirim] = useState(false)

  // Regenerate tiap opsi berubah: perkiraan ukuran harus mencerminkan opsi yang aktif.
  // Canvas bukan sumber "kebenaran reaktif" → aman untuk tidak masuk daftar dependensi.
  // ponytail: regenerasi penuh tiap ganti opsi. Add when kanvas besar bikin lag: cache per opsi.
  useEffect(() => {
    if (!open) return
    let hidup = true
    setMemuat(true)
    // Aturan ekspor: JPEG tidak punya alfa → latar selalu dipaksa putih.
    const pkBlob = buatBlob(format, kualitas, format === "png" && transparan)
    void pkBlob
      .then((b) => {
        if (!hidup) return
        setBlob(b)
        if (!b) toast.error("Kanvas belum siap diekspor. Coba lagi.")
      })
      .catch((e) => {
        if (!hidup) return
        setBlob(null)
        tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal membuat berkas.")
      })
      .finally(() => {
        if (hidup) setMemuat(false)
      })
    return () => {
      hidup = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, format, kualitas, transparan])

  const ekstensi = format === "jpeg" ? "jpg" : "png"
  const mime = format === "jpeg" ? "image/jpeg" : "image/png"
  // Nama kosong/hanya spasi → jangan hasilkan berkas bernama ".".jpg.
  const namaBersih = nama.trim().replace(/[\\/:*?"<>|]+/g, "-") || "desain"
  const terlaluBesar = blob !== null && blob.size > BATAS_SHOPEE

  /** Unduh lewat anchor sementara; URL dicabut setelah klik supaya memori tidak bocor. */
  function simpanLokal() {
    if (!blob) {
      toast.error("Berkas belum siap. Tunggu sampai pratinjau ukuran muncul.")
      return
    }
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement("a")
      a.href = url
      a.download = `${namaBersih}.${ekstensi}`
      a.click()
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyimpan berkas.")
      return
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }
    toast.success("Berkas disimpan.")
  }

  async function kirimTelegram() {
    if (!blob) {
      toast.error("Berkas belum siap. Tunggu sampai pratinjau ukuran muncul.")
      return
    }
    setMengirim(true)
    try {
      const base64 = await blobKeBase64(blob)
      const res = await fetch("/api/ai/gambar/kirim-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ base64, mime, caption: namaBersih.slice(0, 1024) }),
      })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !d?.ok) {
        tampilkanGagalTulis(d?.error ?? `Gagal mengirim (${res.status}).`)
        return
      }
      toast.success("Gambar dikirim ke Telegram.")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi Telegram.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-ekspor-editor">
        <DialogHeader>
          <DialogTitle>Ekspor desain</DialogTitle>
          <DialogDescription>
            Hasil diekspor pada ukuran asli {lebar}x{tinggi} piksel, bukan ukuran tampilan di layar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="ekspor-format">Format</FieldLabel>
            <Select value={format} onValueChange={(v) => typeof v === "string" && setFormat(v as FormatEkspor)}>
              <SelectTrigger id="ekspor-format" className="w-full" data-testid="ekspor-format">
                <SelectValue>
                  {(v: string | null) => (v === "png" ? "PNG (bisa transparan)" : "JPEG (foto produk)")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jpeg">JPEG (foto produk)</SelectItem>
                <SelectItem value="png">PNG (bisa transparan)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {/* Mutu hanya berarti untuk JPEG; PNG selalu lossless. */}
          {format === "jpeg" && (
            <Field>
              <FieldLabel htmlFor="ekspor-kualitas">Kualitas JPEG</FieldLabel>
              <Select
                value={String(kualitas)}
                onValueChange={(v) => typeof v === "string" && setKualitas(Number(v))}
              >
                <SelectTrigger id="ekspor-kualitas" className="w-full" data-testid="ekspor-kualitas">
                  <SelectValue>
                    {(v: string | null) => KUALITAS.find((k) => k.id === v)?.label ?? "Sedang (0.9)"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {KUALITAS.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {format === "png" && (
            <Field orientation="horizontal">
              <input
                id="ekspor-transparan"
                type="checkbox"
                className="size-4 accent-primary"
                checked={transparan}
                onChange={(e) => setTransparan(e.target.checked)}
                data-testid="ekspor-transparan"
              />
              <FieldLabel htmlFor="ekspor-transparan">Latar transparan (tanpa putih)</FieldLabel>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="ekspor-nama">Nama berkas</FieldLabel>
            <Input
              id="ekspor-nama"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="desain"
              data-testid="ekspor-nama"
            />
            <FieldDescription>
              Hasil: <span className="font-mono">{namaBersih}.{ekstensi}</span>
            </FieldDescription>
          </Field>

          <div className="flex items-center gap-2 text-sm" data-testid="ekspor-ukuran">
            {memuat ? (
              <>
                <Spinner />
                <span className="text-muted-foreground">Membuat berkas…</span>
              </>
            ) : blob ? (
              <span className={terlaluBesar ? "text-destructive" : "text-muted-foreground"}>
                Perkiraan ukuran: {ukuranTeks(blob.size)}
                {terlaluBesar ? " — melebihi batas 2 MB Shopee, turunkan kualitas." : ""}
              </span>
            ) : (
              <span className="text-destructive">Berkas belum bisa dibuat.</span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={simpanLokal}
            disabled={!blob || memuat}
            data-testid="ekspor-simpan-lokal"
          >
            <Download data-icon="inline-start" />
            Simpan lokal
          </Button>
          <Button
            onClick={() => void kirimTelegram()}
            disabled={!blob || memuat || mengirim}
            data-testid="ekspor-kirim-telegram"
          >
            {mengirim ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
            Kirim Telegram
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
