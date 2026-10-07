// lib/dashboard/data/mock-data.ts
// Dataset mock DETERMINISTIK (bukan acak) — supaya screenshot & snapshot Playwright stabil.
// Bentuk WAJIB identik dengan Firestore nyata (PRD Bagian 23/38.2).
// WAJIB memuat minimal 1 produk dengan stok_gudang_online < 0 (PRD 38.3 / DoD Stok Minus).
import type {
  AccessRequestDoc,
  AdminDoc,
  AiSettingsDoc,
  DailyRequestDoc,
  DailyRequestStatus,
  GudangDoc,
  KeywordNoteDoc,
  MovementDoc,
  MovementSource,
  MovementStatus,
  MovementType,
  OpnameDraftDoc,
  OpnameGudangDoc,
  PermintaanGudangDoc,
  ProdukDoc,
  Role,
  RoleChangeDoc,
  StockDoc,
  SyncStokDraftDoc,
} from "../types";

/** Waktu dasar tetap supaya tanggal deterministik. */
const T0 = "2026-09-15T08:00:00.000Z";

function menitLalu(n: number): string {
  return new Date(new Date(T0).getTime() - n * 60_000).toISOString();
}

function hariLalu(n: number): string {
  return new Date(new Date(T0).getTime() - n * 86_400_000).toISOString();
}

/** Id dokumen `YYYY-MM-DD` (TZ lokal) relatif hari ini. */
function tanggalId(offsetHari: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetHari);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------- produk

export const MOCK_PRODUK: ProdukDoc[] = [
  {
    kode_barang: "BRG-001",
    nama_accurate: "Kemeja Flanel Lengan Panjang",
    nama_accurate_normalized: "kemeja flanel lengan panjang",
    hpp: 85000,
    hpp_baru: 88000,
    is_online_product: true,
    variants: [{ variasi: "M", nama_shopee: "Kemeja Flanel M" }, { variasi: "L", nama_shopee: "Kemeja Flanel L" }],
    search_keywords: ["flanel", "kemeja"],
    updated_at: hariLalu(2),
  },
  {
    kode_barang: "BRG-002",
    nama_accurate: "Kaos Polos Cotton Combed 30s",
    nama_accurate_normalized: "kaos polos cotton combed 30s",
    hpp: 42000,
    hpp_baru: null,
    is_online_product: true,
    variants: [{ variasi: "Hitam", nama_shopee: "Kaos Polos Hitam" }, { variasi: "Putih", nama_shopee: "Kaos Polos Putih" }],
    search_keywords: ["kaos", "cotton"],
    updated_at: hariLalu(5),
  },
  {
    kode_barang: "BRG-003",
    nama_accurate: "Celana Chino Slim Fit",
    nama_accurate_normalized: "celana chino slim fit",
    hpp: 120000,
    hpp_baru: null,
    is_online_product: true,
    variants: [{ variasi: "32", nama_shopee: "Chino 32" }],
    search_keywords: ["chino", "celana"],
    updated_at: hariLalu(1),
  },
  {
    kode_barang: "BRG-004",
    nama_accurate: "Jaket Bomber Hitam",
    nama_accurate_normalized: "jaket bomber hitam",
    hpp: 175000,
    hpp_baru: 180000,
    is_online_product: true,
    variants: [{ variasi: "XL", nama_shopee: "Bomber XL" }],
    search_keywords: ["jaket", "bomber"],
    updated_at: hariLalu(9),
  },
  {
    kode_barang: "BRG-005",
    nama_accurate: "Sepatu Sneakers Putih",
    nama_accurate_normalized: "sepatu sneakers putih",
    hpp: 210000,
    hpp_baru: null,
    is_online_product: true,
    variants: [{ variasi: "42", nama_shopee: "Sneakers 42" }],
    search_keywords: ["sepatu", "sneakers"],
    updated_at: hariLalu(3),
  },
  {
    kode_barang: "BRG-006",
    nama_accurate: "Topi Baseball Logo",
    nama_accurate_normalized: "topi baseball logo",
    hpp: 35000,
    hpp_baru: null,
    is_online_product: true,
    variants: [{ variasi: "-", nama_shopee: "Topi Baseball" }],
    search_keywords: ["topi"],
    updated_at: hariLalu(12),
  },
  {
    kode_barang: "BRG-007",
    nama_accurate: "Tas Ransel Kanvas",
    nama_accurate_normalized: "tas ransel kanvas",
    hpp: 145000,
    hpp_baru: null,
    is_online_product: true,
    variants: [{ variasi: "Abu", nama_shopee: "Ransel Abu" }],
    search_keywords: ["tas", "ransel"],
    updated_at: hariLalu(7),
  },
  {
    kode_barang: "BRG-008",
    nama_accurate: "Sandal Jepit Karet",
    nama_accurate_normalized: "sandal jepit karet",
    hpp: 18000,
    hpp_baru: null,
    is_online_product: true,
    variants: [],
    search_keywords: ["sandal"],
    updated_at: hariLalu(30),
  },
];

