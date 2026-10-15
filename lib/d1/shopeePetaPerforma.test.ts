// Uji `simpanPerforma` (penulis pertama tabel `performa_produk`, migrasi 0027).
//
// Kenapa diuji meski hanya "insert": tabel itu SELALU KOSONG sebelum perubahan ini, jadi
// satu-satunya cara membuktikan sudah ada penulis adalah menulis lalu membacanya kembali.
// Mock di bawah setia pada dua hal yang mudah salah: konflik upsert (preset, periode, sku)
// dan pembuangan baris ber-SKU kosong.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BarisPeta } from "@/lib/analisa/peta";
import { simpanPerforma } from "./shopeePeta";

type Row = Record<string, unknown>;

/**
 * Mock D1 minimal: meniru INSERT ... ON CONFLICT(preset_id, periode, sku) DO UPDATE.
 */
function dbPalsu() {
  const performa = new Map<string, Row>();
  const db = {
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...args: unknown[]) {
          st._args = args;
          return st;
        },
        async run() {
          return { meta: {} };
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] as Row[] };
        },
      };
      return st;
    },
    async batch(stmts: { _sql: string; _args: unknown[] }[]) {
      const hasil: { meta: { changes: number } }[] = [];
      for (const s of stmts) {
        if (!s._sql.startsWith("INSERT INTO performa_produk")) {
          hasil.push({ meta: { changes: 0 } });
          continue;
        }
        const [presetId, periode, sku, dilihat, klik, kunjungan, keranjang, pesanan, omzet, tanpaBeli, at] = s._args as [
          number, string, string, number, number, number, number, number, number, number, number,
        ];
        performa.set(`${presetId}|${periode}|${sku}`, {
          preset_id: presetId, periode, sku, dilihat, klik, kunjungan, keranjang, pesanan, omzet,
          melihat_tanpa_beli: tanpaBeli, at,
        });
        hasil.push({ meta: { changes: 1 } });
      }
      return hasil;
    },
  };
  return Object.assign(db, { performa }) as unknown as D1Database & { performa: Map<string, Row> };
}

/** Satu baris peta lengkap; hanya field yang diuji yang perlu masuk akal. */
function b(sku: string, extra: Partial<BarisPeta> = {}): BarisPeta {
  return {
    kodeProduk: "28753717561", sku, tingkat: "variasi", variasi: "BIRU",
    kodeVariasiShopee: "138333482525", namaShopee: "Piring Rotan", periode: "29-09-2026-05-10-2026",
    dilihat: 155063, klik: 7405, kunjungan: 2274, keranjang: 1273, tanpaBeli: 456,
    pesanan: 283, omzet: 14244744, ...extra,
  };
}

describe("simpanPerforma", () => {
  it("menulis baris ber-SKU dengan kunci (preset, periode, sku)", async () => {
    const db = dbPalsu();
    await simpanPerforma(db, 7, "29-09-2026-05-10-2026", [b("001770")]);
    assert.equal(db.performa.size, 1);
    const r = db.performa.get("7|29-09-2026-05-10-2026|001770");
    assert.deepEqual(
      { d: r?.["dilihat"], k: r?.["klik"], j: r?.["kunjungan"], g: r?.["keranjang"], p: r?.["pesanan"], o: r?.["omzet"], t: r?.["melihat_tanpa_beli"] },
      { d: 155063, k: 7405, j: 2274, g: 1273, p: 283, o: 14244744, t: 456 },
    );
  });

  it("membuang baris tanpa SKU (performa_produk berkunci SKU)", async () => {
    const db = dbPalsu();
    await simpanPerforma(db, 7, "p", [b(""), b("001770")]);
    assert.equal(db.performa.size, 1);
    assert.equal(db.performa.has("7|p|001770"), true);
  });

  it("impor ulang menimpa, bukan menggandakan (idempoten)", async () => {
    const db = dbPalsu();
    await simpanPerforma(db, 7, "p", [b("001770")]);
    await simpanPerforma(db, 7, "p", [b("001770", { omzet: 999, pesanan: 5, dilihat: 1 })]);
    assert.equal(db.performa.size, 1);
    assert.equal(db.performa.get("7|p|001770")?.["omzet"], 999);
    assert.equal(db.performa.get("7|p|001770")?.["pesanan"], 5);
  });

  it("preset/periode berbeda tidak saling menimpa", async () => {
    const db = dbPalsu();
    await simpanPerforma(db, 7, "p1", [b("001770", { omzet: 100 })]);
    await simpanPerforma(db, 8, "p1", [b("001770", { omzet: 200 })]);
    await simpanPerforma(db, 7, "p2", [b("001770", { omzet: 300 })]);
    assert.equal(db.performa.size, 3);
    assert.deepEqual(
      [db.performa.get("7|p1|001770")?.["omzet"], db.performa.get("8|p1|001770")?.["omzet"], db.performa.get("7|p2|001770")?.["omzet"]],
      [100, 200, 300],
    );
  });

  it("daftar kosong tidak menyentuh DB", async () => {
    const db = dbPalsu();
    await simpanPerforma(db, 7, "p", []);
    assert.equal(db.performa.size, 0);
  });
});
