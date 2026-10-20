"use client"

// components/dashboard/dialog-import-order.tsx — Import Order.toship + Advance (Fase E2).
// Dipilih sebagai file baru (bukan perluas dialog-import-excel.tsx) karena panelnya
// spesifik export Shopee 2-sheet: ringkasan, Perlu SKU + tebakan, Compare Nama, dan
// blok peringatan (MUNDUR / resi gabungan / kriteria / gagal). dialog-import-excel
// tetap dipakai template generik 7 kolom supaya jalur lama tidak berubah perilaku.
// Sejak dukungan multi-seller: banyak berkas dipilih sekaligus, dipreview & diimpor
// BERURUTAN per batch supaya server tetap idempoten dan satu berkas gagal tidak
// membatalkan berkas lain.
//
// Impor BERTAHAP (berkas besar): setelah preview, order dikirim ke server dalam potongan
// (ukuran potongan ditentukan SERVER lewat jawaban `mulai-impor`), satu request per potongan.
// Worker Free hanya punya ~50 KUERI D1 per invokasi, jadi mengirim seluruh berkas sekaligus
// akan mati di tengah jalan. Klien memegang barisnya (server tidak lagi menyimpan payload
// raksasa), menyimpan `batchId` di state agar impor yang terputus bisa DILANJUTKAN, dan
// menyediakan tombol Hentikan (AbortController) supaya impor bisa dibatalkan tanpa menutup dialog.
import { useRef, useState } from "react"
import { toast } from "sonner"

// SheetJS 312 KB dimuat saat file benar-benar dibaca, bukan saat halaman dibuka.
// Specifier statis; hanya waktu-muat yang dinamis (pola fabric di editor-desain).
async function bacaExcel(buf: ArrayBuffer) {
  const XLSX = await import("xlsx")
  return { wb: XLSX.read(buf, { type: "array" }), toJson: XLSX.utils.sheet_to_json }
}

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
  /**
   * SKU yang tertulis di file tapi tidak ada di master. Kosong = baris memang tanpa SKU.
   * Dipakai untuk memberi tahu user APA yang salah, bukan sekadar "perlu SKU".
   */
  sku_asal: string
  /** Jalur asal baris: pesanan biasa atau advance fulfilment. */
  sumber: "order" | "advance"
  tebakan: { sku: string; perlu_pilih_manual: boolean; kandidat: Kandidat[] }
}
type Mundur = { no_pesanan: string; no_resi: string; wms: string; file: string }
type ResiMulti = { no_resi: string; no_pesanan: string[]; jumlah_order: number }
type Kriteria = { no_resi: string; no_pesanan: string[]; alasan: string[] }
type Compare = { sku: string; nama_shopee: string; nama_d1: string; sama: boolean }
type Gagal = { no_pesanan: string; sku?: string; pesan: string }
/** Baris yang ditolak D1 saat konfirmasi (mis. FK). Order lain tetap tersimpan. */
type Dilewati = { no_pesanan: string; pesan: string }

type Preview = {
  batch_id: number
  totalBaris: number
  /** Fingerprint berkas — dipakai `selesai-impor` untuk mencatat anti-dobel. */
  hash: string
  orders: OrderRingkas[]
  advance: BookingRingkas[]
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
  /** Grup yang tidak sempat ditebak server (batas anggaran waktu) — perlu dipilih manual. */
  tebakan_dilewati: number
}

/**
 * Satu order hasil normalisasi server, dikirim balik apa adanya lalu dipotong di klien.
 * Bentuknya sengaja longgar: klien hanya perlu mengirim potongannya kembali tanpa membacanya,
 * dan menyalin tipe server ke sini berarti dua definisi yang bisa menyimpang.
 */
type OrderRingkas = { no_pesanan: string; items: { nama_shopee: string; variasi: string }[] }
/** Satu baris Advance Fulfilment, dikirim utuh di `selesai-impor` (bukan dipotong). */
type BookingRingkas = { booking_sn: string }

/** Satu baris "Perlu SKU" + asal berkasnya; indeks file dipakai supaya kunci tetap unik antar berkas. */
type BarisGabungan = BarisBelumSku & { berkas: string }

