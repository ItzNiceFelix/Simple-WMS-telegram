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

### 1.3 Struktur file performa — dua lapis baris

File punya **dua jenis baris**:

| Jenis baris | `Nama Variasi` | `SKU Induk` | `Kode Variasi` |
|---|---|---|---|
| **Induk** (produk) | `-` | **kosong** | `-` |
| **Variasi** | `BIRU`, `HITAM`, ... | **terisi** | kode variasi |

Terukur: **83 baris ber-`SKU Induk`, 843 kosong.** Dari 624 Kode Produk unik, hanya
**60 yang punya `SKU Induk`** di salah satu barisnya.

**Konsekuensi teknis:** pemetaan harus **mengumpulkan `Kode Produk → SKU Induk` dari
SELURUH baris file**, bukan membaca per baris. Produk yang SKU Induk-nya hanya muncul
di baris variasi tetap bisa dipetakan — asalkan dikumpulkan dulu.

### 1.3b Yang lebih penting: 61 produk berterjual TANPA SKU Induk

Dari 564 Kode Produk tanpa `SKU Induk`, **61 di antaranya benar-benar berterjual** —
dan itu justru produk yang paling besar:

```
28753717561  Piring Rotan Kupu-Kupu     terjual 558   dilihat 362.653
20076426310  Lunch Box TRI J 4in1       terjual 541   dilihat 302.615
28566565639  Rak sepatu ASTER 4 Susun   terjual 242   dilihat  59.660
6261211167   Tisu Kompor BeClean 1kg    terjual 237   dilihat  28.332
9715798028   Dispenser Beras New Modern terjual 138   dilihat  79.496
54964139911  Lemari Plastik 4 Susun     terjual  23   dilihat  26.903
```

**Ini masalah serius:** produk dengan penjualan & tayangan terbesar justru **tidak bisa
dipetakan otomatis** ke master, karena induknya tidak punya SKU Induk di file.

Sisanya (485) hanya dilihat tanpa terjual — tidak mendesak.

**Kesimpulan: tool tanya SKU BUKAN pelengkap, tapi WAJIB** — dan dipakai justru untuk
produk paling penting. Ini memvalidasi usulan user.

### 1.4 Sisa masalah: SKU Induk tidak selalu cocok langsung

Dari **60 SKU Induk** yang ditemukan:

```
48  cocok LANGSUNG dengan master          (80%)
 2  cocok setelah kanonik (buang nol depan)
10  tetap tidak cocok:
      1777, GYG-ISADX, FYP-MSP, 0227, 0229, 1459, 0813,
      RCB-12KIMP, TGS-130DIS, 001522
```

**Bahaya yang terbukti — 79 grup SKU "kembar" di master kita:**

```
1203     Alas Setrika uk.3x45x90          ⟷  001203  Pampers Cilukba Pants uk. XL
1620     Kaca Cetakan 7/8 Lubang          ⟷  001620  tudung saji 4ssn tri j peri glowing biru
1124     Waskom 10 Super -T               ⟷  001124  Botol Kaca Kaktus No Box
1126     (SKU/01126) Bangku Pendek 2 CHT  ⟷  001126  Botol Kaca Six Oup Logo
```

**Produk yang sama sekali berbeda.** Mencocokkan dengan "buang nol depan" saja akan
menyambungkan keduanya — dan biaya iklan/analisa masuk ke produk yang salah.

**Inilah satu-satunya alasan tool tanya SKU dibutuhkan**, dan hanya untuk kasus ini.

---

## 2. Tool Tanya SKU (usulan user — disetujui, dipersempit)

### 2.1 Prinsip

Tool ini **bukan chatbot**. Bentuknya: **satu pertanyaan tertutup, satu jawaban,
tersimpan permanen.** Muncul HANYA saat pemetaan tidak pasti.

Alasan dipersempit: chatbot bebas berarti user tidak tahu kapan harus dipanggil, dan
jawaban bebas sulit diverifikasi. Pertanyaan tertutup dengan kandidat bisa diuji,
diaudit, dan dijawab cepat.

### 2.2 Kapan muncul (empat pemicu, semuanya pasti)

Diukur dari file nyata:

```
Pemicu 1  Kode Produk BERterjual tapi tidak punya SKU Induk
          61 produk, termasuk 6 terbesar (558, 541, 242, 237, 138, 23 pesanan)
          → tanya: "Produk ini terjual 558 tapi belum ada padanannya. Pilih produknya."

Pemicu 2  SKU Induk ada di master, TAPI kanoniknya bertabrakan (79 grup kembar)
          → tanya: "SKU '1620' bisa berarti 2 produk berbeda. Yang mana?"
             [1620   Kaca Cetakan 7/8 Lubang Happycall Gold]
             [001620 tudung saji 4ssn tri j peri glowing biru]
             [bukan keduanya]

Pemicu 3  SKU Induk tidak ada di master sama sekali (10 dari 60)
          → tanya: "SKU '1777' tidak ada di master. Pilih tindakan."
             [ tambah produk baru ]  [ petakan ke produk lain ]  [ bukan produk kita ]

Pemicu 4  Kode Produk di file iklan tidak ada di file performa
          → tanya: sama seperti pemicu 1
```

**Urutan prioritas pertanyaan: pemicu 1 lebih dulu** — itu produk dengan penjualan
terbesar, jadi salah petanya paling merugikan.

### 2.3 Bentuk dialog

Bukan popup mengambang yang mengganggu. **Baris di daftar "Perlu Keputusan"**:

