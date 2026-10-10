// lib/dashboard/types.ts
// Bentuk data dashboard — WAJIB identik dengan dokumen Firestore nyata (PRD Bagian 23).
// Mock dan real memakai tipe yang sama; integrasi = tukar implementasi, bukan ubah UI.

import type { ProviderAi } from "./providerAi";

export type { ProviderAi } from "./providerAi";

export type Role = "owner" | "admin" | "guest";

export type MovementType =
  | "keluar_resi"
  | "opname"
  | "restock"
  | "koreksi_manual"
  | "sync_confirmed"
  | "jual_mp"
  | "retur_mp";

export type MovementStatus =
  | "processed"
  | "pending_request"
  | "pending_confirmation";

export type MovementSource =
  | "screenshot"
  | "manual_chat"
  | "manual_chat_batch"
  | "manual_chat_batch_produk_baru"
  | "manual_chat_produk_baru"
  | "sync"
  | "web_dashboard";

/** Koleksi `stock/{kode_barang}` */
export interface StockDoc {
  kode_barang: string;
  /** Signed integer. BOLEH negatif — negatif = sinyal kekurangan (PRD 13.6). */
  stok_gudang_online: number;
  /** v5 (D2a): qty per gudang. Key "ONLINE" = cerminan stok_gudang_online (BR3). */
  qty_per_gudang?: Record<string, number>;
  reorder_point: number | null;
  last_updated: string | null;
  last_updated_by: string | null;
  last_synced_at: string | null;
  last_synced_value: number | null;
}

/** `products/{kode_barang}` */
export interface ProdukVariant {
  variasi?: string;
  nama_shopee?: string;
  [key: string]: unknown;
}

export interface ProdukDoc {
  kode_barang: string;
  nama_accurate: string;
  nama_accurate_normalized?: string;
  hpp: number | null;
  hpp_baru: number | null;
  is_online_product: boolean;
  kategori?: string | null;
  tier_override?: string | null;
  pre_order?: boolean;
  ukuran_khusus?: boolean;
  go_override?: string | null;
  variants?: ProdukVariant[];
  search_keywords?: string[];
  updated_at: string | null;
}

/** Baris gabungan stok + produk untuk tabel/detail. */
export interface StockRow {
  kode_barang: string;
  nama_accurate: string | null;
  hpp: number | null;
  stok_gudang_online: number | null;
  /** v5: qty per gudang (semua key). Kosong bila dokumen lama sebelum migrasi. */
  qty_per_gudang: Record<string, number>;
  /** v5: flag global produk (F8/F9). Dipakai filter default online. */
  is_online_product: boolean;
  reorder_point: number | null;
  status: StockStatus;
  /** Kekurangan = Math.abs(stok) saat status "minus". */
  kekurangan: number;
  /** Path kategori Shopee (PRD v2 U5). Null = kosong. */
  kategori?: string | null;
  /** True bila path ada di kategori_tarif atau tier_override terisi. */
  terpetakan?: boolean;
}

/** v5 (F9): filter listStock. Default is_online=true; gudang_id untuk scope. */
export interface StockFilter {
  /** Filter satu gudang (nilai dari qty_per_gudang[key]). null = tanpa filter gudang. */
  gudang_id?: string | null;
  /** true = hanya produk online; "semua" = jangan filter. Default true. */
  is_online?: boolean | "semua";
  /** Sertakan produk tanpa dokumen stock (qty null). */
  sertakan_tanpa_gudang?: boolean;
}

/** v5 (F1): koleksi gudang/{gudang_id}. */
export interface GudangDoc {
  gudang_id: string;
  nama: string;
  aktif: boolean;
  urutan: number;
  created_at: string | null;
  created_by: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  nonaktif_at?: string | null;
  peringatan_referensi?: number;
}

