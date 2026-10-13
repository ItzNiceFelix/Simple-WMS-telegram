# Laporan Progres — Simple-WMS-telegram (dikerjakan semalam)

## Fase 0 — SELESAI ✅ (live + ter-push)

- Worker `simple-wms-telegram` + D1 `simple-wms` (APAC) + auth web.
- `worker/auth.ts`: PBKDF2-SHA256, sesi opaque 12 jam, OTP 6-digit, rate-limit.
- Endpoint: health, setup/owner, login, logout, me, set-password,
  minta-kode (via bot), reset-password.
- Test `worker/auth.test.ts` 5/5 hijau.

## Fase 1 — SELESAI ✅ (live + ter-push, commit `044f046`)

- **Dashboard Next.js live di Cloudflare** via OpenNext (versi `46c41ed9`),
  15/15 halaman termasuk `/masuk` baru. Tanpa pengurangan UI.
- **Cutover Firestore → D1 penuh**:
  - `lib/d1/*` (13 modul): stok+ledger, produk, gudang, transfer (13 aksi
    + CAS), opname (CAS T9), permintaan harian, admin, akses, kamus,
    ledger, pengaturan, guard, route helper.
  - 12 route tulis Next → D1; `GET /api/baca` (11 scope) ganti Firestore SDK.
  - Auth web: `/masuk` + 5 endpoint sesi; provider redirect ke `/masuk`.
- **Terverifikasi live end-to-end**: setup owner → login → baca stok
  (DEMO-002 menipis ✅) → mutasi → tambah gudang → transfer
  setujui→kirim→terima (stok pindah benar) → opname selisih→setujui →
  HPP → reorder → histori. Data uji DIBERSIHKAN (D1 kosong kembali).
- Test D1 `6/6` hijau; typecheck `0 error`.

## Yang belum (butuh kamu)

1. **Migrasi data produksi**: skrip `scripts/migrate-firestore-to-d1.mjs`
   siap (dry-run default). Butuh `GOOGLE_APPLICATION_CREDENTIALS`
   (service account Firestore) — tidak ada di mesin ini. Jalankan dari
   mesin yang punya akses Firebase, atau kirim service account.
2. **Secrets bot (WAJIB sebelum uji Telegram)**: `wrangler secret put
   TELEGRAM_BOT_TOKEN` + `wrangler secret put TELEGRAM_WEBHOOK_SECRET`,
   lalu daftarkan webhook (`setWebhook` + `secret_token` sama). Tanpa ini:
   `minta-kode` 503, webhook tanpa secret lolos 200, balasan `/start /stok`
   tak terkirim. Uji `/start /stok /tambah` + cron drain (`wrangler tail`)
   MENUNGGU secrets ini.
3. **Token `ghp_…` di chat**: REVOKE di github.com/settings/tokens (bocor).
4. **CI workflow**: `.github/workflows/` belum ter-push (token tanpa scope
   `workflow`) — tambah manual via web atau token baru.
5. **Modul e-commerce** (Fase 3) — sesuai PRD.


## Update — Fase 1 SELESAI PENUH ✅ (2026-10-08 pagi)

- Unit: **579/579 hijau** (5 test Firestore usang dihapus, diganti
  `test/guardD1.test.js`; 3 test teks disesuaikan ke implementasi D1).
- E2E: browser diperbaiki (`playwright install --with-deps`); spec
  `/masuk` baru **2/2 lolos**. Full suite 258 test terlalu berat untuk
  sandbox (timeout) — jalankan di CI/Workers Builds.
- Halaman `/masuk` dibebaskan dari AppShell (bug: tertahan splash) —
  terverifikasi visual: form telegramId+password + lupa password.
- Alur login → dashboard "Ringkasan" terverifikasi di browser
  (empty state benar untuk DB kosong).
- Produksi: versi `4b0ea8ce` live, D1 bersih kembali.
- Commit: `8605e67`, ter-push ke repo publik.

## Update — Fase 2 TERDEPLOY ✅ (2026-10-08 siang)

- Bot webhook+command, notify queue+cron `*/5`, Excel import/export live
  (versi `b177de30`, 100% traffic, triggers aktif).
- Fix migrasi supergroup (pola scaFlow v13): webhook tangani
  `migrate_to/from_chat_id`; drain update `chat_id` + retry sekali ke chat
  baru. Notify test `3/3` hijau; typecheck `0 error`.
