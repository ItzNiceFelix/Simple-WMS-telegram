// lib/ai/provider.test.ts — Rantai kandidat teks: batas per-provider, batas jumlah
// model, dan pesan gagal yang menyebut provider belum dicoba.
//
// KENAPA TEST INI ADA (dari pesan gagal nyata di produksi):
//   kenari/solar-mini4:free: Timeout provider setelah 60000ms
//   kenari/deepseek-v4-flash: dilewati: anggaran total 100000ms habis
//   ... (21 model kenari lain dilewati)
//   gemini/gemini-2.5-flash: dilewati: anggaran total 100000ms habis
// Satu provider (kenari) dengan 23 model memakan seluruh anggaran, sehingga provider
// berikutnya (gemini, kredensialnya sehat) TIDAK PERNAH dicoba. Test ini mengunci
// perilaku yang benar: provider lambat tidak boleh memblokir provider berikutnya.
//
// Catatan waktu: uji memakai jam palsu + timer dipersingkat supaya tidak menunggu
// puluhan detik nyata untuk membuktikan urutan percobaan.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANGGARAN_PROVIDER_MS, MAKS_MODEL_PER_PROVIDER, panggilTeks } from "./provider";
import { enkripsi } from "./kripto";

const KUNCI = "Y2JjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=";

type BarisKred = {
  id: number;
  provider: string;
  label: string;
  ciphertext: string;
  iv: string;
  tag: string;
  ujung: string;
  aktif: number;
  base_url: string;
};
type BarisModel = { id: number; provider: string; model_id: string; jenis: string; aktif: number };

/** D1 palsu: cukup setia pada prepare/bind/first/all/run yang dipakai provider.ts + lib/d1. */
function buatDb(opsi: { kredensial: BarisKred[]; model: BarisModel[]; settings?: Record<string, unknown> }) {
  const pemakaian: unknown[][] = [];
  const settings = opsi.settings ?? {};
  const db = {
    pemakaian,
    prepare(sql: string) {
      const st = {
        _args: [] as unknown[],
        bind(...a: unknown[]) {
          st._args = a;
          return st;
        },
        async first() {
          if (sql.includes("FROM settings")) return { value: JSON.stringify(settings) };
          if (sql.includes("FROM ai_kredensial")) {
            const p = String(st._args[0] ?? "").toLowerCase();
            const k = opsi.kredensial.filter((x) => x.provider === p && x.aktif === 1).sort((a, b) => b.id - a.id)[0];
            return k ?? null;
          }
          return null;
        },
        async all() {
          const results: unknown[] = [];
          if (sql.includes("FROM ai_model")) {
            const p = String(st._args[0] ?? "").toLowerCase();
            for (const m of opsi.model.filter((x) => x.provider === p)) results.push(m);
          }
          return { results };
        },
        async run() {
          if (sql.includes("INTO ai_pemakaian")) pemakaian.push(st._args);
          return { meta: { changes: 1 } };
        },
      };
      return st;
    },
  };
  return db as unknown as D1Database;
}

/** Baris kredensial AES-GCM asli supaya `ambilKredensial` benar-benar mendekripsi. */
async function kred(provider: string, apiKey: string, id: number): Promise<BarisKred> {
  const t = await enkripsi(apiKey, KUNCI);
  return { id, provider, label: provider, ciphertext: t.ciphertext, iv: t.iv, tag: t.tag, ujung: t.ujung, aktif: 1, base_url: "" };
}

/** Katalog model aktif urut `id` — pola nyata: puluhan model satu provider. */
function model(provider: string, jumlah: number, mulaiId = 1): BarisModel[] {
  const keluar: BarisModel[] = [];
  for (let i = 0; i < jumlah; i++) {
    keluar.push({ id: mulaiId + i, provider, model_id: `${provider}-model-${i + 1}`, jenis: "teks", aktif: 1 });
  }
  return keluar;
}

type Panggilan = { provider: string; model: string };

/** Nama model dari body permintaan adapter; body bukan JSON = "" (bukan lempar). */
function namaModelDariBody(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") return "";
  try {
    const data: unknown = JSON.parse(body);
    if (data && typeof data === "object" && "model" in data) return String(data.model ?? "");
  } catch {
    /* body bukan JSON */
  }
  return "";
}

const NAMA_PER_FRAGMEN: Record<string, string> = {
  generativelanguage: "gemini",
  kenari: "kenari",
  groq: "groq",
};

