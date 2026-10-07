# Review Adversarial - PRD v3b (Sinkron Dua Arah: A7 + A5 + A2)

> Reviewer: adversarial senior product reviewer. Metode: verifikasi langsung ke kode pada 2026-09-16.
> Lingkup: `docs/dashboard-prd-v3b.md` (877 baris). Fokus: regresi bot produksi, keamanan identitas,
> dobel-proses, kontrak tidak testable.
> Catatan: review INI tidak mengubah spec. Semua klaim di bawah disertai file:baris.

---

## Verdict

**NEEDS_REVISION**

Alasan utama: v3b menyentuh 3 handler bot produksi DAN memperkenalkan satu bug logika konkret
di jalur picking list (satu `draft_id` dari dashboard memicu apply SELURUH `pendingPickingList`),
yang belum dibahas spec sama sekali. Selain itu, guard dobel-proses yang diklaim "2 lapis + guard
10s" TIDAK menutup jendela race di sisi Telegram, dan beberapa kontrak (409 A7, A5 race, state
401) belum punya sumber guard di kode. Fase A (A7+A5) relatif lebih aman; Fase B (A2) belum layak
diekskusi tanpa revisi.

---

## Blocking

### B1. Picking list: satu `draft_id` dari dashboard memicu apply SELURUH sesi picking
- **Apa:** Spec §5.4 mengizinkan dashboard mengonfirmasi SATU movement: `{ jenis:"picking", draft_id:"<movementId>", aksi_draft:"apply" }`. §S8.2 mengklaim guard status berlaku PER DRAFT. Tapi `konfirmasiPickingList` membaca `pendingPickingList.movementIds` (SEMUA id di sesi itu) lalu memproses semuanya, dan menghapus seluruh `pendingPickingList`.
  - `lib/handlers/konfirmasiPickingList.js:44` `const { chatId, movementIds } = pending;`
  - `lib/handlers/konfirmasiPickingList.js:70` `const movements = await ambilMovementsByIds(movementIds);` (loop `:81-98` apply semua)
  - `lib/handlers/konfirmasiPickingList.js:100` `await hapusPendingPickingList(sessionRef);` (hapus seluruh sesi)
  - `lib/handlers/handleScreenshotPickingList.js:66` `await simpanPendingPickingList(telegramUserId, chatId, movementIds);` (sesi menyimpan BANYAK movement dari satu screenshot)
- **Kenapa blocking:** Dashboard "Konfirmasi" per kartu → user mengira 1 movement diproses, kenyataannya SEMUA movement di screenshot itu ikut `kurangiStok`/`pending_request` dan sesi dihapus. Over-apply stok = kerusakan data produksi. Guard Lapis 1 (status per-draft) yang diklaim spec TIDAK berlaku karena `konfirmasiPickingList` tidak memeriksa `status` per movement sama sekali — ia hanya memfilter `m.kode_barang` (`:75`).
- **Perbaikan konkret:** Pilih satu (dan jelaskan di spec):
  1. Batasi UI: dashboard hanya boleh konfirmasi picking pada level **sesi** (dan beri tahu jumlah movement), ATAU
  2. Tambah fungsi bot baru `konfirmasiPickingListSatu(movementId, ...)` yang memproses 1 movement + update `pendingPickingList.movementIds` sisa — dan akui ini perubahan bot tambahan (bukan "TIDAK mengubah fungsi bot", kontradiksi dengan §3.3/§12), ATAU
  3. Route menolak `jenis:"picking"` bila `movementIds.length > 1` (fail-closed) dan minta konfirmasi via Telegram.
  Minimal: spec WAJIB menyatakan bahwa satu aksi `konfirmasi-draft` picking memproses seluruh sesi, dan UI harus menampilkan jumlah movement, bukan "per kartu".

