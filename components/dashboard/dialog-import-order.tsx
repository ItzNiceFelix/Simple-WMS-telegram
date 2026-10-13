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
import { PilihSku, type OpsiSku } from "@/components/dashboard/pilih-sku"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

type Kandidat = { sku: string; nama: string; skor: number }
type BarisBelumSku = {
  /** No. Pesanan pertama pada grup (kompat). */
  order_ref: string
  /** Seluruh No. Pesanan yang memuat produk sama ini. */
  order_refs: string[]
  /** Banyak order yang terkena — inilah yang tampil di kolom Order. */
  jumlah_order: number
  nama_shopee: string
  variasi: string
  qty_total: number
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

/** Opsi SKU untuk 1 baris "Perlu SKU": kandidat tebakan (beri skor) lalu seluruh master. */
function opsiUntuk(b: BarisBelumSku, master: OpsiSku[]): OpsiSku[] {
  const dariTebakan: OpsiSku[] = b.tebakan.kandidat.map((k) => ({ sku: k.sku, nama: k.nama, skor: k.skor }))
  const ada = new Set(dariTebakan.map((o) => o.sku))
  return [...dariTebakan, ...master.filter((m) => !ada.has(m.sku))]
}

export function DialogImportOrder({ open, onOpenChange, onSukses }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const [manual, setManual] = useState<Record<string, string>>({})
  const [master, setMaster] = useState<OpsiSku[]>([])
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
      // Daftar SKU master untuk pemilih manual. Endpoint: /api/baca?scope=produk
      // (tidak ada /api/produk — dulu 404 sehingga daftar selalu kosong).
      const resMaster = await fetch("/api/baca?scope=produk", { credentials: "include" })
      const dataMaster = (await resMaster.json().catch(() => null)) as
        | { ok?: boolean; rows?: { sku: string; nama_accurate?: string }[] }
        | null
      setMaster((dataMaster?.rows ?? []).map((p) => ({ sku: p.sku, nama: p.nama_accurate ?? "" })))
      if (!dataMaster?.ok) tampilkanGagalTulis("Daftar SKU master gagal dimuat — pemilih SKU hanya berisi tebakan.")
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

  /** Tandai semua baris yang masih kosong sebagai "belum ada di MP" (sekali klik). */
  function tandaiSemuaSisa(): void {
    setTandai((lama) => {
      const baru = new Set(lama)
      for (const b of preview?.belumSku ?? []) {
        const k = kunciBaris(b)
        if (!manual[k]) baru.add(k)
      }
      return baru
    })
  }

  function siapCommit(): boolean {
    if (!preview) return false
    return preview.belumSku.every((b) => manual[kunciBaris(b)] || tandai.has(kunciBaris(b)))
  }

  /** Baris yang belum dipilih SKU dan belum ditandai — penyebab tombol Konfirmasi mati. */
  const belumLengkap = (preview?.belumSku ?? []).filter((b) => !manual[kunciBaris(b)] && !tandai.has(kunciBaris(b)))

  async function konfirmasi() {
    if (!preview) return
    setMengirim(true)
    try {
      const skuManual = Object.entries(manual).flatMap(([k, sku]) => {
        const [order_ref, nama_shopee, variasi] = k.split("\u0000")
        // Baris preview mewakili beberapa order sekaligus — terapkan ke semuanya.
        const baris = preview.belumSku.find(
          (b) => b.order_ref === order_ref && b.nama_shopee === nama_shopee && b.variasi === variasi
        )
        const refs = baris?.order_refs ?? [order_ref]
        return refs.map((ref) => ({ order_ref: ref, nama_shopee, variasi, sku }))
      })
      const tandaiBelumMp = preview.belumSku
        .filter((b) => tandai.has(kunciBaris(b)))
        .flatMap((b) =>
          (b.order_refs ?? [b.order_ref]).map((ref) => ({ order_ref: ref, nama_shopee: b.nama_shopee, variasi: b.variasi }))
        )
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
      <DialogContent className="flex max-h-[92dvh] w-[95vw] flex-col gap-3 overflow-hidden sm:max-w-[min(96rem,95vw)]" data-testid="dialog-import-order">
        <DialogHeader className="shrink-0">
          <DialogTitle>Import Order Shopee (Order.toship)</DialogTitle>
          <DialogDescription>
            Sheet <b>orders</b> + <b>Advance Fulfilment</b>. File sama ditolak (fingerprint). Status yang sudah
            lebih maju di WMS tidak diturunkan.
          </DialogDescription>
        </DialogHeader>

        {/* Isi scroll sendiri (flex-1) supaya footer tetap terjangkau di HP. */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Perlu SKU ({belumSkuList.length} produk)</p>
                  {belumLengkap.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 md:h-7"
                      onClick={tandaiSemuaSisa}
                      data-testid="tandai-semua-sisa"
                    >
                      Tandai {belumLengkap.length} sisanya "Belum di MP"
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Baris ini belum punya SKU di file Shopee. Pilih SKU master <b>atau</b> centang{" "}
                  <b>Belum di MP</b> bila barang ini memang belum terdaftar di marketplace — order tetap
                  diimpor, dan baris ini dicatat sebagai daftar tunggu supaya kamu bisa urus SKU-nya nanti.
                </p>
                <div className="rounded-lg border border-border">
                  {/* Kepala kolom: hanya di layar lebar (md+). Di mobile tiap baris jadi kartu. */}
                  <div className="hidden border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[9rem_minmax(0,1fr)_7rem_4rem_minmax(0,20rem)_5rem] md:items-center md:gap-3">
                    <span>Order</span>
                    <span>Nama Shopee</span>
                    <span>Variasi</span>
                    <span className="text-right">Qty</span>
                    <span>SKU &amp; nama produk</span>
                    <span className="text-center">Belum di MP</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {belumSkuList.map((b) => {
                      const k = kunciBaris(b)
                      const refs = b.order_refs ?? [b.order_ref]
                      return (
                        <li
                          key={k}
                          className="grid gap-2 p-3 md:grid-cols-[9rem_minmax(0,1fr)_7rem_4rem_minmax(0,20rem)_5rem] md:items-center md:gap-3"
                          data-testid={`belum-sku-${b.order_ref}`}
                        >
                          <div className="tabular-nums">
                            <span className="font-medium" title={refs.join("\n")} data-testid={`jumlah-order-${b.order_ref}`}>
                              {b.jumlah_order > 1 ? `${b.jumlah_order} order` : b.order_ref}
                            </span>
                            {b.jumlah_order > 1 && (
                              <span className="ml-2 text-[11px] text-muted-foreground">{b.order_ref} +{b.jumlah_order - 1}</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="block truncate text-sm" title={b.nama_shopee}>{b.nama_shopee}</span>
                            <span className="text-[11px] text-muted-foreground md:hidden">
                              {b.variasi ? `Variasi: ${b.variasi} · ` : ""}Qty {b.qty_total}
                            </span>
                          </div>
                          <div className="hidden truncate text-sm md:block">{b.variasi || "-"}</div>
                          <div className="hidden text-right text-sm tabular-nums md:block">{b.qty_total}</div>
                          <div className="min-w-0">
                            <PilihSku
                              opsi={opsiUntuk(b, master)}
                              nilai={manual[k] ?? ""}
                              onPilih={(sku) => pilihSku(b, sku)}
                              placeholder={b.tebakan.sku ? `Tebakan: ${b.tebakan.sku}` : "Cari SKU / nama…"}
                              testId={`pilih-sku-${b.order_ref}`}
                            />
                            {b.tebakan.sku && (
                              <p className="mt-1 text-[11px] text-emerald-700">Cocok persis: {b.tebakan.sku}</p>
                            )}
                          </div>
                          <label className="flex items-center gap-2 text-xs md:justify-center">
                            <input
                              type="checkbox"
                              className="size-5 accent-primary"
                              aria-label={`Tandai belum ada SKU di MP ${b.nama_shopee}`}
                              data-testid={`tandai-belum-mp-${b.order_ref}`}
                              checked={tandai.has(k)}
                              disabled={Boolean(manual[k])}
                              onChange={() => toggleTandai(b)}
                            />
                            <span className="md:hidden">Belum di MP</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
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
        </div>

        <DialogFooter className="shrink-0">
          {!preview ? (
            <Button onClick={unggah} disabled={!file || mengirim} data-testid="unggah-import-order">
              {mengirim && <Spinner />} Upload & preview
            </Button>
          ) : (
            <>
              {belumLengkap.length > 0 && (
                <p className="mr-auto self-center text-xs text-amber-700" data-testid="sisa-belum-lengkap">
                  {belumLengkap.length} produk belum dipetakan (pilih SKU atau centang "Belum di MP").
                </p>
              )}
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
