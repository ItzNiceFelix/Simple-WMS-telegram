# Rencana: Analisa Produk + Saran Iklan + Tool Tanya SKU

Status: RENCANA (belum ada kode). Tanggal: 2026-10-14.
Menggantikan `docs/rencana-analisa-produk.md` versi pertama (asumsi "export iklan tanpa SKU"
SUDAH TERBANTAH oleh file nyata — lihat §1).

Keputusan user: halaman Kata Kunci **dihapus**; diganti **Analisa Produk** dengan mode
cepat (tanpa AI) dan tombol **Analisa mendalam** (dengan AI, reasoning tertinggi dari
pengaturan global). Ditambah **tool tanya SKU** untuk kasus SKU tidak diketahui.

---

## 0. Ringkasan

Satu halaman **Analisa Produk**, tiga bagian:

1. **Analisa cepat** — selalu tampil, tanpa AI, tanpa tombol. Angka murni dari data.
2. **Saran iklan** — ROAS titik impas per SKU (dihitung, bukan dikarang) + data iklan nyata.
3. **Analisa mendalam** — tombol terpisah, pakai AI + reasoning tertinggi.

Plus satu **alat bantu**: **tool tanya SKU** — muncul hanya saat SKU tidak diketahui,
menanyakan ke user. Bukan chatbot; satu pertanyaan, satu jawaban, tersimpan.

Alasan pemisahan cepat vs AI: angka benar harus selalu bisa didapat **tanpa menunggu AI
dan tanpa biaya token**. AI menafsirkan, tidak menghitung. Di data keuangan, angka yang
tidak bisa diaudit tidak boleh jadi dasar keputusan.

---

## 1. Fakta dari file nyata (mengganti asumsi)

Dua file user sudah diperiksa. **Kesimpulan versi pertama rencana (pencocokan nama
tanpa SKU) TERBANTAH.**

### 1.1 `parentskudetail.*.xlsx` — Performa Produk: **PUNYA SKU**

Kolom kunci yang tersedia (39 kolom):

| Kolom | Nilai contoh | Kegunaan |
|---|---|---|
| `Kode Produk` | `43782225197` | ID produk Shopee |
| `SKU Induk` | `100331` | **= SKU master kita** |
| `Kode Variasi` / `Nama Variasi` | `251709099114` / `BIRU` | level variasi |
| `Total Penjualan (Pesanan Dibuat)` | `12.064.912` | omzet |
| `Penjualan (Pesanan Siap Dikirim)` | `11.183.288` | omzet terkirim |
| `Jumlah Produk Dilihat` | `302615` | **tayangan** |
| `Produk Diklik` | `14302` | **klik** |
| `Persentase Klik` | `4,73%` | CTR |
| `Pengunjung Produk (Kunjungan)` | `7881` | kunjungan |
| `Pengunjung Melihat Tanpa Membeli` | `1985` | tidak beli |
| `Tingkat Pengunjung Melihat Tanpa Membeli` | `25,19%` | bounce |
| `Dimasukkan ke Keranjang (Produk)` | `4808` | niat beli |
| `Pesanan Dibuat` / `Siap Dikirim` | `541` / `529` | pesanan |
| `Tingkat Konversi Pesanan` | `3,78%` | konversi |
| `Suka` | `51` | engagement |

**Terukur: 48/60 SKU Induk cocok langsung dengan master kita (80%).**

Kolom `SKU Induk` kosong pada baris induk (hanya terisi pada baris variasi), dan
`Kode Variasi` berisi SKU variasi — **ini juga jawaban untuk varian** yang dulu
dikeluhkan tidak ada.

### 1.2 `Data+Keseluruhan+Iklan+Shopee-*.csv` — Iklan: **TIDAK punya SKU, tapi punya kode produk**

Kolom: `Urutan, Nama Iklan, Status, Jenis Iklan, Kode Produk, Tampilan Iklan, Mode Bidding,
Penempatan Iklan, Tanggal Mulai, Tanggal Selesai, Dilihat, Jumlah Klik, Persentase Klik,
Tambah ke Keranjang, Konversi, Konversi Langsung, Tingkat konversi, Biaya per Konversi,
Produk Terjual, Terjual Langsung, Omzet Penjualan, Penjualan Langsung (GMV Langsung),
Biaya, Efektifitas Iklan, ACOS, Jumlah Produk Dilihat, Jumlah Klik Produk, Voucher Amount,
Vouchered Sales`.

