# UI Spec — Dashboard Bot Admin Toko

> Sumber: `docs/dashboard-prd.md` (v4). Dokumen ini mengunci keputusan visual/komposisi
> supaya tiap tahap implementasi konsisten. Bahasa produk: Bahasa Indonesia.

## 1. Arah visual

- Gaya: **SaaS WMS bersih & netral-modern**. Tanpa brand toko, tanpa gradient dekoratif,
  tanpa glassmorphism, tanpa blob.
- Komponen: shadcn/ui (base UI, style `nova`, baseColor `neutral`, ikon `lucide`).
- Token: hanya token semantik (`bg-background`, `text-muted-foreground`, `bg-primary`,
  `text-destructive`, `border-border`). Dilarang hardcode warna Tailwind (mis. `bg-blue-500`).
- Warna status stok: pakai token + label teks (bukan warna saja). Minus = merah
  (`text-destructive` + `bg-destructive/10`), Menipis = amber sarana token kustom,
  Aman = netral/hijau sarana token kustom. Tambah token status di `globals.css` bila perlu.
- Tipografi: Geist (bawaan shadcn init). Skala: judul halaman `text-xl font-semibold`,
  label kartu `text-sm text-muted-foreground`, angka besar `text-2xl font-semibold tabular-nums`.
- Angka stok selalu `tabular-nums` agar tidak goyang.
- Spacing: `gap-*` (bukan `space-y-*`), container `p-4 md:p-6`, stack `flex flex-col gap-4`.
- Radius: token bawaan shadcn (`rounded-lg`/`rounded-xl`). Tidak menambah radius liar.

## 2. Kerangka aplikasi (shell)

- **Mobile (< 768px):** header ringkas (judul halaman + pemilih role mock) + **bottom nav**
  ikon+label, maksimum 5 tujuan terlihat; destinasi staff dikelompokkan ke tab "Lainnya"
  (Sheet) bila lebih dari 5. Konten ber-scroll, `padding-bottom` cukup untuk bottom nav.
- **Desktop (>= 768px):** **sidebar kiri** (lebar 240px) + area konten. Header konten berisi
  judul + breadcrumb ringkas bila berada di halaman detail.
- Tujuan navigasi (H1..H8) sesuai matriks izin: guest hanya melihat Ringkasan, Stok, Histori.
- Item nav yang tidak diizinkan **tidak dirender** untuk role tersebut (bukan disabled).

## 3. Halaman

### H1 Ringkasan (`/`)
- Baris kartu statistik: Total Produk Online · Menipis · **Stok Minus** · Draft Pending
  (staff) · Permintaan Hari Ini (staff).
- Kartu "Stok Minus" menonjol (border/aksen merah) dan menautkan ke H2 filter minus.
- Blok "Perlu Minta Gudang Cabang": daftar produk minus, urut kekurangan terbesar,
  tiap baris menampilkan `Kurang N` (nilai absolut). Empty state bila tak ada minus.
- Blok "Stok Menipis" (maks 10) + "Pergerakan Terakhir" (maks 10, timeline ringkas → H3).

### H2 Stok (`/stok`)
- Mobile: daftar **kartu**; Desktop: **tabel** (`Table`). Kolom: Kode · Nama · HPP ·
  Stok · Reorder · Status (Badge).
- Kontrol: input cari (kode/nama, case-insensitive), `ToggleGroup` filter
  (Semua · Menipis · **Perlu Minta Gudang Cabang**), sort.
- Badge status: label teks + warna. Minus menampilkan nilai negatif apa adanya.
- Aksi "Koreksi" hanya untuk owner/admin (guest tidak melihat tombol).
- Empty state berbeda per filter; error state = `Alert` + tombol "Coba lagi".

### H3 Detail Produk (`/produk/[kode]`)
- Kartu info produk: `nama_accurate`, kode, HPP/HPP baru, `variants[]`.
- Kartu stok: saldo (badge), reorder point, last sync, tombol "Koreksi" (owner/admin).
- Timeline pergerakan kode ini (maks 20) → tiap baris menautkan ke konteks histori.

