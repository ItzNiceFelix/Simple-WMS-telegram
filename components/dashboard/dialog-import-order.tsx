"use client"

// components/dashboard/dialog-import-order.tsx — Import Order.toship + Advance (Fase E2).
// Dipilih sebagai file baru (bukan perluas dialog-import-excel.tsx) karena panelnya
// spesifik export Shopee 2-sheet: ringkasan, Perlu SKU + tebakan, Compare Nama, dan
// blok peringatan (MUNDUR / resi gabungan / kriteria / gagal). dialog-import-excel
// tetap dipakai template generik 7 kolom supaya jalur lama tidak berubah perilaku.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

type Kandidat = { sku: string; nama: string; skor: number }
type BarisBelumSku = {
  order_ref: string
  nama_shopee: string
  variasi: string
  tebakan: { sku: string; perlu_pilih_manual: boolean; kandidat: Kandidat[] }
}
type Mundur = { no_pesanan: string; no_resi: string; wms: string; file: string }
type ResiMulti = { no_resi: string; no_pesanan: string[]; jumlah_order: number }
type Kriteria = { no_resi: string; no_pesanan: string[]; alasan: string[] }
type Compare = { sku: string; nama_shopee: string; nama_d1: string; sama: boolean }
type Gagal = { no_pesanan: string; sku?: string; pesan: string }

