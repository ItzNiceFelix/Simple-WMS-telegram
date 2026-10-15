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
import {
  ANGGARAN_PROVIDER_MS,
  ANGGARAN_TEKS_MS,
  MAKS_MODEL_PER_PROVIDER,
  TIMEOUT_TEKS_MS,
  TIMEOUT_TEKS_REASONING_MS,
  batasPercobaanTeks,
  panggilTeks,
  panggilTeksStream,
} from "./provider";
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
      assert.match(pesan, new RegExp(`${21 - (MAKS_MODEL_PER_PROVIDER - 3)} model lain tidak dicoba`), `pesan harus menyebut sisa katalog: ${pesan}`);
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

/**
 * SSE palsu: potongan dibalas bertahap lewat ReadableStream, jadi jalur streaming
 * diuji apa adanya (parsing buffer + `data: [DONE]`), bukan lewat mock fungsi.
 */
function badanSSE(isi: string[], opsi: { usage?: boolean } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const potongan = [
    ...isi.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`),
    // Baris asing TIDAK boleh menggagalkan stream — bentuk ini nyata dikirim provider.
    "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n",
    "data: bukan-json\n\n",
    ...(opsi.usage ? [`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`] : []),
    // Sebagian provider memakai CRLF — harus terbaca sama.
    `data: ${JSON.stringify({ choices: [{ delta: { content: "!" } }] })}\r\n\r\n`,
    "data: [DONE]\n\n",
  ];
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of potongan) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

describe("panggilTeksStream", () => {
  const settings = {
    textProvider: "kenari",
    chainTeks: ["kenari", "groq"],
    modelTeks: { kenari: "kenari-cepat" },
    modelVision: {},
    modelGambar: {},
  };

  it("mengembalikan potongan bertahap (bukan satu blok) + metadata provider/model", async () => {
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1)],
      model: model("kenari", 1, 1),
      settings,
    });
    globalThis.fetch = (async () =>
      ({ ok: true, status: 200, body: badanSSE(["Ha", "lo", " dunia"], { usage: true }) }) as unknown as Response) as unknown as typeof fetch;

    const hasil = await panggilTeksStream({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }] });
    assert.equal(hasil.ok, true, `harus ok: ${hasil.ok ? "" : hasil.error}`);
    if (!hasil.ok) return;
    assert.equal(hasil.provider, "kenari");
    assert.equal(hasil.model, "kenari-cepat", "model pilihan user harus yang dipakai");
    let teks = "";
    let jumlahPotongan = 0;
    for await (const p of hasil.potongan) {
      if (p.delta) {
        teks += p.delta;
        jumlahPotongan += 1;
      }
    }
    assert.equal(teks, "Halo dunia!");
    assert.equal(jumlahPotongan, 4, "tiap delta harus terkirim terpisah, bukan digabung di akhir (termasuk event CRLF)");
    // Token dari event usage dicatat sebagai agregat; kegagalan catat tidak boleh melempar.
    assert.deepEqual(db.pemakaian[0]?.slice(1, 6), ["kenari", "kenari-cepat", "teks", 7, 3]);
  });

  it("gagal SEBELUM potongan -> lanjut kandidat berikutnya; provider kedua dipakai", async () => {
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1), await kred("groq", "key-groq", 2)],
      model: [...model("kenari", 1, 1), ...model("groq", 1, 9)],
      settings: { ...settings, modelTeks: { kenari: "kenari-cepat", groq: "groq-cepat" } },
    });
    const dipanggil: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      dipanggil.push(u);
      if (u.includes("kenari")) return { ok: false, status: 400, text: async () => "kredensial ditolak" } as unknown as Response;
      return { ok: true, status: 200, body: badanSSE(["dari groq"]) } as unknown as Response;
    }) as unknown as typeof fetch;

    const hasil = await panggilTeksStream({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }] });
    assert.equal(hasil.ok, true, `harus pindah ke groq: ${hasil.ok ? "" : hasil.error}`);
    if (!hasil.ok) return;
    assert.equal(hasil.provider, "groq");
    let teks = "";
    for await (const p of hasil.potongan) teks += p.delta;
    assert.equal(teks, "dari groq!");
    assert.ok(dipanggil.some((u) => u.includes("kenari")), "kenari harus dicoba lebih dulu");
    assert.ok(dipanggil.some((u) => u.includes("groq")), "groq harus dicoba setelah kenari gagal sebelum potongan");
    assert.ok(
      dipanggil.findIndex((u) => u.includes("groq")) > dipanggil.findIndex((u) => u.includes("kenari")),
      "urutan percobaan harus mengikuti rantai: semua kandidat kenari dulu, baru groq"
    );
  });

  it("semua provider gagal sebelum potongan -> pesan menyebut provider/model yang dicoba", async () => {
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1)],
      model: model("kenari", 1, 1),
      settings,
    });
    globalThis.fetch = (async () => {
      throw new Error("jaringan mati");
    }) as unknown as typeof fetch;

    const hasil = await panggilTeksStream({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }] });
    assert.equal(hasil.ok, false);
    const pesan = hasil.ok ? "" : hasil.error;
    assert.match(pesan, /kenari\/kenari-model-1/);
    assert.match(pesan, /jaringan mati/);
  });
});

describe("panggilTeksStream — aturan tidak pindah provider setelah potongan pertama", () => {
  it("stream yang putus SETELAH potongan pertama TIDAK difallback ke provider berikutnya", async () => {
    const settings = {
      textProvider: "kenari",
      chainTeks: ["kenari", "groq"],
      modelTeks: { kenari: "kenari-cepat", groq: "groq-cepat" },
      modelVision: {},
      modelGambar: {},
    };
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1), await kred("groq", "key-groq", 2)],
      model: [...model("kenari", 1, 1), ...model("groq", 1, 9)],
      settings,
    });
    const enc = new TextEncoder();
    const dipanggil: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      dipanggil.push(u);
      if (u.includes("groq")) return { ok: true, status: 200, body: badanSSE(["dari groq"]) } as unknown as Response;
      // Kenari: kirim satu potongan lalu MATI di tengah jalan (bukan [DONE]).
      let kirim = 0;
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          pull(c) {
            if (kirim === 0) {
              kirim += 1;
              c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "awal" } }] })}\n\n`));
              return;
            }
            c.error(new Error("koneksi putus di tengah jawaban"));
          },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const hasil = await panggilTeksStream({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }] });
    assert.equal(hasil.ok, true, "stream kenari sudah terpilih saat potongan pertama terkirim");
    if (!hasil.ok) return;
    assert.equal(hasil.provider, "kenari");
    let teks = "";
    await assert.rejects(async () => {
      for await (const p of hasil.potongan) teks += p.delta;
    }, /koneksi putus/);
    assert.equal(teks, "awal", "potongan yang sudah terkirim tidak boleh hilang");
    assert.equal(dipanggil.some((u) => u.includes("groq")), false, "provider TIDAK boleh diganti setelah ada potongan terkirim");
  });
});