/** v5 (F5/R2): status satu entri tujuan[] - status PER-TUJUAN. */
export type TujuanStatus =
  | "menunggu"
  | "diterima"
  | "tidak_terima"
  | "ditolak"
  | "ditutup";

/** v5.1 (Q1/Q8): status setujui+kirim pada level TUJUAN. */
export type StatusKirimTujuan = "menunggu" | "disetujui" | "dikirim";

export interface TujuanEntri {
  tipe: "gudang" | "user";
  id: string;
  nama: string | null;
  jabatan: string | null;
  /** Snapshot gudang saat buat (T10); null bila user tanpa gudang. */
  gudang_id_snapshot: string | null;
  status: TujuanStatus;
  /** v5.1 (Q1/Q8): siklus setujui+kirim PER TUJUAN. */
  status_kirim: StatusKirimTujuan;
  /** v5.1 (Q2/Q3): penerima, harus dari gudang tujuan. null = owner fallback. */
  user_penerima_id: string | null;
  user_penerima_nama: string | null;
  /** v5.1 (P7): qty PER TUJUAN. Boleh beda antar tujuan. */
  items: PermintaanItem[];
  /** v5.1 (Q7): null = belum dicoba, false = gagal kirim. */
  notifikasi_terkirim?: boolean | null;
  disetujui_at?: string | null;
  disetujui_oleh?: string | null;
  dikirim_at?: string | null;
  dikirim_oleh?: string | null;
  ditolak_at?: string | null;
  ditolak_oleh?: string | null;
  diterima_at?: string | null;
  diterima_oleh?: string | null;
  tidak_terima_at?: string | null;
  tidak_terima_oleh?: string | null;
  ditutup_at?: string | null;
  ditutup_oleh?: string | null;
  catatan_alasan?: string | null;
}

export interface PermintaanItem {
  kode_barang: string;
  qty: number;
}

/** v5 (F5): status dokumen keseluruhan (TURUNAN dari status tujuan). */
export type PermintaanStatus =
  | "menunggu"
  | "disetujui"
  | "ditolak"
  | "dibatalkan"
  | "dikirim"
  | "selesai";

export interface PermintaanGudangDoc {
  id: string;
  dari_gudang_id: string;
  tujuan: TujuanEntri[];
  /** Field bantu untuk query array-contains (T21). */
  tujuan_ids: string[];
  status: PermintaanStatus;
  items: PermintaanItem[];
  created_by: string;
  created_at: string;
  updated_at: string | null;
  disetujui_oleh?: string | null;
  ditolak_oleh?: string | null;
  dibatalkan_oleh?: string | null;
  dikirim_oleh?: string | null;
  dikirim_at?: string | null;
  selesai_at?: string | null;
  riwayat_status: { status: string; oleh: string | null; at: string }[];
}

/** v5 (F7): status opname_gudang. */
export type OpnameGudangStatus = "menunggu_approval" | "disetujui" | "ditolak";

export interface OpnameGudangItem {
  kode_barang: string;
  qty_sistem: number | null;
  qty_fisik: number;
  selisih: number;
  belum_terdaftar: boolean;
}

export interface OpnameGudangDoc {
  id: string;
  gudang_id: string;
  items: OpnameGudangItem[];
  status: OpnameGudangStatus;
  created_by: string;
  created_at: string;
  disetujui_oleh?: string | null;
  disetujui_at?: string | null;
  ditolak_oleh?: string | null;
}

export type StockStatus = "aman" | "menipis" | "minus";

/** `stock_movements/{autoId}` */
export interface MovementDoc {
  id: string;
  kode_barang: string;
  nama_terbaca: string | null;
  variasi: string | null;
  /** Signed; delta kurangi negatif. */
  qty: number | null;
  type: MovementType;
  action_type: string | null;
  qty_sistem: number | null;
  qty_fisik: number | null;
  /** Signed. */
  selisih: number | null;
  catatan: string | null;
  source: MovementSource;
  status: MovementStatus;
  created_at: string;
  /** SELALU string (PRD BR10). */
  created_by: string | null;
  created_by_username: string | null;
  created_by_name: string | null;
  requested_by: string | null;
  requested_by_username: string | null;
  requested_by_name: string | null;
  confirmed_by: string | null;
  resolved_by: string | null;
  penanda: string | null;
}

