# Test Report - Tests CAS Transaksi & Urutan Guard v5

Tanggal: 2026-09-17
Scope: dua file test baru (tidak mengubah lib/ atau app/).
- `test/casModelFirestore.test.js` - semantik CAS transaksi (race) pada dokumen `permintaan_gudang` yang sama.
- `test/urutanGuardV5.test.js` - urutan guard route v5 (`tolakOrigin` -> sesi -> rate limit -> role -> validasi body).

Metode:
- Mock Firestore in-memory (`test/helpers/mockFirestore.js`) yang MEN-SERIALISASI `runTransaction` lewat antrean mutex, meniru Firestore asli. Race diuji dengan `Promise.all`.
- Route `.ts` di-transpile TypeScript in-test (`typescript` devDependency) lalu di-`_compile` sebagai CJS, sehingga `POST()` asli dipanggil dengan `Request` buatan. Tanpa browser/network/server Next.
- Encoding: UTF-8 tanpa BOM, ASCII-only.

## Perintah

```
node --test test/casModelFirestore.test.js test/urutanGuardV5.test.js
```

## Hasil

- tests: 8 (4 + 4)
- pass: 8
- fail: 0
- duration: ~0.78 s (kedua file)
- suite penuh `node --test test/*.test.js`: 435 pass, 0 fail, ~7.7 s (tidak ada regresi).

## Test yang dijalankan

`test/casModelFirestore.test.js` (4):
1. Dua `terima` tujuan BERBEDA pada dokumen sama, paralel -> kedua entri `diterima`, dokumen `selesai`, stok D13 dan D14 naik TEPAT sekali (masing-masing 5), stok asal tetap 95.
2. `terima` vs `tutup-tujuan` pada tujuan SAMA, paralel -> TEPAT SATU menang; yang kalah 409. Stok D13 = 5 (terima menang) atau 0 (tutup menang), TIDAK pernah 10.
3. Dua `kirim` pada dokumen sama, paralel -> satu ok, satu 409 `"Permintaan sudah dikirim."`; stok asal turun TEPAT sekali (100 -> 95).
4. Dua `tidak-terima` tujuan SAMA, paralel -> satu ok, satu 409; stok asal naik TEPAT sekali (95 -> 100), stok tujuan tetap 0.

`test/urutanGuardV5.test.js` (4, tiap test lintas 4 route: `/api/permintaan-gudang`, `/api/gudang`, `/api/opname-gudang`, `/api/stok/gudang`):
1. Origin tidak valid -> 403 `"Origin tidak diizinkan."` (tolakOrigin paling awal).
2. Origin valid, tanpa cookie sesi -> 401 (pesan `Sesi kedaluwarsa...`).
3. GUEST (dokumen admins role `guest`) + body INVALID (`"BUKAN-JSON"`) -> 403, BUKAN 400. Ini inti urutan v5: guest menang sebelum `request.json()`/validasi.
4. OWNER (lolos role) + body INVALID -> 400 `"Body tidak valid."` (validasi jalan setelah role).

## Coverage acceptance criteria

- Semantik CAS transaksi: operasi bersamaan pada dokumen sama tidak menghasilkan efek ganda (stok tidak naik/turun dua kali; tepat satu aksi menang, sisanya 409). Terbukti untuk `terima`, `tidak-terima`, `kirim`, dan `terima` vs `tutup-tujuan`.
- Urutan guard v5: `tolakOrigin` -> sesi -> role -> validasi body, dengan bukti status nyata dari `POST()` asli keempat route. Klaim kunci (guest + body invalid = 403) lulus; bila urutan validasi body didahulukan, test 3 akan mendapat 400 dan gagal.

## Failures

Tidak ada.

Selama pengerjaan sempat 1 kegagalan di test 3 (`urutanGuardV5`): pesan yang diharapkan `"Akses ditolak. Hubungi owner."` ternyata untuk `/api/gudang` route mengembalikan `"Hanya owner yang dapat mengelola gudang."`. Diagnosa: bukan bug implementasi - `/api/gudang` memang owner-only tanpa cabang guest khusus (route.ts baris 58-61), sehingga SEMUA non-owner memakai pesan owner. Assertion pesan diperbaiki jadi menerima salah satu pesan 403 per desain route; assertion STATUS 403 (klaim urutan) tetap ketat.

## Temuan

1. **Pesan 403 non-owner tidak seragam antar route.** `/api/gudang` memakai pesan owner-only (`"Hanya owner yang dapat mengelola gudang."`) untuk guest, sedangkan tiga route lain memakai `"Akses ditolak. Hubungi owner."`. Bukan bug (perilaku sesuai kode), tapi tidak konsisten untuk UX/klien. Bila keseragaman diinginkan, tambahkan cabang guest eksplisit di `/api/gudang`.

## Batasan / risiko

1. `tolakOrigin` tanpa header Origin -> `ok:true` saat `NODE_ENV !== "production"` (dev). Test memakai Origin TIDAK valid (bukan absen) agar 403 deterministik tanpa bergantung NODE_ENV. Perilaku produksi (Origin absen -> 403) TIDAK dicakup test ini; diuji terpisah di `test/guard.test.js`.
2. File test meng-transpile `route.ts` in-test. Bila route berhenti memakai `createRequire(import.meta.url)` atau menambah TS yang tidak didukung `transpileModule`, loader test dapat perlu disesuaikan. Ini friksi test, bukan risiko produksi.
3. `cekRateLimit` adalah singleton in-memory; antar test dipanggil `resetRateLimit()` + uid unik per route agar tidak bocor 429.
4. Sesi valid di test dibuat dengan `buatTokenSesi` + `DASHBOARD_SESSION_SECRET` uji (bukan alur login Telegram penuh); cukup untuk membuktikan urutan guard, bukan E2E auth.
5. `test/casModelFirestore.test.js` bergantung pada jaminan serialisasi mutex mock. Bila helper mock diubah agar transaksi paralel, test race ini perlu ditinjau ulang.