// ---------------------------------------------------------------- stock
// WAJIB ada >= 1 produk negatif. BRG-004 = -5 (minus), BRG-003 = 3 < reorder 10 (menipis),
// BRG-006 = 0 < reorder 5 (menipis), BRG-007 reorder null (aman meski kecil).

export const MOCK_STOCK: StockDoc[] = [
  { kode_barang: "BRG-001", stok_gudang_online: 42, reorder_point: 10, last_updated: menitLalu(40), last_updated_by: "900001", last_synced_at: hariLalu(1), last_synced_value: 42 },
  { kode_barang: "BRG-002", stok_gudang_online: 120, reorder_point: 20, last_updated: menitLalu(95), last_updated_by: "900001", last_synced_at: hariLalu(1), last_synced_value: 120 },
  { kode_barang: "BRG-003", stok_gudang_online: 3, reorder_point: 10, last_updated: menitLalu(15), last_updated_by: "900002", last_synced_at: hariLalu(2), last_synced_value: 3 },
  { kode_barang: "BRG-004", stok_gudang_online: -5, reorder_point: 5, last_updated: menitLalu(8), last_updated_by: "900002", last_synced_at: hariLalu(2), last_synced_value: 0 },
  { kode_barang: "BRG-005", stok_gudang_online: 18, reorder_point: 6, last_updated: menitLalu(200), last_updated_by: "900001", last_synced_at: hariLalu(3), last_synced_value: 18 },
  { kode_barang: "BRG-006", stok_gudang_online: 0, reorder_point: 5, last_updated: menitLalu(500), last_updated_by: "900001", last_synced_at: hariLalu(4), last_synced_value: 0 },
  { kode_barang: "BRG-007", stok_gudang_online: 7, reorder_point: null, last_updated: menitLalu(700), last_updated_by: "900002", last_synced_at: null, last_synced_value: null },
  { kode_barang: "BRG-008", stok_gudang_online: -2, reorder_point: null, last_updated: menitLalu(900), last_updated_by: "900001", last_synced_at: null, last_synced_value: null },
];

// ---------------------------------------------------------------- movements

interface MovementSeed {
  id: string;
  kode_barang: string;
  nama_terbaca: string;
  qty: number;
  type: MovementType;
  action_type: string;
  source: MovementSource;
  status: MovementStatus;
  menitLalu: number;
  created_by: string;
  catatan?: string;
  qty_sistem?: number;
  qty_fisik?: number;
  selisih?: number;
}

