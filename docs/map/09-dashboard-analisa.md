# 09 — Dashboard & Analisa Produk/Iklan

## Ringkasan area
- Peta UI dashboard Next.js, sumber data mock/real, halaman analisa produk, kalkulasi, impor Shopee, penyimpanan D1 dan ringkasan AI.
- Dashboard di repo ini adalah UI internal pada `app/page.tsx` dan halaman-halaman App Router; bukan satu komponen tunggal. Halaman utama ringkasan memakai `lib/dashboard`.
- Sumber kontrak dashboard (`lib/dashboard/data/index.ts`) punya mode mock/real: `NEXT_PUBLIC_DASHBOARD_DATA=mock` memilih implementasi mock; mode default/selain `mock` adalah real. `data/real.ts` membaca API server, bukan fixture.
- Analisa produk berada di `/analisa`; ia memakai kalkulasi murni `lib/analisa/*` dan D1, bukan sumber dashboard mock/real.
- TIDAK termasuk: seluruh pemetaan semua API WMS dan skema lengkap D1 (lihat `02-database.md`); bisnis stok/order, laba, cetak, editor desain dan integrasi Kledo poza hubungan yang disebut di sini.
- `components/dashboard/` adalah kumpulan UI lintas halaman, bukan hanya analisa; kelompokkan berdasarkan fitur, tidak satu baris per file.

