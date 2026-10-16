// components/dashboard/nav-config.ts
import {
  ChartColumn,
  ChartNoAxesCombined,
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutDashboard,
  Package,
  PackageSearch,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  UserRound,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/dashboard/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Role yang boleh melihat tujuan ini di UI. Non-listed = tidak dirender. */
  roles: Role[];
  /** true = ditampilkan di bottom nav mobile (maks 5 termasuk "Lainnya"). */
  utama?: boolean;
}

// Daftar di bawah harus mencerminkan `AKSES_HALAMAN` di lib/d1/akses-halaman.ts —
// itu spec-nya, ini hanya versi menu (judul + ikon). owner = semua, high_admin = semua
// KECUALI /pengaturan (konfigurasi AI), admin = apa adanya hari ini, designer hanya
// /, /profil, /ai-gambar, guest hanya /.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Ringkasan", icon: LayoutDashboard, roles: ["owner", "high_admin", "admin", "designer", "guest"], utama: true },
  { href: "/stok", label: "Stok", icon: PackageSearch, roles: ["owner", "high_admin", "admin"], utama: true },
  { href: "/histori", label: "Histori", icon: History, roles: ["owner", "high_admin", "admin"], utama: true },
  { href: "/draft", label: "Draft", icon: ClipboardList, roles: ["owner", "high_admin", "admin"], utama: true },
  { href: "/order", label: "Order", icon: Package, roles: ["owner", "high_admin", "admin"], utama: true },
  { href: "/laba", label: "Laba", icon: ChartColumn, roles: ["owner", "high_admin", "admin"] },
  { href: "/harga-jual", label: "Harga Jual", icon: Tag, roles: ["owner", "high_admin", "admin"] },
  { href: "/gudang", label: "Gudang", icon: Warehouse, roles: ["owner", "high_admin"] },
  { href: "/opname-gudang", label: "Opname", icon: ClipboardCheck, roles: ["owner", "high_admin", "admin"] },
  { href: "/permintaan-gudang", label: "Permintaan Gudang", icon: Send, roles: ["owner", "high_admin", "admin"] },
  { href: "/permintaan", label: "Permintaan", icon: Send, roles: ["owner", "high_admin", "admin"] },
  { href: "/analisa", label: "Analisa", icon: ChartNoAxesCombined, roles: ["owner", "high_admin", "admin"] },
  { href: "/admin", label: "Admin", icon: ShieldCheck, roles: ["owner", "high_admin", "admin"] },
  // high_admin sengaja TIDAK di sini: /pengaturan berisi konfigurasi AI (kredensial/model/prompt).
  { href: "/pengaturan", label: "Pengaturan", icon: Settings, roles: ["owner", "admin"], utama: true },
  { href: "/profil", label: "Profil", icon: UserRound, roles: ["owner", "high_admin", "admin", "designer"] },
  { href: "/ai-gambar", label: "Studio Gambar", icon: Sparkles, roles: ["owner", "high_admin", "admin", "designer"] },
  // Halaman nyata yang dibuka dari /order (bukan menu) — tetap didaftarkan supaya
  // gerbang ButuhAkses-nya berlaku. Ikut aturan yang sama dengan server.
  { href: "/advance", label: "Advance", icon: Send, roles: ["owner", "high_admin", "admin"] },
];

/** Halaman yang terdaftar demi izin saja, bukan untuk dirender sebagai tombol menu. */
const BUKAN_MENU: Record<string, true> = { "/advance": true };

export function itemUntukRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => i.roles.includes(role) && BUKAN_MENU[i.href] !== true);
}

/**
 * Fail CLOSED — samakan dengan `bolehBukaHalaman` di lib/d1/akses-halaman.ts.
 * `NAV_ITEMS` adalah daftar MENU; halaman yang tak terdaftar di sini tidak otomatis
 * boleh dibuka. (Sebelumnya `return true`, sehingga `/advance` lolos untuk semua role.)
 */
export function bolehAkses(role: Role, href: string): boolean {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) return false;
  return item.roles.includes(role);
}
