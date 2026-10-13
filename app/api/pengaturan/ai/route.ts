// app/api/pengaturan/ai/route.ts — Kelola sistem AI (Fase A).
// GET  ?aksi=ringkas|kredensial|model|preset|tool  → baca (owner)
// POST { aksi } → tulis (owner). Aksi:
//   provider | pengaturan | kredensial-simpan | kredensial-aktif | kredensial-hapus
//   model-tambah | model-impor | model-aktif | model-label | model-hapus
//   preset-tambah | preset-ubah | preset-hapus
//   tool-simpan | tool-aktif | tool-kata | tool-hapus | tool-seed | preset-seed
//
// Kredensial TIDAK PERNAH dikembalikan sebagai plaintext. Hanya mask (••••3f2a).
import { getDb, getEnvAi, getKunciEnkripsi } from "@/lib/d1/db";
import {
  ambilKredensial, catatUji, daftarKredensial, hapusKredensial, setAktifKredensial, simpanKredensial,
} from "@/lib/d1/aiKredensial";
import { daftarModel, hapusModel, setAktifModel, tambahModel, tambahModelBanyak, ubahLabelModel } from "@/lib/d1/aiModel";
import { daftarPreset, hapusPreset, seedPreset, tambahPreset, ubahPreset } from "@/lib/d1/aiPreset";
import { daftarTool, hapusTool, seedTool, setAktifTool, setKataTool, simpanTool } from "@/lib/d1/aiTool";
import { ambilPengaturanAI, PROVIDER_VALID, simpanPengaturanAI, simpanProviderAI } from "@/lib/d1/pengaturan";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body angka aman: kosong/NaN → undefined (biar lib yang memakai nilai lama). */
function angkaOpsional(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 120);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);

  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi") ?? "ringkas";
  const db = getDb();

  if (aksi === "ringkas") {
    return json({
      ok: true,
      pengaturan: await ambilPengaturanAI(db, getEnvAi()),
      kredensial: await daftarKredensial(db),
      provider_valid: PROVIDER_VALID,
      kunci_enkripsi_ada: getKunciEnkripsi().length > 0,
    });
  }
  if (aksi === "kredensial") {
    return json({ ok: true, kredensial: await daftarKredensial(db, url.searchParams.get("provider") ?? undefined) });
  }
  if (aksi === "model") {
    return json({
      ok: true,
      model: await daftarModel(db, url.searchParams.get("provider") ?? undefined, url.searchParams.get("jenis") ?? undefined),
    });
  }
  if (aksi === "preset") {
    return json({ ok: true, preset: await daftarPreset(db, url.searchParams.get("kategori") ?? undefined) });
  }
  if (aksi === "tool") {
    return json({ ok: true, tool: await daftarTool(db) });
  }
  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 40);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah pengaturan AI." }, 403);

  const body = await bacaBody(request);
  const aksi = teks(body.aksi);
  const db = getDb();
  const uid = sesi.user.tg_id;

  // ── Pengaturan umum ──
  if (aksi === "provider") {
    const h = await simpanProviderAI(db, teks(body.provider), uid, getEnvAi());
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, pengaturan: h.pengaturan });
  }
  if (aksi === "pengaturan") {
    const patch = {
      textProvider: teks(body.textProvider) || undefined,
      imageProvider: teks(body.imageProvider) || undefined,
      chainTeks: Array.isArray(body.chainTeks) ? body.chainTeks.map(teks).filter(Boolean) : undefined,
      chainGambar: Array.isArray(body.chainGambar) ? body.chainGambar.map(teks).filter(Boolean) : undefined,
      modelTeks: typeof body.modelTeks === "object" && body.modelTeks !== null ? (body.modelTeks as Record<string, string>) : undefined,
      modelGambar: typeof body.modelGambar === "object" && body.modelGambar !== null ? (body.modelGambar as Record<string, string>) : undefined,
      modelVision: typeof body.modelVision === "object" && body.modelVision !== null ? (body.modelVision as Record<string, string>) : undefined,
      maksRiwayat: angkaOpsional(body.maksRiwayat),
      maksLoopTool: angkaOpsional(body.maksLoopTool),
      saatTakCocok: body.saatTakCocok === "tolak" ? ("tolak" as const) : body.saatTakCocok === "semua_tool" ? ("semua_tool" as const) : undefined,
      promptSistem: typeof body.promptSistem === "string" ? body.promptSistem : undefined,
    };
    const bersih = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const h = await simpanPengaturanAI(db, bersih, uid, getEnvAi());
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, pengaturan: h.pengaturan });
  }

  // ── Kredensial ──
  if (aksi === "kredensial-simpan") {
    const h = await simpanKredensial(
      db,
      { provider: teks(body.provider), label: teks(body.label), apiKey: teks(body.apiKey), oleh: uid },
      getKunciEnkripsi()
    );
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, kredensial: h.kredensial });
  }
  if (aksi === "kredensial-aktif") {
    const h = await setAktifKredensial(db, angkaOpsional(body.id) ?? 0, body.aktif !== false);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, kredensial: h.kredensial });
  }
  if (aksi === "kredensial-hapus") {
    const h = await hapusKredensial(db, angkaOpsional(body.id) ?? 0);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true });
  }

  // ── Model ──
  if (aksi === "model-tambah") {
    const h = await tambahModel(db, { provider: teks(body.provider), model_id: teks(body.model_id), label: teks(body.label), jenis: teks(body.jenis) });
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, model: h.model });
  }
  if (aksi === "model-impor") {
    const daftar = Array.isArray(body.daftar) ? (body.daftar as Record<string, unknown>[]) : [];
    if (daftar.length === 0) return json({ ok: false, error: "Daftar model kosong." }, 400);
    const h = await tambahModelBanyak(db, teks(body.provider), daftar.map((m) => ({ model_id: teks(m.model_id), label: teks(m.label), jenis: teks(m.jenis) })));
    return json({ ok: true, ...h });
  }
  if (aksi === "model-aktif") {
    const h = await setAktifModel(db, angkaOpsional(body.id) ?? 0, body.aktif !== false);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, model: h.model });
  }
  if (aksi === "model-label") {
    const h = await ubahLabelModel(db, angkaOpsional(body.id) ?? 0, teks(body.label));
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, model: h.model });
  }
  if (aksi === "model-hapus") {
    const h = await hapusModel(db, angkaOpsional(body.id) ?? 0);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true });
  }

  // ── Preset prompt ──
  if (aksi === "preset-tambah") {
    const h = await tambahPreset(db, { nama: teks(body.nama), prompt: teks(body.prompt), kategori: teks(body.kategori), urutan: angkaOpsional(body.urutan) });
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, preset: h.preset });
  }
  if (aksi === "preset-ubah") {
    const h = await ubahPreset(db, angkaOpsional(body.id) ?? 0, {
      nama: body.nama === undefined ? undefined : teks(body.nama),
      prompt: body.prompt === undefined ? undefined : teks(body.prompt),
      kategori: body.kategori === undefined ? undefined : teks(body.kategori),
      urutan: angkaOpsional(body.urutan),
      aktif: body.aktif === undefined ? undefined : body.aktif !== false,
    });
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, preset: h.preset });
  }
  if (aksi === "preset-hapus") {
    const h = await hapusPreset(db, angkaOpsional(body.id) ?? 0);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true });
  }
  if (aksi === "preset-seed") {
    return json({ ok: true, ...(await seedPreset(db)) });
  }

  // ── Tool + kata kunci ──
  if (aksi === "tool-simpan") {
    const h = await simpanTool(db, {
      nama: teks(body.nama), label: teks(body.label), deskripsi: teks(body.deskripsi),
      jenis: teks(body.jenis), perluKonfirmasi: body.perluKonfirmasi === true,
      aktif: body.aktif === undefined ? true : body.aktif !== false,
      urutan: angkaOpsional(body.urutan),
    });
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, tool: h.tool });
  }
  if (aksi === "tool-aktif") {
    const h = await setAktifTool(db, teks(body.nama), body.aktif !== false);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, tool: h.tool });
  }
  if (aksi === "tool-kata") {
    const kata = Array.isArray(body.kata) ? (body.kata as unknown[]).map(teks) : teks(body.kata).split(",");
    const h = await setKataTool(db, teks(body.nama), kata);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, tool: h.tool });
  }
  if (aksi === "tool-hapus") {
    const h = await hapusTool(db, teks(body.nama));
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true });
  }
  if (aksi === "tool-seed") {
    return json({ ok: true, ...(await seedTool(db)) });
  }

  // ── Uji koneksi (dipakai Fase B; di sini hanya mencatat bila dipanggil) ──
  if (aksi === "catat-uji") {
    const id = angkaOpsional(body.id) ?? 0;
    if (!id) return json({ ok: false, error: "id tidak sah." }, 400);
    await catatUji(db, id, { ok: body.ok === true, latencyMs: angkaOpsional(body.latencyMs), model: teks(body.model), error: teks(body.error) });
    const kred = await ambilKredensial(db, teks(body.provider), getKunciEnkripsi());
    return json({ ok: true, kredensial_ditemukan: kred !== null });
  }

  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
