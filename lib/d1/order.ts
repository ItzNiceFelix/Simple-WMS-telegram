// lib/d1/order.ts — Impor pesanan + CRUD/transisi (stok). Laba pindah ke /laba per preset (A4).
import { gagal, sekarang, type Hasil } from "./hasil";
import { ambilProduk } from "./produk";
import { bacaQty, GUDANG_ONLINE } from "./stok";

export type OrderItem = {
  sku: string; qty: number; harga_satuan: number; hpp_snapshot: number;
  variasi?: string; nama_shopee?: string;
  /** SKU belum ada di master: baris ini menunggu dipetakan, bukan barang siap kirim. */
  perlu_sku?: boolean;
  /** SKU asal yang tertulis di file, untuk ditampilkan saat baris bermasalah. */
  sku_asal?: string;
};
export type OrderFee = { jenis: string; basis: "flat" | "persen"; nilai: number };
export type BarisPesanan = {
  marketplace: string; no_pesanan: string; tanggal: number; buyer: string;
  sku: string; qty: number; harga_satuan: number;
};

type ItemGrup = { sku: string; qty: number; harga: number; hpp: number };
type GrupPesanan = {
  mp: string; no: string; tanggal: number; buyer: string;
  items: ItemGrup[];
};

/** Impor batch baris pesanan: kelompok per order, beku hpp_snapshot. Idempoten. Tanpa fee/pajak (laba di /laba). */
export async function imporPesanan(db: D1Database, daftar: BarisPesanan[], oleh: string | null): Promise<Hasil<{ order: number; item: number }>> {
  void oleh;
  for (const b of daftar) {
    if (!Number.isInteger(b.qty) || b.qty < 1) return gagal(400, `Qty ${b.sku} harus bilangan bulat ≥ 1 (order ${b.no_pesanan}).`);
    if (!Number.isInteger(b.harga_satuan) || b.harga_satuan < 0) return gagal(400, `Harga ${b.sku} harus bilangan bulat ≥ 0 (order ${b.no_pesanan}).`);
  }
  const grup: Record<string, GrupPesanan> = {};
  const urutan: string[] = [];
  for (const b of daftar) {
    const k = `${b.marketplace} ${b.no_pesanan}`;
    let g = grup[k];
    if (!g) {
      g = grup[k] = { mp: b.marketplace, no: b.no_pesanan, tanggal: b.tanggal, buyer: b.buyer ?? "", items: [] };
      urutan.push(k);
    }
    g.items.push({ sku: b.sku, qty: b.qty, harga: b.harga_satuan, hpp: 0 });
  }
  const hppCache = new Map<string, number>();
  for (const k of urutan) {
    const g = grup[k];
    for (const it of g.items) {
      // B5-A: cache HPP per SKU unik (ganti N SELECT products per baris).
      let hpp = hppCache.get(it.sku);
      if (hpp === undefined) {
        const p = await ambilProduk(db, it.sku);
        if (!p) return gagal(400, `SKU ${it.sku} tidak dikenal (order ${g.no}).`);
        hpp = p.hpp ?? 0;
        hppCache.set(it.sku, hpp);
      }
      it.hpp = hpp;
    }
  }
  const stmts: D1PreparedStatement[] = [];
  let nItem = 0;
  for (const k of urutan) {
    const g = grup[k];
    stmts.push(db.prepare("INSERT OR IGNORE INTO orders (marketplace, no_pesanan, tanggal, buyer) VALUES (?, ?, ?, ?)").bind(g.mp, g.no, g.tanggal, g.buyer));
    // Ruling Task 3→4: reimport UPDATE header KECUALI status_fulfill (first-wins ditolak).
    stmts.push(db.prepare("UPDATE orders SET tanggal = ?, buyer = ? WHERE marketplace = ? AND no_pesanan = ?").bind(g.tanggal, g.buyer, g.mp, g.no));
    for (const it of g.items) {
      stmts.push(db.prepare("INSERT OR REPLACE INTO order_items (marketplace, no_pesanan, sku, qty, harga_satuan, hpp_snapshot, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(g.mp, g.no, it.sku, it.qty, it.harga, it.hpp, it.qty * it.harga));
      nItem++;
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { ok: true, order: urutan.length, item: nItem };
}

export { transisiFulfill, transisiFulfillBatch, type KeFulfill, type TargetFulfill } from "./orderTransisi";

export type OrderDetail = {
  marketplace: string; no_pesanan: string; tanggal: number; buyer: string;
  no_resi: string;
  /** Diisi saat impor Shopee; "" bila file tidak memuatnya. Ditampilkan di kolom Pengiriman. */
  jasa_kirim: string; tipe_layanan: string;
  status_fulfill: string; pajak_pph: boolean; pajak_ppn_persen: number;
  items: (OrderItem & { subtotal: number })[];
  fees: (OrderFee & { amount: number })[];
};

/** Header + item + fee satu pesanan; null bila tak ada. */
export async function ambilOrder(db: D1Database, mp: string, no: string): Promise<OrderDetail | null> {
  const h = await db.prepare("SELECT marketplace, no_pesanan, tanggal, buyer, no_resi, jasa_kirim, tipe_layanan, status_fulfill, pajak_pph, pajak_ppn_persen FROM orders WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).first<{ marketplace: string; no_pesanan: string; tanggal: number; buyer: string; no_resi: string; jasa_kirim: string | null; tipe_layanan: string | null; status_fulfill: string; pajak_pph: number; pajak_ppn_persen: number }>();
  if (!h) return null;
  // `perlu_sku`/`sku_asal` ikut dibaca supaya halaman order bisa memperingatkan sebelum
  // mencetak picklist yang isinya belum lengkap. Tipe hasil query ditulis sendiri (bukan
  // irisan dengan OrderItem) karena `perlu_sku` di DB berupa 0/1, bukan boolean.
  const { results: barisItem } = await db
    .prepare("SELECT sku, variasi, nama_shopee, qty, harga_satuan, hpp_snapshot, subtotal, perlu_sku, sku_asal FROM order_items WHERE marketplace = ? AND no_pesanan = ? ORDER BY sku, variasi")
    .bind(mp, no)
    .all<{
      sku: string; variasi: string | null; nama_shopee: string | null; qty: number;
      harga_satuan: number; hpp_snapshot: number; subtotal: number;
      perlu_sku: number | null; sku_asal: string | null;
    }>();
  const items: (OrderItem & { subtotal: number })[] = barisItem.map((it) => ({
    sku: it.sku,
    qty: it.qty,
    harga_satuan: it.harga_satuan,
    hpp_snapshot: it.hpp_snapshot,
    variasi: it.variasi ?? "",
    nama_shopee: it.nama_shopee ?? "",
    subtotal: it.subtotal,
    perlu_sku: it.perlu_sku === 1,
    sku_asal: it.sku_asal ?? "",
  }));
  const { results: fees } = await db.prepare("SELECT jenis, basis, nilai, amount FROM order_fees WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).all<OrderFee & { amount: number }>();
  return { marketplace: h.marketplace, no_pesanan: h.no_pesanan, tanggal: h.tanggal, buyer: h.buyer, no_resi: h.no_resi ?? "", jasa_kirim: h.jasa_kirim ?? "", tipe_layanan: h.tipe_layanan ?? "", status_fulfill: h.status_fulfill, pajak_pph: h.pajak_pph === 1, pajak_ppn_persen: h.pajak_ppn_persen, items, fees };
}

export type FilterOrder = {
  mp?: string;
  status?: string;
  dari?: number;
  sampai?: number;
  /** SKU yang harus ADA di order; hanya dipakai untuk mode daftar item (lihat listItemOrder). */
  sku?: string;
  /** Toko pemilik order. Satu D1 dipakai beberapa toko dan fee berbeda per akun, jadi daftar
   *  per toko TIDAK boleh tercampur. NULL = baris lama yang belum ditandai (lihat migrasi 0040). */
  presetId?: number;
  limit?: number;
  offset?: number;
  kolomUrut?: KolomUrutOrder;
  arah?: ArahUrut;
};
export type RingkasOrder = {
  marketplace: string; no_pesanan: string; tanggal: number; buyer: string;
  no_resi: string; status_fulfill: string;
};

/**
 * Kolom yang boleh diurutkan server-side — PETUNJUK untuk pemanggil, bukan pengaman.
 *
 * `no_resi` ADA di daftar ini walau selalu "" untuk mayoritas order (hanya order bergrup resi
 * yang punya). Urutannya tetap deterministik lewat tiebreaker, jadi tidak ada baris yang
 * terlewat di antara halaman.
 *
 * Kolom yang TAMPIL di tabel /order tapi TIDAK bisa diurutkan server-side, dan alasannya:
 *   - Item (jumlah qty)  : SUM(qty) lintas order_items, bukan kolom tabel orders. Untuk
 *                          mengurutkannya harus agregasi JOIN + GROUP BY, dan paginasi jadi
 *                          terpotong di tengah order (kelas bug yang sudah ditulis di /api/baca).
 *   - Total (rupiah)     : SUM(subtotal) — alasan sama dengan Item.
 *   - Pengiriman         : gabungan dua kolom (jasa_kirim + tipe_layanan) yang ditampilkan
 *                          klien dengan " · "; bukan satu ekspresi kolom.
 * Karena itu kolom-kolom itu, kalau mau, harus diurutkan di KLIEN SETELAH halaman termuat —
 * dan urutan klien hanya benar untuk halaman itu, bukan seluruh dataset.
 */
export const KOLOM_URUT_ORDER = ["marketplace", "no_pesanan", "no_resi", "tanggal", "status_fulfill"] as const;
export type KolomUrutOrder = (typeof KOLOM_URUT_ORDER)[number];
export type ArahUrut = "asc" | "desc";

/**
 * Tiebreaker paginasi. WAJIB, bukan hiasan.
 *
 * `tanggal` di-anchor ke tengah malam UTC dan SATU KALI impor menulis tanggal yang SAMA ke
 * seluruh batch (lihat imporPesanan: satu `g` per grup, tanggal dari berkas). Jadi ratusan
 * baris bisa berbagi (tanggal) yang identik — dan dengan `ORDER BY tanggal DESC` saja, SQLite
 * bebas mengembalikan baris-baris itu dalam urutan apa pun, BEDA antar pemanggilan.
 *
 * Akibatnya pada paginasi: baris yang sudah tampil di halaman 1 bisa muncul LAGI di halaman 2,
 * dan baris lain tidak pernah tampil sama sekali. Itu bug yang tidak terlihat di layar (daftar
 * tetap "penuh") tapi membuat order hilang dari pandangan checker.
 *
 * Primary key `orders` adalah (marketplace, no_pesanan) dan unik, jadi pasangan itu memberi
 * urutan TOTAL yang tidak bisa seri. Arah kedua kolom mengikuti arah utama supaya "terbaru
 * dulu" juga berarti "no_pesanan menurun" saat tanggalnya sama — konsisten, bukan campur.
 */
export const TIEBREAKER_ORDER = "marketplace ASC, no_pesanan ASC";

/** Peta kolom urut → ekspresi SQL. Nilai di sini SATU-SATUNYA yang boleh masuk ORDER BY. */
const URUT_SQL: Record<KolomUrutOrder, string> = {
  marketplace: "marketplace",
  no_pesanan: "no_pesanan",
  no_resi: "no_resi",
  tanggal: "tanggal",
  status_fulfill: "status_fulfill",
};

/** Susun WHERE yang dipakai BARENGAN oleh query daftar dan COUNT. Satu sumber, jadi
 *  jumlah halaman tidak mungkin menghitung himpunan yang berbeda dari yang dipaginasi. */
function syaratOrder(filter: FilterOrder): { where: string; args: unknown[] } {
  const syarat: string[] = [];
  const args: unknown[] = [];
  if (filter.mp) { syarat.push("marketplace = ?"); args.push(filter.mp); }
  if (filter.status) { syarat.push("status_fulfill = ?"); args.push(filter.status); }
  if (filter.dari !== undefined) { syarat.push("tanggal >= ?"); args.push(filter.dari); }
  if (filter.sampai !== undefined) { syarat.push("tanggal <= ?"); args.push(filter.sampai); }
  if (filter.presetId !== undefined) { syarat.push("preset_id = ?"); args.push(filter.presetId); }
  return { where: syarat.length > 0 ? ` WHERE ${syarat.join(" AND ")}` : "", args };
}

/** ORDER BY dari allowlist; nilai tak dikenal jatuh ke default (tanggal DESC). */
export function urutOrder(filter: FilterOrder): string {
  const kolom = filter.kolomUrut && URUT_SQL[filter.kolomUrut] ? URUT_SQL[filter.kolomUrut] : URUT_SQL.tanggal;
  const arah = filter.kolomUrut && filter.arah === "asc" ? "ASC" : "DESC";
  return ` ORDER BY ${kolom} ${arah}, ${TIEBREAKER_ORDER}`;
}

/**
 * Daftar header order + jumlah total untuk paginasi.
 *
 * COUNT(*) dijalankan atas WHERE yang SAMA dengan query halaman; kalau keduanya berbeda
 * sedikit saja, footer halaman menunjuk halaman yang isinya kosong.
 */
export async function listOrder(
  db: D1Database,
  filter: FilterOrder
): Promise<{ orders: RingkasOrder[]; total: number }> {
  const { where, args } = syaratOrder(filter);
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const { results } = await db
    .prepare(`SELECT marketplace, no_pesanan, tanggal, buyer, no_resi, status_fulfill FROM orders${where}${urutOrder(filter)} LIMIT ? OFFSET ?`)
    .bind(...args, limit, offset)
    .all<RingkasOrder>();
  const hitung = await db.prepare(`SELECT COUNT(*) AS total FROM orders${where}`).bind(...args).first<{ total: number }>();
  return { orders: results, total: hitung?.total ?? 0 };
}

/**
 * Daftar order yang PUNYA `sku` tertentu — jalur filter SKU halaman order.
 *
 * Kenapa terpisah dari listOrder, bukan "ambil 200 lalu saring di memori": menyaring setelah
 * paginasi membuat halaman berisi 200 baris hanya menyisakan segelintir order ber-SKU itu,
 * sementara total yang dilaporkan tetap 200. Halaman tampak hampir kosong dan nomor halamannya
 * menunjuk himpunan yang salah. Dengan subquery `EXISTS`, himpunan yang dipaginasi = himpunan
 * yang difilter, jadi total dan isi halaman selalu sepakat.
 *
 * `EXISTS` dipilih ketimbang `IN (SELECT ...)`: SQLite mengevaluasi EXISTS sebagai semi-join
 * yang berhenti di baris pertama yang cocok — cukup satu item per order, dan tidak ada daftar
 * SKU yang perlu diduplikasi di memori.
 */
export async function listOrderBerSku(
  db: D1Database,
  filter: FilterOrder & { sku: string }
): Promise<{ orders: RingkasOrder[]; total: number }> {
  const { where, args } = syaratOrder(filter);
  const whereSku = `${where}${where ? " AND" : " WHERE"} EXISTS (SELECT 1 FROM order_items i WHERE i.marketplace = orders.marketplace AND i.no_pesanan = orders.no_pesanan AND i.sku = ?)`;
  const argsSku = [...args, filter.sku];
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const { results } = await db
    .prepare(`SELECT marketplace, no_pesanan, tanggal, buyer, no_resi, status_fulfill FROM orders${whereSku}${urutOrder(filter)} LIMIT ? OFFSET ?`)
    .bind(...argsSku, limit, offset)
    .all<RingkasOrder>();
  const hitung = await db.prepare(`SELECT COUNT(*) AS total FROM orders${whereSku}`).bind(...argsSku).first<{ total: number }>();
  return { orders: results, total: hitung?.total ?? 0 };
}

/**
 * Batas parameter D1 per pernyataan. Sama dengan pola picklist.ts/picklistEkspor.ts/stokOnline.ts
 * (UKURAN_BATCH = 50) supaya tidak ada angka ajaib kedua di repo ini.
 *
 * Arithmetic pemakaian di jalur daftar: tiap potongan memakai 2 parameter per order
 * (marketplace + no_pesanan) — jadi 50 order = 100 parameter, jauh di bawah plafon 100
 * parameter D1 per pernyataan yang sudah jadi alasan pemotongan di seluruh repo.
 */
const POTONG_ORDER = 50;

/** Idempoten dan berulang: pasangan (mp, no) yang sama muncul sekali. */
type KunciOrder = { mp: string; no: string };

function kunciUnik(orders: KunciOrder[]): KunciOrder[] {
  return [...new Map(orders.map((o) => [`${o.mp}|${o.no}`, o])).values()];
}

/**
 * Header + item + fee untuk BANYAK order sekaligus — pengganti loop `ambilOrder` per baris.
 *
 * Kenapa ada: `ambilOrder` menjalankan 3 kueri per order. Daftar 200 baris = 600 kueri
 * berurutan, dan Worker Free mati di plafon ~50 kueri per invokasi jauh sebelum selesai.
 * Di sini jumlah kueri hanya bergantung pada JUMLAH POTONGAN, bukan jumlah order.
 *
 * Hasil selalu berisi SEMUA order yang diminta (yang tak ada di DB punya items/fees kosong);
 * pemanggil yang menentukan order mana yang benar-benar ditampilkan.
 */
export async function ambilOrderBanyak(db: D1Database, orders: KunciOrder[]): Promise<OrderDetail[]> {
  const unik = kunciUnik(orders);
  if (unik.length === 0) return [];
  const headers: OrderDetail[] = [];
  for (let i = 0; i < unik.length; i += POTONG_ORDER) {
    const potong = unik.slice(i, i + POTONG_ORDER);
    const pasangan = potong.map(() => "(marketplace = ? AND no_pesanan = ?)").join(" OR ");
    const args = potong.flatMap((o) => [o.mp, o.no]);
    const { results } = await db
      .prepare(`SELECT marketplace, no_pesanan, tanggal, buyer, no_resi, jasa_kirim, tipe_layanan, status_fulfill, pajak_pph, pajak_ppn_persen FROM orders WHERE ${pasangan}`)
      .bind(...args)
      .all<{
        marketplace: string; no_pesanan: string; tanggal: number; buyer: string; no_resi: string | null;
        jasa_kirim: string | null; tipe_layanan: string | null; status_fulfill: string;
        pajak_pph: number; pajak_ppn_persen: number;
      }>();
    for (const h of results) {
      headers.push({
        marketplace: h.marketplace,
        no_pesanan: h.no_pesanan,
        tanggal: h.tanggal,
        buyer: h.buyer,
        no_resi: h.no_resi ?? "",
        jasa_kirim: h.jasa_kirim ?? "",
        tipe_layanan: h.tipe_layanan ?? "",
        status_fulfill: h.status_fulfill,
        pajak_pph: h.pajak_pph === 1,
        pajak_ppn_persen: h.pajak_ppn_persen,
        items: [],
        fees: [],
      });
    }
  }
  const peta = new Map(headers.map((h) => [`${h.marketplace}|${h.no_pesanan}`, h]));
  // Satu kueri item per potongan untuk SEMUA order di potongan itu. IN (pasangan) dipilih
  // ketimbang IN (no_pesanan) karena no_pesanan bisa sama di marketplace berbeda; mengunci
  // ke pasangan membuat baris tidak bisa nyasar ke order marketplace lain.
  for (let i = 0; i < unik.length; i += POTONG_ORDER) {
    const potong = unik.slice(i, i + POTONG_ORDER);
    const pasangan = potong.map(() => "(marketplace = ? AND no_pesanan = ?)").join(" OR ");
    const args = potong.flatMap((o) => [o.mp, o.no]);
    const { results } = await db
      .prepare(`SELECT marketplace, no_pesanan, sku, variasi, nama_shopee, qty, harga_satuan, hpp_snapshot, subtotal, perlu_sku, sku_asal FROM order_items WHERE ${pasangan} ORDER BY sku, variasi`)
      .bind(...args)
      .all<{
        marketplace: string; no_pesanan: string; sku: string; variasi: string | null;
        nama_shopee: string | null; qty: number; harga_satuan: number; hpp_snapshot: number;
        subtotal: number; perlu_sku: number | null; sku_asal: string | null;
      }>();
    for (const it of results) {
      peta.get(`${it.marketplace}|${it.no_pesanan}`)?.items.push({
        sku: it.sku,
        qty: it.qty,
        harga_satuan: it.harga_satuan,
        hpp_snapshot: it.hpp_snapshot,
        variasi: it.variasi ?? "",
        nama_shopee: it.nama_shopee ?? "",
        subtotal: it.subtotal,
        perlu_sku: it.perlu_sku === 1,
        sku_asal: it.sku_asal ?? "",
      });
    }
  }
  // Fee: satu kueri per potongan, sama seperti item. `order_fees` boleh punya BANYAK baris per
  // order (CHECK-nya mengizinkan), jadi pengelompokan dilakukan lewat peta, bukan diasumsikan.
  for (let i = 0; i < unik.length; i += POTONG_ORDER) {
    const potong = unik.slice(i, i + POTONG_ORDER);
    const pasangan = potong.map(() => "(marketplace = ? AND no_pesanan = ?)").join(" OR ");
    const args = potong.flatMap((o) => [o.mp, o.no]);
    const { results } = await db
      .prepare(`SELECT marketplace, no_pesanan, jenis, basis, nilai, amount FROM order_fees WHERE ${pasangan}`)
      .bind(...args)
      .all<OrderFee & { marketplace: string; no_pesanan: string; amount: number }>();
    for (const f of results) {
      peta.get(`${f.marketplace}|${f.no_pesanan}`)?.fees.push({ jenis: f.jenis, basis: f.basis, nilai: f.nilai, amount: f.amount });
    }
  }
  // Urutan keluaran = urutan permintaan, supaya pemanggil bisa memakai hasilnya berpasangan
  // dengan daftar header yang dia kirim.
  return unik.map((o) => peta.get(`${o.mp}|${o.no}`)).filter((d): d is OrderDetail => d !== undefined);
}

/** Laba satu order persis seperti yang terakhir diimpor untuk preset itu. */
export type LabaOrder = {
  laba: number;
  /** Persen, satu desimal; null saat omzet 0 — margin atas nol tidak terdefinisi, bukan 0%. */
  margin: number | null;
  biaya: number;
  tanggal_snapshot: string;
};

/**
 * Laba per no_pesanan dari `laba_order`, hanya untuk daftar nomor yang diminta.
 *
 * Kenapa IN atas halaman, bukan query seluruh tabel: tabel ini berisi semua order semua
 * tanggal semua preset. Membacanya utuh lalu menyaring di Worker memindahkan ribuan baris
 * untuk melengkapi 50 baris layar. Pemotongan 50 sama dengan `klasifikasikan`
 * (lib/d1/labaPreset.ts) karena No pesanan disimpan sebagai teks — parameter D1 punya plafon.
 *
 * Order tanpa baris di sini TIDAK dikembalikan sebagai 0: pemanggil merender "—" supaya
 * "belum pernah diimpor labanya" tidak terbaca sebagai "labanya nol".
 */
export async function labaPerOrder(
  db: D1Database,
  presetId: number,
  noPesanan: string[]
): Promise<Map<string, LabaOrder>> {
  const hasil = new Map<string, LabaOrder>();
  const unik = [...new Set(noPesanan)].filter((s) => s.length > 0);
  for (let i = 0; i < unik.length; i += POTONG_ORDER) {
    const potong = unik.slice(i, i + POTONG_ORDER);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db.prepare(
      `SELECT no_pesanan, laba, omzet, biaya, tanggal_snapshot FROM laba_order WHERE preset_id = ? AND no_pesanan IN (${tanda})`
    ).bind(presetId, ...potong).all<{ no_pesanan: string; laba: number; omzet: number; biaya: number; tanggal_snapshot: string }>();
    for (const r of results) {
      hasil.set(r.no_pesanan, {
        laba: r.laba,
        biaya: r.biaya,
        tanggal_snapshot: r.tanggal_snapshot,
        // Pembulatan ke 1 desimal: persen mentah (mis. 33.3333) memenuhi kolom dan tidak
        // menambah keputusan apa pun di layar.
        margin: r.omzet > 0 ? Math.round((r.laba / r.omzet) * 1000) / 10 : null,
      });
    }
  }
  return hasil;
}