### B2. Race dashboard vs Telegram TIDAK ditutup guard manapun di sisi Telegram
- **Apa:** Spec §8.2 A2-7 mengklaim guard dokumen `draft_kirim_guard` ("panggilan baru < 10 detik → 409") menutup race. Tapi guard ini HANYA ditulis di route dashboard (`app/api/admin`). Jalur bot Telegram (`handleKonfirmasiCallback` → `konfirmasiOpname`/`konfirmasiPickingList`/`konfirmasiSyncStok`) TIDAK membaca `draft_kirim_guard` sama sekali:
  - `lib/handlers/handleKonfirmasiCallback.js:47,68,76` langsung memanggil fungsi bot.
  - `lib/handlers/handleOpname.js:209-213` hanya cek `pendingOpname` ADA.
  - `lib/sheets/syncStokDuaArah.js:332-336` hanya cek `pendingSyncStok` ADA.
- **Kenapa blocking:** Skenario spec sendiri (§8.1 "dashboard konfirmasi pada detik yang sama admin balas ya di Telegram"): dua invocation berjalan paralel, keduanya lolos guard, keduanya apply. Untuk picking ini dobel `kurangiStok` (TIDAK idempoten — dikonfirmasi §3.4). Untuk opname movement audit dobel. Guard 10s di dashboard tidak bisa memblokir bot yang tidak membacanya.
- **Perbaikan konkret:** Spec harus jujur: guard 10s hanya mencegah dobel-DARI-DASHBOARD (double-tap dashboard), BUKAN dashboard-vs-Telegram. Untuk menutup dashboard-vs-Telegram, salah satu:
  - Bot juga cek `draft_kirim_guard` sebelum apply (perubahan bot tambahan + risiko), ATAU
  - Fungsi bot cek `status draft` DI DALAM transaksi sebelum apply (perubahan bot), ATAU
  - Terima sebagai risiko tersisa dengan mitigasi operasional (dokumentasikan sebagai R3 dengan status "tidak sepenuhnya tertutup", bukan "tertutup").
  Klaim "guard 2 lapis menutup race" di §8.2/R3 harus dilemahkan atau diperbaiki.

### B3. Bot early-return senyap = dashboard lapor sukses palsu (state draft tetap `pending_confirmation`)
- **Apa:** Bila `pending*` sudah dibersihkan (mis. bot memproses dari Telegram lebih dulu) tapi draft belum sempat di-read statusnya oleh route (TOCTOU), fungsi bot `return` tanpa error dan tanpa mutasi:
  - `lib/handlers/handleOpname.js:213` `if (!pending) return;`
  - `lib/sheets/syncStokDuaArah.js:336` `if (!pending) return;`
  - `lib/handlers/konfirmasiPickingList.js:42` `if (!pending) return false;`
  Spec §5.4 hanya mengembalikan 200 sukses / 500 model-throw; tidak ada cara mendeteksi "fungsi bot no-op".
- **Kenapa blocking:** Route akan membalas `200 { ok:true }` padahal draft TIDAK diproses dan statusnya tetap `pending_confirmation` (atau status berubah tapi user diberi tahu sebaliknya). §3.4 sudah mengakui "berhenti senyap", tapi §5.4/§8.2 tidak menurunkan konsekuensi ini ke kontrak respons. Ini persis jenis kegagalan yang bikin operator kehilangan kepercayaan.
- **Perbaikan konkret:** Bungkam ketidakpastian dengan SATU dari:
  - Fungsi bot mengembalikan nilai sukses/gagal eksplisit (mis. `{diproses: boolean}`) → perubahan bot, ATAU
  - Route memverifikasi SETELAH panggilan: re-read `draft.status`; bila masih `pending_confirmation` → balas 409 `"Draft sedang diproses atau pemilik draft tidak dapat diverifikasi."` (bukan 200). Tambahkan test T2a-varian untuk jalur ini.

### B4. Guard 409 A7 "sudah diproses" tidak atomik (TOCTOU) dan tidak ada di model
- **Apa:** Spec §5.2 memakai 409 `"Request ini sudah diproses sebelumnya."` untuk status != `pending`. Model `setujuiAccessRequest`/`tolakAccessRequest` TIDAK punya guard status — hanya `update()`:
  - `lib/models/accessRequests.js:31-39` (`setujuiAccessRequest`) dan `:42-52` (`tolakAccessRequest`) — tidak cek `status === "pending"`.
  - Paritas bot melakukan cek TERPISAH sebelum update: `lib/handlers/handleApprovalCallback.js:101` `if (!req || req.status !== "pending")`. Itu pun non-atomik.
