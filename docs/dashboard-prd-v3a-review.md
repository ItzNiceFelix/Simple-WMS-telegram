# Adversarial Review - PRD Addendum v3a (`docs/dashboard-prd-v3a.md`)

Reviewer: senior product reviewer (adversarial). Tanggal: 2026-09-15.
Metode: setiap klaim spec diverifikasi langsung ke kode asli. Spec TIDAK diubah.

---

## Verdict

**PASS WITH CHANGES.**

Alasan satu kalimat: desain inti (state machine, lazy migration, plain-text Telegram, route gabungan F1)
sehat dan klaim teknis utamanya terbukti akurat di kode, tetapi ada 6 lubang blocking yang membuat
kontraknya belum bisa diimplementasikan/diuji apa adanya: (a) aksi `datang` mustahil pada dokumen
`draft` (kontradiksi transisi), (b) `sesuaikan` pada dokumen `draft` meninggalkan `qty_diminta`
undefined sehingga pesan bisa berisi `NaN`/salah, (c) kontrak data-access tidak menyebut perubahan
`listDailyRequests` di `real.ts` padahal types diperluas, (d) klaim cast `dataKosong` sudah usang
(cast dihapus di v2, kini `satisfies`), (e) audit `sesuaikan` mengandalkan log server yang di Vercel
tidak durable, (f) item `qty=0` membuat auto-`selesai` mustahil dicapai selamanya.

---

## Blocking (harus diperbaiki sebelum implementasi)

### B1. Aksi `datang` mustahil pada dokumen `draft` vs state machine

- **Lokasi:** S3.1 tabel transisi (baris 118-125), S3.2 tabel tombol (baris 134-138), S5.1.
- **Bukti:** Tombol "Barang Datang" hanya dirender pada status `diproses` (S3.2 baris 137). Tetapi
  tabel transisi S3.1 hanya mendefinisikan `datang` dari `diproses`, dan S4.4 baris 347 menulis
  "Dokumen menjadi `selesai` **hanya** ketika aksi `datang`". Tidak ada transisi `draft --datang-->`.
  Andaikan ada: dokumen `draft` belum punya `qty_diminta` (snapshot baru terjadi di `buat-form`,
  S4.3 baris 337). Jika `datang` diizinkan di `draft`, `qty_datang` ada tapi `qty_diminta` null ->
  UI S3.6 "default = `qty_diminta`" menjadi `null`.
- **Kenapa blocking:** implementasi tidak tahu harus menolak atau mengizinkan `datang` di `draft`.
  Dua developer bisa menghasilkan perilaku berbeda. Test #5 & #10 tidak menguji kasus ini.
- **Perbaikan konkret:** tambahkan satu baris eksplisit di tabel S3.1:
  `draft | Barang Datang | DITOLAK 409 | "Kirim form dulu sebelum menandai barang datang."`
  dan tambahkan baris ini ke tabel cek S5.1 aksi `datang`.

### B2. `sesuaikan` di `draft` tidak menetapkan `qty_diminta` -> pesan Telegram bisa `NaN`

- **Lokasi:** S4.3 baris 343 (`sesuaikan` TIDAK mengubah `qty_diminta`), S3.4 langkah 2 (snapshot
  saat kirim), S5.1 aksi `sesuaikan`, S4.1 tabel field (`qty_diminta` wajib "saat form dikirim").
- **Bukti:** item baru dari bot (`tambahItemKeDailyRequest`, `dailyRequests.js:52`) hanya menulis
  `qty`. Alur normal: admin buka `draft` -> "Ubah Jumlah" (`sesuaikan`, mengubah `qty` saja) ->
  "Kirim Form" (`buat-form`, snapshot `qty_diminta = qty`). Ini aman. TAPI kontrak S5.1 mengizinkan
  UI mengirim `datang` pada item yang `qty_diminta` masih belum ada bila urutan aksi bukan
  draft->sesuaikan->buat-form. Lebih tajam: E15 (baris 639) bilang bot bisa menambah item saat
  `diproses`; item itu `qty_diminta` = `qty` "lazy". Namun normalizer S4.2 (`normalisasiItemLama`)
  dievaluasi **saat baca**, dan `buat-form` men-snapshot berdasarkan item yang dibaca. Bila route
  `sesuaikan` membaca dokumen lewat `ambilDailyRequest` yang sudah dinormalisasi, lalu menulis array
  dari data mentah (tanpa `qty_diminta`), snapshot bisa hilang. Spec tidak menetapkan apakah
  `sesuaikan` menulis balik field hasil normalisasi.
