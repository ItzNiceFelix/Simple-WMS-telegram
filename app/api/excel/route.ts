// app/api/excel/route.ts — Import 2-fase + export Excel (Fase 2, PRD F3).
// POST multipart { file, sheet?, gudang_id? } → parse SheetJS (≤5MB) →
//   validasi per baris → simpan import_batches + import_errors → balas preview
//   { batch_id, sukses[], gagal[{baris, pesan}] }.
// POST { aksi:"konfirmasi", batch_id } → eksekusi batch atomik D1
//   (INSERT ... ON CONFLICT upsert, chunk 100).
// GET ?format=export&tipe=produk|stok|hpp&gudang_id=&q= → file .xlsx.
// Semua owner/admin; tulis butuh owner untuk konfirmasi massal? Tidak —
// admin boleh (scope gudang dicek saat tulis stok).
import { getDb } from "@/lib/d1/db";
import { normalisasiNama } from "@/lib/d1/produk";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAKS_FILE = 5 * 1024 * 1024;

type BarisValid = {
  sku: string; nama: string; satuan: string; stokAwal: number;
  hpp: number | null; kategori: string | null; stokMin: number | null; barcode: string | null;
  gudang: string | null;
};

function angkaBaris(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Math.floor(Number(v));
  return Number.isInteger(n) && n >= 0 ? n : NaN as unknown as null;
}

