import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alokasiLabaSku, ambilOrder, hitungLaba, imporPesanan, listOrder, porsiSku, transisiFulfill, transisiFulfillBatch, type BarisPesanan, type OrderItem } from "./order";
import type { Hasil } from "./db";

describe("hitungLaba", () => {
  it("omzet-hpp-biaya-pph-ppn benar", () => {
    const r = hitungLaba(
      [{ sku: "A", qty: 2, harga_satuan: 100000, hpp_snapshot: 60000 }],
      [{ jenis: "admin", basis: "persen", nilai: 4 }],
      true, 0
    );
    assert.equal(r.omzet, 200000);
    assert.equal(r.hpp, 120000);
    assert.equal(r.biaya, 8000);
    assert.equal(r.pph, 1000);
    assert.equal(r.laba, 200000 - 120000 - 8000 - 1000);
  });
  it("tanpa pph + flat fee", () => {
    const r = hitungLaba(
      [{ sku: "A", qty: 1, harga_satuan: 50000, hpp_snapshot: 30000 }],
      [{ jenis: "ongkir", basis: "flat", nilai: 10000 }],
      false, 11
    );
    assert.equal(r.pph, 0);
    assert.equal(r.ppn, 5500);
    assert.equal(r.laba, 50000 - 30000 - 10000 - 5500);
  });
  it("alokasi per SKU jumlah = laba order", () => {
    const items = [
      { sku: "A", qty: 1, harga_satuan: 100000, hpp_snapshot: 60000 },
      { sku: "B", qty: 1, harga_satuan: 100000, hpp_snapshot: 50000 },
    ];
    const r = hitungLaba(items, [{ jenis: "admin", basis: "persen", nilai: 10 }], true, 0);
    const al = alokasiLabaSku(items, r);
    assert.ok(Math.abs(al["A"] + al["B"] - r.laba) < 1);
  });
});

type Row = Record<string, unknown>;
const kunciOrder = (mp: string, no: string) => `${mp}|${no}`;

