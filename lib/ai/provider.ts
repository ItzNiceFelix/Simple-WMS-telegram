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
import { streamJson, type PotonganStream } from "./stream";

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
 * Batas waktu SATU percobaan model teks.
 * Model penalaran (reasoning `high`/`xhigh`/`max`, apalagi varian `:free` yang mengantre
 * di sisi penyedia) memang lambat: 30 detik terlalu pendek dan membuat request yang
 * sebenarnya akan berhasil di-DROP lebih dulu, sehingga user hanya melihat kegagalan.
 * Tapi 60 detik juga terlalu lama: satu model lambat bisa menghabiskan hampir seluruh
 * anggaran rantai sebelum provider lain (yang kredensialnya sehat) sempat dicoba.
 * 35 detik = batas terburuk yang masih menyisakan jatah adil untuk provider berikutnya.
 */
export const TIMEOUT_TEKS_MS = 35000;

/**
 * Batas waktu SATU percobaan teks yang MEMAKAI reasoning (model benar-benar berpikir).
 * Model penalaran perlu waktu jauh lebih lama daripada jawaban biasa: dengan 35 detik
 * permintaan yang sebenarnya akan berhasil di-DROP lebih dulu — persis keluhan pemilik
 * repo ("reasoning selalu timeout"). Nilai reasoning sudah dinormalisasi di
 * lib/ai/reasoning.ts (max/xhigh → high), ini pagar waktu untuk tingkat yang sah itu.
 */
export const TIMEOUT_TEKS_REASONING_MS = 70000;

/**
 * Batas waktu SATU percobaan vision (model gambar biasa yang membaca gambar). Tidak dinaikkan.
 */
export const TIMEOUT_VISION_MS = 60000;

/**
 * Anggaran SATU provider di rantai teks (semua model provider itu dijumlahkan).
 * MASALAH YANG DIPERBAIKI: dulu hanya ada anggaran TOTAL, jadi provider pertama yang
 * lambat membakar seluruh jatah (satu model 60 detik + model berikutnya) dan provider
 * di belakangnya selalu "dilewati: anggaran total habis" — praktisnya tidak pernah
 * dicoba, padahal kredensialnya sehat. Batas per-provider membuat tiap provider dapat
 * giliran nyata.
 * Perhitungan: satu provider boleh memakai sampai timeout percobaan terpanjangnya —
 * 70000ms (TIMEOUT_TEKS_REASONING_MS), jadi anggarannya 70000 juga. Model cadangan di
 * provider yang sama praktis hanya kebagian bila model pertama gagal cepat.
 */
export const ANGGARAN_PROVIDER_MS = 70000;

/**
 * Anggaran TOTAL rantai teks (semua provider dijumlahkan) — pagar terakhir.
 *
 * Perhitungan SEKARANG: 2 provider × ANGGARAN_PROVIDER_MS = 140000.
 * Turun dari 210000 (= 3 provider) SETELAH jalur streaming ada: pada streaming,
 * provider yang sama sudah dipakai lebih dari satu kali gagal sebelum ada potongan,
 * jadi provider pertama yang berhasil membalas TIDAK diganti — jumlah provider yang
 * benar-benar perlu dicoba berkurang. 140000 tetap memberi tiap provider jatah penuh
 * satu percobaan reasoning (70000) plus satu cadangan yang gagal cepat.
 *
 * CATATAN: ini anggaran jalur NON-stream (`panggilTeks`), yang pemakainya masih ada
 * (chat, vision, saran iklan). Angkanya TIDAK memperlambat jawaban biasa:
 * batas satu percobaan tetap TIMEOUT_TEKS_MS (35000).
 */
export const ANGGARAN_TEKS_MS = 140000;

