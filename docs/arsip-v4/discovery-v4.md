# Discovery & Scope v4 — WMS Multi-Gudang sebagai Jembatan Kledo

> Status: DRAF discovery (belum PRD). Tanggal: 2026-09-16.
> Basis: docs/research-kledo.md, docs/research-wms.md, docs/impact-map-v4.md,
> docs/research-cloudflare.md ringkasan, README.md.
> Aturan sitasi: setiap klaim riset merujuk file + baris. Yang tidak terdokumentasi
> ditandai TIDAK TERDOKUMENTASI. Kejujuran soal ketidakpastian > kelengkapan semu.

## 0. Keputusan yang sudah dikunci user (tidak dibuka ulang)

| # | Keputusan | Sumber |
|---|---|---|
| K1 | Platform tetap **Vercel Hobby**. Migrasi Cloudflare **DIBATALKAN** untuk v4. | Konteks user; research-cloudflare.md:211-214 |
| K2 | Batas 12 function = **kebijakan internal** yang akan direvisi, bukan batas Vercel. | impact-map-v4.md:11-12 |
| K3 | Fokus v4 = **WMS**. Integrasi Kledo masuk v4 sebagai fondasi. | Konteks user |
| K4 | Target "Kirim ke" = **hanya user ber-flag lokasi gudang + gudang terdaftar**, bukan semua user. | Konteks user |
| K5 | Kledo = **source of truth** stok & valuasi; WMS = lapisan operasional. **KONFLIK TERBUKA:** README.md:140 menyatakan sebaliknya ("Firestore sebagai sumber kebenaran untuk stok" saat sync Sheets). v4 memilih Kledo sebagai SoT; README harus direvisi, dan jalur sync Firestore<->Sheets lama perlu dipertemukan (lihat 8 R15). | Konteks user; research-wms.md:170; konflik: README.md:140 |
| K6 | Webhook tersedia di plan Elite user, **tapi topik/payload/signature Kledo TIDAK TERDOKUMENTASI**. | Konteks user; research-kledo.md:399-411 |

---

## 1. Problem Statement

**Dari sudut pandang user (bukan fitur):**

Admin stok dan sales di toko dengan lebih dari satu gudang hari ini **tidak punya cara resmi untuk saling minta barang**. Mereka bergantung pada chat manual (WhatsApp/Telegram) yang tidak tercatat, tidak bisa diaudit, dan tidak nyambung ke Kledo. Akibatnya:

1. **Stok tidak pernah akurat per gudang.** Sistem saat ini hanya punya satu angka `stok_gudang_online` per produk — tidak ada dimensi gudang sama sekali (impact-map-v4.md:15: `gudang_id`/`warehouse`/`kledo` = 0 kemunculan). Jadi "stok gudang D12" dan "stok gudang online" tidak bisa dibedakan.
2. **Admin tanpa akun Kledo tidak bisa bekerja.** Plan Kledo user (Elite) membatasi jumlah akun. Admin stok/sales yang tidak punya akun Kledo **tidak bisa** minta stok, opname, atau lihat stok per gudang — padahal mereka yang pegang barang fisik.
3. **Permintaan antar-gudang tidak berjejak.** Tidak ada approval, tidak ada status in-transit, tidak ada bukti terima. Kalau barang hilang di jalan, tidak ada yang tahu di mana selisihnya muncul (research-wms.md:115).
4. **Opname tidak menghasilkan dokumen resmi.** Perubahan stok saat ini langsung ditimpa (`timpaStokOpname`, impact-map-v4.md:26), tanpa approval dan tanpa jurnal Kledo — sehingga akuntansi dan fisik bisa berbeda diam-diam.
5. **Data tidak terhubung ke sistem kebenaran.** Kledo punya warehouses, transfers, stockAdjustments, tapi **nol kode integrasi** di repo (impact-map-v4.md:216). Jadi angka di dashboard tidak pernah cocok dengan pembukuan.

**Visi user (kutipan asli):**

> "Mungkin ini nanti akan merubah workflow. Jika integrasi kledo, maka wms akan menjadi jembatan penghubung antara admin yang tak punya akun kledo (limit plan, plan ku di kledo adalah elite jadi nantinya bisa webhook juga). Firestore akan menjadi caching, untuk gudangku meminta stok, jadi admin stok/sales yang login kledo di pc bisa memproses invoice/surat jalan dengan mudah."

**Rumusan satu kalimat:** v4 harus membuat admin tanpa akun Kledo bisa **melihat stok per gudang, minta barang antar-gudang, dan opname** lewat dashboard/Telegram — sementara Firestore menyimpan cache + approval + akses, dan Kledo tetap jadi sistem kebenaran yang memproses dokumen resmi.

---

## 2. Target User & Peran

### 2.1 Siapa

| Persona | Punya akun Kledo? | Kebutuhan utama |
|---|---|---|
| **Owner** | Ya | Lihat semua gudang, setujui permintaan & selisih opname, atur konfigurasi/role |
| **Admin Stok per gudang** (mis. "Admin Stok, Gudang D12") | Tidak | Minta/terima barang, opname gudangnya, lihat stok gudangnya saja |
| **Sales** | Ya (login Kledo PC) | Lihat ketersediaan stok gudang, proses invoice/surat jalan di Kledo |
| **Guest** | Tidak | Lihat terbatas (read-only) |

### 2.2 Struktur role: level permission x jabatan x lokasi

Permintaan user (item 7, 8, 9): level permission tetap owner/admin/guest, tapi "role" jadi **penamaan jabatan bebas**; flag lokasi gudang per user; listing gudang dipakai untuk flag item DAN user.