- **Kenapa blocking:** Dua permintaan approve paralel (owner double-tap dari dua tab / dua owner) → keduanya lolos cek lalu keduanya `update`, dan dua notifikasi "kenalan" terkirim; `resolved_by`/`resolved_at` terakhir menang. Guard status di route tidak atomik terhadap write Firestore.
- **Perbaikan konkret:** Lakukan `runTransaction` di route atau tambah guard atomic di model (`setujuiAccessRequest` menolak bila status != pending, mengembalikan sentinel/exception), lalu route memetakan ke 409. Spec §5.2 harus menyebut mekanisme atomik, bukan sekadar "cek status".

### B5. A5 race "kode sudah dipakai" non-atomik + `simpanProduk` merge bisa menimpa produk existing
- **Apa:** Route cek `ambilProdukByKode != null` → 409 (spec §5.3), lalu `simpanProduk` MENIMPA karena `merge: true`:
  - `lib/models/produk.js:83` `await db.collection(KOLEKSI).doc(kodeBarang).set(payload, { merge: true });`
  - `lib/models/stok.js:33` `buatStokAwal` juga `set(..., { merge: true })`.
- **Kenapa blocking:** Dua admin menambah kode sama bersamaan → keduanya lolos cek → keduanya merge → `nama_accurate`/`hpp`/`stok_awal` salah satu saling menimpa tanpa error. Paritas bot menghadapi ini (race guard `chatHandler.js:621-624`), spec TIDAK menyalin mekanisme atomik apa pun untuk dashboard.
- **Perbaikan konkret:** Pakai `create()` (fail bila sudah ada) / `runTransaction` cek-lalu-tulis di route. Spec §5.3 harus menyebut "write atomic eksklusif" bukan "baca dulu, kalau ada 409".

### B6. State 401 mid-write A7/A5/A2 tidak konsisten dengan janji v1 §11.2
- **Apa:** Spec §10.1/10.2/10.3 punya baris "Error 401 mid-write" masing-masing dan §10.4 mengklaim "isian dipertahankan di memori". TIDAK dijelaskan MEKANISME mempertahankan isian/dialog: `app/draft/page.tsx` saat ini tidak punya form/wizard; `app/admin/page.tsx` A7 hanya baris tabel + AlertDialog. `app/api/admin/route.ts:37-39` mengembalikan 401 sebelum parse body; tidak ada token refresh.
- **Kenapa blocking:** Tanpa mekanisme eksplisit (state form tetap mounted, tidak reset via `setState`), janji "dialog & isian DIPERTAHANKAN" tidak dapat diverifikasi dan mudah regresi. Acceptance criteria §19 tidak menguji 401 sama sekali.
- **Perbaikan konkret:** Nyatakan bahwa isian hidup di React state lokal yang TIDAK di-reset pada error 401 (dan tambahkan test e2e `?mock-401=1` untuk A5 dialog, sesuai pola `lib/dashboard/data/mock.ts:133-136`). Untuk A7/A2 yang tak punya form isian, batas "yang dipertahankan" harus dinyatakan (tombol kembali aktif, dialog tetap terbuka).

---

## Non-blocking

