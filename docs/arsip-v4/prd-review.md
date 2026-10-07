# Review Adversarial — docs/discovery-v4.md

> Reviewer: prd-reviewer (adversarial). Tanggal: 2026-09-16.
> Metode: verifikasi tiap sitasi "file:baris" terhadap sumber asli
> (research-kledo.md, research-wms.md, impact-map-v4.md, dashboard-prd-v3b.md,
> research-cloudflare.md), plus spot-check kode (firestore.rules, README.md,
> lib/reminder/*).
> Dokumen TIDAK ditulis ulang. Hanya temuan.

---

## A. Sitasi salah / berhalusinasi

### T1 — [major] §2.3 (baris 79): sitasi research-wms.md:228 tidak memuat klaim
- Masalah: Dokumen menulis "Riset WMS menyebut perbedaan lokasi harus jadi entity, bukan flag (research-wms.md:228)." Baris 228 sumber berbunyi: "Stok per gudang di setiap query (bukan `stok_gudang_online` tunggal) | Multi-lokasi inti". Tidak ada pernyataan "location harus entity, bukan flag".
- Bukti: research-wms.md:228.
- Perbaikan: Turunkan kualitas klaim jadi [I]/inferensi sendiri, atau ganti rujukan ke research-wms.md:23-26 (A1 lokasi = entity) + :170-172.

### T2 — [major] §3.1 S2 (baris 90): sitasi research-wms.md:228 tidak memuat "flag lokasi per item"
- Masalah: S2 "Flag lokasi gudang per **item**" dirujuk ke research-wms.md:228. Baris itu soal stok per gudang di query, bukan flag per item. Riset WMS tidak pernah membahas "flag lokasi per item".
- Bukti: research-wms.md:228; bandingkan :88-93 (role vs scope) — tidak ada flag item.
- Perbaikan: Rujuk impact-map-v4.md:75 (`is_online_product` global) sebagai basis, dan tandai desain flag-per-item sebagai usulan sendiri, bukan temuan riset.

### T3 — [minor] §7.1 (baris 315): nomor baris Base URL/Auth salah
- Masalah: "Base URL ... auth Bearer (research-kledo.md:4)". Sumber justru menulis: Base URL = baris 3, Auth = baris 5. Baris 4 bukan keduanya.
- Bukti: research-kledo.md:4 ("Base URL: ... (baris 3). Auth: Bearer token (baris 5).").
- Perbaikan: Ganti jadi research-kledo.md:3,5.

### T4 — [minor] §3.1 S14 (baris 102): rentang sitasi tidak mencakup klaim
- Masalah: S14 "auth PAT, sync stok, tulis dokumen" dirujuk ke research-kledo.md:353-369. Rentang itu hanya G.1 (Personal Access Token). Tidak memuat sync stok maupun tulis dokumen.
- Bukti: research-kledo.md:353-369 = G.1 PAT saja.
- Perbaikan: Pecah sitasi: PAT -> :353-369; sync stok -> :138-143,169-170; tulis dokumen -> :185-210, :249-308.

### T5 — [minor] §3.2 N10 (baris 122): endpoint `/reportings/inventoryTurnover/{warehouseId}` hanya bersumber sekunder
- Masalah: Discovery menyatakan endpoint ini faktual. Satu-satunya dasar = research-wms.md:245, yang mengklaimnya [V] TANPA nomor baris kledo-api-reference. research-kledo.md TIDAK memuat `inventoryTurnover` sama sekali (grep 0 hit).
- Bukti: research-wms.md:245 (tanpa baris referensi); research-kledo.md (tidak ada).
- Perbaikan: Turunkan jadi "belum terverifikasi di research-kledo.md" atau buang dari alasan N10.

### Lolos
- Sitasi ke impact-map-v4.md:11-12, :13-14, :15, :26, :75, :81-99, :140, :174, :182-189, :216, :224, :226 — terverifikasi tepat.
- Sitasi research-kledo.md:17, :93, :97, :103, :113, :120, :129, :132, :138-143, :157, :169, :170, :185-210, :212, :218-228, :230-239, :245-320, :355-362, :369, :371-373, :389-411 — terverifikasi tepat.
- Sitasi research-wms.md:101-107, :106, :113-117, :135-136, :160, :170, :178, :180, :191-193, :206-213, :223-239, :243-264 — terverifikasi tepat.
- dashboard-prd-v3b.md:192-199, :256, :400, :452 — tepat.
- research-cloudflare.md:211-214 — tepat.

---

## B. Endpoint Kledo yang dikarang / salah kutip

### T6 — [minor] Daftar 5 endpoint webhook: akurat, tapi ada klaim idempotensi yang dijatuhkan diam-diam
- Masalah: Discovery §7.2 benar bahwa hanya 5 endpoint manajemen (regenerateSecret, settings, setup, verify, test) dengan research-kledo.md:389-411. TAPI research-wms.md:186 menyatakan "[V] Webhook Kledo idempoten-friendly ('jika sudah pernah diproses ... tetap 200') -> dedup by event id, kledo-api-reference.md:30393". Dua dokumen riset saling bertentangan; discovery memihak kledo tanpa menandai konflik.
- Bukti: research-wms.md:185-186 vs research-kledo.md:391-405 (H.2/H.3 "TIDAK ADA DI DOKUMENTASI").
- Perbaikan: Tambah baris risiko "KONFLIK sumber riset: research-wms.md:186 menyitir docs webhook konkret (30393); research-kledo.md menganggapnya kosong. Perlu cek kledo-api-reference.md:30393 langsung."

Tidak ada endpoint yang benar-benar dikarang (fiktif). Klaim "TIDAK TERDOKUMENTASI" pada transfer body, status enum, efek stok, response shape stok, webhook topik — semuanya tepat sesuai sumber.

### Lolos
- `POST /personal-access-tokens` body — tepat (research-kledo.md:355-362).
- `/finance/stockAdjustments` body + approve POST — tepat (research-kledo.md:185-228).
- `/finance/materialRequests`/`materialIssues` — tepat (research-kledo.md:245-320).
- `GET /warehouses/transfers/{id}/approve` = GET — tepat (research-kledo.md:103).
- `/healthCheck/stockMovementModifier` bukan alat opname — tepat (research-kledo.md:230-239).

---

## C. Kontradiksi internal

### T7 — [blocker] §3/§4 vs README.md:140: "source of truth" berkonflik tanpa disadari
- Masalah: K5 + §4 merekomendasikan Kledo = SoT stok; Firestore jadi cache. Tapi README.md:140 menyatakan invariant proyek saat ini: "Firestore sebagai sumber kebenaran untuk stok". Discovery mengutip 26 file writer sebagai beban refactor (impact-map:21-49) tetapi TIDAK pernah menyebut konflik eksplisit dengan invariant README, juga tidak membahas `lib/sheets/syncStokDuaArah.js` yang menulis Firestore->Sheets (impact-map:37).
- Kenapa penting: membalik SoT = perubahan kontrak arsitektur, bukan sekadar ganti field. Tanpa mengangkat konflik, engineering bisa menganggap ini refactor field biasa.
- Perbaikan: Tambah risiko blocker: "Membalik README:140 (Firestore SoT) ke Kledo SoT, plus review ulang sync Firestore->Sheets dan 26 file writer. Butuh keputusan user."

### T8 — [major] §10 MVP vs §3.1: S18 di v4 tapi ditunda di MVP, metrik §12 tetap memakainya
- Masalah: §3.1 S18 (reorder point per gudang) masuk scope v4; §10 menaruhnya "boleh ditunda"; §12 tidak memakai S18 — OK. Tapi alasan cache di §4 (baris 160,163) berdiri di atas kebutuhan reorder point, sementara reorder point ditunda di MVP. Urutan ketergantungan tidak jelas.
- Perbaikan: Nyatakan eksplisit: cache-level minimum yang dibutuhkan MVP (produk ber-flag online) vs penuh (S18).

### T9 — [major] §0 K2 vs §10: batas "12 function" tidak pernah dihitung ulang untuk route baru
- Masalah: K2 menetapkan 12 function = kebijakan internal (impact-map:11-12, saat ini 11). §10 MVP menambah route baru (`/api/permintaan-kirim`, cache refresh, polling job) dan impact-map:172 mendaftar ~13 method DataSource baru, tetapi discovery tidak pernah menghitung apakah jumlah function melampaui 12.
- Kenapa penting: bisa langsung melanggar keputusan terkunci K2 di hari pertama.
- Perbaikan: Tambah sub-bagian "Anggaran route": daftar route baru vs sisa kuota 1 function, atau tetapkan bahwa K2 direvisi.

### T10 — [minor] §0 K3 vs §10: "Kledo masuk v4 sebagai fondasi" tapi webhook + tulis dokumen bergantung blocker yang tak terpecahkan
- Masalah: K3 menyatakan integrasi Kledo masuk v4. §10 menaruh "Auth PAT + polling + cache" di MVP, tapi eksekusi dokumen (transfer) bergantung R2 yang belum terpecahkan. Jadi "fondasi Kledo" di MVP sebenarnya hanya read+cache.
- Perbaikan: Klarifikasi K3 = fondasi baca saja di MVP; fondasi tulis menunggu Q6/R2.

---

## D. Pertanyaan terbuka (Q1-Q6)

### T11 — [major] Q1 dapat dijawab sebagian dari riset/pengukuran, bukan murni keputusan manusia
- Masalah: Q1 menanyakan cakupan cache (semua vs subset) dengan alasan "butuh angka kuota baca Firestore & Vercel Hobby yang user tahu". Kuota baca Firestore & Hobby dapat diukur dari data pemakaian nyata, bukan diingat user. Trade-off biaya sebenarnya bisa dihitung.
- Perbaikan: Pecah: (a) keputusan produk "apakah dashboard harus bisa lihat semua produk" = manusia; (b) biaya = ukur dulu.

### T12 — [minor] Q4 dapat dijawab dengan uji Kledo, bukan keputusan manusia
- Masalah: Q4 menanyakan "boleh pakai gudang biasa sebagai transit?" — ini bisa diverifikasi runtime (buat gudang, cek apakah stok transit muncul di laporan). Asumsinya R13 sudah menandai ini "tidak terdokumentasi".
- Perbaikan: Ubah jadi prasyarat riset R13, bukan pertanyaan terbuka user. Sisakan bagian "user bersedia menandai gudang transit?".

### Lolos
- Q2 (multi-gudang user saat terima), Q3 (online flag vs entity), Q5 (angka threshold), Q6 (fallback acceptability) = keputusan manusia yang sah.

---

## E. Risiko yang hilang

### T13 — [blocker] Risiko PAT kedaluwarsa & rotasi
- Masalah: PAT punya `expires_in_days` (research-kledo.md:359) dan hanya muncul sekali saat create (:362). Discovery tak menyebut risiko token expired mematikan seluruh integrasi, atau prosedur rotasi.
- Perbaikan: Tambah risiko + handling (alert sebelum expiry, prosedur rotasi, penyimpanan).

### T14 — [major] Risiko keamanan rules Firestore untuk koleksi baru
- Masalah: R9 hanya membahas query scope. Koleksi baru (`gudang`, `permintaan_kirim`, `kledo_cache`) belum punya aturan `firestore.rules`; pola existing (firestore.rules:33-36) menaruh guard server-only. Discovery tak menyinggung.
- Perbaikan: Tambah risiko + acceptance: setiap koleksi baru punya rule eksplisit; default deny (`firestore.rules:38`).

### T15 — [major] Backfill data stok lama ke per-gudang tidak direncanakan
- Masalah: 1107 produk punya satu `stok_gudang_online`; setelah ganti ke per-gudang, tidak ada rencana migrasi nilai lama ke gudang mana. R11 hanya soal refactor titik, bukan backfill.
- Perbaikan: Tambah risiko + tugas data migration; tentukan gudang default untuk data lama.

### T16 — [minor] Timezone & negative stock (F3, F1) tak masuk daftar risiko
- Masalah: research-wms F1 (stok negatif, Kledo 400) & F3 (timezone/UTC) tidak muncul di §8.
- Perbaikan: Tambah ke §8 sebagai risiko rendah/menengah.

### T17 — [minor] Biaya Firestore dari polling 1107 produk/hari tidak dihitung
- Masalah: R6 hanya soal rate limit Kledo. Sisi biaya Firestore (tulis cache 1107 baris/hari) tak dibahas.
- Perbaikan: Tambah ke R6 atau R1.

---

## F. Scope creep / YAGNI

### T18 — [major] S18 (reorder point per gudang) & S17 (kartu stok view) sudah ada di v4 padahal riset menandai tak mendesak
- Masalah: research-wms.md:236-237 memang menaruhnya di "HARUS v4", jadi ini bukan creep terhadap riset. TAPI §10 sendiri menundanya. Jadi inklusi di §3.1 vs deferral di §10 = inkonsistensi scope, bukan creep. (Turunkan prioritas setelah klarifikasi T8.)

### T19 — [minor] Approval berlapis 3 tahap khusus untuk transfer antar-gudang kecil berisiko over-engineering
- Masalah: research-wms.md:131 membenarkan 3 tahap untuk 10 staf/2-5 gudang. Discovery mengadopsinya. Sesuai riset — bukan creep. Lolos.

### T20 — [major] S15 idempotency key "di semua konfirmasi draft" meluas ke seluruh sistem, bukan hanya transfer/opname
- Masalah: §3.1 S15 & §7.4 menyebut idempotency untuk transfer/opname/sync, lalu §7.4 mengaitkan ke `webhook_events`/guard. research-wms:234 secara eksplisit mendukung ini. Tapi cakupan "semua konfirmasi" memperluas ke endpoint non-Kledo yang belum tentu butuh (lihat impact-map:136-138 guard yang sudah ada: `draft_kirim_guard`, `permintaan_form_guard`, `stock_write_guard`). Discovery tidak menghitung guard yang SUDAH ada.
- Perbaikan: Nyatakan apakah S15 = retrofit guard lama + guard baru, atau hanya path baru.

---

## G. Kejujuran ketidakpastian

### T21 — [minor] §4 baris 134-136 menyajikan bentuk endpoint sebagai fakta padahal sumber menandai "TIDAK TERDOKUMENTASI"
- Masalah: Discovery menulis parameter endpoint seolah pasti ("`product_ids` required"), yang memang terdokumentasi di research-kledo.md:141; tetapi pada baris 135 menyatakan `/reportings/warehouseStock` "Cocok tarik seluruh stok per gudang sekali jalan" — ini inferensi yang tampak sebagai fakta. Sumber (:169) hanya mendaftar parameter. Sudah diberi hedge di §8 R1, jadi sebagian besar jujur.
- Perbaikan: Tambah hedge "bentuk response belum terverifikasi" pada kalimat 135.

### Lolos
- §13 menyatakan metodologi dan TIDAK menyembunyikan ketidakpastian secara umum. Baik.
- Klaim "PAT muncul sekali — TIDAK ADA pernyataan eksplisit" (baris 316) = contoh kejujuran yang tepat.

---

## Ringkasan severity
- Blocker: T7, T13
- Major: T1, T2, T8, T9, T11, T14, T15, T20
- Minor: T3, T4, T5, T6, T10, T12, T16, T17, T21

## Verdict

NEEDS_REVISION
