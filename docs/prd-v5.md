# PRD v5 - Dashboard Multi-Gudang, Permintaan Antar-Gudang, Opname ber-Approval, Is-Online, Jabatan

Status: implementation-ready (revisi 3, menutup review adversarial pass-1 T1-T30 dan pass-2 V1-V15).
Tanggal revisi 1: 2026-09-16.
Tanggal revisi 2: 2026-09-16 (menutup T1-T30 + keputusan R1-R5).
Tanggal revisi 3: 2026-09-16 (menutup V1-V15 + keputusan user V4b; lihat bagian 18 dan 19).
Sumber: `docs/discovery-v5.md` (D1a, D2a, D3a, D4a, D5c + Q1a..Q5a), `docs/research-dashboard-wms.md`, `docs/learnings.md`, `docs/prd-v5-review.md`, `docs/prd-v5-review-2.md`.
Revisi 2 mengadopsi keputusan user baru R1-R5 (bagian 17). R2 MENGUBAH keputusan Q1a lama: sekarang status adalah PER-TUJUAN.
Revisi 3 menutup temuan review pass-2 V1-V15 (bagian 18) dan mengadopsi keputusan user V4b (bagian 19): `tutup-tujuan` mencatat qty ASLI barang tujuan di `stock_movements` untuk rekonsiliasi.
Keputusan terkunci TIDAK dibuka ulang di dokumen ini kecuali dinyatakan eksplisit sebagai perubahan R1-R5.

---

## 1. Executive summary

Dashboard admin toko diperluas dari satu wadah stok (`stock.stok_gudang_online`) menjadi stok per gudang.
Owner/admin dapat mengelola master gudang (maksimum 50, R3), menandai gudang kerja tiap user, mengirim permintaan
antar-gudang ke banyak tujuan sekaligus (satu dokumen, status PER-TUJUAN), melakukan stok opname
yang selisihnya wajib disetujui owner, dan men-toggle `is_online_product` dari dashboard.
Jabatan user menjadi label kosmetik editable tanpa mengubah permission (`owner/admin/guest`).
Semua tulis lewat route server + firebase-admin.
READ lintas gudang DIIZINKAN untuk semua staff (keputusan user R5): scope gudang HANYA membatasi default filter dan operasi tulis, TIDAK membatasi read.
Target user: owner (approval + kelola), admin (operasional harian), guest (baca).

---

## 2. Non-goals

Disalin dari `docs/discovery-v5.md:71-87`:

- Integrasi Kledo/ERP/sheets master apa pun. Data murni Firestore lokal.
- Gudang transit / in-transit (D3a). Cukup `dikirim` -> `diterima`/`tidak_terima`, tanpa lokasi virtual.
- Approval berlapis permintaan (D4a). Satu langkah `disetujui` eksplisit cukup.
- Reorder point per gudang. `reorder_point` tetap satu nilai per `stock/{kode}`.
- Barcode / QR / scanner. Input manual.
- Batch / lot / expiry / serial number.
- Hierarki gudang / bin-location. Daftar gudang flat.
- Slotting / putaway / picking optimization / wave planning.
- Permission granular per jabatan. Jabatan kosmetik.
- Migrasi riwayat `stock_movements` lama ke per-gudang.
- Auto-expire / timeout dokumen `permintaan_gudang`. Dokumen `dikirim` yang nyangkut ditutup manual owner (R2, aksi `tutup-tujuan`).

---

## 3. Persona & permission matrix

Level: `owner`, `admin`, `guest` - dari `admins.role` (`lib/models/admins.js:9-13`, `lib/dashboard/types.ts:5`).
Jabatan (label bebas) TIDAK pernah jadi input otorisasi (`research-dashboard-wms.md:154-171`).

| Aksi | owner | admin | guest |
|---|---|---|---|
| Lihat stok / produk / movement | YA | YA | YA |
| Lihat master gudang | YA | YA | YA (read-only, T19) |
| Lihat permintaan_gudang / opname_gudang (semua gudang) | YA | YA | TIDAK |
| Lihat stok lintas gudang (semua key `qty_per_gudang`) | YA | YA | YA (R5) |
| Filter stok per gudang (scope) | YA (semua gudang) | YA (default `gudang_id` sendiri, dapat diganti) | YA (default `gudang_id` sendiri bila ada) |
| Toggle `is_online_product` | YA | YA | TIDAK |
| Buat permintaan antar-gudang | YA | YA | TIDAK |
| Setujui / tolak permintaan | YA | YA | TIDAK |
| Batalkan permintaan (`batal`) | YA | YA (pembuat atau admin mana pun, R1) | TIDAK |
| Kirim permintaan (`kirim`) | YA | YA | TIDAK |
| Terima / tidak-terima per tujuan | YA | YA | TIDAK |
| Tutup tujuan nyangkut (`tutup-tujuan`) | YA | TIDAK | TIDAK |
| Input opname (buat `menunggu_approval`) | YA | YA | TIDAK |
| Approve / tolak opname berselisih | YA | TIDAK | TIDAK |
| Kelola master gudang (tambah/edit/nonaktif/aktifkan) | YA | TIDAK | TIDAK |
| Set flag gudang per item (`qty_per_gudang`) | YA | YA | TIDAK |
| Set flag gudang per user (`gudang_id`) | YA | TIDAK | TIDAK |
| Set jabatan user (`jabatan`) | YA | TIDAK | TIDAK |

Catatan: `setujui` permintaan boleh ditekan admin/owner MANA PUN (Q2a) - tidak dibatasi ke gudang asal/tujuan.
`batal` boleh dilakukan pembuat permintaan atau admin/owner mana pun (R1).
Semua aksi bertanda YA untuk admin divalidasi ULANG dari `admins/{uid}` di server (pola `app/api/stok/mutasi/route.ts:87-103`).
Penegakan read lintas gudang: DIIZINKAN untuk stok dan untuk `permintaan_gudang`/`opname_gudang` (R5, bagian 8). Scope gudang hanya membatasi default filter (Q3a) dan operasi tulis (BR7).

---
## 4. Requirement fungsional

### F1 - Master gudang (tambah/edit/nonaktif/aktifkan)

Deskripsi: owner mengelola koleksi `gudang`. Gudang tidak dihapus keras, hanya `aktif:false`,
supaya referensi `gudang_id` lama tetap valid (`discovery-v5.md:114-116`). Maksimum 50 gudang (R3).

Acceptance criteria:
- `POST /api/gudang` aksi `tambah` dengan `nama` valid (1-60 karakter setelah trim) membuat
  satu dokumen `gudang/{autoId}` dengan `aktif:true`, `urutan` = (maks urutan existing + 1), `created_at`, `created_by`.
- Aksi `tambah` dengan `nama` duplikat (case-insensitive, trim) pada gudang `aktif:true` -> HTTP 409, pesan `"Nama gudang sudah dipakai."`, TIDAK menulis dokumen.
- Aksi `tambah` dengan `nama` kosong/whitespace -> HTTP 400, pesan `"Nama gudang wajib diisi."`.
- Aksi `tambah` ketika jumlah dokumen `gudang` (aktif maupun nonaktif) SUDAH 50 -> HTTP 400, pesan `"Maksimal 50 gudang."`, TIDAK menulis dokumen (R3, BR15).
- Aksi `edit` dengan `gudang_id` ada dan `nama` valid mengubah `nama` + `updated_at` + `updated_by`; `gudang_id` tidak ditemukan -> HTTP 404.
- Aksi `edit` dengan `nama` duplikat gudang aktif lain -> HTTP 409.
- Aksi `nonaktif` dengan `gudang_id` ada mengubah `aktif` -> `false` + `nonaktif_at` + `nonaktif_by`; dokumen TIDAK dihapus.
- Aksi `nonaktif` untuk gudang yang masih dirujuk -> tetap sukses, tetapi respons memuat `peringatan_referensi:<jumlah>` di mana jumlah = (jumlah `admins.gudang_id == gudang_id`) + (jumlah dokumen `stock` yang punya key `qty_per_gudang[gudang_id]`). Tidak rollback.
  - AC rinci (T11c): `peringatan_referensi` = `adminCount + stockKeyCount`. `adminCount` dihitung dari koleksi `admins` (full scan + filter client, pola `real.ts:380-396`). `stockKeyCount` dihitung dari full scan `stock` + cek `qty_per_gudang` memuat key gudang.
- Aksi `aktifkan` mengubah `aktif` -> `true`.
- Semua aksi owner-only: admin/guest -> HTTP 403, pesan `"Hanya owner yang dapat mengelola gudang."`.
- `listGudang()` mengembalikan gudang `aktif:true` default; `{ semua: true }` (owner) menyertakan yang nonaktif.
- Menambah gudang berturut-turut sampai tepat 50 -> sukses; tambah ke-51 -> 400 `"Maksimal 50 gudang."` (menggantikan AC lama "20 gudang tanpa batas", T23).

Edge case:
- `nama` berbeda hanya pada spasi/kapitalisasi dianggap duplikat.
- `urutan` bertabrakan (dua tambah berbarengan) -> kedua dokumen tetap tersimpan selama masih <= 50; `urutan` boleh sama, pengurutan sekunder = `nama` ascending.
- `gudang_id` berisi karakter path Firestore (`/`) -> HTTP 400 `"ID gudang tidak valid."`.
- Nonaktifkan gudang terakhir yang aktif -> sukses (tidak ada aturan minimal 1 gudang aktif).
- Duplikat nama dibandingkan TERHADAP gudang `aktif:true` saja; gudang nonaktif dengan nama sama tidak menghalangi.

### F2 - Flag gudang per item (`qty_per_gudang`)

Deskripsi: admin menulis qty per gudang pada `stock/{kode}.qty_per_gudang[gudang_id]`
(D2a, `discovery-v5.md:96-99`). Audit ke `stock_movements` dengan penanda gudang.

Acceptance criteria:
- `POST /api/stok/gudang` aksi `set-qty` dengan `kode_barang`, `gudang_id` aktif, `qty` integer >= 0
  menulis `qty_per_gudang.<gudang_id>` = qty, `last_updated`, `last_updated_by`.
- Menulis satu key gudang TIDAK mengubah key gudang lain (uji dengan dua gudang: nilai gudang kedua tetap).
- Bila `gudang_id == "ONLINE"`, route JUGA menulis `stok_gudang_online` = qty dalam transaksi yang sama (paritas BR3), dan sebaliknya jalur lama `_ubahStokRelatif` (`lib/models/stok.js:51-67`) juga menyelaraskan `qty_per_gudang["ONLINE"]`.
- Setelah sukses, respons memuat `qty_per_gudang` utuh (semua key) dari hasil baca ulang.
- `kode_barang` tanpa dokumen `stock` -> HTTP 404, pesan `"Stok produk tidak ditemukan."`, TIDAK membuat dokumen baru.
- `gudang_id` nonaktif atau tidak ada -> HTTP 400, pesan `"Gudang tidak dikenal."`.
- `qty` bukan integer atau negatif -> HTTP 400, pesan `"Jumlah harus bilangan bulat >= 0."`.
- Setiap sukses menulis satu `stock_movements` `{type:"koreksi_manual", action_type:"set_qty_gudang", gudang_id:<id>}`; gagal audit TIDAK rollback tapi respons memuat `peringatan_audit:true`.
- Admin dengan `gudang_id` terisi hanya boleh menulis qty gudang miliknya -> gudang lain HTTP 403. Owner boleh menulis gudang mana pun (scope tulis, BR7). Read lintas gudang tetap diizinkan (R5).

Edge case:
- `qty_per_gudang` belum ada di dokumen -> dibuat sebagai map baru lewat `set(..., {merge:true})`, field lain (`stok_gudang_online`, `reorder_point`) tidak hilang.
- Set qty = 0 -> key tetap ditulis dengan nilai 0 (bukan dihapus).
- Jumlah key `qty_per_gudang` TIDAK divalidasi terhadap 50 (key warisan/historis boleh tetap ada). Batas relevan = batas gudang saat membuat gudang baru (BR15) dan batas 40.000 index entries/dokumen (`research-dashboard-wms.md:33`). Dengan maksimum 50 gudang, map aman jauh di bawah 1 MiB (perhitungan bagian 11). Bila `qty_per_gudang` sudah punya lebih dari 50 key (mis. gudang nonaktif lama), route tetap sukses; tidak ada guard khusus (T23: batas gudang ditegakkan di F1, bukan di sini).

### F3 - Flag gudang per user

Deskripsi: owner menetapkan satu gudang kerja ke tiap admin (`discovery-v5.md:122-124`).

Acceptance criteria:
- `POST /api/admin` aksi `set-gudang-user` dengan `target_user_id` (ada di `admins`) + `gudang_id` aktif -> menulis `admins/{uid}.gudang_id`.
- `gudang_id: null` -> menghapus penetapan (field di-set `null`).
- `target_user_id` tidak ada di `admins` -> HTTP 404, pesan `"User belum terdaftar."`.
- `gudang_id` tidak ada / nonaktif -> HTTP 400, pesan `"Gudang tidak dikenal."`.
- Aksi owner-only; admin -> HTTP 403, pesan `"Hanya owner yang dapat mengatur lokasi user."`.
- Perubahan dicatat ke `admin_role_changes` dengan `catatan:"set_gudang"` (audit lokasi memakai koleksi yang sama; `old_role`/`new_role` = role tidak berubah).
- Mengubah `gudang_id` TIDAK mengubah `role`.
- Dispatcher validasi (Z1): aksi `set-gudang-user` DITERIMA oleh `validasiAksiAdmin` di `lib/dashboard/validasiTulisV3a.js` (bukan ditolak HTTP 400 "Aksi tidak dikenal."). Body valid (`target_user_id` pola `^\d+$` + `gudang_id` string atau `null`) -> validator mengembalikan `{ok:true, status:200, aksi:"set-gudang-user", targetUserId, gudangId}` dan route melanjutkan ke handler tulis. Body invalid (`target_user_id` hilang/bukan digit) -> HTTP 400 `"User ID Telegram tidak valid."` dari validator.

Edge case:
- Owner tanpa `gudang_id` -> `gudang_id:null` sah (owner lihat semua, Q3a).
- Set `gudang_id` ke gudang yang baru dinonaktifkan dalam request yang sama -> 400.
- Admin dengan `gudang_id` menunjuk gudang nonaktif -> `listStock()` mengembalikan 0 baris + flag `gudang_nonaktif:true` + pesan `"Gudang kerja Anda dinonaktifkan. Hubungi owner."` (T11a).

### F4 - Jabatan editable

Deskripsi: label bebas per user, kosmetik, tanpa efek permission (`discovery-v5.md:46-49`).

Acceptance criteria:
- `POST /api/admin` aksi `set-jabatan` dengan `jabatan` string (0-40 karakter setelah trim) menulis `admins/{uid}.jabatan`.
- `jabatan` kosong -> menyimpan `null` (menghapus label).
- `jabatan` > 40 karakter -> HTTP 400, pesan `"Jabatan maksimal 40 karakter."`.
- Aksi owner-only; admin -> HTTP 403.
- Mengubah `jabatan` TIDAK mengubah `role` (uji: role sebelum == role sesudah) dan TIDAK mengubah hasil permission check.
- AC negatif otorisasi (T12): request `POST /api/admin` dengan body memuat `jabatan:"owner"` pada sesi user ber-role `guest` -> tetap HTTP 403. Body `jabatan` TIDAK pernah dibaca sebagai pengganti `role`. Test: `test/adminGudangJabatan.test.js` meng-import `POST()` dari `app/api/admin/route.ts` dan mengirim `jabatan`; assert 403. Plus negative-grep: string `jabatan` TIDAK boleh muncul di jalur otorisasi (`app/api/**/route.ts` di luar blok `set-jabatan`, `lib/dashboard/auth/**`).
- `jabatan` muncul di `listAdmins()` dan di daftar pilihan "Kirim ke: User" (F6).
- Dispatcher validasi (Z1): aksi `set-jabatan` DITERIMA oleh `validasiAksiAdmin` di `lib/dashboard/validasiTulisV3a.js` (bukan ditolak HTTP 400 "Aksi tidak dikenal."). Body valid (`target_user_id` pola `^\d+$` + `jabatan` string 0-40 karakter atau `null`/absen) -> `{ok:true, status:200, aksi:"set-jabatan", targetUserId, jabatan}` dan route melanjutkan. `jabatan` > 40 karakter -> HTTP 400 `"Jabatan maksimal 40 karakter."` dari validator.

Edge case:
- `jabatan` dengan karakter non-ASCII (emoji) sah selama <= 40 karakter (hitung per code point, bukan byte).
- Dua user boleh punya jabatan identik (bukan key, hanya label).

### F5 - Permintaan antar-gudang (buat/setujui/tolak/batal/kirim/terima/tidak-terima/tutup-tujuan)

Deskripsi: dokumen `permintaan_gudang` dengan SATU dokumen berisi banyak `tujuan[]`, tiap tujuan punya status SENDIRI (R2). Stok asal turun SEKALI saat `kirim`. Stok tujuan naik saat `terima` tujuan itu. Status dokumen keseluruhan adalah TURUNAN dari status semua tujuan (R2, BR5).

#### F5.1 Definisi status tujuan dan status dokumen

Status tiap entri `tujuan[]`:
- `menunggu` - tujuan belum menerima/menolak barang (status awal tiap entri, di-set saat `kirim`).
- `diterima` - penerima menerima barang; stok gudang tujuan naik.
- `tidak_terima` - penerima menolak barang; stok dikembalikan ke gudang asal (R2).
- `ditutup` - owner menutup tujuan nyangkut; TIDAK mengubah stok (barang dianggap hilang/selesai di luar sistem), TETAPI `stock_movements` WAJIB mencatat qty ASLI barang tujuan itu (V4b, F5.2, R17).

