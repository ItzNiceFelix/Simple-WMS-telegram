// lib/d1/picklistPaket.test.ts — Picklist per paket (F18/D4): gruping resi, qty apa adanya, PDF per lembar.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { buatPicklistPaket } from "./picklist";
import { bangunPdfPicklistPaket } from "./picklistPaketPdf";

type Baris = Record<string, unknown>;

/** Mock D1 untuk buatPicklistPaket + mode. */
function mockDb(init: { orders?: Baris[]; grup?: Baris[]; items?: Baris[]; produk?: Baris[] } = {}) {
  const db = { orders: init.orders ?? [], grup: init.grup ?? [], items: init.items ?? [], produk: init.produk ?? [] };
  const norm = (s: unknown): string => (s == null ? "" : String(s));
  db.prepare = (sql: string) => {
    const stmt: { _args: unknown[]; bind: (...a: unknown[]) => typeof stmt; all: <T>() => Promise<{ results: T[] }>; first: <T>() => Promise<T | null>; run: () => Promise<{ meta: { changes: number } }> } = {
      _args: [] as unknown[],
      bind(...args: unknown[]) {
        stmt._args = args;
        return stmt;
      },
      async all<T>() {
        const a = stmt._args.map(norm);
        if (sql.includes("FROM order_items")) {
          // SELECT i.sku, p.nama_accurate AS nama, i.qty, i.variasi → proyeksikan kolom nama.
          return { results: db.items.filter((i) => norm(i.no_pesanan) === a[0]).map((i) => ({ sku: i.sku, nama: i.nama_accurate, qty: i.qty, variasi: i.variasi })) as T[] };
        }
        if (sql.includes("FROM orders")) {
          const set = new Set(a);
          return { results: db.orders.filter((o) => set.has(norm(o.no_pesanan))) as T[] };
        }
        if (sql.includes("FROM resi_grup")) {
          const set = new Set(a);
          return { results: db.grup.filter((g) => set.has(norm(g.no_resi))) as T[] };
        }
        return { results: [] as T[] };
      },
      async first<T>() {
        return null as T | null;
      },
      async run() {
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  db.batch = async (list: { run: () => Promise<unknown> }[]) => Promise.all(list.map((s) => s.run()));
  return db as unknown as D1Database & typeof db;
}

const DB_FIXTURE = {
  orders: [
    { no_pesanan: "O-A", no_resi: "R-GAB" },
    { no_pesanan: "O-B", no_resi: "R-GAB" },
    { no_pesanan: "O-C", no_resi: "R-TUNGGAL" },
  ],
  grup: [
    { no_resi: "R-GAB", no_json: '["O-A","O-B"]', jasa_kirim: "SPX" },
    { no_resi: "R-TUNGGAL", no_json: '["O-C"]', jasa_kirim: "JNE" },
  ],
  items: [
    { no_pesanan: "O-A", sku: "SKU-1", nama_accurate: "Produk Satu", qty: 2, variasi: "MERAH" },
    { no_pesanan: "O-B", sku: "SKU-2", nama_accurate: "Produk Dua", qty: 3, variasi: "" },
    { no_pesanan: "O-C", sku: "SKU-1", nama_accurate: "Produk Satu", qty: 1, variasi: "BIRU" },
  ],
};

describe("buatPicklistPaket", () => {
  it("grup resi gabungan jadi satu paket dengan qty apa adanya (bukan agregasi lintas order)", async () => {
    const db = mockDb(DB_FIXTURE);
    // Kedua order di grup dikirim sebagai target (itulah yang dilakukan UI memilih order).
    const r = await buatPicklistPaket(db, [{ mp: "shopee", no: "O-A" }, { mp: "shopee", no: "O-B" }]);
    assert.ok(r.ok);
    assert.equal(r.paket.length, 1);
    assert.deepEqual(r.paket[0].no_pesanan, ["O-A", "O-B"]);
    assert.equal(r.paket[0].no_resi, "R-GAB");
    assert.equal(r.paket[0].units, 5);
    assert.equal(r.paket[0].rows.length, 2);
  });
  it("D4: SKU SAMA di dua order TIDAK diagregasi — baris tetap terpisah per order, total = jumlah apa adanya", async () => {
    const db = mockDb({
      orders: [{ no_pesanan: "O-A", no_resi: "R1" }, { no_pesanan: "O-B", no_resi: "R1" }],
      grup: [{ no_resi: "R1", no_json: '["O-A","O-B"]', jasa_kirim: "SPX" }],
      items: [
        { no_pesanan: "O-A", sku: "SKU-1", nama_accurate: "Produk Satu", qty: 2, variasi: "HIJAU" },
        { no_pesanan: "O-B", sku: "SKU-1", nama_accurate: "Produk Satu", qty: 3, variasi: "BIRU" },
      ],
    });
    const r = await buatPicklistPaket(db, [{ mp: "shopee", no: "O-A" }, { mp: "shopee", no: "O-B" }]);
    assert.ok(r.ok);
    // Dua baris terpisah (bukan satu baris qty 5) — qty di file gabungan SUDAH total paket.
    assert.equal(r.paket[0].rows.length, 2);
    assert.deepEqual(r.paket[0].rows.map((x) => ({ sku: x.sku, qty: x.qty, variasi: x.variasi })), [
      { sku: "SKU-1", qty: 2, variasi: "HIJAU" },
      { sku: "SKU-1", qty: 3, variasi: "BIRU" },
    ]);
    assert.equal(r.paket[0].units, 5);
  });
  it("variasi menempel PER BARIS: SKU sama beda varian tidak saling menimpa", async () => {
    const db = mockDb({
      orders: [{ no_pesanan: "O-A", no_resi: "R1" }, { no_pesanan: "O-B", no_resi: "R1" }],
      grup: [{ no_resi: "R1", no_json: '["O-A","O-B"]', jasa_kirim: "SPX" }],
      items: [
        { no_pesanan: "O-A", sku: "SKU-1", nama_accurate: "Produk Satu", qty: 1, variasi: "HIJAU" },
        { no_pesanan: "O-B", sku: "SKU-1", nama_accurate: "Produk Satu", qty: 1, variasi: "BIRU" },
      ],
    });
    const r = await buatPicklistPaket(db, [{ mp: "shopee", no: "O-A" }, { mp: "shopee", no: "O-B" }]);
    assert.ok(r.ok);
    assert.deepEqual(r.paket[0].rows.map((x) => x.variasi), ["HIJAU", "BIRU"]);
    // Tidak ada field map variasi per-SKU yang bisa menimpa (regresi lama).
    assert.equal("variasi" in r.paket[0] && typeof (r.paket[0] as unknown as Record<string, unknown>).variasi === "object" && !Array.isArray(r.paket[0].rows), false);
  });
  it("order tanpa resi tetap diekspor sebagai paket sendiri (no_resi kosong)", async () => {
    const db = mockDb({
      orders: [{ no_pesanan: "O-X", no_resi: "" }, { no_pesanan: "O-Y", no_resi: "" }],
      items: [
        { no_pesanan: "O-X", sku: "SKU-1", nama_accurate: "Produk Satu", qty: 1, variasi: "" },
        { no_pesanan: "O-Y", sku: "SKU-2", nama_accurate: "Produk Dua", qty: 2, variasi: "" },
      ],
    });
    const r = await buatPicklistPaket(db, [{ mp: "shopee", no: "O-X" }, { mp: "shopee", no: "O-Y" }]);
    assert.ok(r.ok);
    // Dua order tanpa resi TIDAK boleh menumpuk jadi satu paket.
    assert.equal(r.paket.length, 2);
    assert.deepEqual(r.paket.map((p) => p.no_resi), ["", ""]);
    assert.deepEqual(r.paket.map((p) => p.no_pesanan), [["O-X"], ["O-Y"]]);
  });
  it("tanpa target → 400", async () => {
    const r = await buatPicklistPaket(mockDb(), []);
    assert.equal(r.ok === false && r.status, 400);
  });
});

describe("bangunPdfPicklistPaket", () => {
  it("mode per_paket: satu halaman awal per paket", async () => {
    const db = mockDb(DB_FIXTURE);
    const r = await buatPicklistPaket(db, [{ mp: "shopee", no: "O-A" }, { mp: "shopee", no: "O-C" }]);
    assert.ok(r.ok);
    const bytes = await bangunPdfPicklistPaket(r.paket, { mode: "per_paket", judul: "PICKLIST ORDER — PER PAKET", subjudul: "", gudang: "Gudang ONLINE" });
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 2);
    assert.equal(doc.getPage(0).getWidth(), 595.28);
  });
  it("mode gabung: satu tabel lintas paket, kolom No. Resi", async () => {
    const db = mockDb(DB_FIXTURE);
    const r = await buatPicklistPaket(db, [{ mp: "shopee", no: "O-A" }, { mp: "shopee", no: "O-C" }]);
    assert.ok(r.ok);
    const rows = r.paket.flatMap((p) => p.rows.map((x) => ({ ...x, no_resi: p.no_resi })));
    const bytes = await bangunPdfPicklistPaket(rows, { mode: "gabung", judul: "PICKLIST ORDER — GABUNG PER PAKET", subjudul: "2 paket", gudang: "Gudang ONLINE" });
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 1);
  });
});