Temuan penting:

- **`Kode Produk` = ID produk Shopee** (`20076426310`) — **sama dengan `Kode Produk` di
  file Performa Produk.** Jadi **file iklan bisa dipetakan ke SKU lewat file performa!**
- `Mode Bidding` = **`GMV Max ROAS`** — konfirmasi mode iklan yang dipakai.
- Baris tanpa `Kode Produk` (nilainya `-`) = iklan tingkat **grup/toko**, bukan produk.
- `Biaya` = **0 di seluruh baris** pada file contoh (periode 1 hari). Jadi biaya iklan
  nyata harus dari periode yang lebih panjang.
- `ACOS`, `Efektifitas Iklan`, `Terjual Langsung` tersedia → basis ROAS nyata.

### 1.3 KOREKSI PENTING: SKU kita ada di TIGA kolom, bukan satu

Pemeriksaan awal hanya membaca kolom **`SKU Induk`** — itu **SALAH dan menyesatkan**.
File punya **dua kolom bernama `Kode Variasi`** (posisi 3 dan 6), dan **kolom 6 berisi SKU kita**.

```
[ 3] Kode Variasi      kode variasi SHOPEE      (138333482525, 251709099114, ...)
[ 6] Kode Variasi      SKU KITA                 (001770, 1212, 0174, 0169)   <-- 218 cocok
[ 7] SKU Induk         SKU KITA                 (100331, 1708)                <--  48 cocok
```

Kolom 3 dan 6 **berbeda total** (irisan **0**) meski namanya sama. Karena keduanya bernama
`Kode Variasi`, pembacaan berbasis **nama kolom** tidak bisa dipakai — **harus berbasis POSISI**.
Ini jebakan yang wajib dicatat di importer.

Terukur dari file nyata:

| Sumber | SKU cocok master |
|---|---|
| `[6] Kode Variasi` | **247 langsung** + 1 kanonik |
| `[7] SKU Induk` | 70 langsung + 2 kanonik |
| `[3] Kode Variasi` | 0 (memang kode Shopee) |
| **Gabungan** | **~263 SKU**, memetakan **120 dari 624 kode produk** |

Naik **5×** dibanding hanya membaca `SKU Induk` (60 kode produk).

### 1.3b Dampak nyata: cakupan omset 98,3%

Kesalahan membaca kolom memutuskan seluruh rencana. Perbandingan pada file nyata
(periode 7-13 Okt):

| | Hanya `SKU Induk` | Semua kolom (benar) |
|---|---|---|
| Kode produk terpetakan | 60 | **120** |
| Pesanan terpetakan | ~10% | **98,3%** (3524/3585) |
| Omzet terpetakan | — | **97,6%** (Rp 105,9 jt dari Rp 108,6 jt) |
| Produk berpesanan yang belum terpetakan | **61** | **22** |

Produk terbesar yang dulu dianggap "tak terpetakan" ternyata **punya SKU** di kolom 6:

```
28753717561  Piring Rotan Kupu-Kupu  terjual 558
   variasi BIRU R  [6]=001770   variasi COKLAT [6]=1212
   variasi HIJAU   [6]=0174     variasi BIRU   [6]=0169
   (SKU Induk KOSONG di semua baris — tapi SKU ada di kolom 6)
```

Jadi **tool tanya SKU jauh lebih jarang dipakai dari dugaan**: hanya **22 produk**
(0,4% omzet), dan yang terbesar cuma 23 pesanan / Rp 1,07 jt.

### 1.3c Model varian itu SAH, bukan bentrok

Satu kode produk Shopee dengan **banyak SKU** = **model varian yang benar**:

```
20076426310  Lunch Box TRI J 4in1
   BIRU  -> 001517      PINK -> 001916
   PUTIH -> 001917      UNGU -> 001944
9715798028   Dispenser Beras New Modern
   14 variasi, masing-masing punya SKU sendiri, SEMUA ada di master
```

Diperiksa juga: 35 kandidat yang namanya "tidak nyambung" ternyata **semuanya benar**,
hanya beda gaya penulisan:

```
"Termos nasi & es motif rotan"    -> "Rice Bucket 6,5L tri J Ungu"    (produk sama)
"Tissu Kompor Serbaguna"          -> "Beclean Warna T1000"            (merek vs deskripsi)
"Rak Penyimpanan Makanan 4 Susun" -> "Tudung Saji 4ssn Peri"          (nama beda, produk sama)
```