Pola industri mendukung pemisahan ini: **role** (fungsi kerja) dan **scope resource** adalah dua dimensi terpisah (research-wms.md:88-93). Kledo sendiri mengimplementasi role global + penugasan role **per gudang** (research-kledo.md:63-75). Tapi karena admin gudang **tidak punya akun Kledo**, RBAC Kledo **tidak bisa dipakai langsung** — otorisasi harus di Firestore (research-kledo.md:83).

**Saran desain (3 dimensi terpisah, bukan 1 field "role"):**

```
users/{uid} = {
  level_permission: "owner" | "admin" | "guest",   // gerbang keamanan, TETAP
  jabatan:           free text  (mis. "Admin Stok"),// label UI saja
  lokasi_gudang:     [gudang_id, ...]               // scope, multi
}
```

- **level_permission** — tetap dipakai `firestore.rules:5-15` (owner/admin/guest, `staff()` = owner|admin) dan semua gate route (impact-map-v4.md:81-99). **TIDAK berubah.** Jabatan bebas TIDAK boleh menambah permission.
- **jabatan** — murni kosmetik untuk dropdown "Kirim ke" dan daftar user (item 8, 10). Tidak pernah jadi input otorisasi. Alasan: mencegah **role explosion** (research-wms.md:107,213).
- **lokasi_gudang[]** — scope. **WAJIB di-enforce di server**, bukan filter UI. Bahaya utama RBAC multi-lokasi = filter gudang hanya di UI, user gudang A bisa lihat/edit gudang B via API langsung (research-wms.md:101-107). Preseden bug nyata ada di proyek (research-wms.md:106; dashboard-prd-v3b.md:452: filter status/action_type di memori).

Contoh terpetakan (item 8): `{ level_permission: "admin", jabatan: "Admin Stok", lokasi_gudang: ["D12"] }`.

Contoh owner multi-gudang: `{ level_permission: "owner", jabatan: "Owner", lokasi_gudang: ["D12","D13","ONLINE"] }`.

### 2.3 Kaitan dengan `is_online_product`

Catatan penting: `is_online_product` saat ini **field global di `products`**, bukan per gudang (impact-map-v4.md:75). Item 6 user ("filter default online") bisa tetap dipertahankan sebagai flag global v4, TAPI konsep "online" sebagai gudang terpisah (bukan flag produk) perlu keputusan — lihat 9 Q3. Riset WMS menempatkan "stok per gudang di setiap query" sebagai syarat multi-lokasi (research-wms.md:228); implikasinya lokasi diperlakukan sebagai dimensi query, bukan sekadar flag tampilan (inferensi penulis, bukan kutipan langsung).

---

## 3. Scope v4

### 3.1 MASUK scope (rujuk research-wms.md:223-239)

| # | Fitur | Permintaan user | Rujukan |
|---|---|---|---|
| S1 | Master gudang: listing gudang, tambah/edit nama gudang, gudang masuk filter stok | item 5, 9 | research-wms.md:227; Kledo /finance/warehouses (research-kledo.md:17) |
| S2 | Flag lokasi gudang per **item** | item 4 | Turunan dari S5 (research-wms.md:228 menuntut stok per gudang); konsep entity lokasi di research-wms.md:23 |
| S3 | Flag lokasi gudang per **user** (scope) | item 8 | research-wms.md:229 |
| S4 | Level permission tetap (owner/admin/guest) + **jabatan editable** | item 7 | impact-map-v4.md:81-99; research-wms.md:93 |
| S5 | Stok **per gudang** di setiap query (ganti `stok_gudang_online` tunggal) | implisit item 6 | research-wms.md:228 |
| S6 | Filter stok default `is_online_product == true`, bisa dimatikan | item 6 | impact-map-v4.md:65-75 |
| S7 | Dashboard buat permintaan ke gudang sebelah (tombol) | item 1 | research-wms.md:230-231 |
| S8 | Opsi "Kirim ke": Gudang **atau** User (tampil jabatan), multiple | item 10, K4 | research-wms.md:231 |
| S9 | Transfer antar-gudang **dengan status in-transit** | item 1 | research-wms.md:230; ERPNext Add to Transit (research-wms.md:115) |
| S10 | Approval berlapis: peminta -> penyetuju (admin/owner) -> penerima | item 1 | research-wms.md:231; Kledo transfers/approve (research-kledo.md:103) |
| S11 | Partial receive (`qty_kirim` vs `qty_diterima`, status `partial`) | item 1 | research-wms.md:232; research-wms.md:135-136 |
| S12 | Stok opname dari dashboard -> dokumen `stockAdjustments` ber-approval | item 2 | research-wms.md:233; Kledo stockAdjustments (research-kledo.md:185) |
| S13 | Flag `is online` produk dari dashboard (baca seluruh item) | item 3 | impact-map-v4.md:65-75 |
| S14 | Integrasi Kledo: auth PAT, sync stok, tulis dokumen (transfer/adjustment) | item 11 | PAT research-kledo.md:353-369; sync stok :138,:169; tulis transfer/adjustment :183-228 |
| S15 | Idempotency key di semua konfirmasi draft | — | research-wms.md:234; gap nyata dashboard-prd-v3b.md:192-199 |
| S16 | Audit trail append-only (pakai .../logs Kledo) | — | research-wms.md:235; research-kledo.md:129 |
| S17 | Kartu stok / stock ledger view | — | research-wms.md:236; Kledo /stockMovements (research-kledo.md:157) |
| S18 | Reorder point per gudang | — | research-wms.md:237. **Catatan:** ada di v4 tapi ditunda di MVP (10) karena bergantung cache yang stabil |
| S19 | Job rekonsiliasi qty WMS<->Kledo harian (laporan discrepancy, tidak auto-timpa) | — | research-wms.md:239,193 |

### 3.2 TIDAK masuk v4 (dengan alasan)

