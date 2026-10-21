# 08 — Printing (resi/watermark/PDF) & Editor Desain

## Ringkasan area
- Peta alur pratinjau/cetak resi dan generator PDF picklist, permintaan, laba, advance.
- Mencakup editor desain, operasi kanvas, pengaturan AI layout, serta penyimpanan elemen/latar.
- Termasuk draft guard/owner/aksi yang terkait dengan desain.
- BUKAN dokumentasi umum seluruh API AI/gambar, modul laba bisnis, atau seluruh lifecycle order.
- BUKAN katalog semua PDF aplikasi; fokus pada target inventaris area cetak/desain.

## Peta file
| file | peran | export/entry penting |
|---|---|---|
| `lib/printing/watermark.ts` | Susun PDF keluaran: resi + strip + penanda qty, per lembar | `bangunPdf`, `tataLetakAwal`, `Kotak`, `OpsiCetak`, `HalamanSumber` |
| `lib/printing/strip.ts` | Susun PDF strip 1 halaman (klasik vektor / kartun SVG) | `buatStrip`, `TEMPLATE`, `TemplateStrip`, `TeksStrip` |
| `lib/printing/templateKartun.ts` | SVG template kartun (dirender ke PNG di klien) | `SVG_KARTUN` |
| `lib/printing/ekstraksi.ts` | Ekstrak saran nomor order/resi dari teks label; murni tanpa PDF/DOM/jaringan | `bacaNomorLabel`, `bacaNomorDariHalaman`, `NomorLabel` |
| `lib/printing/watermark.test.ts`, `lib/printing/ekstraksi.test.ts` | Unit test printing | test colocated; watermark memakai `pdf-lib` |
| `lib/desain/skemaLayout.ts` | Model/validasi layout kanvas normalized | `JenisElemen`, `ElemenLayout`, `LayoutBanner`, `validasiLayout`, `UKURAN_PRESET`, `FONT_AMAN` |
| `lib/desain/skemaOperasi.ts` | Skema operasi kanvas dan validasi | `OperasiKanvas`, `OP_DIKENAL`, `validasiOperasi`, `destruktif` |
| `lib/desain/aiEditor.ts` | Tool dan konteks prompt AI editor | `NAMA_TOOL_EDITOR`, `SKEMA_TOOL_EDITOR`, `SPESIFIKASI_TOOL_EDITOR`, `susunPromptEditor`, `ringkasElemenKanvas` |
| `lib/desain/*.test.ts` | Test skema layout/operasi | test colocated |
| `lib/d1/desain.ts` | Persistensi folder/desain/latar D1 | `daftarFolder`, `UKURAN_SAH`, tipe `DesainPenuh`/`LatarPenuh` |
| `lib/d1/elemenDesain.ts` | Elemen SVG & kategori (ikon/bentuk/panah/hiasan) | `daftarElemen`, `ambilElemen`, `KATEGORI_ELEMEN`, `MAKS_ELEMEN_BYTE` |
| `components/dashboard/printing-studio.tsx` | Halaman kerja cetak (client): deteksi kotak resi, tabel qty, penanda qty, urutan cetak, editor posisi, cetak | `PrintingStudio` |
| `lib/printing/deteksiResi.ts` | Cari kotak resi (U/H/T) dari piksel halaman; murni | `deteksiKotakTinta`, `AMBANG_KOSONG`, `INFO_PENUH`, tipe `InfoResi` |
| `lib/printing/tataLetak.ts` | Rencana 1 vs 2 lembar per halaman resi; murni | `rencanaHalaman`, tipe `Bagian`, `OpsiRencana` |
| `lib/printing/penandaQty.ts` | Baca kolom Qty dari teks PDF + susun penanda | `bacaQtyHalaman`, `penandaQty`, `bentukPenanda`, `kotakTeks`, `kolomDariHeader` |
| `lib/printing/urutanCetak.ts` | Urutan cetak bertahap (sku/nama/qty/qtyNama) | `urutkanHalaman`, `grupQty`, `namaGrup` |
| `lib/printing/klienPdf.ts` | Helper pdf.js sisi klien (worker lokal, render, logo B/W) | `muatPdfJs`, `denganDokumen`, `renderHalaman`, `kePngHitamPutih` |
| `public/pdf.worker.min.mjs`, `scripts/salin-worker-pdf.mjs` | Worker pdf.js seversi, dilayani sendiri (tanpa CDN) | salinan dari `pdfjs-dist/build`; hook `postinstall`/`prebuild`/`predev` |
| `lib/d1/picklistPdf.ts` | PDF picklist per SKU | `bangunPdfPicklist` |
| `lib/d1/picklistPaketPdf.ts` | PDF picklist paket | `bangunPdfPicklistPaket` |
| `lib/d1/picklistGabungPdf.ts` | PDF gabungan order + advance | `bangunPdfPicklistGabung`, `gabungPerSku` |
| `lib/d1/permintaanPdf.ts` | PDF surat permintaan stok | `bangunPdfPermintaan` |
| `lib/d1/labaPdf.ts` | PDF laporan laba | `bangunPdfLaba` |
| `lib/d1/advancePdf.ts` | PDF picklist advance | `bangunPdfAdvance` |
| `lib/d1/resiGrup.ts` | Relasi satu resi ke beberapa order | `hitungResiGrup`, `isiResiGrup`, `ambilResiGrup` |
| `lib/d1/picklistEkspor.ts` | Catatan ekspor picklist | `MODE_EKSPOR`, `catatEksporPicklist`, `petaEkspor` |
| `app/printing/page.tsx` | Halaman kerja cetak resi | `HalamanPrinting` |
| `app/ai-gambar/page.tsx` | Halaman AI gambar | entry halaman |
| `app/api/printing/route.ts` | Pencatatan printing | entry route; handler detail belum dibaca |
| `app/api/desain/route.ts` | Route desain | handler detail belum dibaca |
| `app/api/desain/elemen/route.ts`, `folder/route.ts`, `latar/route.ts`, `layout/route.ts` | Route elemen/folder/latar/layout desain | handler detail belum dibaca |
| `lib/dashboard/draftGuard.js`, `draftOwner.js`, `aksiDraft.js` | Guard kepemilikan/aksi draft (CJS) | `kunciGuard`, `guardAktif`, `TTL_MS`; `tulisGuardDraft`, `ambilBatchPicking`, `siapkanKonfirmasiDraft`, `validasiStatusDraft`, `otorisasi` |
| `migrations/0028_desain.sql`, `0036_ai_editor.sql`, `0037_ai_editor_model.sql` | Migrasi desain/editor | lihat tabel di bagian terkait |

