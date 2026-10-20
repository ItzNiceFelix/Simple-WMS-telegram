# 11 — Bot Telegram (webhook, router, handlers, notifikasi)

## Ringkasan area

- Dua stack bot hidup berdampingan: (A) jalur AKTIF di Cloudflare Worker — `worker/index.ts` → `worker/bot.ts` → `lib/d1/*` + `lib/ai/*` (D1 sebagai sumber data); (B) jalur legacy Vercel CJS — `api/webhook.js` → `lib/router/*` → `lib/handlers/*` → `lib/gemini/*` → `lib/models/*` (Firestore).
- Jalur A yang dipanggil Telegram produksi: route `/api/telegram/webhook` ditangkap di `worker/index.ts` SEBELUM OpenNext/Next.js, jadi `api/webhook.js` (Vercel) tidak lagi jadi pintu utama deploy Worker.
- Isi peta: penerimaan update, penentu "bot harus merespon", daftar command + handler, callback tombol, ekstraksi picking list/opname, dan notifikasi keluar (queue cron + pesan reaktif).
- TIDAK termasuk: halaman/API dashboard (`app/api/*` selain `ai/gambar/kirim-telegram`), isi `lib/d1/*` sebagai data layer (lihat peta Database), alur Sheets dua arah (`lib/sheets/*`), dan printing/PDF.
- Batas penting: `lib/models/*.js` masih Firestore (era lama) sedangkan `lib/d1/*.ts` D1; satu fitur bisa punya dua implementasi yang beda perilaku.

## Peta file

