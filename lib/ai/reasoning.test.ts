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

  it("groq + hilir memakai reasoning_format parsed (raw menaruh pikiran DI DALAM content)", () => {
    assert.deepEqual(terapkanReasoning("groq", "max", { hilir: true }), { reasoning_effort: "high", reasoning_format: "parsed" });
    // jsonMode/adaTool tetap diterima demi pemanggil lama, tapi hasilnya sama: `parsed`
    // (dulu `raw` dipakai di jalur ini dan mencampur pikiran model ke `content`).
    assert.deepEqual(terapkanReasoning("groq", "max", { hilir: true, adaTool: true }), {
      reasoning_effort: "high",
      reasoning_format: "parsed",
    });
    assert.deepEqual(terapkanReasoning("groq", "max", { hilir: true, jsonMode: true }), {
      reasoning_effort: "high",
      reasoning_format: "parsed",
    });
    assert.equal(semuaNilai(terapkanReasoning("groq", "max", { hilir: true })).includes("raw"), false, "`raw` tidak boleh keluar lagi");
  });

  it("tanpa hilir tidak ada includeThoughts/include_reasoning", () => {
    assert.equal("include_reasoning" in terapkanReasoning("openrouter", "high"), false);
    const gem = terapkanReasoning("gemini", "high") as { thinkingConfig: Record<string, unknown> };
    assert.equal("includeThoughts" in gem.thinkingConfig, false);
    assert.equal("reasoning_format" in terapkanReasoning("groq", "high"), false);
  });
});

/**
 * Paramater reasoning Gemini BERGANTUNG VERSI MODEL (dokumentasi resmi Google, 2026-10-15):
 * Gemini 3 ke atas memakai `thinkingLevel`, seri 2.5 memakai `thinkingBudget` ANGKA, dan
 * varian `gemini-3-*-pro` hanya menerima `low`/`high`. Salah bentuk/level = 400 → reasoning
 * mati total di jalur itu, jadi perilakunya dikunci di sini.
 */
describe("terapkanReasoning — Gemini mengikuti versi model", () => {
  it("gemini-3-flash-preview memakai thinkingLevel (level apa adanya)", () => {
    assert.deepEqual(terapkanReasoning("gemini", "high", { model: "gemini-3-flash-preview" }), {
      thinkingConfig: { thinkingLevel: "high" },
    });
    assert.deepEqual(terapkanReasoning("gemini", "none", { model: "gemini-3-flash-preview" }), {
      thinkingConfig: { thinkingLevel: "minimal" },
    });
    // Nama model dibandingkan tanpa peduli huruf besar/kecil.
    assert.deepEqual(terapkanReasoning("gemini", "medium", { model: "Gemini-3-Flash-Preview" }), {
      thinkingConfig: { thinkingLevel: "medium" },
    });
  });

  it("gemini-3-pro-preview TIDAK PERNAH mengirim minimal/medium (hanya low|high)", () => {
    const peta: [string, string][] = [
      ["none", "low"],
      ["minimal", "low"],
      ["low", "low"],
      ["medium", "high"],
      ["high", "high"],
      ["max", "high"],
      ["ultra", "high"],
    ];
    for (const [nilai, level] of peta) {
      assert.deepEqual(
        terapkanReasoning("gemini", nilai, { model: "gemini-3-pro-preview" }),
        { thinkingConfig: { thinkingLevel: level } },
        `${nilai} harus jadi ${level} untuk varian pro`
      );
    }
  });

  it("gemini-2.5 memakai thinkingBudget berupa ANGKA", () => {
    const peta: [string, number][] = [
      ["minimal", 128],
      ["low", 1024],
      ["medium", 8192],
      ["high", 24576],
    ];
    for (const model of ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-latest"]) {
      for (const [nilai, budget] of peta) {
        const hasil = terapkanReasoning("gemini", nilai, { model });
        assert.deepEqual(hasil, { thinkingConfig: { thinkingBudget: budget } }, `${model} + ${nilai}`);
        const cfg = hasil.thinkingConfig;
        assert.ok(cfg && typeof cfg === "object" && "thinkingBudget" in cfg, `${model} + ${nilai}: thinkingConfig harus objek berisi thinkingBudget`);
        assert.equal(typeof cfg.thinkingBudget, "number", "thinkingBudget WAJIB angka di seri 2.5");
        assert.equal("thinkingLevel" in cfg, false, "thinkingLevel tidak sah untuk seri 2.5");
      }
    }
  });

  it("nama model kosong/tak dikenal tetap thinkingLevel (perilaku lama, mis. jalur gambar)", () => {
    const lama = { thinkingConfig: { thinkingLevel: "high" } };
    assert.deepEqual(terapkanReasoning("gemini", "high"), lama);
    assert.deepEqual(terapkanReasoning("gemini", "high", { model: "" }), lama);
    assert.deepEqual(terapkanReasoning("gemini", "high", { model: "gemini-1.5-flash" }), lama);
  });

  it("hilir tetap menambahkan includeThoughts di semua versi", () => {
    assert.deepEqual(terapkanReasoning("gemini", "low", { hilir: true, model: "gemini-2.5-flash" }), {
      thinkingConfig: { thinkingBudget: 1024, includeThoughts: true },
    });
    assert.deepEqual(terapkanReasoning("gemini", "medium", { hilir: true, model: "gemini-3-pro-preview" }), {
      thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
    });
  });
});
