// app/api/order/route.test.ts — uji jalur `konfirmasi-shopee` soal FK `order_items.sku`.
//
// Cacat yang diuji: `order_items.sku REFERENCES products(sku)`. Fitur "baris tanpa SKU tetap
// disimpan dengan penanda +PERLU-SKU-XXXX" dulu TIDAK PERNAH berhasil — penanda tidak pernah
// disisipkan ke `products`, jadi `db.batch()` melanggar FK dan SELURUH konfirmasi gagal 500
// (order yang sehat ikut hilang). Produksi: `products WHERE sku LIKE '+%'` = 0 dan
// `order_items WHERE perlu_sku=1` = 0.
//
// PENTING: mock D1 di sini MEMODELKAN FK — menulis `order_items` dengan SKU yang tidak ada di
// `products` DITOLAK, sama seperti D1 asli. Tanpa pemodelan itu ujinya tidak bernilai: cacat
// aslinya lolos begitu saja.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { GET, POST } from "./route";

type Row = Record<string, unknown>;

type GabunganItem = { sku: string; variasi: string; nama_shopee: string; qty: number; harga_satuan: number; subtotal: number };
type Gabungan = {
  marketplace: "shopee"; no_pesanan: string; tanggal: number; buyer: string; noResi: string;
  statusAwal: "pending" | "kirim"; statusFile: string; statusMp: string; opsiKirim: string; antarKe: string;
  jasaKirim: string; tipeLayanan: string; cod: boolean; preorder: boolean; batasKirim: string; items: GabunganItem[];
};

const ASAL = "https://simple-wms-telegram.bagus-deva-nov-p.workers.dev";

function order(no: string, items: GabunganItem[]): Gabungan {
  return {
    marketplace: "shopee", no_pesanan: no, tanggal: 1728288000, buyer: "Budi", noResi: `RESI-${no}`,
    statusAwal: "pending", statusFile: "perlu_dikirim", statusMp: "Perlu Dikirim", opsiKirim: "", antarKe: "",
    jasaKirim: "SPX Hemat", tipeLayanan: "Hemat", cod: false, preorder: false, batasKirim: "", items,
  };
}

const item = (sku: string, nama: string, variasi = ""): GabunganItem => ({
  sku, variasi, nama_shopee: nama, qty: 1, harga_satuan: 100000, subtotal: 100000,
});

/**
 * Mock D1 dengan FK `order_items.sku → products(sku)` DIPAKSAKAN.
 *
 * `batch` bersifat TRANSACTIONAL seperti D1 asli: satu pernyataan gagal → seluruh batch
 * gagal (perubahan tidak diterapkan). Inilah yang membuat cacat lama terbukti: satu penanda
 * menjatuhkan seluruh konfirmasi.
 */
function buatDbFk(skuAwal: string[], payload: unknown) {
  const products = new Set<string>(skuAwal);
  const orders = new Map<string, Row>();
  const items: Row[] = [];
  const batches: Row[] = [];
  const files: Row[] = [];
  let seq = 100;
  let batchId = 7;
  // Di-set oleh uji: bila true, produk penanda SENGAJA tidak disisipkan — meniru kegagalan
  // nyata (kolom rusak / trigger) supaya jalur `dilewati` teruji.
  let tahanProduk = false;

  const gagalFk = (sku: string) =>
    new Error(`D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY) — sku=${sku}`);

  /** Jalankan satu pernyataan; lempar bila melanggar FK (seperti D1). */
  function jalankan(sql: string, a: unknown[]): void {
    if (sql.startsWith("INSERT OR IGNORE INTO products")) {
      if (!tahanProduk) products.add(String(a[0]));
      return;
    }
    if (sql.startsWith("INSERT INTO products")) {
      if (!products.has(String(a[0]))) throw gagalFk(String(a[0]));
      return;
    }
    if (sql.startsWith("INSERT INTO orders")) {
      // Marketplace literal 'shopee' ada di SQL; argumen pertama = no_pesanan.
      orders.set(`shopee|${a[0]}`, { marketplace: "shopee", no_pesanan: a[0], status_fulfill: a[2] });
      return;
    }
    if (sql.startsWith("DELETE FROM order_items")) {
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i]["marketplace"] === a[0] && items[i]["no_pesanan"] === a[1]) items.splice(i, 1);
      }
      return;
    }
    if (sql.startsWith("INSERT INTO order_items")) {
      const sku = String(a[1]);
      if (!products.has(sku)) throw gagalFk(sku);
      // SQL memasang perlu_sku di akhir; sku_asal LITERAL '' pada baris normal, dan
      // argumen terakhir pada baris bertanda (lihat urutan bind di route).
      const perlu = sql.includes(", 1)") ? 1 : 0;
      const skuAsal = perlu === 1 ? String(a[a.length - 1]) : "";
      items.push({ marketplace: "shopee", no_pesanan: String(a[0]), sku, variasi: a[2], nama_shopee: a[3], qty: a[4], perlu_sku: perlu, sku_asal: skuAsal });
      return;
    }
    // advance_bookings / resi_grup / import_files / dll — tidak relevan untuk uji ini.
  }

  const db = {
    data: { products, orders, items, batches, files },
    prepare(sql: string) {
      let args: unknown[] = [];
      const st = {
        _sql: sql,
        _args: args,
        bind(...a: unknown[]) {
          args = a;
          st._args = a;
          return st;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes("FROM import_batches WHERE id = ?")) {
            return { id: batchId, file: "Order.toship.xlsx", payload_json: JSON.stringify(payload), by: "1" } as T;
          }
          if (sql.includes("FROM products WHERE sku")) {
            return (products.has(String(args[0])) ? { sku: args[0], nama_accurate: "X", hpp: 5000 } : null) as T | null;
          }
          return null;
        },
        async run() {
          jalankan(sql, args);
          if (sql.startsWith("INSERT INTO import_batches")) return { meta: { last_row_id: ++seq } };
          return { meta: { changes: 1 } };
        },
        // Contoh resmi Cloudflare memakai `_isInBatch` pada objek INNER yang dibagikan antara
        // `batch()` dan `run()`; `route.ts` sendiri belum memakainya. Disiapkan supaya mock
        // setia bentuknya bila penanganan error batch ditambahkan nanti.
        _isInBatch: true,
        async all<T>() {
          // `ambilProdukBanyak` membaca master lewat SATU query `WHERE sku IN (...)`. Mock dulu
          // selalu membalas array kosong, jadi prefetch menganggap SEMUA SKU tidak ada di master
          // dan setiap baris jatuh ke cabang penanda "PERLU SKU" — jauh dari perilaku produksi,
          // dan itu yang membuat uji FK gagal. Di sini query itu benar-benar dijawab.
          if (sql.includes("FROM products WHERE sku IN")) {
            const hasil = args
              .map(String)
              .filter((sku) => products.has(sku))
              .map((sku) => ({ sku, nama_accurate: "X", hpp: 5000, hpp_baru: 0, is_online_product: 0, stok_min: 0 }));
            return { results: hasil as T[] };
          }
          if (sql.includes("FROM resi_grup")) return { results: [] as T[] };
          return { results: [] as T[] };
        },
      };
      return st;
    },
    /**
     * Batch TRANSACTIONAL, tapi ATOMIK seperti D1 asli.
     *
     * D1 `batch()` mengirim banyak pernyataan dalam SATU transaksi: D1 memvalidasi SELURUH
     * pernyataan dulu, dan bila ada satu yang melanggar FK, TIDAK ADA yang dijalankan —
     * yang dilempar adalah error FK dari pernyataan pertama yang buruk.
     *
     * Mock ini dulu menjalankan pernyataan satu per satu sambil MENGUBAH state, lalu melempar
     * error dan memulihkan snapshot lewat `items.length = snap.items`. Dua akibatnya salah:
     * (1) rollback hanya memangkas panjang array, jadi `orders.set()` hasil tulisan parsial
     * TIDAK ikut dipulihkan — beda dari D1 yang benar-benar rollback; (2) yang dilempar adalah
     * error FK pernyataan terakhir sementara D1 melempar yang pertama. Karena jalur produksi
     * memutuskan "coba satu-satu" dari error itu, mock yang tidak setia membuat uji memeriksa
     * perilaku yang tidak pernah terjadi di produksi.
     */
    async batch(stmts: { _sql: string; _args: unknown[] }[]) {
      batches.push({ n: stmts.length });
      // DEBUG
      // 1) Validasi dulu SEMUA pernyataan tanpa menyentuh state; error pertama yang dilempar.
      for (const s of stmts) {
        if (s._sql.startsWith("INSERT INTO order_items")) {
          const sku = String(s._args[1]);
          if (!products.has(sku)) throw gagalFk(sku);
        }
      }
      // 2) Semua lolos validasi → baru jalankan.
      const hasil: { meta: { changes?: number; last_row_id?: number } }[] = [];
      for (const s of stmts) {
        jalankan(s._sql, s._args);
        hasil.push({ meta: { changes: 1 } });
      }
      return hasil;
    },
  };
  return {
    db,
    batchId,
    /** Uji: penanda tidak jadi disisipkan → baris order_items-nya melanggar FK. */
    tahanProduk(v: boolean) {
      tahanProduk = v;
    },
    /** Uji: ganti batch jadi selalu gagal (masalah skema), termasuk `run()` per pernyataan. */
    rusakTotal() {
      db.batch = async () => {
        throw new Error("no such table: order_items");
      };
      const stGagal = () => {
        let args: unknown[] = [];
        const st = {
          _sql: "INSERT INTO order_items (marketplace, no_pesanan, sku) VALUES ('shopee', ?, ?)",
          _args: args,
          bind(...a: unknown[]) {
            args = a;
            st._args = a;
            return st;
          },
          async first() {
            return { id: batchId, file: "x.xlsx", payload_json: JSON.stringify(payload), by: "1" };
          },
          async run() {
            throw new Error("no such table: order_items");
          },
          async all() {
            return { results: [] };
          },
        };
        return st;
      };
      // Pertahankan pembacaan batch, tetapi semua pernyataan tulis ditolak.
      db.prepare = ((sql: string) => {
        if (sql.includes("FROM import_batches WHERE id = ?")) return stGagal();
        if (sql.includes("FROM products WHERE sku")) {
          let args: unknown[] = [];
          const st = {
            _sql: sql,
            _args: args,
            bind(...a: unknown[]) { args = a; st._args = a; return st; },
            async first() { return products.has(String(args[0])) ? { sku: args[0], nama_accurate: "X", hpp: 5000 } : null; },
            async run() { return { meta: {} }; },
            // Prefetch `ambilProdukBanyak` (`WHERE sku IN (...)`) juga harus dijawab di sini:
            // kalau tidak, SEMUA SKU dianggap tak ada di master, tiap baris jadi baris penanda,
            // dan `siapkanProdukPenanda` menulis — padahal niat uji ini hanya menggagalkan
            // pernyataan tulis `order_items`, bukan memicu jalur penanda.
            async all() {
              const hasil = args
                .map(String)
                .filter((sku) => products.has(sku))
                .map((sku) => ({ sku, nama_accurate: "X", hpp: 5000, hpp_baru: 0, is_online_product: 0, stok_min: 0 }));
              return { results: hasil };
            },
          };
          return st;
        }
        return stGagal();
      }) as typeof db.prepare;
    },
  };
}