| file | peran | export/entry penting |
|---|---|---|
| `worker/index.ts` | Router Worker: webhook bot, `/api/*` lain, cron | `fetch`, `scheduled` (panggil `tanganiWebhook`, `tanganiApi`, `drainTick`) |
| `worker/bot.ts` | Webhook + command bot + jalur foto/AI di Worker | `tanganiWebhook`, `kirimPesanBot`, `kirimPesanTombol`, `editPesan`, `kirimTyping`, `Update` |
| `worker/notify.ts` | Antrean notifikasi + cron drain + laporan harian + sinkron Kledo sore | `antreNotifikasi`, `fanoutNotifikasi`, `drainQueue`, `bangunLaporanHarian`, `drainTick`, `LAPORAN_CRON`, `SINKRON_CRON` |
| `api/webhook.js` | Entry Vercel legacy (secret header, selalu 200, `waitUntil`) | handler default, `apakahRequestValid` (lokal) |
| `lib/router/routePesan.js` | Router legacy: filter DM/grup, gating akses, dispatch teks/foto/callback | `routePesan`, `adalahFotoOpname`; internal `routeMessage`, `routeCallbackQuery`, `gatingAkses`, `cekDraftPending`, `buatCtx` |
| `lib/router/handleCommand.js` | Dispatch command legacy + teks bantuan | `handleCommand`, `DAFTAR_COMMAND` |
| `lib/telegram/apakahBotHarusMerespon.js` | Penentu bot merespon (DM vs grup) + izin screenshot | `apakahBotHarusMerespon`, `apakahBolehProsesScreenshot`, `apakahPesanDiawaliCommand`, `apakahBotDiMention`, `apakahMerupakanReplyKeBot` |
| `lib/telegram/kirimPesan.js` | Wrapper Bot API legacy (fetch, retry tanpa parse_mode, unduh file) | `kirimPesan`, `kirimPesanPlain`, `kirimPesanDenganTombol`, `kirimPesanPanjang`, `jawabCallbackQuery`, `editPesan`, `hapusTombolPesan`, `hapusPesan`, `kirimAksiSedangMengetik`, `unduhFileSebagaiBase64`, `panggilTelegramApi` |
| `lib/telegram/notifikasiError.js` | Alert kegagalan cron script ke owner/admin (best-effort) | `kirimNotifErrorCron`, `susunTeksNotif`, `potongPesanError` |
| `lib/handlers/handleAksesBaru.js` | Gating user baru + sesi "kenalan" + notif Super Admin | `handleAksesBaru`, `apakahMenungguKenalan`, `lanjutkanKenalan`, `kirimNotifKeSuperAdmin`, `PESAN_TOLAK_HALUS` |
| `lib/handlers/handleApprovalCallback.js` | Tombol approve/reject akses + revoke admin | `handleApprovalCallback` |
| `lib/handlers/handleKonfirmasiCallback.js` | Router tombol konfirmasi `pa/pb/op/ss/kolom/pl/cp` | `handleKonfirmasiCallback` |
| `lib/handlers/handleOpname.js` | Opname via screenshot/teks: banding, klasifikasi selisih, draft + apply | `handleOpname`, `apakahAdaPendingOpname`, `konfirmasiOpname` |
| `lib/handlers/handleScreenshotPickingList.js` | Alur C: ekstrak → keyword_notes → match → draft pending | `handleScreenshotPickingList` |
| `lib/handlers/konfirmasiPickingList.js` | Apply draft picking list saat admin jawab "ya" | `apakahAdaPendingPickingList`, `konfirmasiPickingList` |
| `lib/handlers/handleRevokeAdmin.js` | Alur `/revoke_admin` + eksekusi hapus admin | `mulaiRevokeAdmin`, `eksekusiRevokeAdmin` |
| `lib/handlers/handleSetRole.js` | `/set_role` (Super Admin) | `handleSetRole` |
| `lib/handlers/handleSettings.js` | `/settings` pilih provider AI + callback `settings_ai:` | `handleSettings`, `handleSettingsCallback`, `tombolSettings` |
| `lib/matching/cariProdukByNama.js` | Fuzzy match nama→produk (token overlap + Levenshtein ringan) | `cariProdukByNama` |
| `lib/matching/cariProdukPintar.js` | Resolusi terpusat: kolam online dulu, sinyal perlu-konfirmasi-cakupan | `cariProdukPintar`, `cariProdukSemuaKatalog` |
| `lib/gemini/chatHandler.js` | Orchestrator chat teks legacy (loop tool Gemini) | `handleChatBiasa`, `prosesPendingActionViaTombol`, `prosesPendingBatchActionViaTombol`, `prosesKonfirmasiCakupanViaTombol` |
| `lib/gemini/ekstrakPickingList.js` | Gemini vision: gambar → baris `{nama_terbaca, variasi, qty, penanda}` | `ekstrakPickingList` (juga `PROMPT_EKSTRAKSI` internal) |
| `lib/models/keywordNotes.js` | Kamus penanda kolom picking list (Firestore `keyword_notes`) | `ambilActionTypeUntukPenanda`, `cariKeywordNote`, `simpanKeywordBaru`, `konfirmasiKeyword`, `listKeywordNotes`, `perbaruiInterpretasi`, `petakanInterpretasiKeActionType` |
| `app/api/ai/gambar/kirim-telegram/route.ts` | Kirim hasil Studio Gambar ke chat Telegram peminta | `POST` |

## Alur data

### A. Jalur AKTIF (Cloudflare Worker, D1)
1. Telegram → `POST /api/telegram/webhook`; `worker/index.ts::fetch` mencocokkan pathname → `worker/bot.ts::tanganiWebhook` (bandingkan `x-telegram-bot-api-secret-token` vs `TELEGRAM_WEBHOOK_SECRET` via `secretCocok`, constant-time; selalu balas 200) → `ctx.waitUntil(prosesUpdate(...))`.
2. `prosesUpdate`: `my_chat_member` → upsert/`status='left'` tabel `groups`; `callback_query` prefix `ai:` → `tanganiCallbackAi`; `message` dengan `migrate_to_chat_id` → `tanganiMigrasiGrup`.
3. Pesan biasa: `tanganiMigrasiGrup` → cek `msg.photo` LEBIH DULU (caption bercaption tidak boleh bocor ke jalur teks) → `parsePerintahGambar` (`lib/ai/parserGambar.ts`): ada `@gambar` → `jalurGambar`, tanpa perintah → `jalurVision`; teks diawali `/` → `tanganiCommand`; teks lain → gate (`gateAdmin` / `gateDesain`) → `jalurAiTeks`.
4. `tanganiCommand` → `parseCommand` → cabang per command (tabel di bawah) → helper `lib/d1/*` (`bacaQtyPerGudang`, `ubahRelatif`, `cariProduk`, `listGudang`, `listOpname`, `listTransfer`, `listAkses`, `mintaAkses`) → `kirimPesanBot`.
5. `jalurAiTeks` → `cekBatas` (`lib/ai/rateLimit.ts`) → `ambilPengaturanAI` → `balasChat` (`lib/ai/chat.ts`) → bila `perluKonfirmasi` simpan `bot_sessions.pending_action_json` + `kirimPesanTombol` (`ai:ya`/`ai:tidak`) → `tanganiCallbackAi` menjalankan `jalur.jalankanTool` (`lib/ai/tools.ts`, 9 tool) hanya bila `kapabilitas(role).bolehPerintah`.
6. `jalurVision` → `ekstrakPickingList` (`lib/ai/vision.ts`, butuh role lolos `gateAdmin`, designer ditolak) → ringkasan tabel ke chat (tidak menulis stok).