Status dokumen keseluruhan (TURUNAN, tidak diset manual):
- `menunggu` - dokumen belum disetujui.
- `disetujui` - dokumen disetujui, belum dikirim.
- `ditolak` - dokumen ditolak (terminal).
- `dibatalkan` - dokumen dibatalkan (terminal).
- `dikirim` - ada minimal satu tujuan masih `menunggu`.
- `selesai` - SEMUA tujuan `diterima`/`tidak_terima`/`ditutup` (tidak ada yang `menunggu`).

Catatan: field `status` dokumen disimpan (bukan dihitung on-read) tetapi WAJIB di-recompute server pada setiap transisi tujuan di dalam transaksi yang sama (BR5, AC F5.3).
Catatan legalitas aksi: legal/tidaknya `terima`/`tidak-terima`/`tutup-tujuan` ditentukan oleh status ENTRI `tujuan[k]`, bukan hanya status dokumen. Tujuan berstatus `ditutup` TERMINAL: tidak ada aksi apa pun yang dapat mengubahnya lagi (V1, V3).

#### F5.2 Tabel transisi eksplisit (T6)

Format: `dari_status | aksi | ke_status | siapa | efek stok | efek audit`.

| dari_status | aksi | ke_status | siapa | efek stok | efek audit |
|---|---|---|---|---|---|
| `menunggu` | `setujui` | `disetujui` | owner/admin mana pun (Q2a) | tidak ada | `disetujui_oleh`, `disetujui_at`, `riwayat_status` |
| `menunggu` | `tolak` | `ditolak` | owner/admin mana pun | tidak ada | `ditolak_oleh`, `ditolak_at`, `riwayat_status` |
| `menunggu` | `batal` | `dibatalkan` | pembuat atau admin/owner mana pun (R1) | tidak ada (stok belum turun) | `dibatalkan_oleh`, `dibatalkan_at`, `riwayat_status` |
| `menunggu` | `ubah-item` | `menunggu` (isi berubah) | pembuat atau admin/owner | tidak ada | `riwayat_status` entri `ubah_item` |
| `disetujui` | `kirim` | `dikirim` | owner/admin mana pun | `qty_per_gudang[dari_gudang_id]` turun SEKALI sebesar total qty item | `dikirim_oleh`, `dikirim_at`, `riwayat_status`, `stock_movements` tiap item (`action_type:"mutasi_gudang"`, arah keluar) |
| `disetujui` | `batal` | `dibatalkan` | pembuat atau admin/owner mana pun (R1) | tidak ada (stok belum turun) | `dibatalkan_oleh`, `dibatalkan_at`, `riwayat_status` |
| `dikirim` | `terima` (status ENTRI tujuan ke-k = `menunggu`) | tetap `dikirim` bila masih ada tujuan `menunggu`; `selesai` bila itu tujuan terakhir | owner/admin mana pun | `qty_per_gudang[gudang_tujuan_k]` NAIK sebesar total qty item tujuan itu | entri `tujuan[k].diterima_at/diterima_oleh`, `riwayat_status`, `stock_movements` (masuk) |
| `dikirim` | `tidak-terima` (status ENTRI tujuan ke-k = `menunggu`) | tetap `dikirim` bila ada tujuan `menunggu` lain; `selesai` bila terakhir | owner/admin mana pun | `qty_per_gudang[dari_gudang_id]` NAIK sebesar total qty item tujuan itu (kembalikan ke asal, R2) | entri `tujuan[k].tidak_terima_at/tidak_terima_oleh`, `riwayat_status`, `stock_movements` (`action_type:"pengembalian_gudang"`, arah masuk ke asal) |
| `dikirim` | `tutup-tujuan` (status ENTRI tujuan ke-k = `menunggu`) | tetap `dikirim` bila ada `menunggu` lain; `selesai` bila terakhir | OWNER ONLY | TIDAK mengubah stok (barang dianggap selesai di luar sistem); qty ASLI barang tujuan itu TETAP dicatat (V4b) | entri `tujuan[k].ditutup_at/ditutup_oleh/catatan_alasan`, `riwayat_status`, `stock_movements` (`type:"koreksi_manual"`, `action_type:"tutup_tujuan"`, `gudang_id:<dari_gudang_id>`, `qty` = qty ASLI barang tujuan itu (BUKAN 0), `catatan_alasan` 1-200 char) |
| `dikirim` | `terima`/`tidak-terima`/`tutup-tujuan` (status ENTRI tujuan ke-k = `diterima`) | 409 `"Tujuan ini sudah diterima."` | - | tidak ada | - |
| `dikirim` | `terima`/`tidak-terima`/`tutup-tujuan` (status ENTRI tujuan ke-k = `tidak_terima`) | 409 `"Tujuan ini sudah tidak diterima."` | - | tidak ada | - |
| `dikirim` | `terima`/`tidak-terima`/`tutup-tujuan` (status ENTRI tujuan ke-k = `ditutup`) | 409 `"Tujuan ini sudah ditutup."` | - | tidak ada (V3: stok asal TIDAK berubah, barang tidak diciptakan) | - |
| `dikirim` | `terima`/`tidak-terima`/`tutup-tujuan` (indeks tujuan ke-k di luar `tujuan[]`) | 409 `"Tujuan tidak ditemukan."` | - | tidak ada | - |
| `dikirim` | `kirim` (kirim ulang) | 409 `"Permintaan sudah dikirim."` | - | tidak ada | - |
| `dikirim` | `setujui`/`tolak`/`batal`/`ubah-item` | 409 `"Permintaan sudah diproses."` | - | tidak ada | - |
| `disetujui` | `terima`/`tidak-terima`/`tutup-tujuan` | 409 `"Permintaan belum dikirim."` | - | tidak ada | - |
| `disetujui` | `setujui`/`tolak`/`ubah-item` | 409 `"Permintaan sudah diproses."` | - | tidak ada | - |
| `disetujui` | `kirim` (kirim kedua) | 409 `"Permintaan sudah dikirim."` | - | tidak ada | - |
| `menunggu` | `kirim` | 409 `"Permintaan belum disetujui."` | - | tidak ada | - |
| `menunggu` | `terima`/`tidak-terima` | 409 `"Permintaan belum dikirim."` | - | tidak ada | - |
| `menunggu` | `tutup-tujuan` | 409 `"Permintaan belum dikirim."` | - | tidak ada | - |
| `ditolak` | apa pun selain `buat` dokumen baru | 409 `"Permintaan sudah ditolak."` | - | tidak ada | - |
| `dibatalkan` | apa pun | 409 `"Permintaan sudah dibatalkan."` | - | tidak ada | - |
| `selesai` | apa pun | 409 `"Permintaan sudah selesai."` | - | tidak ada | - |

Aturan umum jalur ilegal: server mengembalikan HTTP 409 dengan pesan spesifik di atas, TIDAK menulis apa pun.
Legalitas `terima`/`tidak-terima`/`tutup-tujuan` SELALU ditentukan status ENTRI `tujuan[k]` (bukan hanya status dokumen). Tujuan berstatus `ditutup` TERMINAL: TIDAK ada aksi apa pun yang dapat mengubahnya lagi (V1, V3).
Setiap baris 409 di atas WAJIB punya AC padanannya di F5.3 dan test di `test/permintaanGudang.test.js` (bagian 18 V1).

#### F5.3 Acceptance criteria

- `POST /api/permintaan-gudang` aksi `buat` dengan `dari_gudang_id`, `tujuan[]` (>=1 entri valid), `items[]` (1 <= jumlah <= 200 item, tiap qty integer >= 1, tiap `kode_barang` ada di `stock`) membuat satu dokumen status `menunggu`, tiap entri `tujuan[]` berstatus `menunggu`.
- `tujuan[]` kosong -> HTTP 400, pesan `"Pilih minimal satu tujuan."`.
- `tujuan[]` > 20 -> HTTP 400, pesan `"Maksimal 20 tujuan."`.
- `items[]` kosong -> HTTP 400, pesan `"Permintaan belum berisi item."`.
- `items[]` > 200 -> HTTP 400, pesan `"Maksimal 200 item."` (T23, selaras bagian 11).
- `dari_gudang_id` = gudang nonaktif/tidak ada -> HTTP 400, pesan `"Gudang asal tidak dikenal."`.
- `dari_gudang_id` = salah satu `tujuan` bertipe gudang -> HTTP 400, pesan `"Gudang asal tidak boleh jadi tujuan."`.
- Tujuan bertipe user yang resolve ke `gudang_id` == `dari_gudang_id` -> HTTP 400, pesan `"Tujuan sama dengan gudang asal."` (T13).
- Satu request `buat` yang identik (uid + dari_gudang_id + tujuan + items) dalam 10 detik -> HTTP 409, pesan `"duplikat"`, hanya satu dokumen dibuat (guard `permintaan_gudang_guard`).
- Aksi `setujui` hanya berhasil dari status `menunggu`; dari status lain -> HTTP 409 sesuai tabel F5.2.
- Aksi `setujui` boleh ditekan admin/owner mana pun (Q2a): admin dengan `gudang_id` berbeda dari `dari_gudang_id` dan berbeda dari seluruh `tujuan` tetap sukses.
- Aksi `tolak` dari `menunggu` -> status `ditolak`, TIDAK ada perubahan stok.
- Aksi `batal` dari `menunggu` ATAU `disetujui` (R1) -> status `dibatalkan`; stok TIDAK berubah (belum turun); siapa: pembuat atau admin/owner mana pun; pemanggil yang BUKAN pembuat DAN BUKAN admin/owner -> HTTP 403. Batal dari status lain BUKAN 403 melainkan 409 (lihat AC berikutnya, tabel F5.2 baris `dikirim`).
- Aksi `batal` dari `dikirim`/`selesai`/`ditolak`/`dibatalkan` -> HTTP 409 `"Permintaan sudah diproses."`.
- Aksi `kirim` hanya dari status `disetujui`; dari status lain -> HTTP 409.
- Aksi `kirim` mengurangi `qty_per_gudang[dari_gudang_id]` sebesar total qty item SEKALI, dan TIDAK menambah gudang tujuan (uji stok tujuan sebelum == sesudah saat `kirim`). Setiap entri `tujuan[]` di-set `menunggu`.
- Aksi `kirim` ketika `qty_per_gudang[dari_gudang_id]` < qty diminta -> HTTP 409, pesan `"Stok gudang asal tidak cukup."`, TIDAK menulis apa pun (BR1).
- Aksi `terima` hanya valid bila status dokumen `dikirim` DAN entri tujuan ke-k masih `menunggu`; status entri bukan `menunggu` -> HTTP 409 dengan pesan spesifik tabel F5.2 (`"Tujuan ini sudah diterima."` / `"Tujuan ini sudah tidak diterima."` / `"Tujuan ini sudah ditutup."`).
- `terima` untuk tujuan ke-k menambah `qty_per_gudang[gudang_tujuan_k]` sesuai qty item; menyimpan `tujuan[k].status = "diterima"`, `diterima_at`, `diterima_oleh`; setelah itu status dokumen di-recompute.
- `terima` yang dipanggil dua kali untuk tujuan yang SAMA -> HTTP 409 `"Tujuan ini sudah diterima."`, stok TIDAK bertambah dua kali.
- `tidak-terima` untuk tujuan ke-k mengembalikan stok ke gudang ASAL: `qty_per_gudang[dari_gudang_id]` + qty item tujuan itu (R2); menyimpan `tujuan[k].status = "tidak_terima"`, `tidak_terima_at`, `tidak_terima_oleh`; menulis `stock_movements` `action_type:"pengembalian_gudang"`.
- `tidak-terima` yang dipanggil dua kali untuk tujuan yang sama -> HTTP 409, stok TIDAK bertambah dua kali.
- `tidak-terima` HANYA valid bila status ENTRI tujuan ke-k masih `menunggu` (V3). Pada tujuan `ditutup` -> HTTP 409 `"Tujuan ini sudah ditutup."` dan `qty_per_gudang[dari_gudang_id]` TIDAK berubah (assert: nilai sebelum == sesudah). Ini mencegah stok diciptakan dari barang yang sudah dianggap hilang. Test urutan: `tutup-tujuan` lalu `tidak-terima` pada tujuan sama -> 409, stok asal tetap.
- `tutup-tujuan` (owner-only) untuk tujuan ke-k yang masih `menunggu`: TIDAK mengubah saldo stok apa pun (TETAPI qty ASLI barang tujuan WAJIB dicatat di `stock_movements`, lihat AC berikutnya); wajib menulis `catatan_alasan` (string 1-200 karakter); tanpa catatan -> HTTP 400 `"Alasan wajib diisi."`; admin -> 403. Menyimpan `tujuan[k].status = "ditutup"` (dihitung sebagai tujuan yang tidak lagi `menunggu`).
- `tutup-tujuan` WAJIB menulis satu `stock_movements` dengan `type:"koreksi_manual"`, `action_type:"tutup_tujuan"`, `gudang_id:<dari_gudang_id>`, dan `qty` = qty ASLI total barang tujuan ke-k (BUKAN 0) (V4b). `catatan_alasan` 1-200 char ikut tersimpan di entri `tujuan[k]` dan di movement. Respons memuat `qty_hilang` = qty ASLI tujuan itu. Rekonsiliasi kapan pun: query `stock_movements where action_type == "tutup_tujuan"` dan jumlahkan `qty`. Gagal tulis movement -> TIDAK rollback stok (BR10), respons `peringatan_audit:true`.
- `tutup-tujuan` pada tujuan yang status ENTRI-nya sudah `diterima`/`tidak_terima`/`ditutup` -> HTTP 409 sesuai tabel F5.2; tujuan `ditutup` TIDAK dapat ditutup ulang.
- Recompute status dokumen (R2): `selesai` bila SEMUA entri `tujuan[]` berstatus `diterima`/`tidak_terima`/`ditutup`; `dikirim` bila ada minimal satu `menunggu`.
- AC recompute kombinasi (V2), diuji di `test/permintaanGudang.test.js` dan model test:
  - 3 tujuan berstatus `diterima` + `tidak_terima` + `ditutup` -> status dokumen `selesai` (BUKAN `dikirim`; `ditutup` dihitung sebagai selesai).
  - 2 tujuan berstatus `diterima` + `menunggu` -> status dokumen tetap `dikirim`.
  - 2 tujuan berstatus `ditutup` + `menunggu` -> status dokumen tetap `dikirim`.
  - 3 tujuan berstatus `diterima` + `diterima` + `tidak_terima` -> status dokumen `selesai`.
  - Dokumen dengan semua tujuan `ditutup` -> status dokumen `selesai`.
  - Setiap kali status dokumen berubah menjadi `selesai`, `selesai_at` terisi TEPAT sekali (transisi berikutnya 409, tidak menulis ulang).
- AC race `terima` vs `tutup-tujuan` pada tujuan SAMA (V5): keduanya dijalankan bersamaan -> TEPAT SATU menang, yang kalah HTTP 409 `"Tujuan ini sudah ditutup."` atau `"Tujuan ini sudah diterima."`; stok konsisten (gudang tujuan naik ATAU tidak naik, TIDAK keduanya). CAS pada `tujuan[k].status` di dalam `runTransaction` (bagian 11). Diuji deterministik lewat model test `test/casModelFirestore.test.js` (bagian 12, V7); verifikasi staging dicatat di PR.
- Tujuan bertipe `user`: `terima` menambah stok gudang SNAPSHOT yang disimpan saat `buat` (T10), BUKAN `gudang_id` user saat `terima`. Bila user tidak punya `gudang_id` saat `buat`, entri tujuan menyimpan `gudang_id_snapshot:null` dan `terima` oleh user tersebut TIDAK menambah stok gudang mana pun (entri tetap selesai).
- Respons `kirim`/`terima`/`tidak-terima` memuat status dokumen terbaru + `tujuan[]` + `qty_per_gudang` asal/tujuan yang berubah (hasil baca ulang).
- Setiap transisi status dicatat di `riwayat_status[]` sebagai `{status, oleh, at}`.
- Korespondensi tabel F5.2 (V1): SETIAP baris 409 di tabel punya AC di sini, dan sebaliknya. AC eksplisit per baris yang belum tercakup di atas:
  - `dikirim` + `kirim` (kirim ulang) -> 409 `"Permintaan sudah dikirim."`; stok asal TIDAK dipotong dua kali (assert sebelum == sesudah).
  - `dikirim` + `terima`/`tidak-terima`/`tutup-tujuan` pada tujuan ke-k yang status ENTRI-nya `diterima` -> 409 `"Tujuan ini sudah diterima."`; stok TIDAK berubah.
  - `dikirim` + `terima`/`tidak-terima`/`tutup-tujuan` pada tujuan ke-k yang status ENTRI-nya `tidak_terima` -> 409 `"Tujuan ini sudah tidak diterima."`; stok TIDAK berubah.
  - `dikirim` + `terima`/`tidak-terima`/`tutup-tujuan` pada tujuan ke-k yang status ENTRI-nya `ditutup` -> 409 `"Tujuan ini sudah ditutup."`; stok TIDAK berubah (V3).
  - `dikirim` + `terima`/`tidak-terima`/`tutup-tujuan` dengan indeks tujuan ke-k di luar `tujuan[]` -> 409 `"Tujuan tidak ditemukan."`; stok TIDAK berubah.
  - `dikirim` + `setujui`/`tolak`/`batal`/`ubah-item` -> 409 `"Permintaan sudah diproses."`; stok TIDAK berubah.
  - `disetujui` + `terima`/`tidak-terima`/`tutup-tujuan` -> 409 `"Permintaan belum dikirim."`; stok TIDAK berubah.
  - `disetujui` + `setujui`/`tolak`/`ubah-item` -> 409 `"Permintaan sudah diproses."`; stok TIDAK berubah.
  - `disetujui` + `kirim` kedua -> 409 `"Permintaan sudah dikirim."`; stok asal TIDAK dipotong dua kali.
  - `menunggu` + `kirim` -> 409 `"Permintaan belum disetujui."`.
  - `menunggu` + `terima`/`tidak-terima` -> 409 `"Permintaan belum dikirim."`.
  - `menunggu` + `tutup-tujuan` -> 409 `"Permintaan belum dikirim."`.
  - `ditolak` + aksi apa pun selain `buat` dokumen baru -> 409 `"Permintaan sudah ditolak."`.
  - `dibatalkan` + aksi apa pun -> 409 `"Permintaan sudah dibatalkan."`.
  - `selesai` + aksi apa pun -> 409 `"Permintaan sudah selesai."`.