const MOVEMENT_SEEDS: MovementSeed[] = [
  { id: "mv-001", kode_barang: "BRG-004", nama_terbaca: "Jaket Bomber Hitam", qty: -5, type: "koreksi_manual", action_type: "kurangi_stok", source: "web_dashboard", status: "processed", menitLalu: 8, created_by: "900002", catatan: "Barang keluar belum tercatat" },
  { id: "mv-002", kode_barang: "BRG-003", nama_terbaca: "Celana Chino Slim Fit", qty: -7, type: "koreksi_manual", action_type: "kurangi_stok", source: "web_dashboard", status: "processed", menitLalu: 15, created_by: "900001" },
  { id: "mv-003", kode_barang: "BRG-001", nama_terbaca: "Kemeja Flanel Lengan Panjang", qty: 12, type: "restock", action_type: "tambah_stok", source: "manual_chat", status: "processed", menitLalu: 40, created_by: "900001" },
  { id: "mv-004", kode_barang: "BRG-005", nama_terbaca: "Sepatu Sneakers Putih", qty: -4, type: "keluar_resi", action_type: "kurangi_stok", source: "screenshot", status: "processed", menitLalu: 75, created_by: "900002" },
  { id: "mv-005", kode_barang: "BRG-002", nama_terbaca: "Kaos Polos Cotton Combed 30s", qty: 30, type: "restock", action_type: "tambah_stok", source: "manual_chat_batch", status: "processed", menitLalu: 95, created_by: "900001" },
  { id: "mv-006", kode_barang: "BRG-006", nama_terbaca: "Topi Baseball Logo", qty: -2, type: "opname", action_type: "kurangi_stok", source: "manual_chat", status: "processed", menitLalu: 500, created_by: "900001", qty_sistem: 2, qty_fisik: 0, selisih: -2 },
  { id: "mv-007", kode_barang: "BRG-007", nama_terbaca: "Tas Ransel Kanvas", qty: 7, type: "sync_confirmed", action_type: "tambah_stok", source: "sync", status: "processed", menitLalu: 700, created_by: "900002", catatan: "Sync dari Sheets" },
  { id: "mv-008", kode_barang: "BRG-004", nama_terbaca: "Jaket Bomber Hitam", qty: -3, type: "koreksi_manual", action_type: "kurangi_stok", source: "manual_chat", status: "pending_confirmation", menitLalu: 20, created_by: "900002" },
  { id: "mv-009", kode_barang: "BRG-008", nama_terbaca: "Sandal Jepit Karet", qty: -2, type: "koreksi_manual", action_type: "kurangi_stok", source: "manual_chat", status: "pending_request", menitLalu: 1200, created_by: "900001" },
  { id: "mv-010", kode_barang: "BRG-001", nama_terbaca: "Kemeja Flanel Lengan Panjang", qty: -6, type: "koreksi_manual", action_type: "kurangi_stok", source: "web_dashboard", status: "processed", menitLalu: 1440, created_by: "900001" },
  { id: "mv-011", kode_barang: "BRG-005", nama_terbaca: "Sepatu Sneakers Putih", qty: 10, type: "restock", action_type: "tambah_stok", source: "manual_chat", status: "processed", menitLalu: 2000, created_by: "900002" },
  { id: "mv-012", kode_barang: "BRG-002", nama_terbaca: "Kaos Polos Cotton Combed 30s", qty: -8, type: "keluar_resi", action_type: "kurangi_stok", source: "screenshot", status: "processed", menitLalu: 2600, created_by: "900001" },
];

export const MOCK_MOVEMENTS: MovementDoc[] = MOVEMENT_SEEDS.map((s) => ({
  id: s.id,
  kode_barang: s.kode_barang,
  nama_terbaca: s.nama_terbaca,
  variasi: "-",
  qty: s.qty,
  type: s.type,
  action_type: s.action_type,
  qty_sistem: s.qty_sistem ?? null,
  qty_fisik: s.qty_fisik ?? null,
  selisih: s.selisih ?? null,
  catatan: s.catatan ?? null,
  source: s.source,
  status: s.status,
  created_at: menitLalu(s.menitLalu),
  created_by: s.created_by,
  created_by_username: s.created_by === "900001" ? "owner_toko" : "admin_gudang",
  created_by_name: s.created_by === "900001" ? "Budi Owner" : "Siti Admin",
  requested_by: s.created_by,
  requested_by_username: s.created_by === "900001" ? "owner_toko" : "admin_gudang",
  requested_by_name: s.created_by === "900001" ? "Budi Owner" : "Siti Admin",
  confirmed_by: s.created_by,
  resolved_by: null,
  penanda: null,
}));