function buatDbOrder() {
  const products: Record<string, Row> = {
    A: { sku: "A", nama_accurate: "Produk A", hpp: 60000, hpp_baru: null, is_online_product: 1, stok_min: null },
  };
  const bins: Record<string, number> = { "A|ONLINE": 10 };
  const moves: Row[] = [];
  const orders: Record<string, Row> = {};
  const items: Record<string, Row> = {};
  const fees: Row[] = [];
  const presets: Row[] = [
    { marketplace: "shopee", jenis: "admin", basis: "persen", nilai: 4 },
    { marketplace: "tokopedia", jenis: "service", basis: "persen", nilai: 6 },
  ];
  let feeSeq = 0;
  const db = {
    data: { products, bins, moves, orders, items, fees, presets },
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...a: unknown[]) {
          st._args = a;
          return st;
        },
        async first(): Promise<unknown> {
          const a = st._args;
          if (sql.includes("FROM products WHERE sku")) return products[String(a[0])] ?? null;
          if (sql.startsWith("SELECT qty FROM stock_by_bin")) return { qty: bins[`${a[0]}|${a[1]}`] ?? 0 };
          if (sql.includes("SELECT status_fulfill, stok_dikurangi FROM orders")) {
            const o = orders[kunciOrder(String(a[0]), String(a[1]))];
            return o ? { status_fulfill: o["status_fulfill"], stok_dikurangi: o["stok_dikurangi"] ?? 0 } : null;
          }
          if (sql.includes("SELECT status_fulfill FROM orders")) {
            const o = orders[kunciOrder(String(a[0]), String(a[1]))];
            return o ? { status_fulfill: o["status_fulfill"] } : null;
          }
          if (sql.startsWith("SELECT marketplace, no_pesanan, tanggal, buyer, status_fulfill, pajak_pph")) {
            return orders[kunciOrder(String(a[0]), String(a[1]))] ?? null;
          }
          return null;
        },
        async run() {
          const a = st._args;
          if (sql.startsWith("INSERT INTO stock_by_bin")) {
            bins[`${a[0]}|${a[1]}`] = Number(a[2]);
            return { meta: {} };
          }
          if (sql.startsWith("INSERT INTO stock_moves")) {
            moves.push({ sku: a[0], qty: a[1], jenis: String(a[2]), gudang_id: a[3] });
            return { meta: {} };
          }
          if (sql.startsWith("UPDATE orders SET status_fulfill = ?, stok_dikurangi = ?")) {
            const o = orders[kunciOrder(String(a[2]), String(a[3]))];
            if (o) {
              o["status_fulfill"] = a[0];
              o["stok_dikurangi"] = a[1];
            }
            return { meta: {} };
          }
          if (sql.startsWith("UPDATE orders SET status_fulfill")) {
            const o = orders[kunciOrder(String(a[1]), String(a[2]))];
            if (o) o["status_fulfill"] = a[0];
            return { meta: {} };
          }
          if (sql.startsWith("INSERT OR IGNORE INTO orders")) {
            const k = kunciOrder(String(a[0]), String(a[1]));
            if (!orders[k]) orders[k] = { marketplace: a[0], no_pesanan: a[1], tanggal: a[2], buyer: a[3], status_fulfill: "pending", pajak_pph: a[4], pajak_ppn_persen: a[5], stok_dikurangi: 0 };
            return { meta: {} };
          }
          if (sql.startsWith("INSERT OR REPLACE INTO order_items")) {
            items[`${a[0]}|${a[1]}|${a[2]}`] = { marketplace: a[0], no_pesanan: a[1], sku: a[2], qty: a[3], harga_satuan: a[4], hpp_snapshot: a[5], subtotal: a[6] };
            return { meta: {} };
          }
          if (sql.startsWith("DELETE FROM order_fees")) {
            for (let i = fees.length - 1; i >= 0; i--) if (fees[i]["marketplace"] === a[0] && fees[i]["no_pesanan"] === a[1]) fees.splice(i, 1);
            return { meta: {} };
          }
          if (sql.startsWith("INSERT INTO order_fees")) {
            feeSeq += 1;
            fees.push({ id: feeSeq, marketplace: a[0], no_pesanan: a[1], jenis: a[2], basis: a[3], nilai: a[4], amount: a[5] });
            return { meta: {} };
          }
          return { meta: {} };
        },
        async all(): Promise<{ results: unknown[] }> {
          const a = st._args;
          if (sql.includes("FROM order_items WHERE marketplace")) {
            return { results: Object.values(items).filter((x) => x["marketplace"] === a[0] && x["no_pesanan"] === a[1]) };
          }
          if (sql.includes("FROM mp_fee_presets WHERE marketplace")) {
            return { results: presets.filter((x) => x["marketplace"] === a[0]) };
          }
          if (sql.includes("FROM order_fees WHERE marketplace")) {
            return { results: fees.filter((x) => x["marketplace"] === a[0] && x["no_pesanan"] === a[1]) };
          }
          if (sql.includes("FROM orders") && sql.includes("ORDER BY tanggal DESC")) {
            let r = Object.values(orders).sort((x, y) => Number(y["tanggal"]) - Number(x["tanggal"]));
            let i = 0;
            if (sql.includes("marketplace = ?")) { const v = a[i++]; r = r.filter((x) => x["marketplace"] === v); }
            // ponytail: ceiling = e2e mock-mode cuma UI; perluas agregat bila route rekap butuh.
            if (sql.includes("status_fulfill = ?")) { const v = a[i++]; r = r.filter((x) => x["status_fulfill"] === v); }
            if (sql.includes("tanggal >= ?")) { const v = Number(a[i++]); r = r.filter((x) => Number(x["tanggal"]) >= v); }
            if (sql.includes("tanggal <= ?")) { const v = Number(a[i++]); r = r.filter((x) => Number(x["tanggal"]) <= v); }
            return { results: r.slice(0, 100) };
          }
          return { results: [] };
        },
      };
      return st;
    },
    async batch(stmts: { _sql: string; _args: unknown[] }[]) {
      for (const s of stmts) await this.prepare(s._sql).bind(...s._args).run();
      return [];
    },
  };
  return db as unknown as D1Database & { data: { products: Record<string, Row>; bins: Record<string, number>; moves: Row[]; orders: Record<string, Row>; items: Record<string, Row>; fees: Row[]; presets: Row[] } };
}

function statusGagal(r: Hasil<unknown>): number {
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("diharapkan gagal");
  return r.status;
}

const barisA = (no: string, qty: number): BarisPesanan => ({ marketplace: "shopee", no_pesanan: no, tanggal: 1728288000, buyer: "Budi", sku: "A", qty, harga_satuan: 100000 });