**Kesimpulan: pencocokan nama TIDAK diperlukan sebagai penentu.** SKU sudah tersedia
eksplisit dari Shopee. Nama hanya dipakai untuk **menampilkan** agar manusia mudah memilih
saat 22 kasus itu ditanyakan.

### 1.3d Struktur baris file

File punya dua jenis baris:

| Jenis baris | `[3] Kode Variasi` | `[6]` | `[7] SKU Induk` |
|---|---|---|---|
| **Induk** (produk) | `-` | `-` | kadang terisi, kadang `-` |
| **Variasi** | kode Shopee | **SKU kita** | kadang terisi |

Konsekuensi: pemetaan **WAJIB mengumpulkan dari SELURUH baris** per `Kode Produk`,
tidak boleh membaca per baris. Angka pesanan/omzet hanya ada di baris **induk** —
jadi penggabungan harus hati-hati agar tidak menghitung ganda.

### 1.5 KEPUTUSAN: `[6]` dulu, `[7]` cadangan

Kedua kolom **sering berbeda**, dan itu **bukan konflik — beda tingkat**:

```
[7] SKU Induk   = SKU produk INDUK        (satu, generik)      -> 48 produk, 20,9% omzet
[6] Kode Variasi = SKU per VARIASI        (banyak, spesifik)  -> 79 produk, 78,9% omzet
```

Bukti dari master:

```
001485  "Piring 9 super"                HPP 7500   <- INDUK (dari [7])
  100012 "Piring 9 Super Hijau - SY"    HPP 7093   <- VARIASI (dari [6])
  100013 "Piring 9 Super Biru - SY"     HPP 7000   <- VARIASI (dari [6])
  100345 "Piring 9 Super Merah - SY"    HPP 7000   <- VARIASI (dari [6])
```

Terukur pada file nyata (7-13 Okt):

| Strategi | Produk terpetakan | Pesanan | Omzet |
|---|---|---|---|
| `[7]` saja | 48 | 32,7% | **20,9%** |
| `[6]` saja | 79 | 68,6% | 78,9% |
| **`[6]` dulu, `[7]` cadangan** | **117** | **98,3%** | **97,6%** |

**Keputusan user (2026-10-14): pakai `[6]` dulu, jatuh ke `[7]` bila `[6]` kosong.**

Alasan tambahan: **`[6]` membawa HPP yang lebih akurat.** Variasi punya biaya
sendiri-sendiri (Hijau 7093, Biru 7000), sedangkan induk hanya 7500 rata-rata.
Untuk analisa margin, memakai HPP varian adalah satu-satunya cara menjawab
"varian mana yang untung" dengan benar.

**Keputusan user: HPP yang dipakai = HPP varian (`[6]`).**

Kalau `[7]` saja yang dipakai: **79% omzet hilang** dari analisa dan harus dijawab
satu per satu lewat tool tanya SKU. Perbedaan 4,7×.

Meski cakupan 98%, **79 grup SKU "kembar"** tetap ada di master dan tetap berbahaya
bila suatu saat dipakai untuk pencocokan longgar:

```
1203     Alas Setrika uk.3x45x90          ⟷  001203  Pampers Cilukba Pants uk. XL
1620     Kaca Cetakan 7/8 Lubang          ⟷  001620  tudung saji 4ssn tri j peri glowing biru
1124     Waskom 10 Super -T               ⟷  001124  Botol Kaca Kaktus No Box
```

Karena pemetaan sekarang **eksplisit lewat SKU** (bukan tebakan), grup ini **tidak
berbahaya**. Yang berbahaya hanya bila seseorang menambahkan pencocokan "buang nol depan"
di masa depan — karena itu **aturan kanonik longgar DILARANG** (§2.4).

---

## 2. Tool Tanya SKU (usulan user — disetujui, dipersempit)

### 2.1 Prinsip

Tool ini **bukan chatbot**. Bentuknya: **satu pertanyaan tertutup, satu jawaban,
tersimpan permanen.** Muncul HANYA saat pemetaan tidak pasti.

Alasan dipersempit: chatbot bebas berarti user tidak tahu kapan harus dipanggil, dan
jawaban bebas sulit diverifikasi. Pertanyaan tertutup dengan kandidat bisa diuji,
diaudit, dan dijawab cepat.

### 2.2 Kapan muncul (dua pemicu, angkanya terukur)

