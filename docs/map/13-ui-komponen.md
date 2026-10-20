# 13 — UI, Halaman & Komponen

## Ringkasan area
- Cakupan: shell aplikasi (`app/layout.tsx`), 21 halaman App Router (`app/**/page.tsx`), 23 primitif `components/ui`, 68 komponen `components/dashboard`, tema/breakpoint/TMA, dan konfigurasi UI.
- Sumber data halaman dibagi dua: `SumberDataProvider` (`lib/dashboard/data/*`, mode mock lewat `NEXT_PUBLIC_DASHBOARD_DATA`) untuk dashboard lama, dan `fetch("/api/...")` langsung ke route D1 untuk halaman baru.
- TIDAK termasuk: isi handler route, query D1, alur bot, PDF (lihat peta 01/02/08/11).
- Acuan desain: `docs/ui-spec.md` (spesifikasi), `docs/visual-review.md` (review), `e2e/{tema,responsif,tma}.spec.ts` (penjaga perilaku).

## Peta file
| file | peran | export/entry penting |
|---|---|---|
| `app/layout.tsx` | root layout: metadata, viewport, font, SDK Telegram (beforeInteractive), provider data, shell, toaster | `metadata`, `viewport`, `RootLayout` (default) |
| `app/globals.css` | Tailwind v4 (`@import "tailwindcss"`, `tw-animate-css`, `shadcn/tailwind.css`), token warna, varian `.dark` | `@custom-variant dark`, `@theme inline` |
| `components.json` | konfigurasi shadcn (style `base-nova`, `rsc: true`, ikon Lucide, alias `@/components/ui`) | — |
| `postcss.config.mjs` | PostCSS + `@tailwindcss/postcss` | — |
| `next.config.mjs` | konfigurasi Next (env publik, `serverExternalPackages`) | — |
| `lib/dashboard/data/index.ts` | pemilih sumber data (mock vs real) untuk `SumberDataProvider` | lihat peta 09 |
| `components/dashboard/app-shell.tsx` + `app-sidebar.tsx` | shell + navigasi (sidebar ≥768px, bottom nav <768px) | `AppShell` |
| `components/dashboard/butuh-akses.tsx` | wrapper izin halaman (redirect/empty state) | `ButuhAkses` |
| `components/dashboard/theme-toggle.tsx` | toggle tema, simpan ke `localStorage["tema"]`, class `dark` di `<html>` | `ThemeToggle` |
| `components/ui/*.tsx` | 23 primitif (Base UI + shadcn), dipakai ulang semua halaman | lihat tabel primitif |

## Halaman -> komponen -> endpoint
Endpoint = literal `/api/...` yang muncul di page atau komponen dashboard yang diimpor page; URL dinamis (template literal) dan panggilan lewat `useData` tidak tercantum.