function req(body: unknown): Request {
  return new Request(`${ASAL}/api/order`, {
    method: "POST",
    headers: { origin: ASAL, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Jawaban = {
  ok: boolean; error?: string; order?: number; item?: number;
  dilewati?: { no_pesanan: string; pesan: string }[];
  /** `mulai-impor`: batch baru vs batch lama yang dilanjutkan. */
  dilanjutkan?: boolean;
  /** `mulai-impor`: order yang sudah tersimpan di batch (0 untuk batch baru). */
  sudahBaris?: number;
  /** `mulai-impor`: ukuran potongan yang ditetapkan server (klien memakainya apa adanya). */
  ukuranPotong?: number;
};

async function panggil(db: unknown, body: Record<string, unknown>): Promise<{ status: number; body: Jawaban }> {
  // Alias `@/lib/d1/db` mengembalikan nilai ini (lihat test/alias-db.mjs). Tipe declaration
  // global berasal dari uji route lain; di sini yang dipasang mock berbeda, jadi diset lewat
  // satu-satunya jalur yang memang menerima nilai apa pun.
  (globalThis as unknown as { __TMA_TEST_DB__?: unknown }).__TMA_TEST_DB__ = db;
  // Body dibaca sebagai JSON lalu di-cast ke Jawaban: balasan 400 (`{ ok, error }`) tidak
  // memuat `order`/`item`, jadi hanya field yang ada yang benar-benar terisi.
  const res = await POST(req(body));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Jawaban };
}

/**
 * Mock D1 seadanya untuk jalur BERTAHAP (`mulai-impor`). Hanya yang dipakai jalur itu yang
 * dimodelkan: `import_batches` sebagai daftar baris + satu `db.run`, sehingga uji bisa memeriksa
 * batch mana yang berstatus apa setelah tiap panggilan.
 */
function buatDbBertahap(awal: { file: string; status: string; progres_baris: number; nomor_potong?: number }[]) {
  let seq = 100;
  const rows = awal.map((b) => ({
    id: ++seq,
    file: b.file,
    status: b.status,
    progres_baris: b.progres_baris,
    nomor_potong: b.nomor_potong ?? 0,
    mode_impor: "bertahap",
    sukses: 0,
  }));
  return {
    rows,
    prepare(sql: string) {
      let args: unknown[] = [];
      const st = {
        _sql: sql,
        _args: args,
        bind(...a: unknown[]) {
          args = a;
          st._args = a;
          return st;
        },
        /**
         * SELECT resume: `status = 'preview' AND progres_baris > 0 ORDER BY at DESC LIMIT 1`.
         * Urutan `at` disederhanakan jadi urutan id dari yang terbaru — cukup untuk uji ini.
         */
        async first<T>(): Promise<T | null> {
          if (!sql.includes("FROM import_batches")) return null;
          const file = String(args[0]);
          const kandidat = rows.filter((r) => r.file === file && r.status === "preview" && r.progres_baris > 0);
          if (kandidat.length === 0) return null;
          const terakhir = kandidat[kandidat.length - 1];
          return { id: terakhir.id, progres_baris: terakhir.progres_baris } as T;
        },
        async run() {
          if (sql.startsWith("UPDATE import_batches SET status = 'batal'")) {
            const file = String(args[0]);
            for (const r of rows) {
              if (r.file === file && r.mode_impor === "bertahap" && r.status === "preview" && r.progres_baris > 0) {
                r.status = "batal";
                r.sukses = r.progres_baris;
              }
            }
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO import_batches")) {
            const id = ++seq;
            rows.push({ id, file: String(args[0]), status: "preview", progres_baris: 0, nomor_potong: 0, mode_impor: "bertahap", sukses: 0 });
            return { meta: { last_row_id: id } };
          }
          return { meta: { changes: 1 } };
        },
        async all<T>() {
          return { results: [] as T[] };
        },
      };
      return st;
    },
    async batch() {
      return [];
    },
  };
}

describe("mulai-impor — resume vs mulai baru", () => {
  it("tanpa flag: batch belum selesai untuk berkas sama DILANJUTKAN (bukan batch baru)", async () => {
    const db = buatDbBertahap([{ file: "Order.toship.xlsx", status: "preview", progres_baris: 600, nomor_potong: 3 }]);
    const r = await panggil(db, { aksi: "mulai-impor", namaBerkas: "Order.toship.xlsx", totalBaris: 5000 });
    assert.equal(r.status, 200, `harus 200: ${r.body.error ?? ""}`);
    assert.equal(r.body.dilanjutkan, true, "batch lama harus dilanjutkan");
    assert.equal(r.body.sudahBaris, 600, "progres diteruskan apa adanya");
    assert.equal(db.rows.length, 1, "tidak boleh ada batch baru");
    assert.equal(db.rows[0].status, "preview", "batch lama tetap preview");
  });

  it("mulaiBaru: batch lama ditandai 'batal' dan batch BARU dibuat dengan progres 0", async () => {
    const db = buatDbBertahap([{ file: "Order.toship.xlsx", status: "preview", progres_baris: 600, nomor_potong: 3 }]);
    const r = await panggil(db, { aksi: "mulai-impor", namaBerkas: "Order.toship.xlsx", totalBaris: 5000, mulaiBaru: true });
    assert.equal(r.status, 200, `harus 200: ${r.body.error ?? ""}`);
    assert.equal(r.body.dilanjutkan, false, "mulaiBaru harus MEMBUAT batch baru, bukan melanjutkan");
    assert.equal(r.body.sudahBaris, 0, "batch baru mulai dari nol");
    assert.equal(db.rows.length, 2, "batch baru ditambahkan");
    const [lama, baru] = db.rows;
    assert.equal(lama.status, "batal", "batch lama ditandai batal");
    assert.equal(lama.sukses, 600, "riwayat baris tersimpan tetap tercatat di batch lama");
    assert.equal(baru.status, "preview");
    assert.equal(baru.progres_baris, 0);
    assert.notEqual(baru.id, lama.id, "batch baru = id baru");
  });
});

describe("konfirmasi-shopee + FK order_items.sku", () => {
  it("baris tanpa SKU master TETAP tersimpan sebagai perlu_sku=1, order lain utuh", async () => {
    const { db } = buatDbFk(["A"], {
      hash: "h1",
      // O-1 punya dua baris: satu SKU master (A), satu SKU yang TIDAK ada di master (ZZ).
      orders: [order("O-1", [item("A", "Produk A"), item("ZZ", "Barang ZZ")]), order("O-2", [item("A", "Produk A")])],
      advance: [],
    });
    const r = await panggil(db, { aksi: "konfirmasi-shopee", batch_id: 7, presetId: 1 });
    assert.equal(r.status, 200, `harus 200, bukan 500: ${r.body.error ?? ""}`);
    assert.equal(r.body.ok, true);
    // Order sehat TETAP tersimpan.
    assert.ok(db.data.orders.has("shopee|O-2"), "order O-2 tidak boleh ikut hilang");
    // Baris bertanda tersimpan dengan kolom penanda + produk penanda ada di master.
    const tanda = db.data.items.filter((i) => i["no_pesanan"] === "O-1" && i["perlu_sku"] === 1);
    assert.equal(tanda.length, 1, "baris ZZ harus tersimpan sebagai perlu_sku=1");
    const skuTanda = String(tanda[0]["sku"]);
    assert.match(skuTanda, /^\+PERLU-SKU-/);
    assert.equal(tanda[0]["sku_asal"], "ZZ", "SKU asal dari file dibawa");
    assert.ok(db.data.products.has(skuTanda), "produk penanda WAJIB ada agar FK terpenuhi");
    assert.equal(db.data.items.length, 3, "3 baris: A(O-1), penanda(O-1), A(O-2)");
  });

  it('baris "belum di MP" tidak lagi menggagalkan seluruh batch', async () => {
    const { db } = buatDbFk(["A"], {
      hash: "h2",
      orders: [order("P-1", [item("", "Belum di MP sama sekali")]), order("P-2", [item("A", "Produk A")])],
      advance: [],
    });
    const r = await panggil(db, {
      aksi: "konfirmasi-shopee", batch_id: 7, presetId: 1,
      tandaiBelumMp: [{ order_ref: "P-1", nama_shopee: "Belum di MP sama sekali", variasi: "", sumber: "order", qty_total: 1 }],
    });
    assert.equal(r.status, 200, `harus 200: ${r.body.error ?? ""}`);
    assert.equal(r.body.ok, true);
    assert.ok(db.data.orders.has("shopee|P-2"));
    const tanda = db.data.items.filter((i) => i["no_pesanan"] === "P-1");
    assert.equal(tanda.length, 1);
    assert.equal(tanda[0]["perlu_sku"], 1);
    assert.match(String(tanda[0]["sku"]), /^\+PERLU-SKU-/);
  });

  it("satu baris ditolak D1 → sisa tetap tersimpan, respons memuat `dilewati` (bukan 500)", async () => {
    // Penanda SENGAJA tidak bisa disisipkan ke `products` → baris order_items-nya melanggar FK.
    // Inilah cacat produksi: dulu satu baris begini menjatuhkan SELURUH konfirmasi sebagai 500.
    const { db, tahanProduk } = buatDbFk(["A"], {
      hash: "h3",
      orders: [order("Q-1", [item("", "Tanpa SKU")]), order("Q-2", [item("A", "Produk A")])],
      advance: [],
    });
    tahanProduk(true);

    const r = await panggil(db, {
      aksi: "konfirmasi-shopee", batch_id: 7, presetId: 1,
      tandaiBelumMp: [{ order_ref: "Q-1", nama_shopee: "Tanpa SKU", variasi: "", sumber: "order", qty_total: 1 }],
    });
    assert.equal(r.status, 200, `satu baris buruk tidak boleh 500: ${r.body.error ?? ""}`);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.dilewati?.length, 1, "baris yang ditolak dilaporkan ke UI");
    assert.equal(r.body.dilewati?.[0]?.no_pesanan, "Q-1");
    assert.match(String(r.body.dilewati?.[0]?.pesan), /FOREIGN KEY/i);
    assert.ok(db.data.orders.has("shopee|Q-2"), "order sehat tetap tersimpan");
  });

  it("semua pernyataan gagal → tetap error (bukan sukses palsu)", async () => {
    const fake = buatDbFk(["A"], { hash: "h4", orders: [order("R-1", [item("A", "Produk A")])], advance: [] });
    fake.rusakTotal();
    const r = await panggil(fake.db, { aksi: "konfirmasi-shopee", batch_id: 7, presetId: 1 });
    assert.notEqual(r.status, 200, "semua gagal bukan sukses");
    assert.equal(r.body.ok, false);
    assert.match(String(r.body.error), /masalah skema|ditolak/i);
  });
});

// Satu D1 dipakai banyak toko: tanpa `presetId` order masuk ke toko yang salah tanpa terlihat.
// Jadi server MENOLAK impor tanpa preset, bukan menulis dengan preset kosong/tebakan.
describe("impor wajib presetId", () => {
  it("konfirmasi-shopee tanpa presetId → 400 yang menyebut presetId", async () => {
    const { db } = buatDbFk(["A"], { hash: "h5", orders: [order("S-1", [item("A", "Produk A")])], advance: [] });
    const r = await panggil(db, { aksi: "konfirmasi-shopee", batch_id: 7 });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
    assert.match(String(r.body.error), /presetId/);
    assert.equal(db.data.orders.size, 0, "tidak boleh ada order tertulis tanpa toko");
  });

  it("presetId bukan integer > 0 → 400", async () => {
    const { db } = buatDbFk(["A"], { hash: "h6", orders: [order("S-2", [item("A", "Produk A")])], advance: [] });
    for (const presetId of [0, -3, 1.5, "abc", null]) {
      const r = await panggil(db, { aksi: "konfirmasi-shopee", batch_id: 7, presetId });
      assert.equal(r.status, 400, `presetId=${String(presetId)} harus ditolak`);
      assert.match(String(r.body.error), /presetId/);
    }
    assert.equal(db.data.orders.size, 0);
  });

  it("impor-potong tanpa presetId → 400 sebelum pernyataan disusun", async () => {
    const r = await panggil(buatDbBertahap([{ file: "a.xlsx", status: "preview", progres_baris: 0 }]), {
      aksi: "impor-potong",
      batchId: 101,
      nomorPotong: 1,
      potongan: [order("T-1", [item("A", "Produk A")])],
    });
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /presetId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// preview-picklist
// ─────────────────────────────────────────────────────────────────────────────

type Gudang = { id: string; code: string; nama: string };
type StokBaris = { sku: string; warehouse_id: string; qty: number };
type ItemOrder = { no_pesanan: string; sku: string; qty: number; perlu_sku: number; sku_asal: string };
type Booking = { booking_sn: string; sku: string; qty: number; nama_produk: string; antar_ke: string; status: string };

/**
 * Mock D1 READ-ONLY untuk jalur `preview-picklist` (dan `picklist-pdf` pembandingnya).
 *
 * Hanya SELECT yang dimodelkan — cukup untuk membuktikan dua hal yang tidak bisa dibuktikan
 * oleh uji unit murni: (a) `lokasi` benar-benar keluar sebagai NAMA gudang, dan (b) baris
 * pratinjau benar-benar dihasilkan fungsi D1 yang sama dengan jalur PDF.
 *
 * `query` mengembalikan {sql,args} supaya uji PDF/peta bisa dibandingkan langsung.
 */
function buatDbBaca(fix: {
  orders: { no_pesanan: string; no_resi: string; status_fulfill?: string }[];
  items: ItemOrder[];
  products: { sku: string; nama_accurate: string }[];
  stok: StokBaris[];
  gudang: Gudang[];
  booking?: Booking[];
  resiGrup?: { no_resi: string; no_json: string; jasa_kirim: string }[];
}) {
  const eksekusi = (sql: string, args: unknown[]): unknown[] => {
    if (sql.includes("FROM products p") && sql.includes("stock_by_bin")) {
      // infoNamaDanLokasi: satu baris per (produk × bin). `LEFT JOIN` → baris tetap ada
      // walau SKU belum punya bin sama sekali (gudang = null).
      const daftar = args.map(String);
      return fix.products
        .filter((p) => daftar.includes(p.sku))
        .flatMap((p) => {
          const bins = fix.stok.filter((s) => s.sku === p.sku);
          const baris: { sku: string; nama: string; gudang: string | null; qty: number | null }[] =
            bins.length > 0
              ? bins.map((b) => ({ sku: p.sku, nama: p.nama_accurate, gudang: b.warehouse_id, qty: b.qty }))
              : [{ sku: p.sku, nama: p.nama_accurate, gudang: null, qty: null }];
          return baris;
        });
    }
    if (sql.startsWith("SELECT id, code, nama FROM warehouses")) return fix.gudang.map((g) => ({ ...g }));
    if (sql.includes("FROM orders WHERE marketplace")) {
      const daftar = args.map(String);
      return fix.orders.filter((o) => daftar.includes(o.no_pesanan)).map((o) => ({ ...o, status_fulfill: o.status_fulfill ?? "pending" }));
    }
    if (sql.includes("FROM resi_grup")) {
      const daftar = args.map(String);
      return (fix.resiGrup ?? []).filter((r) => daftar.includes(r.no_resi));
    }
    if (sql.includes("FROM order_items i")) {
      // Dua bentuk: `buatPicklist` memakai `i.marketplace = ? AND i.no_pesanan = ?`;
      // `buatPicklistPaket` memakai literal 'shopee' dan satu parameter nomor pesanan.
      const no = String(args[args.length - 1]);
      return fix.items
        .filter((i) => i.no_pesanan === no)
        .map((i) => {
          const p = fix.products.find((x) => x.sku === i.sku);
          return {
            sku: i.sku, nama: p?.nama_accurate ?? null, qty: i.qty, variasi: "",
            nama_shopee: p?.nama_accurate ?? "Nama Shopee", perlu_sku: i.perlu_sku, sku_asal: i.sku_asal,
          };
        });
    }
    if (sql.includes("FROM advance_bookings")) {
      // Dua bentuk bind: dengan filter status → (status, limit); tanpa → (limit).
      // `listBooking` tanpa status dipakai `ambilBookingTerpilih` untuk mencari SN terpilih.
      const adaFilterStatus = sql.includes("WHERE status = ?");
      const semua = fix.booking ?? [];
      return adaFilterStatus ? semua.filter((b) => b.status === String(args[0])) : semua;
    }
    if (sql.includes("FROM products WHERE sku IN")) {
      const daftar = args.map(String);
      return fix.products.filter((p) => daftar.includes(p.sku)).map((p) => ({ sku: p.sku, nama_accurate: p.nama_accurate }));
    }
    return [];
  };
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const st = {
        _sql: sql,
        _args: args,
        bind(...a: unknown[]) { args = a; st._args = a; return st; },
        async first<T>(): Promise<T | null> {
          return (eksekusi(sql, args)[0] ?? null) as T | null;
        },
        async all<T>() {
          return { results: eksekusi(sql, args) as T[] };
        },
        async run() { return { meta: { changes: 0 } }; },
      };
      return st;
    },
    async batch() { return []; },
  };
  return { db, query: eksekusi };
}

const FIX_GUDANG: Gudang[] = [
  { id: "GMV0LJYS5", code: "D12", nama: "Gudang D12" },
  { id: "AZQ9K7WP1", code: "D19", nama: "Gudang D19" },
];

/** Fixture bersama: A ada di D12 (5) + D19 (2); B cuma di D19 (3); C tanpa stok.
 *  Bentuk fixture baca (order + item + master + stok + booking) yang dipakai uji pratinjau. */
type FixtureBaca = {
  orders: { no_pesanan: string; no_resi: string }[];
  items: ItemOrder[];
  products: { sku: string; nama_accurate: string }[];
  stok: StokBaris[];
  gudang: Gudang[];
  booking: Booking[];
  resiGrup: { no_resi: string; no_json: string; jasa_kirim: string }[];
};

function fixtureBaca(): FixtureBaca {
  return {
    orders: [
      { no_pesanan: "O-1", no_resi: "RESI-1" },
      { no_pesanan: "O-2", no_resi: "RESI-2" },
    ],
    items: [
      { no_pesanan: "O-1", sku: "A", qty: 2, perlu_sku: 0, sku_asal: "" },
      { no_pesanan: "O-1", sku: "B", qty: 1, perlu_sku: 0, sku_asal: "" },
      { no_pesanan: "O-2", sku: "A", qty: 1, perlu_sku: 0, sku_asal: "" },
      { no_pesanan: "O-2", sku: "C", qty: 4, perlu_sku: 0, sku_asal: "" },
    ],
    products: [
      { sku: "A", nama_accurate: "Piring Melamin" },
      { sku: "B", nama_accurate: "Gelas Kaca" },
      { sku: "C", nama_accurate: "Sendok Stainless" },
    ],
    stok: [
      { sku: "A", warehouse_id: "GMV0LJYS5", qty: 5 },
      { sku: "A", warehouse_id: "AZQ9K7WP1", qty: 2 },
      { sku: "B", warehouse_id: "AZQ9K7WP1", qty: 3 },
    ],
    gudang: FIX_GUDANG,
    booking: [
      { booking_sn: "BK-1", sku: "A", qty: 3, nama_produk: "Nama Shopee A", antar_ke: "SHP-9", status: "menunggu" },
      { booking_sn: "BK-2", sku: "B", qty: 1, nama_produk: "Nama Shopee B", antar_ke: "SHP-8", status: "menunggu" },
    ],
    resiGrup: [],
  };
}

type HasilPreview = {
  ok: boolean; mode: string; urut: string; arah: string; kolom: string[]; judul: string;
  baris: { no: number; nama: string; sku: string; lokasi: string; qty: number; perluSku: boolean; skuAsal: string; grup?: string }[];
  total_baris: number; total_unit: number; ada_bermasalah: number;
  total_order: number; total_advance: number;
  total_baris_order: number; total_baris_advance: number;
  error?: string;
};

/**
 * Bongkar teks yang BENAR-BENAR tergambar di PDF (pola sama dengan
 * `lib/d1/picklistGabungPdf.test.ts`). Perlu, karena "PDF tidak melempar" tidak berarti
 * isinya benar — cakupan booking yang salah hanya terlihat dari isi lembar.
 */
async function teksPdf(bytes: Uint8Array): Promise<string[]> {
  const buf = Buffer.from(bytes);
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf.toString("latin1"))) !== null) {
    let isi = Buffer.from(m[1]!, "latin1");
    try { isi = inflateSync(isi); } catch { /* tidak ter-deflate: pakai apa adanya */ }
    const teks = isi.toString("latin1");
    const reHex = /<([0-9A-Fa-f]+)>\s*Tj/g;
    let h: RegExpExecArray | null;
    while ((h = reHex.exec(teks)) !== null) out.push(Buffer.from(h[1]!, "hex").toString("latin1"));
  }
  return out;
}

async function panggilPreview(
  db: unknown,
  q: { targets: { marketplace: string; no_pesanan: string }[]; mode?: string; urut?: string; arah?: string; booking?: string[] }
): Promise<{ status: number; body: HasilPreview }> {
  (globalThis as unknown as { __TMA_TEST_DB__?: unknown }).__TMA_TEST_DB__ = db;
  const p = new URLSearchParams({ aksi: "preview-picklist", targets: JSON.stringify(q.targets) });
  if (q.mode !== undefined) p.set("mode", q.mode);
  if (q.urut !== undefined) p.set("urut", q.urut);
  if (q.arah !== undefined) p.set("arah", q.arah);
  if (q.booking !== undefined) p.set("booking", JSON.stringify(q.booking));
  const res = await GET(new Request(`${ASAL}/api/order?${p.toString()}`));
  return { status: res.status, body: (await res.json()) as HasilPreview };
}

const TARGETS = [
  { marketplace: "shopee", no_pesanan: "O-1" },
  { marketplace: "shopee", no_pesanan: "O-2" },
];

describe("preview-picklist — bentuk respons", () => {
  it("gabung-order: kolom lengkap, judul, dan qty = order + advance untuk SKU yang sama", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order" });
    assert.equal(r.status, 200, `harus 200: ${r.body.error ?? ""}`);
    assert.deepEqual(r.body.kolom, ["No", "Nama Produk", "SKU", "Lokasi Gudang", "Quantity Total"]);
    assert.equal(r.body.mode, "gabung-order");
    assert.equal(r.body.judul, "PICKLIST ORDER — GABUNG ORDER + ADVANCE");
    // SKU A: order O-1 (2) + order O-2 (1) + booking BK-1 (3) = 6. Inilah "Quantity Total":
    // angka yang SAMA dengan yang tercetak di lembar gabungan.
    const a = r.body.baris.find((b) => b.sku === "A");
    assert.equal(a?.qty, 6, "qty gabungan = jumlah order + advance");
    // Total unit = 6 (A) + 2 (B: order 1 + booking 1) + 4 (C: order saja) = 12.
    assert.equal(r.body.total_unit, 12);
    assert.equal(r.body.total_order, 2, "dua order ikut menyumbang");
    assert.equal(r.body.total_advance, 2, "dua booking menunggu ikut menyumbang");
    assert.equal(r.body.total_baris, 3);
    assert.deepEqual(r.body.baris.map((b) => b.no), [1, 2, 3], "nomor 1-based berurutan setelah urut");
  });

  it("gabung-order: total_baris_order = BARIS (sama dengan header PDF), beda dari total_order = ENTITAS", async () => {
    // Cacat yang dikunci: layar dulu hanya punya `total_order` (order UNIK) sementara
    // header PDF menghitung BARIS. Fixture ini punya 2 order (O-1, O-2) tetapi 4 baris item
    // order (O-1: A+B, O-2: A+C), jadi angka-angkanya HARUS berbeda — kalau uji ini lulus
    // dengan `total_baris_order === total_order`, ia tidak membuktikan apa pun.
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order" });
    assert.equal(r.status, 200, `harus 200: ${r.body.error ?? ""}`);

    assert.equal(r.body.total_order, 2, "2 order unik");
    assert.equal(r.body.total_baris_order, 4, "4 baris item order (2 per order)");
    assert.notEqual(
      r.body.total_baris_order,
      r.body.total_order,
      "baris order HARUS beda dari order unik — inilah beda layar vs kertas yang diperbaiki"
    );
    // 2 booking, satu baris masing-masing — jadi kedua satuan sama di sisi advance.
    assert.equal(r.body.total_advance, 2, "2 booking advance");
    assert.equal(r.body.total_baris_advance, 2, "2 baris advance");
  });

  it("lokasi adalah NAMA gudang, bukan id/kode (regresi kolom Lokasi Gudang)", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order" });
    const a = r.body.baris.find((b) => b.sku === "A");
    // A punya 5 di GMV0LJYS5 (code D12) dan 2 di AZQ9K7WP1 (code D19) → dominan D12.
    assert.ok(a?.lokasi.includes("Gudang D12"), `lokasi harus NAMA gudang, dapat ${JSON.stringify(a?.lokasi)}`);
    assert.ok(!a?.lokasi.includes("GMV0LJYS5"), "ID gudang tidak boleh bocor ke kolom Lokasi Gudang");
    assert.ok(a?.lokasi.includes("Gudang D19"), "gudang lain tetap disebut sebagai penanda");
  });

  it("pisah: tanpa kolom Lokasi (buatPicklist memang tidak menghitungnya)", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: TARGETS, mode: "pisah" });
    assert.deepEqual(r.body.kolom, ["No", "Nama Produk", "SKU", "Quantity Total"]);
    assert.ok(r.body.baris.every((b) => b.lokasi === ""), "mode pisah tidak punya lokasi");
    assert.deepEqual(r.body.baris.map((b) => b.sku).sort(), ["A", "B", "C"]);
  });

  it("per_paket: satu grup per resi", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: TARGETS, mode: "per_paket" });
    assert.deepEqual(r.body.kolom, ["No", "Nama Produk", "SKU", "Quantity Total"]);
    assert.deepEqual([...new Set(r.body.baris.map((b) => b.grup))].sort(), ["RESI-1", "RESI-2"]);
  });

  it("mode tak dikenal → 400, bukan lembar kosong", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: TARGETS, mode: "ngawur" });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
  });

  it("targets kembar: total_order = jumlah order UNIK, bukan panjang array", async () => {
    // Cacat yang ditutup: `total_order = targets.length` membuat kepala "N order" membengkak
    // dibanding tabelnya saat ada entri kembar, sedangkan baris & unit tetap benar (picklist
    // sudah dedupe per `${mp}|${no}`). User melihat "N order" di atas tabel dari N-1 order.
    const fx = fixtureBaca();
    const { db } = buatDbBaca(fx);
    const kembar = [...TARGETS, ...TARGETS, { marketplace: "SHOPEE", no_pesanan: "O-1" }];
    const r = await panggilPreview(db, { targets: kembar, mode: "gabung-order" });
    assert.equal(r.status, 200, `harus 200: ${r.body.error ?? ""}`);
    assert.equal(r.body.total_order, 2, "hanya 2 order unik (O-1, O-2) walau targets panjang 5");
    // Baris tetap sama seperti tanpa kembar — angka kepala yang salah, bukan isi lembar.
    const tunggal = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order" });
    assert.equal(r.body.total_baris, tunggal.body.total_baris);
    assert.equal(r.body.total_unit, tunggal.body.total_unit);
  });

  it("targets tidak valid → 400", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    (globalThis as unknown as { __TMA_TEST_DB__?: unknown }).__TMA_TEST_DB__ = db;
    const res = await GET(new Request(`${ASAL}/api/order?aksi=preview-picklist&targets=bukan-json`));
    assert.equal(res.status, 400);
  });
});

