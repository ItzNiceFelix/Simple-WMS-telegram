# 04 — Laba, Harga Jual & Preset Biaya

## Ringkasan area
- Dua mesin terpisah: (1) **laba per order/preset** dari export `Order.all` Shopee, disimpan per `(preset_id, tanggal)` + registry anti-dobel per No. Pesanan; (2) **hitung harga jual** per SKU dari HPP + fee preset (tidak menyimpan transaksi).
- Inti murni (tanpa D1) ada di `lib/laba/*`; adapter D1 di `lib/d1/laba*.ts` + `lib/d1/hargaJualPreset.ts`; HTTP di `app/api/laba/route.ts` dan `app/api/harga-jual/route.ts`.
- Tarif/fee hidup di tabel `fee_rules` (per preset), `tier_admin`, `kategori_tarif`, `program_katalog`/`preset_program`; HPP di `products.hpp`.
- BUKAN area ini: impor order/stok/picklist (`lib/d1/order*.ts`, lihat `03-order.md`), sinkron HPP Kledo (`12-integrasi-sinkron.md`), iklan/analisa (`09-dashboard-analisa.md`), PDF laba ada di sini tetapi generator PDF lain di `08-printing-desain.md`.
- Jalur lama `lib/d1/labaShopee.ts` (`laba_harian`, `hitungLabaShopee`) tidak dipanggil route produksi; yang masih dipakai hanya util `tanggalJakarta` (diimpor `lib/d1/labaPreset.ts`) dan `hitungLabaShopee` di `scripts/uji-laba-nyata.mjs`.