| halaman | jenis | komponen dashboard inti | endpoint langsung |
|---|---|---|---|
| `app/admin/page.tsx` (admin) | client | aksi-akses, aksi-nama-admin, aksi-role-admin, butuh-akses, page-header | - |
| `app/advance/page.tsx` (advance) | client | butuh-akses, page-header, umpan-tulis | `/api/advance` |
| `app/ai-gambar/page.tsx` (ai-gambar) | server | pagar-viewport | - |
| `app/analisa/page.tsx` (analisa) | client | analisa-detail-produk, analisa-estimasi-iklan, analisa-peta-sku, analisa-ringkasan, analisa-setting-ai, butuh-akses … | `/api/ai/analisa/setting`, `/api/analisa`, `/api/analisa/peta`, `/api/baca` |
| `app/draft/page.tsx` (draft) | client | butuh-akses, page-header, umpan-tulis | - |
| `app/gudang/page.tsx` (gudang) | client | aksi-gudang, butuh-akses, dialog-gudang, page-header | - |
| `app/harga-jual/page.tsx` (harga-jual) | client | butuh-akses, page-header, umpan-tulis | `/api/harga-jual`, `/api/preset` |
| `app/histori/page.tsx` (histori) | client | butuh-akses, page-header | - |
| `app/laba/page.tsx` (laba) | client | butuh-akses, dialog-laba-shopee, export-laba-gambar, page-header, umpan-tulis | `/api/laba`, `/api/preset`, `/api/sinkronisasi` |
| `app/masuk/page.tsx` (masuk) | client | - | `/api/auth/login`, `/api/auth/minta-kode`, `/api/auth/reset-password` |
| `app/opname-gudang/page.tsx` (opname-gudang) | client | aksi-opname, butuh-akses, page-header | - |
| `app/order/page.tsx` (order) | client | butuh-akses, dialog-import-excel, dialog-import-order, footer-paginasi, page-header, umpan-tulis | `/api/advance`, `/api/baca`, `/api/excel`, `/api/order`, `/api/preset`, `/api/sinkronisasi` |
| `app/page.tsx` (ringkasan (/)) | client | page-header | - |
| `app/pengaturan/page.tsx` (pengaturan) | client | ai-fallback, ai-izin-model, ai-kredensial, ai-model, ai-model-default, ai-prompt … | `/api/pengaturan/ai`, `/api/pengaturan/kledo`, `/api/preset`, `/api/preset/` |
| `app/permintaan-gudang/page.tsx` (permintaan-gudang) | server | butuh-akses, dialog-permintaan-export, page-header, umpan-tulis | `/api/permintaan-gudang` |
| `app/permintaan/page.tsx` (permintaan) | client | butuh-akses, dialog-barang-datang, dialog-ubah-jumlah, page-header, umpan-tulis | - |
| `app/printing/page.tsx` (printing) | client | butuh-akses, printing-workspace | `/api/preset`, `/api/printing` |
| `app/produk/[kode]/page.tsx` (produk) | client | butuh-akses, dialog-edit-hpp, dialog-edit-reorder, dialog-koreksi-stok, form-master-produk, page-header … | `/api/produk/`, `/api/produk/kategori` |
| `app/profil/page.tsx` (profil) | server | page-header, profil-form | `/api/profil`, `/api/profil/password`, `/api/profil/username` |
| `app/sinkronisasi/page.tsx` (sinkronisasi) | client | butuh-akses, dialog-import-order, dialog-laba-shopee, page-header, umpan-tulis | `/api/analisa`, `/api/analisa/peta`, `/api/baca`, `/api/laba`, `/api/order`, `/api/preset`, `/api/sinkronisasi` |
| `app/stok/page.tsx` (stok) | server | aksi-massal-kategori, butuh-akses, dialog-import-excel, dialog-kekurangan-stok, dialog-koreksi-stok, dialog-stok-gudang … | `/api/excel`, `/api/order`, `/api/produk/`, `/api/produk/massal` |

## Inventaris `components/ui` (23)
| komponen | export |
|---|---|
| `alert-dialog` | AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle, AlertDialogTrigger |
| `alert` | Alert, AlertAction, AlertDescription, AlertTitle |
| `badge` | Badge, badgeVariants |
| `button` | Button, buttonVariants |
| `card` | Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle |
| `collapsible` | Collapsible, CollapsibleContent, CollapsibleTrigger |
| `combobox` | Combobox |
| `dialog` | Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger |
| `dropdown-menu` | DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger |
| `empty` | Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle |
| `field` | Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle |
| `input` | Input |
| `label` | Label |
| `select` | Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue |
| `separator` | Separator |
| `sheet` | Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger |
| `skeleton` | Skeleton |
| `sonner` | Toaster |
| `spinner` | Spinner |
| `table` | Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow |
| `tabs` | Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants |
| `toggle-group` | ToggleGroup, ToggleGroupItem |
| `toggle` | Toggle, toggleVariants |

