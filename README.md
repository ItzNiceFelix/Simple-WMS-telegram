# Bot Admin Toko

Bot Telegram untuk admin toko online: cek stok gudang online, HPP, dan info produk; mencatat pemakaian stok dari screenshot picking list; stok opname; sinkronisasi stok dengan Google Sheets; serta menjawab pertanyaan bebas lewat AI (Gemini/Groq) berbasis tool-calling ke Firestore. Berjalan sebagai Vercel Serverless Function (Node.js CommonJS) dengan Firestore sebagai database dan Google Sheets sebagai sumber master data produk.

## Fitur utama

- **Chat AI bahasa natural** — tanya stok, HPP, info produk, daftar stok menipis, dsb. AI memanggil tool nyata ke Firestore, tidak menebak angka.
- **Catat pemakaian stok dari screenshot picking list** — kirim foto picking list, bot ekstrak (Gemini vision), cocokkan nama produk (fuzzy match), minta konfirmasi, lalu kurangi stok / masukkan daftar minta ke gudang sebelah.
- **Stok opname** — kirim daftar hasil hitung fisik (teks atau screenshot dengan caption `opname`/`hitung`); bot bandingkan dengan stok sistem, apply hanya item cocok/selisih wajar.
- **Ubah stok manual lewat chat** — "kurangi stok X 3", "barang datang A 2, B 50" → ringkasan konfirmasi, eksekusi setelah admin setuju (jalur tunggal maupun batch).
- **Sync stok dua arah Firestore ↔ Google Sheets** — `/sync_stok` menampilkan diff, direview per kelompok sebelum ditulis (Firestore selalu jadi acuan).
- **Sync master data otomatis** — Google Sheets → Firestore tiap pagi (GitHub Actions): kode barang, nama accurate, HPP, varian Shopee, flag online.
- **Reminder proaktif** — notifikasi reaktif saat stok di bawah reorder point + reminder harian proyeksi stok menipis dari tren pemakaian.
- **Manajemen admin & akses** — approval user baru oleh Super Admin, role owner/admin/guest, daftar/ubah/revoke admin.
- **Kamus penanda adaptif** — arti kolom penanda picking list dipelajari (`keyword_notes`) dan dipetakan ke aksi stok.
- **Fallback AI & rate limit** — provider teks bisa diganti via `/settings` (Groq↔Gemini), rate limit per user, timeout Google Sheets, validasi env fail-fast, alert cron gagal ke owner.

## Arsitektur singkat

```
Telegram ──webhook──> api/webhook.js (validasi secret + env, waitUntil)
                            │
                            ▼
                    lib/router/routePesan.js
              (filter DM/grup, gating akses, dispatch)
                    ├─ /command ──> lib/router/handleCommand.js (DAFTAR_COMMAND)
                    ├─ teks biasa ─> cek draft pending (picking/opname/sync/kolom)
                    │                  └─> lib/gemini/chatHandler.js (loop tool-calling)
                    ├─ foto ──────> caption "opname"/"hitung" ? handleOpname()
                    │                                 : handleScreenshotPickingList()
                    └─ callback ──> handleKonfirmasiCallback / handleApprovalCallback / handleSettings
                            │
        Firestore (sessions, stock, products, stock_movements, ...) 
        Google Sheets (DATABASE_ACCURATE, Mapping) via lib/sheets/
```

Cron terpisah (GitHub Actions, bukan webhook):
`sync-master-data.yml` (06:00 WIB) dan `reminder-harian.yml` (07:00 WIB) memanggil script Node di `scripts/`.

## Daftar command

| Command | Fungsi | Akses |
|---|---|---|
| `/start` | Sapaan awal + ringkasan kemampuan bot | semua |
| `/help` | Daftar command | semua |
| `/reset` | Reset history percakapan | semua |
| `/batal` | Batalkan draft/konfirmasi pending (history tetap disimpan) | semua |
| `/sync_stok` | Sinkronisasi stok Firestore ↔ Google Sheets (direview dulu) | admin |
| `/list_admins` | Tampilkan daftar admin | Super Admin |
| `/revoke_admin <user_id>` | Cabut akses admin | Super Admin |
| `/set_role <user_id> <owner\|admin\|guest>` | Ubah role user | Super Admin |
| `/settings` | Pilih provider AI teks (Gemini/Groq) | Super Admin |
| `/histori_stok [kode]` | Lihat histori perubahan stok | owner/admin |

Selain command: kirim **foto picking list** atau **foto dengan caption `opname`/`hitung`**, dan teks bebas untuk chat AI.

## Struktur folder

