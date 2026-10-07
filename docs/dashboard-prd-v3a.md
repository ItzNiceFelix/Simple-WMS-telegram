# PRD Addendum v3a - Dashboard "Bot Admin Toko" (Permintaan Harian Interaktif + Keyword Notes)

> Status: **ADDENDUM** untuk `docs/dashboard-prd.md` (v1) dan `docs/dashboard-prd-v2.md` (v2).
> Dokumen ini TIDAK menggantikan v1/v2. Semua keputusan v1 & v2 tetap berlaku kecuali yang
> diubah eksplisit di sini. Pola-pola v2 (route, state UI, data-access, matriks izin) **diacu**,
> tidak diulang.
> Referensi acuan (dibaca, bukan disalin): v2 S7.1 matriks izin, v2 S11 DataSource,
> v2 S12 state UI/401. Pola route teladan: `app/api/stok/reorder-point/route.ts`.
>
> Bahasa produk: Bahasa Indonesia. Penulis: PRD specialist. Konsumen: agent server/model + agent UI/UX.
>
> **Lingkup tunggal dokumen ini: v3a.** v3b (sinkron A2/A5/A7: konfirmasi draft bot, tambah produk,
> approve akses) DILUAR scope dan dilarang diimplementasikan dari dokumen ini.

> **Changelog (revisi pasca-review `dashboard-prd-v3a-review.md`, 2026-09-15):**
> - **B1:** `datang` saat `draft` -> eksplisit 409 (baris transisi S3.1 + tabel validasi S5.1).
> - **B2:** `buat-form` SELALU snapshot `qty_diminta = qty` untuk SETIAP item (termasuk item bot yang hanya punya `qty`); UI baca `qty_diminta ?? qty`.
> - **B3:** Normalisasi item dipindah ke jalur baca UI (`real.ts`/`mock.ts`), bukan hanya model server.
> - **B4:** Narasi cast `dataKosong` dikoreksi (`satisfies DataSource`, `tsc` menagih otomatis).
> - **B5:** Audit `sesuaikan` -> array `perubahan[]` di dokumen (max 50) + `updated_at`/`updated_by` (bukan `console.info`).
> - **B6:** Item `qty 0`/`qty_diminta 0` otomatis dianggap selesai; tidak menghalangi auto-`selesai`.
> - **T1:** Gabung duplikat HANYA bila `kode_barang`+`variasi`+`buffer` sama.
> - **T4:** Route `/api/kata-kunci` DIBATALKAN; aksi `kata-kunci` titip di `POST /api/admin` baru.
> - Non-blocking: dead code `updateStatusDailyRequest`, guard tanggal server-side, `stock_write_guard`, seksi Riwayat existing, badge desync, keyword admin read-only.
>
> ---
---

## 1. Ringkasan

v3a membuat dua perubahan yang **tidak menyentuh runtime/sesi bot** sama sekali:

1. **F1 - Permintaan Harian interaktif.** Halaman `/permintaan` (sekarang read-only,
   `app/permintaan/page.tsx`, 230 baris) menjadi interaktif dengan state machine
   `draft -> diproses -> selesai`: admin bisa menyetel qty, mengirim form permintaan ke owner+admin
   via Telegram, dan menandai barang datang per item.
2. **F2 - Keyword Notes.** Halaman baru `/kata-kunci` yang menjadi **UI pertama** untuk memanggil
   `konfirmasiKeyword()` (`lib/models/keywordNotes.js:59`) yang sudah ada dan diekspor
   (`:117`) tetapi **tidak pernah dipanggil siapa pun** di seluruh repo.

### 1.1 Latar belakang F2 (kebocoran fungsional terverifikasi)

`lib/models/keywordNotes.js` menyimpan penanda (keyword) baru dengan `confidence: "guessed"`
(`simpanKeywordBaru`, baris 31-43). Baik `cariKeywordNote()` maupun loop resolusi
`ambilActionTypeUntukPenanda()` (baris 86-109) **selalu** memetakan penanda berstatus `guessed`
ke `action_type: "perlu_request"` (default aman, baris 108) meskipun `interpreted_as` - hasil
usulan AI - mungkin `STOK` atau `MINTA_SISA`. Penanda hanya akan keluar dari kondisi ini bila
`confidence` menjadi `"confirmed"`, dan satu-satunya fungsi yang menulis nilai itu adalah
`konfirmasiKeyword()` (baris 59-67) yang **belum punya pemanggil**.

Konsekuensi yang dapat diobservasi:
- Setiap penanda baru selamanya diperlakukan `perlu_request` (masuk permintaan gudang cabang),
  bahkan bila AI menebak `STOK` (idealnya memotong stok gudang online).
- `petakanInterpretasiKeActionType()` (baris 71-78) tidak pernah efektif untuk penanda baru.
- Tidak ada jalur bagi admin untuk mengoreksi tebakan AI - kamus adaptif tidak pernah "belajar".

v3a menutup kebocoran ini dengan halaman konfirmasi, tanpa duplikasi fungsi model.

### 1.2 Daftar fitur v3a (scope disetujui, tidak lebih)

| # | Fitur | Role (lihat S7) | Halaman | Route baru |
|---|---|---|---|---|
| F1 | Permintaan Harian interaktif (ubah qty, kirim form, barang datang, selesai) | owner + admin | `/permintaan` | `POST /api/permintaan` (gabungan, 1 route) |
| F2 | Keyword Notes (konfirmasi interpretasi penanda: owner ubah, admin lihat) | owner (ubah) + admin (lihat) | `/kata-kunci` (baru) | aksi `kata-kunci` dititip di `POST /api/admin` (gabungan, T4/S6.4) |

**Keputusan route gabungan (BATASAN KERAS):** seluruh aksi F1 masuk **satu** route
`POST /api/permintaan` dengan diskriminator `aksi`. Budget function Vercel Hobby = 12.

### 1.3 Non-goals v3a (jangan diimplementasikan)

- **v3b secara keseluruhan:** konfirmasi draft bot (A2), tambah produk (A5), approve akses (A7).
- Sesi/state bot, command bot, runtime Gemini - TIDAK disentuh. Tidak ada perubahan pada
  `lib/gemini/**`, `lib/handlers/**`, `lib/router/**`.
- Mengubah penanda di `keyword_notes` dari bot (v3a hanya memberi UI konfirmasi; nilai default
  `guessed` -> `perlu_request` di bot TETAP, hanya kini bisa dikonfirmasi).
- Notifikasi Telegram per-item barang datang (F1 hanya mengirim form permintaan; aksi
  `datang`/`selesai` TIDAK mengirim pesan, keputusan S4.5).
- Role baru/permission custom, theme per-user, tulis Firestore langsung dari client SDK.
- Edit/hapus item dari `daily_requests` (v3a hanya menyesuaikan qty item yang sudah ada).
- Membatalkan/mengembalikan dokumen `selesai` (keputusan S4.4).

---

## 2. Persona, JTBD, dan user story

Persona & JTBD diwarisi dari v1 S8/S9: owner (Budi), admin operasional.

### 2.1 F1 - Permintaan Harian

> Sebagai **owner/admin**, saya mau menyetel ulang jumlah permintaan, mengirimnya ke gudang cabang
> lewat Telegram, dan menandai barang saat tiba, supaya rekap kebutuhan harian akurat dan riwayat
> penerimaan tercatat tanpa menyentuh Firestore manual pada alur normal. (Pengecualian: koreksi
> dokumen `selesai` yang salah - lihat S4.4 - tidak punya jalur UI dan harus lewat intervensi manual
> owner/dev; ini gap yang diakui, OQ-7.)

User story turunan:
- US-F1-1: Sebagai admin, ketika saya membuka "Ubah Jumlah", saya melihat saran qty = kekurangan
  stok gudang online (`max(0, -stok_gudang_online)`), supaya saya tidak perlu menghitung manual.
- US-F1-2: Sebagai admin, saya mau menimpa saran qty, supaya saya bisa meminta lebih/kurang dari
  kekurangan sistem.
- US-F1-3: Sebagai admin, saya mau menekan "Kirim Form" dan seluruh owner+admin menerima pesan
  Telegram berisi daftar permintaan dalam format plain-text identik dengan template S3.5 (diuji string equality; tanpa `parse_mode`; <= 4096 karakter).
- US-F1-4: Sebagai admin, saya mau menandai tiap item "Barang Datang" dengan qty aktual (boleh
  beda dari qty diminta), supaya selisih kiriman tercatat.

### 2.2 F2 - Keyword Notes

> Sebagai **owner**, saya mau melihat penanda yang belum dikonfirmasi dan menetapkan artinya
> (potong stok / minta gudang / minta sisa), supaya kamus penanda tidak selamanya dipaksa
> `perlu_request` dan AI bisa belajar dari koreksi saya.

User story turunan:
- US-F2-1: Sebagai owner, saya mau memfilter penanda yang belum dikonfirmasi, supaya fokus
  mengoreksi tebakan AI terbaru.
- US-F2-2: Sebagai owner, saya mau mengubah interpretasi penanda -> statusnya menjadi `confirmed`,
  sehingga `petakanInterpretasiKeActionType()` mulai berlaku untuk penanda itu.

---

## 3. Fitur F1 - Permintaan Harian interaktif

### 3.1 State machine

```
```
draft --[Kirim Form]--> diproses --[Barang Datang, semua item]--> selesai
  |                        |
  +--[Ubah Jumlah]---------+   (Ubah Jumlah juga berlaku di diproses)