Diukur pada file nyata: cakupan **98,3% pesanan / 97,6% omzet sudah beres tanpa bertanya.**
Pertanyaan hanya untuk sisa kecil:

```
Pemicu 1  Kode Produk BERPESANAN tanpa SKU di ketiga kolom ( [3]/[6]/[7] )
          22 produk — terbesar 23 pesanan (Rp 1,07 jt), sisanya 1-12 pesanan
          → tanya: "Produk ini terjual 23 kali tapi belum punya padanan. Pilih produknya."

Pemicu 2  SKU ditemukan tapi TIDAK ADA di master
          → tanya: "SKU '1777' tidak ada di master. Pilih tindakan."
             [ tambah produk baru ]  [ petakan ke produk lain ]  [ bukan produk kita ]
```

**Pemicu lama yang DIBATALKAN** (karena tidak lagi perlu):

- ~~SKU kembar/kanonik bentrok~~ → pemetaan sekarang **eksplisit** dari SKU, bukan
  tebakan, jadi 79 grup kembar tidak berbahaya (§1.4).
- ~~Kode produk iklan tak ada di performa~~ → file iklan memuat `Kode Produk` yang
  sama; bila tidak ketemu, itu jatuh ke pemicu 1.

**Kandidat tetap ditampilkan** (nama Shopee + variasi + jumlah terjual) agar keputusan
cepat, tapi **hanya sebagai tampilan** — bukan dasar pemetaan.

### 2.3 Bentuk UI: DUA KARTU (permintaan user)

User meminta tool tanya berbentuk **kolom isian yang bisa dijawab sekaligus (batch)**,
bukan popup satu per satu. Bentuknya dua kartu bertumpuk:

```
┌─ PERTANYAAN ──────────────────────────────  [7 belum dijawab] ─┐
│ Produk yang belum punya SKU. Isi kolom SKU, atau tandai        │
│ "bukan produk kita". Jawaban tersimpan dan tidak ditanya lagi. │
│                                                                 │
│  #  Produk Shopee                         Terjual   Variasi     │
│  1  Rak Buku Portable 5 Layer             23       TANPADUS    │
│  2  Bubble Wrap Untuk Packing Aman        12       -            │
│  3  Gayung Mandi Jumbo                     3       -            │
└─────────────────────────────────────────────────────────────────┘
┌─ JAWABAN ───────────────────────────────────────────────────────┐
│  #  SKU                          SKU          Kandidat terdekat │
│  1  [_______________]            (021)        [Rak Buku 5 Layer]│
│  2  [_______________]            (022)        [Bubble Wrap 50cm]│
│  3  [_______________]            (023)        [Gayung Jumbo]    │
│                                                                 │
│  [ Simpan semua ]   [ Tandai bukan produk kita ]                │
└─────────────────────────────────────────────────────────────────┘
```

Mengetik SKU, begitu terisi dan cocok master → baris **hijau** dan otomatis tersimpan
pada baris pertama yang valid. Yang tidak diisi → baris tetap di daftar pertanyaan.

Keunggulan bentuk ini dibanding popup satu-satu:

- **Sekali lihat, semua jawab** — 22 pertanyaan selesai dalam satu sesi, bukan 22 popup.
- **Bisa ditinggal** — jawaban yang sudah diisi tersimpan; sisanya menunggu sesi berikutnya.
- **Mengetik SKU langsung** — user sudah tahu SKU-nya (dari sistem lama), tidak perlu
  menelusuri kandidat.
- **Kandidat tetap ditampilkan** untuk yang lupa SKU-nya.

### 2.4 Pemicu pertanyaan (2 saja, terukur)

```
Pemicu 1  Kode Produk BERPESANAN tanpa SKU di kolom [6] maupun [7]
          22 produk — terbesar 23 pesanan (Rp 1,07 jt), sisanya 1-12 pesanan
          → masuk kartu PERTANYAAN

Pemicu 2  SKU ditemukan (di [6] atau [7]) tapi TIDAK ADA di master
          → masuk kartu PERTANYAAN dengan pilihan "tambah produk baru"
```

Semua yang punya SKU valid (98,3% pesanan) **tidak muncul sama sekali** — tidak perlu
dilihat, tidak perlu dijawab.

### 2.5 Aturan yang mengikat

