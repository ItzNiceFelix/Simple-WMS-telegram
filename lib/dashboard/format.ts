// lib/dashboard/format.ts
// Helper format & derivasi status stok. Aturan PRD 13.6:
// minus (stok < 0) > menipis (0 <= stok < reorder) > aman.
import type { MovementStatus, Role, StockStatus } from "./types";

export function statusStok(
  stok: number | null | undefined,
  reorderPoint: number | null | undefined
): StockStatus {
  if (stok == null) return "aman";
  if (stok < 0) return "minus";
  if (reorderPoint != null && stok < reorderPoint) return "menipis";
  return "aman";
}

export function kekuranganStok(stok: number | null | undefined): number {
  if (stok == null || stok >= 0) return 0;
  return Math.abs(stok);
}

const LABEL_STATUS: Record<StockStatus, string> = {
  aman: "Aman",
  menipis: "Menipis",
  minus: "Stok Minus",
};

export function labelStatus(s: StockStatus): string {
  return LABEL_STATUS[s];
}

const LABEL_STATUS_MOVEMENT: Record<MovementStatus, string> = {
  processed: "Diproses",
  pending_request: "Menunggu permintaan",
  pending_confirmation: "Menunggu konfirmasi",
};

export function labelStatusMovement(s: MovementStatus): string {
  return LABEL_STATUS_MOVEMENT[s] ?? s;
}

const LABEL_ROLE: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  guest: "Guest",
};

export function labelRole(role: Role): string {
  return LABEL_ROLE[role];
}

/** Angle: angka dengan pemisah ribuan id-ID, tanda minus dipertahankan. */
export function formatAngka(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("id-ID").format(n);
}

export function formatRupiah(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Tanggal ringkas: 15 Sep 2026, 14:30 */
export function formatTanggal(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatTanggalSingkat(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/**
 * "YYYY-MM-DD" -> "15 Sep 2026" TANPA `new Date()` supaya TIDAK bergeser timezone.
 * `new Date("2026-09-15")` diparse sebagai tengah malam UTC; di server TZ barat UTC hasilnya
 * bisa H-1 (PRD v3a §3.5/§10 #7b). Di sini string dipecah manual.
 */
const NAMA_BULAN_SINGKAT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

export function formatTanggalSingkatDariId(idTanggal: string | null | undefined): string {
  if (!idTanggal) return "—";
  const cocok = /^(\d{4})-(\d{2})-(\d{2})/.exec(idTanggal);
  if (!cocok) return "—";
  const [, tahun, bulan, hari] = cocok;
  const namaBulan = NAMA_BULAN_SINGKAT[Number(bulan) - 1];
  if (!namaBulan) return "—";
  return `${Number(hari)} ${namaBulan} ${tahun}`;
}

/** "YYYY-MM-DD" untuk id dokumen daily_requests. */
export function idTanggalHariIni(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "+5" / "-3" untuk delta pergerakan. */
export function formatDelta(n: number | null | undefined): string {
  if (n == null) return "—";
  const s = formatAngka(Math.abs(n));
  return n < 0 ? `-${s}` : `+${s}`;
}
