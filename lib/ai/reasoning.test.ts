// lib/ai/reasoning.test.ts — Normalisasi nilai reasoning ke kosakata HTTP API provider.
//
// KENAPA TEST INI ADA (keluhan pemilik repo: "reasoning selalu timeout"):
// katalog provider menyimpan `reasoning_pilihan` dengan kosakata INTERNAL mereka
// (`low,high,max`, `high,xhigh`, `none,low,high`), sedangkan HTTP API hanya menerima
// `minimal|low|medium|high`. Dulu nilai `max`/`xhigh` diteruskan VERBATIM sehingga
// provider berjalan jauh lebih lama lalu melewati timeout. Test ini mengunci janji:
// nilai tak sah TIDAK PERNAH keluar lagi.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalkanTingkatReasoning, terapkanReasoning } from "./reasoning";

/** Kumpulkan setiap nilai string di dalam objek hasil (untuk memastikan tak ada `max`/`xhigh`). */
function semuaNilai(v: unknown, keluar: string[] = []): string[] {
  if (typeof v === "string") keluar.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v)) semuaNilai(x, keluar);
  return keluar;
}

const PROVIDER = ["gemini", "groq", "kenari", "openai", "openrouter"];

describe("normalkanTingkatReasoning", () => {
  it("max dan xhigh dipetakan ke high (API tidak punya tingkat di atas high)", () => {
    assert.equal(normalkanTingkatReasoning("max"), "high");
    assert.equal(normalkanTingkatReasoning("XHIGH"), "high");
  });

  it("none → minimal, medium tetap medium", () => {
    assert.equal(normalkanTingkatReasoning("none"), "minimal");
    assert.equal(normalkanTingkatReasoning("medium"), "medium");
  });

  it("kosakata sah diteruskan apa adanya", () => {
    for (const t of ["minimal", "low", "medium", "high"]) assert.equal(normalkanTingkatReasoning(t), t);
  });

  it("bool dan angka dipetakan hidup/mati", () => {
    for (const hidup of ["on", "true", "1"]) assert.equal(normalkanTingkatReasoning(hidup), "high");
    for (const mati of ["off", "false", "0"]) assert.equal(normalkanTingkatReasoning(mati), "minimal");
  });

  it("nilai sampah → medium tanpa melempar", () => {
    for (const sampah of ["ultra", "default", "  ", undefined, null, "max "]) {
      assert.doesNotThrow(() => normalkanTingkatReasoning(sampah));
    }
    assert.equal(normalkanTingkatReasoning("ultra"), "medium");
    assert.equal(normalkanTingkatReasoning(undefined), "medium");
  });
});

describe("terapkanReasoning — nilai tak sah tidak pernah lolos", () => {
  it("max/xhigh jadi high di SEMUA provider", () => {
    for (const provider of PROVIDER) {
      for (const nilai of ["max", "xhigh"]) {
        const hasil = terapkanReasoning(provider, nilai);
        assert.ok(!semuaNilai(hasil).includes(nilai), `${provider}: ${nilai} bocor apa adanya → ${JSON.stringify(hasil)}`);
        assert.ok(semuaNilai(hasil).includes("high"), `${provider}: ${nilai} harus jadi high`);
      }
    }
  });

  it("none → minimal, medium tetap medium", () => {
    assert.equal(terapkanReasoning("openai", "none").reasoning_effort, "minimal");
    assert.equal(terapkanReasoning("openai", "medium").reasoning_effort, "medium");
  });

  it("kosong/undefined → objek KOSONG (tanpa parameter sama sekali)", () => {
    for (const provider of PROVIDER) {
      for (const kosong of ["", "   ", undefined, null]) {
        assert.deepEqual(terapkanReasoning(provider, kosong), {}, `${provider} + ${String(kosong)}`);
      }
    }
  });

  it("nilai sampah → medium, tidak melempar", () => {
    for (const provider of PROVIDER) {
      let hasil: Record<string, unknown> = {};
      assert.doesNotThrow(() => {
        hasil = terapkanReasoning(provider, "ultra");
      });
      assert.ok(semuaNilai(hasil).includes("medium"), `${provider}: ultra harus jadi medium`);
    }
  });

  it("gemini memakai thinkingConfig.thinkingLevel", () => {
    assert.deepEqual(terapkanReasoning("gemini", "max"), { thinkingConfig: { thinkingLevel: "high" } });
  });

  it("openrouter memakai reasoning.effort (dan API-nya, bukan reasoning_effort)", () => {
    assert.deepEqual(terapkanReasoning("openrouter", "max"), { reasoning: { effort: "high" } });
    assert.deepEqual(terapkanReasoning("openrouter", "on"), { reasoning: { effort: "high" } });
    assert.deepEqual(terapkanReasoning("openrouter", "off"), { reasoning: { effort: "minimal" } });
  });

  it("groq/openai-compatible memakai reasoning_effort", () => {
    assert.deepEqual(terapkanReasoning("groq", "xhigh"), { reasoning_effort: "high" });
    assert.deepEqual(terapkanReasoning("kenari", "max"), { reasoning_effort: "high" });
  });
});

describe("terapkanReasoning — jalur hilir", () => {
  it("gemini + hilir menambahkan includeThoughts", () => {
    assert.deepEqual(terapkanReasoning("gemini", "max", { hilir: true }), {
      thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
    });
  });

  it("openrouter + hilir menambahkan include_reasoning", () => {
    assert.deepEqual(terapkanReasoning("openrouter", "xhigh", { hilir: true }), {
      reasoning: { effort: "high" },
      include_reasoning: true,
    });
  });

  it("groq + hilir memakai reasoning_format raw, parsed saat ada tool/jsonMode", () => {
    assert.deepEqual(terapkanReasoning("groq", "max", { hilir: true }), { reasoning_effort: "high", reasoning_format: "raw" });
    assert.deepEqual(terapkanReasoning("groq", "max", { hilir: true, adaTool: true }), {
      reasoning_effort: "high",
      reasoning_format: "parsed",
    });
    assert.deepEqual(terapkanReasoning("groq", "max", { hilir: true, jsonMode: true }), {
      reasoning_effort: "high",
      reasoning_format: "parsed",
    });
  });

  it("tanpa hilir tidak ada includeThoughts/include_reasoning", () => {
    assert.equal("include_reasoning" in terapkanReasoning("openrouter", "high"), false);
    const gem = terapkanReasoning("gemini", "high") as { thinkingConfig: Record<string, unknown> };
    assert.equal("includeThoughts" in gem.thinkingConfig, false);
    assert.equal("reasoning_format" in terapkanReasoning("groq", "high"), false);
  });
});
