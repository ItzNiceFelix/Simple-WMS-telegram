# PRD — Simple-WMS-telegram

> Repo publik: `ItzNiceFelix/Simple-WMS-telegram` · Basis: duplikat `Bot-Admin-Toko` (commit `9175952`) + pola terbukti `scaFlow` (Worker `scanflow` + D1 + Mini App).
> Status: DRAFT v1 · Tanggal: 2026-10-07
> Catatan: repo duplikat sengaja **tanpa** `.github/workflows/` (token butuh scope `workflow` untuk push file workflow).

---

## 1. Visi & Ruang Lingkup

Membangun **WMS advanced untuk UMKM Indonesia** yang berjalan penuh di **Cloudflare** (Workers + D1 + Assets), dengan **bot Telegram + Mini App + website login mandiri**, mendukung gudang konvensional **maupun** pelaku usaha **e-commerce/marketplace**.

Prinsip:

1. **Migrasi penuh Vercel + Firebase → Cloudflare**, tanpa mengurangi tampilan/fitur UI yang sudah ada di dashboard Next.js.
2. **Tanpa Firebase** — sesi, data, dan auth pindah ke D1 (+ KV hanya cache opsional).
3. **Tema UI/UX ikut proyek utama** — desain baru mengikuti bahasa visual dashboard Bot-Admin-Toko (Tailwind/shadcn), dipadukan dengan token desain scaFlow (industrial slate + stock green) untuk layar operasional gudang.
4. **Gabung fungsi scaFlow** — auth Mini App (initData HMAC), session cookie, notify queue + cron, lifecycle grup Telegram, dan UX scanner satu-tangan dipakai ulang, bukan ditulis ulang.

---

## 2. Arsitektur Target

```
Browser / Mini App (Telegram) / Bot Telegram
        │                │              │
        ▼                ▼              ▼
Cloudflare Worker (tunggal, nodejs_compat)
  ├─ /api/*      → REST JSON (auth cookie sfsess-style)
  ├─ /api/telegram/webhook → Bot API (secret header, selalu 200)
  ├─ /*          → ASSETS (SPA hasil build Next.js → static export)
  └─ scheduled() → cron: notifikasi batch, laporan, rekonsiliasi
D1 (SQLite serverless): SEMUA data — users, sessions, produk, stok,
  ledger, gudang/rak/bin, receiving, transfer, opname, pesanan MP, fees
KV (opsional): cache read-through klasifikasi/AI, BUKAN sumber sesi
Secrets: SESSION_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
  AI keys (Gemini/Groq/Kenari/OpenAI/OpenRouter)
```

Keputusan arsitektur (hasil riset):

| Keputusan | Alasan |
|---|---|
| D1 sebagai satu-satunya database | Ledger butuh JOIN + transaksi atomik (`D1Database.batch()`); UMKM muat dalam limit D1 (Free 500MB/DB, Paid 10GB/DB). Pindah ke Postgres bila >10GB / tulis konkuren tinggi / realtime multi-gudang |
| Sesi di D1, bukan KV | KV Free: 1.000 writes/hari + eventual-consistency — tidak layak untuk sesi. Tabel `sessions(id/token_hash, user_id, expires_at, revoked_at, ip/ua)` + cookie HttpOnly Secure SameSite=Lax |
| Hash password PBKDF2-SHA256 via WebCrypto | Workers tidak punya bcrypt native; PBKDF2 100k+ iterasi + salt 16 byte cukup untuk v1 |
| Excel via SheetJS CE (`xlsx`) | Ada demo resmi Cloudflare Workers; hindari `exceljs` (berat, butuh Node Buffer/stream). File >5MB → tawarkan CSV |
| PDF via `pdf-lib` di Worker | Pure JS tanpa native. JPG: render di client (canvas/html2canvas) — Workers tidak punya Canvas; jangan render image berat di Worker v1 |
| Next.js → static export ke ASSETS | UI tidak berubah; `next build` + output statis diserve binding ASSETS (`not_found_handling = single-page-application`, pola terbukti scaFlow) |
| Bot AI (Gemini/Groq/dkk) tetap | `lib/ai/registry.js` + tool-calling dipindah ke Worker (via fetch API masing-masing provider); rate-limit pindah dari in-memory ke D1/KV agar terdistribusi |

