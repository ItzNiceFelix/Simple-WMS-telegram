// Uji mesin sinkronisasi: aturan HPP, gudang baru, drift ledger, dan idempotensi.
// Memakai fetch palsu + mock D1 in-memory (pola sama dengan order.test.ts).
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { jalankanSinkron, hppDariKledo, normNama, GUDANG_VIRTUAL, adaSinkronBerjalan } from "./sinkron";
import type { OpsiKledo } from "./klien";

const OPSI: OpsiKledo = { subdomain: "uji", token: "rahasia", retry: 1 };

// ── Mock D1 minimal yang memahami query yang dipakai sinkron.ts ──
type Row = Record<string, unknown>;

function buatDb(awal?: { produk?: Row[]; gudang?: Row[]; bin?: Row[] }) {
  const produk = new Map<string, Row>((awal?.produk ?? []).map((r) => [String(r.sku), r]));
  const gudang = new Map<string, Row>((awal?.gudang ?? []).map((r) => [String(r.id), r]));
  const bin = new Map<string, Row>();
  for (const b of awal?.bin ?? []) bin.set(`${b.sku}|${b.warehouse_id}`, b);
  const petaKledo: Row[] = [];
  const moves: Row[] = [];
  const sync: Row[] = [];
  const syncGalat: Row[] = [];
  let seq = 0;

  const db = {
    _produk: produk, _gudang: gudang, _bin: bin, _peta: petaKledo, _moves: moves, _sync: sync, _galat: syncGalat,
    /** db.batch: jalankan berurutan, seperti D1. */
    async batch(list: { run: () => Promise<unknown> }[]) {
      const hasil: unknown[] = [];
      for (const s of list) hasil.push(await s.run());
      return hasil;
    },
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _a: [] as unknown[],
        bind(...a: unknown[]) {
          st._a = a;
          return st;
        },
        async first<T>(): Promise<T | null> {
          const a = st._a;
          if (sql.includes("FROM kledo_sync WHERE status = 'jalan'")) {
            const batas = Number(a[0]);
            return (sync.find((s) => s.status === "jalan" && Number(s.mulai_at) > batas) ?? null) as T | null;
          }
          if (sql.includes("FROM kledo_map WHERE jenis = 'gudang'")) {
            return (petaKledo.find((m) => m.jenis === "gudang" && m.kledo_id === String(a[0])) ?? null) as T | null;
          }
          if (sql.includes("FROM kledo_kredensial WHERE id")) return null as T | null;
          if (sql.includes("COALESCE(MAX(urutan)")) {
            const n = Math.max(0, ...[...gudang.values()].map((g) => Number(g.urutan ?? 0)));
            return { n: n + 1 } as T;
          }
          if (sql.includes("FROM warehouses WHERE id = ? OR lower(nama)")) {
            const [id, nama] = a as string[];
            const ada = [...gudang.values()].find((g) => g.id === id || String(g.nama).toLowerCase() === String(nama).toLowerCase());
            return (ada ?? null) as T | null;
          }
          if (sql.includes("COUNT(*) AS n FROM kledo_sync_galat")) {
            return { n: syncGalat.filter((g) => g.sync_id === Number(a[0])).length } as T;
          }
          return null as T | null;
        },
        async all<T>() {
          const a = st._a;
          if (sql.includes("FROM warehouses WHERE is_online = 0")) {
            return { results: [...gudang.values()].filter((g) => Number(g.is_online) === 0) as T[] };
          }
          if (sql.includes("SELECT sku, hpp, nama_accurate FROM products")) {
            return { results: [...produk.values()].map((p) => ({ sku: p.sku, hpp: p.hpp, nama_accurate: p.nama_accurate })) as T[] };
          }
          if (sql.includes("SELECT sku, warehouse_id, qty FROM stock_by_bin")) {
            return { results: [...bin.values()] as T[] };
          }
          if (sql.includes("HAVING n > 1")) {
            const hitung = new Map<string, number>();
            for (const m of petaKledo.filter((x) => x.jenis === "produk")) {
              hitung.set(String(m.lokal_id), (hitung.get(String(m.lokal_id)) ?? 0) + 1);
            }
            const hasil = [...hitung.entries()].filter(([, n]) => n > 1).map(([lokal_id, n]) => ({ lokal_id, n }));
            return { results: hasil as T[] };
          }
          if (sql.includes("FROM kledo_sync_galat WHERE sync_id")) {
            return { results: syncGalat.filter((g) => g.sync_id === Number(a[0])) as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          const a = st._a;
          if (sql.startsWith("INSERT INTO kledo_sync ")) {
            seq++;
            sync.push({ id: seq, jenis: a[0], pemicu: a[0], status: a[1], oleh: a[2], mulai_at: 1000, gudang_baru: 0, gudang_ubah: 0, produk_baru: 0, produk_ubah: 0, hpp_dipertahankan: 0, stok_baris: 0, stok_drift: 0, galat: 0, durasi_ms: null, pesan: null });
            return { meta: { last_row_id: seq } };
          }
          if (sql.startsWith("UPDATE kledo_sync SET status = 'gagal'")) {
            // bind(selesai_at, pesan, id)
            const s = sync.find((x) => x.id === Number(a[2]) && x.status === "jalan");
            if (s) Object.assign(s, { status: "gagal", selesai_at: a[0], pesan: a[1] });
            return {};
          }
          if (sql.startsWith("UPDATE kledo_sync SET selesai_at")) {
            // bind(selesai_at, status, durasi_ms, pesan, galat, id)
            const s = sync.find((x) => x.id === Number(a[5]));
            if (s) Object.assign(s, { selesai_at: a[0], status: a[1], durasi_ms: a[2], pesan: a[3], galat: a[4] });
            return {};
          }
          if (sql.startsWith("UPDATE kledo_sync SET gudang_baru")) {
            const s = sync.find((x) => x.id === Number(a[7]));
            if (s) Object.assign(s, { gudang_baru: a[0], gudang_ubah: a[1], produk_baru: a[2], produk_ubah: a[3], hpp_dipertahankan: a[4], stok_baris: a[5], stok_drift: a[6] });
            return {};
          }
          if (sql.startsWith("INSERT INTO kledo_sync_galat")) {
            syncGalat.push({ sync_id: Number(a[0]), bagian: a[1], ref: a[2], pesan: a[3] });
            return {};
          }
          if (sql.startsWith("INSERT INTO warehouses")) {
            const [id, code, nama, urutan, kledoId] = a as (string | number)[];
            gudang.set(String(id), { id, code, nama, aktif: 1, urutan, is_online: 0, kledo_id: kledoId });
            return {};
          }
          if (sql.startsWith("UPDATE warehouses SET kledo_id = ?")) {
            // bind(kledo_id, kledo_synced_at, updated_at, id)
            const g = gudang.get(String(a[3]));
            if (g) { g.kledo_id = a[0]; g.kledo_synced_at = a[1]; }
            return {};
          }
          if (sql.startsWith("UPDATE warehouses SET nama = ?")) {
            // bind(nama, updated_at, id)
            const g = gudang.get(String(a[2]));
            if (g) g.nama = a[0];
            return {};
          }
          if (sql.startsWith("INSERT INTO kledo_map")) {
            // `jenis` adalah literal di SQL ('produk'/'gudang'), bukan parameter bind.
            // Bind: (kledo_id, lokal_id, nama_snapshot, terakhir_dilihat).
            const jenis = sql.includes("'gudang'") ? "gudang" : "produk";
            const [kledoId, lokalId, nama] = a as string[];
            const ada = petaKledo.find((m) => m.jenis === jenis && m.kledo_id === String(kledoId));
            if (ada) Object.assign(ada, { lokal_id: lokalId, nama_snapshot: nama });
            else petaKledo.push({ jenis, kledo_id: String(kledoId), lokal_id: String(lokalId), nama_snapshot: nama });
            return {};
          }
          if (sql.startsWith("UPDATE kledo_map SET nama_snapshot")) {
            const m = petaKledo.find((x) => x.jenis === "gudang" && x.kledo_id === String(a[2]));
            if (m) m.nama_snapshot = a[0];
            return {};
          }
          if (sql.startsWith("INSERT INTO products")) {
            const [sku, nama, norm, hpp] = a as (string | number | null)[];
            if (!produk.has(String(sku))) produk.set(String(sku), { sku, nama_accurate: nama, nama_accurate_normalized: norm, hpp, is_online_product: 0 });
            return {};
          }
          if (sql.includes("UPDATE products SET nama_accurate = ?, nama_accurate_normalized = ?, hpp = ?")) {
            const [nama, norm, hpp, , , sku] = a as (string | number)[];
            const p = produk.get(String(sku));
            if (p) Object.assign(p, { nama_accurate: nama, nama_accurate_normalized: norm, hpp });
            return {};
          }
          if (sql.includes("UPDATE products SET nama_accurate = ?, nama_accurate_normalized = ?, updated_at")) {
            const [nama, norm, , , sku] = a as (string | number)[];
            const p = produk.get(String(sku));
            if (p) Object.assign(p, { nama_accurate: nama, nama_accurate_normalized: norm });
            return {};
          }
          if (sql.startsWith("INSERT INTO stock_by_bin")) {
            const [sku, wh, qty] = a as (string | number)[];
            bin.set(`${sku}|${wh}`, { sku, warehouse_id: wh, qty });
            return {};
          }
          if (sql.startsWith("INSERT INTO stock_moves")) {
            moves.push({
              sku: a[0], qty: a[1], jenis: "sync_confirmed", source: "sync",
              qty_sistem: a[2], qty_fisik: a[3], selisih: a[4], penanda: a[5], catatan: a[6],
            });
            return {};
          }
          return {};
        },
      };
      return st;
    },
  };
  return db as unknown as D1Database;
}

