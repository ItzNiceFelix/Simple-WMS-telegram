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

/**
 * Role owner untuk konteks uji: `himpunanIzin` mengembalikan `null` (tanpa batas) sehingga
 * uji rantai mengukur PERILAKU RANTAI, bukan allowlist per role (fitur terpisah, diuji di
 * suite `hanyaModelDipilih`). Tanpa ini, setiap kandidat ditolak lebih dulu dan yang terukur
 * hanyalah fail-closed-nya izin.
 */
const OWNER = "owner";

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
function buatDb(opsi: {
  kredensial: BarisKred[];
  model: BarisModel[];
  settings?: Record<string, unknown>;
  /** Override izin per (role, jenis); default: SEMUA model katalog jenis itu diizinkan. */
  izin?: { allowedUntuk?: (role: string, jenis: string) => boolean };
}) {
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
          if (sql.includes("FROM ai_model_izin")) {
            // Tabel izin per role (migrasi 0035). Tanpa pemodelan ini `himpunanIzin`
            // fail-closed dan SELURUH uji rantai gagal karena satu baris kueri mock —
            // bukan karena produksi. `_args` = [role, jenis]; mock memaksakan aturan
            // produksi: baris SELALU ada untuk setiap pasangan role+jenis, `allowed`
            // ditentukan `opsi.izin` (default 1 = diizinkan) supaya uji izin bisa
            // memaksa penolakan tanpa mengubah mock.
            const role = String(st._args[0] ?? "");
            const jenis = String(st._args[1] ?? "");
            // Kueri produksi memuat `AND allowed = 1`, jadi baris yang ditolak TIDAK ikut
            // terpilih. Default izin = diizinkan (tabel terisi), `allowedUntuk` dipakai uji
            // yang memang perlu membuktikan penolakan.
            const allowed = opsi.izin?.allowedUntuk?.(role, jenis) ?? true;
            if (allowed) {
              for (const m of opsi.model.filter((x) => x.jenis === jenis)) {
                results.push({ provider: m.provider, model_id: m.model_id, allowed: 1 });
              }
            }
          } else if (sql.includes("FROM ai_model")) {
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

type Panggilan = { provider: string; model: string; /** Body permintaan apa adanya — dipakai uji reasoning (mis. ada/tidaknya `reasoning_effort`). */ body?: string };

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
    aturan.log.push({ provider, model, body: String(init?.body ?? "") });
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
  // Timer "langsung menyala": adapter memutus percobaan seketika, jadi uji tidak menunggu
  // puluhan detik nyata. Sengaja lewat MACROTASK (`setTimeout(…, 0)`), BUKAN panggilan
  // sinkron: timer yang menyala sinkron selalu menang atas bacaan stream yang datanya sudah
  // ada, sehingga jalur streaming tidak bisa dibedakan antara "potongan tiba" dan "timeout".
  globalThis.setTimeout = ((cb: () => void) => asliSetTimeout(cb, 0)) as typeof globalThis.setTimeout;
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
        { db, kunci: KUNCI, role: OWNER },
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

      const hasil = await panggilTeks({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });
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

      const hasil = await panggilTeks({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });
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

      const hasil = await panggilTeks({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });
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

    const hasil = await panggilTeksStream({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });
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

    const hasil = await panggilTeksStream({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });
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

    const hasil = await panggilTeksStream({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });
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

    const hasil = await panggilTeksStream({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });
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

    const hasil = await panggilTeksStream({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }], reasoning: "high" });
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

/** Badan respons 200 yang TIDAK PERNAH mengirim potongan: model berpikir DIAM sampai timeout. */
function badanTanpaPotongan(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start() {
      // sengaja kosong: tidak pernah enqueue, tidak pernah close — meniru model yang diam.
    },
  });
}

/** SSE yang langsung berakhir tanpa satu pun potongan teks (`[DONE]` saja). */
function badanSSETanpaTeks(): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

/**
 * Cacat yang dikunci di sini: `streamJson`/`streamGemini` mengembalikan `ok: true` begitu
 * HEADER 2xx tiba, bukan setelah potongan pertama. Dulu kandidat langsung dikunci di titik
 * itu, sehingga model yang diam lebih lama dari batas waktu membuat timeout terjadi SETELAH
 * `panggilTeksStream` sudah `return` — dan fallback ke provider berikutnya tidak pernah jalan.
 */
