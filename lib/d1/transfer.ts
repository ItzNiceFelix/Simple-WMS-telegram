// lib/d1/transfer.ts — Transfer antar-gudang di D1 (Fase 1, paritas
// lib/models/permintaanGudang.js v5.1). Satu transfer = banyak tujuan, tiap
// tujuan punya status + siklus kirim SENDIRI. Stok asal turun saat kirim per
// tujuan; stok tujuan naik saat terima; kembali ke asal saat tidak-terima.
// Status dokumen TURUNAN (hitungStatusDokumen) — jangan ditulis manual.
// CAS: UPDATE ... WHERE status_kirim = <harap>, cek meta.changes.
import { gagal, sekarang, type Hasil } from "./db";
import { bacaQty } from "./stok";

export const MAKS_TUJUAN = 20;
export const MAKS_ITEM = 200;
export const MAKS_ALASAN = 200;

export type TujuanInput = {
  id: string;
  user_penerima_id?: string | null;
  items?: { kode_barang: string; qty: number }[];
};

export type TransferDoc = {
  id: string;
  dari_warehouse_id: string;
  status: string;
  created_at: number;
  created_by: string | null;
  tujuan: TujuanDoc[];
};

export type TujuanDoc = {
  db_id: number;
  idx: number;
  dest_warehouse_id: string | null;
  nama_snapshot: string | null;
  status: string;
  status_kirim: string;
  user_penerima_id: string | null;
  user_penerima_nama: string | null;
  items: { sku: string; nama: string | null; qty: number }[];
};

/** Status dokumen turunan dari status tiap tujuan (paritas hitungStatusDokumen). */
export function hitungStatusDokumen(tujuan: { status: string; status_kirim: string }[]): string {
  if (tujuan.length === 0) return "menunggu";
  if (tujuan.every((t) => t.status_kirim === "menunggu")) return "menunggu";
  if (tujuan.some((t) => t.status_kirim === "menunggu")) return "disetujui";
  if (tujuan.every((t) => t.status_kirim === "dikirim")) {
    if (tujuan.some((t) => t.status === "ditolak")) return "ditolak";
    return "dikirim";
  }
  return "disetujui";
}

async function ambilTujuan(
  db: D1Database,
  transferId: string
): Promise<(TujuanDoc & { db_id: number })[]> {
  const { results } = await db
    .prepare("SELECT * FROM transfer_destinations WHERE transfer_id = ? ORDER BY idx_tujuan ASC")
    .bind(transferId)
    .all<Record<string, unknown>>();
  const keluar: (TujuanDoc & { db_id: number })[] = [];
  for (const r of results) {
    const { results: items } = await db
      .prepare("SELECT sku, nama, qty FROM transfer_items WHERE destination_id = ?")
      .bind(r.id as number)
      .all<{ sku: string; nama: string | null; qty: number }>();
    keluar.push({
      db_id: r.id as number,
      idx: r.idx_tujuan as number,
      dest_warehouse_id: r.dest_warehouse_id as string | null,
      nama_snapshot: r.nama_snapshot as string | null,
      status: r.status as string,
      status_kirim: r.status_kirim as string,
      user_penerima_id: r.user_penerima_id as string | null,
      user_penerima_nama: r.user_penerima_nama as string | null,
      items: items.map((i) => ({ sku: i.sku, nama: i.nama, qty: i.qty })),
    });
  }
  return keluar;
}

export async function ambilTransfer(db: D1Database, id: string): Promise<TransferDoc | null> {
  const h = await db
    .prepare("SELECT * FROM transfers WHERE id = ?")
    .bind(id)
    .first<{ id: string; dari_warehouse_id: string; status: string; created_at: number; created_by: string | null }>();
  if (!h) return null;
  return { ...h, tujuan: await ambilTujuan(db, id) };
}

async function tulisStatusDokumen(db: D1Database, id: string, oleh: string | null, status: string): Promise<void> {
  const tujuan = await ambilTujuan(db, id);
  const turunan = hitungStatusDokumen(tujuan);
  const at = sekarang();
  await db.batch([
    db.prepare("UPDATE transfers SET status = ? WHERE id = ?").bind(status === "auto" ? turunan : status, id),
    db.prepare("INSERT INTO transfer_status_log (transfer_id, status, oleh, at) VALUES (?, ?, ?, ?)").bind(id, status === "auto" ? turunan : status, oleh, at),
  ]);
}

