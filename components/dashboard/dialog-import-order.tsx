"use client"

// components/dashboard/dialog-import-order.tsx — Import Order.toship + Advance (Fase E2).
// Dipilih sebagai file baru (bukan perluas dialog-import-excel.tsx) karena panelnya
// spesifik export Shopee 2-sheet: ringkasan, Perlu SKU + tebakan, Compare Nama, dan
// blok peringatan (MUNDUR / resi gabungan / kriteria / gagal). dialog-import-excel
// tetap dipakai template generik 7 kolom supaya jalur lama tidak berubah perilaku.
// Sejak dukungan multi-seller: banyak berkas dipilih sekaligus, dipreview & dikonfirmasi
// BERURUTAN per batch_id supaya server tetap idempoten dan satu berkas gagal tidak
// membatalkan berkas lain.
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

/** Satu baris "Perlu SKU" + asal berkasnya; indeks file dipakai supaya kunci tetap unik antar berkas. */
type BarisGabungan = BarisBelumSku & { berkas: string }

/** Hasil preview satu berkas. `gagal: true` = preview berkas ini tidak jalan, berkas lain lanjut. */
type HasilBerkas =
  | { nama: string; gagal: true; pesan: string }
  | {
      nama: string
      gagal: false
      batch_id: number
      totalBaris: number
      orderCount: number
      advanceCount: number
      gagalCount: number
      ringkas: Preview["klasifikasi"]
      belumSku: BarisBelumSku[]
      compareNama: Compare[]
      gagalBaris: Gagal[]
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
  const [files, setFiles] = useState<File[]>([])
  const [hasil, setHasil] = useState<HasilBerkas[] | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const [progres, setProgres] = useState<{ nama: string; ke: number; dari: number } | null>(null)
  const [manual, setManual] = useState<Record<string, string>>({})
  const [master, setMaster] = useState<OpsiSku[]>([])
  const [tandai, setTandai] = useState<Set<string>>(new Set())

  function kunciBaris(b: BarisBelumSku): string {
    return `${b.order_ref}\u0000${b.nama_shopee}\u0000${b.variasi}`
  }

  function tutup(v: boolean) {
    if (mengirim) return
    if (!v) {
      setFiles([])
      setHasil(null)
      setProgres(null)
      setManual({})
      setTandai(new Set())
    }
    onOpenChange(v)
  }

  async function unggah() {
    if (files.length === 0) return
    setMengirim(true)
    setHasil([])
    try {
      // Daftar SKU master untuk pemilih manual. Endpoint: /api/baca?scope=produk
      // (tidak ada /api/produk — dulu 404 sehingga daftar selalu kosong). Cukup sekali
      // per unggahan walau berkasnya banyak.
      const resMaster = await fetch("/api/baca?scope=produk", { credentials: "include" })
      const dataMaster = (await resMaster.json().catch(() => null)) as
        | { ok?: boolean; rows?: { sku: string; nama_accurate?: string }[] }
        | null
      setMaster((dataMaster?.rows ?? []).map((p) => ({ sku: p.sku, nama: p.nama_accurate ?? "" })))
      if (!dataMaster?.ok) tampilkanGagalTulis("Daftar SKU master gagal dimuat — pemilih SKU hanya berisi tebakan.")

      const daftar: HasilBerkas[] = []
      for (const [i, f] of files.entries()) {
        setProgres({ nama: f.name, ke: i + 1, dari: files.length })
        try {
          const buf = await f.arrayBuffer()
          const wb = XLSX.read(buf, { type: "array" })
          const ordersWs = wb.Sheets["orders"]
          const advanceWs = wb.Sheets["Advance Fulfilment"]
          if (!ordersWs) throw new Error('Workbook wajib memiliki sheet "orders".')
          const ordersRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ordersWs, { defval: "" })
          const advanceRows = advanceWs
            ? XLSX.utils.sheet_to_json<Record<string, unknown>>(advanceWs, { defval: "" })
            : []
          const res = await fetch("/api/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aksi: "preview-shopee", ordersRows, advanceRows, file: f.name }),
            credentials: "include",
          })
          const raw = (await res.json().catch(() => null)) as (Preview & { ok?: boolean; error?: string }) | null
          if (!res.ok || !raw?.ok) {
            daftar.push({ nama: f.name, gagal: true, pesan: raw?.error ?? `Gagal preview (${res.status}).` })
          } else {
            daftar.push({
              nama: f.name,
              gagal: false,
              batch_id: raw.batch_id,
              totalBaris: ordersRows.length + advanceRows.length,
              orderCount: raw.orders.length,
              advanceCount: raw.advance.length,
              gagalCount: raw.gagal.length,
              ringkas: raw.klasifikasi,
              belumSku: raw.belumSku,
              compareNama: raw.compareNama ?? [],
              gagalBaris: raw.gagal,
            })
          }
        } catch (e) {
          // Satu berkas rusak/gagal jaringan tidak boleh menghentikan berkas berikutnya.
          daftar.push({ nama: f.name, gagal: true, pesan: e instanceof Error ? e.message : "Berkas gagal dibaca." })
        }
        // Tampilkan hasil sejauh ini supaya user melihat kemajuan, bukan layar diam.
        setHasil([...daftar])
      }
      if (daftar.every((h) => h.gagal)) tampilkanGagalTulis("Semua berkas gagal dipreview. Lihat rincian di daftar.")
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.")
    } finally {
      setProgres(null)
      setMengirim(false)
    }
  }

  function pilihSku(b: BarisGabungan, sku: string): void {
    setManual((lama) => ({ ...lama, [kunciBaris(b)]: sku }))
  }

  function toggleTandai(b: BarisGabungan): void {
    const k = kunciBaris(b)
    setTandai((lama) => {
      const baru = new Set(lama)
      if (baru.has(k)) baru.delete(k)
      else baru.add(k)
      return baru
    })
  }

  /** BelumSku dari SEMUA berkas; kunci baris diberi nama berkas karena kunci bisa bertabrakan antar seller. */
  const barisGabungan: BarisGabungan[] = (hasil ?? []).flatMap((h) =>
    h.gagal ? [] : h.belumSku.map((b) => ({ ...b, berkas: h.nama }))
  )

  /** Baris yang belum dipilih SKU dan belum ditandai — penyebab tombol Konfirmasi mati. */
  const belumLengkap = barisGabungan.filter((b) => !manual[kunciBaris(b)] && !tandai.has(kunciBaris(b)))

  /** Tandai semua baris yang masih kosong sebagai "belum ada di MP" (sekali klik). */
  function tandaiSemuaSisa(): void {
    setTandai((lama) => {
      const baru = new Set(lama)
      for (const b of barisGabungan) {
        const k = kunciBaris(b)
        if (!manual[k]) baru.add(k)
      }
      return baru
    })
  }

  function siapCommit(): boolean {
    if (!hasil || hasil.every((h) => h.gagal)) return false
    return belumLengkap.length === 0
  }

  async function konfirmasi() {
    const siap = (hasil ?? []).filter((h): h is Extract<HasilBerkas, { gagal: false }> => !h.gagal)
    if (siap.length === 0) return
    setMengirim(true)
    try {
      // Peta baris per berkas: baris preview mewakili beberapa order sekaligus dan kunci
      // hanya unik di dalam berkasnya sendiri.
      const petaBaris = new Map<string, BarisGabungan>()
      for (const b of barisGabungan) petaBaris.set(`${b.berkas}\u0000${kunciBaris(b)}`, b)

      const total = { order: 0, item: 0, advance: 0 }
      const sukses: string[] = []
      const gagal: string[] = []
      for (const [i, h] of siap.entries()) {
        setProgres({ nama: h.nama, ke: i + 1, dari: siap.length })
        const skuManual = Object.entries(manual).flatMap(([k, sku]) => {
          const [order_ref, nama_shopee, variasi] = k.split("\u0000")
          const baris = petaBaris.get(`${h.nama}\u0000${k}`)
          if (!baris) return []
          // Terapkan ke seluruh order pada grup produk yang sama.
          const refs = baris.order_refs ?? [order_ref]
          return refs.map((ref) => ({ order_ref: ref, nama_shopee, variasi, sku }))
        })
        const tandaiBelumMp = h.belumSku
          .filter((b) => tandai.has(kunciBaris(b)))
          .flatMap((b) =>
            (b.order_refs ?? [b.order_ref]).map((ref) => ({
              order_ref: ref,
              nama_shopee: b.nama_shopee,
              variasi: b.variasi,
            }))
          )
        try {
          const res = await fetch("/api/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aksi: "konfirmasi-shopee", batch_id: h.batch_id, skuManual, tandaiBelumMp }),
            credentials: "include",
          })
          const raw = (await res.json().catch(() => null)) as
            | { ok?: boolean; error?: string; order?: number; item?: number; advance?: number }
            | null
          if (!res.ok || !raw?.ok) {
            gagal.push(`${h.nama} (${raw?.error ?? `HTTP ${res.status}`})`)
            continue
          }
          total.order += raw.order ?? 0
          total.item += raw.item ?? 0
          total.advance += raw.advance ?? 0
          sukses.push(h.nama)
        } catch (e) {
          // Batch yang sudah sukses tetap sukses; yang gagal hanya disebut namanya.
          gagal.push(`${h.nama} (${e instanceof Error ? e.message : "jaringan gagal"})`)
        }
      }

      if (sukses.length === 0) {
        tampilkanGagalTulis(`Semua konfirmasi gagal: ${gagal.join("; ")}`)
        return
      }
      toast.success(
        `Import selesai: ${total.order} order, ${total.item} item, ${total.advance} booking advance. ` +
          `${sukses.length} berkas sukses${gagal.length > 0 ? `, ${gagal.length} gagal: ${gagal.join("; ")}` : ""}.`
      )
      tutup(false)
      onSukses?.()
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.")
    } finally {
      setProgres(null)
      setMengirim(false)
    }
  }

  const daftarHasil = hasil ?? []
  const suksesList = daftarHasil.filter((h): h is Extract<HasilBerkas, { gagal: false }> => !h.gagal)
  const gagalList = daftarHasil.filter((h) => h.gagal)
  const total = suksesList.reduce(
    (t, h) => ({
      baris: t.baris + h.totalBaris,
      order: t.order + h.orderCount,
      advance: t.advance + h.advanceCount,
      gagal: t.gagal + h.gagalCount,
      baru: t.baru + h.ringkas.baru,
      update: t.update + h.ringkas.update,
      skip: t.skip + h.ringkas.skip,
      advanceSkip: t.advanceSkip + h.ringkas.advanceSkip.length,
    }),
    { baris: 0, order: 0, advance: 0, gagal: 0, baru: 0, update: 0, skip: 0, advanceSkip: 0 }
  )
  // Peringatan digabung lintas berkas — tiap baris menyebut nama berkas agar bisa dilacak.
  const peringatan = <T,>(jenis: "mundur" | "resiMultiOrder" | "kriteriaGabungan" | "gandaDalamFile") =>
    suksesList.flatMap((h) => (h.ringkas[jenis] as T[]).map((x) => ({ ...x, berkas: h.nama })))
  const semuaMundur = peringatan<Mundur>("mundur")
  const semuaResi = peringatan<ResiMulti>("resiMultiOrder")
  const semuaKriteria = peringatan<Kriteria>("kriteriaGabungan")
  const semuaGanda = peringatan<{ no_pesanan: string; jumlah: number }>("gandaDalamFile")
  const compareBeda = suksesList
    .flatMap((h) => h.compareNama.filter((c) => !c.sama).map((c) => ({ ...c, berkas: h.nama })))
    .filter((c, i, a) => a.findIndex((x) => x.berkas === c.berkas && x.sku === c.sku) === i)
  const gagalBaris = suksesList.flatMap((h) => h.gagalBaris.map((g) => ({ ...g, berkas: h.nama })))

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="flex max-h-[92dvh] w-[95vw] flex-col gap-3 overflow-hidden sm:max-w-[min(96rem,95vw)]" data-testid="dialog-import-order">
        <DialogHeader className="shrink-0">
          <DialogTitle>Import Order Shopee (Order.toship)</DialogTitle>
          <DialogDescription>
            Sheet <b>orders</b> + <b>Advance Fulfilment</b>. Bisa pilih beberapa berkas sekaligus (satu per akun
            seller) — diproses berurutan. File sama ditolak (fingerprint). Status yang sudah lebih maju di WMS
            tidak diturunkan.
          </DialogDescription>
        </DialogHeader>

        {/* Isi scroll sendiri (flex-1) supaya footer tetap terjangkau di HP. */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {daftarHasil.length === 0 ? (
          <div className="space-y-3">
            <Input
              type="file"
              multiple
              accept=".xlsx,.xls"
              data-testid="berkas-import-order"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {files.length} berkas: {files.map((f) => f.name).join(", ")}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm" data-testid="ringkas-import-order-gabungan">
                {daftarHasil.length} berkas · {total.baris} baris dibaca:{" "}
                <b className="text-emerald-600">{total.order} order</b>, <b>{total.advance} booking advance</b>
                {total.gagal > 0 && <>, <b className="text-red-600">{total.gagal} gagal</b></>} · baru {total.baru},
                update {total.update}, skip {total.skip}
                {total.advanceSkip > 0 && <> · advance skip {total.advanceSkip}</>}
                {gagalList.length > 0 && <>, <b className="text-red-600">{gagalList.length} berkas gagal</b></>}
              </p>
              {/* Daftar per berkas: inilah yang dipakai user melacak seller mana yang bermasalah. */}
              <ul className="divide-y divide-border rounded-lg border border-border text-xs" data-testid="daftar-berkas-import-order">
                {daftarHasil.map((h) => (
                  <li key={h.nama} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <b className="mr-auto truncate min-w-0">{h.nama}</b>
                    {h.gagal ? (
                      <span className="text-red-600">gagal — {h.pesan}</span>
                    ) : (
                      <span className="text-muted-foreground" data-testid="ringkas-import-order">
                        {h.totalBaris} baris · {h.orderCount} order · {h.advanceCount} booking advance · baru{" "}
                        {h.ringkas.baru}, update {h.ringkas.update}, skip {h.ringkas.skip}
                        {h.gagalCount > 0 && <span className="text-red-600"> · {h.gagalCount} gagal</span>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {semuaMundur.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900" data-testid="peringatan-mundur">
                <b>Beberapa no resi status belum update, silakan dicek dulu.</b>
                <ul className="mt-1 space-y-0.5">
                  {semuaMundur.slice(0, 20).map((m) => (
                    <li key={`${m.berkas}-${m.no_pesanan}`}>
                      [{m.berkas}] {m.no_pesanan} — resi {m.no_resi || "-"} (WMS: {m.wms}, file: {m.file})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {semuaGanda.length > 0 && (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-900">
                <b>No. Pesanan ganda dalam file (tolak perbaiki export):</b>{" "}
                {semuaGanda.map((g) => `[${g.berkas}] ${g.no_pesanan}×${g.jumlah}`).join(", ")}
              </div>
            )}

            {semuaResi.length > 0 && (
              <div className="rounded-lg bg-sky-50 p-3 text-xs text-sky-900" data-testid="peringatan-gabungan">
                <b>Pesanan Gabungan terdeteksi ({semuaResi.length} resi).</b> Picklist default per paket.
                <ul className="mt-1 space-y-0.5">
                  {semuaResi.slice(0, 20).map((r) => (
                    <li key={`${r.berkas}-${r.no_resi}`}>
                      [{r.berkas}] Resi {r.no_resi} — {r.jumlah_order} order: {r.no_pesanan.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {semuaKriteria.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900" data-testid="peringatan-kriteria">
                <b>Tidak sesuai kriteria gabungan Shopee</b> (tidak memblokir):{" "}
                {semuaKriteria.map((k) => `[${k.berkas}] ${k.no_resi} (${k.alasan.join(", ")})`).join("; ")}
              </div>
            )}

            {barisGabungan.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Perlu SKU ({barisGabungan.length} produk)</p>
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
                    {barisGabungan.map((b) => {
                      const k = kunciBaris(b)
                      const refs = b.order_refs ?? [b.order_ref]
                      return (
                        <li
                          key={`${b.berkas}\u0000${k}`}
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
                            <span className="block truncate text-[11px] text-muted-foreground" title={b.berkas}>
                              {b.berkas}
                            </span>
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
                    <li key={`${c.berkas}-${c.sku}`}>
                      <b>{c.sku}</b> — Shopee: {c.nama_shopee} · D1: {c.nama_d1} <i>({c.berkas})</i>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {gagalBaris.length > 0 && (
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs" data-testid="gagal-import-order">
                {gagalBaris.slice(0, 50).map((g, i) => (
                  <li key={`${i}-${g.berkas}-${g.pesan.slice(0, 24)}`}>
                    [{g.berkas}] {g.no_pesanan || "-"}: {g.pesan}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        </div>

        <DialogFooter className="shrink-0">
          {daftarHasil.length === 0 ? (
            <Button onClick={unggah} disabled={files.length === 0 || mengirim} data-testid="unggah-import-order">
              {mengirim && <Spinner />} Upload &amp; preview
            </Button>
          ) : (
            <>
              {belumLengkap.length > 0 && (
                <p className="mr-auto self-center text-xs text-amber-700" data-testid="sisa-belum-lengkap">
                  {belumLengkap.length} produk belum dipetakan (pilih SKU atau centang "Belum di MP").
                </p>
              )}
              {progres && (
                <p className="mr-auto self-center text-xs text-muted-foreground">
                  {progres.nama} — {progres.ke}/{progres.dari}
                </p>
              )}
              <Button variant="secondary" onClick={() => { setHasil(null); setManual({}); setTandai(new Set()) }} disabled={mengirim}>
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