Command bot ACTIVE — semua di `worker/bot.ts::tanganiCommand` (dipanggil `prosesUpdate`, bukan file handler terpisah):

| command | gate/role | efek |
|---|---|---|
| `/start` | sebelum gate | teks bantuan; versi berbeda untuk role `designer` |
| `/daftar` | sebelum gate | `mintaAkses` → tulis `access_requests` + notif DM ke semua `users.role='owner'` |
| `/batal`, `/reset` | sebelum gate | `DELETE FROM bot_sessions WHERE tg_id=?` |
| `/stok [kode]` | `gateAdmin` | baca `products`+`stock_by_bin` (`bacaQtyPerGudang`); tanpa argumen daftar produk ONLINE (limit 50) |
| `/menipis` | `gateAdmin` | `stock_by_bin.qty < products.stok_min`, gudang ONLINE, limit 30 |
| `/laba [7h\|30h]` | `gateAdmin` | `laba_order` JOIN `seller_presets`; fallback `laba_snapshot` |
| `/gudang` | `gateAdmin` | `listGudang(db,false)` |
| `/tambah <kode> <qty>` / `/kurangi <kode> <qty>` | `gateAdmin` | `ubahRelatif(...)` → tulis `stock_by_bin` (+pergerakan) `source:"manual_chat"` |
| `/transfer` | `gateAdmin` | `listTransfer`, filter status non-selesai, maks 10 |
| `/opname` | `gateAdmin` | `listOpname(db,"menunggu_approval")` |
| `/cari <kata>` | `gateAdmin` | `cariProduk(db, kunci, 10)` |
| `/akses` | `gateAdmin` + `role==='owner'` | `listAkses(db,"pending")` |
| `@gambar <prompt>` (+opsional foto) | `gateGambar` (`kapabilitas().bolehGambar`) | `panggilGambar` → `sendPhoto`; foto = mode edit (batas 10 MB) |
| foto tanpa perintah | `gateAdmin` (designer ditolak) | `ekstrakPickingList` vision → ringkasan tabel; TIDAK mengubah stok |
| teks bebas | `gateAdmin` / `gateDesain` | `balasChat` (`lib/ai/chat.ts`); `perluKonfirmasi` → tombol `ai:ya`/`ai:tidak` → `jalankanTool` |
| command lain | `gateAdmin` | pesan "Perintah tidak dikenal" (TIDAK ada `/help` di Worker) |

### B. Jalur legacy (Vercel, Firestore) — masih dipakai `npm test`/arsip
1. `api/webhook.js`: `validasiEnvWebhook` (`lib/config/env.js`) → cek `POST` → cek secret header → `waitUntil(routePesan(req.body))` → balas 200.
2. `lib/router/routePesan.js::routePesan` → `routeMessage` / `routeCallbackQuery`; `routeMessage` memanggil `apakahBotHarusMerespon(message)` (keputusan "bot harus merespon" ADA DI SINI), `updateUsernameAdmin`, `gatingAkses`.
3. `gatingAkses` → `isAdmin` lanjut; `apakahMenungguKenalan` → `lanjutkanKenalan`; selain itu `handleAksesBaru` (buat `access_requests` + notif owner) dan STOP.
4. Foto (hanya DM, `apakahBolehProsesScreenshot`) → `unduhFileSebagaiBase64` → `adalahFotoOpname(caption)` memilih `handleOpname({sumber:"screenshot"})` atau `handleScreenshotPickingList`.
5. Teks `/` → `handleCommand` → `DAFTAR_COMMAND`. Teks biasa → `cekDraftPending` (urutan: kolom → picking list → sync stok → opname) → kalau tidak ada draft → `handleChatBiasa` (loop tool, `MAKS_LOOP_TOOL_CALL = 5`).
6. Efek tulis: `konfirmasiPickingList` → `kurangiStok` atau `tambahItemKeDailyRequest` (`daily_requests`); `konfirmasiOpname` → `timpaStokOpname` + `catatPergerakanStok` (`stock_movements`).