- **N1.** §5.4 body menyertakan `owner_user_id?` (opsional) padahal §7.3/§12 menyatakan nilai ini diambil dari draft, BUKAN dari body. Field body tanpa fungsi = undangan eksploitasi/CI test palsu. Hapus dari body atau beri catatan tegas "diabaikan".
- **N2.** §6.2 merekomendasikan mengubah `handleKonfirmasiCallback.js:47,76` ke bentuk objek. Ini pekerjaan TAMBAHAN yang tidak diperlukan (fallback string sudah cukup). Kalau dilakukan, jaga jangan sampai `konfirmasiPickingList` di `:68` bercampur bentuk. Sebaiknya cukup "jangan ubah call site lama" untuk meminimalkan diff bot.
- **N3.** §3.1 tabel picking menyebut `handleScreenshotPickingList.js:131` `created_by: telegramUserId` — terverifikasi. Tapi spec mengabaikan bahwa movement juga bisa dibuat dari jalur lain (picking manual chat). Jika `created_by` null → §7.3 step 3 menolak 409. Sudah fail-closed, OK, tapi tak diuji.
- **N4.** Rate limit 40/menit (§4.3) masih soft in-memory per instance (dikonfirmasi `guard.js` tidak memiliki store lintas-lambda). Spec jujur soal ini. Tapi bucket `admin:{uid}` tunggal untuk 5 aksi berarti A2 (berat, memanggil Sheets) lebih mudah memakan kuota. Pertimbangkan bucket terpisah; minimal dokumentasikan dampaknya.
- **N5.** §9 S9-1 mengakui A7 tidak punya pembeda durable dashboard-vs-Telegram. Untuk fitur yang menyentuh identitas akses, ini gap audit nyata. `resolved_via` (1 baris additive) murah; menundanya ke v3c berarti insiden A7 tidak bisa direkonstruksi.
- **N6.** §3.5 klaim budget 11/12. Terverifikasi wajar (route existing 10 + webhook). Tidak ada aksi v3b yang butuh route baru karena semua dititip ke `/api/admin`. Klaim §E-15 benar.
- **N7.** §10.3 UI-1 menambah seksi Picking List ke `/draft` dengan "query `stock_movements` `status=="pending_confirmation"` dan `action_type != null`". `!=` butuh composite index di mode real (`lib/dashboard/data/real.ts:286-302` membatasi maksimum satu equality + rentang; pola picking di sini akan menambah index baru). Spec tidak menyebut index. Tambahkan catatan index atau lakukan filter `action_type` di memori (pola `listOpnameDrafts` `real.ts:305-318` memfilter status di memori).
- **N8.** §7.2 mengubah `simpanDraftOpname(hasilBanding)` menjadi `simpanDraftOpname(hasilBanding, telegramUserId)` dan `simpanDraftPerKelompok(kelompok, indexKolom)` menjadi `(..., telegramUserId)`. Spec benar menyebut titik `add()`; tapi tidak menyebut apakah ada TEST yang memanggil `simpanDraftOpname`/`simpanDraftPerKolompok` langsung (bila ada, signature berubah → test bot lama pecah). Verifikasi: tidak ada test yang mengimpornya (hanya fungsi konfirmasi diuji). Risiko rendah, tapi gate B-W1 harus mencakup `npm test` penuh.

---

## Verifikasi klaim spec vs kode