describe("porsiSku (filter rekap per SKU)", () => {
  it("order 2 SKU: porsi = omzet/HPP/laba SKU itu, bukan total order", () => {
    const items: OrderItem[] = [
      { sku: "A", qty: 1, harga_satuan: 100000, hpp_snapshot: 60000 },
      { sku: "B", qty: 1, harga_satuan: 100000, hpp_snapshot: 50000 },
    ];
    const r = hitungLaba(items, [{ jenis: "admin", basis: "persen", nilai: 10 }], true, 0);
    const a = porsiSku(items, r, "A");
    assert.equal(a.omzet, 100000, "omzet = porsi SKU A, bukan 200000");
    assert.equal(a.hpp, 60000);
    assert.notEqual(a.laba, r.laba, "laba porsi bukan laba total order");
    assert.equal(a.porsi_sku, true);
    assert.equal(a.pph, 0);
    assert.equal(a.ppn, 0);
    // omzet - hpp - biaya = laba tetap konsisten dengan bentuk RincianOrder.
    assert.equal(a.omzet - a.hpp - a.biaya, a.laba);
    const b = porsiSku(items, r, "B");
    assert.equal(a.laba + b.laba, r.laba, "jumlah porsi = laba order");
    assert.equal(a.omzet + b.omzet, r.omzet);
    assert.equal(a.hpp + b.hpp, r.hpp);
  });

  it("tanpa filter sku: angka baris tetap total order", () => {
    const items: OrderItem[] = [
      { sku: "A", qty: 1, harga_satuan: 100000, hpp_snapshot: 60000 },
      { sku: "B", qty: 1, harga_satuan: 100000, hpp_snapshot: 50000 },
    ];
    const r = hitungLaba(items, [], false, 0);
    assert.equal(r.omzet, 200000);
    assert.equal(r.laba, 90000);
  });

  it("SKU tak ada di order → porsi nol (bukan total order)", () => {
    const items: OrderItem[] = [{ sku: "A", qty: 2, harga_satuan: 50000, hpp_snapshot: 30000 }];
    const r = hitungLaba(items, [], false, 0);
    const c = porsiSku(items, r, "C");
    assert.equal(c.omzet, 0);
    assert.equal(c.hpp, 0);
    assert.equal(c.laba, 0);
    assert.equal(c.margin, 0);
  });
});

describe("transisiFulfill", () => {
  it("pack kurangi stok + movement jual_mp", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("SHP-1", 3)], null);
    const r = await transisiFulfill(db, "shopee", "SHP-1", "pack", "owner1");
    assert.equal(r.ok, true);
    assert.equal(db.data.bins["A|ONLINE"], 7);
    const mv = db.data.moves.filter((m) => m["jenis"] === "jual_mp");
    assert.equal(mv.length, 1);
    assert.equal(mv[0]["qty"], -3);
  });
  it("pack stok kurang → 400, stok utuh", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("SHP-2", 99)], null);
    const r = await transisiFulfill(db, "shopee", "SHP-2", "pack", null);
    assert.equal(statusGagal(r), 400);
    assert.equal(db.data.bins["A|ONLINE"], 10);
  });
  it("batal kembalikan stok + retur_mp", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("SHP-3", 3)], null);
    await transisiFulfill(db, "shopee", "SHP-3", "pack", null);
    const r = await transisiFulfill(db, "shopee", "SHP-3", "batal", null);
    assert.equal(r.ok, true);
    assert.equal(db.data.bins["A|ONLINE"], 10);
    const mv = db.data.moves.filter((m) => m["jenis"] === "retur_mp");
    assert.equal(mv.length, 1);
    assert.equal(mv[0]["qty"], 3);
  });
  it("pending→kirim langsung → 409; order tak ada → 404", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("SHP-4", 1)], null);
    assert.equal(statusGagal(await transisiFulfill(db, "shopee", "SHP-4", "kirim", null)), 409);
    assert.equal(statusGagal(await transisiFulfill(db, "shopee", "TAK-ADA", "pack", null)), 404);
  });
});

