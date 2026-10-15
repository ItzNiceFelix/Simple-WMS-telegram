// Uji potong stok gudang ONLINE saat picklist dicetak.
//
// Yang dijaga di sini bukan sekadar "berhasil memotong", tapi tiga hal yang mahal kalau
// salah: (1) cetak ulang TIDAK memotong dua kali, (2) stok tidak boleh jadi negatif,
// (3) barang yang kurang tetap tercatat utuh supaya dialog permintaan tidak berbohong.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ambilSkuOnline, potongOnlineUntukOrder } from "./stokOnline";

type Row = Record<string, unknown>;
const kunci = (mp: string, no: string) => `${mp}|${no}`;

type DataUji = {
  produk: Record<string, Row>;
  bins: Record<string, number>;
  moves: Row[];
  orders: Record<string, Row>;
  items: Row[];
};

type DbUji = {
  data: DataUji;
  prepare(sql: string): unknown;
  batch(sts: { _sql: string; _args: unknown[] }[]): Promise<unknown[]>;
};

function buatDb(): DbUji {
  const produk: Record<string, Row> = {};
  const bins: Record<string, number> = {};
  const moves: Row[] = [];
  const orders: Record<string, Row> = {};
  const items: Row[] = [];

  function cocokPasangan(a: unknown[]) {
    // Pola "(marketplace = ? AND no_pesanan = ?) OR (...)" — argumen berpasangan.
    const pasangan: [string, string][] = [];
    for (let i = 0; i < a.length; i += 2) pasangan.push([String(a[i]), String(a[i + 1])]);
    return pasangan;
  }

  const db = {
    data: { produk, bins, moves, orders, items },
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...a: unknown[]) { st._args = a; return st; },
        async first<T>(): Promise<T | null> {
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          const a = st._args;
          if (sql.includes("is_online_product = 1 AND sku IN")) {
            const set = new Set(a.map(String));
            return { results: Object.values(produk).filter((p) => p["is_online_product"] === 1 && set.has(String(p["sku"]))) as T[] };
          }
          if (sql.includes("FROM orders WHERE") && sql.includes("stok_dikurangi = 0")) {
            const pasangan = cocokPasangan(a);
            const out = pasangan
              .map(([mp, no]) => orders[kunci(mp, no)])
              .filter((o) => o && o["stok_dikurangi"] === 0)
              .map((o) => ({ marketplace: o!["marketplace"], no_pesanan: o!["no_pesanan"] }));
            return { results: out as T[] };
          }
          if (sql.includes("SELECT sku, SUM(qty) AS qty FROM order_items")) {
            const pasangan = cocokPasangan(a);
            const tot = new Map<string, number>();
            for (const it of items) {
              if (pasangan.some(([mp, no]) => mp === it["marketplace"] && no === it["no_pesanan"])) {
                tot.set(String(it["sku"]), (tot.get(String(it["sku"])) ?? 0) + Number(it["qty"]));
              }
            }
            return { results: [...tot].map(([sku, qty]) => ({ sku, qty })) as T[] };
          }
          if (sql.includes("SELECT sku, qty FROM stock_by_bin")) {
            const set = new Set(a.slice(1).map(String));
            return { results: [...set].filter((s) => bins[`${s}|ONLINE`] !== undefined).map((s) => ({ sku: s, qty: bins[`${s}|ONLINE`] })) as T[] };
          }
          if (sql.includes("SELECT sku, nama_accurate FROM products")) {
            const set = new Set(a.map(String));
            return { results: [...set].filter((s) => produk[s]).map((s) => ({ sku: s, nama_accurate: produk[s]!["nama_accurate"] })) as T[] };
          }
          return { results: [] as T[] };
        },
        async run() { return { meta: {} }; },
      };
      return st;
    },
    async batch(sts: { _sql: string; _args: unknown[] }[]) {
      for (const s of sts) {
        const a = s._args;
        if (s._sql.startsWith("UPDATE stock_by_bin SET qty")) {
          bins[`${a[1]}|${a[2]}`] = Number(a[0]);
        } else if (s._sql.startsWith("INSERT INTO stock_moves")) {
          // jenis & source berupa literal di SQL, jadi args = [sku, qty, gudang_id, oleh, at, oleh].
          moves.push({ sku: a[0], qty: a[1], gudang_id: a[2], action_type: "picklist_online" });
        } else if (s._sql.startsWith("UPDATE orders SET stok_dikurangi = 1")) {
          const o = orders[kunci(String(a[0]), String(a[1]))];
          if (o) o["stok_dikurangi"] = 1;
        }
      }
      return [];
    },
  };
  return db;
}

function siapkan(db: DbUji) {
  db.data.produk["ON-1"] = { sku: "ON-1", nama_accurate: "Piring Melamin", is_online_product: 1 };
  db.data.produk["NY-1"] = { sku: "NY-1", nama_accurate: "Gelas Kaca", is_online_product: 0 };
  db.data.orders[kunci("shopee", "SHP-1")] = { marketplace: "shopee", no_pesanan: "SHP-1", stok_dikurangi: 0 };
  db.data.orders[kunci("shopee", "SHP-2")] = { marketplace: "shopee", no_pesanan: "SHP-2", stok_dikurangi: 0 };
  db.data.items.push(
    { marketplace: "shopee", no_pesanan: "SHP-1", sku: "ON-1", qty: 3 },
    { marketplace: "shopee", no_pesanan: "SHP-1", sku: "NY-1", qty: 5 }
  );
}

