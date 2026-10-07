// lib/d1/permintaan.ts — Permintaan harian di D1 (Fase 1, paritas
// lib/models/dailyRequests.js v3a). Identitas item = sku+variasi+buffer+status.
// Snapshot B2 (qty_diminta) hanya di buat-form; auto-selesai B6 di-transaksi.
import { gagal, sekarang, type Hasil } from "./db";

export type ItemMasuk = { kode_barang: string; nama?: string; variasi?: string; qty: number; buffer?: boolean };

export type DailyItem = {
  id: number; sku: string; nama: string | null; variasi: string; qty: number;
  buffer: number; status: string; qty_diminta: number | null; qty_datang: number | null;
};

export type DailyDoc = {
  tanggal: string; status: string; items: DailyItem[];
};

export function tanggalHariIni(): string {
  const wib = new Date(Date.now() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}

export async function ambilDaily(db: D1Database, tanggal: string): Promise<DailyDoc | null> {
  const h = await db.prepare("SELECT tanggal, status FROM daily_requests WHERE tanggal = ?").bind(tanggal).first<{ tanggal: string; status: string }>();
  if (!h) return null;
  const { results } = await db.prepare("SELECT * FROM daily_request_items WHERE tanggal = ? ORDER BY sku ASC, variasi ASC").bind(tanggal).all<DailyItem>();
  return { ...h, items: results };
}

export async function tambahItem(
  db: D1Database, tanggal: string, item: ItemMasuk, oleh: string | null
): Promise<Hasil<{ doc: DailyDoc }>> {
  const sku = String(item.kode_barang);
  const qty = Math.floor(Number(item.qty));
  if (!sku || !Number.isInteger(qty) || qty < 1) return gagal(400, "Item tidak valid.");
  const p = await db.prepare("SELECT sku FROM products WHERE sku = ?").bind(sku).first();
  if (!p) return gagal(404, `Produk ${sku} tidak ditemukan.`);
  await db.prepare("INSERT OR IGNORE INTO daily_requests (tanggal, status) VALUES (?, 'draft')").bind(tanggal).run();
  const variasi = item.variasi ?? "-";
  const buffer = item.buffer === true ? 1 : 0;
  const ada = await db.prepare("SELECT id, qty FROM daily_request_items WHERE tanggal = ? AND sku = ? AND variasi = ? AND buffer = ? AND status = 'diminta'").bind(tanggal, sku, variasi, buffer).first<{ id: number; qty: number }>();
  const at = sekarang();
  if (ada) {
    await db.batch([
      db.prepare("UPDATE daily_request_items SET qty = ? WHERE id = ?").bind(ada.qty + qty, ada.id),
      db.prepare("INSERT INTO daily_request_changes (tanggal, key_item, qty_lama, qty_baru, oleh, at) VALUES (?, ?, ?, ?, ?, ?)").bind(tanggal, `${sku}::${variasi}::${buffer}`, ada.qty, ada.qty + qty, oleh, at),
    ]);
  } else {
    await db.prepare("INSERT INTO daily_request_items (tanggal, sku, nama, variasi, qty, buffer) VALUES (?, ?, ?, ?, ?, ?)").bind(tanggal, sku, item.nama ?? null, variasi, qty, buffer).run();
  }
  // Retensi 50 perubahan terakhir per tanggal
  await db.prepare("DELETE FROM daily_request_changes WHERE tanggal = ? AND id NOT IN (SELECT id FROM daily_request_changes WHERE tanggal = ? ORDER BY id DESC LIMIT 50)").bind(tanggal, tanggal).run();
  const doc = await ambilDaily(db, tanggal);
  if (!doc) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, doc };
}

export async function sesuaikanQty(
  db: D1Database, tanggal: string, sku: string, variasi: string, buffer: boolean, qtyBaru: number, oleh: string | null
): Promise<Hasil<{ doc: DailyDoc }>> {
  if (!Number.isInteger(qtyBaru) || qtyBaru < 0) return gagal(400, "Qty harus bilangan bulat >= 0.");
  const baris = await db.prepare("SELECT id, qty, status FROM daily_request_items WHERE tanggal = ? AND sku = ? AND variasi = ? AND buffer = ? AND status = 'diminta'").bind(tanggal, sku, variasi ?? "-", buffer ? 1 : 0).first<{ id: number; qty: number; status: string }>();
  if (!baris) return gagal(404, "Item tidak ditemukan.");
  const at = sekarang();
  await db.batch([
    db.prepare("UPDATE daily_request_items SET qty = ? WHERE id = ?").bind(qtyBaru, baris.id),
    db.prepare("INSERT INTO daily_request_changes (tanggal, key_item, qty_lama, qty_baru, oleh, at) VALUES (?, ?, ?, ?, ?, ?)").bind(tanggal, `${sku}::${variasi}::${buffer}`, baris.qty, qtyBaru, oleh, at),
    db.prepare("UPDATE daily_requests SET updated_at = ?, updated_by = ? WHERE tanggal = ?").bind(at, oleh, tanggal),
  ]);
  const doc = await ambilDaily(db, tanggal);
  if (!doc) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, doc };
}