| # | Klaim spec | Temuan kode | Status |
|---|---|---|---|
| 1 | `konfirmasiOpname` param-3 = `confirmedBy` string | `handleOpname.js:209` `async function konfirmasiOpname(telegramUserId, teksJawaban, confirmedBy = telegramUserId)` | BENAR |
| 2 | `konfirmasiSyncStok` param-3 = `confirmedBy` string | `syncStokDuaArah.js:332` idem | BENAR |
| 3 | `konfirmasiPickingList` param-3 = objek | `konfirmasiPickingList.js:37` `{ sumber, confirmedBy } = {}` | BENAR |
| 4 | Fallback `typeof opsi === "string"` melindungi pemanggil lama | `handleKonfirmasiCallback.js:47,76` kirim string → masuk fallback | BENAR untuk opname/sync |
| 5 | `validasiAksiAdmin` lama tolak aksi != kata-kunci | `validasiTulisV3a.js:128-130` | BENAR |
| 6 | Test v3a tetap hijau bila validator diperluas | `test/adminRoute.test.js:32-37` menguji `""/null/undefined/"role"/"hapus"` → semua tetap 400 sebagai aksi tak dikenal | BENAR (tidak ada tabrakan) |
| 7 | `sessions` tidak punya match → deny total | `firestore.rules:37` catch-all deny; tidak ada match `sessions` | BENAR |
| 8 | `opname_drafts`/`sync_stok_drafts` read staff | `firestore.rules:24-25` `allow read: if staff()` | BENAR |
| 9 | `draft_kirim_guard` diusulkan di rules | spec §8.2/S15 menyebut APPEND ke `firestore.rules` dekat `:35`; saat ini BELUM ada (perlu ditambah) | SESUAI SPEC (belum ada, memang akan ditambah) |
| 10 | Status draft != pending → 409 A7 (paritas bot `:103`) | Bot cek di `handleApprovalCallback.js:101`; model `accessRequests.js:31,42` TIDAK punya guard; route harus cek sendiri (non-atomik) | SEBAGIAN (lihat B4) |
| 11 | 409 A5 berasal dari cek `kode sudah dipakai` | Cek via `ambilProdukByKode`; model `produk.js:83` `merge:true` | SEBAGIAN (lihat B5) |
| 12 | A5 paritas `chatHandler.js:953-984` (auto online, race guard) | `chatHandler.js:957` `is_online_product: true`; race guard `:621-624` (`throw`) | BENAR dijelaskan; tapi race guard TIDAK disalin ke route (lihat B5) |
| 13 | `source: "web_dashboard"` sudah ada di types | `lib/dashboard/types.ts:26` | BENAR |
| 14 | `product_changes` berorientasi field existing | `types.ts:253` `field: "hpp"\|"hpp_baru"\|"reorder_point"` | BENAR |
| 15 | Bot tidak kirim notif saat tambah produk | `chatHandler.js:978-982` membalas pelaku di chat | BENAR |
| 16 | `handleKonfirmasiCallback.js:47,68,76` 3 call site | terverifikasi `:47` (op/string), `:68` (pl/objek), `:76` (ss/string) | BENAR |
| 17 | `hapusSemuaPendingState`/`SEMUA_FIELD_PENDING` tak boleh dipakai untuk A2 | `lib/models/sessions.js:60-76` (menghapus 6 field termasuk `pendingAction`) — spec benar menolak | BENAR |
| 18 | `buatStokAwal(kode, stokAwal, {userId})` | `lib/models/stok.js:24` | BENAR |
| 19 | `simpanProduk(kode, { nama_accurate, hpp, is_online_product })` merge → invalidasinya otomatis | `lib/models/produk.js:77-86` (merge + `invalidasiCacheProduk`) | BENAR |
| 20 | `sesi.uid` == telegram user id (identitas ganda A2) | `lib/dashboard/auth/sesi.js:34-39` payload `{ uid: String(userId) }` dari initData Telegram | BENAR |
| 21 | `owner_user_id` ditulis di 2 titik `add()` bot | `handleOpname.js:175-181`; `syncStokDuaArah.js:201-215` | BENAR |
| 22 | Picking owner via `created_by`/`requested_by` | `handleScreenshotPickingList.js:131`; `stockMovements.js:64,67` | BENAR |
| 23 | Bot bersihkan `pending*` di semua cabang sukses | `handleOpname.js:264,279`; `konfirmasiPickingList.js:100,141`; `syncStokDuaArah.js:376,378` | BENAR |
| 24 | `konfirmasiPickingList` proses SEMUA movementIds sesi | `konfirmasiPickingList.js:44,70,81-98,100` | **TIDAK disebut spec** (lihat B1) |

---

## Risiko regresi bot