/** Hasil preview satu berkas. `gagal: true` = preview berkas ini tidak jalan, berkas lain lanjut. */
type HasilBerkas =
  | { nama: string; gagal: true; pesan: string }
  | {
      nama: string
      gagal: false
      totalBaris: number
      orderCount: number
      advanceCount: number
      gagalCount: number
      ringkas: Preview["klasifikasi"]
      belumSku: BarisBelumSku[]
      compareNama: Compare[]
      gagalBaris: Gagal[]
      tebakanDilewati: number
      /** Baris hasil preview — dipegang klien supaya server tak perlu menyimpan payload raksasa. */
      orders: OrderRingkas[]
      advance: BookingRingkas[]
      hash: string
    }

/**
 * Cadangan ukuran potongan, HANYA untuk server lama yang tidak mengirim `ukuranPotong`.
 *
 * Sumber kebenaran ukuran potongan adalah SERVER: `mulai-impor` mengembalikan `ukuranPotong`
 * (lihat UKURAN_POTONG di app/api/order/route.ts) dan itulah yang dipakai untuk memotong.
 * Angka di sini tidak boleh dipakai selama server menjawab normal — kalau dipakai, artinya
 * server dan klien bisa menyimpang, dan penyimpangannya muncul sebagai 400 dari batas server
 * (route.ts, "Satu potongan maksimal N baris") alih-alih tidak mungkin terjadi sama sekali.
 */
const UKURAN_POTONG_CADANGAN = 200

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSukses?: () => void
  /**
   * Toko pemilik order yang diimpor. Wajib diisi (null = belum dipilih): satu D1 dipakai
   * banyak toko, jadi tanpa preset order masuk ke toko yang salah tanpa terlihat di daftar
   * maupun perhitungan laba. Server menolak `impor-potong` tanpa `presetId`.
   */
  preset: { id: number; nama: string } | null
}

/** Opsi SKU untuk 1 baris "Perlu SKU": kandidat tebakan (beri skor) lalu seluruh master. */
function opsiUntuk(b: BarisBelumSku, master: OpsiSku[]): OpsiSku[] {
  const dariTebakan: OpsiSku[] = b.tebakan.kandidat.map((k) => ({ sku: k.sku, nama: k.nama, skor: k.skor }))
  const ada = new Set(dariTebakan.map((o) => o.sku))
  return [...dariTebakan, ...master.filter((m) => !ada.has(m.sku))]
}

