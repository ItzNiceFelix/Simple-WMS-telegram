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
  ambilKredensial, catatUji, daftarKredensial, hapusKredensial, setAktifKredensial, setBaseKredensial, simpanKredensial,
} from "@/lib/d1/aiKredensial";
import {
  daftarModel,
  hapusModel,
  perbaruiKapabilitasModel,
  ringkasKapabilitas,
  setAktifModel,
  tambahModel,
  tambahModelBanyak,
  ubahLabelModel,
} from "@/lib/d1/aiModel";
import { daftarPreset, hapusPreset, seedPreset, tambahPreset, ubahPreset } from "@/lib/d1/aiPreset";
import { daftarTool, hapusTool, seedTool, setAktifTool, setKataTool, simpanTool } from "@/lib/d1/aiTool";
import { ambilPengaturanAI, PROVIDER_VALID, simpanPengaturanAI, simpanProviderAI, type EnvAi } from "@/lib/d1/pengaturan";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { BASE_OPENAI, baseKenari, chatOpenai, modelOpenai } from "@/lib/ai/adapterOpenai";
import { modelOpenrouter } from "@/lib/ai/adapterOpenrouter";
import { chatGemini, modelGemini } from "@/lib/ai/adapterGemini";
import { tanggalWib } from "@/lib/ai/provider";
import type { HasilHttp, HasilModel } from "@/lib/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batas token untuk tes koneksi. Cukup besar agar model reasoning tetap menghasilkan teks. */
const MAKS_UJI = 256;

