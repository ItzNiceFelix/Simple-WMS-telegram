// lib/d1/preset.test.ts — CRUD preset + aturan + program (A1/A2/A-R1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  duplikatPreset, hapusAturan, hapusPreset, listPreset, listProgram,
  setProgram, tambahAturan, tambahPreset, ubahAturan, ubahPreset, validasiAturan,
} from "./preset";

type Row = Record<string, unknown>;

function buatDb() {
  const presets: Row[] = [];
  const rules: Row[] = [];
  const katalog: Row[] = [{ kode_program: "go", nama: "GO" }];
  const toggle: Row[] = [];
  const snap: Row[] = [];
  let seq = 0; let rseq = 0;
  const db = {
    prepare(sql: string) {
      const st = {
        _args: [] as unknown[],
        bind(...a: unknown[]) { st._args = a; return st; },
        async first(): Promise<unknown> {
          const a = st._args;
          if (sql.includes("FROM seller_presets WHERE id")) {
            return presets.find((x) => x["id"] === a[0] && x["dihapus_at"] == null) ?? null;
          }
          if (sql.includes("FROM program_katalog WHERE")) {
            return katalog.find((x) => x["kode_program"] === a[0]) ?? null;
          }
          if (sql.includes("FROM preset_program WHERE preset_id")) {
            return toggle.find((x) => x["preset_id"] === a[0] && x["kode_program"] === a[1]) ?? null;
          }
          if (sql.includes("FROM fee_rules WHERE id")) {
            const idOnly = sql.includes("AND preset_id");
            return rules.find((x) => x["id"] === a[0] && (!idOnly || x["preset_id"] === a[1])) ?? null;
          }
          if (sql.includes("COUNT(*)") && sql.includes("laba_snapshot")) return { n: snap.length };
          if (sql.includes("SELECT basis, nilai FROM fee_rules")) {
            return rules.find((x) => x["id"] === a[0]) ?? null;
          }
          return null;
        },
        async run() {
          const a = st._args;
          if (sql.startsWith("INSERT INTO seller_presets")) {
            seq += 1;
            presets.push({ id: seq, nama: a[0], marketplace: a[1] ?? "shopee", status_toko: a[2] ?? "non_star", dihapus_at: null, diubah_at: 0 });
            return { meta: { last_row_id: seq } };
          }
          if (sql.startsWith("INSERT OR IGNORE INTO preset_program")) {
            if (!toggle.some((x) => x["preset_id"] === a[0] && x["kode_program"] === a[1])) {
              toggle.push({ preset_id: a[0], kode_program: a[1], aktif: a[2] ?? 0, aktif_sejak: null, aktif_sampai: null });
            }
            return { meta: {} };
          }
          if (sql.startsWith("INSERT OR IGNORE INTO preset_penghitung")) return { meta: {} };
          if (sql.startsWith("INSERT INTO preset_program")) {
            const i = toggle.findIndex((x) => x["preset_id"] === a[0] && x["kode_program"] === a[1]);
            const row = { preset_id: a[0], kode_program: a[1], aktif: a[2], aktif_sejak: a[3], aktif_sampai: a[4] };
            if (i >= 0) toggle[i] = row; else toggle.push(row);
            return { meta: {} };
          }
          if (sql.startsWith("INSERT INTO fee_rules") && !sql.includes("SELECT")) {
            const cols = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((s) => s.trim());
            if (sql.includes("SELECT *")) return { meta: {} };
            rseq += 1;
            const row: Row = { id: rseq };
            cols.forEach((c, i) => { row[c] = a[i]; });
            rules.push(row);
            return { meta: { last_row_id: rseq } };
          }
          if (sql.startsWith("UPDATE seller_presets SET nama")) {
            const p = presets.find((x) => x["id"] === a[2]);
            if (p) p["nama"] = a[0];
            return { meta: {} };
          }
          if (sql.startsWith("UPDATE seller_presets SET status_toko")) {
            const p = presets.find((x) => x["id"] === a[3]);
            if (p) { p["status_toko"] = a[0]; }
            return { meta: {} };
          }
          if (sql.startsWith("UPDATE seller_presets SET dihapus_at")) {
            const p = presets.find((x) => x["id"] === a[2]);
            if (p) p["dihapus_at"] = a[0];
            return { meta: {} };
          }
          if (sql.startsWith("DELETE FROM seller_presets")) {
            const i = presets.findIndex((x) => x["id"] === a[0]);
            if (i >= 0) presets.splice(i, 1);
            return { meta: {} };
          }
          if (sql.startsWith("UPDATE fee_rules SET aktif = 0")) {
            const r = rules.find((x) => x["id"] === a[0]);
            if (r) r["aktif"] = 0;
            return { meta: {} };
          }
          if (sql.startsWith("UPDATE fee_rules SET")) {
            const id = a[a.length - 1];
            const r = rules.find((x) => x["id"] === id);
            if (r) {
              const cols = sql.slice("UPDATE fee_rules SET ".length, sql.indexOf(" WHERE")).split(",").map((s) => s.trim().split(" ")[0]);
              cols.forEach((c, i) => { r[c] = a[i]; });
            }
            return { meta: {} };
          }
          if (sql.startsWith("DELETE FROM fee_rules")) {
            for (let i = rules.length - 1; i >= 0; i--) {
              if (sql.includes("preset_id") && rules[i]["preset_id"] !== a[0]) continue;
              rules.splice(i, 1);
            }
            return { meta: {} };
          }
          return { meta: {} };
        },
        async all(): Promise<{ results: unknown[] }> {
          const a = st._args;
          if (sql.includes("FROM seller_presets")) {
            return { results: presets.filter((x) => x["dihapus_at"] == null).map((x) => ({ ...x, jml_aturan: rules.filter((r) => r["preset_id"] === x["id"]).length })) };
          }
          if (sql.includes("FROM fee_rules WHERE preset_id")) return { results: rules.filter((x) => x["preset_id"] === a[0]) };
          if (sql.includes("SELECT * FROM fee_rules")) return { results: rules.filter((x) => x["preset_id"] === (st._args[0] as number)) };
          if (sql.includes("LEFT JOIN preset_program")) {
            return {
              results: katalog.map((k) => {
                const t = toggle.find((x) => x["preset_id"] === a[0] && x["kode_program"] === k["kode_program"]);
                return { kode_program: k["kode_program"], nama: k["nama"], aktif: t?.["aktif"] ?? 0, aktif_sejak: null, aktif_sampai: null };
              }),
            };
          }
          if (sql.includes("FROM program_katalog")) return { results: katalog };
          if (sql.includes("preset_program WHERE preset_id")) {
            return { results: toggle.filter((x) => x["preset_id"] === a[0]) };
          }
          return { results: [] };
        },
      };
      return st;
    },
    data: { presets, rules, toggle, snap },
  };
  return db;
}