Command bot LEGACY — `lib/router/handleCommand.js::DAFTAR_COMMAND` → file handler:

| command | handler | efek |
|---|---|---|
| `/start` | `handleStart` (lokal) | sapaan + arahkan ke `/help` |
| `/help` | `handleHelp` (lokal) | daftar command |
| `/reset` | `handleReset` (lokal) | `resetSession` (hapus history `sessions`) |
| `/batal` | `handleBatal` (lokal) | `hapusSemuaPendingState` (draft saja, history tetap) |
| `/sync_stok` | `handleSyncStok` (lokal) | `lib/sheets/syncStokDuaArah.mulaiSyncStok` (draft diff Sheets↔Firestore) |
| `/list_admins` | `handleListAdmins` (lokal) | `isSuperAdmin` → `ambilSemuaAdmin` |
| `/revoke_admin <id>` | `handleRevokeAdmin` → `lib/handlers/handleRevokeAdmin.js::mulaiRevokeAdmin` | tombol `revoke_confirm:`/`revoke_cancel:` |
| `/set_role <id> <role>` | `lib/handlers/handleSetRole.js::handleSetRole` | `updateRoleAdmin` + audit + notif ke target |
| `/settings` | `lib/handlers/handleSettings.js::handleSettings` | `ambilPengaturanAI` + tombol `settings_ai:<provider>` |
| `/histori_stok [kode]` | `handleHistoriStok` (lokal) | `ambilPergerakanByKode`/`ambilPergerakanTerakhir` (`stock_movements`) |
| command tak dikenal | fallback di `handleCommand` | pesan "belum dikenal" + arahkan `/help` |

Callback legacy — `lib/router/routePesan.js::routeCallbackQuery` memilih dari prefix `callback_data`:

| prefix | handler | efek |
|---|---|---|
| `settings_ai:` | `handleSettings.js::handleSettingsCallback` | `simpanProviderAI` (Super Admin saja) |
| `approve:` / `reject:` | `handleApprovalCallback.js::handleApprovalCallback` | `setujuiAccessRequest` / tolak + balas user; `isSuperAdmin` |
| `revoke_confirm:` / `revoke_cancel:` | idem | `handleRevokeAdmin.js::eksekusiRevokeAdmin` (`hapusAdmin` + `revokeAccessRequest`) |
| `pa:` / `pb:` | `handleKonfirmasiCallback.js` | `chatHandler.js::prosesPendingActionViaTombol` / `prosesPendingBatchActionViaTombol` |
| `op:` | idem | `handleOpname.js::konfirmasiOpname` → apply `timpaStokOpname` |
| `pl:` | idem | `konfirmasiPickingList.js::konfirmasiPickingList` → `kurangiStok` / `daily_requests` |
| `ss:` / `kolom:` | idem | `lib/sheets/syncStokDuaArah.js::konfirmasiSyncStok` / `konfirmasiTambahKolom`/`batalkanTambahKolom` |
| `cp:` | idem | `chatHandler.js::prosesKonfirmasiCakupanViaTombol` (cari di semua katalog / batal) |

### C. Notifikasi keluar
1. Antrean D1 `notify_queue`: `antreNotifikasi` / `fanoutNotifikasi` (penerima = `users.notify_problem=1 AND active=1` + `groups.status='active' AND notify_problem=1`, cap fanout 200).
2. Cron `worker/index.ts::scheduled` → `drainTick(env, controller.cron)`; cron di `wrangler.jsonc`: `*/15 * * * *` (drain), `5 0 * * *` (`LAPORAN_CRON`, laporan harian via `bangunLaporanHarian`), `0 9 * * *` (`SINKRON_CRON`, `sinkronKledoSore` → `lib/kledo/sinkron.jalankanSinkron` lalu lapor hasil).
3. `drainQueue`: ≤25 baris/tick, retry maks 5 (`attempts`), konkurensi 5, `last_error`; grup upgrade supergroup → pindah `chat_id` di `groups` + `notify_queue` lalu retry sekali.
4. Pesan reaktif (bukan via queue): `lib/reminder/cekReorderPoint.js::cekDanNotifikasiReorderPoint` dan `lib/reminder/reminderHarian.js` memanggil `kirimPesan` langsung; kegagalan cron script dilaporkan `kirimNotifErrorCron` ke owner (fallback admin).

