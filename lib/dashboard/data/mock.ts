// lib/dashboard/data/mock.ts
// Implementasi DataSource berbasis data mock deterministik + store mutable.
// Tidak ada network call keluar (PRD 38.4).
import { idTanggalHariIni, statusStok, kekuranganStok } from "../format";

// CJS murni (satu sumber kebenaran filter dengan real.ts + test).
import filterStok from "./filterStok.js";
import { adalahProviderAi } from "../providerAi";
import { SESI_KEDALUWARSA } from "../pesan";
import type {
  AdminDoc,
  AiSettingsDoc,
  BuatOpnameGudangRequest,
  BuatOpnameGudangResponse,
  DailyRequestDoc,
  DailyRequestItem,
  GudangDoc,
  InterpretasiKeyword,
  KeywordNoteDoc,
  KonfirmasiKeywordRequest,
  KonfirmasiKeywordResponse,
  PutusAksesRequest,
  PutusAksesResponse,
  TambahProdukRequest,
  TambahProdukResponse,
  KirimFormRequest,
  KirimFormResponse,
  PerubahanQty,
  SelesaikanRequest,
  SelesaikanResponse,
  SesuaikanQtyRequest,
  SesuaikanQtyResponse,
  TandaiDatangRequest,
  TandaiDatangResponse,
  HapusAdminRequest,
  HapusAdminResponse,
  MovementDoc,
  MutasiRequest,
  MutasiResponse,
  OpnameDraftDoc,
  OpnameGudangDoc,
  OpnameGudangStatus,
  PickingBatchDoc,
  PermintaanGudangDoc,
  ProdukDoc,
  RingkasanData,
  Role,
  RoleChangeDoc,
  StockFilter,
  StockRow,
  SetQtyGudangRequest,
  SetQtyGudangResponse,
  MutasiStokGudangRequest,
  MutasiStokGudangResponse,
  SetujuiOpnameGudangRequest,
  SetujuiOpnameGudangResponse,
  SyncStokDraftDoc,
  TambahGudangRequest,
  TambahGudangResponse,
  ToggleOnlineRequest,
  ToggleOnlineResponse,
  UbahGudangRequest,
  UbahGudangResponse,
  KonfirmasiDraftRequest,
  KonfirmasiDraftResponse,
  TambahAdminRequest,
  TambahAdminResponse,
  UbahHppRequest,
  UbahHppResponse,
  UbahReorderPointRequest,
  UbahReorderPointResponse,
  UbahRoleAdminRequest,
  UbahRoleAdminResponse,
} from "../types";
import type { DataSource, MovementFilter, ProdukDetail } from "./index";
import { guardHapusMock, superAdminMock, validasiHppMock } from "./mock-paritas";
import {
  gabungItemDuplikat,
  normalisasiDokumen,
  normalisasiItemLama,
  normalisasiStatusDokumen,
  normalisasiPerubahan,
} from "./normalisasi";
import {
  MOCK_ACCESS_REQUESTS,
  MOCK_ADMINS,
  MOCK_AI_SETTINGS,
  MOCK_DAILY_REQUESTS,
  MOCK_GUDANG,
  MOCK_PERMINTAAN_GUDANG,
  MOCK_KEYWORD_NOTES,
  MOCK_OPNAME_GUDANG,
  MOCK_MOVEMENTS,
  MOCK_OPNAME_DRAFTS,
  MOCK_OPNAME_ORPHAN,
  MOCK_PICKING_MOVEMENTS,
  MOCK_PRODUK,
  MOCK_ROLE_CHANGES,
  MOCK_SESSION,
  MOCK_STOCK,
  MOCK_SYNC_DRAFTS,
  MOCK_SYNC_ORPHAN,
} from "./mock-data";

// Store mutable supaya aksi tulis mock mengubah state (dan UI refetch melihat hasilnya).
const store = {
  stock: MOCK_STOCK.map((s) => ({ ...s })),
  // Histori (H1/H4) HANYA memakai 12 movement lama — seed picking dipisah supaya jumlah baris
  // histori tidak berubah (kontrak e2e histori.spec.ts/ringkasan.spec.ts).
  movements: MOCK_MOVEMENTS.map((m) => ({ ...m })),
  // Movement batch picking (A2). Dibaca HANYA oleh listPickingDrafts/konfirmasiDraft, BUKAN
  // listMovements — di produksi keduanya memang koleksi yang sama, di mock dipisah demi e2e.
  pickingMovements: MOCK_PICKING_MOVEMENTS.map((m) => ({ ...m })),
  produk: MOCK_PRODUK.map((p) => ({ ...p })),
  admins: MOCK_ADMINS.map((a) => ({ ...a })),
  roleChanges: MOCK_ROLE_CHANGES.map((r) => ({ ...r })),
  aiSettings: { ...MOCK_AI_SETTINGS },
  // Store mutable v3a: deep-ish clone items supaya mutasi tidak bocor ke konstanta mock.
  dailyRequests: MOCK_DAILY_REQUESTS.map((d) => ({ ...d, items: d.items.map((it) => ({ ...it })) })),
  keywordNotes: MOCK_KEYWORD_NOTES.map((n) => ({ ...n })),
  // Store mutable v3b: A7 mengubah status permintaan akses (refetch melihat hasilnya).
  accessRequests: MOCK_ACCESS_REQUESTS.map((r) => ({ ...r })),
  // Store mutable v3b Fase B (A2): draft + movement picking ikut berubah saat konfirmasi,
  // sehingga refetch `/draft` melihat status terbaru. Orphan tetap disertakan (uji fail-closed).
  opnameDrafts: [...MOCK_OPNAME_DRAFTS, MOCK_OPNAME_ORPHAN].map((d) => ({ ...d, items: d.items.map((it) => ({ ...it })) })),
  syncDrafts: [...MOCK_SYNC_DRAFTS, MOCK_SYNC_ORPHAN].map((d) => ({ ...d, items: d.items.map((it) => ({ ...it })) })),
  // Store v5: gudang + opname gudang TERPISAH dari koleksi bersama (e2e COUNT rapuh).
  gudang: MOCK_GUDANG.map((g) => ({ ...g })),
  permintaanGudang: MOCK_PERMINTAAN_GUDANG.map((r) => ({ ...r, tujuan: r.tujuan.map((t: import("../types").TujuanEntri) => ({ ...t })), items: r.items.map((it: import("../types").PermintaanItem) => ({ ...it })) })),
  opnameGudang: MOCK_OPNAME_GUDANG.map((o) => ({ ...o, items: o.items.map((it) => ({ ...it })) })),
  seq: 100,
};

// ---------------- Helper guard paritas server v3a (§5.1/§6.5) ----------------

/** Item efektif selesai (B6): sudah datang ATAU qty_diminta 0 (fallback qty). */
function itemEfektifSelesai(item: DailyRequestItem): boolean {
  return item.status === "datang" || (item.qty_diminta ?? item.qty) === 0;
}

function dokumenMock(tanggal: string): DailyRequestDoc | null {
  const d = store.dailyRequests.find((x) => x.tanggal === tanggal);
  if (!d) return null;
  return normalisasiDokumen(d.tanggal, d as unknown as Record<string, unknown>, (v) =>
    typeof v === "string" ? v : null
  );
}

/** Cari item by kode+variasi+buffer (identitas T1). */
function idxItem(items: DailyRequestItem[], kunci: { kode_barang: string; variasi: string; buffer: boolean }): number {
  return items.findIndex(
    (it) =>
      it.kode_barang === kunci.kode_barang &&
      (it.variasi ?? "-") === (kunci.variasi ?? "-") &&
      (it.buffer === true) === (kunci.buffer === true)
  );
}

/** Guard aksi permintaan bersama: dokumen ada, bukan `selesai`, role staff. */
function guardAksiPermintaan(
  role: Role,
  tanggal: string
): { error: string } | { doc: DailyRequestDoc } {
  if (role !== "owner" && role !== "admin") return { error: "Akses ditolak. Hubungi owner." };
  const doc = dokumenMock(tanggal);
  if (!doc) return { error: "Permintaan tidak ditemukan." };
  if (doc.status === "selesai") return { error: "Permintaan sudah selesai." };
  return { doc };
}

/** Set updated_at/by + tulis balik ke store (bentuk kanonik). */
function tulisDokumen(doc: DailyRequestDoc) {
  const idx = store.dailyRequests.findIndex((x) => x.tanggal === doc.tanggal);
  const simpan = { ...doc, updated_at: new Date().toISOString(), updated_by: MOCK_SESSION.user.id };
  if (idx === -1) store.dailyRequests.push(simpan);
  else store.dailyRequests[idx] = simpan;
}

/**
 * Seam e2e: `?mock-401=1` membuat SEMUA tulis mock gagal dengan pesan sesi kedaluwarsa,
 * untuk menguji perilaku 401 mid-write (form dipertahankan, dialog tidak tutup) tanpa backend.
 * Hanya berlaku di mode mock (server tetap penegak di mode real).
 */
function mockSesiKedaluwarsa(aksi?: string): boolean {
  if (typeof window === "undefined") return false;
  const p = new URLSearchParams(window.location.search);
  // Seam global: semua tulis 401. Seam per-aksi: `?mock-401=approve-akses` (uji B6 terisolasi).
  const v = p.get("mock-401");
  if (v === "1") return true;
  return aksi !== undefined && v === aksi;
}

/** Jeda simulasi agar loading skeleton bisa diuji. Set 0 untuk instan. */
function delay(ms = 120): Promise<void> {
  const raw = process.env.NEXT_PUBLIC_MOCK_DELAY;
  const dur = raw === undefined ? ms : Number(raw);
  if (!dur || Number.isNaN(dur)) return Promise.resolve();
  return new Promise((r) => setTimeout(r, dur));
}

function produkByKode(kode: string) {
  return store.produk.find((p) => p.kode_barang === kode);
}

function stokByKode(kode: string) {
  return store.stock.find((s) => s.kode_barang === kode);
}

function adminById(id: string): AdminDoc | undefined {
  return store.admins.find((a) => a.telegram_user_id === String(id));
}

type GuardGagal = { ok: false; error: string };

// ---------------- v5: batas & helper master gudang / opname ----------------

/** Batas keras jumlah gudang (BR15, paritas lib/models/gudang.js:8). */
const MAKS_GUDANG = 50;
/** Batas item per opname (paritas validasiOpnameGudangV5.js). */
const MAKS_ITEM_OPNAME = 200;
/** Gudang kerja admin seed (900002) di mock; paritas `admins.gudang_id` produksi (BR7). */
const GUDANG_ADMIN_MOCK = "D12";
/** Status entri tujuan FINAL (paritas `STATUS_TUJUAN_FINAL`, permintaanGudang.js:31). */
const STATUS_TUJUAN_FINAL = ["diterima", "tidak_terima", "ditolak", "ditutup"];
/** Batas panjang catatan_alasan tutup-tujuan (paritas MAKS_ALASAN, permintaanGudang.js:28). */
const MAKS_ALASAN_TUJUAN = 200;

/** Paritas `namaDipakai` (lib/models/gudang.js:51-57): duplikat pada gudang AKTIF, case-insensitive. */
function namaGudangDipakai(nama: string, kecualiId: string | null = null): boolean {
  const target = String(nama || "").trim().toLowerCase();
  return store.gudang.some(
    (g) => g.aktif === true && String(g.nama || "").trim().toLowerCase() === target && String(g.gudang_id) !== String(kecualiId ?? "")
  );
}

/** Paritas `hitungReferensiGudang` (lib/models/gudang.js:139-151): admins.gudang_id + key stock.qty_per_gudang. */
function hitungReferensiGudangMock(gudangId: string): number {
  const id = String(gudangId);
  // Mock: satu admin seed memakai gudang kerja (GUDANG_ADMIN_MOCK). Jumlah referensi cukup
  // menggambarkan peringatan UI; yang penting non-nol saat masih dirujuk.
  const adminCount = id === GUDANG_ADMIN_MOCK ? 1 : 0;
  const stockCount = store.stock.filter((s) => {
    const map = bacaQtyPerGudangMock(s);
    return Object.prototype.hasOwnProperty.call(map, id);
  }).length;
  return adminCount + stockCount;
}

