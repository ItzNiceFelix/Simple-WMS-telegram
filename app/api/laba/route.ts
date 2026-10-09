// app/api/laba/route.ts — Estimasi laba Shopee standalone (tak sentuh stok).
// POST { aksi:'hitung', rows, file?, marketplace? } → { ok, agregat } (tanpa simpan).
// POST { aksi:'simpan', rows, file?, tanggal?, marketplace? } → hitung + simpanLabaHarian (timpa per tanggal).
// GET ?aksi=muat&tanggal=YYYY-MM-DD → { ok, snapshot } (null bila belum ada).
// GET ?aksi=list&limit= → { ok, daftar } tanggal snapshot terbaru dulu.
// Semua owner/admin (rekap laba sensitif).
import { getDb } from "@/lib/d1/db";
import {
  ambilHppDb,
  hitungLabaShopee,
  listTanggalLaba,
  muatLabaHarian,
  simpanLabaHarian,
  tanggalJakarta,
  type BarisShopee,
} from "@/lib/d1/labaShopee";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAKS_BARIS = 10000;

async function presetsMp(db: D1Database, mp: string): Promise<{ basis: string; nilai: number }[]> {
  const { results } = await db
    .prepare("SELECT basis, nilai FROM mp_fee_presets WHERE marketplace = ?")
    .bind(mp)
    .all<{ basis: string; nilai: number }>();
  return results;
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi");
  const db = getDb();

  if (aksi === "muat") {
    const tanggal = (url.searchParams.get("tanggal") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ ok: false, error: "Tanggal harus YYYY-MM-DD." }, 400);
    const snapshot = await muatLabaHarian(db, tanggal);
    return json({ ok: true, snapshot });
  }

  if (aksi === "list") {
    const limitRaw = Number(url.searchParams.get("limit") ?? "30");
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 30;
    const daftar = await listTanggalLaba(db, limit);
    return json({ ok: true, daftar });
  }

  return json({ ok: false, error: "Aksi tidak dikenal (muat/list)." }, 400);
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  if (aksi !== "hitung" && aksi !== "simpan") return json({ ok: false, error: "Aksi tidak dikenal (hitung/simpan)." }, 400);

  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) return json({ ok: false, error: "Rows kosong." }, 400);
  if (rows.length > MAKS_BARIS) return json({ ok: false, error: `Maksimal ${MAKS_BARIS} baris per hitung.` }, 400);
  const mpRaw = typeof body.marketplace === "string" && body.marketplace.trim() ? body.marketplace.trim().toLowerCase() : "shopee";
  const file = typeof body.file === "string" ? body.file.trim().slice(0, 120) : "";

  const db = getDb();
  const presets = await presetsMp(db, mpRaw);
  const agregat = await hitungLabaShopee(rows as BarisShopee[], ambilHppDb(db), presets);

  if (aksi === "hitung") return json({ ok: true, agregat });

  const tanggalRaw = typeof body.tanggal === "string" ? body.tanggal.trim() : "";
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(tanggalRaw) ? tanggalRaw : tanggalJakarta();
  const hasil = await simpanLabaHarian(db, tanggal, agregat, file, user.tg_id, mpRaw);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, tanggal: hasil.tanggal, agregat });
}
