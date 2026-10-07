// lib/dashboard/data/index.ts
// Satu kontrak data-access dengan DUA implementasi: mock | real (PRD 38.2).
// Pilih lewat NEXT_PUBLIC_DASHBOARD_DATA. Default: mock (aman untuk dev/pengujian).
import type {
  AccessRequestDoc,
  AdminDoc,
  AiSettingsDoc,
  AdminV5Response,
  BuatOpnameGudangRequest,
  SetGudangUserRequest,
  SetJabatanRequest,
  BuatOpnameGudangResponse,
  GudangDoc,
  DailyRequestDoc,
  HapusAdminRequest,
  HapusAdminResponse,
  KeywordNoteDoc,
  KonfirmasiDraftRequest,
  KonfirmasiDraftResponse,
  KonfirmasiKeywordRequest,
  OpnameGudangStatus,
  KonfirmasiKeywordResponse,
  KirimFormRequest,
  KirimFormResponse,
  MovementDoc,
  MutasiRequest,
  MutasiResponse,
  OpnameDraftDoc,
  OpnameGudangDoc,
  PickingBatchDoc,
  ProdukDoc,
  RingkasanData,
  RoleChangeDoc,
  SessionInfo,
  SelesaikanRequest,
  SelesaikanResponse,
  SesuaikanQtyRequest,
  SesuaikanQtyResponse,
  SyncStokDraftDoc,
  TambahAdminRequest,
  TambahAdminResponse,
  TandaiDatangRequest,
  TandaiDatangResponse,
  UbahHppRequest,
  UbahHppResponse,
  UbahReorderPointRequest,
  UbahReorderPointResponse,
  UbahRoleAdminRequest,
  UbahRoleAdminResponse,
  PutusAksesRequest,
  PutusAksesResponse,
  SetQtyGudangRequest,
  SetQtyGudangResponse,
  MutasiStokGudangRequest,
  MutasiStokGudangResponse,
  SetujuiOpnameGudangRequest,
  SetujuiOpnameGudangResponse,
  TambahGudangRequest,
  TambahGudangResponse,
  TambahProdukRequest,
  TambahProdukResponse,
  ToggleOnlineRequest,
  ToggleOnlineResponse,
  AksiPermintaanRequest,
  AksiTujuanRequest,
  BuatPermintaanGudangRequest,
  ListPermintaanFilter,
  PermintaanGudangDoc,
  PermintaanGudangResponse,
  TutupTujuanRequest,
  UbahItemPermintaanRequest,
  UbahGudangRequest,
  UbahGudangResponse,
} from "../types";

export interface MovementFilter {
  kode_barang?: string;
  type?: string;
  status?: string;
  created_by?: string;
  /** Batas bawah created_at (ISO), inklusif. */
  dari?: string;
  /** Batas atas created_at (ISO), inklusif. */
  sampai?: string;
  limit?: number;
}

export interface ProdukDetail {
  produk: ProdukDoc;
  stok: { kode_barang: string; stok_gudang_online: number | null; reorder_point: number | null } | null;
}

export interface DataSource {
  getSession(): Promise<SessionInfo>;
  getRingkasan(): Promise<RingkasanData>;
  /** v5 (F9): filter opsional (gudang + online). Tanpa argumen = produk online (paritas lama). */
  listStock(filter?: import("../types").StockFilter): Promise<import("../types").StockRow[]>;
  getProduk(kode: string): Promise<ProdukDetail | null>;
  listMovements(filter?: MovementFilter): Promise<MovementDoc[]>;
  listOpnameDrafts(): Promise<OpnameDraftDoc[]>;
  listSyncDrafts(): Promise<SyncStokDraftDoc[]>;
  listDailyRequests(): Promise<DailyRequestDoc[]>;
  listAdmins(): Promise<AdminDoc[]>;
  listRoleChanges(): Promise<RoleChangeDoc[]>;
  listAccessRequests(): Promise<AccessRequestDoc[]>;
  getAiSettings(): Promise<AiSettingsDoc>;
  mutasiStok(req: MutasiRequest): Promise<MutasiResponse>;
  ubahProviderAi(provider: string): Promise<{ ok: true } | { ok: false; error: string }>;

