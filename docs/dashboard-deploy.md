# Deploy Dashboard (Telegram Mini App)

> Rujukan PRD: `docs/dashboard-prd.md` Bagian 11 (auth), 12 (budget function), 33 (rollout),
> 37 C4 (smoke manual). Dokumen ini hanya berisi langkah operasional.

## 0. Ringkas

Dashboard berjalan sebagai aplikasi Next.js di repo ini. Semua halaman statis kecuali
`/produk/[kode]`; route tulis ada 10. Total function bersama webhook bot: **11** (batas Vercel
Hobby 12). Bukti resmi budget = **hasil auto-build Vercel setelah push**, bukan build lokal.

## 1. Variabel environment

Isi di Vercel: Project → Settings → Environment Variables (Production + Preview).
Salin juga ke `.env` lokal untuk dev. Penjelasan ada di `.env.example`.

### Wajib (dashboard)

| Variabel | Fungsi | Cara dapat |
|---|---|---|
| `NEXT_PUBLIC_DASHBOARD_DATA` | Pilih sumber data. Produksi **wajib** `real`. | Tidak perlu kredensial. |
| `DASHBOARD_ALLOWED_ORIGINS` | Allowlist origin untuk route tulis (anti-CSRF). Origin lain ditolak 403. | URL dashboard di Vercel, mis. `https://<project>.vercel.app`. **TANPA trailing slash** (header Origin tidak pernah berisi `/`; trailing slash = 403). Pisahkan dengan koma bila lebih dari satu. |
| `DASHBOARD_SESSION_SECRET` | Kunci HMAC penanda tangan cookie sesi. | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Konfigurasi SDK Firebase di browser (baca Firestore). | Firebase Console → Project settings → General → Your apps → Web App (`</>`) → blok `firebaseConfig`. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Idem. | `firebaseConfig.authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Idem. | `firebaseConfig.projectId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Idem. | `firebaseConfig.appId` |

### Sudah ada (bot) — jangan lupa ada juga

`TELEGRAM_BOT_TOKEN`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`,
`SUPER_ADMIN_ID`, `GEMINI_API_KEY`, `GROQ_API_KEY`.

> `TELEGRAM_BOT_TOKEN` dipakai verifikasi `initData` dan (bila `DASHBOARD_SESSION_SECRET` kosong)
> sebagai fallback kunci cookie. Sebaiknya isi `DASHBOARD_SESSION_SECRET` eksplisit.
>
> **v2:** `SUPER_ADMIN_ID` ditampilkan read-only di halaman Pengaturan (tidak bisa diubah dari
> UI, karena env tidak bisa diubah saat runtime). Nilai ini juga jadi jaring pengaman guard
> owner-terakhir - pastikan tetap diset di produksi. Satu id, atau beberapa dipisah koma.

### JANGAN pernah diset di Vercel

`NEXT_PUBLIC_ALLOW_MOCK` — hanya untuk build/e2e lokal. Bila terpasang di produksi, siapa pun
dapat memakai dashboard sebagai owner (risiko R11).

## 2. Firebase / Firestore

1. **Aktifkan Authentication.** Console → Authentication → Get started. Metode tidak perlu
   diaktifkan manual; dashboard memakai **Custom Token** (dibuat server via `firebase-admin`),
   sehingga yang perlu ada hanyalah Firebase Auth aktif.
2. **Deploy Security Rules:**
   ```bash
   firebase deploy --only firestore:rules
   ```
   Sumber: `firestore.rules` (deny-by-default, per-role; guest hanya `stock`/`products`/
   `stock_movements`).
3. **Deploy index** (jika belum):
   ```bash
   firebase deploy --only firestore:indexes

   **Composite index WAJIB - bukan opsional.** Query `where(equality)` + `orderBy(created_at)` pada
   `stock_movements` GAGAL di produksi bila index kompositnya belum ada. Firestore mengembalikan
   error, `DataSource` melempar, dan halaman menampilkan "Coba lagi" / "Periksa koneksi".
   Gejala ini TIDAK terlihat di `npm test` maupun e2e (keduanya mode mock, tidak menyentuh Firestore).

   Kombinasi yang harus punya index (`firestore.indexes.json`):

   | Equality | Index yang dibutuhkan | Dipakai oleh |
   |---|---|---|
   | `status` | `(status ASC, created_at DESC)` | `/`, `/draft` (batch picking), `/histori` filter status |
   | `type` | `(type ASC, created_at DESC)` | `/histori` filter jenis |
   | `kode_barang` | `(kode_barang ASC, created_at DESC)` | `/histori` filter kode, H3 detail produk |
   | `created_by` | `(created_by ASC, created_at DESC)` | `/histori` filter pelaku |

   Guard otomatis: `test/indexFirestore.test.js` membandingkan `lib/dashboard/data/real.ts` dengan
   `firestore.indexes.json` dan GAGAL di `npm test` bila satu kombinasi kehilangan index. Saat
   menambah `filter` baru di `MovementFilter`, tambahkan index-nya lalu jalankan `npm test`.

   Verifikasi index benar-benar ter-deploy (jangan hanya lihat file lokal):

   ```bash
   firebase firestore:indexes --project bot-admin-toko-a0c47
   ```
   ```
4. **Isi koleksi `admins`.** Dokumen per Telegram user id, field `role` = `owner`/`admin`/
   `guest`. Hanya user yang ada di sini yang bisa masuk. Owner efektif juga bisa lewat env
   `SUPER_ADMIN_ID`.

## 3. Deploy Vercel

1. Push ke `main` (setelah gate hijau). Vercel auto-build.
2. Set env pada langkah 1.
3. Buka hasil build → **Function** tab. Konfirmasi jumlahnya ≤ 12 (harapan 11).
   Ini bukti resmi budget (PRD 12.3).
4. Setelah deploy, jangan uji di browser biasa — `initData` tidak ada di sana.

## 4. Aktifkan di Telegram

1. BotFather → `/mybots` → pilih bot → **Bot Settings** → **Menu Button** → **Configure menu button**.
2. Isi URL: `https://<project>.vercel.app` dan teks tombol, mis. "Dashboard".
3. Buka bot dari Telegram, ketuk menu button → Mini App terbuka.

