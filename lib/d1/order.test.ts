import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ambilOrder, ambilOrderBanyak, imporPesanan, listOrder, transisiFulfill, transisiFulfillBatch, type BarisPesanan } from "./order";
import type { Hasil } from "./hasil";

type Row = Record<string, unknown>;
const kunciOrder = (mp: string, no: string) => `${mp}|${no}`;

/**
 * Jalur `all()` daftar order, dipakai BARENGAN oleh `all()` dan `first()` (COUNT).
 *
 * Satu implementasi untuk keduanya disengaja: produksi memakai WHERE yang sama untuk daftar
 * dan COUNT, jadi mock yang menghitungnya dengan dua potongan kode terpisah bisa "lolos" uji
 * walau produksinya menghitung himpunan yang berbeda — persis bug yang ingin dicegah.
 */
function barisOrder(st: { _sql: string; _args: unknown[] }, orders: Record<string, Row>, items: Record<string, Row>) {
  const sql = st._sql;
  const a = st._args;
  let r = Object.values(orders);
  let i = 0;
  if (sql.includes("marketplace = ?")) { const v = a[i++]; r = r.filter((x) => x["marketplace"] === v); }
  if (sql.includes("status_fulfill = ?")) { const v = a[i++]; r = r.filter((x) => x["status_fulfill"] === v); }
  if (sql.includes("tanggal >= ?")) { const v = Number(a[i++]); r = r.filter((x) => Number(x["tanggal"]) >= v); }
  if (sql.includes("tanggal <= ?")) { const v = Number(a[i++]); r = r.filter((x) => Number(x["tanggal"]) <= v); }
  if (sql.includes("EXISTS (SELECT 1 FROM order_items")) {
    const sku = String(a[i++]);
    r = r.filter((x) => Object.values(items).some((it) => it["marketplace"] === x["marketplace"] && it["no_pesanan"] === x["no_pesanan"] && it["sku"] === sku));
  }
  // Tiebreaker produksi: (marketplace ASC, no_pesanan ASC) setelah kolom utama, apa pun
  // kolom utamanya. Mock menerapkan tiebreaker itu supaya uji "halaman tidak tumpang tindih"
  // benar-benar menguji jaminan yang sama dengan SQL.
  const kolom = /ORDER BY (\w+)/.exec(sql)?.[1] ?? "tanggal";
  const naik = /ORDER BY \w+ ASC/.test(sql);
  const kunci = kolom === "tanggal" ? (x: Row) => Number(x["tanggal"]) : (x: Row) => String(x[kolom] ?? "");
  r.sort((x, y) => {
    const c = typeof kunci(x) === "number" ? Number(kunci(y)) - Number(kunci(x)) : String(kunci(x)).localeCompare(String(kunci(y)));
    return (naik ? c : -c) || kunciOrder(String(x["marketplace"]), String(x["no_pesanan"])).localeCompare(kunciOrder(String(y["marketplace"]), String(y["no_pesanan"])));
  });
  return r;
}

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
          if (sql.includes("SELECT COUNT(*) AS total FROM orders")) {
            return { total: barisOrder(st, orders, items).length };
          }
          if (sql.startsWith("SELECT marketplace, no_pesanan, tanggal, buyer, no_resi,")) {
            // Pencocokan sengaja hanya pada AWAL daftar kolom, bukan seluruh daftar. Kolom
            // baru (mis. jasa_kirim/tipe_layanan) menambah isi SELECT tanpa mengubah maksud
            // query; mencocokkan seluruh daftar membuat uji ini pecah setiap kali ada kolom
            // baru, padahal produksinya benar.
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
          if (sql.startsWith("DELETE FROM order_items")) {
            let n = 0;
            for (const k of Object.keys(items)) {
              if (items[k]["marketplace"] === a[0] && items[k]["no_pesanan"] === a[1]) {
                delete items[k];
                n++;
              }
            }
            return { meta: { changes: n } };
          }
          if (sql.startsWith("DELETE FROM orders")) {
            const k = kunciOrder(String(a[0]), String(a[1]));
            const ada = Boolean(orders[k]);
            delete orders[k];
            return { meta: { changes: ada ? 1 : 0 } };
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
          if (sql.includes("FROM orders WHERE (marketplace = ? AND no_pesanan = ?)")) {
            const pasangan: string[] = [];
            for (let i = 0; i + 1 < a.length; i += 2) pasangan.push(kunciOrder(String(a[i]), String(a[i + 1])));
            return { results: Object.values(orders).filter((x) => pasangan.includes(kunciOrder(String(x["marketplace"]), String(x["no_pesanan"])))) };
          }
          if (sql.includes("FROM order_items WHERE") && sql.includes("OR (marketplace")) {
            // Jalur berkelompok (ambilOrderBanyak): pasangan (mp, no) di-OR, bukan dua argumen tunggal.
            const pasangan: string[] = [];
            for (let i = 0; i + 1 < a.length; i += 2) pasangan.push(kunciOrder(String(a[i]), String(a[i + 1])));
            return { results: Object.values(items).filter((x) => pasangan.includes(kunciOrder(String(x["marketplace"]), String(x["no_pesanan"])))) };
          }
          if (sql.includes("FROM order_fees WHERE") && sql.includes("OR (marketplace")) {
            const pasangan: string[] = [];
            for (let i = 0; i + 1 < a.length; i += 2) pasangan.push(kunciOrder(String(a[i]), String(a[i + 1])));
            return { results: fees.filter((x) => pasangan.includes(kunciOrder(String(x["marketplace"]), String(x["no_pesanan"])))) };
          }
          if (sql.includes("SELECT COUNT(*) AS total FROM orders")) {
            let r = Object.values(orders);
            let i = 0;
            if (sql.includes("marketplace = ?")) { const v = a[i++]; r = r.filter((x) => x["marketplace"] === v); }
            if (sql.includes("status_fulfill = ?")) { const v = a[i++]; r = r.filter((x) => x["status_fulfill"] === v); }
            if (sql.includes("tanggal >= ?")) { const v = Number(a[i++]); r = r.filter((x) => Number(x["tanggal"]) >= v); }
            if (sql.includes("tanggal <= ?")) { const v = Number(a[i++]); r = r.filter((x) => Number(x["tanggal"]) <= v); }
            if (sql.includes("EXISTS (SELECT 1 FROM order_items")) {
              const sku = String(a[i++]);
              r = r.filter((x) => Object.values(items).some((it) => it["marketplace"] === x["marketplace"] && it["no_pesanan"] === x["no_pesanan"] && it["sku"] === sku));
            }
            return { results: [{ total: r.length }] };
          }
          if (sql.includes("FROM orders") && sql.includes("ORDER BY")) {
            const r = barisOrder(st, orders, items);
            const limit = Number(a[a.length - 2]);
            const offset = Number(a[a.length - 1]);
            return { results: r.slice(offset, offset + limit) };
          }
          return { results: [] };
        },
      };
      return st;
    },
    async batch(stmts: { _sql: string; _args: unknown[] }[]) {
      // D1 asli mengembalikan hasil per statement (termasuk meta.changes). Mock dulu
      // mengembalikan [] sehingga kode yang membaca meta.changes terlihat "lolos"
      // padahal selalu 0 — itu menyembunyikan bug, jadi sekarang hasilnya diteruskan.
      const hasil: { meta: { changes?: number } }[] = [];
      for (const s of stmts) hasil.push(await this.prepare(s._sql).bind(...s._args).run());
      return hasil;
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

describe("transisiFulfill", () => {
  // Aturan 2026-10-14: WMS TIDAK memotong stok. Kledo yang memotong, dan sinkron Kledo
  // menimpa penuh stock_by_bin gudang non-ONLINE. Kalau WMS ikut memotong, saat sync
  // berikutnya potongan itu dianggap selisih lalu dibalik — stok jadi kacau bolak-balik.
  it("pack hanya ubah status — stok dan ledger TIDAK disentuh", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("SHP-1", 3)], null);
    const r = await transisiFulfill(db, "shopee", "SHP-1", "pack", "owner1");
    assert.equal(r.ok, true);
    assert.equal(db.data.bins["A|ONLINE"], 10);
    assert.equal(db.data.moves.length, 0);
    assert.equal(db.data.orders[kunciOrder("shopee", "SHP-1")]["status_fulfill"], "pack");
    // stok_dikurangi tetap 0: kolom itu menandai era WMS-potong, bukan transisi ini.
    assert.equal(db.data.orders[kunciOrder("shopee", "SHP-1")]["stok_dikurangi"], 0);
  });

  it("batal TIDAK mengembalikan stok (tidak ada retur_mp)", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("SHP-3", 3)], null);
    await transisiFulfill(db, "shopee", "SHP-3", "pack", null);
    const r = await transisiFulfill(db, "shopee", "SHP-3", "batal", null);
    assert.equal(r.ok, true);
    assert.equal(db.data.bins["A|ONLINE"], 10);
    assert.equal(db.data.moves.filter((m) => m["jenis"] === "retur_mp").length, 0);
  });

  it("pending→kirim langsung → 409; order tak ada → 404", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("SHP-4", 1)], null);
    assert.equal(statusGagal(await transisiFulfill(db, "shopee", "SHP-4", "kirim", null)), 409);
    assert.equal(statusGagal(await transisiFulfill(db, "shopee", "TAK-ADA", "pack", null)), 404);
  });
});