// ── Fetch palsu yang meniru bentuk NYATA Kledo ──
let asli: typeof globalThis.fetch;
let data: {
  gudang: { id: number; name: string; code: string }[];
  produk: { id: number; name: string; code: string; avg_base_price: number | null }[];
  stok: Record<string, Record<string, { warehouse_id: number; qty: number }>>;
  beli: { id: number; last_price: number }[];
};

beforeEach(() => {
  asli = globalThis.fetch;
  data = { gudang: [], produk: [], stok: {}, beli: [] };
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/finance/warehouses")) {
      return j({ success: true, data: { data: data.gudang, current_page: 1, last_page: 1 } });
    }
    if (u.includes("/finance/products/stocks")) {
      const ids = (new URL(u).searchParams.get("product_ids") ?? "").split(",").filter(Boolean);
      return j({ success: true, data: ids.map((id) => ({ id, qty: 0, stocks: data.stok[id] ?? {} })) });
    }
    if (u.includes("/finance/products/last_buy_prices")) {
      const ids = (new URL(u).searchParams.get("ids") ?? "").split(",").filter(Boolean);
      // Bentuk NYATA: objek berkunci id, bukan array.
      const obj: Record<string, { last_buy_price: number }> = {};
      for (const b of data.beli) if (ids.includes(String(b.id))) obj[String(b.id)] = { last_buy_price: b.last_price };
      return j({ success: true, data: obj });
    }
    if (u.includes("/finance/products")) {
      return j({ success: true, data: { data: data.produk, current_page: 1, last_page: 1 } });
    }
    return j({ success: true, data: {} });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = asli;
});

