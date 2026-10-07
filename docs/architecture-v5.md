# Arsitektur v5 - Dashboard Multi-Gudang, Permintaan Antar-Gudang, Opname ber-Approval, Is-Online

Status: architecture, revisi 2 (menutup SEMUA temuan `docs/architecture-v5-review.md`: 3 blocker B1/B2/B4, 7 major A1/A2/B3/C1/C2/D1/D2, 13 minor A3/A4/B5/B6/C3/C4/C5/C6/D3/D4/E1/E2/E3/E4).
Tanggal: 2026-09-16.
Sumber: `docs/prd-v5.md` (1262 baris, revisi 4, implementation-ready), `docs/architecture-v5-review.md`, `docs/discovery-v5.md`, `docs/research-dashboard-wms.md`, `docs/learnings.md`.
Keputusan terkunci yang DIPATUHI: D1a, D2a, D3a, D4a, D5c, Q1a+R2, Q2a, Q3a, Q4a, Q5a, R1, R3, R4, R5, V4b. TANPA Kledo/ERP/transit/approval berlapis.
Catatan: file versi sebelumnya RUSAK (tertimpa 1 baris). Dokumen ini ditulis ulang dari nol.
Konvensi: setiap klaim kode existing memakai `file:baris`. ASCII saja, tanpa em-dash.

---

## 1. Ringkasan arsitektur

Sistem adalah monolith Next.js (App Router) + Firestore + bot Telegram yang SUDAH ADA (`package.json:14-16`,
`vercel.json` `framework:"nextjs"`). v5 memperluas domain stok dari satu angka (`stock.stok_gudang_online`)
menjadi map `stock.qty_per_gudang[kode]`, lalu menambahkan domain permintaan antar-gudang, opname ber-approval,
master gudang, dan toggle is-online.

Prinsip arsitektur yang dipakai ulang (TIDAK ada abstraksi baru):
- **Satu pintu tulis.** Semua mutasi lewat route server `app/api/**/route.ts` + firebase-admin
  (`app/api/stok/mutasi/route.ts` pola). Klien TIDAK pernah menulis Firestore.
- **Satu kontrak data-access.** `DataSource` (`lib/dashboard/data/index.ts:65-115`) dengan dua implementasi
  `mock.ts`/`real.ts`. UI hanya tahu tipe di `lib/dashboard/types.ts`.
- **Guard dokumen best-effort server-only**, pola `stock_write_guard` (`app/api/stok/mutasi/route.ts:132-147`).
- **Audit di `stock_movements`**, gagal audit TIDAK rollback (`lib/models/stok.js:77-82` pola).

### 1.1 Lapisan

```
+-----------------------------------------------------------------------+
|  TELEGRAM MINI APP (Next.js client, "use client")                     |
|  app/page.tsx  app/stok/page.tsx  app/permintaan/page.tsx             |
|  app/gudang/page.tsx (BARU)  app/opname-gudang/page.tsx (BARU)        |
+----------------------------------+------------------------------------+
                                   | useData() -> DataSource
                                   v
+-----------------------------------------------------------------------+
|  DataSource (lib/dashboard/data/index.ts)                             |
|    real.ts  -> Firestore CLIENT SDK (READ saja) + fetch ke route tulis|
|    mock.ts  -> store in-memory (e2e)                                  |
|  types.ts: StockRow, GudangDoc, PermintaanGudangDoc, ... (BARU)       |
+------------------+--------------------------------+-------------------+
                   | READ (client SDK)              | WRITE (fetch POST)
                   v                                v
+--------------------------+   +----------------------------------------+
| FIRESTORE (client rules) |   | ROUTE SERVER (runtime=nodejs)          |
|  stock/products/gudang   |   |  /api/gudang          (BARU, F1)       |
|  permintaan_gudang       |   |  /api/stok/gudang     (BARU, F2)       |
|  opname_gudang           |   |  /api/permintaan-gudang (BARU, F5/F6)  |
|  admins                  |   |  /api/opname-gudang   (BARU, F7)       |
|  rules: write:false      |   |  /api/produk/online   (BARU, F8)       |
+--------------------------+   |  /api/admin           (EXISTING, F3/F4)|
                               +-----------------+----------------------+
                                                 | firebase-admin SDK
                                                 v
+-----------------------------------------------------------------------+
|  lib/models/*.js (CJS, require("../firebase"))                        |
|   gudang.js  stokGudang.js  permintaanGudang.js  opnameGudang.js      |
|   stok.js (diubah)  admins.js (diubah)  produk.js (diubah)            |
|   validasiTulisV3a.js (diperluas)  guardV5.js (BARU)                  |
+-----------------------------------------------------------------------+
```

### 1.2 Alur data kritis (permintaan antar-gudang multi-tujuan)

```
BUAT (status=menunggu, tiap tujuan.status=menunggu)
  dashboard -> POST /api/permintaan-gudang {aksi:"buat", dari_gudang_id, tujuan[], items[]}
            -> validasi -> guard -> model.buatPermintaan
            -> tulis permintaan_gudang + snapshot TujuanEntri (nama, jabatan, gudang_id_snapshot)
SETUJUI (menunggu -> disetujui)          [stok TIDAK berubah]
KIRIM   (disetujui -> dikirim)           [stok ASAL turun SEKALI, tiap tujuan.status=menunggu]
  transaksi: baca permintaan + N stock -> CAS status -> tulis stok asal turun + status dikirim
TERIMA tujuan[k] (dikirim -> dikirim|selesai)  [stok TUJUAN naik per tujuan]
  transaksi: baca permintaan + stock -> CAS status doc + tujuan[k].status=menunggu
             -> tulis stok tujuan naik + tujuan[k].status=diterima -> recompute status dokumen
TIDAK-TERIMA tujuan[k]  [stok ASAL naik kembali]
TUTUP-TUJUAN tujuan[k]  (owner) [saldo stok TIDAK berubah; stock_movements qty ASLI + gudang_id=dari_gudang_id]
RECOMPUTE status dokumen: ada tujuan menunggu -> dikirim; semua selesai -> selesai (+selesai_at)
```

### 1.3 Model stok (D2a + Q4a)

```
stock/{kode_barang}
  qty_per_gudang: { "ONLINE": 12, "G1": 4, "G2": 0 }   <-- sumber angka per gudang (D2a)
  stok_gudang_online: 12                                <-- ALIAS key "ONLINE" (Q4a), BUKAN total
  reorder_point, last_updated, last_updated_by, last_synced_at, last_synced_value
```

Parisitas (BR3): setiap tulis `stok_gudang_online` WAJIB menulis `qty_per_gudang["ONLINE"]` dengan nilai
sama, dan sebaliknya. Dokumen belum backfill dibaca lewat fallback `{ "ONLINE": stok_gudang_online }`.

---

## 2. Keputusan arsitektur (ADR ringkas)

### ADR-1 - D2a: `qty_per_gudang` map di `stock/{kode}` (bukan koleksi lain)
Status: diterima (keputusan user).
Konteks: stok per gudang harus bisa dibaca bersama produk & reorder point; jumlah gudang kecil (maks 50, R3).
Alternatif ditolak:
- (b) koleksi `stok_gudang/{kode}_{gudang}`: query agregasi lebih kuat, tapi join per baris di `listStock()`
  menjadi N+M read dan mengubah bentuk baris existing (`real.ts:164-187`). Biaya migrasi + risiko tanpa bukti.
- (c) subcollection `stock/{kode}/gudang/{id}`: menambah collection-group query yang tidak dibutuhkan dan
  menyulitkan paritas `stok_gudang_online` (BR3).
Alasan diterima: `research-dashboard-wms.md:41-43` menyatakan map "easy to set up and streamline" untuk list
sederhana & fixed; 50 key x ~25 byte = ~1.25 KiB jauh di bawah 1 MiB (`research-dashboard-wms.md:14`).
Tradeoff: hotspot kontensi pada dokumen `stock/{kode}` saat dua `terima` menulis gudang berbeda; SDK
`runTransaction` retry otomatis menyerapnya (dibahas AR1, bagian 10).

### ADR-2 - D3a: TANPA gudang transit
Status: diterima (keputusan user, D3a).
Konteks: perpindahan antar gudang harus dicegah double-count tanpa lokasi virtual.
Alternatif ditolak: status `in_transit` + lokasi virtual (pola "Add to Transit" ERPNext,
`research-dashboard-wms.md:138-150`) - menambah state, UI, dan rekonsiliasi yang tidak diminta.
Alasan diterima: `research-dashboard-wms.md:146-150` menyatakan transfer 1-step cukup untuk <10 gudang satu
pemilik; pola "kurangi saat kirim, tambah saat terima" mencegah double-count.
Tradeoff: risiko dokumen nyangkut `dikirim` (R10) - ditutup aksi `tutup-tujuan` owner-only + query index #1
(`listPermintaanGudang({status:"dikirim"})`).

### ADR-3 - R5: cross-gudang READ diizinkan, scope hanya filter + tulis
Status: diterima (keputusan user, R5).
Konteks: `stock/{kode}` punya `allow read: if authed()` (`firestore.rules:18`), jadi `qty_per_gudang` semua
gudang sudah terlihat semua staff. Menegakkan read-scope butuh rules `get()` + query constraint sama
("rules are not filters", `research-dashboard-wms.md:94`).
Alternatif ditolak:
- rules document-level scope via `get(admins/uid)`: menambah read billable + limit 10 call/request
  (`research-dashboard-wms.md:84-89`) tanpa manfaat karena keputusan user memang mengizinkan read.