describe("transisiFulfillBatch", () => {
  it("qty besar tetap lolos walau stok ONLINE kurang", async () => {
    // 99 unit padahal stok 10: dulu ditolak 400 oleh gerbang stok. Gerbang itu dihapus
    // justru karena stok ONLINE bukan lagi sumber kebenaran.
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("B-3", 99)], null);
    const r = await transisiFulfillBatch(db, [{ mp: "shopee", no: "B-3", ke: "pack" }], null);
    assert.equal(r.ok, true);
    assert.equal(db.data.bins["A|ONLINE"], 10);
    assert.equal(db.data.moves.length, 0);
    assert.equal(db.data.orders[kunciOrder("shopee", "B-3")]["status_fulfill"], "pack");
  });

  it("satu transisi tidak sah → TIDAK ada order yang berubah", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("B-3", 4), barisA("B-4", 1)], null);
    // B-4 masih pending, jadi kirim tidak sah; B-3 sah. Preflight harus menahan keduanya.
    const r = await transisiFulfillBatch(db, [{ mp: "shopee", no: "B-3", ke: "pack" }, { mp: "shopee", no: "B-4", ke: "kirim" }], null);
    assert.equal(statusGagal(r), 409);
    assert.equal(db.data.orders[kunciOrder("shopee", "B-3")]["status_fulfill"], "pending");
    assert.equal(db.data.orders[kunciOrder("shopee", "B-4")]["status_fulfill"], "pending");
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
  });
});

