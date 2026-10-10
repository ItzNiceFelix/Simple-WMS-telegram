// app/api/produk/kategori/route.ts — Kategori + tier override per SKU (A-R3).
// GET ?belum_terpetakan=1 → daftar SKU belum terpetakan · PATCH { sku, kategori?, tier_override? }.
import { getDb } from "@/lib/d1/db";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const url = new URL(request.url);
  const db = getDb();
  if (url.searchParams.get("belum_terpetakan") === "1") {
    const { results: paths } = await db.prepare("SELECT kategori_path FROM kategori_tarif")
      .all<{ kategori_path: string }>();
    const himpunan = new Set(paths.map((p) => p.kategori_path));
    const { results: produk } = await db.prepare(
      "SELECT sku, nama_accurate, kategori, tier_override FROM products ORDER BY sku LIMIT 2000"
    ).all<{ sku: string; nama_accurate: string; kategori: string | null; tier_override: string | null }>();
    const belum = produk.filter((p) => !p.tier_override && (!p.kategori || !himpunan.has(p.kategori)));
    return json({ ok: true, jml: belum.length, produk: belum.slice(0, 200) });
  }
  const { results: semua } = await db.prepare("SELECT kategori_path, tier FROM kategori_tarif ORDER BY kategori_path")
    .all<{ kategori_path: string; tier: string }>();
  return json({ ok: true, kategori: semua });
}

export async function PATCH(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah kategori." }, 403);
  const body = await bacaBody(request);
  const sku = teks(body.sku).toUpperCase();
  if (!sku) return json({ ok: false, error: "sku wajib diisi." }, 400);
  const db = getDb();
  const ada = await db.prepare("SELECT sku FROM products WHERE sku = ?").bind(sku).first<{ sku: string }>();
  if (!ada) return json({ ok: false, error: "SKU tidak dikenal." }, 404);
  const patch: string[] = [];
  const vals: unknown[] = [];
  if (body.kategori !== undefined) {
    const kat = teks(body.kategori);
    if (kat) {
      const cocok = await db.prepare("SELECT kategori_path FROM kategori_tarif WHERE kategori_path = ?")
        .bind(kat).first<{ kategori_path: string }>();
      if (!cocok) return json({ ok: false, error: "Kategori tak ada di kategori_tarif." }, 400);
    }
    patch.push("kategori = ?");
    vals.push(kat || null);
  }
  if (body.tier_override !== undefined) {
    const tier = teks(body.tier_override);
    if (tier) {
      const cocok = await db.prepare("SELECT tier FROM tier_admin WHERE tier = ?")
        .bind(tier).first<{ tier: string }>();
      if (!cocok) return json({ ok: false, error: "Tier override tak dikenal." }, 400);
    }
    patch.push("tier_override = ?");
    vals.push(tier || null);
  }
  if (patch.length === 0) return json({ ok: false, error: "Tak ada field diubah." }, 400);
  vals.push(sku);
  await db.prepare(`UPDATE products SET ${patch.join(", ")} WHERE sku = ?`).bind(...vals).run();
  return json({ ok: true, sku });
}
