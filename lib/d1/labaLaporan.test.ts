// lib/d1/labaLaporan.test.ts — Lapis 3: escape CSV + deteksi overlap berbasis laba_snapshot.no_json.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { barisCsv, cariOverlap, daftarPerNo, selCsv } from "./labaLaporan";

type Row = Record<string, unknown>;

// Mock D1 minimal: snapshot (preset_id, tanggal, no_json) + registry datar.
// Meniru realita: registry ber-PK (preset_id, no_pesanan) → satu baris per No (upsert).
function buatDb(snapshot: Row[], registry: Row[]) {
  return {
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...a: unknown[]) { st._args = a; return st; },
        async all(): Promise<{ results: unknown[] }> {
          const a = st._args;
          if (sql.includes("FROM laba_snapshot")) {
            return {
              results: snapshot
                .filter((s) => s["preset_id"] === a[0] && String(s["tanggal"]) >= String(a[1]) && String(s["tanggal"]) <= String(a[2]))
                .sort((x, y) => String(x["tanggal"]).localeCompare(String(y["tanggal"])))
                // Simulasi DB lama tanpa kolom no_json: baris tanpa key → undefined.
                .map((s) => ({ tanggal: s["tanggal"], no_json: s["no_json"] })),
            };
          }
          if (sql.includes("no_pesanan IN (")) {
            const nos = a.slice(1) as string[];
            return {
              results: registry.filter((x) => x["preset_id"] === a[0] && nos.includes(String(x["no_pesanan"]))),
            };
          }
          return {
            results: registry
              .filter((x) => x["preset_id"] === a[0] && String(x["tanggal_snapshot"]) >= String(a[1]) && String(x["tanggal_snapshot"]) <= String(a[2]))
              .sort((x, y) => String(x["no_pesanan"]).localeCompare(String(y["no_pesanan"]))),
          };
        },
      };
      return st;
    },
  };
}

function snap(tanggal: string, no: string[]): Row {
  return { preset_id: 1, tanggal, no_json: JSON.stringify(no) };
}

function baris(no: string, tanggal: string, omzet: number, laba: number, status = "Selesai"): Row {
  return {
    preset_id: 1, no_pesanan: no, tanggal_snapshot: tanggal, tanggal_pesanan: `${tanggal} 09:00`,
    status_pesanan: status, omzet, hpp: 10000, biaya: 1000, pajak: 90, laba,
  };
}

describe("labaLaporan (Lapis 3)", () => {
  it("selCsv mengutip ganda + sel berisiko", () => {
    assert.equal(selCsv('Pesanan "A"'), '"Pesanan ""A"""');
    assert.equal(selCsv("a,b"), '"a,b"');
    assert.equal(selCsv("normal"), "normal");
    assert.equal(selCsv(null), "");
    assert.equal(selCsv(18000), "18000");
  });

  it("barisCsv: header tetap + baris ber-kutip di-escape", () => {
    const csv = barisCsv([
      { no_pesanan: 'O-"1"', tanggal_snapshot: "2026-10-10", tanggal_pesanan: "2026-10-10 09:00", status_pesanan: "Selesai", omzet: 18000, hpp: 10000, biaya: 1000, pajak: 90, laba: 6910 },
    ]);
    const lines = csv.split("\r\n");
    assert.equal(lines[0], "no_pesanan,tanggal_snapshot,tanggal_pesanan,status_pesanan,omzet,hpp,biaya,pajak,laba");
    assert.equal(lines[1], '"O-""1""",2026-10-10,2026-10-10 09:00,Selesai,18000,10000,1000,90,6910');
    assert.equal(lines[2], "", "CSV diakhiri newline, tanpa baris kosong tambahan");
    assert.equal(lines.length, 3);
  });

  // Inti cacat desain yang diperbaiki: registry ber-PK → tak pernah bisa deteksi lintas tanggal.
  it("cariOverlap: registry ber-PK satu baris/No → deteksi dari no_json snapshot", async () => {
    const registry = [baris("O-1", "2026-10-11", 18000, 6910), baris("O-2", "2026-10-12", 5000, 100)];
    const db = buatDb(
      [snap("2026-10-10", ["O-1", "O-2"]), snap("2026-10-11", ["O-1"]), snap("2026-10-12", ["O-3"])],
      registry
    );
    const r = await cariOverlap(db as unknown as D1Database, 1, "2026-10-01", "2026-10-31");
    assert.equal(r.jml_overlap, 1, "hanya O-1 yang muncul di 2 tanggal");
    assert.equal(r.daftar[0].no_pesanan, "O-1");
    assert.deepEqual(r.daftar[0].tanggal_list, ["2026-10-10", "2026-10-11"]);
    assert.equal(r.daftar[0].jumlah_snapshot, 2);
    assert.equal(r.daftar[0].omzet_total, 18000, "angka dari registry (snapshot terakhir)");
    assert.equal(r.daftar[0].laba_total, 6910);
    assert.equal(r.daftar[0].selisih_omzet, 18000);
    assert.equal(r.daftar[0].ada_di_registry, true);
  });

  it("cariOverlap: No tak ada di registry → angka 0 + ada_di_registry false", async () => {
    const db = buatDb([snap("2026-10-10", ["O-9"]), snap("2026-10-12", ["O-9"])], []);
    const r = await cariOverlap(db as unknown as D1Database, 1, "2026-10-01", "2026-10-31");
    assert.equal(r.jml_overlap, 1);
    assert.equal(r.daftar[0].ada_di_registry, false);
    assert.equal(r.daftar[0].omzet_total, 0);
    assert.equal(r.daftar[0].selisih_omzet, 0);
  });

  it("cariOverlap: snapshot lama tanpa no_json dihitung, tidak bikin error", async () => {
    // Snapshot terakhir tak punya kolom no_json sama sekali (simulasi DB pra-0018).
    const db = buatDb(
      [snap("2026-10-10", ["O-1"]), snap("2026-10-11", ["O-1"]), { preset_id: 1, tanggal: "2026-10-12" }],
      [baris("O-1", "2026-10-11", 18000, 6910)]
    );
    const r = await cariOverlap(db as unknown as D1Database, 1, "2026-10-01", "2026-10-31");
    assert.equal(r.jml_overlap, 1);
    assert.equal(r.jml_snapshot_tanpa_daftar, 1, "snapshot tanpa daftar No ditandai");
  });

  it("cariOverlap: no_json rusak / bukan array diabaikan", async () => {
    const db = buatDb(
      [{ preset_id: 1, tanggal: "2026-10-10", no_json: "{bukan json" }, { preset_id: 1, tanggal: "2026-10-11", no_json: "{}" }],
      []
    );
    const r = await cariOverlap(db as unknown as D1Database, 1, "2026-10-01", "2026-10-31");
    assert.equal(r.jml_overlap, 0);
    assert.equal(r.jml_snapshot_tanpa_daftar, 2);
  });

  it("daftarPerNo: satu baris per No pada rentang (sumber CSV)", async () => {
    const db = buatDb([], [baris("O-1", "2026-10-10", 18000, 6910), baris("O-2", "2026-11-01", 5000, 100)]);
    const rows = await daftarPerNo(db as unknown as D1Database, 1, "2026-10-01", "2026-10-31");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].no_pesanan, "O-1");
    assert.equal(rows[0].laba, 6910);
  });
});