/**
 * fetch palsu: provider di `lambat` pertama kali menggantung sampai AbortController
 * memutus (meniru timeout provider nyata), provider di `sukses` membalas 200.
 *
 * Jam palsu hanya dimajukan SEKALI per (provider, model) — bukan per panggilan —
 * supaya percobaan ulang adapter tidak menggelembungkan waktu yang terpakai dan
 * menyamarkan perilaku anggaran yang sedang diuji. Percobaan ulang setelah timeout
 * dibalas 400 (tidak layak diulang) agar tidak menunggu lagi.
 */
function fetchPalsu(aturan: { lambat: string[]; sukses: string[]; log: Panggilan[]; majuSekaliPerModel?: (ms: number) => void; majuMs?: number }) {
  const sudahLambat = new Set<string>();
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    const provider = Object.entries(NAMA_PER_FRAGMEN).find(([frag]) => u.includes(frag))?.[1] ?? "lain";
    const model = namaModelDariBody(init?.body);
    aturan.log.push({ provider, model });
    if (aturan.sukses.includes(provider)) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "dari gemini" }] } }] }),
      } as unknown as Response;
    }
    const kunci = `${provider}/${model}`;
    if (sudahLambat.has(kunci)) {
      return { ok: false, status: 400, text: async () => "sudah timeout" } as unknown as Response;
    }
    sudahLambat.add(kunci);
    aturan.majuSekaliPerModel?.(aturan.majuMs ?? 0);
    // Provider lambat: bertahan sampai adapter membatalkan lewat signal.
    return new Promise<Response>((_resolve, reject) => {
      const ac = init?.signal;
      const bunuh = () => {
        const e = new Error("This operation was aborted");
        e.name = "AbortError";
        reject(e);
      };
      if (ac?.aborted) return bunuh();
      ac?.addEventListener("abort", bunuh);
    });
  };
}

/**
 * Jalankan `fn` dengan jam palsu dan timer yang langsung menyala. Timer langsung
 * menyala = AbortController adapter memutus seketika, sehingga percobaan "lambat"
 * tidak menunggu puluhan detik nyata. Jam palsu dimajukan lewat `maju(ms)`.
 */
async function denganJamPalsu<T>(fn: (maju: (ms: number) => void) => Promise<T>): Promise<T> {
  const asliFetch = globalThis.fetch;
  const asliSetTimeout = globalThis.setTimeout;
  const asliDateNow = Date.now;
  let jam = 1_000_000;
  Date.now = () => jam;
  // Timer langsung menyala: adapter memutus percobaan seketika, jadi uji tidak
  // menunggu puluhan detik nyata. Nilai balik timer tidak dipakai adapter.
  globalThis.setTimeout = ((cb: () => void) => {
    cb();
    return asliSetTimeout(cb, 0);
  }) as typeof globalThis.setTimeout;
  try {
    return await fn((ms) => (jam += ms));
  } finally {
    globalThis.fetch = asliFetch;
    globalThis.setTimeout = asliSetTimeout;
    Date.now = asliDateNow;
  }
}

