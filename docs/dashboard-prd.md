# PRD - Dashboard Telegram Mini App "Bot Admin Toko" (REVISI v4)

> Status: **revisi pasca review adversarial**. Dokumen ini menggantikan `docs/dashboard-plan.md`
> (rencana lama, tidak relevan: memakai Firebase Auth — keputusan final memakai Telegram `initData`).
>
> Penulis: PRD specialist. Konsumen: agent frontend UI/UX spesialis (per tahap, lihat Bagian 37).
> Bahasa produk: Bahasa Indonesia.
>
> **Revisi v2** menutup 2 BLOCKER, 9 MAJOR, dan 9 MINOR dari `docs/dashboard-prd-review.md`
> (verdict REJECT). Keputusan owner yang TIDAK diubah: Next.js in-repo, auth Telegram `initData` +
> jembatan Firebase Custom Token, satu outlet, Bahasa Indonesia, satu project Vercel / budget
> 12 function, tulis stok lewat server route + model stok yang ada + audit.
>
> **Revisi v3 - keputusan owner: testing frontend memakai Playwright dengan pendekatan MOCK-FIRST.**
> UI dibangun & divalidasi terhadap mock, lalu Playwright (routing, state, matriks izin, form tulis,
> responsive, dark/light, aksesibilitas) sampai hijau **sebelum** backend nyata disambung. Backend
> (`initData` auth, custom token, Firestore, route tulis) diintegrasikan SETELAH UI matang. Rincian:
> Bagian 37 (urutan tahap direvisi) dan Bagian 38 (strategi testing). Semua keputusan v2 tetap utuh.
>
> **Revisi v4 - 2 KEPUTUSAN OWNER BARU:**
> 1. **Stok negatif adalah FITUR, bukan bug.** Angka `stok_gudang_online` negatif disengaja: artinya
>    toko kekurangan dan harus `minta ke gudang cabang`. Guard `StokTidakCukupError` / tolak-negatif
>    **DIHAPUS** dari seluruh dokumen (13, 18, 36, 37). Yang tetap: transaksi atomik (tulis konkuren
>    konsisten) + validasi form (`qty > 0` untuk tambah/kurangi). Ditambah area tampilan `Stok Minus`
>    (badge merah, filter, daftar kekurangan, histori apa adanya).
> 2. **Playwright TETAP MOCK sampai akhir** (bahkan setelah integrasi backend), karena `initData`
>    tidak ada di headless browser. Verifikasi integrasi nyata = `npm test` (node:test, bukan mock) +
>    **smoke test manual WAJIB di Mini App Telegram nyata** sebelum rilis. Playwright pasca-swap =
>    regresi UI saja. Lihat Bagian 32 (R12/R13), 36, 37 (Fase C/D), 38.
>
> Keputusan tetap yang TIDAK diubah: Next.js in-repo, Telegram `initData` + Firebase Custom Token,
> satu outlet, Bahasa Indonesia, satu project Vercel / budget 12 function, tulis stok hanya via server
> route + model stok yang ada + audit, guest tidak boleh baca koleksi terbatas.

---

## 0. Changelog Revisi (peta temuan → resolusi)

| Temuan | Severity | Ringkas resolusi | Bagian |
|---|---|---|---|
| **D3** | BLOCKER (DIBATALKAN v4) | ~~Guard tolak-negatif~~ **DIBATALKAN oleh keputusan owner I1**: stok negatif = fitur. Sisa yang tetap: transaksi atomik konsisten (tanpa tolak-negatif) | 13.1, 13.2, 18 |
| **D4** | BLOCKER | Idempotensi DIHAPUS → guard double-submit sederhana (disabled button + unique guard doc) | 13.4, 18 |
| A1 | MAJOR | Field opname dikoreksi: `type:"opname"`, `action_type:"kurangi_stok"` | 13.3 |
| A2 | MINOR | Daftar nilai `source` dilengkapi | 13.3, 23 |
| A3 | MINOR | `resolved_by` jadi satu sumber kebenaran | 23 |
| A4 | MAJOR | Tipe `created_by` dikanonkan (string) + aturan index | 13.3, 18, 35 |
| A5 | MINOR | Daftar dependency client baru + risiko CJS/ESM | 31 |
| B1 | MAJOR | Parse `user` aman (try/catch + cek skema) → 401 | 11.1 |
| B2 | MINOR | `auth_date` wajib integer finite | 11.1, 11.2 |
| B3 | MINOR | Detail perbandingan konstan (lowercase, cek panjang → 401) | 11.1 |
| B4 | MAJOR | Interaksi TTL sesi cookie vs masa hidup Mini App + perilaku 401 mid-write | 11.2, 11.7, 19.4, 21 |
| C1 | MAJOR | Aturan hitung function AKTUAL (Next route + middleware dihitung); semua halaman statis | 12 |
| C2 | MAJOR | `page_view` klien DIHAPUS (tanpa route baru) | 27 |
| D1 | MAJOR | Klaim role di token + gating server-side per halaman/route | 11.5, 11.6, 11.8 |
| D2 | MAJOR | TTL token pendek + re-validasi `admins/{id}` tiap tukar initData; risiko residual dinyatakan | 11.7, 32 |
| D5 | MINOR | Rate limit tulis per-user (pola `rateLimit.js`) | 11.9, 24 |
| D6 | MINOR | Asumsi embedding + cek Origin/CSRF | 11.10 |
| D7 | (GOOD) | Dipertahankan | 13.5 |
| E1 | MINOR | Allowlist istilah asing untuk AC bahasa | 17 (FR-NFR-01) |
| E2 | MAJOR | Realitas full-scan `stock` + batas scope + asumsi ukuran data di S2 | 17, 25, 35 |
| E3 | MINOR | Validasi per mode (timpa vs relatif) | 13.1, 21 (E6) |
| E4 | MAJOR | AC konkurensi dapat diuji (dua penulis) | 17 (FR-WRITE-02), 21 (E8) |
| E5 | MINOR | Skema respons Bagian 24 diselaraskan | 24 |
| E6 | MINOR | Hook visibilitas audit-gagal | 34 |
| E7 | MINOR | Edge case tambahan | 21 |
| E8 | MINOR | Enum provider valid + penolakan invalid | 17 (FR-WRITE-09), 18 |
| F | MINOR | Index dirapikan: hanya yang didukung query nyata | 35 |
| G | (GOOD) | Requirements yang dinilai solid dipertahankan | seluruh |
| **H1** | KEPUTUSAN | Playwright + mock-first; urutan tahap diubah | 31, 37, 38 |
| **I1** | KEPUTUSAN | Stok negatif = FITUR (bukan bug); guard tolak-negatif (StokTidakCukupError) **DIHAPUS** di seluruh dokumen; tambah area tampilan "Stok Minus" (badge, filter, daftar kekurangan, histori apa adanya); mock wajib punya produk negatif | 13.1, 13.2, 13.6, 18, 21, 23, 25, 26, 36, 37, 38 |
| **I2** | KEPUTUSAN | Playwright **TETAP MOCK** hingga akhir (lihat I2 di bawah); verifikasi integrasi nyata = 
pm test (node:test) + **smoke test manual WAJIB** di Telegram Mini App nyata sebelum rilis; Fase B (guard atomik) DIHAPUS, sisanya (normalisasi created_by A4) dipindah ke Fase C | 32, 36, 37, 38 |

---

## 1. Ringkasan Eksekutif

### 1.1 Masalah yang dipecahkan

1. **Token AI terbuang untuk satu gerakan stok.** Satu-satunya cara mengubah stok adalah lewat chat
   Gemini (`lib/gemini/chatHandler.js`, tool `kurangiStok`/`tambahStok`). Satu koreksi 1 item =
   1 panggilan AI penuh (loop tool-calling sampai `MAKS_LOOP_TOOL_CALL = 5`).
2. **Data hanya bisa dilihat lewat chat.** Ringkasan stok, histori, draft, `daily_requests`, daftar
   admin hanya via perintah/menunggu balasan bot. Tidak ada tampilan visual yang cepat dipindai.
3. **Audit trail sulit ditelusuri.** `stock_movements` sudah lengkap tetapi hanya terbaca
   per-perintah.

### 1.2 Solusi yang diusulkan

Dashboard **Telegram Mini App** (Next.js App Router, di dalam repo ini) yang:

- Dibuka dari menu button bot, **hanya di dalam Telegram**.
- Autentikasi via verifikasi `initData` Telegram di server (HMAC-SHA256 pakai `TELEGRAM_BOT_TOKEN`),
  lalu cocokkan `user.id` ke koleksi `admins`.
- Membaca Firestore lewat **client SDK** dengan Security Rules berbasis klaim `role`
  (hemat budget function Vercel Hobby).
- Menulis stok lewat **satu server route** yang memanggil model yang ada (`lib/models/stok.js`,
  transaksi atomik) + mencatat audit `stock_movements`. **Stok negatif diizinkan** (13.2, 13.6).

### 1.3 Kriteria sukses (terukur)

| # | KPI | Target | Cara ukur |
|---|---|---|---|
| S1 | Panggilan AI untuk koreksi stok manual 1 item | 0 dari dashboard | Log server: tidak ada impor `lib/gemini/*` di bundle dashboard |
| S2 | Waktu muat H1 (data `stock` + `products` online) | <= 2,5 s P75 pada 4G, **dengan asumsi katalog <= 2.000 produk online** (lihat 25.1) | RUM/web-vitals pada 20 sesi uji; jika katalog > 2.000, target ditinjau ulang |
| S3 | Aksi tulis stok tercatat audit | 100% baris tulis punya `stock_movements` cocok | Verifikasi otomatis pasca-tulis (count dokumen) |
| S4 | Percobaan akses non-admin / guest ke halaman terlarang | 100% ditolak sebelum data terbaca | Test role-based (owner/admin/guest/non-admin) |
| S5 | Skor aksesibilitas Lighthouse halaman Stok | >= 90 | Lighthouse CI manual |
| S6 | `npm test` | tetap hijau (0 gagal) | `node --test test/*.test.js` |

---

## 2. Latar Belakang & Konteks

- Repo: Node.js CommonJS, `"type": "commonjs"`, Node >= 20 (`package.json`).
- Satu-satunya Vercel Function saat ini: `api/webhook.js`. `vercel.json` hanya mengatur
  `maxDuration: 300` untuk `api/*.js` (**tidak** mengatur `app/**`).
- Firestore diakses server-side via `firebase-admin` (`lib/firebase.js`, bypass Rules).
- Koleksi & field terdokumentasi di `docs/architecture.md` dan model di `lib/models/`.
- Bot sudah punya whitelist admin (`admins`), audit role (`admin_role_changes`), audit stok
  (`stock_movements`), dan pola rate limit in-memory (`lib/gemini/rateLimit.js`).

---

## 3. Pernyataan Masalah

> Owner/admin toko perlu melihat dan mengoreksi data operasional (terutama stok) secara visual dan
> cepat dari HP, tanpa membakar token AI untuk tiap gerakan stok, dan tanpa kehilangan jejak audit
> yang saat ini dijaga oleh bot.

---

## 4. Mengapa Sekarang

- Data & model sudah matang (`stock`, `products`, `stock_movements`, `admins` lengkap).
- Bot sudah jadi satu-satunya jalur; beban token AI untuk operasi rutin mulai terasa.
- Telegram Mini App menghilangkan kebutuhan login web terpisah (cukup identitas Telegram yang
  sudah dipakai bot).

---

## 5. Visi

Satu dashboard ringkas, mobile-first, Bahasa Indonesia, dibuka dengan satu tap dari bot: lihat stok
& draft, dan koreksi stok dengan aman (tetap berjejak audit) tanpa AI.

---

## 6. Tujuan (Goals)

- G1. Tampilan visual data operasional inti (stok, histori, draft, permintaan, admin).
- G2. Menghilangkan panggilan AI untuk koreksi stok manual dari dashboard.
- G3. Menjaga audit trail stok 100% (setiap tulis = 1 baris `stock_movements`).
- G4. Tetap di dalam 12-function limit Vercel Hobby (dihitung dengan aturan aktual, Bagian 12).
- G5. Auth hanya Telegram `initData`; tanpa Firebase Auth login, tanpa login browser.

---

## 7. Non-Goals (OUT eksplisit)

- **N1. Tidak ada akses browser-only.** `initData` hanya ada di dalam Telegram. Buka di browser
  biasa = tidak terautentikasi = layar "Buka dari Telegram", tanpa data.
- **N2. Tidak ada multi-outlet / multi-toko.** Satu toko.
- **N3. Tidak ada Bahasa Inggris untuk label produk.** Istilah teknis/proper noun dalam allowlist
  (17 FR-NFR-01) dikecualikan.