## Peta file
| file | peran | export/entry penting |
|---|---|---|
| `lib/laba/aturanBiaya.ts` | Resolver aturan fee murni: cocok jenis/kategori/status/tanggal, tie-break | `cocok`, `pilihAturan`, `feePersen`, `feePlafonQty`, tipe `Aturan`, `KriteriaAturan` |
| `lib/laba/kategori.ts` | Resolusi tier dari path kategori | `resolveTier`, `normalisasiPath`, `TIER_UNKNOWN` |
| `lib/laba/syarat.ts` | Evaluasi `fee_rules.syarat_json` | `evaluasiSyarat`, `parseSyarat`, tipe `KonteksSyarat` |
| `lib/laba/hitungLabaPreset.ts` | Mesin laba per order (murni) | `hitungLabaPreset`, `dasarBaris`, tipe `AgregatPreset`, `OrderPreset`, `OpsiHitung` |
| `lib/laba/hitungHargaJual.ts` | Mesin harga jual per unit (murni) | `hitungHargaJual`, tipe `InputHarga`, `HasilHarga`, `KomponenFee` |
| `lib/laba/petaKategoriShopee.ts` | Konversi kategori export Seller Centre (EN `ID - L1/L2/L3`) ke path `kategori_tarif` | `kategoriExportKeID` (dipakai `scripts/banding-income.mjs`, `scripts/isi-kategori-export.mjs`) |
| `lib/laba/laba.test.ts` | 26 uji rumus laba (E1/E-R1/E-R2/E2 + Lapis 2) | — |
| `lib/laba/hitungHargaJual.test.ts` | 20 uji rumus harga jual (margin persen/nominal, OPEX, pembulatan) | — |
| `lib/d1/labaPreset.ts` | Adapter D1: muat preset/rules/tier/kategori/penghitung, hitung, simpan snapshot+registry, klasifikasi, total periode | `siapkanHitung`, `hitungDanSimpan`, `klasifikasikan`, `totalRegistry`, tipe `SiapHitung`, `ModeSimpan` |
| `lib/d1/labaLaporan.ts` | Lapis 3 read-only: daftar per No, deteksi overlap, CSV | `daftarPerNo`, `cariOverlap`, `barisCsv`, `selCsv`, `KOLOM_CSV`, `MAKS_OVERLAP` |
| `lib/d1/labaPdf.ts` | PDF A4 laporan laba dari snapshot | `bangunPdfLaba`, tipe `LabaPdfData` |
| `lib/d1/labaShopee.ts` | Mesin lama (Order.all standalone) + util tanggal | `hitungLabaShopee`, `tanggalJakarta`, `simpanLabaHarian`, `muatLabaHarian`, `listTanggalLaba`, `ambilHppDb`, `angkaShopee` |
| `lib/d1/hargaJualPreset.ts` | Adapter D1 komponen harga jual (fee admin/program/pajak/flat otomatis) | `muatKomponenHarga`, tipe `KomponenAuto` |
| `lib/d1/seedLaba.ts` | Loader seed idempoten + migrasi data lama | `pastikanPresetUtama`, `muatSeed`, `migrasiPresetLama`, `migrasiLabaLama` |
| `lib/d1/preset.ts` | CRUD preset/aturan/program | `listPreset`, `tambahPreset`, `duplikatPreset`, `ubahPreset`, `hapusPreset`, `validasiAturan`, `tambahAturan`, `ubahAturan`, `hapusAturan`, `resetSeed`, `listProgram`, `setProgram` |
| `lib/analisa/potongHarian.ts` | Potong satu berkas rentang → snapshot per tanggal | `potongPerTanggal`, `rentangDariNamaBerkas`, `waktuBaris` |
| `app/api/laba/route.ts` | Hitung/simpan + muat/list/pdf/total/overlap/export-csv | `GET`, `POST` |
| `app/api/harga-jual/route.ts` | Komponen auto + hitung harga jual | `GET`, `POST` |
| `app/api/preset/route.ts`, `app/api/preset/[id]/aturan/route.ts`, `app/api/preset/[id]/program/route.ts` | Kelola preset, fee_rules, toggle program | `GET`/`POST`/`PUT`/`DELETE` |
| `app/api/produk/hpp/route.ts`, `app/api/produk/kategori/route.ts`, `app/api/produk/massal/route.ts` | Ubah HPP, kategori/tier_override, aksi massal | `POST`; `GET`/`PATCH`; `POST` |
| `app/laba/page.tsx` | UI laba per preset (kartu upload, riwayat, overlap, CSV, PDF/JPG) | komponen `LabaPreset`, `Kartu` |
| `app/harga-jual/page.tsx` | UI hitung harga jual per SKU | komponen `HitungHarga` |
| `components/dashboard/dialog-laba-shopee.tsx`, `export-laba-gambar.tsx`, `preset-toko.tsx`, `editor-preset.tsx`, `aksi-massal-kategori.tsx` | Dialog upload, export JPG/PDF, editor preset, aksi massal kategori | `DialogLabaShopee`, `ExportLabaGambar`, `PresetToko`, `EditorPreset`, `AksiMassalKategori` |
| `scripts/muat-seed-laba.mjs`, `scripts/uji-laba-nyata.mjs`, `scripts/banding-income.mjs` | Seed remote, banding mesin lama/baru, rekonsiliasi income | sekali jalan (butuh wrangler/xlsx lokal) |
| `bundle/PRD-laba-multi-preset.md`, `docs/refactor-laba/*.md`, `docs/superpowers/plans/2026-10-13-hitung-harga-jual*.md` | PRD, inventaris, catatan migrasi, rancangan harga jual | acuan perilaku, bukan kode |