| # | Ditunda | Alasan | Rujukan |
|---|---|---|---|
| N1 | Webhook Kledo sebagai kanal sinkron utama | Topik, payload, signature **TIDAK TERDOKUMENTASI**. Hanya endpoint manajemen yang ada. | research-kledo.md:399-411 |
| N2 | Migrasi Cloudflare | Dikunci user (K1). Free CPU 10ms tidak muat; firebase-admin blocker. | research-cloudflare.md:211-214 |
| N3 | Engine konversi UoM (dus->pcs) | Kledo sudah punya /finance/units + product_conversion. Jangan bangun ulang. | research-wms.md:28,261 |
| N4 | Batch/lot/serial/expiry engine sendiri | Kledo punya "Product serial". Tampilkan saja. | research-wms.md:63,262 |
| N5 | Message broker / event bus | 10 staf cukup webhook+polling. EDA overkill. | research-wms.md:255 |
| N6 | 2PC lintas WMS<->Kledo | Blocking, butuh intervensi manual. Pakai saga/idempotent retry. | research-wms.md:256,192 |
| N7 | Ledger stok ganda (dua source of truth) | Sumber drift. Kledo = system of record. | research-wms.md:257,170 |
| N8 | Full/cycle count scheduling ABC (Pareto), barcode scan opname | v5. v4 cukup opname manual + filter. | research-wms.md:243-247 |
| N9 | Frozen stock kompleks per-lokasi | v4 cukup kunci manual (flag freeze sederhana). | research-wms.md:244 |
| N10 | Laporan aging & inventory turnover | Kledo disebut punya /reportings/inventoryTurnover/{warehouseId} — **klaim dari research-wms.md:245 saja; tidak ditemukan di research-kledo.md, perlu verifikasi runtime**. v5 cukup pakai Kledo. | research-wms.md:245 (belum terverifikasi) |
| N11 | Slotting/putaway, wave/cluster picking, YMS, WMS/robotics, prediksi ML | Overkill fasilitas besar. | research-wms.md:258-264 |
| N12 | Role per gudang (role explosion) | Pakai role + scope. | research-wms.md:263,107 |

---

## 4. Analisis Keputusan: Sumber Stok Multi-Gudang

**Pertanyaan user:** (a) simpan map `stok_per_gudang` di Firestore, atau (b) ambil langsung dari Kledo `/finance/products/stocks` + cache?

### Fakta dari riset

- **Endpoint batch ada.** `GET /finance/products/stocks?product_ids=1,2,3&warehouse_ids=1,2,3` — satu request untuk banyak produk x banyak gudang. Param `product_ids` **required**, `warehouse_ids` opsional (default semua), `trans_date` opsional. Bentuk response **TIDAK TERDOKUMENTASI** (research-kledo.md:138-143).
- **Endpoint laporan penuh ada.** `GET /reportings/warehouseStock` — **required `date`**, filter `warehouse_ids` multi-koma, `hide_zero_qty`, `per_page`, `page`, `export`. Cocok tarik seluruh stok per gudang sekali jalan (research-kledo.md:169).
- **Mass export ada.** `/reportings/warehouseStock/massExport` — Excel multi-sheet, `per_page` = jumlah produk per sheet, default 100, bisa dikirim besar untuk seluruh data (research-kledo.md:170).
- **Volume data:** 1107 produk (konteks user). impact-map mencatat `stok_gudang_online` tersebar di **26 file / 56 baris**, `is_online_product` di **18 file / 42 baris** (impact-map-v4.md:13-14). Itu 42 titik yang perlu tahu "gudang mana".
- **Rate limit Kledo TIDAK TERDOKUMENTASI.** Tidak ada jaminan; tangani 429 defensif (research-kledo.md:371-373).

### Perbandingan

| Dimensi | (a) stok_per_gudang map Firestore | (b) Kledo langsung + cache |
|---|---|---|
| Sumber kebenaran | Firestore — bertentangan dengan K5 (Kledo = SoT) | Kledo — selaras K5 |
| Biaya baca Firestore | 1107 dokumen x N field gudang; baca besar tiap buka dashboard | Nol baca untuk angka; baca hanya cache |
| Risiko drift | Tinggi — dua ledger, persis YAGNI N7 (research-wms.md:257) | Rendah — cache bisa di-refresh |
| Butuh stok lokal (reminder/reorder) | Ya, native | **Ya — cache tetap perlu** |
| Blocker | Perlu semua penulis stok ikut memelihara map (26 file writer/reader, impact-map-v4.md:21-49) | Response shape **TIDAK TERDOKUMENTASI** -> verifikasi runtime dulu |
| Kontrak endpoint | — | Batch terdokumentasi (research-kledo.md:138) |

### REKOMENDASI

**Pakai (b): ambil dari Kledo sebagai sumber angka, simpan cache di Firestore.**

Pola: `kledo_cache` (gudang x produk -> qty) di-refresh oleh job harian (dan saat webhook tersedia) lewat `/reportings/warehouseStock` (semua produk, satu tanggal) dan/atau `/finance/products/stocks` (lookup produk gudang tertentu). Dashboard baca cache; aksi yang mengubah stok (transfer/adjustment) **selalu** tulis ke Kledo dulu, lalu refresh cache.

Alasan:
1. Selaras kunci K5 — Kledo = SoT, WMS tidak menyimpan ledger tandingan (research-wms.md:170,257).
2. Menghindari YAGNI ledger ganda (N7).
3. Bot tetap butuh angka lokal untuk reminder/reorder point (`lib/reminder/reminderHarian.js:39-44`, `lib/reminder/cekReorderPoint.js:30-41`). **Ya, cache tetap perlu** — tapi cache = salinan yang di-refresh, **bukan** sumber tulis independen.
4. Cache di-invalidate saat aksi tulis agar tidak basi.

**Yang tetap diputuskan user (tidak bisa diputuskan dari riset):** lihat 9 Q1 — apakah cache berisi **semua gudang x semua produk** (1107 baris penuh, biaya baca lebih besar) atau **hanya produk yang punya `reorder_point`/flag online** (lebih murah tapi tidak lengkap). Riset tidak bisa menjawab trade-off biaya baca Firestore aktual tanpa data kuota user.