describe("hapus order (koreksi salah impor)", () => {
  /** Meniru aksi `hapus` di app/api/order/route.ts: anak dulu, lalu header. */
  async function hapus(db: D1Database, targets: { mp: string; no: string }[]): Promise<number> {
    let dihapus = 0;
    const stmts: D1PreparedStatement[] = [];
    for (const t of targets) {
      stmts.push(db.prepare("DELETE FROM order_items WHERE marketplace = ? AND no_pesanan = ?").bind(t.mp, t.no));
      stmts.push(db.prepare("DELETE FROM order_fees WHERE marketplace = ? AND no_pesanan = ?").bind(t.mp, t.no));
      stmts.push(db.prepare("DELETE FROM orders WHERE marketplace = ? AND no_pesanan = ?").bind(t.mp, t.no));
    }
    const hasil = await db.batch(stmts);
    for (let j = 2; j < hasil.length; j += 3) dihapus += hasil[j].meta.changes ?? 0;
    return dihapus;
  }

  it("hapus order menghilangkan header + item, order lain utuh", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("D-1", 2), barisA("D-2", 3)], null);
    assert.equal((await listOrder(db, {})).orders.length, 2);
    const n = await hapus(db, [{ mp: "shopee", no: "D-1" }]);
    assert.equal(n, 1);
    const sisa = (await listOrder(db, {})).orders;
    assert.equal(sisa.length, 1);
    assert.equal(sisa[0]?.no_pesanan, "D-2");
    const d2 = await ambilOrder(db, "shopee", "D-2");
    assert.equal(d2?.items.length, 1, "item order lain tidak boleh ikut terhapus");
    assert.equal(d2?.items[0]?.qty, 3);
  });

  it("hapus order tanpa item tidak melempar error", async () => {
    const db = buatDbOrder();
    assert.equal(await hapus(db, [{ mp: "shopee", no: "TAK-ADA" }]), 0);
  });

  it("hapus TIDAK menyentuh stok maupun ledger", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("D-3", 1)], null);
    const binSebelum = db.data.bins["A|ONLINE"];
    const movesSebelum = db.data.moves.length;
    await hapus(db, [{ mp: "shopee", no: "D-3" }]);
    assert.equal(db.data.bins["A|ONLINE"], binSebelum);
    assert.equal(db.data.moves.length, movesSebelum);
  });
});

