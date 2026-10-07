# Arsitektur Teknis v4 - WMS Multi-Gudang sebagai Jembatan Kledo

> Status: DRAF arsitektur. Tanggal: 2026-09-16.
> Basis: `docs/discovery-v4.md`, `docs/impact-map-v4.md`, `docs/research-kledo.md`,
> `docs/research-wms.md` (B/C/E/F), `lib/dashboard/data/index.ts`, `lib/models/stok.js`,
> `lib/models/produk.js`, `lib/models/admins.js`.
> Aturan sitasi: klaim kode merujuk `file:baris`; klaim Kledo merujuk `docs/research-kledo.md`.
> Klaim yang tidak terdokumentasi ditandai ASUMSI - WAJIB VALIDASI RUNTIME.
> Dokumen ini TIDAK mengubah kode sumber.

---

## 0. Keputusan yang sudah dikunci (tidak ditawar)

| # | Keputusan | Rujukan |
|---|---|---|
| K1 | Platform tetap Vercel Hobby; migrasi Cloudflare dibatalkan | discovery-v4.md:13 |
| K2 | `is_online_product` dihapus sebagai konsep; "online" = gudang tersendiri | discovery §2.3, K2 |
| K3 | Cache stok = SEMUA produk x SEMUA gudang (1107 produk), bukan subset | K3 |
| K4 | Permintaan antar-gudang pakai Kledo Warehouse Transfer; body POST belum terdokumentasi | research-kledo.md:93,132 |
| K5 | Sync Sheets DIMATIKAN; Kledo = satu-satunya sumber kebenaran | K5 |
| K6 | Penerima memilih gudang saat menerima | K6 |
| K7 | SEMUA selisih opname butuh approve owner; tidak ada auto-approve | K7 |
| K8 | RBAC 3 dimensi: `level_permission` x `jabatan` x `lokasi_gudang[]`; enforce server-side | K8 |
| K9 | Tujuan permintaan = gudang terdaftar ATAU user ber-flag lokasi gudang; bisa multiple | K9 |

Catatan koreksi: `lib/sheets/syncStokDuaArah.js` aktual **600 baris**, bukan 522 seperti
disebut discovery. `syncMasterData.js` juga ada. Keduanya dihentikan (K5).

Konflik yang HARUS diselesaikan (K5 vs README): `README.md:140` menyatakan "Firestore sebagai
sumber kebenaran untuk stok". v4 menetapkan Kledo sebagai SoT. README baris itu direvisi
bersamaan rilis v4 (lihat 9.10).

---

## 1. Arsitektur Overview

Tiga lapisan, satu arah otoritas:

```
[Telegram bot + Dashboard Next.js]      <- lapisan operasional & approval
        |
   Firestore (cache + state dokumen + RBAC + audit)
        |
   lib/kledo/*  (satu-satunya modul yang bicara ke Kledo)
        |
   Kledo API  <- source of truth stok & valuasi
```

Prinsip yang mengikat seluruh dokumen (`docs/research-wms.md:170,257`):

1. Kledo = system of record. WMS tidak menyimpan ledger stok tandingan. Firestore menyimpan
   salinan (cache) yang di-refresh + state dokumen operasional.
2. Semua aksi yang mengubah stok menulis ke Kledo DULU, baru refresh cache. Cache tidak
   pernah jadi sumber tulis independen.
3. Satu pintu ke Kledo (`lib/kledo/client.js`). Tidak ada `fetch` Kledo di route/model lain.
4. Scope gudang di-enforce di server, tidak pernah hanya filter UI
   (`docs/research-wms.md:103,105`).

### 1.1 Peta komponen