```
api/                Entry point Vercel (webhook Telegram, secret header, waitUntil)
lib/
  config/           Validasi env fail-fast per konteks (webhook/cron/script)
  firebase.js       Init Firebase Admin singleton
  gemini/           Integrasi AI: client + fallback, tool-calling, rate limit, vision, prompt
  handlers/         Alur fitur: picking list, opname, admin, approval, settings, callback
  matching/         Fuzzy match nama produk (token overlap + typo ringan) & pencarian pintar
  models/           CRUD koleksi Firestore (sessions, stock, products, admins, dst.)
  reminder/         Notifikasi reorder point (reaktif) & reminder harian proyeksi
  router/           Dispatch update Telegram: routePesan, handleCommand
  sheets/           Google Sheets API client + sync master data & sync stok dua arah
  telegram/         Wrapper Telegram Bot API (kirim/edit/hapus pesan, download file)
scripts/            Entry point CLI untuk cron GitHub Actions + verifikasi admin
test/               Test suite (node:test) + helper mock Firestore
docs/               Dokumentasi arsitektur & operasional
```

## Setup lokal

```bash
npm install
```

Salin `.env.example` → `.env` dan isi semua variabel (lihat daftar di bawah). Jalankan:

```bash
npm run dev      # = vercel dev
```

`vercel dev` meng-inject env dari file `.env` lokal (proyek ini sengaja tanpa `dotenv`).

Set webhook Telegram ke URL function Vercel (butuh URL publik HTTPS):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<domain>/api/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Env yang dibaca proyek (lihat `.env.example`):

- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`
- Firebase: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- AI: `GEMINI_API_KEY`, `GROQ_API_KEY`, `AI_PROVIDER_TEXT`, `GEMINI_TIMEOUT_MS`, `GEMINI_TOTAL_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MINUTE`
- Sheets: `GOOGLE_SHEETS_ID`, `GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`, `SHEETS_TIMEOUT_MS`
- Akses: `SUPER_ADMIN_ID`

## Testing

```bash
npm test
```

Menjalankan `node --test "test/**/*.test.js"` (30 test). Tidak butuh kredensial nyata: test yang menyentuh Firestore memakai `test/helpers/mockFirestore.js`, yang lain mengisi env dummy. CI (`.github/workflows/ci.yml`) menjalankan `npm ci && npm test` tiap push/PR ke `main`.

## Deploy

1. Set semua env variable di dashboard Vercel (Project Settings → Environment Variables). Untuk `FIREBASE_PRIVATE_KEY`/`GOOGLE_SHEETS_PRIVATE_KEY`, paste private key apa adanya (Vercel menangani `\n`).
2. Deploy. `vercel.json` menaikkan `maxDuration` function `api/*.js` menjadi 300 detik.
3. Terapkan index Firestore yang dibutuhkan (lihat `firestore.indexes.json`):

```bash
firebase deploy --only firestore:indexes
```

## Cron GitHub Actions

| Workflow | Jadwal (WIB) | Job | Env yang dibutuhkan |
|---|---|---|---|
| `sync-master-data.yml` | 06:00 (23:00 UTC) | `node scripts/jalankanSyncMasterData.js` | `FIREBASE_*`, `GOOGLE_SHEETS_*`, `TELEGRAM_BOT_TOKEN` (alert) |
| `reminder-harian.yml` | 07:00 (00:00 UTC) | `node scripts/jalankanReminderHarian.js` | `FIREBASE_*`, `TELEGRAM_BOT_TOKEN` |

Keduanya memakai GitHub Environment `production` — simpan nilai sebagai **Environment secret**, bukan Repository secret, karena job mendeklarasikan `environment: production`. Bisa juga dipicu manual lewat `workflow_dispatch`.

## Catatan operasional

- **Rate limit AI bersifat in-memory** (`lib/gemini/rateLimit.js`): per warm instance Vercel, bukan terdistribusi. Batas efektif bisa lebih longgar saat request tersebar ke beberapa instance — ini soft guard, bukan kuota keras. Default 20/menit per user (`AI_RATE_LIMIT_PER_MINUTE`).
- **Provider teks** default Groq (fallback otomatis ke Gemini saat 429/503/jaringan). Vision (baca screenshot) selalu lewat Gemini, tidak mengikuti provider teks.
- **Zona waktu**: jadwal cron ditulis UTC tapi dirancang untuk 06:00/07:00 WIB. Notifikasi error cron memakai `Asia/Jakarta`. ID dokumen `daily_requests` memakai tanggal lokal server.
- **Kunci private key**: nilai `FIREBASE_PRIVATE_KEY`/`GOOGLE_SHEETS_PRIVATE_KEY` berisi `\n` literal; kode melakukan `.replace(/\\n/g, "\n")` saat init.
- **Firestore sebagai sumber kebenaran** untuk stok: saat sync, nilai Firestore yang menang dan ditulis ke Sheets (Sheets hanya jendela tampilan).
- **Cache in-memory**: `products` (5 menit) dan `stock` (1 menit) di-cache per warm instance untuk menekan biaya baca Firestore; di-invalidasi saat data berubah.
- **Webhook selalu balas 200** ke Telegram; proses berat dijalankan via `waitUntil` agar Telegram tidak retry berulang.