// ---------------------------------------------------------------- admins

export const MOCK_ADMINS: AdminDoc[] = [
  { telegram_user_id: "900001", name: "Budi Owner", telegram_username: "owner_toko", role: "owner", added_at: hariLalu(120), approved_by: null, jabatan: "Owner", gudang_id: null },
  { telegram_user_id: "900002", name: "Siti Admin", telegram_username: "admin_gudang", role: "admin", added_at: hariLalu(90), approved_by: "900001", jabatan: "Admin Stok", gudang_id: "D12" },
  { telegram_user_id: "900003", name: "Rina Guest", telegram_username: "rina_lia", role: "guest", added_at: hariLalu(30), approved_by: "900001", jabatan: null, gudang_id: null },
];

export const MOCK_ROLE_CHANGES: RoleChangeDoc[] = [
  { id: "rc-001", target_user_id: "900003", target_name: "Rina Guest", old_role: "guest", new_role: "guest", changed_by: "900001", created_at: hariLalu(30) },
  { id: "rc-002", target_user_id: "900002", target_name: "Siti Admin", old_role: "guest", new_role: "admin", changed_by: "900001", created_at: hariLalu(90) },
];

export const MOCK_ACCESS_REQUESTS: AccessRequestDoc[] = [
  { telegram_user_id: "900010", status: "pending", requested_at: menitLalu(60), telegram_username: "calon_admin", telegram_display_name: "Dewi Calon", rejected_until: null, resolved_by: null, resolved_at: null },
  { telegram_user_id: "900011", status: "rejected", requested_at: hariLalu(2), telegram_username: "spammer", telegram_display_name: "Unknown", rejected_until: menitLalu(-30), resolved_by: "900001", resolved_at: hariLalu(2) },
  { telegram_user_id: "900012", status: "approved", requested_at: hariLalu(10), telegram_username: "toko_2", telegram_display_name: "Toko Cabang", rejected_until: null, resolved_by: "900001", resolved_at: hariLalu(10) },
];

// ---------------------------------------------------------------- drafts

export const MOCK_OPNAME_DRAFTS: OpnameDraftDoc[] = [
  {
    id: "od-001",
    items: [
      { kode_barang: "BRG-001", nama: "Kemeja Flanel Lengan Panjang", kategori: "cocok", qty_sistem: 42, qty_fisik: 42 },
      { kode_barang: "BRG-003", nama: "Celana Chino Slim Fit", kategori: "selisih_kecil", qty_sistem: 10, qty_fisik: 3 },
      { kode_barang: "BRG-006", nama: "Topi Baseball Logo", kategori: "tidak_ketemu", qty_sistem: 2, qty_fisik: null },
    ],
    status: "pending_confirmation",
    created_at: menitLalu(35),
    // Additive v3b §7: pemilik draft (uji otorisasi admin == pemilik). Lihat juga orphan.
    owner_user_id: "900001",
  },
];

