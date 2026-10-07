# Arsitektur & Wiring

Dokumen ini menjelaskan bagaimana file-file di proyek saling terhubung. Fokus: alur data nyata, bukan rencana.

## 1. Entry point & alur pesan

`api/webhook.js` adalah satu-satunya Vercel Function. Urutannya:

1. `validasiEnvWebhook()` (`lib/config/env.js`) — gagal → balas `500 {ok:false}`, tidak crash cold start.
2. Cek `method === "POST"` → else `405`.
3. Cek header `x-telegram-bot-api-secret-token` === `TELEGRAM_WEBHOOK_SECRET` → else `401`.
4. `waitUntil(routePesan(req.body))` lalu langsung balas `200 {ok:true}` — Telegram tidak menunggu proses AI/Firestore.

### Alur pesan teks

```
message.text
  └─ lib/router/routePesan.js::routeMessage
       ├─ apakahBotHarusMerespon(message)  (lib/telegram/apakahBotHarusMerespon.js)
       │     DM selalu true; grup hanya command/mention/reply
       ├─ updateUsernameAdmin()  (lib/models/admins.js)
       ├─ gatingAkses()
       │     ├─ isAdmin? lanjut
       │     ├─ apakahMenungguKenalan? → lanjutkanKenalan() (sesi isi nama)
       │     └─ handleAksesBaru() → access request + notif Super Admin
       ├─ text diawali "/" → lib/router/handleCommand.js::handleCommand
       │     └─ parseCommand → DAFTAR_COMMAND[namaCommand](ctx)
       ├─ ada draft pending? cekDraftPending() (urutan: kolom → picking → sync → opname)
       │     kalau ada, pesan ini dianggap jawaban; STOP
       └─ lib/gemini/chatHandler.js::handleChatBiasa (loop tool-calling)
```

### Alur foto

Foto hanya diproses di **DM** (`apakahBolehProsesScreenshot`). `message.photo` array diambil elemen terakhir (resolusi terbesar), lalu `unduhFileSebagaiBase64` (getFile + download). Caption menentukan jalur via `adalahFotoOpname` (`/\bopname\b/i` ATAU `/^\s*hitung\b/i`):

- opname → `lib/handlers/handleOpname.js::handleOpname({sumber:"screenshot"})`
- lainnya (termasuk caption kosong) → `lib/handlers/handleScreenshotPickingList.js`

### Alur callback_query

`routeCallbackQuery` memilih handler dari prefix `callback_data`:

| Prefix | Handler |
|---|---|
| `settings_ai:` | `lib/handlers/handleSettings.js::handleSettingsCallback` |
| `approve:` / `reject:` / `revoke_confirm:` / `revoke_cancel:` | `lib/handlers/handleApprovalCallback.js` |
| `pa:` `pb:` `op:` `ss:` `kolom:` `pl:` `cp:` | `lib/handlers/handleKonfirmasiCallback.js` |

`handleKonfirmasiCallback` menerjemahkan tombol menjadi jawaban teks yang sama seperti jalur teks (reuse penuh), lalu menutup tombol (`hapusTombolPesan`) supaya tidak diklik dobel.

## 2. Tabel file → tanggung jawab → dependensi utama