- memindahkan stok per gudang ke route server berfilter: biaya besar, mengubah pola READ existing.
Alasan diterima: konsistensi rules existing + keputusan sadar user. Scope gudang ditegakkan HANYA (a) sebagai
DEFAULT FILTER di `listStock()` (`Q3a`) dan (b) untuk aksi TULIS (BR7).
Tradeoff: `qty_per_gudang` lintas gudang terlihat semua staff (termasuk guest) via `stock` - konsekuensi
diterima & didokumentasikan (`docs/prd-v5.md:735-739`, R16). Upgrade path: route server ber-scope (non-MVP).

### ADR-4 - R4+R1 (nama field waktu & aksi batal)
Status: diterima (keputusan user).
Konteks: R7 discovery meminta snake_case konsisten; `stock_movements` existing memakai `created_at`.
Alternatif ditolak: `dibuat_at`/`diubah_at` - tidak konsisten dengan `stock_movements:created_at` dan
memaksa mapping baru di `mapMovement` (`real.ts:205`).
Alasan diterima: satu bentuk waktu `created_at` (dan `updated_at` bila ada update). Aksi `batal` (R1)
ditambahkan karena satu-dokumen-banyak-tujuan tidak bisa diwakili `ditolak` (yang berarti approval gagal).

### ADR-5 - Q4a: `stok_gudang_online` = key `"ONLINE"`, bukan total lintas gudang
Status: diterima (keputusan user, Q4a; menggantikan wacana "agregat" di `discovery-v5.md:96-99`).
Konteks: helper lama (`lib/models/stok.js:19-103`) membaca/menulis `stok_gudang_online`; bot, reminder,
`syncStokDuaArah.js` bergantung padanya.
Alternatif ditolak:
- `stok_gudang_online` = SUM semua gudang: setiap tulis per gudang harus recompute sum, dan helper lama
  (`_ubahStokRelatif`, `stok.js:51-67`) yang menulis field tunggal akan merusak invariant. Bot tetap
  "mengurangi" angka yang bukan miliknya.