export const MOCK_SYNC_DRAFTS: SyncStokDraftDoc[] = [
  {
    id: "sd-001",
    // N-7: `kondisi` WAJIB salah satu KONDISI_VALID (validasiTulisV3a.js) supaya jalur
    // "konfirmasi per kelompok" benar-benar mengirim nilai yang dikenal server.
    kondisi: "sheets_manual",
    items: [
      { kode_barang: "BRG-005", nama: "Sepatu Sneakers Putih", nilai_firestore: 18, nilai_sheets: 20 },
      { kode_barang: "BRG-004", nama: "Jaket Bomber Hitam", nilai_firestore: -5, nilai_sheets: 0 },
    ],
    index_kolom: 3,
    status: "pending_confirmation",
    created_at: menitLalu(50),
    // Additive v3b §7: pemilik draft sync. Lihat juga draft orphan.
    owner_user_id: "900002",
  },
  {
    // Draft sync KEDUA milik owner yang sama, supaya "Konfirmasi Semua" punya >=2 kelompok
    // nyata milik satu pemilik (server scope per `sessions/{owner}.pendingSyncStok`).
    id: "sd-002",
    kondisi: "sheets_ketinggalan",
    items: [
      { kode_barang: "BRG-007", nama: "Tas Ransel Kanvas", nilai_firestore: 5, nilai_sheets: 7 },
    ],
    index_kolom: 4,
    status: "pending_confirmation",
    created_at: menitLalu(45),
    owner_user_id: "900002",
  },
];

// Draft ORPHAN (tanpa `owner_user_id`): uji fail-closed E-1/E-2 di mock. UI WAJIB menandai
// "Pemilik tidak diketahui" dan tombol konfirmasi harus gagal. TIDAK dimasukkan ke konteks
// MOCK_OPNAME_DRAFTS/MOCK_SYNC_DRAFTS supaya penomoran/daftar test lama tetap utuh.
export const MOCK_OPNAME_ORPHAN: OpnameDraftDoc = {
  id: "od-orphan",
  items: [
    { kode_barang: "BRG-002", nama: "Kaos Polos Cotton Combed 30s", kategori: "selisih_wajar", qty_sistem: 120, qty_fisik: 118 },
  ],
  status: "pending_confirmation",
  created_at: menitLalu(70),
};

export const MOCK_SYNC_ORPHAN: SyncStokDraftDoc = {
  id: "sd-orphan",
  kondisi: "konflik",
  items: [
    { kode_barang: "BRG-003", nama: "Celana Chino Slim Fit", nilai_firestore: 3, nilai_sheets: 5 },
  ],
  index_kolom: 3,
  status: "pending_confirmation",
  created_at: menitLalu(80),
};

// ---------------------------------------------------------------- picking (v3b A2)