- Setiap `kirim`/`terima`/`tidak-terima` menulis `stock_movements` (`type:"koreksi_manual"`, `action_type` sesuai tabel F5.2, `gudang_id`).
- `tutup-tujuan` menulis `stock_movements` (`type:"koreksi_manual"`, `action_type:"tutup_tujuan"`, `gudang_id:<dari_gudang_id>`, `qty` ASLI) sesuai tabel F5.2 dan bagian 19 (V4b).
- Admin hanya boleh `buat` permintaan dengan `dari_gudang_id` == `gudang_id` miliknya, kecuali owner. Admin dengan `gudang_id:null` -> HTTP 403 `"Akun Anda belum punya gudang."`.
- Guest -> semua aksi HTTP 403.

Edge case:
- `items[]` memuat `kode_barang` duplikat -> server menggabungkan qty (sum) sebelum menyimpan, memilih nilai terakhir untuk `variasi`.
- Item yang sama muncul di dua permintaan `menunggu` bersamaan -> keduanya boleh dibuat; validasi stok hanya saat `kirim`.
- Qty pada dokumen diubah setelah `disetujui` -> aksi `ubah-item` hanya diizinkan pada status `menunggu`; status lain -> 409.
- Permintaan ke gudang yang dinonaktifkan ANTARA `buat` dan `kirim` -> `kirim` tetap sukses (gudang tujuan tidak dipakai saat kirim); `terima` ke gudang nonaktif -> HTTP 409 `"Gudang tujuan nonaktif."`; `tidak-terima` ke gudang nonaktif tetap sukses (barang dikembalikan ke asal).
- `dari_gudang_id` dinonaktifkan setelah `dikirim` sebelum `terima` -> `terima` tetap sukses (stok asal sudah dipotong).
- Dua request `kirim` berbarengan untuk dokumen yang sama -> hanya satu yang menurunkan stok; yang kedua 409 (CAS pada `status` di transaksi).
- Dua request `terima` untuk tujuan BERBEDA berbarengan (T30): keduanya tercatat di `tujuan[]`, `diterima_at` per entri masing-masing terisi, `riwayat_status` memuat dua entri, TIDAK ada duplikasi entri, status dokumen konsisten setelah keduanya selesai (CAS pada `status` + `tujuan[i].status` di transaksi; request kedua retry transaksi). Diuji deterministik lewat model test `test/casModelFirestore.test.js` (V7, bagian 12): dua mutasi tujuan BERBEDA pada dokumen yang SAMA dijalankan berurutan -> assert BOTH entri tercatat dan status dokumen benar.
- `terima` vs `tutup-tujuan` pada tujuan SAMA bersamaan (V5) -> tepat satu menang, yang kedua 409, stok konsisten (gudang tujuan naik ATAU tidak, tidak keduanya).
- Matriks deterministik `tipe` tujuan x kondisi gudang saat `terima`/`tidak-terima` (V11), TIDAK ada tumpang tindih:
  - `tipe:"gudang"` dan gudang masih `aktif` -> `terima` menambah `qty_per_gudang[id]`; `tidak-terima` mengembalikan ke asal.
  - `tipe:"gudang"` dan gudang `nonaktif`/tidak ada -> `terima` HTTP 409 `"Gudang tujuan nonaktif."`; `tidak-terima` tetap sukses (kembali ke asal, gudang tujuan tidak dipakai).
  - `tipe:"user"` dengan `gudang_id_snapshot` terisi dan gudang snapshot ada -> `terima` menambah gudang snapshot; `tidak-terima` mengembalikan ke asal.
  - `tipe:"user"` dengan `gudang_id_snapshot` = `null` -> `terima` sukses TANPA menambah stok gudang mana pun, entri tetap `diterima` (selesai); `tidak-terima` mengembalikan ke asal (stok asal tetap turun sekali sejak `kirim`).
  - `tipe:"user"` dengan `gudang_id_snapshot` menunjuk gudang yang TIDAK ADA lagi -> `terima` HTTP 409 `"Gudang tujuan tidak ditemukan."`; owner menutup dengan `tutup-tujuan`.
- AC jalur pemulihan dokumen nyangkut (V10): tujuan dengan `gudang_id_snapshot` hilang/tidak ada -> `tutup-tujuan` oleh owner SUKSES menutup entri itu (tanpa mengubah stok: `qty_per_gudang` semua gudang sebelum == sesudah), `stock_movements` `action_type:"tutup_tujuan"` ber-`qty` ASLI tercatat, dan bila itu tujuan terakhir `menunggu` -> status dokumen `selesai` + `selesai_at` terisi. Ini diuji di `test/permintaanGudang.test.js` (kasus: `gudang_id_snapshot` menunjuk gudang yang dihapus/nonaktif).
### F6 - "Kirim ke" multiple (gudang dan/atau user)

Deskripsi: satu dokumen permintaan, banyak tujuan, status per tujuan (R2).

Acceptance criteria:
- `tujuan[]` menerima entri `{tipe:"gudang", id:<gudang_id>}` dan/atau `{tipe:"user", id:<telegram_user_id>}`.
- Saat `buat`, server MENYIMPAN snapshot tiap entri: `{tipe, id, nama, jabatan, gudang_id_snapshot}` (T10). Untuk `tipe:"user"`, `gudang_id_snapshot` = `admins[id].gudang_id` saat itu (`null` bila tidak ada). Untuk `tipe:"gudang"`, `gudang_id_snapshot` = id itu sendiri.
- `terima` dan `tidak-terima` memakai `gudang_id_snapshot`, BUKAN `admins.gudang_id` saat ini (T10).
- Opsi `tipe:"user"` HANYA menawarkan user dengan `admins.gudang_id` terisi (Q5a). `listUserTujuan()` mengembalikan 0 entri untuk user guest dan user tanpa `gudang_id`.
- `tujuan[]` dengan `tipe` tidak dikenal -> HTTP 400, pesan `"Tipe tujuan tidak dikenal."`.
- `tujuan[]` dengan `tipe:"gudang"` id nonaktif/tidak ada -> HTTP 400.
- `tujuan[]` dengan `tipe:"user"` id tidak ada di `admins` atau tanpa `gudang_id` -> HTTP 400, pesan `"User tujuan tidak valid."`.
- `tujuan[]` dengan entri `{tipe,id}` duplikat -> dinormalisasi jadi satu entri (dedup) sebelum disimpan.
- Tujuan bertipe user yang `gudang_id_snapshot` == `dari_gudang_id` -> HTTP 400 `"Tujuan sama dengan gudang asal."` (T13).
- Daftar tujuan yang ditampilkan memuat `jabatan` user (label kosmetik) untuk tipe user.
- Jumlah tujuan maksimal 20 per dokumen -> ke-21 -> HTTP 400 `"Maksimal 20 tujuan."`.
- Field bantu `tujuan_ids: string[]` (= `["gudang:G1","user:900002"]`) disimpan untuk query `array-contains` (T21).

Edge case:
- Tujuan user yang kemudian dihapus dari `admins` sebelum `terima` -> `terima` tetap sukses memakai `gudang_id_snapshot`; bila snapshot `null`, stok tidak berubah dan entri tetap selesai. Bila gudang snapshot sudah tidak ada -> HTTP 409 `"Gudang tujuan tidak ditemukan."`; owner menutup entri dengan `tutup-tujuan` (F5.2).
- Permintaan dengan SEMUA tujuan bertipe user tanpa `gudang_id` pada saat terima -> stok tidak berubah, dokumen tetap selesai.
- User tujuan pindah gudang setelah `buat` -> stok masuk gudang SNAPSHOT (T10), bukan gudang baru.

### F7 - Opname dengan approval owner

Deskripsi: input qty fisik per gudang; selisih != 0 wajib approve owner (`discovery-v5.md:134-137`).

Acceptance criteria:
- `POST /api/opname-gudang` aksi `buat` dengan `gudang_id`, `items[{kode_barang, qty_fisik}]` (qty_fisik integer >= 0).
- Server menghitung `qty_sistem = qty_per_gudang[gudang_id] ?? null` dan `selisih = qty_fisik - qty_sistem` per item; nilai yang dihitung server ini yang disimpan.
- Item yang TIDAK punya key `gudang_id` di `qty_per_gudang` (atau `qty_per_gudang` absent): `qty_sistem = null`, `selisih = 0`, dan item ditandai `belum_terdaftar: true`. Item ini TIDAK memicu `menunggu_approval` (T14).
- Bila SELURUH item `selisih === 0`: status dokumen langsung `disetujui`, `qty_per_gudang` ditulis ulang = qty_fisik untuk item yang `belum_terdaftar:false` saja, respons `{ok:true, status:"disetujui", langsung:true}` (D5c).
- Bila ada >=1 item `selisih !== 0`: status `menunggu_approval`; `qty_per_gudang` TIDAK berubah (uji: qty sebelum == sesudah untuk semua item).
- `POST /api/opname-gudang` aksi `setujui` (owner only):
  - Langkah 1 (T9, CAS nilai sistem): untuk setiap item, bandingkan `qty_sistem` yang tersimpan dengan `qty_per_gudang[gudang_id] ?? null` saat ini. Bila ada SATU saja yang berbeda -> HTTP 409 `"Stok berubah sejak opname dibuat. Buat ulang."`, TIDAK menulis apa pun.
  - Langkah 2: bila semua cocok, tulis `qty_per_gudang[gudang_id] = qty_fisik` untuk SETIAP item, status -> `disetujui`, `disetujui_oleh`/`disetujui_at` terisi, dalam transaksi yang sama dengan langkah 1.
- Aksi `tolak` (owner only) -> status `ditolak`, `qty_per_gudang` TIDAK berubah.
- `setujui`/`tolak` dari status selain `menunggu_approval` -> HTTP 409 `"Opname sudah diproses."`.
- Admin -> `setujui`/`tolak` HTTP 403 `"Hanya owner yang dapat menyetujui opname."`.
- Admin hanya boleh `buat` opname untuk `gudang_id` miliknya; gudang lain -> HTTP 403.
- Owner boleh `buat` opname untuk gudang mana pun.
- `kode_barang` tanpa dokumen `stock` -> HTTP 404 `"Stok produk tidak ditemukan."` (server tidak membuat dokumen).
- `qty_fisik` bukan integer atau negatif -> HTTP 400.
- `items[]` kosong -> HTTP 400 `"Opname belum berisi item."`.
- Setiap opname `disetujui` menulis satu `stock_movements` per item dengan `type:"opname"`, `qty_sistem`, `qty_fisik`, `selisih`, `gudang_id`.
- Selisih != 0 pada item apa pun membuat SATU SELURUH dokumen `menunggu_approval` (tidak memecah item yang selisih 0).

Edge case:
- Semua item `selisih !== 0` -> tetap satu dokumen `menunggu_approval`.
- Opname `menunggu_approval` yang gudangnya dinonaktifkan -> `setujui` tetap sukses (stok tetap ditulis) selama CAS T9 terpenuhi.
- Item yang sama muncul dua kali dalam `items[]` -> server menolak dengan HTTP 400 `"Item duplikat dalam opname."`.
- Dua opname `menunggu_approval` untuk gudang yang sama -> keduanya boleh ada; `setujui` yang kedua kemungkinan besar 409 karena CAS T9 mendeteksi `qty_per_gudang` sudah berubah oleh opname pertama (menggantikan klaim last-write-wins lama).
- `setujui` dengan guard duplikat < 10 detik -> 409 `"Sedang diproses."`.

### F8 - Toggle is-online dari dashboard

Deskripsi: tombol toggle `products.is_online_product` dari dashboard (`discovery-v5.md:139-143`).

Acceptance criteria:
- `POST /api/produk/online` dengan `{kode_barang, is_online_product: boolean}` menulis field tersebut + `updated_at`.
- `kode_barang` tidak ada di `products` -> HTTP 404 `"Produk tidak ditemukan."`.
- `is_online_product` bukan boolean -> HTTP 400.
- Owner/Admin sukses; guest -> HTTP 403.
- Setelah sukses, `invalidasiCacheProduk()` dipanggil (uji: `listSemuaProduk({hanyaOnline:true})` langsung merefleksikan nilai baru dalam proses yang sama).
- Toggle `true -> false` pada produk yang masih punya `stock` -> tetap sukses; dokumen `stock` TIDAK dihapus.
- `listStock()` di dashboard membaca SELURUH item (bukan hanya online), lalu filter `is_online_product` diterapkan di jalur tampilan (F9); status toggle dan filter default saling independen.

Edge case:
- Toggle yang sama dua kali berturut-turut -> sukses keduanya (idempoten), `updated_at` diperbarui.
- Produk dengan `is_online_product` absen (null) -> dianggap `false` untuk filter, toggle `true` menulis nilai eksplisit.
- 1107 produk (`discovery-v5.md:159`) dibaca penuh di `listStock()` -> lihat batas payload bagian 11 (AC terukur T28).

### F9 - Filter stok (gudang + online)

Deskripsi: filter default `is_online_product == true`, dapat dilepas; filter gudang DEFAULT mengikuti `gudang_id` user tetapi dapat diganti ke gudang lain (Q3a + R5). Read lintas gudang diizinkan.

Acceptance criteria:
- `listStock()` mengembalikan SEMUA item (bukan hanya produk online, memperbaiki `real.ts:144-187`), lalu parameter `{gudang_id?, is_online?, sertakan_tanpa_gudang?}` memfilter di jalur data.
- Admin dengan `gudang_id = "G1"` memanggil `listStock()` tanpa argumen -> hanya baris dengan `qty_per_gudang["G1"]` terdefinisi (atau baris tanpa key `G1` bila `sertakan_tanpa_gudang:true`); ini FILTER DEFAULT, bukan batas read.
- Admin dengan `gudang_id = "G1"` boleh memanggil `listStock({gudang_id:"G2"})` dan MELIHAT baris gudang `G2` (R5: read lintas gudang diizinkan). Parameter gudang dari UI DIPERCAYA untuk read; TIDAK ada 403. Filter gudang ditegakkan sebagai default saja.
- Owner (tanpa gudang / multi-gudang) -> default semua gudang; baris memuat `qty_per_gudang` utuh + `stok_gudang_online`.
- Admin dengan `gudang_id:null` -> filter default tidak diterapkan; `listStock()` mengembalikan semua baris + flag `perlu_gudang:true` (UI menampilkan pesan "Akun Anda belum punya gudang, filter gudang tidak diterapkan."). Guest tanpa `gudang_id` juga tidak difilter.
- Admin dengan `gudang_id` nonaktif -> 0 baris + flag `gudang_nonaktif:true` + pesan `"Gudang kerja Anda dinonaktifkan. Hubungi owner."` (T11a).
- `is_online` default `true`; `is_online:false` menampilkan juga item non-online.
- `is_online:"semua"` -> tidak memfilter berdasarkan `is_online_product`.
- `StockRow` hasil menambah field `qty_per_gudang: Record<string, number>` dan `qty_gudang_terpilih: number | null`.
- `status`/`kekurangan` dihitung dari `qty_gudang_terpilih` bila gudang dipilih, dari `stok_gudang_online` bila tidak.
- Write tetap ter-scope (BR7): `set-qty` (F2) dan `buat` (F5) menolak gudang di luar scope admin. HANYA write yang di-scope.

Edge case:
- Item tanpa dokumen `stock` (produk ada, stok tidak) -> `qty_gudang_terpilih:null`, `status:"aman"` bila `reorder_point` null.
- Item dengan `qty_per_gudang` ada tapi bukan angka -> diperlakukan `null` di boundary baca (toleransi dua bentuk, `docs/learnings.md:5-7`).
- `qty_gudang_terpilih` negatif -> `status:"minus"`, `kekurangan = Math.abs(nilai)`.

### F10 - Migrasi kontrak DataSource (T2, T24)

Deskripsi: `listStock` berubah dari `listStock(): Promise<StockRow[]>` (`lib/dashboard/data/index.ts:68`) menjadi `listStock(filter?: StockFilter): Promise<StockRow[]>`.

File yang WAJIB disentuh (T24):
- `lib/dashboard/data/index.ts` - ubah signature `listStock` (baris 68), export `StockFilter`.
- `lib/dashboard/types.ts` - tambah field `StockRow.qty_per_gudang` + `qty_gudang_terpilih` (baris 60-69), dan semua tipe request/response baru v5 (pola existing: tipe tulis v2/v3a/v3b ada di file ini, `types.ts:287-523`).
- `lib/dashboard/data/real.ts` - implementasi `rowsStok()` (baris 164-187) + method baru.
- `lib/dashboard/data/mock.ts` - implementasi `listStock` (baris 442-447) + method baru + aturan bisnis sama.
- `lib/dashboard/data/mock-data.ts` - seed baru di store TERPISAH (`store.gudang`, `store.permintaanGudang`, `store.opnameGudang`).
- `lib/dashboard/data/mock-paritas.js` - guard mock untuk aksi v5 (paritas server).
- `lib/dashboard/validasiTulisV3a.js` - PERLUAS `validasiAksiAdmin` (`lib/dashboard/validasiTulisV3a.js:227-260`, dipanggil `app/api/admin/route.ts:65`) dengan dua cabang baru `set-gudang-user` dan `set-jabatan`. Route existing `/api/admin` memakai dispatcher ini; tanpa cabang baru, kedua aksi jatuh ke HTTP 400 "Aksi tidak dikenal." (Z1).
- `lib/dashboard/sumber-data.tsx` - tambah stub `tolak` untuk SEMUA method baru di `dataKosong()` (baris 196-235, `satisfies DataSource` menagih method lengkap).

