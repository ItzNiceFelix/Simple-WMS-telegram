# Visual Review

> Reviewer: visual QA independen. Bukti: 18 screenshot di `test-results/visual/` (desktop 1280x800,
> mobile 360x640). Tidak ada server dijalankan; tidak ada source diubah. Beberapa item hanya bisa
> dinilai dari sumber (state interaktif tidak ada di screenshot) — ditandai "tidak dapat diverifikasi".

## Verdict
**CHANGES_REQUIRED** — layak produksi setelah perbaikan minor. Tidak ada BLOCKER. Arsitektur visual,
token semantik, badge status, dark mode, dan mobile-first sudah sesuai spec.

## Scores
- Hierarchy: 8/10
- Typography: 8/10
- Spacing: 8/10
- Composition: 8/10
- Consistency: 8/10
- Responsive: 8/10
- Accessibility-visible: 7/10

## Findings

### MAJOR

1. **H1 `desktop-h1-ringkasan.png` — grid kartu statistik kosong di kolom kanan.**
   `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` (`app/page.tsx:293`) dengan 3 kartu (guest/minus) atau
   5 kartu (staff). Pada desktop 1280 (`lg`, 5 kolom) + role staff = 5 kartu pas. Bila role guest
   (3 kartu), grid 5 kolom menyisakan **2 sel kosong** di kanan — kartu tampak menggantung, bukan
   terdistribusi. Bukti: `desktop-h1-ringkasan.png`.
   Perbaikan: pakai `lg:grid-cols-3 xl:grid-cols-5` atau `grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]`
   agar jumlah kolom mengikuti jumlah kartu.

2. **H2 Stok `desktop-stok.png` — dua ToggleGroup berdampingan menciptakan baris kontrol padat.**
   Filter (3 item, salah satunya "Perlu Minta Gudang Cabang" panjang) + sort (3 item) dibungkus
   `flex-wrap` (`app/stok/page.tsx:129`). Pada 1280px, label panjang mendorong grup sort ke kanan
   sehingga kontrol terkesan berdesakan dan sulit dipindai sebagai dua grup berbeda.
   Perbaikan: beri `Separator`/`gap-4` lebih tegas atau label "Urutkan:" sebelum grup sort.

### MINOR

3. **H4 Histori `desktop-histori.png` + `mobile-histori.png` — panel filter mendominasi.**
   `FieldSet` filter memuat 4 tombol mode + 2 input tanggal + tombol "Hapus filter" dengan
   `rounded-xl border p-4` (`app/histori/page.tsx:208`). Di mobile `mobile-histori.png`, panel ini
   memakan > 40% viewport pertama sehingga timeline pergerakan (konten utama) berada di bawah lipatan.
   Perbaikan: collapse panel filter di mobile (Sheet/Accordion) atau default-nya tertutup.

4. **H7 Admin `mobile-admin.png` — tabel Daftar Admin berpotensi melebar.**
   Tabel 4 kolom (Nama panjang + Username + Peran + Ditambahkan) dirender tanpa varian kartu mobile
   (`app/admin/page.tsx:126`); berbeda dari H2 yang punya `md:hidden` kartu. Pada 360px kolom
   "Ditambahkan" (formatTanggal Indonesia panjang) dapat memaksa scroll horizontal. Tergantung
   panjang tanggal; screenshot `mobile-admin.png` menunjukkan baris data ada tetapi kompresi tinggi.
   Perbaikan: tambah varian kartu mobile untuk daftar admin (pola sama dengan H2) atau sembunyikan
   kolom "Ditambahkan" di `< md`.

5. **H1/H3 `desktop-h1-gelap.png` / `mobile-h1-gelap.png` — aksen kartu "Stok Minus" di dark mode rendah kontras.**
   Kartu minus pakai `ring-status-minus/40` (`app/page.tsx:355`). Di dark, `--status-minus: oklch(0.68 0.21 25)`
   pada latar `--card: oklch(0.205 0 0)` menghasilkan ring tipis yang hampir tidak terlihat pada
   screenshot. Badge merah-nya jelas, tetapi affordance kartu "menonjol" (spec 3.H1) lemah di dark.
   Perbaikan: naikkan opasitas ring di dark (`ring-status-minus/60`) atau tambah border kiri aksen.