## Inventaris `components/dashboard` (68, per kelompok)
- **ai** (9): `ai-fallback`, `ai-gambar-setting`, `ai-gambar-studio`, `ai-izin-model`, `ai-kredensial`, `ai-model`, `ai-model-default`, `ai-prompt`, `ai-tool`
- **akses** (1): `akses-ditolak`
- **aksi** (6): `aksi-akses`, `aksi-gudang`, `aksi-massal-kategori`, `aksi-nama-admin`, `aksi-opname`, `aksi-role-admin`
- **analisa** (5): `analisa-detail-produk`, `analisa-estimasi-iklan`, `analisa-peta-sku`, `analisa-ringkasan`, `analisa-setting-ai`
- **app** (2): `app-shell`, `app-sidebar`
- **bottom** (1): `bottom-nav`
- **buka** (1): `buka-dari-telegram`
- **butuh** (1): `butuh-akses`
- **dialog** (15): `dialog-barang-datang`, `dialog-edit-hpp`, `dialog-edit-reorder`, `dialog-gudang`, `dialog-import-excel`, `dialog-import-order`, `dialog-kekurangan-stok`, `dialog-koreksi-stok`, `dialog-laba-shopee`, `dialog-permintaan-export`, `dialog-stok-gudang`, `dialog-tambah-admin`, `dialog-tambah-produk`, `dialog-ubah-jumlah`, `dialog-user-gudang-jabatan`
- **editor** (8): `editor-ai-setting`, `editor-desain`, `editor-elemen`, `editor-export-dialog`, `editor-panel-properti`, `editor-picker-aset`, `editor-preset`, `editor-toolbar-ai`
- **export** (1): `export-laba-gambar`
- **footer** (1): `footer-paginasi`
- **form** (1): `form-master-produk`
- **input** (1): `input-iklan`
- **kanvas** (1): `kanvas-anotasi`
- **kelola** (1): `kelola-admin`
- **kledo** (1): `kledo-integrasi`
- **konfirmasi** (1): `konfirmasi-hapus-admin`
- **layar** (1): `layar-auth-error`
- **pagar** (1): `pagar-viewport`
- **page** (1): `page-header`
- **pilih** (1): `pilih-sku`
- **preset** (1): `preset-toko`
- **printing** (1): `printing-workspace`
- **profil** (1): `profil-form`
- **role** (1): `role-switcher`
- **splash** (1): `splash-awal`
- **status** (1): `status-badge`
- **theme** (1): `theme-toggle`

## Alur data
1. `app/layout.tsx` merender `RootLayout`: memuat SDK Telegram sebelum interaksi, memasang `SumberDataProvider`, `AppShell`, `Toaster`.
2. Halaman dashboard lama membaca `useData`/provider -> `lib/dashboard/data/*` (mock `mock*.ts`/`mock-data.ts` bila `NEXT_PUBLIC_DASHBOARD_DATA=mock`, atau `real.ts` ke D1).
3. Halaman baru memanggil `fetch("/api/<segmen>")`; komponen `dialog-*`/`aksi-*` melakukan POST/PATCH (contoh: `order` -> `/api/order`, `/api/advance`, `/api/excel`, `/api/preset`).
4. Route `app/api/**/route.ts` memakai guard `lib/d1/route.ts` lalu `lib/d1/*` (peta 02/03/04/05).
5. Aksi tulis menampilkan `umpan-tulis` (toast/inline) dan memicu refresh data; form wajib menonaktifkan tombol saat proses.

## Endpoint & tabel terkait
- Endpoint yang dipanggil UI: `advance`, `ai/analisa/setting`, `analisa`, `analisa/peta`, `auth/*`, `baca`, `excel`, `harga-jual`, `laba`, `order`, `pengaturan/ai`, `pengaturan/kledo`, `permintaan-gudang`, `preset`, `printing`, `produk/…`, `profil/*`, `sinkronisasi`.
- Pemetaan endpoint -> file route ada di peta domain (02/03/04/05/06/08/09); UI tidak boleh query D1 langsung.

## Test terkait
- `e2e/tema.spec.ts` (toggle terang/gelap + `prefers-color-scheme`), `e2e/responsif.spec.ts` (shell 768px, 360px tanpa scroll horizontal), `e2e/tma.spec.ts` (guard origin Mini App), `e2e/a11y.spec.ts` (axe).
- `e2e/izin.spec.ts` menguji `butuh-akses` per role; `test/` unit untuk format/pesan (`lib/dashboard/format.test.ts`).
- Satu spec: `npx playwright test e2e/tema.spec.ts --project=desktop` (build mock dulu: `npm run e2e:build`).