describe("potongOnlineUntukOrder", () => {
  it("hanya memotong produk yang ditandai online, gudang lain tidak disentuh", async () => {
    const db = buatDb();
    siapkan(db);
    db.data.bins["ON-1|ONLINE"] = 10;
    db.data.bins["NY-1|GDG-A"] = 50;

    const r = await potongOnlineUntukOrder(db as never, [{ mp: "shopee", no: "SHP-1" }], "u1");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.dipotong, 3, "hanya ON-1 yang dipotong");
    assert.deepEqual(r.kurang, [], "stok cukup, tidak ada kekurangan");
    assert.equal(db.data.bins["ON-1|ONLINE"], 7);
    assert.equal(db.data.bins["NY-1|GDG-A"], 50, "produk non-online tidak boleh disentuh");
  });

  it("cetak ulang tidak memotong dua kali", async () => {
    const db = buatDb();
    siapkan(db);
    db.data.bins["ON-1|ONLINE"] = 10;

    await potongOnlineUntukOrder(db as never, [{ mp: "shopee", no: "SHP-1" }], "u1");
    const kedua = await potongOnlineUntukOrder(db as never, [{ mp: "shopee", no: "SHP-1" }], "u1");
    assert.equal(kedua.ok, true);
    if (!kedua.ok) return;
    assert.equal(kedua.dipotong, 0, "cetakan kedua tidak memotong apa pun");
    assert.equal(db.data.bins["ON-1|ONLINE"], 7, "saldo tetap seperti setelah cetakan pertama");
    const potongLedger = db.data.moves.filter((m) => m["action_type"] === "picklist_online");
    assert.equal(potongLedger.length, 1, "ledger hanya satu baris pemotongan");
  });

  it("stok tidak jadi negatif; sisanya dilaporkan sebagai kekurangan", async () => {
    const db = buatDb();
    siapkan(db);
    db.data.bins["ON-1|ONLINE"] = 1;

    const r = await potongOnlineUntukOrder(db as never, [{ mp: "shopee", no: "SHP-1" }], "u1");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.dipotong, 1);
    assert.equal(db.data.bins["ON-1|ONLINE"], 0, "berhenti di nol, bukan minus");
    assert.deepEqual(r.kurang, [{ sku: "ON-1", nama: "Piring Melamin", kurang: 2 }]);
  });

  it("kekurangan dihitung walau stok nol sama sekali", async () => {
    const db = buatDb();
    siapkan(db);
    // Tanpa baris stock_by_bin sama sekali untuk ON-1.
    const r = await potongOnlineUntukOrder(db as never, [{ mp: "shopee", no: "SHP-1" }], "u1");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.dipotong, 0);
    assert.deepEqual(r.kurang, [{ sku: "ON-1", nama: "Piring Melamin", kurang: 3 }]);
    assert.equal(db.data.orders[kunci("shopee", "SHP-1")]!["stok_dikurangi"], 1, "order tetap ditandai supaya tidak memotong lagi");
  });

  it("SKU yang sama di dua order dijumlahkan, bukan dipotong dua kali dari saldo yang sama", async () => {
    const db = buatDb();
    siapkan(db);
    db.data.orders[kunci("shopee", "SHP-2")] = { marketplace: "shopee", no_pesanan: "SHP-2", stok_dikurangi: 0 };
    db.data.items.push({ marketplace: "shopee", no_pesanan: "SHP-2", sku: "ON-1", qty: 2 });
    db.data.bins["ON-1|ONLINE"] = 10;

    const r = await potongOnlineUntukOrder(db as never, [{ mp: "shopee", no: "SHP-1" }, { mp: "shopee", no: "SHP-2" }], "u1");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.dipotong, 5, "3 + 2 unit");
    assert.equal(db.data.bins["ON-1|ONLINE"], 5);
  });

  it("order tanpa item sama sekali tidak menghasilkan kekurangan", async () => {
    const db = buatDb();
    siapkan(db);
    // SHP-2 tidak punya baris order_items: tidak ada yang diminta, jadi tidak ada yang kurang.
    db.data.orders[kunci("shopee", "SHP-2")] = { marketplace: "shopee", no_pesanan: "SHP-2", stok_dikurangi: 0 };
    const r = await potongOnlineUntukOrder(db as never, [{ mp: "shopee", no: "SHP-2" }], "u1");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.kurang, []);
    assert.equal(r.dipotong, 0);
    assert.equal(db.data.orders[kunci("shopee", "SHP-2")]!["stok_dikurangi"], 1, "tetap ditandai supaya tidak dipotong di cetakan berikutnya");
  });

  it("menolak target kosong", async () => {
    const db = buatDb();
    const r = await potongOnlineUntukOrder(db as never, [], "u1");
    assert.equal(r.ok, false);
  });
});

describe("ambilSkuOnline", () => {
  it("hanya mengembalikan SKU yang is_online_product = 1", async () => {
    const db = buatDb();
    siapkan(db);
    const set = await ambilSkuOnline(db as never, ["ON-1", "NY-1", "TIDAK-ADA"]);
    assert.deepEqual([...set], ["ON-1"]);
  });

  it("daftar kosong tidak menyentuh DB", async () => {
    const db = buatDb();
    const set = await ambilSkuOnline(db as never, []);
    assert.equal(set.size, 0);
  });
});