  // ---- Tulis v2 (F1-F4). Kontrak BEKU (Wave 3a) — dipakai mock & real. ----
  ubahHpp(req: UbahHppRequest): Promise<UbahHppResponse>;
  ubahReorderPoint(req: UbahReorderPointRequest): Promise<UbahReorderPointResponse>;
  ubahRoleAdmin(req: UbahRoleAdminRequest): Promise<UbahRoleAdminResponse>;
  tambahAdmin(req: TambahAdminRequest): Promise<TambahAdminResponse>;
  hapusAdmin(req: HapusAdminRequest): Promise<HapusAdminResponse>;

  // ---- Tulis v3a (F1 permintaan harian + F2 keyword notes). Kontrak BEKU (Wave 3a). ----
  /** `sesuaikan` — Ubah Jumlah. `req.tanggal` disertakan di body. */
  sesuaikanQtyPermintaan(req: SesuaikanQtyRequest): Promise<SesuaikanQtyResponse>;
  /** `buat-form` — Kirim Form / Kirim Ulang. */
  kirimFormPermintaan(req: KirimFormRequest): Promise<KirimFormResponse>;
  /** `datang` — Barang Datang (per item). */
  tandaiPermintaanDatang(req: TandaiDatangRequest): Promise<TandaiDatangResponse>;
  /** `selesai` — Selesai manual. */
  selesaikanPermintaan(req: SelesaikanRequest): Promise<SelesaikanResponse>;
  /** F2 — daftar penanda (owner + admin). */
  listKeywordNotes(): Promise<KeywordNoteDoc[]>;
  /** F2 — konfirmasi interpretasi penanda (owner only). */
  konfirmasiKeywordNote(req: KonfirmasiKeywordRequest): Promise<KonfirmasiKeywordResponse>;

  // ---- Tulis v3b Fase A (A7 permintaan akses + A5 tambah produk). Kontrak BEKU. ----
  /** A7 — pprove-akses (owner only). */
  setujuiAkses(req: PutusAksesRequest): Promise<PutusAksesResponse>;
  /** A7 — 	olak-akses (owner only). */
  tolakAkses(req: PutusAksesRequest): Promise<PutusAksesResponse>;
  /** A5 — 	ambah-produk (owner + admin). */
  tambahProduk(req: TambahProdukRequest): Promise<TambahProdukResponse>;

  // ---- Tulis v3b Fase B (A2 konfirmasi-draft). Kontrak BEKU. ----
  /** A2 — daftar batch picking pending, satu entri per pemilik sesi (PRD v3b §10.3 UI-1). */
  listPickingDrafts(): Promise<PickingBatchDoc[]>;
  /** A2 — konfirmasi/batalkan draft (opname/sync per draft, picking per batch). */
  konfirmasiDraft(req: KonfirmasiDraftRequest): Promise<KonfirmasiDraftResponse>;

  // ---- Tulis v5 (F1 gudang, F2 set-qty, F7 opname, F8 toggle online). ----
  /** F1 — daftar gudang; `semua:true` menyertakan yang nonaktif (owner). Aktif + urut `urutan`. */
  listGudang(opts?: { semua?: boolean }): Promise<GudangDoc[]>;
  /** F1 — tambah gudang (owner only). */
  tambahGudang(req: TambahGudangRequest): Promise<TambahGudangResponse>;
  /** F1 — ubah nama gudang (owner only). */
  ubahGudang(req: UbahGudangRequest): Promise<UbahGudangResponse>;
  /** F2 — set qty satu gudang (owner + admin, admin ter-scope gudangnya). */
  setQtyGudang(req: SetQtyGudangRequest): Promise<SetQtyGudangResponse>;
  /** v5.2 — pindah qty antar dua gudang (owner + admin, admin memindah DARI gudangnya). */
  mutasiStokGudang(req: MutasiStokGudangRequest): Promise<MutasiStokGudangResponse>;
  /** F8 — toggle `is_online_product` (owner + admin). */
  toggleOnlineProduk(req: ToggleOnlineRequest): Promise<ToggleOnlineResponse>;
  /** F7 — daftar opname gudang; `status` opsional (mis. `"menunggu_approval"`). */
  listOpnameGudang(opts?: { status?: OpnameGudangStatus }): Promise<OpnameGudangDoc[]>;
  /** F7 — buat opname (owner + admin). Server menghitung qty_sistem/selisih. */
  buatOpnameGudang(req: BuatOpnameGudangRequest): Promise<BuatOpnameGudangResponse>;
  /** F7 — setujui opname (owner only). CAS: qty berubah sejak dibuat -> error 409. */
  setujuiOpnameGudang(req: SetujuiOpnameGudangRequest): Promise<SetujuiOpnameGudangResponse>;
  /** F7 — tolak opname (owner only). */
  tolakOpnameGudang(req: SetujuiOpnameGudangRequest): Promise<SetujuiOpnameGudangResponse>;