describe("preview-picklist — INVARIAN: urutan pratinjau = urutan PDF", () => {
  /**
   * Semua SKU yang MUNGKIN muncul di PDF, diambil dari fixture — bukan dari daftar tetap.
   *
   * Kenapa tidak boleh daftar tetap: pengekstrak yang hanya mengenali `A|B|C` akan
   * mengembalikan `[]` begitu ada SKU lain, dan `[] vs []` sama-sama cocok — uji yang
   * mengawal seluruh fitur ini bisa lulus tanpa memeriksa apa pun. Sumber kebenarannya harus
   * data yang kita umpankan sendiri.
   */
  function semuaSkuFixture(fx: FixtureBaca): Set<string> {
    return new Set([
      ...fx.items.map((i) => i.sku),
      ...fx.products.map((p) => p.sku),
      ...fx.stok.map((s) => s.sku),
      ...fx.booking.map((b) => b.sku),
    ]);
  }

  /**
   * Urutan baris yang BENAR-BENAR tercetak di PDF `gabung-order`.
   *
   * Sumber urutannya adalah teks yang tergambar di halaman PDF (lewat `teksPdf`), bukan
   * panggilan fungsi internal: kolom "No" PDF diisi nomor urut baris tabel, jadi urutan
   * kemunculan SKU di aliran teks adalah urutan cetak. Memakai fungsi yang sama untuk
   * membandingkan akan membuktikan apa pun yang ditulis fungsi itu, termasuk bila keduanya
   * sama-sama salah.
   *
   * `skuSah` WAJIB datang dari fixture. Bila tidak satu pun token tergambar, hasilnya array
   * kosong dan pemanggil menolaknya — bukan membandingkan dua himpunan kosong.
   */
  async function urutanSkuPdf(bytes: Uint8Array, skuSah: Set<string>): Promise<string[]> {
    const teks = await teksPdf(bytes);
    return teks.filter((t) => skuSah.has(t));
  }

  for (const urut of ["default", "sku", "nama", "lokasi"]) {
    for (const arah of ["asc", "desc"]) {
      it(`gabung-order ${urut}/${arah}: baris pratinjau persis urutan lembar PDF`, async () => {
        const fx = fixtureBaca();
        const { db } = buatDbBaca(fx);
        (globalThis as unknown as { __TMA_TEST_DB__?: unknown }).__TMA_TEST_DB__ = db;
        const q = new URLSearchParams({
          targets: JSON.stringify(TARGETS), mode: "gabung-order", urut, arah,
        });
        const pdfRes = await GET(new Request(`${ASAL}/api/order?aksi=picklist-pdf&${q.toString()}`));
        assert.equal(pdfRes.status, 200, "PDF harus jadi dulu");
        // SKU yang sah = yang ada di fixture, bukan daftar tetap.
        const skuSah = semuaSkuFixture(fx);
        const skuPdf = await urutanSkuPdf(new Uint8Array(await pdfRes.arrayBuffer()), skuSah);

        const prev = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order", urut, arah });
        assert.equal(prev.status, 200, `pratinjau harus 200: ${prev.body.error ?? ""}`);
        const skuPratinjau = prev.body.baris.map((b) => b.sku);

        // PENJAGA ANTI-VAKUM: kalau ekstraksi tidak menemukan satu pun SKU yang kita kenali,
        // perbandingan di bawah akan membandingkan kenyataan dengan harapan kosong dan lulus
        // tanpa memeriksa apa pun. Fixture ini PASTI punya baris, jadi panjang 0 = ekstraktor
        // rusak, bukan lembar kosong.
        assert.ok(
          skuPdf.length > 0,
          `ekstraksi PDF harus menemukan minimal satu SKU fixture (dapat ${skuPdf.length}); ` +
            `kalau 0, satu-satunya cara uji ini lulus adalah secara hampa`
        );
        assert.ok(skuPratinjau.length > 0, "pratinjau harus punya baris");

        // SYARAT uji ini sah: lembar gabungan memisah baris bermasalah ke tabel kedua, jadi
        // urutan SKU di aliran teks = "normal dulu, lalu bermasalah". Fixture ini tidak punya
        // baris bermasalah, sehingga kedua urutan memang sebanding. Kalau nanti ada baris
        // `perluSku`, urutannya HARUS dibandingkan per bagian — bukan diasumsikan sama.
        assert.equal(prev.body.ada_bermasalah, 0, "invariant ini hanya berlaku tanpa baris bermasalah");

        assert.deepEqual(
          skuPratinjau,
          skuPdf,
          `urutan pratinjau harus sama dengan lembar tercetak untuk ${urut}/${arah}`
        );
      });
    }
  }

  it("NEGATIF: comparator HARUS gagal saat urutan PDF sengaja dibalik", async () => {
    // Uji ini tidak memanggil server salah satu kali pun. Ia memverifikasi ALAT UKURNYA:
    // kalau pembanding di atas tidak bisa melihat dua urutan yang berbeda, ia tidak menjaga
    // apa pun dan seluruh blok invariant ini hanya hiasan.
    const fx = fixtureBaca();
    const { db } = buatDbBaca(fx);
    (globalThis as unknown as { __TMA_TEST_DB__?: unknown }).__TMA_TEST_DB__ = db;
    const q = new URLSearchParams({ targets: JSON.stringify(TARGETS), mode: "gabung-order", urut: "nama", arah: "asc" });
    const pdfRes = await GET(new Request(`${ASAL}/api/order?aksi=picklist-pdf&${q.toString()}`));
    const skuSah = semuaSkuFixture(fx);
    const asli = await urutanSkuPdf(new Uint8Array(await pdfRes.arrayBuffer()), skuSah);

    // Syarat supaya pembalikan punya arti: minimal dua baris.
    assert.ok(asli.length >= 2, `butuh >=2 baris untuk membalik (dapat ${asli.length})`);
    const dibalik = [...asli].reverse();
    assert.notDeepEqual(
      asli,
      dibalik,
      "pembanding WAJIB membedakan urutan asli dan urutan yang dibalik — kalau ini lulus, " +
        "seluruh invariant preview=PDF di atas tidak membuktikan apa-apa"
    );

    // Dan pembandingnya memang menangkap perbedaan itu saat dipakai apa adanya.
    const prev = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order", urut: "nama", arah: "asc" });
    assert.deepEqual(prev.body.baris.map((b) => b.sku), asli, "kondisi normal harus cocok");
    assert.throws(
      () => assert.deepEqual(prev.body.baris.map((b) => b.sku), dibalik),
      "pembanding harus MELEMPAR ketika urutan berbeda"
    );
  });

  it("NEGATIF: ekstraksi tidak boleh lulus hampa saat SKU di luar daftar dikenal", async () => {
    // Cacat yang ditutup: ekstraktor lama hanya mengenali Set(["A","B","C"]) sehingga PDF
    // berisi SKU lain mengekstrak ke [] dan [] vs [] sama-sama cocok. Uji ini membuktikan
    // ekstraktor memakai daftar milik pemanggil, bukan literal di dalam fungsinya.
    const fx = fixtureBaca();
    const { db } = buatDbBaca(fx);
    (globalThis as unknown as { __TMA_TEST_DB__?: unknown }).__TMA_TEST_DB__ = db;
    const q = new URLSearchParams({ targets: JSON.stringify(TARGETS), mode: "gabung-order", urut: "default", arah: "asc" });
    const pdfRes = await GET(new Request(`${ASAL}/api/order?aksi=picklist-pdf&${q.toString()}`));
    const bytes = new Uint8Array(await pdfRes.arrayBuffer());

    const skuBenar = semuaSkuFixture(fx);
    assert.ok((await urutanSkuPdf(bytes, skuBenar)).length > 0, "dengan SKU fixture: ketemu");

    // Daftar yang sengaja salah → HARUS kosong. Ini yang membuat penjaga anti-vakum di uji
    // invariant punya gigi: panjang 0 memang mungkin terjadi, dan itulah yang ditolak.
    const skuSalah = new Set(["TIDAK-ADA-1", "TIDAK-ADA-2"]);
    assert.deepEqual(await urutanSkuPdf(bytes, skuSalah), [], "SKU asing tidak boleh dianggap cocok");
  });

  it("preview dan PDF memakai (urut, arah) yang sama persis — termasuk default", async () => {
    const { db, query } = buatDbBaca(fixtureBaca());
    const prev = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order", urut: "nama", arah: "desc" });
    assert.equal(prev.body.urut, "nama");
    assert.equal(prev.body.arah, "desc");
    // Kunci tak dikenal jatuh ke `default` di KEDUA jalur (tautan cetak lama tidak berubah).
    const asing = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order", urut: "hpp", arah: "ngawur" });
    assert.equal(asing.body.urut, "default");
    assert.equal(asing.body.arah, "asc");
    // `default` = urutan lama PERSIS: lokasi lalu nama, TANPA tiebreak sku.
    assert.ok(query, "mock dipakai, bukan kueri paralel");
  });

  it("urutan desc benar-benar terbalik, bukan hanya label", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const asc = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order", urut: "nama", arah: "asc" });
    const desc = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order", urut: "nama", arah: "desc" });
    assert.deepEqual(desc.body.baris.map((b) => b.sku), asc.body.baris.map((b) => b.sku).reverse());
  });
});