Sumber batasan: [D1 limits](https://developers.cloudflare.com/d1/platform/limits), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing), [KV limits](https://developers.cloudflare.com/kv/platform/limits).

---

## 3. Modul Fitur

### F1. Auth Web + Akun (tanpa Telegram Mini Apps)

- **F1.1 Login web mandiri**: form `telegramId + password`. Password di-set di **menu Profile pada Mini App (TMA)** — bukan di web.
- **F1.2 Lupa password**: tombol "Lupa password" → user input telegramId → **bot mengirim kode verifikasi** (6 digit, TTL 5–10 menit, tabel `auth_codes`) ke chat user → user input kode + password baru di web.
- **F1.3 Verifikasi kepemilikan**: pola OTP-bot dua arah dipakai ulang (login password sukses → OTP via `sendMessage` ke tg_id terdaftar → input di web), mengikuti pola sesi `sfsess` scaFlow (HMAC-SHA256, TTL 12 jam, `requireUser/requireRole`, `assertNotLastAdmin`).
- **F1.4 RBAC**: `owner/admin/staff` (ganti `packer/admin/super` scaFlow) × scope gudang (`user_warehouses`), enforce **di server per query**, bukan filter UI. Bootstrap: user pertama = owner.
- **F1.5 Audit login**: tabel `login_audit` (tg_id, ip/ua, sukses/gagal, at); rate-limit 5 gagal/15 mnt → lock sementara.
- P1: Login Widget Telegram (HMAC `initData`, `auth_date` <24 jam) sebagai alternatif. YAGNI v1: OIDC, TOTP 2FA.

### F2. Migrasi Cloudflare Penuh (refactor besar)

- **F2.1** Pindahkan 15 koleksi Firestore → skema D1 relasional (§5). Ledger `stock_moves` immutable jadi sumber kebenaran (stok = `SUM(qty)`), bukan dokumen qty yang ditimpa.
- **F2.2** `api/webhook.js` (Vercel) → `src/api/telegram.js` di Worker (pola `callBot/chunkMessage/sendMessage/secretMatches`, constant-time compare, selalu 200).
- **F2.3** 15+ route Next.js (`app/api/*`) → endpoint Worker `GET/POST /api/*`; tulis butuh sesi + guard idempotensi (`idempotency_keys`).
- **F2.4** Cron GitHub Actions (sync master 06:00, reminder 07:00) → `scheduled()` Worker (notif batch per menit pola `notify_queue` + laporan harian).
- **F2.5** Dashboard Next.js → static export, diserve ASSETS. **Tidak ada pengurangan tampilan**: semua halaman (`stok, produk, permintaan, permintaan-gudang, gudang, opname-gudang, draft, histori, kata-kunci, admin, pengaturan`) + 27 Playwright specs harus tetap hijau.
- **F2.6** Google Sheets: dari "sumber master" turun jadi **sumber import opsional** (template Excel §F3 adalah jalur utama); sync dua-arah dihapus, diganti import 2-fase + rekonsiliasi.

### F3. Import / Export Excel (template dari kita)

- **F3.1 Template resmi** (sheet `Produk`, `StokOpname`, `HPP-Update`, `Pesanan`, + sheet `PANDUAN`): header baris-1 `SKU* | Nama* | Kategori | Satuan* | StokAwal | HPP | HargaJual | Rak/Bin | StokMin | Barcode | Expired(YYYY-MM-DD) | Aktif`. Contoh 3 baris + dropdown validasi. Export memakai header sama (round-trip).
- **F3.2 Alur 2-fase**: upload (≤5–10MB) → parse di Worker → validasi per baris (tipe, duplikat SKU dalam file, FK kategori) → **preview sukses/gagal** (no. baris + pesan) → tombol Konfirmasi → eksekusi `D1Database.batch()` atomik (chunk 50–200 stmt, `INSERT … ON CONFLICT(sku) DO UPDATE`, normalisasi SKU trim/upper). Gagal satu → rollback semua.
- **F3.3** `import_batches` + `import_errors` untuk audit. Cocok untuk migrasi dari app akuntansi/WMS lain (Kledo/Accurate/Jurnal) — user petakan kolom mereka ke template sekali, lalu import.
- **F3.4 Export**: stok, HPP, produk — per gudang / semua / by filter (kategori, status, search). Tombol kirim hasil via bot ke Telegram.
- P1: riwayat batch + template `HPP-Update` massal. YAGNI: XLSB/XLS legacy, formula engine.

### F4. Inti WMS Advanced (naik dari Basic)

| Fitur | Spesifikasi minimal |
|---|---|
| Lokasi bertingkat | `warehouses → zones → bins(id, code UNIQUE, kapasitas)` + `stock_by_bin(sku, bin, qty)`; putaway terpandu (saran bin by kapasitas/zona) |
| Receiving + QC + Putaway | `receivings(id, supplier, status draft/QC/pass/quarantine)` → lolos masuk bin, gagal ke bin quarantine. Pengganti `tambahStok` langsung |
| Pick → Pack → Ship | `pick_lists` per pesanan/transfer; pack = scan validasi; ship = resi + kurir (gabung mesin `resi/couriers` scaFlow: 9 kurir seed + regex prefix) |
| Transfer in-transit + partial | `transfers(..., status in_transit/received/partial)`; `qty_kirim` vs `qty_terima`; sisa tetap in-transit dan **masuk laporan** (pelajaran ERPNext Add-to-Transit; menutup risiko D3a) |
| Reservasi | `available = on_hand − reserved`; reservasi saat order dikonfirmasi, lepas saat cancel/ship — cegah oversell MP |
| Batch/expiry + FEFO | `lots(sku, batch_no, expired_at, qty)`; alokasi keluar = expired tercepat; blokir lot expired/quarantine |
| Barcode/RF | SKU = Code128, unit/batch = QR; scan via PWA kamera (`html5-qrcode`) — tanpa alat khusus; UX scanner scaFlow dipakai ulang (input mono besar, autofocus, guard ganda, haptic+beep WebAudio) |
| Cycle count + freeze | Opname per bin bergilir (ABC/fast-moving sering); freeze = kunci bin selama hitung (transaksi ke bin terkunci → 409); selisih jadi adjustment ber-approval |
| Kartu stok / ledger | `stock_moves(sku, bin, jenis IN/OUT/ADJ/TRANSFER, qty, hpp_snapshot, ref, at, by)` immutable; kartu stok = query per SKU |
| Valuasi | Default Moving Average perpetual (pola ERPNext); FIFO opsional; LIFO dilarang (IFRS) |
| Stok negatif | Hard-block di server (seperti Kledo `400 Stok tidak cukup`); sinyal negatif lama dihapus |

### F5. Modul E-Commerce / Marketplace (khusus pelaku usaha online)

- **F5.1 Master MP**: `mp_products(sku_internal, nama_mp, harga_jual_mp, marketplace)` — import nama + harga jual per marketplace (Shopee/Tokopedia/TikTok/Lazada).
- **F5.2 Import barang terjual harian**: template `Pesanan` (`NoPesanan*, Marketplace*, Tanggal*, SKU*, Qty*, HargaSatuan*`) → tabel `orders(no_pesanan PK per MP, tanggal, buyer, status)` + `order_items(sku, qty, harga_satuan, hpp_snapshot, subtotal)`. Satu No. Pesanan boleh multi-item multi-qty. Untuk analisa harian/mingguan/bulanan.
- **F5.3 Biaya & pajak (multi, fleksibel)**: `order_fees(order_id, jenis[admin|service|komisi|ongkir|voucher|affiliate|iklan|lain], basis[flat|persen], nilai, amount)`. Preset per MP (biaya kategori Shopee/Tokopedia) + pajak PPh UMKM 0,5% toggle + PPN opsional. Boleh >1 biaya, persen maupun flat.
- **F5.4 Rumus laba** (beban dihitung **per 1 No. Pesanan**, berapa pun itemnya):
  - `Omzet = Σ(qty × harga_satuan)`
  - `Total HPP = Σ(qty × hpp_snapshot)`
  - `Total Biaya = Σ(fee: persen × Omzet + flat)`
  - `Total Pajak = sesuai setting`
  - **`Laba/Rugi = Omzet − HPP − Biaya − Pajak`**, `Margin = Laba/Omzet × 100%`
  - Laba per SKU = alokasi proporsional `subtotal/Omzet` atas biaya level order.
- **F5.5 Laporan**: rekap per pesanan + agregat per periode/MP/SKU; **export PDF** (`pdf-lib` di Worker) dan **JPG** (render client-side); kirim via bot ke Telegram.
- Referensi struktur biaya: [Shopee fees](https://seller.shopee.sg/edu/article/16478/seller-fees-calculation), [kalkulator V3](https://kira.pja.my/shopee).

### F6. Bot Telegram + Mini App (gabungan kedua proyek)

- Perintah existing (`/sync_stok` → ganti jadi import preview, `/histori_stok`, admin/role/settings) tetap; tambah: `/laba [periode]`, `/laporanharian`, `/link KODE` (bind web), `/kode` (minta kode verifikasi lupa password).
- Chat AI + vision picking list + opname (Gemini/Groq/Kenari) dipindah ke Worker; rate-limit di D1 (terdistribusi, bukan in-memory).
- **Pakai 1:1 dari scaFlow**: `notify_queue` + `drainQueue` (limit 25, retry 5) + `batchProblemEvents` + `buildReportText` tabel 42-kolom; lifecycle grup (`handleGroupMigration`, merge duplikat, retry langsung); session scan-out + watermark untuk opname/handover; klasifikasi regex untuk tebak kategori SKU.
- Tema Mini App: token scaFlow (slate + `#059669`, 3 status warna, tabbar bawah, kartu, beep/haptic) menyatu dengan komponen shadcn dashboard.

### F7. Non-fungsional

- Bahasa Indonesia (ID) default; format tanggal WIB, angka `id-ID`.
- Aksesibilitas WCAG AA (kontras 4.5:1, target sentuh ≥48px) mengikuti komentar CSS scaFlow.
- Test: `node:test` untuk logika Worker + Playwright untuk web (27 specs existing wajib hijau); tambah spec: login web, lupa-password OTP, import preview, laba per pesanan.
- Observabilitas: `action_logs` append-only; alert cron gagal ke owner via bot ( existing behavior dipertahankan).
- Kuota: patuhi limit D1/KV Free; tampilkan pemakaian di halaman pengaturan bila mendekati batas.

---

## 4. Migrasi Data (Firestore → D1)

| Firestore | D1 | Catatan |
|---|---|---|
| `stock` + `qty_per_gudang` | `products` + `stock_by_bin` + `stock_moves` | Pecah hotspot dokumen; qty awal = movement `OPENING` |
| `products` (+variants) | `products` + `product_variants` + `mp_products` | Varian Shopee → varian umum + nama MP |
| `stock_movements` | `stock_moves` | Tambah `bin_id, hpp_snapshot`; immutable |
| `gudang` | `warehouses` (+`zones`, `bins`) | Flat → bertingkat; ONLINE jadi warehouse khusus |
| `permintaan_gudang` | `transfers` | Tambah `qty_kirim/terima`, status in-transit |
| `opname_gudang` | `stock_counts` (+`count_lines`) | Tambah freeze + ABC schedule |
| `daily_requests` | `daily_requests` | Struktur sama |
| `admins`/`accessRequests`/`sessions` | `users`/`access_requests`/`sessions` | Password hash + `auth_codes` baru |
| `keyword_notes` | `keyword_notes` | Struktur sama |
| `system_settings/ai` | `settings` | Key-value umum |
| Google Sheets master | template Excel F3 | Import awal via template, bukan sync |

Script migrasi sekali jalan (`scripts/migrate-firestore-to-d1.mjs`): baca Firestore via Admin SDK → tulis D1 via batch → verifikasi count per tabel → laporan discrepancy (tanpa auto-timpa).

---

## 5. Skema D1 (ringkas — DDL penuh di fase implementasi)

```
users(id, tg_id UNIQUE, username, display_name, password_hash, password_set_at,
      role[owner|admin|staff], active, notify_problem)
user_warehouses(user_id, warehouse_id)          -- scope gudang
sessions(token_hash PK, user_id, expires_at, revoked_at, ip, ua)
auth_codes(id, tg_id, code_hash, purpose[reset|link|otp], expires_at, used_at, attempts)
login_audit(id, tg_id, ip, ua, sukses, at)
warehouses(id, code UNIQUE, nama, aktif, urutan, is_online)
zones(id, warehouse_id, code, nama)
bins(id, zone_id, code UNIQUE, kapasitas, aktif)
products(sku PK, nama, kategori_id, satuan, hpp, harga_jual, stok_min, barcode UNIQUE, aktif)
product_variants(id, sku, variasi, nama_mp)
mp_products(id, sku, marketplace, nama_mp, harga_jual_mp)
stock_by_bin(sku, bin_id, qty)                  -- PK komposit
stock_moves(id, sku, bin_id, jenis, qty, hpp_snapshot, ref_type, ref_id, at, by)
lots(id, sku, batch_no, expired_at, qty, status)
reservations(id, sku, bin_id, qty, ref_type, ref_id, status, at)
receivings(id, supplier, status, at, by) + receiving_lines(id, receiving_id, sku, qty, qc)
pick_lists(id, ref_type, ref_id, status, at) + pick_lines(...)
transfers(id, dari_bin, ke_bin, qty_kirim, qty_terima, status, at, by)  -- ganti permintaan_gudang
stock_counts(id, bin_id, status, freeze, at, by) + count_lines(...)
orders(no_pesanan, marketplace, tanggal, buyer, status) + order_items(...) + order_fees(...)
couriers + courier_prefixes + resi + scan_sessions + scan_events      -- dari scaFlow
notify_queue + groups + problem_events        -- dari scaFlow
import_batches(id, tipe, file, total, sukses, gagal, at, by) + import_errors(...)
idempotency_keys(key PK, at)  +  action_logs(...)  +  settings(key PK, value)
```

---

## 6. Prioritas & Tahapan

- **Fase 0 — Fondasi**: Worker + D1 + ASSETS hello-world; skema §5; auth F1 + migrasi user; CI deploy `wrangler deploy`.
- **Fase 1 — Paritas**: F2 (semua halaman dashboard hidup, Playwright hijau) + migrasi data §4; Sheets jadi import opsional.
- **Fase 2 — WMS advanced**: F4 (bin → receiving/QC → pick/pack/ship → transfer in-transit/partial → reservasi → barcode) + F3 import/export.
- **Fase 3 — E-commerce**: F5 (master MP → import pesanan → biaya/pajak → laba → PDF/JPG) + batch/expiry/FEFO + cycle count/freeze + valuasi MA.
- **Fase 4 — Polish**: Login Widget HMAC, preset fee per MP, JPG client, dashboard analitik, hapus total sisa Firebase/Vercel.
- **YAGNI**: multi-cabang penuh, wave/cluster picking, slotting AI, 2D floor plan, OIDC/TOTP, XLSB, PDF browser berbayar, akuntansi double-entry, realtime multi-gudang.

---

## 7. Risiko Terbuka

1. **Next.js static export vs fitur dinamis** — halaman yang butuh SSR harus jadi CSR + API Worker; verifikasi per halaman di Fase 1.
2. **AI di Worker** — tool-calling loop + upload foto (vision) lewat batas body/worker; fallback: endpoint khusus + batas ukuran 5MB, atau pindahkan vision ke Pages Function terpisah.
3. **Limit D1 Free saat import massal** — chunk batch + tampilkan estimasi row-write sebelum konfirmasi.
4. **Token GitHub di chat** (`ghp_…` 7 Okt) — anggap bocor; revoke dan ganti sebelum repo publik menerima kontribusi.
5. **`.github/workflows/` belum ter-push** — butuh token scope `workflow`; CI nonaktif sampai ditambahkan manual via web GitHub.