export function DialogImportOrder({ open, onOpenChange, onSukses, preset }: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [hasil, setHasil] = useState<HasilBerkas[] | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const [progres, setProgres] = useState<{ nama: string; ke: number; dari: number } | null>(null)
  /**
   * Perbarui `status_fulfill` dari berkas. Default MATI: impor ulang berkas lama tidak boleh
   * memundurkan order yang sudah dikirim. Saat dicentang, status mengikuti berkas — kecuali
   * order yang sudah batal, yang tetap batal (aturan server).
   */
  const [perbaruiStatus, setPerbaruiStatus] = useState(false)
  const [manual, setManual] = useState<Record<string, string>>({})
  const [master, setMaster] = useState<OpsiSku[]>([])
  const [tandai, setTandai] = useState<Set<string>>(new Set())
  /**
   * Batch bertahap yang SUDAH dibuat server (per nama berkas). Disimpan di state komponen
   * dengan sengaja: bila jaringan putus atau impor gagal di tengah, `batchId` masih ada
   * sehingga tombol "Lanjutkan" bisa meneruskan dari potongan terakhir, bukan mengulang
   * dari nol dan menyimpan ulang ribuan baris yang sudah masuk.
   *
   * `ukuranPotong` diambil dari jawaban SERVER saat batch pertama kali dibuat, lalu ikut
   * disimpan: percobaan ulang memakai `batchId` yang sama tanpa memanggil `mulai-impor` lagi,
   * jadi tanpa menyimpannya di sini ukuran potongan akan hilang dan harus ditebak.
   */
  const [batchBertahap, setBatchBertahap] = useState<
    Record<string, { batchId: number; sudahBaris: number; ukuranPotong: number; dilanjutkan: boolean }>
  >({})
  /** Progres impor bertahap: berapa baris sudah benar-benar tersimpan di server. */
  const [progresImpor, setProgresImpor] = useState<{ nama: string; baris: number; total: number } | null>(null)
  /**
   * Pembatal impor. Disimpan di ref (bukan state) karena hanya dibaca di dalam loop async:
   * kalau di state, closure loop akan menangkap nilai lama dan tombol Batal tak berefek.
   * SATU controller per unggahan: dibuat saat berkas dipilih, bukan saat Konfirmasi ditekan.
   * Dulu dibuat di `konfirmasi()`, jadi ada celah di mana loop sudah jalan tapi `batalRef`
   * masih null (mis. Konfirmasi tepat setelah dialog dibuka) — impor panjang jadi tak bisa
   * dihentikan. `mulai-impor` juga memakai controller ini agar request yang menggantung saat
   * user menutup dialog benar-benar dihentikan, bukan lanjut di latar belakang.
   */
  const batalRef = useRef<AbortController | null>(null)
  /** Baris yang DITOLAK saat konfirmasi — ditampilkan supaya user tahu mana yang perlu diperbaiki. */
  const [dilewatiHasil, setDilewatiHasil] = useState<(Dilewati & { berkas: string })[]>([])
  /**
   * Berkas yang batch-nya baru saja DILANJUTKAN server (`dilanjutkan: true`). Dipakai untuk
   * memunculkan tombol "Mulai dari awal": tanpa flag eksplisit, unggah ulang berkas yang sama
   * selalu melanjutkan batch lama dan satu-satunya cara mulai dari nol adalah mengganti nama
   * berkas — cara yang ditolak pemilik produk.
   */
  const [lanjutanBerkas, setLanjutanBerkas] = useState<{ nama: string; tersimpan: number } | null>(null)
  /** Berkas yang sedang dipaksa mulai dari nol (lihat tombol "Mulai dari awal"). */
  const mulaiBaruRef = useRef<string | null>(null)

  function kunciBaris(b: BarisBelumSku): string {
    return `${b.order_ref}\u0000${b.nama_shopee}\u0000${b.variasi}`
  }

  function tutup(v: boolean) {
    // Dulu `if (mengirim) return` di sini: menutup dialog saat impor jalan memang harus
    // dihentikan, bukan ditolak — kalau ditolak, satu-satunya jalan keluar user adalah menutup
    // tab, dan loop-nya tetap menulis di latar belakang. Sekarang penutupan selalu meng-abort
    // lebih dulu; batchId tetap tersimpan di state sehingga impor bisa dilanjutkan nanti.
    if (!v) {
      // Impor yang masih jalan dihentikan, bukan dibiarkan menulis di latar belakang setelah
      // dialog hilang — batchId tersimpan di state sehingga bisa dilanjutkan nanti.
      batalRef.current?.abort()
      setFiles([])
      setHasil(null)
      setProgres(null)
      setProgresImpor(null)
      setManual({})
      setTandai(new Set())
      setDilewatiHasil([])
      setLanjutanBerkas(null)
    }
    onOpenChange(v)
  }

  /** Hentikan impor yang sedang jalan; potongan yang sudah masuk tetap tersimpan di server. */
  function batalkanImpor(): void {
    batalRef.current?.abort()
    // Tombol langsung kembali aktif walau request yang sedang menggantung belum menyerah:
    // `mengirim` hanya dipakai untuk menonaktifkan tombol, bukan untuk menghentikan loop
    // (loop berhenti sendiri di pemeriksaan `signal.aborted`).
    setMengirim(false)
  }

  async function unggah() {
    // Preview belum menulis apa pun, tapi tombolnya ikut mati saat preset null: memaksa
    // user memilih toko SEBELUM memilih berkas, bukan sesudah seluruh baris dipetakan.
    if (!preset) return
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
          const { wb, toJson } = await bacaExcel(buf)
          const ordersWs = wb.Sheets["orders"]
          const advanceWs = wb.Sheets["Advance Fulfilment"]
          if (!ordersWs) throw new Error('Workbook wajib memiliki sheet "orders".')
          const ordersRows = toJson<Record<string, unknown>>(ordersWs, { defval: "" })
          const advanceRows = advanceWs
            ? toJson<Record<string, unknown>>(advanceWs, { defval: "" })
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
              totalBaris: ordersRows.length + advanceRows.length,
              orderCount: raw.orders.length,
              advanceCount: raw.advance.length,
              gagalCount: raw.gagal.length,
              ringkas: raw.klasifikasi,
              belumSku: raw.belumSku,
              compareNama: raw.compareNama ?? [],
              gagalBaris: raw.gagal,
              tebakanDilewati: raw.tebakan_dilewati ?? 0,
              orders: raw.orders,
              advance: raw.advance,
              hash: raw.hash,
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

  /**
   * "Mulai dari awal": buang batch lama untuk berkas yang dilanjutkan server, lalu impor ulang
   * dari baris nol. Order yang sudah masuk batch lama TIDAK dihapus (server menandainya
   * 'batal'), dan karena setiap order ditulis dengan `ON CONFLICT ... DO UPDATE`, baris yang
   * sama tersimpan ulang di batch baru — bukan terduplikasi.
   */
  function mulaiDariAwal(): void {
    const l = lanjutanBerkas
    if (!l) return
    const setuju = window.confirm(
      `Mulai dari awal untuk "${l.nama}"?\n\n` +
        `${l.tersimpan} order berkas ini sudah tersimpan di batch lama dan TETAP tersimpan di sana (tidak dihapus). ` +
        `Sisa barisnya akan diimpor ulang dari nol ke batch baru. ` +
        `Order yang sama ditulis ulang, jadi tidak menjadi order ganda.`,
    )
    if (!setuju) return
    setBatchBertahap((lama) => {
      const baru = { ...lama }
      delete baru[l.nama]
      return baru
    })
    mulaiBaruRef.current = l.nama
    setLanjutanBerkas(null)
    void konfirmasi()
  }

  async function konfirmasi() {
    const siap = (hasil ?? []).filter((h): h is Extract<HasilBerkas, { gagal: false }> => !h.gagal)
    if (siap.length === 0) return
    // Payung terakhir: tombol memang sudah dimatikan saat preset null, tapi impor tanpa preset
    // akan ditolak server 400 setelah seluruh berkas diparse — hentikan sebelum ada request.
    if (!preset) {
      tampilkanGagalTulis("Pilih preset/toko pemilik order dulu — impor tanpa preset masuk ke toko yang salah.")
      return
    }
    setMengirim(true)
    // Controller datang dari pemilihan berkas (lihat onChange input): Konfirmasi tidak pernah
    // berjalan tanpa controller. Cadangan di sini hanya untuk jaga-jaga bila berkas dipilih
    // sebelum perubahan itu ada di bundel yang termuat.
    const batal = batalRef.current ?? new AbortController()
    batalRef.current = batal
    try {
      // Peta baris per berkas: baris preview mewakili beberapa order sekaligus dan kunci
      // hanya unik di dalam berkasnya sendiri.
      const petaBaris = new Map<string, BarisGabungan>()
      for (const b of barisGabungan) petaBaris.set(`${b.berkas}\u0000${kunciBaris(b)}`, b)

      const total = { order: 0, item: 0, advance: 0 }
      const sukses: string[] = []
      const gagal: string[] = []
      const dilewati: (Dilewati & { berkas: string })[] = []
      setDilewatiHasil([])
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
              // Dibawa supaya daftar tunggu bisa menampilkan APA yang salah dan dari jalur mana,
              // bukan cuma nama produk. Tanpa ini tabelnya tidak berguna saat dibuka lagi.
              sumber: b.sumber,
              sku_asal: b.sku_asal,
              qty_total: b.qty_total,
            }))
          )
        try {
          const r = await imporBertahap(h, preset.id, skuManual, tandaiBelumMp, batal.signal)
          if (r.batal) {
            // Dibatalkan user: batchId SUDAH tersimpan di state, jadi impor bisa dilanjutkan
            // nanti tanpa mengulang potongan yang sudah masuk.
            tampilkanGagalTulis(`Impor ${h.nama} dihentikan di baris ke-${r.barisTersimpan}. Tekan "Lanjutkan" untuk meneruskan.`)
            continue
          }
          if (!r.ok) {
            gagal.push(`${h.nama} (${r.pesan})`)
            continue
          }
          total.order += r.order
          total.item += r.item
          total.advance += r.advance
          for (const d of r.dilewati) dilewati.push({ ...d, berkas: h.nama })
          sukses.push(h.nama)
        } catch (e) {
          // Batch yang sudah sukses tetap sukses; yang gagal hanya disebut namanya.
          gagal.push(`${h.nama} (${e instanceof Error ? e.message : "jaringan gagal"})`)
        }
      }

      setDilewatiHasil(dilewati)
      // Riwayat dicatat SEBELUM `onSukses()` dan di-`await`: dulu POST-nya di-`void` lalu
      // `onSukses()` langsung memuat ulang riwayat, sehingga halaman Sinkronisasi sering
      // menampilkan daftar TANPA impor yang baru saja selesai (balapan POST vs GET).
      // Kegagalan mencatat tidak membatalkan impor yang sudah tersimpan — hanya diberitahukan.
      try {
        const res = await fetch("/api/sinkronisasi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            presetId: preset.id,
            jenis: "order",
            // Berkas yang gagal disebut juga: tanpa itu riwayat hanya menyebut yang sukses,
            // dan impor yang seluruh berkasnya gagal tidak punya nama berkas sama sekali.
            file: (sukses.length > 0 ? sukses : siap.map((h) => h.nama)).join(", ").slice(0, 200),
            // `total.item` = order yang benar-benar tersimpan. `total.order` hanya jumlah order
            // DI BERKAS, jadi dulu kartu Sinkronisasi mengaku menyimpan baris yang dilewati.
            baris: total.item,
            // Dua sebab berbeda sama-sama "tidak masuk": baris ditolak D1 dan berkas yang gagal
            // total. Menghitung salah satunya saja membuat angka gagal lebih kecil dari kenyataan.
            gagal: dilewati.length + gagal.length,
            ringkas:
              `${sukses.length} berkas sukses` +
              `${gagal.length > 0 ? `, ${gagal.length} gagal: ${gagal.join("; ")}` : ""}`,
          }),
        })
        if (!res.ok) {
          tampilkanGagalTulis(`Riwayat impor gagal dicatat (HTTP ${res.status}). Impor tetap tersimpan.`)
        }
      } catch {
        tampilkanGagalTulis("Riwayat impor gagal dicatat (jaringan). Impor tetap tersimpan.")
      }
      if (sukses.length === 0) {
        // Log di atas SUDAH terkirim dengan `baris: 0`: impor yang gagal seluruhnya tetap
        // terlihat di halaman Sinkronisasi, bukan hilang tanpa jejak.
        tampilkanGagalTulis(`Semua konfirmasi gagal: ${gagal.join("; ")}`)
        return
      }
      toast.success(
        `Import selesai: ${total.order} order, ${total.item} item, ${total.advance} booking advance. ` +
          `${sukses.length} berkas sukses${gagal.length > 0 ? `, ${gagal.length} gagal: ${gagal.join("; ")}` : ""}` +
          `${dilewati.length > 0 ? `, ${dilewati.length} baris dilewati` : ""}.`
      )
      // Daftar order di belakang dialog perlu disegarkan walau dialog tetap terbuka: order
      // yang sehat SUDAH tersimpan walau ada baris dilewati.
      onSukses?.()
      // Ada baris ditolak → JANGAN tutup dialog; user harus melihat mana yang perlu diperbaiki.
      if (dilewati.length === 0) tutup(false)
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.")
    } finally {
      batalRef.current = null
      setProgres(null)
      setProgresImpor(null)
      setMengirim(false)
    }
  }

  /**
   * Impor satu berkas SECARA BERTAHAP: pastikan batch ada, kirim potongan berurutan, lalu tutup.
   *
   * Kenapa dipotong: Worker Free hanya punya ~50 subrequest dan 10 ms CPU per invokasi. Berkas
   * besar yang dikirim sebagai satu body akan menghabiskan anggaran itu di tengah jalan dan
   * gagal tanpa pesan berguna. Dengan potongan, tiap request punya anggaran segar.
   *
   * Resume: `batchId` disimpan di state komponen dan potongan lama tidak dikirim ulang karena
   * server menolak nomor potongan yang sudah diproses (idempoten). Jadi menekan tombol lagi
   * setelah gagal jaringan MELANJUTKAN, bukan menyimpan baris dua kali.
   */
  async function imporBertahap(
    h: Extract<HasilBerkas, { gagal: false }>,
    presetId: number,
    skuManual: { order_ref: string; nama_shopee: string; variasi: string; sku: string }[],
    tandaiBelumMp: { order_ref: string; nama_shopee: string; variasi: string; sumber: string; sku_asal: string; qty_total: number }[],
    signal: AbortSignal,
  ): Promise<
    | { batal: true; barisTersimpan: number }
    | { batal: false; ok: false; pesan: string }
    | { batal: false; ok: true; order: number; item: number; advance: number; dilewati: Dilewati[] }
  > {
    const kirim = async (body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; dibatalkan?: boolean }> => {
      try {
        const res = await fetch("/api/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
          signal,
        })
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
        return { ok: res.ok, status: res.status, data: data ?? {} }
      } catch (e) {
        // Abort BUKAN kegagalan jaringan. Tanpa penanda ini, impor yang dihentikan user
        // dilaporkan sebagai "jaringan gagal" dan user mengira koneksinya bermasalah —
        // padahal batchId-nya tetap valid dan impor bisa dilanjutkan.
        if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          return { ok: false, status: 0, data: {}, dibatalkan: true }
        }
        throw e
      }
    }

    // 1) Batch: server mengembalikan batch yang BELUM selesai untuk berkas yang sama, sehingga
    //    unggah ulang melanjutkan dari `sudahBaris` — bukan mulai dari nol.
    let batchId: number | undefined = batchBertahap[h.nama]?.batchId
    let sudahOrder = 0
    let ukuranPotong: number
    // Dipaksa mulai dari nol (tombol "Mulai dari awal"): batchId lama dibuang sehingga
    // `mulai-impor` dipanggil ulang dengan `mulaiBaru`, dan server menandai batch lama 'batal'.
    const mulaiBaru = mulaiBaruRef.current === h.nama
    mulaiBaruRef.current = null
    if (mulaiBaru) batchId = undefined
    if (batchId === undefined) {
      // `totalBaris` di sini = jumlah ORDER, bukan baris berkas: server mencatat progres dalam
      // satuan order supaya resume bisa memotong array `orders` dengan indeks yang benar.
      const mulai = await kirim({ aksi: "mulai-impor", namaBerkas: h.nama, totalBaris: h.orders.length, mulaiBaru })
      if (mulai.dibatalkan) return { batal: true, barisTersimpan: sudahOrder }
      if (!mulai.ok || mulai.data.ok !== true) {
        return { batal: false, ok: false, pesan: String(mulai.data.error ?? `mulai-impor gagal (HTTP ${mulai.status}).`) }
      }
      batchId = Number(mulai.data.batchId)
      sudahOrder = Number(mulai.data.sudahBaris ?? 0)
      // Ukuran potongan datang dari SERVER supaya tak ada dua angka yang bisa menyimpang.
      // `UKURAN_POTONG_CADANGAN` hanya untuk server lama yang belum mengirim field ini; bila
      // dipakai, potongan berisiko ditolak batas server (400) — lihat komentar konstanta itu.
      const ukuranServer = Number(mulai.data.ukuranPotong)
      ukuranPotong = Number.isFinite(ukuranServer) && ukuranServer > 0 ? ukuranServer : UKURAN_POTONG_CADANGAN
      // `dilanjutkan: true` = server mengembalikan batch lama, bukan membuat yang baru. Hanya
      // di situlah tombol "Mulai dari awal" masuk akal.
      const dilanjutkan = mulai.data.dilanjutkan === true && sudahOrder > 0
      setLanjutanBerkas(dilanjutkan ? { nama: h.nama, tersimpan: sudahOrder } : null)
      setBatchBertahap((lama) => ({
        ...lama,
        [h.nama]: { batchId: batchId!, sudahBaris: sudahOrder, ukuranPotong, dilanjutkan },
      }))
    } else {
      const tersimpan = batchBertahap[h.nama]
      sudahOrder = tersimpan?.sudahBaris ?? 0
      // Percobaan ulang memakai batchId yang sudah ada, jadi `mulai-impor` tidak dipanggil lagi
      // dan ukuran potongan diambil dari simpanan percobaan pertama (dari server saat itu).
      ukuranPotong = tersimpan?.ukuranPotong ?? UKURAN_POTONG_CADANGAN
    }

    // 2) Potongan berurutan. `orders` datang dari preview, jadi server tidak perlu menyimpannya.
    const potongan: OrderRingkas[][] = []
    for (let i = sudahOrder; i < h.orders.length; i += ukuranPotong) {
      potongan.push(h.orders.slice(i, i + ukuranPotong))
    }
    const nomorAwal = Math.floor(sudahOrder / ukuranPotong) + 1
    let barisTersimpan = sudahOrder
    let tersimpanTotal = 0
    let dilewatiTotal = 0
    for (const [idx, bagian] of potongan.entries()) {
      if (signal.aborted) return { batal: true, barisTersimpan }
      const nomorPotong = nomorAwal + idx
      // SKU manual & "belum di MP" hanya relevan untuk order yang ada di potongan ini — kalau
      // semuanya dikirim tiap potongan, body-nya membengkak dan `tandaiBelumMp` yang sama
      // dicatat berulang di server.
      const noPesananPotong = new Set(bagian.map((o) => o.no_pesanan))
      const r = await kirim({
        aksi: "impor-potong",
        batchId,
        presetId,
        perbaruiStatus,
        nomorPotong,
        potongan: bagian,
        skuManual: skuManual.filter((m) => noPesananPotong.has(m.order_ref)),
        tandaiBelumMp: tandaiBelumMp.filter((t) => noPesananPotong.has(t.order_ref)),
      })
      if (r.dibatalkan) return { batal: true, barisTersimpan }
      if (!r.ok || r.data.ok !== true) {
        // Server bisa membalas 409 dengan `progressBaris` — artinya potongan ini SEBAGIAN
        // tersimpan. Progres itu disimpan supaya percobaan berikutnya melanjutkan dari titik
        // yang benar, bukan mengulang potongan yang barisnya sudah masuk.
        const progresServer = Number(r.data.progressBaris ?? barisTersimpan)
        barisTersimpan = progresServer
        setBatchBertahap((lama) => ({
          ...lama,
          [h.nama]: { batchId: batchId!, sudahBaris: barisTersimpan, ukuranPotong, dilanjutkan: lama[h.nama]?.dilanjutkan === true },
        }))
        setProgresImpor({ nama: h.nama, baris: barisTersimpan, total: h.orders.length })
        return {
          batal: false,
          ok: false,
          pesan: `${String(r.data.error ?? "potongan ditolak")} (potongan ${nomorPotong}, ${barisTersimpan}/${h.orders.length} order berkas sudah tersimpan)`,
        }
      }
      barisTersimpan = Number(r.data.progressBaris ?? barisTersimpan)
      tersimpanTotal += Number(r.data.tersimpan ?? 0)
      dilewatiTotal += Number(r.data.dilewati ?? 0)
      setBatchBertahap((lama) => ({
        ...lama,
        [h.nama]: { batchId: batchId!, sudahBaris: barisTersimpan, ukuranPotong, dilanjutkan: lama[h.nama]?.dilanjutkan === true },
      }))
      setProgresImpor({ nama: h.nama, baris: barisTersimpan, total: h.orders.length })
    }

    // 3) Tutup batch: simpan booking advance, catat resi grup, tandai anti-dobel berkas.
    //    `skuManual`/`tandaiBelumMp` tidak dikirim lagi — keduanya sudah diproses tiap potongan.
    const selesai = await kirim({
      aksi: "selesai-impor",
      batchId,
      hash: h.hash,
      advance: h.advance,
    })
    if (selesai.dibatalkan) return { batal: true, barisTersimpan }
    if (!selesai.ok || selesai.data.ok !== true) {
      return { batal: false, ok: false, pesan: String(selesai.data.error ?? `selesai-impor gagal (HTTP ${selesai.status}).`) }
    }
    // Batch ini tuntas → buang jejaknya supaya unggahan berikutnya membuat batch baru,
    // bukan "melanjutkan" batch yang sudah selesai.
    setBatchBertahap((lama) => {
      const baru = { ...lama }
      delete baru[h.nama]
      return baru
    })
    return {
      batal: false,
      ok: true,
      order: Number(selesai.data.order ?? 0),
      item: Number(selesai.data.item ?? 0),
      advance: Number(selesai.data.advance ?? 0),
      dilewati: Array.isArray(selesai.data.dilewati)
        ? (selesai.data.dilewati as Dilewati[])
        : dilewatiTotal > 0
          ? [{ no_pesanan: "-", pesan: `${dilewatiTotal} baris dilewati D1 selama impor bertahap.` }]
          : [],
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
      dilewati: t.dilewati + h.tebakanDilewati,
    }),
    { baris: 0, order: 0, advance: 0, gagal: 0, baru: 0, update: 0, skip: 0, advanceSkip: 0, dilewati: 0 }
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
          {/* Satu D1 dipakai banyak toko: nama preset ditampilkan supaya user melihat toko tujuan
              SEBELUM konfirmasi, bukan menemukan order nyasar di daftar setelah impor. */}
          <p className="text-sm" data-testid="preset-import-order">
            {preset ? (
              <>Toko tujuan: <b>{preset.nama}</b></>
            ) : (
              <span className="text-red-600">
                Preset/toko belum dipilih — pilih preset di halaman Order dulu. Impor tanpa preset tidak dijalankan
                karena order akan masuk ke toko yang salah tanpa terlihat.
              </span>
            )}
          </p>
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
              onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []))
                // Controller dibuat di sini (bukan saat Konfirmasi): begitu ada berkas yang
                // bisa diimpor, Konfirmasi sudah SELALU punya controller untuk di-abort.
                batalRef.current = new AbortController()
                setLanjutanBerkas(null)
              }}
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
                {total.dilewati > 0 && (
                  <p className="text-xs text-amber-700" data-testid="tebakan-dilewati">
                    {total.dilewati} produk lain perlu dipilih manual (sistem tidak sempat menebak).
                  </p>
                )}
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
                            {/* SKU bermasalah: file menulis SKU tapi master tidak punya. Ditampilkan
                                supaya user tahu apa yang tertulis di berkasnya, bukan menebak. */}
                            {b.sku_asal && (
                              <span className="block text-[11px] text-amber-700 dark:text-amber-500" data-testid={`sku-bermasalah-${b.order_ref}`}>
                                SKU di file: <b>{b.sku_asal}</b> (tidak ada di master)
                              </span>
                            )}
                            {b.sumber === "advance" && (
                              <span className="block text-[11px] text-muted-foreground" data-testid={`sumber-advance-${b.order_ref}`}>
                                dari Advance Fulfilment
                              </span>
                            )}
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

            {dilewatiHasil.length > 0 && (
              <div className="space-y-1 rounded-lg bg-red-50 p-3 text-xs text-red-900" data-testid="dilewati-import-order">
                <b>
                  {dilewatiHasil.length} baris dilewati D1 (order lain tetap tersimpan) — perbaiki lalu impor ulang:
                </b>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                  {dilewatiHasil.slice(0, 50).map((d, i) => (
                    <li key={`${i}-${d.berkas}-${d.no_pesanan}`}>
                      [{d.berkas}] {d.no_pesanan || "-"}: {d.pesan}
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
          {!preset && (
            <p className="mr-auto self-center text-xs text-red-600" data-testid="preset-kosong-import-order">
              Preset/toko belum dipilih — impor dinonaktifkan. Tutup dialog, pilih preset di halaman Order, lalu buka lagi.
            </p>
          )}
          {daftarHasil.length === 0 ? (
            <Button onClick={unggah} disabled={files.length === 0 || mengirim || !preset} data-testid="unggah-import-order">
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
              {progresImpor && (
                <p className="mr-auto self-center text-xs text-muted-foreground" data-testid="progres-impor-bertahap">
                  {progresImpor.nama}: {progresImpor.baris}/{progresImpor.total} order tersimpan
                </p>
              )}
              {lanjutanBerkas && !mengirim && (
                <p className="mr-auto self-center text-xs text-amber-700" data-testid="lanjutan-impor-bertahap">
                  {lanjutanBerkas.nama}: {lanjutanBerkas.tersimpan} order sudah tersimpan — Konfirmasi akan
                  melanjutkan. Pilih "Mulai dari awal" untuk mengimpor ulang berkas ini dari nol.
                </p>
              )}
              <label className="mr-auto flex items-center gap-1.5 text-xs" data-testid="perbarui-status-import-order">
                <input
                  type="checkbox"
                  checked={perbaruiStatus}
                  onChange={(e) => setPerbaruiStatus(e.target.checked)}
                  disabled={mengirim}
                />
                Perbarui status dari berkas
              </label>
              <Button
                variant="outline"
                onClick={mulaiDariAwal}
                disabled={!lanjutanBerkas || mengirim || !siapCommit() || !preset}
                data-testid="mulai-baru-import-order"
              >
                Mulai dari awal
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  // Ganti file = meninggalkan impor yang sedang jalan; hentikan dulu supaya
                  // loop tidak menulis di latar belakang sementara daftar berkas sudah diganti.
                  batalRef.current?.abort()
                  setMengirim(false)
                  setHasil(null)
                  setManual({})
                  setTandai(new Set())
                  setDilewatiHasil([])
                  setLanjutanBerkas(null)
                }}
                disabled={mengirim}
              >
                Ganti file
              </Button>
              {mengirim && (
                <Button variant="outline" onClick={batalkanImpor} data-testid="batal-import-order">
                  Hentikan
                </Button>
              )}
              <Button onClick={konfirmasi} disabled={mengirim || !siapCommit() || !preset} data-testid="konfirmasi-import-order">
                {mengirim && <Spinner />} Konfirmasi
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