## Alur data
1. `app/printing/page.tsx` -> `components/dashboard/printing-studio.tsx`; dokumen resi diproses browser karena berisi nama/alamat/telepon. File tidak diunggah; nomor order saja dikirim setelah cetak untuk catatan.
2. Studio membaca teks dengan `pdfjs-dist`; `lib/printing/ekstraksi.ts` (`bacaNomorLabel`, `bacaNomorDariHalaman`) memberi kandidat nomor, `penandaQty.ts:bacaQtyHalaman` membaca tabel Qty/SKU/Variasi. Keduanya SARAN: label yang nomornya/tabelnya tak terbaca tetap boleh dicetak.
3. Pemindaian per halaman: render 300 px → `deteksiResi.ts:deteksiKotakTinta` (kotak U/H/T + fraksi tinta untuk halaman kosong) → thumbnail 150 px.
4. `lib/printing/strip.ts` (`buatStrip`) menyusun PDF strip 1 halaman seukuran kotak S; template klasik menggambar kotak+ikon vektor, template kartun merender `SVG_KARTUN` ke PNG. Lalu `lib/printing/watermark.ts` (`bangunPdf`) memuat sumber (`PDFDocument.load`, `embedPage`), memakai `tataLetak.ts:rencanaHalaman` untuk memilih kotak (satu atau dua lembar), menempel resi + strip (koordinat mm dari atas) + penanda qty, barcode tetap vektor. Strip HANYA di lembar pertama tiap resi.
4. Picklist per SKU: `lib/d1/picklistPdf.ts` (`bangunPdfPicklist`), menerima `BarisPicklist[]` dan jumlah order; PDF `pdf-lib`, Helvetica/HelveticaBold.
5. Picklist paket: `lib/d1/picklistPaketPdf.ts` (`bangunPdfPicklistPaket`), menerima `PaketPicklist[]`/`BarisPaket[]`; PDF `pdf-lib`, Helvetica/HelveticaBold.
6. Gabung order+advance: `lib/d1/picklistGabungPdf.ts` (`gabungPerSku`, `bangunPdfPicklistGabung`), menerima baris bertipe order/advance; PDF `pdf-lib`, Helvetica/HelveticaBold.
7. Permintaan stok: `lib/d1/permintaanPdf.ts` (`bangunPdfPermintaan`), menerima `DataPermintaanPdf`; laba: `lib/d1/labaPdf.ts` (`bangunPdfLaba`), menerima snapshot `LabaPdfData`; keduanya PDF `pdf-lib`, Helvetica/HelveticaBold.
8. Advance: `lib/d1/advancePdf.ts` (`bangunPdfAdvance`), menerima `BarisAdvancePick[]` dan opsi gudang/batch; PDF `pdf-lib`, Helvetica/HelveticaBold.
9. `lib/d1/resiGrup.ts` (`hitungResiGrup`, `isiResiGrup`, `ambilResiGrup`) mengelola peta satu resi -> beberapa order; pemanggil tepatnya belum diverifikasi.