```
┌─ Perlu Keputusan (4) ────────────────────────────────────┐
│ ⚠ SKU 1570 — 2 kemungkinan produk                       │
│   [ 001570 tudung saji 4ssn... ]  [ 1570 ... ]  [ lain ] │
│                                                          │
│ ⚠ Kode 28753717561 — belum ada di master                │
│   [ tambah produk baru ]  [ bukan produk kita ]          │
└──────────────────────────────────────────────────────────┘
```

Satu baris = satu keputusan. Dijawab sekali, **tersimpan**, tidak pernah ditanya lagi.

### 2.4 Aturan yang mengikat

- **Sistem TIDAK PERNAH menebak.** Tidak ada auto-pilih, tidak ada "kandidat terbaik".
  Kandidat hanya **diurutkan** (dari mesin `cariProdukByNama.js` yang sudah ada) untuk
  mempercepat mata manusia.
- **Data tidak dipakai sebelum dijawab.** Baris yang belum diputuskan **dikeluarkan**
  dari analisa, dan jumlahnya dilaporkan ("4 baris belum dipetakan, tidak dihitung").
  Bukan dihitung dengan asumsi.
- **Jawaban bisa diubah** (manusia salah pilih) → analisa dihitung ulang.
- **Kandidat ditampilkan dengan bukti**: nama + SKU + (bila ada) jumlah terjual, supaya
  keputusan bisa diambil dalam detik.

### 2.5 Kenapa ini bukan "AI tool"

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
-- Jembatan Kode Produk Shopee → SKU kita. Diisi dari file Performa (fakta Shopee).
CREATE TABLE shopee_produk (
  kode_produk TEXT PRIMARY KEY,          -- ID produk Shopee
  sku TEXT,                              -- products.sku; NULL = belum diputuskan
  nama_shopee TEXT,                      -- untuk ditampilkan saat bertanya
  sumber TEXT NOT NULL DEFAULT 'performa' CHECK (sumber IN ('performa','manual')),
  diputuskan_at INTEGER, diputuskan_oleh TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_shopee_produk_sku ON shopee_produk(sku);

-- Keputusan tak-pasti: satu baris per pertanyaan yang menunggu jawaban manusia.
CREATE TABLE peta_putusan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jenis TEXT NOT NULL CHECK (jenis IN ('produk_baru','sku_kembar','tanpa_padanan')),
  acuan TEXT NOT NULL,                   -- kode_produk / sku shopee yang dipertanyakan
  kandidat_json TEXT NOT NULL DEFAULT '[]',
  diputuskan_sku TEXT,                   -- hasil; '' = bukan produk kita
  diputuskan_at INTEGER, diputuskan_oleh TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (jenis, acuan)
);

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
- **Silang stok**: kontribusi besar + stok menipis (risiko) / kontribusi rendah + stok
  menumpuk (modal mati).
- **Retur**: (setelah importer menambahkan field) produk dengan retur tinggi.

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
| `lib/analisa/hitung.ts` | analisa cepat + ROAS impas. **Fungsi murni, tanpa DB** |
| `lib/analisa/peta.ts` | aturan pemetaan + deteksi 3 pemicu pertanyaan |
| `lib/analisa/ai.ts` | prompt dari temuan → provider (`lib/ai/provider`), reasoning dari pengaturan |
| `lib/d1/shopeePeta.ts` | CRUD `shopee_produk` + `peta_putusan` |
| `lib/d1/adsProduk.ts` | importer CSV iklan + performa xlsx |
| `app/api/analisa/route.ts` | GET (cepat) + POST (`mendalam`, `putusan`) |
| `app/analisa/page.tsx` | halaman baru |

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
| **T4** | Migrasi + importer performa xlsx + peta `Kode Produk → SKU` | 48/60 cocok langsung; sisanya jadi pertanyaan |
| **T5** | **Tool tanya SKU** + deteksi 3 pemicu + UI "Perlu Keputusan" | 12 SKU tak cocok jadi 12 keputusan jelas |
| **T6** | Importer CSV iklan + `ads_produk` | biaya iklan nyata masuk per SKU |
| **T7** | ROAS impas + tab Saran Iklan + baris keterbatasan | angka impas cocok hitung tangan |
| **T8** | `lib/analisa/ai.ts` + tombol "Analisa mendalam" + reasoning global | narasi memuat angka benar + menyebut data kurang |

T4 sebelum T5: pemetaan 80% cocok **tanpa bertanya**; pertanyaan hanya untuk 20% sisanya.
T5 sebelum T7: tanpa SKU yang benar, saran iklan salah sasaran.

---

## 8. Keputusan user (2026-10-14)

1. **File iklan tanpa SKU** → ternyata **ada jembatan resmi** lewat `Kode Produk` →
   file performa → `SKU Induk`. Pencocokan nama berbahaya **tidak dipakai**.
2. **File performa perlu** → dipakai, dan ternyata **berisi SKU Induk**.
3. **Ambang margin tipis: 10%.**
4. **Halaman Kata Kunci: HAPUS.**
5. **Reasoning tertinggi**, diatur **global di halaman AI**.
6. **Tool tanya SKU disetujui** — dipersempit jadi pertanyaan tertutup, 3 pemicu pasti.

### Peringatan user yang dipatuhi

> "ini perlu informasi yang SANGAT terkini tentang iklan GMX MAX ROAS dan GMV MAX AUTO.
> Jika analisa salah bisa bikin user rugi besar."

→ Dijawab §5.4: sistem dibatasi pada **titik impas dari biaya sendiri**, dilarang
mengklaim tahu perilaku platform, dan wajib menyatakan keterbatasan.

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