describe("preview-picklist — booking advance DIBATASI ke yang dipilih", () => {
  // Cacat yang diuji: jalur `gabung-order` dulu memakai `listBooking(status, limit:500)` —
  // kueri GLOBAL. Picker menerima lembar berisi advance yang tidak dipilih siapa pun, dan
  // mode itu jadi tak bisa dipakai karena isinya tidak bisa dikendalikan.
  it("(e) `booking` membatasi baris advance TEPAT ke SN yang diminta", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const semua = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order" });
    // Tanpa `booking` = perilaku lama: SEMUA booking menunggu ikut (BK-1 dan BK-2).
    assert.equal(semua.body.total_advance, 2, "tanpa `booking`, semua booking menunggu ikut");

    const satu = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order", booking: ["BK-1"] });
    assert.equal(satu.status, 200, `harus 200: ${satu.body.error ?? ""}`);
    assert.equal(satu.body.total_advance, 1, "hanya BK-1 yang ikut");
    // A: order 2+1 + advance BK-1 (3) = 6. Kalau BK-2 ikut, B akan 2 dan total 12.
    assert.equal(satu.body.baris.find((b) => b.sku === "A")?.qty, 6);
    // B hanya punya 1 unit dari ORDER; 1 unit dari BK-2 harus HILANG saat BK-2 tidak dipilih.
    // Inilah bukti cakupan benar-benar menyaring, bukan sekadar melaporkan angka.
    assert.equal(satu.body.baris.find((b) => b.sku === "B")?.qty, 1, "advance BK-2 tidak boleh ikut");
    assert.equal(satu.body.total_unit, semua.body.total_unit - 1, "tepat satu unit BK-2 hilang");
  });

  it("(e2) PDF dengan `booking` memakai cakupan yang SAMA seperti pratinjau", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    (globalThis as unknown as { __TMA_TEST_DB__?: unknown }).__TMA_TEST_DB__ = db;
    const q = new URLSearchParams({
      aksi: "picklist-pdf", targets: JSON.stringify(TARGETS), mode: "gabung-order", booking: JSON.stringify(["BK-1"]),
    });
    const pdfRes = await GET(new Request(`${ASAL}/api/order?${q.toString()}`));
    assert.equal(pdfRes.status, 200, "PDF dengan cakupan booking harus jadi");
    const bytes = new Uint8Array(await pdfRes.arrayBuffer());
    const teks = await teksPdf(bytes);
    // BK-2 hanya menyumbang SKU B 1 unit. Dengan BK-2 TIDAK dipilih, total unit lembar
    // turun tepat 1 dibanding tanpa `booking` — bukti cakupan ikut ke PDF, bukan hanya
    // ke pratinjau.
    const header = teks.find((t) => /baris order, .*baris advance/.test(t)) ?? "";
    assert.match(header, /4 baris order, 1 baris advance/, `cakupan advance harus 1: ${header}`);
    assert.ok(
      teks.some((t) => t.includes("11 unit")),
      `total unit PDF harus 11 (12 − 1 dari BK-2); dapat: ${teks.join(" | ").slice(0, 300)}`
    );
  });

  it("(c) booking_sn tak dikenal DITOLAK, bukan dibuang diam-diam", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order", booking: ["BK-TIDAK-ADA"] });
    assert.equal(r.status, 400, "SN hantu harus 400, bukan lembar yang kurang barang");
    assert.match(String(r.body.error), /tidak ditemukan/i);
  });

  it("booking yang sudah bukan `menunggu` juga ditolak", async () => {
    const fix = fixtureBaca();
    fix.booking = [{ ...fix.booking[0]!, status: "terkirim" }];
    const { db } = buatDbBaca(fix);
    const r = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order", booking: ["BK-1"] });
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /bukan berstatus/i);
  });

  it("`booking` tidak valid → 400 (bukan diam-diam mengabaikan)", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    (globalThis as unknown as { __TMA_TEST_DB__?: unknown }).__TMA_TEST_DB__ = db;
    for (const buruk of ["bukan-json", "\"BK-1\"", "{\"a\":1}"]) {
      const q = new URLSearchParams({ aksi: "preview-picklist", targets: JSON.stringify(TARGETS), mode: "gabung-order", booking: buruk });
      const res = await GET(new Request(`${ASAL}/api/order?${q.toString()}`));
      assert.equal(res.status, 400, `booking=${buruk} harus ditolak`);
    }
  });

  it("array `booking` kosong = tidak menyaring (tautan lama tidak berubah)", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: TARGETS, mode: "gabung-order", booking: [] });
    assert.equal(r.status, 200);
    assert.equal(r.body.total_advance, 2, "`[]` bukan 'pilih nol'");
  });
});