**Prasyarat wajib sebelum implementasi:** verifikasi runtime bentuk response `/finance/products/stocks` dan `/reportings/warehouseStock` (keduanya **TIDAK TERDOKUMENTASI** bentuknya). Lihat 8 R1.

---

## 5. Desain Alur Permintaan Antar-Gudang (UI -> Kledo)

### 5.1 Dilema: Transfer vs Material Request/Issue

Dari riset (research-kledo.md:315-320):

- **Warehouse Transfer** (`/finance/warehouses/transfers`) — model asal->tujuan antar gudang yang **benar** (dua gudang di level dokumen), tapi **body POST TIDAK TERDOKUMENTASI** (research-kledo.md:93, `CreateFinanceWarehouseTransferAPIRequest` tak punya skema). Approve-nya `GET` (bukan POST, research-kledo.md:103). Status enum **TIDAK TERDOKUMENTASI** (research-kledo.md:113). Efek stok (langsung vs setelah approve) **TIDAK TERDOKUMENTASI** (research-kledo.md:120).
- **Material Request + Material Issue** — **terdokumentasi penuh**: body POST, alur approval (submit/approve/reject/revert/draft), dan **efek stok eksplisit** pada approval level terakhir (research-kledo.md:245-320). Tapi **tidak ada gudang tujuan** dalam satu dokumen — hanya `warehouse_id` tunggal; `location` cuma teks (research-kledo.md:269). Transfer antar-gudang **tidak** direpresentasikan dua gudang dalam satu dokumen (research-kledo.md:318).
- Modul Material bisa mati per perusahaan -> `404` (research-kledo.md:245).

### 5.2 Rekomendasi

**Pilih Warehouse Transfer sebagai dokumen eksekusi, dengan rencana mitigasi blocker via network capture.** Material Request/Issue jadi **fallback** bila capture gagal.

Alasan:
1. Hanya transfer yang punya **pasangan asal->tujuan** di level dokumen — syarat wajib untuk permintaan antar-gudang (research-kledo.md:132,318).
2. Material tidak punya gudang tujuan -> harus dipetakan di Firestore dan dieksekusi sebagai dua langkah, memaksa WMS jadi pemegang logika transfer (melanggar K5).

**Strategi mitigasi blocker (body POST transfer TIDAK TERDOKUMENTASI):**

1. **Network capture** di UI Kledo saat owner membuat transfer manual: buka DevTools -> rekam request POST `/finance/warehouses/transfers` -> dapatkan bentuk body persis. Ini cara paling cepat dan pasti.
2. **Uji runtime terisolasi** di lingkungan Kledo user: kirim POST dengan body hasil capture, cek response & efek stok (via `GET {id}` dengan `include_stock_before=1`, research-kledo.md:97).
3. **Tangkap response** untuk memetakan status enum (`status_id` tidak punya daftar nilai, research-kledo.md:113).
4. **Bila capture gagal/unavailable** -> fallback Material Request/Issue:
   - Material Request ke gudang asal (`warehouse_id` sumber, research-kledo.md:249-268).
   - Gudang tujuan disimpan di Firestore (`permintaan_kirim`).
   - Realisasi = Material Issue (research-kledo.md:281-308).
   - Transfer fisik antar gudang tetap perlu dokumen transfer manual di Kledo oleh admin berakun, atau transfer via API setelah body ditemukan.
5. Karena modul Material bisa `404`, **cek ketersediaan modul** saat onboarding sebelum bergantung fallback.

**Keputusan ini harus dicatat sebagai blocker terbuka** (research-kledo.md:132: "Harus tangkap payload dari UI Kledo sebelum bangun jembatan").

### 5.3 Alur (dengan in-transit)

Patuhi pola in-transit: stok keluar gudang asal -> virtual location **Transit** -> masuk gudang tujuan setelah diterima (research-wms.md:113-117, ERPNext "Add to Transit"). Tanpa ini, transfer langsung bikin selisih opname saat barang belum sampai (research-wms.md:115).

```
[UI Dashboard]
  Admin Stok D12 klik "Minta Stok"
    pilih produk + qty
    "Kirim ke": [Gudang D13] atau [User: Sales Budi (Sales)]
  -> POST /api/permintaan-kirim (scope divalidasi server-side)

[Firestore: permintaan_kirim]
  status: "menunggu_approval"
  gudang_asal, gudang_tujuan, peminta, tujuan(user|gudang)[],
  idempotency_key, items[{product_id, qty}]

[Penyetuju admin/owner]
  setujui -> status: "disetujui"
  tolak   -> status: "ditolak" (alasan)   [audit append-only]

[Kledo] (setelah disetujui)
  Buat dokumen transfer gudang_asal -> TRANSIT
    (jika body POST belum terverifikasi: fallback Material Issue keluar dari asal)
  -> stok keluar gudang asal, masuk TRANSIT
     (firestore cache di-refresh)

[Penerima di gudang tujuan]
  terima penuh  -> transfer TRANSIT -> gudang_tujuan, status: "diterima"
  terima sebagian (10 dikirim, 8 diterima)
                -> qty_kirim=10, qty_diterima=8, status: "partial"
                   selisih 2 tetap di TRANSIT sampai keputusan
                   (lanjut kirim / adjustment / loss)   [research-wms.md:135-136]

[Audit]
  semua transisi tulis log append-only; pakai .../logs Kledo bila tersedia
```

**In-transit harus muncul di laporan** (in-transit inventory) supaya tidak dianggap hilang (research-wms.md:117). Kledo: apakah punya virtual warehouse "Transit" bawaan **TIDAK TERDOKUMENTASI** -> owner harus menandai satu gudang Kledo sebagai lokasi transit (konfigurasi, 9 Q4).