- **N4. Tidak ada panggilan AI dari dashboard.** Dashboard tidak memanggil Gemini/Groq, tidak
  memakai `lib/gemini/*`.
- **N5. Tidak menggantikan bot.** Bot tetap jalur utama untuk alur kompleks (opname screenshot,
  picking list, sync Sheets).
- **N6. Tidak ada Firebase Auth login (email/magic-link/Google).** Custom token hanya jembatan
  Rules; tidak ada layar login.
- **N7. Tidak ada CRUD produk baru** (bikin/ubah produk) di v1.
- **N8. Tidak ada aksi setuju/tolak `access_requests`** di v1 (tetap lewat bot).
- **N9. Tidak ada multi-bahasa, tidak ada PWA offline penuh** (offline = degradasi, Bagian 21).
- **N10. Tidak menulis Firestore stok langsung dari browser.** Selalu via server route.
- **N11. Tidak ada aplikasi klien non-bot (mis. FCM/push)** di v1.

---

## 8. Persona & Peran

| Peran | Sumber | Deskripsi |
|---|---|---|
| **Owner** | `admins.role == "owner"` atau env `SUPER_ADMIN_ID` (`lib/models/admins.js::isSuperAdmin`) | Pemilik. Akses penuh termasuk pengaturan. |
| **Admin** | `admins.role == "admin"` | Operasional: lihat + koreksi stok + tinjau draft. |
| **Guest** | `admins.role == "guest"` | Hanya lihat ringkasan + stok + histori. Tanpa aksi tulis, tanpa Draft/Admin/Pengaturan. |
| **Bukan admin** | Tidak ada di `admins` | Ditolak. Layar "Akses ditolak". |

Catatan: `ambilAdmin` mengembalikan `null` kalau tidak ada. `isAdmin` = `ambilAdmin !== null`.
Role default `tambahAdmin` tanpa argumen = `"guest"`. `SUPER_ADMIN_ID` = owner efektif.

### 8.1 Matriks izin per halaman/aksi (mengikat, ditegakkan server-side)

| Halaman / Aksi | Owner | Admin | Guest | Non-admin |
|---|---|---|---|---|
| Ringkasan (`/`) | lihat | lihat | lihat | tolak |
| Stok (`/stok`) | lihat | lihat | lihat | tolak |
| Detail Produk (`/produk/[kode]`) | lihat | lihat | lihat | tolak |
| Koreksi stok (tambah/kurangi/timpa) | ya | ya | **tidak** | tidak |
| Histori (`/histori`) | lihat | lihat | lihat | tolak |
| Draft pending (`/draft`) | lihat | lihat | **tidak** | tolak |
| Permintaan harian (`/permintaan`) | lihat | lihat | **tidak** | tolak |
| Admin (`/admin`) | lihat | lihat | **tidak** | tolak |
| Pengaturan AI (`/pengaturan`, lihat) | lihat | lihat | **tidak** | tolak |
| Pengaturan AI (ubah provider) | **ya** | tidak | tidak | tidak |

**Penegakan izin (DUA lapis, keduanya wajib):**

1. **Rules Firestore** (client SDK) berbasis klaim `role` di token — Bagian 11.6. Guest TIDAK
   punya jalur baca ke `opname_drafts`, `sync_stok_drafts`, `daily_requests`, `admins`,
   `admin_role_changes`, `access_requests`, `system_settings`. Ini menutup celah "guest baca
   langsung via SDK, melewati UI tersembunyi" (review D1).
2. **Server-side** untuk aksi tulis & pembacaan sensitif — Bagian 11.4/11.8.

Sisi klien hanya menyembunyikan UI (bukan pengaman).

---

## 9. Jobs To Be Done

- J1. "Saat ada barang keluar/masuk cepat, saya mau koreksi stok tanpa nunggu AI."
- J2. "Saya mau tahu produk mana yang di bawah reorder point dalam sekali pandang."
- J3. "Saya mau telusuri siapa mengubah stok apa, kapan, dan dari mana."
- J4. "Saya mau lihat draft yang masih nunggu konfirmasi tanpa scroll chat."
- J5. "Saya mau lihat daftar permintaan harian ke gudang sebelah."

---

## 10. Pain Points

- P1. Tiap koreksi = 1 sesi AI (token + latency).
- P2. Data terpencar di balasan chat; tidak ada ringkasan visual.
- P3. Audit sulit ditelusuri dari HP.
- P4. Untuk lihat angka tertentu harus mengetik perintah berulang.

---
## 11. Auth & Keamanan (WAJIB DIBACA)

### 11.1 Verifikasi `initData` langkah demi langkah (server-side)

Route: `POST /api/auth/telegram` (satu-satunya pengelolaan sesi). Input: `{ initData: string }`.

1. Terima `initData` mentah (query-string style, sudah di-URL-decode oleh framework).
2. `new URLSearchParams(initData)`; ambil nilai `hash`. Jika `hash` kosong → **400**.
3. Buang `hash` dari `URLSearchParams`. Susun `data_check_string`: setiap `key=value` untuk SEMUA
   parameter yang tersisa, disusun **urut abjad berdasarkan `key` ASCII**, disambung dengan `\n`.
4. `secret_key = HMAC_SHA256(key="WebAppData", message=TELEGRAM_BOT_TOKEN)`.
   Di Node: `crypto.createHmac("sha256", "WebAppData").update(TELEGRAM_BOT_TOKEN).digest()`.
5. `computed = HMAC_SHA256(key=secret_key, message=data_check_string)` heksadesimal.
6. Bandingkan `computed` dengan `hash` memakai **perbandingan waktu-konstan**:
   - Normalisasi `hash` ke **lowercase** sebelum banding.
   - Cek panjang sama; **panjang tidak sama → 401** (bukan 500; `timingSafeEqual` melempar pada
     panjang beda).
   - Bandingkan **hanya digest heksadesimal** (panjang tetap), via `crypto.timingSafeEqual`.
   - Tidak cocok → **401**.
7. Parse `auth_date` (Unix detik):
   - Wajib ada dan `Number.isInteger(Number(auth_date))`; jika tidak → **401**
     (review B2: `now - NaN > 3600` bernilai `false` → lolos tanpa cek ini).
   - Jika `now - auth_date > 3600` → **401** (`initData kedaluwarsa`).
   - Jika `auth_date > now + 60` → **401** (indikasi manipulasi).
8. Parse `user` (**aman** — review B1):
   - Bungkus `JSON.parse` dengan `try/catch`; gagal → **401**.
   - Hasil WAJIB objek (bukan array / bukan primitif); `user.id` wajib ada dan bukan objek.
   - Jika tidak sesuai → **401** (`initData tidak valid`).
   - Ambil `user.id`, `user.username`, `user.first_name`.
9. `ambilAdmin(String(user.id))` (`lib/models/admins.js`). Null → **403** (`bukan admin`).
10. Sukses → terbitkan sesi HTTP-only cookie (HttpOnly, `Secure`, `SameSite=Lax`,
    umur <= `auth_date` + 1 jam; lihat 11.2) + Firebase Custom Token dengan klaim role
    (Bagian 11.5). `role` dari `admins.role`, BUKAN dari klien.

### 11.2 Aturan `auth_date` freshness & interaksi masa hidup Mini App (review B4)

- Batas freshness `initData`: **60 menit**. Di luar itu tolak, minta buka ulang dari Telegram.
- **`initData` bersifat statis sepanjang sesi Mini App** dan tidak dapat di-refresh tanpa membuka
  ulang dari Telegram. Karena itu:
  - Umur cookie sesi = `auth_date` + 60 menit (bukan diperpanjang sliding).
  - Setelah cookie kedaluwarsa, request berikutnya (termasuk tulisan stok) menerima **401**.
  - **Perilaku 401 mid-write (wajib):** route tulis mengembalikan 401; UI menampilkan toast
    "Sesi kedaluwarsa. Buka ulang dari Telegram." dan tombol "Buka ulang"; **tidak ada** tulisan
    parsial (tulis stok hanya terjadi setelah semua validasi termasuk sesi lolos). Isian form
    dipertahankan di memori sampai user me-refresh halaman.

### 11.3 Yang TIDAK boleh dipercaya dari client

- `initData` dianggap **sudah diverifikasi hanya setelah** langkah 3-6 di server. Client tidak
  boleh mengirim `user_id`/`role` sebagai klaim.
- Cookie sesi untuk identifikasi; route tulis **wajib** memverifikasi ulang cookie (bukan
  mempercayai field body).
- Data Firestore yang dibaca client dibatasi Security Rules (Bagian 11.6), bukan apa yang
  dikirim klien.
- Jangan pernah mengirim `TELEGRAM_BOT_TOKEN`, service-account key, atau `FIREBASE_*` privat ke
  bundle client.

### 11.4 Pengecekan role server-side (aksi tulis)

- Aksi tulis stok (`POST /api/stok/mutasi`): verifikasi sesi → `ambilAdmin(user_id)` → tolak bila
  `role === "guest"` atau bukan admin → **403**.
- Pengaturan AI ubah provider: hanya `role === "owner"` (atau `isSuperAdmin`).
- Role TIDAK boleh dibaca dari body request.

### 11.5 Firebase Custom Token + klaim role (review D1)

Firestore Security Rules **tidak dapat memverifikasi `initData` Telegram**. Solusi: setelah
`/api/auth/telegram` memverifikasi `initData`, server menerbitkan **Firebase Custom Token** via
`firebase-admin`:

```
createCustomToken(String(user.id), {
  admin: role === "owner" || role === "admin",   // guest => false
  role:  role                                      // "owner" | "admin" | "guest"
})
```

Rules memakai `request.auth.token.role`. **Guest TIDAK mendapat `admin:true`** dan TIDAK mendapat
izin baca koleksi sensitif (11.6). Tidak ada layar login, tidak ada email/password.

