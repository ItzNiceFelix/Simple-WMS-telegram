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
| `lib/printing/watermark.ts` | Bangun PDF resi client-side, menempel halaman asli vektor + watermark | `bangunPdf`, `dasarPita`, `OpsiCetak`, `PosisiWatermark` |
| `lib/printing/ekstraksi.ts` | Ekstrak saran nomor order/resi dari teks label; murni tanpa PDF/DOM/jaringan | `bacaNomorLabel`, `bacaNomorDariHalaman`, `NomorLabel` |
| `lib/printing/watermark.test.ts`, `lib/printing/ekstraksi.test.ts` | Unit test printing | test colocated; watermark memakai `pdf-lib` |
| `lib/desain/skemaLayout.ts` | Model/validasi layout kanvas normalized | `JenisElemen`, `ElemenLayout`, `LayoutBanner`, `validasiLayout`, `UKURAN_PRESET`, `FONT_AMAN` |
| `lib/desain/skemaOperasi.ts` | Skema operasi kanvas dan validasi | `OperasiKanvas`, `OP_DIKENAL`, `validasiOperasi`, `destruktif` |
| `lib/desain/aiEditor.ts` | Tool dan konteks prompt AI editor | `NAMA_TOOL_EDITOR`, `SKEMA_TOOL_EDITOR`, `SPESIFIKASI_TOOL_EDITOR`, `susunPromptEditor`, `ringkasElemenKanvas` |
| `lib/desain/*.test.ts` | Test skema layout/operasi | test colocated |
| `lib/d1/desain.ts` | Persistensi folder/desain/latar D1 | `daftarFolder`, `UKURAN_SAH`, tipe `DesainPenuh`/`LatarPenuh` |
| `lib/d1/elemenDesain.ts` | Elemen SVG & kategori (ikon/bentuk/panah/hiasan) | `daftarElemen`, `ambilElemen`, `KATEGORI_ELEMEN`, `MAKS_ELEMEN_BYTE` |
| `components/dashboard/printing-workspace.tsx` | Halaman kerja cetak (client): preset watermark, konversi ikon SVG→PNG, panggil `bangunPdf` | `PrintingWorkspace`; internal: `PRESET` (fragile, unboxing, jangan, hati, cod, terima, buka, tanpa), `kePngHitamPutih(File\|Blob, maksPx=480)`, `BASE_PATH` |
| `public/wm/*.svg` | Aset ikon preset watermark (Tabler Icons, MIT) + `LISENSI.txt` | `cod`, `dilarang-buka`, `fragile`, `hati-hati`, `jangan-dibanting`, `terima-kasih`, `video-unboxing` |
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
1. `app/printing/page.tsx` -> `components/dashboard/printing-workspace.tsx`; dokumen resi diproses browser karena berisi nama/alamat/telepon. File tidak diunggah; nomor order saja dikirim setelah cetak untuk catatan.
2. Workspace membaca teks dengan `pdfjs-dist`; `lib/printing/ekstraksi.ts` (`bacaNomorLabel`, `bacaNomorDariHalaman`) memberi kandidat nomor. Ini saran, label yang nomornya tak terbaca tetap boleh dicetak.
3. `lib/printing/watermark.ts` (`bangunPdf`) memuat sumber dengan `pdf-lib` (`PDFDocument.load`, `embedPage`) lalu menggambar lapisan watermark, mempertahankan barcode vektor. Pita memakai Helvetica/HelveticaBold; ikon garis digambar lokal, ikon PNG opsional melalui `embedPng`.
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
- Unit: `lib/printing/watermark.test.ts`, `lib/printing/ekstraksi.test.ts`, `lib/desain/skemaLayout.test.ts`, `lib/desain/skemaOperasi.test.ts`.
- PDF order: `lib/d1/picklistGabungPdf.test.ts`, `lib/d1/picklistPaket.test.ts`, `lib/d1/picklistEkspor.test.ts`.
- Test e2e: `e2e/printing-sinkronisasi.spec.ts` (watermark/pita + impor), `e2e/preview-picklist.spec.ts` (pratinjau vs cetak), `e2e/excel.spec.ts` (ekspor). Jalankan satu spec: `npm run e2e:build` lalu `npx playwright test e2e/printing-sinkronisasi.spec.ts --project=desktop`.