- **Kenapa blocking:** `formatPesanPermintaan(doc)` (S5.3) membaca `qty_diminta` untuk baris pesan.
  Bila field absen, `formatAngka(undefined)` mengembalikan `""` (`format.ts:53`) atau `NaN` ->
  pesan Telegram salah, dan itu pelanggaran DoD "PESAN PERSIS contoh literal S3.5".
- **Perbaikan konkret:** (1) tegaskan di S3.3/S5.1 bahwa `sesuaikan` WAJIB menulis balik `qty_diminta = qty`
  hanya bila item belum `datang` DAN dokumen masih `draft`; ATAU (2) tegaskan `formatPesanPermintaan`
  memakai fallback `item.qty_diminta ?? item.qty`. Pilih satu, tulis eksplisit, tambah test.

### B3. Kontrak data-access tidak lengkap: perubahan `real.ts` tidak disebut

- **Lokasi:** S13 W3b baris 786 (menyebut `real.ts`), S15 baris 840 (`real.ts`), tetapi S5.2/§11
  hanya membahas method baru & `dataKosong`.
- **Bukti:** `real.ts:338-349` sekarang membaca `daily_requests` dengan
  `items: (d.data().items ?? []) as DailyRequestDoc["items"]` (cast paksa, baris 344) dan
  `status: String(...)`. Begitu `DailyRequestItem` diperluas (S4.1 field `qty_diminta`, `status`,
  `qty_datang`, `datang_at`, `datang_by`), cast itu tetap kompilasi tetapi mengembalikan objek TANPA
  field baru -> `it.qty_diminta` = `undefined` di UI, padahal TS mengira field ada. Ini silent runtime bug.
- **Kenapa blocking:** normalisasi lazy (S4.2) didefinisikan di `lib/models/dailyRequests.js`
  (server), sedangkan UI memuat lewat client SDK `real.ts`. Tidak ada jembatan: route server tidak
  dipakai untuk MEMBACA `daily_requests`. Jadi `normalisasiItemLama` **tidak akan pernah jalan di jalur
  baca UI real**. Spec berasumsi normalizer dipakai saat baca (S4.2 baris 325-326), tetapi yang
  membaca adalah `real.ts`, bukan model server.
- **Perbaikan konkret:** tambahkan tugas eksplisit di W3b: `real.ts:listDailyRequests` dan mock harus
  menormalisasi item (panggil `normalisasiItemLama` / replika di TS) dan mengekspos `status` dokumen
  efektif. Tambah test #1b: `listDailyRequests()` (mock & real) mengembalikan item lama dengan
  `status:"diminta"`, `qty_diminta` terisi.

### B4. Klaim `dataKosong()` memakai cast `as unknown as DataSource` sudah USANG

- **Lokasi:** S13 W3c baris 787 ("`satisfies` menagih, TIDAK boleh dilewat"), S10 baris 676-677,
  S14 baris 819.
- **Bukti:** `sumber-data.tsx:220` sekarang diakhiri `} satisfies DataSource;` - cast sudah dihapus
  (persis tindak lanjut v2 §11 yang menyarankan opsi (a)). Spec v3a masih menyebut "cast sudah
  dihapus di v2" di beberapa tempat, tetapi S13 baris 787 justru menyebut "`satisfies` menagih" -
  arahnya benar. Namun tidak ada instruksi **apa** yang harus ditambah ke `dataKosong()` selain
  "manual". Method baru (`sesuaikanQtyPermintaan`, `kirimFormPermintaan`, `tandaiPermintaanDatang`,
  `selesaikanPermintaan`, `listKeywordNotes`, `konfirmasiKeywordNote` - S15 baris 838-839) hanya
  disebut di S15, tidak di W3a/W3c secara enumeratif.