Pemanggil `listStock` yang harus dimigrasi (T2) - argumen opsional, jadi pemanggil lama tetap kompilasi:
- `app/stok/page.tsx:74` - `setRows(await data.listStock())` (ubah untuk mengirim filter gudang + online).
- `app/permintaan/page.tsx:72` - `Promise.all([data.listDailyRequests(), data.listStock()])`.
- `app/page.tsx:45` - `data.listStock()` di ringkasan.
- `lib/dashboard/sumber-data.tsx:203` - stub `tolak`.

Acceptance criteria:
- `npx tsc --noEmit` exit 0 setelah perubahan (argumen `listStock` opsional -> pemanggil lama tidak error).
- `listStock()` tanpa argumen mengembalikan perilaku setara versi lama (semua item, default `is_online:true`).
- Setiap method baru di `DataSource` punya stub di `dataKosong()` (`sumber-data.tsx`), kalau tidak `satisfies DataSource` gagal tsc.
- Semua tipe baru didefinisikan di `lib/dashboard/types.ts`, TIDAK inline di `index.ts`.

---
## 5. Aturan bisnis & invariant

**BR1 - Stok asal tidak boleh negatif.** Pada aksi `kirim` (F5), server menolak dengan HTTP 409
`"Stok gudang asal tidak cukup."` bila `qty_per_gudang[dari_gudang_id] < qty`. Penolakan terjadi di
server, bukan UI. Ini BERBEDA dari `mode:"kurangi"` di `app/api/stok/mutasi/route.ts:155-157` yang
tetap boleh negatif (fitur lama, tidak diubah). Alasan: perpindahan antar-gudang tidak boleh
menciptakan barang.

**BR2 - `qty_per_gudang` sumber angka per gudang.** Semua angka per gudang dibaca/ditulis dari
`stock/{kode}.qty_per_gudang[gudang_id]` (D2a). `stok_gudang_online` BUKAN total lintas gudang
(Q4a): ia adalah salah satu key, yaitu key `"ONLINE"`. Contoh: `qty_per_gudang = {"ONLINE": 12, "G1": 4}`.
CATATAN (T5): discovery v5 baris `discovery-v5.md:96-99` menyebut `stok_gudang_online` sebagai
"agregat/total"; pernyataan itu DIGANTIKAN oleh jawaban Q4a dan TIDAK berlaku lagi. Definisi yang
mengikat ada di PRD ini.

**BR3 - Paritas helper lama.** `ambilStok`, `kurangiStok`, `tambahStok`, `timpaStokOpname`
(`lib/models/stok.js:19-103`) tetap berjalan tanpa perubahan. Setiap helper membaca/menulis
`stok_gudang_online`; karena `stok_gudang_online` didefinisikan sebagai alias key `"ONLINE"`,
setiap perubahan `stok_gudang_online` WAJIB menulis `qty_per_gudang["ONLINE"]` dengan nilai sama,
dan sebaliknya. Pelanggaran paritas = bug (test paritas wajib, bagian 12).

**BR4 - Qty per gudang integer >= 0.** Tidak ada qty per gudang negatif dari jalur permintaan/opname.
Negatif hanya sah sebagai `stok_gudang_online` dari jalur lama `mode:"kurangi"` (PRD 13.6, tidak diubah).

**BR5 - Permintaan multi-tujuan dengan status per tujuan.** Satu dokumen = banyak `tujuan[]`, tiap entri
punya `status` sendiri (`menunggu`/`diterima`/`tidak_terima`/`ditutup`). Stok asal turun SEKALI saat
`kirim`. Stok tujuan naik saat `terima` tujuan itu. Stok asal naik kembali saat `tidak_terima`.
Status dokumen = TURUNAN: `dikirim` bila ada tujuan `menunggu`; `selesai` bila semua tujuan selesai.

**BR6 - Opname approval.** `selisih != 0` -> `menunggu_approval`, wajib owner. `selisih == 0` di
semua item -> langsung `disetujui`. `qty_per_gudang` hanya ditulis setelah `disetujui`, dengan CAS
nilai sistem (T9).

**BR7 - Scope gudang hanya untuk TULIS.** Setiap TULIS yang menyentuh data per gudang memvalidasi
keanggotaan gudang dari `admins/{uid}` di server (R1, `discovery-v5.md:149-154`). Parameter gudang
dari body TIDAK dipercaya untuk aksi tulis. READ stok dan `permintaan_gudang`/`opname_gudang`
lintas gudang DIIZINKAN untuk semua staff (R5) - scope gudang TIDAK membatasi read.

**BR8 - Jabatan bukan otorisasi.** Field `admins.jabatan` tidak pernah dibaca di jalur otorisasi
(T12). Role tetap `admins.role` (`lib/models/admins.js:9-13`).

**BR9 - Gudang nonaktif tetap bisa dirujuk.** Nonaktif hanya menyembunyikan dari pilihan baru;
referensi lama tetap valid agar dokumen historis tidak jadi yatim. Admin bergudang nonaktif melihat
pesan eksplisit (F3 edge, F9).

**BR10 - Audit tidak rollback.** Gagal tulis `stock_movements` TIDAK membatalkan perubahan stok;
respons memuat `peringatan_audit:true` (pola `app/api/stok/mutasi/route.ts:167-194`).

**BR11 - Guard idempotensi (daftar lengkap, T22 + V6).** Semua aksi tulis memakai guard dokumen server-only
TTL 10 detik, pola `stock_write_guard` (`app/api/stok/mutasi/route.ts:121-147`). Satu aksi masuk TEPAT
SATU kategori; tidak ada aksi yang muncul di dua daftar (kontradiksi versi revisi 2 dihapus).

Kategori A - Guard WAJIB (dokumen dibaca/ditulis; guard adalah lapisan pertama, bukan pengaman utama):
- `gudang_guard`: `tambah`, `edit`, `nonaktif`, `aktifkan`.
- `stok_gudang_guard`: `set-qty`.
- `permintaan_gudang_guard`: `buat`, `ubah-item`, `setujui`, `tolak`, `batal`, `kirim`, `terima`, `tidak-terima`, `tutup-tujuan`.
- `opname_gudang_guard`: `buat`, `setujui`, `tolak`.
- `produk_online_guard`: toggle `is_online_product`.

Catatan kategori A: untuk `batal` dan `tutup-tujuan`, guard TETAP dipasang (konsisten `6.4`), tetapi
pengaman utama double-apply adalah cek status di dalam `runTransaction` (CAS pada `status` dokumen +
`tujuan[k].status`, bagian 11). Test guard HARUS mengharapkan 409 duplikat < 10s untuk KEDUA aksi ini,
seperti aksi lain di kategori A.

Kategori B - Aksi yang TIDAK butuh guard (alami idempoten; TIDAK masuk kategori A):
- `set-jabatan` (last-write-wins; hasil sama bila diulang dengan nilai sama; bukan aksi stok).
- `set-gudang-user` (last-write-wins; idempoten; bukan aksi stok).

Kategori B ditutup: `batal` dan `tutup-tujuan` DIHAPUS dari daftar idempoten (V6). Keduanya tidak alami
idempoten: `batal` pada `dikirim` harus 409, dan `tutup-tujuan` mengubah status ENTRI sehingga harus
CAS. Test `test/guardV5.test.js` menguji: (a) setiap aksi kategori A menolak duplikat < 10s dengan 409
dan tidak memanggil model (spy); (b) aksi kategori B boleh diulang tanpa guard dan tetap sukses.

**BR12 - Snake_case.** Semua nama field baru snake_case (`gudang_id`, `qty_per_gudang`,
`dari_gudang_id`, `created_by`, `updated_at`). Field baru pada koleksi lama tidak mengubah nama lama.
CATATAN (T1): nama field waktu untuk `gudang`/`permintaan_gudang`/`opname_gudang` = `created_at`
(mengikuti `stock_movements` existing), BUKAN `dibuat_at`.

**BR13 - Nilai `status` dan `kekurangan` tetap dihitung** oleh `statusStok`/`kekuranganStok`
(`lib/dashboard/format.ts`), sekarang dari qty gudang terpilih. Perilaku reorder lama
(`lib/models/stok.js:132-140`) tidak berubah (R8).

**BR14 - Permintaan `kirim` menurunkan `stok_gudang_online` bila gudang asal = `"ONLINE"`**
(karena BR3). Untuk gudang lain, hanya key gudang tersebut yang berubah.

**BR15 - Maksimum 50 gudang (R3).** Penambahan gudang ke-51 ditolak dengan HTTP 400 `"Maksimal 50 gudang."`.
Gudang nonaktif IKUT dihitung terhadap batas ini (agar `urutan` dan map `qty_per_gudang` tetap terbatas).

**BR16 - Batas item permintaan <= 200 (T23).** `items[]` pada `permintaan_gudang` maksimum 200 entri
(selaras bagian 11).

---

## 6. Skema data final

### 6.1 Koleksi baru `gudang/{gudang_id}`

| Field | Tipe | Wajib | Catatan |
|---|---|---|---|
| `gudang_id` | string | ya (doc id) | autoId Firestore, bukan monotonic (research bagian A.1 anti-hotspot); kecuali `"ONLINE"` literal (migrasi bagian 10) |
| `nama` | string | ya | 1-60 char; unik case-insensitive antar gudang aktif |
| `aktif` | boolean | ya | default `true` |
| `urutan` | number | ya | integer; duplikat diizinkan, tie-break `nama` asc |
| `created_at` | Timestamp | ya | T1 |
| `created_by` | string | ya | telegram uid |
| `updated_at` | Timestamp | tidak | T1 |
| `updated_by` | string | tidak | |
| `nonaktif_at` | Timestamp | tidak | |
| `nonaktif_by` | string | tidak | |

Migrasi: tidak ada backfill langsung. Satu gudang default bernama `"ONLINE"` dibuat sebagai bagian
dari langkah #1 migrasi (bagian 10) karena `stok_gudang_online` diperlakukan sebagai key `"ONLINE"` (Q4a).

### 6.2 Koleksi baru `permintaan_gudang/{autoId}`

| Field | Tipe | Wajib | Catatan |
|---|---|---|---|
| `permintaan_id` | string | ya (doc id) | autoId |
| `dari_gudang_id` | string | ya | gudang asal |
| `tujuan` | array<TujuanEntri> | ya | 1-20 entri, unik per `tipe:id` |
| `tujuan_ids` | string[] | ya | field bantu `["gudang:G1","user:900002"]` untuk `array-contains` (T21) |
| `status` | `"menunggu"` / `"disetujui"` / `"ditolak"` / `"dibatalkan"` / `"dikirim"` / `"selesai"` | ya | TURUNAN dari status semua tujuan (R2, BR5) |
| `items` | array<{kode_barang, nama, variasi, qty:number}> | ya | 1-200 |
| `created_at` | Timestamp | ya | T1 |
| `created_by` | string | ya | uid |
| `disetujui_oleh` | string | tidak | |
| `disetujui_at` | Timestamp | tidak | |
| `ditolak_oleh` | string | tidak | |
| `ditolak_at` | Timestamp | tidak | |
| `dibatalkan_oleh` | string | tidak | R1 |
| `dibatalkan_at` | Timestamp | tidak | R1 |
| `dikirim_oleh` | string | tidak | |
| `dikirim_at` | Timestamp | tidak | |
| `selesai_at` | Timestamp | tidak | terisi saat status -> `selesai` |
| `catatan` | string | tidak | |
| `riwayat_status` | array<{status, oleh, at}> | ya | append-only, audit transisi |

`TujuanEntri` (T7, T10):

| Field | Tipe | Wajib | Catatan |
|---|---|---|---|
| `tipe` | `"gudang"` / `"user"` | ya | |
| `id` | string | ya | gudang_id atau telegram_user_id |
| `nama` | string | ya | snapshot nama gudang/user saat `buat` |
| `jabatan` | string/null | tidak | snapshot label user (kosmetik) |
| `gudang_id_snapshot` | string/null | ya | T10: gudang tujuan pada saat `buat`; dipakai `terima` |
| `status` | `"menunggu"` / `"diterima"` / `"tidak_terima"` / `"ditutup"` | ya | R2 |
| `diterima_at` | Timestamp/null | tidak | |
| `diterima_oleh` | string/null | tidak | |
| `tidak_terima_at` | Timestamp/null | tidak | |
| `tidak_terima_oleh` | string/null | tidak | |
| `ditutup_at` | Timestamp/null | tidak | `tutup-tujuan` owner |
| `ditutup_oleh` | string/null | tidak | |
| `catatan_alasan` | string/null | tidak | wajib saat `tutup-tujuan` |

### 6.3 Koleksi baru `opname_gudang/{autoId}`

| Field | Tipe | Wajib | Catatan |
|---|---|---|---|
| `opname_id` | string | ya (doc id) | autoId |
| `gudang_id` | string | ya | |
| `items` | array<{kode_barang, qty_sistem:number/null, qty_fisik:number, selisih:number, belum_terdaftar:boolean}> | ya | `selisih` dihitung server; `qty_sistem` null bila key absen (T14) |
| `status` | `"menunggu_approval"` / `"disetujui"` / `"ditolak"` | ya | |
| `created_at` | Timestamp | ya | T1 |
| `created_by` | string | ya | |
| `disetujui_oleh` | string | tidak | owner |
| `disetujui_at` | Timestamp | tidak | |
| `ditolak_oleh` | string | tidak | owner |
| `ditolak_at` | Timestamp | tidak | |
| `catatan` | string | tidak | |
| `riwayat_status` | array<{status, oleh, at}> | ya | |

### 6.4 Guard baru (server-only)

| Koleksi | Field | TTL | Dipakai |
|---|---|---|---|
| `permintaan_gudang_guard/{uid}` | `kunci` (hash payload), `at` | 10s | buat/ubah-item/setujui/tolak/batal/kirim/terima/tidak-terima/tutup-tujuan (V13: kategori A BR11; untuk `batal`/`tutup-tujuan` guard best-effort, pengaman utama = CAS `tujuan[k].status`) |
| `opname_gudang_guard/{uid}` | `opname_id`, `aksi`, `at` | 10s | buat/setujui/tolak |
| `gudang_guard/{uid}` | `aksi`, `nama`, `at` | 10s | tambah/edit/nonaktif/aktifkan |
| `stok_gudang_guard/{uid}` | `kode_barang`, `gudang_id`, `qty`, `at` | 10s | set qty per gudang |
| `produk_online_guard/{uid}` | `kode_barang`, `nilai`, `at` | 10s | toggle is-online |

Semua guard: `allow read, write: if false` (pola `firestore.rules:34-36`).

Pembersihan (T16): setiap guard ditulis dengan `{merge:false}` untuk dokumen `/{uid}`, sehingga jumlah
dokumen guard = jumlah uid (kecil), bukan tumbuh per aksi. TIDAK butuh TTL policy Firestore.
Dokumen guard lama (uid tidak aktif) dibiarkan; pembersihan tidak bagian MVP.

### 6.5 Perubahan koleksi existing

**`stock/{kode_barang}`** (tambah field, tidak ada field lama diubah/dihapus):

| Field | Tipe | Wajib | Catatan migrasi |
|---|---|---|---|
| `qty_per_gudang` | map<string, number> | ya (setelah backfill) | backfill 33 dokumen, aturan pemenang di bagian 10 (T8) |
| `stok_gudang_online` | number | ya | DIPERTAHANKAN; alias key `"ONLINE"` (Q4a) |
| field lama lain | - | - | tidak berubah (`reorder_point`, `last_updated`, `last_updated_by`, `last_synced_at`, `last_synced_value`) |

Aturan paritas: setiap tulis `stok_gudang_online` menulis juga `qty_per_gudang["ONLINE"]`, dan
sebaliknya (BR3). Dokumen yang `qty_per_gudang` absen (belum backfill) tetap terbaca lewat
fallback `{ "ONLINE": stok_gudang_online }` di boundary baca.

Batas map (T23): maksimum 50 gudang (BR15) -> map maksimum ~50 key. Ukuran tiap key ~20 byte
(id + angka) -> jauh di bawah 1 MiB. Untuk perbandingan kuantitatif: 50 key x ~25 byte = ~1.25 KiB,
dan `items` 200 x ~80 byte = ~16 KiB; total dokumen ~0.1 persen dari 1 MiB.

**`admins/{telegram_user_id}`** (tambah field):

| Field | Tipe | Wajib | Catatan migrasi |
|---|---|---|---|
| `jabatan` | string/null | tidak | default `null`; label kosmetik (BR8) |
| `gudang_id` | string/null | tidak | default `null`; owner dibiarkan `null` (= semua gudang, Q3a) |

Backfill `gudang_id`: TIDAK diisi otomatis. Semua user existing mendapat `gudang_id:null` (field
absen = null). Owner existing tetap `null`. Lihat bagian 10 langkah #4.

**`products/{kode_barang}`**: tidak ada field baru. `is_online_product` tetap global (D1a,
`discovery-v5.md:94`). Toggle dari dashboard menulis field ini (F8).

### 6.6 Koleksi `system_settings`

Tidak ada field wajib baru. Bila nanti perlu default filter, gunakan doc terpisah; tidak bagian MVP.

---
## 7. Endpoint & permission

Pola route: `runtime="nodejs"`, `dynamic="force-dynamic"`.
URUTAN GUARD BARU (T18): `tolakOrigin` -> sesi cookie -> `cekRateLimit` -> role dari `admins` -> validasi body.
Guest ditolak 403 SEBELUM validasi body (agar pesan validasi tidak bocor ke guest).
CATATAN: urutan ini SENGAJA BERBEDA dari route existing (`app/api/stok/mutasi/route.ts:67-103` memvalidasi body sebelum role; `app/api/admin/route.ts:58-79` validasi sebelum rate limit/role). Route v5 memakai urutan baru yang dilock test.

