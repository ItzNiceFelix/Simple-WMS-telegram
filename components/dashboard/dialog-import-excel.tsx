"use client"

// components/dashboard/dialog-import-excel.tsx
// Import Excel 2-fase (Fase 2, PRD F3): upload → preview gagal/sukses → konfirmasi.
// Export: tombol unduh per tipe (produk/stok/hpp) + filter gudang.
import { useState } from "react"
import * as XLSX from "xlsx"
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
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  gudangId?: string
  onSukses?: () => void
  tipe?: "produk" | "pesanan"
}

type Preview = {
  batch_id: number
  total: number
  sukses: number
  gagal: { baris: number; pesan: string }[]
  peringatan?: string[]
};

function isPreviewOk(v: unknown): v is Preview & { ok: true } {
  return !!v && typeof v === "object" && "ok" in v && v.ok === true && "batch_id" in v && "total" in v && "sukses" in v && "gagal" in v
}

function isKonfirmasiOk(v: unknown): v is { ok: true; sukses?: number; order?: number; item?: number } {
  return !!v && typeof v === "object" && "ok" in v && v.ok === true
}

export function DialogImportExcel({ open, onOpenChange, gudangId = "ONLINE", onSukses, tipe = "produk" }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const endpoint = tipe === "pesanan" ? "/api/order" : "/api/excel"

  function tutup(v: boolean) {
    if (mengirim) return
    if (!v) {
      setFile(null)
      setPreview(null)
    }
    onOpenChange(v)
  }

  async function unggah() {
    if (!file) return
    setMengirim(true)
    try {
      if (tipe === "pesanan") {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: "array" })
        const nama = wb.SheetNames.includes("Pesanan") ? "Pesanan" : wb.SheetNames[0]
        const ws = nama ? wb.Sheets[nama] : undefined
        if (!nama || !ws) {
          tampilkanGagalTulis("Sheet Pesanan tidak ditemukan.")
          return
        }
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" })
        if (rows.length === 0) {
          tampilkanGagalTulis(`Sheet ${nama} kosong.`)
          return
        }
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aksi: "preview", rows, file: file.name }),
          credentials: "include",
        })
        if (!res.ok) throw new Error(`Gagal preview pesanan (${res.status}).`);
        const raw: unknown = await res.json()
        if (!isPreviewOk(raw)) {
          tampilkanGagalTulis(raw && typeof raw === "object" && "error" in raw && typeof raw.error === "string" ? raw.error : `Gagal (${res.status}).`)
          return
        }
        setPreview(raw)
        return
      }
      const form = new FormData()
      form.append("file", file)
      form.append("gudang_id", gudangId)
      const res = await fetch(endpoint, { method: "POST", body: form, credentials: "include" })
      if (!res.ok) throw new Error(`Gagal preview (${res.status}).`);
      const raw: unknown = await res.json()
      if (!isPreviewOk(raw)) {
        tampilkanGagalTulis(raw && typeof raw === "object" && "error" in raw && typeof raw.error === "string" ? raw.error : `Gagal (${res.status}).`)
        return
      }
      setPreview(raw)
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  async function konfirmasi() {
    if (!preview) return
    setMengirim(true)
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "konfirmasi", batch_id: preview.batch_id }),
        credentials: "include",
      })
      if (!res.ok) throw new Error(`Gagal konfirmasi (${res.status}).`);
      const raw: unknown = await res.json()
      if (!isKonfirmasiOk(raw)) {
        tampilkanGagalTulis(raw && typeof raw === "object" && "error" in raw && typeof raw.error === "string" ? raw.error : `Gagal (${res.status}).`)
        return
      }
      const jml = "order" in raw && typeof raw.order === "number" ? `Import selesai: ${raw.order} order, ${"item" in raw && typeof raw.item === "number" ? raw.item : preview.sukses} item.` : `Import selesai: ${"sukses" in raw && typeof raw.sukses === "number" ? raw.sukses : preview.sukses} produk.`
      toast.success(jml)
      tutup(false)
      onSukses?.()
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tipe === "pesanan" ? "Import Pesanan" : "Import Excel"}</DialogTitle>
          <DialogDescription>
            Pakai template resmi (<a className="underline" href="/template-import-produk.xlsx">unduh template</a>).
            {tipe === "pesanan" ? " Isi sheet Pesanan → preview → konfirmasi. Satu order boleh multi-baris." : " Upload → preview → konfirmasi. SKU ada = update."}
          </DialogDescription>
        </DialogHeader>
        {!preview ? (
          <div className="space-y-3">
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && <p className="text-sm text-muted-foreground">{file.name} ({Math.round(file.size / 1024)} KB)</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">
              Total {preview.total} baris: <b className="text-emerald-600">{preview.sukses} valid</b>
              {preview.gagal.length > 0 && <>, <b className="text-red-600">{preview.gagal.length} gagal</b></>}
            </p>
            {preview.peringatan && preview.peringatan.length > 0 && (
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                {preview.peringatan.slice(0, 20).map((w, i) => (
                  <li key={`${i}-${w.slice(0, 32)}`}>{w}</li>
                ))}
                {preview.peringatan.length > 20 && <li>… +{preview.peringatan.length - 20} lagi</li>}
              </ul>
            )}
            {preview.gagal.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs">
                {preview.gagal.slice(0, 50).map((g) => (
                  <li key={g.baris}>Baris {g.baris}: {g.pesan}</li>
                ))}
                {preview.gagal.length > 50 && <li>… +{preview.gagal.length - 50} lagi</li>}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          {!preview ? (
            <Button onClick={unggah} disabled={!file || mengirim}>
              {mengirim && <Spinner />} Upload & preview
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={mengirim}>
                Ganti file
              </Button>
              <Button onClick={konfirmasi} disabled={preview.sukses === 0 || mengirim}>
                {mengirim && <Spinner />} Konfirmasi ({preview.sukses})
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