## Gotcha / konvensi
- Watermark resi memiliki pita: strip dibatasi 0..45 mm, digambar di y=0 (bawah) atau y=tinggi-strip (atas); ini lapisan pada output cetak, bukan ruang di dalam label asli.
- Motif watermark diulang di sekitar sepertiga tepi yang tersisa sesudah pita. Sudut rotasi dibatasi -90..90 derajat; cap tengah diletakkan di pusat halaman. Posisi tepi ditentukan `dasarPita`.
- Ikon garis pada pita berupa vektor (`gambarIkonGaris`); PNG opsional hanya ditanam bila opsi ikon menyediakan byte yang valid. Font standar `pdf-lib`: Helvetica dan HelveticaBold.
- Lima generator server (picklist biasa/paket/gabung, permintaan, laba, advance) memakai `pdf-lib`; data masuk dalam objek/baris siap pakai. Caller dan tabel sumber spesifik belum ditelusuri. Source generator tidak menunjukkan aset ikon/font/watermark eksternal.
- Pita di tepi (commit `0dbfff8`): dulu `posisi` diabaikan dan motif digambar menutupi seluruh halaman, jadi motif/pita bertumpuk di tepi dan menutupi isi label. Sekarang `OpsiCetak.stripMm` (dibatasi 0..45 mm) + `gambarPita`, titik tempel ditentukan `dasarPita(tinggiHalamanPt, stripPt, diAtas)` (`y = 0` atau `y = tinggi - strip`), dan area motif dikurangi pita (`Math.max(strip, H - strip - tinggiArea)`) supaya tidak tergambar di bawah pita.
- Ikon watermark tidak termuat (commit `5becf5b`): opsi dulu bernama `logo` dan menanam PNG yang belum tentu ada; sekarang opsi `ikon: {png, rasio}` diisi hasil `kePngHitamPutih` (SVG `public/wm/*.svg` → `<img>` → canvas → PNG ≤480px) lalu ditanam `embedPng(opsi.ikon.png)` dengan rasio dari gambar yang benar-benar ditanam. Aset ikon + `LISENSI.txt` ikut di-commit di `public/wm/`.
- Skema layout memakai elemen koordinat ternormalisasi 0..1 dan z-order; validator membuang jenis tak dikenal. Operasi kanvas dibatasi daftar dikenal; `bangun_ulang` bersifat destruktif.
- `0028_desain.sql` menyimpan dokumen elemen JSON, bukan render desain; raster latar AI/unggahan disimpan terpisah. Penghapusan folder tidak menghapus desain/latar terkait secara otomatis (FK SET NULL pada yang bersangkutan).
- Migrasi `0037` menambah preferensi model pribadi editor; server tetap memeriksa model/izin saat digunakan.
- Perbedaan jumlah halaman pratinjau vs cetak ada implikasi eksplisit: `bangunPdf(..., hanyaHalamanPertamaDigambar=true)` masih menambah semua halaman, tetapi menggambar watermark hanya pada yang pertama; test memastikan pratinjau lebih kecil dari versi cetak. Detail UI menghitung halaman belum diverifikasi.

## Kalau masalahnya ... buka ...
| gejala / kata kunci (Indonesia, sinonim/typo) | file pertama | catatan |
|---|---|---|
| Resi tidak tercetak / tombol cetak | `app/printing/page.tsx` | Lanjut ke workspace client. |
| Pratinjau kosong / gagal membaca label | `lib/printing/ekstraksi.ts` | Ekstraksi teks murni; lihat test colocated. |
| Watermark pita di tepi / posisi atas-bawah | `lib/printing/watermark.ts` | `dasarPita`, `gambarPita`, `OpsiCetak.stripMm` (0..45 mm). |
| Ikon watermark hilang | `components/dashboard/printing-workspace.tsx` → `lib/printing/watermark.ts` | `kePngHitamPutih` (SVG `public/wm/*.svg` → PNG) lalu `embedPng`; cek `BASE_PATH`/`NEXT_PUBLIC_BASE_PATH` bila 404. |
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
