// app/api/laba/route.ts — Hitung laba per preset (A3, mesin baru hitungLabaPreset).
// POST { aksi:'hitung'|'simpan', presetId, rows, file?, tanggal? }.
// GET ?aksi=muat&presetId=&tanggal= | ?aksi=list&presetId=&limit= | ?aksi=pdf&presetId=&tanggal=.
import { getDb } from "@/lib/d1/db";
import { hitungDanSimpan, siapkanHitung } from "@/lib/d1/labaPreset";
import { bangunPdfLaba } from "@/lib/d1/labaPdf";
import { tanggalJakarta } from "@/lib/d1/labaShopee";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

const MAKS_BARIS = 10000;

function presetIdBody(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi");
  const presetId = Number(url.searchParams.get("presetId"));
  if (!Number.isInteger(presetId) || presetId <= 0) {
    return json({ ok: false, error: "presetId wajib diisi." }, 400);
  }
  const db = getDb();

  if (aksi === "muat") {
    const tanggal = (url.searchParams.get("tanggal") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ ok: false, error: "Tanggal harus YYYY-MM-DD." }, 400);
    const snap = await db.prepare("SELECT * FROM laba_snapshot WHERE preset_id = ? AND tanggal = ?")
      .bind(presetId, tanggal).first<Record<string, unknown>>();
    if (!snap) return json({ ok: true, snapshot: null });
    return json({
      ok: true,
      snapshot: {
        tanggal: snap["tanggal"], jml_order: snap["jml_order"], jml_baris: snap["jml_baris"],
        omzet: snap["omzet"], hpp: snap["hpp"], biaya: snap["biaya"], pajak: (snap["pajak"] as number) ?? 0, laba: snap["laba"],
        tolak: JSON.parse(String(snap["tolak_json"] ?? "[]")),
        rincian: JSON.parse(String(snap["rincian_json"] ?? "[]")),
        peringatan: JSON.parse(String(snap["peringatan_json"] ?? "[]")),
        file: snap["file"],
      },
    });
  }

  if (aksi === "list") {
    const limitRaw = Number(url.searchParams.get("limit") ?? "30");
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 30;
    const { results } = await db.prepare(
      "SELECT tanggal, jml_order, laba FROM laba_snapshot WHERE preset_id = ? ORDER BY tanggal DESC LIMIT ?"
    ).bind(presetId, limit).all<{ tanggal: string; jml_order: number; laba: number }>();
    return json({ ok: true, daftar: results });
  }

  if (aksi === "pdf") {
    const tanggal = (url.searchParams.get("tanggal") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ ok: false, error: "Tanggal harus YYYY-MM-DD." }, 400);
    const snap = await db.prepare("SELECT * FROM laba_snapshot WHERE preset_id = ? AND tanggal = ?")
      .bind(presetId, tanggal).first<Record<string, unknown>>();
    if (!snap) return json({ ok: false, error: "Snapshot tidak ditemukan." }, 404);
    const preset = await db.prepare("SELECT nama, status_toko FROM seller_presets WHERE id = ?")
      .bind(presetId).first<{ nama: string; status_toko: string }>();
    const omzet = Number(snap["omzet"] ?? 0);
    const laba = Number(snap["laba"] ?? 0);
    const pdf = await bangunPdfLaba({
      presetNama: preset?.nama ?? `#${presetId}`, statusToko: preset?.status_toko ?? "-",
      tanggal: String(snap["tanggal"]), file: String(snap["file"] ?? ""),
      jml_order: Number(snap["jml_order"] ?? 0), jml_baris: Number(snap["jml_baris"] ?? 0),
      omzet, hpp: Number(snap["hpp"] ?? 0), biaya: Number(snap["biaya"] ?? 0),
      pajak: Number(snap["pajak"] ?? 0), laba, margin: omzet > 0 ? (laba / omzet) * 100 : 0,
      tolak: JSON.parse(String(snap["tolak_json"] ?? "[]")),
      peringatan: JSON.parse(String(snap["peringatan_json"] ?? "[]")),
      rincian: JSON.parse(String(snap["rincian_json"] ?? "[]")),
    });
    return new Response(pdf as unknown as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="laba-${presetId}-${tanggal}.pdf"`,
      },
    });
  }

  return json({ ok: false, error: "Aksi tidak dikenal (muat/list/pdf)." }, 400);
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  if (aksi !== "hitung" && aksi !== "simpan") return json({ ok: false, error: "Aksi tidak dikenal (hitung/simpan)." }, 400);

  const presetId = presetIdBody(body.presetId);
  if (!presetId) return json({ ok: false, error: "presetId wajib diisi." }, 400);
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) return json({ ok: false, error: "Rows kosong." }, 400);
  if (rows.length > MAKS_BARIS) return json({ ok: false, error: `Maksimal ${MAKS_BARIS} baris per hitung.` }, 400);
  const file = typeof body.file === "string" ? body.file.trim().slice(0, 120) : "";

  const db = getDb();
  const siap = await siapkanHitung(db, presetId);
  if (!siap) return json({ ok: false, error: "Preset tidak ditemukan." }, 404);

  const tanggalRaw = typeof body.tanggal === "string" ? body.tanggal.trim() : "";
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(tanggalRaw) ? tanggalRaw : tanggalJakarta();
  const { agregat } = await hitungDanSimpan(
    db, siap, rows as Record<string, unknown>[], file, tanggal, user.tg_id, aksi === "simpan"
  );
  if (aksi === "hitung") return json({ ok: true, agregat });
  return json({ ok: true, tanggal, agregat });
}