6. **Badge status "Aman" — label hadir, tetapi di dark mode `status-aman-fg` bisa sulit dibedakan dari background hijau pucat.**
   `desktop-h1-gelap.png`/`mobile-h1-gelap.png`: badge Aman terbaca, namun kontras teks-vs-fill tipis.
   Tidak cukup bukti untuk menyebut gagal 4.5:1 tanpa pengukuran piksel; **kontras tepat tidak dapat diverifikasi**.
   Perbaikan: audit kontras token `--status-*-fg` vs fill di dark dengan alat kontras.

### NIT

7. **H1 `desktop-h1-ringkasan.png` — judul blok pakai `text-base` (`app/page.tsx:411`) sementara h1 halaman `text-xl`.**
   Skala h2 `text-base font-semibold` memang sesuai ui-spec §1 (`text-sm` label kartu, h1 `text-xl`),
   tetapi jarak h1→h2 kecil; hierarki bisa dipertegas dengan `text-lg` untuk h2. Subjektif.

8. **H2 `desktop-stok.png` — kolom "Nama" `max-w-64 truncate` (`app/stok/page.tsx:274`) dapat memotong nama panjang tanpa tooltip.**
   Tidak terlihat terpotong di screenshot (data mock pendek), jadi **dampak tidak dapat diverifikasi**.

9. **`mobile-stok.png` — tombol "Koreksi" `h-11 w-full` (`app/stok/page.tsx:237`) memenuhi kartu; target sentuh >= 44px terpenuhi.** Baik. Tidak ada temuan.

## Yang sudah baik (bukti)

- **Badge status warna + label** jelas: "Stok Minus" merah (badge destructive + dot), "Menipis" amber,
  "Aman" hijau netral — terlihat di `desktop-stok.png`, `mobile-stok.png`, `desktop-produk-BRG-004.png`.
  Prioritas minus di atas menipis terjaga (`status` ditentukan sekali di data, bukan fallback warna).
- **Angka `tabular-nums`** diterapkan konsisten pada stok/HPP/delta/kartu statistik.
- **Dark mode berfungsi**: `desktop-h1-gelap.png`/`mobile-h1-gelap.png` menunjukkan token gelap
  terpakai merata, teks terbaca, tidak ada elemen putih "bocor".
- **Mobile composi tiada scroll horizontal**: bottom nav 4 utama + "Lainnya" (Sheet) sesuai ui-spec §2;
  nav item `min-h-11` (44px) terpenuhi.
- **Shell konsisten**: sidebar 240px desktop, header sticky, konten `p-4 md:p-6` seragam antar halaman.
- **State kosong/error ada**: Empty dashed, Alert destructive + "Coba lagi" di H1/H2/H4/H7 (source).
- **ToggleGroup/filter pakai `ToggleGroupItem h-11 md:h-8`** → target sentuh mobile >= 44px.

## Fix Order (maks 8, dampak tertinggi dulu)

1. H1: grid kartu statistik jangan sisakan sel kosong (`auto-fit`/`minmax` atau kolom menyesuaikan jumlah kartu).
2. H4: panel filter collapsible di mobile agar timeline di atas lipatan.
3. H7: varian kartu mobile untuk Daftar Admin (cegah tabel melebar di 360px).
4. H2: pisahkan visual grup filter vs sort (gap/separator/label "Urutkan:").
5. Dark mode: perkuat aksen kartu "Stok Minus" (`ring-status-minus/60`) dan audit kontras token `--status-*-fg`.
6. H2/H3: beri tooltip/`title` pada nama panjang yang di-`truncate`.
7. H1: pertimbangkan h2 `text-lg` untuk hierarki lebih tegas.
8. Tambah verifikasi kontras terukur (alat otomatis) untuk badge & teks muted di dark/light.

## Kesimpulan
Belum layak produksi hanya karena temuan MAJOR #1 (komposisi grid H1) dan #2 (kepadatan kontrol H2);
keduanya perbaikan CSS kecil. Selebihnya solid dan sesuai `docs/ui-spec.md`. Setelah fix order 1–5,
verdict dapat naik ke PASS.