| File | Tanggung jawab | Dependensi utama |
|---|---|---|
| `api/webhook.js` | Entry Vercel: validasi secret+env, `waitUntil`, balas 200 | `lib/router/routePesan`, `lib/config/env`, `@vercel/functions` |
| `lib/router/routePesan.js` | Filter DM/grup, gating akses, dispatch teks/foto/callback, `adalahFotoOpname` | semua handler, `apakahBotHarusMerespon`, models/admins |
| `lib/router/handleCommand.js` | `DAFTAR_COMMAND` + `parseCommand`, command dasar | handlers, models, sheets/syncStokDuaArah |
| `lib/gemini/chatHandler.js` | Orkestrasi chat teks, loop tool-call, pendingAction/batch, konfirmasi cakupan produk | `gemini/client`, `gemini/tools`, matching, models, handlers |
| `lib/gemini/tools.js` | Deklarasi 11 tool + himpunan kategori + bentuk pendingAction | models/produk, models/stok, matching/cariProdukPintar |
| `lib/gemini/client.js` | Init Gemini, pilih provider, fallback model/utama-cadangan, fallback ke Groq | `groqClient`, models/aiSettings |
| `lib/gemini/groqClient.js` | Adapter Groq (OpenAI-compatible) yang "menyamar" jadi bentuk respons Gemini | fetch bawaan (tanpa SDK) |
| `lib/gemini/ekstrakPickingList.js` | Gemini vision: gambar → array baris mentah `{nama_terbaca, variasi, qty, penanda}` | `gemini/client` |
| `lib/gemini/rateLimit.js` | Sliding-window limiter AI per user (in-memory) | env `AI_RATE_LIMIT_PER_MINUTE` |
| `lib/gemini/promptSystem.js` | System prompt chat (konstanta) | — |
| `lib/handlers/handleScreenshotPickingList.js` | Ekstrak → keyword_notes → fuzzy match → draft stock_movements pending | gemini/ekstrak, matching, models, telegram |
| `lib/handlers/konfirmasiPickingList.js` | Apply draft picking list saat admin "ya": kurangi stok / isi daily_requests | models/stok, models/dailyRequests |
| `lib/handlers/handleOpname.js` | Bandingkan hitung fisik vs sistem, klasifikasi selisih, draft + apply terbatas | matching, models, gemini/ekstrak |
| `lib/handlers/handleAksesBaru.js` | Gating user baru, sesi "kenalan", notif approval ke owner | models/accessRequests, models/admins |
| `lib/handlers/handleApprovalCallback.js` | Tombol Setujui/Tolak akses + tombol revoke | models/accessRequests, models/admins |
| `lib/handlers/handleRevokeAdmin.js` | Validasi + konfirmasi revoke, eksekusi hapus admin & tutup akses | models/admins, models/accessRequests |
| `lib/handlers/handleSetRole.js` | `/set_role`: validasi role, catat audit | models/admins, models/adminRoleChanges |
| `lib/handlers/handleSettings.js` | `/settings`: pilih provider AI teks | models/aiSettings |
| `lib/handlers/handleKonfirmasiCallback.js` | Routing tombol konfirmasi (pa/pb/op/ss/kolom/pl/cp) | semua modul konfirmasi + chatHandler |
| `lib/matching/cariProdukByNama.js` | Fuzzy match token-overlap + Levenshtein ringan → jelas/ragu/tidak_ketemu | models/produk |
| `lib/matching/cariProdukPintar.js` | Resolusi terpusat: kolam online dulu, sinyal perlu-konfirmasi-cakupan, expand katalog | cariProdukByNama, models/produk |
| `lib/models/*.js` | CRUD tiap koleksi Firestore | lib/firebase |
| `lib/reminder/cekReorderPoint.js` | Notif reaktif saat stok ≤ reorder_point (dipanggil dari models/stok) | models/stok, produk, admins, telegram |
| `lib/reminder/reminderHarian.js` | Proyeksi habis dari tren 7 hari, kirim ke owner+admin | models, telegram |
| `lib/sheets/client.js` | Init Sheets API singleton, baca/tulis/header/append + timeout | googleapis, env `SHEETS_TIMEOUT_MS` |
| `lib/sheets/syncMasterData.js` | Alur A: Sheets → Firestore (products) searah otomatis | sheets/client, models/produk |
| `lib/sheets/syncStokDuaArah.js` | Alur F: diff stok Firestore↔Sheets, draft per kelompok, apply saat konfirmasi | sheets/client, models, telegram |
| `lib/telegram/kirimPesan.js` | Wrapper Bot API (fetch), retry tanpa parse_mode, download file | fetch, env token |
| `lib/telegram/apakahBotHarusMerespon.js` | Aturan respon DM/grup + izin proses screenshot | env `TELEGRAM_BOT_USERNAME` |
| `lib/telegram/notifikasiError.js` | Alert cron gagal ke owner/admin (best-effort, tidak throw) | models/admins, telegram |
| `lib/config/env.js` | Validasi env fail-fast per konteks boundary | process.env |
| `lib/firebase.js` | Init Firebase Admin singleton (`cert`) | firebase-admin |
| `scripts/jalankanSyncMasterData.js` | CLI cron sync master data + alert gagal | sheets/syncMasterData, notifikasiError |
| `scripts/jalankanReminderHarian.js` | CLI cron reminder + alert gagal | reminder/reminderHarian, notifikasiError |

## 3. Koleksi Firestore & field kunci

Sumber field: `lib/models/*.js` dan pemakaian di handler/sheets.