describe("normNama", () => {
  it("menyamakan nama yang berbeda tanda baca dan huruf", () => {
    assert.equal(normNama("Gudang D12"), normNama("gudang  d12"));
    assert.equal(normNama("Dukuh Kupang"), "dukuh kupang");
  });
});

describe("hppDariKledo", () => {
  it("membulatkan HPP desimal", () => {
    assert.equal(hppDariKledo(5620.84), 5621);
    assert.equal(hppDariKledo(28333.2223), 28333);
  });

  it("menolak 0 dan nilai di bawah 1 (round-nya jadi 0)", () => {
    assert.equal(hppDariKledo(0), null);
    assert.equal(hppDariKledo(0.0006892), null, "0.0006892 tidak boleh jadi HPP 0");
    assert.equal(hppDariKledo(null), null);
    assert.equal(hppDariKledo(undefined), null);
    assert.equal(hppDariKledo("bukan angka"), null);
  });

  it("memakai fallback hanya bila avg_base_price tidak layak", () => {
    assert.equal(hppDariKledo(0, 5000), 5000);
    assert.equal(hppDariKledo(12000, 5000), 12000, "avg_base_price menang");
    assert.equal(hppDariKledo(0, 0), null);
  });
});

describe("jalankanSinkron — gudang", () => {
  it("MENAMBAH gudang Kledo yang belum ada di D1", async () => {
    const db = buatDb({ gudang: [{ id: "ONLINE", nama: "Gudang Online", code: "ONLINE", is_online: 1 }, { id: "GMV0LJYS5", nama: "Gudang D12", code: "GMV0LJYS5", is_online: 0 }] });
    data.gudang = [
      { id: 2, name: "Gudang D12", code: "D12" },
      { id: 3, name: "Gudang D19", code: "D19" },
      { id: 4, name: "Dukuh Kupang", code: "DK-KPG" },
    ];
    const h = await jalankanSinkron(db, OPSI);
    assert.equal(h.gudangBaru, 2, "D19 dan Dukuh Kupang ditambahkan");
    assert.equal(h.gudangUbah, 1, "D12 dicocokkan lewat nama");
    const d = db as unknown as { _gudang: Map<string, Row> };
    assert.ok(d._gudang.has("K3"), "gudang D19 dibuat dengan id K<kledoId>");
    assert.ok(d._gudang.has("K4"), "Dukuh Kupang dibuat");
    assert.equal(d._gudang.get("GMV0LJYS5")?.kledo_id, 2, "D12 mendapat kledo_id=2");
  });

  it("TIDAK PERNAH menyentuh gudang virtual ONLINE", async () => {
    const db = buatDb({ gudang: [{ id: "ONLINE", nama: "Gudang Online", code: "ONLINE", is_online: 1 }] });
    data.gudang = [{ id: 2, name: "Gudang D12", code: "D12" }];
    await jalankanSinkron(db, OPSI);
    const d = db as unknown as { _gudang: Map<string, Row> };
    const online = d._gudang.get("ONLINE");
    assert.equal(online?.kledo_id, undefined, "ONLINE tidak dipetakan ke Kledo");
  });

  it("gudang Kledo yang punya nama sama tidak digandakan", async () => {
    const db = buatDb({ gudang: [{ id: "GMV0LJYS5", nama: "Gudang D12", code: "GMV0LJYS5", is_online: 0 }] });
    data.gudang = [{ id: 2, name: "gudang d12", code: "D12" }];
    const h = await jalankanSinkron(db, OPSI);
    assert.equal(h.gudangBaru, 0, "tidak ada gudang baru");
    const d = db as unknown as { _gudang: Map<string, Row> };
    assert.equal(d._gudang.size, 1, "jumlah gudang tetap 1");
  });
});