## Alur data
1. **Entry UI.** `DialogLabaShopee` membaca XLSX di klien (sheet `orders`, fallback sheet pertama) → `POST /api/laba {aksi:"hitung"|"simpan", presetId, rows, file, mode?}`. Halaman `/laba` memuat preset lewat `GET /api/preset`, riwayat `aksi=list`, snapshot `aksi=muat`.
2. **Potong per tanggal.** Route memanggil `potongPerTanggal(rows, rentangDariNamaBerkas(file))`; tanggal diambil dari `Waktu Pesanan Dibuat` (WIB), bukan tanggal yang diketik user; hari tepi ditandai `parsial`. Tanpa tanggal terbaca → 422.
3. **Muat konteks.** `siapkanHitung(db, presetId, tanggalAwal)` membaca `seller_presets`, `fee_rules` (aktif) + toggle `preset_program`, `tier_admin.persen_final`, `kategori_tarif` (tier + `grup_go`), `preset_penghitung`, rasio iklan `ads_harian ÷ SUM(laba_order.omzet)` bulan berjalan; kumulatif pesanan dihitung dari registry bila `sampaiTanggal` diisi.
4. **Biaya & kategori per baris.** `hitungLabaPreset` mengelompokkan per `No. Pesanan`, menyaring status (`statusDihitung`: `perlu dikirim|telah dikirim|sedang dikirim|selesai`), menghitung `dasarBaris` = (`Harga Awal` − diskon − voucher penjual) × qty bersih. SKU = `Nomor Referensi SKU` → `SKU Induk` (uppercase). `ambilSku` membaca `products`; `resolveTier(info.kategori, info.tierOverride, kategoriTabel)` menentukan tier.
5. **Preset/aturan.** Admin: `tierAdmin.get(tier)` + `pilihAturan` untuk kelayakan (`cocok`, `evaluasiSyarat`); program: `feePlafonQty` per baris memakai grup GO (`go_override` → `kategori_tarif.grup_go` → tier) atau `*`; pajak `pajak_pph`/`pajak_ppn` per baris/per order via `feePersen`; aturan `per_order` sekali per order (flat atau persen omzet). `laba = omzet − hpp − biaya` (biaya SUDAH termasuk pajak).
6. **Simpan.** `klasifikasikan` membandingkan `hash_baris` tiap No (baru/sama/berubah). Mode `tambah_baru` menulis `laba_order` dengan `INSERT OR IGNORE`; `timpa_semua` memakai `ON CONFLICT(preset_id,no_pesanan) DO UPDATE`. `laba_snapshot` selalu `INSERT OR REPLACE` per `(preset_id,tanggal)` + `no_json`; `preset_penghitung` di-update dari `COUNT(*) laba_order`.
7. **Laporan.** `GET aksi=total` → `totalRegistry` (SUM registry, bukan SUM snapshot); `aksi=overlap` → `cariOverlap` (dari `laba_snapshot.no_json`); `aksi=export-csv` → `daftarPerNo` + `barisCsv`; `aksi=pdf` → `bangunPdfLaba` (pdf-lib, A4, rincian SKU, tolak, peringatan).
8. **Harga jual.** `GET /api/harga-jual?aksi=komponen` → `muatKomponenHarga` (fee admin per tier, program aktif, pajak, flat per order dari `fee_rules`; OPEX/iklan manual). `POST {aksi:"hitung"}` → `hitungHargaJual`: `opex_unit = opexBulanan/volumeBulanan`, `harga = (hpp + opex_unit + flat/qty) / (1 − fee% − iklan% − margin%)`; mode `nominal` menambah margin ke pembilang, bukan pembagi.

## Endpoint & tabel terkait
- `GET /api/laba` (`app/api/laba/route.ts` `GET`, `sesiRoute(60)` + `is_admin`): `aksi=muat|list|pdf|total|overlap|export-csv`.
- `POST /api/laba` (`POST`, `sesiRoute(20)` + `is_admin`, `MAKS_BARIS=10000`): `aksi=hitung|simpan`; simpan diblokir 422 bila ada SKU `TIER_UNKNOWN`.
- `GET/POST /api/harga-jual` (`sesiRoute(120)` GET / `sesiRoute(20)` POST + `is_admin`): `GET aksi=komponen|cari-sku`; `POST aksi=hitung`.
- `GET/POST /api/preset`: GET `is_admin`, POST `is_owner` (aksi `tambah|duplikat|ubah-nama|ubah-status|hapus`).
- `GET/POST/PUT/DELETE /api/preset/[id]/aturan`: GET `is_admin`; POST (termasuk `reset-seed`), PUT, DELETE `is_owner` (hapus lunak bila preset punya snapshot).
- `GET/POST /api/preset/[id]/program`: GET `is_admin`; POST `is_owner` (`toggle|set-aktif-sejak|set-aturan`).
- `POST /api/produk/hpp` `is_owner`; `GET/PATCH /api/produk/kategori` (`is_admin`/`is_owner`); `POST /api/produk/massal` `is_owner` (`set-kategori|set-pre-order|set-ukuran`).
- Tabel: `fee_rules` (penulis `preset.ts`, pembaca `labaPreset.ts`/`hargaJualPreset.ts`; migrasi `0013`, kolom `0014`) · `seller_presets` (`0013` + `status_berlaku_sejak` `0014`) · `laba_snapshot` (`0013`, `pajak` `0016`, `no_json` `0018`) · `laba_order` (`0017`) · `tier_admin`/`kategori_tarif`/`program_katalog`/`preset_program`/`ads_harian`/`preset_penghitung` (`0014`) · `products.kategori_shopee` (`0013`), `kategori`/`tier_override`/`pre_order`/`ukuran_khusus` (`0014`), `go_override` (`0015`) · `laba_harian` (`0008`, `rincian_json` `0010`) legacy · `sinkron_log` (`0043`, jenis `laba` dicatat klien setelah simpan).