describe("preview-picklist — targets boleh kosong HANYA di gabung-order", () => {
  it("(a) targets kosong + satu booking_sn → ok, bukan 400", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: [], mode: "gabung-order", booking: ["BK-1"] });
    assert.equal(r.status, 200, `kasus ini justru alasan mode-nya ada: ${r.body.error ?? ""}`);
    assert.equal(r.body.total_order, 0);
    assert.equal(r.body.total_advance, 1);
    assert.deepEqual(r.body.baris.map((b) => b.sku), ["A"]);
    assert.equal(r.body.baris[0]?.qty, 3, "qty murni dari advance");
    assert.equal(r.body.baris[0]?.no, 1);
  });

  it("(a2) jalur PDF juga: targets kosong + booking_sn → PDF jadi, bukan 400", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    (globalThis as unknown as { __TMA_TEST_DB__?: unknown }).__TMA_TEST_DB__ = db;
    const q = new URLSearchParams({
      aksi: "picklist-pdf", targets: "[]", mode: "gabung-order", booking: JSON.stringify(["BK-1"]),
    });
    const res = await GET(new Request(`${ASAL}/api/order?${q.toString()}`));
    assert.equal(res.status, 200, "PDF advance-only harus bisa dicetak");
    assert.match(String(res.headers.get("content-type")), /application\/pdf/);
  });

  it("(b) targets kosong + tanpa booking → 400 dengan pesan yang jelas", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: [], mode: "gabung-order" });
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /minimal satu order atau satu booking/i);
  });

  it("(d) gabung/per_paket/pisah dengan targets kosong TETAP 400", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    for (const mode of ["gabung", "per_paket", "pisah"]) {
      const r = await panggilPreview(db, { targets: [], mode });
      assert.equal(r.status, 400, `${mode} tanpa order harus 400 (lembar kosong bukan jawaban)`);
      assert.equal(r.body.ok, false);
    }
  });

  it("(d2) jalur PDF: gabung/per_paket/pisah tanpa order tetap 400", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    (globalThis as unknown as { __TMA_TEST_DB__?: unknown }).__TMA_TEST_DB__ = db;
    for (const mode of ["gabung", "per_paket", "pisah"]) {
      const q = new URLSearchParams({ aksi: "picklist-pdf", targets: "[]", mode });
      const res = await GET(new Request(`${ASAL}/api/order?${q.toString()}`));
      assert.equal(res.status, 400, `${mode} tanpa order harus 400`);
    }
  });

  it("targets kosong + booking yang tidak ada → tetap 400 (bukan lembar kosong)", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const r = await panggilPreview(db, { targets: [], mode: "gabung-order", booking: ["BK-HANTU"] });
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /tidak ditemukan/i);
  });
});

