// lib/d1/pengaturan.test.ts — Provider AI: env kosong tidak boleh melempar.
//
// KENAPA TEST INI ADA: `ambilPengaturanAI(db)` tanpa argumen env membuat
// `(env.AI_PROVIDER_TEXT || "groq")` selalu cocok, lalu cabang true memanggil
// `env.AI_PROVIDER_TEXT.toLowerCase()` pada `undefined` → TypeError → route
// /api/baca?scope=ai balas 500 dengan body kosong (kartu AI di /pengaturan
// menampilkan "Coba lagi"). Test ini mengunci kasus env kosong/minimal.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ambilPengaturanAI, PROVIDER_VALID, simpanProviderAI } from "./pengaturan";

type Row = { value: string } | null;

function buatDb(baris: Row = null) {
  const rekam: { sql: string; args: unknown[] }[] = [];
  const db = {
    rekam,
    prepare(sql: string) {
      const st = {
        _args: [] as unknown[],
        bind(...a: unknown[]) {
          st._args = a;
          rekam.push({ sql, args: a });
          return st;
        },
        async first() {
          return baris;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
      return st;
    },
  };
  return db as unknown as D1Database;
}

describe("ambilPengaturanAI", () => {
  it("TIDAK melempar saat dipanggil tanpa env (penyebab 500 kartu AI)", async () => {
    const s = await ambilPengaturanAI(buatDb());
    assert.equal(s.textProvider, "groq", "harus jatuh ke default groq");
    assert.equal(s.geminiTimeoutMs, 120000);
    assert.equal(s.totalTimeoutMs, 240000);
  });

  it("TIDAK melempar saat env = {} eksplisit", async () => {
    const s = await ambilPengaturanAI(buatDb(), {});
    assert.equal(s.textProvider, "groq");
  });

  it("AI_PROVIDER_TEXT undefined -> default groq", async () => {
    const s = await ambilPengaturanAI(buatDb(), { AI_PROVIDER_TEXT: undefined });
    assert.equal(s.textProvider, "groq");
  });

  it("AI_PROVIDER_TEXT string kosong -> default groq (dulu lolos jadi '')", async () => {
    const s = await ambilPengaturanAI(buatDb(), { AI_PROVIDER_TEXT: "" });
    assert.equal(s.textProvider, "groq");
  });

  it("AI_PROVIDER_TEXT spasi saja -> default groq", async () => {
    const s = await ambilPengaturanAI(buatDb(), { AI_PROVIDER_TEXT: "   " });
    assert.equal(s.textProvider, "groq");
  });

  it("provider sah dibaca apa adanya (huruf besar dinormalkan)", async () => {
    for (const p of PROVIDER_VALID) {
      const s = await ambilPengaturanAI(buatDb(), { AI_PROVIDER_TEXT: p.toUpperCase() });
      assert.equal(s.textProvider, p);
    }
  });

  it("provider tak dikenal -> default groq", async () => {
    const s = await ambilPengaturanAI(buatDb(), { AI_PROVIDER_TEXT: "claude" });
    assert.equal(s.textProvider, "groq");
  });

  it("timeout dari env dibaca bila > 0", async () => {
    const s = await ambilPengaturanAI(buatDb(), { GEMINI_TIMEOUT_MS: "5000", GEMINI_TOTAL_TIMEOUT_MS: "9000" });
    assert.equal(s.geminiTimeoutMs, 5000);
    assert.equal(s.totalTimeoutMs, 9000);
  });

  it("timeout env tidak sah (0/abc) -> pakai default", async () => {
    const a = await ambilPengaturanAI(buatDb(), { GEMINI_TIMEOUT_MS: "0" });
    assert.equal(a.geminiTimeoutMs, 120000);
    const b = await ambilPengaturanAI(buatDb(), { GEMINI_TIMEOUT_MS: "abc" });
    assert.equal(b.geminiTimeoutMs, 120000);
  });

  it("settings tersimpan menimpa env, tapi provider tak sah dari DB ditolak", async () => {
    const s = await ambilPengaturanAI(buatDb({ value: '{"textProvider":"gemini","geminiTimeoutMs":60000}' }), {});
    assert.equal(s.textProvider, "gemini");
    assert.equal(s.geminiTimeoutMs, 60000);

    const rusak = await ambilPengaturanAI(buatDb({ value: '{"textProvider":"claude"}' }), {});
    assert.equal(rusak.textProvider, "groq", "provider tak sah dari DB harus jatuh ke default");
  });

  it("settings JSON rusak -> pakai dasar, tidak melempar", async () => {
    const s = await ambilPengaturanAI(buatDb({ value: "BUKAN-JSON" }), { AI_PROVIDER_TEXT: "kenari" });
    assert.equal(s.textProvider, "kenari");
  });
});

describe("simpanProviderAI", () => {
  it("TIDAK melempar saat env kosong", async () => {
    const h = await simpanProviderAI(buatDb(), "gemini", "1");
    assert.equal(h.ok, true, h.ok ? "" : h.error);
  });

  it("tolak provider tak dikenal", async () => {
    const h = await simpanProviderAI(buatDb(), "claude", "1");
    assert.equal(h.ok, false);
  });
});