| Koleksi | Doc ID | Field kunci |
|---|---|---|
| `sessions` | `telegram_user_id` | `history[] {role, content, ts}`, `last_updated`, `pendingAction`, `pendingBatchAction`, `pendingOpname`, `pendingPickingList`, `pendingSyncStok`, `pendingKonfirmasiCakupan`. Window 5 turn, auto-reset 10 menit. |
| `stock` | `kode_barang` | `stok_gudang_online`, `reorder_point`, `last_updated`, `last_updated_by`, `last_synced_at`, `last_synced_value` |
| `stock_movements` | auto-id | `kode_barang`, `nama_terbaca`, `variasi`, `qty`, `type` (`keluar_resi`/`opname`/`restock`/`koreksi_manual`/`sync_confirmed`), `penanda`, `action_type` (`kurangi_stok`/`perlu_request`/`perlu_request_buffer`/`tambah_stok`), `qty_sistem`, `qty_fisik`, `selisih`, `source`, `status`, `created_by/at`, `requested_by`, `confirmed_by` |
| `products` | `kode_barang` | `nama_accurate`, `nama_accurate_normalized`, `hpp`, `hpp_baru`, `is_online_product`, `variants[] {nama_shopee, variasi, mark_down}`, `search_keywords[]`, `updated_at` |
| `keyword_notes` | auto-id | `raw_text`, `interpreted_as` (`STOK`/`MINTA`/`MINTA_SISA`), `confidence` (`guessed`/`confirmed`), `first_seen`, `last_used`, `usage_count` |
| `daily_requests` | `YYYY-MM-DD` | `items[] {kode_barang, nama, variasi, qty, buffer}`, `status`, `created_at` |
| `system_settings/ai` | `ai` (tetap) | `textProvider` (`gemini`/`groq`), `updatedAt`, `updatedBy`; fallback dari env `AI_PROVIDER_TEXT` |
| `admins` | `telegram_user_id` | `name`, `telegram_username`, `role` (`owner`/`admin`/`guest`), `added_at`, `approved_by`, `role_updated_at/by` |
| `admin_role_changes` | auto-id | `target_user_id`, `target_name`, `old_role`, `new_role`, `changed_by`, `created_at` |
| `access_requests` | `telegram_user_id` | `status` (`pending`/`approved`/`rejected`/`revoked`), `requested_at`, `telegram_username`, `telegram_display_name`, `rejected_until`, `resolved_by/at` |
| `opname_drafts` | auto-id | `items[]` (dengan `kategori`), `status` (`pending_confirmation`/`processed`/`dibatalkan`), `created_at` |
| `sync_stok_drafts` | auto-id | `kondisi`, `items[]`, `index_kolom`, `status` (`pending_confirmation`/`processed`/`dibatalkan`), `created_at` |
| `sync_stok_state` | `chatId` | `mintaKonfirmasiKolom` (khusus state "boleh tambah kolom?") |

Index Firestore (lihat `firestore.indexes.json`):
- `stock_movements`: `created_by ASC` + `created_at DESC`
- `stock_movements`: `kode_barang ASC` + `created_at DESC`

## 4. Alur AI tool-calling

Didefinisikan di `lib/gemini/tools.js` (11 tool). `chatHandler.js` mengelompokkannya:

**Tool read-only sederhana** — langsung dieksekusi, hasil dikirim balik ke Gemini sebagai `functionResponse`:
- `cekProdukStokMenipis`
- `listProdukOnlineBesertaStok`

**Tool butuh resolusi nama→produk** (`TOOL_BUTUH_RESOLUSI_PRODUK`) — selalu lewat `cariProdukPintar` dulu:
- `cariProduk`, `cekStok`, `kurangiStok`, `tambahStok`, `kurangiStokBatch`, `tambahStokBatch`

**Tool terminal langsung** (`TOOL_TERMINAL_LANGSUNG`) — loop berhenti, delegasi ke handler:
- `mulaiOpname` → `handleOpname()`
- `tambahProdukBaru` / `tambahProdukBaruBatch` → validasi kode, tahan sebagai pending

**Tool perlu konfirmasi** (`TOOL_PERLU_KONFIRMASI`): `kurangiStok`, `tambahStok`.

### Loop

`MAKS_LOOP_TOOL_CALL = 5`. Tiap iterasi:
1. Ambil `functionCall` dari respons. Tidak ada → balasan teks final, simpan ke history, kirim ke admin, selesai.
2. Ada >1 `kurangiStok`/`tambahStok` dalam satu giliran, atau ada `*Batch` → jalur batch (`tanganiToolResolusiProdukBatch`): resolve tiap item satu-satu, yang jelas dikumpulkan, yang ragu/tidak ketemu di-skip & dilaporkan, tampilkan satu ringkasan → `pendingBatchAction`.
3. Ada 1 tool resolusi produk → `tanganiToolResolusiProduk` (terminal di titik ini): `jelas` lanjut sesuai tool; `ragu` → pilih kandidat; tidak ketemu di kolam online → `perluKonfirmasiCakupan`.
4. Ada tool terminal → tangani, stop.
5. Sisanya read-only → eksekusi semua, push `functionResponse` (role `user` eksplisit, bukan `function`), lanjut loop.

### pendingAction vs pendingBatchAction