- **Urutan pengambilan SKU: `[6]` dulu, `[7]` cadangan.** `[6]` = SKU variasi (punya HPP
  sendiri); `[7]` = SKU induk (hanya bila `[6]` kosong). Terukur: `[7]` saja = 20,9%
  omzet, `[6]`+`[7]` = 97,6%.
- **HPP yang dipakai = HPP varian** (dari `[6]`). Itu satu-satunya cara menjawab
  "varian mana yang untung" dengan benar.
- **DUA-DUANYA HARUS COCOK PERSIS** (setelah trim + uppercase) dengan `products.sku`.
  Tidak ada normalisasi longgar.
- **Kanonik longgar (buang nol depan / awalan `SKU/`) DILARANG.** Terbukti berbahaya:
  `1203` ≠ `001203`. Bila perlu penyamaan, itu **harus** jadi pertanyaan ke user.
- **Importer membaca kolom berdasarkan POSISI**, bukan nama — karena ada dua kolom
  bernama `Kode Variasi` (§1.3). Header dipakai sebagai **pemeriksa** (memastikan file
  tidak bergeser), bukan sebagai dasar pengambilan nilai.
- **Sistem TIDAK PERNAH menebak.** Tidak ada auto-pilih, tidak ada "kandidat terbaik".
- **Data tidak dipakai sebelum dijawab.** Baris yang belum diputuskan **dikeluarkan** dari
  analisa, dan jumlahnya dilaporkan ("22 baris belum dipetakan, tidak dihitung").
  Bukan dihitung dengan asumsi, bukan juga dibuang diam-diam.
- **Jawaban tersimpan permanen** per `Kode Produk`; tidak pernah ditanya lagi.
- **Jawaban bisa diubah** (manusia salah ketik) → analisa dihitung ulang.

### 2.6 Kenapa ini bukan "AI tool"

Tool tanya SKU **tidak memanggil AI sama sekali**. Ia pertanyaan deterministik dari
kondisi data. AI hanya dipakai (opsional, fase akhir) untuk **mengusulkan urutan
kandidat** — dan itu pun hanya mengurutkan, bukan memutuskan.

Pemisahan ini penting: kesalahan pemetaan merusak **semua** angka di hilirnya. Tidak
boleh ada bagian yang tidak bisa ditelusuri.

---

## 3. Yang SUDAH ADA (bahan analisa, terverifikasi)

| Data | Sumber | Isi nyata |
|---|---|---|
| Analisa per SKU | `laba_snapshot.rincian_json` | `sku, nama, unit, hppSatuan, hargaJual, marginSatuan, marginPersen, kontribusi` — sudah dihitung tiap impor laba, 65-100+ SKU per snapshot |
| Laba per pesanan | `laba_order` | **1573 baris** (omzet, hpp, biaya, pajak, laba, tanggal, status) |
| Master produk | `products` | **1174 SKU** + HPP terkini (dari Kledo) |
| Stok | `stock_by_bin` | per gudang |
| Kategori tarif | `kategori_tarif` | **276 baris** (tier) |
| Mesin pencocokan | `lib/matching/cariProdukByNama.js` | token overlap + typo, ambang 0.72/0.45 |

**Dan tiga tabel yang kosong** (penulisnya nol pemanggil — akan diperbaiki atau dihapus):

- `keyword_notes` (0 baris) — `catatKeyword` tidak dipanggil → **halaman Kata Kunci dihapus**
- `product_search_keywords` (0 baris) — `tambahKeyword` tidak dipanggil
- `ads_harian` (0 baris) — belum pernah diisi

---

## 4. Skema — satu migrasi