| # | Risiko | Bukti | Test yang HARUS ada |
|---|---|---|---|
| R-A | Fallback string salah → `confirmedBy = undefined` → `confirmed_by` kosong | `handleOpname.js:209`, `syncStokDuaArah.js:332` | T4a/T4c (sudah ada di §6.5) — pastikan assert nilai PERSIS `String(fromUserId)`, bukan hanya truthy |
| R-B | Guard `if (kirimNotifikasi)` salah membungkus MUTASI (bukan hanya kirim) → status draft/stok tidak berubah saat dashboard | §6.3 klaim guard hanya bungkus kirim; verifikasi tiap baris `:221,226,267` / `:53,61,103` / `:344,350,362,381` | T4b/T4d/T4e + assert `stock_movements`/`status` berubah TANPA `kirimPesan`. WAJIB juga test jalur `batal` (status `dibatalkan`) |
| R-C | `kirimNotifikasi:false` pada picking `sumber:"teks"` `:61` — guard salah → dashboard mendapat pesan "masih nunggu" ke chat bot | `konfirmasiPickingList.js:60-66` | Test bahwa `sumber` dari dashboard = bukan `"teks"` ATAU guard menutup `:61`; assert `kirimPesan` nol |
| R-D | Callback `op`/`ss` masih kirim string; kalau fungsi diperbaiki TAPI call site diubah salah bentuk → `{confirmedBy}` vs `confirmedBy` | `handleKonfirmasiCallback.js:47,76` | T4f spy argumen: assert pemanggilan tetap `(idPemilik, jawabanTeks, fromUserId)` atau objek yang setara |
| R-E | `simpanDraftOpname`/`simpanDraftPerKelompok` terima `telegramUserId` baru, tapi pemanggil lama lupa → `String(undefined)` = `"undefined"` ter-tulis | `handleOpname.js:56`, `syncStokDuaArah.js:83` | Test draft baru punya `owner_user_id` non-empty; test draft lama (tanpa field) tetap terbaca & `/draft` tandai "Pemilik tidak diketahui" |
| R-F | Picking `tandaiMovementConfirmedBy(confirmedBy)` → `ambilIdentitasAdmin(sesi.uid)`; jika `sesi.uid` tidak ada di `admins` → `name/username` null (bukan crash) | `konfirmasiPickingList.js:120-128`, `admins.js:36-46` | Test dashboard `confirmed_by === sesi.uid`; test `ambillIdentitasAdmin` null-safe |
| R-G | Sync: `konfirmasiSyncStok` menulis balik `pendingSyncStok.draftIds` sisa via `set(..., merge:true)` `:378`; race dengan bot bisa menghidupkan kembali sesi yang sudah dihapus | `syncStokDuaArah.js:375-379` | Test T2c (sync sebagian) + test race (dua invocation) → sudah diminta spec, tapi T2c tidak menyentuh race; tambah test race nyata |

---

## Lubang guard dobel-proses (skenario belum tertutup)

1. **Dashboard ↔ Telegram paralel (B2).** `draft_kirim_guard` tidak dibaca bot. Dua jalur apply bersamaan.
2. **Picking per-item (B1).** Satu `draft_id` memicu seluruh sesi — guard status per draft tidak berlaku.
3. **Bot early-return senyap (B3).** Sukses palsu saat sesi sudah bersih.
4. **Sync resurrect.** `:378` tulis balik `draftIds` bisa menimpa penghapusan `pendingSyncStok` dari invocation lain (lost update) — tidak ada `runTransaction`.
5. **Opname re-apply bila `pendingOpname` masih ada & draft `processed` (dikonfirmasi §3.4).** Route guard status menutupnya DARI dashboard, tapi balasan Telegram lama masih memanggil bot yang hanya cek `pending*` → apply ulang item (`timpaStokOpname` idempoten nilai, tapi `catatPergerakanStok` dobel audit). Skenario §8-9 spec ("admin masih melihat pesan lama & menekan tombol") TIDAK ditutup: `hapusTombolPesan` (`handleKonfirmasiCallback.js:111`) berjalan di jalur bot, tapi dashboard TIDAK menghapus tombol Telegram (keputusan §6.4 `kirimNotifikasi:false`). Jadi tombol lama TETAP ada dan bisa ditekan → bot apply ulang.
6. **Movement setengah jadi (pertanyaan C10).** `konfirmasiPickingList` loop `:81-98`: tiap iterasi `kurangiStok` lalu `tandaiMovementProcessed` + `tandaiMovementConfirmedBy` terpisah. Bila gagal di tengah, movement sebelumnya sudah `processed`, sisanya masih `pending_confirmation`, dan `pendingPickingList` BELUM dihapus (baru di `:100`). Retry → apply ulang movement yang sudah `processed` (tidak ada cek status). Spec tidak punya guard untuk ini. Blocking-adjacent (masuk B1 cluster).