## Peta file
|file|peran|export/entry penting|
|---|---|---|
|`app/page.tsx`|halaman Ringkasan dashboard|`HalamanRingkasan` (default); `useData()`|
|`app/analisa/page.tsx`|UI tab analisa, saran iklan, peta SKU|default page; `keputusanIklan`, `organikCr` dari `lib/analisa/hitung`|
|`app/api/analisa/route.ts`|API analisa cepat, tren, detail, AI, impor iklan|`GET`, `POST`; `sesiRoute`, `analisaCepat`, `susunBahan`|
|`app/api/analisa/peta/route.ts`|baca dan ubah keputusan peta SKU|`GET`, `POST`|
|`app/api/ads/route.ts`|baca/tulis/hapus biaya ads harian|`GET`, `POST`, `DELETE`|
|`lib/dashboard/data/index.ts`|kontrak `DataSource`, pemilih mode data|`dataMode()`, `isMockMode()`, `assertMockAllowedInThisEnv()`|
|`lib/dashboard/data/real.ts`|implementasi dashboard nyata, fetch API|`makeRealDataSource()`|
|`lib/dashboard/data/mock.ts`, `mock-data.ts`|implementasi dan fixture mock|store/mock seed (bukan D1)|
|`lib/dashboard/sumber-data.tsx`|provider React/useData dan sesi/role UI|`SumberDataProvider`, `useData`, `useRole`|
|`lib/dashboard/types.ts`, `format.ts`|tipe UI dan format angka/tanggal|tipe dokumen; `formatAngka`, `formatRupiah`, `formatTanggal`|
|`lib/dashboard/useCariProduk.ts`|hook cari produk|`useCariProduk`|
|`lib/analisa/hitung.ts`|analisa murni dan keputusan iklan per SKU|`bangunBaris`, `analisaCepat`, `keputusanIklan`, `organikCr`, `urutSaranIklan`|
|`lib/analisa/iklanEstimasi.ts`|estimasi skenario biaya iklan berdasar histori|`estimasiIklan`, `ringkasEstimasi`|
|`lib/analisa/tren.ts`|seri harian, delta, ringkasan dan bahan tren|`seriHarian`, `ringkasRentang`, `bandingkan`, `bahanTren`|
|`lib/analisa/ai.ts`|prompt/bahan narasi AI, konteks metrik organik|`susunBahan`, `analisaMendalam`, `susunPesanMendalam`|
|`lib/analisa/peta.ts`|parse peta Shopee dan pertanyaan pemetaan SKU|`deteksiKolom`, `bangunPeta`, tipe peta|
|`lib/analisa/skenarioIklan.ts`, `ringkas-gagal.ts`|skenario bertahap dan ringkasan percobaan AI gagal|`bangunPaketSkenario`, `ringkasGagal`, `saranGagal`|
|`lib/analisa/potongHarian.ts`, `tipe.ts`|pecah data order per hari; kontrak hasil analisa|`potongPerTanggal`, `rentangDariNamaBerkas`; tipe `BarisSku`, `HasilAnalisa`|
|`lib/d1/analisa.ts`|query snapshot laba, performa, stok, ads dan peta ke data analisa|`ambilSnapshot`, `performaPerSku`, `metrikIklanPerSku`, `historiPerSku` (antara lain)|
|`lib/d1/analisa.ts` (penulis `performaPerSku`)|akses performa per SKU|`performaPerSku` — file `analisaPerforma.ts` TIDAK ada|
|`lib/d1/analisa.ts` (penulis `historiPerSku`)|riwayat SKU dari snapshot|`historiPerSku` — file `analisaHistoriSku.ts` TIDAK ada|
|`lib/d1/shopeePeta.ts`, `lib/d1/shopeePetaImpor.ts`|persistensi peta/performa Shopee & lookup kode Shopee-SKU|`simpanPerforma` (diuji `shopeePetaPerforma.test.ts`), `imporPerforma`|
|`lib/d1/adsProduk.ts`|parse CSV Shopee Ads dan simpan agregat|`bacaCsv`, `parseIklan`, `imporIklan`, `totalIklan`|
|`lib/dashboard/format.ts`, `pesan.ts`, `data/normalisasi.ts`, `data/filterStok.mjs`|utilitas format, pesan, normalisasi dokumen, filter|`formatAngka`; helper normalisasi/filter (lihat ekspor modul)|
|`lib/dashboard/comboboxFilter.js`, `guardV5.js`, `validasi*.js|mjs`|filter combobox, guard dan validasi form dashboard|fungsi validasi/guard per domain; modul bukan lapisan analisa|
|`components/dashboard/analisa-ringkasan.tsx`|UI hasil dan ringkasan analisa|komponen presentasi|
|`components/dashboard/analisa-detail-produk.tsx`|detail funnel/performa produk|komponen presentasi|
|`components/dashboard/analisa-estimasi-iklan.tsx`|hasil estimasi iklan|komponen presentasi|
|`components/dashboard/analisa-peta-sku.tsx`|peta SKU dan keputusan manusia|komponen presentasi|
|`components/dashboard/analisa-setting-ai.tsx`|pengaturan analisa AI|komponen presentasi|
|`components/dashboard/input-iklan.tsx`|form impor/input iklan|komponen presentasi|
|`components/dashboard/app-shell.tsx`, `app-sidebar.tsx`, `nav-config.ts`, `page-header.tsx`, `bottom-nav.tsx`|shell, navigasi dan header lintas halaman|entry/layout UI; `nav-config.ts` konfigurasi nav|
|`components/dashboard/dialog-import-order.tsx`, `dialog-import-excel.tsx`, `preset-toko.tsx`, `dialog-laba-shopee.tsx`|impor order/excel, preset toko dan laba|UI impor dan pemilihan preset|
|`components/dashboard/editor-*.tsx`, `printing-studio.tsx`, `kanvas-anotasi.tsx`|editor desain/AI dan workspace cetak|kelompok fitur desain/cetak|
|`components/dashboard/dialog-*.tsx`, `aksi-*.tsx`, `form-master-produk.tsx`, `kelola-admin.tsx`, `kledo-integrasi.tsx`|aksi/dialog stok, admin, gudang, akses dan integrasi|UI lintas domain (71 file total; inventaris terkelompok, tidak dirinci semua)|
|`docs/dashboard-prd-v3b.md`, `docs/research-dashboard-wms.md`, `docs/rencana-analisa-produk.md`|PRD, riset dashboard dan rancangan analisa|dokumen konteks; implementasi aktual tetap kode/migrasi|