/** Body angka aman: kosong/NaN → undefined (biar lib yang memakai nilai lama). */
function angkaOpsional(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/** Tarik daftar model dari provider memakai kredensial aktif. Error provider diteruskan apa adanya. */
async function tarikModel(db: D1Database, provider: string, kunci: string, env: EnvAi): Promise<HasilHttp<HasilModel[]>> {
  const kred = await ambilKredensial(db, provider, kunci);
  // OpenRouter: /models publik — tetap jalan tanpa kredensial (key hanya menaikkan rate limit).
  if (provider === "openrouter") return modelOpenrouter({ apiKey: kred?.plaintext ?? "" });
  if (!kred) return { ok: false, status: 400, error: `Provider ${provider} belum punya kredensial aktif.`, latencyMs: 0 };
  if (provider === "gemini") return modelGemini({ apiKey: kred.plaintext });
  // base_url dari kredensial menang atas env: user bisa membetulkan host sendiri
  // dari UI tanpa menunggu deploy (mis. host Kenari yang berubah).
  const baseKred = String(kred.base_url ?? "").trim().replace(/\/+$/, "");
  if (provider === "kenari") return modelOpenai({ baseUrl: baseKred || baseKenari(env), apiKey: kred.plaintext, provider });
  const baseUrl = baseKred || BASE_OPENAI[provider];
  if (!baseUrl) {
    return { ok: false, status: 400, error: `Provider ${provider} tidak menyediakan endpoint daftar model.`, latencyMs: 0 };
  }
  return modelOpenai({ baseUrl, apiKey: kred.plaintext, provider });
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
  // Cakupan data kapabilitas: berapa model yang tahu modality/reasoning-nya.
  if (aksi === "ringkas-kapabilitas") {
    return json({ ok: true, ringkas: await ringkasKapabilitas(db, url.searchParams.get("provider") ?? undefined) });
  }
  if (aksi === "tool") {
    return json({ ok: true, tool: await daftarTool(db) });
  }
  if (aksi === "tarik-model") {
    const provider = teks(url.searchParams.get("provider"));
    if (!provider) return json({ ok: false, error: "Provider wajib diisi." }, 400);
    const h = await tarikModel(db, provider, getKunciEnkripsi(), getEnvAi());
    if (!h.ok) return json({ ok: false, error: h.error, provider, latencyMs: h.latencyMs }, h.status >= 400 ? h.status : 502);
    const jenis = teks(url.searchParams.get("jenis")) || "teks";
    const impor = await tambahModelBanyak(
      db,
      provider,
      h.data.map((m) => ({
        model_id: m.id,
        label: m.label,
        jenis,
        modalMasuk: m.modalMasuk,
        modalKeluar: m.modalKeluar,
        reasoningSkema: m.reasoningSkema,
        reasoningPilihan: m.reasoningPilihan,
        reasoningHilir: m.reasoningHilir,
      }))
    );
    return json({ ok: true, provider, jumlah: h.data.length, ditambah: impor.ditambah, dilewati: impor.dilewati, latencyMs: h.latencyMs });
  }
  if (aksi === "pemakaian") {
    const rangkuman = await db
      .prepare(
        "SELECT provider, model, SUM(panggilan) AS panggilan, SUM(token_masuk) AS token_masuk, SUM(token_keluar) AS token_keluar " +
          "FROM ai_pemakaian WHERE tanggal >= ? GROUP BY provider, model ORDER BY panggilan DESC"
      )
      .bind(tanggalWib(Date.now() - 29 * 24 * 60 * 60 * 1000))
      .all<{ provider: string; model: string; panggilan: number; token_masuk: number; token_keluar: number }>();
    const rincian = rangkuman.results ?? [];
    return json({
      ok: true,
      sejak: tanggalWib(Date.now() - 29 * 24 * 60 * 60 * 1000),
      total: {
        panggilan: rincian.reduce((a, r) => a + (r.panggilan ?? 0), 0),
        tokenMasuk: rincian.reduce((a, r) => a + (r.token_masuk ?? 0), 0),
        tokenKeluar: rincian.reduce((a, r) => a + (r.token_keluar ?? 0), 0),
      },
      rincian,
    });
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
      rateLimitPerMenit: angkaOpsional(body.rateLimitPerMenit),
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
      { provider: teks(body.provider), label: teks(body.label), apiKey: teks(body.apiKey), baseUrl: teks(body.baseUrl), oleh: uid },
      getKunciEnkripsi()
    );
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, kredensial: h.kredensial });
  }
  // Ubah alamat dasar kredensial yang sudah ada (tanpa perlu isi ulang API key).
  if (aksi === "kredensial-base") {
    const h = await setBaseKredensial(db, angkaOpsional(body.id) ?? 0, teks(body.baseUrl));
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
  // Koreksi manual kapabilitas: modality + skema reasoning. Sumber jadi 'manual'
  // supaya tarik-model berikutnya tidak menimpa koreksi user.
  if (aksi === "model-kapabilitas") {
    const h = await perbaruiKapabilitasModel(db, teks(body.provider), teks(body.modelId), {
      modalMasuk: Array.isArray(body.modalMasuk) ? body.modalMasuk.map(teks).filter(Boolean) : undefined,
      modalKeluar: Array.isArray(body.modalKeluar) ? body.modalKeluar.map(teks).filter(Boolean) : undefined,
      reasoningSkema: typeof body.reasoningSkema === "string" ? body.reasoningSkema : undefined,
      reasoningPilihan: Array.isArray(body.reasoningPilihan) ? body.reasoningPilihan.map(teks).filter(Boolean) : undefined,
      reasoningHilir: typeof body.reasoningHilir === "boolean" ? body.reasoningHilir : undefined,
    });
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

  // ── Uji koneksi nyata ──
  if (aksi === "uji") {
    const provider = teks(body.provider);
    const modelDiminta = teks(body.model);
    const jenis = teks(body.jenis) || "teks";
    if (!provider) return json({ ok: false, error: "Provider wajib diisi." }, 400);
    const kunci = getKunciEnkripsi();
    const kred = await ambilKredensial(db, provider, kunci);
    if (!kred) {
      return json({ ok: false, provider, model: modelDiminta, latencyMs: 0, error: `Provider ${provider} belum punya kredensial aktif.` }, 400);
    }

    // Bila model tidak disebut: pakai pilihan pengaturan untuk provider itu, lalu katalog aktif.
    let model = modelDiminta;
    if (!model) {
      const set = await ambilPengaturanAI(db, getEnvAi());
      const peta = jenis === "vision" ? set.modelVision : jenis === "gambar" ? set.modelGambar : set.modelTeks;
      const katalog = await daftarModel(db, provider, jenis);
      model = peta[provider] ?? katalog.find((m) => m.aktif === 1)?.model_id ?? katalog[0]?.model_id ?? "";
    }
    if (!model) {
      return json({ ok: false, provider, model: "", latencyMs: 0, error: `Tidak ada model ${jenis} terdaftar untuk ${provider}. Tambah atau tarik dari provider dulu.` }, 400);
    }

    const mulai = Date.now();
    // Batas token sengaja lebih besar dari jawaban "OK": model reasoning (mis. Kenari
    // `:free`) memakai token untuk berpikir dulu, sehingga dengan batas 16 responsnya
    // kosong walau koneksinya sukses — membingungkan saat menguji.
    const pesan = [{ role: "user" as const, teks: "Balas satu kata: OK" }];
    if (jenis === "gambar") {
      return json({ ok: false, provider, model, latencyMs: 0, error: "Uji koneksi untuk model gambar belum didukung di sini." }, 400);
    }
    const h =
      provider === "gemini"
        ? await chatGemini({ apiKey: kred.plaintext, timeoutMs: 30000 }, { model, pesan, maksToken: MAKS_UJI })
        : await (async () => {
            const baseKred = String(kred.base_url ?? "").trim().replace(/\/+$/, "");
            const baseUrl = baseKred || (provider === "kenari" ? baseKenari(getEnvAi()) : BASE_OPENAI[provider]);
            if (!baseUrl) return { ok: false as const, status: 400, error: `Provider ${provider} tidak mendukung chat teks.`, latencyMs: 0 };
            return chatOpenai({ baseUrl, apiKey: kred.plaintext, timeoutMs: 30000, provider }, { model, pesan, maksToken: MAKS_UJI });
          })();

    const latencyMs = h.ok ? h.latencyMs : h.latencyMs || Date.now() - mulai;
    await catatUji(db, kred.id, {
      ok: h.ok,
      latencyMs,
      model,
      error: h.ok ? undefined : h.error,
    });
    if (!h.ok) return json({ ok: false, provider, model, latencyMs, error: h.error }, h.status >= 400 ? h.status : 502);
    return json({ ok: true, provider, model, latencyMs, teks: h.data.teks, tokenMasuk: h.data.tokenMasuk ?? 0, tokenKeluar: h.data.tokenKeluar ?? 0 });
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
