# Rencana Dashboard UI — Bot Admin Toko

> Status: **RENCANA (belum dieksekusi)**. Dokumen ini untuk dievaluasi owner, lalu
> dilanjutkan oleh agent frontend UI/UX spesialis. Belum ada kode dashboard.

## 1. Tujuan

Bot Telegram sudah jalan, tapi data operasional hanya bisa dilihat lewat chat. Dashboard
memberi owner/admin tampilan visual untuk:

- Memantau stok gudang online & produk di bawah reorder point.
- Melihat histori pergerakan stok (siapa, kapan, berapa, kenapa).
- Meninjau draft yang menunggu konfirmasi (picking list, opname, sync stok).
- Melihat produk/peran admin & audit perubahan role.
- Melihat daftar permintaan harian ke gudang (`daily_requests`).

**Bukan tujuan (v1):** menggantikan bot. Dashboard read-mostly; aksi tulis yang berisiko
(ubah stok) tetap lewat bot + konfirmasi.

## 2. Pengguna & akses

| Peran | Bisa lihat | Bisa aksi |
|---|---|---|
| Owner | semua | approve/reject akses, set role, revoke |
| Admin | stok, histori, draft | konfirmasi draft |
| Guest | ringkas stok | — |

Auth: **belum ada web auth**. Opsi (perlu keputusan owner):
- (a) Google Sign-In + allowlist `admins.telegram_user_id`? tidak cocok (itu Telegram ID).
- (b) Firebase Auth (email) + mapping email ? admin.
- (c) Magic-link ke email owner.
- Rekomendasi: **Firebase Auth email allowlist** disimpan di koleksi `admins` (tambah field
  `email`), karena Firestore sudah pakai Firebase.

## 3. Sumber data (sudah ada)

Semua data sudah di Firestore, tidak perlu backend baru untuk baca:

- `stock` — `stok_gudang_online`, `reorder_point`, `last_synced_at`
- `products` — `nama_accurate`, `hpp`, `is_online_product`, `search_keywords`
- `stock_movements` — histori (type, qty, actor, status, source)
- `daily_requests/{YYYY-MM-DD}` — `items[]`
- `opname_drafts` — status draft opname
- `sync_stok_drafts` — draft sync
- `admins`, `admin_role_changes`, `access_requests`
- `system_settings/ai` — provider AI aktif

Index Firestore sudah ada untuk `stock_movements` (kode+created_at, created_by+created_at).
Dashboard yang butuh filter baru **wajib tambah index** di `firestore.indexes.json`.

## 4. Opsi teknis (perlu keputusan owner)

| Opsi | Pro | Kontra |
|---|---|---|
| A. Next.js di `dashboard/` dalam repo ini, Firebase client SDK | satu repo, deploy Vercel mudah | perlu Firestore security rules baru |
| B. Next.js repo terpisah | isolasi | duplikasi config, dua deploy |
| C. SPA statis + Firestore REST | ringan | tanpa SSR, auth lebih repot |

Rekomendasi: **Opsi A**. Next.js App Router + TypeScript + Tailwind + shadcn/ui. Pakai
koleksi skill yang sudah terpasang (`react-nextjs-development`, `shadcn`, `design-system`,
`ui-design`, `vercel-react-best-practices`).

**PENTING — security:** saat ini Firestore diakses server-side lewat `firebase-admin`
(bypass rules). Dashboard browser TIDAK boleh pakai admin SDK. Wajib:
- Firebase Auth untuk user.
- Firestore Security Rules ketat (draf default-deny, hanya user terautentikasi di allowlist).
- Tulis aksi sensitif lewat server route (Vercel function) yang verifikasi ID token,
  BUKAN langsung dari client.

## 5. Struktur halaman (usulan)

```
/                 Ringkasan: total produk online, item di bawah reorder point, draft pending
/stok             Tabel stok: cari, filter online/menipis, sort. Kolom: kode, nama, hpp, stok, reorder
/produk/[kode]    Detail produk + grafik histori pergerakan
/histori          Timeline stock_movements: filter kode/tipe/status/tanggal/actor
/draft            Draft pending: picking list, opname, sync — dengan tombol tinjau
/permintaan       daily_requests hari ini + riwayat
/admin            Daftar admin, role, log perubahan role, access_requests
/pengaturan       Provider AI aktif (read + ganti lewat server route)
```

## 6. Komponen UI yang dibutuhkan

- `DataTable` (sort/filter/pagination) — shadcn Table + TanStack Table.
- `StatCard` untuk ringkasan.
- `StockBadge` (warna status: aman / menipis / habis).
- `Timeline` untuk histori.
- `DiffReview` untuk draft sync (Firestore vs Sheets side-by-side).
- Grafik tren (Recharts) untuk proyeksi habis.
- Semua state: loading skeleton, empty, error, optimistic update untuk aksi.

## 7. Design system

Ikuti skill `design-system`: pakai token warna semantik, bukan hardcode. Mode gelap/terang.
Bahasa Indonesia untuk seluruh label.
Perlu keputusan owner: warna brand toko (belum ada).

## 8. Tahapan implementasi (usulan, tiap tahap = 1 sesi agent)

1. **Fondasi**: scaffold Next.js + TS + Tailwind + shadcn, layout + nav, Firebase Auth,
   security rules, koneksi Firestore baca read-only.
2. **Stok**: halaman `/stok` + `/produk/[kode]` + grafik histori. (nilai tertinggi)
3. **Histori**: `/histori` dengan filter + pagination.
4. **Draft & permintaan**: `/draft`, `/permintaan`, aksi konfirmasi lewat server route.
5. **Admin & pengaturan**: `/admin`, `/pengaturan`.
6. **Polish**: responsive (skill `responsive-ui`), aksesibilitas (skill `visual-review`),
   verifikasi render nyata di browser (`agent-browser`).

## 9. Pertanyaan terbuka untuk owner

1. Opsi teknis mana (A/B/C)? Rekomendasi A.
2. Auth pakai apa? Rekomendasi Firebase Auth email allowlist.
3. Warna/brand?
4. Dashboard read-only dulu, atau langsung bisa ubah stok dari web?
5. Perlu multi-toko/outlet atau satu toko saja?
6. Bahasa: Indonesia saja, atau perlu Inggris?

## 10. Yang TIDAK dilakukan di v1

- Tidak menulis ulang bot.
- Tidak ada aksi berisiko tanpa konfirmasi.
- Tidak menaruh service-account key di client.
- Tidak menyentuh `api/` kecuali menambah route baru untuk aksi tulis.
