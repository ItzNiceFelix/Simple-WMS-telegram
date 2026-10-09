// lib/d1/seedLaba.test.ts — Loader seed idempoten + migrasi data lama (D2/D-R2/D-R3).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { migrasiLabaLama, migrasiPresetLama, muatSeed, pastikanPresetUtama, type SeedData } from "./seedLaba";

type Row = Record<string, unknown>;

function buatDb() {
  const presets: Row[] = [{ marketplace: "shopee", jenis: "lain", basis: "flat", nilai: 1250 }];
  const laba: Row[] = [{
    tanggal: "2026-10-08", jml_order: 230, jml_baris: 238, omzet: 6776739,
    hpp: 3951280, biaya: 2054740, laba: 770719, tolak_json: "[]", rincian_json: "[]",
    file: "Order.all.xlsx", at: 1, by: "x",
  }];
  const seller: Row[] = [];
  const rules: Row[] = [];
  const tier: Row[] = [];
  const katalog: Row[] = [];
  const toggle: Row[] = [];
  let seq = 0;
  const db = {
    prepare(sql: string) {
      const st = {
        _args: [] as unknown[],
        bind(...a: unknown[]) { st._args = a; return st; },
        async first(): Promise<unknown> {
          const a = st._args;
          if (sql.includes("FROM seller_presets WHERE nama")) {
            return seller.find((x) => x["nama"] === a[0] && x["dihapus_at"] == null) ?? null;
          }
          return null;
        },
        async run() {
          const a = st._args;
          if (sql.startsWith("INSERT INTO seller_presets")) {
            seq += 1;
            seller.push({ id: seq, nama: a[0], marketplace: a[1], status_toko: a[2], dihapus_at: null });
            return { meta: { last_row_id: seq } };
          }
          if (sql.startsWith("INSERT INTO tier_admin")) {
            const i = tier.findIndex((x) => x["tier"] === a[0]);
            const row = { tier: a[0], persen_final: a[1], verifikasi: a[2] };
            if (i >= 0) tier[i] = row; else tier.push(row);
            return { meta: {} };
          }
          if (sql.startsWith("INSERT INTO program_katalog")) {
            const i = katalog.findIndex((x) => x["kode_program"] === a[0]);
            if (i >= 0) katalog[i]["nama"] = a[1]; else katalog.push({ kode_program: a[0], nama: a[1] });
            return { meta: {} };
          }
          if (sql.startsWith("INSERT INTO preset_program")) {
            if (!toggle.some((x) => x["preset_id"] === a[0] && x["kode_program"] === a[1])) {
              toggle.push({ preset_id: a[0], kode_program: a[1], aktif: a[2] });
            }
            return { meta: {} };
          }
          if (sql.startsWith("DELETE FROM fee_rules")) {
            for (let i = rules.length - 1; i >= 0; i--) {
              if (rules[i]["preset_id"] !== a[0]) continue;
              if (sql.includes("LIKE") && !String(rules[i]["sumber"]).startsWith("seed:")) continue;
              if (sql.includes("= 'migrasi") && rules[i]["sumber"] !== "migrasi preset lama") continue;
              rules.splice(i, 1);
            }
            return { meta: {} };
          }
          if (sql.startsWith("INSERT INTO fee_rules")) {
            const cols = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((s) => s.trim());
            const row: Row = {};
            cols.forEach((c, i) => { row[c] = a[i]; });
            rules.push(row);
            return { meta: {} };
          }
          if (sql.startsWith("INSERT OR REPLACE INTO laba_snapshot")) {
            const i = laba.findIndex((x) => String(x["tanggal"]) === String(a[1]));
            const row = { tanggal: a[1], jml_order: a[2], jml_baris: a[3], omzet: a[4], hpp: a[5], biaya: a[6], laba: a[7] };
            if (i >= 0) laba[i] = { ...laba[i], ...row }; else laba.push(row);
            return { meta: {} };
          }
          return { meta: {} };
        },
        async all(): Promise<{ results: unknown[] }> {
          if (sql.includes("FROM mp_fee_presets")) return { results: presets };
          if (sql.includes("FROM laba_harian")) return { results: laba };
          return { results: [] };
        },
      };
      return st;
    },
    data: { seller, rules, tier, katalog, toggle },
  };
  return db;
}

const SEED_MINI: SeedData = {
  programs: [{ kode_program: "go", nama: "GO", opsional: true, default_aktif: false }],
  kategori_tier_admin: [{ tier: "T10", persen: 10, verifikasi: "resmi_cuplikan" }],
  rules: [{
    jenis: "admin", kode_program: null, kategori: "T10", status_toko: null, ukuran: null,
    basis: "persen", unit: "per_baris", nilai: 10, plafon_per_qty: null, syarat: null,
    valid_from: "2026-01-01", valid_to: null, aktif: true, sumber: "seed:test", verifikasi: "resmi_cuplikan", catatan: "",
  }],
};

describe("seedLaba (D2/D-R2/D-R3)", () => {
  it("pastikanPresetUtama stabil + muatSeed idempoten", async () => {
    const db = buatDb();
    const p1 = await pastikanPresetUtama(db as unknown as D1Database);
    const p2 = await pastikanPresetUtama(db as unknown as D1Database);
    assert.equal(p1, p2);
    const r1 = await muatSeed(db as unknown as D1Database, SEED_MINI);
    const r2 = await muatSeed(db as unknown as D1Database, SEED_MINI);
    assert.equal(r1.aturan, 1);
    assert.equal(r2.aturan, 1);
    assert.equal(db.data.rules.length, 1);
    assert.equal(db.data.tier[0]["persen_final"], 10);
  });

  it("rule manual owner tak tertimpa seed", async () => {
    const db = buatDb();
    const p = await pastikanPresetUtama(db as unknown as D1Database);
    await muatSeed(db as unknown as D1Database, SEED_MINI);
    db.data.rules.push({ preset_id: p, sumber: "manual owner", jenis: "lain" });
    await muatSeed(db as unknown as D1Database, SEED_MINI);
    assert.ok(db.data.rules.some((r) => r["sumber"] === "manual owner"));
  });

  it("migrasi preset lama + laba lama sama angkanya", async () => {
    const db = buatDb();
    const p = await pastikanPresetUtama(db as unknown as D1Database);
    const n = await migrasiPresetLama(db as unknown as D1Database, p);
    assert.equal(n, 1);
    const m = await migrasiLabaLama(db as unknown as D1Database, p);
    assert.equal(m, 1);
    const snap = db.data.rules.filter((r) => r["sumber"] === "migrasi preset lama");
    assert.equal(snap.length, 1);
    assert.equal(snap[0]["nilai"], 1250);
  });
});