## Alur data
1. Halaman dashboard yang mengimpor `lib/dashboard`: `/` (`app/page.tsx`), `/admin`, `/draft`, `/gudang`, `/histori`, `/opname-gudang`, `/permintaan-gudang`, `/permintaan`, `/produk/[kode]`, `/stok`, `/pengaturan`; `app/layout.tsx` membungkus UI dengan `SumberDataProvider`. Halaman lain mengimpor utilitas selektif seperti `format.ts`.
2. `NEXT_PUBLIC_DASHBOARD_DATA` dibaca `dataMode()` (`data/index.ts`); `mock` memilih data mock untuk pengembangan/test, mode lain real. `mock.ts` menggunakan seed in-memory; `makeRealDataSource()` (`data/real.ts`) memanggil endpoint dengan fetch, kredensial cookie dan batas timeout. Jangan menyamakan mode dashboard dengan backend analisa.
3. Impor performa: `components/dashboard/analisa-peta-sku.tsx` (`unggah`, `FileReader.readAsDataURL`) atau `app/sinkronisasi/page.tsx` (`unggahPerforma`) → JSON `{aksi:"impor-performa", file, presetId}` ke `POST /api/analisa/peta` → handler `POST` decode base64 → `lib/d1/shopeePetaImpor.ts` `imporPerforma` membaca XLSX (`XLSX.read`, `sheet_to_json`), menentukan periode (`periodeDariTanggal`) dan peta (`bangunPeta`) → `lib/d1/shopeePeta.ts` `simpanPetaProduk`, `simpanPertanyaan`, `simpanPerforma` menulis `shopee_produk`, `peta_putusan`, `performa_produk` (agregasi per SKU) → `0027_analisa.sql`; indeks/kunci lookup performa di `0041_performa_periode.sql`.
4. Untuk hitung analisa cepat, `GET /api/analisa?aksi=cepat` mengambil snapshot laba dan performa/ads melalui `lib/d1/analisa.ts`, menyusun `MasukanAnalisa`, lalu `analisaCepat`/`bangunBaris` (`lib/analisa/hitung.ts`) menghitung metrik, ROAS impas, temuan dan saran. `iklanEstimasi.ts` menangani estimasi historis; `tren.ts` membangun tren.
5. Organik di Saran Iklan: `performaPerSku` memasok kolom `dilihat`, `kunjungan`, `keranjang`, `pesanan`, `omzet` dari `performa_produk`; kalkulasi memisahkannya ke `organik*` dan menampilkan kunjungan/pesanan/CR organik pada `app/analisa/page.tsx` (commit target `0dbfff8`). Data ads (`ads_produk`) tidak boleh dicampur dengan perilaku organik. Nilai tanpa impor = `null`, bukan nol.
6. Permintaan narasi AI: endpoint POST menyusun bahan numerik lewat `susunBahan` (`lib/analisa/ai.ts`), lalu mengirimnya kepada provider AI; AI menafsirkan hasil, bukan menghitung angka. UI menampilkan narasi, kegagalan provider dan kontrol di komponen analisa.
7. `app/api/analisa/peta` menjalankan alur pemetaan produk Shopee → SKU: `bangunPeta` menghasilkan baris/kandidat/pertanyaan, namun kandidat bukan keputusan; `peta_putusan` menyimpan keputusan eksplisit pengguna.

