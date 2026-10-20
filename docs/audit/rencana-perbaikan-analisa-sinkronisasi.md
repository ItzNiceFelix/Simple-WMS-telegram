# Rencana perbaikan akurasi `/sinkronisasi` + `/analisa`

Sumber: `local://peta-sinkronisasi.md`, `local://peta-analisa.md`, `local://audit-{sinkron,laba,peta-iklan,ai-detail}.md`.
Semua klaim P0 sudah diverifikasi ulang langsung ke kode oleh main agent (2 koreksi dicatat di §5).

Aturan kerja: satu slice = satu pemilik file. Tidak ada dua agent menyentuh file yang sama.

---

## 1. Slice & kepemilikan file

| Slice | Pemilik | File |
|---|---|---|
| **A — Integritas data + migrasi** | main agent | `migrations/0044_*.sql`, `lib/d1/adsProduk.ts`, `lib/d1/shopeePeta.ts`, `app/api/analisa/peta/route.ts`, `components/dashboard/analisa-peta-sku.tsx` |
| **B — Sinkronisasi akurat** | agent | `app/api/sinkronisasi/route.ts`, `app/sinkronisasi/page.tsx`, `components/dashboard/dialog-import-order.tsx`, `components/dashboard/dialog-laba-shopee.tsx`, `lib/d1/shopeePetaImpor.ts` |
| **C — Laba, qty, stok** | agent | `lib/laba/hitungLabaPreset.ts`, `lib/d1/orderImportShopee.ts`, `lib/analisa/hitung.ts`, `lib/d1/analisa.ts` |
| **D — Analisa API + UI** | agent | `app/api/analisa/route.ts`, `app/analisa/page.tsx`, `lib/analisa/iklanEstimasi.ts`, `lib/analisa/skenarioIklan.ts`, `components/dashboard/analisa-detail-produk.tsx`, `components/dashboard/analisa-estimasi-iklan.tsx` |

---

## 2. P0 — uang/qty salah (wajib)

| # | Masalah | Perbaikan | Data historis |
|---|---|---|---|
| P0-1 | Impor ulang iklan **menjumlah** biaya (`adsProduk.ts:213-215`) → ROAS jatuh palsu | Upsert **menimpa** (`biaya = excluded.biaya`). Akumulasi dalam satu berkas tetap terjadi di memori (`perKunci`), jadi satu impor multi-baris tetap benar | Baris yang sudah dobel tidak bisa dipulihkan tanpa berkas asli → tandai di dokumen, sediakan `--hapus` per (preset, tanggal) bila perlu impor ulang bersih |
| P0-2 | `peta_putusan` tanpa `preset_id` (`0027:36-52`) → pertanyaan/jawaban bercampur antar toko | Migrasi: rebuild tabel + `preset_id`, UNIQUE `(preset_id, jenis, acuan)`; semua pembaca/penulis memfilter toko | Backfill: baris lama `preset_id = NULL` = "global"; tetap tampil di semua toko sampai dijawab ulang |
| P0-3 | `preset_id = 0` diterima impor performa (`peta/route.ts:84`) | Tolak `!isInteger \|\| <= 0` → 400; tombol unggah `disabled` saat `presetId <= 0` | `DELETE FROM performa_produk WHERE preset_id = 0` (baris yatim, tak terlihat toko mana pun) |
| P0-4 | Retur penuh dihitung terjual 1 (`orderImportShopee.ts:185`) | `Math.max(0, jml - kembali)`; baris qty 0 **tetap disimpan** agar alokasi tidak bocor | Order lama perlu reimpor untuk benar; tanpa reimpor, qty tetap 1 |
| P0-5 | Qty (`orders`) dan omzet (`laba_snapshot`) dari populasi order berbeda | Qty dari `volumeSkuRentang` hanya untuk SKU yang ikut snapshot, atau tandai selisih. Pilih: **kecualikan SKU yang ditolak snapshot** dan laporkan jumlahnya | Tidak perlu migrasi |
| P0-6 | Stok "tidak ada baris" dianggap 0 (`hitung.ts:131`) | `Map.has()` → `0`, `Map` tidak punya SKU → `null`; temuan stok lewati `null` | Tidak perlu migrasi |

## 3. P1 — angka tampil menyesatkan

