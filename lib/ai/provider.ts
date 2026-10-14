// lib/ai/provider.ts — Orkestrator pemanggilan provider AI (Fase B).
// Tanggung jawab: pilih kredensial+model dari D1, jalankan fallback berlapis
// (model berikutnya di provider yang sama BARU pindah provider di `chainTeks`),
// kumpulkan SEMUA kegagalan ke pesan akhir, dan catat pemakaian ke ai_pemakaian.
// Dependensi: lib/d1/* (kredensial, katalog model, pengaturan), adapter OpenAI/Gemini.
// Tidak pernah menyimpan plaintext kredensial — hanya lewat variabel lokal.

import { ambilKredensial } from "@/lib/d1/aiKredensial";
import { daftarModel } from "@/lib/d1/aiModel";
import { ambilPengaturanAI, type EnvAi } from "@/lib/d1/pengaturan";
import { gagal, type Hasil } from "@/lib/d1/hasil";
import { BASE_OPENAI, baseKenari, chatOpenai, gambarOpenai, type OpsiAdapter } from "./adapterOpenai";
import { chatGemini, gambarGemini } from "./adapterGemini";
import type { BagianChat, JawabanChat, PermintaanChat } from "./http";

export type ProviderNama = "gemini" | "groq" | "kenari" | "openai" | "openrouter";

export type Konteks = {
  db: D1Database;
  /** AI_KEY_ENCRYPTION_KEY — kunci dekripsi kredensial. */
  kunci: string;
  env?: EnvAi & { KENARI_BASE_URL?: string };
};

/** Provider OpenAI-compatible = semua kecuali gemini. */
const PROVIDER_OPENAI: ProviderNama[] = ["groq", "kenari", "openai", "openrouter"];

/**
 * Base URL efektif untuk provider: alamat dari kredensial menang atas bawaan.
 * Alasan: user bisa membetulkan host sendiri dari UI (mis. host Kenari berubah)
 * tanpa perlu deploy ulang.
 */
function opsiUntuk(provider: ProviderNama, apiKey: string, ctx: Konteks, timeoutMs: number, baseKred = ""): OpsiAdapter | null {
  const dariKred = String(baseKred ?? "").trim().replace(/\/+$/, "");
  if (dariKred) return { baseUrl: dariKred, apiKey, timeoutMs, provider };
  if (provider === "kenari") return { baseUrl: baseKenari(ctx.env), apiKey, timeoutMs, provider };
  const baseUrl = BASE_OPENAI[provider];
  return baseUrl ? { baseUrl, apiKey, timeoutMs, provider } : null;
}

/**
 * Tanggal WIB (UTC+7) format YYYY-MM-DD.
 * Digeser 7 jam lalu diambil bagian tanggalnya — batas hari mengikuti admin WMS,
 * bukan UTC, supaya rekap "hari ini" cocok dengan jam kerja.
 */