| Path | Method | Level minimal | Fungsi |
|---|---|---|---|
| `/api/gudang` | POST | owner | aksi `tambah`/`edit`/`nonaktif`/`aktifkan` (F1) |
| `/api/stok/gudang` | POST | admin | aksi `set-qty` per gudang (F2) |
| `/api/permintaan-gudang` | POST | admin | aksi `buat`/`ubah-item`/`setujui`/`tolak`/`batal`/`kirim`/`terima`/`tidak-terima`/`tutup-tujuan` (F5, F6, R1, R2, T7) |
| `/api/opname-gudang` | POST | admin (`setujui`/`tolak` owner) | aksi `buat`/`setujui`/`tolak` (F7) |
| `/api/produk/online` | POST | admin | toggle `is_online_product` (F8) |
| `/api/admin` | POST | owner (aksi baru) | aksi `set-gudang-user` + `set-jabatan` (F3, F4) - route existing, bukan route baru |

Route baru = 5 file `route.ts`. Working tree saat ini punya 10 `route.ts` (`app/api/**`).
10 + 5 = 15 total. TIDAK ada route baru webhook di `app/api` (webhook di luar `app/api`).
Platform: repo ini Vercel Next.js (`package.json:14-16` `next build`/`next start`; `vercel.json` `framework:"nextjs"`). BUKAN Firebase Functions (tidak ada folder `functions/`, tidak ada konfigurasi functions). Klaim "batas platform 2048" dari versi 1 DIHAPUS karena tidak berdasar (T26).

Semua baca (list gudang, list permintaan, list opname, list user tujuan) TIDAK lewat route server;
dashboard memakai Firestore client SDK read-only via `DataSource` (pola existing), dengan rules
read untuk role yang tepat (bagian 8).

### 7a. File model/handler server yang WAJIB dibuat (Z2)

Empat route baru selain `/api/admin` menulis lewat firebase-admin. File model `lib/models/*.js` (CJS,
`require("../firebase")`) yang WAJIB dibuat, dengan NAMA SAMA PERSIS seperti `docs/architecture-v5.md`
bagian "Struktur modul & file":

| File model | Koleksi/domain | Dipakai route | Fungsi utama |
|---|---|---|---|
| `lib/models/gudang.js` | `gudang` (F1) | `/api/gudang` | `listGudang`, `ambilGudang`, `tambahGudang`, `editGudang`, `nonaktifkanGudang`, `aktifkanGudang` |
| `lib/models/stokGudang.js` | `stock.qty_per_gudang` (F2) | `/api/stok/gudang` | helper qty per gudang murni + transaksi; `lib/models/stok.js` menyediakan `setQtyGudang` |
| `lib/models/permintaanGudang.js` | `permintaan_gudang` (F5, F6) | `/api/permintaan-gudang` | `buatPermintaan`, `ubahItemPermintaan`, `setujuiPermintaan`, `tolakPermintaan`, `batalPermintaan`, `kirimPermintaan`, `terimaPermintaan`, `tidakTerimaPermintaan`, `tutupTujuanPermintaan`, `_hitungStatusDokumen`, `_cariTujuan` |
| `lib/models/opnameGudang.js` | `opname_gudang` (F7) | `/api/opname-gudang` | `buatOpname`, `setujuiOpname`, `tolakOpname`, `_cocokkanQtySistem` |

Validator payload route (CJS murni, pola `lib/dashboard/validasiTulisV3a.js`), NAMA SAMA PERSIS dengan
arsitektur:
- `lib/dashboard/validasiGudangV5.js` - `validasiAksiGudang`, `validasiGudangId`, `validasiNamaGudang`.
- `lib/dashboard/validasiPermintaanGudangV5.js` - `validasiAksiPermintaanGudang`, `validasiTujuan`, `validasiItems`.
- `lib/dashboard/validasiOpnameGudangV5.js` - `validasiAksiOpnameGudang`, `validasiItemsOpname`.
- `lib/dashboard/guardV5.js` - `tulisGuardV5(namaKoleksi, uid, payload)`.

Perubahan additive pada file model existing (NAMA SAMA PERSIS dengan arsitektur):
- `lib/models/admins.js` - `setGudangUser(targetUserId, gudangId, oleh)`, `setJabatan(targetUserId, jabatan, oleh)`.
- `lib/models/produk.js` - `setOnlineProduk(kodeBarang, nilai, oleh)`.
- `lib/models/stok.js` - `setQtyGudang`, `tambahStokGudang`, `kurangiStokGudang`, `normalisasiQtyPerGudang`, `_bacaParitasOnline`.
- `lib/dashboard/validasiTulisV3a.js` - dua cabang baru di `validasiAksiAdmin` (Z1).

Catatan (Z1): `lib/dashboard/validasiTulisV3a.js` BUKAN validator baru, melainkan PERLUASAN dispatcher
`validasiAksiAdmin` yang sudah dipanggil `app/api/admin/route.ts:65`. Tanpa dua cabang baru, aksi
`set-gudang-user`/`set-jabatan` ditolak `lib/dashboard/validasiTulisV3a.js:248-249` dengan HTTP 400
"Aksi tidak dikenal." sebelum handler mana pun berjalan. Handler baru ditambahkan di
`app/api/admin/route.ts` (dua cabang dispatch, pola `app/api/admin/route.ts:95-112`).

---

## 8. Firestore rules yang dibutuhkan

Mengikuti pola existing (`firestore.rules:17-38`) - semua `write: if false`, server via admin SDK.
Default deny di `firestore.rules:38` tetap dipertahankan.

```
// Multi-gudang v5 - read untuk role sesuai; write SELALU false (server/admin SDK saja).

// Master gudang: semua role boleh baca (dipakai filter & label), nonaktif pun perlu terbaca.
match /gudang/{gudang_id} { allow read: if authed(); allow write: if false; }

// Permintaan & opname: semua staff boleh baca termasuk lintas gudang (KEPUTUSAN USER R5).
// Scope gudang TIDAK membatasi read; scope hanya untuk default filter + tulis (BR7).
match /permintaan_gudang/{id} { allow read: if staff(); allow write: if false; }
match /opname_gudang/{id}     { allow read: if staff(); allow write: if false; }

// Guard baru: server-only, client dilarang total.
match /permintaan_gudang_guard/{id} { allow read, write: if false; }
match /opname_gudang_guard/{id}     { allow read, write: if false; }
match /gudang_guard/{id}            { allow read, write: if false; }
match /stok_gudang_guard/{id}       { allow read, write: if false; }
match /produk_online_guard/{id}     { allow read, write: if false; }
```

Catatan:
- `staff()` dan `authed()` sudah didefinisikan (`firestore.rules:5-15`), tidak perlu duplikat.
- Nested `match` tetap 1 level; batas 10 nested (`research-dashboard-wms.md:18`) jauh dari limit.
- Rules TIDAK memakai `get()`/`exists()`. Alasan: `get()` menambah read billable dan limit 10 call/request (`research-dashboard-wms.md:84-89`), DAN read lintas gudang memang DIIZINKAN (R5), jadi tidak perlu scope document-level. Keputusan T15 ditutup dengan menerima akses read lintas gudang (bukan menambah rules).
- Rules TIDAK membatasi `permintaan_gudang` per `gudang_id` karena (a) R5 mengizinkan read, (b) "rules are not filters" (`research-dashboard-wms.md:94`) akan menggagalkan query yang tidak memuat constraint sama.
- Guest hanya baca `gudang`; guest tidak menyentuh permintaan/opname (`staff()`), tetapi guest BISA baca stok semua gudang via `stock` (`firestore.rules:18` `authed()`).

KONSEKUENSI EKSPLISIT (T17): `stock/{kode}` punya `allow read: if authed()` (`firestore.rules:18`),
sehingga seluruh `qty_per_gudang` (semua gudang, semua staff termasuk guest) TERLIHAT. Ini
KONSEKUENSI YANG DITERIMA (R5: cross-gudang read diizinkan). PRD ini TIDAK lagi mengklaim scope gudang
menegakkan read. Bila kelak read lintas gudang stok perlu dibatasi, pindahkan stok per gudang ke
route server yang memfilter key (bukan MVP).

---

## 9. Index komposit yang dibutuhkan

Setiap query `where(equality) + orderBy(...)` butuh composite index (`docs/learnings.md:35`).
Index ditulis ke `firestore.indexes.json` dan dikunci test (pola `test/indexFirestore.test.js:24-50`).
Test membaca `collectionGroup` + `fields[].fieldPath`/`fields[].order` (bukan format tabel).

Pemetaan index ke query konkret (T20):

| # | collectionGroup | Field (order) | Query yang dilayani (fungsi di `real.ts`) |
|---|---|---|---|
| 1 | `permintaan_gudang` | `status` ASC, `created_at` DESC, `__name__` DESC | `listPermintaanGudang({ status })` - (a) antrian approval owner (`status:"menunggu"`); (b) V8: daftar dokumen NYANGKUT `listPermintaanGudang({ status:"dikirim" })` untuk owner menemukan tujuan yang perlu `tutup-tujuan` |
| 2 | `permintaan_gudang` | `dari_gudang_id` ASC, `created_at` DESC, `__name__` DESC | `listPermintaanGudang({ dari_gudang_id })` - riwayat per gudang asal |
| 3 | `permintaan_gudang` | `created_by` ASC, `created_at` DESC, `__name__` DESC | `listPermintaanGudang({ created_by })` - "permintaan saya" |
| 4 | `permintaan_gudang` | `tujuan_ids` ARRAY_CONTAINS, `created_at` DESC, `__name__` DESC | `listPermintaanGudang({ tujuan_id })` - permintaan yang menunjuk gudang/user saya sebagai tujuan (T21) |
| 5 | `opname_gudang` | `status` ASC, `created_at` DESC, `__name__` DESC | `listOpnameGudang({ status })` - antrian approval owner |
| 6 | `opname_gudang` | `gudang_id` ASC, `created_at` DESC, `__name__` DESC | `listOpnameGudang({ gudang_id })` - riwayat opname per gudang |
| 7 | `admins` | `gudang_id` ASC, `name` ASC, `__name__` ASC | `listUserTujuan()` - daftar user per gudang ("Kirim ke: User") |


Index yang DIBUANG (T20 + V9):
- `stock.kode_barang` - `kode_barang` adalah DOC ID `stock`, bukan field; index tidak berguna.
- `gudang.aktif ASC, urutan ASC` - `listGudang()` mengikuti pola existing `listAdmins` (`real.ts:380-396`) yaitu full scan + filter client; index ini TIDAK dipakai query nyata.
- `stock` index lain - tidak ada query `where + orderBy` pada koleksi `stock`.
- V9: `stock_movements` `gudang_id ASC, created_at DESC, __name__ DESC` - DIHAPUS dari bagian 9. Tidak ada fungsi v5 yang memakainya (`listMovements({ gudang_id })` bukan bagian v5). Bila halaman histori per gudang dibuat, index dipasang BERSAMAAN fungsi + AC-nya.

Catatan order `name` (T20d): `admins.name` boleh null. Firestore menempatkan null di awal (ascending).
Perilaku eksplisit: user tanpa `name` muncul lebih dulu di daftar; UI memakai `nama ?? telegram_user_id`
untuk label. Query tetap satu `where("gudang_id","==",id)` + `orderBy("name")` + `orderBy("__name__")`.

JSON final siap tempel ke `firestore.indexes.json` (tambahkan ke array `indexes` existing; jangan hapus 5 index `stock_movements` lama):

```json
{
  "collectionGroup": "permintaan_gudang",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "created_at", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ],
  "density": "SPARSE_ALL"
}
```

```json
{
  "collectionGroup": "permintaan_gudang",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "dari_gudang_id", "order": "ASCENDING" },
    { "fieldPath": "created_at", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ],
  "density": "SPARSE_ALL"
}
```

```json
{
  "collectionGroup": "permintaan_gudang",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "created_by", "order": "ASCENDING" },
    { "fieldPath": "created_at", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ],
  "density": "SPARSE_ALL"
}
```

```json
{
  "collectionGroup": "permintaan_gudang",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tujuan_ids", "order": "ARRAY_CONTAINS" },
    { "fieldPath": "created_at", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ],
  "density": "SPARSE_ALL"
}
```

```json
{
  "collectionGroup": "opname_gudang",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "created_at", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ],
  "density": "SPARSE_ALL"
}
```

```json
{
  "collectionGroup": "opname_gudang",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "gudang_id", "order": "ASCENDING" },
    { "fieldPath": "created_at", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ],
  "density": "SPARSE_ALL"
}
```

```json
{
  "collectionGroup": "admins",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "gudang_id", "order": "ASCENDING" },
    { "fieldPath": "name", "order": "ASCENDING" },
    { "fieldPath": "__name__", "order": "ASCENDING" }
  ],
  "density": "SPARSE_ALL"
}
```

Catatan:
- V9: index `stock_movements.gudang_id` DIBUANG dari v5. Halaman riwayat movement per gudang BUKAN
  bagian v5 (non-goal), sehingga `listMovements({ gudang_id })` tidak ada di v5 dan index itu tidak
  punya query pemakai. Ini menutup kontradiksi revisi 2 (bagian 9 menyebut wajib, bagian 15 bilang jangan).
  Bila kelak halaman histori per gudang dibuat, tambahkan index `gudang_id ASC, created_at DESC, __name__ DESC`
  BERSAMAAN dengan fungsi `listMovements({ gudang_id })` + AC, jangan lebih dulu.
- Field orderBy harus SESUDAH semua field equality (dikodekan di `test/indexFirestore.test.js:38-50`).
- `ARRAY_CONTAINS` di field pertama untuk query `array-contains` (T21).
- Verifikasi index ter-deploy dengan `firebase firestore:indexes --project bot-admin-toko-a0c47` (`docs/learnings.md:35`), bukan percaya file lokal saja.
- Semua koleksi baru wajib punya `created_at` bila memakai index di atas (T1).

---
## 10. Migrasi & backfill

Langkah (dijalankan sekali, script di luar repo, TIDAK di route):

1. **Buat gudang default `"ONLINE"`.** Tulis `gudang/"ONLINE"` `{nama:"ONLINE", aktif:true, urutan:0, created_at:now, created_by:"migrasi"}`. Doc id HARUS literal `"ONLINE"` (bukan autoId) agar sama dengan key `qty_per_gudang` (Q4a).
2. **Backfill `stock` (33 dokumen) DENGAN ATURAN PEMENANG TUNGGAL (T8).** Untuk setiap `stock/{kode}`, dijalankan DALAM SATU TRANSAKSI per dokumen (`db.runTransaction`):
   - Baca dokumen (`trx.get`).
   - Bila `doc.qty_per_gudang` sudah memuat key `"ONLINE"` (nilai angka apa pun): nilai `qty_per_gudang["ONLINE"]` MENANG; set `stok_gudang_online` = nilai itu (selaraskan).
   - Bila `qty_per_gudang["ONLINE"]` TIDAK ada tapi `stok_gudang_online` ada: backfill `qty_per_gudang["ONLINE"]` = `stok_gudang_online`.
   - Bila keduanya tidak ada: `qty_per_gudang["ONLINE"]` = 0; `stok_gudang_online` = 0.
   - Tulis `trx.set(ref, { qty_per_gudang: {...lama, "ONLINE": pemenang}, stok_gudang_online: pemenang }, {merge:true})`.
   - Idempoten: menjalankan dua kali memberi hasil sama (setelah run 1 keduanya sama; run 2 memilih nilai itu lagi).
   - Transaksi menutup race `_ubahStokRelatif` (`stok.js:51-67`) yang menulis `stok_gudang_online` tanpa `qty_per_gudang` (T8 race): transaksi mengunci dokumen sehingga backfill membaca nilai konsisten. Rekomendasi operasional: jalankan migrasi saat trafik bot sepi.
   - Verifikasi: `count(stock where qty_per_gudang.ONLINE != stok_gudang_online) == 0` (lihat bagian 10a).
3. **Backfill `products` (1107 dokumen).** Tidak ada field baru. Tidak ada aksi. Produk tanpa dokumen `stock` tetap tampil di `listStock()` dengan qty `null` (F9 edge case).
4. **Backfill `admins` (~10 dokumen).** Tidak ada aksi wajib: `jabatan` dan `gudang_id` absen diperlakukan `null`. Opsional: tulis eksplisit `{jabatan:null, gudang_id:null}`; boundary baca menerima dua bentuk (`docs/learnings.md:5-7`).
5. **Tidak ada backfill `stock_movements`.** Riwayat lama tanpa `gudang_id` tetap apa adanya (non-goal, `discovery-v5.md:86`).
6. **Urutan aman:** jalankan #1 SEBELUM #2 (key `"ONLINE"` harus punya dokumen gudang, kalau tidak filter gudang memunculkan id yatim).
7. **Rollback:** #2 hanya menyelaraskan `qty_per_gudang["ONLINE"]` dan `stok_gudang_online` ke nilai pemenang; `stok_gudang_online` TIDAK pernah dihapus. Rollback = hapus key `qty_per_gudang` (data `stok_gudang_online` tetap utuh).

### 10a. Verifikasi migrasi yang dapat dijalankan ulang (T4)

AC "selisih 0 pada seluruh koleksi" tidak dapat dijalankan gate otomatis (`npm test`/`tsc`/e2e pakai mock).
Solusi: perintah verifikasi read-only `scripts/verify-backfill.mjs` yang mencetak:
- jumlah dokumen `stock` dengan `qty_per_gudang.ONLINE != stok_gudang_online`,
- jumlah dokumen `stock` tanpa key `qty_per_gudang.ONLINE`,
- exit code 1 bila salah satu > 0, exit code 0 bila keduanya 0.

AC menjadi: perintah `node scripts/verify-backfill.mjs` exit 0 dan output-nya dicatat di PR.
Bila script tidak dibuat, AC ini WAJIB ditandai MANUAL dan diverifikasi lewat konsol Firestore, dicatat di PR.

---
## 11. Non-functional

