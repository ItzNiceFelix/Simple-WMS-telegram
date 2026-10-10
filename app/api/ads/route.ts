// app/api/ads/route.ts — Biaya iklan harian per preset, input manual (A-R2/A-M2 K-2).
// GET ?presetId=&bulan=YYYY-MM → ringkasan bulanan (total iklan + total omzet snapshot + rasio).
// POST { presetId, tanggal, biaya } → upsert · DELETE ?presetId=&tanggal= → hapus.
import { getDb } from "@/lib/d1/db";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function presetAda(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare("SELECT id FROM seller_presets WHERE id = ? AND dihapus_at IS NULL")
    .bind(id).first<{ id: number }>();
  return !!r;
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const url = new URL(request.url);
  const presetId = Number(url.searchParams.get("presetId"));
  if (!Number.isInteger(presetId) || presetId <= 0) return json({ ok: false, error: "presetId wajib diisi." }, 400);
  const bulan = (url.searchParams.get("bulan") ?? "").trim() || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(bulan)) return json({ ok: false, error: "bulan harus YYYY-MM." }, 400);
  const db = getDb();
  if (!(await presetAda(db, presetId))) return json({ ok: false, error: "Preset tidak ditemukan." }, 404);
  const { results: harian } = await db.prepare(
    "SELECT tanggal, biaya_iklan_bersih FROM ads_harian WHERE preset_id = ? AND tanggal LIKE ? ORDER BY tanggal"
  ).bind(presetId, `${bulan}%`).all<{ tanggal: string; biaya_iklan_bersih: number }>();
  const totalIklan = harian.reduce((a, h) => a + h.biaya_iklan_bersih, 0);
  const jual = await db.prepare(
    "SELECT COALESCE(SUM(omzet), 0) AS omzet FROM laba_snapshot WHERE preset_id = ? AND tanggal LIKE ?"
  ).bind(presetId, `${bulan}%`).first<{ omzet: number }>();
  const omzet = jual?.omzet ?? 0;
  return json({
    ok: true, bulan, harian, totalIklan, omzet,
    rasio: omzet > 0 ? Math.round((totalIklan / omzet) * 1000) / 10 : null,
  });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengisi iklan." }, 403);
  const body = await bacaBody(request);
  const presetId = body.presetId;
  if (typeof presetId !== "number" || !Number.isInteger(presetId) || presetId <= 0) {
    return json({ ok: false, error: "presetId wajib angka." }, 400);
  }
  const tanggal = String(body.tanggal ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ ok: false, error: "tanggal harus YYYY-MM-DD." }, 400);
  const biaya = Number(body.biaya);
  if (!Number.isFinite(biaya) || biaya < 0) return json({ ok: false, error: "biaya harus angka ≥ 0." }, 400);
  const db = getDb();
  if (!(await presetAda(db, presetId))) return json({ ok: false, error: "Preset tidak ditemukan." }, 404);
  await db.prepare(
    "INSERT INTO ads_harian (preset_id, tanggal, biaya_iklan_bersih) VALUES (?, ?, ?) " +
    "ON CONFLICT(preset_id, tanggal) DO UPDATE SET biaya_iklan_bersih = excluded.biaya_iklan_bersih"
  ).bind(presetId, tanggal, Math.round(biaya)).run();
  return json({ ok: true, presetId, tanggal, biaya: Math.round(biaya) });
}

export async function DELETE(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat menghapus iklan." }, 403);
  const url = new URL(request.url);
  const presetId = Number(url.searchParams.get("presetId"));
  const tanggal = (url.searchParams.get("tanggal") ?? "").trim();
  if (!Number.isInteger(presetId) || presetId <= 0) return json({ ok: false, error: "presetId wajib diisi." }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ ok: false, error: "tanggal harus YYYY-MM-DD." }, 400);
  await getDb().prepare("DELETE FROM ads_harian WHERE preset_id = ? AND tanggal = ?")
    .bind(presetId, tanggal).run();
  return json({ ok: true });
}