## Test terkait
- Unit murni: `lib/laba/laba.test.ts` (29), `lib/laba/hitungHargaJual.test.ts` (20).
- Unit D1 (mock `prepare/bind/first/all/run/batch`): `lib/d1/labaRegistry.test.ts` (6: klasifikasi, anti-dobel `tambah_baru`, blokir TIER_UNKNOWN, `timpa_semua`, D-5 per-berkas), `lib/d1/labaLaporan.test.ts` (8: CSV, overlap dari `no_json`), `lib/d1/labaShopee.test.ts` (4, mesin lama), `lib/d1/seedLaba.test.ts` (4: idempoten, rule owner utuh, migrasi).
- E2E (mock API, tanpa server): `e2e/laba-preset.spec.ts` (kartu PPh, rincian, tombol export, kolom GO stok), `e2e/order-laba.spec.ts` (snapshot + tolak + empty state). Tidak ada e2e `/harga-jual`.
- Satu unit test: `npx esbuild lib/laba/laba.test.ts --bundle --platform=node --format=esm --outfile=.tmp-t.mjs --define:__dirname="'.'" && node --test .tmp-t.mjs`. Semua unit TS: `npm run test:worker`. Satu e2e: `npx playwright test e2e/laba-preset.spec.ts --project=desktop`.