describe("jalankanSinkron — produk", () => {
  it("produk baru masuk dengan sku = code Kledo", async () => {
    const db = buatDb();
    data.produk = [{ id: 5, name: "Kemeja", code: "1203", avg_base_price: 13000 }];
    const h = await jalankanSinkron(db, OPSI);
    assert.equal(h.produkBaru, 1);
    const d = db as unknown as { _produk: Map<string, Row> };
    assert.equal(d._produk.get("1203")?.hpp, 13000);
    assert.equal(d._produk.get("1203")?.is_online_product, 0, "produk baru tidak otomatis online");
  });

  it("HPP TIDAK ditimpa jadi 0 saat Kledo mengirim 0 (ada produk stok 774, HPP 0)", async () => {
    const db = buatDb({ produk: [{ sku: "1620", nama_accurate: "Kaca Cetakan", hpp: 25000, is_online_product: 1 }] });
    data.produk = [{ id: 231, name: "Kaca Cetakan", code: "1620", avg_base_price: 0 }];
    const h = await jalankanSinkron(db, OPSI);
    assert.equal(h.hppDipertahankan, 1, "dihitung sebagai dipertahankan");
    const d = db as unknown as { _produk: Map<string, Row> };
    assert.equal(d._produk.get("1620")?.hpp, 25000, "HPP lama 25000 tetap utuh");
  });

  it("HPP diambil dari last_buy_prices bila avg_base_price kosong", async () => {
    const db = buatDb({ produk: [{ sku: "900", nama_accurate: "Lama", hpp: 3000, is_online_product: 1 }] });
    data.produk = [{ id: 9, name: "Produk", code: "900", avg_base_price: 0 }];
    data.beli = [{ id: 9, last_price: 4200 }];
    await jalankanSinkron(db, OPSI);
    const d = db as unknown as { _produk: Map<string, Row> };
    assert.equal(d._produk.get("900")?.hpp, 4200, "fallback last_buy_prices dipakai");
  });

  it("HPP produk baru boleh null, dan is_online_product tidak disentuh", async () => {
    const db = buatDb({ produk: [{ sku: "777", nama_accurate: "Lama", hpp: 8000, is_online_product: 1 }] });
    data.produk = [{ id: 77, name: "Produk", code: "777", avg_base_price: 0 }];
    await jalankanSinkron(db, OPSI);
    const d = db as unknown as { _produk: Map<string, Row> };
    assert.equal(d._produk.get("777")?.hpp, 8000, "tetap 8000");
    assert.equal(d._produk.get("777")?.is_online_product, 1, "tombol online milik WMS");
  });

  it("produk yang hilang dari Kledo TIDAK dihapus", async () => {
    const db = buatDb({ produk: [{ sku: "HILANG", nama_accurate: "Sudah tidak ada di Kledo", hpp: 5000, is_online_product: 1 }] });
    data.produk = [{ id: 1, name: "Ada", code: "ADA", avg_base_price: 1000 }];
    await jalankanSinkron(db, OPSI);
    const d = db as unknown as { _produk: Map<string, Row> };
    assert.ok(d._produk.has("HILANG"), "produk lama dipertahankan (ledger mereferensikannya)");
  });
});