describe("transisiFulfillBatch", () => {
  it("dua order pack: keduanya terpotong", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("B-1", 2), barisA("B-2", 3)], null);
    const r = await transisiFulfillBatch(db, [{ mp: "shopee", no: "B-1", ke: "pack" }, { mp: "shopee", no: "B-2", ke: "pack" }], null);
    assert.equal(r.ok, true);
    assert.equal(db.data.bins["A|ONLINE"], 5);
    assert.equal(db.data.moves.filter((m) => m["jenis"] === "jual_mp").length, 2);
  });

  it("satu order stok kurang: tidak ada perubahan sama sekali", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("B-3", 4), barisA("B-4", 9)], null);
    const r = await transisiFulfillBatch(db, [{ mp: "shopee", no: "B-3", ke: "pack" }, { mp: "shopee", no: "B-4", ke: "pack" }], null);
    assert.equal(statusGagal(r), 400);
    assert.equal(db.data.bins["A|ONLINE"], 10);
    assert.equal(db.data.moves.length, 0);
    assert.equal(db.data.orders[kunciOrder("shopee", "B-3")]["status_fulfill"], "pending");
  });

  it("batal order ber-resi eksternal tidak menyentuh stok", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("B-5", 2)], null);
    db.data.orders[kunciOrder("shopee", "B-5")]["status_fulfill"] = "kirim";
    const r = await transisiFulfillBatch(db, [{ mp: "shopee", no: "B-5", ke: "batal" }], null);
    assert.equal(r.ok, true);
    assert.equal(db.data.bins["A|ONLINE"], 10);
    assert.equal(db.data.moves.filter((m) => m["jenis"] === "retur_mp").length, 0);
  });

  it("target duplikat dihitung sekali", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("B-6", 3)], null);
    const r = await transisiFulfillBatch(db, [{ mp: "shopee", no: "B-6", ke: "pack" }, { mp: "shopee", no: "B-6", ke: "pack" }], null);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.count, 1);
    assert.equal(db.data.bins["A|ONLINE"], 7);
  });
});

describe("imporPesanan", () => {
  it("2 order: preset bila tanpa fee + snapshot beku", async () => {
    const db = buatDbOrder();
    const r = await imporPesanan(db, [
      { marketplace: "shopee", no_pesanan: "O-1", tanggal: 1728288000, buyer: "Budi", sku: "A", qty: 2, harga_satuan: 100000 },
      { marketplace: "tokopedia", no_pesanan: "O-2", tanggal: 1728288000, buyer: "Sari", sku: "A", qty: 1, harga_satuan: 50000, fee_jenis: "ongkir", fee_basis: "flat", fee_nilai: 10000 },
    ], null);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.order, 2);
      assert.equal(r.item, 2);
    }
    const o1 = await ambilOrder(db, "shopee", "O-1");
    assert.ok(o1);
    assert.equal(o1?.items[0]?.hpp_snapshot, 60000);
    assert.equal(o1?.fees.length, 1);
    assert.equal(o1?.fees[0]?.jenis, "admin");
    assert.equal(o1?.fees[0]?.amount, 8000);
    const o2 = await ambilOrder(db, "tokopedia", "O-2");
    assert.equal(o2?.fees.length, 1);
    assert.equal(o2?.fees[0]?.jenis, "ongkir");
    db.data.products["A"]["hpp"] = 99999;
    const o1b = await ambilOrder(db, "shopee", "O-1");
    assert.equal(o1b?.items[0]?.hpp_snapshot, 60000);
  });
  it("SKU tak dikenal → 400; impor ulang idempoten", async () => {
    const db = buatDbOrder();
    assert.equal(statusGagal(await imporPesanan(db, [{ ...barisA("X-1", 1), sku: "ZILCH" }], null)), 400);
    await imporPesanan(db, [barisA("O-9", 1)], null);
    await imporPesanan(db, [barisA("O-9", 1)], null);
    const o = await ambilOrder(db, "shopee", "O-9");
    assert.equal(o?.items.length, 1);
    assert.equal(o?.fees.length, 1);
    assert.equal((await listOrder(db, {})).length, 1);
  });
});

describe("ambilOrder + listOrder", () => {
  it("null bila tak ada; filter mp", async () => {
    const db = buatDbOrder();
    assert.equal(await ambilOrder(db, "shopee", "NOPE"), null);
    await imporPesanan(db, [barisA("L-1", 1), { ...barisA("L-2", 1), marketplace: "tiktok" }], null);
    assert.equal((await listOrder(db, {})).length, 2);
    assert.equal((await listOrder(db, { mp: "shopee" })).length, 1);
  });
});
describe("listOrder filter status + periode", () => {
  it("status pack; dari/sampai epoch", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [
      { ...barisA("F-1", 1), tanggal: 1728288000 },
      { ...barisA("F-2", 1), tanggal: 1730419200 },
    ], null);
    await transisiFulfill(db, "shopee", "F-1", "pack", null);
    assert.equal((await listOrder(db, { status: "pack" })).length, 1);
    assert.equal((await listOrder(db, { dari: 1730000000 })).length, 1);
    assert.equal((await listOrder(db, { sampai: 1729000000 })).length, 1);
  });
});