/** Status per item (PRD v3a —4.1). Normalizer jalur baca menetapkan `"diminta"` utk item lama. */
export type DailyRequestItemStatus = "diminta" | "datang";

export interface DailyRequestItem {
  kode_barang: string;
  nama: string;
  variasi: string;
  qty: number;
  buffer: boolean;
  /** Status efektif per item. Item lama -> `"diminta"`. */
  status: DailyRequestItemStatus;
  /** Snapshot qty saat form dikirim (B2). Item lama -> `qty`. */
  qty_diminta: number | null;
  /** Qty aktual diterima; `null` bila belum datang. */
  qty_datang: number | null;
  /** ISO string; `null` bila belum datang. */
  datang_at: string | null;
  datang_by: string | null;
}

export type DailyRequestStatus = "draft" | "diproses" | "selesai";

/** Entri audit `sesuaikan` (B5), max 50 terakhir di dokumen. */
export interface PerubahanQty {
  key_item: string;
  qty_lama: number;
  qty_baru: number;
  oleh: string;
  at: string;
}

/** `daily_requests/{YYYY-MM-DD}` — field baru v3a (PRD —4.1). */
export interface DailyRequestDoc {
  tanggal: string;
  items: DailyRequestItem[];
  status: DailyRequestStatus;
  created_at: string;
  form_dibuat_at: string | null;
  form_dibuat_by: string | null;
  selesai_at: string | null;
  selesai_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  perubahan?: PerubahanQty[];
}

/** `keyword_notes/{autoId}` — kamus penanda picking list (PRD —6.1). */
export type InterpretasiKeyword = "STOK" | "MINTA" | "MINTA_SISA";
export type ConfidenceKeyword = "guessed" | "confirmed";

export interface KeywordNoteDoc {
  id: string;
  raw_text: string;
  interpreted_as: InterpretasiKeyword | null;
  confidence: ConfidenceKeyword;
  usage_count: number;
  last_used: string | null;
  first_seen?: string | null;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
}

/** `opname_drafts/{autoId}` */
export interface OpnameDraftDoc {
  id: string;
  items: {
    kode_barang?: string;
    nama?: string;
    kategori?: string;
    qty_sistem?: number | null;
    qty_fisik?: number | null;
    [key: string]: unknown;
  }[];
  status: string;
  created_at: string;
  /** Additive bot v3b §7: pemilik draft (telegram user id). Absen/null = tak diketahui. */
  owner_user_id?: string | null;
}

/** `sync_stok_drafts/{autoId}` */
export interface SyncStokDraftDoc {
  id: string;
  kondisi: string;
  items: {
    kode_barang?: string;
    nama?: string;
    nilai_firestore?: number | null;
    nilai_sheets?: number | null;
    [key: string]: unknown;
  }[];
  index_kolom: number | null;
  status: string;
  created_at: string;
  /** Additive bot v3b §7: pemilik draft (telegram user id). Absen/null = tak diketahui. */
  owner_user_id?: string | null;
}

/** `admins/{telegram_user_id}` */
export interface AdminDoc {
  telegram_user_id: string;
  name: string | null;
  telegram_username: string | null;
  role: Role;
  added_at: string | null;
  approved_by: string | null;
  role_updated_at?: string | null;
  role_updated_by?: string | null;
  /** v5: jabatan bebas (label KOSMETIK, tidak memengaruhi permission). */
  jabatan?: string | null;
  /** v5: lokasi kerja (scope). Satu gudang. */
  gudang_id?: string | null;
}

