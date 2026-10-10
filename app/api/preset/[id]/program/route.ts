// app/api/preset/[id]/program/route.ts — Toggle program per preset (A-R1).
// GET daftar program+toggle · POST aksi toggle/set-aktif-sejak/set-aturan.
import { getDb } from "@/lib/d1/db";
import { listProgram, setProgram, tambahAturan } from "@/lib/d1/preset";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

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
  const { results: aturan } = await db.prepare(
    "SELECT * FROM fee_rules WHERE preset_id = ? AND kode_program IS NOT NULL ORDER BY kode_program, kategori"
  ).bind(id).all<Record<string, unknown>>();
  return json({ ok: true, program: await listProgram(db, id), aturan });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah program." }, 403);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ ok: false, error: "id preset tak valid." }, 400);
  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  const db = getDb();
  if (!(await presetAda(db, id))) return json({ ok: false, error: "Preset tidak ditemukan." }, 404);

  if (aksi === "toggle" || aksi === "set-aktif-sejak") {
    const kode = String(body.kode_program ?? "");
    if (!kode) return json({ ok: false, error: "kode_program wajib diisi." }, 400);
    const cur = await db.prepare(
      "SELECT aktif FROM preset_program WHERE preset_id = ? AND kode_program = ?"
    ).bind(id, kode).first<{ aktif: number }>();
    const aktif = aksi === "toggle" ? !(cur?.aktif === 1) : cur?.aktif === 1;
    const hasil = await setProgram(
      db, id, kode, aktif,
      body.aktif_sejak === undefined ? null : (body.aktif_sejak as string | null),
      body.aktif_sampai === undefined ? null : (body.aktif_sampai as string | null)
    );
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, kode: hasil.kode, aktif });
  }

  if (aksi === "set-aturan") {
    // Ubah tarif matriks: tambah bila belum ada (cocok kode+kategori+ukuran+status), else update nilai.
    const kode = String(body.kode_program ?? "");
    const kategori = String(body.kategori ?? "*");
    const ukuran = (body.ukuran as string | null) ?? null;
    const statusToko = (body.status_toko as string | null) ?? null;
    if (!kode) return json({ ok: false, error: "kode_program wajib diisi." }, 400);
    const ada = await db.prepare(
      "SELECT id FROM fee_rules WHERE preset_id = ? AND kode_program = ? AND kategori = ? " +
      "AND IFNULL(ukuran,'') = IFNULL(?, '') AND IFNULL(status_toko,'') = IFNULL(?, '')"
    ).bind(id, kode, kategori, ukuran, statusToko).first<{ id: number }>();
    if (ada) {
      await db.prepare("UPDATE fee_rules SET nilai = ?, plafon_per_qty = ? WHERE id = ?")
        .bind(Number(body.nilai), body.plafon_per_qty == null ? null : Number(body.plafon_per_qty), ada.id).run();
      return json({ ok: true, id: ada.id });
    }
    const hasil = await tambahAturan(db, id, {
      jenis: "program", kode_program: kode, kategori, status_toko: statusToko, ukuran,
      basis: "persen", unit: "per_baris", nilai: Number(body.nilai),
      plafon_per_qty: body.plafon_per_qty == null ? null : Number(body.plafon_per_qty),
      valid_from: String(body.valid_from ?? "2026-01-01"),
    });
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, id: hasil.id });
  }

  return json({ ok: false, error: "Aksi tidak dikenal (toggle/set-aktif-sejak/set-aturan)." }, 400);
}