## Endpoint & tabel terkait
- Endpoint: `GET|POST /api/printing` -> `app/api/printing/route.ts`; hanya nomor pesanan dikenal yang dicatat, namun label asing tetap boleh dicetak. Handler spesifik belum diverifikasi.
- Endpoint: `/api/desain` -> `app/api/desain/route.ts`; `/api/desain/elemen`, `/folder`, `/latar`, `/layout` -> route masing-masing; metode/handler belum diverifikasi.
- Tabel D1: `desain_folder`, `ai_latar`, `ai_desain` -> migrasi `0028_desain.sql`. Folder menyimpan pohon folder, latar menyimpan raster base64, desain menyimpan elemen JSON; aset raster dipisah agar daftar desain ringan.
- Tabel D1: `ai_editor_setting.model_editor` -> migrasi `0037_ai_editor_model.sql`; tabel `ai_editor_setting` ditambahkan `0036_ai_editor.sql`. Kolom menyimpan preferensi model editor per user; `''` berarti fallback ke model teks global.
- Tabel `picklist_ekspor` (migrasi `0032_picklist_ekspor.sql`) -> penulis `lib/d1/picklistEkspor.ts:catatEksporPicklist`, pembaca `petaEkspor`; mode `per_paket|pisah|gabung|gabung-order` (`MODE_EKSPOR`).

## Test terkait
- Unit: `lib/printing/watermark.test.ts`, `lib/printing/ekstraksi.test.ts`, `lib/printing/deteksiResi.test.ts`, `lib/printing/tataLetak.test.ts`, `lib/printing/penandaQty.test.ts`, `lib/printing/urutanCetak.test.ts`, `lib/desain/skemaLayout.test.ts`, `lib/desain/skemaOperasi.test.ts`.
- PDF order: `lib/d1/picklistGabungPdf.test.ts`, `lib/d1/picklistPaket.test.ts`, `lib/d1/picklistEkspor.test.ts`.
- Test e2e: `e2e/printing-studio.spec.ts` (deteksi kosong, tabel qty, filter, penanda, urutan, cetak + catat), `e2e/printing-sinkronisasi.spec.ts` (toko/template + impor), `e2e/preview-picklist.spec.ts` (pratinjau vs cetak), `e2e/excel.spec.ts` (ekspor). Jalankan satu spec: `npm run e2e:build` lalu `npx playwright test e2e/printing-sinkronisasi.spec.ts --project=desktop`.