function validasiBaris(row: Record<string, unknown>, noBaris: number): { ok: true; data: BarisValid } | { ok: false; pesan: string } {
  const sku = String(row["SKU*"] ?? row["SKU"] ?? "").trim().toUpperCase();
  const nama = String(row["Nama*"] ?? row["Nama"] ?? "").trim();
  const satuan = String(row["Satuan*"] ?? row["Satuan"] ?? "").trim() || "pcs";
  if (!sku) return { ok: false, pesan: `Baris ${noBaris}: SKU wajib diisi.` };
  if (/\s/.test(sku)) return { ok: false, pesan: `Baris ${noBaris}: SKU tanpa spasi.` };
  if (!nama) return { ok: false, pesan: `Baris ${noBaris}: Nama wajib diisi.` };
  const stokAwal = angkaBaris(row["StokAwal"]);
  if (stokAwal !== null && Number.isNaN(stokAwal as unknown as number)) return { ok: false, pesan: `Baris ${noBaris}: StokAwal harus >= 0.` };
  const hpp = angkaBaris(row["HPP"]);
  if (hpp !== null && Number.isNaN(hpp as unknown as number)) return { ok: false, pesan: `Baris ${noBaris}: HPP harus >= 0.` };
  const stokMin = angkaBaris(row["StokMin"]);
  if (stokMin !== null && Number.isNaN(stokMin as unknown as number)) return { ok: false, pesan: `Baris ${noBaris}: StokMin harus >= 0.` };
  const barcode = String(row["Barcode"] ?? "").trim() || null;
  const expired = String(row["Expired(YYYY-MM-DD)"] ?? row["Expired"] ?? "").trim();
  if (expired && !/^\d{4}-\d{2}-\d{2}$/.test(expired)) return { ok: false, pesan: `Baris ${noBaris}: Expired harus YYYY-MM-DD.` };
  const aktif = String(row["Aktif"] ?? "YA").trim().toUpperCase();
  if (!["YA", "TIDAK", ""].includes(aktif)) return { ok: false, pesan: `Baris ${noBaris}: Aktif = YA/TIDAK.` };
  return {
    ok: true,
    data: {
      sku, nama, satuan,
      stokAwal: stokAwal ?? 0,
      hpp: (hpp as number | null) ?? null,
      kategori: String(row["Kategori"] ?? "").trim() || null,
      stokMin: (stokMin as number | null) ?? null,
      barcode,
      gudang: String(row["Gudang"] ?? "").trim().toUpperCase() || null,
    },
  };
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const url = new URL(request.url);
  if (url.searchParams.get("format") !== "export") {
    return json({ ok: true, template: "/template-import-produk.xlsx" });
  }
  const tipe = url.searchParams.get("tipe") || "produk";
  const gudangId = url.searchParams.get("gudang_id") || "ONLINE";
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const db = getDb();
  const HEADER = ["SKU*", "Nama*", "Kategori", "Satuan*", "StokAwal", "HPP", "HargaJual", "RakBin", "StokMin", "Barcode", "Expired(YYYY-MM-DD)", "Aktif"];
  let rows: (string | number | null)[][] = [HEADER];
  if (tipe === "stok") {
    const { results } = await db.prepare(
      `SELECT p.sku, p.nama_accurate, b.qty FROM products p JOIN stock_by_bin b ON b.sku = p.sku
       WHERE b.warehouse_id = ? ${q ? "AND (lower(p.sku) LIKE ? OR lower(p.nama_accurate) LIKE ?)" : ""} ORDER BY p.sku LIMIT 5000`
    ).bind(...(q ? [gudangId, `%${q}%`, `%${q}%`] : [gudangId])).all<{ sku: string; nama_accurate: string; qty: number }>();
    rows = [["SKU", "Nama", `Stok@${gudangId}`, "Status"], ...results.map((r) => [r.sku, r.nama_accurate, r.qty, r.qty < 0 ? "minus" : "ok"])];
  } else if (tipe === "hpp") {
    const { results } = await db.prepare(
      `SELECT sku, nama_accurate, hpp, hpp_baru FROM products ${q ? "WHERE lower(sku) LIKE ? OR lower(nama_accurate) LIKE ?" : ""} ORDER BY sku LIMIT 5000`
    ).bind(...(q ? [`%${q}%`, `%${q}%`] : [])).all<{ sku: string; nama_accurate: string; hpp: number | null; hpp_baru: number | null }>();
    rows = [["SKU", "Nama", "HPP", "HPPBaru"], ...results.map((r) => [r.sku, r.nama_accurate, r.hpp, r.hpp_baru])];
  } else {
    const { results } = await db.prepare(
      `SELECT p.sku, p.nama_accurate, p.hpp, p.stok_min, b.qty FROM products p LEFT JOIN stock_by_bin b ON b.sku = p.sku AND b.warehouse_id = ?
       ${q ? "WHERE lower(p.sku) LIKE ? OR lower(p.nama_accurate) LIKE ?" : ""} ORDER BY p.sku LIMIT 5000`
    ).bind(...(q ? [gudangId, `%${q}%`, `%${q}%`] : [gudangId])).all<{ sku: string; nama_accurate: string; hpp: number | null; stok_min: number | null; qty: number | null }>();
    rows = [HEADER, ...results.map((r) => [r.sku, r.nama_accurate, "", "pcs", r.qty ?? 0, r.hpp, "", "", r.stok_min, "", "", "YA"])];
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), tipe);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as unknown as Uint8Array;
  return new Response(new Blob([buf as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="export-${tipe}-${gudangId}.xlsx"`,
    },
  });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const db = getDb();
  const ct = request.headers.get("content-type") ?? "";

  // Konfirmasi batch
  if (ct.includes("application/json")) {
    const body = await bacaBody(request);
    if (body.aksi !== "konfirmasi" || typeof body.batch_id !== "number") {
      return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
    }
    const batch = await db.prepare("SELECT * FROM import_batches WHERE id = ? AND status = 'preview'").bind(body.batch_id).first<{ id: number; payload_json: string; gudang_id: string }>();
    if (!batch) return json({ ok: false, error: "Batch tidak ditemukan / sudah diproses." }, 404);
    let daftar: BarisValid[] = [];
    try {
      daftar = JSON.parse(batch.payload_json) as BarisValid[];
    } catch {
      return json({ ok: false, error: "Payload batch rusak." }, 500);
    }
    const gudangDefault = batch.gudang_id || "ONLINE";
    const diLuarScope = daftar.filter((b) => !user.is_owner && !user.scope_gudang.includes(b.gudang ?? gudangDefault));
    if (diLuarScope.length > 0) {
      return json({ ok: false, error: `Di luar scope gudang Anda: ${diLuarScope.slice(0, 3).map((b) => `${b.sku}@${b.gudang ?? gudangDefault}`).join(", ")}${diLuarScope.length > 3 ? ` (+${diLuarScope.length - 3})` : ""}.` }, 403);
    }
    const at = Math.floor(Date.now() / 1000);
    let sukses = 0;
    for (let i = 0; i < daftar.length; i += 50) {
      const chunk = daftar.slice(i, i + 50);
      const stmts: D1PreparedStatement[] = [];
      for (const b of chunk) {
        const g = b.gudang ?? gudangDefault;
        stmts.push(
          db.prepare(`INSERT INTO products (sku, nama_accurate, nama_accurate_normalized, hpp, stok_min, is_online_product, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(sku) DO UPDATE SET nama_accurate = excluded.nama_accurate, hpp = excluded.hpp, stok_min = excluded.stok_min, updated_at = excluded.updated_at`)
            .bind(b.sku, b.nama, normalisasiNama(b.nama), b.hpp, b.stokMin, at),
          db.prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty")
            .bind(b.sku, g, b.stokAwal),
          db.prepare("INSERT INTO stock_moves (sku, qty, jenis, gudang_id, source, status, created_by, at, by) VALUES (?, ?, 'restock', ?, 'web_dashboard', 'processed', ?, ?, ?)")
            .bind(b.sku, b.stokAwal, g, user.tg_id, at, user.tg_id)
        );
      }
      await db.batch(stmts);
      sukses += chunk.length;
    }
    await db.prepare("UPDATE import_batches SET status = 'done', sukses = ? WHERE id = ?").bind(sukses, batch.id).run();
    return json({ ok: true, sukses, batch_id: batch.id });
  }

  // Upload file (multipart)
  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, error: "File tidak ditemukan." }, 400);
  const file = form.get("file");
  if (!(file instanceof Blob)) return json({ ok: false, error: "File tidak ditemukan." }, 400);
  const buf = Buffer.from(await file.arrayBuffer());
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer" });
  } catch {
    return json({ ok: false, error: "File Excel tidak valid." }, 400);
  }
  const sheetName = typeof form.get("sheet") === "string" && form.get("sheet") ? String(form.get("sheet")) : (wb.SheetNames.includes("Produk") ? "Produk" : wb.SheetNames[0]);
  const ws = wb.Sheets[sheetName];
  if (!ws) return json({ ok: false, error: `Sheet ${sheetName} tidak ditemukan.` }, 400);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  if (rows.length === 0) return json({ ok: false, error: "Sheet kosong." }, 400);
  if (rows.length > 5000) return json({ ok: false, error: "Maksimal 5000 baris per import." }, 400);
  const gudangDefault = typeof form.get("gudang_id") === "string" && form.get("gudang_id") ? String(form.get("gudang_id")).trim().toUpperCase() : "ONLINE";

  const sukses: BarisValid[] = [];
  const gagal: { baris: number; pesan: string }[] = [];
  const lihatSkuGudang = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const noBaris = i + 2;
    const v = validasiBaris(rows[i], noBaris);
    if (!v.ok) {
      gagal.push({ baris: noBaris, pesan: v.pesan });
      continue;
    }
    const gudang = v.data.gudang ?? gudangDefault;
    const ada = await db.prepare("SELECT id FROM warehouses WHERE id = ? AND aktif = 1").bind(gudang).first<{ id: string }>();
    if (!ada) {
      gagal.push({ baris: noBaris, pesan: `Baris ${noBaris}: Gudang ${gudang} belum terdaftar — buat dulu di /gudang.` });
      continue;
    }
    const kunci = `${v.data.sku}|${gudang}`;
    if (lihatSkuGudang.has(kunci)) {
      gagal.push({ baris: noBaris, pesan: `Baris ${noBaris}: pasangan SKU ${v.data.sku} + Gudang ${gudang} duplikat dalam file.` });
      continue;
    }
    lihatSkuGudang.add(kunci);
    sukses.push({ ...v.data, gudang });
  }
  const ins = await db.prepare("INSERT INTO import_batches (tipe, file, total, sukses, gagal, gudang_id, payload_json, status, at, by) VALUES ('produk', ?, ?, ?, ?, ?, ?, 'preview', ?, ?)").bind(
    typeof file === "object" && "name" in file ? String((file as { name: string }).name).slice(0, 120) : "upload.xlsx",
    rows.length, sukses.length, gagal.length, gudangDefault, JSON.stringify(sukses), Math.floor(Date.now() / 1000), user.tg_id
  ).run();
  const batchId = Number(ins.meta.last_row_id);
  for (let i = 0; i < gagal.length; i += 100) {
    const chunk = gagal.slice(i, i + 100);
    await db.batch(chunk.map((g) => db.prepare("INSERT INTO import_errors (batch_id, baris, pesan) VALUES (?, ?, ?)").bind(batchId, g.baris, g.pesan)));
  }
  return json({ ok: true, batch_id: batchId, total: rows.length, sukses: sukses.length, gagal });
}