// Seed BATCH picking untuk uji manual `/draft` tanpa Firestore. SENGAJA array terpisah dari
// `MOVEMENT_SEEDS` supaya test lama yang menghitung gerakan stok tidak berubah.
//   owner 900001: 3 movement -> 2 punya kode_barang ("2 siap"), 1 tanpa kode_barang ("1 dilewati")
//   owner 900002: 2 movement, semuanya punya kode_barang ("2 siap")
//   owner 900004: 2 movement pending, SEMUA kode_barang — owner ini TIDAK punya movement
//     processed di MOCK_MOVEMENTS, sehingga batch-nya benar-benar "siap" dan jalur SUKSES
//     konfirmasi picking bisa diuji manual. (Batch 900001/900002 sengaja "sebagian" karena
//     owner tsb sudah punya movement processed — paritas E-3 fail-closed route: batch = SEMUA
//     movement milik pemilik, bukan hanya yang pending.)
// Bentuk objek KOMPLIT seperti MovementDoc; `status` pending_confirmation + `action_type` non-null.
export const MOCK_PICKING_MOVEMENTS: MovementDoc[] = [
  {
    id: "pk-001",
    kode_barang: "BRG-004",
    nama_terbaca: "Jaket Bomber Hitam",
    variasi: "L",
    qty: -2,
    type: "keluar_resi",
    action_type: "kurangi_stok",
    qty_sistem: null,
    qty_fisik: null,
    selisih: null,
    catatan: null,
    source: "screenshot",
    status: "pending_confirmation",
    created_at: menitLalu(12),
    created_by: "900001",
    created_by_username: "owner_toko",
    created_by_name: "Budi Owner",
    requested_by: "900001",
    requested_by_username: "owner_toko",
    requested_by_name: "Budi Owner",
    confirmed_by: null,
    resolved_by: null,
    penanda: null,
  },
  {
    id: "pk-002",
    kode_barang: "BRG-003",
    nama_terbaca: "Celana Chino Slim Fit",
    variasi: "32",
    qty: -3,
    type: "keluar_resi",
    action_type: "kurangi_stok",
    qty_sistem: null,
    qty_fisik: null,
    selisih: null,
    catatan: null,
    source: "screenshot",
    status: "pending_confirmation",
    created_at: menitLalu(11),
    created_by: "900001",
    created_by_username: "owner_toko",
    created_by_name: "Budi Owner",
    requested_by: "900001",
    requested_by_username: "owner_toko",
    requested_by_name: "Budi Owner",
    confirmed_by: null,
    resolved_by: null,
    penanda: null,
  },
  {
    // Tanpa kode_barang -> "dilewati" (produk tak ketemu/ragu), tetap anggota batch.
    id: "pk-003",
    kode_barang: "",
    nama_terbaca: "Produk Tak Dikenal",
    variasi: "-",
    qty: -1,
    type: "keluar_resi",
    action_type: "kurangi_stok",
    qty_sistem: null,
    qty_fisik: null,
    selisih: null,
    catatan: "Nama produk tidak yakin",
    source: "screenshot",
    status: "pending_confirmation",
    created_at: menitLalu(10),
    created_by: "900001",
    created_by_username: "owner_toko",
    created_by_name: "Budi Owner",
    requested_by: "900001",
    requested_by_username: "owner_toko",
    requested_by_name: "Budi Owner",
    confirmed_by: null,
    resolved_by: null,
    penanda: null,
  },
  {
    id: "pk-004",
    kode_barang: "BRG-005",
    nama_terbaca: "Sepatu Sneakers Putih",
    variasi: "42",
    qty: -1,
    type: "keluar_resi",
    action_type: "kurangi_stok",
    qty_sistem: null,
    qty_fisik: null,
    selisih: null,
    catatan: null,
    source: "screenshot",
    status: "pending_confirmation",
    created_at: menitLalu(9),
    created_by: "900002",
    created_by_username: "admin_gudang",
    created_by_name: "Siti Admin",
    requested_by: "900002",
    requested_by_username: "admin_gudang",
    requested_by_name: "Siti Admin",
    confirmed_by: null,
    resolved_by: null,
    penanda: null,
  },
  {
    id: "pk-005",
    kode_barang: "BRG-002",
    nama_terbaca: "Kaos Polos Cotton Combed 30s",
    variasi: "Hitam",
    qty: -4,
    type: "keluar_resi",
    action_type: "kurangi_stok",
    qty_sistem: null,
    qty_fisik: null,
    selisih: null,
    catatan: null,
    source: "screenshot",
    status: "pending_confirmation",
    created_at: menitLalu(8),
    created_by: "900002",
    created_by_username: "admin_gudang",
    created_by_name: "Siti Admin",
    requested_by: "900002",
    requested_by_username: "admin_gudang",
    requested_by_name: "Siti Admin",
    confirmed_by: null,
    resolved_by: null,
    penanda: null,
  },
  {
    // Owner "bersih" (tanpa movement processed) -> batch "siap" untuk uji sukses apply/batal.
    id: "pk-006",
    kode_barang: "BRG-001",
    nama_terbaca: "Kemeja Flanel Lengan Panjang",
    variasi: "M",
    qty: -2,
    type: "keluar_resi",
    action_type: "kurangi_stok",
    qty_sistem: null,
    qty_fisik: null,
    selisih: null,
    catatan: null,
    source: "screenshot",
    status: "pending_confirmation",
    created_at: menitLalu(7),
    created_by: "900004",
    created_by_username: "admin_picking",
    created_by_name: "Andi Picking",
    requested_by: "900004",
    requested_by_username: "admin_picking",
    requested_by_name: "Andi Picking",
    confirmed_by: null,
    resolved_by: null,
    penanda: null,
  },
  {
    id: "pk-007",
    kode_barang: "BRG-007",
    nama_terbaca: "Tas Ransel Kanvas",
    variasi: "-",
    qty: -1,
    type: "keluar_resi",
    action_type: "kurangi_stok",
    qty_sistem: null,
    qty_fisik: null,
    selisih: null,
    catatan: null,
    source: "screenshot",
    status: "pending_confirmation",
    created_at: menitLalu(6),
    created_by: "900004",
    created_by_username: "admin_picking",
    created_by_name: "Andi Picking",
    requested_by: "900004",
    requested_by_username: "admin_picking",
    requested_by_name: "Andi Picking",
    confirmed_by: null,
    resolved_by: null,
    penanda: null,
  },
];

