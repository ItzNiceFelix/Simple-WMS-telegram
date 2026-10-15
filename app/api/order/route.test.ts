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
import { POST } from "./route";

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
  const res = await POST(req(body));
  return { status: res.status, body: (await res.json()) as Jawaban };
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
    const r = await panggil(db, { aksi: "konfirmasi-shopee", batch_id: 7 });
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
      aksi: "konfirmasi-shopee", batch_id: 7,
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
      aksi: "konfirmasi-shopee", batch_id: 7,
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
    const r = await panggil(fake.db, { aksi: "konfirmasi-shopee", batch_id: 7 });
    assert.notEqual(r.status, 200, "semua gagal bukan sukses");
    assert.equal(r.body.ok, false);
    assert.match(String(r.body.error), /masalah skema|ditolak/i);
  });
});