## Gotcha / konvensi
- **Dua allowlist status berbeda**: `hitungLabaPreset` menghitung `perlu dikirim`; `labaShopee.ts` (legacy) TIDAK. Jangan pakai `hitungLabaShopee` untuk angka produksi.
- **Registry anti-dobel**: `laba_order` PK `(preset_id, no_pesanan)` (migrasi `0017`) — satu No hanya satu baris. `tambah_baru` = `INSERT OR IGNORE` (No lama dilewati, bukan diperbarui); `timpa_semua` = upsert. Keduanya **tidak menghapus** No yang absen dari berkas, meski teks konfirmasi UI menyebut "TIMPA".
- **Peringatan D-5** (`hitungLabaPreset`, loop `dataLama`) harus memakai konteks SATU berkas: `statusBerkas` (No → status seluruh tanggal berkas) + `rentangBerkas` + `o.tanggal`. Tanpa itu registry global dibandingkan dengan slice satu tanggal → setiap order hari lain dituduh "hilang dari file" (data nyata: 2.542/2.545 peringatan palsu). Order yang batal **tetap ada** di berkas dengan status `Batal`, jadi keberadaan di `grup` saja bukan bukti masih dihitung — yang menentukan `statusBerkas`.
- **Overlap** hanya terdeteksi dari `laba_snapshot.no_json` (`0018`), bukan registry (registry sudah 1 baris/No). Snapshot pra-0018 bernilai `'[]'` → tak terdeteksi (`jml_snapshot_tanpa_daftar`).
- `biaya` sudah termasuk pajak; kolom `pajak` hanya rincian. Label UI "Estimasi PPh terbayarkan" sebenarnya `pajak_pph + pajak_ppn`.
- `rincian[].omzet` = Σ `dasar` apa adanya, bukan `hargaJual × unit` (harga per unit dibulatkan). Jangan kalikan ulang.
- Simpan diblokir (422) bila ada SKU `TIER_UNKNOWN`; preview `hitung` tetap jalan dengan peringatan + `estimasi_kasar` bila aturan admin belum `status_verifikasi='terverifikasi'`.
- Dua kolom verifikasi: `fee_rules.status_verifikasi` (`terverifikasi|belum_diverifikasi`, dipakai mesin) dan `fee_rules.verifikasi` (`resmi|resmi_cuplikan|sekunder|belum`, dipakai seed/validasi). Jangan tertukar.
- Tier tak dikenal = admin TIDAK dibebankan (bukan fallback `*`); kategori tak terpetakan juga tidak menolak order, hanya menambah `sku_belum_terpetakan`.
- `syarat_json` dengan kunci tak dikenal → `{ok:false}` → aturan dilewati. `tenor_bulan`/`kecuali_kategori` sengaja tidak dievaluasi di `syarat.ts`.
- `iklanPersen` null (belum ada `ads_harian`/omzet) → aturan bersyarat iklan dilewati dengan peringatan. HPP basi default 30 hari (`updatedAt` dari `products.updated_at`).
- Tarif program memakai kolom `kategori` sebagai **grup huruf GO** (A–H) atau `*`, bukan path kategori; `ukuran` `biasa|khusus` eksklusif dan `go_override` menang.
- `potongPerTanggal` mengabaikan `tanggal` kiriman user dan membuang baris di luar rentang nama berkas; hari tepi `parsial` tetap dihitung.
- Query per SKU di `ambilSku` (cache per panggilan) — berkas besar bisa menghabiskan anggaran kueri Worker; jangan panggil ulang per tanggal.
- `hitungHargaJual` menolak (bukan menebak) bila fee+iklan+margin ≥ 100%, HPP/OPEX/volume negatif. OPEX tidak dibebankan bila volume 0 (hanya peringatan). Flat per order dibagi `qtyPerOrder` (default 1). Plafon `plafon_per_qty` tidak diperhitungkan di jalur harga jual (hanya peringatan).
- `resetSeed` hanya mengganti baris `sumber LIKE 'seed:%'`; aturan manual owner aman.