// ---------------------------------------------------------------- daily

// Hari ini = "draft" (tombol Ubah Jumlah + Kirim Form). Item lama tanpa field v3a besar
// SENGAJA: membuktikan normalizer jalur baca UI (B3) mengisi `status`/`qty_diminta` dkk.
// Tanggal dokumen RELATIF hari ini supaya suite e2e tidak basi saat tanggal mesin berganti.
// Seed "mentah" (bentuk data bot) — item SENGAJA tanpa field v3a supaya normalizer jalur baca
// UI (B3) benar-benar teruji. Bukan `DailyRequestDoc` penuh; mock store menormalisasi saat baca.
export interface DailyRequestSeed {
  tanggal: string;
  items: {
    kode_barang: string;
    nama: string;
    variasi: string;
    qty: number;
    buffer: boolean;
  }[];
  status: DailyRequestStatus;
  created_at: string;
}

export const MOCK_DAILY_REQUESTS: DailyRequestSeed[] = [
  {
    tanggal: tanggalId(0),
    items: [
      // Item lama dari bot: HANYA field lama -> normalizer WAJIB mengisi sisanya.
      { kode_barang: "BRG-004", nama: "Jaket Bomber Hitam", variasi: "XL", qty: 10, buffer: false },
      { kode_barang: "BRG-003", nama: "Celana Chino Slim Fit", variasi: "32", qty: 7, buffer: true },
      // Item qty 0 (B6): badge "Tidak diminta", tanpa tombol Barang Datang.
      { kode_barang: "BRG-006", nama: "Topi Baseball Logo", variasi: "-", qty: 0, buffer: false },
    ],
    status: "draft",
    created_at: menitLalu(30),
  },
  {
    tanggal: tanggalId(-1),
    items: [
      { kode_barang: "BRG-002", nama: "Kaos Polos Cotton Combed 30s", variasi: "Hitam", qty: 25, buffer: false },
    ],
    status: "selesai",
    created_at: hariLalu(1),
  },
];

// ------------------------------------------------------------------- keyword_notes
// Campuran `guessed` (Belum dikonfirmasi) & `confirmed` (Terkonfirmasi) utk uji filter + badge.
export const MOCK_KEYWORD_NOTES: KeywordNoteDoc[] = [
  {
    id: "kw-001",
    raw_text: "sisa gdg",
    interpreted_as: "MINTA_SISA",
    confidence: "guessed",
    usage_count: 12,
    last_used: menitLalu(20),
    first_seen: hariLalu(20),
    confirmed_by: null,
    confirmed_at: null,
  },
  {
    id: "kw-002",
    raw_text: "toko",
    interpreted_as: "MINTA",
    confidence: "confirmed",
    usage_count: 48,
    last_used: menitLalu(120),
    first_seen: hariLalu(60),
    confirmed_by: "900001",
    confirmed_at: hariLalu(30),
  },
  {
    id: "kw-003",
    raw_text: "gudang online",
    interpreted_as: "STOK",
    confidence: "confirmed",
    usage_count: 31,
    last_used: hariLalu(1),
    first_seen: hariLalu(45),
    confirmed_by: "900001",
    confirmed_at: hariLalu(40),
  },
  {
    id: "kw-004",
    raw_text: "brg rusak",
    interpreted_as: null,
    confidence: "guessed",
    usage_count: 3,
    last_used: hariLalu(3),
    first_seen: hariLalu(3),
    confirmed_by: null,
    confirmed_at: null,
  },
];