## Gotcha / konvensi
- Mekanisme = alat referensi pemilik toko: strip adalah PDF tersendiri yang ditanam `embedPdf` (bukan digambar ulang per halaman), dan posisi resi/strip adalah dua kotak mm yang diedit lewat drag/resize di kanvas (`S` strip, `R` resi). `tataLetakAwal` hanya mengisi posisi awal; setelah user menggeser (`manual`), perubahan template/ukuran tidak mereset posisi.
- **Deteksi kotak resi** (`deteksiResi.ts`): frame dikenali dari garis VERTIKAL terpanjang; ujung bawahnya memisahkan H (resi) dan T (daftar produk). Tanpa frame → T `null` → selalu satu lembar. Abu-abu terang (watermark COD) diabaikan (ambang 190).
- **Pecah 2 lembar** (`tataLetak.ts`): hanya bila skala satu-lembar turun di bawah `ambangPecah` (default 0,85) dibanding skala kotak resi. Lembar sambungan TIDAK memakai strip. Mode `kecil` mematikan pemecahan.
- **Penanda qty** (`penandaQty.ts`) membaca header `Qty` dan hanya mengambil angka di kolom yang sama (toleransi `max(0,8×lebar,fontSize)`); baris di bawah `Qty Total`/`Total`/`Pesan` diabaikan; halaman `rotate ≠ 0` menghasilkan tabel kosong (bukan menebak). SKU vs Seller SKU dibedakan untuk Shopee vs TikTok.
- **Urutan cetak** (`urutanCetak.ts`): halaman tanpa tabel produk selalu paling akhir dengan urutan asli; `n` (posisi asli) adalah pemecah seri sehingga sort stabil.
- `batasHalaman` di `bangunPdf` hanya memotong keluaran; `halaman` yang dikembalikan tetap menghitung semua lembar (pratinjau dan tombol cetak tidak boleh beda angka).
- Detail cetak: area `#area-cetak-printing` dibuat sebagai anak langsung `<body>` oleh `cetak()`, CSS print `body>*:not(#area-cetak-printing){display:none}` + `@page{size:100mm <tinggi>mm;margin:0}`. Area yang bersarang di AppShell membuat dialog cetak keluar satu halaman kosong.
- Halaman kosong: pemindai di `printing-studio.tsx` merender halaman 300 px, memakai `deteksiKotakTinta` (fraksi tinta <0,2% = kosong), lalu menyimpan thumbnail 150 px. Seperti alat referensi, halaman kosong LANGSUNG dilewati; klik halaman untuk membalik, atau tombol `lewati-kosong` / `cetak-semua`.
- Template klasik: ikon garis vektor (`ikonGelas`, `ikonKamera`), font Helvetica/HelveticaBold, logo opsional diubah hitam-putih lalu ditanam. Template kartun tidak memakai teks/logo.
- Worker pdf.js DILAYANI SENDIRI: `public/pdf.worker.min.mjs` disalin dari `pdfjs-dist/build` oleh `scripts/salin-worker-pdf.mjs` (hook `postinstall`, `prebuild`, `predev`), URL `${BASE_PATH}/pdf.worker.min.mjs?v=<versi>`. Jangan kembalikan ke CDN: offline/CSP memblokir jsdelivr mematikan seluruh halaman.
- Setiap pemakaian pdf.js lewat `denganDokumen()` (loading task + `destroy()` di `finally`). Berkas yang tetap terbuka untuk thumbnail menyimpan `tugas` dan menutupnya saat berkas dihapus / halaman ditinggalkan — pdf.js v6 tidak punya `doc.destroy()`.
- Lima generator server (picklist biasa/paket/gabung, permintaan, laba, advance) memakai `pdf-lib`; data masuk dalam objek/baris siap pakai. Caller dan tabel sumber spesifik belum ditelusuri. Source generator tidak menunjukkan aset ikon/font/watermark eksternal.
- Sebelum perbaikan (commit sebelumnya): pita digambar DI ATAS resi (persegi putih + kotak menimpa 20 mm bawah, barcode hilang), area cetak bersarang di AppShell + `body>*{display:none}` (hasil print = satu halaman kosong), dan motif/nama toko menutupi badan resi. Ketiganya sudah dihapus.
- Skema layout memakai elemen koordinat ternormalisasi 0..1 dan z-order; validator membuang jenis tak dikenal. Operasi kanvas dibatasi daftar dikenal; `bangun_ulang` bersifat destruktif.
- `0028_desain.sql` menyimpan dokumen elemen JSON, bukan render desain; raster latar AI/unggahan disimpan terpisah. Penghapusan folder tidak menghapus desain/latar terkait secara otomatis (FK SET NULL pada yang bersangkutan).
- Migrasi `0037` menambah preferensi model pribadi editor; server tetap memeriksa model/izin saat digunakan.
- Perbedaan jumlah halaman pratinjau vs cetak ada implikasi eksplisit: `bangunPdf(..., hanyaHalamanPertamaDigambar=true)` masih menambah semua halaman, tetapi menggambar watermark hanya pada yang pertama; test memastikan pratinjau lebih kecil dari versi cetak. Detail UI menghitung halaman belum diverifikasi.