- **Kenapa blocking ringan:** dengan `satisfies`, `tsc` AKAN gagal bila `dataKosong()` ketinggalan
  method - jadi ini tidak akan lolos gate W3. Tetapi spec menyatakan sebaliknya di §S10 ("compiler
  tidak menagih") dan menetapkan langkah manual yang tak perlu. Implementer bisa bingung.
- **Perbaikan konkret:** koreksi teks S13 W3c: dengan `satisfies` (baris 220), `tsc --noEmit` menagih
  - cukup tambah 6 method ke literal `dataKosong()`. Hapus kalimat "compiler tidak menagih" yang
  diwarisi dari v1.

### B5. Audit `sesuaikan` hanya lewat `console.info` -> tidak durable di Vercel

- **Lokasi:** S9.1 baris 653-654 ("history disimpan terbatas: `updated_at` + log server
  `[permintaan_sesuaikan]`"), S10 baris 683.
- **Bukti:** `console.info` di serverless Vercel masuk log ephemeral, tanpa retensi/kueri, tidak
  menjawab "siapa ubah qty dari X ke Y kapan" setelah log bergulir. Bandingkan v2 yang punya koleksi
  audit durable (`product_changes`, `admin_role_changes`, `stock_movements` - `types.ts:203-212`,
  `firestore.rules:27,31`). Spec sadar ini dan menaruh `ponytail:` untuk koleksi audit (baris 661-664).
- **Kenapa blocking (konteks):** DoD S14 baris 807-820 tidak mencantumkan audit qty sebagai
  deliverable, tetapi R9/§9 menjanjikan "siapa mengubah qty" terjawab. Untuk data operasional bernilai
  (qty permintaan gudang), klaim audit yang tidak durable adalah janji palsu ke operasional.
- **Perbaikan konkret:** turunkan klaim di S9.1: nyatakan eksplisit bahwa **tidak ada** audit qty
  yang tahan lama di v3a (hanya `updated_at` + `updated_by` terakhir dokumen - dan bahkan `updated_by`
  tidak ada di skema S4.1, hanya `updated_at`). Tambahkan `updated_by` ke skema dokumen minimal, ATAU
  akui sebagai gap operasional tertulis dan naikkan koleksi `daily_request_changes` dari `ponytail:`
  ke scope bila sengketa qty dianggap nyata. Perhatikan: `updated_at` saja tidak menyimpan "dari X ke Y".

### B6. Item `qty=0` membuat dokumen MUSTAHIL `selesai`

- **Lokasi:** S3.7 baris 245-246 (`qty` 0 sah), S4.4 baris 347 (`selesai` hanya bila SEMUA item
  `datang`), S5.1 aksi `buat-form` (baris 430: "semua item sudah datang" -> 409), E3 (baris 627).
- **Bukti:** E3 bilang item qty 0 "tetap bisa dikirim dengan qty 0". `sesuaikan` menolak item yang
  sudah datang (S5.1 baris 420) dan `buat-form` menolak bila "semua item sudah datang" (baris 430).
  Skenario: dokumen punya item A (qty 0, sengaja tidak diminta) dan item B. B ditandai datang. A
  tidak pernah bisa diubah (`sesuaikan` hanya bila ada minimal 1 item belum datang - S3.1 baris 122;
  setelah B datang, A masih belum datang sehingga `sesuaikan` masih boleh - OK), tetapi `datang` A
  dengan `qty_datang=0` adalah satu-satunya jalan ke `selesai`. Bila admin tidak menandai A, dokumen
  nyangkut `diproses` selamanya walau semua barang fisik sudah tiba.
- **Kenapa blocking:** tidak ada jalur keluar dokumen. Aksi `selesai` manual (S5.1 baris 446-451)
  memang ada, tetapi guard-nya "minimal satu item `datang`" (baris 448) - jadi bisa dipakai. Namun
  `selesai` manual ditandai **OPSIONAL** (OQ-1, baris 720-721). Bila produk memilih menghapus `selesai`
  manual, dokumen dengan item qty 0 jadi dead-end. Ini kontradiksi scope.
- **Perbaikan konkret:** (1) tegaskan `datang` untuk item `qty_diminta=0` boleh `qty_datang=0` dan itu
  menutup item; DAN (2) jadikan `selesai` manual **wajib** (bukan opsional) atau definisikan auto-`selesai`
  sebagai "semua item `datang` ATAU `qty_diminta=0`". Putuskan OQ-1 sebelum W1, bukan "sebelum Wave 2".

---

## Non-blocking

1. **S3.5 contoh literal pakai spasi + middle dot ambigu.** Baris 203-204 `BRG-001 . 12 pcs` dan
   catatan baris 209-210 menyebut U+00B7, tetapi penulisan di blok kode adalah `" . "` (spasi-titik-spasi),
   bukan `" \u00B7 "`. Test #7 menuntut "PERSIS sama" - implementer bisa menulis titik ASCII `.` dan
   lulus review mata. Perjelas: literal harus memakai `\u00B7` (`\u00b7`), tulis escape-nya di spec.
2. **`formatAngka(null)` mengembalikan `"—"`** (`format.ts:53`), bukan `"-"`. S3.3 baris 152 dan E9
   (baris 633) menulis stok ditampilkan `-`. Inkonsistensi kosmetik, tapi test screenshot bisa gagal.
3. **S3.5 "Total: 2 item . 22 pcs"** - spec tidak mendefinisikan apakah total qty memakai
   `qty_diminta` (yang baru di-snapshot) atau `qty`. Untuk Kirim Ulang setelah `sesuaikan`, keduanya
   bisa beda. Perjelas sumber angka total.
4. **S6.5 respons sukses tidak mengembalikan `confirmed_at`/`confirmed_by`** padahal S9.2 menulisnya.
   Bila UI mau menampilkan audit, tidak tersedia. Minor.
5. **Rate limit 30/menit untuk campuran aksi** (S5.1 baris 379). `sesuaikan` adalah operasi
   penyetelan qty berulang; 30/menit bisa terlalu ketat bila admin menyetel banyak item dalam
   beberapa putaran dialog. Pertimbangkan hitung `sesuaikan` berbeda dari `buat-form` (yang memicu
   Telegram). Ini "soft guard" in-memory per-instance (`guard.js:44-45`) sehingga tidak reliabel
   lintas lambda - klaim "menahan spam pesan" (baris 380) terlalu kuat untuk rate limit per-instance.
6. **`formatTanggalSingkat` menerima `iso`** (`format.ts:80`), tetapi S3.5 baris 187-190
   mengirim `tanggal` dokumen (`"2026-09-15"`). `new Date("2026-09-15")` diparse sebagai UTC tengah
   malam; `Intl` dengan locale `id-ID` di server TZ tertentu bisa menghasilkan tanggal H-1. Perlu
   test khusus timezone, karena server Vercel default UTC sedangkan user WIB.
7. **`data-testid` baru (S3.9 baris 284-285) memakai `{kode}`** tetapi item diidentifikasi oleh
   `kode_barang`+`variasi` (S3.7). Dua item beda variasi, kode sama -> `input-qty-BRG-001` tabrakan.
   Ganti ke `${kode}::${variasi}` atau `{index}` stabil.

---

## Verifikasi klaim: spec vs kode aktual

| # | Klaim spec | Temuan kode aktual | Status |
|---|---|---|---|
| 1 | `konfirmasiKeyword` (`keywordNotes.js:59`) tidak pernah dipanggil siapa pun | `grep konfirmasiKeyword` = hanya definisi (`:59`), ekspor (`:117`), dan penyebutan di docs. Nol call site. | **BENAR** |
| 2 | `tambahItemKeDailyRequest` pola `runTransaction` (`dailyRequests.js:40-58`) | Terverifikasi `runTransaction` di baris 40; item menulis `kode_barang,nama,variasi,qty,buffer` (baris 46-55). | **BENAR** |
| 3 | `updateStatusDailyRequest:63` dead code | Fungsi ada (`:63`), diekspor (`:74`), TIDAK ada pemanggil di app/. Spec bilang "tidak diubah (bot)" (S5.2 baris 468) - klaim "bot memakai" salah; tidak ada pemakai. | **SEBAGIAN SALAH** |
| 4 | Route pola: `tolakOrigin` -> cookie -> `verifikasiTokenSesi` -> `cekRateLimit` -> validasi -> `ambilAdmin` -> log | `reorder-point/route.ts:28-38,43-50,57-73,138` persis urutan itu. | **BENAR** |
| 5 | Signature `verifikasiTokenSesi(t,{now})` -> `{uid,role}|null` | `sesi.js:44` `(token,{now=Date.now()})`; return payload `{uid,role,exp}` (baris 36) atau `null`. | **BENAR** |
| 6 | `ambilTokenDariCookie(cookieHeader)` | `sesi.js:86`. | **BENAR** |
| 7 | `tolakOrigin` / `cekRateLimit` bentuk return | `guard.js:29-42,58-71` -> `{ok:true}|{ok:false,status,error}`. | **BENAR** |
| 8 | `kirimPesan` default `parse_mode="Markdown"` (`kirimPesan.js:72`) | `:76` `parse_mode: opsi.parseMode || "Markdown"`. `parseMode:""` lolos ke Markdown. | **BENAR** |
| 9 | `kirimPesanPlain` BELUM ada | Ekspor `:225-236` tidak memuat `kirimPesanPlain`. Belum ada. | **BENAR** |
| 10 | `kirimPesanPanjang` ada | `:100`. | **BENAR** |
| 11 | `ambilSemuaAdminByRole` (`:126-129`) return `telegram_user_id`, BUKAN `id` | `:128` `({ telegram_user_id: doc.id, ...doc.data() })`. | **BENAR** |
| 12 | `kekuranganStok` (`format.ts:16`) = `max(0,-stok)`; null -> 0 | `:16-19`. | **BENAR** |
| 13 | `formatTanggal` (`:67`) ada jam; `formatTanggalSingkat` (`:80`) tanpa jam | `:67-78` (hour/minute), `:80-89` (tanpa jam). | **BENAR** |
| 14 | `keyword_notes` rules `staff()` read, write false | `firestore.rules:30`. | **BENAR** |
| 15 | `daily_requests` rules `allow read: if staff()` | `firestore.rules:23`. | **BENAR** |
| 16 | Budget sekarang 9/12 (8 `app/api/**/route.ts` + `api/webhook.js`) | 8 `route.ts` + `api/webhook.js` = 9. `dashboard-deploy.md:9` juga menyebut 9. | **BENAR** |
| 17 | `dataKosong()` cast sudah dihapus di v2 | `sumber-data.tsx:220` `} satisfies DataSource;` - cast sudah tidak ada. | **BENAR** |
| 18 | S13 W3c: "`satisfies` menagih" | Konsisten dengan `:220`. Tetapi S10/S13 lain masih mewarisi narasi "manual, compiler tidak menagih" dari v1/v2. | **INKONSISTEN INTERNAL** |
| 19 | `DailyRequestItem` punya `qty` yang dibaca `page.tsx:118,168` (`it.qty`) | `page.tsx:178` `formatAngka(it.qty)`, `:213` `formatAngka(item.qty)`. `types.ts:107` `qty: number`. | **BENAR** |
| 20 | Spec mempertahankan seksi Riwayat & Empty existing | `page.tsx:130-190` (Riwayat), `:96-106` (Empty hari ini), `:140-151` (Empty riwayat). Spec S3.9 hanya menyebut Empty hari ini & loading; Riwayat tidak dibahas sama sekali di tabel state. | **GAP** |
| 21 | Normalisasi lazy saat baca dipakai `ambilDailyRequest`/`ambilOrBuatDailyRequestHariIni` | UI real membaca lewat `real.ts:338` (client SDK), BUKAN `ambilDailyRequest`. Normalizer server tidak akan jalan di jalur baca UI. | **SALAH (blocking B3)** |
| 22 | `stock_write_guard` dipakai pola v2 untuk double-submit | `mutasi/route.ts:132-147` memakainya untuk mutasi stok. Spec F1 TIDAK menyebut guard ini untuk `buat-form`; hanya idempotensi 30 detik (S4.3). | **GAP (lihat Lubang #6)** |
| 23 | `created_at` dokumen bertipe `string` di UI | `types.ts:116` `created_at: string`; `real.ts:346` mengonversi via `keIso`. Tetapi `dailyRequests.js:30,44` menulis `created_at: new Date()` (objek Date). Field baru `qty_datang/datang_at` didefinisikan `Date|null` di S4.1 - tidak konsisten dengan konvensi UI `string`. | **INKONSISTENSI TIPE** |

---

## Lubang state machine (skenario tidak terjawab spec)

Merujuk daftar cek di brief. Status per item:

- **(a) Form dikirim saat dokumen kosong / tanpa item** - TERJAWAB: 400 "Permintaan belum berisi item."
  (S5.1 baris 429, E1/E7).
- **(b) Item ditandai datang saat dokumen `draft`** - **TIDAK TERJAWAB** (B1). Tidak ada transisi.
- **(c) Qty diubah setelah form dikirim tapi sebelum datang** - TERJAWAB: `sesuaikan` di `diproses`
  diizinkan (S3.1 baris 122), `qty_diminta` TIDAK ikut berubah (S4.3 baris 343). **Tetapi** ini
  menciptakan jurang: Telegram sudah dikirim dengan qty X, `qty` berubah ke Y, `qty_diminta` tetap X.
  Pesan yang sudah terkirim dan dokumen jadi tak sinkron - spec tidak bilang UI harus menandai
  "sudah beda dari yang dikirim". **GAP keputusan produk.**
- **(d) Semua item datang, aksi `datang` dipanggil lagi** - TERJAWAB: E6 baris 630 -> 409. Tetapi
  urutannya: bila dokumen sudah `selesai`, 409 "Permintaan sudah selesai."; bila belum `selesai`
  (mis. ada item qty 0 belum datang), 409 "Item ini sudah ditandai datang." **Konsisten.**
- **(e) Dokumen `selesai` lalu `sesuaikan`** - TERJAWAB: 409 (S3.1 baris 125, S5.1 baris 407).
- **(f) Satu item datang, item lain qty 0** - **TIDAK TERJAWAB** (B6): tidak jelas apakah item qty 0
  harus ditandai datang eksplisit, dan akibatnya pada auto-`selesai`.
- **(g) `qty_datang` > `qty_diminta`** - TERJAWAB: sah, tersimpan (S3.7 baris 249, E5).
- **(h) Qty 0 atau negatif** - TERJAWAB: 0 sah, negatif 400 (S3.7 baris 245-247, E3/E4).
- **(i) Item duplikat `kode_barang`+`variasi`** - TERJAWAB: digabung (S3.7 baris 236-242, E2).
  **Tetapi** lihat Tantangan #1: penggabungan menghapus `buffer` yang berbeda & tracking per item.
- **(j) Dokumen lama tanpa field status** - TERJAWAB: `normalisasiStatusDokumen` -> `draft`
  (S4.2 baris 330, S3.1 baris 128-130). **Tetapi** normalizer ini ada di model server, bukan di
  `real.ts` yang dipakai UI baca (B3).
- **(k) Tanggal dokumen bukan hari ini** - TERJAWAB: E8 baris 632 -> 404 untuk aksi, riwayat read-only.
  **Tetapi** guard "UI aksi hanya untuk tanggal hari ini" adalah guard **klien** saja; S5.1 tidak
  menetapkan guard **server** yang menolak `tanggal != hari ini`. Body `tanggal` berasal dari klien
  (S5.1 baris 384-387). Artinya siapa pun dengan sesi valid dapat `POST /api/permintaan` dengan
  `tanggal` lampau selama dokumen ada. **Celah keamanan/audit** - tidak ada requirement "tolak tanggal
  selain hari ini" di tabel validasi S5.1.

---

## Requirement tidak testable

Kutipan "kata sifat" dari spec, dengan kriteria terukur pengganti:

| Kutipan | Lokasi | Masalah | Kriteria terukur pengganti |
|---|---|---|---|
| "pesan Telegram berisi daftar permintaan yang **mudah di-copy** apa adanya" | S2.1 US-F1-3 baris 88 | "mudah di-copy" subjektif | Diuji via test string equality S3.5 (sudah ada di #7) + assert tidak ada `parse_mode` dan panjang <= 4096 char. Ganti kalimat jadi "pesan plain text identik dengan template S3.5". |
| "menahan **spam** pesan" | S5.1 baris 380 | "spam" tak terukur; rate limit in-memory per-instance (guard.js:44) tidak reliabel lintas lambda | Ganti jadi: "maksimum N pesan Telegram terkirim per uid per 60 detik; diuji via test route (11 panggilan -> 429)." |
| "pesan deterministik" | S3.5 baris 191 | "deterministik" perlu disepakati kuncinya | Sudah cukup terukur: "urut stabil alfabetis `nama` (case-insensitive, fallback `kode_barang`); diuji test #7." Perjelas case-sensitivity. |
| "target sentuh >= 44px" | S3.2 baris 140, S10 baris 680 | OK terukur | Pertahankan; tambah assert Playwright boundingBox height >= 44. |
| "tanpa scroll horizontal @360px" | S10 baris 681 | OK terukur | Pertahankan; tambah test viewport 360px `scrollWidth <= clientWidth`. |
| "kontras >= 4.5:1" | S10 baris 680 | OK terukur | Pertahankan; pakai `@axe-core/playwright` (sudah ada di devDependencies). |
| "**cepat**/responsif" | muncul implisit (S3.9 skeleton) | Tidak ada batas waktu eksplisit | Tambah NFR: "skeleton tampil <= 100ms; refetch pasca-submit selesai <= 2s pada data mock." |
| "**user-friendly**" | tidak literal, tetapi terkandung di S3.2/S3.9 | Implisit | Ganti dengan checklist state eksplisit (loading/kosong/error/sukses/disabled/401) + `data-testid`, sudah sebagian ada. |

Catatan: spec v3a relatif disiplin; hanya US-F1-3 "mudah di-copy" dan "menahan spam" yang benar-benar
longgar.

---

## Tantangan keputusan

### T1. Identifier `kode_barang`+`variasi`, duplikat DIGABUNG

- **Lokasi:** S3.7 baris 236-242, E2, R4.
- **Evaluasi:** Alasan menolak index array (concurrent rewrite) **valid** dan didukung: bot menulis
  ulang array (`dailyRequests.js:46-57`), jadi index tidak stabil. Tetapi penggabungan punya biaya:
  (a) `buffer` berbeda hilang - spec bilang `buffer = true` bila salah satu true (baris 242), sehingga
  item "MINTA" (perlu_request) bercampur "MINTA_SISA" (perlu_request_buffer) menjadi satu -
  **kehilangan semantik permintaan**. Dua item sengaja beda (satu buffer, satu tidak) akan salah
  keputusan gudang. (b) Item dengan `nama` berbeda tetapi kode+variasi sama (data bot kotor) akan
  memakai `nama` yang mana? Spec tidak menetapkan aturan merge `nama`.
- **Rekomendasi:** Jangan gabung saat baca. Gabungkan **hanya saat menyusun pesan Telegram** (agregasi
  display), dan pertahankan item terpisah di dokumen dengan key `${kode}::${variasi}::${buffer}`.
  Bila tetap digabung, (1) tetapkan `nama` = item pertama (stabil), (2) tolak gabung bila `buffer`
  berbeda (biarkan dua baris), (3) tambah test untuk kasus buffer konflik.

### T2. `selesai` tidak bisa dibatalkan

- **Lokasi:** S4.4 baris 351-354, S1.3 baris 68, matriks baris 602.
- **Evaluasi:** Alasan (a)(b)(c) masuk akal untuk v3a, dan "pemulihan = koreksi stok via halaman stok"
  adalah jalur keluar nyata. Namun kombinasi dengan B6 (item qty 0) dan salah-tanda `datang`
  (mis. admin menandai semua item datang padahal belum) membuat blokir permanen untuk data yang
  tidak bisa dikoreksi lewat UI. "Pemulihan lewat Firestore manual" bertentangan dengan tujuan F1
  ("tanpa menyentuh Firestore manual", S2.1 baris 80).
- **Rekomendasi:** Pertahankan tidak-bisa-batal untuk v3a, TETAPI (1) tambahkan konfirmasi dialog
  dua-langkah pada aksi `datang` terakhir ("Tandai semua barang datang? Dokumen akan selesai dan
  tidak bisa diubah."), dan (2) pastikan B6 diputuskan agar tidak ada dead-end. Jangan andalkan
  "intervensi Firestore" sebagai mitigasi UX.

### T3. Keyword notes owner-only vs rules `staff()`

- **Lokasi:** S6.3 baris 535, S7.1 baris 606-615, S6.5 baris 584.
- **Evaluasi:** Keputusan owner-only untuk **tulis** benar (mengubah perilaku bot). Tetapi spec
  owner-only juga untuk **baca** (baris 535, 603). Rules `keyword_notes` = `staff()` (`firestore.rules:30`),
  jadi admin **bisa** membaca via Firestore SDK walau UI menyembunyikan. Ini bukan celah (read-only),
  tetapi klaim S7.1 "mengikuti pola v2 S6.3 (mencegah kebocoran)" **tidak akurat**: rules tidak
  menyembunyikan apa pun dari admin. Selain itu, tidak ada halaman admin yang "tombolnya selalu 403":
  `ButuhAkses` menyembunyikan seluruh halaman (butuh-akses.tsx:13). Jadi klaim brief "UI admin akan
  menampilkan halaman yang tombolnya selalu 403" **tidak terjadi** - UI tidak dirender. Route tetap
  403 (S6.5 baris 584) sebagai pengaman, benar.
- **Rekomendasi:** Koreksi narasi S7.1: owner-only adalah keputusan **produk/UI**, bukan kontrol
  keamanan; admin tetap bisa baca lewat SDK. Bila confidentiality benar-benar diinginkan, ubah rules
  `keyword_notes` ke `owner()` (rules tidak punya fungsi itu - perlu ditambah). Putuskan eksplisit.

### T4. Route terpisah `/api/kata-kunci` (+1 -> 11/12)

- **Lokasi:** S6.4 baris 544-567, R6 baris 744, S10 baris 676.
- **Evaluasi:** Alasan "domain beda/kohesi" (baris 555-556) lemah secara rekayasa: kohesi kode bukan
  alasan menghabiskan margin produksi (12 function Hobby = batas keras; melebihi = deploy gagal).
  Margin tersisa 1 untuk v3b yang menurut baris 557 "mungkin memerlukan route sendiri" - dan v3b
  punya tiga fitur (A2/A5/A7). S6.4 sendiri mengakui ini (baris 559-561). Ini taruhan margin, bukan
  keputusan teknis murni.
- **Rekomendasi:** Secara default **gabung** `aksi: "konfirmasi-kata-kunci"` ke `/api/permintaan`
  (diskriminator `aksi` sudah ada, biaya kohesi kecil) dan sisakan 2 margin untuk v3b. Atau: turunkan
  v3b menjadi 1 route sejak sekarang (S6.4 baris 559 sudah mengusulkan pola ini). Membuang 1 function
  demi kohesi bertentangan dengan `BR-function budget` yang jadi batasan keras di seluruh v1/v2.
  Jalankan `vercel build` lebih awal (bukan hanya di Gate akhir) untuk mengunci fakta budget.

---

## Catatan bagian yang sudah benar

- Pola route (S5.1) menyalin `reorder-point/route.ts` dengan tepat, termasuk urutan `role dari
  ambilAdmin` (bukan body/sesi) - sesuai `reorder-point/route.ts:57-73`.
- Klaim `konfirmasiKeyword` belum dipanggil dan kelemahan `confidence: "guessed"` -> selalu
  `perlu_request` **terbukti** (`keywordNotes.js:104-108`). Ini temuan F2 valid & bernilai.
- Klaim `telegram_user_id` vs `id` (bug B1) **terbukti** (`admins.js:128`) dan mitigasi (test #8)
  tepat sasaran.
- Keputusan migrasi lazy (`normalisasiItemLama`) tepat sebagai prinsip - hanya lokasi penerapannya
  yang salah (B3).
- Keputusan plain text tanpa `parse_mode` tepat: `kirimPesan` memang retry plain hanya bila
  Telegram membalas "can't parse entities" (`kirimPesan.js:39-55`), yang tidak menjamin sukses pada
  percobaan pertama. Helper `kirimPesanPlain` valid.

---

## Status

**PASS WITH CHANGES** - 6 blocking (B1-B6) harus ditutup sebelum Wave 1/Wave 2 dikunci.