describe("imporPesanan", () => {
  it("2 order: snapshot hpp beku, tanpa fee", async () => {
    const db = buatDbOrder();
    const r = await imporPesanan(db, [
      { marketplace: "shopee", no_pesanan: "O-1", tanggal: 1728288000, buyer: "Budi", sku: "A", qty: 2, harga_satuan: 100000 },
      { marketplace: "tokopedia", no_pesanan: "O-2", tanggal: 1728288000, buyer: "Sari", sku: "A", qty: 1, harga_satuan: 50000 },
    ], null);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.order, 2);
      assert.equal(r.item, 2);
    }
    const o1 = await ambilOrder(db, "shopee", "O-1");
    assert.ok(o1);
    assert.equal(o1?.items[0]?.hpp_snapshot, 60000);
    assert.equal(o1?.fees.length, 0);
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
    assert.equal((await listOrder(db, {})).orders.length, 1);
  });
});

describe("ambilOrder + listOrder", () => {
  it("null bila tak ada; filter mp", async () => {
    const db = buatDbOrder();
    assert.equal(await ambilOrder(db, "shopee", "NOPE"), null);
    await imporPesanan(db, [barisA("L-1", 1), { ...barisA("L-2", 1), marketplace: "tiktok" }], null);
    assert.equal((await listOrder(db, {})).orders.length, 2);
    assert.equal((await listOrder(db, { mp: "shopee" })).orders.length, 1);
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
    assert.equal((await listOrder(db, { status: "pack" })).orders.length, 1);
    assert.equal((await listOrder(db, { dari: 1730000000 })).orders.length, 1);
    assert.equal((await listOrder(db, { sampai: 1729000000 })).orders.length, 1);
  });
});

describe("paginasi + tiebreaker + urutan", () => {
  /** 7 order dengan TANGGAL IDENTIK — persis pola satu batch impor. */
  const batch = (n: number): BarisPesanan[] =>
    Array.from({ length: n }, (_, i) => ({ ...barisA(`P-${String(i + 1).padStart(2, "0")}`, 1), tanggal: 1728288000 }));

  it("tanggal identik tetap punya urutan TOTAL — halaman tidak tumpang tindih", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, batch(7), null);
    const h1 = await listOrder(db, { limit: 3, offset: 0 });
    const h2 = await listOrder(db, { limit: 3, offset: 3 });
    const h3 = await listOrder(db, { limit: 3, offset: 6 });
    const semua = [...h1.orders, ...h2.orders, ...h3.orders].map((o) => o.no_pesanan);
    assert.equal(semua.length, 7, "7 baris terkumpul dari 3 halaman");
    assert.equal(new Set(semua).size, 7, "TIDAK ada baris yang muncul dua kali antar halaman");
    assert.deepEqual(semua, [...semua].sort(), "tiebreaker ASC membuat urutan dapat diulang");
  });

  it("total dihitung dari WHERE yang sama, bukan dari isi halaman", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, batch(7), null);
    const h = await listOrder(db, { limit: 2 });
    assert.equal(h.orders.length, 2, "satu halaman dibatasi");
    assert.equal(h.total, 7, "total tetap seluruh himpunan");
  });

  it("urut=no_pesanan&arah=asc mengubah urutan tanpa menyentuh SQL", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, batch(3), null);
    const r = await listOrder(db, { kolomUrut: "no_pesanan", arah: "asc" });
    assert.deepEqual(r.orders.map((o) => o.no_pesanan), ["P-01", "P-02", "P-03"]);
  });
});

describe("ambilOrderBanyak", () => {
  it("mengembalikan header+item+fee seluruh order dalam SATU panggilan", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("B-1", 2), barisA("B-2", 3), barisA("B-3", 1)], null);
    const hasil = await ambilOrderBanyak(db, [
      { mp: "shopee", no: "B-1" }, { mp: "shopee", no: "B-2" }, { mp: "shopee", no: "B-3" },
    ]);
    assert.equal(hasil.length, 3, "semua order diminta ikut kembali");
    assert.equal(hasil[1]?.no_pesanan, "B-2", "urutan keluaran = urutan permintaan");
    assert.equal(hasil[1]?.items[0]?.qty, 3, "item terpasang ke order yang benar");
    assert.deepEqual(hasil[0]?.fees.length, 0, "fee kosong tetap array, bukan undefined");
    assert.equal(hasil[1]?.status_fulfill, "pending", "header ikut terbaca");
  });

  it("order yang diminta dua kali tidak digandakan", async () => {
    const db = buatDbOrder();
    await imporPesanan(db, [barisA("B-9", 1)], null);
    const hasil = await ambilOrderBanyak(db, [{ mp: "shopee", no: "B-9" }, { mp: "shopee", no: "B-9" }]);
    assert.equal(hasil.length, 1);
  });
});
