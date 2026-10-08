"use client"

// components/dashboard/dialog-import-excel.tsx
// Import Excel 2-fase (Fase 2, PRD F3): upload → preview gagal/sukses → konfirmasi.
// Export: tombol unduh per tipe (produk/stok/hpp) + filter gudang.
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
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  gudangId?: string
  onSukses?: () => void
}

type Preview = {
  batch_id: number
  total: number
  sukses: number
  gagal: { baris: number; pesan: string }[]
};

export function DialogImportExcel({ open, onOpenChange, gudangId = "ONLINE", onSukses }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mengirim, setMengirim] = useState(false)

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
      const form = new FormData()
      form.append("file", file)
      form.append("gudang_id", gudangId)
      const res = await fetch("/api/excel", { method: "POST", body: form, credentials: "include" })
      const data = (await res.json()) as Preview & { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        tampilkanGagalTulis((data as { error?: string }).error ?? `Gagal (${res.status}).`)
        return
      }
      setPreview(data)
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
      const res = await fetch("/api/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "konfirmasi", batch_id: preview.batch_id }),
        credentials: "include",
      })
      const data = (await res.json()) as { ok: boolean; sukses?: number; error?: string };
      if (!res.ok || !data.ok) {
        tampilkanGagalTulis(data.error ?? `Gagal (${res.status}).`)
        return
      }
      toast.success(`Import selesai: ${data.sukses} produk.`)
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
          <DialogTitle>Import Excel</DialogTitle>
          <DialogDescription>
            Pakai template resmi (<a className="underline" href="/template-import-produk.xlsx">unduh template</a>).
            Upload → preview → konfirmasi. SKU ada = update.
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