```
-- Jembatan Kode Produk Shopee → daftar SKU kita. Diisi dari file Performa (fakta Shopee).
-- Satu Kode Produk bisa punya BANYAK SKU (model varian sah — Dispenser Beras 14 variasi).
CREATE TABLE shopee_produk (
  kode_produk TEXT NOT NULL,             -- ID produk Shopee
  sku TEXT NOT NULL,                     -- products.sku
  tingkat TEXT NOT NULL CHECK (tingkat IN ('variasi','induk')),
  variasi TEXT,                          -- nama variasi (tampilan)
  kode_variasi_shopee TEXT,              -- kolom [3], untuk jejak
  nama_shopee TEXT,                      -- nama produk Shopee (tampilan)
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (kode_produk, sku)
);
CREATE INDEX idx_shopee_produk_sku ON shopee_produk(sku);
-- Cari SKU variasi lebih dulu; kalau tidak ada, baru induk (aturan §2.5).
CREATE INDEX idx_shopee_produk_tingkat ON shopee_produk(kode_produk, tingkat);

-- Keputusan tak-pasti: satu baris per pertanyaan yang menunggu jawaban manusia.
-- Diisi lewat UI DUA KARTU secara batch (permintaan user), bukan popup satu-satu.
CREATE TABLE peta_putusan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jenis TEXT NOT NULL CHECK (jenis IN ('tanpa_sku','sku_tak_ada_master')),
  acuan TEXT NOT NULL,                   -- kode_produk yang dipertanyakan
  nama_shopee TEXT,                      -- untuk ditampilkan saat bertanya
  pesanan INTEGER NOT NULL DEFAULT 0,    -- bobot prioritas (terbesar dulu)
  omzet INTEGER NOT NULL DEFAULT 0,
  kandidat_json TEXT NOT NULL DEFAULT '[]',
  diputuskan_sku TEXT,                   -- hasil; '' = bukan produk kita
  diputuskan_at INTEGER, diputuskan_oleh TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (jenis, acuan)
);
CREATE INDEX idx_peta_putusan_belum ON peta_putusan(pesanan DESC) WHERE diputuskan_at IS NULL;

-- Biaya iklan PER PRODUK per tanggal.
CREATE TABLE ads_produk (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  tanggal TEXT NOT NULL,                 -- WIB YYYY-MM-DD
  sku TEXT NOT NULL,
  biaya INTEGER NOT NULL DEFAULT 0,
  klik INTEGER, dilihat INTEGER,
  omzet_iklan INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (preset_id, tanggal, sku)
);
CREATE INDEX idx_ads_produk_tgl ON ads_produk(preset_id, tanggal);

-- Performa produk (kunjungan/konversi) per SKU per periode.
CREATE TABLE performa_produk (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  periode TEXT NOT NULL,                 -- YYYY-MM-DD_YYYY-MM-DD
  sku TEXT NOT NULL,
  dilihat INTEGER NOT NULL DEFAULT 0, klik INTEGER NOT NULL DEFAULT 0,
  kunjungan INTEGER NOT NULL DEFAULT 0, keranjang INTEGER NOT NULL DEFAULT 0,
  pesanan INTEGER NOT NULL DEFAULT 0, omzet INTEGER NOT NULL DEFAULT 0,
  melihat_tanpa_beli INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (preset_id, periode, sku)
);
```

**Nol perubahan pada `laba_snapshot`/`laba_order`.**

---

## 5. Analisa yang dikerjakan

### 5.1 Analisa cepat (tanpa AI) — dari data yang sudah ada

- **Merugi**: SKU margin negatif (rugi tiap terjual) — paling mendesak, dengan total rupiah.
- **Margin tipis**: `< 10%` (ambang keputusan user).
- **Konsentrasi**: persen laba dari 10 SKU teratas (>60% = risiko bergantung segelintir).
- **HPP basi**: HPP naik setelah snapshot dibuat → margin sebenarnya kini lebih jelek.
- **Tren antar periode**: 3 snapshot tersedia — SKU naik, turun, baru muncul, hilang.
- **Silang stok**: kontribusi besar + stok menipis (risiko) / kontribusi rendah +
  stok menumpuk (modal mati).
- **Retur**: (setelah importer menambahkan field) produk dengan retur tinggi.

#### 5.1b Analisa tingkat VARIAN — baru, dan ini keunggulan utama

Karena pemetaan memakai SKU variasi dengan HPP masing-masing, analisa bisa turun ke
tingkat varian. Ini yang tidak bisa dilakukan sistem lama:

- **Varian merugi di dalam produk yang untung.** Produk terlihat sehat, padahal satu
  warnanya rugi tiap terjual. Contoh nyata: Piring 9 Super Hijau (HPP 7093) vs Biru
  (HPP 7000) vs induk 7500 — selisih biaya per unit itulah yang menggerus margin.
- **Warna/ukuran mana yang paling laku**, dan mana yang hanya menumpuk stok.
- **Rekomendasi fokus**: tawarkan varian ber-margin terbaik; kurangi yang rugi.
- **HPP varian vs HPP induk**: bandingkan harga jual aktual terhadap biaya varian
  sesungguhnya, bukan rata-rata.

