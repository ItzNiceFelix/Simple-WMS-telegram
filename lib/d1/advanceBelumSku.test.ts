// lib/d1/advanceBelumSku.test.ts — Fase C+D: booking advance, tebak SKU, sku_belum_mp, compare nama, PDF advance.
// Mock D1 minimal: hanya mendukung SQL yang dipakai modul ini (pola d1.library.test.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { normalisasiKata, skorMirip, normalisasiLonggar, tebakSku, simpanBooking, listBooking, kirimKeShopee, batalkanBooking, tandaiBelumMp, listBelumMp, hapusBelumMp, compareNama } from "./advanceBelumSku";
import { bangunPdfAdvance } from "./advancePdf";

type Baris = Record<string, unknown>;

/** Mock D1: table-aware, mendukung pola query modul ini. */
function mockDb(init: { products?: Baris[]; keywords?: Baris[]; mp?: Baris[]; advance?: Baris[]; belum?: Baris[]; stock?: Baris[]; moves?: Baris[] } = {}) {
  const db = {
    products: init.products ?? [],
    keywords: init.keywords ?? [],
    mp: init.mp ?? [],
    advance: init.advance ?? [],
    belum: init.belum ?? [],
    stock: init.stock ?? [],
    moves: init.moves ?? [],
    lastSql: "",
  };
  const norm = (s: unknown): string => (s == null ? "" : String(s));
  const strip = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  db.prepare = (sql: string) => {
    db.lastSql = sql;
    const stmt = {
      _args: [] as unknown[],
      bind(...args: unknown[]) {
        this._args = args;
        return this;
      },
      async all<T>() {
        const a = stmt._args;
        if (sql.includes("FROM products WHERE nama_accurate_normalized")) {
          return { results: db.products.filter((p) => norm(p.nama_accurate_normalized) === norm(a[0])).map((p) => ({ sku: p.sku, nama: p.nama_accurate })) };
        }
        if (sql.includes("UPPER(REPLACE(REPLACE(nama_accurate_normalized")) {
          return { results: db.products.filter((p) => strip(norm(p.nama_accurate_normalized)) === norm(a[0])).map((p) => ({ sku: p.sku, nama: p.nama_accurate })) };
        }
        if (sql.includes("FROM product_search_keywords")) {
          const keys = db.keywords.filter((k) => norm(k.keyword) === norm(a[0])).map((k) => norm(k.sku));
          return { results: db.products.filter((p) => keys.includes(norm(p.sku))).map((p) => ({ sku: p.sku, nama: p.nama_accurate })) };
        }
        if (sql.includes("FROM mp_products")) {
          return { results: db.mp.filter((m) => strip(norm(m.nama_mp)) === norm(a[0])).map((m) => ({ sku: m.sku, nama: m.nama_mp })) };
        }
        if (sql.includes("FROM products WHERE sku IN")) {
          const set = new Set(a.map(norm));
          return { results: db.products.filter((p) => set.has(norm(p.sku))).map((p) => ({ sku: p.sku, nama_accurate: p.nama_accurate })) };
        }
        if (sql.includes("FROM advance_bookings")) {
          const status = sql.includes("WHERE status = ?") ? norm(a[0]) : "";
          const rows = db.advance.filter((b) => !status || norm(b.status) === status);
          return { results: rows.slice(0, Number(a[a.length - 1]) || 100) };
        }
        if (sql.includes("FROM sku_belum_mp")) return { results: db.belum };
        return { results: [] as T[] };
      },
      async first<T>() {
        const a = stmt._args;
        if (sql.includes("FROM advance_bookings WHERE booking_sn")) {
          return (db.advance.find((b) => norm(b.booking_sn) === norm(a[0])) as T) ?? null;
        }
        if (sql.includes("FROM stock_by_bin")) {
          const r = db.stock.find((s) => norm(s.sku) === norm(a[0]));
          return (r ? { qty: r.qty } : null) as T | null;
        }
        if (sql.includes("FROM products WHERE sku = ?")) {
          return (db.products.find((p) => norm(p.sku) === norm(a[0])) as T) ?? null;
        }
        return null;
      },
      async run() {
        const a = stmt._args;
        if (sql.startsWith("INSERT OR IGNORE INTO advance_bookings")) {
          // Kolom: ..., qty=1, status='menunggu', batch_import=?, at=? → arg 9 & 10.
          if (db.advance.some((b) => norm(b.booking_sn) === norm(a[0]))) return { meta: { changes: 0 } };
          db.advance.push({ booking_sn: a[0], no_resi: a[1], sku: a[2], variasi: a[3], nama_produk: a[4], opsi_kirim: a[5], antar_ke: a[6], booking_at: a[7], batas_kirim: a[8], qty: 1, status: "menunggu", batch_import: a[9], dikirim_at: null, dikirim_oleh: null, at: a[10] });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE advance_bookings SET status = 'batal'")) {
          // SQL: ... dikirim_at = ?, dikirim_oleh = ?, WHERE booking_sn = ? AND status = 'menunggu'
          let n = 0;
          for (const b of db.advance) if (norm(b.booking_sn) === norm(a[2]) && norm(b.status) === "menunggu") { b.status = "batal"; n++; }
          return { meta: { changes: n } };
        }
        if (sql.startsWith("UPDATE advance_bookings SET status = 'terkirim'")) {
          let n = 0;
          for (const b of db.advance) if (norm(b.booking_sn) === norm(a[2]) && norm(b.status) === "menunggu") { b.status = "terkirim"; b.dikirim_at = a[0]; b.dikirim_oleh = a[1]; n++; }
          return { meta: { changes: n } };
        }
        if (sql.startsWith("INSERT INTO stock_by_bin")) {
          // (sku, 'ONLINE', qty) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty
          const s = db.stock.find((x) => norm(x.sku) === norm(a[0]));
          if (s) s.qty = a[1];
          else db.stock.push({ sku: a[0], warehouse_id: "ONLINE", qty: a[1] });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE stock_by_bin")) {
          const s = db.stock.find((x) => norm(x.sku) === norm(a[1]));
          if (s) s.qty = a[0];
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO stock_moves")) {
          // SQL punya 8 placeholder: sku, qty, qty_sistem, qty_fisik, selisih, created_by, at, by
          // (jenis/gudang/action_type/source/status konstanta di SQL).
          db.moves.push({ sku: a[0], qty: a[1], jenis: "kirim_advance", gudang_id: "ONLINE", qty_sistem: a[2], qty_fisik: a[3], selisih: a[4] });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO sku_belum_mp")) {
          const ada = db.belum.find((b) => norm(b.nama_shopee) === norm(a[0]) && norm(b.variasi) === norm(a[1]));
          if (ada) Object.assign(ada, { order_ref: a[2], sejak: a[3], at: a[4], by: a[5] });
          else db.belum.push({ nama_shopee: a[0], variasi: a[1], order_ref: a[2], sejak: a[3], at: a[4], by: a[5] });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM sku_belum_mp")) {
          const i = db.belum.findIndex((b) => norm(b.nama_shopee) === norm(a[0]) && norm(b.variasi) === norm(a[1]));
          if (i < 0) return { meta: { changes: 0 } };
          db.belum.splice(i, 1);
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  db.batch = async (list: { run: () => Promise<unknown> }[]) => Promise.all(list.map((s) => s.run()));
  return db as unknown as D1Database & typeof db;
}

describe("normalisasi & skor", () => {
  it("normalisasi ketat: uppercase, buang simbol/hubung, rapatkan spasi", () => {
    assert.equal(normalisasiKata("Kaos Polos - Hitam (L)"), "KAOS POLOS HITAM L");
    assert.equal(normalisasiKata("  J&T   Express "), "J T EXPRESS");
  });
  it("skorMirip: persis 1, token overlap di antara 0..1", () => {
    assert.equal(skorMirip("KAOS POLOS HITAM", "KAOS POLOS HITAM"), 1);
    assert.equal(skorMirip("KAOS POLOS HITAM", "KAOS POLOS PUTIH"), 0.5);
    assert.equal(skorMirip("AAA", "BBB"), 0);
  });
  it("normalisasiLonggar: lowercase, simbol jadi spasi", () => {
    assert.equal(normalisasiLonggar("Kaos-Polos  HITAM!"), "kaos polos hitam");
  });
});

describe("tebakSku", () => {
  it("auto-isi HANYA bila cocok persis setelah normalisasi", async () => {
    const db = mockDb({ products: [{ sku: "A1", nama_accurate: "Kaos Polos Hitam", nama_accurate_normalized: "KAOS POLOS HITAM" }] });
    const r = await tebakSku(db, "kaos-polos hitam", "");
    assert.equal(r.sku, "A1");
    assert.equal(r.perlu_pilih_manual, false);
  });
  it("mirip tapi TIDAK persis → perlu_pilih_manual, kandidat + skor < 1", async () => {
    // Query persis hanya menemukan baris ber-keyword sama; keyword cocok, nama produk beda
    // → kandidat muncul tapi skor < 1 sehingga TIDAK auto-isi.
    const db = mockDb({
      products: [{ sku: "A1", nama_accurate: "Kaos Polos Hitam Premium Edition", nama_accurate_normalized: "KAOS POLOS HITAM PREMIUM EDITION" }],
      keywords: [{ sku: "A1", keyword: "KAOS POLOS HITAM" }],
    });
    const r = await tebakSku(db, "Kaos Polos Hitam", "");
    assert.equal(r.sku, "");
    assert.equal(r.perlu_pilih_manual, true);
    assert.equal(r.kandidat.length, 1);
    assert.equal(r.kandidat[0].sku, "A1");
    assert.ok(r.kandidat[0].skor > 0 && r.kandidat[0].skor < 1);
  });
  it("keyword & mp_products jadi sumber kandidat", async () => {
    const db = mockDb({
      products: [{ sku: "B2", nama_accurate: "Sepatu Lari", nama_accurate_normalized: "SEPATU LARI" }],
      keywords: [{ sku: "B2", keyword: "SEPATU LARI" }],
      mp: [{ sku: "B2", nama_mp: "Sepatu Lari" }],
    });
    const r = await tebakSku(db, "Sepatu Lari", "");
    assert.equal(r.sku, "B2");
    assert.equal(r.perlu_pilih_manual, false);
  });
  it("nama + variasi digabung sebelum dinormalisasi", async () => {
    const db = mockDb({ products: [{ sku: "C3", nama_accurate: "Kaos Hitam L", nama_accurate_normalized: "KAOS HITAM L" }] });
    const r = await tebakSku(db, "Kaos Hitam", "L");
    assert.equal(r.sku, "C3");
  });
});

describe("advance bookings", () => {
  const booking = { booking_sn: "BS-1", no_resi: "R-1", sku: "A1", variasi: "", nama_produk: "Kaos", opsi_kirim: "SPX", antar_ke: "Counter", booking_at: "2026-10-11", batas_kirim: "2026-10-12" };
  it("simpanBooking idempoten (INSERT OR IGNORE)", async () => {
    const db = mockDb();
    assert.equal(await simpanBooking(db, [booking], 7), 1);
    assert.equal(await simpanBooking(db, [booking], 7), 0);
    assert.equal(db.advance.length, 1);
    assert.equal(db.advance[0].batch_import, 7);
  });
  it("listBooking filter status", async () => {
    const db = mockDb({ advance: [{ booking_sn: "BS-1", sku: "A1", qty: 1, status: "menunggu", at: 1 }, { booking_sn: "BS-2", sku: "A2", qty: 1, status: "terkirim", at: 2 }] });
    assert.equal((await listBooking(db)).length, 2);
    assert.equal((await listBooking(db, { status: "menunggu" })).length, 1);
  });
  it("kirimKeShopee: stok ONLINE turun + ledger kirim_advance + status terkirim", async () => {
    const db = mockDb({ advance: [{ booking_sn: "BS-1", sku: "A1", qty: 1, status: "menunggu", at: 1 }], stock: [{ sku: "A1", qty: 5 }] });
    const r = await kirimKeShopee(db, "BS-1", "77");
    assert.ok(r.ok);
    assert.equal(db.stock[0].qty, 4);
    assert.equal(db.moves[0].jenis, "kirim_advance");
    assert.equal(db.moves[0].qty, -1);
    assert.equal(db.advance[0].status, "terkirim");
    // Konvensi ledger WAJIB sama dengan tulisQty: qty_sistem = SEBELUM, qty_fisik = SESUDAH, selisih = sesudah − sebelum.
    assert.equal(db.moves[0].qty_sistem, 5);
    assert.equal(db.moves[0].qty_fisik, 4);
    assert.equal(db.moves[0].selisih, -1);
    assert.equal(r.ok === true && r.stok_negatif, false);
    assert.equal(r.ok === true && r.stok_akhir, 4);
  });
  it("kirimKeShopee izinkan stok negatif TAPI beri sinyal stok_negatif (keputusan I1: stok negatif = fitur)", async () => {
    const db = mockDb({ advance: [{ booking_sn: "BS-1", sku: "A1", qty: 1, status: "menunggu", at: 1 }], stock: [{ sku: "A1", qty: 0 }] });
    const r = await kirimKeShopee(db, "BS-1", "77");
    assert.ok(r.ok, "kirim advance TIDAK diblokir walau stok kurang — booking sudah dibukukan di Shopee");
    assert.equal(db.stock[0].qty, -1);
    assert.equal(r.ok === true && r.stok_negatif, true);
    assert.equal(r.ok === true && r.stok_akhir, -1);
    assert.equal(db.moves[0].qty_sistem, 0);
    assert.equal(db.moves[0].qty_fisik, -1);
    assert.equal(db.moves[0].selisih, -1);
  });
  it("kirimKeShopee SKU tanpa baris stock_by_bin → baris dibuat, tetap sinyal negatif", async () => {
    const db = mockDb({ advance: [{ booking_sn: "BS-1", sku: "A1", qty: 1, status: "menunggu", at: 1 }] });
    const r = await kirimKeShopee(db, "BS-1", "77");
    assert.ok(r.ok);
    assert.equal(db.stock[0].qty, -1);
    assert.equal(r.ok === true && r.stok_negatif, true);
  });
  it("kirimKeShopee tolak 409 bila sudah terkirim/batal", async () => {
    const db = mockDb({ advance: [{ booking_sn: "BS-1", sku: "A1", qty: 1, status: "terkirim", at: 1 }], stock: [{ sku: "A1", qty: 5 }] });
    const r = await kirimKeShopee(db, "BS-1", "77");
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 409);
    assert.equal(db.stock[0].qty, 5);
  });
  it("kirimKeShopee 404 bila booking tak ada", async () => {
    const r = await kirimKeShopee(mockDb(), "X", null);
    assert.equal(r.ok === false && r.status, 404);
  });
  it("batalkanBooking hanya dari menunggu", async () => {
    const db = mockDb({ advance: [{ booking_sn: "BS-1", sku: "A1", qty: 1, status: "menunggu", at: 1 }] });
    assert.ok((await batalkanBooking(db, "BS-1", "77")).ok);
    assert.equal(db.advance[0].status, "batal");
    assert.equal((await batalkanBooking(db, "BS-1", "77")).ok, false);
  });
});

describe("sku_belum_mp", () => {
  it("upsert PK nama+variasi + hapus", async () => {
    const db = mockDb();
    await tandaiBelumMp(db, { namaShopee: "Kaos X", variasi: "L", orderRef: "O-1", oleh: "77" });
    await tandaiBelumMp(db, { namaShopee: "Kaos X", variasi: "L", orderRef: "O-2", oleh: "77" });
    assert.equal(db.belum.length, 1);
    assert.equal(db.belum[0].order_ref, "O-2");
    assert.equal((await listBelumMp(db)).length, 1);
    assert.equal(await hapusBelumMp(db, "Kaos X", "L"), 1);
    assert.equal(await hapusBelumMp(db, "Kaos X", "L"), 0);
  });
});

describe("compareNama", () => {
  it("tandai beda setelah normalisasi longgar, urut beda dulu", async () => {
    const db = mockDb({ products: [{ sku: "A1", nama_accurate: "Kaos Polos Hitam" }, { sku: "A2", nama_accurate: "Sepatu Lari" }] });
    const r = await compareNama(db, [
      { sku: "A1", nama_shopee: "Kaos-Polos  HITAM" },
      { sku: "A2", nama_shopee: "Sendal Jepit" },
    ]);
    assert.equal(r.length, 2);
    assert.equal(r[0].sku, "A2");
    assert.equal(r[0].sama, false);
    assert.equal(r[1].sama, true);
  });
  it("SKU tanpa master dilewati (tidak memblokir)", async () => {
    const r = await compareNama(mockDb(), [{ sku: "ZZ", nama_shopee: "Apa Saja" }]);
    assert.equal(r.length, 0);
  });
});

describe("advancePdf", () => {
  it("menghasilkan PDF A4 halaman cukup + header 'PICKLIST ADVANCE'", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ booking_sn: `BS-${i}`, sku: `SKU-${i}`, nama: "Produk Uji", variasi: "", qty: 1, lokasi: "A1" }));
    const bytes = await bangunPdfAdvance(rows, { gudang: "Gudang ONLINE", batchImport: 12 });
    assert.ok(bytes.length > 1000);
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 3);
    assert.equal(doc.getPage(0).getWidth(), 595.28);
  });
});