| Komponen | Lokasi | Tanggung jawab |
|---|---|---|
| Master gudang | `lib/models/gudang.js` (baru) | mirror `/finance/warehouses`, flag transit, freeze |
| State permintaan | `lib/models/permintaanKirim.js` (baru) | lifecycle menunggu_approval -> disetujui -> in_transit -> diterima/partial |
| Cache stok | `lib/models/kledoCache.js` (baru) | baca/tulis `kledo_cache`, tandai basi |
| Klien Kledo | `lib/kledo/client.js` (baru) | auth, retry, backoff, rate limit, idempotency |
| Bentuk body transfer | `lib/kledo/transfers.js` (baru) | SATU tempat bentuk body POST transfer (K4) |
| Endpoint Kledo | `lib/kledo/endpoints.js` (baru) | daftar path + parse; tidak ada string path di luar file ini |
| Sinkronisasi | `lib/kledo/sync.js` (baru) | polling `/reportings/warehouseStock`, refresh cache |
| Job rekonsiliasi | `lib/kledo/rekonsiliasi.js` (baru) | banding qty cache vs Kledo, laporan discrepancy |
| Guard scope | `lib/dashboard/auth/scope.js` (baru) | resolusi `lokasi_gudang` dari sesi, penolakan lintas-scope |
| Otorisasi RBAC | `lib/dashboard/auth/otorisasi.js` (baru) | cek level_permission x scope pada objek |

Modul baru `.js` (CommonJS) mengikuti pola model yang ada (`lib/models/stok.js:3` pakai
`require("../firebase")`).

### 1.2 Batas modul

- `lib/kledo/*` - satu-satunya yang menyentuh HTTP Kledo. Tidak mengimpor route/model
  Firestore kecuali lewat parameter (mudah diuji dengan inject client).
- `lib/models/*` - hanya Firestore. Tidak memanggil Kledo. Orkestrasi (tulis Kledo ->
  refresh cache -> audit) di route atau helper `lib/dashboard/aksiKledo.js` (baru).
- `app/api/**/route.ts` - guard + validasi + delegasi. Tetap tipis seperti sekarang
  (`app/api/stok/mutasi/route.ts:50-201`).

---

## 2. Model Data Firestore v4

### 2.1 Aturan ID dokumen

Pelajaran repo: nama field tidak dikelola pusat -> pakai snake_case seragam
(`docs/learnings.md:5-7`).

| Koleksi | ID dokumen | Alasan |
|---|---|---|
| `gudang` | `gudang_id` Kledo (string, mis. `"12"`) | Kledo sumber master gudang; pakai ID Kledo = tidak perlu tabel mapping |
| `kledo_cache` | `{kode_barang}` (1 dok/produk), qty per gudang sebagai map | 1107 dok, 1 read per produk, paritas pola `stock/{kode}` (`lib/models/stok.js:19-23`) |
| `permintaan_kirim` | `crypto.randomUUID()` | Dokumen lahir di WMS (belum ada di Kledo saat draft); UUID bebas tabrakan |
| `kledo_sync_state` | nama job tetap: `"warehouseStock"`, `"rekonsiliasi"`, `"pat_health"` | Singleton per job, mudah dibaca, tanpa query |
| `webhook_events` | `event_id` Kledo; fallback sha256(payload) | Dedup natural. ASUMSI nama field event_id Kledo - TIDAK TERDOKUMENTASI (`docs/research-kledo.md:403-405`) -> fallback hash WAJIB ada |
| `role_definisi` | slug jabatan ternormalisasi (`"admin-stok"`) | Jabatan bebas tapi perlu konsistensi dropdown |
| `stock_movements` | auto-ID (tetap) | 5 index ter-deploy bergantung padanya (`firestore.indexes.json:3-109`) |
| `stock` (transisi) | tetap `{kode_barang}` (lihat 2.4) | Rekomendasi B: map di dalam dokumen |

### 2.2 Koleksi baru

```
gudang/{gudang_id} = {
  gudang_id: string,            // ID Kledo
  nama: string,
  kode: string,
  tipe: "normal" | "transit",   // transit untuk in-transit (research-wms.md:113-117)
  freeze: boolean,              // kunci selama sesi opname (research-wms.md:152)
  rak: [{rak_id, nama, kode}],  // mirror /finance/warehouses/{id}/racks
  arsip: boolean,               // mirror archive/unarchive
  urutan: number,
  sync_at: Timestamp
}
```

