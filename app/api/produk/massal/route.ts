// app/api/produk/massal/route.ts — Aksi massal master produk (A-M1).
// POST { aksi:'set-kategori'|'set-pre-order'|'set-ukuran', sku: string[], nilai } (owner).
// POST { aksi:'set-penghitung', presetId, bergabung_sejak?, upload_produk_pertama? }.
import { getDb } from "@/lib/d1/db";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat aksi massal." }, 403);
  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  const db = getDb();

  if (aksi === "set-penghitung") {
    const presetId = body.presetId;
    if (typeof presetId !== "number" || !Number.isInteger(presetId)) {
      return json({ ok: false, error: "presetId wajib angka." }, 400);
    }
    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const k of ["bergabung_sejak", "upload_produk_pertama"] as const) {
      if (body[k] !== undefined) {
        const v = teks(body[k]);
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return json({ ok: false, error: `${k} harus YYYY-MM-DD.` }, 400);
        cols.push(`${k} = ?`);
        vals.push(v || null);
      }
    }
    if (cols.length === 0) return json({ ok: false, error: "Tak ada field diubah." }, 400);
    vals.push(presetId);
    await db.prepare(
      "INSERT INTO preset_penghitung (preset_id) VALUES (?) ON CONFLICT(preset_id) DO NOTHING"
    ).bind(presetId).run();
    await db.prepare(`UPDATE preset_penghitung SET ${cols.join(", ")} WHERE preset_id = ?`).bind(...vals).run();
    return json({ ok: true });
  }

  const daftar = Array.isArray(body.sku) ? body.sku.map((s) => teks(s).toUpperCase()).filter(Boolean) : [];
  if (daftar.length === 0) return json({ ok: false, error: "sku kosong." }, 400);
  if (daftar.length > 500) return json({ ok: false, error: "Maksimal 500 SKU per aksi." }, 400);

  if (aksi === "set-kategori") {
    const kat = teks(body.nilai);
    if (!kat) return json({ ok: false, error: "nilai kategori wajib diisi." }, 400);
    const cocok = await db.prepare("SELECT kategori_path FROM kategori_tarif WHERE kategori_path = ?")
      .bind(kat).first<{ kategori_path: string }>();
    if (!cocok) return json({ ok: false, error: "Kategori tak ada di kategori_tarif." }, 400);
    for (let i = 0; i < daftar.length; i += 100) {
      const chunk = daftar.slice(i, i + 100);
      await db.batch(chunk.map((s) => db.prepare("UPDATE products SET kategori = ? WHERE sku = ?").bind(kat, s)));
    }
    return json({ ok: true, count: daftar.length });
  }
  if (aksi === "set-pre-order" || aksi === "set-ukuran") {
    const s = teks(body.nilai).toLowerCase();
    if (s !== "ya" && s !== "tidak") return json({ ok: false, error: "nilai harus ya/tidak." }, 400);
    const kolom = aksi === "set-pre-order" ? "pre_order" : "ukuran_khusus";
    const v = s === "ya" ? 1 : 0;
    for (let i = 0; i < daftar.length; i += 100) {
      const chunk = daftar.slice(i, i + 100);
      await db.batch(chunk.map((sku) => db.prepare(`UPDATE products SET ${kolom} = ? WHERE sku = ?`).bind(v, sku)));
    }
    return json({ ok: true, count: daftar.length });
  }
  if (aksi === "set-go") {
    const g = teks(body.nilai).toUpperCase();
    if (g && !/^[A-H]$/.test(g)) return json({ ok: false, error: "nilai harus A–H (kosong = ikut kategori)." }, 400);
    for (let i = 0; i < daftar.length; i += 100) {
      const chunk = daftar.slice(i, i + 100);
      await db.batch(chunk.map((sku) => db.prepare("UPDATE products SET go_override = ? WHERE sku = ?").bind(g || null, sku)));
    }
    return json({ ok: true, count: daftar.length });
  }
  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