## Endpoint & tabel terkait

- Endpoint: `POST /api/telegram/webhook` → `worker/index.ts::fetch` → `worker/bot.ts::tanganiWebhook`; endpoint legacy yang setara `api/webhook.js` (handler default).
- Endpoint: `POST /api/ai/gambar/kirim-telegram` → `app/api/ai/gambar/kirim-telegram/route.ts::POST` (guard `ROLE_GAMBAR` + `sesi.user.is_admin`, kirim `sendPhoto` multipart ke `sesi.user.tg_id`, tanpa tulis D1).
- Tabel D1 `notify_queue` → penulis `worker/notify.ts` (`antreNotifikasi`, `fanoutNotifikasi`) + `worker/bot.ts::tanganiMigrasiGrup` (update target_group) → pembaca `drainQueue`; migrasi `migrations/0004_fase2_notify.sql`.
- Tabel D1 `groups` → penulis `worker/bot.ts::prosesUpdate` (my_chat_member) & `drainQueue`/`tanganiMigrasiGrup`; pembaca `fanoutNotifikasi`; migrasi `0004_fase2_notify.sql`.
- Tabel D1 `bot_sessions` → penulis `simpanSesi` / `/batal`/`/reset` (`worker/bot.ts`); pembaca `bacaRiwayat`, `bacaTertunda`; skema `migrations/0002_fase1_skema.sql` (kolom `history_json`, `pending_action_json`).
- Tabel D1 `users`, `access_requests` → penulis `/daftar` (`mintaAkses`), `gateAdmin`/`gateDesain` membaca status; penerima notif owner dibaca via `SELECT tg_id FROM users WHERE role='owner'`.
- Tabel D1 `products`, `stock_by_bin`, `warehouses` → dibaca command `/stok`, `/menipis`, `/cari`, `/gudang`, dan `jalurVision`; penulis `ubahRelatif` (`/tambah`, `/kurangi`) via `lib/d1/stok.ts`.
- Tabel D1 `transfers`, `opname`, `seller_presets`, `laba_order`, `laba_snapshot` → dibaca `/transfer`, `/opname`, `/laba`.
- Firestore (legacy): `sessions`, `admins`, `access_requests`, `keyword_notes`, `stock_movements`, `opname_drafts`, `daily_requests`, `products`, `stock`, `system_settings`, `admin_role_changes` via `lib/models/*.js`.
- Rate limit: `lib/ai/rateLimit.ts::cekBatas` → `lib/d1/rateLimit.ts::cekRateLimitD1` (Map per-isolat, TANPA tabel); legacy `lib/gemini/rateLimit.js::apakahKenaRateLimit` (in-memory, env `AI_RATE_LIMIT_PER_MINUTE`, default 20/menit).

## Test terkait

- Unit legacy (CJS): `test/notifikasiError.test.js`, `test/handleScreenshotPickingList.test.js`, `test/konfirmasiBotV3b.test.js`, `test/draftKonfirmasiV3b.test.js`, `test/routeFotoOpname.test.js` (kontrak `adalahFotoOpname`), `test/keywordNotes.test.js`, `test/keywordActionType.test.js`, `test/kataKunci.test.js`.
- Unit Worker/TS: `worker/bot-akses.test.ts` (kapabilitas role), `worker/notify.test.ts` (mock D1 + stub fetch), `worker/auth.test.ts`.
- Cara jalankan satu test: `node --test test/notifikasiError.test.js`; jalur TS bundel: `npm run test:worker` (skrip `scripts/jalankan-tes-worker.mjs` men-discover `lib|app|worker/**/*.test.ts`), atau bundel manual `npx esbuild worker/notify.test.ts --bundle --platform=node --format=esm --outfile=/tmp/t.mjs && node --test /tmp/t.mjs`.
- e2e Playwright TIDAK menguji bot Telegram (selalu mode mock): `e2e/masuk.spec.ts` hanya menguji halaman login web, `e2e/tma.spec.ts` untuk initData TMA.
- Stub: `test/helpers/stubTelegram.js::installStubTelegram` (require.cache `lib/telegram/kirimPesan`), `test/helpers/mockFirestore.js::installMockFirestore`, `test/alias-*.mjs` untuk bundel TS.