---

## 6. Desain Alur Opname dari Dashboard

### 6.1 Kait ke Kledo `stockAdjustments`

`POST /finance/stockAdjustments` terdokumentasi (research-kledo.md:185-210):
```json
{
  "trans_date": date,
  "warehouse_id": integer,
  "account_id": integer,
  "type_id": integer,
  "ref_number": string,
  "memo": string,
  "pic_user_id": integer,
  "counted_by_user_id": integer,
  "items": [{ "product_id", "actual_qty", "diff_qty", "price", "serial_numbers" }],
  "tags": [integer]
}
```

Penting: item memuat **`actual_qty` DAN `diff_qty`** bersamaan. Kehadiran `actual_qty` (qty fisik) + `diff_qty` (selisih) mengindikasikan opname **absolut**. Tapi **mana yang wajib dan bagaimana relasi keduanya TIDAK DIJELASKAN** (research-kledo.md:212) -> verifikasi runtime.

Alur approve `stockAdjustments` = **POST** `approve`/`reject`/`revert` (research-kledo.md:218-228). Status enum **TIDAK TERDOKUMENTASI**.

Cek `lock_date` sebelum kirim adjustment — Kledo menolak "tanggal terkunci" (research-kledo.md:380).

### 6.2 Frozen stock

Odoo men-set produk/lokasi "frozen" selama sesi cycle count supaya tidak bisa dipakai transaksi (research-wms.md:152). Risiko tanpa freeze: item multi-lokasi + lag paperwork -> salah adjustment sampai stok di-nol-kan (research-wms.md:148).

**Rekomendasi v4:** kunci **manual** — flag `freeze` di gudang/rak selama sesi opname. Transaksi masuk ke lokasi terkunci ditolak (HTTP 409). Frozen kompleks per-lokasi = v5 (research-wms.md:244). Ini kelas "error handling yang mencegah data loss" -> jangan disederhanakan.

### 6.3 Approval selisih

Selisih = dokumen ber-approval, bukan edit langsung (research-wms.md:233). Rekomendasi riset: selisih **< threshold** (mis. 2% nilai rak) auto-approve; **>= threshold** wajib approve owner. Audit trail tidak boleh dihapus (research-wms.md:160).

### 6.4 Alur

```
[UI Dashboard Opname]
  pilih gudang (+ rak opsional)  -> kunci (freeze) lokasi
  sistem tampilkan qty sistem per produk   (dari cache/Kledo)
  admin input qty fisik (actual_qty)
  -> hitung diff_qty = actual_qty - qty_sistem

[Firestore: opname_drafts]
  status: "draft_hitung"
  gudang_id, items[{product_id, actual_qty, diff_qty}], idempotency_key

[Buka kunci]
  admin selesai hitung -> lepas freeze

[Approval]
  selisih < threshold -> auto-approve
  selisih >= threshold -> menunggu approve owner
  (threshold nilai/scope: keputusan user, 9 Q5)

[Kledo]
  POST /finance/stockAdjustments  (warehouse_id, items)
  cek /options/lock_date dulu
  bila perlu approve: POST /stockAdjustments/{id}/approve
  -> stok resmi menyesuaikan; stock ledger & jurnal terbentuk
  -> firestore cache di-refresh
```

**Endpoint yang BUKAN alat opname:** `/finance/healthCheck/stockMovementModifier` mengubah baris stock movement langsung tanpa approval/jurnal — deskripsinya "Clear log dispatch healthcheck", kemungkinan maintenance internal. **Jangan dipakai** (research-kledo.md:230-239).

---

## 7. Strategi Integrasi Kledo

### 7.1 Auth — Personal Access Token (PAT)

- Buat sekali via `POST /personal-access-tokens` body `{ name, expires_in_days }` (research-kledo.md:355-362). Base URL `https://{subdomain}.api.kledo.com/api/v1/`, auth Bearer (research-kledo.md:4; base URL baris 3, auth Bearer baris 5).
- Simpan di env Vercel (secret manager), **jangan** di repo. Nilai token hanya muncul sekali saat create — **TIDAK ADA pernyataan eksplisit di dokumen** (research-kledo.md:362).
- Jalur lama paralel: `/authentication/user/apikeys` (research-kledo.md:369). Pakai PAT.
- **Rate limit TIDAK TERDOKUMENTASI** (research-kledo.md:371-373). Tangani 429 defensif + backoff; jangan asumsi kuota.
- **Kedaluwarsa & rotasi token (BLOCKER operasional):** expires_in_days wajib saat create (research-kledo.md:355-362), tapi perilaku saat token kedaluwarsa tidak dijelaskan. Risiko: sinkronisasi berhenti diam-diam tanpa error yang terlihat. **Mitigasi wajib v4:** job cek /personal-access-tokens/stats + last_used_at (research-kledo.md:363,366), alert owner bila token mendekati kedaluwarsa atau tidak terpakai; prosedur rotasi terdokumentasi. Akun user plan Elite, satu PAT = satu titik gagal.

### 7.2 Sinkronisasi: webhook vs polling