### H4 Histori (`/histori`)
- Timeline `stock_movements` dengan delta apa adanya (negatif tampil negatif).
- Filter: **satu** equality (Kode / Type / Status / Dibuat oleh) + rentang tanggal.
  Kombinasi dua equality tidak disediakan (aturan bounded, PRD 35.4).
- Pagination default 20.

### H5 Draft Pending (`/draft`)
- Dua seksi: Opname & Sync. Kartu ringkasan per draft (jumlah item, waktu) + tombol
  "Tinjau di Telegram" (buka bot). Tidak ada aksi ubah dari web.

### H6 Permintaan Harian (`/permintaan`)
- Seksi "Hari Ini" (kartu berisi item: nama, variasi, qty, buffer) + riwayat hari sebelumnya.

### H7 Admin (`/admin`)
- Tiga seksi: Daftar Admin (`Table`), Perubahan Role (timeline), Permintaan Akses (daftar).

### H8 Pengaturan (`/pengaturan`)
- Kartu "Provider AI Aktif" + `Select` gemini/groq. Select hanya aktif untuk owner;
  admin melihat nilai tanpa kontrol ubah.

## 4. Aksi tulis & umpan balik

- **Dialog Koreksi Stok**: nama produk + kode + stok saat ini selalu terlihat.
  `ToggleGroup` mode (Tambah/Kurangi/Timpa), input qty (`inputMode="numeric"`), catatan opsional.
  Validasi per mode: relatif `>= 1`; timpa `>= 0`. Pesan error inline + `data-invalid`.
- Saat submit: tombol disabled + `Spinner`, form terkunci (cegah double-tap).
- Sukses: toast "Stok diperbarui", dialog tutup, refetch, saldo baru ditampilkan
  (termasuk bila negatif → badge "Stok Minus", bukan error).
- Gagal: toast spesifik per kode (400/403/404/409/429); 401 → toast
  "Sesi kedaluwarsa. Buka ulang dari Telegram." + tombol "Buka ulang".

## 5. State wajib tiap halaman

`Skeleton` saat memuat, `Empty` saat kosong (teks kontekstual), `Alert` + "Coba lagi" saat
error. Tidak ada dead end. Tombol ikon wajib `aria-label`.

## 6. Aksesibilitas & responsif

- Kontras >= 4.5:1, fokus terlihat, kontrol form berlabel (`Field`/`Label`).
- Target sentuh >= 44px pada mobile.
- Tanpa scroll horizontal pada 360px.
- Dark & light via token; toggle manual + `prefers-color-scheme`.

## 7. Istilah

Semua label Bahasa Indonesia. Allowlist istilah asing: stok, stock, produk, kode barang,
HPP, reorder point, Telegram, Mini App, AI, Gemini, Groq, Firestore, online, draft, id, login.

## 8. Catatan implementasi (Fase A)

- **H3 `/produk/[kode]` dirender dinamis (1 Vercel function).** Dynamic segment tanpa
  `generateStaticParams` tidak dapat diprerender saat build karena data diambil via client SDK.
  Ini satu-satunya halaman non-statis. Total function tetap jauh di bawah batas 12
  (webhook + 3 route tulis + H3 = 5). Bila budget menipis, ubah H3 menjadi `/produk?kode=`.
- **Tailwind v4:** `@layer base` TIDAK boleh memakai `@apply` untuk utility dari
  `@theme inline` pada setup ini (gagal `Cannot apply unknown utility`). Gunakan CSS
  langsung dengan `var(--token)`. Aturan ini mengikat semua perubahan `app/globals.css`.
- **shadcn style `base-nova`** memakai **Base UI** (bukan Radix): gunakan prop `render`
  untuk elemen kustom, bukan `asChild`. Utilitas `cn` diimpor dari paket `cn`.

## 9. Bukti gate Fase A (A6.3)

- **Playwright (mode mock)**: 351 lulus / 0 gagal / 6 skip, di 3 viewport
  (mobile 360x640, tablet 768x1024, desktop 1280x800). Suite: routing, smoke, stok, histori,
  ringkasan, izin, staff, a11y (axe), tema, responsif, offline. Tidak ada request keluar
  (diverifikasi `e2e/offline.spec.ts`).