## Gotcha / konvensi

- Penentu "bot harus merespon" HANYA ada di jalur legacy (`apakahBotHarusMerespon`). Di Worker (`worker/bot.ts`) TIDAK ADA filter DM/grup: `prosesUpdate` memproses setiap `message`, jadi command/teks di grup pun dieksekusi (perbedaan perilaku nyata antar dua stack).
- Grup: default diam; merespon hanya kalau command `/`, di-mention, atau reply ke bot. Deteksi mention/reply butuh env `TELEGRAM_BOT_USERNAME`; kalau kosong, mention/reply TIDAK terdeteksi (hanya warning sekali di log).
- Screenshot picking list/opname hanya di DM (`apakahBolehProsesScreenshot`), walau grup sedang aktif merespon; di Worker tidak ada batasan ini.
- Dua gate terpisah di Worker: `gateAdmin` (owner/high_admin/admin) untuk semua perintah, `gateDesain`/`gateGambar` untuk `designer`. Menambah `designer` ke `gateAdmin` otomatis membuka `/stok`, `/tambah`, `/laba`, dst. Keputusan terpusat di `lib/d1/peran.ts::kapabilitas` (`bolehPerintah`, `bolehGambar`, `chatTanpaTool`).
- `parseCommand` membuang suffix `@namabot`, jadi `/start@bot` valid di grup; argumen dipisah spasi (`/tambah KODE qty`).
- Foto dicek SEBELUM teks (`worker/bot.ts`: `if (msg.photo?.length)`), supaya caption yang diawali `/` tidak salah masuk command.
- Prioritas draft pending legacy (urutan WAJIB): `kolom:` (keyed per chatId) → picking list → sync stok → opname (keyed per telegramUserId). Salah urutan = jawaban admin dipakai alur yang salah.
- `keyword_notes`: penanda baru otomatis disimpan `confidence:"guessed"` dengan default aman `MINTA` → `perlu_request`; hanya setelah dikonfirmasi jadi `confirmed` mapping `STOK/MINTA/MINTA_SISA` aktif. Jangan kirim balik objek `ambilActionTypeUntukPenanda()` sebagai `action_type` (harus di-destructure) — regresi BUG A.
- Semua callback WAJIB dijawab (`jawabCallbackQuery`/`jawabCallback`) atau tombol spinner selamanya; `kirimPesan` legacy otomatis retry sekali tanpa `parse_mode` saat "can't parse entities" — gejalanya pesan Markdown dinamis (nama produk) tak terkirim.
- Webhook SELALU balas 200 (Worker & Vercel): error ditangkap + di-log, TIDAK memicu retry Telegram. Konsekuensi: kegagalan proses = update hilang, dan update bisa diproses dobel bila Telegram kirim ulang (tidak ada dedup `update_id` di kode).
- Rate limit AI hanya in-memory per warm instance/per-isolat (bukan distributed) → batas efektif lebih longgar; `jalurAiTeks` worker: 20/menit per tg_id.
- Batas ukuran foto: Worker menolak >10 MB (`MAKS_FOTO_BYTE`) setelah `getFile`; `kirim-telegram` menolak base64 >9 MB (~limit sendPhoto 10 MB) dan selalu pakai multipart, bukan JSON+base64.
- Perbandingan secret header di Worker constant-time (`secretCocok`); di Vercel, bila `TELEGRAM_WEBHOOK_SECRET` kosong maka validasi DINONAKTIFKAN (hanya warning) — jangan dikosongkan di produksi.
- Migrasi grup→supergroup: `chat_id` berubah, jadi `groups` + `notify_queue` harus ikut dipindah (dilakukan di `tanganiMigrasiGrup` dan di `kirimSatu` saat error "upgraded to a supergroup").
- `notify_queue.attempts` maks 5 lalu baris diam permanen (tidak dihapus) — "notif tidak sampai" bisa berhenti di sini, bukan di Telegram.