function efektifSelesai(i: DailyItem): boolean {
  if (i.status === "datang") return true;
  return (i.qty_diminta ?? i.qty) === 0;
}

export async function buatForm(db: D1Database, tanggal: string, oleh: string | null): Promise<Hasil<{ doc: DailyDoc }>> {
  const doc = await ambilDaily(db, tanggal);
  if (!doc) return gagal(404, "Permintaan tidak ditemukan.");
  if (doc.items.length === 0) return gagal(400, "Permintaan belum berisi item.");
  if (doc.items.every(efektifSelesai)) return gagal(400, "Semua item sudah datang.");
  const at = sekarang();
  const stmts: D1PreparedStatement[] = [
    db.prepare("UPDATE daily_requests SET status = 'diproses', form_dibuat_at = ?, form_dibuat_by = ?, updated_at = ?, updated_by = ? WHERE tanggal = ?").bind(at, oleh, at, oleh, tanggal),
  ];
  for (const it of doc.items) {
    if (it.status !== "datang") {
      stmts.push(db.prepare("UPDATE daily_request_items SET qty_diminta = ? WHERE id = ?").bind(it.qty, it.id));
    }
  }
  await db.batch(stmts);
  const segar = await ambilDaily(db, tanggal);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, doc: segar };
}

export async function tandaiDatang(
  db: D1Database, tanggal: string, sku: string, variasi: string, buffer: boolean, qtyDatang: number, oleh: string | null
): Promise<Hasil<{ doc: DailyDoc; selesai_otomatis: boolean }>> {
  if (!Number.isInteger(qtyDatang) || qtyDatang < 0) return gagal(400, "Qty datang tidak valid.");
  const baris = await db.prepare("SELECT id FROM daily_request_items WHERE tanggal = ? AND sku = ? AND variasi = ? AND buffer = ? AND status = 'diminta'").bind(tanggal, sku, variasi ?? "-", buffer ? 1 : 0).first<{ id: number }>();
  if (!baris) return gagal(404, "Item tidak ditemukan atau sudah datang.");
  const at = sekarang();
  await db.prepare("UPDATE daily_request_items SET status = 'datang', qty_datang = ?, datang_at = ?, datang_by = ? WHERE id = ?").bind(qtyDatang, at, oleh, baris.id).run();
  const doc = await ambilDaily(db, tanggal);
  if (!doc) return gagal(500, "Gagal membaca permintaan.");
  const selesaiOtomatis = doc.items.every(efektifSelesai);
  if (selesaiOtomatis) {
    await db.prepare("UPDATE daily_requests SET status = 'selesai', selesai_at = ?, selesai_by = ?, updated_at = ?, updated_by = ? WHERE tanggal = ?").bind(at, oleh, at, oleh, tanggal).run();
    const segar = await ambilDaily(db, tanggal);
    if (!segar) return gagal(500, "Gagal membaca permintaan.");
    return { ok: true, doc: segar, selesai_otomatis: true };
  }
  return { ok: true, doc, selesai_otomatis: false };
}

export async function selesaikan(db: D1Database, tanggal: string, oleh: string | null): Promise<Hasil<{ doc: DailyDoc }>> {
  const doc = await ambilDaily(db, tanggal);
  if (!doc) return gagal(404, "Permintaan tidak ditemukan.");
  const adaDatang = doc.items.some((i) => i.status === "datang");
  const semuaNol = doc.items.length > 0 && doc.items.every((i) => (i.qty_diminta ?? i.qty) === 0);
  if (!adaDatang && !semuaNol) return gagal(400, "Belum ada item yang datang.");
  const at = sekarang();
  await db.prepare("UPDATE daily_requests SET status = 'selesai', selesai_at = ?, selesai_by = ?, updated_at = ?, updated_by = ? WHERE tanggal = ?").bind(at, oleh, at, oleh, tanggal).run();
  const segar = await ambilDaily(db, tanggal);
  if (!segar) return gagal(500, "Gagal membaca permintaan.");
  return { ok: true, doc: segar };
}