```

Aturan transisi (eksplisit):

| Dari | Aksi | Ke | Syarat | Bila syarat gagal |
|---|---|---|---|---|
| `draft` | Ubah Jumlah | `draft` | dokumen punya >= 1 item | 400 `"Permintaan belum berisi item."` |
| `draft` | Kirim Form | `diproses` | dokumen punya >= 1 item | 400 `"Permintaan belum berisi item."` |
| `draft` | **Barang Datang** | - | **DITOLAK SELALU** | **409 `"Kirim form dulu sebelum menandai barang datang."`** |
| `draft` | **Selesai manual** | - | **DITOLAK SELALU** | **409 `"Kirim form dulu sebelum menyelesaikan permintaan."`** |
| `diproses` | Ubah Jumlah | `diproses` | ada minimal 1 item yang belum `datang` | 409 `"Item yang sudah datang tidak bisa diubah."` |
| `diproses` | Kirim Ulang | `diproses` | dokumen punya >= 1 item | 400 `"Permintaan belum berisi item."` |
| `diproses` | Barang Datang (per item) | `diproses` atau `selesai` | item belum `datang` | 409 `"Item ini sudah ditandai datang."` |
| `selesai` | aksi apa pun | - | - | 409 `"Permintaan sudah selesai."` |

**B1 (keputusan final):** aksi `datang` HANYA sah saat dokumen `diproses`. Bila dipanggil saat dokumen
`draft` -> **409 `"Kirim form dulu sebelum menandai barang datang."`** (bukan 400, bukan 404). Alasan:
dokumen `draft` belum punya snapshot `qty_diminta` (snapshot terjadi di `buat-form`, S4.3), sehingga
`qty_datang` akan ada tanpa `qty_diminta` acuan. Batas ini diuji test #10b.

**B6 (keputusan final - item qty 0):** item dengan `qty_diminta === 0` (termasuk item yang `qty === 0`
dan belum pernah di-snapshot) **OTOMATIS dianggap selesai**: tidak perlu ditandai `datang`, tidak
menghalangi dokumen menjadi `selesai`. Definisi auto-`selesai` (S4.4) menjadi: **SEMUA item memenuhi
`status === "datang"` ATAU `qty_diminta === 0`** (atau `qty === 0` bila `qty_diminta` belum ada).
Item yang otomatis selesai ini ditampilkan UI sebagai badge "Tidak diminta" (read-only), bukan tombol
"Barang Datang". Alasan: barang yang tidak diminta mustahil "datang"; tanpa aturan ini dokumen
nyangkut `diproses` selamanya. Diuji test #5b & #12.

Status dokumen (nilai string) mengikuti pola lama: `draft`, `diproses`, `selesai`.
**Backward-compat status lama:** dokumen lama (bot) menulis `status: "draft"` (`dailyRequests.js:30,44`).
Dokumen berstatus lain yang tidak dikenal (mis. mock lama `"sent"`) diperlakukan sebagai `draft`
oleh UI (bukan error). Lihat S6.
### 3.2 Tombol per status (mobile-first, h-11, nama Bahasa Indonesia)

| Status | Tombol (urutan kiri->kanan) |
|---|---|
| `draft` | **Ubah Jumlah** (`outline`) + **Kirim Form** (`primary`) |
| `diproses` | **Ubah Jumlah** (`outline`) + **Kirim Ulang** (`outline`) + **Barang Datang** (`primary`) |
| `selesai` | Badge "Selesai", tanpa tombol, read-only |

- Semua tombol `h-11` (target sentuh >= 44px, ui-spec S6) dan `disabled` saat `mengirim`.
- Penamaan lolos ui-spec S7 (semua istilah Bahasa Indonesia; "Form" boleh karena sudah dipakai
  di v2/nav "Permintaan").

### 3.3 Aksi 1 - Ubah Jumlah

- Membuka dialog (pola `components/dashboard/dialog-koreksi-stok.tsx`).
- Setiap baris item menampilkan: `nama`, `kode_barang`, `variasi`, **stok gudang online saat ini**,
- Aturan saran: `max(0, -stok_gudang_online)`. Stok `null` -> saran `0`. Stok `>= 0` -> saran `0`.
  Admin boleh menimpa saran dengan nilai apa pun yang valid (S3.7).
- Item yang tidak punya dokumen `stock` -> saran `0`, stok ditampilkan `—` (`formatAngka(null)`
  mengembalikan `"—"` U+2014, bukan `-`; lihat `lib/dashboard/format.ts:53`).
- Simpan mengirim `POST /api/permintaan` `aksi: "sesuaikan"` berisi daftar qty baru.
- Item baru TIDAK bisa ditambah/dihapus dari dialog ini (non-goal S1.3).
- **Nilai awal input qty:** `item.qty_diminta ?? item.qty` (B2/S4.2). Item dari bot yang belum pernah
  di-snapshot hanya punya `qty`, sehingga fallback ini WAJIB agar input tidak kosong/`""`.

### 3.4 Aksi 2 - Kirim Form / Kirim Ulang

Saat submit sukses (urutan server, S5.3):
1. Set `status: "diproses"`.
2. **Snapshot** qty saat ini ke `qty_diminta` per item (item yang `qty_diminta`-nya sudah ada dan
   statusnya `datang` TIDAK diubah snapshot-nya; lihat S4.3).
3. Catat `form_dibuat_at` (Date) dan `form_dibuat_by` (= `sesi.uid`).
4. Kirim pesan Telegram ke SEMUA owner + admin via `ambilSemuaAdminByRole` (gabungan).
4. Kirim pesan Telegram ke SEMUA owner + admin via `ambilSemuaAdminByRole` (gabungan).

**B2 (keputusan final - sumber angka snapshot):** pada `buat-form`, server **SELALU** menetapkan
`qty_diminta = qty` (snapshot saat itu) untuk **SETIAP** item yang belum `datang` - termasuk item yang
`qty_diminta`-nya masih `undefined`. Alasan konkret: item dari bot (`tambahItemKeDailyRequest`,
`lib/models/dailyRequests.js:46-55`) hanya menulis `{ kode_barang, nama, variasi, qty, buffer }` tanpa
`qty_diminta`. Bila snapshot dilewatkan (`qty_diminta` tetap `undefined`), `formatPesanPermintaan`
memanggil `formatAngka(undefined)` -> `"—"` (`format.ts:53`) dan pesan Telegram pecah. Karena itu
snapshot TIDAK boleh bergantung pada keberadaan `qty_diminta` sebelumnya; acuannya selalu field `qty`.
Aturan ini menggantikan tafsir lama "hanya bila belum ada". Diuji test #4 & #4b.
**Penting (bug pernah terjadi):** pengiriman WAJIB memakai `admin.telegram_user_id`
(`lib/models/admins.js:126-129` mengembalikan field `telegram_user_id`, BUKAN `id`). Mengirim ke
`admin.id` menghasilkan `undefined` -> pesan tidak pernah sampai. Ini bug B1 v2 yang sudah diperbaiki
di `lib/reminder/*`; F1 tidak boleh mengulanginya. Test wajib membuktikan id yang diterima valid.
`kirimPesan(chatId, teks, opsi)` (`lib/telegram/kirimPesan.js:72`) default `parse_mode = "Markdown"`.
Karena teks dinamis (nama produk) berisiko "can't parse entities", pesan WAJIB dikirim plain tanpa
`parse_mode`. Karena `parseMode: ""` tetap lolos operator `||` ke `"Markdown"`, **keputusan: tambah
helper `kirimPesanPlain(chatId, teks)` (perlu dibuat, `lib/telegram/kirimPesan.js`)** yang memanggil
`panggilTelegramApi("sendMessage", { chat_id, text, disable_web_page_preview: true })` TANPA
`parse_mode`. Satu pintu Telegram + mudah di-stub di test.

Kegagalan kirim ke satu/semua admin:
- TIDAK me-rollback status `diproses` (status sudah berubah = fakta). Pola sama v2 E4.
- Route tetap balas **200** dengan `peringatan_kirim: true` dan `kirim_gagal: <jumlah admin gagal>`.
- Log `[permintaan_kirim_gagal]` per admin gagal (tanpa token).
- UI menampilkan toast sukses + toast warning "Form tersimpan, tapi sebagian pesan gagal terkirim."

### 3.5 Format pesan Telegram final (plain, mudah di-copy)

Aturan:
Aturan:
- Tanpa `parse_mode` (plain text) -> aman dari karakter `* _ backtick [ ]` di nama produk.
- Tanggal pesan = tanggal dokumen (`YYYY-MM-DD`), diformat `formatTanggalSingkat` ->
  contoh "15 Sep 2026" (`lib/dashboard/format.ts:80`). **Catatan:** `formatTanggal` (baris 67)
  menyertakan jam `, 14:30`; pesan memakai bentuk **tanpa jam** -> gunakan `formatTanggalSingkat`,
  bukan `formatTanggal`. Contoh di brief ("15 Sep 2026") mengonfirmasi ini.
  - **TZ:** `formatTanggalSingkat("2026-09-15")` memakai `new Date("2026-09-15")` = tengah malam UTC.
    Di server UTC + locale `id-ID`, hasil = "15 Sep 2026"; di TZ barat UTC, bisa jadi "14 Sep 2026".
    Keputusan: tanggal pesan dihitung dari string `YYYY-MM-DD` secara UTUH tanpa `new Date()` -
    pecah manual `y,m,d` lalu map nama bulan (`formatTanggalSingkatDariId`) yang perlu dibuat di
    `lib/dashboard/format.ts`, ATAU set `timeZone: "UTC"` eksplisit di `Intl.DateTimeFormat`.
    Diuji test #7b dengan `process.env.TZ="America/New_York"`. Tidak boleh mengandalkan TZ server.
- Item diurutkan stabil alfabetis `nama` (case-insensitive, "a" < "b" < "Z"), fallback `kode_barang`
  bila `nama` kosong; tie-break terakhir `kode_barang` lalu `variasi`, agar pesan deterministik.
- qty baris item memakai `formatAngka`.
- **Sumber angka qty = `qty_diminta ?? qty`** (B2/S4.2). Pesan menampilkan jumlah yang DIKIRIM/diminta,
  bukan `qty` yang mungkin sudah diubah setelah kirim (S4.3).
- **Sumber angka Total: jumlah yang SAMA dengan baris item** (`qty_diminta ?? qty`), bukan `qty`.
  Dengan begitu "Total" selalu konsisten dengan daftar di atasnya, termasuk pada Kirim Ulang setelah
  `sesuaikan`.
- Header/footer TETAP; nomor urut 1..N.

**Contoh literal (WAJIB sama persis formatnya).** Separator WAJIB karakter **U+00B7 MIDDLE DOT**
(`·`), ditulis di kode sebagai escape `"\u00b7"` (bukan titik ASCII `"."`, bukan spasi-titik-spasi).
Di bawah ini separator ditampilkan sebagai `\u00b7` agar tidak ada ambiguitas glyph:

```
Permintaan Stok ke Gudang Cabang
15 Sep 2026

1. Kemeja Flanel Lengan Panjang
   BRG-001 \u00b7 12 pcs
2. Celana Chino Slim Fit
   BRG-003 \u00b7 10 pcs

Total: 2 item \u00b7 22 pcs
```

Catatan: teks di atas adalah representasi dengan escape literal; string/template di kode WAJIB
menghasilkan karakter `·` (U+00B7) pada posisi escape itu. Test #7 membandingkan string ASTUAL
(hilang escape), dan WAJIB gagal bila implementer memakai titik ASCII `"."`. Nilai harapan test
ditulis di spec sebagai `"BRG-001 \u00b7 12 pcs"` (escape di source test).

Bila item punya `variasi !== "-"`, baris kedua menjadi `` `kode \u00b7 variasi \u00b7 qty pcs` ``.
Bila `variasi === "-"`, variasi dihilangkan (tetap `kode \u00b7 qty pcs`).

Catatan: header contoh di user brief memakai emoji di baris pertama. Untuk pesan plain yang bisa
di-copy bersih TANPA risiko encoding, **keputusan: TIDAK memakai emoji** (header persis seperti blok
di atas). Bila produk menghendaki emoji, cukup awali baris pertama dengan emoji clipboard; ini satu
baris perubahan dan dicatat sebagai open question S11 (OQ-2).

### 3.6 Aksi 3 - Barang Datang

- Per item: set `status: "datang"`, `qty_datang` (integer >= 0, boleh beda dari `qty_diminta`),
  `datang_at` (Date), `datang_by` (= `sesi.uid`).
- Bila SEMUA item `status: "datang"` ATAU `qty_diminta === 0` -> dokumen otomatis `selesai`:
  set `selesai_at`, `selesai_by`. Lihat B6 (S3.1) & S4.4.
- UI menampilkan input `qty_datang` per item dengan default = `qty_diminta ?? qty` (B2/S4.2).
- Item yang sudah `datang` tidak dirender kontrol (read-only, tampil `qty_datang`).
- Item dengan `qty_diminta === 0` (atau `qty === 0` bila belum di-snapshot) ditampilkan badge
  **"Tidak diminta"** (read-only), TANPA tombol "Barang Datang" - item ini otomatis selesai (B6).

### 3.7 Identifier item & validasi qty

**Keputusan IDENTIFIER: key = `kode_barang` + `variasi` + `buffer` (bukan index array).** Alasan:
index array berubah saat array ditulis ulang oleh transaksi concurrent (mis. bot menambah item);
`kode_barang`+`variasi`+`buffer` stabil dan `kode_barang`+`variasi` sudah dipakai `key` React
(`page.tsx:119,170`). Format key internal: `${kode_barang}::${variasi}::${buffer}`.

**Keputusan DUPLIKAT (T1, final): item digabung HANYA bila `kode_barang` + `variasi` + `buffer`
SAMA PERSIS (>1 item dengan ketiganya identik).** Bila `buffer` berbeda (satu `true`, satu `false`),
item TETAP DIPISAH - karena `buffer: true` bermakna `MINTA_SISA` (perlu_request_buffer) dan
`buffer: false` bermakna `MINTA` (perlu_request); menggabung keduanya kehilangan semantik permintaan
gudang. Alasan lain penggabungan tetap berlaku: (a) data lama dari bot bisa punya duplikat identik;
(b) menghindari baris ganda saat kirim form. Implementasi: helper `gabungItemDuplikat(items)` (perlu
dibuat, `lib/models/dailyRequests.js`) dipakai saat baca & saat transisi form. Aturan merge:
- Kunci gabung = `${kode_barang}::${variasi}::${buffer}`.
- `qty` dijumlahkan; `nama` = item **pertama** (stabil, tidak berubah urutan); `buffer` = nilai kunci
  (karena kunci sudah memuat flag, semua sumber bernilai sama).
- `status` gabungan: `"datang"` bila SEMUA sumber `datang`, jika tidak `"diminta"` (konservatif).
- `qty_diminta`/`qty_datang`: dijumlahkan untuk sumber ber-status setara; bila campuran (sebagian
  `datang`), item `datang` dan belum `datang` TIDAK digabung (kunci diperluas dengan status efektif).
- Hanya berlaku untuk keputusan gabung saat ini; item `buffer` beda = dua baris terpisah.

**Aturan qty (server-side, eksplisit):**
- `qty` (Ubah Jumlah) dan `qty_datang`: `Number.isInteger` dan `>= 0`. `0` sah (item sah tapi tidak
  diminta/tidak datang; mis. admin tahu stok ternyata cukup). `qty_diminta === 0` mengikuti aturan
  auto-selesai B6 (S3.1/S4.4).
- Negatif -> 400 `"Jumlah harus bilangan bulat >= 0 (maks 1.000.000)."`
- String `"12"` -> 400 (tanpa `Number()` implisit; paritas v2).
- `qty_datang` > `qty_diminta` SAH (barang bisa datang lebih; selisih tersimpan apa adanya).
- Batas atas qty: 1.000.000 (guard anti-salah-ketik) -> 400 pesan yang sama.
### 3.8 Izin per role (F1)

| Aksi | Owner | Admin | Guest | Non-admin |
|---|---|---|---|---|
| Lihat `/permintaan` | **ya** | **ya** | tidak (nav tersembunyi) | tidak (401/403) |
| Ubah Jumlah (`sesuaikan`) | **ya** | **ya** | tidak | tidak |
| Kirim Form / Kirim Ulang (`buat-form`) | **ya** | **ya** | tidak | tidak |
| Barang Datang (`datang`) | **ya** | **ya** | tidak | tidak |
| Selesai otomatis | otomatis | otomatis | - | - |

Guest dilarang total (konsisten rules `daily_requests` v1: `allow read: if staff()`).

### 3.9 UI + state

Halaman: `app/permintaan/page.tsx` (diubah dari read-only). Nav sudah ada (`nav-config.ts:30`,
owner+admin). Tidak ada perubahan nav untuk F1.

| State | Perilaku |
|---|---|
| Loading | Skeleton existing (`Memuat`, `page.tsx:219`) dipertahankan |
| Kosong (belum ada dokumen hari ini) | Empty existing "Belum ada permintaan hari ini." |
| Kosong (dokumen ada, 0 item) | Empty "Permintaan ini belum berisi item." + tombol aksi DISABLED (lihat S8 E1) |
| Error muat | Alert existing + "Coba lagi" |
| Guest | Tidak sampai halaman (nav tersembunyi + `ButuhAkses`) |
| Dokumen `selesai` | Badge "Selesai"; tanpa tombol; item menampilkan `qty_diminta` vs `qty_datang` |
| Dialog Ubah Jumlah | Item + stok saat ini + saran qty + input; submit `disabled` saat mengirim |
| Submit sukses | Toast kontekstual (`"Jumlah diperbarui"` / `"Form terkirim"` / `"Barang datang dicatat"`); dialog tutup; refetch `listDailyRequests()` |
| Submit sukses + `peringatan_kirim` | Toast sukses + toast warning "Form tersimpan, tapi sebagian pesan gagal terkirim." |
| Error 400/404/409 | Error inline pesan server; dialog tetap terbuka; isian DIPERTAHANKAN |
| Error 401 mid-write | Toast `SESI_KEDALUWARSA` (`lib/dashboard/pesan.ts:9`) + tombol "Buka ulang" (`bukaUlangTelegram`); dialog TIDAK ditutup; isian form DIPERTAHANKAN di memori (v1 S11.2) |
| Error 500/network | Toast "Gagal menyimpan. Coba lagi."; dialog tetap terbuka |
| Error 500/network | Toast "Gagal menyimpan. Coba lagi."; dialog tetap terbuka |
| **Riwayat (existing)** | Seksi Riwayat (`app/permintaan/page.tsx:130-190`, tabel tanggal lampau) + Empty riwayat (`:140-151`) **DIPERTAHANKAN apa adanya**; periode lampau read-only (tanpa tombol aksi - lihat S8 E8) |
| **Empty existing hari ini** | Empty `page.tsx:96-106` ("Belum ada permintaan hari ini.") **DIPERTAHANKAN** |
| **Badge desync (keputusan)** | Item dengan `qty !== (qty_diminta ?? qty)` DAN dokumen `diproses` menampilkan badge kecil **"Qty berubah sejak kirim"** (indikator kuning, `title="Qty sekarang berbeda dari yang dikirim ke gudang"`). Alasan: setelah `sesuaikan` pasca-kirim, pesan Telegram sudah terkirim dengan qty lama - UI harus jujur soal selisih itu; tanpa badge, admin bisa mengira gudang sudah menerima qty baru |
| **Item qty 0** | Badge "Tidak diminta" (B6); tanpa tombol "Barang Datang" |
| **Bundle "selesai" tidak bisa dibatalkan** | Saat tombol "Barang Datang" terakhir akan menyelesaikan dokumen, tampil **dialog konfirmasi dua-langkah**: "Tandai semua barang datang? Dokumen akan selesai dan tidak bisa diubah." Tanpa konfirmasi, aksi tidak dikirim |

`data-testid` baru: `aksi-ubah-jumlah`, `aksi-kirim-form`, `aksi-kirim-ulang`, `aksi-barang-datang`,
`dialog-ubah-jumlah`, `dialog-konfirmasi-selesai`, `input-qty-{kode}::{variasi}`,
`badge-selesai`, `badge-tidak-diminta`, `badge-qty-desync`.

**Catatan `data-testid` (non-blocking #7):** `input-qty` memakai `${kode_barang}::${variasi}` (BUKAN
hanya `{kode}`) supaya dua varian dengan `kode_barang` sama tidak bertabrakan.
---

## 4. Data & aturan F1

### 4.1 Skema `daily_requests` diperluas (WAJIB backward-compatible)

Item (`DailyRequestItem`), field baru:
Item (`DailyRequestItem`), field baru:

| Field | Tipe | Wajib baru? | Keterangan |
|---|---|---|---|
| `qty_diminta` | number | ya (saat form dikirim) | snapshot qty saat form dibuat |
| `status` | `"diminta" \| "datang"` | ya (default saat baca) | status per item |
| `qty_datang` | number \| null | ya (saat datang) | qty aktual diterima |
| `datang_at` | string \| null (ISO) | ya (saat datang) | waktu diterima |
| `datang_by` | string \| null | ya (saat datang) | telegram user id pelaku |

Item LAMA (tanpa field ini) tetap valid: dibaca dengan `status` efektif `"diminta"`, `qty_diminta`
efektif = `qty` lama, `qty_datang`/`datang_at`/`datang_by` = `null`.

**Konsistensi tipe waktu (non-blocking #23):** `DailyRequestItem` di `lib/dashboard/types.ts:103-109`
dipakai UI (client) dan field `created_at` dokumen sudah bertipe `string` (ISO) di UI
(`types.ts:116`), meski model server menulis `Date` (`dailyRequests.js:30,44`). Agar tidak menambah
konversi tipe baru di UI, field waktu item **di UI didefinisikan `string | null` (ISO)**, dan
normalizer di `real.ts` (S4.2) mengonversi `Date` Firestore -> ISO via `keIso`, sama seperti
`created_at` di `real.ts:346`. Model server tetap menyimpan objek `Date` (konvensi Firestore).

Dokumen (`DailyRequestDoc`), field baru:

| Field | Tipe | Keterangan |
|---|---|---|
| `form_dibuat_at` | string \| null (ISO) | waktu Kirim Form/Ulir terakhir |
| `form_dibuat_by` | string \| null | uid pelaku kirim terakhir |
| `selesai_at` | string \| null (ISO) | waktu dokumen jadi `selesai` |
| `selesai_by` | string \| null | uid yang memicu item terakhir `datang` |
| `updated_at` | string \| null (ISO) | terakhir dokumen dimodifikasi dashboard |
| `updated_by` | string \| null | uid pelaku modifikasi dashboard terakhir (B5) |
| `perubahan` | `Array<{ key_item, qty_lama, qty_baru, oleh, at }>` | riwayat penyetelan qty (B5), default `[]`, max **50** entri terakhir |

**B5 (keputusan final - audit qty durable):** `sesuaikan` menulis satu entri ke array `perubahan[]`
di dokumen (BUKAN koleksi baru, BUKAN `console.info` saja). Skema entri:

| Field | Tipe | Keterangan |
|---|---|---|
| `key_item` | string | `${kode_barang}::${variasi}::${buffer}` |
| `qty_lama` | number | qty sebelum perubahan |
| `qty_baru` | number | qty setelah perubahan |
| `oleh` | string | uid pelaku (`sesi.uid`) |
| `at` | string (ISO) | waktu perubahan |

- **Batas panjang:** simpan hanya **50 entri TERAKHIR** (append lalu `slice(-50)`) agar dokumen tidak
  membengkak. Entri terlama dibuang saat melebihi 50.
- `updated_at`/`updated_by` di level dokumen di-set pada **setiap** aksi (sesuaikan/buat-form/datang/
  selesai).
- Alasan: `console.info` di Vercel serverless tidak durable (log ephemeral, tanpa kueri). Array
  in-document menjawab "siapa mengubah qty dari X ke Y kapan" tanpa menambah koleksi/route. Diuji
  test #3b (riwayat tercatat) & #3c (pemotongan 50).

Dokumen LAMA tetap valid: `status` efektif `"draft"` bila tidak ada/tidak dikenal,
field baru dianggap `null` (dan `perubahan` dianggap `[]`).

### 4.2 Aturan migrasi eksplisit (lazy, tanpa skrip migrasi)

**Keputusan: migrasi LAZY di lapisan baca, bukan skrip tulis massal.** Alasan: skrip migrasi
menyentuh data produksi & harus dijalankan ulang; lazy normalizer lebih kecil risikonya dan
idempoten.

**B3 (keputusan final - LOKASI normalizer):** ada DUA jalur baca `daily_requests`, dan normalizer
WAJIB ada di KEDUANYA:
1. **Jalur bot/server** (`lib/models/dailyRequests.js`): `ambilDailyRequest`/
   `ambilOrBuatDailyRequestHariIni` menormalisasi saat mengembalikan data (dipakai route tulis &
   bot).
2. **Jalur UI/client** (`lib/dashboard/data/real.ts:338-349`): `listDailyRequests()` membaca langsung
   via client SDK dan saat ini meng-cast mentah `items: (d.data().items ?? []) as DailyRequestDoc["items"]`
   (baris 344). Cast itu TIDAK menambah field baru saat runtime -> `it.qty_diminta` = `undefined`.
   Normalizer server model TIDAK PERNAH jalan di sini. Karena itu `real.ts` WAJIB menormalisasi tiap
   item saat map (dan `mock.ts` + `mock-data.ts` mencerminkan bentuk kanonik yang sama).

**Aturan normalisasi (SATU sumber kebenaran, replika di TS untuk `real.ts`):**
- `status: x.status ?? "diminta"`
- `qty_diminta: x.qty_diminta ?? x.qty`
- `qty_datang: x.qty_datang ?? null`
- `datang_at: keIso(x.datang_at) ?? null`
- `datang_by: x.datang_by ?? null`
- `status` dokumen: `normalisasiStatusDokumen(String(x.status ?? ""))` -> `"draft"` bila bukan
  `"draft" | "diproses" | "selesai"`.
- `perubahan: Array.isArray(x.perubahan) ? x.perubahan : []`.

`normalisasiItemLama(item)`/`normalisasiStatusDokumen(status)` tetap perlu dibuat di
`lib/models/dailyRequests.js` (dipakai route tulis & bot). Untuk UI, logika identik diterapkan di
`real.ts` (boleh helper lokal `normalisasiItemUi`); tidak ada impor lintas bundel server->client.
Item LAMA `{ kode_barang, nama, variasi, qty, buffer }` WAJIB tampil benar di UI (test #1b).

- Penulisan field baru dilakukan saat aksi pertama (lazy write): begitu admin menekan aksi apa pun,
  dokumen/item sudah lengkap. Tidak ada dokumen setengah tulis pada jalur baca.
- Bot tetap menulis `{ items: [...], status: "draft", created_at }` (tidak diubah) -> tetap valid.

### 4.3 Snapshot qty & idempotensi Kirim Ulang

- **B2 (final):** `buatForm` **SELALU** men-snapshot `qty_diminta = qty` untuk **SETIAP** item yang
  belum `datang`, tanpa syarat "hanya bila `qty_diminta` belum ada". Item bot (hanya `qty`) tetap
  mendapat `qty_diminta`. Item yang sudah `datang` TIDAK diubah `qty_diminta`/`qty_datang`-nya
  (mencegah kehilangan catatan penerimaan).
- `sesuaikan` TIDAK mengubah `qty_diminta` (hanya `qty`) -> UI memakai `qty_diminta ?? qty` untuk
  baca & pesan; selisih pasca-kirim ditandai badge desync (S3.9).
- Idempotensi: bila dokumen sudah `diproses` dan `buat-form` dipanggil ulang dalam **< 30 detik**
  setelah `form_dibuat_at` oleh uid yang sama, route mengembalikan 200 dengan
  `{ ok: true, dikirim_ulang: false }` TANPA mengirim Telegram lagi (anti double-tap). Di luar
  30 detik -> benar-benar kirim ulang (`dikirim_ulang: true`).
- **Guard double-submit server (non-blocking #22, keputusan):** `buat-form` MENAMBAH guard
  best-effort bergaya `stock_write_guard` (`app/api/stok/mutasi/route.ts:132-147`): tulis doc
  server-only `permintaan_form_guard/{uid}` = `{ tanggal, at }` sebelum kirim; bila panggilan baru
  < 10 detik dengan `tanggal` sama DAN uid sama -> 409 `"Permintaan sedang dikirim."`. Guard ini
  best-effort (kegagalan guard tidak memblokir aksi sah; `console.error("[permintaan_guard_failed]")`).
  Alasan: idempotensi 30 detik berbasis `form_dibuat_at` bergantung urutan tulis; guard server-only
  mencegah dobel-kirim Telegram saat double-tap paralel. Firestore rules: `permintaan_form_guard/{id}
  { allow read, write: if false; }` (server-only). Diuji test #9b.

### 4.4 Definisi "selesai" otomatis + pembatalan

- **B6 (final):** dokumen menjadi `selesai` ketika aksi `datang` membuat **SEMUA** item memenuhi
  `status === "datang"` **ATAU** `qty_diminta === 0` (atau `qty === 0` bila `qty_diminta` belum
  ada). Item qty 0 otomatis dianggap selesai (tidak perlu ditandai datang, tidak menghalangi).
  Keputusan dievaluasi di dalam `db.runTransaction` (`tandaiItemDatang`) agar tidak ada jendela race
  dua request datang bersamaan.
- Saat berpindah ke `selesai`: set `selesai_at` (ISO), `selesai_by = sesi.uid`, `updated_at/by`.
- Aksi `datang` pada item qty 0 tetap DIIZINKAN (idempoten: item sudah efektif selesai; server
  mengembalikan 409 `"Item ini sudah ditandai datang."` bila tidak ada perubahan; tidak
  menggagalkan auto-selesai).
- **KEPUTUSAN: `selesai` TIDAK dapat dibatalkan/dikembalikan dari dashboard v3a.** Alasan:
  (a) keputusan ini berisiko tinggi (data penerimaan); (b) fitur "batal" butuh audit + guard baru
  yang di luar scope. **Mitigasi eksplisit (non-blocking #T2):** karena tidak ada jalur UI, dokumen
  `selesai` yang salah HARUS dikoreksi manual oleh **owner/dev** lewat Firestore Console (ubah
  `status` dokumen kembali ke `diproses` + hapus `selesai_at`/`selesai_by`) atau lewat `firebase-admin`
  script; prosedur ini dicatat di `docs/dashboard-deploy.md`. UI menampilkan dialog konfirmasi
  dua-langkah sebelum transisi ke `selesai` (S3.9) untuk mencegah salah-tanda. Dicatat sebagai
  **OQ-7** untuk v4 (batalkan / buka kembali dokumen `selesai`).
- Setelah `selesai`, semua aksi F1 -> 409 `"Permintaan sudah selesai."`.

### 4.5 Notifikasi F1

- **Dikirim:** hanya saat `buat-form`/`kirim-ulang` sukses (ke semua owner+admin).
- **TIDAK dikirim:** `sesuaikan`, `datang`, `selesai`. Alasan: menghindari spam; status internal
  sudah terlihat di dashboard.
- Kegagalan kirim: tidak fatal (S3.4). Notifikasi TIDAK diulang otomatis; admin bisa "Kirim Ulang".

---

## 5. Kontrak route (BATASAN KERAS)
Budget function Vercel: sekarang **9/12** (terverifikasi: 8 `app/api/**/route.ts` +
`api/webhook.js`). v3a menambah **1 route gabungan** `/api/permintaan` dan **1 route gabungan**
`/api/admin` (aksi `kata-kunci`) -> **11/12**. Lihat analisis T4 di S6.4.

### 5.1 `POST /api/permintaan` (F1, wajib)

- **Path:** `POST /api/permintaan`
- **Runtime:** `nodejs`, `dynamic = "force-dynamic"`.
- **Auth:** cookie `dat_sesi`; role dari `ambilAdmin(sesi.uid)`; WAJIB owner/admin.
- **Pola:** persis `app/api/stok/reorder-point/route.ts`:
  `tolakOrigin` -> cookie -> `verifikasiTokenSesi` -> `cekRateLimit` -> parse -> validasi ->
  `ambilAdmin` -> model -> `console.info`.
- **Rate limit:** `permintaan:{uid}` **30/menit** (aksi campuran). **Catatan (non-blocking #5):**
  rate limit ini soft-guard in-memory per-instance (`lib/dashboard/auth/guard.js`), TIDAK reliabel
  lintas lambda, jadi jangan diklaim "menahan spam" absolut. Klaim yang benar: "maksimum 30 panggilan
  per uid per 60 detik **per instance**; diuji via test route (#10)." Pertimbangkan menghitung
  `sesuaikan` terpisah dari `buat-form` bila operasional menyetel banyak item (opsional).
- **Body:**

```json
{ "aksi": "sesuaikan", "tanggal": "2026-09-15", "qty": [ { "kode_barang": "BRG-001", "variasi": "-", "qty": 12 } ] }
{ "aksi": "buat-form", "tanggal": "2026-09-15" }
{ "aksi": "datang", "tanggal": "2026-09-15", "item": { "kode_barang": "BRG-001", "variasi": "-", "qty_datang": 10 } }
{ "aksi": "selesai", "tanggal": "2026-09-15" }
```

Keputusan: `aksi: "kirim-ulang"` TIDAK dipisah - aksi UI "Kirim Ulang" memakai `aksi: "buat-form"`
yang sama (server membedakan via state & idempotensi). Kontrak body tetap 4 nilai: `sesuaikan`,
`buat-form`, `datang`, `selesai`.

**Kebijakan tanggal (non-blocking #2 - keputusan final):** guard "hanya tanggal hari ini" saat ini
hanya di KLIEN; server menerima `tanggal` lampau dari body. Keputusan server-side:

| Aksi | Tanggal hari ini | Tanggal lampau | Alasan |
|---|---|---|---|
| `buat-form` | boleh | **boleh** | kirim ulang form yang belum terkirim (mis. lupa kirim kemarin) |
| `datang` | boleh | **boleh** | barang bisa datang telat |
| `selesai` | boleh | **boleh** | menutup dokumen lama yang sudah selesai fisik |
| `sesuaikan` | boleh | **DITOLAK 400 `"Hanya permintaan hari ini yang bisa diubah."`** | mencegah edit retroaktif yang mengacaukan audit/pesan terkirim |

Semua aksi lampau WAJIB tetap **owner/admin** (guard role yang sama), TIDAK dibuka untuk tanggal
masa depan (`tanggal > hari ini` -> 400 `"Tanggal tidak valid."`). Alasan pembatasan: audit & pesan
Telegram sudah terkirim untuk dokumen lampau; membiarkan `sesuaikan` retroaktif membuat qty dokumen
dan pesan tidak sinkron tanpa jejak. Diuji test #10c.

Validasi per aksi + status + pesan:

| Cek (berlaku semua aksi) | Status | `error` |
|---|---|---|
| `tolakOrigin` gagal | 403 | `"Origin tidak diizinkan."` |
| cookie/sesi invalid | 401 | `"Sesi kedaluwarsa. Buka ulang dari Telegram."` (persis `SESI_KEDALUWARSA`) |
| rate limit | 429 | `"Terlalu banyak permintaan. Coba lagi sebentar lagi."` |
| body bukan JSON | 400 | `"Body tidak valid."` |
| `aksi` bukan salah satu nilai | 400 | `"Aksi tidak dikenal."` |
| `tanggal` bukan `YYYY-MM-DD` valid, atau > hari ini | 400 | `"Tanggal tidak valid."` |
| `ambilAdmin` null | 403 | `"Akses ditolak. Hubungi owner."` |
| role guest | 403 | `"Akses ditolak. Hubungi owner."` |
| dokumen `daily_requests/{tanggal}` tidak ada | 404 | `"Permintaan tidak ditemukan."` |
| dokumen `selesai` | 409 | `"Permintaan sudah selesai."` |
| `sesuaikan` dengan `tanggal != hari ini` | 400 | `"Hanya permintaan hari ini yang bisa diubah."` |
| guard double-submit `buat-form` < 10 detik | 409 | `"Permintaan sedang dikirim."` |
| model throw (Firestore) | 500 | `"Gagal memperbarui permintaan."` |

Validasi khusus per aksi:

**`sesuaikan`**

| Cek | Status | `error` |
|---|---|---|
| `qty` bukan array atau kosong | 400 | `"Daftar jumlah wajib diisi."` |
| elemen tanpa `kode_barang` string | 400 | `"Item tidak valid."` |
| `qty` elemen bukan integer >= 0, atau > 1.000.000 | 400 | `"Jumlah harus bilangan bulat >= 0 (maks 1.000.000)."` |
| `kode_barang`+`variasi` tidak ada di dokumen | 404 | `"Item tidak ditemukan di permintaan."` |
| ada item yang sudah `datang` | 409 | `"Item yang sudah datang tidak bisa diubah."` |
| dokumen 0 item | 400 | `"Permintaan belum berisi item."` |
| dokumen `draft` / `diproses` | boleh | (menulis entri `perubahan[]`, B5) |

Sukses 200: `{ ok: true, tanggal, items: [...], status, perubahan_terakhir }`.

**`buat-form` (Kirim Form + Kirim Ulang)**

| Cek | Status | `error` |
|---|---|---|
| dokumen 0 item | 400 | `"Permintaan belum berisi item."` |
| semua item sudah `datang` ATAU `qty_diminta === 0` (B6) | 409 | `"Semua item sudah datang."` |
| idempoten < 30 detik, uid sama | 200 | - (`dikirim_ulang: false`) |
| guard double-submit < 10 detik (S4.3) | 409 | `"Permintaan sedang dikirim."` |

Sukses 200: `{ ok: true, tanggal, status: "diproses", form_dibuat_at, dikirim_ulang: boolean, kirim_terkirim: number, kirim_gagal: number, peringatan_kirim?: boolean }`.
`buat-form` SELALU men-snapshot `qty_diminta = qty` untuk setiap item yang belum `datang` (B2/S4.3).

**`datang`**

| Cek | Status | `error` |
|---|---|---|
| dokumen `draft` (B1) | **409** | **`"Kirim form dulu sebelum menandai barang datang."`** |
| `item` bukan objek / tanpa `kode_barang` | 400 | `"Item tidak valid."` |
| `qty_datang` bukan integer >= 0 (maks 1.000.000) | 400 | `"Jumlah datang harus bilangan bulat >= 0 (maks 1.000.000)."` |
| item tidak ditemukan | 404 | `"Item tidak ditemukan di permintaan."` |
| item sudah `datang` | 409 | `"Item ini sudah ditandai datang."` |

Sukses 200: `{ ok: true, tanggal, status: "diproses"|"selesai", selesai_otomatis: boolean, items: [...] }`.
Auto-`selesai` (B6): berlaku bila semua item `datang` ATAU `qty_diminta === 0`.

**`selesai`**

- Guard: **dokumen harus `diproses`** (dokumen `draft` -> 409 `"Kirim form dulu sebelum menyelesaikan permintaan."`).
- Guard: minimal satu item `datang` ATAU semua item `qty_diminta === 0` (400 `"Belum ada item yang datang."`).
- Aksi ini **WAJIB dipertahankan** (bukan opsional lagi): jalur keluar dokumen dengan item `qty 0`
  (B6) & item yang tidak akan datang fisik. Sukses 200:
  `{ ok: true, tanggal, status: "selesai", selesai_at }`.

### 5.2 Model `lib/models/dailyRequests.js` (perlu dibuat / diperluas)

| Fungsi | Status | Signature / return |
|---|---|---|
| `sesuaikanQtyItem(tanggal, daftar, oleh)` | baru | `(string, Array<{kode_barang,variasi,qty}>, string) -> Promise<doc>`; `runTransaction`; tolak item `datang`; tulis `perubahan[]` (max 50) + `updated_at/by` |
| `buatForm(tanggal, oleh)` | baru | `(string, string) -> Promise<{ doc, itemsFinal }>`; snapshot `qty_diminta = qty` untuk SEMUA item belum `datang` (B2), set `form_dibuat_at/by`, `updated_at/by` |
| `tandaiItemDatang(tanggal, item, qtyDatang, oleh)` | baru | `(string, {kode_barang,variasi}, number, string) -> Promise<{ doc, selesaiOtomatis }>`; `runTransaction`; auto-`selesai` bila semua `datang` ATAU `qty_diminta === 0` (B6) |
| `selesaikanRequest(tanggal, oleh)` | baru | `(string, string) -> Promise<doc>` |
| `gabungItemDuplikat(items)` | baru (helper) | `(items) -> items`; kunci `${kode}::${variasi}::${buffer}`; ekspor untuk test |
| `normalisasiItemLama(item)` | baru (helper) | `(item) -> item`; ekspor untuk test |
| `normalisasiStatusDokumen(status)` | baru (helper) | `(string) -> "draft"|"diproses"|"selesai"`; ekspor untuk test |
| `formatPesanPermintaan(doc)` | baru (helper murni) | `(doc) -> string`; ekspor untuk test |
| `kirimFormPermintaan(doc)` | baru | `(doc) -> Promise<{ terkirim, gagal }>` |
| `ambilOrBuatDailyRequestHariIni()` | ada (`:25`) | tidak diubah (normalizer ditambah di baca) |
| `tambahItemKeDailyRequest` | ada (`:36`) | **TIDAK diubah** (dipakai bot; harus tetap jalan) |
| `updateStatusDailyRequest` | ada (`:63`) | **DEAD CODE - keputusan: DIPAKAI ulang** untuk aksi `selesai` (bukan dibiarkan mati). Lihat catatan di bawah |

**Keputusan dead code `updateStatusDailyRequest` (non-blocking #3):** verifikasi kode membuktikan
fungsi ini (`:63`) diekspor (`:74`) tetapi **NOL pemanggil di `app/`** - klaim lama "tidak diubah
(bot)" SALAH; bot TIDAK memakainya. Keputusan: **pakai ulang `updateStatusDailyRequest(tanggal,
"selesai")` di dalam `selesaikanRequest`** (atau ganti namanya menjadi `selesaikanRequest` bila
signature baru diperlukan). Jangan biarkan dead code menumpuk. Bila `selesaikanRequest` butuh guard
tambahan (minimal satu item datang/B6), guard tinggal di `selesaikanRequest` yang memanggil helper
ini. Diuji test #5c.

Semua mutasi array WAJIB `db.runTransaction` (pola `tambahItemKeDailyRequest:40-58`).
Semua mutasi array WAJIB `db.runTransaction` (pola `tambahItemKeDailyRequest:40-58`).

### 5.3 Handler `kirimFormPermintaan` (perlu dibuat)

Lokasi usulan: `lib/models/dailyRequests.js` (satu pintu model, prinsip v1 S16) ATAU
`lib/permintaan/kirimForm.js`. Rekomendasi: **`lib/models/dailyRequests.js`** agar route tidak
mengimpor Telegram sendiri.

```
kirimFormPermintaan(doc) -> Promise<{ terkirim: number, gagal: number }>
```

- Ambil owner+admin: `[...await ambilSemuaAdminByRole("owner"), ...await ambilSemuaAdminByRole("admin")]`
  (`lib/models/admins.js:126`). Dedupe by `telegram_user_id`.
- Susun teks via `formatPesanPermintaan(doc)` (helper murni, ekspor untuk test).
- Kirim per admin memakai `admin.telegram_user_id` dan `kirimPesanPlain`.
- Bungkus setiap kirim `try/catch`; hitung `terkirim`/`gagal`; jangan throw.
- `console.error("[permintaan_kirim_gagal]", ...)` per kegagalan.

---

## 6. Fitur F2 - Keyword Notes (halaman `/kata-kunci`)

### 6.1 Data & model

Koleksi `keyword_notes` (sudah ada, rules read staff, write false). Skema existing
(`keywordNotes.js`): `raw_text`, `interpreted_as`, `confidence`, `first_seen`, `last_used`,
`usage_count`.

| Fungsi | Status | Signature / return |
|---|---|---|
| `listKeywordNotes()` | **perlu dibuat** (`lib/models/keywordNotes.js`) | `() -> Promise<Note[]>`; semua note, `id` disertakan; urut `last_used` desc |
| `perbaruiInterpretasi(id, interpretedAs, oleh)` | **perlu dibuat** | `(string, "STOK"\|"MINTA"\|"MINTA_SISA", string) -> Promise<Note>` |
| `konfirmasiKeyword(id, interpretedAsFinal)` | ada (`:59`) | **JANGAN duplikasi**; `perbaruiInterpretasi` memanggilnya (set `interpreted_as` + `confidence: "confirmed"` + `last_used`) |
| `petakanInterpretasiKeActionType(interpretedAs)` | ada (`:71`) | dipakai untuk teks bantuan UI |
| `cariKeywordNote`, `simpanKeywordBaru`, `catatPemakaianKeyword`, `ambilActionTypeUntukPenanda` | ada | tidak diubah |

`perbaruiInterpretasi` menambahkan `confirmed_by`/`confirmed_at` (audit ringan, ekstensi aman di
koleksi existing) -> keputusan S9.2.

### 6.2 Terjemahan istilah untuk UI

| `interpreted_as` | Label UI | Arti operasional (rujuk `petakanInterpretasiKeActionType` `:71-78`) |
|---|---|---|
| `STOK` | **Potong Stok Gudang Online** | `action_type: kurangi_stok` |
| `MINTA` | **Masukkan ke Permintaan Gudang Cabang** | `action_type: perlu_request` |
| `MINTA_SISA` | **Permintaan Sisa (Buffer)** | `action_type: perlu_request_buffer` |

Teks bantuan di kolom interpretasi (tooltip/description) memakai kalimat di atas, sehingga admin
tahu konsekuensi konfirmasi. `raw_text` adalah penanda mentah dari picking list (contoh "sisa gdg").

### 6.3 UI + state

Halaman baru `app/kata-kunci/page.tsx`; nav baru di `nav-config.ts` (owner + admin, **admin read-only**
- keputusan non-blocking #T3 / S7.1). Tabel (`Table` shadcn, pola `app/stok/page.tsx`): kolom
`raw_text`, `interpreted_as` (Select/label), `confidence` (Badge: "Belum dikonfirmasi"/"Terkonfirmasi"),
`usage_count`, `last_used`.
Filter `ToggleGroup`: **Semua . Belum Dikonfirmasi**.
Aksi per baris: `Select` interpretasi + tombol "Konfirmasi" -> memanggil `perbaruiInterpretasi`.
**Owner** melihat Select + tombol "Konfirmasi" aktif. **Admin** melihat tabel & filter TANPA kontrol
ubah (Select read-only/label + tidak ada tombol "Konfirmasi").

| State | Perilaku |
|---|---|
| Loading | Skeleton tabel |
| Kosong (semua) | Empty "Belum ada penanda tercatat." |
| Kosong (filter belum dikonfirmasi) | Empty "Semua penanda sudah dikonfirmasi." |
| Error muat | Alert "Gagal memuat daftar penanda." + "Coba lagi" |
| Guest (non-staff) | Halaman tidak dirender (nav + `ButuhAkses`) |
| Admin (read-only) | Tabel tampil; kontrol ubah DISEMBUNYIKAN (bukan 403 di UI); ubah via route -> 403 |
| Submit (owner) | Tombol + Select baris disabled + spinner |
| Sukses (owner) | Toast "Interpretasi penanda diperbarui"; baris pindah ke `confidence: "confirmed"` (refetch) |
| Error 400/404 (owner) | Toast pesan server; Select kembali ke nilai lama |
| Error 401 | Toast `SESI_KEDALUWARSA` + tombol "Buka ulang"; pilihan Select DIPERTAHANKAN |

`data-testid`: `tabel-kata-kunci`, `filter-kata-kunci`, `pilih-interpretasi-{id}`,
`konfirmasi-{id}`, `badge-confidence-{id}`.

### 6.4 Route keyword notes - KEPUTUSAN FINAL (T4): titip di `POST /api/admin`

**Fakta terverifikasi:**
- `firestore.rules:30` -> `keyword_notes` `allow read: if staff()`, `allow write: if false`. Tulis
  dari client SDK MEMANG diblokir; pola client-write TIDAK mungkin tanpa mengubah rules (ditolak).
- Route lama yang ada: `app/api/admin/role/route.ts`, `app/api/admin/tambah/route.ts`,
  `app/api/admin/hapus/route.ts` - TIDAK ada `app/api/admin/route.ts`.
- Budget function = 9/12 sebelum v3a (8 `route.ts` + `api/webhook.js`).

**KEPUTUSAN USER (menggantikan rekomendasi route terpisah):** aksi keyword TIDAK memakai route
`/api/kata-kunci` sendiri. Aksi dititipkan ke **`POST /api/admin`** (route GABUNGAN baru) dengan body
`{ "aksi": "kata-kunci", "id": "<docId>", "interpreted_as": "STOK"|"MINTA"|"MINTA_SISA" }`.
Alasan: hemat margin Vercel (route terpisah akan jadi 12/12, habis; dengan titip di `/api/admin` jadi 11/12, sisa 1) supaya v3b punya ruang; route gabungan dengan
diskriminator `aksi` adalah pola yang sudah ditetapkan untuk F1 (`/api/permintaan`).

**Route `app/api/admin/route.ts` (BARU) - cakupan:**
- v3a mengimplementasikan **satu** aksi: `kata-kunci` (F2).
- Route ini dirancang sebagai **route gabungan aksi admin**: aksi v3b (approve akses dll) menyusul di
  route yang SAMA (ditambah ke `switch`/diskriminator `aksi`), TIDAK membuat route baru.
- Aksi di luar `kata-kunci` pada v3a -> 400 `"Aksi tidak dikenal."` (jangan implementasikan aksi v3b
  dari dokumen ini - non-goal S1.3).

**Analisis trade-off: apakah route lama `admin/role`, `admin/tambah`, `admin/hapus` ikut digabung?**

| Opsi | Kelebihan | Kekurangan | Rekomendasi |
|---|---|---|---|
| Biarkan 3 route lama, tambah `/api/admin` baru | Tidak menyentuh route yang sudah rilis & teruji (v2); risiko regresi 0; diff kecil | 3 function tetap terpakai (total 11/12) | **DEFAULT - dipilih** |
| Gabung ketiganya ke `/api/admin` (aksi `role`/`tambah`/`hapus`) | Hemat 3 function (total 8/12); satu pintu | Mengubah route yang sudah rilis & teruji; butuh migrasi pemanggil UI + test v2 diubah; risiko regresi pada audit role/hapus owner-terakhir | TIDAK dipaksa; kandidat v4 |

**Keputusan: JANGAN refactor route lama.** Default: pertahankan `admin/role`, `admin/tambah`,
`admin/hapus` apa adanya; tambah `app/api/admin/route.ts` baru khusus aksi baru. Alasan: menggabung
mengubah route yang sudah teruji (v2) demi 3 function yang margin-nya belum kritis; biaya regresi
(role audit, guard owner-terakhir) lebih besar dari manfaat. Refactor digabung = kandidat v4 bila
budget mendesak.

**Angka budget function FINAL (eksplisit):**

| Tahap | Function | Total |
|---|---|---|
| Sebelum v3a | 8 `route.ts` + `api/webhook.js` | **9/12** |
| + `/api/permintaan` (F1) | +1 | **10/12** |
| + `/api/admin` (F2 aksi `kata-kunci`, gabungan) | +1 | **11/12** |
| Sisa margin | | **1** |

Catatan: `/kata-kunci` (halaman) statis, tidak menambah function. Route lama (role/tambah/hapus)
tetap dihitung. Margin 1 tersisa untuk v3b; v3b WAJIB memakai route gabungan `aksi` (idealnya menambah
aksi ke `/api/admin` yang sudah dibuat di sini).

### 6.5 Kontrak `POST /api/admin` - aksi `kata-kunci`

- **Path:** `POST /api/admin`; `runtime="nodejs"`, `dynamic="force-dynamic"`.
- **Auth:** cookie sesi; role dari `ambilAdmin`; WAJIB `owner` untuk aksi `kata-kunci`.
- **Pola:** sama seperti S5.1 (`tolakOrigin` -> cookie -> `verifikasiTokenSesi` -> `cekRateLimit` ->
  parse -> validasi `aksi` -> `ambilAdmin` -> model -> `console.info`).
- **Rate limit:** `admin:{uid}` 20/menit (kunci mencakup semua aksi admin; cukup untuk v3a).
- **Body:** `{ "aksi": "kata-kunci", "id": "<docId>", "interpreted_as": "STOK" | "MINTA" | "MINTA_SISA" }`

| Cek | Status | `error` |
|---|---|---|
| origin / sesi / rate limit | 403 / 401 / 429 | pesan standar |
| body bukan JSON | 400 | `"Body tidak valid."` |
| `aksi` kosong / bukan string | 400 | `"Aksi tidak dikenal."` |
| `aksi` != `kata-kunci` (di v3a) | 400 | `"Aksi tidak dikenal."` |
| `id` kosong / bukan string | 400 | `"Id penanda wajib diisi."` |
| `interpreted_as` di luar 3 nilai | 400 | `"Interpretasi tidak dikenal."` |
| `ambilAdmin` null | 403 | `"Akses ditolak. Hubungi owner."` |
| role !== owner | 403 | `"Hanya owner yang dapat mengubah penanda."` |
| note tidak ada | 404 | `"Penanda tidak ditemukan."` |
| model throw | 500 | `"Gagal menyimpan interpretasi penanda."` |

Sukses 200:
`{ ok: true, note: { id, raw_text, interpreted_as, confidence: "confirmed", usage_count, last_used, confirmed_by, confirmed_at } }`.
`confirmed_at`/`confirmed_by` disertakan (non-blocking #4) supaya UI bisa menampilkan audit ringan.

---

## 7. Matriks Izin ADDENDUM (melengkapi v1 S8.1 + v2 S7.1)

Baris baru saja; seluruh baris v1/v2 tetap berlaku.

| Halaman / Aksi | Owner | Admin | Guest | Non-admin |
|---|---|---|---|---|
| `/permintaan` - Ubah Jumlah (F1) | **ya** | **ya** | tidak | tidak |
| `/permintaan` - Kirim Form / Kirim Ulang (F1) | **ya** | **ya** | tidak | tidak |
| `/permintaan` - Barang Datang (F1) | **ya** | **ya** | tidak | tidak |
| `/permintaan` - `sesuaikan` tanggal lampau | **tidak (400)** | tidak (400) | tidak | tidak |
| `/permintaan` - `datang`/`selesai`/`buat-form` tanggal lampau | **ya** | **ya** | tidak | tidak |
| `/permintaan` - batal/ubah setelah `selesai` | **tidak ada di UI** | tidak | tidak | tidak |
| `/kata-kunci` - lihat tabel (F2) | **ya** | **ya (read-only)** | tidak | tidak |
| `/kata-kunci` - ubah interpretasi penanda (F2) | **ya** | tidak (kontrol disembunyikan; route 403) | tidak | tidak |

### 7.1 Keputusan: siapa boleh mengubah keyword - **UBAH = OWNER SAJA; LIHAT = OWNER + ADMIN**

**T3 (keputusan final):** admin BOLEH **MELIHAT** halaman `/kata-kunci` (read-only), sejalan dengan
`firestore.rules:30` (`keyword_notes` `allow read: if staff()` - admin memang sudah bisa membaca via
SDK). Tombol/Select ubah HANYA owner.

Alasan ubah = owner saja: mengubah interpretasi penanda = **mengubah perilaku bot** (penanda confirmed
mengubah `action_type`, yang menentukan apakah stok dipotong atau masuk permintaan gudang). Itu
setara perubahan aturan operasional, bukan operasi harian seperti kirim form. Karena bot membaca
`confidence`/`interpreted_as` secara langsung, kesalahan admin di sini berdampak luas & sulit
dilacak. Owner = pemegang data master (konsisten v2 F1: HPP owner-only karena mengubah perilaku
perhitungan).

**Koreksi narasi (non-blocking #T3):** owner-only pada UBAH adalah keputusan **produk/UI + guard
route**, BUKAN kontrol kerahasiaan - admin tetap bisa MEMBACA `keyword_notes` lewat Firestore SDK
| # | Kasus | Perilaku |
|---|---|---|
| E1 | Dokumen tanpa item (`items: []`) | Baca: Empty; `sesuaikan`/`buat-form` -> 400 `"Permintaan belum berisi item."`; `datang` -> 404 `"Item tidak ditemukan di permintaan."`; tombol aksi disabled di UI |
| E2 | Item duplikat (`kode_barang`+`variasi`+`buffer` SAMA) | Digabung oleh `gabungItemDuplikat`; qty dijumlah; tidak error (S3.7). Bila `buffer` BEDA -> TIDAK digabung (dua baris) |
| E3 | `qty` 0 | Sah (integer >= 0); item tetap bisa dikirim dengan qty 0; item qty 0 otomatis selesai (B6/S4.4), badge "Tidak diminta", tanpa tombol datang |
| E4 | `qty` negatif / string / `null` | 400 `"Jumlah harus bilangan bulat >= 0 (maks 1.000.000)."` |
| E5 | `qty_datang` > `qty_diminta` | Sah; tersimpan apa adanya; tidak ada peringatan di v3a |
| E6 | Semua item sudah `datang`, user tekan `datang` lagi | 409 `"Item ini sudah ditandai datang."`; bila dokumen sudah `selesai`, aksi apa pun -> 409 `"Permintaan sudah selesai."` |
| E7 | `buat-form` tanpa item | 400 `"Permintaan belum berisi item."` |
| E8 | Dokumen tanggal lain / hari ini belum dibuat | Baca: 404 `"Permintaan tidak ditemukan."`; UI aksi hanya untuk tanggal hari ini (riwayat read-only). Server (keputusan): `sesuaikan` tanggal lampau -> 400 `"Hanya permintaan hari ini yang bisa diubah."`; `datang`/`selesai`/`buat-form` tanggal lampau DIIZINKAN (owner/admin), `tanggal > hari ini` -> 400 |
| E9 | Stok item `null` / dokumen `stock` tidak ada | Saran qty 0; stok tampil em-dash U+2014 (`formatAngka(null)`), BUKAN hyphen; `sesuaikan` tetap boleh (tidak butuh stok) |
| E10 | `qty` = 1.000.001 | 400 (batas atas) |
| E11 | Dua request `datang` bersamaan pada item terakhir | `runTransaction` menjamin satu menang; yang kedua 409; hanya satu set `selesai_at` |
| E12 | Kirim Telegram gagal (semua admin) | Status tetap `diproses`; 200 + `peringatan_kirim: true`, `kirim_gagal: N`; log |
| E13 | `admin.telegram_user_id` kosong/undefined di daftar admin | Dilewati (tidak dikirim), dihitung `kirim_gagal`; log per instance |
| E14 | Cookie kedaluwarsa saat submit (401) | Dialog TIDAK tutup; isian DIPERTAHANKAN; toast `SESI_KEDALUWARSA` + "Buka ulang" (v1 S11.2) |
| E15 | Bot menambah item ke dokumen yang sedang `diproses` | Item baru `status` efektif `"diminta"`; `qty_diminta` = `qty` (lazy via fallback) dan akan di-snapshot saat kirim ulang; UI refetch menampilkannya |
| E16 | `interpreted_as` note NULL/aneh | UI menampilkan em-dash; opsi Select default `MINTA`; konfirmasi menyimpan nilai valid |
| E17 | Note tidak ada saat konfirmasi | 404 `"Penanda tidak ditemukan."` |
| E18 | `items` bukan array (data rusak) | Normalizer mengembalikan `[]`; aksi -> 400/404; UI Empty |
| E19 | Item `qty 0` + `datang` dipanggil (B6) | Item sudah efektif selesai -> 409 `"Item ini sudah ditandai datang."`; tidak menggagalkan auto-`selesai` |
| E20 | Dobel-tap "Kirim Form" paralel (< 10 detik) | Guard `permintaan_form_guard` -> 409 `"Permintaan sedang dikirim."` (S4.3); idempotensi 30 detik tetap berlaku pada panggilan serial |
| E21 | Data lama: item hanya punya kode_barang/nama/variasi/qty/buffer (jalur UI `real.ts`) | Normalizer `real.ts` (B3) -> `status:"diminta"`, `qty_diminta = qty`, field datang `null`; tampil benar di UI |

---

## 9. Audit trail
### 9.1 Keputusan F1: **field per item + array `perubahan[]` di dokumen, BUKAN koleksi baru**

Setiap item menyimpan `datang_by`/`datang_at` (siapa & kapan menandai datang); dokumen menyimpan
`form_dibuat_by`/`form_dibuat_at`, `selesai_by`/`selesai_at`, `updated_at`/`updated_by`.

Untuk `sesuaikan` (ubah qty), history disimpan **durable di dokumen**: array `perubahan[]`
(`{ key_item, qty_lama, qty_baru, oleh, at }`, max 50 entri terakhir - S4.1 B5) + `updated_at`/
`updated_by`. **KEPUTUSAN: TIDAK membuat koleksi `daily_request_changes` di v3a, DAN TIDAK
mengandalkan `console.info` saja.** Alasan:
1. Log server (`console.info`) di Vercel serverless ephemeral - tidak durable, tidak bisa diku kueri.
   Klaim lama "audit lewat log server" adalah janji palsu (koreksi review B5).
2. Array in-document menjawab "siapa mengubah qty dari X ke Y kapan" tanpa menambah koleksi/route
   (menjaga function budget & kompleksitas).
3. Batas 50 entri terakhir menjaga dokumen tidak membengkak.

`perubahan[]` dan field per-dokumen (B5) **tahan lama** - semua aksi v3a punya jejak pelaku yang
bisa dibaca ulang.

`ponytail:` bila frekuensi `sesuaikan` sangat tinggi (array terus mentok 50) atau butuh kueri lintas
dokumen (sengketa qty massal), naikkan ke koleksi `daily_request_changes` dengan skema
`{ id, tanggal, kode_barang, variasi, qty_lama, qty_baru, changed_by, created_at }` (perlu dibuat di
`lib/models/dailyRequestChanges.js`). Untuk v3a, array in-document CUKUP.

### 9.2 Keputusan F2: audit ringan di dokumen note

`perbaruiInterpretasi` menulis `confirmed_by` (uid) + `confirmed_at` (Date/ISO) pada dokumen
`keyword_notes`. Alasan: koleksi existing mudah ditambah field; perubahan perilaku bot harus punya
jejak pelaku. Tidak ada koleksi terpisah.
---

## 10. Non-functional, analytics, test

- **Function budget:** +1 route F1 `/api/permintaan` (10/12); +1 route gabungan `/api/admin`
  (aksi `kata-kunci`) (11/12). Route lama (role/tambah/hapus) TETAP (tidak digabung - S6.4). Bukti
  `vercel build` WAJIB dilampirkan di PR. Halaman `/kata-kunci` statis (client shell), tidak
  menambah function.
- **Rate limit:** `permintaan:{uid}` 30/menit; `admin:{uid}` 20/menit (soft-guard v1 S11.9,
  per-instance).
- **Aksesibilitas:** tombol h-11 (>= 44px), label form, `aria-invalid` saat error, `aria-label`
  tombol ikon, kontras >= 4.5:1 (ui-spec S6). Diuji Playwright `boundingBox().height >= 44` +
  `@axe-core/playwright` (sudah ada di devDependencies).
- **Responsif:** tanpa scroll horizontal @360px (test `scrollWidth <= clientWidth`); tabel -> kartu
  di mobile (pola `app/stok/page.tsx`).
- **Persepsi cepat (non-blocking):** skeleton tampil <= 100ms; refetch pasca-submit selesai <= 2s pada
  data mock.
- **Log server baru:**
  `permintaan_sesuaikan`, `permintaan_buat_form`, `permintaan_datang`, `permintaan_selesai`,
  `permintaan_reject`, `permintaan_kirim_gagal`, `permintaan_guard_failed`, `admin_kata_kunci_success`,
  `admin_kata_kunci_reject`. Memuat `uid`, `tanggal`/`id`, alasan; TIDAK memuat token/`initData`.
  Catatan: log = observabilitas, BUKAN sumber audit (audit durable = `perubahan[]`/field dokumen - S9).
- **Analytics klien:** tidak ada event baru (v1 S27).

**Test wajib:**

*Model / server (`node:test` + `test/helpers/mockFirestore.js`):*
1. `normalisasiItemLama` -> item lama dapat `status: "diminta"`, `qty_diminta = qty`.
1b. **B3: jalur baca UI** - `listDailyRequests()` (mock & real) mengembalikan item lama
   (`{kode_barang,nama,variasi,qty,buffer}`) dengan `status:"diminta"` & `qty_diminta` terisi; item
   tampil benar (bukti normalizer jalan di `real.ts`/`mock.ts`, bukan hanya model server).
2. `gabungItemDuplikat` -> 2 item sama (kode+variasi+buffer SAMA) digabung qty-nya; 2 item dengan
   `buffer` BEDA TIDAK digabung (dua baris) - T1.
3. `sesuaikanQtyItem` -> qty berubah; item `datang` ditolak; 0 item ditolak.
3b. **B5:** `sesuaikanQtyItem` menulis entri `perubahan[]` (`qty_lama`,`qty_baru`,`oleh`,`at`) +
   `updated_at`/`updated_by`.
3c. **B5:** 51 perubahan -> `perubahan.length === 50` (entri terlama dibuang).
4. `buatForm` -> `status: "diproses"`, `qty_diminta` ter-snapshot, `form_dibuat_at/by` terisi;
   item `datang` tidak berubah snapshot-nya.
4b. **B2:** item bot (hanya `qty`, tanpa `qty_diminta`) -> setelah `buatForm`, `qty_diminta === qty`
   (bukan `undefined`); `formatPesanPermintaan` tidak memuat em-dash/spasi kosong.
5. `tandaiItemDatang` -> item `datang` + `qty_datang`; semua datang -> `selesai` + `selesai_at/by`.
5b. **B6:** dokumen dengan item A (`qty` 0) + item B; B `datang` -> dokumen otomatis `selesai`
   (A tidak perlu ditandai).
5c. **dead code:** `selesaikanRequest` memakai/menggantikan `updateStatusDailyRequest` (tidak ada
   fungsi mati tersisa).
6. Auto-`selesai` di dalam transaksi (simulasi dua request item terakhir -> hanya satu `selesai`).
7. `formatPesanPermintaan` -> teks PERSIS sama dengan contoh literal S3.5 (separator WAJIB U+00B7
   `"\u00b7"`, BUKAN titik ASCII); urut alfabetis; qty `formatAngka`.
7b. **TZ:** `formatPesanPermintaan` menghasilkan tanggal sama dengan TZ `America/New_York` & `UTC`.
8. **Kirim form:** stub `kirimPesanPlain` -> dipanggil dengan `admin.telegram_user_id` (string,
   BUKAN `undefined`); 1 owner + 1 admin = 2 panggilan.
9. Kegagalan kirim 1 admin -> `kirim_gagal: 1`, status TETAP `diproses`, route 200 +
   `peringatan_kirim`.
9b. **Guard double-submit:** `buat-form` dua kali paralel < 10 detik -> satu 200, satu 409
   `"Permintaan sedang dikirim."`; Telegram terkirim sekali.
10. Route validasi: `aksi` tak dikenal, `tanggal` invalid, guest -> 403, `selesai` dobel -> 409,
    idempoten kirim ulang < 30 detik -> tidak kirim Telegram, rate limit ke-31 -> 429.
10b. **B1:** `datang` pada dokumen `draft` -> 409 `"Kirim form dulu sebelum menandai barang datang."`;
    `selesai` pada `draft` -> 409.
10c. **Tanggal (non-blocking #2):** `sesuaikan` tanggal lampau -> 400; `datang`/`selesai`/`buat-form`
    tanggal lampau -> sukses (owner/admin); `tanggal > hari ini` -> 400.
11. F2: `listKeywordNotes` mengembalikan note; `perbaruiInterpretasi` -> `confidence: "confirmed"`,
    `interpreted_as` baru, `confirmed_by` terisi; memanggil `konfirmasiKeyword` (bukan duplikat).
11b. Route `/api/admin` aksi `kata-kunci`: sukses mengembalikan `confirmed_at`/`confirmed_by`; admin
    (non-owner) -> 403 `"Hanya owner yang dapat mengubah penanda."`; `id`/`interpreted_as` invalid -> 400.

*Playwright (mock):*
12. F1 alur penuh: buka dialog Ubah Jumlah (saran qty = kekurangan), simpan, Kirim Form (status
    -> diproses), Barang Datang semua (-> dialog konfirmasi dua-langkah -> selesai, badge "Selesai",
    tanpa tombol).
12b. **B6 UI:** item qty 0 tampil badge "Tidak diminta" & tanpa tombol datang; dokumen tetap bisa
    `selesai` saat item lain datang.
12c. **Desync:** ubah qty setelah kirim -> badge "Qty berubah sejak kirim" muncul; hilang setelah
    Kirim Ulang.
13. F1 401 mid-write (`?mock-401=1`): dialog tidak tutup, isian dipertahankan, tombol "Buka ulang".
14. F2: owner melihat tabel + filter + kontrol ubah; konfirmasi mengubah badge ke "Terkonfirmasi";
    **admin** melihat tabel read-only (tanpa tombol "Konfirmasi"); guest tidak bisa akses.
    bisa mengakses halaman.

---
## 11. Pertanyaan terbuka (OQ)

**Sudah DIJAWAB (tutup - jangan dipertanyakan lagi):**
- ~~OQ-1: aksi `selesai` manual opsional?~~ **DIJAWAB: WAJIB dipertahankan** (jalur keluar item qty 0
  / tidak akan datang; B6). Lihat S5.1.
- ~~OQ-3: fallback keyword ke `/api/permintaan` bila v3b butuh >= 2 route?~~ **DIJAWAB: TIDAK.**
  Keyword dititip di `POST /api/admin` (route gabungan baru); budget final 11/12. Lihat S6.4.
- ~~OQ-4: admin boleh lihat `/kata-kunci` read-only?~~ **DIJAWAB: YA** (konsisten rules `staff()`);
  ubah tetap owner-only. Lihat S7.1.

**Masih terbuka:**
- **OQ-2:** Emoji di baris pertama pesan Telegram (contoh user memakai emoji clipboard). Default
  dokumen: TANPA emoji agar copy bersih. Konfirmasi perlu?
- **OQ-5:** Apakah "Kirim Ulang" harus mengirim hanya selisih/perubahan, atau selalu daftar penuh?
  Default: daftar penuh (lebih aman & mudah di-copy ulang di Telegram).
- **OQ-6:** Sumber stok untuk saran qty: `stock.stok_gudang_online` (dipakai). Bila produk tidak
  online tapi ada di permintaan, saran tetap dari `stock/{kode}` apa adanya. Konfirmasi cukup?
- **OQ-7 (baru):** v4 - apakah perlu fitur "batalkan / buka kembali dokumen `selesai`"? v3a memilih
  tidak (S4.4) dengan mitigasi koreksi manual Firestore; keputusan ini ditinjau v4.
- **OQ-8 (baru):** Apakah route lama `admin/role`, `admin/tambah`, `admin/hapus` perlu digabung ke
  `/api/admin` di v4 untuk hemat 3 function? Default v3a: TIDAK (S6.4). Tinjau bila margin kritis.

---

## 12. Risiko

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Kirim Telegram ke `admin.id` (bukan `telegram_user_id`) | Pesan tidak pernah terkirim (bug B1 terulang) | Test #8 assert argumen valid; pakai `ambilSemuaAdminByRole` |
| R2 | Teks Telegram ter-parse Markdown & ditolak Telegram | Pesan gagal / karakter rusak | Kirim plain (tanpa `parse_mode`); test teks literal |
| R3 | Migrasi lazy tidak konsisten | Item lama salah baca | Normalizer SATU aturan di DUA jalur baca (model server + `real.ts`); test #1 & #1b |
| R4 | Duplikat item membuat pesan ganda | Pesan membingungkan | `gabungItemDuplikat` (kunci kode+variasi+buffer) sebelum kirim; test #2 |
| R5 | Race `datang` -> `selesai` ganda | Dua `selesai_at` | `runTransaction` (test #6) |
| R6 | Function budget 11/12 | v3b kehabisan margin (1 sisa) | v3b WAJIB pakai route gabungan `aksi` (tambah ke `/api/admin`); bukti `vercel build` |
| R7 | Mock lebih longgar dari server | Test hijau palsu | Mock meniru guard & urutan validasi server (pola v2 S11) |
| R8 | Double-tap Kirim Form -> 2 pesan | Spam Telegram | Idempotensi 30 detik + guard `permintaan_form_guard` 10 detik (test #9b) + tombol disabled |
| R9 | `sesuaikan` mengubah item yang sudah datang | Kehilangan data penerimaan | Guard tolak item `datang` (400/409) |
| R10 | Keyword `confirmed` salah -> bot memotong stok keliru | Dampak stok nyata | Ubah owner-only + audit `confirmed_by`/`confirmed_at` + tooltip konsekuensi |
| R11 | Doc `daily_requests` membengkak karena `perubahan[]` | Baca lambat / limit 1MB | Batas 50 entri terakhir (S4.1); test #3c |
| R12 | Badge desync tidak jelas bagi ops | Admin salah paham qty terkini | Badge "Qty berubah sejak kirim" + tooltip (S3.9); Kirim Ulang menyinkronkan |
| R13 | Item qty 0 dead-end (B6) | Dokumen tak pernah `selesai` | Aturan qty 0 auto-selesai + `selesai` manual WAJIB (test #5b, #12b) |

Tidak ada pertanyaan terbuka yang memblokir mulai Wave 1. OQ-2/OQ-5/OQ-6 kosmetik/opsional; OQ-7/OQ-8
ditinjau v4.

---

## 13. Urutan implementasi (delegasi paralel, pola wave/gate v2-plan)

### Wave 1 - Model & helper server (tidak paralel dengan UI; kontrak dasar)

| Langkah | Pekerjaan | File |
|---|---|---|
| W1.1 | Helper normalisasi (`normalisasiItemLama`, `normalisasiStatusDokumen`) & `gabungItemDuplikat` (kunci kode+variasi+buffer) + ekspor | `lib/models/dailyRequests.js` |
| W1.2 | `sesuaikanQtyItem` (tulis `perubahan[]` max 50 + `updated_at/by`), `buatForm` (snapshot B2), `tandaiItemDatang` (auto-selesai B6), `selesaikanRequest` (pakai ulang `updateStatusDailyRequest`) | `lib/models/dailyRequests.js` |
| W1.3 | `formatPesanPermintaan` (helper murni, separator U+00B7, TZ-safe) + `kirimFormPermintaan` | `lib/models/dailyRequests.js` |
| W1.4 | `kirimPesanPlain` (tanpa `parse_mode`) | `lib/telegram/kirimPesan.js` (perlu dibuat) |
| W1.5 | `listKeywordNotes`, `perbaruiInterpretasi` (pakai `konfirmasiKeyword`, tulis `confirmed_by/at`) | `lib/models/keywordNotes.js` |
| W1.6 | Validasi payload gabungan (`/api/permintaan` + aksi `kata-kunci`) | `lib/dashboard/validasiTulisV3a.js` (perlu dibuat, pola `validasiTulisV2.js`) |
| W1.7 | Helper tanggal TZ-safe (`formatTanggalSingkatDariId` atau opsi `timeZone`) | `lib/dashboard/format.ts` |
| W1.8 | **Normalizer item di jalur baca UI** (replika TS) - `status`/`qty_diminta`/`qty_datang`/`datang_*`/`perubahan` | `lib/dashboard/data/real.ts`, `lib/dashboard/data/mock.ts` |
| W1.9 | Test model | `test/` (baru) |

Gate W1: `npm test` hijau (test model membuktikan S10 #1-#9b, #11, #11b).

### Wave 2 - Route server

| Langkah | Pekerjaan | File |
|---|---|---|
| W2.1 | `POST /api/permintaan` (4 aksi: sesuaikan/buat-form/datang/selesai, pola reorder-point, guard double-submit + kebijakan tanggal) | `app/api/permintaan/route.ts` (perlu dibuat) |
| W2.2 | `POST /api/admin` (route gabungan baru; aksi `kata-kunci`; siap menampung aksi v3b) | `app/api/admin/route.ts` (perlu dibuat) |
| W2.3 | Test route (validasi, guard, 409, idempoten, guest, rate limit, tanggal lampau, 409 `datang` di `draft`) | `test/` (baru) |

Gate W2: `npm test` hijau + `npx tsc --noEmit` exit 0.

### Wave 3 - Kontrak data & UI

| Sub | Pekerjaan | File |
|---|---|---|
| W3a (beku) | Tambah tipe + method `DataSource` (6 method: `sesuaikanQtyPermintaan`, `kirimFormPermintaan`, `tandaiPermintaanDatang`, `selesaikanPermintaan`, `listKeywordNotes`, `konfirmasiKeywordNote`) | `lib/dashboard/types.ts`, `lib/dashboard/data/index.ts` |
| W3b (data) | Implementasi mock (guard tiruan, normalisasi) + real (`fetch` + normalisasi saat baca - B3) | `lib/dashboard/data/mock.ts`, `lib/dashboard/data/real.ts`, `lib/dashboard/data/mock-data.ts` |
| W3c (data) | **Tambah 6 method ke literal `dataKosong()`** - `satisfies DataSource` (baris 220) membuat `tsc --noEmit` GAGAL bila method ketinggalan (B4); ini WAJIB, bukan opsional | `lib/dashboard/sumber-data.tsx` |
| W3d (UI) | Halaman interaktif + dialog Ubah Jumlah/Barang Datang + badge (desync/tidak-diminta) + dialog konfirmasi selesai | `app/permintaan/page.tsx`, `components/dashboard/*` (baru) |
| W3e (UI/nav) | Halaman `/kata-kunci` (owner ubah, admin read-only) + nav | `app/kata-kunci/page.tsx` (baru), `components/dashboard/nav-config.ts` |
| W3f (e2e) | Playwright mock (alur penuh + B6 + desync + 401 + izin) | `e2e/*.spec.ts` (baru) |

Gate W3: `npx tsc --noEmit` exit 0; `npm run e2e` hijau; key `dataKosong` lengkap (6 method baru);
Playwright lama tetap hijau.

### Wave 4 - Rules + deploy

| Pekerjaan | File |
|---|---|
| Pastikan rules `daily_requests`/`keyword_notes` tetap `read staff / write false` (TIDAK diubah - semua tulis via route). Tambah rules server-only `permintaan_form_guard/{id} { allow read, write: if false; }` (S4.3) | `firestore.rules` (ubah: +1 blok guard) |
| Update dokumen budget function (9 -> 11) + prosedur koreksi manual dokumen `selesai` (S4.4) + smoke test mini app | `docs/dashboard-deploy.md` |
| Gate akhir: `vercel build` <= 12 function (bukti log) | - |

---

## 14. Definition of Done v3a

- Kontrak route S5.1 (`/api/permintaan`) & S6.5 (`/api/admin` aksi `kata-kunci`) diimplementasikan
  persis (path, status, pesan Bahasa Indonesia).
- **B1:** `datang` pada dokumen `draft` -> 409 `"Kirim form dulu sebelum menandai barang datang."`
  (test #10b).
- **B2:** `buat-form` SELALU snapshot `qty_diminta = qty` untuk setiap item belum `datang`,
  termasuk item bot yang hanya punya `qty`; UI membaca `qty_diminta ?? qty` (test #4b).
- **B3:** normalizer item ada di jalur baca UI (`real.ts`/`mock.ts`) DAN model server; item lama
  tampil benar di UI (test #1 & #1b).
- **B4:** `dataKosong()` lengkap 6 method baru; `tsc --noEmit` exit 0; narasi spec konsisten
  (`satisfies` menagih, bukan cast).
- **B5:** `sesuaikan` menulis `perubahan[]` (max 50) + `updated_at`/`updated_by`; bukan hanya
  `console.info` (test #3b, #3c).
- **B6:** item `qty 0` otomatis dianggap selesai; tidak menghalangi auto-`selesai`; `selesai` manual
  WAJIB tersedia (test #5b, #12b).
- **T1:** gabung duplikat hanya bila `kode_barang`+`variasi`+`buffer` sama (test #2).
- **T4:** route `POST /api/admin` (aksi `kata-kunci`) ada; TIDAK ada `/api/kata-kunci`; route lama
  (role/tambah/hapus) tidak diubah; budget 11/12 dengan bukti `vercel build`.
- `npm test` hijau termasuk test baru S10 (semua nomor); `npx tsc --noEmit` exit 0.
- Pesan Telegram cocok PERSIS contoh literal S3.5 (separator U+00B7, test string equality); dikirim
  plain tanpa `parse_mode`; memakai `admin.telegram_user_id` (test membuktikan bukan `undefined`);
  tanggal TZ-safe (test #7b).
- Kegagalan kirim tidak me-rollback status; respons `peringatan_kirim` + `kirim_gagal` benar.
- Guard double-submit `buat-form` berfungsi (test #9b); kebijakan tanggal server-side diterapkan
  (test #10c).
- Semua mutasi array `daily_requests` memakai `db.runTransaction`.
- Backward-compat terbukti: item/dokumen lama tetap terbaca & valid; `tambahItemKeDailyRequest`
  tidak diubah; `updateStatusDailyRequest` TIDAK menjadi dead code (dipakai `selesaikanRequest`).
- Auto-`selesai` saat semua item `datang` ATAU `qty_diminta 0`; tidak bisa dibatalkan dari dashboard
  (guard 409 + dialog konfirmasi dua-langkah).
- `/kata-kunci`: owner ubah, admin lihat read-only; memanggil `konfirmasiKeyword()` yang ada (tanpa
  duplikasi); `confidence` -> `confirmed`.
- `daily_requests` & `keyword_notes` rules tetap `allow write: if false` (tulis hanya via route);
  `permintaan_form_guard` server-only.
- Seksi Riwayat & Empty existing `app/permintaan/page.tsx` dipertahankan (S3.9).
- Mock meniru guard server (paritas); Playwright hijau termasuk 401 mid-write.
- `vercel build` <= 12 function dengan bukti log (11).
- Tidak ada fitur v3b/non-goals S1.3 terimplementasi; runtime bot tidak tersentuh.

---

## 15. Daftar file (ringkas, untuk delegasi)

**Server / model**
- `lib/models/dailyRequests.js` (ubah: helper normalisasi/gabung, `sesuaikanQtyItem` (+`perubahan[]`),
  `buatForm` (snapshot B2), `tandaiItemDatang` (auto-selesai B6), `selesaikanRequest` (pakai
  `updateStatusDailyRequest`), `formatPesanPermintaan`, `kirimFormPermintaan`)
- `lib/models/keywordNotes.js` (ubah: `listKeywordNotes`, `perbaruiInterpretasi` (+`confirmed_by/at`);
  `konfirmasiKeyword` dipakai apa adanya)
- `lib/telegram/kirimPesan.js` (ubah: `kirimPesanPlain` perlu dibuat)
- `lib/dashboard/format.ts` (ubah: helper tanggal TZ-safe untuk pesan)
- `lib/dashboard/validasiTulisV3a.js` (baru)
- `app/api/permintaan/route.ts` (baru)
- `app/api/admin/route.ts` (baru - route gabungan, aksi `kata-kunci`; T4)

**Kontrak data**
- `lib/dashboard/types.ts` (DailyRequestItem/Doc diperluas: `perubahan[]`, `updated_by`, tipe ISO;
  tipe request/response; `KeywordNoteDoc`)
- `lib/dashboard/data/index.ts` (6 method baru: `sesuaikanQtyPermintaan`, `kirimFormPermintaan`,
  `tandaiPermintaanDatang`, `selesaikanPermintaan`, `listKeywordNotes`, `konfirmasiKeywordNote`)
- `lib/dashboard/data/mock.ts`, `lib/dashboard/data/mock-data.ts`, `lib/dashboard/data/real.ts`
  (normalizer item jalur UI - B3)
- `lib/dashboard/sumber-data.tsx` (`dataKosong` - tambah 6 method; `satisfies` menagih - B4)

**UI**
- `app/permintaan/page.tsx` (ubah interaktif; Riwayat/Empty existing dipertahankan)
- `app/kata-kunci/page.tsx` (baru)
- `components/dashboard/nav-config.ts` (tambah nav `/kata-kunci`, owner + admin)
- `components/dashboard/dialog-ubah-jumlah.tsx` (baru)
- `components/dashboard/dialog-barang-datang.tsx` (baru)
- `components/dashboard/tabel-kata-kunci.tsx` (baru, opsional)

**Rules**
- `firestore.rules` (ubah: tambah `permintaan_form_guard` server-only; `daily_requests`/
  `keyword_notes` tidak berubah)

**Docs**
- `docs/dashboard-deploy.md` (ubah: budget 9 -> 11 + prosedur koreksi manual `selesai`)

**Test**
- `test/permintaanHarian.test.js` (baru)
- `test/kataKunci.test.js` (baru)
- `test/permintaanRoute.test.js`, `test/adminRoute.test.js` (baru)
- `e2e/permintaan.spec.ts`, `e2e/kata-kunci.spec.ts` (baru)