- Verifikasi produksi: health `db:up`; webhook POST → 200; `/masuk`+`/stok`
  200; Excel template 3 baris preview 3/3 → konfirmasi 3 → stok terbaca
  benar → export 3 baris cocok. Data uji DIBERSIHKAN (D1 kosong kembali).
- Commit: `04fb722`, ter-push ke repo publik.

## Update — Fase 3a Order + Laba SELESAI ✅ (2026-10-08 malam)

- **Order Keluar**: import pesanan MP (template sheet `Pesanan`, 12 kolom),
  filter status/MP, tombol Pack/Kirim/Selesai/Batal; stok ONLINE kurang saat
  Pack (movement `jual_mp`), kembali saat Batal (`retur_mp`), hard-block stok
  negatif.
- **Laba**: omzet/HPP/biaya/PPh 0,5%×omzet per pesanan/PPN → laba + margin;
  filter periode/MP/SKU; filter SKU menampilkan **porsi** SKU (bukan total
  order); export CSV + **PDF** (`pdf-lib`).
- Skema: migrasi `0006` (orders/order_items/order_fees/mp_fee_presets + jenis
  movement MP) + `0007` (index fee). Fresh — tanpa migrasi Firebase.
- Bot: `/laba [7h|30h]` agregat per MP.
- Test: tsc `0 error`; worker `32/32` (auth 5 + notify 3 + d1lib 6 + order 14
  + rekapPdf 3 + route TMA 4); e2e `36/36` (order-laba + histori).
- Review: tiap tugas lewat reviewer independen; final review ketemu 2 regresi
  nyata (Histori rusak oleh jenis movement baru; filter SKU menampilkan angka
  salah) → diperbaiki + diverifikasi ulang.
- Commit Fase 3a: `7fa7ecf`..`8f2f99b` (12 commit), ter-push.
- Belum: Fase 3b (lots/FEFO, cycle count/freeze, valuasi MA); JPG export.

### Catatan teknis (histori implementasi)

- `app/api/order/route.ts`: `HEADER_PESANAN` tak lagi di-export (export
  non-route memecah `next build`); `test:worker` bundle `auth.test` via esbuild.
- `filter-branch` dipakai untuk mengeluarkan `.github/workflows` dari riwayat
  Fase 3a (belum ter-push saat itu) — isi kode tak berubah, hanya hash commit.

## Cara pakai sekarang

1. Buka `https://simple-wms-telegram.bagus-deva-nov-p.workers.dev/api/setup/owner`
   sekali (buat owner pertama), atau POST tg_id + password.
2. Buka `/masuk`, login dengan telegramId + password.
3. Dashboard penuh dengan data D1 (kosong — import/migrasi dulu).

## Perbaikan Bug Produksi (2026-10-13)

Tiga bug dilaporkan owner, semua sudah diverifikasi akar masalahnya lewat query langsung ke D1 produksi.

### B1 — Import Order.toship error 500
**Akar:** `lib/d1/advanceBelumSku.ts` menjalankan `SELECT sku, nama FROM products`, padahal kolomnya bernama `nama_accurate`. D1 mengembalikan `no such column: nama` → handler tanpa try/catch → 500. Terbukti via query produksi: `no such column: nama at offset 12: SQLITE_ERROR [code: 7500]`.
**Pemicu:** setiap file Order.toship yang punya baris tanpa `Nomor Referensi SKU` memanggil `tebakSku`, jadi bug ini selalu kena.
**Fix:** dua query diganti `nama_accurate AS nama`.

### B1b — Bonus: `SELECT sku, lokasi FROM products` di picklist Advance
**Akar:** kolom `lokasi` tidak ada di `products` maupun `stock_by_bin`. Data lokasi rak tidak pernah ada di skema.
**Fix:** kolom PDF "Bin" diganti "Kirim Ke", bersumber `advance_bookings.antar_ke` yang memang terisi.

### B2 — Owner tidak bisa menjadikan orang admin ("Origin tidak diizinkan")
**Akar ganda:**
1. `DASHBOARD_ALLOWED_ORIGINS` kosong di `wrangler.jsonc`. Hostname produksi (`bagus-deva-nov-p`) ≠ suffix hardcode (`bagus-deva-n-p`) → allowlist kosong + produksi = 403.
2. Forwarder `/api/admin/role` (dan `tambah`/`hapus`) membangun `Request` BARU hanya dengan `content-type` + `cookie`, **membuang header `Origin`** → handler dalam melihat "POST tanpa Origin" → 403.
**Fix:** allowlist diisi origin produksi; helper `lib/d1/forwardAdmin.ts` meneruskan header asli termasuk `Origin`.