describe("jalankanSinkron — stok", () => {
  it("menulis qty ke gudang yang dipetakan, melewati yang tidak", async () => {
    const db = buatDb({ gudang: [{ id: "GMV0LJYS5", nama: "Gudang D12", code: "GMV0LJYS5", is_online: 0 }] });
    data.gudang = [{ id: 2, name: "Gudang D12", code: "D12" }];
    data.produk = [{ id: 3, name: "Alas Setrika", code: "1203", avg_base_price: 13000 }];
    // wh4 = Dukuh Kupang, TIDAK dipetakan (tidak ada di data.gudang) -> harus dilewati.
    data.stok = { "3": { "2": { warehouse_id: 2, qty: 17 }, "4": { warehouse_id: 4, qty: 99 } } };
    const h = await jalankanSinkron(db, OPSI);
    const d = db as unknown as { _bin: Map<string, Row> };
    assert.equal(d._bin.get("1203|GMV0LJYS5")?.qty, 17, "gudang tepetakan ditulis");
    assert.equal(d._bin.has("1203|K4"), false, "gudang tak terpetakan dilewati");
    assert.equal(h.stokBaris, 1);
  });

  it("ledger mencatat drift SATU baris per SKU, dengan nilai lama/baru", async () => {
    const db = buatDb({
      gudang: [{ id: "GMV0LJYS5", nama: "Gudang D12", code: "GMV0LJYS5", is_online: 0 }],
      bin: [{ sku: "1203", warehouse_id: "GMV0LJYS5", qty: 5 }],
    });
    data.gudang = [{ id: 2, name: "Gudang D12", code: "D12" }];
    data.produk = [{ id: 3, name: "Alas", code: "1203", avg_base_price: 13000 }];
    data.stok = { "3": { "2": { warehouse_id: 2, qty: 17 } } };
    const h = await jalankanSinkron(db, OPSI);
    const d = db as unknown as { _moves: Row[] };
    assert.equal(h.stokDrift, 1);
    assert.equal(d._moves.length, 1, "satu baris ledger, bukan satu per baris stok");
    assert.equal(d._moves[0].qty_sistem, 5);
    assert.equal(d._moves[0].qty_fisik, 17);
    assert.equal(d._moves[0].selisih, 12);
    assert.equal(d._moves[0].jenis, "sync_confirmed");
    assert.equal(d._moves[0].source, "sync");
  });

  it("siklus KEDUA tidak menulis apa pun (idempoten)", async () => {
    const db = buatDb({ gudang: [{ id: "GMV0LJYS5", nama: "Gudang D12", code: "GMV0LJYS5", is_online: 0 }] });
    data.gudang = [{ id: 2, name: "Gudang D12", code: "D12" }];
    data.produk = [{ id: 3, name: "Alas", code: "1203", avg_base_price: 13000 }];
    data.stok = { "3": { "2": { warehouse_id: 2, qty: 17 } } };

    const h1 = await jalankanSinkron(db, OPSI);
    assert.equal(h1.produkBaru, 1);
    assert.equal(h1.stokDrift, 1);

    const h2 = await jalankanSinkron(db, OPSI);
    assert.equal(h2.produkBaru, 0, "tidak ada produk baru");
    assert.equal(h2.produkUbah, 0, "tidak ada produk yang berubah (nama & HPP sama)");
    assert.equal(h2.stokDrift, 0, "tidak ada drift");
    assert.equal(h2.stokBaris, 0, "tidak ada baris stok yang ditulis ulang");
    assert.equal(h2.gudangBaru, 0);
    assert.equal(h2.gudangUbah, 0, "gudang sudah dipetakan, tidak diubah lagi");
    const d = db as unknown as { _moves: Row[] };
    assert.equal(d._moves.length, 1, "ledger tidak bertambah di siklus kedua");
  });
});