---

## Requirement tidak testable

| Kutipan | Lokasi | Pengganti terukur |
|---|---|---|
| "Draft sedang diproses." (guard 10s) | §8.2 | Sudah terukur (10 detik) — OK, tapi tambah "berlaku hanya untuk dobel-dari-dashboard" |
| "kegagalan guard tidak memblokir aksi sah" | §8.2 | Definisikan: bila `runTransaction` gagal, route LANJUT (true/false test dengan mock throw) |
| "Draft lama tanpa owner → gap" | §7.2 | Eksplisit: perilaku = tombol disembunyikan + badge; test T5d sudah ada. OK |
| "notifikasi Telegram bukan event yang perlu diberitahukan" | §5.3 | Subjektif. Ganti jadi keputusan eksplisit: "bot juga tidak mengirim → paritas" (sudah ada bukti `chatHandler.js:978-982`) |
| "Form: `hpp` (opsional, angka)" | §10.2 | Sebut validasi: integer >= 0, > 1.000.000 ditolak; `hpp` boleh kosong → null (`§5.3` sudah, tapi UI table belum) |
| "Submit -> toast <= 2s" (mock) | §12 | Terukur (<=2s/<=5s). OK |
| "tanpa scroll horizontal @360px" | §12 | Terukur. OK |
| "`action_type != null`" query picking | §10.3 | Tidak testable tanpa index real; ganti jadi filter memori + test unit, atau sebut index composite |

---

## Tantangan keputusan (bagian F)

### F16. A5 tanpa `product_changes`
**Evaluasi: sebagian valid, tapi kesimpulan terlalu cepat.**
Alasan spec benar bahwa `product_changes.field` bertipe `"hpp"|"hpp_baru"|"reorder_point"` (`types.ts:253`) sehingga pembuatan produk tidak cocok. Tapi klaim "`stock_movements` sudah menjawab siapa menambah produk apa kapan" hanya sebagian: `stock_movements` mencatat pergerakan stok, BUKAN nama produk yang didaftarkan (`nama_terbaca` diisi `nama_produk` di §5.3 langkah 3 — jadi sebenarnya ada). Yang HILANG: kalau `stok_awal` 0, `catatPergerakanStok` tetap ditulis dengan qty 0 (`Math.abs(stok_awal||0)`), jadi tetap ada jejak. Jadi audit via `stock_movements` memang cukup untuk "siapa menambah kode apa". **Pertahankan keputusan**, tapi perbaiki alasan: tulis bahwa `nama_terbaca` + `source:"web_dashboard"` cukup, DAN catat bahwa `product_changes` sengaja tidak dipakai agar tidak memperluas enum `field`. Jika kelak perlu audit field-level produk (edit/hapus), itu v3c.

### F17. Rate limit 20 → 40
**Evaluasi: keputusan default 40/menit DAPAT DITERIMA, tapi bukan tanpa risiko.**
- Terlalu longgar? Untuk 5 aksi termasuk A2 yang memanggil Sheets (mahal, kuota), 40/menit per uid = 1 aksi tiap 1.5 detik. Itu cukup untuk script abuse. Bucket tunggal berarti spam `tambah-produk` (murah) bisa menghabiskan kuota yang seharusnya untuk A2.
- Terlalu ketat? 40 cukup untuk manusia. Tidak ada alasan naik melebihi ini.
- **Rekomendasi:** pertahankan 40 tapi pisah bucket (mis. `admin:{uid}:admin` dan `admin:{uid}:draft`) ATAU turunkan ke 30. Jika dipisah, spec §4.3/§12 harus diubah. Minimal: dokumentasikan bahwa bucket tunggal adalah trade-off yang disadari (sudah sebagian di OQ-6).

