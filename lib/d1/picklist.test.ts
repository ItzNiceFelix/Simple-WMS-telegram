import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buatPicklist } from "./picklist";
import { bangunPdfPicklist } from "./picklistPdf";

type Row = Record<string, unknown>;

function buatDbPicklist(orders: Row[], items: Row[], products: Row[]) {
  return {
    prepare(sql: string) {
      const st = {
        _args: [] as unknown[],
        bind(...a: unknown[]) { st._args = a; return st; },
        async first() {
          if (sql.includes("FROM orders") && sql.includes("status_fulfill")) {
            const o = orders.find((x) => x["marketplace"] === st._args[0] && x["no_pesanan"] === st._args[1]);
            return o ? { status_fulfill: o["status_fulfill"] } : null;
          }
          return null;
        },
        async all() {
          return {
            results: items
              .filter((it) => it["marketplace"] === st._args[0] && it["no_pesanan"] === st._args[1])
              .map((it) => {
                const p = products.find((x) => x["sku"] === it["sku"]);
                return { sku: it["sku"], nama: p ? p["nama_accurate"] : null, qty: it["qty"] };
              }),
          };
        },
      };
      return st;
    },
  } as unknown as D1Database;
}

describe("buatPicklist", () => {
  it("agregat SKU sama lintas order pending", async () => {
    const db = buatDbPicklist(
      [{ marketplace: "shopee", no_pesanan: "O1", status_fulfill: "pending" }, { marketplace: "shopee", no_pesanan: "O2", status_fulfill: "pending" }],
      [{ marketplace: "shopee", no_pesanan: "O1", sku: "A", qty: 2 }, { marketplace: "shopee", no_pesanan: "O2", sku: "A", qty: 3 }, { marketplace: "shopee", no_pesanan: "O2", sku: "B", qty: 1 }],
      [{ sku: "A", nama_accurate: "Produk A" }, { sku: "B", nama_accurate: "Produk B" }],
    );
    const r = await buatPicklist(db, [{ mp: "shopee", no: "O1" }, { mp: "shopee", no: "O2" }]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.orders, 2);
    assert.equal(r.units, 6);
    assert.deepEqual(r.rows.map((x) => x.sku), ["A", "B"]);
    assert.equal(r.rows[0].qty, 5);
  });

  it("order bukan pending ditolak", async () => {
    const db = buatDbPicklist([{ marketplace: "shopee", no_pesanan: "O3", status_fulfill: "kirim" }], [], []);
    const r = await buatPicklist(db, [{ mp: "shopee", no: "O3" }]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 409);
  });

  it("order tak ada → 404", async () => {
    const db = buatDbPicklist([], [], []);
    const r = await buatPicklist(db, [{ mp: "shopee", no: "X" }]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 404);
  });

  it("SKU hilang dari master ditolak", async () => {
    const db = buatDbPicklist(
      [{ marketplace: "shopee", no_pesanan: "O4", status_fulfill: "pending" }],
      [{ marketplace: "shopee", no_pesanan: "O4", sku: "ZZ", qty: 1 }],
      [],
    );
    const r = await buatPicklist(db, [{ mp: "shopee", no: "O4" }]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /ZZ/);
  });
});

describe("bangunPdfPicklist", () => {
  it("menghasilkan PDF dan memuat ringkasan", async () => {
    const bytes = await bangunPdfPicklist([{ sku: "A", nama: "Produk A", qty: 5 }], 2);
    assert.ok(bytes.length > 500);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  });
});
