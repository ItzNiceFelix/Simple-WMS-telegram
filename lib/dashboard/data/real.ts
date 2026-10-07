"use client";

// lib/dashboard/data/real.ts
// Implementasi DataSource untuk Firestore client SDK (Fase C, PRD 37 C2).
// Bentuk data WAJIB sama dengan mock (PRD 38.2) supaya UI tidak berubah.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as batasi,
  orderBy,
  query,
  where,
  Timestamp,
} from "firebase/firestore";

import { idTanggalHariIni, kekuranganStok, statusStok } from "../format";

// CJS murni (dipakai juga oleh mock + test). Satu sumber kebenaran logika filter stok v5.
import filterStok from "./filterStok.js";
import { adalahProviderAi } from "../providerAi";
import type {
  AccessRequestDoc,
  AdminDoc,
  AiSettingsDoc,
  DailyRequestDoc,
  MovementDoc,
  MovementStatus,
  MovementType,
  OpnameDraftDoc,
  ProdukDoc,
  ProdukVariant,
  RingkasanData,
  Role,
  StockFilter,
  RoleChangeDoc,
  StockRow,
  SyncStokDraftDoc,
  GudangDoc,
  OpnameGudangDoc,
  OpnameGudangStatus,
  PermintaanGudangDoc,
} from "../types";
import type { DataSource, MovementFilter, ProdukDetail } from "./index";
import { normalisasiDokumen } from "./normalisasi";
import { ambilDb, masukDenganCustomToken } from "./klien-firebase";