  // ---- v5 F5/F6: permintaan antar-gudang (satu dokumen, status PER-TUJUAN). ----
  /** F5 - daftar permintaan. Filter opsional; baca lintas gudang diizinkan (R5). */
  listPermintaanGudang(filter?: ListPermintaanFilter): Promise<PermintaanGudangDoc[]>;
  /** F5 - buat permintaan (admin: gudang sendiri; owner: bebas). */
  buatPermintaanGudang(req: BuatPermintaanGudangRequest): Promise<PermintaanGudangResponse>;
  /** F5 - ubah item (hanya status menunggu). */
  ubahItemPermintaan(req: UbahItemPermintaanRequest): Promise<PermintaanGudangResponse>;
  /** v5.1 (Q1) - setujui SATU tujuan: penerima tujuan itu, atau owner. */
  setujuiTujuanGudang(req: AksiTujuanRequest): Promise<PermintaanGudangResponse>;
  /** v5.1 (P1) - tolak SATU tujuan: penerima tujuan itu, atau owner. */
  tolakTujuanPermintaanGudang(req: AksiTujuanRequest): Promise<PermintaanGudangResponse>;
  /** F5 - tolak dokumen (semua tujuan masih menunggu). */
  tolakPermintaanGudang(req: AksiPermintaanRequest): Promise<PermintaanGudangResponse>;
  /** F5 - batal (dari menunggu/disetujui, R1). */
  batalPermintaanGudang(req: AksiPermintaanRequest): Promise<PermintaanGudangResponse>;
  /** v5.1 (P7) - kirim SATU tujuan: stok asal turun sebesar qty tujuan itu saja. */
  kirimPermintaanGudang(req: AksiTujuanRequest): Promise<PermintaanGudangResponse>;
  /** F5 - terima satu tujuan (stok gudang snapshot tujuan naik). Gate pembuat/owner. */
  terimaPermintaanGudang(req: AksiTujuanRequest): Promise<PermintaanGudangResponse>;
  /** F5 - tidak-terima satu tujuan (stok kembali ke gudang asal). Gate pembuat/owner. */
  tidakTerimaPermintaanGudang(req: AksiTujuanRequest): Promise<PermintaanGudangResponse>;
  /** v5.1 (P6) - selesai: pembuat/owner, semua tujuan harus final. */
  selesaiPermintaanGudang(req: AksiPermintaanRequest): Promise<PermintaanGudangResponse>;
  /** F5 - tutup tujuan nyangkut (OWNER only, wajib catatan). */
  tutupTujuanPermintaanGudang(req: TutupTujuanRequest): Promise<PermintaanGudangResponse>;
  /** F3 - set gudang kerja user (owner only). gudang_id null = hapus penetapan. */
  setGudangUser(req: SetGudangUserRequest): Promise<AdminV5Response>;
  /** F4 - set jabatan user (owner only). Kosong/null = hapus label. */
  setJabatan(req: SetJabatanRequest): Promise<AdminV5Response>;
  /** F6 - daftar user ber-gudang untuk opsi Kirim ke: User (Q5a) + jabatan. */
  listUserTujuan(): Promise<{ telegram_user_id: string; name: string | null; jabatan: string | null; gudang_id: string | null }[]>;
}

export type DataMode = "mock" | "real";

export function dataMode(): DataMode {
  const raw = (process.env.NEXT_PUBLIC_DASHBOARD_DATA || "mock").toLowerCase();
  return raw === "real" ? "real" : "mock";
}

export function isMockMode(): boolean {
  return dataMode() === "mock";
}

/**
 * Guard R11: mode mock MENOLAK BOOT di build/lingkungan produksi.
 * Dipanggil dari client shell saat mount; melempar error di produksi.
 */
export function assertMockAllowedInThisEnv(): void {
  if (!isMockMode()) return;
  // R11: mock DILARANG di produksi kecuali flag eksplisit khusus pengujian
  // (NEXT_PUBLIC_ALLOW_MOCK=true, diset hanya oleh build e2e lokal).
  const allowMock = process.env.NEXT_PUBLIC_ALLOW_MOCK === "true";
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
  if (isProduction && !allowMock) {
    throw new Error(
      "Mode mock tidak diizinkan di produksi. Set NEXT_PUBLIC_DASHBOARD_DATA=real."
    );
  }
}