| Aspek | Ketentuan |
|---|---|
| Rate limit | `/api/gudang` 20/menit; `/api/stok/gudang` 30/menit; `/api/permintaan-gudang` 30/menit; `/api/opname-gudang` 20/menit; `/api/produk/online` 40/menit; aksi baru `/api/admin` ikut bucket `aksi` 40/menit (pola `app/api/admin/route.ts:74-79`) |
| Idempotensi | Guard dokumen TTL 10s per aksi (BR11 daftar lengkap), pola `stock_write_guard` (`app/api/stok/mutasi/route.ts:132-147`). Duplikat -> HTTP 409 |
| Race | `kirim`/`terima`/`tidak-terima`/`setujui`/`tutup-tujuan` memakai `runTransaction` dengan CAS pada `status` dokumen + `tujuan[i].status`; perubahan stok dan status dalam transaksi yang sama |
| Audit trail | Setiap mutasi stok menulis `stock_movements`; setiap transisi status menulis `riwayat_status[]`; approve opname menulis `disetujui_oleh`/`disetujui_at` |
| Batas dokumen | Batas 1 MiB (`research-dashboard-wms.md:14`). `tujuan.length <= 20`, `items.length <= 200` per dokumen -> HTTP 400 bila lebih (BR16, T23). Maksimum 50 gudang (BR15) -> `qty_per_gudang` maksimum ~50 key, aman dari 1 MiB |
| Payload respons | AC terukur (T28): respons `listStock()` pada 1107 produk (termasuk `qty_per_gudang` utuh + `stok_gudang_online`) WAJIB < 500 KiB terukur (test menghitung `JSON.stringify(rows).length`). Bila >= 500 KiB -> paginasi WAJIB sebelum rilis (bukan "nanti") |
| Dampak `getRingkasan` (T28b) | `getRingkasan()` (`real.ts:228-255`) memanggil `rowsStok()` (baris 230), sehingga ikut full-scan 1107 produk. AC: `getRingkasan()` tetap menghitung `totalProdukOnline`/`itemMenipis`/`itemMinus` dari baris online SAJA (tidak berubah arti). Bila berubah, `e2e/ringkasan.spec.ts` mengunci angka -> spec diperbarui sadar |
| Waktu respons | Route tulis mengembalikan nilai final setelah baca ulang (1-2 round-trip). Tidak ada SLA keras; `listStock()` < 500 KiB jadi proxy performa |
| Bahasa error | Semua pesan error route: kalimat Indonesia, PERSIS yang diuji test (pola `app/api/permintaan/route.ts:38-46`) |
| Log | Event `[gudang_v5_reject]`/`[gudang_v5_success]` dengan `{uid, aksi, alasan}` - tanpa isi payload penuh |
| Env | Tidak ada env baru. Tidak ada endpoint diagnosa (`docs/learnings.md:13-14`) |

---
## 12. Test strategy

Gate akhir (urutan ini):
1. **e2e pengunci COUNT lebih dulu** (`docs/learnings.md:31-32`): `e2e/histori.spec.ts` (`toHaveCount(12)` di baris 50 dan 135), `e2e/ringkasan.spec.ts` (`toHaveCount(10)` di baris 67), DAN `e2e/stok.spec.ts` (T25: perubahan default filter bisa mengubah jumlah baris) DIJALANKAN sebelum menambah seed apa pun. Seed v5 (gudang/permintaan/opname) WAJIB masuk store mock TERPISAH (`store.gudang`, `store.permintaanGudang`, `store.opnameGudang`), TIDAK ke `store.movements`/`store.stock` bersama.
2. `npm test` (script `node --test test/*.test.js`, `package.json:12`) - target: 0 fail (lihat catatan angka T3).
3. `npx tsc --noEmit` - exit 0.
4. `npm run e2e` (`package.json:16`) - target: 0 fail.

### 12a. Angka test yang dapat direproduksi (T3)

Metodologi hitung (jalankan sendiri, bukan percaya satu run):
- Unit: `(Select-String -Path test/*.test.js -Pattern "^\s*test\(").Count` = 316 saat dokumen ini ditulis.
- E2E: `(Select-String -Path e2e/*.spec.ts -Pattern "^\s*test\(").Count` = 150 spec; `playwright.config.ts:17-24` punya 3 project (mobile/tablet/desktop) -> 150 x 3 = 450 test utama; `retries: process.env.CI ? 1 : 0` (`playwright.config.ts:9`) dapat menambah rerun saat gagal. Jadi angka absolut TIDAK stabil; metrik gate = **0 fail**, bukan "601 pass" (angka versi 1 SALAH, dihapus).

Unit test baru:
- F1 `test/gudangMaster.test.js`: tambah/edit/nonaktif/aktifkan, duplikat nama (409), validasi panjang, owner-only, nonaktif gudang yang masih dirujuk -> `peringatan_referensi` menghitung admin + key `stock.qty_per_gudang` (T11c), batas 50 gudang (tambah ke-51 -> 400, T23/R3).
- F2 `test/stokGudangQty.test.js`: set-qty, isolasi antar key, paritas `stok_gudang_online` <-> `qty_per_gudang["ONLINE"]`, 404 kode tanpa stok, 403 admin gudang lain, audit `action_type:"set_qty_gudang"`.
- F3/F4 `test/adminGudangJabatan.test.js`: set `gudang_id`, set `jabatan` (termasuk > 40 char -> 400), `jabatan` tidak mengubah `role`, owner-only, DAN `jabatan:"owner"` pada guest -> tetap 403 (T12).
- F5/F6 `test/permintaanGudang.test.js`: buat + dedup item, satu dokumen untuk N tujuan, tabel transisi F5.2 (semua jalur legal + ilegal -> 409), `kirim` menurunkan asal SEKALI, `terima` per tujuan, `tidak-terima` mengembalikan ke asal, `tutup-tujuan` owner-only tanpa ubah stok + wajib alasan, `batal` dari `menunggu`/`disetujui`, stok asal tidak cukup -> 409 tanpa tulis, self-target gudang -> 400, self-target via user -> 400 (T13), snapshot `gudang_id` dipakai saat terima + user pindah gudang (T10), `setujui` oleh admin gudang lain -> sukses (Q2a), guard duplikat, max 20 tujuan, max 200 item (T23), status dokumen turunan benar (`dikirim`/`selesai`), `tujuan_ids` ditulis (T21).
- F7 `test/opnameGudang.test.js`: selisih 0 -> langsung `disetujui`; selisih != 0 -> `menunggu_approval` + qty TIDAK berubah; item tanpa key gudang -> `belum_terdaftar:true`, selisih 0 (T14); `setujui` owner menulis qty; `setujui` dengan `qty_per_gudang` BERUBAH sejak buat -> 409 `"Stok berubah sejak opname dibuat. Buat ulang."` (T9); `setujui` admin -> 403; `setujui` ganda -> 409; item duplikat -> 400; audit per item.
- F8 `test/produkOnline.test.js`: toggle, 404, 400 non-boolean, 403 guest, invalidasi cache dipanggil.
- F9 `test/stockFilter.test.js` (Z3): unit test logika filter `listStock` di `lib/dashboard/data/real.ts` dan `mock.ts`, satu test per cabang:
  - default online: `listStock()` tanpa argumen -> hanya baris `is_online_product === true`;
  - `is_online:"semua"` -> tidak memfilter `is_online_product` (baris online dan non-online keduanya tampil);
  - `is_online:false` -> juga menampilkan item non-online;
  - filter gudang: `listStock({gudang_id:"G1"})` -> hanya baris dengan key `qty_per_gudang["G1"]` terdefinisi;
  - kombinasi gudang + online: `listStock({gudang_id:"G1", is_online:"semua"})` -> irisan kedua filter, bukan salah satu;
  - `sertakan_tanpa_gudang:true` -> baris tanpa key gudang ikut tampil dengan `qty_gudang_terpilih:null`;
  - admin tanpa gudang: `listStock()` mengembalikan semua baris + flag `perlu_gudang:true` (filter gudang TIDAK diterapkan);
  - admin bergudang nonaktif: `listStock()` -> 0 baris + flag `gudang_nonaktif:true` + pesan `"Gudang kerja Anda dinonaktifkan. Hubungi owner."`;
  - perhitungan `status`/`kekurangan`: dari `qty_gudang_terpilih` bila gudang dipilih, dari `stok_gudang_online` bila tidak; `qty_gudang_terpilih` negatif -> `status:"minus"`, `kekurangan = Math.abs(nilai)`;
  - `qty_per_gudang` key bukan angka -> diperlakukan `null` di boundary baca.
  E2E `e2e/gudang-v5.spec.ts` tetap ada sebagai penguji jalur tampilan; `test/stockFilter.test.js` mengunci tiap cabang filter di jalur data.
- F3/F4 dispatcher validator (Z1) di `test/adminGudangJabatan.test.js`: test memanggil `validasiAksiAdmin` dari `lib/dashboard/validasiTulisV3a.js` (atau `POST()` dari `app/api/admin/route.ts`) dengan (a) body `set-gudang-user`/`set-jabatan` INVALID (mis. `target_user_id` hilang / `jabatan` > 40 karakter) -> HTTP 400 dengan pesan validator; (b) body VALID -> validator `ok:true` dan route melanjutkan ke handler (bukan 400 "Aksi tidak dikenal."). Tanpa cabang baru, test (b) GAGAL -> mengunci regresi Z1.
- Guard `test/guardV5.test.js`: tiap guard BR11 menolak duplikat < 10s dengan 409 dan TIDAK memanggil model (spy); aksi idempoten (set-jabatan/set-gudang-user) didokumentasikan tanpa guard.
- Index `test/indexFirestoreV5.test.js`: untuk SETIAP query konkret di tabel bagian 9, ada composite index di `firestore.indexes.json` dengan format `collectionGroup` + `fields[].fieldPath` (memakai helper yang sama dengan `test/indexFirestore.test.js:38-50`), DAN assert bentuk query di `real.ts`.
- Urutan guard `test/urutanGuardV5.test.js` (T18): import dan panggil `POST()` tiap route v5 dengan sesi guest + body INVALID -> assert 403 (guest menang sebelum validasi body). Urutan diuji: `tolakOrigin` -> sesi -> rate limit -> role -> validasi.

Uji CAS/concurrency (T27):
- Mock `mock.ts` TIDAK menyentuh Firestore -> CAS tidak dapat diuji lewat mock. AC yang bergantung transaksi Firestore nyata DITANDAI MANUAL/PRODUKSI-ONLY dan dicatat di PR:
  - dua `kirim` bersamaan (F5 edge),
  - dua `terima` tujuan berbeda bersamaan (T30),
  - dua `setujui` opname bersamaan (T9 CAS),
  - `verify-backfill.mjs` (T4).
- Test model DETERMINISTIK (V7): `test/casModelFirestore.test.js` dengan helper `test/helpers/mockFirestore.js` menyimulasikan `runTransaction` (versi dokumen per `get`, commit hanya bila versi masih sama; transaksi kedua yang membaca versi lama -> throw -> route memetakan ke 409). Minimal 3 skenario WAJIB, semua deterministik (bukan manual):
  - (a) DUA `terima` untuk DUA tujuan BERBEDA pada dokumen yang SAMA, dijalankan BERURUTAN pada dokumen yang sama: assert KEDUA entri `tujuan[]` tercatat (`diterima_at`/`diterima_oleh` masing-masing terisi), `riwayat_status` memuat dua entri, TIDAK ada duplikasi entri, dan status dokumen benar (`dikirim` bila masih ada `menunggu`, `selesai` bila semua selesai). Ini menggantikan AC #30 yang di revisi 2 hanya manual.
  - (b) `terima` vs `tutup-tujuan` tujuan SAMA (V5): tepat satu menang, yang kalah 409, stok konsisten (gudang tujuan naik ATAU tidak naik, tidak keduanya).
  - (c) DUA `tidak-terima` tujuan SAMA: yang pertama sukses mengembalikan stok ke asal sekali, yang kedua 409, stok asal tidak naik dua kali.
  - Bila helper mock tidak sanggup mensimulasikan salah satu skenario, skenario itu ditandai manual/staging dan dicatat di PR; skenario (a) TIDAK boleh diturunkan jadi manual karena menutup AC #30.

Paritas mock/real (WAJIB, `discovery-v5.md:170-171`):
- `test/mockParitas.test.js` diperluas: setiap method baru di `DataSource` (`listGudang`, `listPermintaanGudang`, `listOpnameGudang`, `listUserTujuan`, `buatPermintaanGudang`, `setujuiPermintaanGudang`, `tolakPermintaanGudang`, `batalPermintaanGudang`, `kirimPermintaanGudang`, `terimaPermintaanGudang`, `tidakTerimaPermintaanGudang`, `tutupTujuanPermintaan`, `ubahItemPermintaan`, `buatOpnameGudang`, `setujuiOpnameGudang`, `tolakOpnameGudang`, `toggleOnline`, `setQtyGudang`, `setGudangUser`, `setJabatan`) menghasilkan SHAPE identik antara `mock.ts` dan `real.ts` (kunci + tipe, nilai boleh beda).
- Mock menerapkan aturan bisnis yang sama (BR1, BR5, BR6) supaya e2e bisa menguji alur.
- `lib/dashboard/data/mock-paritas.js` ditambah guard v5 (paritas guard server) sesuai pola existing.

E2E baru:
- `e2e/gudang-v5.spec.ts`: master gudang CRUD, filter stok per gudang (default admin G1 = G1, dapat diganti ke G2 karena R5 read lintas gudang), toggle is-online mengubah baris di tabel.
- `e2e/permintaan-gudang.spec.ts`: alur buat -> setujui -> kirim -> terima multi-tujuan, `tidak-terima` mengembalikan stok, status akhir `selesai`, angka stok asal/tujuan terlihat berubah, PLUS (V14) langkah `batal` (permintaan `menunggu` -> `dibatalkan`, stok tidak berubah) dan langkah `tutup-tujuan` (owner menutup tujuan `menunggu` -> status dokumen `selesai` bila terakhir, stok tidak berubah, tombol hanya tampil untuk owner).
- `e2e/opname-gudang.spec.ts`: selisih 0 langsung tampil `disetujui`; selisih != 0 tampil antrian approval, tombol setujui hanya owner.

Regresi index lama (T29): `test/indexFirestore.test.js` existing WAJIB tetap hijau; test v5 memakai helper `adaIndexPendukung` yang sama (bukan menyalin). Perubahan bentuk query `stock_movements` di `real.ts` (mis. menambah `gudang_id`) WAJIB memperbarui `FIELD_EQUALITY` di test lama tersebut.

Wajib (`docs/learnings.md:24`): minimal satu test per route baru yang MENG-IMPORT dan memanggil `POST()` route tersebut (bukan mirror helper), memverifikasi status code + urutan (tolakOrigin -> sesi -> rate limit -> role -> validasi).

Mutation test: satu test yang GAGAL bila guard dihapus atau bila `kirim` menambah stok tujuan (mis. mengubah `qty_per_gudang[tujuan]` di kode lalu lihat test merah).

---
## 13. Risiko

Risiko dari `discovery-v5.md:147-179` (R1-R8) plus implementasi baru:

| # | Risiko | Mitigasi |
|---|---|---|
| R1 | Filter gudang hanya di UI -> IDOR pada TULIS (`discovery-v5.md:149-154`) | BR7 (write-scope); test memanggil route set-qty/buat dengan `gudang_id` palsu milik admin lain -> 403. Read lintas gudang SENGAJA diizinkan (R5), bukan bug |
| R2 | Seed baru merusak e2e COUNT (`discovery-v5.md:155-158`) | Jalankan `histori`/`ringkasan`/`stok` dulu; store mock terpisah (bagian 12 langkah 1) |
| R3 | Backfill data lama (`discovery-v5.md:159-161`) | Aturan pemenang tunggal bagian 10 langkah #2 + transaksi per dokumen; fallback baca `{"ONLINE": stok_gudang_online}` di boundary |
| R4 | Koleksi baru tak terbaca (`discovery-v5.md:162-166`) | Rules bagian 8 ditambahkan bersamaan rilis, bukan setelahnya |
| R5 | Composite index tak terlihat gate (`docs/learnings.md:35`) | `test/indexFirestoreV5.test.js` + verifikasi `firebase firestore:indexes` |
| R6 | DataSource 3x + paritas (`discovery-v5.md:170-171`) | Daftar file lengkap F10/T24; test paritas wajib; method baru didefinisikan di `index.ts` + `types.ts` dulu |
| R7 | Nama field campur camelCase (`discovery-v5.md:173-174`) | BR12; semua `dibuat_at` -> `created_at` (T1); review grep sebelum merge |
| R8 | Reorder point lama berubah (`discovery-v5.md:175-176`) | BR13; `cariStokDiDibawahReorderPoint` tidak disentuh |
| R9 | Paritas `stok_gudang_online` <-> `qty_per_gudang["ONLINE"]` bocor | BR3 + test paritas; kedua nilai selalu ditulis di transaksi yang sama |
| R10 | `terima` multi-tujuan setengah jalan lalu dokumen nyangkut `dikirim` | Aksi `tutup-tujuan` (owner-only, F5.2) tersedia + dicatat audit; status per tujuan terlihat di UI |
| R11 | Admin `gudang_id:null` (belum di-set pasca migrasi) | F9 default tidak difilter + flag `perlu_gudang:true`; F5 -> pesan `"Akun Anda belum punya gudang."`; UI banner |
| R12 | Transaksi Firestore dengan >10 read/write | Batasi `items.length <= 200` dan `tujuan.length <= 20`; bila melebihi, pecah ke batched write (belum MVP) |
| R13 | Guard best-effort gagal -> double-submit lolos | Sama seperti existing (`app/api/stok/mutasi/route.ts:144-147`): guard gagal tidak memblokir; mitigasi utama CAS transaksi |
| R14 | Angka `stok_gudang_online` beda dari `qty_per_gudang["ONLINE"]` pada dokumen lama | Boundary baca: `qty_per_gudang["ONLINE"] ?? stok_gudang_online ?? 0`; migrasi bagian 10 menyelaraskan ke pemenang `qty_per_gudang` (T8) |
| R15 | e2e `stok.spec.ts` mengasumsikan tabel hanya menampilkan produk online | `stok.spec.ts` masuk gate awal (T25); perubahan default filter dicek ke spec itu |
| R16 (baru) | Read lintas gudang stok/permintaan membuat data operasional gudang lain terlihat semua staff | KONSEKUENSI YANG DITERIMA (R5). Didokumentasikan di bagian 3 dan 8; bila kelak perlu, pindahkan ke route server ber-scope (bukan MVP) |
| R17 (baru) | `tutup-tujuan` menandai barang hilang tanpa jejak | Wajib `catatan_alasan` 1-200 char + `stock_movements` `action_type:"tutup_tujuan"` dengan `qty` = qty ASLI barang tujuan itu (bukan 0) + `gudang_id:<dari_gudang_id>` + audit owner. Total barang hilang dapat direkonsiliasi kapan pun: jumlahkan `qty` pada `stock_movements where action_type == "tutup_tujuan"` (V4b) |