## 4b. Diagnosis cepat "Buka dari Telegram" / auth gagal

| Gejala | Penyebab umum | Perbaikan |
|---|---|---|
| Layar "Buka dari Telegram" padahal di dalam Telegram | SDK belum termuat / dibuka di browser biasa | Pastikan dibuka dari menu button bot. Cek DevTools: `window.Telegram.WebApp` harus ada. |
| Log Vercel: `[auth_fail] {"alasan":"origin","status":403}` | `DASHBOARD_ALLOWED_ORIGINS` tidak cocok | Cocokkan **persis** dengan origin di address bar, **tanpa** trailing slash. |
| Log Vercel: `[auth_fail] ... "bukan_admin"` | user id belum ada di koleksi `admins` | Tambahkan dokumen di `admins` dengan ID Telegram user & `role`. |
| Log Vercel: `"initData kedaluwarsa"` | Mini App dibuka > 60 menit lalu | Tutup dan buka ulang Mini App dari Telegram. |
| Log Vercel: `"custom_token"` / "Gagal membuat sesi" | Firebase Auth belum aktif atau kredensial admin salah | Aktifkan Authentication di Firebase Console; cek `FIREBASE_*`. |

## 5. Smoke test manual WAJIB (PRD 37 C4) — sebelum rilis

Semua di dalam Telegram nyata (bukan browser biasa, bukan Playwright):

1. Buka Mini App dari menu button → **H1 Ringkasan** tampil.
2. Auth berhasil: tanpa layar error 401/403, tanpa layar "Buka dari Telegram".
3. Baca stok: **H2 Stok** menampilkan data `stock`+`products` nyata.
4. Tulis stok: satu aksi **Koreksi** berhasil; angka stok berubah.
5. Baris audit muncul di **H4 Histori** untuk aksi tadi
   (`source:"web_dashboard"`).
6. **Stok Minus**: produk dengan saldo negatif ber-badge merah; filter
   "Perlu Minta Gudang Cabang" menampilkan kekurangan sebagai nilai absolut.
7. **Role gating guest**: guest tidak melihat menu/aksi Draft/Admin/Pengaturan dan tidak
   melihat tombol Koreksi; akses paksa ditolak ("Akses ditolak").

### v2 (fitur tulis administratif)

8. **Edit HPP** (owner): ubah HPP di **H3 Detail Produk** -> sukses; nilai baru tampil.
9. **Edit reorder point** (owner/admin): set reorder di atas stok saat ini -> notifikasi
   "Stok Menipis" benar-benar masuk ke chat owner & admin (bukti fix bug B1).
10. **Ubah role** (owner): promosikan guest -> admin; timeline **H7 Admin** bertambah TEPAT
    SATU entri (bukan dua). Coba ubah role diri sendiri -> ditolak.
11. **Hapus admin** (owner): hapus admin biasa -> sukses + tercatat. Coba hapus diri sendiri
    atau owner terakhir -> ditolak.
12. **Super admin** read-only tampil di **H8 Pengaturan**; tidak ada kontrol ubah.
13. **401 mid-write**: diamkan Mini App > 60 menit, lalu simpan -> toast "Sesi kedaluwarsa."
    + tombol "Buka ulang"; isian form TIDAK ter-reset.

