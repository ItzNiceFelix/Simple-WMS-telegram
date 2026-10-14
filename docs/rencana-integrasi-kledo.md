# Rencana Integrasi Kledo → Simple-WMS (Sinkronisasi Stok & Gudang)

Status: RENCANA (belum ada kode). Tanggal: 2026-10-14.
Sumber: `kledo-api-reference.md` (54.052 baris), `docs/arsip-v4/research-kledo.md` (426 baris),
skema D1 aktual (`migrations/0001`-`0024`), data produksi live.

---

## 0. Ringkasan keputusan

Fungsi: **tarik satu arah dari Kledo ke D1** (Kledo = sumber kebenaran master produk, gudang, stok, HPP).
Sistem repo TIDAK menulis balik ke Kledo pada fase ini.

Yang disinkronkan (5, sesuai permintaan): **list produk, stok, SKU, HPP, list gudang, stok per gudang**.

Alasan tarik-satu-arah: (a) WMS ini punya ledger sendiri (`stock_moves` immutable) dan alur transfer/opname
ber-approval; kalau WMS menulis balik, dua penulis memperebutkan angka stok yang sama → konflik tak terdeteksi.
(b) `/finance/products/stocks` memberi seluruh matriks produk × gudang dalam satu request per batch —
cukup untuk mencerminkan Kledo tanpa menulis. (c) Menulis balik ke Kledo butuh body POST yang
**tidak terdokumentasi** (research-kledo.md blocker #2), jadi memang belum bisa.

Pemetaan konsep:

| Kledo | D1 | Catatan |
|---|---|---|
| Product.id (integer) | `products.sku`(?) | **BLOKER B1** — lihat §5 |
| Product.code (SKU) | `products.sku` | kandidat kuat |
| Product.name | `products.nama_accurate` + `nama_accurate_normalized` | normalisasi sudah ada |
| Product.hpp | `products.hpp` | INTEGER rupiah |
| Warehouse.id | `warehouses.id` | **bukti kuat sudah cocok** — lihat §1 |
| Warehouse.name | `warehouses.nama` | |
| Warehouse.code | `warehouses.code` | |
| qty per gudang | `stock_by_bin.qty` | |

---

## 1. Bukti yang sudah ada di produksi (bukan asumsi)

Fakta dari D1 live:

- `warehouses`: `ONLINE`/Gudang Online, `GMV0LJYS5`/Gudang D12, `GMV0LK4BG`/Gudang D19.
  Dua ID terakhir berpola alfanumerik 9 karakter — **format ID Kledo**, bukan ID buatan sendiri.
  `ONLINE` jelas gudang virtual milik WMS (is_online=1), bukan dari Kledo.
  → Artinya gudang Kledo **sudah pernah** dimasukkan (manual atau impor lama), dan `warehouses.id`
  kemungkinan besar **sudah** = `Warehouse.id` Kledo. Ini harus dipastikan lewat satu panggilan API (§7 T1),
  bukan diasumsikan.
- `products`: 482 baris, `sku` contoh `1203`, `100146` — numerik 3-6 digit, konsisten dengan SKU/`code` Kledo.
- `stock_by_bin`: 734 baris (482 produk × ~1,5 gudang) — belum penuh 3 gudang, jadi stok belum lengkap.
- `stock_moves`: 1008 baris — ledger internal WMS.

Fakta dari sistem:

- **Tidak ada satu baris kode pun yang menyebut Kledo** (grep seluruh `.ts/.tsx/.sql/.json/.mjs` kosong).
- **Tidak ada kredensial Kledo**: `wrangler secret list` hanya AI_KEY_ENCRYPTION_KEY, SUPER_ADMIN_ID,
  TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET.
- `kledo-api-reference.md` **tidak memuat satu pun contoh respons JSON**; semua respons hanya
  "200: successful operation". **Maka bentuk persis respons wajib diverifikasi live sebelum menulis kode final.**

---

## 2. Endpoint Kledo terpilih

| # | Kebutuhan | Endpoint | Param kunci |
|---|---|---|---|
| E1 | List gudang | `GET /finance/warehouses` | `include_archive=1`, `include_racks=0`, `exclude_qty=1` |
| E2 | List produk + SKU + HPP | `GET /finance/products` | `per_page=100`, `show_columns=id,name,code,hpp,unit_id,category`, `include_archive=1`, `include_total=1` |
| E3 | **Stok produk × gudang (BATCH)** | `GET /finance/products/stocks` | `product_ids=1,2,3` (**wajib**), `warehouse_ids=1,2,3` |
| E4 | Stok alternatif per-gudang penuh | `GET /reportings/warehouseStock` | `date` (**wajib**), `warehouse_ids`, `hide_zero_qty=0`, `per_page` |
| E5 | HPP cadangan | `GET /finance/products/last_buy_prices` | `ids=1,2,3` |

Kenapa E3 sebagai jalur utama: satu request melayani N produk × M gudang. Menghindari pola
1-request-per-produk yang akan jadi 482 request per siklus. Batas panjang `product_ids` **tidak
didokumentasikan** → chunking wajib (§4.3).

**Catatan `show_columns` E2**: referensi memberi contoh valid kolom
`id,name,photo,code,description,category,base_price,price,qty,hpp,is_track,unit_id`.
`include_warehouse_qty=1` ada sebagai param terpisah — artinya qty per gudang TIDAK dijamin ada di
`show_columns`. **Jangan** bergantung pada E2 untuk stok; pakai E3. E2 hanya untuk master.

---

## 3. Arsitektur yang dipakai ulang (tanpa abstraksi baru)

Pola yang SUDAH ada dan akan dipatuhi:

1. **Satu pintu tulis**: klien tidak pernah menyentuh D1; semua lewat route server atau handler.
   Integrasi ini menambah **route admin** `app/api/kledo/sinkron/route.ts` (pemicu manual + cron),
   bukan jalur tulis baru.
2. **Kredensial terenkripsi**: pola `ai_kredensial` (`migrations/0020_ai.sql:7`) — `ciphertext`/`iv`/`tag`
   base64 + kolom `ujung` untuk mask + `uji_at` untuk waktu uji terakhir. Token Kledo memakai pola yang sama.
3. **Ledger immutable**: `stock_moves` dengan `jenis` ber-CHECK. Sinkronisasi menambah nilai jenis baru
   `sync_kledo` lewat migrasi (ALTER CHECK tidak didukung SQLite → lihat §4.4).
4. **Batch import + pelaporan galat**: pola `import_batches`/`import_errors`
   (`migrations/0005_fase2_import.sql:2,17`) dipakai ulang untuk run sinkronisasi — supaya hasil
   ("berapa produk/stok masuk, mana yang gagal") bisa dilihat dari dashboard, bukan hanya log.
5. **Uji**: repo memakai `vitest` dengan `*.test.ts` di sebelah modul (`lib/d1/*.test.ts`) dan
   mock D1 in-memory. Sinkronisasi diuji dengan respons Kledo yang direkam (§6).

---

## 4. Rancangan teknis

### 4.1 Skema baru (satu migrasi, `0025_kledo.sql`)

```
-- Kredensial Kledo: pola sama dengan ai_kredensial (enkripsi AES-GCM, kunci dari secret).
CREATE TABLE kledo_kredensial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL DEFAULT '',
  subdomain TEXT NOT NULL,          -- {subdomain}.api.kledo.com
  ciphertext TEXT NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL,
  ujung TEXT NOT NULL DEFAULT '',   -- mask 4 karakter terakhir
  aktif INTEGER NOT NULL DEFAULT 1,
  dibuat_at INTEGER NOT NULL DEFAULT (unixepoch()),
  dibuat_oleh TEXT,
  uji_at INTEGER, uji_ok INTEGER,
  UNIQUE(subdomain)
);

-- Pemetaan ID Kledo → kunci D1 (WAJIB: sumber tunggal kebenaran pemetaan).
CREATE TABLE kledo_map (
  jenis TEXT NOT NULL CHECK (jenis IN ('produk','gudang')),
  kledo_id TEXT NOT NULL,
  lokal_id TEXT NOT NULL,           -- products.sku atau warehouses.id
  nama_snapshot TEXT,
  terakhir_dilihat INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (jenis, kledo_id)
);
CREATE INDEX idx_kledo_map_lokal ON kledo_map(lokal_id);

-- Riwayat sinkronisasi (memakai pola import_batches, tabel sendiri agar tidak mengganggu Excel).
CREATE TABLE kledo_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mulai_at INTEGER NOT NULL DEFAULT (unixepoch()),
  selesai_at INTEGER,
  jenis TEXT NOT NULL,              -- gudang|produk|stok|semua
  status TEXT NOT NULL DEFAULT 'jalan' CHECK (status IN ('jalan','sukses','sebagian','gagal')),
  produk_baru INTEGER DEFAULT 0, produk_ubah INTEGER DEFAULT 0,
  gudang_baru INTEGER DEFAULT 0, gudang_ubah INTEGER DEFAULT 0,
  stok_baris INTEGER DEFAULT 0, peringatan INTEGER DEFAULT 0,
  pesan TEXT, oleh TEXT
);
CREATE TABLE kledo_sync_galat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id INTEGER NOT NULL REFERENCES kledo_sync(id) ON DELETE CASCADE,
  bagian TEXT NOT NULL,             -- produk|gudang|stok
  ref TEXT,                         -- kledo_id atau sku
  pesan TEXT NOT NULL
);

-- Kolom penanda pada tabel yang sudah ada (aditif, aman).
ALTER TABLE products ADD COLUMN kledo_updated_at INTEGER;  -- kapan Kledo terakhir mengubah
ALTER TABLE warehouses ADD COLUMN kledo_id TEXT;           -- eksplisit, jangan andalkan id saja
CREATE INDEX idx_products_kledo ON products(kledo_updated_at);
```

**Nol perubahan pada `stock_moves`** — lihat §4.4 (sudah punya `sync_confirmed` + `sync` + `catatan`).

**Catatan `warehouses.kledo_id`**: meski `warehouses.id` mungkin sudah = ID Kledo, kolom eksplisit
memisahkan "ID kita" dari "ID Kledo" sehingga gudang virtual (`ONLINE`) tidak pernah tertukar.

### 4.2 Alur sinkronisasi (empat tahap, urut, satu arah)

```
TAHAP 1  GUDANG    GET /finance/warehouses  → upsert warehouses (kode+nama) → isi kledo_map
TAHAP 2  PRODUK    GET /finance/products    → upsert products (nama, hpp)    → isi kledo_map
TAHAP 3  STOK      GET /finance/products/stocks (batch product_ids × all warehouse_ids)
                                            → UPSERT stock_by_bin.qty
TAHAP 4  LAPORAN   tulis kledo_sync + kledo_sync_galat selesai
```

Urutan wajib: stok butuh kedua sisi sudah punya ID.

**Aturan penulisan yang mengikat (dikonfirmasi user + temuan live):**

- **Kledo TIDAK PERNAH ditulis.** Hanya GET. Tidak ada POST/PUT/DELETE ke Kledo dari sistem ini,
  dalam keadaan apa pun. Ini batas mutlak.
- **Produk yang hilang dari Kledo TIDAK dihapus.** Ditandai saja (`include_archive=1` sudah ditarik;
  produk Kledo yang diarsipkan tetap masuk dengan penanda). Alasan: `stock_moves` mereferensikan
  `products(sku)`; menghapus produk akan merusak ledger. Penghapusan harus keputusan manusia.
- **`products.hpp` ditimpa HANYA bila Kledo memberi angka ≥ 1** (setelah `Math.round`).
  Bukti: ada produk berstok 774 dengan `avg_base_price=0`, dan 2 produk bernilai `<1` yang
  round-nya jadi 0. HPP D1 yang sudah terisi **tidak boleh** rusak karena Kledo kosong.
  Fallback berurutan: `avg_base_price` → bila 0/absen coba `last_buy_prices` → bila keduanya
  kosong, **pertahankan HPP D1**.
- **Gudang baru ditambahkan**, gudang yang tidak ada di Kledo (mis. `ONLINE`) tidak disentuh.
  Pemetaan lewat `nama` (bukan ID), `code` sebagai cadangan.
- **`stock_by_bin.qty` ditimpa penuh** (Kledo = kebenaran stok) **hanya untuk gudang yang dipetakan**.
  Perubahan TIDAK ditulis ke `stock_moves` sebagai penyesuaian per baris — kalau ditulis, ratusan baris
  × tiap siklus akan membanjiri ledger. Yang ditulis ke ledger hanya **ringkasan drift** saat `qty`
  berbeda dari nilai sebelumnya (jenis `sync_confirmed`, `source='sync'`, `qty_sistem`=nilai D1 sebelum,
  `qty_fisik`=nilai Kledo, `selisih`, `catatan` memuat `[kledo]`).
- **`is_online_product` (keputusan WMS) TIDAK disentuh** oleh sinkronisasi. Itu milik WMS.
- **SKU bentrok** (dua `id` Kledo, satu `code`): dilaporkan ke `kledo_sync_galat`, D1 tidak ditimpa.

### 4.3 Chunking & batas (angka hasil pengukuran, bukan tebakan)

- `per_page` = **100**. Terukur: minta 100 → dapat 100; minta 200/500 → **tetap 100**. Jadi 100 adalah
  plafon keras, dan meminta lebih besar hanya menyia-nyiakan request.
- `product_ids` dipotong **200 per request**. Terukur: x50/x100/x200 semua 200 OK. Ambil 200 (bukan
  50) karena 1172 produk Kledo → hanya **6 request** untuk seluruh stok, bukan 24.
- Paginasi produk: `per_page=100` → 1172 produk = **12 halaman**. Pagar aman maks **200 halaman**
  (20.000 produk) sebelum berhenti dengan peringatan.
- Deteksi akhir: `current_page >= last_page`, atau `next_page_url` null. Dipakai keduanya (salah satu
  saja bisa meleset bila Kledo mengubah bentuk).
- Timeout per request 30 detik; maks 3 percobaan ulang, jeda 1s/2s/4s untuk 5xx dan 429.
  Rate limit tidak pernah muncul di ~30 request pengukuran, tapi tetap ditangani (defensif).
- Jeda 200 ms antar chunk untuk sopan-santun; total siklus 12 + 6 = 18 request ≈ beberapa detik.
- Sinkronisasi dijalankan dalam satu panggilan (bukan `waitUntil`), karena totalnya cepat. Durasi tetap
  dicatat di `kledo_sync` sebagai pengaman bila data tumbuh.

### 4.4 `stock_moves.jenis` — TIDAK perlu rebuild (terverifikasi)

Dicek langsung ke D1 produksi (`SELECT sql FROM sqlite_master WHERE name='stock_moves'`):

```
CHECK jenis: 'keluar_resi','opname','restock','koreksi_manual','sync_confirmed','OPENING',
             'TRANSFER_IN','TRANSFER_OUT','jual_mp','retur_mp','kirim_advance'
kolom `penanda` ada : true
kolom `catatan` ada : true
source CHECK: 'screenshot','manual_chat','manual_chat_batch','manual_chat_produk_baru',
              'manual_chat_batch_produk_baru','sync','web_dashboard'
```

Ternyata sudah tersedia **semua yang dibutuhkan tanpa mengubah skema**:

- `jenis = 'sync_confirmed'` — nilai yang MEMANG disediakan untuk sinkronisasi eksternal. Lebih tepat
  daripada `koreksi_manual` (yang berarti koreksi oleh manusia).
- `source = 'sync'` — sudah ada dan tepat.
- `catatan` untuk penanda asal (`[kledo]`).
- Kolom `qty_sistem`, `qty_fisik`, `selisih` sudah ada untuk merekam drift.

**Keputusan: nol perubahan pada `stock_moves`.** Rebuild tabel 1008 baris yang berisi ledger
immutable dibatalkan — risikonya (kolom terlewat saat `INSERT SELECT`, `FOREIGN KEY` tak terlihat)
tidak sebanding dengan manfaat sekecil apa pun. Sinkronisasi menulis
`jenis='sync_confirmed'`, `source='sync'`, `catatan='[kledo] ...'`.

### 4.5 Antarmuka yang dipakai ulang (bukan baru)

- `lib/d1/gudang.ts` — sudah punya operasi gudang; tambah `upsertGudangKledo()` di file yang sama,
  bukan file baru.
- `lib/d1/db.ts` — akses D1 dan env.
- Kredensial: tiru `lib/d1/aiKredensial.ts` (enkripsi/dekripsi + mask + uji).
- Modul Kledo baru: `lib/kledo/klien.ts` (HTTP + retry + paginasi) dan `lib/kledo/sinkron.ts` (4 tahap).
  Dua file. Klien HTTP dibuat sendiri karena tidak ada dependency yang dipasang dan `fetch` sudah cukup.

### 4.6 Pemicu

- **Manual**: tombol di dashboard (route `POST /api/kledo/sinkron`), role owner saja, memakai `sesiRoute`
  yang sudah ada.
- **Terjadwal**: cron Cloudflare (`[triggers]` di `wrangler.jsonc`) memanggil endpoint internal dengan
  rahasia bersama. **Belum diputuskan frekuensinya** — lihat §8 pertanyaan.
- Sinkronisasi bersamaan dicegah: `kledo_sync` dicek dulu — bila ada baris `status='jalan'` yang
  lebih muda dari 30 menit, pemicu baru ditolak dengan pesan jelas.

---

## 5. Bloker dan cara menutupnya

**SEMUA BLOKER SUDAH DITUTUP lewat penyelidikan live (2026-10-14).**
Fixture respons nyata tersimpan di `lib/kledo/fixture/kledo.json` (tanpa token).

| # | Bloker | Status | Temuan |
|---|---|---|---|
| **B1** | Tidak ada contoh respons JSON | **TERTUTUP** | Bentuk: `{success, data, message, time}`. List berpaginasi: `data.data[]` + `data.current_page/last_page/per_page/total`. |
| **B2** | Tidak ada kredensial | **TERTUTUP** | Token PAT + subdomain `cv-hanaa-jaya` diterima; 200 di semua endpoint. |
| **B3** | `sku` = `code` atau `id`? | **TERTUTUP — `code`** | **482/482 cocok** dengan `code`; hanya 10/482 cocok dengan `id`. |
| **B4** | Batas paginasi/chunk | **TERTUTUP** | `per_page` **dipatok 100** (minta 500 tetap 100). `product_ids` tahan 200+. |
| **B5** | Rate limit | **TERTUTUP sebagian** | Tidak ada 429 selama ~30 request berturut. Tetap pasang retry defensif. |
| **B6** | Stocks butuh `product_ids` | **TERTUTUP** | Ambil ID dari TAHAP 2, potong 200 (terbukti aman). |

### Temuan live yang mengubah rencana

**1. Pemetaan gudang TIDAK lewat ID.**

```
Kledo:  id=2 "Gudang D12" code=D12   id=3 "Gudang D19" code=D19   id=4 "Dukuh Kupang" code=DK-KPG
D1:     id='GMV0LJYS5' nama='Gudang D12'   id='GMV0LK4BG' nama='Gudang D19'   (+ 'ONLINE' virtual)
```

`warehouses.id` D1 (9 karakter alfanumerik) **bukan** ID Kledo. Pemetaan **wajib lewat `nama`**,
dengan `code` sebagai cadangan. Akibatnya:

- **Gudang ke-4 "Dukuh Kupang" (Kledo id=4, code=DK-KPG) BELUM ADA di D1** → harus ditambahkan,
  persis seperti yang diminta user.
- `warehouses.id` untuk gudang baru dibuat WMS (pola ID-nya sendiri), `kledo_id` menyimpan `4`.
- `ONLINE` tidak pernah dipetakan dan tidak pernah disentuh.

**2. Bentuk respons E3 (stok) — sempurna untuk kebutuhan.**

```json
{"success":true,"data":[
  {"id":"3","qty":17,"stocks":{
     "2":{"warehouse_id":2,"qty":17,"avg_price":13000,"product_val":221000},
     "3":{"warehouse_id":3,"qty":0,...},"4":{"warehouse_id":4,"qty":0,...}}}]}
```

Kunci `stocks` = `warehouse_id` Kledo, langsung dipetakan lewat `kledo_map`.

**3. HPP ada di DUA tempat, dan hampir selalu sama.**

- `Product.avg_base_price` (tingkat produk) ← **dipakai**
- `stocks[wh].avg_price` (tingkat gudang) ← di 40 produk berstok, selisih hanya float
  (`33262.6666667` vs `33262.666666667`) → **tidak dipakai**, tidak ada nilai tambah.

**4. `avg_base_price` bisa DESIMAL dan bisa SANGAT KECIL.**

- 61 produk non-integer >1 → `Math.round` (5620.84 → 5621).
- 2 produk <1 (`0.0006892`, `0.0009145`) → **round jadi 0** → **wajib kena aturan "jangan timpa dengan 0"**.
- **Ada produk stok 774 tapi HPP 0** (Kaca Cetakan 7/8 Lubang, code 1620). Aturan user tepat: HPP D1
  yang sudah terisi TIDAK boleh ditimpa dengan 0 dari Kledo.

**5. `last_buy_prices` untuk produk HPP 0 mengembalikan KOSONG**
(`{"success":true,"data":[],"message":"Produk tidak ditemukan"}`). Jadi fallback ini **bukan penyelamat**
untuk produk tanpa pembelian; hasilnya tetap HPP 0 → tetap jangan timpa.

**6. Profil produk Kledo (1172 produk):** `variant_type_id` semua 0 (reguler), `is_track` semua true,
`bundle_type_id` semua 0, `is_archive` semua 0, kategori semua terisi. Tidak ada varian/bundle/serial.
Skala: **1172 produk Kledo vs 482 di D1 → 690 produk baru**, dan paginasi `per_page=100` → **12 halaman**.

### Jawaban atas pertanyaan SKU bentrok (dari user)

Diperiksa langsung ke data: **`code` duplikat di Kledo = 0**, **`code` kosong = 0**.
Karena `sku` D1 = `code` Kledo dan `products.sku` adalah PRIMARY KEY, tabrakan antar-ID Kledo
**tidak mungkin terjadi secara struktur**. Sisa kasus teoretis: `code` sama tapi Kledo beda `id`.
Penanganannya tetap disiapkan (murah): `kledo_map` PK = (`jenis`, `kledo_id`), sehingga dua `id`
dengan satu `code` akan menghasilkan dua baris peta yang menunjuk `lokal_id` yang sama →
**dilaporkan ke `kledo_sync_galat`, dan nilai D1 TIDAK ditimpa otomatis.** Keputusan manusia.

---

## 6. Strategi verifikasi

1. **Unit (vitest, pola repo)**: `klien.ts` diuji dengan `fetch` palsu — paginasi, retry 429/5xx, timeout,
   pemotongan 50. `sinkron.ts` diuji dengan respons Kledo **yang direkam** (fixture) dan mock D1
   in-memory: produk baru masuk, produk ada ter-update, HPP 0 tidak menimpa, produk hilang tidak dihapus,
   qty stok ter-update, drift tercatat ke ledger.
2. **Uji nyata terkendali**: jalankan sinkron ke **D1 lokal** (`--local`, bukan `--remote`) lebih dulu,
   bandingkan 20 produk acak terhadap UI Kledo secara mata. Baru ke produksi.
3. **Verifikasi silang**: setelah sinkron, bandingkan total stok dari E3 vs E4 untuk 20 produk acak.
   Beda = ada kesalahan pemetaan gudang.
4. **Bukti akhir**: jalankan ulang sinkron dua kali berturut-turut; siklus kedua harus melaporkan
   **0 produk baru, 0 perubahan** (idempoten). Ini bukti terkuat bahwa sinkronisasi benar.
5. **Smoke di produksi**: stok satu produk yang diketahui diubah manual di Kledo, sinkron dijalankan,
   `stock_by_bin` harus berubah ke angka baru — dan `kledo_sync` mencatat 1 perubahan.

---

## 7. Urutan pengerjaan

T1 **SUDAH SELESAI** (penyelidikan live). Sisa kerja:

| Tahap | Kerja | Bukti selesai |
|---|---|---|
| ~~**T1**~~ | ~~Panggil live 5 endpoint~~ **SELESAI** | `lib/kledo/fixture/kledo.json`; B1/B3/B4/B6 terjawab |
| **T2** | Migrasi `0026_kledo.sql` (§4.1, tanpa menyentuh `stock_moves`) | `wrangler d1 migrations apply --local` bersih; tabel baru ada |
| **T3** | `lib/kledo/klien.ts` + uji | Uji paginasi/retry/timeout/chunk-200 hijau |
| **T4** | `lib/kledo/sinkron.ts` + uji (fixture) | Uji 6 skenario hijau, termasuk "HPP 0 tidak menimpa" |
| **T5** | Kredensial Kledo (enkripsi) + kartu UI setelan di Pengaturan | Token tersimpan bermask; tombol "Uji koneksi" memanggil `/finance/warehouses` |
| **T6** | Route `POST /api/kledo/sinkron` + tombol "Sinkron sekarang" + kartu status | Sinkron manual jalan dari UI, `kledo_sync` terisi |
| **T7** | Uji D1 lokal → produksi; verifikasi silang + idempoten | Siklus kedua: 0 baru / 0 ubah |
| **T8** | Cron **harian sore** (mis. 16:00 WIB) | `kledo_sync` terisi otomatis tiap sore |

T1 paling awal bukan tanpa alasan: **menulis kode sebelum T1 = menebak nama field**, dan tebakan itu
terbukti akan salah (HPP ternyata `avg_base_price`, bukan `hpp`; `sku` ternyata `code`, bukan `id`).

---

## 8. Keputusan user (SUDAH DIJAWAB, 2026-10-14)

1. **Kledo hanya boleh dibaca** — tidak ada penulisan ke Kledo, dalam keadaan apa pun. Batas mutlak.
2. **Token & subdomain** — sudah diberikan (PAT + `cv-hanaa-jaya`). Tetap dibangun **UI setelan** agar
   token bisa diganti sendiri tanpa deploy.
3. **Frekuensi** — **tiap sore** (satu kali/hari) **DAN** tombol "Sinkron sekarang" di UI.
4. **SKU bentrok** — dijaga: dilaporkan ke `kledo_sync_galat`, D1 tidak ditimpa (lihat §5, terbukti
   0 duplikat di data nyata, jadi ini jaring pengaman, bukan masalah aktif).
5. **Gudang `ONLINE`** — tetap virtual, tidak pernah dipetakan/disentuh. **Gudang lain WAJIB sinkron**,
   dan **gudang yang ada di Kledo tapi belum ada di D1 harus ditambahkan** (terbukti: "Dukuh Kupang"
   id=4 belum ada di D1).
6. **HPP** — pakai `avg_base_price`. Boleh jatuh ke `last_buy_prices` bila kosong. **Bila keduanya
   kosong, HPP D1 yang sudah terisi TIDAK boleh ikut menjadi kosong/0.**

Pertanyaan terbuka tunggal: bentuk UI setelan (halaman terpisah vs kartu di Pengaturan) —
**rekomendasi: kartu baru di halaman Pengaturan yang sudah ada**, mengikuti pola setelan AI
(kredensial bermask + tombol "Uji koneksi"), karena tidak perlu halaman baru.

---

## 9. Yang SENGAJA tidak dikerjakan

- **Menulis balik ke Kledo** (transfer/opname dari WMS → Kledo). Dilarang user (poin 1 di atas),
  dan memang body POST-nya tidak terdokumentasi.
- **Webhook Kledo** sebagai pemicu. Dokumen nyaris kosong: ada `regenerateSecret`/`setup`/`verify`/`test`,
  tapi **tanpa daftar topik, tanpa bentuk payload, tanpa skema tanda tangan**.
  Karena sinkron harian + tombol manual sudah memenuhi kebutuhan, webhook tidak sebanding risikonya.
- **Rak (`racks`) sebagai gudang.** Rak = child warehouse (maks 50/gudang); memetakannya ke `warehouses`
  akan meledakkan jumlah gudang. Tidak diminta.
- **Serial number, expiry, bundle, varian.** Tidak diminta; dan profil Kledo membuktikan tak ada
  satu pun dari itu (`variant_type_id`=0, `bundle_type_id`=0, `is_archive`=0 untuk semua 1172 produk).
- **Menyimpan riwayat stok Kledo per hari** (`trans_date`). Hanya kondisi terkini.
- **Grup kategori / kategori produk.** Kledo punya `category_ids`, D1 punya `kategori` — bentuknya
  berbeda (id vs jalur teks seperti "Elektronik > Peralatan Listrik Kecil"). Tidak diminta, dan
  pemetaannya perlu keputusan terpisah. `kategori` D1 dibiarkan apa adanya.
- **Stok per rak (`racks`).** `/finance/warehouses?include_racks=1` memberi rak; karena rak tidak
  dipetakan, stok rak tidak ditarik. **Catatan penting:** qty induk dari Kledo sudah roll-up termasuk
  rak (tertulis di referensi baris 31896), jadi angka gudang tetap benar tanpa menarik rak.