Catatan: Kledo TIDAK punya `is_active` untuk warehouse - hanya archive/unarchive
(`docs/research-kledo.md:24,28-30`). Jadi pakai `arsip`, jangan `is_active`.

```
kledo_cache/{kode_barang} = {
  kode_barang: string,
  qty_per_gudang: { [gudang_id]: number },                  // K3: semua gudang
  reorder_point_per_gudang: { [gudang_id]: number | null }, // S18
  sync_at: Timestamp,
  sync_batch: string,
  basi: boolean
}
```

```
kledo_sync_state/{job} = {
  job: string,
  terakhir_mulai: Timestamp,
  terakhir_sukses: Timestamp | null,
  status: "idle" | "berjalan" | "gagal",
  pesan_error: string | null,
  lock_date: string | null,     // cache /options/lock_date (research-kledo.md:380)
  jumlah_produk: number,
  jumlah_gudang: number,
  percobaan_gagal_berturut: number
}
```

```
webhook_events/{event_id} = {
  event_id: string,
  payload_hash: string,
  topik: string | null,
  diterima_at: Timestamp,
  diproses_at: Timestamp | null,
  status: "baru" | "diproses" | "diabaikan" | "gagal"
}
```

```
permintaan_kirim/{uuid} = {
  id: string,
  gudang_asal: string,
  tujuan: [{ tipe: "gudang" | "user", gudang_id?: string, user_id?: string }],  // K9 multiple
  gudang_tujuan: string | null,     // ditetapkan penerima saat terima (K6); null selama transit
  peminta: string,                  // telegram_user_id
  status: "menunggu_approval" | "disetujui" | "ditolak" | "in_transit"
        | "diterima" | "partial" | "gagal_sinkron" | "dibatalkan",
  items: [{ product_id: string, kode_barang: string, qty_kirim: number,
            qty_diterima: number | null, harga?: number }],
  idempotency_key: string,
  kledo_transfer_id: number | null,
  kledo_doc_keluar: number | null,  // fallback material issue (research-kledo.md:283)
  alasan_tolak: string | null,
  riwayat: [{ status, oleh, at, catatan }],  // append-only
  created_at: Timestamp,
  updated_at: Timestamp
}
```

```
role_definisi/{slug} = {
  slug: string,
  label: string,          // "Admin Stok"
  urutan: number,
  aktif: boolean
}
```

`jabatan` di `admins` tetap teks bebas (K8); `role_definisi` hanya menyediakan daftar
pilihan agar tidak terjadi role explosion/ejaan bervariasi (`docs/research-wms.md:107`).

### 2.3 Koleksi yang berubah

```
products/{kode_barang} = {
  ...existing (nama_accurate, hpp, hpp_baru, variants, search_keywords, ...),
  is_online_product: true   // DEPRECATED - dibaca tapi tidak pernah ditulis lagi;
                            // dipertahankan sampai migrasi selesai untuk rollback
}
```

Makna "produk online" pindah ke: produk punya baris stok di gudang ONLINE. Query lama
`where("is_online_product","==",true)` (`lib/models/produk.js:149`) diganti query ke
`kledo_cache` yang punya key gudang ONLINE (filter in-memory) atau `stock` gudang ONLINE.

```
admins/{telegram_user_id} = {
  ...existing (name, telegram_username, role, added_at, approved_by, ...),
  role: string,                                    // TETAP, backward-compat firestore.rules
  level_permission: "owner" | "admin" | "guest",   // BARU; mirror `role` selama migrasi
  jabatan: string,                                 // BARU, teks bebas
  lokasi_gudang: string[]                          // BARU, scope (K8)
}
```

`role` dan `level_permission` hidup bersama selama migrasi; enforcement baca
`level_permission ?? role` supaya user lama tetap jalan. Lihat 9.2.

```
stock_movements/{auto-id} = {
  ...existing,
  gudang_id: string,               // BARU - wajib untuk movement baru; null untuk data lama
  idempotency_key: string | null   // BARU (R10)
}
```