type Preview = {
  batch_id: number
  totalBaris: number
  orders: unknown[]
  advance: unknown[]
  belumSku: BarisBelumSku[]
  gagal: Gagal[]
  klasifikasi: {
    baru: number
    update: number
    skip: number
    mundur: Mundur[]
    resiMultiOrder: ResiMulti[]
    gandaDalamFile: { no_pesanan: string; jumlah: number }[]
    kriteriaGabungan: Kriteria[]
    advanceSkip: string[]
  }
  compareNama: Compare[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSukses?: () => void
}

/** Pilihan SKU master untuk 1 baris "Perlu SKU" (tebakan dulu, lalu manual). */
function opsiUntuk(b: BarisBelumSku, master: string[]): string[] {
  const dariTebakan = b.tebakan.kandidat.map((k) => k.sku)
  return [...new Set([...dariTebakan, ...master.filter((s) => !dariTebakan.includes(s))])]
}

export function DialogImportOrder({ open, onOpenChange, onSukses }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const [manual, setManual] = useState<Record<string, string>>({})
  const [master, setMaster] = useState<string[]>([])
  const [tandai, setTandai] = useState<Set<string>>(new Set())

  function kunciBaris(b: BarisBelumSku): string {
    return `${b.order_ref}\u0000${b.nama_shopee}\u0000${b.variasi}`
  }

  function tutup(v: boolean) {
    if (mengirim) return
    if (!v) {
      setFile(null)
      setPreview(null)
      setManual({})
      setTandai(new Set())
    }
    onOpenChange(v)
  }

  async function unggah() {
    if (!file) return
    setMengirim(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" })
      const ordersWs = wb.Sheets["orders"]
      const advanceWs = wb.Sheets["Advance Fulfilment"]
      if (!ordersWs) { tampilkanGagalTulis('Workbook wajib memiliki sheet "orders".'); return }
      const ordersRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ordersWs, { defval: "" })
      const advanceRows = advanceWs ? XLSX.utils.sheet_to_json<Record<string, unknown>>(advanceWs, { defval: "" }) : []
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "preview-shopee", ordersRows, advanceRows, file: file.name }),
        credentials: "include",
      })
      const raw = (await res.json().catch(() => null)) as (Preview & { ok?: boolean; error?: string }) | null
      if (!res.ok || !raw?.ok) { tampilkanGagalTulis(raw?.error ?? `Gagal preview (${res.status}).`); return }
      setPreview({ ...raw, totalBaris: ordersRows.length + advanceRows.length })
      const resMaster = await fetch("/api/produk?limit=500", { credentials: "include" })
      const dataMaster = (await resMaster.json().catch(() => null)) as { produk?: { sku: string }[] } | null
      setMaster((dataMaster?.produk ?? []).map((p) => p.sku))
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  function pilihSku(b: BarisBelumSku, sku: string): void {
    setManual((lama) => ({ ...lama, [kunciBaris(b)]: sku }))
  }

  function toggleTandai(b: BarisBelumSku): void {
    const k = kunciBaris(b)
    setTandai((lama) => {
      const baru = new Set(lama)
      if (baru.has(k)) baru.delete(k)
      else baru.add(k)
      return baru
    })
  }

  function siapCommit(): boolean {
    if (!preview) return false
    return preview.belumSku.every((b) => manual[kunciBaris(b)] || tandai.has(kunciBaris(b)))
  }

  async function konfirmasi() {
    if (!preview) return
    setMengirim(true)
    try {
      const skuManual = Object.entries(manual).map(([k, sku]) => {
        const [order_ref, nama_shopee, variasi] = k.split("\u0000")
        return { order_ref, nama_shopee, variasi, sku }
      })
      const tandaiBelumMp = preview.belumSku
        .filter((b) => tandai.has(kunciBaris(b)))
        .map((b) => ({ order_ref: b.order_ref, nama_shopee: b.nama_shopee, variasi: b.variasi }))
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "konfirmasi-shopee", batch_id: preview.batch_id, skuManual, tandaiBelumMp }),
        credentials: "include",
      })
      const raw = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; order?: number; item?: number; advance?: number } | null
      if (!res.ok || !raw?.ok) { tampilkanGagalTulis(raw?.error ?? `Gagal konfirmasi (${res.status}).`); return }
      toast.success(`Import selesai: ${raw.order ?? 0} order, ${raw.item ?? 0} item, ${raw.advance ?? 0} booking advance.`)
      tutup(false)
      onSukses?.()
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  const belumSkuList = preview?.belumSku ?? []
  const compareBeda = (preview?.compareNama ?? []).filter((c) => !c.sama)

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" data-testid="dialog-import-order">
        <DialogHeader>
          <DialogTitle>Import Order Shopee (Order.toship)</DialogTitle>
          <DialogDescription>
            Sheet <b>orders</b> + <b>Advance Fulfilment</b>. File sama ditolak (fingerprint). Status yang sudah
            lebih maju di WMS tidak diturunkan.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-3">
            <Input
              type="file"
              accept=".xlsx,.xls"
              data-testid="berkas-import-order"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && <p className="text-sm text-muted-foreground">{file.name} ({Math.round(file.size / 1024)} KB)</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm" data-testid="ringkas-import-order">
              {preview.totalBaris} baris dibaca: <b className="text-emerald-600">{preview.orders.length} order</b>,{" "}
              <b>{preview.advance.length} booking advance</b>
              {preview.gagal.length > 0 && <>, <b className="text-red-600">{preview.gagal.length} gagal</b></>} ·{" "}
              baru {preview.klasifikasi.baru}, update {preview.klasifikasi.update}, skip {preview.klasifikasi.skip}
              {preview.klasifikasi.advanceSkip.length > 0 && <> · advance skip {preview.klasifikasi.advanceSkip.length}</>}
            </p>

            {preview.klasifikasi.mundur.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900" data-testid="peringatan-mundur">
                <b>Beberapa no resi status belum update, silakan dicek dulu.</b>
                <ul className="mt-1 space-y-0.5">
                  {preview.klasifikasi.mundur.slice(0, 20).map((m) => (
                    <li key={m.no_pesanan}>{m.no_pesanan} — resi {m.no_resi || "-"} (WMS: {m.wms}, file: {m.file})</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.klasifikasi.gandaDalamFile.length > 0 && (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-900">
                <b>No. Pesanan ganda dalam file (tolak perbaiki export):</b>{" "}
                {preview.klasifikasi.gandaDalamFile.map((g) => `${g.no_pesanan}×${g.jumlah}`).join(", ")}
              </div>
            )}

            {preview.klasifikasi.resiMultiOrder.length > 0 && (
              <div className="rounded-lg bg-sky-50 p-3 text-xs text-sky-900" data-testid="peringatan-gabungan">
                <b>Pesanan Gabungan terdeteksi ({preview.klasifikasi.resiMultiOrder.length} resi).</b> Picklist default per paket.
                <ul className="mt-1 space-y-0.5">
                  {preview.klasifikasi.resiMultiOrder.slice(0, 20).map((r) => (
                    <li key={r.no_resi}>Resi {r.no_resi} — {r.jumlah_order} order: {r.no_pesanan.join(", ")}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.klasifikasi.kriteriaGabungan.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900" data-testid="peringatan-kriteria">
                <b>Tidak sesuai kriteria gabungan Shopee</b> (tidak memblokir):{" "}
                {preview.klasifikasi.kriteriaGabungan.map((k) => `${k.no_resi} (${k.alasan.join(", ")})`).join("; ")}
              </div>
            )}

            {belumSkuList.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Perlu SKU ({belumSkuList.length})</p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Nama Shopee</TableHead>
                        <TableHead>Variasi</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Belum di MP</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {belumSkuList.map((b) => {
                        const k = kunciBaris(b)
                        return (
                          <TableRow key={k} data-testid={`belum-sku-${b.order_ref}`}>
                            <TableCell className="tabular-nums">{b.order_ref}</TableCell>
                            <TableCell>{b.nama_shopee}</TableCell>
                            <TableCell>{b.variasi || "-"}</TableCell>
                            <TableCell>
                              <Select value={manual[k] ?? ""} onValueChange={(v) => typeof v === "string" && pilihSku(b, v)}>
                                <SelectTrigger className="h-9 w-52" data-testid={`pilih-sku-${b.order_ref}`}>
                                  <SelectValue placeholder={b.tebakan.sku ? `Tebakan: ${b.tebakan.sku}` : "Pilih SKU"} />
                                </SelectTrigger>
                                <SelectContent>
                                  {opsiUntuk(b, master).map((sku) => {
                                    const kandidat = b.tebakan.kandidat.find((x) => x.sku === sku)
                                    return (
                                      <SelectItem key={sku} value={sku}>
                                        {sku}{kandidat ? ` (${Math.round(kandidat.skor * 100)}%)` : ""}
                                      </SelectItem>
                                    )
                                  })}
                                </SelectContent>
                              </Select>
                              {b.tebakan.sku && (
                                <p className="mt-1 text-[11px] text-emerald-700">Cocok persis: {b.tebakan.sku}</p>
                              )}
                            </TableCell>
                            <TableCell>
                              <input
                                type="checkbox"
                                className="size-5 accent-primary"
                                aria-label={`Tandai belum ada SKU di MP ${b.nama_shopee}`}
                                data-testid={`tandai-belum-mp-${b.order_ref}`}
                                checked={tandai.has(k)}
                                disabled={Boolean(manual[k])}
                                onChange={() => toggleTandai(b)}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {compareBeda.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Compare Nama ({compareBeda.length} beda)</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs" data-testid="compare-nama">
                  {compareBeda.slice(0, 50).map((c) => (
                    <li key={c.sku}>
                      <b>{c.sku}</b> — Shopee: {c.nama_shopee} · D1: {c.nama_d1}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.gagal.length > 0 && (
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs" data-testid="gagal-import-order">
                {preview.gagal.slice(0, 50).map((g, i) => (
                  <li key={`${i}-${g.pesan.slice(0, 24)}`}>{g.no_pesanan || "-"}: {g.pesan}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {!preview ? (
            <Button onClick={unggah} disabled={!file || mengirim} data-testid="unggah-import-order">
              {mengirim && <Spinner />} Upload & preview
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={mengirim}>
                Ganti file
              </Button>
              <Button onClick={konfirmasi} disabled={mengirim || !siapCommit()} data-testid="konfirmasi-import-order">
                {mengirim && <Spinner />} Konfirmasi
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
