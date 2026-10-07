# Patch Notes

## [Unreleased] — fix boot: splash + hilangkan flash "Gagal memuat"

**Tanggal:** 2026-09-15
**Commit:** (diisi saat commit)
**Klasifikasi:** bug boot / race condition (bukan keamanan, bukan data)

### Gejala

Saat Mini App pertama dibuka, muncul sekejap layar error "Gagal memuat ringkasan…
Coba lagi." Lalu halaman memuat ulang sendiri dan berjalan normal.

### Akar masalah

Race antara *dynamic import* data source dan render pertama halaman:

1. `AppShell` render konten saat `statusAuth === "memuat"` (hanya
   `tanpa_telegram` dan `gagal` yang ditangani).
2. Halaman langsung memanggil `useData().getRingkasan()`.
3. Data source real belum dibangun (dynamic import masih jalan) → membuang error
   `"Sumber data sedang dimuat. Coba lagi."`
4. Halaman menangkap error itu dan menampilkan `Alert` "Gagal memuat…".
5. Inisialisasi selesai → status "siap" → halaman refetch → data tampil.

Jadi pesan error itu **bukan** kegagalan nyata, melainkan UI menembak sebelum siap.

### Perbaikan

**Tampilan**
- Komponen baru `components/dashboard/splash-awal.tsx`: splash minimal (ikon + judul
  "Admin Toko" + pesan "Menyiapkan dashboard…" + spinner + tombol "Coba lagi").
- `AppShell` menahan render konten selama `statusAuth === "memuat"` dan menampilkan
  splash. Halaman tidak pernah render sebelum data source siap.
- `LayarAuthError` menerima prop `onCoba`.

**Logika**
- `sumber-data.tsx`: `DataSource` real HANYA dibangun setelah `getSession()`
  berhasil, lalu disimpan di state (`dataReal`). Tidak ada lagi pembungkus
  `tungguAa()` yang membuang error "sedang dimuat".
- Batas waktu inisialisasi **10 detik**: lewat batas → status `gagal` dengan pesan
  "Waktu masuk habis. Periksa koneksi lalu coba lagi." + tombol "Coba lagi".
- `coba()` mengulang inisialisasi tanpa reload halaman.
- Status `gagal` sekarang **hanya** untuk kegagalan auth nyata (401/403/500) atau
  timeout. Error palsu tidak lagi mungkin muncul.
- Mode mock tidak berubah: siap sinkron, tanpa splash, tanpa jaringan.

### Berkas diubah

| Berkas | Perubahan |
|---|---|
| `components/dashboard/splash-awal.tsx` | baru — splash minimal |
| `components/dashboard/app-shell.tsx` | tahan render saat "memuat" |
| `components/dashboard/layar-auth-error.tsx` | prop `onCoba` |
| `lib/dashboard/sumber-data.tsx` | state machine + timeout 10 s + `coba()` |
| `e2e/boot.spec.ts` | baru — 3 test regresi boot (mode mock) |
| `scripts/cek-splash-real.mjs` | baru — uji boot mode real dengan initData tiruan |

### Verifikasi

| Uji | Hasil |
|---|---|
| `npm test` | **72 lulus / 0 gagal** |
| `npx playwright test` (3 viewport, mode mock) | **363 lulus / 9 skip** |
| `npm run typecheck` | bersih |
| `scripts/cek-splash-real.mjs` (mode real, initData tiruan) | **PASS** — splash muncul, `ada_gagal_memuat: false` |

### Catatan

- Bug ini **lolos** dari seluruh suite sebelumnya karena mode mock selalu siap
  sinkron. Celah itu kini ditutup: `cek-splash-real.mjs` menguji jalur mode real
  (splash → sesi → konten) dengan initData tiruan.
- Smoke manual di Telegram nyata tetap wajib sebelum rilis (lihat
  `docs/dashboard-deploy.md` §5).