### 2.4 Transisi `stock`: dari 1 dok/produk ke multi-gudang

Pilihan A - dokumen per (produk, gudang): `stock/{kode}__{gudang_id}`
- Pro: query equality `where("gudang_id","==","D12")` native; tulis konkuren dua gudang
  tidak bertabrakan (tidak hotspot satu dokumen).
- Kontra: 1107 produk x N gudang dokumen (4 gudang = 4428 dok); **56 titik kode**
  (`docs/impact-map-v4.md:21-49`) yang membaca `stock/{kode}` semua rusak, termasuk
  `ambilStok` (`lib/models/stok.js:19-23`) yang di-await di banyak jalur.

Pilihan B - map di dalam dokumen: `stock/{kode}` + `qty_per_gudang: {D12: 5, ...}`
- Pro: 1107 dokumen tetap; ID tidak berubah; `ambilStok(kode)` tetap 1 read.
- Kontra: **transaksi Firestore pada satu dokumen = hotspot 1 write/detik**; dua gudang
  menerima barang bersamaan -> contention + retry. Filter per gudang tidak bisa di query.

REKOMENDASI: B untuk v4.

Alasan: setelah K5, `stock` bukan lagi sumber angka - angka ada di `kledo_cache` + Kledo.
Yang tersisa di `stock` adalah `reorder_point` dan metadata. Transisi paling murah =
pertahankan bentuk dokumen, ubah isi field jadi map, dan tidak memaksakan query per gudang
di koleksi ini. Konsumen yang butuh stok per gudang membaca `kledo_cache` (tetap 1 dok/produk).

Konsekuensi ke 56 titik kode:
- `lib/models/stok.js:55` (`stok_gudang_online || 0`) -> `qty_per_gudang[gudang_id] ?? 0`.
  `_ubahStokRelatif` (`lib/models/stok.js:51-85`) berubah tanda tangan menjadi
  `_ubahStokRelatif(kodeBarang, gudangId, deltaQty, userId)`.
- `lib/models/stok.js:7,137-138` (banding reorder) -> per gudang.
- `lib/dashboard/data/real.ts:174,180,282` dan `mock.ts:328,334,459,1101` (map ke StockRow)
  -> tambah dimensi gudang.
- `lib/models/mock-data.ts:143-150` (8 baris MOCK_STOCK) dan 8 file test (impact-map §1C)
  -> seed harus punya gudang_id, kalau tidak, paritas mock vs real pecah.
- Strategi jangka pendek: **helper paritas** di `lib/models/stok.js`:
  `ambilStokPerGudang(kode, gudangId)` + `stokGudangOnline(kode)` (map ke gudang ONLINE)
  supaya konsumen lama (Gemini tools, reminder, halaman stok) tetap jalan sementara UI baru
  pakai per-gudang. Ini menahan gelombang refactor 56 titik sampai fase lanjut.
- Hotspot write dapat diterima karena setelah K5 penulisan `stock` hanya untuk
  `reorder_point` + koreksi manual (volume rendah).

ASUMSI - WAJIB VALIDASI RUNTIME: bentuk response `/finance/products/stocks` dan
`/reportings/warehouseStock` TIDAK TERDOKUMENTASI (`docs/research-kledo.md:143,169`).
Pemetaan ke `qty_per_gudang` bergantung padanya. Jangan finalisasi parser sebelum capture.

### 2.5 Kenapa cache pakai map, bukan dok per (produk,gudang)

`kledo_cache` di-refresh sebagai batch. Dengan map: refresh = 1107 write, pembacaan
dashboard = 1107 read. Dengan dok per (produk,gudang): refresh = 1107 x N write, dashboard
= 1107 x N read. K3 mensyaratkan semua produk x semua gudang, jadi map menghemat read
secara linear terhadap jumlah gudang. Trade-off: tidak ada query "produk dengan stok
gudang X < ambang" di Firestore; jalur itu tetap full scan + cache in-memory, pola yang
sudah dipakai `_ambilSemuaStokDenganCache` (`lib/models/stok.js:121-129`).

---