/** Paritas 
ormalisasiNama (lib/models/produk.js) — dipakai A5 mock. */
function normalisasiNama(nama: string): string {
  if (!nama) return "";
  return nama
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Paritas validator A5 (validasiTulisV3a.js) — mock TIDAK boleh lebih longgar dari route. */
function validasiTambahProdukMock(req: TambahProdukRequest):
  | { ok: true; kodeBarang: string; namaProduk: string; hpp: number | null; stokAwal: number }
  | { ok: false; error: string } {
  const kodeBarang = typeof req.kode_barang === "string" ? req.kode_barang.trim() : "";
  if (!kodeBarang) return { ok: false, error: "Kode barang wajib diisi." };
  if (kodeBarang.length > 60) return { ok: false, error: "Kode barang maksimal 60 karakter." };
  if (kodeBarang.includes("/") || /[\u0000-\u001f\u007f]/.test(kodeBarang) || kodeBarang === "." || kodeBarang === "..") {
    return { ok: false, error: "Kode barang tidak valid." };
  }
  const namaProduk = typeof req.nama_produk === "string" ? req.nama_produk.trim() : "";
  if (!namaProduk) return { ok: false, error: "Nama produk wajib diisi." };
  if (namaProduk.length > 120) return { ok: false, error: "Nama produk maksimal 120 karakter." };
  let hpp: number | null = null;
  if (req.hpp !== undefined && req.hpp !== null) {
    if (typeof req.hpp !== "number" || !Number.isInteger(req.hpp) || req.hpp < 0) {
      return { ok: false, error: "HPP harus bilangan bulat >= 0." };
    }
    hpp = req.hpp;
  }
  let stokAwal = 0;
  if (req.stok_awal !== undefined && req.stok_awal !== null) {
    if (typeof req.stok_awal !== "number" || !Number.isInteger(req.stok_awal) || req.stok_awal < 0) {
      return { ok: false, error: "Stok awal harus bilangan bulat >= 0." };
    }
    if (req.stok_awal > 1_000_000) return { ok: false, error: "Stok awal maksimal 1.000.000." };
    stokAwal = req.stok_awal;
  }
  return { ok: true, kodeBarang, namaProduk, hpp, stokAwal };
}

/** Paritas server: hanya owner. Pesan persis route (§2.3/§4.3/§5.3). */
function butuhOwner(role: Role, pesan: string): GuardGagal | null {
  return role === "owner" ? null : { ok: false, error: pesan };
}

/**
 * Guard paritas server updateRoleAdmin (lib/models/admins.js:79-92).
 * Urutan: target ada -> bukan diri sendiri -> role beda -> owner terakhir.
 */
function guardUbahRole(
  role: Role,
  oleh: string,
  targetUserId: string,
  roleBaru: Role
): GuardGagal | null {
  const bukanOwner = butuhOwner(role, "Hanya owner yang dapat mengubah role.");
  if (bukanOwner) return bukanOwner;
  const admin = adminById(targetUserId);
  if (!admin) return { ok: false, error: "User belum terdaftar sebagai admin." };
  if (String(targetUserId) === String(oleh)) {
    return { ok: false, error: "Tidak boleh mengubah role diri sendiri." };
  }
  const roleLama = admin.role ?? "guest";
  if (roleLama === roleBaru) return { ok: false, error: `Role user sudah ${roleBaru}.` };
  if (roleLama === "owner" && roleBaru !== "owner") {
    const jumlahOwner = store.admins.filter((a) => a.role === "owner").length;
    if (jumlahOwner <= 1) return { ok: false, error: "Owner terakhir tidak boleh diturunkan rolenya." };
  }
  return null;
}

/**
 * Guard paritas server alasanTolakHapus (validasiTulisV2.js:117-132) lewat
 * mock-paritas.js: diri sendiri -> tidak ada -> owner terakhir -> super-admin-env.
 */
function guardHapusAdmin(role: Role, oleh: string, targetUserId: string): GuardGagal | null {
  const bukanOwner = butuhOwner(role, "Hanya owner yang dapat menghapus admin.");
  if (bukanOwner) return bukanOwner;
  const admin = adminById(targetUserId);
  const jumlahOwner =
    admin?.role === "owner" ? store.admins.filter((a) => a.role === "owner").length : 0;
  const tolak = guardHapusMock({
    requesterId: oleh,
    targetId: targetUserId,
    targetAdmin: admin ?? null,
    jumlahOwner,
  });
  return tolak.ok ? null : { ok: false, error: tolak.error };
}

/**
 * Guard + efek A7 (paritas route v3b §5.2): owner-only, 404 bila tidak ada,
 * 409 bila status != pending (CAS), notifikasi_terkirim selalu true di mock.
 * Seam 401: ?mock-401=approve-akses / ?mock-401=tolak-akses / ?mock-401=1.
 */
async function ubahStatusAksesMock(
  role: Role,
  status: "approved" | "rejected",
  req: PutusAksesRequest
): Promise<PutusAksesResponse> {
  const aksi = status === "approved" ? "approve-akses" : "tolak-akses";
  await delay(300);
  if (mockSesiKedaluwarsa(aksi)) return { ok: false, error: SESI_KEDALUWARSA };
  if (role !== "owner") {
    return { ok: false, error: "Hanya owner yang dapat memproses permintaan akses." };
  }
  const target = String(req.target_user_id);
  const r = store.accessRequests.find((x) => x.telegram_user_id === target);
  if (!r) return { ok: false, error: "Permintaan akses tidak ditemukan." };
  if (r.status !== "pending") return { ok: false, error: "Request ini sudah diproses sebelumnya." };
  r.status = status;
  r.resolved_by = MOCK_SESSION.user.id;
  r.resolved_at = new Date().toISOString();
  r.rejected_until = status === "rejected" ? new Date(Date.now() + 3_600_000).toISOString() : null;
  // Mock TIDAK memanggil Telegram; notifikasi dianggap terkirim (paritas sukses).
  return { ok: true, target_user_id: target, status, notifikasi_terkirim: true };
}

/** Audit tiruan perubahan role (paritas catatPerubahanRole). */
function catatRoleChange(
  targetUserId: string,
  targetName: string | null,
  roleLama: string | null,
  roleBaru: string
) {
  store.roleChanges.unshift({
    id: `rc-mock-${store.seq++}`,
    target_user_id: targetUserId,
    target_name: targetName,
    old_role: roleLama,
    new_role: roleBaru,
    changed_by: MOCK_SESSION.user.id,
    created_at: new Date().toISOString(),
  });
}

/** Map qty per gudang (BR3). Dokumen lama tanpa map -> {ONLINE: stok_gudang_online}. */
function bacaQtyPerGudangMock(stok: { stok_gudang_online?: number | null; qty_per_gudang?: Record<string, number> } | undefined): Record<string, number> {
  if (!stok) return {};
  const map = stok.qty_per_gudang;
  if (map && typeof map === "object" && !Array.isArray(map)) return { ...map };
  return typeof stok.stok_gudang_online === "number" ? { ONLINE: stok.stok_gudang_online } : {};
}

function toRow(kode: string, filter?: { gudang_id?: string | null }): StockRow | null {
  const produk = produkByKode(kode);
  if (!produk) return null;
  const stok = stokByKode(kode);
  const qtyPerGudang = bacaQtyPerGudangMock(stok);
  const nilai = filter?.gudang_id
    ? (qtyPerGudang[filter.gudang_id] ?? null)
    : (stok?.stok_gudang_online ?? null);
  const reorder = stok?.reorder_point ?? null;
  return {
    kode_barang: kode,
    nama_accurate: produk.nama_accurate,
    hpp: produk.hpp,
    stok_gudang_online: nilai,
    qty_per_gudang: qtyPerGudang,
    is_online_product: produk.is_online_product === true,
    reorder_point: reorder,
    status: statusStok(nilai, reorder),
    kekurangan: kekuranganStok(nilai),
  };
}

// ---------------- A2 konfirmasi-draft (v3b Fase B) — paritas aksiDraft.js/draftOwner.js ----------------

/**
 * Paritas `draftOwner.ambilOwnerDraft`: sumber = `owner_user_id` ?? `created_by` ?? `requested_by`.
 * Nilai kosong/whitespace dianggap tak ada. `null` -> route/mock fail-closed (409).
 */
function ambilOwnerDraft(dokumen: {
  owner_user_id?: unknown;
  created_by?: unknown;
  requested_by?: unknown;
} | null): string | null {
  if (!dokumen) return null;
  for (const kandidat of [dokumen.owner_user_id, dokumen.created_by, dokumen.requested_by]) {
    if (kandidat !== null && kandidat !== undefined && String(kandidat).trim() !== "") {
      return String(kandidat);
    }
  }
  return null;
}

/** Semua movement (dari SEMUA status) milik batch = owner id, paritas `ambilBatchPicking`. */
function movementBatch(owner: string): MovementDoc[] {
  // Paritas `ambilBatchPicking` (aksiDraft.js:43-50): SEMUA movement pemilik itu, dari sumber
  // picking MAUPUN histori, supaya batch setengah jadi (E-3) benar-benar terdeteksi.
  return [...store.movements, ...store.pickingMovements].filter((m) => ambilOwnerDraft(m) === owner);
}

/** Batch picking pending yang ditampilkan UI: `pending_confirmation` + `action_type` non-null. */
function batchPickingPending(): PickingBatchDoc[] {
  // I-2: paritas PRODUKSI — `real.ts` membaca SELURUH `stock_movements`, jadi movement pending
  // dari jalur lain (mis. `mv-008` `manual_chat`) ikut masuk batch pemiliknya. Mock harus sama,
  // kalau tidak ringkasan batch di e2e tidak mewakili produksi.
  const pending = [...store.movements, ...store.pickingMovements].filter(
    (m) => m.status === "pending_confirmation" && m.action_type != null
  );
  const perOwner = new Map<string, MovementDoc[]>();
  for (const m of pending) {
    const kunci = ambilOwnerDraft(m) ?? "";
    const daftar = perOwner.get(kunci);
    if (daftar) daftar.push(m);
    else perOwner.set(kunci, [m]);
  }
  const batches: PickingBatchDoc[] = [];
  for (const [batchId, daftar] of perOwner) {
    const siap = daftar.filter((m) => m.kode_barang).length;
    batches.push({
      batch_id: batchId,
      owner_user_id: batchId === "" ? null : batchId,
      movements: daftar,
      siap,
      dilewati: daftar.length - siap,
        // E-3: dihitung dari SELURUH movement pemilik itu (paritas `ambilBatchPicking`
        // `aksiDraft.js:43-50` yang membaca semua status), bukan dari daftar pending -> kalau
        // tidak, `sebagian` selalu false dan batch setengah jadi lolos ke UI.
        sebagian: movementBatch(batchId).some((m) => m.status !== "pending_confirmation"),
      });
  }
  return batches;
}

/** Paritas `statusBatchPicking`: "kosong" | "siap" | "sebagian" | "sudah". */
function statusBatchPicking(movements: MovementDoc[]): "kosong" | "siap" | "sebagian" | "sudah" {
  if (movements.length === 0) return "kosong";
  const pending = movements.filter((m) => m.status === "pending_confirmation").length;
  if (pending === movements.length) return "siap";
  if (pending === 0) return "sudah";
  return "sebagian";
}

// ---------------- v5.1: paritas `lib/models/permintaanGudang.js` ----------------

/**
 * Paritas `hitungStatusDokumen` model (v5.1, P6): turunan dari `status_kirim` + `status` entri.
 * `selesai` TIDAK pernah jadi hasil turunan - hanya aksi eksplisit `selesaiPermintaanGudang`.
 */
function hitungStatusDokumenMock(tujuan: import("../types").TujuanEntri[]): import("../types").PermintaanStatus {
  const daftar = Array.isArray(tujuan) ? tujuan : [];
  if (daftar.length === 0) return "menunggu";
  if (daftar.every((t) => t && t.status_kirim === "menunggu")) return "menunggu";
  if (daftar.some((t) => !t || t.status_kirim === "menunggu")) return "disetujui";
  const semuaDikirim = daftar.every((t) => t.status_kirim === "dikirim");
  if (semuaDikirim) {
    if (daftar.some((t) => t.status === "ditolak")) return "ditolak";
    return "dikirim";
  }
  return "disetujui";
}

/** Paritas `_pesanStatusTerminal`: 409 status dokumen terminal (tabel F5.2). */
function pesanStatusTerminalMock(status: string): string | null {
  if (status === "ditolak") return "Permintaan sudah ditolak.";
  if (status === "dibatalkan") return "Permintaan sudah dibatalkan.";
  if (status === "selesai") return "Permintaan sudah selesai.";
  return null;
}

/** Paritas `_assertPenerimaAtauOwner`: penerima tujuan itu ATAU owner. */
function guardPenerimaAtauOwnerMock(entri: import("../types").TujuanEntri): GuardGagal | null {
  const uid = MOCK_SESSION.user.id;
  if (entri.user_penerima_id) {
    return String(uid) === String(entri.user_penerima_id)
      ? null
      : { ok: false, error: "Hanya penerima tujuan ini yang dapat menyetujui." };
  }
  // Penerima null -> owner fallback (Q2).
  return adminById(uid)?.role === "owner"
    ? null
    : { ok: false, error: "Hanya penerima tujuan ini yang dapat menyetujui." };
}

/** Paritas `_assertPembuatAtauOwner` (Q4): pembuat permintaan ATAU owner. */
function guardPembuatAtauOwnerMock(dok: { created_by?: string | null }): GuardGagal | null {
  const uid = String(MOCK_SESSION.user.id);
  if (uid && dok.created_by && uid === String(dok.created_by)) return null;
  if (adminById(uid)?.role === "owner") return null;
  return { ok: false, error: "Hanya pembuat permintaan yang dapat mengonfirmasi." };
}

/** Entri tujuan ke-k; indeks di luar array -> null (paritas `cariTujuan`). */
function cariTujuanMock(
  dok: PermintaanGudangDoc,
  indeks: number
): { k: number; entri: import("../types").TujuanEntri } | null {
  if (!Number.isInteger(indeks) || indeks < 0 || indeks >= dok.tujuan.length) return null;
  return { k: indeks, entri: dok.tujuan[indeks] };
}

/** Items efektif entri tujuan; fallback items dokumen (paritas `itemsEfektif`). */
function itemsTujuanMock(dok: PermintaanGudangDoc, entri: import("../types").TujuanEntri): import("../types").PermintaanItem[] {
  if (Array.isArray(entri.items) && entri.items.length > 0) return entri.items;
  return Array.isArray(dok.items) ? dok.items : [];
}

/** Tambah qty satu gudang pada stok mock (paritas `payloadQtyGudang`). */
function tambahQtyGudangMock(kode: string, gudangId: string, delta: number): void {
  const st = stokByKode(kode);
  if (!st) return;
  const map = bacaQtyPerGudangMock(st);
  map[gudangId] = (map[gudangId] ?? 0) + delta;
  st.qty_per_gudang = map;
  // BR3: key "ONLINE" adalah cerminan stok_gudang_online (satu operasi).
  if (gudangId === "ONLINE") st.stok_gudang_online = map[gudangId];
  st.last_updated = new Date().toISOString();
  st.last_updated_by = MOCK_SESSION.user.id;
}

/** qty satu gudang pada stok mock (0 bila tak terdaftar). */
function qtyGudangMock(kode: string, gudangId: string): number {
  return bacaQtyPerGudangMock(stokByKode(kode))[gudangId] ?? 0;
}

/** Paritas `_pesanTujuanBukanMenunggu`: pesan 409 status ENTRI tujuan yang bukan `menunggu`. */
function pesanTujuanBukanMenungguMock(status: string): string | null {
  if (status === "diterima") return "Tujuan ini sudah diterima.";
  if (status === "tidak_terima") return "Tujuan ini sudah tidak diterima.";
  if (status === "ditolak") return "Tujuan ini sudah ditolak.";
  if (status === "ditutup") return "Tujuan ini sudah ditutup.";
  return status === "menunggu" ? null : "Tujuan ini sudah diproses.";
}

/**
 * Inti setujui/tolak tujuan (paritas `_ubahStatusKirimTujuan`): CAS `status_kirim` `menunggu`,
 * gate penerima/owner, recompute status dokumen.
 */
async function ubahStatusKirimTujuanMock(
  req: import("../types").AksiTujuanRequest,
  aksi: "disetujui" | "ditolak"
): Promise<import("../types").PermintaanGudangResponse> {
  await delay(300);
  const dok = store.permintaanGudang.find((r) => r.id === String(req.id));
  if (!dok) return { ok: false, error: "Permintaan tidak ditemukan." };
  const terminal = pesanStatusTerminalMock(dok.status);
  if (terminal) return { ok: false, error: terminal };
  const cari = cariTujuanMock(dok, req.tujuan_index);
  if (!cari) return { ok: false, error: "Tujuan tidak ditemukan." };
  if (cari.entri.status_kirim !== "menunggu") return { ok: false, error: "Tujuan ini sudah diproses." };
  const tolak = guardPenerimaAtauOwnerMock(cari.entri);
  if (tolak) return tolak;

  const sekarang = new Date().toISOString();
  if (aksi === "disetujui") {
    cari.entri.status_kirim = "disetujui";
    cari.entri.disetujui_at = sekarang;
    cari.entri.disetujui_oleh = MOCK_SESSION.user.id;
  } else {
    cari.entri.status = "ditolak";
    cari.entri.ditolak_at = sekarang;
    cari.entri.ditolak_oleh = MOCK_SESSION.user.id;
  }
  dok.status = hitungStatusDokumenMock(dok.tujuan);
  dok.updated_at = sekarang;
  dok.riwayat_status.push({
    status: aksi === "disetujui" ? "disetujui" : "ditolak_tujuan",
    oleh: MOCK_SESSION.user.id,
    at: sekarang,
  });
  return responsPermintaanMock(dok);
}

/** Bentuk respons sukses dokumen permintaan (paritas hasil model). */
function responsPermintaanMock(dok: PermintaanGudangDoc): import("../types").PermintaanGudangResponse {
  const tujuan = dok.tujuan.map((t) => ({ ...t, items: (t.items ?? []).map((it) => ({ ...it })) }));
  return { ok: true, permintaan: { ...dok, tujuan }, status: dok.status, tujuan };
}

export function makeMockDataSource(getRole: () => Role): DataSource {
  return {
    async getSession() {
      await delay(0);
      const role = getRole();
      // Q3: status super admin diri sendiri. Paritas auth route lewat mock-paritas.js
      // (owner ATAU id di daftar env mock).
      return { ...MOCK_SESSION, role, superAdmin: superAdminMock(role) };
    },

    async getRingkasan(): Promise<RingkasanData> {
      await delay();
      // B2: tetap hanya produk online (paritas real.ts getRingkasan).
      const rows = store.produk.filter((p) => p.is_online_product)
        .map((p) => toRow(p.kode_barang))
        .filter((r): r is StockRow => r !== null);
      const role = getRole();
      const staff = role === "owner" || role === "admin";
      const draftPending = staff
        ? store.opnameDrafts.filter((d) => d.status === "pending_confirmation").length +
          store.syncDrafts.filter((d) => d.status === "pending_confirmation").length +
          batchPickingPending().length
        : null;
      const hariIni = MOCK_DAILY_REQUESTS.find((d) => d.tanggal === idTanggalHariIni());
      return {
        totalProdukOnline: rows.length,
        itemMenipis: rows.filter((r) => r.status === "menipis").length,
        itemMinus: rows.filter((r) => r.status === "minus").length,
        draftPending,
        permintaanHariIni: staff ? hariIni?.items.length ?? 0 : null,
      };
    },

    async listStock(filter?: StockFilter): Promise<StockRow[]> {
      await delay();
      // Bangun SEMUA baris dulu (toRow tidak lagi memfilter online), lalu terapkan
      // filterStok.terapkanFilter - SATU sumber kebenaran dengan real.ts.
      const baris = store.produk
        .map((p) => toRow(p.kode_barang, { gudang_id: filter?.gudang_id ?? null }))
        .filter((r): r is StockRow => r !== null);
      return filterStok.terapkanFilter(baris as unknown as Record<string, unknown>[], filter as Record<string, unknown>) as unknown as StockRow[];
    },

    async getProduk(kode: string): Promise<ProdukDetail | null> {
      await delay();
      const produk = produkByKode(kode);
      if (!produk) return null;
      const stok = stokByKode(kode);
      return {
        produk,
        stok: stok
          ? {
              kode_barang: kode,
              stok_gudang_online: stok.stok_gudang_online,
              reorder_point: stok.reorder_point,
            }
          : null,
      };
    },

    async listMovements(filter: MovementFilter = {}) {
      await delay();
      // Histori = 12 movement lama saja (seed picking A2 tidak muncul di H1/H4; kontrak e2e).
      let rows = store.movements.slice();
      if (filter.kode_barang) rows = rows.filter((m) => m.kode_barang === filter.kode_barang);
      if (filter.type) rows = rows.filter((m) => m.type === filter.type);
      if (filter.status) rows = rows.filter((m) => m.status === filter.status);
      if (filter.created_by) rows = rows.filter((m) => m.created_by === filter.created_by);
      if (filter.dari) {
        const batas = new Date(filter.dari).getTime();
        rows = rows.filter((m) => new Date(m.created_at).getTime() >= batas);
      }
      if (filter.sampai) {
        const batas = new Date(filter.sampai).getTime();
        rows = rows.filter((m) => new Date(m.created_at).getTime() <= batas);
      }
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      if (filter.limit) rows = rows.slice(0, filter.limit);
      return rows;
    },

    async listOpnameDrafts(): Promise<OpnameDraftDoc[]> {
      await delay();
      // Baca STORE (bukan konstanta) supaya konfirmasi mengubah state dan refetch melihatnya.
      return store.opnameDrafts
        .filter((d) => d.status === "pending_confirmation")
        .map((d) => ({ ...d, owner_user_id: d.owner_user_id ?? null }));
    },

    async listSyncDrafts(): Promise<SyncStokDraftDoc[]> {
      await delay();
      return store.syncDrafts
        .filter((d) => d.status === "pending_confirmation")
        .map((d) => ({ ...d, owner_user_id: d.owner_user_id ?? null }));
    },

    async listPickingDrafts(): Promise<PickingBatchDoc[]> {
      await delay();
      return batchPickingPending();
    },

    /**
     * A2 `konfirmasi-draft` — PARITAS penuh `app/api/admin/route.ts:361-482` +
     * `lib/dashboard/aksiDraft.js` + `draftOwner.js`. Pesan error disalin literal.
     * Guard `draft_kirim_guard` (TTL 10s) sengaja tidak dijalankan di mock (state UI-only);
     * mock TIDAK boleh lebih longgar — semua guard otorisasi/status tetap dievaluasi.
     */
    async konfirmasiDraft(req: KonfirmasiDraftRequest): Promise<KonfirmasiDraftResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa("konfirmasi-draft")) return { ok: false, error: SESI_KEDALUWARSA };

      // --- Validasi body (paritas validasiKonfirmasiDraft, validasiTulisV3a.js) ---
      const jenis = req?.jenis;
      if (jenis !== "opname" && jenis !== "picking" && jenis !== "sync") {
        return { ok: false, error: "Jenis draft tidak dikenal." };
      }
      const aksiDraft = req?.aksi_draft;
      if (aksiDraft !== "apply" && aksiDraft !== "batal") {
        return { ok: false, error: "Aksi draft tidak dikenal." };
      }
      const KONDISI_VALID = ["sheets_ketinggalan", "sheets_manual", "konflik", "produk_baru", "semua"];
      let kondisi: string | null = null;
      if (req.kondisi !== undefined && req.kondisi !== null) {
        if (jenis !== "sync") return { ok: false, error: "Kondisi hanya untuk draft sync." };
        if (typeof req.kondisi !== "string" || !KONDISI_VALID.includes(req.kondisi)) {
          return { ok: false, error: "Kondisi tidak dikenal." };
        }
        kondisi = req.kondisi;
      }
      if (jenis === "sync" && kondisi === null) kondisi = "semua";

      const batchId = jenis === "picking" ? (typeof req.batch_id === "string" ? req.batch_id.trim() : "") : "";
      if (jenis === "picking" && !batchId) return { ok: false, error: "Batch picking tidak ditemukan." };
      const draftId = jenis !== "picking" ? (typeof req.draft_id === "string" ? req.draft_id.trim() : "") : "";
      if (jenis !== "picking" && !draftId) return { ok: false, error: "Draft tidak ditemukan." };

      // --- Otorisasi role dulu (paritas route: guest 403 sebelum baca dokumen) ---
      const role = getRole();
      if (role !== "owner" && role !== "admin") {
        return { ok: false, error: "Akses ditolak. Hubungi owner." };
      }

      // --- Ambil sumber SERVER (draft/movement), owner dari dokumen (§7.3) ---
      let ownerUserId: string | null;
      let dokumen: OpnameDraftDoc | SyncStokDraftDoc | null = null;
      let movementsBatch: MovementDoc[] = [];
      if (jenis === "picking") {
        movementsBatch = movementBatch(batchId);
        if (movementsBatch.length === 0) return { ok: false, error: "Batch picking tidak ditemukan." };
        const status = statusBatchPicking(movementsBatch);
        if (status === "sebagian") {
          return { ok: false, error: "Batch picking ini diproses sebagian. Selesaikan lewat Telegram." };
        }
        if (status === "sudah") {
          return { ok: false, error: "Batch picking ini sudah diproses sebelumnya." };
        }
        ownerUserId = ambilOwnerDraft(movementsBatch[0]);
      } else {
        const koleksi = jenis === "opname" ? store.opnameDrafts : store.syncDrafts;
        dokumen = koleksi.find((d) => d.id === draftId) ?? null;
        if (!dokumen) return { ok: false, error: "Draft tidak ditemukan." };
        ownerUserId = ambilOwnerDraft(dokumen);
      }

      // --- Fail-closed §7.2: owner tak diketahui -> 409 TANPA kecuali (termasuk owner) ---
      if (!ownerUserId) {
        return { ok: false, error: "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram." };
      }
      // admin hanya draft sendiri; owner boleh semua.
      if (role === "admin" && ownerUserId !== String(MOCK_SESSION.user.id)) {
        return { ok: false, error: "Hanya owner atau pembuat draft yang dapat mengonfirmasi." };
      }

      // --- Lapis 1: status draft (opname/sync) + kondisi sync kelompok (E-5) ---
      if (jenis !== "picking" && dokumen && dokumen.status !== "pending_confirmation") {
        return { ok: false, error: "Draft ini sudah diproses sebelumnya." };
      }
      if (
        jenis === "sync" &&
        dokumen &&
        kondisi &&
        kondisi !== "semua" &&
        (dokumen as SyncStokDraftDoc).kondisi !== kondisi
      ) {
        return { ok: false, error: "Tidak ada draft kelompok itu yang masih pending." };
      }

      const uid = MOCK_SESSION.user.id;
      const sekarang = new Date().toISOString();

      // --- Batal: opname/sync tandai draft; picking tandai movement batch ---
      if (aksiDraft === "batal") {
        if (jenis === "picking") {
          for (const m of movementsBatch) m.status = "processed";
        } else if (dokumen) {
          dokumen.status = "dibatalkan";
        }
        return { ok: true, jenis, aksi_draft: "batal", dibatalkan: true };
      }

      // --- Apply ---
      if (jenis === "opname") {
        const d = dokumen as OpnameDraftDoc;
        // Paritas handleOpname: hanya item kategori cocok/selisih_wajar yang diaplikasikan;
        // item tanpa selisih ("cocok", selisih 0) tidak menulis movement.
        const bisaApply = d.items.filter(
          (i) => i.kategori === "cocok" || i.kategori === "selisih_wajar"
        );
        let diproses = 0;
        for (const item of bisaApply) {
          const selisih = (item.qty_fisik ?? 0) - (item.qty_sistem ?? 0);
          if (selisih === 0) continue;
          store.movements.unshift({
            id: `mv-mock-${store.seq++}`,
            kode_barang: String(item.kode_barang ?? ""),
            nama_terbaca: item.nama ?? null,
            variasi: "-",
            qty: selisih,
            type: "opname",
            action_type: "kurangi_stok",
            qty_sistem: item.qty_sistem ?? null,
            qty_fisik: item.qty_fisik ?? null,
            selisih,
            catatan: null,
            source: "manual_chat",
            status: "processed",
            created_at: sekarang,
            created_by: uid,
            created_by_username: MOCK_SESSION.user.username,
            created_by_name: MOCK_SESSION.user.name,
            requested_by: ownerUserId,
            requested_by_username: null,
            requested_by_name: null,
            confirmed_by: uid,
            resolved_by: null,
            penanda: null,
          });
          diproses += 1;
        }
        d.status = "processed";
        return { ok: true, jenis, aksi_draft: "apply", diproses };
      }

      if (jenis === "picking") {
        const bisaDiproses = movementsBatch.filter((m) => m.kode_barang);
        const dilewati = movementsBatch.filter((m) => !m.kode_barang);
        for (const m of bisaDiproses) {
          m.status = "processed";
          m.confirmed_by = uid;
        }
        return {
          ok: true,
          jenis,
          aksi_draft: "apply",
          diproses: bisaDiproses.length,
          dilewati: dilewati.length,
          batch_id: batchId,
        };
      }

      // sync: tandai kelompok terpilih processed; untuk "semua" tandai semua; sisakan kelompok lain.
      // I-1: server memproses draft MILIK PEMILIK yang sedang dipanggil saja (`sessions/{owner}`,
      // `syncStokDuaArah.js:358-379`). Mock tidak boleh menyapu lintas pemilik/orphan.
      const drafts = store.syncDrafts.filter(
        (d) => d.status === "pending_confirmation" && ambilOwnerDraft(d) === ownerUserId
      );
      const dipilih = kondisi === "semua" ? drafts : drafts.filter((d) => d.kondisi === kondisi);
      if (dipilih.length === 0) {
        return { ok: false, error: "Tidak ada draft kelompok itu yang masih pending." };
      }
      let jumlahItem = 0;
      for (const d of dipilih) {
        d.status = "processed";
        jumlahItem += d.items.length;
      }
      const sisa = drafts.length - dipilih.length;
      return { ok: true, jenis, aksi_draft: "apply", diproses: jumlahItem, sisa };
    },

    async listDailyRequests(): Promise<DailyRequestDoc[]> {
      await delay();
      // Paritas B3: jalur baca menormalisasi item (item lama -> field baru terisi).
      return store.dailyRequests.map((d) =>
        normalisasiDokumen(d.tanggal, d as unknown as Record<string, unknown>, (v) =>
          typeof v === "string" ? v : null
        )
      );
    },

    async listKeywordNotes(): Promise<KeywordNoteDoc[]> {
      await delay();
      const role = getRole();
      // Paritas rules `staff()`: owner+admin boleh baca; guest tidak.
      if (role !== "owner" && role !== "admin") throw new Error("Akses ditolak. Hubungi owner.");
      return store.keywordNotes
        .map((n) => ({ ...n }))
        .sort((a, b) => (b.last_used ?? "").localeCompare(a.last_used ?? ""));
    },

    // ---- Tulis v3a — guard = paritas server (PRD §5.1/§6.5). ----

    async sesuaikanQtyPermintaan(req: SesuaikanQtyRequest): Promise<SesuaikanQtyResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      if (req.tanggal !== idTanggalHariIni()) {
        return { ok: false, error: "Hanya permintaan hari ini yang bisa diubah." };
      }
      const g = guardAksiPermintaan(getRole(), req.tanggal);
      if ("error" in g) return { ok: false, error: g.error };
      const doc = g.doc;
      if (doc.items.length === 0) return { ok: false, error: "Permintaan belum berisi item." };
      if (!Array.isArray(req.qty) || req.qty.length === 0) {
        return { ok: false, error: "Daftar jumlah wajib diisi." };
      }

      const items = doc.items.map((it) => ({ ...it }));
      const perubahan: PerubahanQty[] = normalisasiPerubahan(doc.perubahan);
      for (const baris of req.qty) {
        if (!Number.isInteger(baris.qty) || baris.qty < 0 || baris.qty > 1_000_000) {
          return { ok: false, error: "Jumlah harus bilangan bulat >= 0 (maks 1.000.000)." };
        }
        const i = idxItem(items, baris);
        if (i === -1) return { ok: false, error: "Item tidak ditemukan di permintaan." };
        if (items[i].status === "datang") {
          return { ok: false, error: "Item yang sudah datang tidak bisa diubah." };
        }
        const qtyLama = items[i].qty ?? 0;
        items[i].qty = baris.qty;
        perubahan.push({
          key_item: `${items[i].kode_barang}::${items[i].variasi ?? "-"}::${items[i].buffer === true}`,
          qty_lama: qtyLama,
          qty_baru: baris.qty,
          oleh: MOCK_SESSION.user.id,
          at: new Date().toISOString(),
        });
      }
      const baru: DailyRequestDoc = { ...doc, items, perubahan: perubahan.slice(-50) };
      tulisDokumen(baru);
      const akhir = normalisasiPerubahan(baru.perubahan);
      return {
        ok: true,
        tanggal: baru.tanggal,
        items: baru.items,
        status: baru.status,
        perubahan_terakhir: akhir.length ? akhir[akhir.length - 1] : null,
      };
    },

    async kirimFormPermintaan(req: KirimFormRequest): Promise<KirimFormResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const g = guardAksiPermintaan(getRole(), req.tanggal);
      if ("error" in g) return { ok: false, error: g.error };
      const doc = g.doc;
      if (doc.items.length === 0) return { ok: false, error: "Permintaan belum berisi item." };
      if (doc.items.every(itemEfektifSelesai)) return { ok: false, error: "Semua item sudah datang." };

      // Idempotensi 30 detik (PRD §4.3): dokumen sudah diproses oleh uid sama baru-baru ini.
      const terakhirMs = doc.form_dibuat_at ? new Date(doc.form_dibuat_at).getTime() : 0;
      if (
        doc.status === "diproses" &&
        terakhirMs &&
        Date.now() - terakhirMs < 30_000 &&
        doc.form_dibuat_by === MOCK_SESSION.user.id
      ) {
        return { ok: true, tanggal: req.tanggal, status: "diproses", form_dibuat_at: doc.form_dibuat_at, dikirim_ulang: false };
      }

      // Snapshot B2: qty_diminta = qty untuk setiap item belum datang; gabung duplikat.
      const itemsFinal = gabungItemDuplikat(doc.items).map((it) =>
        it.status === "datang" ? it : { ...it, qty_diminta: it.qty ?? 0 }
      );
      const sekarang = new Date().toISOString();
      const baru: DailyRequestDoc = {
        ...doc,
        items: itemsFinal,
        status: "diproses",
        form_dibuat_at: sekarang,
        form_dibuat_by: MOCK_SESSION.user.id,
      };
      tulisDokumen(baru);
      return {
        ok: true,
        tanggal: req.tanggal,
        status: "diproses",
        form_dibuat_at: sekarang,
        dikirim_ulang: true,
        kirim_terkirim: 2,
        kirim_gagal: 0,
      };
    },

    async tandaiPermintaanDatang(req: TandaiDatangRequest): Promise<TandaiDatangResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      // B1: `datang` di dokumen `draft` -> 409 pesan persis.
      const dokumen0 = dokumenMock(req.tanggal);
      if (dokumen0?.status === "draft") {
        return { ok: false, error: "Kirim form dulu sebelum menandai barang datang." };
      }
      const g = guardAksiPermintaan(getRole(), req.tanggal);
      if ("error" in g) return { ok: false, error: g.error };
      const doc = g.doc;
      if (!Number.isInteger(req.item.qty_datang) || req.item.qty_datang < 0 || req.item.qty_datang > 1_000_000) {
        return { ok: false, error: "Jumlah datang harus bilangan bulat >= 0 (maks 1.000.000)." };
      }
      const items = doc.items.map((it) => ({ ...it }));
      const i = idxItem(items, req.item);
      if (i === -1) return { ok: false, error: "Item tidak ditemukan di permintaan." };
      if (items[i].status === "datang") return { ok: false, error: "Item ini sudah ditandai datang." };

      const sekarang = new Date().toISOString();
      items[i] = {
        ...items[i],
        status: "datang",
        qty_datang: req.item.qty_datang,
        datang_at: sekarang,
        datang_by: MOCK_SESSION.user.id,
      };
      const selesaiOtomatis = items.every(itemEfektifSelesai);
      const baru: DailyRequestDoc = {
        ...doc,
        items,
        status: selesaiOtomatis ? "selesai" : doc.status,
        selesai_at: selesaiOtomatis ? sekarang : doc.selesai_at,
        selesai_by: selesaiOtomatis ? MOCK_SESSION.user.id : doc.selesai_by,
      };
      tulisDokumen(baru);
      return {
        ok: true,
        tanggal: req.tanggal,
        status: baru.status,
        selesai_otomatis: selesaiOtomatis,
        items: baru.items,
      };
    },

    async selesaikanPermintaan(req: SelesaikanRequest): Promise<SelesaikanResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const role = getRole();
      if (role !== "owner" && role !== "admin") {
        return { ok: false, error: "Akses ditolak. Hubungi owner." };
      }
      const dokumen0 = dokumenMock(req.tanggal);
      if (!dokumen0) return { ok: false, error: "Permintaan tidak ditemukan." };
      if (dokumen0.status === "draft") {
        return { ok: false, error: "Kirim form dulu sebelum menyelesaikan permintaan." };
      }
      if (dokumen0.status === "selesai") return { ok: false, error: "Permintaan sudah selesai." };
      const adaDatang = dokumen0.items.some((it) => it.status === "datang");
      const semuaTidakDiminta =
        dokumen0.items.length > 0 && dokumen0.items.every((it) => (it.qty_diminta ?? it.qty) === 0);
      if (!adaDatang && !semuaTidakDiminta) return { ok: false, error: "Belum ada item yang datang." };

      const sekarang = new Date().toISOString();
      const baru: DailyRequestDoc = {
        ...dokumen0,
        status: "selesai",
        selesai_at: sekarang,
        selesai_by: MOCK_SESSION.user.id,
      };
      tulisDokumen(baru);
      return { ok: true, tanggal: req.tanggal, status: "selesai", selesai_at: sekarang };
    },

    async konfirmasiKeywordNote(req: KonfirmasiKeywordRequest): Promise<KonfirmasiKeywordResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      // Paritas route: owner only, pesan persis §6.5.
      if (getRole() !== "owner") return { ok: false, error: "Hanya owner yang dapat mengubah penanda." };
      const VALID: InterpretasiKeyword[] = ["STOK", "MINTA", "MINTA_SISA"];
      if (!VALID.includes(req.interpreted_as)) return { ok: false, error: "Interpretasi tidak dikenal." };
      const note = store.keywordNotes.find((n) => n.id === req.id);
      if (!note) return { ok: false, error: "Penanda tidak ditemukan." };
      note.interpreted_as = req.interpreted_as;
      note.confidence = "confirmed";
      note.last_used = new Date().toISOString();
      note.confirmed_by = MOCK_SESSION.user.id;
      note.confirmed_at = new Date().toISOString();
      return { ok: true, note: { ...note } };
    },

    // ---- Tulis v3b Fase A (A7 + A5). Guard = paritas server (PRD v3b §5.2/§5.3). ----

    async setujuiAkses(req: PutusAksesRequest): Promise<PutusAksesResponse> {
      return ubahStatusAksesMock(getRole(), "approved", req);
    },

    async tolakAkses(req: PutusAksesRequest): Promise<PutusAksesResponse> {
      return ubahStatusAksesMock(getRole(), "rejected", req);
    },

    async tambahProduk(req: TambahProdukRequest): Promise<TambahProdukResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa("tambah-produk")) return { ok: false, error: SESI_KEDALUWARSA };
      const role = getRole();
      // Paritas route A5: owner + admin; guest -> 403. Validasi SEBELUM role? Server
      // validasi payload dulu (dispatcher), lalu cek role -> tirukan urutannya.
      const valid = validasiTambahProdukMock(req);
      if (!valid.ok) return { ok: false, error: valid.error };
      if (role !== "owner" && role !== "admin") {
        return { ok: false, error: "Akses ditolak. Hubungi owner." };
      }
      // B5 paritas: create-only. Produk ATAU stok orphan sama-sama menolak (409).
      if (produkByKode(valid.kodeBarang) || stokByKode(valid.kodeBarang)) {
        return { ok: false, error: `kode "${valid.kodeBarang}" sudah dipakai produk lain` };
      }
      const sekarang = new Date().toISOString();
      const produk: ProdukDoc = {
        kode_barang: valid.kodeBarang,
        nama_accurate: valid.namaProduk,
        nama_accurate_normalized: normalisasiNama(valid.namaProduk),
        hpp: valid.hpp,
        hpp_baru: null,
        is_online_product: true,
        variants: [],
        search_keywords: [],
        updated_at: sekarang,
      };
      store.produk.push(produk);
      store.stock.push({
        kode_barang: valid.kodeBarang,
        stok_gudang_online: valid.stokAwal,
        reorder_point: null,
        last_updated: sekarang,
        last_updated_by: MOCK_SESSION.user.id,
        last_synced_at: null,
        last_synced_value: null,
      });
      return {
        ok: true,
        produk: {
          kode_barang: produk.kode_barang,
          nama_accurate: produk.nama_accurate,
          hpp: produk.hpp,
          is_online_product: true,
        },
        stok_awal: valid.stokAwal,
      };
    },

    async listAdmins() {
      await delay();
      return store.admins.map((a) => ({ ...a }));
    },

    async listRoleChanges() {
      await delay();
      return store.roleChanges.map((r) => ({ ...r }));
    },

    async listAccessRequests() {
      await delay();
      return store.accessRequests.map((r) => ({ ...r }));
    },

    async getAiSettings(): Promise<AiSettingsDoc> {
      await delay();
      return { ...store.aiSettings };
    },

    async mutasiStok(req: MutasiRequest): Promise<MutasiResponse> {
      await delay(300);
      const produk = produkByKode(req.kode_barang);
      if (!produk || !produk.is_online_product) {
        return { ok: false, error: "Produk tidak ditemukan." };
      }
      const role = getRole();
      if (role !== "owner" && role !== "admin") {
        return { ok: false, error: "Akses ditolak. Hubungi owner." };
      }
      // Validasi per mode (PRD 13.1 / E6).
      if (req.mode !== "timpa" && (!Number.isInteger(req.qty) || req.qty < 1)) {
        return { ok: false, error: "Jumlah harus bilangan bulat >= 1." };
      }
      if (req.mode === "timpa" && (!Number.isInteger(req.qty) || req.qty < 0)) {
        return { ok: false, error: "Jumlah fisik harus bilangan bulat >= 0." };
      }

      let stok = stokByKode(req.kode_barang);
      if (!stok) {
        stok = {
          kode_barang: req.kode_barang,
          stok_gudang_online: 0,
          reorder_point: null,
          last_updated: null,
          last_updated_by: null,
          last_synced_at: null,
          last_synced_value: null,
        };
        store.stock.push(stok);
      }
      const sebelum = stok.stok_gudang_online;
      let baru: number;
      if (req.mode === "tambah") baru = sebelum + Math.abs(req.qty);
      else if (req.mode === "kurangi") baru = sebelum - Math.abs(req.qty);
      else baru = req.qty;

      stok.stok_gudang_online = baru;
      stok.last_updated = new Date().toISOString();
      stok.last_updated_by = MOCK_SESSION.user.id;

      const id = `mv-mock-${store.seq++}`;
      const isTimpa = req.mode === "timpa";
      const movement: MovementDoc = {
        id,
        kode_barang: req.kode_barang,
        nama_terbaca: produk.nama_accurate,
        variasi: "-",
        qty: isTimpa ? baru - sebelum : req.mode === "kurangi" ? -Math.abs(req.qty) : Math.abs(req.qty),
        type: isTimpa ? "opname" : "koreksi_manual",
        action_type: isTimpa
          ? "kurangi_stok"
          : req.mode === "tambah"
            ? "tambah_stok"
            : "kurangi_stok",
        qty_sistem: isTimpa ? sebelum : null,
        qty_fisik: isTimpa ? baru : null,
        selisih: isTimpa ? baru - sebelum : null,
        catatan: req.catatan?.trim() ? req.catatan.trim() : null,
        source: "web_dashboard",
        status: "processed",
        created_at: new Date().toISOString(),
        created_by: MOCK_SESSION.user.id,
        created_by_username: MOCK_SESSION.user.username,
        created_by_name: MOCK_SESSION.user.name,
        requested_by: MOCK_SESSION.user.id,
        requested_by_username: MOCK_SESSION.user.username,
        requested_by_name: MOCK_SESSION.user.name,
        confirmed_by: MOCK_SESSION.user.id,
        resolved_by: null,
        penanda: null,
      };
      store.movements.unshift(movement);
      return { ok: true, stok_baru: baru, movement_id: id };
    },

    async ubahProviderAi(provider: string) {
      await delay(300);
      if (getRole() !== "owner") {
        return { ok: false as const, error: "Hanya owner yang dapat mengubah pengaturan." };
      }
      if (!adalahProviderAi(provider)) {
        return { ok: false as const, error: "Provider AI tidak dikenal." };
      }
      store.aiSettings = {
        textProvider: provider,
        updatedAt: new Date().toISOString(),
        updatedBy: MOCK_SESSION.user.id,
      };
      return { ok: true as const };
    },

    // ---- Tulis v2 (F1-F4). Guard = paritas server (PRD §11, §9). ----
    async ubahHpp(req: UbahHppRequest): Promise<UbahHppResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      // Paritas route (hpp/route.ts:54-59): validasi payload SEBELUM cek role/produk.
      const valid = validasiHppMock(req);
      if (!valid.ok) return { ok: false, error: valid.error };
      const bukanOwner = butuhOwner(getRole(), "Hanya owner yang dapat mengubah HPP.");
      if (bukanOwner) return bukanOwner;
      const produk = produkByKode(valid.kodeBarang);
      if (!produk) return { ok: false, error: "Produk tidak ditemukan." };
      const { adaHpp, hpp, adaHppBaru, hppBaru } = valid;
      // Idempoten: nilai sama -> 200 tanpa tulis & tanpa audit (BR-F1-4).
      if (
        (!adaHpp || produk.hpp === hpp) &&
        (!adaHppBaru || (produk.hpp_baru ?? null) === (hppBaru ?? null))
      ) {
        return { ok: true, produk: { ...produk } };
      }
      if (adaHpp) produk.hpp = hpp ?? null;
      if (adaHppBaru) produk.hpp_baru = hppBaru ?? null;
      produk.updated_at = new Date().toISOString();
      return { ok: true, produk: { ...produk } };
    },

    async ubahReorderPoint(req: UbahReorderPointRequest): Promise<UbahReorderPointResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const role = getRole();
      if (role !== "owner" && role !== "admin") {
        return { ok: false, error: "Akses ditolak. Hubungi owner." };
      }
      const stok = stokByKode(req.kode_barang);
      if (!stok) return { ok: false, error: "Data stok produk belum ada." };
      // Idempoten: nilai sama -> 200 tanpa notifikasi (hindari spam).
      if ((stok.reorder_point ?? null) === (req.reorder_point ?? null)) {
        return { ok: true, reorder_point: req.reorder_point, notifikasi_terkirim: false };
      }
      stok.reorder_point = req.reorder_point;
      stok.last_updated = new Date().toISOString();
      stok.last_updated_by = MOCK_SESSION.user.id;
      const saldo = stok.stok_gudang_online;
      const notifikasi =
        req.reorder_point != null && saldo != null && saldo <= req.reorder_point;
      return { ok: true, reorder_point: req.reorder_point, notifikasi_terkirim: notifikasi };
    },

    async ubahRoleAdmin(req: UbahRoleAdminRequest): Promise<UbahRoleAdminResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const oleh = MOCK_SESSION.user.id;
      const tolak = guardUbahRole(getRole(), oleh, req.target_user_id, req.role_baru);
      if (tolak) return tolak;
      const admin = adminById(req.target_user_id)!;
      const roleLama = admin.role ?? "guest";
      admin.role = req.role_baru;
      admin.role_updated_at = new Date().toISOString();
      admin.role_updated_by = oleh;
      catatRoleChange(admin.telegram_user_id, admin.name, roleLama, req.role_baru);
      return {
        ok: true,
        target_user_id: admin.telegram_user_id,
        role_lama: roleLama,
        role_baru: req.role_baru,
      };
    },

    async tambahAdmin(req: TambahAdminRequest): Promise<TambahAdminResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const bukanOwner = butuhOwner(getRole(), "Hanya owner yang dapat menambah admin.");
      if (bukanOwner) return bukanOwner;
      const id = String(req.telegram_user_id);
      // Paritas 409: tambahAdmin server pakai set() tanpa merge -> cegah timpa.
      if (adminById(id)) return { ok: false, error: "User sudah terdaftar sebagai admin." };
      const role = req.role ?? "guest";
      const admin: AdminDoc = {
        telegram_user_id: id,
        name: req.name,
        telegram_username: req.telegram_username ?? null,
        role,
        added_at: new Date().toISOString(),
        approved_by: MOCK_SESSION.user.id,
      };
      store.admins.push(admin);
      catatRoleChange(id, req.name, null, role);
      return { ok: true, admin: { ...admin } };
    },

    async hapusAdmin(req: HapusAdminRequest): Promise<HapusAdminResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const oleh = MOCK_SESSION.user.id;
      const tolak = guardHapusAdmin(getRole(), oleh, req.telegram_user_id);
      if (tolak) return tolak;
      const idx = store.admins.findIndex(
        (a) => a.telegram_user_id === String(req.telegram_user_id)
      );
      const admin = store.admins[idx];
      store.admins.splice(idx, 1);
      // Audit pencabutan SETELAH hapus sukses (paritas N5).
      catatRoleChange(admin.telegram_user_id, admin.name, admin.role ?? "guest", "dihapus");
      return { ok: true, telegram_user_id: admin.telegram_user_id, nama: admin.name };
    },

    // ---- v5: master gudang (F1), set-qty gudang (F2), opname ber-approval (F7), toggle online (F8). ----
    // Guard = paritas server (pesan disalin dari route + model), mock TIDAK boleh lebih longgar.

    async listGudang(opts = {}): Promise<GudangDoc[]> {
      await delay();
      const semua = opts.semua === true;
      return store.gudang
        .filter((g) => semua || g.aktif === true)
        .map((g) => ({ ...g }))
        .sort((a, b) => {
          const ua = typeof a.urutan === "number" ? a.urutan : Number.MAX_SAFE_INTEGER;
          const ub = typeof b.urutan === "number" ? b.urutan : Number.MAX_SAFE_INTEGER;
          if (ua !== ub) return ua - ub;
          return String(a.nama || "").localeCompare(String(b.nama || ""), "id");
        });
    },

    async tambahGudang(req: TambahGudangRequest): Promise<TambahGudangResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      if (getRole() !== "owner") return { ok: false, error: "Hanya owner yang dapat mengelola gudang." };
      const nama = typeof req.nama === "string" ? req.nama.trim() : "";
      if (!nama) return { ok: false, error: "Nama gudang wajib diisi." };
      if (nama.length > 60) return { ok: false, error: "Nama gudang maksimal 60 karakter." };
      if (store.gudang.length >= MAKS_GUDANG) return { ok: false, error: "Maksimal 50 gudang." };
      if (namaGudangDipakai(nama)) return { ok: false, error: "Nama gudang sudah dipakai." };
      const urutan =
        store.gudang.reduce((maks, g) => Math.max(maks, typeof g.urutan === "number" ? g.urutan : -1), -1) + 1;
      const gudang: GudangDoc = {
        gudang_id: `gd-mock-${store.seq++}`,
        nama,
        aktif: true,
        urutan,
        created_at: new Date().toISOString(),
        created_by: MOCK_SESSION.user.id,
      };
      store.gudang.push(gudang);
      return { ok: true, gudang: { ...gudang } };
    },

    async ubahGudang(req: UbahGudangRequest): Promise<UbahGudangResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      if (getRole() !== "owner") return { ok: false, error: "Hanya owner yang dapat mengelola gudang." };
      const g = store.gudang.find((x) => x.gudang_id === String(req.gudang_id));
      if (!g) return { ok: false, error: "Gudang tidak ditemukan." };
      const aksi = req.aksi;
      if (aksi === "nonaktif") {
        g.aktif = false;
        g.nonaktif_at = new Date().toISOString();
        const peringatan = hitungReferensiGudangMock(g.gudang_id);
        return { ok: true, gudang: { ...g }, peringatan_referensi: peringatan };
      }
      if (aksi === "aktifkan") {
        g.aktif = true;
        g.updated_at = new Date().toISOString();
        return { ok: true, gudang: { ...g } };
      }
      const nama = typeof req.nama === "string" ? req.nama.trim() : "";
      if (!nama) return { ok: false, error: "Nama gudang wajib diisi." };
      if (nama.length > 60) return { ok: false, error: "Nama gudang maksimal 60 karakter." };
      if (namaGudangDipakai(nama, g.gudang_id)) return { ok: false, error: "Nama gudang sudah dipakai." };
      g.nama = nama;
      g.updated_at = new Date().toISOString();
      g.updated_by = MOCK_SESSION.user.id;
      return { ok: true, gudang: { ...g } };
    },

    async setQtyGudang(req: SetQtyGudangRequest): Promise<SetQtyGudangResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const role = getRole();
      if (role !== "owner" && role !== "admin") return { ok: false, error: "Akses ditolak. Hubungi owner." };
      if (!Number.isInteger(req.qty) || req.qty < 0) {
        return { ok: false, error: "Jumlah harus bilangan bulat >= 0." };
      }
      const gudang = store.gudang.find((g) => g.gudang_id === String(req.gudang_id));
      if (!gudang || !gudang.aktif) return { ok: false, error: "Gudang tidak dikenal." };
      // BR7: scope tulis admin (mock: gudang admin seed = "D12").
      if (role === "admin" && String(req.gudang_id) !== GUDANG_ADMIN_MOCK) {
        return { ok: false, error: "Anda hanya dapat mengubah stok gudang Anda." };
      }
      const stok = stokByKode(req.kode_barang);
      if (!stok) return { ok: false, error: "Stok produk tidak ditemukan." };
      const map = bacaQtyPerGudangMock(stok);
      map[String(req.gudang_id)] = req.qty;
      stok.qty_per_gudang = map;
      // BR3: key "ONLINE" adalah cerminan stok_gudang_online (satu operasi).
      if (String(req.gudang_id) === "ONLINE") stok.stok_gudang_online = req.qty;
      stok.last_updated = new Date().toISOString();
      stok.last_updated_by = MOCK_SESSION.user.id;
      return { ok: true, qty_per_gudang: { ...map } };
    },

    /**
     * v5.2 (D6) - mutasi stok antar gudang. Paritas PENUH `mutasiStokGudang` (model) +
     * guard route (guest, BR7 scope, gudang aktif). Pesan error disalin literal.
     */
    async mutasiStokGudang(req: MutasiStokGudangRequest): Promise<MutasiStokGudangResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const role = getRole();
      if (role !== "owner" && role !== "admin") {
        return { ok: false, error: "Akses ditolak. Hubungi owner." };
      }
      // BR7: admin hanya boleh memindah DARI gudangnya (keputusan D8).
      if (role === "admin" && req.dari_gudang_id !== GUDANG_ADMIN_MOCK) {
        return { ok: false, error: "Anda hanya dapat memindah dari gudang Anda." };
      }
      if (String(req.dari_gudang_id) === String(req.ke_gudang_id)) {
        return { ok: false, error: "Gudang asal dan tujuan tidak boleh sama." };
      }
      if (!Number.isInteger(req.qty) || req.qty < 1) {
        return { ok: false, error: "Jumlah harus bilangan bulat >= 1." };
      }
      const stok = stokByKode(req.kode_barang);
      if (!stok) return { ok: false, error: "Stok produk tidak ditemukan." };
      // P1: KEDUA gudang harus ada dan aktif.
      const dariAktif = store.gudang.some((g) => g.gudang_id === String(req.dari_gudang_id) && g.aktif);
      const keAktif = store.gudang.some((g) => g.gudang_id === String(req.ke_gudang_id) && g.aktif);
      if (!dariAktif || !keAktif) return { ok: false, error: "Gudang tidak dikenal." };

      const dari = String(req.dari_gudang_id);
      const ke = String(req.ke_gudang_id);
      const map = bacaQtyPerGudangMock(stok);
      if ((map[dari] ?? 0) < req.qty) {
        return { ok: false, error: "Stok gudang asal tidak cukup." };
      }
      map[dari] = (map[dari] ?? 0) - req.qty;
      map[ke] = (map[ke] ?? 0) + req.qty;
      stok.qty_per_gudang = map;
      // Paritas BR3: salah satu gudang ONLINE -> selaraskan stok_gudang_online.
      if (dari === "ONLINE" || ke === "ONLINE") stok.stok_gudang_online = map.ONLINE ?? 0;
      stok.last_updated = new Date().toISOString();
      stok.last_updated_by = MOCK_SESSION.user.id;
      return { ok: true, qty_per_gudang: { ...map } };
    },

    async toggleOnlineProduk(req: ToggleOnlineRequest): Promise<ToggleOnlineResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const role = getRole();
      if (role !== "owner" && role !== "admin") return { ok: false, error: "Akses ditolak. Hubungi owner." };
      if (typeof req.is_online !== "boolean") return { ok: false, error: "Status online harus boolean." };
      const produk = produkByKode(req.kode_barang);
      if (!produk) return { ok: false, error: "Produk tidak ditemukan." };
      produk.is_online_product = req.is_online;
      produk.updated_at = new Date().toISOString();
      return { ok: true };
    },

    async listOpnameGudang(opts = {}): Promise<OpnameGudangDoc[]> {
      await delay();
      const status = opts.status;
      return store.opnameGudang
        .filter((o) => !status || o.status === status)
        .map((o) => ({ ...o, items: o.items.map((it) => ({ ...it })) }))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },

    async buatOpnameGudang(req: BuatOpnameGudangRequest): Promise<BuatOpnameGudangResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const role = getRole();
      if (role !== "owner" && role !== "admin") return { ok: false, error: "Akses ditolak. Hubungi owner." };
      const gudangId = typeof req.gudang_id === "string" ? req.gudang_id.trim() : "";
      if (!gudangId) return { ok: false, error: "Gudang tidak dikenal." };
      const gudang = store.gudang.find((g) => g.gudang_id === gudangId);
      if (!gudang) return { ok: false, error: "Gudang tidak dikenal." };
      // BR7: admin hanya opname gudangnya; owner bebas.
      if (role === "admin" && gudangId !== GUDANG_ADMIN_MOCK) {
        return { ok: false, error: "Anda hanya dapat opname gudang Anda." };
      }
      if (!Array.isArray(req.items) || req.items.length === 0) {
        return { ok: false, error: "Opname belum berisi item." };
      }
      if (req.items.length > MAKS_ITEM_OPNAME) return { ok: false, error: "Maksimal 200 item." };
      const terlihat = new Set<string>();
      for (const it of req.items) {
        const kode = typeof it?.kode_barang === "string" ? it.kode_barang.trim() : "";
        if (!kode) return { ok: false, error: "Item tidak valid." };
        if (terlihat.has(kode)) return { ok: false, error: "Item duplikat dalam opname." };
        terlihat.add(kode);
        if (!Number.isInteger(it.qty_fisik) || it.qty_fisik < 0) {
          return { ok: false, error: "Jumlah fisik harus bilangan bulat >= 0." };
        }
        if (!stokByKode(kode)) return { ok: false, error: "Stok produk tidak ditemukan." };
      }

      // qty_sistem/selisih DIHITUNG di sini (paritas buatOpname model), bukan dari client.
      const items: OpnameGudangDoc["items"] = req.items.map((it) => {
        const kode = it.kode_barang.trim();
        const map = bacaQtyPerGudangMock(stokByKode(kode));
        const terdaftar = Object.prototype.hasOwnProperty.call(map, gudangId);
        const qtySistem = terdaftar ? map[gudangId] : null;
        const selisih = qtySistem === null ? 0 : it.qty_fisik - qtySistem;
        return { kode_barang: kode, qty_sistem: qtySistem, qty_fisik: it.qty_fisik, selisih, belum_terdaftar: !terdaftar };
      });
      const adaSelisih = items.some((i) => i.selisih !== 0);
      const status: OpnameGudangStatus = adaSelisih ? "menunggu_approval" : "disetujui";
      const sekarang = new Date().toISOString();
      const opname: OpnameGudangDoc = {
        id: `og-mock-${store.seq++}`,
        gudang_id: gudangId,
        items,
        status,
        created_by: MOCK_SESSION.user.id,
        created_at: sekarang,
      };
      if (status === "disetujui") {
        // BR6: semua selisih 0 -> qty langsung ditulis (hanya item belum_terdaftar:false).
        for (const it of items) {
          if (it.belum_terdaftar) continue;
          const stok = stokByKode(it.kode_barang);
          if (!stok) continue;
          const map = bacaQtyPerGudangMock(stok);
          map[gudangId] = it.qty_fisik;
          stok.qty_per_gudang = map;
          if (gudangId === "ONLINE") stok.stok_gudang_online = it.qty_fisik;
          stok.last_updated = sekarang;
          stok.last_updated_by = MOCK_SESSION.user.id;
        }
        opname.disetujui_at = sekarang;
      }
      store.opnameGudang.push(opname);
      return { ok: true, opname: { ...opname, items: opname.items.map((it) => ({ ...it })) }, status, langsung: status === "disetujui" };
    },

    async setujuiOpnameGudang(req: SetujuiOpnameGudangRequest): Promise<SetujuiOpnameGudangResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      if (getRole() !== "owner") return { ok: false, error: "Hanya owner yang dapat menyetujui opname." };
      const opname = store.opnameGudang.find((o) => o.id === String(req.id));
      if (!opname) return { ok: false, error: "Opname tidak ditemukan." };
      if (opname.status !== "menunggu_approval") return { ok: false, error: "Opname sudah diproses." };
      // CAS T9: qty_sistem tersimpan harus masih sama dengan nilai sistem sekarang.
      for (const it of opname.items) {
        if (it.belum_terdaftar) continue;
        const map = bacaQtyPerGudangMock(stokByKode(it.kode_barang));
        const kini = Object.prototype.hasOwnProperty.call(map, opname.gudang_id) ? map[opname.gudang_id] : null;
        if (kini !== it.qty_sistem) {
          return { ok: false, error: "Stok berubah sejak opname dibuat. Buat ulang." };
        }
      }
      const sekarang = new Date().toISOString();
      for (const it of opname.items) {
        if (it.belum_terdaftar) continue;
        const stok = stokByKode(it.kode_barang);
        if (!stok) continue;
        const map = bacaQtyPerGudangMock(stok);
        map[opname.gudang_id] = it.qty_fisik;
        stok.qty_per_gudang = map;
        if (opname.gudang_id === "ONLINE") stok.stok_gudang_online = it.qty_fisik;
        stok.last_updated = sekarang;
        stok.last_updated_by = MOCK_SESSION.user.id;
      }
      opname.status = "disetujui";
      opname.disetujui_oleh = MOCK_SESSION.user.id;
      opname.disetujui_at = sekarang;
      return { ok: true, opname: { ...opname, items: opname.items.map((it) => ({ ...it })) } };
    },

    async tolakOpnameGudang(req: SetujuiOpnameGudangRequest): Promise<SetujuiOpnameGudangResponse> {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      if (getRole() !== "owner") return { ok: false, error: "Hanya owner yang dapat menyetujui opname." };
      const opname = store.opnameGudang.find((o) => o.id === String(req.id));
      if (!opname) return { ok: false, error: "Opname tidak ditemukan." };
      if (opname.status !== "menunggu_approval") return { ok: false, error: "Opname sudah diproses." };
      opname.status = "ditolak";
      opname.ditolak_oleh = MOCK_SESSION.user.id;
      return { ok: true, opname: { ...opname, items: opname.items.map((it) => ({ ...it })) } };
    },

    // ---- v5 F5/F6: permintaan antar-gudang. Paritas aturan model server (status PER-TUJUAN). ----

    async listPermintaanGudang(filter = {}) {
      await delay(300);
      return store.permintaanGudang
        .filter((r) => {
          if (filter.status && r.status !== filter.status) return false;
          if (filter.dari_gudang_id && r.dari_gudang_id !== filter.dari_gudang_id) return false;
          if (filter.created_by && r.created_by !== filter.created_by) return false;
          if (filter.tujuan_id && !r.tujuan_ids.includes(filter.tujuan_id)) return false;
          return true;
        })
        .map((r) => ({ ...r, tujuan: r.tujuan.map((t) => ({ ...t })), items: r.items.map((it) => ({ ...it })) })) as PermintaanGudangDoc[];
    },

    async buatPermintaanGudang(req) {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      const role = getRole();
      if (role === "guest") return { ok: false, error: "Akses ditolak. Hubungi owner." };
      if (role === "admin" && MOCK_SESSION.gudangId && req.dari_gudang_id !== MOCK_SESSION.gudangId) {
        return { ok: false, error: "Anda hanya dapat meminta dari gudang Anda." };
      }
      const waktu = new Date().toISOString();
      // PARITAS _siapkanTujuan (model server): validasi sebelum menerima.
      let tujuanSiap: import("../types").TujuanEntri[] = [];
      try {
        tujuanSiap = req.tujuan.map((t): import("../types").TujuanEntri => {
        if (!t || t.tipe !== "gudang") throw new Error("Tujuan hanya boleh gudang.");
        const gid = String(t.id);
        if (gid === String(req.dari_gudang_id)) throw new Error("Gudang asal tidak boleh jadi tujuan.");
        const g = store.gudang.find((x) => x.gudang_id === gid && x.aktif);
        if (!g) throw new Error("Gudang tujuan tidak dikenal.");
        // Penerima harus dari gudang tujuan (Q3). null = owner fallback (Q2).
        let penerima = null;
        if (t.user_penerima_id) {
          penerima = store.admins.find((a) => String(a.telegram_user_id) === String(t.user_penerima_id)) ?? null;
          if (!penerima || String(penerima.gudang_id ?? "") !== gid) {
            throw new Error("Penerima harus dari gudang tujuan.");
          }
        }
        const itemsTujuan = t.items && t.items.length > 0 ? t.items : req.items;
        for (const it of itemsTujuan) {
          if (!it || typeof it.kode_barang !== "string" || !it.kode_barang.trim()) throw new Error("Item tidak valid.");
          if (typeof it.qty !== "number" || !Number.isInteger(it.qty) || it.qty < 1) {
            throw new Error("Jumlah item harus bilangan bulat >= 1.");
          }
          if (!store.stock.some((s) => s.kode_barang === it.kode_barang)) {
            throw new Error("Stok produk tidak ditemukan.");
          }
        }
        return {
          tipe: "gudang" as const,
          id: gid,
          nama: g?.nama ?? gid,
          jabatan: null,
          gudang_id_snapshot: gid,
          status: "menunggu" as const,
          status_kirim: "menunggu" as const,
          user_penerima_id: penerima ? String(penerima.telegram_user_id) : null,
          user_penerima_nama: penerima ? (penerima.name ?? String(penerima.telegram_user_id)) : null,
          items: itemsTujuan.map((it) => ({ ...it })),
          notifikasi_terkirim: null,
          disetujui_at: null,
          disetujui_oleh: null,
          dikirim_at: null,
          dikirim_oleh: null,
          ditolak_at: null,
          ditolak_oleh: null,
          diterima_at: null,
          diterima_oleh: null,
          tidak_terima_at: null,
          tidak_terima_oleh: null,
          ditutup_at: null,
          ditutup_oleh: null,
          catatan_alasan: null,
          };
        });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      const dok: PermintaanGudangDoc = {
        id: "pg-mock-" + store.seq++,
        dari_gudang_id: req.dari_gudang_id,
        tujuan: tujuanSiap,
        tujuan_ids: tujuanSiap.map((t) => t.tipe + ":" + t.id),
        status: "menunggu",
        items: req.items.map((it) => ({ ...it })),
        created_by: MOCK_SESSION.user.id,
        created_at: waktu,
        updated_at: waktu,
        riwayat_status: [{ status: "menunggu", oleh: MOCK_SESSION.user.id, at: waktu }],
      };
      store.permintaanGudang.unshift(dok);
      return responsPermintaanMock(dok);
    },

    async ubahItemPermintaan(req) {
      await delay(300);
      const dok = store.permintaanGudang.find((r) => r.id === String(req.id));
      if (!dok) return { ok: false, error: "Permintaan tidak ditemukan." };
      const terminal = pesanStatusTerminalMock(dok.status);
      if (terminal) return { ok: false, error: terminal };
      if (dok.status !== "menunggu") return { ok: false, error: "Permintaan sudah diproses." };
      dok.items = req.items.map((it) => ({ ...it }));
      // Paritas `ubahItemPermintaan`: sinkronkan items tujuan yang belum punya items sendiri.
      dok.tujuan = dok.tujuan.map((t) =>
        Array.isArray(t.items) && t.items.length > 0 ? t : { ...t, items: dok.items.map((it) => ({ ...it })) }
      );
      dok.updated_at = new Date().toISOString();
      dok.riwayat_status.push({ status: dok.status, oleh: MOCK_SESSION.user.id, at: dok.updated_at });
      return responsPermintaanMock(dok);
    },

    /**
     * v5.1 (Q1) - setujui SATU tujuan. Gate penerima tujuan itu atau owner; `status_kirim`
     * `menunggu` -> `disetujui`; status dokumen di-recompute (P6: `selesai` bukan turunan).
     */
    async setujuiTujuanGudang(req) {
      return ubahStatusKirimTujuanMock(req, "disetujui");
    },

    /** v5.1 (P1) - tolak SATU tujuan. Gate sama; `status` entri -> `ditolak`. */
    async tolakTujuanPermintaanGudang(req) {
      return ubahStatusKirimTujuanMock(req, "ditolak");
    },

    async tolakPermintaanGudang(req) {
      await delay(300);
      const role = getRole();
      if (role !== "owner" && role !== "admin") return { ok: false, error: "Akses ditolak. Hubungi owner." };
      const dok = store.permintaanGudang.find((r) => r.id === String(req.id));
      if (!dok) return { ok: false, error: "Permintaan tidak ditemukan." };
      const terminal = pesanStatusTerminalMock(dok.status);
      if (terminal) return { ok: false, error: terminal };
      if (dok.status !== "menunggu") return { ok: false, error: "Permintaan sudah diproses." };
      // Paritas: hanya bila SEMUA tujuan masih `status_kirim === "menunggu"`.
      if (dok.tujuan.some((t) => !t || t.status_kirim !== "menunggu")) {
        return { ok: false, error: "Permintaan sudah diproses." };
      }
      dok.status = "ditolak";
      dok.ditolak_oleh = MOCK_SESSION.user.id;
      dok.updated_at = new Date().toISOString();
      dok.riwayat_status.push({ status: "ditolak", oleh: MOCK_SESSION.user.id, at: dok.updated_at });
      return responsPermintaanMock(dok);
    },

    async batalPermintaanGudang(req) {
      await delay(300);
      const dok = store.permintaanGudang.find((r) => r.id === String(req.id));
      if (!dok) return { ok: false, error: "Permintaan tidak ditemukan." };
      const terminal = pesanStatusTerminalMock(dok.status);
      if (terminal) return { ok: false, error: terminal };
      if (dok.status !== "menunggu" && dok.status !== "disetujui") {
        return { ok: false, error: "Permintaan sudah diproses." };
      }
      dok.status = "dibatalkan";
      dok.dibatalkan_oleh = MOCK_SESSION.user.id;
      dok.updated_at = new Date().toISOString();
      dok.riwayat_status.push({ status: "dibatalkan", oleh: MOCK_SESSION.user.id, at: dok.updated_at });
      return responsPermintaanMock(dok);
    },

    /**
     * v5.1 (P7/Q1) - kirim SATU tujuan: `status_kirim` `disetujui` -> `dikirim`; stok asal turun
     * sebesar qty `tujuan[k].items` SAJA. Gate penerima tujuan itu / owner.
     */
    async kirimPermintaanGudang(req) {
      await delay(300);
      const dok = store.permintaanGudang.find((r) => r.id === String(req.id));
      if (!dok) return { ok: false, error: "Permintaan tidak ditemukan." };
      const terminal = pesanStatusTerminalMock(dok.status);
      if (terminal) return { ok: false, error: terminal };
      const cari = cariTujuanMock(dok, req.tujuan_index);
      if (!cari) return { ok: false, error: "Tujuan tidak ditemukan." };
      if (cari.entri.status_kirim === "menunggu") return { ok: false, error: "Permintaan belum disetujui." };
      if (cari.entri.status_kirim === "dikirim") return { ok: false, error: "Permintaan sudah dikirim." };
      if (cari.entri.status_kirim !== "disetujui") return { ok: false, error: "Permintaan belum disetujui." };
      const tolak = guardPenerimaAtauOwnerMock(cari.entri);
      if (tolak) return tolak;

      const dariId = String(dok.dari_gudang_id);
      const items = itemsTujuanMock(dok, cari.entri);
      // Cek stok cukup LEBIH DULU (paritas model: gagal di tengah tidak menulis apa pun).
      for (const it of items) {
        if (!stokByKode(it.kode_barang)) return { ok: false, error: "Stok produk tidak ditemukan." };
        if (qtyGudangMock(it.kode_barang, dariId) < (it.qty || 0)) {
          return { ok: false, error: "Stok gudang asal tidak cukup." };
        }
      }
      for (const it of items) tambahQtyGudangMock(it.kode_barang, dariId, -(it.qty || 0));

      const sekarang = new Date().toISOString();
      cari.entri.status_kirim = "dikirim";
      cari.entri.dikirim_at = sekarang;
      cari.entri.dikirim_oleh = MOCK_SESSION.user.id;
      dok.status = hitungStatusDokumenMock(dok.tujuan);
      dok.dikirim_oleh = MOCK_SESSION.user.id;
      dok.dikirim_at = sekarang;
      dok.updated_at = sekarang;
      dok.riwayat_status.push({ status: "dikirim", oleh: MOCK_SESSION.user.id, at: sekarang });
      return responsPermintaanMock(dok);
    },

    /** F5 - terima satu tujuan: stok gudang snapshot tujuan naik (qty tujuan itu). Gate pembuat/owner. */
    async terimaPermintaanGudang(req) {
      await delay(300);
      const dok = store.permintaanGudang.find((r) => r.id === String(req.id));
      if (!dok) return { ok: false, error: "Permintaan tidak ditemukan." };
      const cari = cariTujuanMock(dok, req.tujuan_index);
      if (!cari) return { ok: false, error: "Tujuan tidak ditemukan." };
      const tolak = guardPembuatAtauOwnerMock(dok);
      if (tolak) return tolak;
      const bukanMenunggu = pesanTujuanBukanMenungguMock(cari.entri.status);
      if (bukanMenunggu) return { ok: false, error: bukanMenunggu };
      if (cari.entri.status_kirim !== "dikirim") return { ok: false, error: "Permintaan belum dikirim." };

      const items = itemsTujuanMock(dok, cari.entri);
      if (cari.entri.gudang_id_snapshot) {
        for (const it of items) tambahQtyGudangMock(it.kode_barang, cari.entri.gudang_id_snapshot, it.qty || 0);
      }
      const sekarang = new Date().toISOString();
      cari.entri.status = "diterima";
      cari.entri.diterima_at = sekarang;
      cari.entri.diterima_oleh = MOCK_SESSION.user.id;
      dok.status = hitungStatusDokumenMock(dok.tujuan);
      dok.updated_at = sekarang;
      dok.riwayat_status.push({ status: dok.status, oleh: MOCK_SESSION.user.id, at: sekarang });
      return responsPermintaanMock(dok);
    },

    /** F5 - tidak-terima satu tujuan: stok kembali ke gudang ASAL (qty tujuan itu). Gate pembuat/owner. */
    async tidakTerimaPermintaanGudang(req) {
      await delay(300);
      const dok = store.permintaanGudang.find((r) => r.id === String(req.id));
      if (!dok) return { ok: false, error: "Permintaan tidak ditemukan." };
      const cari = cariTujuanMock(dok, req.tujuan_index);
      if (!cari) return { ok: false, error: "Tujuan tidak ditemukan." };
      const tolak = guardPembuatAtauOwnerMock(dok);
      if (tolak) return tolak;
      const bukanMenunggu = pesanTujuanBukanMenungguMock(cari.entri.status);
      if (bukanMenunggu) return { ok: false, error: bukanMenunggu };
      if (cari.entri.status_kirim !== "dikirim") return { ok: false, error: "Permintaan belum dikirim." };

      const items = itemsTujuanMock(dok, cari.entri);
      for (const it of items) tambahQtyGudangMock(it.kode_barang, String(dok.dari_gudang_id), it.qty || 0);
      const sekarang = new Date().toISOString();
      cari.entri.status = "tidak_terima";
      cari.entri.tidak_terima_at = sekarang;
      cari.entri.tidak_terima_oleh = MOCK_SESSION.user.id;
      dok.status = hitungStatusDokumenMock(dok.tujuan);
      dok.updated_at = sekarang;
      dok.riwayat_status.push({ status: dok.status, oleh: MOCK_SESSION.user.id, at: sekarang });
      return responsPermintaanMock(dok);
    },

    /** v5.1 (P6) - selesai: pembuat/owner; SEMUA tujuan harus final. Stok tidak berubah. */
    async selesaiPermintaanGudang(req) {
      await delay(300);
      const dok = store.permintaanGudang.find((r) => r.id === String(req.id));
      if (!dok) return { ok: false, error: "Permintaan tidak ditemukan." };
      const terminal = pesanStatusTerminalMock(dok.status);
      if (terminal) return { ok: false, error: terminal };
      const tolak = guardPembuatAtauOwnerMock(dok);
      if (tolak) return tolak;
      if (dok.tujuan.length === 0 || !dok.tujuan.every((t) => t && STATUS_TUJUAN_FINAL.includes(t.status))) {
        return { ok: false, error: "Masih ada tujuan yang belum selesai." };
      }
      const sekarang = new Date().toISOString();
      dok.status = "selesai";
      dok.selesai_at = dok.selesai_at || sekarang;
      dok.riwayat_status.push({ status: "selesai", oleh: MOCK_SESSION.user.id, at: sekarang });
      return responsPermintaanMock(dok);
    },

    async tutupTujuanPermintaanGudang(req) {
      await delay(300);
      if (getRole() !== "owner") return { ok: false, error: "Hanya owner yang dapat menutup tujuan." };
      const alasan = req.catatan ? String(req.catatan).trim() : "";
      if (!alasan) return { ok: false, error: "Alasan wajib diisi." };
      if (alasan.length > MAKS_ALASAN_TUJUAN) return { ok: false, error: "Alasan maksimal 200 karakter." };
      const dok = store.permintaanGudang.find((r) => r.id === String(req.id));
      if (!dok) return { ok: false, error: "Permintaan tidak ditemukan." };
      const cari = cariTujuanMock(dok, req.tujuan_index);
      if (!cari) return { ok: false, error: "Tujuan tidak ditemukan." };
      const bukanMenunggu = pesanTujuanBukanMenungguMock(cari.entri.status);
      if (bukanMenunggu) return { ok: false, error: bukanMenunggu };
      if (cari.entri.status_kirim !== "dikirim") return { ok: false, error: "Permintaan belum dikirim." };

      const sekarang = new Date().toISOString();
      cari.entri.status = "ditutup";
      cari.entri.ditutup_at = sekarang;
      cari.entri.ditutup_oleh = MOCK_SESSION.user.id;
      cari.entri.catatan_alasan = alasan;
      dok.status = hitungStatusDokumenMock(dok.tujuan);
      dok.updated_at = sekarang;
      dok.riwayat_status.push({ status: "ditutup", oleh: MOCK_SESSION.user.id, at: sekarang });
      return responsPermintaanMock(dok);
    },

    async setGudangUser(req) {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      if (getRole() !== "owner") return { ok: false, error: "Hanya owner yang dapat mengatur lokasi user." };
      const admin = store.admins.find((a) => String(a.telegram_user_id) === String(req.target_user_id));
      if (!admin) return { ok: false, error: "User belum terdaftar." };
      const gid = req.gudang_id ? String(req.gudang_id) : null;
      if (gid) {
        const g = store.gudang.find((x) => x.gudang_id === gid && x.aktif);
        if (!g) return { ok: false, error: "Gudang tidak dikenal." };
      }
      const lama = admin.gudang_id ?? null;
      admin.gudang_id = gid;
      catatRoleChange(String(admin.telegram_user_id), admin.name ?? null, admin.role, admin.role);
      void lama;
      return { ok: true, admin: { ...admin } };
    },

    async setJabatan(req) {
      await delay(300);
      if (mockSesiKedaluwarsa()) return { ok: false, error: SESI_KEDALUWARSA };
      if (getRole() !== "owner") return { ok: false, error: "Hanya owner yang dapat mengubah jabatan." };
      const admin = store.admins.find((a) => String(a.telegram_user_id) === String(req.target_user_id));
      if (!admin) return { ok: false, error: "User belum terdaftar." };
      const j = typeof req.jabatan === "string" && req.jabatan.trim() ? req.jabatan.trim() : null;
      if (j && [...j].length > 40) return { ok: false, error: "Jabatan maksimal 40 karakter." };
      admin.jabatan = j;
      // Jabatan KOSMETIK: TIDAK menyentuh role, TIDAK menulis audit role (BR8).
      return { ok: true, admin: { ...admin } };
    },

    async listUserTujuan() {
      await delay(200);
      return store.admins
        .map((a) => ({
          telegram_user_id: String(a.telegram_user_id),
          name: a.name ?? null,
          jabatan: a.jabatan ?? null,
          gudang_id: a.gudang_id ?? null,
        }))
        .filter((a) => a.gudang_id !== null && a.gudang_id !== "");
    },
  };
}