- **Kondisi faktual:** webhook Kledo nyaris kosong di dokumen. Hanya endpoint manajemen: `regenerateSecret`, `settings`, `setup`, `verify`, `test`. **Tidak ada daftar topik, payload, atau skema signature** (research-kledo.md:389-411). Webhook Shopify di file yang sama **bukan** webhook Kledo (research-kledo.md:401).
- **Rencana v4:** **polling sebagai kanal utama.** Job harian tarik `/reportings/warehouseStock` (semua produk, per tanggal, research-kledo.md:169) + `/finance/products/stocks` untuk lookup (research-kledo.md:138). Webhook = **eksperimen setelah v4 stabil**, setelah topik dipastikan lewat `/webhook/settings`, `/webhook/test`, `regenerateSecret` (research-kledo.md:410-411).
- Riset WMS merekomendasikan webhook+dedup event id sebagai kanal real-time (research-wms.md:238), TAPI fakta proyek = topik tidak diketahui -> **jangan asumsikan webhook bisa langsung dipakai**.
- **KONFLIK SUMBER:** research-wms.md:186 mengklaim webhook Kledo idempoten ("tetap mengembalikan 200") dan menyitir kledo-api-reference.md:30393, tetapi research-kledo.md (bagian H) menemukan **nol** klaim itu — baris 30393 justru area webhook Shopify (research-kledo.md:401). Kebenaran belum pasti; **jangan andalkan idempotensi webhook** sampai diverifikasi runtime.

### 7.3 Cache

- `kledo_cache` (gudang x produk -> qty) di-refresh job harian. Dashboard baca cache (murah, cepat).
- `kledo_sync_state` — catat tanggal sync terakhir, `lock_date`, status.
- Cache in-memory yang sudah ada (`products` 5 menit, `stock` 1 menit — README.md:141) diperluas ke per-gudang.
- **Prinsip:** cache = salinan yang di-refresh, bukan sumber tulis. Semua tulis ke Kledo dulu (research-wms.md:170).
- **Firestore rules untuk koleksi baru (R16):** irestore.rules saat ini hanya kenal owner/admin/guest (impact-map-v4.md:81-85). Koleksi baru (gudang, permintaan_kirim, 
ole_definisi, kledo_cache, kledo_sync_state, webhook_events) harus punya rule eksplisit. kledo_cache/kledo_sync_state = tulis server-only (admin SDK), client read-only. Scope gudang wajib query server-side, tidak boleh client.

### 7.4 Idempotensi

Semua konfirmasi draft (transfer, opname, sync) wajib **idempotency key** per dokumen (research-wms.md:234,206). Gap nyata: `konfirmasiOpname`/`konfirmasiSyncStok` **tidak punya guard idempotensi** — bisa apply ulang kalau `pending*` sudah dibersihkan (research-wms.md:180; dashboard-prd-v3b.md:192-199).

Pola: simpan key di koleksi `webhook_events`/guard (impact-map-v4.md:140); retry aman hanya bila operasi idempoten (research-wms.md:178). Karena POST tidak idempoten (research-wms.md:178), key = kewajiban.
**Cakupan idempotency v4 (R20):** bukan hanya dokumen baru. Guard existing - `draft_kirim_guard`, `permintaan_form_guard`, `stock_write_guard` (impact-map-v4.md:136-138) - harus diaudit dan diberi key yang sama sebelum route baru menumpang jalur itu, supaya tidak ada dua mekanisme guard yang saling tidak tahu.

### 7.5 Bila Kledo down

Prinsip: satu sistem authoritative; sistem lain hanya **mengusulkan dokumen**, bukan menimpa (research-wms.md:191). 2PC tidak praktis untuk dua SaaS via HTTP -> pakai **saga/idempotent retry + rekonsiliasi** (research-wms.md:192).

```
Kledo down / request gagal:
  1. JANGAN tampilkan angka lama sebagai "stok terkini" — tandai cache basi
     (timestamp sync terakhir ditampilkan di UI).
  2. Dokumen yang belum tereksekusi (transfer/opname) tetap tersimpan lokal
     dengan status "menunggu_sinkron" + idempotency key.
  3. Job retry idempoten dengan backoff. Sukses -> update status + refresh cache.
  4. Job rekonsiliasi harian bandingkan qty WMS(cache) vs Kledo.
     Beda -> tampilkan sebagai DISCREPANCY, keputusan manusia. TIDAK auto-timpa
     (research-wms.md:193,211).
  5. Audit trail append-only; persist in-transit event, dequeue setelah ack
     (research-wms.md:212).
```

Tulis ke Kledo yang gagal **tidak boleh** mengubah cache lokal secara optimistis-tanpa-rekonsiliasi, atau WMS jadi sistem tandingan (melanggar K5).

---

## 8. Risiko & Asumsi