describe("preset (A1/A2/A-R1)", () => {
  it("tambah + duplikat salin aturan + ubah + hapus keras", async () => {
    const db = buatDb();
    const t = await tambahPreset(db as unknown as D1Database, "Toko A", "star");
    assert.equal(t.ok, true);
    if (!t.ok) return;
    const ar = await tambahAturan(db as unknown as D1Database, t.id, {
      jenis: "admin", basis: "persen", nilai: 10, valid_from: "2026-01-01",
    });
    assert.equal(ar.ok, true);
    if (!ar.ok) return;
    const d = await duplikatPreset(db as unknown as D1Database, t.id);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(db.data.rules.filter((r) => r["preset_id"] === d.id).length, 1);
    const u = await ubahPreset(db as unknown as D1Database, t.id, { nama: "Toko B" });
    assert.equal(u.ok, true);
    const h = await hapusPreset(db as unknown as D1Database, t.id);
    assert.equal(h.ok && h.lunak, false);
    assert.equal(db.data.presets.some((x) => x["id"] === t.id), false);
  });

  it("hapus lunak bila ada snapshot", async () => {
    const db = buatDb();
    const t = await tambahPreset(db as unknown as D1Database, "Toko A", "non_star");
    assert.equal(t.ok, true);
    if (!t.ok) return;
    db.data.snap.push({ preset_id: t.id });
    const h = await hapusPreset(db as unknown as D1Database, t.id);
    assert.equal(h.ok && h.lunak, true);
    assert.equal((await listPreset(db as unknown as D1Database)).length, 0);
  });

  it("validasi aturan: negatif, persen>100, tanggal balik", async () => {
    assert.match(validasiAturan({ jenis: "admin", basis: "persen", nilai: -1, valid_from: "2026-01-01" }) ?? "", /≥ 0/);
    assert.match(validasiAturan({ jenis: "admin", basis: "persen", nilai: 101, valid_from: "2026-01-01" }) ?? "", /100/);
    assert.match(
      validasiAturan({ jenis: "admin", basis: "flat", nilai: 1, valid_from: "2026-02-01", valid_to: "2026-01-01" }) ?? "",
      /valid_to/
    );
    const db = buatDb();
    const t = await tambahPreset(db as unknown as D1Database, "T", "non_star");
    if (!t.ok) return;
    const bad = await tambahAturan(db as unknown as D1Database, t.id, {
      jenis: "aneh", basis: "persen", nilai: 1, valid_from: "2026-01-01",
    });
    assert.equal(bad.ok, false);
  });

  it("toggle program + ubah aturan + hapus lunak", async () => {
    const db = buatDb();
    const t = await tambahPreset(db as unknown as D1Database, "T", "non_star");
    if (!t.ok) return;
    const s = await setProgram(db as unknown as D1Database, t.id, "go", true, "2026-05-01", null);
    assert.equal(s.ok, true);
    const prog = await listProgram(db as unknown as D1Database, t.id);
    assert.equal(prog.find((p) => p.kode_program === "go")?.aktif, 1);
    const ar = await tambahAturan(db as unknown as D1Database, t.id, {
      jenis: "program", kode_program: "go", kategori: "D", basis: "persen", nilai: 5.5, valid_from: "2026-05-02",
    });
    assert.equal(ar.ok, true);
    if (!ar.ok) return;
    const u = await ubahAturan(db as unknown as D1Database, t.id, ar.id, { nilai: 6 });
    assert.equal(u.ok, true);
    db.data.snap.push({ preset_id: t.id });
    const h = await hapusAturan(db as unknown as D1Database, t.id, ar.id);
    assert.equal(h.ok && h.lunak, true);
  });
});
