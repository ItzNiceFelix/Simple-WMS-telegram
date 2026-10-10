// app/api/produk/[sku]/route.ts — Field master produk per SKU (A-M1).
// PATCH { kategori?, tier_override?, pre_order?, ukuran_khusus? } (owner).
import { getDb } from "@/lib/d1/db";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function yaTidak(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "ya" || s === "1" || s === "true") return 1;
  if (s === "tidak" || s === "0" || s === "false") return 0;
  return -1; // tak valid
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah produk." }, 403);
  const sku = teks((await params).sku).toUpperCase();
  if (!sku) return json({ ok: false, error: "sku tak valid." }, 400);
  const body = await bacaBody(request);
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
  if (body.pre_order !== undefined) {
    const v = yaTidak(body.pre_order);
    if (v === -1) return json({ ok: false, error: "pre_order harus ya/tidak." }, 400);
    if (v !== null) { patch.push("pre_order = ?"); vals.push(v); }
  }
  if (body.ukuran_khusus !== undefined) {
    const v = yaTidak(body.ukuran_khusus);
    if (v === -1) return json({ ok: false, error: "ukuran_khusus harus ya/tidak." }, 400);
    if (v !== null) { patch.push("ukuran_khusus = ?"); vals.push(v); }
  }
  if (body.go_override !== undefined) {
    const g = teks(body.go_override).toUpperCase();
    if (g && !/^[A-H]$/.test(g)) return json({ ok: false, error: "go_override harus A–H." }, 400);
    patch.push("go_override = ?");
    vals.push(g || null);
  }
  if (patch.length === 0) return json({ ok: false, error: "Tak ada field diubah." }, 400);
  vals.push(sku);
  await db.prepare(`UPDATE products SET ${patch.join(", ")} WHERE sku = ?`).bind(...vals).run();
  return json({ ok: true, sku });
}