> Rilis **DIBLOKIR** bila salah satu langkah v1 atau v2 gagal.

### v3a (Permintaan Harian interaktif + Kata Kunci)

14. **Permintaan Harian**: buka `/permintaan` -> tombol **Ubah Jumlah** + **Kirim Form** tampil
    saat status `draft`.
15. **Kirim Form**: tekan -> status jadi `diproses`; pesan form masuk ke Telegram SEMUA owner+admin,
    teksnya rapi & bisa di-copy apa adanya (tanpa karakter Markdown rusak).
16. **Barang Datang**: tandai satu item -> tercatat; tandai SEMUA item -> dokumen otomatis `selesai`.
17. **Guard**: coba `datang` saat dokumen masih `draft` -> ditolak dengan pesan
    "Kirim form dulu sebelum menandai barang datang."
18. **Kata Kunci**: owner bisa ubah interpretasi penanda -> `confidence` jadi Terkonfirmasi;
    admin hanya bisa lihat (tanpa kontrol ubah).


### v3b (A7 approve akses, A5 tambah produk, A2 konfirmasi draft)

19. **A7 approve akses** (owner): `/admin` -> seksi Permintaan Akses -> tombol **Setujui** pada
    baris `pending` -> dialog -> sukses; status jadi Disetujui + user target menerima notifikasi
    Telegram. Sukses tapi notif gagal -> toast peringatan (tidak rollback). Admin TIDAK melihat
    tombol; akses paksa -> 403.
20. **A5 tambah produk** (owner + admin): `/stok` -> **Tambah Produk** -> kode + nama -> Simpan;
    produk muncul di daftar dengan stok awal. Kode duplikat -> pesan inline di field kode
    (bukan toast generik).
21. **A2 konfirmasi opname** (owner/admin pembuat): `/draft` -> kartu Opname -> **Konfirmasi** ->
    dialog ringkasan -> sukses; kartu hilang, stok berubah, baris audit muncul di H4 Histori
    dengan `source:"web_dashboard"`. **Batalkan** -> kartu hilang tanpa mengubah stok.
22. **A2 konfirmasi picking (BATCH)**: seksi Picking List menampilkan SATU kartu per pemilik
    (bukan per movement) dengan ringkasan "N item siap diproses, M dilewati". Konfirmasi ->
    SELURUH movement batch jadi `processed`.
23. **A2 batch setengah jadi (E-3)**: batch yang sebagian movement-nya sudah `processed`
    ber-badge "Diproses sebagian" dan TANPA tombol; harus diselesaikan lewat Telegram.
24. **A2 sync per kelompok**: kartu Sync -> **Konfirmasi** per kelompok -> kelompok itu hilang,
    sisa kelompok lain tetap (toast "Sebagian diproses..."). **Konfirmasi Semua** -> semua bersih.
25. **A2 fail-closed (E-1)**: draft lama tanpa penanda pemilik ber-badge "Pemilik tidak diketahui",
    TANPA tombol konfirmasi. Memaksa lewat API -> 409
    "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram."
26. **401 mid-write `/draft`**: biarkan sesi kedaluwarsa lalu konfirmasi -> toast "Sesi kedaluwarsa."
    + tombol "Buka ulang"; dialog konfirmasi TETAP terbuka.

> Rilis **DIBLOKIR** bila salah satu langkah v1, v2, v3a, atau v3b gagal.


### Koreksi manual dokumen `selesai` (v3a)

Dokumen `daily_requests` berstatus `selesai` TIDAK bisa dibuka kembali dari dashboard (keputusan
PRD v3a §4.4 — mencegah pembatalan tak sengaja). Bila ada kekeliruan:

1. Buka Firebase Console -> Firestore -> `daily_requests/{YYYY-MM-DD}`.
2. Ubah `status` kembali ke `diproses` (atau `draft` bila form belum dikirim).
3. Hapus `selesai_at` dan `selesai_by` agar tidak menyesatkan.
4. Catat alasan koreksi (audit manual).

## 6. Verifikasi lokal (opsional)

```bash
# Uji UI terhadap mock (tanpa Firestore/Telegram)
npm run e2e

# Backend nyata (HMAC initData, model stok, audit)
npm test

# Mode real lokal: halaman harus menampilkan "Buka dari Telegram" (tanpa data)
node scripts/e2e-build-real.mjs
npx next start -p 3105          # jalankan di terminal terpisah
node scripts/cek-real.mjs       # exit 0 = lulus (guard R11)
```

## 7. Rollback

1. Vercel → Deployments → pilih deployment sebelumnya → **Promote to Production**.
2. Bila perlu memutus akses data seketika: kembalikan `firestore.rules` ke deny-all lalu
   `firebase deploy --only firestore:rules`. Data stok tidak berubah.