/** Firestore Timestamp | Date | string -> ISO string | null */
function keIso(nilai: unknown): string | null {
  if (nilai == null) return null;
  if (typeof nilai === "string") return nilai;
  if (nilai instanceof Date) return nilai.toISOString();
  if (typeof nilai === "object" && "toDate" in nilai && typeof (nilai as { toDate: () => Date }).toDate === "function") {
    return (nilai as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function keAngkaAtauNull(nilai: unknown): number | null {
  return typeof nilai === "number" && Number.isFinite(nilai) ? nilai : null;
}

interface SesiReal {
  uid: string;
  role: Role;
  token: string;
  superAdmin: boolean;
}

/**
 * Login real: kirim initData Telegram ke /api/auth/telegram, simpan role + custom token.
 * initData diambil dari window.Telegram.WebApp (PRD N1: tanpa Telegram = tidak terautentikasi).
 */
/** Ambil initData; tunggu singkat bila SDK Telegram belum selesai dimuat. */
async function ambilInitData(): Promise<string | null> {
  const baca = () =>
    (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram
      ?.WebApp?.initData;

  for (let i = 0; i < 10; i++) {
    const nilai = baca();
    if (nilai) return nilai;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function ambilSesiReal(): Promise<SesiReal> {
  if (typeof window === "undefined") {
    throw new Error("Sesi hanya tersedia di browser.");
  }
  const initData = await ambilInitData();
  if (!initData) {
    throw new Error("TANPA_TELEGRAM");
  }

  const res = await fetch("/api/auth/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
    credentials: "include",
  });
  const data = (await res.json()) as {
    ok?: boolean;
    role?: Role;
    user?: { id: string };
    firebaseToken?: string;
    superAdmin?: boolean;
    error?: string;
  };
  if (!res.ok || !data.ok || !data.user || !data.role || !data.firebaseToken) {
    throw new Error(data.error || `Auth gagal (${res.status}).`);
  }

  await masukDenganCustomToken(data.firebaseToken);
  return {
    uid: data.user.id,
    role: data.role,
    token: data.firebaseToken,
    superAdmin: data.superAdmin === true,
  };
}

/**
 * POST ke route tulis v2 (pola mutasiStok). Tidak melempar untuk error terduga:
 * sertakan pesan server apa adanya. 401 memakai pesan SESI_KEDALUWARSA dari server.
 */
async function kirimTulis(path: string, body: unknown): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!data || typeof data !== "object") return { ok: false, error: "Gagal menyimpan. Coba lagi." };
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? `Gagal menyimpan (${res.status}).` };
  }
  return { ok: true, ...data };
}

export function makeRealDataSource(_getRole: () => Role): DataSource {
  let sesiCache: SesiReal | null = null;

  async function sesi(): Promise<SesiReal> {
    if (!sesiCache) sesiCache = await ambilSesiReal();
    return sesiCache;
  }

  async function semuaProdukOnline(): Promise<Map<string, ProdukDoc>> {
    const db = ambilDb();
    const snap = await getDocs(query(collection(db, "products"), where("is_online_product", "==", true)));
    const map = new Map<string, ProdukDoc>();
    for (const d of snap.docs) {
      const x = d.data();
      map.set(d.id, {
        kode_barang: d.id,
        nama_accurate: String(x.nama_accurate ?? d.id),
        nama_accurate_normalized: x.nama_accurate_normalized ?? undefined,
        hpp: keAngkaAtauNull(x.hpp),
        hpp_baru: keAngkaAtauNull(x.hpp_baru),
        is_online_product: true,
        variants: Array.isArray(x.variants) ? (x.variants as ProdukVariant[]) : [],
        search_keywords: Array.isArray(x.search_keywords) ? (x.search_keywords as string[]) : [],
        updated_at: keIso(x.updated_at),
      });
    }
    return map;
  }

  /** v5 (F8/F9): SEMUA produk tanpa filter online. Dipakai filter yang bisa dilepas. */
  async function semuaProduk(): Promise<Map<string, ProdukDoc>> {
    const db = ambilDb();
    const snap = await getDocs(collection(db, "products"));
    const map = new Map<string, ProdukDoc>();
    for (const d of snap.docs) {
      const x = d.data();
      map.set(d.id, {
        kode_barang: d.id,
        nama_accurate: String(x.nama_accurate ?? d.id),
        nama_accurate_normalized: x.nama_accurate_normalized ?? undefined,
        hpp: keAngkaAtauNull(x.hpp),
        hpp_baru: keAngkaAtauNull(x.hpp_baru),
        is_online_product: x.is_online_product === true,
        variants: Array.isArray(x.variants) ? (x.variants as ProdukVariant[]) : [],
        search_keywords: Array.isArray(x.search_keywords) ? (x.search_keywords as string[]) : [],
        updated_at: keIso(x.updated_at),
      });
    }
    return map;
  }

  /** Boundary baca map qty per gudang (BR3) - delegasi ke filterStok (satu sumber kebenaran). */
  function bacaQtyPerGudang(s: { stok_gudang_online?: unknown; qty_per_gudang?: unknown } | undefined): Record<string, number> {
    return filterStok.bacaQtyPerGudang(s);
  }

  // v5 (F9): baca SEMUA produk (bukan hanya online) supaya filter gudang/online bisa
  // dikendalikan. Default filter is_online=true -> paritas perilaku lama.
  // v5 (BR3): qty per gudang dari map qty_per_gudang (fallback stok_gudang_online).
  async function rowsStok(opts: StockFilter = {}): Promise<StockRow[]> {
    const db = ambilDb();
    const [produkMap, stokSnap] = await Promise.all([
      semuaProduk(), // semua, bukan hanya online
      getDocs(collection(db, "stock")),
    ]);
    const stokById = new Map(stokSnap.docs.map((d) => [d.id, d.data()]));
    const baris: StockRow[] = [];
    for (const [kode, produk] of produkMap) {
      const s = stokById.get(kode);
      const qtyPerGudang = bacaQtyPerGudang(s);
      const nilai = filterStok.nilaiUntukFilter(
        { stok_gudang_online: keAngkaAtauNull(s?.stok_gudang_online), qty_per_gudang: qtyPerGudang },
        opts.gudang_id ?? null
      );
      const reorder = s ? keAngkaAtauNull(s.reorder_point) : null;
      baris.push({
        kode_barang: kode,
        nama_accurate: produk.nama_accurate,
        hpp: produk.hpp,
        stok_gudang_online: nilai,
        qty_per_gudang: qtyPerGudang,
        is_online_product: produk.is_online_product === true,
        reorder_point: reorder,
        status: statusStok(nilai, reorder),
        kekurangan: kekuranganStok(nilai),
      });
    }
    // SATU sumber kebenaran filter (paritas dengan mock.ts).
    return filterStok.terapkanFilter(baris as unknown as Record<string, unknown>[], opts) as unknown as StockRow[];
  }

  function mapMovement(d: { id: string; data: () => Record<string, unknown> }): MovementDoc {
    const x = d.data();
    return {
      id: d.id,
      kode_barang: String(x.kode_barang ?? ""),
      nama_terbaca: (x.nama_terbaca as string) ?? null,
      variasi: (x.variasi as string) ?? null,
      qty: keAngkaAtauNull(x.qty),
      type: (x.type as MovementType) ?? "koreksi_manual",
      action_type: (x.action_type as string) ?? null,
      qty_sistem: keAngkaAtauNull(x.qty_sistem),
      qty_fisik: keAngkaAtauNull(x.qty_fisik),
      selisih: keAngkaAtauNull(x.selisih),
      catatan: (x.catatan as string) ?? null,
      source: (x.source as MovementDoc["source"]) ?? "manual_chat",
      status: (x.status as MovementStatus) ?? "processed",
      created_at: keIso(x.created_at) ?? new Date(0).toISOString(),
      created_by: x.created_by == null ? null : String(x.created_by),
      created_by_username: (x.created_by_username as string) ?? null,
      created_by_name: (x.created_by_name as string) ?? null,
      requested_by: x.requested_by == null ? null : String(x.requested_by),
      requested_by_username: (x.requested_by_username as string) ?? null,
      requested_by_name: (x.requested_by_name as string) ?? null,
      confirmed_by: x.confirmed_by == null ? null : String(x.confirmed_by),
      resolved_by: x.resolved_by == null ? null : String(x.resolved_by),
      penanda: (x.penanda as string) ?? null,
    };
  }

  return {
    async getSession() {
      const s = await sesi();
      return {
        user: { id: s.uid, username: null, name: null },
        role: s.role,
        superAdmin: s.superAdmin,
      };
    },

    async getRingkasan(): Promise<RingkasanData> {
      const s = await sesi();
      // B2: rowsStok() sekarang membaca SEMUA produk; getRingkasan HARUS tetap menghitung
      // produk online saja supaya arti totalProdukOnline tidak berubah (AC global #26).
      const rows = await rowsStok({ is_online: true });
      const staff = s.role === "owner" || s.role === "admin";
      let draftPending: number | null = null;
      let permintaanHariIni: number | null = null;
      if (staff) {
        const db = ambilDb();
        const [op, sy, dr] = await Promise.all([
          getDocs(query(collection(db, "opname_drafts"), where("status", "==", "pending_confirmation"))),
          getDocs(query(collection(db, "sync_stok_drafts"), where("status", "==", "pending_confirmation"))),
          getDoc(doc(db, "daily_requests", idTanggalHariIni())),
        ]);
        // v3b A2: batch picking pending = movement `pending_confirmation` ber-`action_type`,
        // dikelompokkan per pemilik. Pakai ulang `listPickingDrafts` (hindari duplikasi logika).
        const batchPicking = await this.listPickingDrafts();
        draftPending = op.docs.length + sy.docs.length + batchPicking.length;
        const items = dr.exists() ? (dr.data().items as unknown[]) : [];
        permintaanHariIni = Array.isArray(items) ? items.length : 0;
      }
      return {
        totalProdukOnline: rows.length,
        itemMenipis: rows.filter((r) => r.status === "menipis").length,
        itemMinus: rows.filter((r) => r.status === "minus").length,
        draftPending,
        permintaanHariIni,
      };
    },

    async listStock(filter?: StockFilter): Promise<StockRow[]> {
      return rowsStok(filter);
    },

    async getProduk(kode: string): Promise<ProdukDetail | null> {
      const db = ambilDb();
      const [p, s] = await Promise.all([
        getDoc(doc(db, "products", kode)),
        getDoc(doc(db, "stock", kode)),
      ]);
      if (!p.exists()) return null;
      const x = p.data();
      return {
        produk: {
          kode_barang: p.id,
          nama_accurate: String(x.nama_accurate ?? p.id),
          nama_accurate_normalized: x.nama_accurate_normalized ?? undefined,
          hpp: keAngkaAtauNull(x.hpp),
          hpp_baru: keAngkaAtauNull(x.hpp_baru),
          is_online_product: x.is_online_product === true,
          variants: Array.isArray(x.variants) ? (x.variants as ProdukVariant[]) : [],
          search_keywords: Array.isArray(x.search_keywords) ? (x.search_keywords as string[]) : [],
          updated_at: keIso(x.updated_at),
        },
        stok: s.exists()
          ? {
              kode_barang: s.id,
              stok_gudang_online: keAngkaAtauNull(s.data().stok_gudang_online),
              reorder_point: keAngkaAtauNull(s.data().reorder_point),
            }
          : null,
      };
    },

    async listMovements(filter: MovementFilter = {}) {
      const db = ambilDb();
      const batasan: Parameters<typeof query>[1][] = [];
      // Bounded query (PRD 35.4): maksimum SATU equality + rentang created_at.
      if (filter.kode_barang) batasan.push(where("kode_barang", "==", filter.kode_barang));
      else if (filter.type) batasan.push(where("type", "==", filter.type));
      else if (filter.status) batasan.push(where("status", "==", filter.status));
      else if (filter.created_by) batasan.push(where("created_by", "==", filter.created_by));

      if (filter.dari) batasan.push(where("created_at", ">=", Timestamp.fromDate(new Date(filter.dari))));
      if (filter.sampai) batasan.push(where("created_at", "<=", Timestamp.fromDate(new Date(filter.sampai))));

      batasan.push(orderBy("created_at", "desc"));
      batasan.push(batasi(filter.limit ?? 200));

      const snap = await getDocs(query(collection(db, "stock_movements"), ...batasan));
      return snap.docs.map(mapMovement);
    },

    async listOpnameDrafts(): Promise<OpnameDraftDoc[]> {
      const db = ambilDb();
      const snap = await getDocs(collection(db, "opname_drafts"));
      return snap.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            items: Array.isArray(x.items) ? (x.items as OpnameDraftDoc["items"]) : [],
            status: String(x.status ?? ""),
            created_at: keIso(x.created_at) ?? new Date(0).toISOString(),
            owner_user_id: x.owner_user_id == null ? null : String(x.owner_user_id),
          };
        })
        .filter((d) => d.status === "pending_confirmation");
    },

    async listSyncDrafts(): Promise<SyncStokDraftDoc[]> {
      const db = ambilDb();
      const snap = await getDocs(collection(db, "sync_stok_drafts"));
      return snap.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            kondisi: String(x.kondisi ?? ""),
            items: Array.isArray(x.items) ? (x.items as SyncStokDraftDoc["items"]) : [],
            index_kolom: keAngkaAtauNull(x.index_kolom),
            status: String(x.status ?? ""),
            created_at: keIso(x.created_at) ?? new Date(0).toISOString(),
            owner_user_id: x.owner_user_id == null ? null : String(x.owner_user_id),
          };
        })
        .filter((d) => d.status === "pending_confirmation");
    },

    async listDailyRequests(): Promise<DailyRequestDoc[]> {
      const db = ambilDb();
      const snap = await getDocs(collection(db, "daily_requests"));
      // B3: normalisasi tiap dokumen (bukan cast mentah) supaya item lama bot
      // `{kode_barang,nama,variasi,qty,buffer}` mendapat field baru yang terisi.
      return snap.docs
        .map((d) => normalisasiDokumen(d.id, d.data() as Record<string, unknown>, keIso))
        .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
    },

    async listKeywordNotes(): Promise<import("../types").KeywordNoteDoc[]> {
      const s = await sesi();
      void s;
      const db = ambilDb();
      const snap = await getDocs(collection(db, "keyword_notes"));
      return snap.docs
        .map((d) => {
          const x = d.data() as Record<string, unknown>;
          const interp = x.interpreted_as;
          const interpValid: import("../types").InterpretasiKeyword | null =
            interp === "STOK" || interp === "MINTA" || interp === "MINTA_SISA" ? interp : null;
          return {
            id: d.id,
            raw_text: String(x.raw_text ?? ""),
            interpreted_as: interpValid,
            confidence: x.confidence === "confirmed" ? ("confirmed" as const) : ("guessed" as const),
            usage_count: typeof x.usage_count === "number" ? x.usage_count : 0,
            last_used: keIso(x.last_used),
            first_seen: keIso(x.first_seen),
            confirmed_by: x.confirmed_by == null ? null : String(x.confirmed_by),
            confirmed_at: keIso(x.confirmed_at),
          };
        })
        .sort((a, b) => (b.last_used ?? "").localeCompare(a.last_used ?? ""));
    },

    async listAdmins(): Promise<AdminDoc[]> {
      const db = ambilDb();
      const snap = await getDocs(collection(db, "admins"));
      return snap.docs.map((d) => {
        const x = d.data();
        return {
          telegram_user_id: d.id,
          name: (x.name as string) ?? null,
          telegram_username: (x.telegram_username as string) ?? null,
          role: (x.role as Role) ?? "guest",
          added_at: keIso(x.added_at),
          approved_by: x.approved_by == null ? null : String(x.approved_by),
          role_updated_at: keIso(x.role_updated_at),
          role_updated_by: x.role_updated_by == null ? null : String(x.role_updated_by),
        };
      });
    },

    async listRoleChanges(): Promise<RoleChangeDoc[]> {
      const db = ambilDb();
      const snap = await getDocs(query(collection(db, "admin_role_changes"), orderBy("created_at", "desc")));
      return snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          target_user_id: String(x.target_user_id ?? ""),
          target_name: (x.target_name as string) ?? null,
          old_role: (x.old_role as string) ?? null,
          new_role: String(x.new_role ?? ""),
          changed_by: String(x.changed_by ?? ""),
          created_at: keIso(x.created_at) ?? new Date(0).toISOString(),
        };
      });
    },

    async listAccessRequests(): Promise<AccessRequestDoc[]> {
      const db = ambilDb();
      const snap = await getDocs(collection(db, "access_requests"));
      return snap.docs.map((d) => {
        const x = d.data();
        return {
          telegram_user_id: d.id,
          status: String(x.status ?? ""),
          requested_at: keIso(x.requested_at),
          telegram_username: (x.telegram_username as string) ?? null,
          telegram_display_name: (x.telegram_display_name as string) ?? null,
          rejected_until: keIso(x.rejected_until),
          resolved_by: x.resolved_by == null ? null : String(x.resolved_by),
          resolved_at: keIso(x.resolved_at),
        };
      });
    },

    async getAiSettings(): Promise<AiSettingsDoc> {
      const db = ambilDb();
      const d = await getDoc(doc(db, "system_settings", "ai"));
      const x = d.exists() ? d.data() : {};
      const p = String(x.textProvider ?? "").toLowerCase();
      // Nilai dokumen tak dikenal -> "groq". Ini kode KLIEN: env non-public tidak
      // ter-inline Next, jadi jangan baca env di sini. Server (lib/models/aiSettings.js)
      // tetap otoritatif untuk default env saat dokumen kosong.
      return {
        textProvider: adalahProviderAi(p) ? p : "groq",
        updatedAt: keIso(x.updatedAt),
        updatedBy: x.updatedBy == null ? null : String(x.updatedBy),
      };
    },

    async mutasiStok(req) {
      const res = await fetch("/api/stok/mutasi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        credentials: "include",
      });
      const data = (await res.json()) as
        | { ok: true; stok_baru: number; movement_id: string }
        | { ok: false; error: string };
      return data;
    },

    async ubahProviderAi(provider: string) {
      const res = await fetch("/api/pengaturan/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
        credentials: "include",
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      return data.ok ? { ok: true as const } : { ok: false as const, error: data.error ?? "Gagal menyimpan." };
    },

    // ---- Tulis v2 (F1-F4). fetch ke route server, paritas mutasiStok. ----
    async ubahHpp(req) {
      const data = await kirimTulis("/api/produk/hpp", req);
      return data as { ok: true; produk: import("../types").ProdukDoc; peringatan_audit?: boolean } | { ok: false; error: string };
    },

    async ubahReorderPoint(req) {
      const data = await kirimTulis("/api/stok/reorder-point", req);
      return data as
        | { ok: true; reorder_point: number | null; notifikasi_terkirim: boolean }
        | { ok: false; error: string };
    },

    async ubahRoleAdmin(req) {
      const data = await kirimTulis("/api/admin/role", req);
      return data as
        | { ok: true; target_user_id: string; role_lama: string; role_baru: import("../types").Role; peringatan_audit?: boolean }
        | { ok: false; error: string };
    },

    async tambahAdmin(req) {
      const data = await kirimTulis("/api/admin/tambah", req);
      return data as
        | { ok: true; admin: import("../types").AdminDoc; peringatan_audit?: boolean }
        | { ok: false; error: string };
    },

    async hapusAdmin(req) {
      const data = await kirimTulis("/api/admin/hapus", req);
      return data as
        | { ok: true; telegram_user_id: string; nama: string | null; peringatan_audit?: boolean; peringatan_revoke?: boolean }
        | { ok: false; error: string };
    },

    // ---- Tulis v3a. Satu pintu `kirimTulis` (POST, `{ok,...}`, error diteruskan apa adanya). ----
    async sesuaikanQtyPermintaan(req) {
      const data = await kirimTulis("/api/permintaan", { aksi: "sesuaikan", ...req });
      return data as import("../types").SesuaikanQtyResponse;
    },

    async kirimFormPermintaan(req) {
      const data = await kirimTulis("/api/permintaan", { aksi: "buat-form", ...req });
      return data as import("../types").KirimFormResponse;
    },

    async tandaiPermintaanDatang(req) {
      const data = await kirimTulis("/api/permintaan", { aksi: "datang", ...req });
      return data as import("../types").TandaiDatangResponse;
    },

    async selesaikanPermintaan(req) {
      const data = await kirimTulis("/api/permintaan", { aksi: "selesai", ...req });
      return data as import("../types").SelesaikanResponse;
    },

    // ---- Tulis v3b Fase A (A7 + A5). Satu pintu kirimTulis ke /api/admin. ----
    async setujuiAkses(req) {
      const data = await kirimTulis("/api/admin", { aksi: "approve-akses", ...req });
      return data as import("../types").PutusAksesResponse;
    },

    async tolakAkses(req) {
      const data = await kirimTulis("/api/admin", { aksi: "tolak-akses", ...req });
      return data as import("../types").PutusAksesResponse;
    },

    async tambahProduk(req) {
      const data = await kirimTulis("/api/admin", { aksi: "tambah-produk", ...req });
      return data as import("../types").TambahProdukResponse;
    },

    async konfirmasiKeywordNote(req) {
      const data = await kirimTulis("/api/admin", {
        aksi: "kata-kunci",
        id: req.id,
        interpreted_as: req.interpreted_as,
      });
      if (!data.ok) return { ok: false, error: data.error ?? "Gagal menyimpan." };
      return data as unknown as import("../types").KonfirmasiKeywordResponse;
    },

    // ---- Tulis v3b Fase B (A2 konfirmasi-draft). ----

    /**
     * A2 — batch picking pending, satu entri per pemilik sesi (PRD v3b §5.4 B1/§10.3 UI-1).
     * Ambil via query equality `status` (method `listMovements`), lalu filter `action_type` di
     * memori (N7: hindari query `!=` yang butuh composite index) dan kelompokkan per pemilik.
     */
    async listPickingDrafts() {
      const movements = await this.listMovements({ status: "pending_confirmation" });
      const pending = movements.filter(
        (m) => m.status === "pending_confirmation" && m.action_type != null
      );

      const perOwner = new Map<string, MovementDoc[]>();
      for (const m of pending) {
        const owner =
          m.created_by && String(m.created_by).trim() !== ""
            ? String(m.created_by)
            : m.requested_by && String(m.requested_by).trim() !== ""
              ? String(m.requested_by)
              : null;
        const kunci = owner ?? "";
        const daftar = perOwner.get(kunci);
        if (daftar) daftar.push(m);
        else perOwner.set(kunci, [m]);
      }

      // E-3 (PRD §8.4): batch setengah jadi hanya terlihat bila SEMUA status ikut dibaca,
      // bukan hanya yang pending. Paritas `ambilBatchPicking` (`aksiDraft.js:43-50`).
      const semuaMovement = await this.listMovements({});
      const perOwnerSemua = new Map<string, MovementDoc[]>();
      for (const m of semuaMovement) {
        const owner =
          m.created_by && String(m.created_by).trim() !== ""
            ? String(m.created_by)
            : m.requested_by && String(m.requested_by).trim() !== ""
              ? String(m.requested_by)
              : null;
        const kunci = owner ?? "";
        const daftar = perOwnerSemua.get(kunci);
        if (daftar) daftar.push(m);
        else perOwnerSemua.set(kunci, [m]);
      }

      const batches: import("../types").PickingBatchDoc[] = [];
      for (const [batchId, daftar] of perOwner) {
        const siap = daftar.filter((m) => m.kode_barang).length;
        batches.push({
          batch_id: batchId,
          owner_user_id: batchId === "" ? null : batchId,
          movements: daftar,
          siap,
          dilewati: daftar.length - siap,
          sebagian: (perOwnerSemua.get(batchId) ?? daftar).some((m) => m.status !== "pending_confirmation"),
        });
      }
      return batches;
    },

    /** A2 — konfirmasi/batalkan draft. Satu pintu `kirimTulis` (owner: semua; admin: sendiri). */
    async konfirmasiDraft(req) {
      const data = await kirimTulis("/api/admin", { aksi: "konfirmasi-draft", ...req });
      return data as import("../types").KonfirmasiDraftResponse;
    },

    // ---- v5: master gudang (F1), set-qty gudang (F2), opname (F7), toggle online (F8). ----
    // Baca = client SDK (pola listAdmins), tulis = `kirimTulis` (satu pintu, error apa adanya).

    async listGudang(opts = {}): Promise<GudangDoc[]> {
      const db = ambilDb();
      const snap = await getDocs(collection(db, "gudang"));
      const semua = opts.semua === true;
      return snap.docs
        .map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            gudang_id: d.id,
            nama: String(x.nama ?? d.id),
            aktif: x.aktif === true,
            urutan: typeof x.urutan === "number" ? x.urutan : Number.MAX_SAFE_INTEGER,
            created_at: keIso(x.created_at),
            created_by: x.created_by == null ? null : String(x.created_by),
            updated_at: keIso(x.updated_at),
            updated_by: x.updated_by == null ? null : String(x.updated_by),
            nonaktif_at: keIso(x.nonaktif_at),
          };
        })
        .filter((g) => semua || g.aktif)
        .sort((a, b) => {
          if (a.urutan !== b.urutan) return a.urutan - b.urutan;
          return String(a.nama || "").localeCompare(String(b.nama || ""), "id");
        });
    },

    async tambahGudang(req) {
      const data = await kirimTulis("/api/gudang", { aksi: "tambah", nama: req.nama });
      return data as import("../types").TambahGudangResponse;
    },

    /** F1 `edit`/`nonaktif`/`aktifkan` — aksi diteruskan apa adanya ke route. */
    async ubahGudang(req) {
      const data = await kirimTulis("/api/gudang", { ...req });
      return data as import("../types").UbahGudangResponse;
    },

    async setQtyGudang(req) {
      const data = await kirimTulis("/api/stok/gudang", { aksi: "set-qty", ...req });
      return data as import("../types").SetQtyGudangResponse;
    },

    async mutasiStokGudang(req) {
      const data = await kirimTulis("/api/stok/gudang", { aksi: "mutasi-gudang", ...req });
      return data as import("../types").MutasiStokGudangResponse;
    },

    async toggleOnlineProduk(req) {
      const data = await kirimTulis("/api/produk/online", { ...req });
      return data as import("../types").ToggleOnlineResponse;
    },

    async listOpnameGudang(opts = {}): Promise<OpnameGudangDoc[]> {
      const db = ambilDb();
      const snap = await getDocs(collection(db, "opname_gudang"));
      return snap.docs
        .map((d) => {
          const x = d.data() as Record<string, unknown>;
          const items = Array.isArray(x.items) ? x.items : [];
          return {
            id: d.id,
            gudang_id: String(x.gudang_id ?? ""),
            items: items.map((it) => {
              const i = (it ?? {}) as Record<string, unknown>;
              return {
                kode_barang: String(i.kode_barang ?? ""),
                qty_sistem: keAngkaAtauNull(i.qty_sistem),
                qty_fisik: keAngkaAtauNull(i.qty_fisik) ?? 0,
                selisih: keAngkaAtauNull(i.selisih) ?? 0,
                belum_terdaftar: i.belum_terdaftar === true,
              };
            }),
            status: (x.status as OpnameGudangStatus) ?? "menunggu_approval",
            created_by: String(x.created_by ?? ""),
            created_at: keIso(x.created_at) ?? new Date(0).toISOString(),
            disetujui_oleh: x.disetujui_oleh == null ? null : String(x.disetujui_oleh),
            disetujui_at: keIso(x.disetujui_at),
            ditolak_oleh: x.ditolak_oleh == null ? null : String(x.ditolak_oleh),
          };
        })
        .filter((o) => !opts.status || o.status === opts.status)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },

    async buatOpnameGudang(req) {
      const data = await kirimTulis("/api/opname-gudang", { aksi: "buat", ...req });
      return data as import("../types").BuatOpnameGudangResponse;
    },

    async setujuiOpnameGudang(req) {
      const data = await kirimTulis("/api/opname-gudang", { aksi: "setujui", id: req.id });
      return data as import("../types").SetujuiOpnameGudangResponse;
    },

    async tolakOpnameGudang(req) {
      const data = await kirimTulis("/api/opname-gudang", { aksi: "tolak", id: req.id });
      return data as import("../types").SetujuiOpnameGudangResponse;
    },

    // ---- v5 F5/F6: permintaan antar-gudang. Baca = client SDK (pola listGudang); tulis = kirimTulis. ----

    async listPermintaanGudang(filter = {}): Promise<PermintaanGudangDoc[]> {
      const db = ambilDb();
      const snap = await getDocs(collection(db, "permintaan_gudang"));
      return snap.docs
        .map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            dari_gudang_id: String(x.dari_gudang_id ?? ""),
            tujuan: Array.isArray(x.tujuan) ? (x.tujuan as PermintaanGudangDoc["tujuan"]) : [],
            tujuan_ids: Array.isArray(x.tujuan_ids) ? (x.tujuan_ids as string[]) : [],
            status: (x.status as PermintaanGudangDoc["status"]) ?? "menunggu",
            items: Array.isArray(x.items) ? (x.items as PermintaanGudangDoc["items"]) : [],
            created_by: String(x.created_by ?? ""),
            created_at: keIso(x.created_at) ?? new Date(0).toISOString(),
            updated_at: keIso(x.updated_at),
            disetujui_oleh: x.disetujui_oleh == null ? null : String(x.disetujui_oleh),
            ditolak_oleh: x.ditolak_oleh == null ? null : String(x.ditolak_oleh),
            dibatalkan_oleh: x.dibatalkan_oleh == null ? null : String(x.dibatalkan_oleh),
            dikirim_oleh: x.dikirim_oleh == null ? null : String(x.dikirim_oleh),
            dikirim_at: keIso(x.dikirim_at),
            selesai_at: keIso(x.selesai_at),
            riwayat_status: Array.isArray(x.riwayat_status) ? (x.riwayat_status as PermintaanGudangDoc["riwayat_status"]) : [],
          } as PermintaanGudangDoc;
        })
        .filter((r) => {
          if (filter.status && r.status !== filter.status) return false;
          if (filter.dari_gudang_id && r.dari_gudang_id !== filter.dari_gudang_id) return false;
          if (filter.created_by && r.created_by !== filter.created_by) return false;
          if (filter.tujuan_id && !r.tujuan_ids.includes(filter.tujuan_id)) return false;
          return true;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },

    async buatPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "buat", ...req });
      return data as import("../types").PermintaanGudangResponse;
    },

    async ubahItemPermintaan(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "ubah-item", ...req });
      return data as import("../types").PermintaanGudangResponse;
    },

    async setujuiTujuanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "setujui-tujuan", id: req.id, tujuan_index: req.tujuan_index });
      return data as import("../types").PermintaanGudangResponse;
    },

    async tolakTujuanPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "tolak-tujuan", id: req.id, tujuan_index: req.tujuan_index });
      return data as import("../types").PermintaanGudangResponse;
    },

    async tolakPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "tolak", id: req.id });
      return data as import("../types").PermintaanGudangResponse;
    },

    async batalPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "batal", id: req.id });
      return data as import("../types").PermintaanGudangResponse;
    },

    async kirimPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "kirim", id: req.id, tujuan_index: req.tujuan_index });
      return data as import("../types").PermintaanGudangResponse;
    },

    async terimaPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "terima", id: req.id, tujuan_index: req.tujuan_index });
      return data as import("../types").PermintaanGudangResponse;
    },

    async tidakTerimaPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "tidak-terima", id: req.id, tujuan_index: req.tujuan_index });
      return data as import("../types").PermintaanGudangResponse;
    },

    async selesaiPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "selesai", id: req.id });
      return data as import("../types").PermintaanGudangResponse;
    },

    async tutupTujuanPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "tutup-tujuan", id: req.id, tujuan_index: req.tujuan_index, catatan: req.catatan });
      return data as import("../types").PermintaanGudangResponse;
    },

    async setGudangUser(req) {
      const data = await kirimTulis("/api/admin", { aksi: "set-gudang-user", target_user_id: req.target_user_id, gudang_id: req.gudang_id });
      return data as import("../types").AdminV5Response;
    },

    async setJabatan(req) {
      const data = await kirimTulis("/api/admin", { aksi: "set-jabatan", target_user_id: req.target_user_id, jabatan: req.jabatan });
      return data as import("../types").AdminV5Response;
    },

    async listUserTujuan() {
      const db = ambilDb();
      const snap = await getDocs(collection(db, "admins"));
      return snap.docs
        .map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            telegram_user_id: d.id,
            name: x.name == null ? null : String(x.name),
            jabatan: x.jabatan == null ? null : String(x.jabatan),
            gudang_id: x.gudang_id == null ? null : String(x.gudang_id),
          };
        })
        .filter((a) => a.gudang_id !== null && a.gudang_id !== "");
    },
  };
}