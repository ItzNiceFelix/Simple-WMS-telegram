// lib/d1/labaRegistry.test.ts — Registry anti-dobel No. Pesanan (Lapis 1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hitungDanSimpan, klasifikasikan, totalRegistry, type SiapHitung } from "./labaPreset";

type Row = Record<string, unknown>;

const SIAP: SiapHitung = {
  presetId: 1, statusToko: "non_star", rules: [], tierAdmin: new Map([["T10", 10]]),
  kategoriTabel: new Map([["Perlengkapan Rumah", "T10"]]),
  grupGo: new Map(), iklanPersen: null, pesananKumulatif: null, bergabungSejak: null, uploadPertama: null,
};

function buatDb(registry: Row[], kategoriProduk = "Perlengkapan Rumah") {
  const produk: Row[] = [
    { sku: "A1", hpp: 10000, nama_accurate: "A1", kategori: kategoriProduk, tier_override: null, pre_order: 0, ukuran_khusus: 0, go_override: null, updated_at: null },
  ];
  const db = {
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...a: unknown[]) { st._args = a; return st; },
        async first(): Promise<unknown> {
          const a = st._args;
          if (sql.startsWith("SELECT COUNT(*) AS jml_order")) {
            const rs = registry.filter((x) => x["preset_id"] === a[0] && String(x["tanggal_snapshot"]) >= String(a[1]) && String(x["tanggal_snapshot"]) <= String(a[2]));
            return {
              jml_order: rs.length, omzet: rs.reduce((t, x) => t + Number(x["omzet"]), 0),
              hpp: rs.reduce((t, x) => t + Number(x["hpp"]), 0), biaya: rs.reduce((t, x) => t + Number(x["biaya"]), 0),
              pajak: rs.reduce((t, x) => t + Number(x["pajak"]), 0), laba: rs.reduce((t, x) => t + Number(x["laba"]), 0),
            };
          }
          if (sql.includes("FROM laba_order WHERE preset_id")) {
            return registry.find((x) => x["preset_id"] === a[0] && x["no_pesanan"] === a[1]) ?? null;
          }
          if (sql.includes("FROM products WHERE sku")) {
            return produk.find((x) => x["sku"] === a[0]) ?? null;
          }
          return null;
        },
        async run() { return { meta: {} }; },
        async all(): Promise<{ results: unknown[] }> {
          if (sql.includes("no_pesanan IN (")) {
            return { results: registry.filter((x) => x["preset_id"] === st._args[0]) };
          }
          if (sql.includes("FROM laba_order WHERE preset_id = ?")) {
            return { results: registry.filter((x) => x["preset_id"] === st._args[0]) };
          }
          return { results: [] };
        },
      };
      return st;
    },
    async batch(stmts: { _sql: string; _args: unknown[] }[]) {
      for (const s of stmts) {
        const a = s._args;
        if (s._sql.includes("INTO laba_snapshot")) continue;
        if (!s._sql.includes("INTO laba_order") || a.length !== 12) continue;
        const row = {
          preset_id: a[0], no_pesanan: a[1], tanggal_snapshot: a[2], tanggal_pesanan: a[3],
          status_pesanan: a[4], omzet: a[5], hpp: a[6], biaya: a[7], pajak: a[8], laba: a[9], hash_baris: a[10],
        };
        const i = registry.findIndex((x) => x["preset_id"] === a[0] && x["no_pesanan"] === a[1]);
        if (s._sql.includes("OR IGNORE")) {
          if (i < 0) registry.push(row);
        } else if (i >= 0) registry[i] = { ...registry[i], ...row };
        else registry.push(row);
      }
      return [];
    },
  };
  return db;
}

function barisNo(no: string): Row {
  return {
    "No. Pesanan": no, "Status Pesanan": "Selesai", "Waktu Pesanan Dibuat": "2026-10-10 09:00",
    "Nomor Referensi SKU": "A1", "SKU Induk": "", "Harga Awal": "20000",
    "Harga Setelah Diskon": "18000", Jumlah: "1", "Returned quantity": "0",
    "Subtotal Pesanan": "18000", "Diskon Dari Penjual": "2000",
    "Voucher Ditanggung Penjual": "0", "Paket Diskon (Diskon dari Penjual)": "0",
  };
}