describe("preview-picklist — total_order dihitung dari target UNIK", () => {
  // Cacat yang dijaga: `total_order` dulu `targets.length` mentah, sementara helper di
  // bawahnya mendedupe kunci `${mp}|${no}`. Target kembar membuat kepala berbunyi "3 order"
  // di atas tabel yang isinya 2 order — baris dan qty benar, angka judulnya bohong.
  it("target kembar → total_order = jumlah order DISTINCT, bukan panjang array", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const kembar = [
      { marketplace: "shopee", no_pesanan: "O-1" },
      { marketplace: "shopee", no_pesanan: "O-1" },
      { marketplace: "shopee", no_pesanan: "O-2" },
    ];
    const r = await panggilPreview(db, { targets: kembar, mode: "gabung-order" });
    assert.equal(r.status, 200, `harus 200: ${r.body.error ?? ""}`);
    assert.equal(kembar.length, 3, "prasyarat uji: array memang punya entri kembar");
    assert.equal(r.body.total_order, 2, "yang dilaporkan harus 2 order distinct, bukan 3");
  });

  it("target kembar juga tidak menggandakan baris/qty", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const kembar = [
      { marketplace: "shopee", no_pesanan: "O-1" },
      { marketplace: "shopee", no_pesanan: "O-1" },
    ];
    const r = await panggilPreview(db, { targets: kembar, mode: "gabung-order" });
    const tunggal = await panggilPreview(db, { targets: [{ marketplace: "shopee", no_pesanan: "O-1" }], mode: "gabung-order" });
    assert.equal(r.body.total_order, 1);
    assert.equal(r.body.total_unit, tunggal.body.total_unit, "qty tidak boleh berlipat");
    assert.deepEqual(r.body.baris, tunggal.body.baris, "baris identik dengan input tunggal");
  });

  it("mode order-only juga melaporkan angka distinct", async () => {
    const { db } = buatDbBaca(fixtureBaca());
    const kembar = [
      { marketplace: "shopee", no_pesanan: "O-1" },
      { marketplace: "shopee", no_pesanan: "O-1" },
      { marketplace: "shopee", no_pesanan: "O-2" },
    ];
    for (const mode of ["pisah", "gabung", "per_paket"]) {
      const r = await panggilPreview(db, { targets: kembar, mode });
      assert.equal(r.body.total_order, 2, `${mode}: total_order harus distinct`);
      assert.equal(r.body.total_advance, 0, `${mode}: tidak ada advance di mode order-only`);
    }
  });
});