## Gotcha / konvensi
- Tailwind v4: token lewat `@theme inline` di `app/globals.css`; jangan menambah `tailwind.config.js` (tidak dipakai).
- Base UI, bukan Radix: pakai prop `render`, bukan `asChild` (lihat `components.json` + `docs/ui-spec.md`).
- Breakpoint navigasi `md` = 768px; target sentuh ≥44px; 360px tidak boleh scroll horizontal.
- Tema: class `dark` di `<html>` + `localStorage["tema"]` (`"terang"|"gelap"`), default ikut `prefers-color-scheme`. `next-themes` hanya dipakai `components/ui/sonner.tsx`.
- Batas client: mayoritas halaman `"use client"` (hooks/event/fetch); `app/layout.tsx` dan beberapa page (mis. `stok`, `profil`, `permintaan-gudang`) server. Jangan tambah hook di file server.
- `SumberDataProvider` menyajikan data global; halaman yang memakainya tidak memanggil `/api` sendiri — jangan menyimpulkan route tidak ada hanya karena tidak ada `fetch` di page.
- State wajib: skeleton saat memuat, empty state saat kosong, alert + coba lagi saat gagal (`docs/ui-spec.md`).
- TMA: `initData` hanya bukti di klien; validasi HMAC di server (`app/api/auth/tma/route.ts`).

## Kalau masalahnya ... buka ...
| gejala / kata kunci (Indonesia, sinonim/typo) | file pertama | catatan |
|---|---|---|
| sidebar hilang, menu mobile, navigasi bawah, hamburger | `components/dashboard/app-shell.tsx` + `app-sidebar.tsx` | breakpoint 768px; cek juga `e2e/responsif.spec.ts` |
| halaman tidak berizin, akses ditolak, "butuh akses", redirect | `components/dashboard/butuh-akses.tsx` | dipasang per halaman; role dari `lib/dashboard/auth/guard.js` (peta 10) |
| tema gelap/terang, warna salah, dark mode tidak persist | `components/dashboard/theme-toggle.tsx` + `app/globals.css` | `localStorage["tema"]`, class `.dark` |
| layar 360 meluber, layout pecah, responsif | `app/globals.css` + `components/dashboard/app-shell.tsx` | uji `e2e/responsif.spec.ts`; cek tabel lebar (min-width) |
| TMA, Telegram WebApp, viewport, initData | `app/layout.tsx` + `app/api/auth/tma/route.ts` | SDK dimuat `beforeInteractive`; validasi di server |
| halaman kosong padahal data ada, kartu ringkasan 0 | `lib/dashboard/data/index.ts` + `sumber-data.tsx` | cek `NEXT_PUBLIC_DASHBOARD_DATA` (mock/real) |
| tombol tidak bereaksi, data tidak refresh setelah simpan | komponen `dialog-*`/`aksi-*` di halaman terkait | cek state busy + pemanggilan ulang fetch/provider |
| toast/error tidak muncul | `components/ui/sonner.tsx` + `components/dashboard/umpan-tulis.ts` | `Toaster` dipasang di `app/layout.tsx` |
| form submit dobel, data ganda | komponen `form-*`/`dialog-*` | tombol harus disable saat proses; server tetap perlu guard (peta 02) |
| komponen tombol/dialog/select/combobox | `components/ui/` | daftar export di tabel primitif |
| tabel panjang, paginasi, sorting UI | `components/dashboard/footer-paginasi.tsx` + halaman terkait | sorting server-side untuk `order`/`stok` (peta 03/05) |
| warna/ikon/animasi | `app/globals.css`, `lucide-react`, `tw-animate-css` | jangan hardcode warna; pakai token |

## Belum diverifikasi
- URL `fetch` dinamis (template literal, mis. `/api/produk/${kode}`) tidak terhitung di kolom endpoint; baca komponennya bila butuh daftar lengkap.
- Komponen dashboard yang dipakai lewat provider/halaman lain (bukan import langsung page) tidak muncul di tabel halaman.
- Detail mekanisme viewport TMA (safe-area, expand) belum ditelusuri sampai baris kode.