## Endpoint & tabel terkait
- Endpoint: `GET|POST /api/analisa` → `app/api/analisa/route.ts` → `GET`, `POST`; mode `cepat`, `saran-iklan`, `estimasi-iklan`, `tren`, `detail-produk`, impor iklan dan AI.
- Endpoint: `GET|POST /api/analisa/peta` → `app/api/analisa/peta/route.ts` → `GET`, `POST`; peta dan putusan SKU.
- Endpoint: `GET|POST|DELETE /api/ads` → `app/api/ads/route.ts` → `GET`, `POST`, `DELETE`; kelola `ads_produk` (route juga memuat SQL langsung).
- Tabel D1 `performa_produk` → penulis `simpanPerforma` (`lib/d1/shopeePeta.ts`) via impor; pembaca `performaPerSku` dan analisa. Migrasi `0027_analisa.sql`, kunci `(preset_id, periode, sku)`, kolom `dilihat`, `klik`, `kunjungan`, `keranjang`, `pesanan`, `omzet`, `melihat_tanpa_beli`, `at`.
- Tabel D1 `ads_produk` → penulis `imporIklan` (`lib/d1/adsProduk.ts`) dan endpoint ads; pembaca analisa per SKU/total iklan. Migrasi `0027_analisa.sql`, PK `(preset_id,tanggal,sku)`; `biaya`, `klik`, `dilihat`, `omzet_iklan`.
- Tabel D1 `shopee_produk` → penulis impor peta; pembaca lookup `petaSkuDariKodeProduk`. `0027_analisa.sql`; PK `(kode_produk,sku)`, kolom `tingkat`, `variasi`, `kode_variasi_shopee`, `nama_shopee`.
- Tabel D1 `peta_putusan` → penulis keputusan manusia dari route peta; pembaca daftar pertanyaan/putusan. `0027_analisa.sql`; UNIQUE `(jenis,acuan)`, `kandidat_json`, `diputuskan_sku`, `diputuskan_at`, `diputuskan_oleh`.
- `0041_performa_periode.sql` memperbarui periode kosong menjadi `legacy` dan menambah indeks unik `idx_performa_preset_periode_sku` serta indeks `idx_performa_preset`; jaga `preset_id` dalam lookup lintas toko.
- Data snapshot yang mendasari hitung adalah `laba_snapshot` (skema awal di migrasi laba; detail di `02-database.md`), bukan tabel `performa_produk`.

## Test terkait
- Unit analisa murni colocated: `lib/analisa/hitung.test.ts`, `iklanEstimasi.test.ts`, `ai.test.ts`, `peta.test.ts`, `skenarioIklan.test.ts`, `potongHarian.test.ts`, `ringkas-gagal.test.ts`.
- Unit akses/import D1: `lib/d1/analisaPerforma.test.ts`, `analisaHistoriSku.test.ts` (keduanya menguji `lib/d1/analisa.ts`), `shopeePeta.test.ts`, `shopeePetaImpor.test.ts`, `shopeePetaPerforma.test.ts` (menguji `simpanPerforma` di `shopeePeta.ts`), `adsProduk.test.ts`.
- UI terkait ada di `e2e/` Playwright; untuk kasus analisa telusuri spesifikasi dengan kata `analisa`/`iklan` sebelum memilih.
- Satu test unit: `npm run test:worker` (esbuild bundle → `node:test`, berkas `*.test.ts` ditemukan otomatis; tidak ada `tsx` di devDependencies, jadi jangan pakai `node --import tsx`).
- E2E umumnya dijalankan dengan Playwright (`npx playwright test e2e/<nama>.spec.ts`); lihat `playwright.config.ts` dan `14-test-tooling.md` untuk prasyarat.

