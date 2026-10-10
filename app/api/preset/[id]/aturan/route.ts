// app/api/preset/[id]/aturan/route.ts — Kelola fee_rules per preset (A2).
// GET daftar · POST tambah/reset-seed · PUT ubah · DELETE hapus (lunak bila ada snapshot).
import { getDb } from "@/lib/d1/db";
import { hapusAturan, listProgram, resetSeed, setProgram, tambahAturan, ubahAturan } from "@/lib/d1/preset";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import seedJson from "@/bundle/seed/shopee_fees_id.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function presetAda(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare("SELECT id FROM seller_presets WHERE id = ? AND dihapus_at IS NULL")
    .bind(id).first<{ id: number }>();
  return !!r;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ ok: false, error: "id preset tak valid." }, 400);
  const db = getDb();
  if (!(await presetAda(db, id))) return json({ ok: false, error: "Preset tidak ditemukan." }, 404);
  const { results } = await db.prepare("SELECT * FROM fee_rules WHERE preset_id = ? ORDER BY jenis, kategori")
    .bind(id).all<Record<string, unknown>>();
  const program = await listProgram(db, id);
  return json({ ok: true, aturan: results, program });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah aturan." }, 403);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ ok: false, error: "id preset tak valid." }, 400);
  const body = await bacaBody(request);
  const db = getDb();
  if (!(await presetAda(db, id))) return json({ ok: false, error: "Preset tidak ditemukan." }, 404);

  if (body.aksi === "reset-seed") {
    const seed = (seedJson as { rules: Record<string, unknown>[] }).rules.map((r) => ({
      jenis: String(r["jenis"]),
      kode_program: (r["kode_program"] as string | null) ?? null,
      kategori: String(r["kategori"] ?? "*"),
      status_toko: (r["status_toko"] as string | null) ?? null,
      ukuran: (r["ukuran"] as string | null) ?? null,
      basis: String(r["basis"]),
      unit: String(r["unit"] ?? "per_baris"),
      nilai: Number(r["nilai"]),
      plafon_per_qty: (r["plafon_per_qty"] as number | null) ?? null,
      priority: 0,
      valid_from: String(r["valid_from"]),
      valid_to: (r["valid_to"] as string | null) ?? null,
      syarat_json: r["syarat"] ? JSON.stringify(r["syarat"]) : null,
      sumber: `seed:${String(r["sumber"])}`,
      verifikasi: String(r["verifikasi"] ?? "belum"),
      catatan: (r["catatan"] as string | null) ?? null,
    }));
    const hasil = await resetSeed(db, id, seed);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, diubah: hasil.diubah });
  }

  const hasil = await tambahAturan(db, id, {
    jenis: String(body.jenis ?? ""),
    kode_program: (body.kode_program as string | null) ?? null,
    kategori: String(body.kategori ?? "*"),
    status_toko: (body.status_toko as string | null) ?? null,
    ukuran: (body.ukuran as string | null) ?? null,
    basis: String(body.basis ?? ""),
    unit: String(body.unit ?? "per_baris"),
    nilai: Number(body.nilai),
    plafon: body.plafon == null ? null : Number(body.plafon),
    plafon_per_qty: body.plafon_per_qty == null ? null : Number(body.plafon_per_qty),
    priority: body.priority == null ? 0 : Number(body.priority),
    valid_from: String(body.valid_from ?? ""),
    valid_to: (body.valid_to as string | null) ?? null,
    syarat_json: (body.syarat_json as string | null) ?? null,
    sumber: (body.sumber as string | null) ?? null,
    verifikasi: String(body.verifikasi ?? "belum"),
    catatan: (body.catatan as string | null) ?? null,
  });
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, id: hasil.id });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah aturan." }, 403);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ ok: false, error: "id preset tak valid." }, 400);
  const body = await bacaBody(request);
  if (typeof body.rule_id !== "number") return json({ ok: false, error: "rule_id wajib angka." }, 400);
  const db = getDb();
  if (!(await presetAda(db, id))) return json({ ok: false, error: "Preset tidak ditemukan." }, 404);
  const patch: Record<string, unknown> = {};
  for (const k of ["jenis", "kode_program", "kategori", "status_toko", "ukuran", "basis", "unit",
    "nilai", "plafon", "plafon_per_qty", "priority", "valid_from", "valid_to",
    "syarat_json", "sumber", "verifikasi", "catatan", "aktif"]) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  const hasil = await ubahAturan(db, id, body.rule_id, patch as Parameters<typeof ubahAturan>[3]);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, id: hasil.id });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat menghapus aturan." }, 403);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ ok: false, error: "id preset tak valid." }, 400);
  const url = new URL(request.url);
  const ruleId = Number(url.searchParams.get("rule_id"));
  if (!Number.isInteger(ruleId)) return json({ ok: false, error: "rule_id wajib angka." }, 400);
  const db = getDb();
  if (!(await presetAda(db, id))) return json({ ok: false, error: "Preset tidak ditemukan." }, 404);
  const hasil = await hapusAturan(db, id, ruleId);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, id: hasil.id, lunak: hasil.lunak });
}