/**
 * Jumlah model yang dicoba per provider: 1 model yang diminta user + 4 cadangan.
 * MASALAH YANG DIPERBAIKI: dulu SEMUA model aktif provider ikut masuk kandidat —
 * pada katalog nyata itu 23 model kenari dijejer berurutan sebelum provider
 * berikutnya (gemini) sempat dicoba. Itu bukan fallback, itu penjelajahan katalog:
 * satu provider yang sedang bermasalah menghabiskan seluruh anggaran waktu.
 * Batas ini menjaga arti "cadangan" tetap: kalau 5 model berturut-turut gagal,
 * masalahnya provider/kredensial, jadi lebih baik segera pindah provider.
 *
 * Dinaikkan dari 3 ke 5: katalog nyata sudah ~160 model, jadi hanya 2 cadangan
 * sesudah model pilihan user terlalu sedikit — satu model mati + satu kuota habis
 * sudah mengakhiri provider yang sebenarnya sehat.
 *
 * ANGGARAN: 5 model × TIMEOUT_TEKS_REASONING_MS (70000) = 350000ms jauh melebihi
 * ANGGARAN_PROVIDER_MS (70000ms). Itu memang disengaja dan bukan bug: anggaran
 * provider adalah pagar waktu, bukan kuota model — model pertama selalu dapat
 * jatah penuh (70000ms = TIMEOUT_TEKS_REASONING_MS saat reasoning aktif, atau
 * 35000ms = TIMEOUT_TEKS_MS saat tidak), jadi tidak mungkin provider ini
 * kehabisan anggaran sebelum model pilihannya selesai dicoba. Model ke-2..5
 * hanya kebagian sisa anggaran bila model sebelumnya gagal cepat (bukan timeout).
 */
export const MAKS_MODEL_PER_PROVIDER = 5;

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

/**
 * Ringkasan kegagalan. `rantai` = urutan provider di `chainTeks`; dipakai untuk
 * menutup pesan dengan kalimat yang menyebut provider BELUM dicoba karena
 * kredensialnya kosong. Tanpa itu user mengira sistemnya mati, padahal masalahnya
 * konfigurasi: provider sehat cuma tidak pernah kebagian giliran.
 */
function ringkasGagal(catatan: Catatan[], rantai: string[] = []): string {
  if (catatan.length === 0) return "Tidak ada provider dengan kredensial aktif dan model tersedia.";
  const badan = `Semua percobaan gagal: ${catatan.map((c) => `${c.provider}/${c.model}: ${c.error}`).join(" | ")}`;
  const tanpaKred = [...new Set(catatan.filter((c) => c.error === "tidak ada kredensial aktif").map((c) => c.provider))];
  const belumDicoba = rantai.filter((p) => !catatan.some((c) => c.provider === p) && !tanpaKred.includes(p));
  const saran: string[] = [];
  if (tanpaKred.length > 0) saran.push(`tanpa kredensial aktif: ${tanpaKred.join(", ")} (isi API key-nya di Pengaturan → Kredensial Provider)`);
  if (belumDicoba.length > 0) saran.push(`belum dicoba: ${belumDicoba.join(", ")}`);
  // Kalau SEMUA provider di rantai sudah dicoba dan semuanya bergagal, jangan tambahkan
  // kalimat penutup: tidak ada provider lain yang bisa ditawarkan ke user.
  if (saran.length === 0) return badan;
  return `${badan} — Masih ada provider yang bisa dicoba: ${saran.join("; ")}.`;
}

type Kandidat = { provider: ProviderNama; model: string; apiKey: string; /** Alamat dasar dari kredensial; "" = pakai bawaan provider. */ baseUrl: string };

/**
 * Batas kandidat per provider: model yang diminta user SELALU nomor satu (kalau ada),
 * lalu maksimal `MAKS_MODEL_PER_PROVIDER - 1` model aktif lain urut `id` sebagai cadangan.
 *
 * KENAPA TIDAK SEMUA MODEL: mencoba 23 model satu provider satu per satu bukan fallback.
 * Bila tiga model berturut-turut gagal (model mati, kuota, atau provider sedang down),
 * model keempat..keduapuluh tiga hampir pasti gagal juga — yang terjadi hanyalah user
 * menunggu sampai anggaran habis tanpa provider sehat di belakangnya pernah dicoba.
 */
