"use client"

// components/dashboard/dialog-permintaan-export.tsx — Ekspor surat permintaan stok.
// PDF diunduh dari endpoint (server pdf-lib); JPG digambar di kanvas klien.
import { useState } from "react"
import type { JSX } from "react"
import { toast } from "sonner"
import { Download, Image as ImageIcon } from "lucide-react"

import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type BarisPermintaanEkspor = { nama: string; sku: string; qty: number }

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  id: string
  nama: string
  baris: BarisPermintaanEkspor[]
  asal: string
}

// Kanvas 2D: lebar tetap, tinggi dihitung dari jumlah baris.
const LEBAR = 1240
const PAD = 48
const BARIS_H = 52
const JUDUL_FS = 40
const ISI_FS = 22

/** Timestamp zona Jakarta: 09 Okt 2026, 14.35 WIB. */
function waktuJakarta(d = new Date()): string {
  const t = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)
  return `${t} WIB`
}

/** Gambar surat permintaan ke kanvas 2D; kembalikan kanvas siap toBlob. */
function gambarKeKanvas(p: Props): HTMLCanvasElement {
  const kanvas = document.createElement("canvas")
  kanvas.width = LEBAR
  const kaki = 200
  kanvas.height = PAD + 120 + p.baris.length * BARIS_H + 140 + kaki
  const ctx = kanvas.getContext("2d")
  if (!ctx) throw new Error("Canvas tak didukung.")

  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, kanvas.width, kanvas.height)

  let y = PAD + JUDUL_FS
  ctx.fillStyle = "#0f172a"
  ctx.font = `700 ${JUDUL_FS}px system-ui, sans-serif`
  ctx.fillText("Admin Toko", PAD, y)
  y += 40
  ctx.font = `600 ${ISI_FS + 4}px system-ui, sans-serif`
  ctx.fillText("PERMINTAAN STOK — GUDANG ONLINE", PAD, y)
  y += 36
  ctx.fillStyle = "#64748b"
  ctx.font = `${ISI_FS}px system-ui, sans-serif`
  ctx.fillText(`Gudang asal: ${p.asal || "-"}`, PAD, y)
  y += 30
  ctx.fillText(`Dokumen: ${p.nama || p.id}`, PAD, y)
  y += 30
  ctx.fillText(`Dicetak: ${waktuJakarta()}`, PAD, y)
  y += 40

  const xSku = LEBAR - PAD - 320
  const xQty = LEBAR - PAD - 80
  ctx.fillStyle = "#0f172a"
  ctx.font = `700 ${ISI_FS}px system-ui, sans-serif`
  ctx.fillText("Nama Produk", PAD, y)
  ctx.fillText("SKU", xSku, y)
  ctx.fillText("Qty", xQty, y)
  y += 10
  ctx.strokeStyle = "#cbd5e1"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, y)
  ctx.lineTo(LEBAR - PAD, y)
  ctx.stroke()
  y += 36

  let total = 0
  p.baris.forEach((b, i) => {
    total += b.qty
    if (i % 2 === 0) {
      ctx.fillStyle = "#f8fafc"
      ctx.fillRect(PAD - 8, y - 28, LEBAR - PAD * 2 + 16, BARIS_H)
    }
    ctx.fillStyle = "#0f172a"
    ctx.font = `${ISI_FS}px system-ui, sans-serif`
    const namaPendek = b.nama.length > 60 ? `${b.nama.slice(0, 60)}…` : b.nama
    ctx.fillText(namaPendek, PAD, y)
    ctx.fillText(b.sku, xSku, y)
    ctx.font = `700 ${ISI_FS}px system-ui, sans-serif`
    ctx.fillText(String(b.qty), xQty, y)
    y += BARIS_H
  })

  ctx.strokeStyle = "#cbd5e1"
  ctx.beginPath()
  ctx.moveTo(PAD, y - 28)
  ctx.lineTo(LEBAR - PAD, y - 28)
  ctx.stroke()
  ctx.fillStyle = "#0f172a"
  ctx.font = `700 ${ISI_FS}px system-ui, sans-serif`
  ctx.fillText("TOTAL", xSku - 120, y)
  ctx.fillText(String(total), xQty, y)
  y += 70

  const kotakW = 380
  ;["Picker", "Checker"].forEach((label, i) => {
    const kx = PAD + i * (kotakW + 60)
    ctx.strokeStyle = "#cbd5e1"
    ctx.lineWidth = 2
    ctx.strokeRect(kx, y, kotakW, 130)
    ctx.beginPath()
    ctx.moveTo(kx + 24, y + 80)
    ctx.lineTo(kx + kotakW - 24, y + 80)
    ctx.stroke()
    ctx.fillStyle = "#0f172a"
    ctx.font = `700 ${ISI_FS}px system-ui, sans-serif`
    ctx.fillText(label, kx + 24, y + 108)
  })

  return kanvas
}

function namaBerkas(p: Props, ekstensi: string): string {
  return `permintaan-${p.nama.trim().replace(/[\\/:*?"<>|]+/g, "-") || p.id}.${ekstensi}`
}

export function DialogPermintaanExport(p: Props): JSX.Element {
  const [sibuk, setSibuk] = useState(false)

  /** PDF dari endpoint (server), bukan blob klien — pola repo memakai window.open. */
  function unduhPdf() {
    window.open(`/api/permintaan-gudang?aksi=pdf&id=${encodeURIComponent(p.id)}`, "_blank")
  }

  async function unduhJpg() {
    setSibuk(true)
    try {
      const kanvas = gambarKeKanvas(p)
      const blob = await new Promise<Blob | null>((res) => kanvas.toBlob(res, "image/jpeg", 0.92))
      if (!blob) throw new Error("Gagal membuat gambar.")
      const url = URL.createObjectURL(blob)
      try {
        const a = document.createElement("a")
        a.href = url
        a.download = namaBerkas(p, "jpg")
        a.click()
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      }
      toast.success("Gambar permintaan disimpan.")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal membuat gambar.")
    } finally {
      setSibuk(false)
    }
  }

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-ekspor-permintaan">
        <DialogHeader>
          <DialogTitle>Ekspor permintaan</DialogTitle>
          <DialogDescription>
            Surat permintaan stok dari {p.asal || "gudang asal"} berisi {p.baris.length} item. PDF
            dibuat di server, JPG digambar di perangkat ini.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            data-testid="permintaan-unduh-pdf"
            onClick={unduhPdf}
          >
            <Download data-icon="inline-start" />
            Unduh PDF
          </Button>
          <Button
            type="button"
            className="h-11 md:h-9"
            disabled={sibuk}
            data-testid="permintaan-unduh-jpg"
            onClick={() => void unduhJpg()}
          >
            <ImageIcon data-icon="inline-start" />
            {sibuk ? "Menyiapkan..." : "Unduh JPG"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