Catatan kehati-hatian: `laba_snapshot.rincian_json` saat ini berisi **per SKU** (yang
sudah tervariasi). Bila suatu varian belum pernah terjual, ia tidak muncul di sana —
analisa varian harus menggabungkan rincian penjualan + master produk, bukan hanya rincian.

### 5.2 Saran iklan — **ROAS titik impas, dihitung bukan dikarang**

```
ROAS impas = hargaJual ÷ (hargaJual − hppSatuan − biayaLainPerUnit)
```

Contoh nyata (SKU 100331 "Pisau Set 3 in 1"): `10.879 ÷ 2.310 = 4,71`.
Setiap Rp 1 iklan harus menghasilkan ≥ Rp 4,71 hanya supaya tidak rugi.

Turunan:
- Urutan prioritas: ROAS impas **terendah** = paling aman diiklankan.
- SKU margin ≤ 0 → **"JANGAN diiklankan"** dengan alasannya.
- Biaya iklan maksimum sehat per SKU per periode (dari omzet nyata).
- **ACOS nyata vs ROAS impas** (data CSV menyediakan ACOS) → produk mana yang iklannya
  sudah untung dan mana yang belum.

### 5.3 Analisa mendalam (AI) — menafsirkan, bukan menghitung

AI menerima hasil analisa cepat (JSON) + `performa_produk` + `ads_produk`, lalu:
- narasi awam, prioritas tindakan berurut dampak rupiah,
- sebab-akibat yang menghubungkan temuan (mis. "margin tipis DAN biaya iklan tinggi"),
- kandidat harga baru dengan alasan,
- **wajib** menyebut data yang tidak ada (mis. "biaya iklan periode ini belum diimpor").

### 5.4 Batas keras saran iklan

**DILARANG**: menyebut target ROAS dari AI sebagai "yang terbaik"; mengklaim tahu
mekanisme GMV MAX / AUTO ROAS yang berlaku; memberi saran bila `ads_produk` kosong.

Setiap keluaran saran iklan **wajib** memuat:

> Angka ini **titik impas**, dihitung dari biaya toko Anda sendiri. Bukan target yang
> dijamin menguntungkan. Perilaku setelan iklan Shopee (GMV MAX/AUTO ROAS) tidak dapat
> diverifikasi sistem ini — uji dengan anggaran kecil sebelum menerapkan menyeluruh.

Prinsip: sistem hanya membuat pernyataan yang bisa dipertanggungjawabkan.

---

## 6. Modul

| Berkas | Isi |
|---|---|
| `lib/analisa/tipe.ts` | tipe temuan (dipakai UI + AI, satu bentuk) |
| `lib/analisa/hitung.ts` | analisa cepat + analisa varian + ROAS impas. **Fungsi murni, tanpa DB** |
| `lib/analisa/peta.ts` | aturan `[6]`→`[7]` + deteksi pemicu pertanyaan |
| `lib/analisa/ai.ts` | prompt dari temuan → provider (`lib/ai/provider`), reasoning dari pengaturan |
| `lib/d1/shopeePeta.ts` | CRUD `shopee_produk` + `peta_putusan` (jawaban batch) |
| `lib/d1/adsProduk.ts` | importer CSV iklan + performa xlsx (**baca per posisi kolom**) |
| `app/api/analisa/route.ts` | GET (cepat) + POST (`mendalam`, `putusan`, `putusan-batch`) |
| `app/analisa/page.tsx` | halaman baru + kartu PERTANYAAN/JAWABAN |

### 6.1 Pengaturan reasoning GLOBAL (diminta user)

Saat ini **tidak ada**. Ditambahkan ke pengaturan AI:

```
reasoningAnalisa: "" | "minimal" | "low" | "medium" | "high" | "tertinggi"
```

Nilai sah diambil dari `ai_model.reasoning_pilihan` (kapabilitas per model yang sudah
tersimpan). Pemetaan ke parameter provider lewat `lib/ai/reasoning.ts` yang sudah ada.
Bila model tidak mendukung → **dicatat sebagai peringatan**, tidak diam-diam turun.

---

## 7. Urutan pengerjaan