describe("panggilTeksStream — potongan pertama menentukan kandidat", () => {
  it("TIMEOUT sebelum potongan pertama -> kandidat berikutnya DICOBA, user tetap dapat jawaban", async () => {
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1), await kred("groq", "key-groq", 2)],
      model: [...model("kenari", 1, 1), ...model("groq", 1, 9)],
      settings: {
        textProvider: "kenari",
        chainTeks: ["kenari", "groq"],
        modelTeks: { kenari: "kenari-diam", groq: "groq-cepat" },
        modelVision: {},
        modelGambar: {},
      },
    });
    const log: Panggilan[] = [];
    await denganJamPalsu(async (maju) => {
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const u = String(url);
        const provider = Object.entries(NAMA_PER_FRAGMEN).find(([frag]) => u.includes(frag))?.[1] ?? "lain";
        log.push({ provider, model: namaModelDariBody(init?.body), body: String(init?.body ?? "") });
        if (provider === "kenari") {
          // 200 + header terkirim lalu DIAM: pembacaan digantung sampai adapter membatalkan
          // lewat AbortController, persis seperti model yang berpikir lebih lama dari timeout.
          maju(TIMEOUT_TEKS_MS);
          return { ok: true, status: 200, body: badanTanpaPotongan() } as unknown as Response;
        }
        return { ok: true, status: 200, body: badanSSE(["dari groq"]) } as unknown as Response;
      }) as unknown as typeof fetch;

      const hasil = await panggilTeksStream({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });

      assert.equal(hasil.ok, true, `timeout sebelum potongan pertama harus difallback: ${hasil.ok ? "" : hasil.error}`);
      if (!hasil.ok) return;
      assert.equal(hasil.provider, "groq", "kandidat kedua dipakai karena yang pertama diam tanpa potongan");
      assert.equal(hasil.model, "groq-cepat");
      let teks = "";
      for await (const p of hasil.potongan) if (p.delta) teks += p.delta;
      assert.equal(teks, "dari groq!");
      assert.ok(log.some((p) => p.provider === "groq"), "groq HARUS benar-benar dipanggil walau kenari sudah membalas 200");
    });
  });

  it("200 yang selesai TANPA potongan teks dianggap gagal -> lanjut kandidat berikutnya", async () => {
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1), await kred("groq", "key-groq", 2)],
      model: [...model("kenari", 1, 1), ...model("groq", 1, 9)],
      settings: {
        textProvider: "kenari",
        chainTeks: ["kenari", "groq"],
        modelTeks: { kenari: "kenari-kosong", groq: "groq-cepat" },
        modelVision: {},
        modelGambar: {},
      },
    });
    const log: Panggilan[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const provider = Object.entries(NAMA_PER_FRAGMEN).find(([frag]) => u.includes(frag))?.[1] ?? "lain";
      log.push({ provider, model: namaModelDariBody(init?.body) });
      // 200, tapi user tidak akan menerima satu karakter pun: ini kegagalan, bukan jawaban kosong.
      if (provider === "kenari") return { ok: true, status: 200, body: badanSSETanpaTeks() } as unknown as Response;
      return { ok: true, status: 200, body: badanSSE(["dari groq"]) } as unknown as Response;
    }) as unknown as typeof fetch;

    const hasil = await panggilTeksStream({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });
    assert.equal(hasil.ok, true, `stream kosong harus difallback: ${hasil.ok ? "" : hasil.error}`);
    if (!hasil.ok) return;
    assert.equal(hasil.provider, "groq");
    let teks = "";
    for await (const p of hasil.potongan) if (p.delta) teks += p.delta;
    assert.equal(teks, "dari groq!");
    assert.ok(log.some((p) => p.provider === "groq"), "groq dicoba setelah kenari berakhir tanpa teks");
  });

  it("sisa anggaran < satu percobaan reasoning -> kandidat berikutnya dicoba TANPA reasoning", async () => {
    // Rantai satu provider dengan DUA model, dan model pilihan user adalah yang PERTAMA.
    // Jatah kandidat pertama adalah `batasPercobaanTeks` = max(MIN_SISA_MS, min(jatah, sisa)),
    // yaitu SELURUH anggaran provider (karena TIMEOUT_TEKS_REASONING_MS = ANGGARAN_PROVIDER_MS),
    // sehingga sisa anggaran provider menjadi 0 dan kandidat berikutnya DILEWATI — aturan
    // "reasoning diturunkan" tidak pernah tersentuh. Uji ini karena itu memakai dua model:
    // model pertama (kenari-model-1) diberi jatah pendek, sehingga sisa anggaran provider
    // masih ada tetapi lebih kecil dari satu percobaan reasoning penuh. Itulah kondisi yang
    // membuat aturan itu aktif, dan keadaannya realistis: satu model lambat memang menghabiskan
    // sebagian besar jatah provider sebelum model cadangan sempat dicoba.
    const db = buatDb({
      kredensial: [await kred("kenari", "key-kenari", 1)],
      model: model("kenari", 2, 1),
      settings: { textProvider: "kenari", chainTeks: ["kenari"], modelTeks: { kenari: "kenari-diam" }, modelVision: {}, modelGambar: {} },
    });
    // Model pertama diberi jatah pendek (bukan seluruh anggaran provider), sehingga sisa
    // anggaran provider masih ada tetapi lebih kecil dari satu percobaan reasoning penuh.
    // Jam WAJIB dimajukan di dalam `pull()`, yaitu ketika stream benar-benar dibaca — bukan
    // di dalam `fetch`. `totalMs`/`timeoutMs` sudah dihitung SEBELUM generator dikonsumsi, jadi
    // memajukan jam saat `fetch` mengubah jatah kandidat berikutnya (sisa provider menjadi 0)
    // dan uji tidak lagi menyentuh aturan yang mau diperiksa.
    const jatahPertama = 20000;
    const majuSelamaBaca = (maju: (ms: number) => void, jumlah: number): ReadableStream<Uint8Array> => {
      let sudah = false;
      return new ReadableStream<Uint8Array>({
        pull() {
          if (sudah) return new Promise<void>(() => {}); // bacaan berikutnya menggantung
          sudah = true;
          maju(jumlah);
          return new Promise<void>(() => {});
        },
      });
    };
    const log: Panggilan[] = [];
    await denganJamPalsu(async (maju) => {
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const u = String(url);
        log.push({
          provider: Object.entries(NAMA_PER_FRAGMEN).find(([frag]) => u.includes(frag))?.[1] ?? "lain",
          model: namaModelDariBody(init?.body),
          body: String(init?.body ?? ""),
        });
        // 200 lalu diam; kandidat pertama memakai jatah pendek, kandidat berikutnya sisanya.
        return {
          ok: true,
          status: 200,
          body: majuSelamaBaca(maju, log.length === 1 ? jatahPertama : ANGGARAN_PROVIDER_MS),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const hasil = await panggilTeksStream({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }], reasoning: "high" });

      assert.equal(hasil.ok, false, "semua kandidat diam, jadi rantai memang gagal");
      // Jumlah percobaan TIDAK dipatok: dengan MAKS_MODEL_PER_PROVIDER kandidat per provider,
      // kandidat cadangan bisa menghabiskan sisa anggaran provider satu per satu, sehingga
      // percobaan KEDUA (kalau ada) yang penting. Yang diuji adalah aturannya:
      // begitu ada percobaan SETELAH percobaan ber-reasoning gagal, percobaan itu TIDAK lagi
      // memakai reasoning dan sisa anggaran TIDAK membolehkannya dilewati.
      assert.ok(log.length >= 2, `kandidat cadangan harus tetap dicoba, bukan dilewati (dicoba: ${log.length})`);
      assert.match(log[0]?.body ?? "", /"reasoning_effort":"high"/, "kandidat pertama tetap memakai reasoning");
      assert.doesNotMatch(
        log[1]?.body ?? "",
        /reasoning_effort/,
        "percobaan setelah kegagalan ber-reasoning dicoba TANPA reasoning"
      );
      const upaya = hasil.ok ? [] : hasil.upaya ?? [];
      // Kandidat yang DICOBA setelah downgrade adalah `kenari-model-1` (kandidat kedua dalam
      // urutan: model pilihan user selalu nomor satu, sisanya urut `id`), bukan model-2.
      // Model-2 memang sudah kehabisan anggaran provider (70s + 35s > ANGGARAN_PROVIDER_MS),
      // dan itu perilaku yang benar — bukan yang sedang diuji di sini.
      const kedua = upaya.find((u) => u.model === "kenari-model-1" && /Timeout provider/.test(u.error));
      assert.match(kedua?.error ?? "", /Timeout provider setelah \d+ms/, `kandidat cadangan harus dicoba dan timeout: ${kedua?.error}`);
      const jatahKedua = Number(/Timeout provider setelah (\d+)ms/.exec(kedua?.error ?? "")?.[1] ?? 0);
      assert.ok(jatahKedua > 0, `jatah kandidat cadangan harus lebih dari nol: ${kedua?.error}`);
      assert.ok(
        jatahKedua <= TIMEOUT_TEKS_MS,
        `jatah kandidat cadangan tidak boleh melebihi timeout tanpa reasoning (${TIMEOUT_TEKS_MS}ms): ${jatahKedua}ms`
      );
      const pesan = hasil.ok ? "" : hasil.error;
      assert.match(pesan, /reasoning diturunkan/, `penurunan reasoning harus terlihat di pesan gagal: ${pesan}`);
      // Yang dijaga: penurunan reasoning TERLIHAT, dan kandidat cadangan sempat DICOBA
      // (dibuktikan `log.length >= 2` + catatan timeout di `kedua` di atas). Kandidat
      // berikutnya boleh saja sudah kehabisan anggaran provider — itu perilaku benar.
    });
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
    log.push({
      provider: Object.entries(NAMA_PER_FRAGMEN).find(([frag]) => u.includes(frag))?.[1] ?? "lain",
      model: namaModelDariBody(init?.body),
      body: String(init?.body ?? ""),
    });
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

      const hasil = await panggilTeks({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });

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

      const hasil = await panggilTeks({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });

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

      const hasil = await panggilTeks({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }], reasoning: "high" });

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

      const hasil = await panggilTeks({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }], reasoning: "high" });

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
      await panggilTeks({ db, kunci: KUNCI, role: OWNER }, { pesan: [{ role: "user", teks: "halo" }] });
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

