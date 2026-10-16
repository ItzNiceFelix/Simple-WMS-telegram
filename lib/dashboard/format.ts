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
  high_admin: "High Admin",
  admin: "Admin",
  designer: "Designer",
  guest: "Guest",
};

/** Fallback aman: role sisa baris lama (mis. `staff`) tetap tampil apa adanya, bukan `undefined`. */
export function labelRole(role: Role): string {
  return LABEL_ROLE[role] ?? String(role);
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
 * Epoch DETIK (kolom `orders.tanggal`) → "15 Okt 2026, 20.04 WIB".
 *
 * Kenapa epoch detik, bukan menerima `iso`: kolom tanggal di DB adalah INTEGER detik dan
 * pemanggilnya sudah memegang angka itu; mengubahnya jadi string lebih dulu hanya menambah
 * satu kesempatan salah parse.
 *
 * Kenapa timeZone WAJIB disebut: tanpa itu hasilnya mengikuti zona BROWSER. Owner memakai
 * Telegram Mini App dari HP yang zonanya bisa apa saja, dan jam order WIB akan tampil
 * bergeser (20.04 jadi 13.04) — persis keluhan "datanya kelihatan salah". Zona papannya
 * adalah WIB dan tidak boleh bergantung pada perangkat.
 *
 * Gaya (id-ID, `hour12: false`, titik sebagai pemisah jam, akhiran "WIB") SENGAJA sama dengan
 * `waktuJakarta` di lib/d1/*Pdf.ts supaya angka di layar dan angka di lembar tercetak sama
 * persis — dua format berbeda untuk satu nilai membuat orang mengira ada dua data.
 *
 * `stamp <= 0` → "—", bukan tengah malam: baris lama dari template Excel repo ini di-truncate
 * ke tengah malam UTC dan sebagian baris bisa 0/kosong. Menampilkan "00.00" untuk itu berarti
 * MENGARANG jam yang tidak pernah tercatat, dan picker bisa mengira ordernya jam 12 malam.
 */
export function formatTanggalJamWib(stamp: number | null | undefined): string {
  const tgl = formatTanggalJamWibBagian(stamp, "tanggal");
  const jam = formatTanggalJamWibBagian(stamp, "jam");
  if (tgl === null || jam === null) return "—";
  return `${tgl}, ${jam} WIB`;
}

/**
 * Satu bagian dari `formatTanggalJamWib` — dipakai kolom tabel yang mencetak tanggal dan jam
 * di BARIS TERPISAH (kolom jadi lebih sempit; lihat SelTanggalWaktu di app/order/page.tsx).
 *
 * Kenapa dipecah di sini, bukan dengan memotong hasil `formatTanggalJamWib`: memotong string
 * berarti bergantung pada posisi koma dan urutan bagian — berubah begitu locale/pilihan opsi
 * berubah, dan salah potong menghasilkan tanggal tanpa jam tanpa error. Kedua bagian dibuat
 * dari opsi `Intl` yang berbeda, jadi tidak ada pemotongan string sama sekali.
 *
 * `stamp <= 0`/bukan angka → `null` (bukan "00.00"), alasannya sama dengan fungsi di atas:
 * jam karangan lebih berbahaya daripada sel kosong.
 */
export function formatTanggalJamWibBagian(stamp: number | null | undefined, bagian: "tanggal" | "jam"): string | null {
  if (stamp == null || !Number.isFinite(stamp) || stamp <= 0) return null;
  const d = new Date(stamp * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(
    "id-ID",
    bagian === "tanggal"
      ? { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" }
      : { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }
  ).format(d);
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