/**
 * SSE palsu bentuk GEMINI (`candidates[0].content.parts[].text`) — beda dari `badanSSE`
 * di atas yang meniru OpenAI (`choices[0].delta.content`).
 */
function badanSSEGemini(teks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const t of teks) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`));
      }
      c.close();
    },
  });
}

describe("panggilTeksStream — gemini ikut dicoba", () => {
  it("gemini TIDAK lagi dilewati: SSE-nya dibaca lewat endpoint streamGenerateContent", async () => {
    const settings = {
      textProvider: "kenari",
      chainTeks: ["kenari", "gemini"],
      modelTeks: { kenari: "kenari-cepat", gemini: "gemini-2.5-flash" },
      modelVision: {},
      modelGambar: {},
    };
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1), await kred("gemini", "key-gemini", 2)],
      model: [...model("kenari", 1, 1), ...model("gemini", 1, 9)],
      settings,
    });
    const dipanggil: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      dipanggil.push(u);
      if (u.includes("kenari")) return { ok: false, status: 400, text: async () => "kredensial ditolak" } as unknown as Response;
      return { ok: true, status: 200, body: badanSSEGemini(["dari ", "gemini"]) } as unknown as Response;
    }) as unknown as typeof fetch;

    const hasil = await panggilTeksStream({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }], reasoning: "high" });
    assert.equal(hasil.ok, true, `gemini harus dipakai, bukan dilewati: ${hasil.ok ? "" : hasil.error}`);
    if (!hasil.ok) return;
    assert.equal(hasil.provider, "gemini");
    assert.equal(hasil.model, "gemini-2.5-flash");
    let teks = "";
    for await (const p of hasil.potongan) teks += p.delta;
    assert.equal(teks, "dari gemini", "parts[].text SSE Gemini harus terbaca sebagai delta");
    assert.ok(dipanggil.some((u) => u.includes(":streamGenerateContent")), "endpoint streaming Gemini harus dipakai");
  });
});

/**
 * fetch yang SELALU menggantung sampai adapter membatalkannya lewat AbortController —
 * meniru model yang tidak menjawab (timeout provider nyata). `maju` mensimulasikan jam
 * yang berjalan selama percobaan itu.
 */
function fetchHitung(log: Panggilan[], maju: (ms: number) => void, ms: number) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    log.push({ provider: Object.entries(NAMA_PER_FRAGMEN).find(([frag]) => u.includes(frag))?.[1] ?? "lain", model: namaModelDariBody(init?.body) });
    maju(ms);
    return new Promise<Response>((_resolve, reject) => {
      const bunuh = () => {
        const e = new Error("This operation was aborted");
        e.name = "AbortError";
        reject(e);
      };
      const ac = init?.signal;
      if (ac?.aborted) return bunuh();
      ac?.addEventListener("abort", bunuh);
    });
  };
}

describe("anggaran percobaan: timeout tidak diulang, provider berikutnya selalu dicoba", () => {
  it("timeout TIDAK diulang: satu kandidat = SATU panggilan jaringan (bukan tiga)", async () => {
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1)],
      // Satu kandidat saja, supaya jumlah panggilan murni milik kandidat pertama.
      model: [{ id: 1, provider: "kenari", model_id: "kenari-lambat", jenis: "teks", aktif: 1 }],
      settings: { textProvider: "kenari", chainTeks: ["kenari"], modelTeks: { kenari: "kenari-lambat" }, modelVision: {}, modelGambar: {} },
    });

    const log: Panggilan[] = [];
    await denganJamPalsu(async (maju) => {
      globalThis.fetch = fetchHitung(log, maju, TIMEOUT_TEKS_MS) as unknown as typeof fetch;

      const hasil = await panggilTeks({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }] });

      assert.equal(hasil.ok, false);
      assert.equal(log.length, 1, `timeout tidak boleh diulang: ${log.length} panggilan untuk satu kandidat`);
      assert.equal(log[0]?.model, "kenari-lambat");
      const upaya = hasil.ok ? [] : hasil.upaya ?? [];
      assert.equal(upaya[0]?.error, `Timeout provider setelah ${TIMEOUT_TEKS_MS}ms.`, "pesan timeout harus tetap sama (UI tidak berubah)");
    });
  });

  it("429/5xx TETAP diulang: 500 lalu 200 -> sukses dengan dua panggilan", async () => {
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1)],
      model: [{ id: 1, provider: "kenari", model_id: "kenari-model-1", jenis: "teks", aktif: 1 }],
      settings: { textProvider: "kenari", chainTeks: ["kenari"], modelTeks: {}, modelVision: {}, modelGambar: {} },
    });

    let panggilan = 0;
    await denganJamPalsu(async () => {
      globalThis.fetch = (async () => {
        panggilan += 1;
        if (panggilan === 1) return { ok: false, status: 500, text: async () => "gangguan sementara" } as unknown as Response;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: "halo juga" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const hasil = await panggilTeks({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }] });

      assert.equal(hasil.ok, true, `5xx harus tetap diulang: ${hasil.ok ? "" : hasil.error}`);
      assert.equal(panggilan, 2, "500 diulang sekali, lalu 200 dipakai");
      if (hasil.ok) assert.equal(hasil.teks, "halo juga");
    });
  });

  it("provider kedua BENAR-BENAR dicoba setelah provider pertama timeout (bukan 'anggaran total habis')", async () => {
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1), await kred("gemini", "key-gemini", 2)],
      model: [...model("kenari", 1, 1), ...model("gemini", 1, 50)],
      settings: {
        textProvider: "kenari",
        chainTeks: ["kenari", "gemini"],
        modelTeks: { kenari: "kenari-lambat", gemini: "gemini-lambat" },
        modelVision: {},
        modelGambar: {},
      },
    });

    const log: Panggilan[] = [];
    await denganJamPalsu(async (maju) => {
      // Kedua provider menggantung; tiap percobaan memakai jatah penuh kandidat pertama
      // (TIMEOUT_TEKS_REASONING_MS) sehingga anggaran TOTAL tetap menyisakan jatah provider
      // penuh untuk gemini.
      globalThis.fetch = fetchPalsu({ lambat: ["kenari", "gemini"], sukses: [], log, majuSekaliPerModel: maju, majuMs: TIMEOUT_TEKS_REASONING_MS }) as unknown as typeof fetch;

      const hasil = await panggilTeks({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }], reasoning: "high" });

      assert.equal(hasil.ok, false);
      assert.ok(log.some((p) => p.provider === "gemini"), "gemini HARUS benar-benar dipanggil, bukan dilewati");
      const upaya = hasil.ok ? [] : hasil.upaya ?? [];
      const gemini = upaya.find((u) => u.provider === "gemini");
      assert.ok(gemini, `catatan harus memuat percobaan gemini: ${JSON.stringify(upaya)}`);
      assert.match(gemini.error, new RegExp(`Timeout provider setelah ${TIMEOUT_TEKS_REASONING_MS}ms`), "gemini memakai jatah penuh providernya sendiri");
      assert.doesNotMatch(gemini.error, /anggaran total .*habis/, `gemini tidak boleh dilewati karena anggaran total habis: ${gemini.error}`);
    });
  });

  it("satu percobaan tidak melewati sisa anggaran provider (kandidat cadangan dibatasi sisa)", async () => {
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1)],
      model: model("kenari", 2, 1),
      settings: { textProvider: "kenari", chainTeks: ["kenari"], modelTeks: { kenari: "kenari-lambat" }, modelVision: {}, modelGambar: {} },
    });

    const log: Panggilan[] = [];
    await denganJamPalsu(async (maju) => {
      // Tiap percobaan menggantung dan menghabiskan TIMEOUT_TEKS_REASONING_MS jam palsu.
      globalThis.fetch = fetchHitung(log, maju, TIMEOUT_TEKS_REASONING_MS) as unknown as typeof fetch;

      const hasil = await panggilTeks({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }], reasoning: "high" });

      assert.equal(hasil.ok, false);
      const upaya = hasil.ok ? [] : hasil.upaya ?? [];
      assert.equal(upaya[0]?.error, `Timeout provider setelah ${TIMEOUT_TEKS_REASONING_MS}ms.`, "kandidat pertama (pilihan user) dapat jatah penuh");
      // Sisa anggaran provider = ANGGARAN_PROVIDER_MS - TIMEOUT_TEKS_REASONING_MS, dan
      // kandidat cadangan TIDAK BOLEH memakai lebih dari sisa itu.
      const sisa = ANGGARAN_PROVIDER_MS - TIMEOUT_TEKS_REASONING_MS;
      assert.equal(upaya[1]?.error, `Timeout provider setelah ${sisa}ms.`, "kandidat cadangan dibatasi sisa anggaran provider");
      assert.match(upaya[2]?.error ?? "", /anggaran provider kenari habis/, `kandidat ketiga harus dilewati: ${upaya[2]?.error}`);
      assert.equal(log.length, 2, "kandidat yang dilewati tidak boleh memanggil jaringan");
    });
  });

  it("batasPercobaanTeks: jatah penuh hanya untuk kandidat pertama, sisanya dibatasi sisa", () => {
    assert.equal(batasPercobaanTeks(true, true, ANGGARAN_PROVIDER_MS, ANGGARAN_TEKS_MS), TIMEOUT_TEKS_REASONING_MS);
    assert.equal(batasPercobaanTeks(false, true, ANGGARAN_PROVIDER_MS, ANGGARAN_TEKS_MS), TIMEOUT_TEKS_MS);
    // Kandidat cadangan: dibatasi TIMEOUT_TEKS_MS walau reasoning aktif.
    assert.equal(batasPercobaanTeks(true, false, ANGGARAN_PROVIDER_MS, ANGGARAN_TEKS_MS), TIMEOUT_TEKS_MS);
    // Sisa anggaran provider/total yang lebih kecil selalu menang.
    assert.equal(batasPercobaanTeks(true, false, 10000, ANGGARAN_TEKS_MS), 10000);
    assert.equal(batasPercobaanTeks(true, true, ANGGARAN_PROVIDER_MS, 5000), 5000);
  });

  it("anggaran total = jumlah provider rantai default x anggaran provider", () => {
    assert.equal(ANGGARAN_TEKS_MS, 3 * ANGGARAN_PROVIDER_MS, "tiap provider di rantai (3) harus kebagian jatah utuh");
    assert.ok(ANGGARAN_PROVIDER_MS > TIMEOUT_TEKS_REASONING_MS, "anggaran provider harus lebih besar dari satu percobaan reasoning supaya cadangan kebagian");
  });
});

describe("urutan kandidat: model :free di belakang model berbayar", () => {
  const katalog: BarisModel[] = [
    { id: 1, provider: "kenari", model_id: "model-a:free", jenis: "teks", aktif: 1 },
    { id: 2, provider: "kenari", model_id: "model-b", jenis: "teks", aktif: 1 },
    { id: 3, provider: "kenari", model_id: "model-c:free", jenis: "teks", aktif: 1 },
    { id: 4, provider: "kenari", model_id: "model-d", jenis: "teks", aktif: 1 },
  ];

  /** Urutan MODEL unik yang benar-benar dicoba (jaringan mati: semua kandidat dijejer). */
  async function urutanKandidat(modelTeks: Record<string, string>): Promise<string[]> {
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1)],
      model: katalog,
      settings: { textProvider: "kenari", chainTeks: ["kenari"], modelTeks, modelVision: {}, modelGambar: {} },
    });
    const log: Panggilan[] = [];
    await denganJamPalsu(async () => {
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        log.push({ provider: Object.entries(NAMA_PER_FRAGMEN).find(([frag]) => u.includes(frag))?.[1] ?? "lain", model: namaModelDariBody(init?.body) });
        throw new Error("jaringan mati");
      }) as unknown as typeof fetch;
      await panggilTeks({ db, kunci: KUNCI }, { pesan: [{ role: "user", teks: "halo" }] });
    });
    return [...new Set(log.map((p) => p.model))];
  }

  it("model :free mengantre di sisi penyedia -> ditaruh SETELAH model berbayar", async () => {
    assert.deepEqual(
      await urutanKandidat({}),
      ["model-b", "model-d", "model-a:free", "model-c:free"],
      "berbayar dulu (urut id), lalu :free (urut id) — model :free bukan kandidat pertama"
    );
  });

  it("model :free yang DIPILIH user tetap nomor satu", async () => {
    assert.deepEqual(await urutanKandidat({ kenari: "model-c:free" }), ["model-c:free", "model-b", "model-d", "model-a:free"]);
  });
});