/**
 * `hanyaModelDipilih` — jalur analisa keuangan. Katalog `ai_model` TIDAK menyimpan harga
 * (`modal_masuk`/`modal_keluar` = modality: text/file), jadi sistem tidak bisa menilai mana
 * model mahal. Satu-satunya pengaman biaya: JANGAN pernah memakai model yang tidak dipilih
 * user — termasuk jangan menambal provider tanpa pilihan dari katalog.
 */
describe("hanyaModelDipilih: analisa tidak boleh memakai model yang tidak dipilih user", () => {
  /** Urutan MODEL unik yang benar-benar dipanggil; jaringan mati supaya semua kandidat dijejer. */
  async function urutanDipanggil(
    settings: Record<string, unknown>,
    kredensial: BarisKred[],
    katalog: BarisModel[],
    minta: { modelDiminta?: string; hanyaModelDipilih?: boolean; roleAktif?: string } = {}
  ): Promise<{ model: string[]; provider: string[]; pesan: string }> {
    const db = buatDb({ kredensial, model: katalog, settings });
    const log: Panggilan[] = [];
    let pesan = "";
    await denganJamPalsu(async () => {
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        log.push({
          provider: Object.entries(NAMA_PER_FRAGMEN).find(([frag]) => u.includes(frag))?.[1] ?? "lain",
          model: namaModelDariBody(init?.body),
        });
        throw new Error("jaringan mati");
      }) as unknown as typeof fetch;
      const { roleAktif, ...mintaApi } = minta;
      const hasil = await panggilTeks(
        { db, kunci: KUNCI, role: roleAktif },
        { pesan: [{ role: "user", teks: "halo" }], ...mintaApi }
      );
      pesan = hasil.ok ? "" : hasil.error;
    });
    return { model: [...new Set(log.map((p) => p.model))], provider: [...new Set(log.map((p) => p.provider))], pesan };
  }

  it("provider tanpa model dipilih DILEWATI (tidak di-fetch) + catatannya bisa ditindak", async () => {
    // gemini punya kredensial DAN katalog, tetapi TIDAK punya entri `modelTeks` — persis
    // keadaan produksi (di sana hanya kenari yang punya pilihan).
    const { provider, pesan } = await urutanDipanggil(
      { textProvider: "kenari", chainTeks: ["kenari", "gemini"], modelTeks: { kenari: "kenari-pilih" }, modelVision: {}, modelGambar: {} },
      [await kred("kenari", "key-kenari", 1), await kred("gemini", "key-gemini", 2)],
      [...model("kenari", 2, 1), ...model("gemini", 3, 50)],
      { hanyaModelDipilih: true }
    );
    assert.equal(provider.includes("gemini"), false, "provider tanpa model dipilih TIDAK boleh di-fetch sama sekali");
    assert.match(pesan, /gemini/, `provider yang dilewati harus disebut: ${pesan}`);
    assert.match(pesan, /belum punya model default/, `catatan harus bisa ditindak: ${pesan}`);
  });

  it("provider dengan model dipilih: HANYA model itu yang dicoba, katalog tidak disentuh", async () => {
    const { model: dicoba } = await urutanDipanggil(
      { textProvider: "kenari", chainTeks: ["kenari"], modelTeks: { kenari: "model-c" }, modelVision: {}, modelGambar: {} },
      [await kred("kenari", "key-kenari", 1)],
      [
        { id: 1, provider: "kenari", model_id: "model-a", jenis: "teks", aktif: 1 },
        { id: 2, provider: "kenari", model_id: "model-b", jenis: "teks", aktif: 1 },
        { id: 3, provider: "kenari", model_id: "model-c", jenis: "teks", aktif: 1 },
        { id: 4, provider: "kenari", model_id: "model-d", jenis: "teks", aktif: 1 },
      ],
      { hanyaModelDipilih: true }
    );
    assert.deepEqual(dicoba, ["model-c"], "hanya model yang dipilih user yang boleh dicoba");
  });

  it("tanpa opsi (bot/vision/gambar): perilaku LAMA tetap — model aktif pertama katalog dipakai", async () => {
    // `role: "owner"` = jalur bot/vision: tidak ada allowlist per role yang berlaku
    // (himpunanIzin → null), jadi katalog tetap dipakai seperti dulu.
    const { model: dicoba } = await urutanDipanggil(
      { textProvider: "kenari", chainTeks: ["kenari"], modelTeks: {}, modelVision: {}, modelGambar: {} },
      [await kred("kenari", "key-kenari", 1)],
      [
        { id: 1, provider: "kenari", model_id: "model-a", jenis: "teks", aktif: 1 },
        { id: 2, provider: "kenari", model_id: "model-b", jenis: "teks", aktif: 1 },
      ],
      { roleAktif: "owner" }
    );
    assert.ok(dicoba.length > 0, "tanpa opsi, katalog tetap dipakai seperti sebelumnya");
    assert.equal(dicoba[0], "model-a", "model aktif pertama katalog (urut id) tetap kandidat pertama");
    assert.ok(dicoba.includes("model-b"), "cadangan katalog tetap dicoba — perilaku lama tidak boleh berubah");
  });

  it("modelDiminta tetap menang atas modelTeks walau hanyaModelDipilih menyala", async () => {
    // model-d DIIZINKAN untuk role: yang diuji di sini urutan kandidat (`modelDiminta`
    // harus mengalahkan `modelTeks`), bukan penegakan izin.
    const { model: dicoba } = await urutanDipanggil(
      { textProvider: "kenari", chainTeks: ["kenari"], modelTeks: { kenari: "model-c" }, modelVision: {}, modelGambar: {} },
      [await kred("kenari", "key-kenari", 1)],
      [{ id: 1, provider: "kenari", model_id: "model-d", jenis: "teks", aktif: 1 }],
      { modelDiminta: "model-d", hanyaModelDipilih: true }
    );
    assert.deepEqual(dicoba, ["model-d"], "model yang diminta eksplisit tetap nomor satu");
  });
});