describe("adaSinkronBerjalan", () => {
  it("false bila tidak ada catatan jalan", async () => {
    const db = buatDb();
    assert.equal(await adaSinkronBerjalan(db), false);
  });

  it("true bila ada sinkron yang baru mulai", async () => {
    const db = buatDb();
    const d = db as unknown as { _sync: Row[] };
    d._sync.push({ id: 1, status: "jalan", mulai_at: Math.floor(Date.now() / 1000) - 5 });
    assert.equal(await adaSinkronBerjalan(db), true);
  });

  it("MENUTUP sinkron yang terputus (lewat 3 menit) agar tidak menghalangi selamanya", async () => {
    const db = buatDb();
    const d = db as unknown as { _sync: Row[] };
    d._sync.push({ id: 7, status: "jalan", mulai_at: Math.floor(Date.now() / 1000) - 600 });
    assert.equal(await adaSinkronBerjalan(db), false, "tidak lagi menahan");
    assert.equal(d._sync[0].status, "gagal", "catatan ditutup sebagai gagal");
    assert.match(String(d._sync[0].pesan), /Terputus/);
  });

  it("mengabaikan catatan jalan yang lebih tua dari maksUmur", async () => {
    const db = buatDb();
    const d = db as unknown as { _sync: Row[] };
    d._sync.push({ id: 1, status: "jalan", mulai_at: Math.floor(Date.now() / 1000) - 7200 });
    assert.equal(await adaSinkronBerjalan(db), false);
  });
});

describe("jalankanSinkron — kegagalan", () => {
  it("kegagalan gudang -> status gagal, laporan tetap ditulis", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: false, message: "Token tidak valid" }), { status: 401 })) as typeof globalThis.fetch;
    const db = buatDb();
    const h = await jalankanSinkron(db, OPSI);
    assert.equal(h.status, "gagal");
    const d = db as unknown as { _sync: Row[] };
    assert.equal(d._sync.length, 1, "laporan sinkronisasi tercatat");
    assert.equal(d._sync[0].status, "gagal");
  });

  it("bentrok SKU (satu sku, dua id Kledo) dilaporkan, tidak menimpa", async () => {
    const db = buatDb({
      produk: [{ sku: "1203", nama_accurate: "Alas", hpp: 9999, is_online_product: 1 }],
    });
    // Dua produk Kledo berbeda yang kebetulan punya code sama.
    data.produk = [
      { id: 3, name: "Alas A", code: "1203", avg_base_price: 1000 },
      { id: 99, name: "Alas B", code: "1203", avg_base_price: 2000 },
    ];
    const h = await jalankanSinkron(db, OPSI);
    const d = db as unknown as { _galat: Row[] };
    const bentrok = d._galat.filter((g) => String(g.pesan).includes("Bentrok"));
    assert.equal(bentrok.length, 1, "bentrok dilaporkan");
  });

  it("GUDANG_VIRTUAL bernilai ONLINE", () => {
    assert.equal(GUDANG_VIRTUAL, "ONLINE");
  });
});
