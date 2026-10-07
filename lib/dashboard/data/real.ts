"use client";

// lib/dashboard/data/real.ts — DataSource server-D1 (Fase 1 cutover).
// Bentuk data WAJIB sama dengan mock (kontrak DataSource) supaya UI tidak berubah.
// Beda dari versi Firestore: sesi = cookie swt_sesi (login web telegramId+
// password, BUKAN initData Telegram); SEMUA baca lewat GET /api/baca?scope=*
// (auth cookie, enforce di server); tulis tetap POST ke route server (sudah D1).
import { kekuranganStok, statusStok } from "../format";
import filterStok from "./filterStok.js";
import { adalahProviderAi } from "../providerAi";
import type {
  DailyRequestDoc,
  Role,
  StockFilter,
  StockRow,
} from "../types";
import type { DataSource, MovementFilter, ProdukDetail } from "./index";

type SesiWeb = {
  uid: string;
  role: Role;
  superAdmin: boolean;
};

async function ambilSesiWeb(): Promise<SesiWeb> {
  const res = await fetch("/api/me", { credentials: "include" });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean; role?: Role; user?: { id?: string }; error?: string;
  } | null;
  if (!res.ok || !data?.ok || !data.user?.id || !data.role) {
    throw new Error(data?.error || "Belum login. Masuk lewat halaman login.");
  }
  return { uid: data.user.id, role: data.role, superAdmin: data.role === "owner" };
}