export function tanggalWib(ms: number = Date.now()): string {
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** UPSERT harian: satu baris per (tanggal, provider, model, jenis). */
export async function catatPemakaian(
  db: D1Database,
  data: { tanggal?: string; provider: string; model: string; jenis: string; tokenMasuk?: number; tokenKeluar?: number }
): Promise<void> {
  const masuk = Math.max(0, Math.trunc(data.tokenMasuk ?? 0));
  const keluar = Math.max(0, Math.trunc(data.tokenKeluar ?? 0));
  await db
    .prepare(
      "INSERT INTO ai_pemakaian (tanggal, provider, model, jenis, panggilan, token_masuk, token_keluar) VALUES (?, ?, ?, ?, 1, ?, ?) " +
        "ON CONFLICT(tanggal, provider, model, jenis) DO UPDATE SET " +
        "panggilan = panggilan + 1, token_masuk = token_masuk + excluded.token_masuk, token_keluar = token_keluar + excluded.token_keluar"
    )
    .bind(data.tanggal ?? tanggalWib(), data.provider, data.model, data.jenis, masuk, keluar)
    .run();
}

/** Riwayat percobaan untuk pesan error akhir — user harus tahu provider+model apa saja yang dicoba. */
type Catatan = { provider: string; model: string; error: string };

function ringkasGagal(catatan: Catatan[]): string {
  if (catatan.length === 0) return "Tidak ada provider dengan kredensial aktif dan model tersedia.";
  return `Semua percobaan gagal: ${catatan.map((c) => `${c.provider}/${c.model}: ${c.error}`).join(" | ")}`;
}

type Kandidat = { provider: ProviderNama; model: string; apiKey: string; /** Alamat dasar dari kredensial; "" = pakai bawaan provider. */ baseUrl: string };

/**
 * Kumpulkan kandidat berurutan: untuk tiap provider di `chain`, kredensial aktif
 * diperlukan; model diambil dari pilihan user (`modelTeks[provider]`) bila ada,
 * lalu sisanya dari katalog aktif urut `id` sebagai cadangan di provider sama.
 */
async function kandidatTeks(ctx: Konteks, jenis: "teks" | "vision", catatan: Catatan[], modelDiminta?: string): Promise<Kandidat[]> {
  const set = await ambilPengaturanAI(ctx.db, ctx.env);
  const rantaiTeks = (set.chainTeks.length > 0 ? set.chainTeks : [set.textProvider || "groq"]).filter(
    (p): p is ProviderNama => (PROVIDER_OPENAI as string[]).concat("gemini").includes(p)
  );
  const peta = jenis === "vision" ? set.modelVision : set.modelTeks;
  const hasil: Kandidat[] = [];
  for (const provider of rantaiTeks) {
    const kred = await ambilKredensial(ctx.db, provider, ctx.kunci);
    if (!kred || !kred.plaintext) {
      catatan.push({ provider, model: "-", error: "tidak ada kredensial aktif" });
      continue;
    }
    const katalog = await daftarModel(ctx.db, provider, jenis);
    const aktif = katalog.filter((m) => m.aktif === 1).sort((a, b) => a.id - b.id);
    const id: string[] = [];
    const pilih = (provider === rantaiTeks[0] ? modelDiminta : undefined) ?? peta[provider];
    if (pilih) id.push(pilih);
    for (const m of aktif) if (!id.includes(m.model_id)) id.push(m.model_id);
    for (const model of id) hasil.push({ provider, model, apiKey: kred.plaintext, baseUrl: kred.base_url ?? "" });
  }
  return hasil;
}

/** Satu percobaan ke satu provider+model; semua error berasal dari adapter (asli dari provider). */
async function cobaTeks(
  kandidat: Kandidat,
  pesan: BagianChat[],
  tool: unknown[] | undefined,
  ctx: Konteks,
  jenis: "teks" | "vision",
  opsiReasoning?: { reasoning?: string; reasoningHilir?: boolean }
): Promise<Hasil<{ jawaban: JawabanChat; latencyMs: number }>> {
  const timeoutMs = jenis === "vision" ? 60000 : 30000;
  const permintaan: PermintaanChat = {
    model: kandidat.model,
    pesan,
    tool,
    ...(opsiReasoning?.reasoning ? { reasoning: opsiReasoning.reasoning } : {}),
    ...(opsiReasoning?.reasoningHilir ? { reasoningHilir: true } : {}),
  };
  const h =
    kandidat.provider === "gemini"
      ? await chatGemini({ apiKey: kandidat.apiKey, timeoutMs }, permintaan)
      : await (async () => {
          const opsi = opsiUntuk(kandidat.provider, kandidat.apiKey, ctx, timeoutMs, kandidat.baseUrl);
          if (!opsi) return { ok: false as const, status: 400, error: `Provider ${kandidat.provider} tidak mendukung chat teks.`, latencyMs: 0 };
          return chatOpenai(opsi, permintaan);
        })();
  if (!h.ok) return { ok: false, status: h.status, error: h.error };
  return { ok: true, jawaban: h.data, latencyMs: h.latencyMs };
}

/**
 * Panggil model teks/vision dengan fallback berlapis.
 * `jenis` = "vision" memakai peta modelVision + katalog vision (model gambar biasa).
 */
export async function panggilTeks(
  ctx: Konteks,
  minta: { pesan: BagianChat[]; tool?: unknown[]; modelDiminta?: string; reasoning?: string; reasoningHilir?: boolean },
  jenis: "teks" | "vision" = "teks"
): Promise<
  Hasil<{
    teks: string;
    provider: string;
    model: string;
    tokenMasuk: number;
    tokenKeluar: number;
    /** Panggilan tool yang diminta model (bila ada). */
    toolCall?: { id: string; nama: string; argumen: string }[];
  }>
> {
  const catatan: Catatan[] = [];
  if (!ctx.kunci && !ctx.env?.AI_KEY_ENCRYPTION_KEY) return gagal(500, "AI_KEY_ENCRYPTION_KEY belum diset.");
  const kandidat = await kandidatTeks(ctx, jenis, catatan, minta.modelDiminta);
  if (kandidat.length === 0) return gagal(502, ringkasGagal(catatan));

  for (const k of kandidat) {
    const h = await cobaTeks(k, minta.pesan, minta.tool, ctx, jenis, {
      reasoning: minta.reasoning,
      reasoningHilir: minta.reasoningHilir,
    });
    if (!h.ok) {
      catatan.push({ provider: k.provider, model: k.model, error: h.error });
      continue;
    }
    const masuk = h.jawaban.tokenMasuk ?? 0;
    const keluar = h.jawaban.tokenKeluar ?? 0;
    await catatPemakaian(ctx.db, {
      provider: k.provider,
      model: k.model,
      jenis,
      tokenMasuk: masuk,
      tokenKeluar: keluar,
    });
    return { ok: true, teks: h.jawaban.teks, provider: k.provider, model: k.model, tokenMasuk: masuk, tokenKeluar: keluar, toolCall: h.jawaban.toolCall };
  }
  return gagal(502, ringkasGagal(catatan));
}

/** Panggil image gen: coba provider tepat satu model (pilihan user/peta modelGambar, lalu katalog gambar). */
export async function panggilGambar(
  ctx: Konteks,
  minta: {
    prompt: string;
    referensi?: { mime: string; base64: string }[];
    /** Hints dari setting per user (halaman /ai-gambar). Kosong = pakai pengaturan global. */
    provider?: string;
    model?: string;
    /** Nilai reasoning; diteruskan ke adapter sebagai field opsional. '' = jangan kirim. */
    reasoning?: string;
    /** Rasio aspek pilihan user; diteruskan ke adapter sebagai field opsional. */
    aspekRasio?: string;
    /** Jumlah gambar yang diminta (1..4). Kosong = 1. */
    jumlah?: number;
  }
): Promise<Hasil<{ base64: string; mime: string; provider: string; model: string }>> {
  const catatan: Catatan[] = [];
  if (!ctx.kunci && !ctx.env?.AI_KEY_ENCRYPTION_KEY) return gagal(500, "AI_KEY_ENCRYPTION_KEY belum diset.");

  const set = await ambilPengaturanAI(ctx.db, ctx.env);
  const semuaProvider = (PROVIDER_OPENAI as string[]).concat("gemini");
  const dasar = (set.chainGambar.length > 0 ? set.chainGambar : [set.imageProvider || "gemini"]).filter(
    (p): p is ProviderNama => semuaProvider.includes(p)
  );
  // Provider pilihan user (bila sah) dipindah ke depan rantai — bukan mengganti rantai,
  // supaya fallback tetap jalan saat provider pilihan sedang bermasalah.
  const pilihan = String(minta.provider ?? "").trim();
  // Provider yang PUNYA model gambar terpilih juga harus ikut rantai.
  // MASALAH YANG DIPERBAIKI: sebelumnya rantai hanya dari chainGambar. Bila user
  // sudah memilih model gambar (atau memakai pengaturan global) untuk provider yang
  // tidak ada di chainGambar, model itu tidak pernah dicoba — dan yang muncul hanya
  // "tidak ada kredensial aktif" untuk provider lain yang belum diisi kuncinya.
  const berModelGambar = Object.keys(set.modelGambar).filter(
    (p): p is ProviderNama => semuaProvider.includes(p) && !!String(set.modelGambar[p] ?? "").trim()
  );
  const dasarLengkap = [...dasar, ...berModelGambar.filter((p) => !dasar.includes(p))];
  const rantaiGambar =
    pilihan && semuaProvider.includes(pilihan)
      ? [pilihan as ProviderNama, ...dasarLengkap.filter((p) => p !== pilihan)]
      : dasarLengkap;

  const gagalSemua = () => {
    // Bila SEMUA kandidat gagal karena kredensial, pesannya harus menuntun user
    // ke tindakan: provider mana yang perlu diisi kuncinya. Pesan "tidak ada
    // kredensial aktif" saja membingungkan karena user sudah mengisi satu provider.
    const tanpaKred = catatan.filter((c) => c.error.includes("tidak ada kredensial"));
    if (tanpaKred.length === catatan.length && catatan.length > 0) {
      const perlu = [...new Set(tanpaKred.map((c) => c.provider))];
      return gagal<{ base64: string; mime: string; provider: string; model: string }>(
        400,
        `Tidak ada kredensial aktif untuk: ${perlu.join(", ")}. ` +
          `Isi API key provider itu di Pengaturan → Kredensial Provider, ` +
          `atau pilih provider yang kredensialnya sudah ada (mis. di Model Default).`
      );
    }
    return gagal<{ base64: string; mime: string; provider: string; model: string }>(502, ringkasGagal(catatan));
  };

  for (const provider of rantaiGambar) {
    const kred = await ambilKredensial(ctx.db, provider, ctx.kunci);
    if (!kred || !kred.plaintext) {
      catatan.push({ provider, model: "-", error: "tidak ada kredensial aktif" });
      continue;
    }
    const katalog = (await daftarModel(ctx.db, provider, "gambar")).filter((m) => m.aktif === 1).sort((a, b) => a.id - b.id);
    const id: string[] = [];
    // Model pilihan user hanya diprioritaskan di provider pilihannya.
    const modelUser = provider === pilihan ? String(minta.model ?? "").trim() : "";
    if (modelUser) id.push(modelUser);
    const pilih = set.modelGambar[provider];
    if (pilih) id.push(pilih);
    for (const m of katalog) if (!id.includes(m.model_id)) id.push(m.model_id);

    for (const model of id) {
      // Reasoning diteruskan ke adapter; adapter yang tidak mendukung akan
      // mengabaikannya karena `terapkanReasoning` mengembalikan objek kosong.
      const mintaGambar = {
        model,
        prompt: minta.prompt,
        referensi: minta.referensi,
        reasoning: String(minta.reasoning ?? "").trim(),
        aspekRasio: String(minta.aspekRasio ?? "").trim(),
        jumlah: Number(minta.jumlah) > 0 ? Math.min(4, Math.floor(Number(minta.jumlah))) : 1,
      };
      const h =
        provider === "gemini"
          ? await gambarGemini({ apiKey: kred.plaintext, timeoutMs: 120000 }, mintaGambar)
          : await (async () => {
              const opsi = opsiUntuk(provider, kred.plaintext, ctx, 120000, kred.base_url ?? "");
              if (!opsi) return { ok: false as const, status: 400, error: `Provider ${provider} tidak mendukung image gen.`, latencyMs: 0 };
              return gambarOpenai(opsi, mintaGambar);
            })();
      if (!h.ok) {
        catatan.push({ provider, model, error: h.error });
        continue;
      }
      await catatPemakaian(ctx.db, { provider, model, jenis: "gambar" });
      return { ok: true, base64: h.data.base64, mime: h.data.mime, provider, model };
    }
  }
  return gagalSemua();
}