## Kalau masalahnya ... buka ...

| gejala / kata kunci | file pertama yang dibuka | catatan |
|---|---|---|
| bot diam / tidak membalas di grup padahal DM normal | `lib/telegram/apakahBotHarusMerespon.js` + env `TELEGRAM_BOT_USERNAME` | cek mention/reply/command; username kosong = tidak terdeteksi |
| bot tidak merespon sama sekali (DM juga) | `worker/bot.ts::tanganiWebhook` (`secretCocok`, token) | secret salah → 401; token kosong → error saat kirim |
| login/chat gagal, user belum terdaftar, "minta akses", approval | `worker/bot.ts::gateAdmin` + `lib/handlers/handleAksesBaru.js` | dua jalur: D1 (`access_requests.status`) vs Firestore (`apakahMenungguKenalan`) |
| tombol Setujui/Tolak tidak bereaksi / spinner | `lib/router/routePesan.js::routeCallbackQuery` + `lib/handlers/handleKonfirmasiCallback.js` | prefix `callback_data` salah atau callback tak dijawab |
| tombol konfirmasi stok/AI nyangkut, dobel penerapan | `worker/bot.ts::tanganiCallbackAi` + `lib/handlers/handleKonfirmasiCallback.js` | `pending_action_json`, guard `draft_kirim_guard`, cek `bolehPerintah` |
| stok tidak sinkron setelah kirim foto picking list | `lib/handlers/handleScreenshotPickingList.js` → `lib/handlers/konfirmasiPickingList.js` | draft belum di-approve, item `ragu` sengaja dilewati, `kode_barang` kosong |
| cetak/isi picking list salah baca (nama produk salah) | `lib/gemini/ekstrakPickingList.js` lalu `lib/matching/cariProdukByNama.js` | hasil vision mentah vs fuzzy match, ambang 0.72/0.45 |
| penanda kolom picking list salah arti (D12, SDA, "sisa gdg") | `lib/models/keywordNotes.js::ambilActionTypeUntukPenanda` | default `MINTA`→`perlu_request` sampai dikonfirmasi di /kata-kunci |
| opname tidak match / selisih aneh / stok opname tidak berubah | `lib/handlers/handleOpname.js` (`bandingkanDenganSistem`, `konfirmasiOpname`) | kategori `selisih_besar`/`hilang_dari_opname` tidak auto-apply |
| notif/cron tidak terkirim, laporan harian hilang | `worker/notify.ts::drainQueue` + `worker/index.ts::scheduled` + `wrangler.jsonc` crons | cek `notify_queue.attempts`, `sent_at`, `last_error`, `groups.status` |
| notifikasi error job cron (GitHub Actions) | `lib/telegram/notifikasiError.js::kirimNotifErrorCron` | penerima owner, fallback admin; best-effort tidak throw |
| "terlalu banyak permintaan", balasan AI lambat/kuota | `lib/ai/rateLimit.ts::cekBatas` / `lib/gemini/rateLimit.js` | in-memory per instance; kuota provider di `lib/ai/provider.ts` |
| gambar hasil Studio Gambar gagal kirim ke Telegram | `app/api/ai/gambar/kirim-telegram/route.ts` | >9 MB base64 → 413 ramah; role harus lolos `ROLE_GAMBAR` |
| pesan Markdown bot gagal terkirim ("can't parse entities") | `lib/telegram/kirimPesan.js::panggilTelegramApi` | retry otomatis tanpa parse_mode; Worker pakai `esc()`/`amanHtml()` |
| command bot tidak dikenal / `/help` kosong | `lib/router/handleCommand.js::DAFTAR_COMMAND` (legacy) vs `worker/bot.ts::tanganiCommand` | daftar command BEDA antar dua stack; `/help` tidak ada di Worker |
| group Telegram jadi supergroup, notif nyasar | `worker/bot.ts::tanganiMigrasiGrup` + `worker/notify.ts::kirimSatu` | `chat_id` -100... dan `notify_queue.target_group` harus ikut dipindah |