/** Gabung item duplikat: sku sama → qty dijumlah (paritas T1 dailyRequests). */
export function gabungItems(items: { kode_barang: string; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const sku = String(it.kode_barang);
    const qty = Math.floor(Number(it.qty));
    if (!sku || !Number.isInteger(qty) || qty < 1) continue;
    m.set(sku, (m.get(sku) ?? 0) + qty);
  }
  return m;
}

export async function buatTransfer(
  db: D1Database,
  dariId: string,
  tujuan: TujuanInput[],
  itemsDokumen: { kode_barang: string; qty: number }[],
  oleh: string | null
): Promise<Hasil<{ transfer: TransferDoc }>> {
  const asal = await db.prepare("SELECT id FROM warehouses WHERE id = ? AND aktif = 1").bind(dariId).first();
  if (!asal) return gagal(400, "Gudang asal tidak dikenal.");
  if (!Array.isArray(tujuan) || tujuan.length === 0 || tujuan.length > MAKS_TUJUAN) {
    return gagal(400, `Tujuan harus 1–${MAKS_TUJUAN}.`);
  }
  const id = `T${Date.now().toString(36).toUpperCase()}`;
  const at = sekarang();
  await db
    .prepare("INSERT INTO transfers (id, dari_warehouse_id, status, created_at, created_by) VALUES (?, ?, 'menunggu', ?, ?)")
    .bind(id, dariId, at, oleh)
    .run();
  let idx = 0;
  for (const t of tujuan) {
    const gid = String(t.id);
    const g = await db.prepare("SELECT nama FROM warehouses WHERE id = ? AND aktif = 1").bind(gid).first<{ nama: string }>();
    if (!g) {
      await db.prepare("DELETE FROM transfers WHERE id = ?").bind(id).run();
      return gagal(400, `Gudang tujuan ${gid} tidak dikenal.`);
    }
    let namaPenerima: string | null = null;
    if (t.user_penerima_id) {
      const u = await db
        .prepare("SELECT display_name FROM users WHERE tg_id = ? AND active = 1")
        .bind(String(t.user_penerima_id))
        .first<{ display_name: string }>();
      if (!u) {
        await db.prepare("DELETE FROM transfers WHERE id = ?").bind(id).run();
        return gagal(400, "Penerima tidak terdaftar.");
      }
      namaPenerima = u.display_name;
    }
    const daftar = gabungItems(t.items?.length ? t.items : itemsDokumen);
    if (daftar.size === 0 || daftar.size > MAKS_ITEM) {
      await db.prepare("DELETE FROM transfers WHERE id = ?").bind(id).run();
      return gagal(400, "Item tidak valid (1–200 item unik).");
    }
    const dest = await db
      .prepare(`INSERT INTO transfer_destinations (transfer_id, idx_tujuan, dest_warehouse_id, nama_snapshot, user_penerima_id, user_penerima_nama)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, idx, gid, g.nama, t.user_penerima_id ? String(t.user_penerima_id) : null, namaPenerima)
      .run();
    const destId = Number(dest.meta.last_row_id);
    for (const [sku, qty] of daftar) {
      const p = await db.prepare("SELECT sku FROM products WHERE sku = ?").bind(sku).first();
      if (!p) {
        await db.prepare("DELETE FROM transfers WHERE id = ?").bind(id).run();
        return gagal(400, `Produk ${sku} tidak dikenal.`);
      }
      await db.prepare("INSERT INTO transfer_items (destination_id, sku, qty) VALUES (?, ?, ?)").bind(destId, sku, qty).run();
    }
    idx++;
  }
  await db.prepare("INSERT INTO transfer_status_log (transfer_id, status, oleh, at) VALUES (?, 'menunggu', ?, ?)").bind(id, oleh, at).run();
  const transfer = await ambilTransfer(db, id);
  if (!transfer) return gagal(500, "Gagal membuat permintaan.");
  return { ok: true, transfer };
}

/** Ambil satu tujuan by indeks; null bila di luar array. */
async function cariTujuanDb(db: D1Database, transferId: string, indeks: number) {
  const daftar = await ambilTujuan(db, transferId);
  const k = Number(indeks);
  if (!Number.isInteger(k) || k < 0 || k >= daftar.length) return null;
  return daftar[k];
}

/** CAS status_kirim satu tujuan; false bila status sudah berubah (409). */
async function casStatusKirim(
  db: D1Database,
  destDbId: number,
  harap: string,
  baru: string,
  oleh: string | null,
  kolomAt: string
): Promise<boolean> {
  const at = sekarang();
  const r = await db
    .prepare(`UPDATE transfer_destinations SET status_kirim = ?, ${kolomAt} = ?, dikirim_oleh = ? WHERE id = ? AND status_kirim = ?`)
    .bind(baru, at, oleh, destDbId, harap)
    .run();
  return (r.meta.changes ?? 0) === 1;
}

export async function setujuiTujuan(
  db: D1Database,
  id: string,
  indeks: number,
  oleh: string | null,
  isOwner: boolean
): Promise<Hasil<{ transfer: TransferDoc }>> {
  const t = await ambilTransfer(db, id);
  if (!t) return gagal(404, "Permintaan tidak ditemukan.");
  const tujuan = await cariTujuanDb(db, id, indeks);
  if (!tujuan) return gagal(409, "Tujuan tidak ditemukan.");
  if (tujuan.status_kirim !== "menunggu") return gagal(409, "Tujuan sudah diproses.");
  const diizinkan = isOwner || (tujuan.user_penerima_id != null && tujuan.user_penerima_id === oleh);
  if (!diizinkan) return gagal(403, "Hanya penerima tujuan atau owner.");
  if (!(await casStatusKirim(db, tujuan.db_id, "menunggu", "disetujui", oleh, "disetujui_at"))) {
    return gagal(409, "Tujuan sudah diproses.");
  }
  await tulisStatusDokumen(db, id, oleh, "auto");
  const segar = await ambilTransfer(db, id);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, transfer: segar };
}

export async function tolakTujuan(
  db: D1Database,
  id: string,
  indeks: number,
  oleh: string | null,
  isOwner: boolean
): Promise<Hasil<{ transfer: TransferDoc }>> {
  const t = await ambilTransfer(db, id);
  if (!t) return gagal(404, "Permintaan tidak ditemukan.");
  const tujuan = await cariTujuanDb(db, id, indeks);
  if (!tujuan) return gagal(409, "Tujuan tidak ditemukan.");
  if (tujuan.status !== "menunggu") return gagal(409, "Tujuan sudah diproses.");
  const diizinkan = isOwner || (tujuan.user_penerima_id != null && tujuan.user_penerima_id === oleh);
  if (!diizinkan) return gagal(403, "Hanya penerima tujuan atau owner.");
  const at = sekarang();
  const r = await db
    .prepare("UPDATE transfer_destinations SET status = 'ditolak', status_kirim = 'dikirim', ditolak_at = ?, ditolak_oleh = ? WHERE id = ? AND status = 'menunggu'")
    .bind(at, oleh, tujuan.db_id)
    .run();
  if ((r.meta.changes ?? 0) !== 1) return gagal(409, "Tujuan sudah diproses.");
  await tulisStatusDokumen(db, id, oleh, "auto");
  const segar = await ambilTransfer(db, id);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, transfer: segar };
}

export async function kirimTujuan(
  db: D1Database,
  id: string,
  indeks: number,
  oleh: string | null,
  isOwner: boolean
): Promise<Hasil<{ transfer: TransferDoc; peringatan_audit: boolean }>> {
  const t = await ambilTransfer(db, id);
  if (!t) return gagal(404, "Permintaan tidak ditemukan.");
  const tujuan = await cariTujuanDb(db, id, indeks);
  if (!tujuan) return gagal(409, "Tujuan tidak ditemukan.");
  if (tujuan.status_kirim !== "disetujui") return gagal(409, "Permintaan belum disetujui.");
  const diizinkan = isOwner || (tujuan.user_penerima_id != null && tujuan.user_penerima_id === oleh);
  if (!diizinkan) return gagal(403, "Hanya penerima tujuan atau owner.");
  // Cek stok cukup per item di gudang asal
  for (const it of tujuan.items) {
    if ((await bacaQty(db, it.sku, t.dari_warehouse_id)) < it.qty) {
      return gagal(409, `Stok ${it.sku} di gudang asal tidak cukup.`);
    }
  }
  if (!(await casStatusKirim(db, tujuan.db_id, "disetujui", "dikirim", oleh, "dikirim_at"))) {
    return gagal(409, "Tujuan sudah diproses.");
  }
  // Stok asal turun + audit (gagal audit tidak rollback)
  let peringatan = false;
  try {
    const at = sekarang();
    const stmts: D1PreparedStatement[] = [];
    for (const it of tujuan.items) {
      const kini = await bacaQty(db, it.sku, t.dari_warehouse_id);
      stmts.push(
        db.prepare("UPDATE stock_by_bin SET qty = ? WHERE sku = ? AND warehouse_id = ?").bind(kini - it.qty, it.sku, t.dari_warehouse_id),
        db.prepare(`INSERT INTO stock_moves (sku, qty, jenis, gudang_id, action_type, source, status, created_by, at, by)
          VALUES (?, ?, 'TRANSFER_OUT', ?, 'mutasi_gudang', 'web_dashboard', 'processed', ?, ?, ?)`).bind(it.sku, -it.qty, t.dari_warehouse_id, oleh, at, oleh)
      );
    }
    await db.batch(stmts);
  } catch {
    peringatan = true;
  }
  await tulisStatusDokumen(db, id, oleh, "auto");
  const segar = await ambilTransfer(db, id);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, transfer: segar, peringatan_audit: peringatan };
}

export async function terimaTujuan(
  db: D1Database,
  id: string,
  indeks: number,
  oleh: string | null,
  isPembuatAtauOwner: boolean
): Promise<Hasil<{ transfer: TransferDoc }>> {
  if (!isPembuatAtauOwner) return gagal(403, "Hanya pembuat atau owner.");
  const t = await ambilTransfer(db, id);
  if (!t) return gagal(404, "Permintaan tidak ditemukan.");
  const tujuan = await cariTujuanDb(db, id, indeks);
  if (!tujuan) return gagal(409, "Tujuan tidak ditemukan.");
  if (tujuan.status !== "menunggu") return gagal(409, "Tujuan sudah diproses.");
  if (tujuan.status_kirim !== "dikirim") return gagal(409, "Permintaan belum dikirim.");
  if (!tujuan.dest_warehouse_id) return gagal(409, "Tujuan tidak valid.");
  const gAktif = await db.prepare("SELECT id FROM warehouses WHERE id = ? AND aktif = 1").bind(tujuan.dest_warehouse_id).first();
  if (!gAktif) return gagal(409, "Gudang tujuan nonaktif.");
  const at = sekarang();
  const r = await db
    .prepare("UPDATE transfer_destinations SET status = 'diterima', diterima_at = ?, diterima_oleh = ? WHERE id = ? AND status = 'menunggu' AND status_kirim = 'dikirim'")
    .bind(at, oleh, tujuan.db_id)
    .run();
  if ((r.meta.changes ?? 0) !== 1) return gagal(409, "Tujuan sudah diproses.");
  const stmts: D1PreparedStatement[] = [];
  for (const it of tujuan.items) {
    const kini = await bacaQty(db, it.sku, tujuan.dest_warehouse_id);
    stmts.push(
      db.prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty").bind(it.sku, tujuan.dest_warehouse_id, kini + it.qty),
      db.prepare(`INSERT INTO stock_moves (sku, qty, jenis, gudang_id, action_type, source, status, created_by, at, by)
        VALUES (?, ?, 'TRANSFER_IN', ?, 'mutasi_gudang', 'web_dashboard', 'processed', ?, ?, ?)`).bind(it.sku, it.qty, tujuan.dest_warehouse_id, oleh, at, oleh)
    );
  }
  await db.batch(stmts);
  await tulisStatusDokumen(db, id, oleh, "auto");
  const segar = await ambilTransfer(db, id);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, transfer: segar };
}

export async function tidakTerimaTujuan(
  db: D1Database,
  id: string,
  indeks: number,
  oleh: string | null,
  isPembuatAtauOwner: boolean
): Promise<Hasil<{ transfer: TransferDoc }>> {
  if (!isPembuatAtauOwner) return gagal(403, "Hanya pembuat atau owner.");
  const t = await ambilTransfer(db, id);
  if (!t) return gagal(404, "Permintaan tidak ditemukan.");
  const tujuan = await cariTujuanDb(db, id, indeks);
  if (!tujuan) return gagal(409, "Tujuan tidak ditemukan.");
  if (tujuan.status !== "menunggu") return gagal(409, "Tujuan sudah diproses.");
  if (tujuan.status_kirim !== "dikirim") return gagal(409, "Permintaan belum dikirim.");
  const at = sekarang();
  const r = await db
    .prepare("UPDATE transfer_destinations SET status = 'tidak_terima', tidak_terima_at = ?, tidak_terima_oleh = ? WHERE id = ? AND status = 'menunggu' AND status_kirim = 'dikirim'")
    .bind(at, oleh, tujuan.db_id)
    .run();
  if ((r.meta.changes ?? 0) !== 1) return gagal(409, "Tujuan sudah diproses.");
  // Stok kembali ke gudang asal
  const stmts: D1PreparedStatement[] = [];
  for (const it of tujuan.items) {
    const kini = await bacaQty(db, it.sku, t.dari_warehouse_id);
    stmts.push(
      db.prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty").bind(it.sku, t.dari_warehouse_id, kini + it.qty),
      db.prepare(`INSERT INTO stock_moves (sku, qty, jenis, gudang_id, action_type, source, status, created_by, at, by)
        VALUES (?, ?, 'TRANSFER_IN', ?, 'mutasi_gudang', 'web_dashboard', 'processed', ?, ?, ?)`).bind(it.sku, it.qty, t.dari_warehouse_id, oleh, at, oleh)
    );
  }
  await db.batch(stmts);
  await tulisStatusDokumen(db, id, oleh, "auto");
  const segar = await ambilTransfer(db, id);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, transfer: segar };
}

export async function tutupTujuan(
  db: D1Database,
  id: string,
  indeks: number,
  alasan: string,
  oleh: string | null,
  isOwner: boolean
): Promise<Hasil<{ transfer: TransferDoc }>> {
  if (!isOwner) return gagal(403, "Hanya owner yang dapat menutup tujuan.");
  const a = alasan.trim();
  if (!a) return gagal(400, "Alasan wajib diisi.");
  if (a.length > MAKS_ALASAN) return gagal(400, "Alasan maksimal 200 karakter.");
  const tujuan = await cariTujuanDb(db, id, indeks);
  if (!tujuan) return gagal(409, "Tujuan tidak ditemukan.");
  if (tujuan.status !== "menunggu") return gagal(409, "Tujuan sudah diproses.");
  const at = sekarang();
  const r = await db
    .prepare("UPDATE transfer_destinations SET status = 'ditutup', ditutup_at = ?, ditutup_oleh = ?, catatan_alasan = ? WHERE id = ? AND status = 'menunggu'")
    .bind(at, oleh, a, tujuan.db_id)
    .run();
  if ((r.meta.changes ?? 0) !== 1) return gagal(409, "Tujuan sudah diproses.");
  await tulisStatusDokumen(db, id, oleh, "auto");
  const segar = await ambilTransfer(db, id);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, transfer: segar };
}

export async function selesaiTransfer(
  db: D1Database,
  id: string,
  oleh: string | null,
  isPembuatAtauOwner: boolean
): Promise<Hasil<{ transfer: TransferDoc }>> {
  if (!isPembuatAtauOwner) return gagal(403, "Hanya pembuat atau owner.");
  const t = await ambilTransfer(db, id);
  if (!t) return gagal(404, "Permintaan tidak ditemukan.");
  if (t.tujuan.some((x) => x.status === "menunggu")) {
    return gagal(409, "Masih ada tujuan yang belum final.");
  }
  const at = sekarang();
  await db.batch([
    db.prepare("UPDATE transfers SET status = 'selesai' WHERE id = ?").bind(id),
    db.prepare("INSERT INTO transfer_status_log (transfer_id, status, oleh, at) VALUES (?, 'selesai', ?, ?)").bind(id, oleh, at),
  ]);
  const segar = await ambilTransfer(db, id);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, transfer: segar };
}

/** Ubah item: hanya bila dokumen masih menunggu (belum ada tujuan maju). */
export async function ubahItemTransfer(
  db: D1Database,
  id: string,
  items: { kode_barang: string; qty: number }[],
  oleh: string | null
): Promise<Hasil<{ transfer: TransferDoc }>> {
  const t = await ambilTransfer(db, id);
  if (!t) return gagal(404, "Permintaan tidak ditemukan.");
  if (t.status !== "menunggu") return gagal(409, "Permintaan sudah diproses.");
  const daftar = gabungItems(items);
  if (daftar.size === 0 || daftar.size > MAKS_ITEM) return gagal(400, "Item tidak valid (1–200 item unik).");
  for (const sku of daftar.keys()) {
    const p = await db.prepare("SELECT sku FROM products WHERE sku = ?").bind(sku).first();
    if (!p) return gagal(404, `Produk ${sku} tidak dikenal.`);
  }
  const at = sekarang();
  for (const d of t.tujuan) {
    if (d.items.length === 0) {
      for (const [sku, qty] of daftar) {
        await db.prepare("INSERT INTO transfer_items (destination_id, sku, qty) VALUES (?, ?, ?)").bind(d.db_id, sku, qty).run();
      }
    }
  }
  await db.prepare("INSERT INTO transfer_status_log (transfer_id, status, oleh, at) VALUES (?, 'ubah_item', ?, ?)").bind(id, oleh, at).run();
  const segar = await ambilTransfer(db, id);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, transfer: segar };
}

/** Tolak dokumen: hanya bila semua tujuan masih menunggu (belum maju). */
export async function tolakDokumen(
  db: D1Database,
  id: string,
  oleh: string | null
): Promise<Hasil<{ transfer: TransferDoc }>> {
  const t = await ambilTransfer(db, id);
  if (!t) return gagal(404, "Permintaan tidak ditemukan.");
  if (t.status !== "menunggu") return gagal(409, "Permintaan sudah diproses.");
  if (t.tujuan.some((x) => x.status_kirim !== "menunggu")) {
    return gagal(409, "Permintaan sudah diproses.");
  }
  const at = sekarang();
  await db.batch([
    db.prepare("UPDATE transfers SET status = 'ditolak' WHERE id = ?").bind(id),
    db.prepare("INSERT INTO transfer_status_log (transfer_id, status, oleh, at) VALUES (?, 'ditolak', ?, ?)").bind(id, oleh, at),
  ]);
  const segar = await ambilTransfer(db, id);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, transfer: segar };
}

export async function batalTransfer(
  db: D1Database,
  id: string,
  oleh: string | null,
  isPembuatAtauOwner: boolean
): Promise<Hasil<{ transfer: TransferDoc }>> {
  if (!isPembuatAtauOwner) return gagal(403, "Hanya pembuat atau owner.");
  const t = await ambilTransfer(db, id);
  if (!t) return gagal(404, "Permintaan tidak ditemukan.");
  if (t.tujuan.some((x) => x.status_kirim === "dikirim")) {
    return gagal(409, "Sudah ada tujuan yang dikirim.");
  }
  const at = sekarang();
  await db.batch([
    db.prepare("UPDATE transfers SET status = 'dibatalkan' WHERE id = ?").bind(id),
    db.prepare("INSERT INTO transfer_status_log (transfer_id, status, oleh, at) VALUES (?, 'dibatalkan', ?, ?)").bind(id, oleh, at),
  ]);
  const segar = await ambilTransfer(db, id);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, transfer: segar };
}

export async function listTransfer(
  db: D1Database,
  filter: { status?: string; dari_gudang_id?: string; tujuan_id?: string; limit?: number } = {}
): Promise<TransferDoc[]> {
  let sql = "SELECT id FROM transfers WHERE 1=1";
  const args: unknown[] = [];
  if (filter.status) {
    sql += " AND status = ?";
    args.push(filter.status);
  }
  if (filter.dari_gudang_id) {
    sql += " AND dari_warehouse_id = ?";
    args.push(filter.dari_gudang_id);
  }
  if (filter.tujuan_id) {
    sql += " AND id IN (SELECT transfer_id FROM transfer_destinations WHERE dest_warehouse_id = ?)";
    args.push(filter.tujuan_id);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(Math.min(filter.limit ?? 50, 200));
  const { results } = await db.prepare(sql).bind(...args).all<{ id: string }>();
  const keluar: TransferDoc[] = [];
  for (const r of results) {
    const t = await ambilTransfer(db, r.id);
    if (t) keluar.push(t);
  }
  return keluar;
}