async function kandidatTeks(
  ctx: Konteks,
  jenis: "teks" | "vision",
  catatan: Catatan[],
  modelDiminta?: string
): Promise<{ kandidat: Kandidat[]; rantai: string[] }> {
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
    // Sisanya memang sengaja TIDAK dicoba — dicatat supaya tidak ada yang menyangka
    // katalog provider ini sudah dicoba habis lalu menyimpulkan modelnya memang mati.
    const sisa = Math.max(0, id.length - MAKS_MODEL_PER_PROVIDER);
    if (sisa > 0) {
      catatan.push({
        provider,
        model: "-",
        error: `dilewati: hanya ${MAKS_MODEL_PER_PROVIDER} model pertama provider ini yang dicoba, ${sisa} model lain tidak dicoba`,
      });
    }
    for (const model of id.slice(0, MAKS_MODEL_PER_PROVIDER)) {
      hasil.push({ provider, model, apiKey: kred.plaintext, baseUrl: kred.base_url ?? "" });
    }
  }
  return { kandidat: hasil, rantai: rantaiTeks };
}

/** Satu percobaan ke satu provider+model; semua error berasal dari adapter (asli dari provider). */
async function cobaTeks(
  kandidat: Kandidat,
  pesan: BagianChat[],
  tool: unknown[] | undefined,
  ctx: Konteks,
  jenis: "teks" | "vision",
  opsiReasoning?: { reasoning?: string; reasoningHilir?: boolean; maksToken?: number }
): Promise<Hasil<{ jawaban: JawabanChat; latencyMs: number }>> {
  const pakaiReasoning = jenis === "teks" && !!String(opsiReasoning?.reasoning ?? "").trim();
  // Reasoning aktif → model benar-benar berpikir, butuh jatah waktu jauh lebih panjang.
  // Tanpa reasoning angkanya TIDAK berubah (TIMEOUT_TEKS_MS).
  const timeoutMs = jenis === "vision" ? TIMEOUT_VISION_MS : pakaiReasoning ? TIMEOUT_TEKS_REASONING_MS : TIMEOUT_TEKS_MS;
  const permintaan: PermintaanChat = {
    model: kandidat.model,
    pesan,
    tool,
    ...(opsiReasoning?.reasoning ? { reasoning: opsiReasoning.reasoning } : {}),
    ...(opsiReasoning?.reasoningHilir ? { reasoningHilir: true } : {}),
    ...(opsiReasoning?.maksToken !== undefined ? { maksToken: opsiReasoning.maksToken } : {}),
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
  minta: { pesan: BagianChat[]; tool?: unknown[]; modelDiminta?: string; reasoning?: string; reasoningHilir?: boolean; maksToken?: number },
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
  const { kandidat, rantai } = await kandidatTeks(ctx, jenis, catatan, minta.modelDiminta);
  if (kandidat.length === 0) return gagal(502, ringkasGagal(catatan, rantai), catatan);

  // Anggaran hanya berlaku untuk "teks" — vision sudah dibatasi satu panggilan pendek.
  const mulai = Date.now();
  // Jam per-provider: direset tiap kali provider berganti, bukan digabung seluruh rantai.
  let providerKini = kandidat[0]!.provider;
  let mulaiProvider = mulai;
  for (const k of kandidat) {
    if (k.provider !== providerKini) {
      providerKini = k.provider;
      mulaiProvider = Date.now();
    }
    if (jenis === "teks" && Date.now() - mulai >= ANGGARAN_TEKS_MS) {
      catatan.push({
        provider: k.provider,
        model: k.model,
        error: `dilewati: anggaran total ${ANGGARAN_TEKS_MS}ms habis`,
      });
      continue;
    }
    // Provider ini sudah kebanyakan makan waktu: sisa model provider ITU dilewati,
    // tapi rantai LANJUT ke provider berikutnya — ini inti perbaikannya.
    if (jenis === "teks" && Date.now() - mulaiProvider >= ANGGARAN_PROVIDER_MS) {
      catatan.push({
        provider: k.provider,
        model: k.model,
        error: `dilewati: anggaran provider ${k.provider} habis, lanjut provider berikutnya`,
      });
      continue;
    }
    const h = await cobaTeks(k, minta.pesan, minta.tool, ctx, jenis, {
      reasoning: minta.reasoning,
      reasoningHilir: minta.reasoningHilir,
      maksToken: minta.maksToken,
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
  return gagal(502, ringkasGagal(catatan, rantai), catatan);
}

/**
 * Varian STREAMING dari `panggilTeks` — TIDAK menggantikannya; pemakai lama tetap
 * memakai jalur non-stream. Rantai kandidatnya SAMA (`kandidatTeks`), yang berbeda
 * hanya cara percobaannya: potongan teks dikembalikan begitu tiba, bukan menunggu
 * jawaban selesai (lihat KENAPA STREAMING di lib/ai/stream.ts).
 *
 * ATURAN PEMILIHAN PROVIDER (penting, tidak bisa dibatalkan):
 * kandidat pertama yang BERHASIL MENGIRIM potongan pertama dianggap terpilih dan
 * stream ditutup setelahnya. Setelah ada potongan sampai ke user, pindah provider
 * akan menghasilkan jawaban campur dua model — jadi kegagalan SETELAH potongan
 * pertama dilaporkan apa adanya, bukan difallback. Provider yang gagal SEBELUM ada
 * potongan (kredensial kosong, 4xx/5xx, timeout handshake) dilewati seperti rantai biasa.
 *
 * `jenis` hanya "teks": Gemini belum punya jalur streaming di repo ini.
 */
export async function panggilTeksStream(
  ctx: Konteks,
  minta: {
    pesan: BagianChat[];
    tool?: unknown[];
    modelDiminta?: string;
    reasoning?: string;
    reasoningHilir?: boolean;
    maksToken?: number;
  }
): Promise<
  Hasil<{
    /** Kandidat yang akhirnya dipakai — dikirim ke user saat stream selesai. */
    provider: string;
    model: string;
    potongan: AsyncGenerator<PotonganStream>;
  }>
> {
  const catatan: Catatan[] = [];
  if (!ctx.kunci && !ctx.env?.AI_KEY_ENCRYPTION_KEY) return gagal(500, "AI_KEY_ENCRYPTION_KEY belum diset.");
  const { kandidat, rantai } = await kandidatTeks(ctx, "teks", catatan, minta.modelDiminta);
  if (kandidat.length === 0) return gagal(502, ringkasGagal(catatan, rantai), catatan);

  const mulai = Date.now();
  let providerKini = kandidat[0]!.provider;
  let mulaiProvider = mulai;
  for (const k of kandidat) {
    if (k.provider !== providerKini) {
      providerKini = k.provider;
      mulaiProvider = Date.now();
    }
    // Pagar anggaran sama seperti panggilTeks: provider yang kebablasan tidak menghentikan
    // rantai — kandidat provider berikutnya tetap dicoba.
    if (Date.now() - mulai >= ANGGARAN_TEKS_MS) {
      catatan.push({ provider: k.provider, model: k.model, error: `dilewati: anggaran total ${ANGGARAN_TEKS_MS}ms habis` });
      continue;
    }
    if (Date.now() - mulaiProvider >= ANGGARAN_PROVIDER_MS) {
      catatan.push({
        provider: k.provider,
        model: k.model,
        error: `dilewati: anggaran provider ${k.provider} habis, lanjut provider berikutnya`,
      });
      continue;
    }
    const pakaiReasoning = !!String(minta.reasoning ?? "").trim();
    // Batas waktu TANPA potongan: model yang benar-benar berpikir tidak mengirim apa pun
    // sementara ia bekerja, jadi reasoning dapat jatah panjang (sama seperti non-stream).
    // Tanpa reasoning angkanya TIDAK berubah (TIMEOUT_TEKS_MS).
    const timeoutMs = pakaiReasoning ? TIMEOUT_TEKS_REASONING_MS : TIMEOUT_TEKS_MS;
    if (k.provider === "gemini") {
      catatan.push({ provider: k.provider, model: k.model, error: "dilewati: jalur streaming belum tersedia untuk gemini" });
      continue;
    }
    const opsi = opsiUntuk(k.provider, k.apiKey, ctx, timeoutMs, k.baseUrl);
    if (!opsi) {
      catatan.push({ provider: k.provider, model: k.model, error: `Provider ${k.provider} tidak mendukung chat teks.` });
      continue;
    }
    const s = await streamJson({
      baseUrl: opsi.baseUrl,
      apiKey: opsi.apiKey,
      provider: k.provider,
      model: k.model,
      pesan: minta.pesan,
      tool: minta.tool,
      maksToken: minta.maksToken,
      reasoning: minta.reasoning,
      reasoningHilir: minta.reasoningHilir,
      timeoutMs,
      totalMs: Math.max(1000, ANGGARAN_TEKS_MS - (Date.now() - mulai)),
    });
    if (!s.ok) {
      // Gagal SEBELUM potongan apa pun: aman pindah kandidat berikutnya.
      catatan.push({ provider: k.provider, model: k.model, error: s.error });
      continue;
    }

    // Potongan pertama sudah menentukan kandidat ini. Token/usage dari SSE (bila provider
    // mengirimnya) dicatat sebagai agregat satu baris; kegagalan pencatatan tidak boleh
    // menggagalkan jawaban yang sudah terkirim ke user.
    const dalam = s.iter;
    const dipakai = { provider: k.provider, model: k.model };
    const masuk = { nilai: 0 };
    const keluar = { nilai: 0 };
    async function* potongan(): AsyncGenerator<PotonganStream> {
      let teksAda = false;
      try {
        for await (const p of dalam) {
          if (p.tokenMasuk !== undefined) masuk.nilai = p.tokenMasuk;
          if (p.tokenKeluar !== undefined) keluar.nilai = p.tokenKeluar;
          if (p.delta) teksAda = true;
          yield p;
        }
      } finally {
        if (teksAda) {
          await catatPemakaian(ctx.db, {
            provider: dipakai.provider,
            model: dipakai.model,
            jenis: "teks",
            tokenMasuk: masuk.nilai,
            tokenKeluar: keluar.nilai,
          }).catch(() => undefined);
        }
      }
    }
    return { ok: true, provider: k.provider, model: k.model, potongan: potongan() };
  }
  return gagal(502, ringkasGagal(catatan, rantai), catatan);
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
): Promise<Hasil<{ base64: string; mime: string; provider: string; model: string; dilewati?: string }>> {
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
      return gagal<{ base64: string; mime: string; provider: string; model: string; dilewati?: string }>(
        400,
        `Tidak ada kredensial aktif untuk: ${perlu.join(", ")}. ` +
          `Isi API key provider itu di Pengaturan → Kredensial Provider, ` +
          `atau pilih provider yang kredensialnya sudah ada (mis. di Model Default).`
      );
    }
    return gagal<{ base64: string; mime: string; provider: string; model: string; dilewati?: string }>(502, ringkasGagal(catatan));
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
      // Bila ada percobaan yang dilewati sebelum model ini berhasil, sertakan di
      // respons supaya user tahu model pilihannya bermasalah (tidak diam-diam jatuh
      // ke model lain dan membingungkan).
      const dilewati = catatan.length > 0 ? ` Dilewati: ${ringkasGagal(catatan)}` : "";
      return { ok: true, base64: h.data.base64, mime: h.data.mime, provider, model, dilewati };
    }
  }
  return gagalSemua();
}