/** `admin_role_changes/{autoId}` */
export interface RoleChangeDoc {
  id: string;
  target_user_id: string;
  target_name: string | null;
  old_role: string | null;
  new_role: string;
  changed_by: string;
  created_at: string;
}

/** `access_requests/{telegram_user_id}` */
export interface AccessRequestDoc {
  telegram_user_id: string;
  status: string;
  requested_at: string | null;
  telegram_username: string | null;
  telegram_display_name: string | null;
  rejected_until: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

/** `system_settings/ai` */
export interface AiSettingsDoc {
  textProvider: ProviderAi;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Hasil auth (mock maupun real) — role TIDAK boleh datang dari client di mode real. */
export interface SessionInfo {
  user: { id: string; username: string | null; name: string | null };
  role: Role;
  /**
   * Status super admin DIRI SENDIRI (F5/Q3): `isSuperAdminDariEnv(uid) || role === "owner"`.
   * Berasal dari env `SUPER_ADMIN_ID` + role owner; TIDAK dapat diubah dari dashboard.
   */
  superAdmin: boolean;
}

/** `product_changes/{autoId}` — audit perubahan data master produk (v2 §8.1). */
export interface ProductChangeDoc {
  id: string;
  kode_barang: string;
  field: "hpp" | "hpp_baru" | "reorder_point";
  nilai_lama: number | null;
  nilai_baru: number | null;
  changed_by: string;
  created_at: string;
}

// ---- Kontrak tulis ----

export type MutasiMode = "tambah" | "kurangi" | "timpa";

export interface MutasiRequest {
  kode_barang: string;
  mode: MutasiMode;
  qty: number;
  catatan?: string;
}

export type MutasiResponse =
  | { ok: true; stok_baru: number; movement_id: string }
  | { ok: false; error: string };

export interface RingkasanData {
  totalProdukOnline: number;
  itemMenipis: number;
  itemMinus: number;
  draftPending: number | null;
  permintaanHariIni: number | null;
}

// ---- Kontrak tulis v2 (F1-F4) ----
// Semua respons tulis: sukses punya `ok: true`, gagal `{ ok: false, error }`.
// `peringatan_audit: true` muncul bila tulis sukses tapi audit gagal (tanpa rollback, PRD §4.3/E3).

/** F1 `POST /api/produk/hpp` — minimal salah satu `hpp`/`hpp_baru` harus ada. */
export interface UbahHppRequest {
  kode_barang: string;
  hpp?: number;
  /** `null` = hapus HPP baru; field tidak dikirim = tidak diubah. */
  hpp_baru?: number | null;
}

export type UbahHppResponse =
  | { ok: true; produk: ProdukDoc; peringatan_audit?: boolean }
  | { ok: false; error: string };

/** F2 `POST /api/stok/reorder-point` — `reorder_point` wajib ada; `null` sah (hapus). */
export interface UbahReorderPointRequest {
  kode_barang: string;
  reorder_point: number | null;
}

export type UbahReorderPointResponse =
  | { ok: true; reorder_point: number | null; notifikasi_terkirim: boolean }
  | { ok: false; error: string };

/** F3 `POST /api/admin/role`. */
export interface UbahRoleAdminRequest {
  target_user_id: string;
  role_baru: Role;
}

export type UbahRoleAdminResponse =
  | {
      ok: true;
      target_user_id: string;
      role_lama: string;
      role_baru: Role;
      peringatan_audit?: boolean;
    }
  | { ok: false; error: string };

/** F4a `POST /api/admin/tambah`. */
export interface TambahAdminRequest {
  telegram_user_id: string;
  name: string;
  telegram_username?: string | null;
  role?: Role;
}

export type TambahAdminResponse =
  | { ok: true; admin: AdminDoc; peringatan_audit?: boolean }
  | { ok: false; error: string };

/** F4b `POST /api/admin/hapus`. */
export interface HapusAdminRequest {
  telegram_user_id: string;
}

export type HapusAdminResponse =
  | {
      ok: true;
      telegram_user_id: string;
      nama: string | null;
      peringatan_audit?: boolean;
      /** Revoke access_requests gagal setelah hapus sukses (tidak rollback). */
      peringatan_revoke?: boolean;
    }
  | { ok: false; error: string };


// ---- Kontrak tulis v3a (F1 permintaan harian + F2 keyword notes) ----
// Route: `POST /api/permintaan` (4 aksi) + `POST /api/admin` (aksi `kata-kunci`).
// Semua respons: sukses `{ ok: true, ... }`, gagal `{ ok: false, error }` — pola v2.

/** Identitas item (T1/S3.7): kode + variasi + buffer. WAJIB dikirim di payload item. */
export interface ItemKey {
  kode_barang: string;
  variasi: string;
  buffer: boolean;
}

/** Aksi `sesuaikan` — Ubah Jumlah. Satu baris per item (qty baru). */
export interface SesuaikanQtyRequest {
  tanggal: string;
  qty: (ItemKey & { qty: number })[];
}

export type SesuaikanQtyResponse =
  | {
      ok: true;
      tanggal: string;
      items: DailyRequestItem[];
      status: DailyRequestStatus;
      perubahan_terakhir: PerubahanQty | null;
    }
  | { ok: false; error: string };

/** Aksi `buat-form` — Kirim Form / Kirim Ulang. */
export interface KirimFormRequest {
  tanggal: string;
}

export type KirimFormResponse =
  | {
      ok: true;
      tanggal: string;
      status: "diproses";
      form_dibuat_at: string | null;
      /** false bila idempoten (< 30 detik) -> Telegram TIDAK dikirim ulang. */
      dikirim_ulang: boolean;
      kirim_terkirim?: number;
      kirim_gagal?: number;
      /** true bila tulis sukses tapi sebagian pesan Telegram gagal (tidak rollback). */
      peringatan_kirim?: boolean;
    }
  | { ok: false; error: string };

/** Aksi `datang` — Barang Datang (per item). */
export interface TandaiDatangRequest {
  tanggal: string;
  item: ItemKey & { qty_datang: number };
}

export type TandaiDatangResponse =
  | {
      ok: true;
      tanggal: string;
      status: DailyRequestStatus;
      selesai_otomatis: boolean;
      items: DailyRequestItem[];
    }
  | { ok: false; error: string };

/** Aksi `selesai` — Selesai manual (item tak akan datang / qty 0). */
export interface SelesaikanRequest {
  tanggal: string;
}

export type SelesaikanResponse =
  | { ok: true; tanggal: string; status: "selesai"; selesai_at: string | null }
  | { ok: false; error: string };

/** F2 `POST /api/admin` aksi `kata-kunci` (owner only). */
export interface KonfirmasiKeywordRequest {
  id: string;
  interpreted_as: InterpretasiKeyword;
}

export type KonfirmasiKeywordResponse =
  | { ok: true; note: KeywordNoteDoc }
  | { ok: false; error: string };
// ---- Kontrak tulis v3b (Fase A: A7 permintaan akses + A5 tambah produk) ----
// Route: `POST /api/admin` (aksi titip, budget function tetap). Pola v2/v3a:
// sukses `{ ok: true, ... }`, gagal `{ ok: false, error }` dengan pesan server APA ADANYA.

/** A7 `POST /api/admin` aksi `approve-akses` / `tolak-akses` (owner only). */
export interface PutusAksesRequest {
  target_user_id: string;
}

export type StatusAksesKeputusan = "approved" | "rejected";

export type PutusAksesResponse =
  | {
      ok: true;
      target_user_id: string;
      status: StatusAksesKeputusan;
      /** false bila status tersimpan tapi notifikasi Telegram ke user gagal terkirim (tidak rollback). */
      notifikasi_terkirim: boolean;
    }
  | { ok: false; error: string };

/** A5 `POST /api/admin` aksi `tambah-produk` (owner + admin). */
export interface TambahProdukRequest {
  kode_barang: string;
  nama_produk: string;
  /** Absen = tidak diset (server -> null). */
  hpp?: number;
  /** Absen = 0 (default). */
  stok_awal?: number;
}

export type TambahProdukResponse =
  | {
      ok: true;
      produk: {
        kode_barang: string;
        nama_accurate: string;
        hpp: number | null;
        is_online_product: true;
      };
      stok_awal: number;
    }
  | { ok: false; error: string };

/** Satu BATCH picking list = satu sesi `sessions/{owner}.pendingPickingList` (PRD v3b §5.4 B1).
 *  Bukan per-movement. `batch_id` = telegram user id pemilik. */
export interface PickingBatchDoc {
  /** = telegram user id pemilik sesi (`owner_user_id`). */
  batch_id: string;
  owner_user_id: string | null;
  /** Movement `pending_confirmation` milik batch ini (bukan seluruh movement). */
  movements: MovementDoc[];
  /** Movement yang akan diproses (punya `kode_barang`) — dipakai ringkasan "N siap". */
  siap: number;
  /** Movement yang akan dilewati (`!kode_barang`) — ringkasan "M dilewati". */
  dilewati: number;
  /** `siap` + `dilewati` > 0 tapi tidak semua `pending_confirmation` -> setengah jadi (E-3). */
  sebagian: boolean;
}

/** A2 `POST /api/admin` aksi `konfirmasi-draft` (owner: semua draft; admin: draft sendiri). */
export interface KonfirmasiDraftRequest {
  jenis: "opname" | "picking" | "sync";
  /** Wajib untuk `jenis` opname/sync. JANGAN dikirim untuk picking. */
  draft_id?: string;
  /** Wajib untuk `jenis:"picking"`; absen untuk lainnya. */
  batch_id?: string;
  aksi_draft: "apply" | "batal";
  /** Hanya `jenis:"sync"`. Absen = server memperlakukan `"semua"`. */
  kondisi?: string;
}

// ---- Kontrak tulis v5 (F1 master gudang, F2 set-qty gudang, F7 opname, F8 toggle online). ----
// Route: `POST /api/gudang` (tambah/edit/nonaktif/aktifkan), `POST /api/stok/gudang` (set-qty),
// `POST /api/opname-gudang` (buat/setujui/tolak), `POST /api/produk/online` (toggle).
// Pola v2/v3a/v3b: sukses `{ ok: true, ... }`, gagal `{ ok: false, error }` pesan server APA ADANYA.

/** F1 `POST /api/gudang` aksi `tambah` / `edit`. */
export interface TambahGudangRequest {
  aksi: "tambah" | "edit";
  nama: string;
  /** Wajib untuk aksi `edit`. */
  gudang_id?: string;
}

export type TambahGudangResponse =
  | { ok: true; gudang: GudangDoc }
  | { ok: false; error: string };

/** F1 `POST /api/gudang` aksi `edit`. */
export interface UbahGudangRequest {
  aksi: "edit" | "nonaktif" | "aktifkan";
  gudang_id: string;
  /** Wajib untuk aksi `edit`. */
  nama?: string;
}

export type UbahGudangResponse =
  | {
      ok: true;
      gudang: GudangDoc;
      /** Hanya aksi `nonaktif`: jumlah referensi (admins.gudang_id + key stock.qty_per_gudang). */
      peringatan_referensi?: number;
    }
  | { ok: false; error: string };

/** F2 `POST /api/stok/gudang` aksi `set-qty`. */
export interface SetQtyGudangRequest {
  kode_barang: string;
  gudang_id: string;
  /** Bilangan bulat >= 0. */
  qty: number;
}

export type SetQtyGudangResponse =
  | { ok: true; qty_per_gudang: Record<string, number> }
  | { ok: false; error: string };

/** v5.2 `POST /api/stok/gudang` aksi `mutasi-gudang` (D6). */
export interface MutasiStokGudangRequest {
  kode_barang: string;
  dari_gudang_id: string;
  ke_gudang_id: string;
  qty: number;
}

export type MutasiStokGudangResponse =
  | { ok: true; qty_per_gudang: Record<string, number> }
  | { ok: false; error: string };

/** F3 `POST /api/admin` aksi `set-gudang-user` (owner only). `gudang_id: null` = hapus penetapan. */
export interface SetGudangUserRequest {
  target_user_id: string;
  gudang_id: string | null;
}

/** F4 `POST /api/admin` aksi `set-jabatan` (owner only). Kosong/null = hapus label. */
export interface SetJabatanRequest {
  target_user_id: string;
  jabatan: string | null;
}

/** Respons bersama aksi admin v5 yang mengembalikan dokumen admin terbaru. */
export type AdminV5Response =
  | { ok: true; admin: AdminDoc }
  | { ok: false; error: string };

/** F8 `POST /api/produk/online`. */
export interface ToggleOnlineRequest {
  kode_barang: string;
  is_online: boolean;
}

export type ToggleOnlineResponse =
  | { ok: true }
  | { ok: false; error: string };

/** F7 `POST /api/opname-gudang` aksi `buat`. */
export interface BuatOpnameGudangRequest {
  gudang_id: string;
  items: { kode_barang: string; qty_fisik: number }[];
}

export type BuatOpnameGudangResponse =
  | {
      ok: true;
      opname: OpnameGudangDoc;
      status: OpnameGudangStatus;
      /** true = semua selisih 0, qty sudah langsung ditulis (BR6). */
      langsung: boolean;
    }
  | { ok: false; error: string };

/** F7 `POST /api/opname-gudang` aksi `setujui` / `tolak` (owner only). */
export interface SetujuiOpnameGudangRequest {
  id: string;
}

export type SetujuiOpnameGudangResponse =
  | { ok: true; opname: OpnameGudangDoc }
  | { ok: false; error: string };
// ---- v5 F5/F6: permintaan antar-gudang ----

export interface PermintaanTujuanInput {
  tipe: "gudang";
  id: string;
  /** v5.1 (Q2/Q3): penerima dari gudang tujuan. null = owner fallback. */
  user_penerima_id?: string | null;
  /** v5.1 (P7): qty PER TUJUAN (boleh beda). Bila kosong, pakai items dokumen. */
  items?: PermintaanItem[];
}

export interface BuatPermintaanGudangRequest {
  dari_gudang_id: string;
  tujuan: PermintaanTujuanInput[];
  items: PermintaanItem[];
}

export interface UbahItemPermintaanRequest {
  id: string;
  items: PermintaanItem[];
}

export interface AksiPermintaanRequest {
  id: string;
}

export interface AksiTujuanRequest {
  id: string;
  tujuan_index: number;
}

export interface TutupTujuanRequest {
  id: string;
  tujuan_index: number;
  catatan: string;
}

export type PermintaanGudangResponse =
  | { ok: true; permintaan: PermintaanGudangDoc; [k: string]: unknown }
  | { ok: false; error: string };

export interface ListPermintaanFilter {
  status?: PermintaanStatus;
  dari_gudang_id?: string;
  created_by?: string;
  tujuan_id?: string;
}

export type KonfirmasiDraftResponse =
  | {
      ok: true;
      jenis: "opname" | "picking" | "sync";
      aksi_draft: "apply" | "batal";
      /** Hasil dari fungsi bot (`{ok:true, ...}`); bentuk spesifik per jenis. */
      diproses?: number;
      dilewati?: number;
      sisa?: number;
      dibatalkan?: boolean;
      batch_id?: string;
    }
  | { ok: false; error: string };