- **`npm test`** (node:test, backend nyata): 30 lulus / 0 gagal.
- **`npm run typecheck`**: bersih.
- **Budget function (`vercel build`)**: **3 function** — `api/webhook`, `produk/[kode]`
  (satu-satunya halaman dinamis), `_not-found.rsc`. Target internal <= 4, batas 12.
  Route tulis (`/api/auth/telegram`, `/api/stok/mutasi`, `/api/pengaturan/ai`) menyusul
  di Fase C dan akan menambah 3 lagi (total 6, masih di bawah batas).
- Catatan tooling: `vercel build` di Windows gagal pada langkah symlink (EPERM) kecuali
  Developer Mode aktif; hitungan function tetap terbaca dari `.vercel/output/functions`.
- **Belum diverifikasi (di luar Fase A)**: integrasi backend nyata (auth `initData`,
  Firestore client SDK, route tulis) dan smoke test manual di Telegram nyata — keduanya
  Fase C/DoD rilis.

## 10. Fase C — integrasi backend (status)

### C1 Auth selesai
- `lib/dashboard/auth/initData.js` — verifikasi HMAC-SHA256 Telegram (data_check_string urut
  ASCII, timing-safe compare, cek panjang -> 401, `auth_date` integer finite, parse `user` aman).
- `lib/dashboard/auth/sesi.js` — cookie HttpOnly/Secure/SameSite=Lax bertanda tangan HMAC;
  umur = `auth_date` + 60 menit, tanpa sliding.
- `lib/dashboard/auth/guard.js` — allowlist Origin (CSRF) + rate limit in-memory.
- `app/api/auth/telegram/route.ts` — verifikasi -> re-validasi `admins/{id}` -> sesi cookie +
  Firebase Custom Token berklaim `role`/`admin`.
- `firestore.rules` — deny-by-default per-role (guest: hanya `stock`/`products`/`stock_movements`).
- Env baru: `DASHBOARD_ALLOWED_ORIGINS`, `DASHBOARD_SESSION_SECRET`, `NEXT_PUBLIC_FIREBASE_*`.

### C2 Baca Firestore selesai
- `lib/dashboard/data/klien-firebase.ts` — init SDK client + `signInWithCustomToken`.
- `lib/dashboard/data/real.ts` — implementasi `DataSource` penuh (bentuk data identik mock).
- Firebase dimuat **dinamis** hanya di mode real; bundle mode mock tetap 103 kB shared
  (tidak ada Firebase di bundle mock).

### C3 Tulis stok selesai
- `app/api/stok/mutasi/route.ts` — sesi -> role dari `admins` -> validasi per mode -> guard
  double-submit 10 s -> model stok (transaksi atomik, tanpa tolak-negatif) -> audit 1 baris
  (`source:"web_dashboard"`, `created_by` string).
- `app/api/pengaturan/ai/route.ts` — owner only, enum `gemini|groq`.
- `lib/models/stockMovements.js` — normalisasi `created_by`/`requested_by`/`confirmed_by`
  ke string (temuan A4).

### R11 guard terverifikasi
- Mode real (build produksi-like) + `?role=owner` -> layar "Buka dari Telegram", tanpa data.
  Diverifikasi `scripts/cek-real.mjs` (4/4 PASS, exit 0). Tanpa Telegram tidak ada data.

### C4 verifikasi (revisi keputusan owner)
- Budget function **TIDAK** diverifikasi dengan `vercel build` lokal (gagal symlink di Windows).
  Bukti resmi = **hasil auto-build Vercel saat push**.
- Perhitungan dari `next build`: 4 route dinamis (`/api/auth/telegram`, `/api/stok/mutasi`,
  `/api/pengaturan/ai`, `/produk/[kode]`) + `api/webhook.js` = **5 function**; batas 12.
- Smoke test manual di Telegram nyata tetap WAJIB sebelum rilis (di luar cakupan otomatis).

