// lib/d1/peran.ts — Bentuk role DI SERVER.
//
// Ditulis terpisah dari lib/dashboard/types.ts karena sisi D1 dilarang mengimpor
// modul dashboard: types.ts menarik ProviderAi dan seluruh kontrak UI (lucide,
// data mock). Isinya harus IDENTIK dengan union `Role` di sana — satu role beda
// ejaan = user kehilangan halaman tanpa error apa pun.
export type Role = "owner" | "high_admin" | "admin" | "designer" | "guest";

/**
 * Kapabilitas bot Telegram per role — "pemakai ini boleh apa?".
 *
 * Sengaja BUKAN daftar role di dalam gerbang admin: gerbang admin berarti "boleh
 * seluruh perintah", dan menambahkan designer ke sana akan otomatis membuka
 * /stok, /menipis, /laba, /gudang, /tambah, /kurangi, /transfer, /opname, /cari.
 * Tiap jalur bot menanyakan kapabilitas yang benar-benar dibutuhkannya.
 *
 * - owner/high_admin/admin : seluruh perintah, perilaku seperti sebelumnya.
 * - designer               : HANYA `@gambar` (buat/edit gambar) + chat desain
 *                            tanpa tool; nol perintah inventory.
 * - guest / tak dikenal    : tidak boleh apa-apa (fail-closed).
 */
export function kapabilitas(role: string): { bolehPerintah: boolean; bolehGambar: boolean; chatTanpaTool: boolean } {
  if (role === "owner" || role === "high_admin" || role === "admin") {
    return { bolehPerintah: true, bolehGambar: true, chatTanpaTool: false };
  }
  if (role === "designer") return { bolehPerintah: false, bolehGambar: true, chatTanpaTool: true };
  return { bolehPerintah: false, bolehGambar: false, chatTanpaTool: false };
}