describe("rantai kandidat teks", () => {
  it("provider pertama yang TIMEOUT tidak mencegah provider berikutnya dicoba (kasus produksi)", async () => {
    const settings = {
      textProvider: "kenari",
      chainTeks: ["kenari", "groq", "gemini"],
      modelTeks: { kenari: "solar-mini4:free" },
      modelVision: {},
      modelGambar: {},
      totalTimeoutMs: 240000,
    };
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1), await kred("gemini", "key-gemini", 2)],
      model: [...model("kenari", 23, 1), ...model("gemini", 46, 100)],
      settings,
    });

    const log: Panggilan[] = [];
    await denganJamPalsu(async (maju) => {
      // Tiap percobaan jaringan memakan TIMEOUT_TEKS_MS (kenari menggantung lalu
      // dibatalkan). Setelah 35 detik, anggaran provider kenari habis → gemini dicoba.
      globalThis.fetch = fetchPalsu({
        lambat: ["kenari"],
        sukses: ["gemini"],
        log,
        majuSekaliPerModel: maju,
        majuMs: ANGGARAN_PROVIDER_MS,
      }) as unknown as typeof fetch;

      const hasil = await panggilTeks(
        { db, kunci: KUNCI },
        { pesan: [{ role: "user", teks: "halo" }], reasoning: "high", maksToken: 16000 }
      );

      assert.equal(hasil.ok, true, `harus sukses lewat gemini, bukan gagal total: ${hasil.ok ? "" : hasil.error}`);
      if (!hasil.ok) return;
      assert.equal(hasil.provider, "gemini", "hasil akhir harus dari provider kedua (gemini)");
      assert.equal(hasil.teks, "dari gemini");
      assert.ok(log.some((p) => p.provider === "gemini"), "gemini HARUS benar-benar dipanggil walau kenari lambat");
      assert.equal(log.some((p) => p.provider === "groq"), false, "groq tanpa kredensial tidak boleh di-fetch");
    });
  });

  it("per provider maksimal MAKS_MODEL_PER_PROVIDER model dicoba (bukan seluruh katalog)", async () => {
    const settings = {
      textProvider: "kenari",
      chainTeks: ["kenari"],
      modelTeks: { kenari: "solar-mini4:free" },
      modelVision: {},
      modelGambar: {},
    };
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1)],
      model: model("kenari", 23, 1),
      settings,
    });

    const log: Panggilan[] = [];
    await denganJamPalsu(async () => {
      // Jaringan mati (bukan timeout): adapter boleh mengulang, jadi hitung MODEL unik.
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        log.push({ provider: Object.entries(NAMA_PER_FRAGMEN).find(([frag]) => u.includes(frag))?.[1] ?? "lain", model: namaModelDariBody(init?.body) });
        throw new Error("jaringan mati");
      }) as unknown as typeof fetch;

      const hasil = await panggilTeks({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }] });
      assert.equal(hasil.ok, false);
      const modelUnik = [...new Set(log.map((p) => p.model))];
      assert.equal(modelUnik.length, MAKS_MODEL_PER_PROVIDER, `hanya ${MAKS_MODEL_PER_PROVIDER} model yang boleh dicoba`);
      assert.equal(modelUnik[0], "solar-mini4:free", "model yang diminta user harus nomor satu");
      // Sisa katalog harus DISEBUT, bukan dibiarkan tampak sudah dicoba habis.
      const pesan = hasil.ok ? "" : hasil.error;
      assert.match(pesan, /21 model lain tidak dicoba/, `pesan harus menyebut sisa katalog: ${pesan}`);
    });
  });

  it("anggaran provider habis -> sisa model provider itu dilewati, provider berikutnya tetap dicoba", async () => {
    const settings = {
      textProvider: "kenari",
      chainTeks: ["kenari", "gemini"],
      modelTeks: { kenari: "kenari-lambat" },
      modelVision: {},
      modelGambar: {},
    };
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1), await kred("gemini", "key-gemini", 2)],
      model: [...model("kenari", 3, 1), ...model("gemini", 2, 50)],
      settings,
    });

    const log: Panggilan[] = [];
    await denganJamPalsu(async (maju) => {
      // Percobaan pertama kenari langsung menghabiskan anggaran provider, jadi
      // dua model kenari berikutnya dilewati tanpa panggilan jaringan sama sekali.
      globalThis.fetch = fetchPalsu({
        lambat: ["kenari"],
        sukses: ["gemini"],
        log,
        majuSekaliPerModel: maju,
        majuMs: ANGGARAN_PROVIDER_MS,
      }) as unknown as typeof fetch;

      const hasil = await panggilTeks({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }] });
      assert.equal(hasil.ok, true, `gemini harus tetap dicoba: ${hasil.ok ? "" : hasil.error}`);
      if (!hasil.ok) return;
      assert.equal(hasil.provider, "gemini");
      assert.ok(log.some((p) => p.provider === "gemini"), "provider berikutnya harus dicoba setelah anggaran provider pertama habis");
      const modelKenari = [...new Set(log.filter((p) => p.provider === "kenari").map((p) => p.model))];
      assert.deepEqual(modelKenari, ["kenari-lambat"], "hanya model pertama kenari yang dicoba; sisanya dilewati (anggaran provider habis)");
    });
  });

  it("pesan gagal menyebut provider yang belum dicoba karena kredensial", async () => {
    const settings = {
      textProvider: "kenari",
      chainTeks: ["kenari", "groq"],
      modelTeks: { kenari: "solar-mini4:free" },
      modelVision: {},
      modelGambar: {},
    };
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1)],
      model: model("kenari", 2, 1),
      settings,
    });

    await denganJamPalsu(async () => {
      globalThis.fetch = (async () => {
        throw new Error("jaringan mati");
      }) as unknown as typeof fetch;

      const hasil = await panggilTeks({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }] });
      assert.equal(hasil.ok, false);
      const pesan = hasil.ok ? "" : hasil.error;
      assert.match(pesan, /tidak ada kredensial aktif/, "kenari/groq tanpa kredensial");
      assert.match(pesan, /groq/, `provider tanpa kredensial harus disebut: ${pesan}`);
      assert.match(pesan, /Masih ada provider yang bisa dicoba/, `harus ada kalimat penutup penuntun: ${pesan}`);
      assert.match(pesan, /Kredensial Provider/, "harus menuntun ke tempat mengisi API key");
    });
  });
});