async function bacaServer<T>(scope: string, params: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams({ scope, ...params }).toString();
  const res = await fetch(`/api/baca?${q}`, { credentials: "include" });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (!res.ok || !data || data.ok !== true) {
    throw new Error((data?.error as string) ?? `Gagal membaca ${scope} (${res.status}).`);
  }
  return data as T;
}

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
  let sesiCache: SesiWeb | null = null;

  async function sesi(): Promise<SesiWeb> {
    if (!sesiCache) sesiCache = await ambilSesiWeb();
    return sesiCache;
  }

  async function rowsStok(opts: StockFilter = {}): Promise<StockRow[]> {
    const data = await bacaServer<{ rows: StockRow[] }>("stok", {
      ...(opts.gudang_id ? { gudang_id: opts.gudang_id } : {}),
      ...(opts.is_online === false ? { is_online: "false" } : {}),
    });
    // Satu sumber kebenaran filter (paritas dengan mock.ts).
    const baris = data.rows.map((r) => ({
      ...r,
      status: statusStok(r.stok_gudang_online, r.reorder_point),
      kekurangan: kekuranganStok(r.stok_gudang_online),
    }));
    return filterStok.terapkanFilter(baris as unknown as Record<string, unknown>[], opts) as unknown as StockRow[];
  }

  return {
    async getSession() {
      const s = await sesi();
      return { user: { id: s.uid, username: null, name: null }, role: s.role, superAdmin: s.superAdmin };
    },

    async getRingkasan() {
      const [ringkasan, s] = await Promise.all([
        bacaServer<{ ringkasan: { totalProdukOnline: number; itemMenipis: number; itemMinus: number } }>("ringkasan"),
        sesi(),
      ]);
      const staff = s.role === "owner" || s.role === "admin";
      let draftPending: number | null = null;
      let permintaanHariIni: number | null = null;
      if (staff) {
        const [histori, daily] = await Promise.all([
          bacaServer<{ rows: { status: string; action_type: string | null }[] }>("histori", { status: "pending_confirmation", limit: "500" }),
          bacaServer<{ rows: { items: unknown[] }[] }>("daily"),
        ]);
        draftPending = histori.rows.filter((m) => m.action_type != null).length;
        permintaanHariIni = daily.rows.reduce((n, d) => n + (Array.isArray(d.items) ? d.items.length : 0), 0);
      }
      return {
        totalProdukOnline: ringkasan.ringkasan.totalProdukOnline,
        itemMenipis: ringkasan.ringkasan.itemMenipis,
        itemMinus: ringkasan.ringkasan.itemMinus,
        draftPending,
        permintaanHariIni,
      };
    },

    async listStock(filter) {
      return rowsStok(filter);
    },

    async getProduk(kode: string): Promise<ProdukDetail | null> {
      try {
        const data = await bacaServer<{ produk: ProdukDetail["produk"]; stok: ProdukDetail["stok"] }>("produk", { kode });
        return { produk: data.produk, stok: data.stok };
      } catch {
        return null;
      }
    },

    async listMovements(filter: MovementFilter = {}) {
      const params: Record<string, string> = {};
      if (filter.kode_barang) params.kode = filter.kode_barang;
      if (filter.type) params.type = filter.type;
      if (filter.status) params.status = filter.status;
      if (filter.created_by) params.created_by = filter.created_by;
      if (filter.dari) params.dari = filter.dari;
      if (filter.sampai) params.sampai = filter.sampai;
      if (filter.limit) params.limit = String(filter.limit);
      const data = await bacaServer<{ rows: DataSource extends never ? never : import("../types").MovementDoc[] }>("histori", params);
      return data.rows;
    },

    async listOpnameDrafts() {
      return [];
    },

    async listSyncDrafts() {
      return [];
    },

    async listDailyRequests(): Promise<DailyRequestDoc[]> {
      const data = await bacaServer<{ rows: DailyRequestDoc[] }>("daily");
      return [...data.rows].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
    },

    async listAdmins() {
      const data = await bacaServer<{ rows: import("../types").AdminDoc[] }>("admin");
      return data.rows;
    },

    async listRoleChanges() {
      return [];
    },

    async listAccessRequests() {
      const data = await bacaServer<{ rows: import("../types").AccessRequestDoc[] }>("akses");
      return data.rows;
    },

    async getAiSettings() {
      const data = await bacaServer<{ settings: { textProvider: string } }>("ai");
      const p = data.settings.textProvider;
      return { textProvider: adalahProviderAi(p) ? p : "groq", updatedAt: null, updatedBy: null };
    },

    async mutasiStok(req) {
      const data = await kirimTulis("/api/stok/mutasi", req);
      return data as { ok: boolean; error?: string; stok_baru?: number; movement_id?: string } as never;
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

    async ubahHpp(req) {
      const data = await kirimTulis("/api/produk/hpp", req);
      return data as never;
    },

    async ubahReorderPoint(req) {
      const data = await kirimTulis("/api/stok/reorder-point", req);
      return data as never;
    },

    async ubahRoleAdmin(req) {
      const data = await kirimTulis("/api/admin/role", req);
      return data as never;
    },

    async tambahAdmin(req) {
      const data = await kirimTulis("/api/admin/tambah", req);
      return data as never;
    },

    async hapusAdmin(req) {
      const data = await kirimTulis("/api/admin/hapus", req);
      return data as never;
    },

    async sesuaikanQtyPermintaan(req) {
      const data = await kirimTulis("/api/permintaan", { aksi: "sesuaikan", ...req });
      return data as never;
    },

    async kirimFormPermintaan(req) {
      const data = await kirimTulis("/api/permintaan", { aksi: "buat-form", ...req });
      return data as never;
    },

    async tandaiPermintaanDatang(req) {
      const data = await kirimTulis("/api/permintaan", { aksi: "datang", ...req });
      return data as never;
    },

    async selesaikanPermintaan(req) {
      const data = await kirimTulis("/api/permintaan", { aksi: "selesai", ...req });
      return data as never;
    },

    async listKeywordNotes() {
      const data = await bacaServer<{ rows: import("../types").KeywordNoteDoc[] }>("keyword");
      return data.rows;
    },

    async konfirmasiKeywordNote(req) {
      const data = await kirimTulis("/api/admin", { aksi: "kata-kunci", id: req.id, interpreted_as: req.interpreted_as });
      if (!data.ok) return { ok: false, error: data.error ?? "Gagal menyimpan." } as never;
      return data as never;
    },

    async setujuiAkses(req) {
      const data = await kirimTulis("/api/admin", { aksi: "approve-akses", ...req });
      return data as never;
    },

    async tolakAkses(req) {
      const data = await kirimTulis("/api/admin", { aksi: "tolak-akses", ...req });
      return data as never;
    },

    async tambahProduk(req) {
      const data = await kirimTulis("/api/admin", { aksi: "tambah-produk", ...req });
      return data as never;
    },

    async listPickingDrafts() {
      const movements = await this.listMovements({ status: "pending_confirmation" });
      const pending = movements.filter((m) => m.status === "pending_confirmation" && m.action_type != null);
      const perOwner = new Map<string, typeof pending>();
      for (const m of pending) {
        const owner = m.created_by?.trim() || m.requested_by?.trim() || "";
        const daftar = perOwner.get(owner);
        if (daftar) daftar.push(m);
        else perOwner.set(owner, [m]);
      }
      const semuaMovement = await this.listMovements({});
      const perOwnerSemua = new Map<string, typeof pending>();
      for (const m of semuaMovement) {
        const owner = m.created_by?.trim() || m.requested_by?.trim() || "";
        const daftar = perOwnerSemua.get(owner);
        if (daftar) daftar.push(m);
        else perOwnerSemua.set(owner, [m]);
      }
      return [...perOwner.entries()].map(([batchId, daftar]) => ({
        batch_id: batchId,
        owner_user_id: batchId === "" ? null : batchId,
        movements: daftar,
        siap: daftar.filter((m) => m.kode_barang).length,
        dilewati: daftar.filter((m) => !m.kode_barang).length,
        sebagian: (perOwnerSemua.get(batchId) ?? daftar).some((m) => m.status !== "pending_confirmation"),
      }));
    },

    async konfirmasiDraft(req) {
      const data = await kirimTulis("/api/admin", { aksi: "konfirmasi-draft", ...req });
      return data as never;
    },

    async listGudang(opts = {}) {
      const data = await bacaServer<{ rows: import("../types").GudangDoc[] }>("gudang", opts.semua ? { semua: "true" } : {});
      return data.rows;
    },

    async tambahGudang(req) {
      const data = await kirimTulis("/api/gudang", { aksi: "tambah", nama: req.nama });
      return data as never;
    },

    async ubahGudang(req) {
      const data = await kirimTulis("/api/gudang", { ...req });
      return data as never;
    },

    async setQtyGudang(req) {
      const data = await kirimTulis("/api/stok/gudang", { aksi: "set-qty", ...req });
      return data as never;
    },

    async mutasiStokGudang(req) {
      const data = await kirimTulis("/api/stok/gudang", { aksi: "mutasi-gudang", ...req });
      return data as never;
    },

    async toggleOnlineProduk(req) {
      const data = await kirimTulis("/api/produk/online", { ...req });
      return data as never;
    },

    async listOpnameGudang(opts = {}) {
      const data = await bacaServer<{ rows: import("../types").OpnameGudangDoc[] }>(
        "opname",
        opts.status ? { status: opts.status } : {}
      );
      return data.rows;
    },

    async buatOpnameGudang(req) {
      const data = await kirimTulis("/api/opname-gudang", { aksi: "buat", ...req });
      return data as never;
    },

    async setujuiOpnameGudang(req) {
      const data = await kirimTulis("/api/opname-gudang", { aksi: "setujui", id: req.id });
      return data as never;
    },

    async tolakOpnameGudang(req) {
      const data = await kirimTulis("/api/opname-gudang", { aksi: "tolak", id: req.id });
      return data as never;
    },

    async listPermintaanGudang(filter = {}) {
      const params: Record<string, string> = {};
      if (filter.status) params.status = filter.status;
      if (filter.dari_gudang_id) params.dari_gudang_id = filter.dari_gudang_id;
      if (filter.tujuan_id) params.tujuan_id = filter.tujuan_id;
      const data = await bacaServer<{ rows: import("../types").PermintaanGudangDoc[] }>("transfer", params);
      return data.rows;
    },

    async buatPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "buat", ...req });
      return data as never;
    },

    async ubahItemPermintaan(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "ubah-item", ...req });
      return data as never;
    },

    async setujuiTujuanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "setujui-tujuan", id: req.id, tujuan_index: req.tujuan_index });
      return data as never;
    },

    async tolakTujuanPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "tolak-tujuan", id: req.id, tujuan_index: req.tujuan_index });
      return data as never;
    },

    async tolakPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "tolak", id: req.id });
      return data as never;
    },

    async batalPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "batal", id: req.id });
      return data as never;
    },

    async kirimPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "kirim", id: req.id, tujuan_index: req.tujuan_index });
      return data as never;
    },

    async terimaPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "terima", id: req.id, tujuan_index: req.tujuan_index });
      return data as never;
    },

    async tidakTerimaPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "tidak-terima", id: req.id, tujuan_index: req.tujuan_index });
      return data as never;
    },

    async selesaiPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "selesai", id: req.id });
      return data as never;
    },

    async tutupTujuanPermintaanGudang(req) {
      const data = await kirimTulis("/api/permintaan-gudang", { aksi: "tutup-tujuan", id: req.id, tujuan_index: req.tujuan_index, catatan: req.catatan });
      return data as never;
    },

    async setGudangUser(req) {
      const data = await kirimTulis("/api/admin", { aksi: "set-gudang-user", target_user_id: req.target_user_id, gudang_id: req.gudang_id });
      return data as never;
    },

    async setJabatan(req) {
      const data = await kirimTulis("/api/admin", { aksi: "set-jabatan", target_user_id: req.target_user_id, jabatan: req.jabatan });
      return data as never;
    },

    async listUserTujuan() {
      const data = await bacaServer<{ rows: { telegram_user_id: string; name: string | null; jabatan: string | null; gudang_id: string | null }[] }>("admin");
      return data.rows;
    },
  };
}