Asumsi (dari discovery bagian 7): jumlah gudang maksimum 50 (BR15); `qty_per_gudang` aman dari 1 MiB; level permission cukup `owner/admin/guest`; approval opname hanya owner.

---

## 14. Acceptance criteria global

v5 dianggap selesai HANYA bila SEMUA pernyataan ini benar dan terverifikasi:

1. Owner bisa menambah, mengedit, menonaktifkan, dan mengaktifkan gudang; gudang ke-51 ditolak 400 `"Maksimal 50 gudang."`; nama duplikat ditolak 409 (F1, BR15).
2. Setiap dokumen `stock` (33 existing setelah migrasi) punya `qty_per_gudang["ONLINE"]` == `stok_gudang_online`; verifikasi via `node scripts/verify-backfill.mjs` exit 0 (atau manual dicatat di PR bila script tidak dibuat) (F2, bagian 10a, T4).
3. Menulis qty satu gudang tidak mengubah qty gudang lain (F2).
4. Admin dengan `gudang_id` hanya bisa MENULIS data gudangnya; memalsukan `gudang_id` di body aksi TULIS -> 403. READ stok lintas gudang DIIZINKAN untuk semua staff (keputusan R5) dan TIDAK dianggap pelanggaran (BR7, F9, T15/T17).
5. Nama field waktu pada `gudang`/`permintaan_gudang`/`opname_gudang` = `created_at`, TIDAK ada `dibuat_at` di dokumen ini (T1).
6. Permintaan satu dokumen banyak tujuan dengan status PER-TUJUAN (R2): `kirim` menurunkan stok asal tepat sekali; `terima` menaikkan tiap gudang tujuan tepat sekali; `tidak-terima` mengembalikan stok ke gudang asal; status dokumen `selesai` hanya setelah semua tujuan selesai (F5, BR5).
7. Tabel transisi F5.2 lengkap: semua jalur legal berfungsi, semua jalur ilegal -> 409 dengan pesan spesifik (T6). Setiap baris 409 di tabel punya AC padanan di F5.3 dan test di `test/permintaanGudang.test.js`; sebaliknya setiap AC F5.3 yang menyebut 409 punya baris di tabel (V1, korespondensi dua arah).
8. `kirim` dengan stok asal tidak cukup ditolak 409 dan tidak menulis apa pun (BR1).
9. `setujui` permintaan berhasil untuk admin/owner mana pun (Q2a), bukan hanya gudang asal/tujuan.
10. `batal` berhasil dari `menunggu` dan `disetujui` oleh pembuat atau admin/owner mana pun, tanpa mengubah stok (R1).
11. Opname selisih 0 langsung `disetujui`; selisih != 0 `menunggu_approval` dan `qty_per_gudang` TIDAK berubah sampai owner menyetujui; `setujui` dengan `qty_sistem` basi -> 409 `"Stok berubah sejak opname dibuat. Buat ulang."` (F7, BR6, T9).
12. Item opname tanpa key gudang tidak memicu approval palsu (T14).
13. Admin tidak bisa menyetujui opname (403); guest tidak bisa aksi tulis apa pun, dan guest ditolak SEBELUM validasi body (403 walau body invalid) (F4-F8, T18).
14. Toggle `is_online_product` dari dashboard bekerja, invalidasi cache produk, dan guest ditolak 403 (F8).
15. `jabatan` dapat diubah owner dan TIDAK memengaruhi hasil otorisasi apa pun; `jabatan:"owner"` pada guest tetap 403 (F4, BR8, T12).
16. "Kirim ke: User" hanya menampilkan user dengan `gudang_id` terisi; guest tidak muncul (Q5a, F6).
17. Filter gudang halaman stok DEFAULT mengikuti `gudang_id` user; admin dapat mengganti ke gudang lain (R5); admin tanpa gudang melihat pesan eksplisit; admin bergudang nonaktif melihat pesan eksplisit (Q3a, F9, T11).
18. User tujuan pindah gudang setelah `buat`: stok masuk gudang SNAPSHOT, bukan gudang baru (T10).
19. `tutup-tujuan` (owner) menutup tujuan `menunggu` tanpa mengubah stok, wajib alasan 1-200 char, tercatat audit, DAN `stock_movements` memuat `action_type:"tutup_tujuan"` dengan `qty` ASLI barang tujuan itu (bukan 0) + `gudang_id:<dari_gudang_id>`; total barang hilang dapat direkonsiliasi via query `stock_movements where action_type == "tutup_tujuan"` (T7, R2, V4b).
20. Tidak ada BOM/mojibake di file yang ditambahkan (`docs/learnings.md:27`); semua field baru snake_case; dokumen ini byte pertama = `#` (T1, BR12).
21. Gate `npm test` 0 fail, `npx tsc --noEmit` exit 0, `npm run e2e` 0 fail, dengan `histori.spec.ts`/`ringkasan.spec.ts`/`stok.spec.ts` dijalankan lebih dulu (T3, T25).
22. Semua composite index bagian 9 ada di `firestore.indexes.json` dalam format JSON final, diverifikasi ter-deploy via `firebase firestore:indexes --project bot-admin-toko-a0c47`, dan tidak ada query produksi tanpa index. Index `stock_movements.gudang_id` TIDAK ada di bagian 9 dan TIDAK dituntut AC ini (V9).
23. Rules bagian 8 ter-deploy; koleksi `gudang`/`permintaan_gudang`/`opname_gudang` terbaca sesuai role; semua guard `read, write: if false`; read lintas gudang untuk staff DIKONFIRMASI sebagai perilaku yang diinginkan (T15).
24. Setiap route baru punya minimal satu test yang memanggil `POST()` route tersebut dan memverifikasi status code (`docs/learnings.md:24`).
25. Respons `listStock()` pada 1107 produk < 500 KiB terukur (T28).
26. `getRingkasan()` tetap hanya menghitung produk online (T28b).
27. Semua aksi tulis v5 masuk daftar guard BR11 atau dinyatakan eksplisit idempoten (T22).
28. Batas `items <= 200` dan `tujuan <= 20` ditegakkan sebagai AC (T23).
29. `test/indexFirestore.test.js` existing tetap hijau (T29).
30. Dua `terima` tujuan berbeda -> kedua entri tercatat, tidak ada duplikasi, status dokumen benar; DIUJI DETERMINISTIK lewat `test/casModelFirestore.test.js` skenario (a) (V7). Verifikasi dua request bersamaan di produksi tetap dicatat manual di PR.
31. Tidak ada file di `docs/arsip-v4/` yang diubah atau dirujuk.
32. Recompute kombinasi (V2): 3 tujuan `diterima`+`tidak_terima`+`ditutup` -> `selesai`; `diterima`+`menunggu` -> tetap `dikirim`; semua tujuan `ditutup` -> `selesai`; `selesai_at` terisi sekali. Teruji di `test/permintaanGudang.test.js`.
33. V3: `tidak-terima` pada tujuan berstatus `ditutup` -> 409 `"Tujuan ini sudah ditutup."` dan stok gudang asal TIDAK berubah (nilai sebelum == sesudah). Tujuan `ditutup` terminal: tidak dapat diubah aksi apa pun.
34. V5: `terima` vs `tutup-tujuan` pada tujuan SAMA -> tepat satu menang, yang kalah 409, stok konsisten (naik ATAU tidak, tidak keduanya). Teruji lewat model test `test/casModelFirestore.test.js` skenario (b).
35. V10: tujuan dengan `gudang_id_snapshot` hilang -> `tutup-tujuan` owner sukses menutup, stok tidak berubah, movement `tutup_tujuan` ber-`qty` ASLI tercatat, dan dokumen menjadi `selesai` bila itu tujuan terakhir `menunggu`. V11: matriks `tipe` tujuan x kondisi gudang saat `terima` diuji satu per satu (gudang nonaktif/hilang -> 409; user snapshot null -> selesai tanpa stok).
36. V8: owner dapat menemukan dokumen nyangkut lewat `listPermintaanGudang({ status:"dikirim" })` (index #1) dan menutup tujuannya dari UI; AC UI: dokumen `dikirim` yang semua tujuannya `tutup-tujuan` langsung hilang dari daftar nyangkut (status menjadi `selesai`).

---

## 15. Pertanyaan terbuka

Tidak ada blocker tersisa. Semua keputusan discovery bagian 8 sudah dijawab user (Q1a-Q5a) dan direvisi oleh R1-R5. Pertanyaan minor yang BELUM diputuskan (tidak memblokir implementasi, default tertulis):
1. Bila `verify-backfill.mjs` tidak dibuat, apakah AC #2 boleh tetap bagian gate atau harus manual? Default: buat script (bagian 10a) karena murah dan dapat dijalankan ulang.
2. (DIPUTUSKAN, V9) `stock_movements.gudang_id` TIDAK di-index di v5. Halaman histori movement per gudang bukan bagian v5, jadi index itu tidak punya query pemakai. Bila halaman dibuat, index ditambah bersamaan fungsi + AC-nya. Tidak lagi pertanyaan terbuka.
3. Batas `items <= 200` apakah terlalu ketat untuk use case nyata? Default: 200 cukup; boleh dinaikkan setelah ada data pemakaian.
4. Apakah guest perlu melihat `permintaan_gudang`/`opname_gudang`? Default: TIDAK (`staff()`), sesuai R5 yang menyebut "read semua STAFF".

Bila implementasi menemukan konflik baru dengan kode nyata, catat di sini sebagai entri baru - JANGAN putuskan sendiri.

---
## 16. Perubahan Revisi (vs versi 1)

Daftar temuan review T1-T30 dan cara ditutup. Semua TERTUTUP.

| Temuan | Severity | Status | Cara ditutup |
|---|---|---|---|
| T1 | blocker | TERTUTUP | Semua `dibuat_at` -> `created_at` di skema 6.1/6.2/6.3; `diubah_at` -> `updated_at`; BR12 + AC global #5 |
| T2 | major | TERTUTUP | Sub-bagian F10 "migrasi kontrak DataSource": daftar pemanggil `listStock` (`app/stok/page.tsx:74`, `app/permintaan/page.tsx:72`, `app/page.tsx:45`, `sumber-data.tsx:203`) + argumen opsional + AC tsc |
| T3 | major | TERTUTUP | Bagian 12a metodologi hitung: unit 316, e2e 150 spec x 3 project = 450, metrik = 0 fail; klaim "601" dihapus |
| T4 | major | TERTUTUP | Bagian 10a + AC global #2: `scripts/verify-backfill.mjs` read-only exit code; fallback manual dicatat PR |
| T5 | major | TERTUTUP | BR2 diberi catatan eksplisit bahwa `discovery-v5.md:96-99` "agregat" DIGANTIKAN Q4a |
| T6 | blocker | TERTUTUP | Tabel transisi eksplisit F5.2 (semua jalur legal + ilegal); aksi `batal` (R1) ditambah |
| T7 | blocker | TERTUTUP | Status PER-TUJUAN (R2) + aksi `terima`/`tidak-terima`/`tutup-tujuan`; skema `TujuanEntri` 6.2; aksi masuk endpoint bagian 7 |
| T8 | blocker | TERTUTUP | Bagian 10 langkah #2 aturan pemenang tunggal (`qty_per_gudang["ONLINE"]` menang, `stok_gudang_online` diselaraskan) + transaksi per dokumen + AC + test |
| T9 | major | TERTUTUP | F7 `setujui` ber-CAS: bandingkan `qty_sistem` tersimpan vs nilai saat ini -> 409 `"Stok berubah sejak opname dibuat. Buat ulang."` |
| T10 | major | TERTUTUP | `TujuanEntri.gudang_id_snapshot` disimpan saat `buat`; `terima` memakai snapshot; AC user pindah gudang |
| T11 | major | TERTUTUP | F3/F9 AC admin bergudang nonaktif -> 0 baris + `gudang_nonaktif:true` + pesan; `peringatan_referensi` hitung admin + key `stock.qty_per_gudang` |
| T12 | major | TERTUTUP | F4 AC negatif `jabatan:"owner"` pada guest -> 403 + negative-grep `jabatan` di jalur otorisasi |
| T13 | major | TERTUTUP | F5/F6 validasi tujuan resolve ke `dari_gudang_id` -> 400 `"Tujuan sama dengan gudang asal."` |
| T14 | minor | TERTUTUP | F7 item tanpa key gudang -> `belum_terdaftar:true`, `qty_sistem:null`, `selisih:0`, tidak memicu approval |
| T15 | blocker | TERTUTUP | Sesuai R5: rules tetap `staff()`; bagian 8 + bagian 3 diubah agar TIDAK mengklaim scope gudang membatasi read; konsekuensi `qty_per_gudang` terlihat semua staff dinyatakan eksplisit |
| T16 | major | TERTUTUP | Bagian 6.4 catatan: guard `{merge:false}` per uid -> jumlah dokumen kecil, tidak butuh TTL policy |
| T17 | major | TERTUTUP | Bagian 8 KONSEKUENSI EKSPLISIT: `stock` read `authed()` -> semua key terlihat; diterima sebagai R5 |
| T18 | major | TERTUTUP | Bagian 7 urutan guard baru + test `test/urutanGuardV5.test.js` + AC global #13 |
| T19 | minor | TERTUTUP | Bagian 3 matrix ditambah baris "Lihat master gudang" (guest read-only) |
| T20 | blocker | TERTUTUP | Bagian 9 format JSON final (`collectionGroup`/`queryScope`/`fields[]`/`density`); index `stock.kode_barang` + `gudang.aktif` dibuang; tiap index dipetakan ke query konkret (fungsi + file) |
| T21 | major | TERTUTUP | Field `tujuan_ids: string[]` + index `ARRAY_CONTAINS` (bagian 9 #4) untuk `array-contains` |
| T22 | major | TERTUTUP | BR11 daftar lengkap guard + daftar eksplisit idempoten (`set-jabatan`, `set-gudang-user`, dst) |
| T23 | major | TERTUTUP | BR15 maksimum 50 gudang (R3) + BR16 `items <= 200` sebagai AC F5; bagian 11 diselaraskan dengan bagian 6.5 |
| T24 | major | TERTUTUP | F10 daftar file wajib: `index.ts`, `real.ts`, `mock.ts`, `types.ts`, `mock-data.ts`, `mock-paritas.js`, `sumber-data.tsx` + test paritas |
| T25 | minor | TERTUTUP | Bagian 12 langkah 1 + AC global #21: `stok.spec.ts` masuk gate awal |
| T26 | minor | TERTUTUP | Bagian 7: klaim "batas platform 2048" dihapus; dinyatakan repo Vercel Next.js (`package.json:14-16`, `vercel.json`), bukan Firebase Functions |
| T27 | major | TERTUTUP | Bagian 12 "Uji CAS/concurrency": AC bergantung Firestore nyata ditandai manual/produksi-only + test model `test/casModelFirestore.test.js` dengan `test/helpers/mockFirestore.js` |
| T28 | major | TERTUTUP | Bagian 11: `listStock()` < 500 KiB jadi AC terukur; `getRingkasan` disebut ikut full-scan + AC tetap hitung produk online |
| T29 | minor | TERTUTUP | Bagian 12 "Regresi index lama": `test/indexFirestore.test.js` wajib tetap hijau, pakai helper sama |
| T30 | minor | TERTUTUP | F5 edge + AC global #30: dua `terima` tujuan berbeda bersamaan -> dua entri tercatat, tanpa duplikasi |

---

## 17. Keputusan User Tambahan (R1-R5)

Keputusan ini dijawab user SETELAH review dan WAJIB dipakai.

**R1 - Aksi `batal` ADA.** Dari status `menunggu` DAN `disetujui`. Yang boleh membatalkan: pembuat permintaan ATAU admin/owner mana pun. Membatalkan TIDAK mengubah stok (stok belum turun saat `menunggu`/`disetujui`). Status hasil: `dibatalkan`. Dicatat: `dibatalkan_oleh`, `dibatalkan_at`, `riwayat_status`. Diterapkan di: BR11 (guard), F5.2 (tabel transisi), F5.3 (AC), bagian 6.2 (field), bagian 7 (aksi).

**R2 - Status PER-TUJUAN.** Mengubah keputusan Q1a lama:
- Satu dokumen permintaan, banyak tujuan.
- Stok asal tetap turun SEKALI saat aksi `kirim` (Q1a lama tetap berlaku untuk poin ini).
- Tiap tujuan punya status SENDIRI: `menunggu` -> `diterima` ATAU `tidak_terima` (plus `ditutup` via owner).
- Status dokumen keseluruhan TURUNAN: `dikirim` (ada tujuan `menunggu`), `selesai` (semua tujuan `diterima`/`tidak_terima`/`ditutup`).
- `tidak_terima` = penerima menolak barang yang sudah dikirim. Stok dikembalikan ke gudang asal (`qty_per_gudang[dari_gudang_id]` + qty tujuan itu) dan dicatat di `stock_movements` sebagai pengembalian (`action_type:"pengembalian_gudang"`). Ditulis eksplisit dengan AC di F5.2/F5.3.
- Owner bisa close tujuan nyangkut `menunggu` (aksi owner-only `tutup-tujuan`) dengan catatan alasan. Efek stok: TIDAK mengubah stok (barang dianggap hilang/selesai di luar sistem), WAJIB tercatat di audit + alasan. REVISI 3 (V4b): `stock_movements` WAJIB menulis `type:"koreksi_manual"`, `action_type:"tutup_tujuan"`, `gudang_id:<dari_gudang_id>`, dan `qty` = qty ASLI barang tujuan itu (BUKAN 0), supaya jumlah barang hilang dapat direkonsiliasi kapan pun lewat query `stock_movements where action_type == "tutup_tujuan"`. Efek STOK (saldo `qty_per_gudang`) tetap TIDAK berubah.
- Diterapkan di: BR5, F5.1, F5.2, F5.3, F6, bagian 6.2 (`TujuanEntri`), bagian 7, bagian 12, bagian 14.

**R3 - Batas gudang MAKSIMUM 50.** Business rule BR15. Route tolak penambahan gudang ke-51 dengan HTTP 400 `"Maksimal 50 gudang."`. Diterapkan di: F1, BR15, bagian 6.5, bagian 11, bagian 12, bagian 14.

**R4 - Nama field waktu = `created_at`.** SEMUA `dibuat_at` di skema diganti `created_at`; `diubah_at` -> `updated_at`. Konsisten snake_case dengan `stock_movements` existing. Diterapkan di: bagian 6.1, 6.2, 6.3, BR12, AC global #5.

**R5 - Cross-gudang READ DIIZINKAN.** Semua staff boleh melihat stok semua gudang (termasuk guest read-only). Ini keputusan sadar user. PRD TIDAK lagi mengklaim scope gudang membatasi READ stok; scope gudang hanya membatasi DEFAULT FILTER (Q3a) dan TULIS (BR7 tetap berlaku untuk aksi tulis). Untuk `permintaan_gudang`/`opname_gudang`: boleh dibaca semua staff juga (konsisten R5), jadi rules boleh `staff()`. Klaim "scope gudang membatasi read" dihapus. Dinyatakan eksplisit di bagian 3, bagian 8: "read lintas gudang diizinkan untuk semua staff (keputusan user); scope gudang hanya membatasi default filter dan operasi tulis." Konsekuensi: `qty_per_gudang` seluruh gudang terlihat oleh semua staff (didokumentasikan bagian 8, T17). Diterapkan di: bagian 1, bagian 3, bagian 8, BR7, F9, BR11 (T22), R16, AC global #4/#17/#23.
---

## 18. Perubahan Revisi 3 (vs revisi 2)

Revisi 3 menutup temuan review pass-2 V1-V15 (`docs/prd-v5-review-2.md`) plus keputusan user V4b.

### 18.1 Blocker

| Temuan | Severity | Status | Cara ditutup (lokasi baru) |
|---|---|---|---|
| V1 | blocker | TERTUTUP | Tabel F5.2 (bagian F5.2) ditulis ulang: baris eksplisit untuk SEMUA kombinasi `dari_status x aksi x status ENTRI tujuan[k]`. Ditambah 12 baris 409 baru: tujuan `diterima` + `terima`/`tidak-terima`/`tutup-tujuan` -> 409 `"Tujuan ini sudah diterima."`; tujuan `tidak_terima` + ketiganya -> 409 `"Tujuan ini sudah tidak diterima."`; tujuan `ditutup` + ketiganya -> 409 `"Tujuan ini sudah ditutup."`; `dikirim` + `kirim` ulang -> 409 `"Permintaan sudah dikirim."`; `disetujui` + `terima`/`tidak-terima`/`tutup-tujuan` -> 409 `"Permintaan belum dikirim."`; `disetujui` + `kirim` kedua -> 409 `"Permintaan sudah dikirim."`; `menunggu` + `terima`/`tidak-terima`/`tutup-tujuan` -> 409 `"Permintaan belum dikirim."`. Aturan umum ditambah: legalitas ditentukan status ENTRI, bukan hanya status dokumen. AC F5.3 ditambah precondition eksplisit untuk `tidak-terima` dan `tutup-tujuan`. AC global #7 diubah menjadi korespondensi dua arah tabel <-> AC. |
| V2 | blocker | TERTUTUP | AC F5.3 ditambah blok "AC recompute kombinasi (V2)": (a) 3 tujuan `diterima`+`tidak_terima`+`ditutup` -> `selesai`; (b) `diterima`+`menunggu` -> tetap `dikirim`; (c) `ditutup`+`menunggu` -> tetap `dikirim`; (d) `diterima`+`diterima`+`tidak_terima` -> `selesai`; (e) semua `ditutup` -> `selesai`; (f) `selesai_at` terisi tepat sekali. Test eksplisit di `test/permintaanGudang.test.js`. AC global #32. |
| V3 | blocker | TERTUTUP | Tabel F5.2 menambah baris 409 untuk tujuan `ditutup` (V1). AC F5.3 baru: "`tidak-terima` HANYA valid bila status ENTRI masih `menunggu`; pada tujuan `ditutup` -> 409 `\"Tujuan ini sudah ditutup.\"` dan `qty_per_gudang[dari_gudang_id]` TIDAK berubah (assert sebelum == sesudah)". Catatan F5.1: tujuan `ditutup` TERMINAL. Test urutan `tutup-tujuan` -> `tidak-terima` -> 409. AC global #33. |
| V4 | blocker | TERTUTUP (keputusan user V4b, bagian 19) | `tutup-tujuan` TETAP tidak mengubah saldo stok, TETAPI `stock_movements` WAJIB dicatat dengan qty ASLI barang tujuan (bukan 0). Lihat bagian 19. Diperbaiki di: F5.1 (baris `ditutup`), F5.2 (baris `tutup-tujuan`), AC F5.3, R17, R2 (bagian 17). |

### 18.2 Major

| Temuan | Severity | Status | Cara ditutup |
|---|---|---|---|
| V5 | major | TERTUTUP | AC F5.3 baru: `terima` vs `tutup-tujuan` pada tujuan SAMA -> tepat satu menang, yang kalah 409, stok konsisten (naik ATAU tidak, tidak keduanya). Edge case F5 ditambah. Diuji deterministik lewat `test/casModelFirestore.test.js` skenario (b). AC global #34. |
| V6 | major | TERTUTUP | BR11 ditulis ulang menjadi Kategori A (Guard WAJIB) dan Kategori B (TIDAK butuh guard). `batal` dan `tutup-tujuan` DIHAPUS dari daftar idempoten: keduanya tetap di Kategori A (guard dipasang, sesuai 6.4) dengan catatan bahwa pengaman utama double-apply = CAS `status` + `tujuan[k].status`. Kontradiksi baris 423 vs 430-431 dihapus. Test `test/guardV5.test.js` diperjelas: kategori A -> 409 duplikat < 10s; kategori B -> boleh diulang. |
| V7 | major | TERTUTUP | Bagian 12 "Uji CAS/concurrency" diperluas: `test/casModelFirestore.test.js` + `test/helpers/mockFirestore.js` WAJIB memuat 3 skenario deterministik: (a) dua `terima` tujuan BERBEDA pada dokumen sama -> kedua entri tercatat + status dokumen benar; (b) `terima` vs `tutup-tujuan` tujuan sama (V5); (c) dua `tidak-terima` tujuan sama. Skenario (a) TIDAK boleh diturunkan jadi manual (menutup AC #30). AC #30 diubah: deterministik, bukan manual-only. |
| V8 | major | TERTUTUP | Bagian 9 index #1 dipetakan juga ke `listPermintaanGudang({ status:"dikirim" })` sebagai "daftar dokumen nyangkut owner". AC global #36: owner menemukan dokumen nyangkut lewat query itu + AC UI (dokumen hilang dari daftar setelah semua tujuan ditutup). R10 pada bagian 13 kini punya query konkret, bukan hanya klaim mitigasi. |
| V9 | major | TERTUTUP | DIPUTUSKAN: `listMovements({ gudang_id })` BUKAN bagian v5 (non-goal). Index `stock_movements.gudang_id` DIHAPUS dari tabel bagian 9, dari blok JSON, dan dari tuntutan AC #22. Ditambahkan ke daftar "Index yang DIBUANG" dengan alasan + jalur upgrade (pasang bersamaan fungsi + AC). Bagian 15 #2 ditutup sebagai DIPUTUSKAN, bukan pertanyaan terbuka. |
| V10 | major | TERTUTUP | Edge case F5 baru: AC jalur pemulihan dokumen nyangkut - tujuan dengan `gudang_id_snapshot` hilang -> `tutup-tujuan` owner SUKSES, stok tidak berubah, movement `tutup_tujuan` ber-`qty` ASLI tercatat, dokumen menjadi `selesai` bila itu terakhir. Test di `test/permintaanGudang.test.js`. AC global #35. |
| V11 | major | TERTUTUP | Edge case F5 baru: matriks deterministik "`tipe` tujuan x kondisi gudang saat `terima`/`tidak-terima`". Pemisah eksplisit: `tipe:"gudang"` nonaktif/tidak ada -> `terima` 409 `"Gudang tujuan nonaktif."` (dan `tidak-terima` tetap sukses); `tipe:"user"` snapshot `null` -> `terima` sukses TANPA menambah stok, entri tetap selesai; `tipe:"user"` snapshot tidak ada -> 409 `"Gudang tujuan tidak ditemukan."`. Tidak ada lagi tumpang tindih dengan baris 244/267 lama. AC global #35. |

### 18.3 Minor

| Temuan | Severity | Status | Cara ditutup |
|---|---|---|---|
| V12 | minor | TERTUTUP | Header diberi jejak tanggal eksplisit: "Tanggal revisi 1 / revisi 2 / revisi 3" (semuanya 2026-09-16) + catatan isi tiap revisi. Sumber ditambah `docs/prd-v5-review-2.md`. |
| V13 | minor | TERTUTUP | Baris 6.4 untuk `permintaan_gudang_guard` diberi catatan eksplisit: `tutup-tujuan`/`batal` masuk Kategori A BR11, guard best-effort, pengaman utama = CAS `tujuan[k].status`. Konsisten dengan keputusan V6. |
| V14 | minor | TERTUTUP | `e2e/permintaan-gudang.spec.ts` ditambah langkah `batal` (permintaan `menunggu` -> `dibatalkan`, stok tidak berubah) dan `tutup-tujuan` (owner menutup tujuan `menunggu`, status dokumen `selesai` bila terakhir, stok tidak berubah, tombol hanya untuk owner). Tidak lagi hanya unit test. |
| V15 | minor | TERTUTUP (catatan) | Tidak ada perubahan requirement. Dicatat eksplisit di sini bahwa matrix bagian 3, rules bagian 8 (`staff()`), dan bagian 15 #4 KONSISTEN: guest BUKAN staff sehingga guest tidak membaca `permintaan_gudang`/`opname_gudang`; guest hanya membaca `gudang` dan `stock`. Agar tidak diperdebatkan ulang (R5 menyebut "semua STAFF", bukan "semua authed"). |

### 18.4 Verifikasi yang menyertai revisi 3

1. Tidak ada sisa ketentuan qty nol untuk `action_type:"tutup_tujuan"` di dokumen ini (grep literal "qt""y 0" bersih).
2. Tidak ada sisa klaim `tutup-tujuan` "TIDAK mengubah stok" tanpa menyebut pencatatan qty ASLI.
3. `dibuat_at` hanya muncul di konteks riwayat/larangan (BR12, R7, AC #5, R4).
4. Tabel F5.2 <-> AC F5.3 berkorespondensi dua arah (setiap baris 409 tabel punya AC; setiap AC 409 punya baris tabel).
5. Gate: `npm test` 0 fail, `npx tsc --noEmit` exit 0, `npm run e2e` 0 fail, `test/indexFirestore.test.js` existing tetap hijau.

---

## 19. Keputusan User Tambahan (V4b)

Keputusan ini dijawab user SETELAH review pass-2 dan WAJIB dipakai.

**V4b - `tutup-tujuan` mencatat qty ASLI di `stock_movements`.**

Saat owner menjalankan `tutup-tujuan` pada tujuan yang nyangkut `menunggu`:

- Saldo stok TIDAK berubah. `qty_per_gudang` gudang asal maupun gudang tujuan TIDAK ditambah/dikurangi. Barang tetap dianggap hilang/selesai di luar sistem (perilaku PRD revisi 2 dipertahankan).
- `stock_movements` WAJIB ditulis dengan qty ASLI barang tujuan itu (BUKAN 0):
  - `type: "koreksi_manual"`
  - `action_type: "tutup_tujuan"`
  - `gudang_id: <dari_gudang_id>`
  - `qty` = jumlah qty ASLI total barang tujuan ke-k
  - `catatan_alasan` 1-200 karakter (WAJIB; tanpa itu -> HTTP 400 `"Alasan wajib diisi."`)
  - `created_at` (BR12, T1), `created_by` = uid owner
- Tujuan: jumlah barang hilang dapat direkonsiliasi kapan pun dengan query
  `stock_movements where action_type == "tutup_tujuan"` lalu jumlahkan `qty`.
- Gagal tulis `stock_movements` TIDAK rollback perubahan status (BR10); respons memuat `peringatan_audit:true`.
- Respons `tutup-tujuan` memuat `qty_hilang` = qty ASLI tujuan itu.

Diterapkan di: F5.1 (definisi status `ditutup`), F5.2 (baris `tutup-tujuan` + efek audit), F5.3 (AC `tutup-tujuan`), R17 (bagian 13), R2 (bagian 17), bagian 18 (status V4), AC global #19.

Catatan konsistensi: keputusan ini TIDAK mengubah BR5 (stok asal turun sekali saat `kirim`) dan TIDAK mengubah aturan `tidak-terima` (satu-satunya jalur yang menambah stok asal). Setelah `tutup-tujuan`, tujuan bersifat TERMINAL sehingga `tidak-terima` berikutnya -> 409 dan tidak menciptakan stok (V3).
---

## 20. Perubahan Revisi 4 (Verifikasi Final)

Revisi 4 menutup temuan verifikasi final Z1-Z4 (`docs/prd-v5-verifikasi-final.md`). Tidak ada keputusan
terkunci (D1a..Q5a, R1-R5, V4b) yang diubah. Semua perubahan bersifat melengkapi daftar file, test, dan
perapian penomoran.

### 20.1 Z1 [major] - `lib/dashboard/validasiTulisV3a.js` tidak terdaftar

Masalah: aksi baru `set-gudang-user` dan `set-jabatan` masuk ke route existing `/api/admin`, yang memakai
dispatcher `validasiAksiAdmin` di `lib/dashboard/validasiTulisV3a.js` (dipanggil `app/api/admin/route.ts:65`).
Dispatcher hanya mengenal `approve-akses`, `tolak-akses`, `tambah-produk`, `konfirmasi-draft`, `kata-kunci`;
aksi di luar daftar ditolak `lib/dashboard/validasiTulisV3a.js:248-249` dengan HTTP 400 "Aksi tidak dikenal."

Cara ditutup:
- File `lib/dashboard/validasiTulisV3a.js` ditambahkan ke daftar file WAJIB disentuh di F10 (bagian 4) dan
  ke daftar file model/handler server bagian 7a, dengan instruksi memperluas `validasiAksiAdmin`.
- AC baru di F3 dan F4: kedua aksi DITERIMA dispatcher; body invalid -> 400 pesan validator; body valid ->
  validator `ok:true` dan route melanjutkan.
- Test baru di `test/adminGudangJabatan.test.js` (bagian 12): panggil `validasiAksiAdmin`/`POST()` dengan
  body invalid -> 400; body valid -> lanjut (bukan 400 "Aksi tidak dikenal.").

### 20.2 Z2 [minor] - file model/handler server koleksi baru tidak didaftar

Masalah: PRD menyebut koleksi `gudang`/`permintaan_gudang`/`opname_gudang` dan guard, tetapi tidak
mendaftar file model/handler server yang harus dibuat.

Cara ditutup: bagian 7a baru mendaftar file model dan validator dengan NAMA SAMA PERSIS seperti
`docs/architecture-v5.md` bagian "Struktur modul & file":
`lib/models/gudang.js`, `lib/models/stokGudang.js`, `lib/models/permintaanGudang.js`,
`lib/models/opnameGudang.js`, `lib/dashboard/validasiGudangV5.js`,
`lib/dashboard/validasiPermintaanGudangV5.js`, `lib/dashboard/validasiOpnameGudangV5.js`,
`lib/dashboard/guardV5.js`, plus perubahan additive `lib/models/admins.js`, `lib/models/produk.js`,
`lib/models/stok.js`.

### 20.3 Z3 [minor] - F9 tidak punya unit test filter

Masalah: bagian 12 hanya punya e2e `e2e/gudang-v5.spec.ts`; logika filter `listStock` di
`real.ts`/`mock.ts` tidak dikunci unit test.

Cara ditutup: unit test baru `test/stockFilter.test.js` di bagian 12 mengunci setiap cabang: default online,
`is_online:"semua"`, `is_online:false`, filter gudang, kombinasi gudang + online,
`sertakan_tanpa_gudang:true`, admin tanpa gudang (`perlu_gudang:true`), admin bergudang nonaktif
(`gudang_nonaktif:true`), perhitungan `status`/`kekurangan`, dan nilai `qty_per_gudang` non-angka.

### 20.4 Z4 [minor] - nomor AC global tidak berurutan

Masalah: AC global #31 ditulis setelah #36 di bagian 14, sehingga urutan tidak monoton.

Cara ditutup: AC #31 dipindahkan ke posisi setelah #30, sebelum #32. Isi tidak berubah. Urutan nomor
kini monoton 1-36 tanpa lompatan.

### 20.5 Verifikasi revisi 4

1. Nama file model di PRD SAMA PERSIS dengan `docs/architecture-v5.md` bagian "Struktur modul & file".
2. `validasiTulisV3a` muncul di minimal: bagian 7a (file model/handler), F3/F4 AC (bagian 4), bagian 12 (test).
3. Nomor AC global bagian 14 berurutan tanpa lompatan.
4. Tidak ada perubahan kode sumber; hanya `docs/prd-v5.md` yang disunting.