/**
 * `providerDiminta` — model pilihan SENDIRI untuk editor (migrasi 0037). Disimpan sebagai
 * kunci izin (`provider\u0000model_id`), jadi provider pembawanya diketahui, bukan ditebak
 * dari urutan rantai. Tanpa ini, pilihan user di provider NON-pertama tidak pernah masuk
 * kandidat (`modelDiminta` lama hanya dibaca untuk provider pertama) — user memilih model,
 * menyimpan, lalu tetap memakai model global tanpa pesan apa pun.
 *
 * Konteks memakai `role: "owner"`: yang diuji di sini URUTAN provider, bukan allowlist izin
 * (`himpunanIzin` → null untuk owner). Pengujian penolakan izin ada di suite `hanyaModelDipilih`.
 */
describe("providerDiminta: model pilihan user dipakai di provider yang benar", () => {
  /** Urutan (provider, model) yang benar-benar dicoba, dibaca dari `upaya` saat kredensial kosong. */
  async function urutanUpaya(
    settings: Record<string, unknown>,
    kredensial: BarisKred[],
    katalog: BarisModel[],
    minta: { modelDiminta?: string; providerDiminta?: string; hanyaModelDipilih?: boolean }
  ): Promise<{ provider: string; model: string }[]> {
    const db = buatDb({ kredensial, model: katalog, settings });
    const hasil = await panggilTeks(
      { db, kunci: KUNCI, role: "owner" },
      { pesan: [{ role: "user", teks: "halo" }], ...minta }
    );
    return hasil.ok ? [] : (hasil.upaya ?? []).map((u) => ({ provider: String(u.provider), model: String(u.model) }));
  }

  it("provider pembawa model dipindah ke depan rantai: pilihan user dibahas lebih dulu", async () => {
    const upaya = await urutanUpaya(
      { textProvider: "kenari", chainTeks: ["kenari", "gemini"], modelTeks: { kenari: "kenari-default" }, modelVision: {}, modelGambar: {} },
      [await kred("kenari", "key-kenari", 1), await kred("gemini", "key-gemini", 2)],
      [...model("kenari", 2, 1), ...model("gemini", 2, 50)],
      { modelDiminta: "gemini-model-1", providerDiminta: "gemini", hanyaModelDipilih: true }
    );
    assert.deepEqual(
      upaya[0],
      { provider: "gemini", model: "gemini-model-1" },
      "provider pembawa model yang diminta harus dibahas paling awal"
    );
  });

  it("tanpa providerDiminta perilaku LAMA tetap: provider pertama tetap di depan", async () => {
    const upaya = await urutanUpaya(
      { textProvider: "kenari", chainTeks: ["kenari", "gemini"], modelTeks: { kenari: "kenari-default" }, modelVision: {}, modelGambar: {} },
      [await kred("kenari", "key-kenari", 1), await kred("gemini", "key-gemini", 2)],
      [...model("kenari", 2, 1), ...model("gemini", 2, 50)],
      { modelDiminta: "gemini-model-1" }
    );
    assert.equal(upaya[0]?.provider, "kenari", "tanpa providerDiminta, urutan rantai tidak boleh berubah");
  });

  it("model terlarang ditolak SEBELUM jaringan — providerDiminta tidak membuka jalan", async () => {
    const db = buatDb({
      kredensial: [await kred("gemini", "key-gemini", 2)],
      // Model ADA di katalog (jadi tidak ditolak karena "model tidak ada"), tetapi
      // `allowed` baris izinnya 0 untuk role ini — inilah yang harus menahan.
      model: [{ id: 1, provider: "gemini", model_id: "gemini-terlarang", jenis: "teks", aktif: 1 }],
      settings: { textProvider: "gemini", chainTeks: ["gemini"], modelTeks: {}, modelVision: {}, modelGambar: {} },
      izin: { allowedUntuk: () => false },
    });
    let jaringan = 0;
    globalThis.fetch = (async () => {
      jaringan += 1;
      throw new Error("jaringan mati");
    }) as unknown as typeof fetch;
    const hasil = await panggilTeks(
      { db, kunci: KUNCI, role: "admin" },
      { pesan: [{ role: "user", teks: "halo" }], modelDiminta: "gemini-terlarang", providerDiminta: "gemini", hanyaModelDipilih: true }
    );
    assert.equal(jaringan, 0, "model di luar izin TIDAK boleh sampai ke provider");
    assert.equal(hasil.ok, false);
    // Non-owner tanpa satu pun model terizinkan → 403 dengan arahan ke owner, bukan 502.
    assert.match(hasil.ok ? "" : hasil.error, /tidak diizinkan owner|Belum ada model teks yang diizinkan/, "penolakan harus menyebut alasannya");
  });
});