describe("labaRegistry (Lapis 1)", () => {
  it("klasifikasi: baru vs sama vs berubah", async () => {
    const registry: Row[] = [
      { preset_id: 1, no_pesanan: "SAMA", tanggal_snapshot: "2026-10-09", hash_baris: "A1x1@18000" },
      { preset_id: 1, no_pesanan: "UBAH", tanggal_snapshot: "2026-10-09", hash_baris: "LAMA" },
    ];
    const db = buatDb(registry);
    const pesanan = (no: string, hash: string) => ({
      no_pesanan: no, status_pesanan: "Selesai", tanggal_pesanan: "2026-10-10 09:00",
      omzet: 18000, hpp: 10000, biaya: 1000, pajak: 90, laba: 6910, hash_baris: hash,
    });
    const k = await klasifikasikan(db as unknown as D1Database, 1, [
      pesanan("SAMA", "A1x1@18000"), pesanan("UBAH", "A1x2@36000"), pesanan("BARU", "A1x1@18000"),
    ]);
    assert.equal(k.baru, 1);
    assert.equal(k.sama, 1);
    assert.equal(k.berubah, 1);
  });

  it("tambah_baru lewati No lama; total distinct anti dobel", async () => {
    const registry: Row[] = [];
    const db = buatDb(registry);
    const r1 = await hitungDanSimpan(db as unknown as D1Database, SIAP, [barisNo("O-1"), barisNo("O-2")], "f1.xlsx", "2026-10-10", "t1", true, "tambah_baru");
    assert.equal(r1.agregat.jml_order, 2);
    assert.equal(r1.klasifikasi.baru, 2);
    assert.equal(registry.length, 2);
    const r2 = await hitungDanSimpan(db as unknown as D1Database, SIAP, [barisNo("O-2"), barisNo("O-3")], "f2.xlsx", "2026-10-11", "t1", true, "tambah_baru");
    assert.equal(r2.klasifikasi.baru, 1);
    assert.equal(r2.klasifikasi.sama, 1);
    assert.equal(registry.find((x) => x["no_pesanan"] === "O-2")?.["tanggal_snapshot"], "2026-10-10");
    const total = await totalRegistry(db as unknown as D1Database, 1, "2026-10-01", "2026-10-31");
    assert.equal(total.jml_order, 3);
  });

  it("blokir simpan saat SKU belum terpetakan (TIER_UNKNOWN)", async () => {
    const registry: Row[] = [];
    const db = buatDb(registry, null); // produk tanpa kategori → T_UNKNOWN
    await assert.rejects(
      () => hitungDanSimpan(db as unknown as D1Database, SIAP, [barisNo("O-9")], "f.xlsx", "2026-10-12", "t1", true),
      /Simpan dibatalkan: 1 baris SKU belum punya kategori tarif.*contoh: A1/
    );
    assert.equal(registry.length, 0, "registry tidak boleh ditulis saat simpan diblokir");
    // Preview (simpan=false) tetap jalan tanpa melempar + menandai SKU.
    const preview = await hitungDanSimpan(db as unknown as D1Database, SIAP, [barisNo("O-9")], "f.xlsx", "2026-10-12", "t1", false);
    assert.equal(preview.agregat.jml_baris_belum_terpetakan, 1);
    assert.deepEqual(preview.agregat.sku_belum_terpetakan, ["A1"]);
  });

  it("simpan lolos setelah kategori SKU dipetakan", async () => {
    const registry: Row[] = [];
    const db = buatDb(registry); // produk berkategori "Perlengkapan Rumah"
    const siapPeta: SiapHitung = {
      ...SIAP,
      kategoriTabel: new Map([["Perlengkapan Rumah", "T10"]]),
      tierAdmin: new Map([["T10", 10]]),
    };
    const ok = await hitungDanSimpan(db as unknown as D1Database, siapPeta, [barisNo("O-9")], "f.xlsx", "2026-10-12", "t1", true);
    assert.equal(ok.agregat.jml_baris_belum_terpetakan, 0);
    assert.equal(registry.length, 1);
  });

  it("timpa_semua tulis ulang No lama", async () => {
    const registry: Row[] = [
      { preset_id: 1, no_pesanan: "O-2", tanggal_snapshot: "2026-10-10", status_pesanan: "Selesai", hash_baris: "LAMA", omzet: 1, hpp: 1, biaya: 1, pajak: 0, laba: 0 },
    ];
    const db = buatDb(registry);
    await hitungDanSimpan(db as unknown as D1Database, SIAP, [barisNo("O-2")], "f2.xlsx", "2026-10-11", "t1", true, "timpa_semua");
    assert.equal(registry.find((x) => x["no_pesanan"] === "O-2")?.["tanggal_snapshot"], "2026-10-11");
  });
});