## Gotcha / konvensi
- `app/api/analisa/route.ts` wajib melalui `sesiRoute`; route menolak non-admin, dan operasi tulis iklan di `/api/ads` mensyaratkan owner. Jangan melompati auth/rate limit/origin.
- Performa produk dan Ads adalah sumber terpisah: tayangan/klik Ads bukan kunjungan organik; angka organik hilang direpresentasikan `null`, jangan diubah menjadi nol.
- Impor Shopee berperiode/toko: gunakan `preset_id` pada query; jangan gabungkan data antar toko. Migrasi 0041 mengubah periode `''` lama ke `legacy`.
- `0027` menyimpan peta variasi dan induk; omzet/pesanan yang sah hanya baris induk untuk mencegah hitung ganda. Keputusan manusia tidak tertimpa impor ulang.
- `lib/analisa/hitung.ts` adalah sumber rumus angka murni; endpoint cepat tidak memakai AI. AI menerima bahan hasil kalkulasi, bukan data mentah untuk menghitung ulang.
- `data/real.ts` membaca API WMS melalui `DataSource`; ia tidak menjadi jalur data analisa yang tersimpan di D1.
- File besar seperti `app/api/analisa/route.ts` (lebih 1.000 baris): cari nama aksi/fungsi via grep dan baca rentang relevan, jangan baca keseluruhan.

## Kalau masalahnya ... buka ...
|gejala / kata kunci (Indonesia, sinonim/typo)|file pertama|catatan|
|---|---|---|
|Ringkasan kosong, dashboard tidak memuat|`app/page.tsx`|cek `useData()` dan provider layout|
|mock tampil padahal data produksi|`lib/dashboard/data/index.ts`|cek `NEXT_PUBLIC_DASHBOARD_DATA`, default real|
|data real dashboard gagal dimuat|`lib/dashboard/data/real.ts`|fetch `/api/baca`, sesi dan timeout|
|analisa angka / hasil cepat keliru|`lib/analisa/hitung.ts`|rumus murni; masukan dibentuk route|
|Saran Iklan, ROAS impas / prioritas|`app/analisa/page.tsx`|UI; rumus keputusan ada di `hitung.ts`|
|kunjungan organik tertukar tayangan iklan|`lib/analisa/tipe.ts`|kontrak membedakan `organik*` dari kolom ads|
|impor performa CSV/Shopee gagal|`lib/d1/shopeePetaImpor.ts`|`imporPerforma`; penulis tabel `performa_produk` = `shopeePeta.ts:simpanPerforma`|
|periode kosong/legacy tidak terbaca|`migrations/0041_performa_periode.sql`|nilai kosong dimigrasikan ke `legacy`|
|biaya iklan tidak cocok / CSV Ads|`lib/d1/adsProduk.ts`|parser dan agregator per SKU/tanggal|
|peta SKU Shopee salah atau belum diputuskan|`lib/analisa/peta.ts`|kandidat bukan putusan otomatis|
|peta/putusan tidak tersimpan|`app/api/analisa/peta/route.ts`|cek guard sesi/role dan tabel D1|
|AI analisa tidak merangkum / salah konteks|`lib/analisa/ai.ts`|`susunBahan`, prompt dan konteks organik|
|estimasi iklan tiga asumsi|`lib/analisa/iklanEstimasi.ts`|histori harian dan status aman/tipis/rugi|
|grafik tren, rentang atau delta|`lib/analisa/tren.ts`|seri tanggal, pembanding dan null hari kosong|
|format angka/tanggal di dashboard|`lib/dashboard/format.ts`|helper presentasi bersama|
|UI tab/detail analisa|`components/dashboard/analisa-detail-produk.tsx`|komponen analisa khusus; halaman parent `/analisa`|
|dialog impor atau preset toko|`components/dashboard/input-iklan.tsx`|UI impor; backend ada di API dan `lib/d1`|

## Belum diverifikasi
- Tidak ada spec Playwright khusus analisa (`e2e/*analisa*` kosong); penjaga utama ada di unit `lib/analisa/*.test.ts` dan `lib/analisa/peta.test.ts`.
- Commit `0dbfff8` terverifikasi menambah kolom “Kunjungan/Pesanan/CR organik” di `app/analisa/page.tsx` dan field organik di `lib/analisa/peta.ts`; efek visual penuh di UI belum diperiksa di browser.
- Komponen `components/dashboard/input-iklan.tsx` baru dipastikan sebagai UI impor; detail validasi form-nya belum ditelusuri.