## Kalau masalahnya ... buka ...
| gejala / kata kunci (Indonesia, sinonim/typo) | file pertama | catatan |
|---|---|---|
| Resi tidak tercetak / tombol cetak | `app/printing/page.tsx` | Lanjut ke `printing-studio.tsx`. |
| Halaman kosong ikut tercetak / tidak terdeteksi | `lib/printing/deteksiResi.ts` | ambang `AMBANG_KOSONG` 0,002; watermark abu-abu tidak dihitung |
| Resi panjang terpotong / tiba-tiba 2 lembar | `lib/printing/tataLetak.ts` (`rencanaHalaman`) | `ambangPecah` default 0,85; `modePecah:"kecil"` mematikan |
| Qty tidak bertanda / salah angka | `lib/printing/penandaQty.ts` (`bacaQtyHalaman`) | header `Qty` wajib; halaman diputar = tak terbaca |
| Urutan cetak tidak berubah | `lib/printing/urutanCetak.ts` (`urutkanHalaman`) | halaman tanpa tabel produk selalu paling akhir |
| Pratinjau kosong / gagal membaca label | `lib/printing/ekstraksi.ts` | Ekstraksi teks murni; lihat test colocated. |
| Strip tidak muncul / posisi meleset | `lib/printing/watermark.ts` | Kotak `strip`/`resi` (mm dari atas) → `drawPage`; strip ditanam `embedPdf`. |
| Template kartun kosong / strip gagal | `lib/printing/strip.ts` | `svgKePng` butuh canvas; cek `SVG_KARTUN` di `templateKartun.ts`. |
| Barcode jadi kabur | `lib/printing/watermark.ts` | Kode mempertahankan halaman asli vektor lewat `embedPage`. |
| Jumlah halaman preview dan cetak beda | `lib/printing/watermark.ts` | Periksa opsi gambar watermark halaman pertama. |
| Picklist per SKU salah | `lib/d1/picklistPdf.ts` | `bangunPdfPicklist`. |
| Picklist per paket salah | `lib/d1/picklistPaketPdf.ts` | `bangunPdfPicklistPaket`. |
| Picklist gabungan order+advance | `lib/d1/picklistGabungPdf.ts` | `bangunPdfPicklistGabung`. |
| Pemetaan resi gabungan | `lib/d1/resiGrup.ts` | Satu resi ke beberapa order. |
| Surat permintaan PDF salah | `lib/d1/permintaanPdf.ts` | `bangunPdfPermintaan`; input `DataPermintaanPdf`. |
| Laporan laba PDF salah | `lib/d1/labaPdf.ts` | `bangunPdfLaba`; input snapshot `LabaPdfData`. |
| Picklist Advance salah | `lib/d1/advancePdf.ts` | `bangunPdfAdvance`. |
| Layout AI ditolak / elemen invalid | `lib/desain/skemaLayout.ts` | `validasiLayout`; operasi di `skemaOperasi.ts`. |
| Simpan desain / folder / latar | `migrations/0028_desain.sql` | Tabel `ai_desain`, `desain_folder`, `ai_latar`; modul D1 perlu ditelusuri. |
| AI layout atau model editor | `app/api/desain/layout/route.ts` | Baca `lib/desain/aiEditor.ts`, migrasi 0036/0037. |
| Draft ditolak / bukan pemilik | `lib/dashboard/draftOwner.js` | Guard/aksi pendamping `draftGuard.js`, `aksiDraft.js`. |

## Belum diverifikasi
- Handler/metode seluruh route desain (`app/api/desain/*`) dan route PDF permintaan/laba/advance: nama handler belum dibaca, yang tercatat baru generator PDF-nya.
- Rangkaian tepat undo/redo dan simpan/buka/AI layout di UI (skema validasi sudah pasti; urutan panggilan UI belum).
- Undo/redo: skema operasi `bangun_ulang` (destruktif) terverifikasi, tetapi batas riwayat dan cara UI menyimpan stack belum ditelusuri.