### 11.6 Security Rules final (per-role, DENY by default) — review D1

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function authed() {
      return request.auth != null
        && request.auth.token.role is string
        && (request.auth.token.role == "owner" || request.auth.token.role == "admin"
            || request.auth.token.role == "guest");
    }
    function staff() { // owner atau admin
      return authed()
        && (request.auth.token.role == "owner" || request.auth.token.role == "admin");
    }

    // Baca boleh untuk SEMUA role admin (termasuk guest)
    match /stock/{kode}        { allow read: if authed(); allow write: if false; }
    match /products/{kode}     { allow read: if authed(); allow write: if false; }
    match /stock_movements/{id}{ allow read: if authed(); allow write: if false; }

    // HANYA owner/admin
    match /daily_requests/{id}     { allow read: if staff(); allow write: if false; }
    match /opname_drafts/{id}      { allow read: if staff(); allow write: if false; }
    match /sync_stok_drafts/{id}   { allow read: if staff(); allow write: if false; }
    match /admins/{uid}            { allow read: if staff(); allow write: if false; }
    match /admin_role_changes/{id} { allow read: if staff(); allow write: if false; }
    match /access_requests/{uid}   { allow read: if staff(); allow write: if false; }
    match /system_settings/{id}    { allow read: if staff(); allow write: if false; }
    match /keyword_notes/{id}      { allow read: if staff(); allow write: if false; }

    match /{document=**} { allow read, write: if false; }
  }
}
```

> **Peringatan keamanan:** jangan pernah menyetel Rules `allow read: if request.auth != null` tanpa
> klaim `role`. Setiap user Telegram yang punya token akan lolos. Jangan juga memberi `admin:true`
> ke guest.

Catatan: Rules di atas memisahkan guest (hanya `stock`/`products`/`stock_movements`) dari staff.
`admins` dibaca hanya oleh staff, sehingga guest tidak bisa membaca daftar admin. `role` di token
berasal dari `admins.role` saat token diterbitkan (lihat 11.7 untuk refresh & pencabutan).

### 11.7 TTL token pendek + pencabutan role (review D2)

- **Custom token / ID token TTL: 1 jam** (default; jangan diperpanjang). Cookie sesi juga
  `auth_date + 60 menit`.
- **Re-validasi server-side tiap tukar `initData`:** setiap panggilan `POST /api/auth/telegram`
  membaca ulang `admins/{user.id}` (sumber kebenaran) dan memakai `role` terkini untuk klaim token.
  Jika `admins/{id}` sudah tidak ada → **403**.
- Karena `initData` statis, user yang sesinya masih hidup tetap memakai `role` lama sampai
  cookie/token kedaluwarsa (maksimum 1 jam).
- **Route tulis & route sensitif TIDAK mempercayai token/klaim** untuk otorisasi akhir: route
  tulis selalu memanggil ulang `ambilAdmin(user_id)` (11.4), jadi role yang dicabut langsung
  berlaku pada aksi tulis tanpa menunggu TTL token.
- **Risiko residual (diterima & didokumentasikan):** user yang dicabut (dihapus dari `admins`,
  atau diturunkan dari admin ke guest) masih dapat **membaca** koleksi sesuai klaim token lama
  (staff) hingga maksimum **1 jam**. Aksi tulis tetap diblokir seketika. Mitigasi operasional:
  setelah mencabut admin, minta user menutup & membuka ulang Mini App (memaksa tukar `initData`
  baru) atau tunggu <= 1 jam.

### 11.8 Gating server-side per halaman (review D1)

Halaman Next.js boleh dirender statis (Bagian 12), tetapi data hanya dapat diambil lewat client SDK
yang tunduk pada Rules 11.6. Untuk memastikan matrix Bagian 8.1 tidak dapat dilanggar:

- Guest yang membuka `/draft`, `/permintaan`, `/admin`, `/pengaturan`:
  - UI memblokir (redirect + layar "Akses ditolak").
  - Bahkan bila UI dilewati, **Rules menolak baca** (guest bukan `staff()`), sehingga SDK
    mengembalikan `permission-denied`; halaman menampilkan error dan **tidak ada data** yang
    ter-render. AC: test role guest → query empat koleksi tersebut harus gagal `permission-denied`.
- Route tulis (`/api/stok/mutasi`, `/api/pengaturan/ai`) mengecek role server-side (11.4).

### 11.9 Rate limit (review D5)

- `/api/stok/mutasi`: maksimum **20 tulisan / menit / user** (pola in-memory `rateLimit.js`).
  Lewat batas → **429** dengan pesan Bahasa Indonesia. Soft-guard (per instance), didokumentasikan.
- `/api/auth/telegram`: maksimum **30 percobaan / menit / IP** (soft-guard).

### 11.10 CSRF / Origin / embedding (review D6)

- Asumsi embedding: Mini App dibuka di WebView Telegram (same-origin top-level) untuk mayoritas
  klien. Sebagian klien Telegram Web dapat memuat Mini App dalam **iframe lintas-origin**.
- Route yang mengubah state (`/api/stok/mutasi`, `/api/pengaturan/ai`, `/api/auth/telegram`)
  **WAJIB** memvalidasi header `Origin` cocok dengan origin yang diizinkan (daftar di env
  `DASHBOARD_ALLOWED_ORIGINS`); tidak cocok → **403**.
- Karena cookie `SameSite=Lax` tidak terkirim pada POST lintas-situs, jika embedding iframe
  lintas-origin terbukti memblokir cookie, fallback yang diizinkan: bearer token sesi di header
  `Authorization` yang diterbitkan bersama cookie (tidak di `localStorage`; disimpan in-memory) —
  keputusan final di Tahap 0.
- CSP `frame-ancestors` diizinkan hanya untuk domain Telegram (`web.telegram.org`,
  `*.telegram.org`).

---
## 12. Budget Vercel Hobby 12 Function (review C1/C2) — ATURAN AKTUAL

### 12.1 Aturan aktual yang dipakai

1. Setiap **Serverless Function** di `api/*.js` (classic Vercel functions) = 1 function.
2. Setiap **Next.js route yang dirender non-statis (SSR / route handler / server action)** =
   1 function. Halaman statis (dipra-render) = 0 function.
3. **Middleware** = 1 function.
4. `vercel.json` `functions: api/*.js` **hanya** mengatur `api/*.js`; ia TIDAK menghitung maupun
   membatasi function yang dihasilkan `app/**`. Karena itu hitungan wajib memakai bukti
   `vercel build` (bukan asumsi).

Konsekuensi desain: **semua halaman H1..H8 WAJIB dirender statis** (tanpa SSR, tanpa server
action untuk pembacaan). Jika satu halaman perlu SSR, halaman itu **masuk hitungan** dan wajib
menggantikan slot route lain.

### 12.2 Hitungan final

| Komponen | Function | Catatan |
|---|---|---|
| `api/webhook.js` (bot) | 1 | existing |
| `POST /api/auth/telegram` (route handler) | 1 | WAJIB |
| `POST /api/stok/mutasi` (route handler) | 1 | WAJIB |
| `POST /api/pengaturan/ai` (route handler) | 1 | owner only; boleh ditunda |
| Halaman H1..H8 | 0 | statis; data via client SDK |
| `middleware.js` | 0 | TIDAK dipakai di v1 (gating dilakukan di Rules + route, 11.8) |
| **Total** | **4** | <= 12 dengan margin 8 |

Jika `POST /api/pengaturan/ai` ditunda, total = **3**.

### 12.3 Larangan & bukti

- **Jangan** membuat 1 route per halaman; **jangan** membuat route hanya untuk read.
- `page_view` klien TIDAK memakai route (Bagian 27) — sebelumnya berpotensi menambah function
  (review C2).
- **Bukti wajib:** log hasil `vercel build` yang mencantumkan daftar function (termasuk Next route
  + middleware). Diterima bila total <= 12; target internal <= 4.
- Setiap function baru setelah ini wajib disetujui + hitung ulang.

---

## 13. Aksi Tulis Stok

### 13.1 Alur lengkap

1. Admin membuka Detail Produk / baris Stok, menekan "Koreksi Stok".
2. Pilih mode: **Tambah** (restock manual), **Kurangi** (keluar manual), **Timpa (opname)**.
3. Isi `qty` + `catatan` opsional. Aturan validasi qty **per mode** (review E3):
   - `tambah` / `kurangi`: bilangan bulat, `qty >= 1` (**qty > 0**). Validasi ini hanya pada INPUT form;
     **hasil (stok setelah aksi) boleh negatif** (lihat 13.6).
   - `timpa`: bilangan bulat, `qty >= 0` (opname boleh menyetel 0).
4. Dialog konfirmasi menampilkan nama produk, `kode_barang`, stok saat ini, nilai setelah aksi.
5. `POST /api/stok/mutasi` dengan `{ kode_barang, mode, qty, catatan? }`.
6. Server: verifikasi sesi (11.4) → `ambilAdmin` → tolak guest/non-admin (403) → rate limit
   (429) → validasi input per mode (400) → muat produk (`ambilProdukByKode`; tak ada → 404) →
   panggil model **dalam transaksi atomik (13.2)** — TANPA guard tolak-negatif:
   - `tambah` → `tambahStok(kode_barang, qty, userId)`
   - `kurangi` → `kurangiStok(kode_barang, qty, userId)` → **boleh menghasilkan stok negatif**
   - `timpa` → `timpaStokOpname(kode_barang, qty, userId)`
7. Setelah mutasi sukses, `catatPergerakanStok(...)` (13.3).
8. Balas `{ ok: true, stok_baru, movement_id }` → client invalidasi cache & refetch.
9. **`stok_baru` boleh negatif**; respons tetap `ok:true`. UI menampilkan badge "Stok Minus" +
   jumlah kekurangan (nilai absolut, lihat 13.6). Tidak ada 409 "stok tidak cukup" (dihapus, 13.2).

### 13.2 Transaksi atomik (review D3) — keputusan owner v4: TANPA tolak-negatif

> **DIBATALKAN oleh keputusan owner I1.** Versi v2/v3 mewajibkan guard `StokTidakCukupError` di
> `lib/models/stok.js` supaya stok tidak pernah negatif. Owner mengklarifikasi: **stok negatif adalah
> perilaku yang BENAR dan disengaja** — saldo negatif berarti toko kurang dan harus "minta ke gudang
> cabang". Bot sudah berperilaku begini (`_ubahStokRelatif` di `lib/models/stok.js:51-67` TIDAK
> meng-clamp ke nol). Karena itu **guard tolak-negatif DIHAPUS**. Yang tetap dipertahankan:

1. **Transaksi atomik wajib.** `_ubahStokRelatif` tetap memakai `db.runTransaction`; `trx.set(...)`
   tetap dipanggil untuk setiap mutasi. Tujuannya: tulis konkuren tetap **konsisten** (tidak ada lost
   update), bukan untuk menolak hasil negatif.
2. **Tidak ada clamping, tidak ada pelemparan error sufficiency.** `nilaiBaru = stokSekarang +
   deltaQty` ditulis apa adanya (boleh negatif).
3. `kurangiStok` tetap memakai `Math.abs(qty)`; `tambahStok` tidak terpengaruh (delta positif).
4. **Tidak ada perubahan `chatHandler.js`** untuk menangkap `StokTidakCukupError` (error itu tidak
   lagi ada). Bot dan dashboard sama-sama boleh menulis stok negatif — perilaku konsisten.
5. **Test (wajib), menggantikan test guard:**

   - Unit: `_ubahStokRelatif` dengan `stokSekarang=3`, `delta=-5` → **tersimpan** `-2` (bukan
     melempar); 1 dokumen `stock_movements` tertulis.
   - Konkurensi: dua `kurangiStok(kode, 3)` bersamaan pada stok 4 → **keduanya diterapkan**; stok
     akhir `== -2` (= jumlah delta; **tanpa assert `>= 0`**). Test dua-penulis tetap wajib, hanya
     assertion `>= 0` yang dihapus.
   - `tambahStok`/`timpaStokOpname` tetap lulus (regresi).

`timpaStokOpname` tidak memakai `_ubahStokRelatif`; rentang validnya `qty >= 0` (validasi route),
sehingga tidak menghasilkan negatif dari jalur timpa.

**Ringkas yang DIHAPUS dari v3:** `StokTidakCukupError`, `stok_tidak_cukup` sebagai 409,
`trx.set` bersyarat `nilaiBaru >= 0`, penangkapan error di `chatHandler.js`, dan test yang
mengharapkan pelemparan pada `stokSekarang=3, delta=-5`.

### 13.3 Field `stock_movements` yang WAJIB diisi (review A1/A4)

Berdasarkan `lib/models/stockMovements.js::catatPergerakanStok`.

| Field | Nilai (dashboard) | Catatan |
|---|---|---|
| `kode_barang` | dari request | string |
| `nama_terbaca` | `products.nama_accurate` | dari produk |
| `variasi` | `"-"` | sama jalur chat manual |
| `qty` | `qty` request; untuk timpa = `qty_fisik` | |
| `type` | `"koreksi_manual"` untuk tambah/kurangi; **`"opname"` untuk timpa** | koreksi A1 |
| `action_type` | **`"tambah_stok"` / `"kurangi_stok"`** | timpa memakai `"kurangi_stok"` (konvensi nyata `handleOpname.js:253` — field wajib skema, netral). Nilai `"opname"` TIDAK ADA di codebase → dihapus |
| `source` | **`"web_dashboard"`** | satu-satunya nilai baru |
| `catatan` | catatan admin (nullable) | |
| `status` | `"processed"` | default |
| `created_by` | `String(telegram_user_id)` | **WAJIB string** (lihat A4 di bawah) |
| `requested_by` | = `created_by` | dashboard = aksi langsung |
| `confirmed_by` | = `created_by` | dashboard = self-confirm |
| `penanda` | `null` | |
| `resolved_by` | `null` | |

Untuk **timpa**: isi `qty_sistem` (nilai sebelum), `qty_fisik` (nilai baru),
`selisih = qty_fisik - qty_sistem`; `type = "opname"`; `action_type = "kurangi_stok"`.

**A4 — tipe `created_by` (review MAJOR).** `catatPergerakanStok` menyimpan `created_by` apa adanya
(`stockMovements.js:59`), sementara `ambilPergerakanByPembuat` membandingkan
`.where("created_by","==",String(telegramUserId))` (baris 84). Bot mengirim id numerik → dokumen
lama kemungkinan bertipe **angka**, sehingga query string dapat mengembalikan 0 baris.

- **Aturan baru:** dashboard WAJIB mengirim `created_by` sebagai **string**.
- **Perbaikan model (shared):** `catatPergerakanStok` menormalkan `created_by = created_by == null
  ? null : String(created_by)`; `requested_by`/`confirmed_by` juga di-`String()`.
- **Index/query aman:** index lama `(created_by ASC, created_at DESC)` tetap dipakai HANYA setelah
  data dikanonkan. Sampai backfill data lama selesai, filter `created_by` di H4 memakai
  **perbandingan string** dan hasil untuk dokumen lama bertipe angka dinyatakan **tidak
  terjamin** (tidak ada klaim "index lama menjamin hasil"). Backfill opsional: perbaiki dokumen
  lama ke string (di luar v1, catat sebagai risiko R9).

Fungsi `catatPergerakanStok` mengisi otomatis `created_at`, `created_by_username`,
`created_by_name`, `requested_by_username`, `requested_by_name` via `ambilIdentitasAdmin`.
Server boleh mengirim `created_by_username`/`created_by_name` dari `initData` (opsional; fallback
`admins`).

**Daftar nilai `source` yang dikenal (review A2):** `"screenshot"`, `"manual_chat"`,
`"manual_chat_batch"`, `"manual_chat_batch_produk_baru"`, `"manual_chat_produk_baru"`, `"sync"`,
dan **`"web_dashboard"`** (baru). Filter `source` di H4 (bila diaktifkan) memakai daftar ini.
`handleOpname.js:274` mengeluarkan `source:"manual_chat"`.

### 13.4 Guard double-submit (BLOCKER D4) — idempotensi DIHAPUS

Keputusan: **`client_request_id` dan collection idempotency DIHAPUS.** Alasan: (a) tidak ada
storage/TTL yang dapat diimplementasikan & diverifikasi di Hobby tanpa menambah biaya/kompleksitas;
(b) guard sederhana sudah cukup menutup kasus nyata (double-tap).

Mekanisme pengganti (paling kecil, dapat diimplementasikan):

1. **Klien:** tombol "Koreksi" `disabled` + spinner selama request berjalan; form terkunci sampai
   respons datang. Ini mencegah double-tap pada satu perangkat.
2. **Server (unique guard doc, best-effort):** dokumen guard
   `stock_write_guard/{String(userId)}` menyimpan `{ kode_barang, mode, qty, at }`. Pada route:
   - Baca dokumen; jika `at` dalam **10 detik terakhir** DAN `kode_barang` + `mode` + `qty` sama →
     **409** `{ ok:false, error:"duplikat" }` tanpa menulis.
   - Jika tidak, tulis guard doc (`set(..., {merge:false})`) lalu lanjut mutasi.
   - Collection baru ini server-only: `match /stock_write_guard/{id} { allow read, write: if
     false; }` (client tidak boleh menyentuh).
3. **Jaminan yang diberikan:** mencegah dua request identik beruntun dari user yang sama dalam
   10 detik. **Tidak** menjamin dedup lintas instance (best-effort, sama seperti pola rate limit
   in-memory) dan **tidak** menjamin dedup bila jeda > 10 detik atau qty berbeda.
4. **Bukan** benar-benar idempoten; AC tidak boleh mengklaim "stok hanya berubah sekali secara
   mutlak". AC baru: dua POST identik berurutan <= 10 s dari user yang sama → request kedua
   **409**; stok berubah sekali.
5. **Race antar-admin:** tidak dicegah guard ini; dicegah oleh `runTransaction` (13.2). Dua admin
   menambah/mengurangi stok tetap keduanya dicatat (perilaku benar); hasil boleh negatif.

`client_request_id` dihapus dari kontrak route (Bagian 24) dan dari edge case E7.

### 13.5 Mengapa harus lewat server (bukan tulis Firestore dari client) — review D7 (GOOD)

1. **Audit trail.** `catatPergerakanStok` hidup di Node; Rules tidak bisa memanggil fungsi Node.
2. **Reorder check.** `_ubahStokRelatif` memanggil `cekDanNotifikasiReorderPoint` (notif Telegram).
3. **Cache invalidation.** `invalidasiCacheStok()`/`invalidasiCacheProduk()` adalah cache
   module-level Node; tulis dari client → data basi.
4. **Transaksi atomik.** `runTransaction` hanya ada di model; validasi sufficiency bukan lagi alasan
   (dihapus, 13.2).
5. **Rate limit + guard double-submit** hanya dimungkinkan di server.

Karena itu: **client DILARANG menulis `stock`/`stock_movements`** (Rules `allow write: if false`).

### 13.6 "Stok Minus" sebagai sinyal operasional (keputusan owner I1)

Stok negatif (`stok_gudang_online < 0`) adalah **sinyal kekurangan** yang dapat ditindaklanjuti:
toko harus "minta ke gudang cabang". Spesifikasi tampilan:

- **H2 Stok — tiga status**, dibedakan visual (warna + label, bukan hanya warna):
  | Status | Kondisi | Badge |
  |---|---|---|
  | **Stok Minus** | `stok_gudang_online < 0` | merah + label "Stok Minus" + nilai negatif |
  | **Menipis** | `reorder_point != null` dan `0 <= stok_gudang_online < reorder_point` | kuning/oranye + label "Menipis" |
  | **Aman** | `stok_gudang_online >= reorder_point` (atau `reorder_point` null) | hijau/netral + label "Aman" |

  Badge "Stok Minus" **berbeda dari dan diprioritaskan di atas** "Menipis" (produk minus tidak
  boleh ikut muncul sebagai "Menipis").
- **Filter/section "Perlu Minta Gudang Cabang".** H2 menyediakan filter khusus menampilkan produk
  dengan `stok_gudang_online < 0` (daftar kekurangan). **Jumlah kekurangan ditampilkan sebagai nilai
  absolut** dari saldo negatif: `kekurangan = Math.abs(stok_gudang_online)` (contoh: `-3` ditampilkan
  "Kurang 3"). Daftar diurutkan dari kekurangan terbesar.
- **H1 Ringkasan** boleh menampilkan kartu "Stok Minus" = jumlah produk dengan `stok_gudang_online < 0`
  (dihitung in-memory via full-scan `stock`, lihat 25.1).
- **H4 Histori** menampilkan delta/nilai negatif **apa adanya** — tidak di-clamp, tidak disembunyikan.
  Baris `kurangi` dengan delta negatif dan baris `timpa` dengan `selisih` negatif tampil sebagai angka
  negatif.
- **Mock (Bagian 38):** data mock WAJIB memuat **minimal satu produk dengan `stok_gudang_online` negatif**
  supaya Playwright menutup state ini.

---

## 14. Ruang Lingkup

### 14.1 IN (v1)

- 8 halaman (Bagian 15).
- Auth Telegram `initData` (11) dengan klaim role + re-validasi + TTL pendek.
- Aksi tulis stok (tambah/kurangi/timpa) via server + transaksi atomik; **hasil boleh negatif** (13.2, 13.6).
- Baca Firestore client SDK untuk semua halaman, dibatasi Rules per-role.
- Ubah provider AI (owner) via route opsional.

### 14.2 OUT (v1) — eksplisit

- N1..N11 (Bagian 7).
- Tidak ada export CSV/Excel, tidak ada push notification, tidak ada edit draft dari web
  (hanya lihat + tombol "buka di Telegram"), tidak ada CRUD produk/admin.
- **Tidak ada `client_request_id` / collection idempotency** (13.4).
- **Tidak ada `middleware.js`** di v1 (12.2).
- **Tidak ada `page_view`** server-side (Bagian 27).

---
## 15. Halaman

| # | Route | Nama | Akses | Sumber data |
|---|---|---|---|---|
| H1 | `/` | Ringkasan | semua admin (guest: lihat) | `stock`, `products` (online), `stock_movements`, `daily_requests`, `opname_drafts`, `sync_stok_drafts` |
| H2 | `/stok` | Stok | semua admin | `stock` join `products` |
| H3 | `/produk/[kode]` | Detail Produk | semua admin | `products/{kode}`, `stock/{kode}`, `stock_movements` |
| H4 | `/histori` | Histori | semua admin | `stock_movements` |
| H5 | `/draft` | Draft Pending | admin+ (bukan guest) | `opname_drafts`, `sync_stok_drafts`, `stock_movements` (status pending) |
| H6 | `/permintaan` | Permintaan Harian | admin+ | `daily_requests` |
| H7 | `/admin` | Admin | admin+ | `admins`, `admin_role_changes`, `access_requests` |
| H8 | `/pengaturan` | Pengaturan | admin+ (ubah: owner) | `system_settings/ai` |

**Catatan (review E2):** kolom "Sumber data" H1 mencantumkan koleksi yang bergantung pada
`stock_movements`/`daily_requests`/`opname_drafts`/`sync_stok_drafts`. Karena guest tidak boleh
membaca empat koleksi itu (11.6), H1 untuk guest hanya menampilkan kartu dari `stock` + `products`
(total produk online, item menipis) + daftar stok menipis; kartu draft & permintaan harian
**disembunyikan untuk guest** (realitas Rules, bukan sekadar UI).

Detail tiap halaman:

- **H1 Ringkasan**: kartu (total produk online, item di bawah reorder point [guest: ya], **jumlah
  produk Stok Minus** [guest: ya], draft pending [staff], jumlah item `daily_requests` hari ini
  [staff]), daftar 10 pergerakan terakhir, daftar stok menipis, daftar singkat "perlu minta gudang
  cabang" (produk negatif).
- **H2 Stok**: tabel kode, nama, hpp, `stok_gudang_online`, `reorder_point`, badge status (Aman /
  Menipis / **Stok Minus**). Cari, filter online/menipis/**stok minus (perlu minta gudang cabang)**,
  sort. Aksi "Koreksi" (admin+). Rincian 13.6.
- **H3 Detail Produk**: info produk (`nama_accurate`, `hpp`, `hpp_baru`, `variants[]`), stok saat
  ini, reorder point, tombol Koreksi, timeline pergerakan kode ini. **Tidak ada** filter `type`
  gabungan di H3 (menghapus index #4 review F); filter `type` hanya di H4.
- **H4 Histori**: timeline `stock_movements`, filter `kode_barang` / `type` / `status` / tanggal /
  `created_by` (tipe string, 13.3). Kombinasi filter yang didukung = hanya SATU equality + rentang
  waktu + orderBy `created_at desc` (bounded; lihat 35.4).
- **H5 Draft Pending**: daftar `opname_drafts` & `sync_stok_drafts` berstatus
  `pending_confirmation`, ringkasan item, tombol "Tinjau di Telegram".
- **H6 Permintaan Harian**: `daily_requests` hari ini + riwayat. **Riwayat memakai ID dokumen
  `YYYY-MM-DD`** (bukan query `status` + `created_at`), sehingga **tidak butuh** composite index.
- **H7 Admin**: daftar `admins` (name, username, role, added_at), audit `admin_role_changes`,
  `access_requests`. **Filter status pada `access_requests` TIDAK didukung v1** → index
  `access_requests` dihapus (review F).
- **H8 Pengaturan**: provider AI aktif (`system_settings/ai.textProvider`), ubah (owner only).

---

## 16. Prinsip Produk

1. Audit dulu, kenyamanan kemudian.
2. Mobile-first (mayoritas dibuka di HP).
3. Bahasa Indonesia di semua label.
4. Klien tidak dipercaya; server dan Rules memutuskan.
5. Minim function (limit Hobby).
6. Tidak ada AI di jalur dashboard.
7. Angka stok apa adanya: **stok negatif adalah sinyal valid** (kekurangan → minta gudang cabang), bukan kesalahan yang disembunyikan.

---
## 17. User Stories & Acceptance Criteria

Semua requirement bernomor dan punya acceptance criteria yang dapat diverifikasi.

### FR-AUTH (Autentikasi & Sesi)

- **FR-AUTH-01** — Server memverifikasi `initData` dengan HMAC-SHA256 Telegram.
  - AC: `initData` valid (hash cocok, `auth_date` < 1 jam) → 200.
  - AC: `hash` salah → 401; `hash` kosong → 400.
  - AC: `data_check_string` urut abjad `key` (test unit dengan 3+ param).
  - AC: `hash` dibandingkan lowercase; panjang beda → 401 (bukan 500).
- **FR-AUTH-02** — Tolak `initData` kedaluwarsa / tidak valid waktunya.
  - AC: `auth_date` lebih tua dari 3600 s → 401 `initData kedaluwarsa`.
  - AC: `auth_date > now + 60` → 401.
  - AC: `auth_date` hilang / `NaN` / non-integer → 401.
- **FR-AUTH-03** — Hanya admin boleh masuk.
  - AC: `user.id` tidak ada di `admins` → 403, tidak ada data dikirim.
  - AC: `user.id` ada di `admins` → 200 + identitas + role.
  - AC: body `initData` berisi `user` bukan-JSON / array / `id` objek → 401.
- **FR-AUTH-04** — Sesi cookie HttpOnly + Firebase custom token berklaim role.
  - AC: Cookie `HttpOnly`, `Secure`, `SameSite=Lax`; tidak ada token di `localStorage`.
  - AC: Token guest memuat `admin:false`, `role:"guest"`; token admin/owner memuat `admin:true`
    dan `role` sesuai.
  - AC: Role di token berasal dari `admins.role` (bukan input klien) — test kirim `role:"owner"`
    palsu dari klien → token tetap role asli.
- **FR-AUTH-04b** — Re-validasi & pencabutan (D2).
  - AC: Tukar `initData` ketika `admins/{id}` sudah dihapus → 403, tanpa token.
  - AC: Setelah role diturunkan admin→guest, tukar `initData` berikutnya menghasilkan
    `role:"guest"` (bukan role lama).
  - AC: TTL token & cookie = 3600 s; tidak ada perpanjangan sliding.
- **FR-AUTH-05** — Tanpa Telegram → layar khusus.
  - AC: `window.Telegram.WebApp.initData` kosong → layar "Buka dari Telegram", tidak ada request
    data.
- **FR-AUTH-06** — Origin/CSRF (D6).
  - AC: `POST` tanpa/`Origin` tidak di allowlist → 403.

### FR-READ (Pembacaan data)

- **FR-READ-01** — H1 menampilkan kartu ringkasan sesuai role.
  - AC: Total produk online = jumlah `products` dengan `is_online_product == true`.
  - AC: Menipis = jumlah `stock` dengan `reorder_point != null` dan
    `stok_gudang_online < reorder_point`.
  - AC: Untuk guest, kartu draft & permintaan harian tidak dirender dan query-nya tidak dijalankan.
- **FR-READ-02** — H2 tabel stok dapat dicari & disaring.
  - AC: Cari memfilter pada `kode_barang` dan `nama_accurate` (case-insensitive).
  - AC: Filter "menipis" hanya item `stok_gudang_online < reorder_point` (dihitung in-memory via
    full-scan `stock`, lihat 25.1).
- **FR-READ-03** — H3 timeline memuat pergerakan kode terpilih.
  - AC: Query `stock_movements where kode_barang == X orderBy created_at desc limit 20` sukses
    (index lama #2). Tidak ada filter `type` di H3.
- **FR-READ-04** — H4 dapat disaring.
  - AC: Filter `created_by` memakai string; hasil hanya terjamin untuk dokumen tersimpan bertipe
    string (13.3 A4).
  - AC: Filter `type` / `status` memakai index baru #1/#2 (35.2).
  - AC: Tidak lebih dari satu equality filter + filter tanggal + orderBy `created_at desc` dalam
    satu query (bounded; 35.4).
- **FR-READ-05** — H5 memuat draft `pending_confirmation` (opname & sync).
  - AC: Guest query ke `opname_drafts`/`sync_stok_drafts` → `permission-denied`; halaman tidak
    merender data.
- **FR-READ-06** — H6 memuat `daily_requests`.
  - AC: Dokumen hari ini dibaca by ID `YYYY-MM-DD`; riwayat memakai daftar ID hari terakhir
    (tanpa filter `status`).
  - AC: Guest → `permission-denied`.
- **FR-READ-07** — H7 memuat `admins`, `admin_role_changes`, `access_requests`.
  - AC: Guest → `permission-denied` untuk ketiganya.
- **FR-READ-08** — H8 memuat `system_settings/ai`.
  - AC: Guest → `permission-denied`.

### FR-WRITE (Aksi tulis stok)

- **FR-WRITE-01** — Tambah stok via server.
  - AC: `POST /api/stok/mutasi {mode:"tambah",qty:5}` → `stock.stok_gudang_online` naik 5.
  - AC: Tercatat 1 baris `stock_movements` `type:"koreksi_manual"`, `action_type:"tambah_stok"`,
    `source:"web_dashboard"`, `created_by` = **string** id pengguna, `confirmed_by` = id pengguna.
- **FR-WRITE-02** — Kurangi stok BOLEH menghasilkan saldo negatif (keputusan owner I1).
  - AC: `mode:"kurangi"`, `qty > stok saat ini` → **200** `{ ok:true }`; `stock.stok_gudang_online`
    menjadi **negatif** (mis. 3 - 5 = -2); **1 baris** audit tertulis.
  - AC (unit): `_ubahStokRelatif` dengan stok 3 dan delta -5 **menyimpan -2** (TIDAK melempar); ada
    penulisan.
  - AC (konkurensi): dua `kurangiStok(kode, 3)` bersamaan pada stok 4 → **keduanya diterapkan**;
    stok akhir `== -2` (= jumlah delta). Assertion `>= 0` **tidak ada**.
  - AC: Konsistensi tetap dijaga `runTransaction` (tidak ada lost update); tetap diuji.
- **FR-WRITE-03** — Timpa (opname) sesuai konvensi nyata (A1).
  - AC: `mode:"timpa"` menulis nilai fisik; audit `qty_sistem`, `qty_fisik`,
    `selisih = qty_fisik - qty_sistem` terisi; **`type:"opname"`**; **`action_type:"kurangi_stok"`**.
  - AC: Tidak ada dokumen `stock_movements` baru dengan `action_type == "opname"` (nilai itu tidak
    ada di codebase).
- **FR-WRITE-04** — Guest/non-admin ditolak.
  - AC: `role == "guest"` → 403; stok TIDAK berubah; tidak ada audit.
- **FR-WRITE-05** — Produk tidak ditemukan.
  - AC: `kode_barang` tak ada di `products`/`stock` → 404; tidak ada penulisan.
- **FR-WRITE-06** — Validasi angka per mode (E3).
  - AC: `tambah`/`kurangi`: bukan integer atau `< 1` → 400.
  - AC: `timpa`: bukan integer atau `< 0` → 400.
  - AC: `qty` `NaN`/`Infinity`/string/`1e999` → 400.
- **FR-WRITE-07** — Satu pintu model.
  - AC: Route mengimpor `kurangiStok`/`tambahStok`/`timpaStokOpname` dari `lib/models/stok.js`;
    tidak ada penulisan `stock` di luar model itu (review kode).
- **FR-WRITE-08** — Guard double-submit (D4, best-effort).
  - AC: Dua POST identik (kode+mode+qty sama) dari user sama berurutan <= 10 s → request kedua
    **409** `{ ok:false, error:"duplikat" }`; stok berubah **sekali**.
  - AC: Collection `stock_write_guard` tidak dapat dibaca/ditulis klien (`allow read, write: if
    false`).
  - AC: **Tidak** ada `client_request_id` pada body route (kontrak 24).
- **FR-WRITE-09** — Ubah provider AI (owner only).
  - AC: Owner + provider ∈ `["gemini","groq"]` → 200, `system_settings/ai.textProvider` berubah,
    `updatedBy` = string id owner.
  - AC: Admin → 403.
  - AC: Provider di luar enum (mis. `"openai"`) → 400 (`Provider AI tidak dikenal.`).
- **FR-WRITE-10** — Rate limit tulis.
  - AC: Tulisan ke-21 dalam 60 s dari user yang sama → 429.

### FR-ROUTES (Batas function)

- **FR-ROUTES-01** — Jumlah function total <= 12 dengan aturan aktual (12.1).
  - AC: Bukti `vercel build` mencantumkan daftar function termasuk Next route handlers &
    middleware; total <= 12; target internal <= 4 (12.2).
- **FR-ROUTES-02** — Tidak ada route read-only & tidak ada halaman SSR.
  - AC: Daftar route hanya auth, mutasi stok, (opsional) pengaturan.
  - AC: H1..H8 dirender statis; tidak ada server action untuk pembacaan.
- **FR-ROUTES-03** — Tidak ada `page_view` server-side.
  - AC: Tidak ada route/log endpoint untuk `page_view` (Bagian 27).

### FR-DATA (Konsistensi data)

- **FR-DATA-01** — `created_by` bertipe string (A4).
  - AC: `catatPergerakanStok` menormalkan `created_by`/`requested_by`/`confirmed_by` ke `String()`
    atau `null`; test unit menyimpan input numerik → tersimpan string.
  - AC: Dashboard selalu mengirim string.

### FR-NFR & TEST

- **FR-TEST-01** — `npm test` tetap hijau.
  - AC: `npm test` → semua lulus; tidak ada test lama dihapus/dilonggarkan.
  - AC: Test baru: HMAC `initData` (valid, hash salah, kedaluwarsa, urutan param, `auth_date`
    invalid), transaksi atomik D3 (unit `stok 3, delta -5 → -2` + konkurensi dua-penulis tanpa
    assert `>= 0`), normalisasi `created_by`, guard double-submit.
- **FR-NFR-01** — Bahasa Indonesia.
  - AC: Tidak ada label UI di luar **allowlist istilah asing**: `stok`, `stock`, `produk`,
    `kode barang`, `HPP`, `reorder point`, `Telegram`, `Mini App`, `AI`, `Gemini`, `Groq`,
    `Firestore`, `online`, `draft`, `id`, `login`, istilah teknis/proper noun yang disepakati.
    Review manual memakai daftar ini; label di luarnya = gagal.
- **FR-NFR-02** — Dark mode + light mode.
  - AC: Mengikuti `prefers-color-scheme` + toggle manual; kontras teks >= 4.5:1.
- **FR-NFR-03** — Aksesibilitas (WCAG 2.1 AA dasar).
  - AC: Navigasi keyboard, `aria-label` pada kontrol ikon, Lighthouse a11y >= 90 pada H2.
- **FR-NFR-04** — Responsive mobile-first.
  - AC: Usable pada 360x640, 768x1024, 1280x800; tidak ada scroll horizontal pada 360 px.
- **FR-NFR-05** — Waktu muat H1 (E2).
  - AC: P75 <= 2,5 s pada 4G untuk katalog uji <= 2.000 produk online (asumsi 25.1); ukur dengan
    web-vitals pada 20 sesi uji. Jika katalog > 2.000, target ditinjau ulang (bukan janji mutlak).

---

## 18. Business Rules

- BR1. Tulis stok hanya lewat `lib/models/stok.js`.
- BR2. Setiap tulis menghasilkan tepat 1 baris `stock_movements`.
- BR3. `source = "web_dashboard"` hanya untuk aksi dashboard.
- BR4. `kurangiStok`/`tambahStok` memakai `Math.abs(qty)`; validasi tetap di server.
- BR5. Role dari `admins.role`; `SUPER_ADMIN_ID` dianggap owner.
- BR6. Tidak ada perubahan role dari dashboard v1.
- BR7. Ubah provider AI hanya owner; enum valid `["gemini","groq"]`.
- BR8. Draft tidak dapat diubah dari dashboard v1 (hanya lihat + arahan ke bot).
- **BR9. Stok `stock.stok_gudang_online` BOLEH negatif.** Saldo negatif = sinyal kekurangan;
  admin diminta "minta ke gudang cabang". Tidak ada guard tolak-negatif (`StokTidakCukupError`
  DIHAPUS). Transaksi `lib/models/stok.js` tetap atomik demi konsistensi tulis konkuren.
- **BR9b. Validasi input tetap:** `tambah`/`kurangi` wajib `qty > 0`; `timpa` wajib `qty >= 0`.
  Hasil (stok setelah aksi) tidak dibatasi.
- **BR9c. Interpretasi tampilan:** produk `stok_gudang_online < 0` berstatus "Stok Minus"; jumlah
  kekurangan = `Math.abs(stok_gudang_online)`. Histori menampilkan nilai negatif apa adanya.
- **BR10. `created_by`/`requested_by`/`confirmed_by` di `stock_movements` bertipe string.**
- **BR11. Guest hanya boleh membaca `stock`/`products`/`stock_movements`.** Koleksi lain ditolak
  Rules.
- **BR12. Guard double-submit bersifat best-effort** (10 s, per user); bukan jaminan idempotensi
  mutlak.

---
## 19. Alur Pengguna

### 19.1 Masuk
Menu button bot → Mini App → client kirim `initData` ke `/api/auth/telegram` → server verifikasi →
custom token (klaim role) + cookie → app memuat H1. Gagal → layar sesuai kode
(401/403/layar non-Telegram).

### 19.2 Koreksi stok
H2/H3 → "Koreksi" → dialog (mode, qty, catatan) → konfirmasi → tombol disabled + `POST
/api/stok/mutasi` → sukses → toast "Stok diperbarui" + refetch → H4 menampilkan baris baru.

### 19.3 Telusuri histori
Tab Histori → filter (satu equality) → timeline → tap item → H3.

### 19.4 Sesi kedaluwarsa saat menulis (B4)
Cookie lewat `auth_date + 60 menit` → POST → 401 → toast "Sesi kedaluwarsa. Buka ulang dari
Telegram." + tombol reload; **tidak ada** penulisan stok/audit.

---

## 20. Empty / Loading / Error States

| Konteks | Empty | Loading | Error |
|---|---|---|---|
| H1 kartu | "Belum ada data stok." | skeleton kartu | banner "Gagal memuat ringkasan. Coba lagi." |
| H1/H2 filter Stok Minus | "Tidak ada produk minus." (empty bila tak ada produk negatif) | skeleton baris | banner + tombol "Coba lagi" |
| H2 tabel | "Tidak ada produk cocok." | skeleton baris | banner + tombol "Coba lagi" |
| H3 timeline | "Belum ada pergerakan untuk produk ini." | skeleton timeline | banner |
| H4 histori | "Belum ada pergerakan pada filter ini." | skeleton | banner |
| H5 draft | "Tidak ada draft menunggu konfirmasi." | skeleton | banner |
| H6 permintaan | "Belum ada permintaan hari ini." | skeleton | banner |
| H7 admin | "Belum ada admin terdaftar." | skeleton | banner |
| H8 pengaturan | — | skeleton | banner; guest/admin → layar "Akses ditolak" |
| Auth | layar "Buka dari Telegram" (tanpa initData) | splash verifikasi | layar error dengan kode |
| Tulis stok | — | tombol disabled + spinner | toast spesifik (400/403/404/409/429); 401 → "Sesi kedaluwarsa...". **Stok minus bukan error**: sukses + badge "Stok Minus" |
| Guest ke halaman staff | layar "Akses ditolak" + tombol kembali | — | `permission-denied` ditangani sebagai "Akses ditolak" |

---

## 21. Edge Cases

| # | Skenario | Perilaku wajib |
|---|---|---|
| E1 | `initData` kedaluwarsa | 401, layar "Sesi kedaluwarsa, buka ulang dari Telegram", tombol reload. |
| E2 | User bukan admin | 403, layar "Akses ditolak. Hubungi owner." Tanpa data. |
| E3 | Stok kurang (kurangi melebihi saldo) | **Bukan error**: 200, saldo menjadi negatif (13.6), audit tertulis. UI menampilkan badge "Stok Minus" + kekurangan = nilai absolut. Tidak ada 409 sufficiency. |
| E4 | Produk tidak ketemu | 404, pesan "Produk tidak ditemukan". |
| E5 | Offline / jaringan gagal | banner "Tidak ada koneksi", tombol "Coba lagi"; tanpa optimistic write. |
| E6 | Angka tidak valid | 400. Pesan **per mode**: relatif → "Jumlah harus bilangan bulat >= 1"; timpa → "Jumlah fisik harus bilangan bulat >= 0" (E3). |
| E7 | Double-submit | FR-WRITE-08: guard 10 s + tombol disabled; request kedua 409. Idempotensi mutlak TIDAK dijanjikan. |
| E8 | Dua admin koreksi bersamaan (kurangi) | `runTransaction` → **keduanya diterapkan** (tanpa lost update); stok akhir = jumlah delta (boleh negatif); tiap tulis = 1 baris audit. Test dua-penulis wajib, **tanpa assertion `>= 0`** (FR-WRITE-02). |
| E9 | `reorder_point` null | Tidak masuk "menipis" (`reorder_point != null`). |
| E10 | Katalog kosong | Empty state; tidak error. |
| E11 | `initData` ada tapi `user` hilang / JSON rusak / id bukan skalar | 401. |
| E12 | Model melempar (mis. Firestore error) | 500 + pesan generik; audit ditulis setelah stok sukses; jika audit gagal setelah stok sukses, log error (pola `chatHandler.js`) + hook monitoring (Bagian 34), tidak rollback. |
| E13 | Cookie kedaluwarsa saat menulis | 401 mid-write, toast, tanpa penulisan (11.2, 19.4). |
| E14 | `user.id` numerik vs string | Selalu `String(user.id)` saat lookup `admins` (`admins.js` sudah `String`); token `createCustomToken(String(id))`. |
| E15 | `reorder_point == 0` dan stok 0 | `0 < 0` false → **bukan** menipis. Perilaku disengaja. |
| E16 | Stok negatif (baru maupun lama) | Ditampilkan apa adanya dengan badge **"Stok Minus"** (merah); kekurangan = nilai absolut; masuk daftar "perlu minta gudang cabang". **Bukan anomali**, bukan bug; tidak diperbaiki otomatis. |
| E17 | Dokumen `products` ada tapi `stock` tidak | Join in-memory menampilkan stok `Tidak diketahui`; aksi Koreksi membuat dokumen stok (via model). |
| E18 | Rate limit tulis | 429 "Terlalu banyak permintaan. Coba lagi sebentar lagi." |
| E19 | Provider AI di luar enum | 400 "Provider AI tidak dikenal." |

---

## 22. Notifikasi

- Dashboard **tidak** mengirim notifikasi push.
- Efek samping server: koreksi stok memicu `cekDanNotifikasiReorderPoint` (notif Telegram) bila
  stok <= `reorder_point` — perilaku sama dengan bot.

---

## 23. Requirement Data & Field

Sumber field (jangan mengarang): `lib/models/*.js`.

| Koleksi | Doc ID | Field dipakai dashboard |
|---|---|---|
| `stock` | `kode_barang` | `stok_gudang_online` (**signed integer, boleh negatif** — lihat 13.6; jangan diasumsikan >= 0), `reorder_point`, `last_updated`, `last_updated_by`, `last_synced_at`, `last_synced_value` |
| `products` | `kode_barang` | `nama_accurate`, `nama_accurate_normalized`, `hpp`, `hpp_baru`, `is_online_product`, `variants[]`, `search_keywords[]`, `updated_at` |
| `stock_movements` | auto-id | `kode_barang`, `nama_terbaca`, `variasi`, `qty` (**signed; delta kurangi negatif**), `type`, `action_type`, `qty_sistem`, `qty_fisik`, `selisih` (**signed**), `catatan`, `source`, `status`, `created_at`, `created_by` (**string**), `created_by_username`, `created_by_name`, `requested_by`, `requested_by_username`, `requested_by_name`, `confirmed_by`, `resolved_by`, `penanda` |
| `daily_requests` | `YYYY-MM-DD` | `items[]{kode_barang,nama,variasi,qty,buffer}`, `status`, `created_at` |
| `opname_drafts` | auto-id | `items[]`, `status`, `created_at` |
| `sync_stok_drafts` | auto-id | `kondisi`, `items[]`, `index_kolom`, `status`, `created_at` |
| `admins` | `telegram_user_id` | `name`, `telegram_username`, `role`, `added_at`, `approved_by`, `role_updated_at`, `role_updated_by` |
| `admin_role_changes` | auto-id | `target_user_id`, `target_name`, `old_role`, `new_role`, `changed_by`, `created_at` |
| `access_requests` | `telegram_user_id` | `status`, `requested_at`, `telegram_username`, `telegram_display_name`, `rejected_until`, `resolved_by`, `resolved_at` |
| `system_settings/ai` | `ai` | `textProvider`, `updatedAt`, `updatedBy` |
| `stock_write_guard` | `telegram_user_id` | `kode_barang`, `mode`, `qty`, `at` (server-only, 13.4) |

Catatan:
- **Satu sumber kebenaran `stock_movements`** = tabel di atas (A3). `resolved_by` termasuk; tabel
  13.3 hanya menetapkan nilai untuk aksi dashboard. Field tidak relevan dibiarkan `null`.
- **Tidak ada field `nama_shopee` top-level** di `products`; nama Shopee ada di
  `variants[].nama_shopee`.
- **`stock_write_guard`** perlu Rules `allow read, write: if false` (tercakup catch-all 11.6,
  disebut eksplisit).

---

## 24. API / Integration Requirements

| Endpoint | Method | Auth | Body | Respons |
|---|---|---|---|---|
| `/api/auth/telegram` | POST | `initData` | `{ initData }` | `{ ok, user:{id,username,name}, role }` + Set-Cookie + custom token |
| `/api/stok/mutasi` | POST | cookie sesi | `{ kode_barang, mode, qty, catatan? }` | sukses `{ ok:true, stok_baru, movement_id }` (**`stok_baru` boleh negatif**); 409 duplikat `{ ok:false, error:"duplikat" }`; 400/401/403/404/429 |
| `/api/pengaturan/ai` | POST | cookie sesi (owner) | `{ provider }` | `{ ok, pengaturan }`; 400 provider invalid; 403 admin |

- `client_request_id` **dihapus** dari kontrak (D4). Skema respons selaras FR-WRITE-08 (E5).
- Semua route memvalidasi `Origin` (11.10) dan menerapkan rate limit (11.9).
- Env baru: `DASHBOARD_ALLOWED_ORIGINS` (allowlist origin). Tidak ada env rahasia baru lain
  (`TELEGRAM_BOT_TOKEN` sudah ada). Firebase client config publik boleh di-expose
  (`NEXT_PUBLIC_FIREBASE_*`) — aman, dilindungi Rules. Service-account key TIDAK ke client.

---
## 25. Requirement Non-Fungsional

- **Performa (E2)**: H1 P75 <= 2,5 s pada 4G **dengan asumsi 25.1**; interaksi tabel >= 60 fps;
  pagination default 20 (maks 100).
- **Aksesibilitas**: WCAG 2.1 AA dasar — kontras >= 4.5:1, fokus terlihat, kontrol form berlabel,
  `aria-label` untuk tombol ikon.
- **Responsive**: mobile-first; minimal 360 px, tablet 768 px, desktop 1280 px.
- **Dark mode**: `prefers-color-scheme` + toggle; token warna semantik.
- **Keamanan**: Bagian 11.
- **Reliabilitas**: aksi tulis melalui transaksi atomik (konsistensi tulis konkuren); **tanpa** guard tolak-negatif; tanpa optimistic update untuk tulis stok.
- **Batas function**: Bagian 12.

### 25.1 Realitas full-scan & asumsi ukuran data (review E2)

- Firestore TIDAK dapat mengekspresikan `stok_gudang_online < reorder_point` sebagai query
  (perbandingan field-vs-field). **Semua** perhitungan "menipis" dan "reorder" memerlukan pembacaan
  seluruh koleksi `stock` + join in-memory dengan `products` (persis pola
  `lib/models/stok.js::_ambilSemuaStokDenganCache` dan `cariStokDiBawahReorderPoint`).
- Scope v1 dibatasi: join hanya untuk produk `is_online_product == true`. Item `stock` yang tidak
  punya pasangan produk online tidak ditampilkan di H2/H1.
- **Asumsi ukuran data:** katalog online <= 2.000 dokumen saat rilis. Asumsi ini mengikat S2 /
  FR-NFR-05. Jika katalog melewati 2.000, tim harus (a) meninjau ulang target 2,5 s, atau (b)
  memindahkan agregat ke server (menambah function — butuh renegosiasi budget 12).

---

## 26. UX/UI Requirements

- Gaya: SaaS WMS bersih, netral modern, tanpa brand toko. Token semantik.
- Navigasi bawah (bottom nav) untuk mobile; sidebar untuk desktop.
- Badge stok: **aman** (`>= reorder` atau reorder null), **menipis** (`0 <= stok < reorder`), **Stok Minus** (`stok < 0`). "Habis" (`== 0` dengan reorder > 0) tampil sebagai menipis. Prioritas: Stok Minus > menipis > aman. Warna + label teks (bukan warna saja) demi aksesibilitas.
- Tabel → kartu pada mobile.
- Semua label Bahasa Indonesia (allowlist 17 FR-NFR-01).
- Konsistensi visual (spacing, radius, tipografi) via skill `design-system`.

---

## 27. Analytics / Events (review C2)

- **`page_view` klien DIHAPUS** dari v1: implementasinya butuh route/third-party, yang menambah
  function (melanggar 12) atau dependency eksternal (diharamkan).
- Event yang tersisa, **semua log server di route yang sudah ada** (0 function tambahan):
  - `auth_success`, `auth_fail` (dengan kode 401/403/400) — di `/api/auth/telegram`.
  - `stock_write_success` (termasuk hasil negatif — bukan error), `stock_write_reject` (dengan alasan
    400/403/404/409/429) — di `/api/stok/mutasi`. Tidak ada event khusus "stok tidak cukup"
  - Log tidak memuat token/`initData` mentah; boleh memuat `telegram_user_id` untuk audit internal.

---

## 28. Success Metrics

Lihat S1..S6 (1.3). Tambahan:

- Rasio aksi tulis stok yang punya audit = 100%.
- Waktu buka H1 dari tap menu → konten tampil <= 3 s P75 (dengan asumsi 25.1).

---

## 29. Acceptance Criteria (ringkasan DoD per fitur)

- Auth: FR-AUTH-01..06.
- Baca: FR-READ-01..08.
- Tulis: FR-WRITE-01..10.
- Route/limit: FR-ROUTES-01..03.
- Data: FR-DATA-01.
- NFR & test: FR-TEST-01, FR-NFR-01..05.
- Semua edge case Bagian 21 tertangani.

---

## 30. MVP vs Future Scope

**MVP (v1):** H1..H8, auth berklaim role, tulis stok + **transaksi atomik (tanpa tolak-negatif)**, tampilan **Stok Minus** (badge/filter/daftar kekurangan), guard double-submit, ubah provider AI (owner), Rules final per-role.

**Future:** backfill `created_by` string, aksi setuju/tolak access request, edit role, konfirmasi
draft dari web, ekspor CSV, multi-outlet, notifikasi push, grafik lanjutan, agregat server bila
katalog > 2.000.

---

## 31. Dependencies

Sisi server (sudah ada):
- `firebase-admin` — verifikasi & custom token.
- `@vercel/functions`.

**Dependency client baru (review A5 — belum terpasang di `package.json`):**
- `next`, `react`, `react-dom`.
- `tailwindcss` + postcss/autoprefixer (atau Tailwind v4 + `@tailwindcss/postcss`).
- `shadcn/ui` (instalasi komponen, bukan paket runtime tunggal).
- `firebase` (client SDK: `signInWithCustomToken`, Firestore).
- Telegram WebApp JS SDK (client-only, via script).

**Dev dependencies (khusus testing, TIDAK ikut ke produksi):**

- `@playwright/test` — dependency **dev-only** (`devDependencies`). Wajib dijalankan `npx playwright
  install` sekali per mesin/CI untuk mengunduh browser (Chromium minimal; opsional WebKit untuk
  smoke iOS).
- `@axe-core/playwright` (opsional) — aksesibilitas otomatis di dalam Playwright.
- **Aturan paket:** dependency di atas TIDAK BOLEH diimpor dari kode aplikasi (`app/**`, `lib/**`,
  `components/**`) maupun dari route handler. Hanya boleh diimpor dari direktori test
  (`tests/**`/`e2e/**`) dan playwright config.
- **Tidak menambah function Vercel:** Playwright/axe adalah dependency dev + test lokal/CI; tidak
  di-bundle ke build produksi, tidak menghasilkan route/serverless function, sehingga **tidak
  mengubah hitungan budget 12 function** (Bagian 12). Bukti: `vercel build` tetap menunjukkan daftar
  function yang sama (target internal <= 4).
- **Bundle produksi bersih:** `npm ci --omit=dev` tidak memasang Playwright; build Vercel tidak
  memuat direktori test. Bila ada impor test dari kode app, build gagal = temuan yang harus
  diperbaiki (bukan diabaikan).
**Strategi versi:** kunci versi mayor di `package.json`; `next` versi stabil terbaru saat Tahap 1.
**Risiko interop:** repo ber-`"type": "commonjs"`. File Next modern (`.tsx`/`.ts`) harus dipisah
dan tidak boleh `require` inkonsisten dengan konfigurasi; `next.config` memakai format yang
didukung Next. Pastikan `lib/` CJS tetap dipakai server-side route via `import`/`require` yang
kompatibel. Verifikasi di Tahap 1 dengan `next build`.

---

## 32. Risks & Mitigations

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Salah verifikasi HMAC `initData` / parse aman | Pembobolan / 500 | Unit test; `timingSafeEqual`; parse `user` try/catch; review keamanan. |
| R2 | Rules terlalu longgar | Kebocoran data | Rules per-role (11.6); tidak ada `request.auth != null` polos; guest tanpa `admin:true`. |
| R3 | Function melebihi 12 | Deploy gagal | Semua halaman statis; tanpa middleware; bukti `vercel build`. |
| R4 | Custom token butuh kredensial server | Auth gagal | Secrets sudah ada; test end-to-end. |
| R5 | Cache basi vs tulis bot | Angka salah | Realtime/refetch on focus; cache model tetap invalidator tunggal. |
| R6 | Draft hanya lihat | UX bercabang | v1 disengaja; tombol "Tinjau di Telegram". |
| R7 | Race double-submit | Stok dobel | Guard 10 s (best-effort) + tombol disabled. |
| R8 | Audit gagal setelah stok sukses | Jejak hilang | Log error + hook monitoring (Bagian 34), bukan rollback. |
| R9 | Data lama `created_by` numerik | Query H4 mengembalikan 0 baris | Normalkan ke depan (string); filter string; backfill ditunda ke Future. (Stok negatif TIDAK lagi termasuk risiko — kini fitur, I1/13.6.) |
| R10 | Pencabutan role belum berlaku pada baca | Akses baca <= 1 jam | Re-validasi saat tukar token; TTL 1 jam; tulis tetap dicek ulang. Residual diterima (11.7). |
| **R11** | **Mock auth bypass aktif di produksi** (mode mock menyuntik role tanpa `initData`) | Siapa pun bisa mengakses dashboard seolah owner/admin | (1) Flag bypass HANYA dihormati bila `NEXT_PUBLIC_DASHBOARD_DATA=mock`, dan mode `mock` **menolak boot** di build produksi (`NODE_ENV=production` / `VERCEL_ENV=production`) — jika flag bypass terpasang di produksi, build/route gagal keras, bukan diam-diam lolos. (2) Bypass di-inject lewat env/query param yang HANYA dibaca di mode mock; kode jalur `real` tidak memuat cabang bypass. (3) Test wajib: (a) assertion build produksi menolak flag bypass, (b) test Playwright mode real bahwa query param role diabaikan, (c) review kode memastikan tidak ada `if (role from param)` di mode real. (4) Smoke test pasca-deploy: buka dashboard tanpa `initData` → layar "Buka dari Telegram", bukan data. |
| **R12** | Refresh `initData` untuk test integrasi nyata otomatis | `initData` kedaluwarsa 1 jam; memutar refresh butuh kredensial Telegram dan berisiko bocor | **Tidak dilakukan.** Verifikasi integrasi nyata = `npm test` (node:test, backend nyata) + **smoke test manual WAJIB** di Mini App Telegram nyata sebelum rilis (Bagian 37 C4/D, 38). Smoke manual = kontrol yang diterima. |
| **R13** | Playwright → real swap memecah UI tanpa terdeteksi | Regresi tak tertangkap | Playwright **tetap mock** (tidak pernah menembak real); pasca-swap dijalankan ulang untuk regresi UI. Kebenaran data dijamin `npm test` + smoke manual. |

Asumsi terbuka:
- Owner menyetujui Firebase Custom Token sebagai jembatan Rules.
- `initData` selalu tersedia di runtime Mini App (diverifikasi Tahap 0).
- Katalog online <= 2.000 (25.1).

---
## 33. Rollout Strategy

1. Deploy ke preview Vercel; uji hanya di dalam Telegram.
2. Deploy `lib/models/stok.js` + `stockMovements.js` (transaksi atomik + normalisasi string; **tanpa** guard tolak-negatif) **dan** `npm test` hijau sebelum dashboard diaktifkan.
3. Deploy Rules Firestore (per-role, deny by default) sebelum halaman publik.
4. Aktifkan menu button bot setelah H1-H3 stabil.
5. Rilis bertahap: baca dulu → tulis stok → pengaturan.

---

## 34. Monitoring & Rollback

- **Monitoring:** log server `auth_fail`/`stock_write_reject`; Vercel log error 500. **Hook khusus
  (E6):** `audit_write_failed` dicatat pada level `error` dengan `kode_barang` + `movement_type`
  bila `catatPergerakanStok` gagal setelah stok sukses; diekspos di Vercel log + alert manual
  (log drain) agar tidak silent.
- **Rollback:** revert deployment Vercel; Rules dapat dikembalikan deny-all seketika tanpa
  menyentuh data stok.
- Tidak ada migrasi data wajib (perubahan skema: normalisasi string `created_by` untuk data baru;
  data lama ditangani sebagai risiko R9).

---

## 35. Firestore Index (dirapikan — review F)

### 35.1 Index lama (sudah ada di `firestore.indexes.json`)
- `stock_movements`: `created_by ASC` + `created_at DESC`
- `stock_movements`: `kode_barang ASC` + `created_at DESC`

### 35.2 Index BARU final (hanya yang didukung query nyata)

| # | Koleksi | Fields | Query yang didukung | Alasan |
|---|---|---|---|---|
| 1 | `stock_movements` | `type ASC`, `created_at DESC` | H4 filter `type` | NEEDED |
| 2 | `stock_movements` | `status ASC`, `created_at DESC` | H4 filter `status` | NEEDED |
| 3 | `opname_drafts` | `status ASC`, `created_at DESC` | H5 `pending_confirmation` | NEEDED |
| 4 | `sync_stok_drafts` | `status ASC`, `created_at DESC` | H5 `pending_confirmation` | NEEDED |

### 35.3 Dihapus (redundant / tanpa query)
- `source ASC + created_at DESC` — H4 v1 tidak memfilter `source` → hapus.
- `kode_barang ASC + type ASC + created_at DESC` — H3 tidak memfilter `type`; query existing
  `kode_barang + created_at` sudah ada → hapus.
- `admin_role_changes created_at DESC` — single-field auto-index → hapus.
- `daily_requests status ASC + created_at DESC` — H6 memakai doc ID `YYYY-MM-DD` → hapus.
- `access_requests status ASC + requested_at DESC` — H7 v1 tidak memfilter status → hapus.

### 35.4 Aturan bounded query
H4 hanya mengizinkan **satu** equality filter (dari `kode_barang`/`type`/`status`/`created_by`) +
rentang `created_at` + `orderBy created_at desc` dalam satu permintaan. Kombinasi dua equality +
rentang akan memerlukan index tambahan dan **tidak didukung v1** (menghindari ledakan index).
`products where is_online_product == true` cukup single-field.

Perintah deploy index:

```bash
firebase deploy --only firestore:indexes
```

---

## 36. Definition of Done

- Semua FR Bagian 17 terpenuhi dengan bukti verifikasi.
- `npm test` hijau, termasuk: verifikasi `initData` (valid/hash salah/kedaluwarsa/urutan/`auth_date`
  invalid/`user` rusak), **transaksi atomik D3: unit (`stok 3, delta -5` → `-2` tersimpan) +
  konkurensi dua-penulis (stok akhir = jumlah delta, boleh negatif, tanpa assert `>= 0`)**, normalisasi
  `created_by` string, guard double-submit.
- `lib/models/stok.js` memakai `runTransaction` (atomik) dan **TIDAK** memuat guard tolak-negatif /
  `StokTidakCukupError`; `chatHandler.js` tidak diubah untuk error itu.
- Firestore Rules final ter-deploy: per-role, guest tidak punya `admin:true`, tulis client ditolak,
  `stock_write_guard` ditolak.
- Konvensi audit opname: `type:"opname"` + `action_type:"kurangi_stok"` (tidak ada `action_type:
  "opname"`).
- `stock_movements` mencatat `source:"web_dashboard"` dan `created_by` string untuk setiap tulis
  dashboard.
- Bukti `vercel build`: total function <= 12 (target <= 4), termasuk Next route handlers &
  middleware; H1..H8 statis.
- Tidak ada akses browser-only (layar "Buka dari Telegram").
- Test role: guest → `permission-denied` untuk `opname_drafts`, `sync_stok_drafts`,
  `daily_requests`, `admins`, `admin_role_changes`, `access_requests`, `system_settings`.
- Semua label Bahasa Indonesia (allowlist FR-NFR-01); dark mode + light mode berfungsi.
- **Suite Playwright mock-first hijau** (Bagian 38): seluruh skenario mock lulus (`npx playwright test`)
  **dalam mode MOCK** (tetap mock bahkan setelah integrasi backend; lihat I2). Tidak ada network call
  ke Firestore/Telegram nyata. Mencakup state **Stok Minus** (badge, filter, empty state).
- **Tampilan Stok Minus:** H2 menampilkan badge merah "Stok Minus" untuk `stok_gudang_online < 0`;
  filter "perlu minta gudang cabang" berfungsi; kekurangan = nilai absolut; H4 menampilkan delta
  negatif apa adanya; mock memuat >= 1 produk negatif.
- **Smoke test manual WAJIB di Mini App Telegram NYATA sebelum rilis** (hanya cara menguji `initData`
  end-to-end; Playwright tidak bisa — `initData` tidak ada di headless browser). Checklist di
  Bagian 37 C4. Rilis DIBLOKIR bila smoke belum lulus.
- **Mock-first sequencing dipatuhi:** integrasi backend nyata (auth `initData`, custom token, baca
  Firestore, route tulis) HANYA dilakukan setelah UI + suite Playwright mock selesai (Fase A ->
  Fase C, Bagian 37). DoD tidak terpenuhi bila backend disambung sebelum gate Fase A hijau.
- Lighthouse aksesibilitas >= 90 pada H2. **Catatan:** Lighthouse tetap target S5, tetapi uji aksesibilitas
  otomatis UTAMA adalah Playwright + `@axe-core/playwright` (berjalan tiap suite, bukan manual);
  Lighthouse dipakai sebagai konfirmasi tambahan, bukan satu-satunya bukti.
- Tidak ada dependency AI di bundle dashboard.

---

## 37. Urutan Implementasi (tiap tahap = 1 sesi agent)

**Prinsip urutan (REVISI v3, diperkuat v4):** UI dibangun & diuji terhadap **mock** lebih dulu;
backend diintegrasikan belakangan. Setiap tahap diserahkan ke agent **frontend UI/UX spesialis**;
tiap tahap frontend berakhir dengan **suite Playwright hijau + `npm test` hijau**. Tidak ada
integrasi backend sebelum gerbang Fase A terpenuhi.

**Prinsip v4 (keputusan I2):** **Playwright TETAP MOCK sampai akhir** (bahkan setelah integrasi
backend). Alasan: `initData` tidak ada di headless browser, jadi auth nyata tidak bisa diuji
Playwright. Verifikasi integrasi nyata = `npm test` (node:test) + **smoke test manual WAJIB** di
Mini App Telegram nyata. Fase B (guard atomik) **DIHAPUS**; sisa validnya (normalisasi `created_by`
A4) dipindah ke C3.

**Fase A — Frontend terhadap mock (backend TIDAK tersambung):**

1. **A0 — Scaffold + mock + Playwright.** Next.js App Router + TS + Tailwind + shadcn (dependencies
   baru A5), lapisan data-access dengan dua implementasi `mock`/`real` (Bagian 38), data mock
   deterministik, `@playwright/test` terpasang + `npx playwright install`, konfigurasi test. Gate:
   `npx playwright test` jalan (suite kosong/minimal) tanpa menembak backend nyata.
2. **A1 — Kerangka UI.** Layout + navigasi (bottom nav mobile / sidebar desktop) + kerangka H1..H8
   yang merender dari mock. Gate: Playwright menguji routing antar halaman H1..H8 hijau.
3. **A2 — Stok.** H2 + H3 + dialog Koreksi Stok (mode/qty/catatan, validasi per mode, disabled saat
   submit), semuanya melawan mock. **Termasuk state "Stok Minus":** badge merah, filter "perlu minta
   gudang cabang", empty state saat tak ada produk negatif, dan blok "kekurangan = nilai absolut".
   Gate: Playwright form tulis + state halaman + state stok minus hijau.
4. **A3 — Histori.** H4 (filter satu equality + pagination) melawan mock. Gate: Playwright filter &
   empty/loading/error state hijau.
5. **A4 — Ringkasan.** H1 kartu + daftar (varian guest). Gate: Playwright render kartu per role hijau.
6. **A5 — Draft, Permintaan, Admin & Pengaturan.** H5 + H6 + H7 + H8 (termasuk form ubah provider
   untuk owner) melawan mock. Gate: Playwright matriks izin owner/admin/guest + state hijau.
7. **A6 — Suite lengkap + review + polish.** Lengkapi cakupan Playwright (Bagian 38): matriks izin,
   responsive viewport (mobile-first), dark & light mode, aksesibilitas (`@axe-core/playwright`),
   review visual (`visual-review`) & render nyata (`agent-browser`). **Gate Fase A: suite Playwright
   mock 100% hijau + `npm test` hijau.**

**Fase B — DIHAPUS (keputusan owner I2).**

- **Dihapus:** seluruh isi Fase B lama (guard atomik + `StokTidakCukupError` di `lib/models/stok.js`,
  penangkapan error itu di `chatHandler.js`, test guard/konkurensi yang mengharapkan pelemparan).
  Alasan: keputusan owner I1 — stok negatif adalah fitur yang benar, jadi tidak ada guard tolak-negatif
  yang perlu dibangun.
- **Dipindahkan (tetap valid):** **normalisasi `created_by` ke string** (temuan MAJOR A4) di
  `stockMovements.js` + test `node:test`-nya tetap dibutuhkan. Ini bukan bagian dari guard stok, jadi
  tidak dibatalkan I1. Pekerjaan ini **dipindah ke Fase C3** (dikerjakan bersamaan integrasi tulis).
- **Sisa lain:** tidak ada. Fase B tidak berisi item mandiri lain yang masih relevan.

**Fase C — Integrasi backend ke frontend (HANYA setelah Gate Fase A hijau):**

9. **C1 — Auth.** Route `POST /api/auth/telegram` (`initData` + custom token berklaim role) + Rules
   Firestore per-role. Gate: test auth + role hijau (`npm test`, bukan mock). Konfirmasi runtime
   `initData` tersedia saat Mini App nyata (lihat C4 smoke).
10. **C2 — Baca Firestore.** Tukar implementasi `mock` → `real` (client SDK) untuk semua halaman
    H1..H8; bentuk data mock wajib sudah identik dengan Firestore nyata (Bagian 23) sehingga UI tidak
    berubah. Gate: Playwright **mode mock** tetap hijau (regresi UI) + uji integrasi baca via `npm test`.
11. **C3 — Tulis stok + normalisasi (serapan dari Fase B).** Route `POST /api/stok/mutasi` + audit +
    rate limit + guard double-submit, disambungkan ke form yang SUDAH ada (tidak menulis UI baru).
    **Termasuk normalisasi `created_by` ke string** di `stockMovements.js` (temuan A4, mantan Fase B)
    + test `node:test`. Gate: `npm test` hijau (integrasi tulis nyata: stok tersimpan termasuk negatif,
    audit tertulis); stok & audit benar.
12. **C4 — Verifikasi integrasi nyata + smoke manual WAJIB.** Verifikasi integrasi nyata TIDAK
    dilakukan Playwright (Playwright tetap mock, I2). Verifikasi:
    - **`npm test` (node:test) = integrasi backend NYATA, bukan mock:** tulis model stok (termasuk hasil
      negatif), verifikasi HMAC `initData`, baris audit `stock_movements` tertulis, normalisasi string.
    - **`vercel build`** = cek jumlah function (bukti budget <= 12, target <= 4) dan syntax; **BUKAN test.**
    - **Smoke test manual di Mini App Telegram NYATA — MANDATORY sebelum rilis.** Hanya cara
      menguji `initData` end-to-end. Checklist (semua wajib lulus):
      1. Buka Mini App dari menu button bot → layar H1 tampil.
      2. Auth berhasil (server verifikasi `initData`; tanpa layar error 401/403; tidak ada "Buka dari
         Telegram" saat di dalam Telegram).
      3. Baca stok: H2 menampilkan data `stock`+`products` nyata.
      4. Tulis stok: satu aksi Koreksi berhasil; stok berubah.
      5. Baris audit muncul di H4 untuk aksi tadi (`source:"web_dashboard"`, `created_by` string).
      6. **Stok Minus:** produk dengan saldo negatif menampilkan badge merah; filter "perlu minta
         gudang cabang" menampilkan kekurangan = nilai absolut.
      7. Role gating untuk **guest**: guest tidak melihat menu/aksi Draft/Admin/Pengaturan dan tombol
         Koreksi; akses paksa → ditolak (`permission-denied`/layar "Akses ditolak").
    - **Suite Playwright (mock) dijalankan ulang pasca-swap** untuk **regresi UI saja** (memastikan
      mock→real swap tidak merusak tampilan), bukan bukti integrasi.
    - Rilis DIBLOKIR bila smoke manual belum lulus atau item mana pun gagal.

**Fase D — Rilis:**

13. **D1 — Commit + push HANYA setelah semua gate hijau** (Gate Fase A + C4 termasuk smoke manual).
    Tidak ada commit sebelum gate terpenuhi. Smoke manual di Telegram nyata = syarat wajib D1.

Mantan **Tahap 0 (verifikasi asumsi runtime)** tetap sebagai langkah paling awal, sekarang masuk
ke **A0**: konfirmasi `initData` tersedia saat runtime Mini App, ukur jumlah function hasil
`vercel build`, finalkan Rules per-role, putuskan fallback cookie-vs-bearer (11.10). Catatan:
asumsi runtime `initData` diverifikasi di Fase C1 (saat auth nyata disambung); Fase A memakai
bypass auth mock (Bagian 38, risiko R11).

---

## 38. Strategi Testing Frontend (Playwright + Mock-first)

### 38.1 Prinsip

- **UI dibangun & diuji terhadap mock dulu; backend baru diintegrasikan setelah UI matang.**
- Alasan: (a) UI dapat dimatangkan tanpa menunggu auth/Firestore (menghilangkan blocker integrasi
  dini); (b) bug divisualkan lebih awal (routing, layout, state, izin); (c) kontrak API **dibekukan
  lewat mock**, sehingga integrasi nanti hanya soal **menukar mock -> implementasi nyata**, bukan
  menulis ulang UI.

### 38.2 Bentuk mock

- Buat lapisan **data-access** (`lib/dashboard/data/*` atau sejenis) dengan **dua implementasi**:
  `mock` dan `real` (Firestore SDK). Pilih lewat env flag, mis.
  `NEXT_PUBLIC_DASHBOARD_DATA= mock|real`.
- **Mock wajib mengembalikan bentuk data yang PERSIS sama** dengan koleksi Firestore nyata (rujuk
  Bagian 23: nama field, tipe, nullability) supaya integrasi = **tukar implementasi**, bukan tulis
  ulang UI.
- **Mock deterministik** (data tetap, bukan acak) supaya screenshot/snapshot Playwright stabil.
- Tidak ada network call keluar pada mode mock.

### 38.3 Cakupan Playwright (mock-first, minimal)

- **Routing** antar halaman H1..H8.
- **Render setiap state** (empty / loading / error) via mock terkontrol.
- **Matriks izin per role** (owner / admin / guest) di UI: guest TIDAK melihat menu/aksi Admin &
  Pengaturan; guest tidak melihat tombol Koreksi.
- **Form tulis stok:** validasi angka (per mode), tombol `disabled` saat double-submit. **Bukan** error
  "stok tidak cukup" (dihapus); hasil negatif = sukses.
- **State Stok Minus:** badge merah, filter "perlu minta gudang cabang", blok kekurangan = nilai
  absolut, H4 menampilkan delta negatif apa adanya, empty state saat tak ada produk negatif. Mock
  WAJIB memuat >= 1 produk `stok_gudang_online < 0`.
- **Responsive viewport** (mobile-first, karena Mini App dibuka di HP): 360x640, 768x1024, 1280x800.
- **Dark & light mode.**
- **Aksesibilitas dasar** (fokus, label, kontras) — boleh memakai `@axe-core/playwright`.

### 38.4 Aturan test

- Playwright dijalankan terhadap `next dev` / `next start` **lokal** dengan **mock aktif** — dan tetap
  mock meski backend sudah terintegrasi (I2).
- **Tidak boleh** menembak Firestore nyata atau API Telegram nyata.
- **Tidak ada network call keluar saat mode mock** — ditegaskan lewat route interception (assert
  tidak ada request ke domain Firestore/Telegram).
- **Playwright TIDAK menguji integrasi nyata.** Integrasi nyata diuji `npm test` + smoke manual
  (Bagian 37 C4). Playwright pasca-swap hanya regression safety.

### 38.5 Gate

- **Fase frontend SELESAI hanya jika suite Playwright mock hijau.**
- `npm test` (node:test backend nyata) tetap hijau; ini bukti integrasi, bukan mock.
- **Rilis (Fase D) tambahan syarat:** smoke test manual wajib lulus (Bagian 37 C4).

### 38.6 Yang harus dibekukan sebelum Fase C (integrasi)

Daftar hal yang HARUS sudah final saat masuk fase integrasi, supaya integrasi tidak mengubah UI:

- Bentuk respons API (sukses & error) tiap endpoint (Bagian 24), termasuk `stok_baru` yang boleh
  negatif (sukses, bukan 409).
- Nama field & tipe data tiap koleksi (Bagian 23).
- Penanganan error (kode 400/401/403/404/409/429 + pesan Bahasa Indonesia).
- Klaim role (owner/admin/guest) dan di mana ia ditegakkan (Rules + server-side).

### 38.7 Placeholder untuk auth di mode mock (RISIKO R11)

- `initData` tidak ada saat dev di browser desktop, jadi mode mock harus melewati auth dengan role
  yang bisa disuntik (mis. query param/env) **HANYA di mode mock**.
- **Dilarang keras aktif di produksi.** Mitigasi: guard compile-time/env (mode mock menolak boot di
  produksi; bypass memicu kegagalan build/route), test yang memastikan build produksi menolak flag
  bypass, dan smoke test pasca-deploy (tanpa `initData` -> layar "Buka dari Telegram", bukan data).
  Lihat risiko R11 di Bagian 32.
