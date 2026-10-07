// components/dashboard/nav-config.ts
import {
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutDashboard,
  PackageSearch,
  Send,
  Settings,
  ShieldCheck,
  Tags,
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

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Ringkasan", icon: LayoutDashboard, roles: ["owner", "admin", "guest"], utama: true },
  { href: "/stok", label: "Stok", icon: PackageSearch, roles: ["owner", "admin", "guest"], utama: true },
  { href: "/histori", label: "Histori", icon: History, roles: ["owner", "admin", "guest"], utama: true },
  { href: "/draft", label: "Draft", icon: ClipboardList, roles: ["owner", "admin"], utama: true },
  { href: "/gudang", label: "Gudang", icon: Warehouse, roles: ["owner"] },
  { href: "/opname-gudang", label: "Opname", icon: ClipboardCheck, roles: ["owner", "admin"] },
  { href: "/permintaan-gudang", label: "Permintaan Gudang", icon: Send, roles: ["owner", "admin"] },
  { href: "/permintaan", label: "Permintaan", icon: Send, roles: ["owner", "admin"] },
  { href: "/kata-kunci", label: "Kata Kunci", icon: Tags, roles: ["owner", "admin"] },
  { href: "/admin", label: "Admin", icon: ShieldCheck, roles: ["owner", "admin"] },
  { href: "/pengaturan", label: "Pengaturan", icon: Settings, roles: ["owner", "admin"], utama: true },
];

export function itemUntukRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => i.roles.includes(role));
}

export function bolehAkses(role: Role, href: string): boolean {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) return true;
  return item.roles.includes(role);
}