### F18. Form A5 sebagai dialog di `/stok`
**Evaluasi: keputusan dialog cukup, tapi `/stok` memang padat.**
`app/stok/page.tsx` punya header aksi (`bolehKoreksi` `:59`), tabel dengan kolom Aksi (`:273,306`), dan tombol mutasi. Menambah 1 tombol "Tambah Produk" di header = +1 elemen, rendah risiko. Dialog menghindari route/navigasi baru (mendukung budget). **Setuju dengan dialog.** Tapi: pastikan dialog tidak tumpang-tindih dengan dialog mutasi/hpp yang sudah ada (fokus & `aria-modal`), dan tambahkan `data-testid` (spec sudah: §10.2). Tidak blocking.

### F19. `owner_user_id` disimpan saat draft dibuat = menyentuh bot; ada alternatif lebih aman?
**Evaluasi: alternatif yang lebih aman SECARA TEKNIS ada, tapi mahal. Keputusan A2-5 dipertahankan dengan catatan.**
- Alternatif paling aman = tidak menyentuh bot sama sekali: route menyimpan peta `draftId → owner` di koleksi server-only BARU saat draft dipantau... tapi draft dibuat OLEH BOT, jadi tetap butuh 1 titik bot.
- Alternatif tanpa sentuh `add()`: route dashboard **resolve pemilik saat konfirmasi** dengan membaca `sessions` (server-side, bukan client) mencari `pendingOpname.draftId === id`. Ini 1 full-scan `sessions` per aksi (spec §3.1 benar: mahal + gagal bila `pending*` sudah dihapus). TIDAK lebih baik.
- Alternatif: `owner_user_id` ditulis oleh bot saat `simpanPendingOpname`/`simpanPendingSyncStok` ke koleksi server-only `draft_owner/{draftId}` (di luar draft) — TETAP menyentuh bot, hanya memindah lokasi field. Tidak lebih aman, dan client tidak bisa baca (kecuali rules dibuka). Justru memperburuk: UI butuh `owner_user_id` untuk sembunyikan tombol, dan rules saat ini hanya mengizinkan client baca collection yang di-whitelist.
- **Kesimpulan:** A2-5 (additive di `add()` draft) adalah pilihan paling hemat DAN field `owner_user_id` di draft memang bisa dibaca client (rules `opname_drafts`/`sync_stok_drafts` = staff read, `firestore.rules:24-25`). Klaim spec benar. **Risiko regresi tetap nyata** (2 titik `add()` bot), jadi mitigasi test R-E WAJIB. Tambahan: pastikan `owner_user_id` TIDAK dipakai untuk otorisasi TULIS tanpa verifikasi server (client bisa baca, tapi tidak bisa tulis — rules `allow write: if false`). Verifikasi: rules `:24-25` memang `write: false`. AMAN.

---

## Catatan bagian yang sudah benar

- Budget function: keputusan menitip 5 aksi ke `POST /api/admin` benar; tidak ada route baru; sisa margin 1 dijaga. (§4.1)
- Urutan guard route `tolakOrigin → cookie → verifikasiToken → rateLimit → parse → validasi → ambilAdmin(role dari Firestore) → guard role` sesuai kode `app/api/admin/route.ts:31-77`. (§4.3)
- Matriks izin A2 owner-semua / admin-sendiri / guest-tolak konsisten dengan pola v3a. (§7.1)
- Keputusan TIDAK memakai `hapusSemuaPendingState` benar (akan menghapus `pendingAction`, `sessions.js:60-67`). (§8.2 A2-6)
- Keputusan dashboard mengirim `teksJawaban` persis format bot (`"ya sheets_ketinggalan"`, `tentukanKondisiDariJawaban` `syncStokDuaArah.js:387-394`) benar dan menghindari perubahan fungsi bot untuk sync. (§3.3)
- Klaim `owner_user_id` picking tersedia via `created_by` terverifikasi. (§3.1)
- Klaim `sessions` tertutup total terverifikasi. (§7.2)

---

## Status

NEEDS_REVISION
