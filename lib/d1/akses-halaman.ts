// lib/d1/akses-halaman.ts — "boleh buka halaman ini?" di SISI SERVER.
//
// Kenapa tidak memakai `bolehAkses` dari components/dashboard/nav-config.ts:
//   1. Fail OPEN. `if (!item) return true` → href yang tak ada di NAV_ITEMS lolos untuk
//      SEMUA role. `/advance` adalah halaman nyata yang memang belum terdaftar di
//      NAV_ITEMS, jadi jalur itu bukan teori. Di klien itu cuma salah render; di server
//      artinya guest bisa membuka halaman admin.
//   2. `NAV_ITEMS` adalah daftar MENU (judul, ikon, bottom-nav), bukan daftar hak akses.
//      Server tak punya alasan mengimpor lucide-react demi menjawab satu pertanyaan izin.
// Di sini daftarnya EKSPLISIT dan arah defaultnya TERBALIK: href tak dikenal = tolak.
import type { Role } from "./peran";

/**
 * Halaman yang boleh dibuka tiap role (href persis seperti di NAV_ITEMS).
 * Sumber: components/dashboard/nav-config.ts (17 item) + `/advance` (halaman nyata
 * yang belum masuk NAV_ITEMS).
 */
const SEMUA_HALAMAN = [
  "/",
  "/stok",
  "/produk-total",
  "/histori",
  "/draft",
  "/order",
  "/laba",
  "/harga-jual",
  "/gudang",
  "/opname-gudang",
  "/permintaan-gudang",
  "/permintaan",
  "/analisa",
  "/admin",
  "/pengaturan",
  "/profil",
  "/ai-gambar",
  "/advance",
] as const;

/** high_admin = semua halaman kecuali /pengaturan (konfigurasi AI). */
const HALAMAN_HIGH_ADMIN = SEMUA_HALAMAN.filter((h) => h !== "/pengaturan");

export const AKSES_HALAMAN: Record<Role, readonly string[]> = {
  owner: SEMUA_HALAMAN,
  high_admin: HALAMAN_HIGH_ADMIN,
  // admin: apa adanya hari ini — /gudang owner-only dan /pengaturan ikut (semua tab
  // selain AI tetap cek is_owner sendiri di servernya).
  admin: [
    "/", "/stok", "/produk-total", "/histori", "/draft", "/order", "/laba", "/harga-jual",
    "/opname-gudang", "/permintaan-gudang", "/permintaan", "/analisa", "/admin",
    "/pengaturan", "/profil", "/ai-gambar", "/advance",
  ],
  designer: ["/", "/profil", "/ai-gambar"],
  guest: ["/"],
};

/** Role yang boleh memakai /ai-gambar — termasuk API-nya (biaya kredit gambar). */
export const ROLE_GAMBAR: readonly Role[] = ["owner", "high_admin", "admin", "designer"];

/**
 * Satu-satunya penentu izin halaman di server.
 * Fail CLOSED: role tak dikenal (mis. `staff` sisa baris lama) DAN href tak terdaftar
 * dua-duanya dijawab "tidak". Bandingkan dengan `bolehAkses` di nav-config yang kebalikannya.
 */
export function bolehBukaHalaman(role: string, href: string): boolean {
  const daftar = (AKSES_HALAMAN as Record<string, readonly string[] | undefined>)[role];
  return daftar !== undefined && daftar.includes(href);
}