## Kalau masalahnya ... buka ...
| gejala / kata kunci (Indonesia, termasuk sinonim/typo umum) | file pertama | catatan |
|---|---|---|
| laba dobel, order kehitung dua kali, impor berulang, "angka bengkak" | `lib/d1/labaPreset.ts` (`klasifikasikan`, `totalRegistry`, `hitungDanSimpan`) | cek `laba_order` PK + `laba_snapshot.no_json`; pakai `aksi=overlap` |
| total periode beda dengan jumlah snapshot, "total tidak cocok" | `app/api/laba/route.ts` `aksi=total` + `totalRegistry` | total dari registry (1 baris/No), bukan SUM `laba_snapshot` |
| simpan ditolak, "belum punya kategori tarif", 422 | `hitungLabaPreset.ts` (`TIER_UNKNOWN`) + `app/api/produk/kategori` | petakan `products.kategori`/`tier_override`, lalu hitung ulang |
| fee admin salah, tarif tidak kena, "admin 0" | `lib/laba/aturanBiaya.ts` (`pilihAturan`) + `tier_admin`/`fee_rules` | cek `aktif`, `valid_from/to`, `status_toko`, `priority`, tier hasil `resolveTier` |
| kategori produk tidak ketemu, tier salah, path beda | `lib/laba/kategori.ts` + `kategori_tarif` | `normalisasiPath` (` > `), prefix induk terpanjang, `tier_override` menang |
| program GO/XTRA tidak kena, plafon per qty salah | `hitungLabaPreset.ts` (blok `kode_program`) + `preset_program` | `kategori` rule = grup huruf/`*`; `go_override` > `grup_go` > tier; toggle harus aktif |
| syarat program tidak jalan, "aturan dilewati", iklan | `lib/laba/syarat.ts` + `ads_harian`/`preset_penghitung` | data null = `tak_dihitung`; kunci tak dikenal = gagal |
| PPh/PPN salah, "pajak dobel" | `hitungLabaPreset.ts` (blok pajak) + `fee_rules.jenis` | `pajak_pph`/`pajak_ppn` masuk `biaya` DAN kolom `pajak`; jangan jumlahkan lagi |
| status order tidak dihitung, "Batal ikut", "Perlu Dikirim hilang" | `hitungLabaPreset.ts` `statusDihitung` vs `labaShopee.ts` | allowlist berbeda; data lama di registry diberi peringatan D-5 |
| "hilang dari file", order dituduh Batal padahal masih Sedang/Telah Dikirim | `hitungLabaPreset.ts` (loop D-5) + `app/api/laba/route.ts` (`berkas`) | peringatan wajib per-berkas (semua tanggal), bukan per slice tanggal |
| omzet beda dengan Shopee, diskon dobel, "subtotal" | `hitungLabaPreset.ts` `dasarBaris` + `docs/refactor-laba/kolom-order-shopee.md` | dasar resmi = Harga Awal − diskon − voucher penjual |
| snapshot masuk tanggal salah, satu file jadi satu tanggal | `lib/analisa/potongHarian.ts` + `POST /api/laba` | tanggal dari `Waktu Pesanan Dibuat`; nama berkas hanya pagar |
| PDF laba rusak/kosong, kolom tumpang tindih | `lib/d1/labaPdf.ts` (`bangunPdfLaba`) | butuh `laba_snapshot` lengkap; `rincian`/`tolak` dari JSON |
| CSV laba kacau, koma/kutip | `lib/d1/labaLaporan.ts` (`selCsv`, `barisCsv`) | CRLF; sumber `daftarPerNo` |
| harga jual negatif/tak terdefinisi, "pembagi ≤ 0" | `lib/laba/hitungHargaJual.ts` | fee+iklan+margin ≥ 100%; margin nominal tidak masuk pembagi |
| harga jual terlalu murah/mahal, OPEX tidak masuk | `hitungHargaJual.ts` + `app/harga-jual/page.tsx` | OPEX butuh `volumeBulanan`; flat dibagi `qtyPerOrder`; `pembulatan` |
| fee otomatis harga jual kosong, "tier tak dikenal" | `lib/d1/hargaJualPreset.ts` (`muatKomponenHarga`) | tidak ada fallback `*` untuk admin; cek `fee_rules` preset + `kategori_tarif` |
| preset hilang, "laba campur antar toko", status toko salah | `app/api/preset/route.ts` + `lib/d1/preset.ts` | `dihapus_at` = soft delete; `status_toko` memengaruhi `cocok` |
| aturan/preset tidak bisa diubah, 403 | route `app/api/preset/**` | tulis owner-only, baca admin; guard `sesiRoute` (origin+sesi+rate limit) |
| HPP salah, "HPP basi", harga pakai HPP lama | `app/api/produk/hpp/route.ts` + `lib/d1/produk.ts` (`ubahHpp`) + `12-integrasi-sinkron.md` | `products.hpp`; peringatan >30 hari dari `updated_at` |
| seed tarif tidak masuk, reset seed | `lib/d1/seedLaba.ts` + `app/api/preset/[id]/aturan/route.ts` (`reset-seed`) | hanya `sumber LIKE 'seed:%'`; remote via `scripts/muat-seed-laba.mjs` |

## Belum diverifikasi
- Tidak ada pemanggil runtime `lib/d1/seedLaba.ts` di `app/`/`lib/`/`components/` (hanya uji + skrip); seed remote dijalankan `scripts/muat-seed-laba.mjs` yang membaca JSON langsung, bukan `muatSeed`.
- `labaShopee.simpanLabaHarian`/`muatLabaHarian`/`listTanggalLaba` tidak dipanggil route/halaman mana pun (hanya `scripts/uji-laba-nyata.mjs` dan uji), tetapi belum ada penanda deprecated resmi.
- `hppBasiHari` tidak pernah dikirim pemanggil mana pun; nilai efektif selalu default 30 hari.
- `products.kategori_shopee` (migrasi `0013`) tidak dibaca kode mana pun; kolom yang dipakai adalah `products.kategori`.
- `InfoSku.preOrder` diisi dari `products.pre_order` tetapi tidak dipakai `hitungLabaPreset` (tidak memengaruhi fee).