| # | Risiko / Asumsi | Termasuk asumsi? | Cara validasi |
|---|---|---|---|
| R1 | **Bentuk response `/finance/products/stocks` & `/reportings/warehouseStock` TIDAK TERDOKUMENTASI** -> desain cache bisa salah bentuk. | Asumsi: ada field qty per gudang | Panggil endpoint runtime dengan produk/gudang nyata; catat shape JSON. **Blocker sebelum implementasi cache.** (research-kledo.md:143,169) |
| R2 | **Body POST transfer TIDAK TERDOKUMENTASI** (`CreateFinanceWarehouseTransferAPIRequest`). Ini risiko inti fitur permintaan. | Asumsi: body menyamai pola lain | Network capture UI Kledo + uji POST terisolasi. Fallback material request/issue. (research-kledo.md:93,132) |
| R3 | **Status enum transfer TIDAK TERDOKUMENTASI** (hanya `status_id` integer tanpa daftar). | Asumsi: ada draft/pending/approved/rejected | Tangkap response GET list transfer; petakan enum. (research-kledo.md:113) |
| R4 | **Efek stok transfer: langsung saat create atau setelah approve? TIDAK TERDOKUMENTASI.** | Asumsi: setelah approve | Uji: create transfer, cek stok via `GET {id}?include_stock_before=1` + `/finance/products/stocks`. (research-kledo.md:120) |
| R5 | **Webhook Kledo: topik, payload, signature TIDAK TERDOKUMENTASI.** | Asumsi: webhook bisa jadi kanal sinkron | `/webhook/settings`, `/webhook/test`, `regenerateSecret`; minta daftar topik resmi Kledo. Sampai itu, **polling**. (research-kledo.md:399-411) |
| R6 | **Rate limit Kledo TIDAK TERDOKUMENTASI.** Volume 1107 produk -> risk 429 saat sinkron penuh. | Asumsi: kuota cukup | Ukur via header/X-RateLimit saat polling; pakai batch endpoint + `massExport` untuk hemat request; backoff defensif. (research-kledo.md:371-373) |
| R7 | **`actual_qty` vs `diff_qty` relasi TIDAK DIJELASKAN.** | Asumsi: opname absolut | Uji kirim satu adjustment dengan kedua field; bandingkan efek stok. (research-kledo.md:212) |
| R8 | **Modul Material bisa mati per perusahaan (404).** | — | Cek ketersediaan modul di akun user sebelum menjadikannya fallback. (research-kledo.md:245) |
| R9 | **Filter scope gudang bocor ke UI/memori** = kelas bug IDOR. Preseden nyata di repo. | Asumsi: enak ditambal nanti | Wajib `where warehouse_id in scope` di server untuk SETIAP query. Review tiap route. (research-wms.md:101-107,207) |
| R10 | **Double-apply konfirmasi** (gap idempotensi yang sudah ada). | — | Idempotency key per dokumen + test. (research-wms.md:180,206) |
| R11 | **42 titik `is_online_product` + 56 titik `stok_gudang_online`** -> refactor besar, test/e2e rapuh. | Asumsi: bisa bertahap | Index dulu; e2e yang mengunci COUNT dijalankan lebih dulu; pecah interface DataSource per domain. (impact-map-v4.md:13-14,174,182-189) |
| R12 | **Index komposit belum terverifikasi** (`opname_drafts`/`sync_stok_drafts` `status`+`created_at`). Butuh `(gudang_id, status, created_at)` & `(gudang_id, is_online_product)`. | Asumsi: sudah ter-deploy | Verifikasi `firebase deploy --only firestore:indexes`; pola bug commit `097b43c`. (impact-map-v4.md:224,226) |
| R13 | **Tidak ada virtual warehouse "Transit" bawaan Kledo** (tidak terdokumentasi). | Asumsi: bisa pakai gudang biasa sebagai transit | Konfirmasi user menandai gudang transit; uji apakah stok transit muncul di laporan. (research-wms.md:117) |
| R14 | **Cache basi saat Kledo down** ditampilkan seolah terkini. | — | Tampilkan timestamp sync; tandai basi; jangan optimistis. (research-wms.md:191) |
| R15 | **Konflik SoT Firestore vs Kledo** (README.md:140 bilang Firestore menang; v4 bilang Kledo menang). Jalur sync Firestore<->Sheets lama bisa menimpa hasil Kledo. | Asumsi: dua jalur bisa hidup berdampingan | Putuskan nasib syncStokDuaArah/syncMasterData untuk v4; bila tetap jalan, jadikan Sheets turunan Kledo (satu arah). Konflik ini **harus diselesaikan sebelum implementasi**. |
| R16 | **Firestore rules koleksi baru** belum ada. Risiko: koleksi baru default tertutup (fitur gagal) atau salah buka (bocor lintas gudang). | Asumsi: aman dengan pola lama | Tulis rules per koleksi baru; test negatif lintas-scope. (impact-map-v4.md:81-85) |
| R17 | **Backfill data lama:** produk/user existing tidak punya lokasi_gudang; stok existing hanya stok_gudang_online tunggal. | Asumsi: bisa diisi nanti | Skrip migrasi: petakan is_online_product=true -> gudang ONLINE (atau sesuai Q3); user existing -> scope awal ditetapkan owner. Uji di data mock dulu. |
| R18 | **Timezone & stok negatif.** Kledo 	rans_date (research-kledo.md:188) vs WIB; Kledo tolak stok tidak cukup (research-wms.md:202 F1). | Asumsi: one-liners | Simpan UTC, render Asia/Jakarta (research-wms.md:204 F3); enforcement stok cukup di server, jangan andalkan UI. |
| R19 | **Biaya baca Firestore dari polling** (cache per gudang x produk) pada kuota user. | Asumsi: muat | Ukur; pertimbangkan batch read + hanya produk ber-flag online/reorder (berkait Q1). |")

---

## 9. Pertanyaan Terbuka untuk User (maks 6)

**Q1 — Cakupan cache stok (tidak bisa diputuskan dari riset).**
Cache `kledo_cache` berisi **semua gudang x 1107 produk** (lengkap, biaya baca Firestore lebih besar) atau **hanya produk yang punya `reorder_point` atau flag online** (lebih murah, tapi tidak bisa lihat stok semua produk di dashboard)?
-> Butuh angka kuota baca Firestore & Vercel Hobby yang user tahu.

**Q2 — Prioritas permintaan: target "Kirim ke".**
K4 kunci tujuan = user ber-flag gudang + gudang terdaftar. Kalau user minta "Kirim ke User (jabatan)" tapi user itu ber-flag **dua** gudang, barang masuk gudang mana? Pilih gudang default, atau minta penerima menetapkan saat terima?
-> Butuh keputusan alur manusia.

**Q3 — `is_online_product` per gudang atau tetap global?**
Item 6 minta filter default online. Apakah "online" tetap flag global produk (seperti sekarang), atau "Online" seharusnya jadi **gudang tersendiri** (stok online = gudang ONLINE)? Riset WMS memperlakukan gudang sebagai lokasi bertingkat/entity (research-wms.md:23), bukan flag tampilan; ini inferensi penulis, bukan kutipan langsung.
-> Mengubah skema produk vs memperluas model gudang; hanya user yang tahu operasi toko.

**Q4 — Gudang transit.**
Kledo tidak menunjukkan punya virtual warehouse "Transit" bawaan. Boleh WMS memakai satu gudang Kledo biasa sebagai lokasi transit (harus user buat & tandai), atau user punya cara lain melacak barang in-transit?
-> **Fakta ini bisa diuji runtime** (R13); yang tetap butuh user = keputusan operasional: siapa nama/penanggung jawab gudang transit itu.