### B3 — User terdaftar tanpa nama (hanya telegramId)
**Akar:** `worker/bot.ts` `/daftar` memanggil `mintaAkses(db, tgId, null, u?.display_name ?? tgId)`; karena user belum ada di `users`, `u` selalu null → nama = telegramId. Approval menyalin placeholder itu (`req.telegram_display_name ?? String(tgId)`). Tidak ada langkah tanya-nama di webhook D1 (handler legacy `lanjutkanKenalan` tidak diport). Tidak ada jalur perbaikan nama sama sekali.
**Fix:** bot meneruskan `msg.from` → `namaUser()` (first+last name); `akses.ts` tidak lagi fallback ke telegramId; ditambah **aksi `ubah-nama`** (lib + API + UI dialog di tabel admin). Data produksi yang telanjur salah sudah dibersihkan.

## Perbaikan Import Order.toship (2026-10-13, lanjutan)

Diuji dengan file produksi nyata 861 baris / 811 order unik.

### B4 — 155 order hilang saat import
**Akar:** `orderImportShopee.ts` men-`continue` baris tanpa SKU SEBELUM masuk ke `g.items`. Order yang SELURUH barisnya tanpa SKU jadi punya 0 item → dibuang ke `gagal` ("Tak ada baris dengan SKU"). Barangnya ada di file, tapi order tidak pernah dibuat.
**Dampak:** 649 dari 804 order valid (155 hilang, 19%).
**Fix:** baris tanpa SKU tetap dimasukkan ke `g.items` dengan `sku: ""`. Item dengan `sku === ""` tidak dianggap "SKU tak dikenal". Saat konfirmasi, SKU diisi dari pilihan manual; bila ditandai "Belum di MP", item dilewati dari `order_items` tapi dicatat di `sku_belum_mp`.
**Hasil:** orders 649 → 804, gagal 156 → 1.

### B5 — Dropdown pilih SKU tidak bereaksi
**Akar:** dialog memanggil `/api/produk?limit=500` yang **tidak ada** (404). Daftar SKU master selalu kosong → Select tanpa item.
**Fix:** pakai `/api/baca?scope=produk` (sudah menyediakan daftar produk).

### B6 — Checkbox "Belum di MP" tanpa penjelasan
Ditambah teks penjelas: baris tanpa SKU di file Shopee → pilih SKU master ATAU centang "Belum di MP" bila barangnya memang belum terdaftar (dicatat sebagai daftar tunggu).

### Fitur — Rincian item per order
Tombol "N item" pada baris order membuka dialog rincian (SKU, nama Shopee, variasi, qty, subtotal). Baris dengan SKU+variasi sama sudah digabung otomatis; variasi berbeda tetap terpisah (mis. MERAH vs BIRU = 2 item, bukan digabung).
`ambilOrder` + `OrderItem` kini membawa `variasi` & `nama_shopee`.

## Efisiensi Preview Import Order (2026-10-13)

### Pengelompokan baris "Perlu SKU"
**Masalah:** baris tanpa SKU tampil satu per satu — file nyata punya 176 baris, padahal hanya 20 produk unik. "PISAU SET DAPUR 3IN1" muncul di 128 order dan harus dipetakan 128 kali.

**Fix:** `normalisasiSheetShopee` mengelompokkan per (nama_shopee, variasi) IDENTIK → satu baris preview mewakili semua order anggotanya.
- `BarisBelumSku` dapat field baru: `order_refs` (semua No. Pesanan), `jumlah_order`, `qty_total`.
- Kolom **Order** menampilkan `"128 order"` + `order_ref +127 lagi` (hover = daftar lengkap).
- Kolom **Qty** menampilkan total qty grup.
- Urut dari grup terbesar supaya yang paling menghemat tampil di atas.
- SKU yang dipilih diterapkan ke SEMUA order anggota (`flatMap` di client); "Belum di MP" juga menandai semua anggota.
- Variasi BEDA tetap terpisah (MERAH vs BIRU = 2 baris) — sengaja, supaya varian tidak tercampur.

**Bonus:** tebakan SKU otomatis (`tebakSku`) turun dari 176 query → 20 query, karena satu grup = satu tebakan.

**Hasil pada file nyata:** 176 baris → 20 baris preview (hemat 156 klik / 89%). Total order terwakili tetap 176 — tidak ada yang hilang.