| # | Masalah | Perbaikan |
|---|---|---|
| P1-1 | Kartu Sinkronisasi: `baris` order = jumlah di berkas; `gagal` = panjang array; `baris` iklan = SKU unik; `baris` laba = jumlah tanggal; `gagal` hardcode 0 | Kirim angka yang benar: order `item` (tersimpan) + `gagal = dilewati.length + berkasGagal`; iklan `baris` = jumlah baris CSV + `gagal = dilewatiTanpaPeta`; laba `baris` = jumlah order tersimpan + `gagal = tanggal tanpa data`; performa `gagal = jumlahPertanyaan` |
| P1-2 | `LIMIT 40` lintas jenis → riwayat hilang | Query per jenis (4 query paralel) atau `LIMIT 40` per jenis lewat window; `ORDER BY at DESC, id DESC` |
| P1-3 | Impor gagal tidak tercatat | Catat juga kegagalan (`baris: 0`, `gagal: n`, `ringkas: "gagal: <alasan>"`), di keempat jalur |
| P1-4 | Biaya iklan multi-variasi menumpuk ke variasi pertama (`route.ts:710`) | Bangun `Map<kode, sku[]>`; agregasi iklan per SKU seperti `simpanPerforma` |
| P1-5 | `ads_produk.tanggal` = awal periode saja (`adsProduk.ts:177`) | Bila laporan mencakup N hari dan tidak ada tanggal per baris: **bagi rata** atau simpan di tanggal akhir + `ringkas` menyebut rentang. Pilih: simpan di tanggal **akhir** periode (lebih dekat ke saat laporan diunduh) + dokumentasikan keterbatasan |
| P1-6 | Metrik performa hanya baris induk; induk tanpa SKU → hilang | Bila baris induk tanpa SKU tetapi variasi punya SKU: alihkan metrik ke SKU variasi pertama (bukan buang) |
| P1-7 | Angka dari body klien masuk prompt "sudah dihitung sistem" | Buang `konteks` dari body: server menghitung ulang `bahanTren` dari DB. `modalIklan/targetRoas/hariKe` tetap dari UI tapi diberi label "asumsi user", bukan "sudah dihitung sistem" |
| P1-8 | Race POST log vs reload | `await` POST log sebelum `onSukses()` |
| P1-9 | `/api/preset` gagal → skeleton selamanya | State error + tombol coba lagi |
| P1-10 | CR iklan overstate (`hitung.ts:116`) | Pakai `iklan.pesanan`/qty iklan bila ada; jika tidak, tandai keterbatasan di UI |

## 4. P2/P3 — label & jalur mati

- `hariKe` 0 → "hari ke-0": default 1, tolak 0 di server.
- `bandingBulan` dihitung tapi tak dirender: render atau hapus (pilih: **hapus query**, hemat 2 query).
- SSE error setelah `{paket}` → card kosong: tampilkan teks error inline.
- `mendalam-stream` dead code: hapus `alirMendalam` + cabang aksi.
- `jumlahPerforma` = `perSku.size`.
- Label "satu hari" padahal 2 hari → perbaiki teks.
- `AnalisaDetailProduk` abaikan prop `tanggal` → pakai.
- `daftarTanggalSnapshot` 60 → naikkan default ke 200 + tanda bila terpotong.
- `dariTotal` SKU merugi → `ringkas.laba`.
- Klasifikasi fast/slow beda antar tab → satu definisi.
- `orderImportShopee` qty 0 vs snapshot qty 0 → selaras.
- `LIMIT 500` kode iklan → laporkan sisa.
- Validasi jumlah kolom CSV iklan (≥26) + judul kolom kunci.
- Case SKU: `COLLATE NOCASE` tidak aman tanpa audit duplikat → cukup trim + laporkan kandidat.

## 5. Koreksi atas laporan agent

| Klaim | Koreksi |
|---|---|
| "Metrik performa tersimpan 0" | Baris **hilang** (`shopeePeta.ts:226` membuang SKU kosong), bukan tersimpan 0 |
| "Order batal tetap dihitung" | Filter `status_fulfill <> 'batal'` **sudah ada** (`analisa.ts:517`); masalah nyata: impor melewati baris batal sehingga status lama tak pernah berubah |
| "V6 `bacaAngka` salah" | Bukan bug; logika ribuan vs desimal sudah benar dan teruji |
| "V7 benar, V8 bug" | Dibalik: V7 (integer rupiah) benar, V8 (tebak ribuan) aman |

## 6. Urutan eksekusi

1. Migrasi `0044` + slice A (P0-1..P0-3).
2. Slice B, C, D paralel (file disjoint).
3. Verifikasi: `tsc --noEmit`, unit test terkait, e2e `printing-sinkronisasi` + `analisa`, probe browser.
4. Deploy setelah semua hijau.