**Q5 — Ambang auto-approve selisih opname.**
Riset menyarankan selisih < threshold auto-approve, >= threshold owner (research-wms.md:160). Threshold berupa persentase nilai rak, nilai absolut Rupiah, atau jumlah unit? Berapa angkanya?

**Q6 — Eksekusi Kledo saat blokir dokumentasi.**
Bila network capture body POST transfer gagal, user bersedia jalan dengan **fallback Material Request/Issue + gudang tujuan di Firestore** untuk v4 (dengan risiko gudang tujuan tidak tercatat di Kledo), atau menunggu sampai body transfer ditemukan?

---

## 10. MVP Scope (usulan)

**MVP = potongan v4 yang memberi nilai walau dokumentasi transfer belum terpecahkan.**

### Wajib di MVP

1. **Master gudang** (S1) — listing/tambah/edit gudang, configurable, masuk filter (item 5, 9). Baca dari Kledo `/finance/warehouses` + `include_racks=1` (research-kledo.md:17-19).
2. **RBAC 3 dimensi** (S3, S4) — `level_permission` tetap + `jabatan` bebas + `lokasi_gudang[]`, **enforced server-side** (item 7, 8). Risiko R9.
> **Catatan fungsi Vercel (K2):** saat ini 11 function (10 route + webhook, impact-map-v4.md:11). MVP menambah route baru (permintaan-kirim, gudang, opname, sinkron Kledo) -> melampaui kebijakan internal 12. Kebijakan ini **dikunci akan direvisi** (K2); jangan jadikan penghalang, tapi hitung ulang jumlah route nyata saat PRD/plan.
3. **Flag lokasi gudang per item & per user** (S2, S3) (item 4, 8).
4. **Stok per gudang read-only** (S5, S6) — baca dari Kledo + cache; filter online default on (item 6). Bergantung R1.
5. **Permintaan antar-gudang dasar** (S7, S8) — tombol minta, "Kirim ke" Gudang/User multiple (item 1, 10). Eksekusi Kledo sesuai hasil R2.
6. **Approval + in-transit + partial receive** (S9, S10, S11) — inti nilai jembatan.
7. **Opname dasar** (S12) — kunci manual, dokumen `stockAdjustments`, approval selisih (item 2).
8. **Auth PAT Kledo + polling harian + cache** (S14, S19) dasar.
9. **Idempotency key** (S15) di semua konfirmasi baru.

### Boleh ditunda ke akhir v4 / v5

- Webhook Kledo (blocker topik).
- S17 kartu stok view, S18 reorder point per gudang (bisa menyusul setelah cache stabil).
- Frozen kompleks, ABC cycle count, barcode (v5).

### Prasyarat keras MVP (blocker, harus selesai lebih dulu)

- **R1** verifikasi shape response stok Kledo.
- **R2** verifikasi/penangkapan body POST transfer (atau keputusan fallback Q6).
- **R12** verifikasi index komposit.
- **R11** urutan refactor: index -> e2e COUNT -> perubahan bertahap.

---

## 11. Ringkasan untuk PRD

Dokumen ini menjawab: **masalah** (1), **user & peran** (2), **scope in/out** (3), **keputusan stok** (4, rekomendasi: Kledo + cache), **alur permintaan** (5, in-transit + mitigasi blocker transfer), **alur opname** (6), **strategi integrasi** (7, polling-first, webhook eksperimental), **risiko** (8), **pertanyaan terbuka** (9), **MVP** (10).

Yang perlu dipindahkan ke PRD:
- Problem & visi (1)
- Persona + model RBAC 3 dimensi (2)
- Requirement fungsional dari 3 dan 5/6 sebagai user flow bertingkat
- Non-goals dari 3.2
- Success metrics: lihat 12
- Acceptance criteria per fitur: butuh PRD-specialist
- Open questions 9 (Q1-Q6) dipindahkan apa adanya.

## 12. Success Metrics (usulan, belum divalidasi user)

Metadata kuantitatif di bawah adalah **usulan** — angka target harus disetujui user.

| Metrik | Kenapa | Catatan |
|---|---|---|
| % permintaan antar-gudang yang lewat WMS (vs chat manual) | Ukur adopsi jembatan | Baseline belum ada — survei manual dulu |
| Waktu siklus permintaan (minta -> disetujui -> diterima) | Ukur efisiensi | Mulai catat dari v4 |
| Jumlah discrepancy opname (WMS cache vs Kledo) per bulan | Ukur akurasi | Turun = sehat (research-wms.md:193) |
| Jumlah admin tanpa akun Kledo yang aktif | Ukur tujuan K5/visi | Target: >0 (syarat jembatan berguna) |
| Zero IDOR: query gudang lintas-scope = 0 | Ukur keamanan | Uji negatif wajib (R9) |
| Sync Kledo terakhir (jam) | Ukur kesegaran cache | < 24 jam |

---

## 13. Catatan Metodologi

- Dokumen ini **bukan PRD** dan **bukan rencana implementasi**. Tidak ada perubahan file source.
- Semua klaim riset bersitasi. Klaim yang tidak ada dasarnya ditandai terbuka, tidak dikarang.
- Endpoint Kledo yang tidak terdokumentasi **tidak** diisi dengan asumsi diam-diam; semuanya masuk 8.
- Bagian `docs/dashboard-prd*.md` tidak dibaca (dokumen ini hanya merujuk jika riset lain sudah menyitirnya).

---

## 14. Di Luar Dokumen Ini

- Penulisan PRD final -> tugas `prd-specialist`.
- Review adversarial -> `prd-reviewer`.
- Verifikasi runtime Kledo (R1, R2, R3, R4, R7) -> butuh akses akun Kledo user.