| Tahap | Kerja | Bukti |
|---|---|---|
| **T1** | `lib/analisa/hitung.ts` + uji (data yang sudah ada) | 5 angka cocok dengan SQL langsung |
| **T2** | API GET + halaman (analisa cepat) | temuan nyata dari 3 snapshot tampil |
| **T3** | Ganti menu "Kata Kunci" → "Analisa"; **hapus** halaman kata-kunci + `kamus.ts` + `catatKeyword` + `konfirmasiKeyword` | grep bersih |
| **T4** | Migrasi + importer performa xlsx (**posisi kolom `[6]` lalu `[7]`**) + peta | 117/624 produk; **98,3% pesanan / 97,6% omzet** |
| **T5** | **Tool tanya SKU: UI DUA KARTU (batch)** + 2 pemicu | 22 pertanyaan selesai dalam satu sesi |
| **T6** | Importer CSV iklan + `ads_produk` | biaya iklan nyata masuk per SKU |
| **T7** | ROAS impas + tab Saran Iklan + baris keterbatasan | angka impas cocok hitung tangan |
| **T8** | `lib/analisa/ai.ts` + tombol "Analisa Mendalam"+ reasoning global | narasi memuat angka benar + menyebut data kurang |

Tiga hal yang WAJIB benar di T4, ketiganya dari kesalahan yang sudah terbukti:

1. **Baca kolom berdasarkan POSISI.** Ada dua kolom bernama `Kode Variasi`; yang berisi
   SKU kita adalah **posisi 6**. Salah baca = cakupan jatuh dari 98% ke 10%.
2. **`[6]` dulu, `[7]` cadangan.** `[7]` saja = 20,9% omzet; `[6]`+`[7]` = 97,6%.
3. **HPP dari SKU varian**, bukan induk. Variasi punya biaya sendiri (7093 vs 7500).

T4 sebelum T5: 98% selesai tanpa bertanya; pertanyaan hanya untuk 22 produk sisanya.
T5 sebelum T7: tanpa SKU yang benar, saran iklan salah sasaran.

---

## 8. Keputusan user (2026-10-14)

1. **File iklan tanpa SKU** → ternyata **ada jembatan resmi**: `Kode Produk` (iklan) →
   file performa → SKU. Pencocokan nama berbahaya **tidak dipakai**.
2. **File performa perlu** → dipakai, dan berisi SKU di **dua** kolom.
3. **Ambang margin tipis: 10%.**
4. **Halaman Kata Kunci: HAPUS.**
5. **Reasoning tertinggi**, diatur **global di halaman AI**.
6. **Tool tanya SKU disetujui** — bentuknya **kolom isian batch (UI dua kartu)**,
   bukan popup satu per satu.
7. **Urutan kolom: `[6]` dulu, `[7]` cadangan** — setelah terbukti `[7]` saja hanya
   menutup 20,9% omzet, sementara `[6]`+`[7]` menutup 97,6%.
8. **HPP yang dipakai = HPP varian (`[6]`)**, bukan HPP induk — supaya analisa
   "varian mana yang untung" benar.

### Peringatan user yang dipatuhi

> "ini perlu informasi yang SANGAT terkini tentang iklan GMX MAX ROAS dan GMV MAX AUTO.
> Jika analisa salah bisa bikin user rugi besar."

→ Dijawab §5.2/§5.4: sistem dibatasi pada **titik impas dari biaya sendiri**, dilarang
mengklaim tahu perilaku platform, dan wajib menyatakan keterbatasan.

### Koreksi yang dicatat sebagai pelajaran

Pemeriksaan awal hanya membaca `SKU Induk` dan menyimpulkan 61 produk tak bisa dipetakan.
User menunjuk kolom lain → ternyata SKU ada di kolom ke-6 yang **bernama sama** dengan
kolom ke-3. Pelajaran: **periksa bentuk data mentah sampai ke posisi kolom, jangan
percaya nama kolom** — terutama pada ekspor pihak ketiga.

---

## 9. Yang SENGAJA tidak dikerjakan

- **Pencocokan nama otomatis untuk uang.** Dilarang (§1.4) — 79 grup SKU kembar terbukti.
- **Saran target ROAS dari AI.** Hanya titik impas dari biaya sendiri.
- **Mengklaim tahu mekanisme GMV MAX / AUTO ROAS.**
- **Mengubah setelan iklan di Shopee.** Sistem menyarankan; manusia mengubah.
- **Chatbot bebas untuk tanya SKU.** Dipersempit jadi pertanyaan tertutup (§2).
- **Prediksi/ramalan penjualan.** Data masih tipis.
- **Analisa kompetitor.** Butuh data luar.
- **Mengubah harga otomatis.** Analisa mengusulkan; manusia memutuskan.