- hapus `stok_gudang_online`: mematahkan bot/reminder/sync.
Alasan diterima: menjadikannya ALIAS satu key membuat paritas BR3 dapat diuji mekanis, dan migrasi cukup
menyelaraskan dua nilai yang sudah ada (bagian 10 PRD langkah #2). **Wajib backfill 33 dokumen** `stock`
supaya `qty_per_gudang["ONLINE"]` ada; sebelum backfill, boundary baca pakai fallback.
Tradeoff: dua representasi nilai yang sama; pelanggaran paritas = bug kelas baru (R9) - dikunci test
`test/stokGudangQty.test.js` + `normalisasiQtyPerGudang`/`_bacaParitasOnline` sebagai satu-satunya jalur baca.

### ADR-6 - V4b: `tutup-tujuan` TIDAK mengubah saldo TETAPI mencatat qty ASLI di `gudang_id:<dari_gudang_id>`
Status: diterima (keputusan user V4b, `docs/prd-v5.md:1184-1201`).
Konteks: owner menutup tujuan nyangkut `menunggu`; barang dianggap hilang di luar sistem. Saldo stok TIDAK
boleh berubah (tidak ada barang yang berpindah maupun kembali), tetapi kehilangan harus dapat direkonsiliasi.
Alternatif ditolak:
- `qty: 0` di movement: hilangnya barang tidak terlihat di audit, tidak dapat direkonsiliasi.
- menambah kembali stok asal saat tutup: menciptakan stok dari barang yang sudah tidak ada (dilarang V3).
- `gudang_id: <gudang tujuan>`: **SALAH** (blocker B1 review lama). Yang perlu direkonsiliasi adalah stok
  ASAL yang sudah turun saat `kirim` dan tidak kembali. Rekonsiliasi "barang hilang" dihitung dari movement
  ber-`gudang_id` asal.
Alasan diterima: satu query `stock_movements where action_type == "tutup_tujuan"` + jumlahkan `qty` memberi
total barang hilang. `gudang_id = dari_gudang_id` konsisten di 4 tempat PRD (`docs/prd-v5.md:203, 250, 281,
1144`). Diterapkan KONSISTEN di seluruh dokumen ini (bagian 5.4, 7, 9, 10, 11).

### ADR-7 - Koleksi `permintaan_gudang` satu dokumen banyak tujuan dengan status PER-TUJUAN (R2)
Status: diterima (keputusan user R2, mengubah Q1a lama).
Konteks: satu permintaan bisa dikirim ke beberapa gudang/user; tiap penerima menerima/menolak sendiri.
Alternatif ditolak: satu dokumen per tujuan - stok asal harus dicatat turun per tujuan (sulit menjamin
"turun SEKALI"), dan UI kehilangan grouping permintaan.
Alasan diterima: "stok asal turun SEKALI saat `kirim`" dijamin oleh satu dokumen + satu transaksi; status
dokumen TURUNAN (BR5) tidak dapat diset manual sehingga tidak ada state drift.
Tradeoff: penulisan ulang seluruh array `tujuan[]` per transisi (CAS pada dokumen, bukan per elemen - D2).

---
## 3. Struktur modul & file

### 3.1 File BARU - model server (`lib/models/`, CJS `require("../firebase")`)
NAMA PERSIS dari `docs/prd-v5.md` bagian 7a.

| File | Tanggung jawab | Fungsi diekspor |
|---|---|---|
| `lib/models/gudang.js` | CRUD koleksi `gudang`, batas 50, duplikat nama, peringatan referensi | `listGudang({semua})`, `ambilGudang(id)`, `tambahGudang({nama,oleh})`, `editGudang({gudang_id,nama,oleh})`, `nonaktifkanGudang({gudang_id,oleh})`, `aktifkanGudang({gudang_id,oleh})` |
| `lib/models/stokGudang.js` | Helper murni + transaksi untuk `stock.qty_per_gudang` (F2) | `normalisasiQtyPerGudang(data)`, `bacaParitasOnline(data)`, `tambahQtyPerGudang(trx, ref, gudangId, delta)`, `kurangiQtyPerGudang(trx, ref, gudangId, delta)`, `setQtyPerGudangDalamTransaksi(...)` |
| `lib/models/permintaanGudang.js` | Seluruh transisi dokumen `permintaan_gudang` (F5, F6) | `buatPermintaan`, `ubahItemPermintaan`, `setujuiPermintaan`, `tolakPermintaan`, `batalPermintaan`, `kirimPermintaan`, `terimaPermintaan`, `tidakTerimaPermintaan`, `tutupTujuanPermintaan`, `_hitungStatusDokumen`, `_cariTujuan` |
| `lib/models/opnameGudang.js` | Dokumen `opname_gudang` + CAS nilai sistem (F7) | `buatOpname`, `setujuiOpname`, `tolakOpname`, `_cocokkanQtySistem` |

Catatan penempatan (menutup C2 - versi lama salah: `setQtyGudang` ditaruh di dua tempat):
- **SATU sumber kebenaran**: helper transaksi qty per gudang ada di `lib/models/stokGudang.js`.
- `setQtyGudang(kodeBarang, gudangId, qty, oleh)` diekspor dari **`lib/models/stok.js`** (bukan `stokGudang.js`)
  karena ia butuh `db`, `ambilStok`, dan `invalidasiCacheStok` yang dimiliki `stok.js` (`lib/models/stok.js:15-17`).
  Route `/api/stok/gudang` memanggil `stok.setQtyGudang`. `stokGudang.js` TIDAK mengimpor `db` dan TIDAK punya
  `setQtyGudang`. Daftar fungsi bagian 4.1 di bawah adalah daftar TUNGGAL, tidak ada duplikasi.

### 3.2 File BARU - validator & guard (CJS murni, pola `lib/dashboard/validasiTulisV3a.js`)
NAMA PERSIS dari `docs/prd-v5.md` bagian 7a.

| File | Tanggung jawab | Fungsi diekspor |
|---|---|---|
| `lib/dashboard/validasiGudangV5.js` | Validasi payload `/api/gudang` | `validasiAksiGudang`, `validasiGudangId`, `validasiNamaGudang` |
| `lib/dashboard/validasiPermintaanGudangV5.js` | Validasi payload `/api/permintaan-gudang` | `validasiAksiPermintaanGudang`, `validasiTujuan`, `validasiItems` |
| `lib/dashboard/validasiOpnameGudangV5.js` | Validasi payload `/api/opname-gudang` | `validasiAksiOpnameGudang`, `validasiItemsOpname` |
| `lib/dashboard/guardV5.js` | Guard dokumen generik TTL 10s (pola `stock_write_guard`) | `tulisGuardV5(namaKoleksi, uid, payload)`, `GUARD_V5` |

### 3.3 File BARU - route server (`app/api/**/route.ts`, `runtime="nodejs"`)
| File | Aksi | Level |
|---|---|---|
| `app/api/gudang/route.ts` | `tambah`/`edit`/`nonaktif`/`aktifkan` (F1) | owner |
| `app/api/stok/gudang/route.ts` | `set-qty` (F2) | admin |
| `app/api/permintaan-gudang/route.ts` | `buat`/`ubah-item`/`setujui`/`tolak`/`batal`/`kirim`/`terima`/`tidak-terima`/`tutup-tujuan` (F5, F6) | admin (`tutup-tujuan` owner) |
| `app/api/opname-gudang/route.ts` | `buat`/`setujui`/`tolak` (F7) | admin (`setujui`/`tolak` owner) |
| `app/api/produk/online/route.ts` | toggle `is_online_product` (F8) | admin |

Route baru = 5 file. Working tree punya 10 `route.ts` di `app/api/**`; total menjadi 15. TIDAK ada webhook baru.

### 3.4 File EXISTING yang DIUBAH
| File | Perubahan | Alasan |
|---|---|---|
| `lib/models/stok.js` | tambah `setQtyGudang`, `tambahStokGudang`, `kurangiStokGudang`, `normalisasiQtyPerGudang`, `_bacaParitasOnline`; ubah `_ubahStokRelatif` (51-67), `timpaStokOpname` (86-103), `buatStokAwal` (24-42) untuk tulis paritas | BR3, F2 |
| `lib/models/admins.js` | tambah `setGudangUser`, `setJabatan` | F3, F4 |
| `lib/models/produk.js` | tambah `setOnlineProduk` | F8 |
| `lib/models/adminRoleChanges.js` | tambah parameter opsional `catatan` pada `catatPerubahanRole` (menutup B3) | F3 AC audit |
| `lib/dashboard/validasiTulisV3a.js` | PERLUAS `validasiAksiAdmin` (baris 227-260) dengan cabang `set-gudang-user` + `set-jabatan` | Z1 |
| `lib/dashboard/data/index.ts` | ubah signature `listStock` (baris 68) + export `StockFilter` + 20 method baru | F10 |
| `lib/dashboard/types.ts` | `StockRow` + `qty_per_gudang`/`qty_gudang_terpilih`; `RoleChangeDoc` + `catatan`; tipe v5 baru | F10, B3 |
| `lib/dashboard/data/real.ts` | `rowsStok(opts)` + `getRingkasan` + semua method baru | F9, F10, B2 |
| `lib/dashboard/data/mock.ts` | `listStock(filter)` + semua method baru + aturan BR1/BR5/BR6 | paritas |
| `lib/dashboard/data/mock-data.ts` | seed store TERPISAH `store.gudang`, `store.permintaanGudang`, `store.opnameGudang` | R2 discovery |
| `lib/dashboard/data/mock-paritas.js` | guard mock aksi v5 | paritas guard |
| `lib/dashboard/sumber-data.tsx` | stub `tolak` untuk 20 method baru di `dataKosong()` (baris 196-235) | `satisfies DataSource` |
| `app/api/admin/route.ts` | 2 cabang dispatch baru (pola baris 95-112) | F3, F4 |
| `firestore.rules` | match `gudang`/`permintaan_gudang`/`opname_gudang` + 5 guard | bagian 8 PRD |
| `firestore.indexes.json` | +7 index | bagian 9 PRD |
| `test/indexFirestore.test.js` | tetap hijau; `FIELD_EQUALITY` diperluas bila `real.ts` berubah (T29) | regresi index |
| `scripts/verify-backfill.mjs` (BARU, di luar repo runtime) | verifikasi migrasi READ-ONLY | T4 |

Frontend page baru (`app/gudang/page.tsx`, `app/opname-gudang/page.tsx`, dsb.) mengikuti pola page existing
(`app/stok/page.tsx:74`), TIDAK lewat route server untuk READ.

---

## 4. Perubahan `lib/models/stok.js`

### 4.1 Fungsi baru
```
normalisasiQtyPerGudang(data) -> Record<string, number>
  // In: data dokumen stock mentah. Out: map qty per gudang, nilai non-angka dibuang.
  // Absen qty_per_gudang -> fallback { "ONLINE": data.stok_gudang_online ?? 0 }.
  // Ini SATU-SATUNYA fungsi pembentuk map dari bahan mentah (boundary baca, docs/learnings.md:5-7).

_bacaParitasOnline(data) -> number
  // = normalisasiQtyPerGudang(data)["ONLINE"] ?? 0   (menutup C3: relasi eksplisit, bukan dua fungsi paralel)

setQtyGudang(kodeBarang, gudangId, qty, oleh) -> { qty_per_gudang } | null
  // Transaksi. kode tidak ada -> null (route 404). Tulis qty_per_gudang[gudangId] + last_updated + last_updated_by.
  // Bila gudangId === "ONLINE": tulis juga stok_gudang_online = qty (BR3) DALAM TRANSAKSI YANG SAMA.
  // invalidasiCacheStok() setelah commit.

tambahStokGudang(trx, ref, gudangId, delta)   // helper transaksi murni, dipakai permintaanGudang.js
kurangiStokGudang(trx, ref, gudangId, delta)  // idem; TETAP menulis paritas bila gudangId === "ONLINE"
```

### 4.2 Fungsi lama yang diubah (paritas BR3)
- `buatStokAwal` (`lib/models/stok.js:24-42`): payload tambah `qty_per_gudang: { "ONLINE": stokAwal }`.
- `_ubahStokRelatif` (`lib/models/stok.js:51-67`): `trx.set` tambah `qty_per_gudang` dengan key `"ONLINE"`
  = `nilaiBaru`, merge. `stok_gudang_online` tetap ditulis (helper lama, `kurangiStok`/`tambahStok` tidak berubah).
- `timpaStokOpname` (`lib/models/stok.js:86-103`): idem, tulis `qty_per_gudang["ONLINE"]`.
- `tandaiTersinkron` (`lib/models/stok.js:107-117`): lihat 4.5 - hanya menulis `last_synced_at`/
  `last_synced_value`, TIDAK menyentuh stok maupun `qty_per_gudang`.

### 4.3 Helper TIDAK berubah
`ambilStok` (19-23), `kurangiStok` (44-46), `tambahStok` (48-50), `setReorderPoint` (152-176),
`cariStokDiBawahReorderPoint` (132-140), `ambilSemuaStokSebagaiMap` (144-147), `invalidasiCacheStok` (15-17)
- signature & perilaku TIDAK berubah.

### 4.4 Konsumen yang HARUS diubah vs AMAN
WAJIB diubah (karena kontrak tulis berubah atau butuh data paritas):
- `lib/dashboard/data/real.ts:164-187` `rowsStok()` - baca SEMUA produk + map qty (F9).
- `lib/dashboard/data/real.ts:228-255` `getRingkasan()` - lihat 4.6 (B2).
- `lib/dashboard/data/mock.ts:442-447` `listStock()` - filter + map.
- `lib/dashboard/data/mock.ts:420-425` `getRingkasan()` - paritas B2.

AMAN (tidak perlu diubah - hanya membaca, dan fallback menutup):
- `lib/reminder/cekReorderPoint.js:11,30,41` dan `lib/reminder/reminderHarian.js:14,39,44` - hanya MEMBACA
  `stok_gudang_online` via `ambilStok`/cache, TIDAK memanggil `_ubahStokRelatif` (menutup B5: review lama
  keliru memasukkan `lib/reminder/*` ke daftar "konsumen signature"). BR13: perilaku reorder TIDAK berubah.
- `lib/sheets/syncStokDuaArah.js` - lihat 4.5.
- `app/api/stok/mutasi/route.ts` - tetap lewat `tambahStok`/`kurangiStok`/`timpaStokOpname` (paritas otomatis).
- `app/api/admin/route.ts:233-276` `tambahProduk` - membuat `stock` baru tanpa `qty_per_gudang`; boundary
  baca fallback `{"ONLINE": stokAwal}` menutup. OPSIONAL: tambahkan `qty_per_gudang:{"ONLINE": stokAwal}`
  (tidak wajib; tidak mengubah perilaku).

### 4.5 Analisis `lib/sheets/syncStokDuaArah.js` (menutup B4 - klaim harus sesuai file nyata)
FAKTA setelah membaca file (600 baris):
- Import (baris 19): `const { ambilStok, tandaiTersinkron } = require("../models/stok");`. TIDAK ada
  `tambahStok`/`kurangiStok` di file ini. TIDAK ada `_ubahStokRelatif`.
- `tandaiTersinkron` dipanggil di `lib/sheets/syncStokDuaArah.js:481` (jalur `applyDraft` update) dan `:530`
  (jalur `applyDraftProdukBaru` insert baris).
- Tulis ke Google Sheets: `pushNilaiKeSheet` (`:506`, definisi `:558-566`) dan `tambahBarisBaru` (`:526`).
- Audit: `catatPergerakanStok` (`:488`, `:536`) dengan `qty = nilaiFinal - stokSebelum`. Karena
  `tandaiTersinkron` TIDAK mengubah stok, komentar `:484-486` benar (`stokSebelum = nilai firestore saat ini`).
- Import `tandaiTersinkron` di baris 19; tidak ada import `tambahStok`/`kurangiStok` di mana pun.

KONSEKUENSI (mengoreksi klaim palsu versi lama):
- Sync DUA ARAH **TIDAK menulis stok Firestore** pada kedua arahnya. Arah resolusi selalu
  Firestore -> Sheets (`:457-465`). Jadi klaim lama "sync menulis stok lewat `tambahStok`/`kurangiStok`
  SEBELUM `tandaiTersinkron`" adalah SALAH. Karena premis itu salah, risiko "sync menimpa map `qty_per_gudang`"
  TIDAK ADA.

RISIKO NYATA yang tetap harus ditangani:
- `tandaiTersinkron` (`lib/models/stok.js:107-117`) menulis `last_synced_at` dan `last_synced_value`
  dan TIDAK menyentuh `stok_gudang_online` maupun `qty_per_gudang`. Maka `tandaiTersinkron` TIDAK dapat
  membuat `stok_gudang_online` berbeda dari `qty_per_gudang["ONLINE"]`. **Ini menjawab pertanyaan review**:
  jawabannya TIDAK, karena `tandaiTersinkron` tidak menulis kedua field itu. Jadi TIDAK ada mitigasi khusus
  yang dibutuhkan untuk sync - TIDAK ada klaim mitigasi palsu.
- Yang benar-benar bisa terjadi: pada dokumen yang BELUM di-backfill, `tandaiTersinkron` mengisi
  `last_synced_value` padahal `qty_per_gudang["ONLINE"]` belum ada. Itu tidak merusak apa pun karena
  boundary baca memakai fallback `{"ONLINE": stok_gudang_online}` (`normalisasiQtyPerGudang`). Karena itu
  urutan migrasi bagian 10 PRD WAJIB dijalankan SEBELUM sync dipakai secara normal; bila belum, sistem
  tetap benar (fallback), hanya filter gudang belum lengkap sampai backfill.
- Mitigasi nyata (bukan palsu): (1) jalankan migrasi bagian 10 PRD sebelum mengandalkan `qty_per_gudang`
  untuk filter; (2) `normalisasiQtyPerGudang` sebagai satu-satunya boundary baca; (3) test paritas
  `test/stokGudangQty.test.js` mengunci `stok_gudang_online === qty_per_gudang["ONLINE"]` setelah setiap
  mutasi BR3. TIDAK ada perubahan pada `syncStokDuaArah.js` di v5.

### 4.6 `getRingkasan()` tetap hanya menghitung produk online (menutup B2 - SOLUSI KONKRET)
Kondisi sekarang (`lib/dashboard/data/real.ts:228-255`):
```
const rows = await rowsStok();            // baris 230
...
totalProdukOnline: rows.length,           // baris 249
itemMenipis: rows.filter(r => r.status === "menipis").length,
itemMinus:  rows.filter(r => r.status === "minus").length,
```
`rowsStok()` (baris 164-187) mengiterasi `semuaProdukOnline()` (`real.ts:143-162`, query
`where("is_online_product","==",true)`), jadi `rows.length` = jumlah produk ONLINE. Setelah v5,
`rowsStok()` harus membaca SEMUA produk (F9), sehingga `rows.length` akan berubah arti.

SOLUSI YANG DIPILIH (bukan "nanti dipisah"): `rowsStok` menerima parameter filter, dan `getRingkasan`
memanggilnya dengan filter online eksplisit.

```
// real.ts
async function rowsStok(opts: StockFilter = {}): Promise<StockRow[]>
//   getRingkasan WAJIB memanggil: rowsStok({ is_online: true })

async getRingkasan(): Promise<RingkasanData> {
  const rowsOnline = await rowsStok({ is_online: true });   // semua produk difetch, difilter is_online===true
  ...
  return {
    totalProdukOnline: rowsOnline.length,                    // arti TIDAK berubah (AC global #26)
    itemMenipis: rowsOnline.filter(r => r.status === "menipis").length,
    itemMinus:  rowsOnline.filter(r => r.status === "minus").length,
    ...
  };
}
```
KONTRAK `StockFilter` (didefinisikan di `lib/dashboard/data/index.ts`, BUKAN inline):
```
export interface StockFilter {
  gudang_id?: string | null;
  is_online?: boolean | "semua";        // default listStock() = true; getRingkasan() selalu true
  sertakan_tanpa_gudang?: boolean;
}
```
Aturan pemakaian:
- `listStock()` tanpa argumen -> `rowsStok({ is_online: true })` (setara perilaku lama, AC F10).
- `listStock({gudang_id:"G2"})` -> `rowsStok({ gudang_id: "G2", is_online: true })` (read lintas gudang, R5).
- `getRingkasan()` -> `rowsStok({ is_online: true })`; TIDAK membaca filter gudang, TIDAK membaca argumen user.
- `is_online === "semua"` -> `rowsStok` tidak memfilter `is_online_product`.

KUNCI TEST (menutup C5 - gate Wave 3 lama tidak mengunci `getRingkasan`):
`test/indexFirestoreV5.test.js` menambah assert:
`getRingkasan()` -> `totalProdukOnline === fixture.filter(p => p.is_online_product).length`
dan `totalProdukOnline !== fixture.length` bila fixture memuat produk non-online.
`e2e/ringkasan.spec.ts` dijalankan lebih dulu (gate bagian 12 langkah 1) dan hasil `toHaveCount(10)` tidak
berubah karena seed v5 TIDAK masuk koleksi bersama (`store.produk`/`store.stock`).

---
## 5. Alur transaksi & CAS

Batas Firestore: **500 operasi dokumen per transaksi** (batas 500 write/detik adalah angka berbeda). Perhitungan
EKSPLISIT (menutup D1):
- `terima` 200 item: 1 `trx.get(permintaan)` + 200 `trx.get(stock)` + 200 `trx.set(stock)` +
  1 `trx.set(permintaan)` = **402 operasi < 500**. AMAN.
- `setujui` opname 200 item: 1 `trx.get(opname)` + 200 `trx.get(stock)` + 200 `trx.set(stock)` +
  1 `trx.set(opname)` = **402 operasi < 500**. AMAN.
- `kirim` 200 item: 1 `trx.get(permintaan)` + 200 `trx.get(stock)` + 200 `trx.set(stock)` +
  1 `trx.set(permintaan)` = **402 < 500**. AMAN.
KONSEKUENSI: BR16 (`items <= 200`) dan `tujuan <= 20` WAJIB dipertahankan; bila dinaikkan, transaksi HARUS
dipecah `db.batch()` (non-MVP, bagian 10 risiko).

SEMANTIK CAS (menutup D2): `tujuan[]` adalah ARRAY DI DALAM SATU DOKUMEN `permintaan_gudang`. CAS
sesungguhnya = **optimistik pada seluruh dokumen** (versi dokumen pada `trx.get`), bukan per-elemen array.
Karena transaksi menulis ulang SELURUH array `tujuan`, semua elemen ikut terversi. `runTransaction`
firebase-admin me-retry otomatis (ABORT -> ulang dengan versi baru). Test model
`test/casModelFirestore.test.js` (bagian 9) mensimulasikan semantik dokumen-level yang benar, bukan
per-elemen.

### 5.1 `buat`
1. Validasi: `dari_gudang_id` ada & aktif; `tujuan` 1..20, tipe valid, tidak ada duplikat `tipe:id`,
   tidak ada tujuan resolve ke `dari_gudang_id`; `items` 1..200; tiap `kode_barang` ADA di `stock`
   (menutup A2). Gagal -> 400/404 dengan pesan PRD.
2. Guard `permintaan_gudang_guard/{uid}`.
3. Baca `gudang` + `admins` untuk snapshot (`nama`, `jabatan`, `gudang_id_snapshot`).
   Untuk `tipe:"user"`: `gudang_id_snapshot = admins[id].gudang_id ?? null`.
4. `add()` dokumen `status:"menunggu"`, tiap `tujuan[i].status="menunggu"`, `created_at`, `created_by`,
   `tujuan_ids` = `["gudang:G1","user:900002"]`, `riwayat_status:[{status:"menunggu",oleh,at}]`.
5. Bukan transaksi (tak menyentuh stok). Race dua `buat` bersamaan = dua dokumen sah.

### 5.2 `setujui` / `tolak`
1. Guard. 2. Baca dokumen. 3. `status === "menunggu"` -> bila tidak 409 (`"Permintaan sudah diproses."`).
4. `db.runTransaction`: `trx.set(permintaanRef, {status:"disetujui", disetujui_oleh, disetujui_at,
   riwayat_status: [...riwayat, {...}]}, {merge:false})` (atau `ditolak`). TIDAK menyentuh `stock`.

### 5.3 `kirim`
1. Guard. 2. `ambilAdmin(uid)` -> role + `gudang_id`.
3. `runTransaction`:
   - `trx.get(permintaanRef)` -> CAS dokumen.
   - Cek `status === "disetujui"` -> bila tidak 409 (`"Permintaan sudah dikirim."` /
     `"Permintaan belum disetujui."`).
   - `trx.get(stockRef)` untuk tiap kode item (sekaligus untuk cek stok cukup).
   - Hitung `totalQty` = sum `items[i].qty`.
   - `normalisasiQtyPerGudang` -> `sekarang = map[dari_gudang_id] ?? 0`.
   - `sekarang < totalQty` -> throw `STOK_TIDAK_CUKUP` (route -> 409 `"Stok gudang asal tidak cukup."`),
     TIDAK menulis apa pun (BR1).
   - `trx.set(stockRef, { qty_per_gudang: {...map, [dari]: sekarang - totalQty}, stok_gudang_online:
     dari === "ONLINE" ? sekarang - totalQty : map.stok_gudang_online, last_updated, last_updated_by }, {merge:true})`
     untuk tiap item. Bila `dari === "ONLINE"`, paritas BR3 ditulis (BR14).
   - Tulis ulang `tujuan[]` dengan tiap entri `status:"menunggu"` (reset, jaga idempotensi).
   - `status:"dikirim"`, `dikirim_oleh`, `dikirim_at`, push `riwayat_status`.
   - TIDAK menambah gudang tujuan (AC F5.3: stok tujuan sebelum == sesudah).
4. Setelah commit: `catatPergerakanStok` per item (`type:"koreksi_manual"`, `action_type:"mutasi_gudang"`,
   arah keluar, `gudang_id: dari_gudang_id`). Gagal -> `peringatan_audit:true`, TIDAK rollback (BR10).

### 5.4 `terima` / `tidak-terima` / `tutup-tujuan`
Kasus `terima` tujuan ke-k:
1. Guard (kategori A, best-effort). 2. Baca dokumen. 3. Cek `status === "dikirim"` -> bila tidak 409 sesuai
tabel F5.2 (`"Permintaan belum dikirim."` / `"Permintaan sudah selesai."`).
4. `runTransaction`:
   - `trx.get(permintaanRef)` -> CAS dokumen + `_cariTujuan(tujuan, k)`.
   - Cek `tujuan[k].status === "menunggu"`. Bila bukan -> throw dengan pesan spesifik
     (`"Tujuan ini sudah diterima."` / `"Tujuan ini sudah tidak diterima."` /
     `"Tujuan ini sudah ditutup."`), TIDAK menulis.
   - Tentukan gudang tujuan dari `tujuan[k].gudang_id_snapshot` (T10). Matriks V11:
     - `tipe:"gudang"` & gudang aktif -> gudang tujuan = `gudang_id_snapshot`.
     - `tipe:"gudang"` & gudang nonaktif/tidak ada -> throw `GUDANG_TUJUAN_NONAKTIF` -> 409
       `"Gudang tujuan nonaktif."`.
     - `tipe:"user"` & snapshot terisi & gudang ada -> gudang tujuan = snapshot.
     - `tipe:"user"` & snapshot `null` -> TIDAK menambah stok mana pun; entri tetap selesai (`diterima`).
     - `tipe:"user"` & snapshot menunjuk gudang yang TIDAK ADA -> throw `GUDANG_TUJUAN_TIDAK_ADA` -> 409
       `"Gudang tujuan tidak ditemukan."` (owner menutup dengan `tutup-tujuan`).
   - `trx.get(stockRef)` untuk tiap kode item; hitung `totalQty` tujuan itu.
   - `trx.set(stockRef, { qty_per_gudang: {...map, [tujuan]: qty + totalQty}, stok_gudang_online:
     tujuan === "ONLINE" ? qty + totalQty : map.stok_gudang_online, ... }, {merge:true})`.
   - Tulis ulang `tujuan[k]` = `{...entri, status:"diterima", diterima_at, diterima_oleh}`.
   - `status = _hitungStatusDokumen(tujuanBaru)` -> `dikirim` bila ada `menunggu`, `selesai` bila semua
     selesai (BR5). Bila transisi -> `selesai` PERTAMA KALI -> `selesai_at` diisi (TEPAT sekali).
   - push `riwayat_status`.
5. Setelah commit: `catatPergerakanStok` masuk (gudang tujuan) per item + `peringatan_audit` bila gagal.

`tidak-terima` tujuan ke-k: sama seperti `terima` kecuali:
- Gudang yang disentuh = `dari_gudang_id` (stok asal NAIK kembali, R2).
- `tujuan[k].status="tidak_terima"`, `tidak_terima_at`, `tidak_terima_oleh`.
- `stock_movements` `action_type:"pengembalian_gudang"` (arah masuk ke asal).
- Valid HANYA bila entri masih `menunggu` (V3). Pada entri `ditutup` -> 409 `"Tujuan ini sudah ditutup."`,
  saldo asal TIDAK berubah (assert sebelum == sesudah).
- Gudang tujuan nonaktif TIDAK menghalangi `tidak-terima` (kembali ke asal, gudang tujuan tidak dipakai).

`tutup-tujuan` tujuan ke-k (OWNER ONLY):
1. Guard. 2. Cek role owner -> bukan -> 403. 3. `catatan_alasan` 1-200 char; kosong -> 400
   `"Alasan wajib diisi."` (validasi sebelum transaksi).
4. Baca dokumen; cek `status === "dikirim"`; bila tidak -> 409 sesuai tabel F5.2.
5. `runTransaction`:
   - `trx.get(permintaanRef)` -> CAS.
   - Cek `tujuan[k].status === "menunggu"` -> bila bukan -> 409 pesan spesifik (V1/V3).
   - **TIDAK menyentuh `stockRef` sama sekali** (saldo TIDAK berubah, V4b). 200 item -> operasi transaksi
     = 1 get + 1 set = 2 (< 500 jauh).
   - Tulis ulang `tujuan[k]` = `{...entri, status:"ditutup", ditutup_at, ditutup_oleh, catatan_alasan}`.
   - `status = _hitungStatusDokumen(tujuanBaru)`; `ditutup` dihitung sebagai selesai (V2). `selesai_at`
     diisi tepat sekali.
   - push `riwayat_status`.
6. Setelah commit: `catatPergerakanStok` dengan **`type:"koreksi_manual"`, `action_type:"tutup_tujuan"`,
   `gudang_id: dari_gudang_id` (GUDANG ASAL - B1)**, `qty` = total qty ASLI barang tujuan ke-k (BUKAN 0),
   `catatan_alasan`, `created_by: uid`. Gagal -> `peringatan_audit:true` (BR10).
   Respons memuat `qty_hilang` = qty ASLI tujuan itu.

**PENEGASAN B1 (blocker review lama):** di SEMUA tempat dokumen ini, `tutup_tujuan` memakai
`gudang_id: dari_gudang_id` (gudang ASAL), BUKAN gudang tujuan. Alasan: stok asal sudah turun saat
`kirim` dan tidak kembali; rekonsiliasi "barang hilang" = `stock_movements where action_type ==
"tutup_tujuan"` dijumlahkan `qty` per gudang asal. Memakai gudang tujuan membuat audit nyangkut salah gudang.

### 5.5 `set-qty` (F2)
1. Guard `stok_gudang_guard`. 2. `ambilAdmin(uid)` -> `gudang_id`. 3. Cek gudang target: bila
`role === "admin"` DAN `gudang_id` terisi DAN `gudang_id !== target` -> 403 (BR7 write-scope); owner bebas.
4. `ambilGudang(target)` -> ada & aktif, kalau tidak 400 `"Gudang tidak dikenal."`.
5. `stok.setQtyGudang(kode, target, qty, uid)` -> transaksi: 1 `trx.get(stock)` + 1 `trx.set(stock)`;
   bila `target === "ONLINE"` tulis juga `stok_gudang_online` (BR3).
6. Setelah commit: `catatPergerakanStok` `{type:"koreksi_manual", action_type:"set_qty_gudang",
   gudang_id: target}`; gagal -> `peringatan_audit:true`.
7. Respons memuat `qty_per_gudang` utuh dari baca ulang.

### 5.6 `setujui` opname (F7 + CAS T9)
1. Guard `opname_gudang_guard`. 2. Role owner (admin -> 403). 3. `status === "menunggu_approval"` -> bila
tidak 409 `"Opname sudah diproses."`.
4. `runTransaction`:
   - `trx.get(opnameRef)` -> CAS.
   - Langkah 1 (CAS nilai sistem): untuk setiap item, bandingkan `item.qty_sistem` tersimpan vs
     `normalisasiQtyPerGudang(stockData)[gudang_id] ?? null` saat ini. Satu saja beda -> throw
     `STOK_BERUBAH` -> 409 `"Stok berubah sejak opname dibuat. Buat ulang."`, TIDAK menulis apa pun.
   - Langkah 2: `trx.set(stockRef, { qty_per_gudang: {...map, [gudang_id]: item.qty_fisik},
     stok_gudang_online: gudang_id === "ONLINE" ? item.qty_fisik : map.stok_gudang_online }, {merge:true})`
     per item; `trx.set(opnameRef, {status:"disetujui", disetujui_oleh, disetujui_at, riwayat_status}, ...)`.
5. Setelah commit: `catatPergerakanStok` per item `{type:"opname", qty_sistem, qty_fisik, selisih,
   gudang_id}`.

AC `buat` opname (F7): hitung `qty_sistem = map[gudang_id] ?? null`, `selisih = qty_fisik - qty_sistem`
(bila `qty_sistem === null` -> `selisih = 0`, `belum_terdaftar:true`, TIDAK memicu approval, T14).
Selisih 0 semua -> langsung `disetujui` + tulis qty (hanya item `belum_terdaftar:false`); ada selisih != 0 ->
`menunggu_approval` + qty TIDAK berubah.

### 5.7 Recompute status dokumen (`_hitungStatusDokumen`)
```
function _hitungStatusDokumen(tujuan):
  if tujuan.some(t => t.status === "menunggu") return "dikirim"
  return "selesai"   // semua diterima/tidak_terima/ditutup
```
`ditutup` dihitung sebagai selesai (V2). `selesai_at` diisi HANYA saat transisi pertama ke `selesai`;
setelahnya 409 karena status bukan `dikirim` lagi.

---

## 6. Guard & idempotensi

Pola: dokumen server-only `{nama}_guard/{uid}`, tulis `{merge:false}`, bandingkan SELURUH field payload
+ TTL 10 detik (pola `app/api/stok/mutasi/route.ts:132-147`). `tulisGuardV5(namaKoleksi, uid, payload)`:
1. `get` dokumen. 2. Bila ada & `Date.now() - at <= 10_000` & seluruh field payload cocok -> `{duplikat:true}`.
3. `set(payload + {at: Date.now()}, {merge:false})`. 4. Gagal guard (error I/O) -> TIDAK memblokir (best-effort),
log `[guard_v5_failed]`.

`{merge:false}` menimpa seluruh dokumen -> field aksi lama hilang (disengaja, menutup E1). Karena itu
payload WAJIB memuat SEMUA field pembanding yang disebut tabel di bawah; implementasi membandingkan KEY
YANG SAMA dengan tabel, bukan subset.

| Guard | Dibuat | Payload pembanding | TTL | Dipakai |
|---|---|---|---|---|
| `permintaan_gudang_guard/{uid}` | BARU | `kunci` (hash payload), `at` | 10s | `buat`/`ubah-item`/`setujui`/`tolak`/`batal`/`kirim`/`terima`/`tidak-terima`/`tutup-tujuan` |
| `opname_gudang_guard/{uid}` | BARU | `opname_id`, `aksi`, `at` | 10s | `buat`/`setujui`/`tolak` |
| `gudang_guard/{uid}` | BARU | `aksi`, `nama`, `at` | 10s | `tambah`/`edit`/`nonaktif`/`aktifkan` |
| `stok_gudang_guard/{uid}` | BARU | `kode_barang`, `gudang_id`, `qty`, `at` | 10s | `set-qty` |
| `produk_online_guard/{uid}` | BARU | `kode_barang`, `nilai`, `at` | 10s | toggle is-online |
| `stock_write_guard/{uid}` | EXISTING | `kode_barang`, `mode`, `qty`, `at` | 10s | mutasi lama (tidak diubah) |

Semua guard baru: `match /{nama}_guard/{id} { allow read, write: if false; }` (pola `firestore.rules:34-36`).
Kategori B (TIDAK butuh guard, alami idempoten - BR11): `set-jabatan`, `set-gudang-user` (last-write-wins,
bukan aksi stok). `batal` dan `tutup-tujuan` TETAP kategori A (bukan idempoten: `batal` dari `dikirim` harus
409; `tutup-tujuan` mengubah status ENTRI) dengan pengaman utama CAS di transaksi.

Pengaman utama double-apply SEMUA aksi kategori A = CAS dokumen di `runTransaction`, guard hanya lapisan
pertama. Guard gagal -> tidak memblokir (paritas `app/api/stok/mutasi/route.ts:144-147`).

---

## 7. Error handling & fail-closed

- **Fail-closed role.** Role SELALU dibaca ulang dari `admins/{uid}` di server, tidak dari sesi/cookie/body
  (pola `app/api/stok/mutasi/route.ts:87-103`, `app/api/admin/route.ts:81-93`). Admin tidak ditemukan -> 403.
- **Fail-closed scope tulis.** Aksi tulis yang menyentuh data per gudang membandingkan `gudang_id` dari
  `admins/{uid}` vs target body (BR7). Beda -> 403. Body TIDAK dipercaya.
- **Read lintas-scope (E2).** READ lintas gudang sengaja diizinkan (R5). Route TULIS yang mengembalikan
  `qty_per_gudang` gudang yang berubah juga membaca lintas-scope, tetapi ini konsisten R5. Dicatat sebagai
  keputusan sadar (bukan bug): respons `kirim`/`terima` memuat `qty_per_gudang` gudang asal/tujuan.
- **Audit tidak rollback (BR10).** `catatPergerakanStok` dibungkus try/catch; gagal -> `peringatan_audit:true`,
  stok tetap berubah (pola `app/api/stok/mutasi/route.ts:167-194`).
- **403 sebelum validasi body (T18).** Urutan guard BARU: `tolakOrigin` -> sesi cookie -> `cekRateLimit` ->
  role dari `admins` -> validasi body. Guest -> 403 walau body invalid (pesan validasi tidak bocor).
  Urutan ini SENGAJA berbeda dari route existing (`app/api/stok/mutasi/route.ts:67-103` validasi dulu) dan
  dikunci `test/urutanGuardV5.test.js` termasuk kasus admin + rate limit terlampaui -> 429 SEBELUM role
  (menutup E4).
- **CAS conflict -> 409.** Throw spesifik di transaksi dipetakan route ke 409 dengan pesan PERSIS PRD.
- **Guard gagal -> lanjut.** Error I/O guard tidak memblokir tulis (best-effort).
- **Index hilang -> route 500/UI "Coba lagi".** Tidak terlihat gate; ditutup `test/indexFirestoreV5.test.js`.
- **Log.** `[gudang_v5_reject]` / `[gudang_v5_success]` + `[guard_v5_failed]`, isi `{uid, aksi, alasan}`
  tanpa payload penuh (bagian 11 PRD).
- **Gudang nonaktif (BR9).** Tidak dihapus keras; referensi lama tetap valid. Admin bergudang nonaktif ->
  `listStock()` 0 baris + flag `gudang_nonaktif:true` + pesan `"Gudang kerja Anda dinonaktifkan. Hubungi owner."`.
- **Admin `gudang_id:null` (R11).** `listStock()` tidak difilter + flag `perlu_gudang:true`; `buat` permintaan
  -> 403 `"Akun Anda belum punya gudang."`.
- **`scripts/verify-backfill.mjs` READ-ONLY (A4/D4/E3).** Script HANYA `get`: TIDAK ada `set`/`update`/
  `delete` sama sekali (invariant didokumentasikan sebagai komentar header file + grep saat PR). Exit 1 bila
  `qty_per_gudang.ONLINE != stok_gudang_online` atau key `ONLINE` tidak ada pada dokumen mana pun; exit 0 bila
  keduanya 0. TIDAK menyentuh koleksi lain.

---
## 8. Strategi DataSource (F10)

Urutan implementasi (WAJIB - `satisfies DataSource` menagih method lengkap di setiap langkah):
1. `lib/dashboard/types.ts` - definisi SEMUA tipe baru (TIDAK inline di `index.ts`).
2. `lib/dashboard/data/index.ts` - tambah method baru ke `interface DataSource` + export `StockFilter`;
   ubah signature `listStock` (baris 68) menjadi `listStock(filter?: StockFilter)` (argumen OPSIONAL ->
   pemanggil lama tetap kompilasi).
3. `lib/dashboard/data/real.ts` - `rowsStok(opts)`, `getRingkasan` (B2), semua method baru.
4. `lib/dashboard/data/mock.ts` - aturan bisnis SAMA (BR1/BR5/BR6) supaya e2e menguji alur.
5. `lib/dashboard/sumber-data.tsx` - stub `tolak` di `dataKosong()` (baris 196-235) untuk SEMUA method baru.
6. `lib/dashboard/data/mock-data.ts` - seed di store TERPISAH: `store.gudang`, `store.permintaanGudang`,
   `store.opnameGudang` (TIDAK ke `store.movements`/`store.stock` bersama - R2 discovery).
7. `lib/dashboard/data/mock-paritas.js` - guard mock untuk aksi v5.
8. Test paritas `test/mockParitas.test.js` (perluas) - shape identik mock vs real.

### 8.1 Daftar method DataSource baru (KONTRAK BEKU - HARUS SAMA dengan `docs/prd-v5.md:977`)
Dua puluh method (nama PERSIS):
```
listGudang, listPermintaanGudang, listOpnameGudang, listUserTujuan,
buatPermintaanGudang, setujuiPermintaanGudang, tolakPermintaanGudang,
batalPermintaanGudang, kirimPermintaanGudang, terimaPermintaanGudang,
tidakTerimaPermintaanGudang, tutupTujuanPermintaan, ubahItemPermintaan,
buatOpnameGudang, setujuiOpnameGudang, tolakOpnameGudang,
toggleOnline, setQtyGudang, setGudangUser, setJabatan
```
(mengisi A1 - review lama mencatat daftar ini tidak dienumerasi; sekarang disalin eksplisit).
Termasuk `listUserTujuan` (F6 "Kirim ke: User" + index #7), `toggleOnline`, `batalPermintaanGudang`,
`tolakPermintaanGudang`, `ubahItemPermintaan`, `setGudangUser`, `setJabatan`.
`listUserTujuan()` memakai index #7 `admins.gudang_id ASC, name ASC` (bagian 9).

### 8.2 Tipe baru `lib/dashboard/types.ts`
- `StockRow` + `qty_per_gudang: Record<string, number>` + `qty_gudang_terpilih: number | null`.
- `RoleChangeDoc` + `catatan?: string | null` (menutup B3).
- `GudangDoc`, `TujuanEntri`, `PermintaanGudangDoc`, `OpnameGudangDoc`, `UserTujuanDoc`.
- Request/Response v5 (pola `types.ts:287-523`): `TambahGudangRequest`, `SetQtyGudangRequest`,
  `BuatPermintaanRequest`, `KirimPermintaanRequest`, `TerimaTujuanRequest`, `TutupTujuanRequest`,
  `BuatOpnameRequest`, `SetujuiOpnameRequest`, `ToggleOnlineRequest`, `SetGudangUserRequest`,
  `SetJabatanRequest` + pasangan Response `{ok:true,...} | {ok:false,error}`.

### 8.3 Urutan file & dependensi model
`produk.js` (`setOnlineProduk`, memakai `invalidasiCacheProduk` existing, `lib/models/produk.js:52-57`) -
TIDAK ada dependency baru (menutup C4). Urutan file dalam Wave 3 tetap: `types.ts` -> `index.ts` ->
`real.ts` -> `mock.ts` -> `sumber-data.tsx` -> `mock-data.ts` -> `mock-paritas.js`.

---

## 9. Urutan implementasi (6 wave)

Gate per wave: `npm test` 0 fail + `npx tsc --noEmit` exit 0 (bila menyentuh TS) + test baru wave hijau.

### Wave 1 - Fondasi model stok & paritas (B2/B4 tertutup di sini)
Files: `lib/models/stok.js`, `lib/models/stokGudang.js` (baru), `test/stokGudangQty.test.js`.
Isi: `qty_per_gudang` paritas BR3 di `buatStokAwal`/`_ubahStokRelatif`/`timpaStokOpname`; helper
`normalisasiQtyPerGudang`/`_bacaParitasOnline`; `setQtyGudang`. **B4**: TIDAK ada perubahan di
`syncStokDuaArah.js`; test memverifikasi `tandaiTersinkron` TIDAK mengubah `stok_gudang_online` maupun
`qty_per_gudang` (kontrak 4.5).
Hijau: `test/stokGudangQty.test.js`, `test/indexFirestore.test.js` existing, `npm test`.
Dependency: tidak ada.

### Wave 2 - Master gudang + admin/jabatan + validator dispatcher
Files: `lib/models/gudang.js` (baru), `lib/models/admins.js`, `lib/models/adminRoleChanges.js` (B3),
`lib/dashboard/validasiGudangV5.js` (baru), `lib/dashboard/validasiTulisV3a.js` (Z1),
`lib/dashboard/guardV5.js` (baru), `app/api/gudang/route.ts`, `app/api/admin/route.ts`,
`test/gudangMaster.test.js`, `test/adminGudangJabatan.test.js`, `test/guardV5.test.js`.
Hijau: master gudang CRUD + batas 50 + duplikat; `set-gudang-user`/`set-jabatan` DITERIMA dispatcher;
audit `catatan`; guard kategori A/B.
Dependency: Wave 1.

### Wave 3 - DataSource migration (pemilik awal `test/indexFirestoreV5.test.js` - C6)
Files: `lib/dashboard/types.ts`, `lib/dashboard/data/index.ts`, `real.ts`, `mock.ts`,
`sumber-data.tsx`, `mock-data.ts`, `mock-paritas.js`, `test/stockFilter.test.js`,
`test/indexFirestoreV5.test.js` (buat + kunci `getRingkasan` - C5), `test/mockParitas.test.js`.
**Titik keputusan ukuran `mock.ts` (B6):** ukur ULANG di akhir Wave 3 (mock.ts existing 1165 baris).
Bila melewati **1800 baris**, pecah store/aturan v5 ke modul terpisah (`mock-v5.ts`) SEBELUM Wave 4.
Hijau: `stockFilter.test.js` semua cabang; `getRingkasan().totalProdukOnline === count(is_online)` (C5);
e2e COUNT lama dijalankan dulu.
Dependency: Wave 1, Wave 2.

### Wave 4 - Permintaan + opname (model + route)
Files: `lib/models/permintaanGudang.js`, `lib/models/opnameGudang.js`,
`lib/dashboard/validasiPermintaanGudangV5.js`, `lib/dashboard/validasiOpnameGudangV5.js`,
`app/api/permintaan-gudang/route.ts`, `app/api/opname-gudang/route.ts`, `app/api/stok/gudang/route.ts`,
`test/permintaanGudang.test.js`, `test/opnameGudang.test.js`, `test/casModelFirestore.test.js` +
`test/helpers/mockFirestore.js`, `test/urutanGuardV5.test.js`.
Hijau: seluruh tabel transisi F5.2 (V1), recompute kombinasi (V2/V32), V3/V5/V10/V11, CAS 3 skenario V7.
Dependency: Wave 3 (model pakai `stokGudang.js` + guard).

### Wave 5 - Is-online + UI + e2e
Files: `lib/models/produk.js` (`setOnlineProduk`), `app/api/produk/online/route.ts`,
`test/produkOnline.test.js`, page baru `app/gudang/page.tsx`, `app/opname-gudang/page.tsx`,
`e2e/gudang-v5.spec.ts`, `e2e/permintaan-gudang.spec.ts`, `e2e/opname-gudang.spec.ts`.
`test/indexFirestoreV5.test.js` ditambah blok TERPISAH (pemilik file = Wave 3; Wave 5 menambah, urutan
SERI untuk file test bersama - menutup C6).
Hijau: toggle + invalidasi cache; e2e alur penuh termasuk `batal` (V14) dan `tutup-tujuan`.
Dependency: Wave 3, Wave 4.

### Wave 6 - Rules + index + migrasi + verifikasi
Files: `firestore.rules`, `firestore.indexes.json`, `scripts/verify-backfill.mjs`.
Hijau: `test/indexFirestoreV5.test.js` (7 index), `test/indexFirestore.test.js` existing,
`node scripts/verify-backfill.mjs` exit 0 (setelah migrasi manual), `firebase firestore:indexes
--project bot-admin-toko-a0c47` mencocokkan.
Dependency: semua wave sebelumnya (index harus cocok dengan query nyata di `real.ts`).

---

## 10. Risiko arsitektural (teknis)

| # | Risiko teknis | Mitigasi |
|---|---|---|
| AR1 | Hotspot kontensi dokumen `stock/{kode}`: dua `terima`/`set-qty` menulis dokumen sama, gudang berbeda -> salah satu retry (ABORT), menambah latency (D3) | `runTransaction` firebase-admin retry otomatis; operasi massal di luar jam sibuk; batas `items<=200` membatasi durasi transaksi. Tidak ada mitigasi kontensi tambahan (skala kecil) |
| AR2 | Batas 500 operasi/transaksi terlampaui bila `items` dinaikkan | Perhitungan eksplisit bagian 5: maks 402 < 500. BR16 `items<=200` WAJIB; bila dinaikkan -> pecah `db.batch()` |
| AR3 | Paritas `stok_gudang_online` <-> `qty_per_gudang["ONLINE"]` bocor (R9) | `normalisasiQtyPerGudang`/`_bacaParitasOnline` satu jalur; semua writer menulis keduanya dalam transaksi sama; test paritas |
| AR4 | `tandaiTersinkron` menulis `last_synced_value` pada dokumen belum backfill (B4) | Bukan race stok (tidak menulis stok/qty_per_gudang); boundary baca fallback `{"ONLINE": stok_gudang_online}`; migrasi bagian 10 PRD dijalankan sebelum filter gudang diandalkan |
| AR5 | Composite index hilang -> query gagal di produksi padahal gate hijau (`docs/learnings.md:35`) | `test/indexFirestoreV5.test.js` + verifikasi `firebase firestore:indexes` |
| AR6 | `_hitungStatusDokumen` tidak dipanggil saat transisi -> status drift | Recompute WAJIB di transaksi yang sama (BR5); test kombinasi V2 |
| AR7 | Seed v5 merusak e2e COUNT | Store mock TERPISAH; e2e `histori`/`ringkasan`/`stok` dijalankan lebih dulu |
| AR8 | `listStock()` payload > 500 KiB pada 1107 produk | AC terukur `JSON.stringify(rows).length < 500 KiB` di test; bila >= -> paginasi WAJIB sebelum rilis |
| AR9 | Transaksi menulis ulang seluruh array `tujuan[]` -> setiap transisi tujuan pada dokumen sama berkonflik | Ini disengaja (CAS dokumen, D2); retry SDK; test model skenario (a) menjamin tidak ada kehilangan entri |
| AR10 | Field `catatan` baru di `admin_role_changes` mengubah bentuk `RoleChangeDoc` | Field opsional (B3); `listRoleChanges` memetakan `catatan ?? null`; UI lama toleran |

---

## 11. Yang TIDAK dilakukan (non-goals teknis)

- TIDAK ada gudang transit / `in_transit` (D3a).
- TIDAK ada approval berlapis / hierarki approver (D4a).
- TIDAK ada reorder point per gudang (BR13; `cariStokDiBawahReorderPoint` tidak disentuh).
- TIDAK ada barcode/QR/scanner, batch/lot/expiry/serial, hierarki gudang/bin-location.
- TIDAK ada permission granular per jabatan (jabatan kosmetik, BR8).
- TIDAK ada migrasi `stock_movements` lama ke per-gudang.
- TIDAK ada auto-expire dokumen `permintaan_gudang`.
- TIDAK ada integrasi Kledo/ERP/sheets master.
- TIDAK ada `listMovements({gudang_id})` dan TIDAK ada index `stock_movements.gudang_id` di v5 (V9).
- TIDAK ada route server untuk READ (dashboard pakai client SDK read-only).
- TIDAK ada `get()`/`exists()` di Firestore rules (read lintas gudang memang diizinkan, R5).
- TIDAK ada env baru, TIDAK ada endpoint diagnosa.
- TIDAK ada perubahan `lib/sheets/syncStokDuaArah.js` (B4).

---

## 12. Verifikasi (gate)

Urutan gate (WAJIB, `docs/learnings.md:31-32`):
1. **e2e pengunci COUNT DIJALANKAN LEBIH DULU** (sebelum menambah seed v5):
   `npx playwright test e2e/histori.spec.ts e2e/ringkasan.spec.ts e2e/stok.spec.ts`.
   Target: 0 fail. Bila gagal -> seed v5 bocor ke koleksi bersama.
2. `npm test` (`node --test test/*.test.js`) - target **0 fail** (angka absolut tidak stabil, `docs/prd-v5.md:934-938`; metrik = 0 fail).
3. `npx tsc --noEmit` - exit 0.
4. `npm run e2e` (`node scripts/e2e-build.mjs && playwright test`) - target 0 fail.
5. `node scripts/verify-backfill.mjs` - exit 0 (setelah migrasi manual bagian 10 PRD).
6. `firebase firestore:indexes --project bot-admin-toko-a0c47` - 7 index v5 ter-deploy.
7. `firebase deploy --only firestore:rules` - rules bagian 8 ter-deploy; koleksi baru terbaca sesuai role.

Test Wajib (daftar lengkap = `docs/prd-v5.md` bagian 12; ringkas):
`gudangMaster.test.js`, `stokGudangQty.test.js`, `adminGudangJabatan.test.js`, `permintaanGudang.test.js`,
`opnameGudang.test.js`, `produkOnline.test.js`, `stockFilter.test.js`, `guardV5.test.js`,
`indexFirestoreV5.test.js`, `urutanGuardV5.test.js`, `casModelFirestore.test.js` +
`test/helpers/mockFirestore.js`, `mockParitas.test.js` (perluas), e2e `gudang-v5.spec.ts`,
`permintaan-gudang.spec.ts`, `opname-gudang.spec.ts`.
Minimal satu test per route baru MENG-IMPORT dan memanggil `POST()` (bukan mirror helper, `docs/learnings.md:24`).

---

## 13. Perubahan Revisi (Review 1) - cara tiap temuan ditutup

### 13.1 Blocker
| ID | Temuan | Cara ditutup |
|---|---|---|
| B1 | `tutup-tujuan` salah `gudang_id` (tujuan) | ADR-6 ditulis ulang: `gudang_id = dari_gudang_id` (ASAL), `qty` ASLI. Diterapkan konsisten di bagian 5.4, 7, 9, 10, 11. Ditegaskan blok "PENEGASAN B1". Test `test/permintaanGudang.test.js` assert nilai |
| B2 | `getRingkasan()` tidak bisa tetap hitung online | Bagian 4.6: `rowsStok(opts: StockFilter)` + `getRingkasan()` memanggil `rowsStok({is_online:true})`. Signature `StockFilter` konkret, aturan pemakaian, dikunci test `indexFirestoreV5.test.js` (C5). TIDAK "nanti dipisah" |
| B4 | Klaim `syncStokDuaArah.js` salah faktual | Bagian 4.5: fakta file (import baris 19; `tandaiTersinkron` baris 481, 530; Sheets baris 506, 558-566; tidak ada `tambahStok`/`kurangiStok`). Analisis: `tandaiTersinkron` TIDAK menulis stok/qty_per_gudang -> TIDAK bisa membuat beda; mitigasi nyata (bukan palsu) diuraikan. Klaim "menulis lewat `tambahStok`/`kurangiStok`" DIHAPUS |

### 13.2 Major
| ID | Temuan | Cara ditutup |
|---|---|---|
| A1 | Method DataSource baru tidak dienumerasi | Bagian 8.1: daftar 20 method PERSIS dari `docs/prd-v5.md:977`, termasuk `listUserTujuan` + index #7 |
| A2 | `buat` tidak cek `kode_barang` ada di `stock` | Bagian 5.1 langkah 1: validasi tiap `kode_barang` ada di `stock`, gagal -> 400/404 |
| B3 | Audit `set-gudang-user` pakai `catatan` yang tidak ada | Bagian 3.4: `lib/models/adminRoleChanges.js` + `RoleChangeDoc` ditambah ke daftar DIUBAH; `catatan` opsional backward-compatible; `listRoleChanges` mapping `catatan ?? null` |
| C1 | Jumlah index 8 vs 7 | Seluruh dokumen memakai **7 index** (bagian 3/9); tidak ada klaim index ke-8 |
| C2 | Penempatan `setQtyGudang`/helper tidak konsisten | Bagian 3.1 catatan penempatan: SATU sumber kebenaran. Helper transaksi di `stokGudang.js`; `setQtyGudang` diekspor `stok.js`. Daftar fungsi bagian 4.1 = daftar TUNGGAL |
| D1 | Batas 500 dok/transaksi tidak dihitung | Bagian 5: perhitungan eksplisit (402 < 500) untuk `terima`/`setujui`/`kirim`; konsekuensi BR16 |
| D2 | Semantik CAS per-array tidak dinyatakan | Bagian 5: SEMANTIK CAS - optimistik pada SELURUH dokumen, `tujuan[i]` ikut karena seluruh array ditulis ulang; SDK retry otomatis |

### 13.3 Minor
| ID | Temuan | Cara ditutup |
|---|---|---|
| A3 | `batal` otorisasi pembuat vs staff tidak eksplisit | Bagian 5.2/5.4 + PRD F5.3: predikat `oleh == created_by \|\| role in {owner,admin}`; route memetakan gagal -> 403 |
| A4 | `verify-backfill.mjs` tidak ada kontrak output | Bagian 7: READ-ONLY (hanya `get`), exit 1 bila selisih > 0, exit 0 bila 0, tidak menyentuh koleksi lain |
| B5 | `lib/reminder/*` diklaim konsumen tulis `_ubahStokRelatif` | Bagian 4.4: dipindahkan ke daftar "AMAN - hanya membaca"; BR13 |
| B6 | Titik keputusan ukuran `mock.ts` tidak jelas | Bagian Wave 3: ukur ULANG di akhir Wave 3; ambang 1800 baris -> pecah `mock-v5.ts` sebelum Wave 4 |
| C3 | `_bacaParitasOnline` vs `normalisasiQtyPerGudang` relasi tidak jelas | Bagian 4.1: `_bacaParitasOnline = normalisasiQtyPerGudang(data)["ONLINE"] ?? 0` |
| C4 | Wave 3 sentuh `produk.js`, dependency tidak disebut | Bagian 8.3: `setOnlineProduk` pakai `invalidasiCacheProduk` existing, tanpa dependency baru |
| C5 | Wave 3 tidak mengunci `getRingkasan` | Bagian 4.6 + Wave 3: assert `getRingkasan().totalProdukOnline == count(is_online)` di `indexFirestoreV5.test.js` |
| C6 | Wave 4/5 berbagi `indexFirestoreV5.test.js` | Bagian 9: Wave 3 pemilik awal; Wave 5 menambah blok TERPISAH, urutan SERI untuk file test bersama |
| D3 | Kontensi `terima` bersamaan multi-tujuan produk sama | Bagian 10 AR1: retry SDK + operasi massal luar jam sibuk |
| D4 | `verify-backfill.mjs` tidak jamin tidak menulis koleksi lain | Bagian 7 (A4): hanya `get`, tidak menyentuh koleksi lain |
| E1 | `payload` guard berbeda per aksi tidak dibahas | Bagian 6: `{merge:false}` menimpa seluruh dokumen; payload WAJIB memuat semua field pembanding tabel; implementasi membandingkan key yang sama |
| E2 | Read lintas-scope vs tulis terbatas | Bagian 7 "Read lintas-scope": dicatat sebagai keputusan sadar R5 |
| E3 | Read-only script tanpa test | Bagian 7 + 12: komentar read-only di header file + grep `set|update` saat PR |
| E4 | Urutan guard hanya diuji guest + body invalid | Bagian 7 + Wave 4: `test/urutanGuardV5.test.js` menambah kasus admin + rate limit -> 429 sebelum role |
| E2b | Konsekuensi `stock` read `authed()` | ADR-3 + Bagian 7: konsekuensi diterima & didokumentasikan (R5, R16) |

### 13.4 Verifikasi revisi ini
1. Byte pertama file ini = `#` (0x23), tanpa BOM.
2. Tidak ada klaim `tutup_tujuan` memakai gudang tujuan; semua `gudang_id: dari_gudang_id`.
3. Nama file model PERSIS `docs/prd-v5.md` bagian 7a.
4. Klaim `syncStokDuaArah.js` sesuai file nyata (4.5).
5. Semua method DataSource di bagian 8.1 ada di `docs/prd-v5.md:977`.