// ---------------------------------------------------------------- settings

// ---------------------------------------------------------------- gudang (v5 F1)

// Seed TERPISAH (tidak menyentuh MOCK_STOCK/MOCK_MOVEMENTS) supaya e2e pengunci COUNT tetap utuh.
// "ONLINE" = gudang default warisan (paritas key qty_per_gudang "ONLINE", BR3); "D12" = gudang cabang.
export const MOCK_GUDANG: GudangDoc[] = [
  { gudang_id: "ONLINE", nama: "ONLINE", aktif: true, urutan: 0, created_at: hariLalu(60), created_by: "900001" },
  { gudang_id: "D12", nama: "Gudang D12", aktif: true, urutan: 1, created_at: hariLalu(60), created_by: "900001" },
];

// Opname gudang (v5 F7). Satu menunggu_approval (owner melihat setujui/tolak), satu sudah disetujui.
export const MOCK_OPNAME_GUDANG: OpnameGudangDoc[] = [
  {
    id: "og-001",
    gudang_id: "D12",
    items: [
      { kode_barang: "BRG-001", qty_sistem: 4, qty_fisik: 3, selisih: -1, belum_terdaftar: false },
      { kode_barang: "BRG-002", qty_sistem: 6, qty_fisik: 8, selisih: 2, belum_terdaftar: false },
    ],
    status: "menunggu_approval",
    created_by: "900002",
    created_at: menitLalu(90),
  },
  {
    id: "og-002",
    gudang_id: "ONLINE",
    items: [{ kode_barang: "BRG-005", qty_sistem: 18, qty_fisik: 18, selisih: 0, belum_terdaftar: false }],
    status: "disetujui",
    created_by: "900001",
    created_at: hariLalu(2),
    disetujui_oleh: "900001",
    disetujui_at: hariLalu(2),
  },
];

// ---------------------------------------------------------------- settings
export const MOCK_AI_SETTINGS: AiSettingsDoc = {
  textProvider: "groq",
  updatedAt: hariLalu(14),
  updatedBy: "900001",
};

export const MOCK_SESSION: { user: { id: string; username: string | null; name: string | null }; role: Role; gudangId: string | null } = {
  user: { id: "900001", username: "owner_toko", name: "Budi Owner" },
  role: "owner",
  // v5: gudang kerja user mock (dipakai scope tulis). null = owner (semua gudang).
  gudangId: null,
};

/** v5 F5/F6: seed permintaan antar-gudang (satu dokumen, status PER-TUJUAN). */
export const MOCK_PERMINTAAN_GUDANG: PermintaanGudangDoc[] = [
  {
    id: "pg-001",
    dari_gudang_id: "D12",
    tujuan: [
      {
        tipe: "gudang",
        id: "D13",
        nama: "Gudang D13",
        jabatan: null,
        gudang_id_snapshot: "D13",
        status: "menunggu",
        status_kirim: "menunggu",
        user_penerima_id: null,
        user_penerima_nama: null,
        items: [{ kode_barang: "BRG-003", qty: 3 }],
      },
    ],
    tujuan_ids: ["gudang:D13"],
    status: "menunggu",
    items: [{ kode_barang: "BRG-003", qty: 3 }],
    created_by: "900002",
    created_at: hariLalu(1),
    updated_at: hariLalu(1),
    riwayat_status: [{ status: "menunggu", oleh: "900002", at: hariLalu(1) }],
  },
];