- `pendingAction` (tunggal): satu item, dipakai jalur pilih-kandidat/expand-katalog. Bentuk: `{jenis, kodeBarang, namaProduk, qty, alasan, tagOnlineSetelahnya, dibuatPada}`.
- `pendingBatchAction`: array `items[]` campuran jenis (tambah/kurangi/produk baru) + `dibuatPada`. Item tidak punya `jenis`/`dibuatPada` sendiri.
- `pendingKonfirmasiCakupan`: state paling "muda", dicek paling awal. Tahap `tanya_cakupan` atau `pilih_kandidat`.

Saat admin menjawab "ya": **hapus pending dari session DULUAN** sebelum eksekusi (cegah race kalau Telegram retry callback), lalu eksekusi, catat `stock_movements`, kirim hasil.

## 5. Alur sync Sheets dua arah (Alur F)

`lib/sheets/syncStokDuaArah.js`. Pemicu: `/sync_stok`.

Kondisi (konstanta `KONDISI`), dibandingkan nilai Firestore vs Sheets vs `last_synced_value`:

| Kondisi | Definisi | Arah resolusi |
|---|---|---|
| `sheets_ketinggalan` | Hanya Firestore berubah (`firestoreBerubah && !sheetBerubah`) | Firestore → Sheets |
| `sheets_manual` | Hanya Sheets berubah — ada editan manual | Firestore menang, ditulis ke Sheets (admin diberi tahu) |
| `konflik` | Dua-duanya berubah, nilai beda | Firestore menang, wajib pilih manual |
| `produk_baru` | Ada di Firestore, belum ada barisnya di Sheets | INSERT baris baru (bukan UPDATE) |

Catatan: kalau dua-duanya "berubah" tapi nilainya sudah sama → dianggap sinkron, tidak jadi draft.

Langkah:
1. `pastikanKolomStokAda(chatId)` — cek header `Stok Online` di sheet `DATABASE_ACCURATE`. Belum ada → tanya admin via tombol `kolom:ya`/`kolom:tidak`, stop (state di `sync_stok_state/{chatId}`).
2. Baca `A2:<kolom>`, ambil produk `hanyaOnline:true`, bandingkan per produk (`bandingkanNilai`).
3. Simpan kelompok non-kosong sebagai dokumen di `sync_stok_drafts`, simpan `pendingSyncStok {chatId, draftIds}` di session.
4. Kirim ringkasan + tombol per kelompok (`ss:<kondisi>`), `ss:semua`, `ss:batal`.

Apply (`applyDraft`): untuk tiap item → `tandaiTersinkron` (update `last_synced_*`), catat `stock_movements` type `sync_confirmed`, push nilai ke Sheets per sel. `produk_baru` → `tambahBarisBaru` dengan kolom A–D + Stok Online; sisanya dikosongkan. Draft ditandai `processed`/`dibatalkan`.

## 6. Alur opname

`lib/handlers/handleOpname.js`. Sumber: `chat` (teks) atau `screenshot` (reuse `ekstrakPickingList`). Keduanya jadi `{nama_terbaca, qty_fisik}`.

Bandingkan tiap item via `cariProdukByNama` (preload produk sekali) → hitung `selisih = qty_fisik - qty_sistem` → klasifikasi:

| Kategori | Aturan | Auto-apply |
|---|---|---|
| `cocok` | `selisih === 0` | tidak perlu apa-apa |
| `selisih_wajar` | bukan selisih besar | ya, saat admin "ya" |
| `selisih_besar` | `>30%` ATAU `>=5` unit (`AMBANG_PERSEN_SELISIH_BESAR`/`AMBANG_NOMINAL_SELISIH_BESAR`) | **tidak** — perlu klarifikasi terpisah |
| `hilang_dari_opname` | produk online yang tidak disebut di daftar opname | **tidak** — perlu klarifikasi |
| `tidak_ketemu` | nama tidak match produk | dilewati |

**Aturan penting**: saat admin menjawab "ya", hanya item `cocok` + `selisih_wajar` yang diapply (`timpaStokOpname` + catat `stock_movements` type `opname`). Item `selisih_besar` dan `hilang_dari_opname` **TIDAK pernah auto-apply** meski admin menyetujui draft — ini prinsip keamanan data agar barang hilang/salah hitung tidak "tertutup" oleh AI. Draft di `opname_drafts`, state `pendingOpname` di session.

## 7. Sync master data searah (Alur A)

`lib/sheets/syncMasterData.js`, dipanggil cron. Baca `DATABASE_ACCURATE!A2:G` + `Mapping!A2:D`, kelompokkan Mapping by nama accurate ternormalisasi, lalu `simpanProduk` per kode. `is_online_product` = OR antara kolom sheet dan flag Firestore yang sudah ada (sync **tidak pernah** mematikan flag yang sudah true). `search_keywords` = nama accurate + tiap nama Shopee ternormalisasi.