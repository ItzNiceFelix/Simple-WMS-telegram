// lib/kledo/sinkron.ts — Mesin sinkronisasi Kledo → D1 (SATU ARAH).
//
// BATAS MUTLAK: hanya MEMBACA Kledo. Tidak ada penulisan ke Kledo, dalam keadaan apa pun.
//
// Empat tahap, urut (stok butuh kedua sisi sudah punya id):
//   1 GUDANG  : namakan gudang Kledo → cocokkan ke warehouses lewat NAMA (bukan id!)
//   2 PRODUK  : products.sku = Produk.code; hpp = avg_base_price (bukan `hpp`)
//   3 STOK    : stock_by_bin.qty per gudang, dari stocks[warehouse_id]
//   4 LAPORAN : tulis kledo_sync + kledo_sync_galat
//
// Aturan yang mengikat (dikonfirmasi user + temuan live):
//   * HPP ditimpa HANYA bila Kledo memberi angka >= 1 setelah pembulatan. Ada produk berstok
//     774 dengan avg_base_price = 0; menimpanya berarti merusak HPP yang benar.
//     Urutan: avg_base_price → last_buy_prices → PERTAHANKAN HPP D1.
//   * Produk/gudang yang hilang dari Kledo TIDAK dihapus (akan merusak ledger stock_moves).
//   * `ONLINE` (gudang virtual WMS) tidak pernah dipetakan/disentuh.
//   * stock_by_bin ditimpa penuh; ledger hanya mencatat DRIFT, bukan tiap baris.
//   * is_online_product TIDAK disentuh.
import { sekarang } from "@/lib/d1/hasil";
import {
  ambilGudang as kledoAmbilGudang,
  ambilProduk as kledoAmbilProduk,
  ambilStok as kledoAmbilStok,
  ambilHargaBeliTerakhir,
  type OpsiKledo,
  type GudangKledo,
  type ProdukKledo,
} from "./klien";

export const GUDANG_VIRTUAL = "ONLINE";

export type HasilSinkron = {
  syncId: number;
  status: "sukses" | "sebagian" | "gagal";
  gudangBaru: number;
  gudangUbah: number;
  produkBaru: number;
  produkUbah: number;
  hppDipertahankan: number;
  stokBaris: number;
  stokDrift: number;
  galat: number;
  durasiMs: number;
};

type Galat = { bagian: string; ref: string | null; pesan: string };

/** Samakan nama untuk pencocokan: huruf kecil, tanpa tanda baca, spasi tunggal. */
export function normNama(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * HPP akhir dari data Kledo.
 * Mengembalikan null bila TIDAK ADA angka yang layak — pemanggil wajib mempertahankan HPP D1.
 * `avg_base_price` bisa desimal (5620.84) → dibulatkan; bisa juga 0.0006892 → dibulatkan jadi 0
 * dan itu TIDAK layak dipakai.
 */
export function hppDariKledo(avgBasePrice: unknown, fallbackTerakhir?: number): number | null {
  const angka = Number(avgBasePrice);
  if (Number.isFinite(angka) && angka >= 1) return Math.round(angka);
  if (typeof fallbackTerakhir === "number" && Number.isFinite(fallbackTerakhir) && fallbackTerakhir >= 1) {
    return Math.round(fallbackTerakhir);
  }
  return null;
}

/** Buat baris laporan sinkronisasi; kembalikan id-nya. */
async function mulaiLaporan(db: D1Database, pemicu: string, oleh: string | null): Promise<number> {
  const r = await db
    .prepare("INSERT INTO kledo_sync (jenis, pemicu, status, oleh) VALUES ('semua', ?, 'jalan', ?)")
    .bind(pemicu === "jadwal" ? "jadwal" : "manual", oleh)
    .run();
  const id = Number(r.meta?.last_row_id ?? 0);
  if (id > 0) return id;
  const cari = await db.prepare("SELECT id FROM kledo_sync ORDER BY id DESC LIMIT 1").first<{ id: number }>();
  return cari?.id ?? 0;
}

/** Cek apakah masih ada sinkronisasi yang berjalan (pagar anti-tumpang-tindih). */
export async function adaSinkronBerjalan(db: D1Database, maksUmurDetik = 1800): Promise<boolean> {
  const baris = await db
    .prepare("SELECT id FROM kledo_sync WHERE status = 'jalan' AND mulai_at > ? LIMIT 1")
    .bind(sekarang() - maksUmurDetik)
    .first();
  return !!baris;
}

/**
 * Jalankan sinkronisasi penuh.
 * `db` adalah D1; `klien` adalah opsi koneksi (subdomain + token plaintext).
 */
export async function jalankanSinkron(
  db: D1Database,
  klien: OpsiKledo,
  opsi: { pemicu?: string; oleh?: string | null } = {}
): Promise<HasilSinkron> {
  const mulai = Date.now();
  const galat: Galat[] = [];
  const syncId = await mulaiLaporan(db, opsi.pemicu ?? "manual", opsi.oleh ?? null);

  let gudangBaru = 0, gudangUbah = 0;
  let produkBaru = 0, produkUbah = 0, hppDipertahankan = 0;
  let stokBaris = 0, stokDrift = 0;
  const at = sekarang();

  const catat = (bagian: string, ref: string | null, pesan: string) => {
    galat.push({ bagian, ref, pesan });
  };

  // ══ TAHAP 1: GUDANG ══
  const hGudang = await kledoAmbilGudang(klien);
  if (!hGudang.ok) {
    await akhiriLaporan(db, syncId, "gagal", { pesan: `Gudang: ${hGudang.error}`, durasiMs: Date.now() - mulai, galat });
    return { syncId, status: "gagal", gudangBaru: 0, gudangUbah: 0, produkBaru: 0, produkUbah: 0, hppDipertahankan: 0, stokBaris: 0, stokDrift: 0, galat: 1, durasiMs: Date.now() - mulai };
  }

  // Peta: kledo_id (string) -> warehouses.id lokal. HANYA gudang yang dipetakan.
  const petaGudang = new Map<string, string>();

  const lokal = await db
    .prepare("SELECT id, nama, code, kledo_id FROM warehouses WHERE is_online = 0")
    .all<{ id: string; nama: string; code: string; kledo_id: number | null }>();
  const daftarLokal = lokal.results ?? [];

  for (const g of hGudang.data) {
    const kledoId = String(g.id);
    // 1a. Sudah pernah dipetakan? pakai itu.
    const sdhAda = await db
      .prepare("SELECT lokal_id FROM kledo_map WHERE jenis = 'gudang' AND kledo_id = ?")
      .bind(kledoId)
      .first<{ lokal_id: string }>();
    if (sdhAda) {
      petaGudang.set(kledoId, sdhAda.lokal_id);
      // Perbarui nama bila berubah di Kledo.
      const target = daftarLokal.find((l) => l.id === sdhAda.lokal_id);
      if (target && normNama(target.nama) !== normNama(g.name)) {
        await db.prepare("UPDATE warehouses SET nama = ?, updated_at = ? WHERE id = ?").bind(g.name, at, target.id).run();
        gudangUbah++;
      }
      await db.prepare("UPDATE kledo_map SET nama_snapshot = ?, terakhir_dilihat = ? WHERE jenis = 'gudang' AND kledo_id = ?")
        .bind(g.name, at, kledoId).run();
      continue;
    }

    // 1b. Cocokkan lewat NAMA (bukan id! warehouses.id D1 bukan id Kledo).
    const cocok = daftarLokal.find((l) => l.kledo_id === g.id) ??
      daftarLokal.find((l) => normNama(l.nama) === normNama(g.name)) ??
      daftarLokal.find((l) => normNama(l.code) === normNama(g.code));

    if (cocok) {
      await db.prepare("UPDATE warehouses SET kledo_id = ?, kledo_synced_at = ?, updated_at = ?, updated_by = 'kledo' WHERE id = ?")
        .bind(g.id, at, at, cocok.id).run();
      await db.prepare("INSERT INTO kledo_map (jenis, kledo_id, lokal_id, nama_snapshot, terakhir_dilihat) VALUES ('gudang', ?, ?, ?, ?) ON CONFLICT(jenis, kledo_id) DO UPDATE SET lokal_id = excluded.lokal_id, nama_snapshot = excluded.nama_snapshot, terakhir_dilihat = excluded.terakhir_dilihat")
        .bind(kledoId, cocok.id, g.name, at).run();
      petaGudang.set(kledoId, cocok.id);
      cocok.kledo_id = g.id;
      gudangUbah++;
      continue;
    }

    // 1c. Belum ada di D1 → TAMBAHKAN (permintaan user: gudang Kledo yang belum ada harus masuk).
    const idBaru = `K${String(g.id)}`;
    const urut = await db.prepare("SELECT COALESCE(MAX(urutan), 0) + 1 AS n FROM warehouses").first<{ n: number }>();
    const bentrok = await db.prepare("SELECT id FROM warehouses WHERE id = ? OR lower(nama) = lower(?)").bind(idBaru, g.name).first();
    if (bentrok) {
      catat("gudang", kledoId, `Gudang "${g.name}" tidak bisa ditambahkan: bentrok id/nama.`);
      continue;
    }
    try {
      await db
        .prepare("INSERT INTO warehouses (id, code, nama, aktif, urutan, is_online, kledo_id, kledo_synced_at, created_at, created_by) VALUES (?, ?, ?, 1, ?, 0, ?, ?, ?, 'kledo')")
        .bind(idBaru, String(g.code || idBaru).slice(0, 40), g.name, urut?.n ?? 100, g.id, at, at)
        .run();
    } catch (e) {
      catat("gudang", kledoId, `Gagal menambah gudang "${g.name}": ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    await db.prepare("INSERT INTO kledo_map (jenis, kledo_id, lokal_id, nama_snapshot, terakhir_dilihat) VALUES ('gudang', ?, ?, ?, ?) ON CONFLICT(jenis, kledo_id) DO UPDATE SET lokal_id = excluded.lokal_id, nama_snapshot = excluded.nama_snapshot, terakhir_dilihat = excluded.terakhir_dilihat")
      .bind(kledoId, idBaru, g.name, at).run();
    petaGudang.set(kledoId, idBaru);
    daftarLokal.push({ id: idBaru, nama: g.name, code: String(g.code ?? ""), kledo_id: g.id });
    gudangBaru++;
  }

  // ══ TAHAP 2: PRODUK ══
  const hProduk = await kledoAmbilProduk(klien);
  if (!hProduk.ok) {
    await akhiriLaporan(db, syncId, "gagal", { pesan: `Produk: ${hProduk.error}`, durasiMs: Date.now() - mulai, galat });
    return { syncId, status: "gagal", gudangBaru, gudangUbah, produkBaru: 0, produkUbah: 0, hppDipertahankan: 0, stokBaris: 0, stokDrift: 0, galat: galat.length, durasiMs: Date.now() - mulai };
  }

  // HPP + nama D1 saat ini — untuk memutuskan "pertahankan" dan "berubah" tanpa query per produk.
  const hppLokal = await db.prepare("SELECT sku, hpp, nama_accurate FROM products").all<{ sku: string; hpp: number | null; nama_accurate: string }>();
  const hppSekarang = new Map<string, number | null>((hppLokal.results ?? []).map((r) => [String(r.sku), r.hpp]));
  const namaProdukSekarang = new Map<string, string>((hppLokal.results ?? []).map((r) => [String(r.sku), String(r.nama_accurate ?? "")]));

  const idKledoProduk: number[] = [];
  const siap: { sku: string; nama: string; hpp: number | null; kledoId: number; baru: boolean }[] = [];

  for (const p of hProduk.data) {
    const sku = String(p.code ?? "").trim();
    const kledoId = Number(p.id);
    if (!sku) {
      catat("produk", String(p.id), `Produk id=${p.id} tanpa code/SKU — dilewati (sku adalah PRIMARY KEY D1).`);
      continue;
    }
    if (!Number.isFinite(kledoId)) {
      catat("produk", sku, "Produk tanpa id Kledo yang sah — dilewati.");
      continue;
    }
    idKledoProduk.push(kledoId);
    const ada = hppSekarang.has(sku);
    const hpp = hppDariKledo(p.avg_base_price);
    if (hpp === null && ada && (hppSekarang.get(sku) ?? 0) > 0) hppDipertahankan++;
    siap.push({ sku, nama: String(p.name ?? sku), hpp, kledoId, baru: !ada });
  }

  // Fallback HPP dari last_buy_prices — hanya untuk yang avg_base_price kosong.
  const perluFallback = siap.filter((s) => s.hpp === null);
  if (perluFallback.length > 0) {
    let petaBeli = new Map<number, number>();
    try {
      petaBeli = await ambilHargaBeliTerakhir(klien, perluFallback.map((s) => s.kledoId));
    } catch {
      catat("produk", null, "Fallback last_buy_prices gagal; HPP D1 dipertahankan untuk produk tanpa avg_base_price.");
    }
    for (const s of perluFallback) {
      const beli = petaBeli.get(s.kledoId);
      if (typeof beli === "number" && Number.isFinite(beli) && beli >= 1) s.hpp = Math.round(beli);
    }
  }

  for (const s of siap) {
    const norm = normNama(s.nama);
    if (s.baru) {
      // HPP null untuk produk BARU = biarkan NULL (jangan pura-pura 0; 0 adalah harga yang sah).
      await db
        .prepare("INSERT INTO products (sku, nama_accurate, nama_accurate_normalized, hpp, is_online_product, updated_at, kledo_synced_at) VALUES (?, ?, ?, ?, 0, ?, ?) ON CONFLICT(sku) DO NOTHING")
        .bind(s.sku, s.nama, norm, s.hpp, at, at)
        .run();
      produkBaru++;
    } else {
      // HPP ditimpa HANYA bila ada angka layak. Kalau tidak, kolom hpp tidak disentuh sama sekali.
      // `produkUbah` hanya dihitung bila ADA yang benar-benar berubah (nama/hpp), supaya
      // siklus yang tidak mengubah apa pun melaporkan 0 — bukan "semua produk diubah".
      const lama = hppSekarang.get(s.sku);
      const namaLama = namaProdukSekarang.get(s.sku) ?? "";
      const berubah = s.hpp !== null ? (lama !== s.hpp || namaLama !== s.nama) : namaLama !== s.nama;
      if (s.hpp !== null) {
        await db
          .prepare("UPDATE products SET nama_accurate = ?, nama_accurate_normalized = ?, hpp = ?, updated_at = ?, kledo_synced_at = ? WHERE sku = ?")
          .bind(s.nama, norm, s.hpp, at, at, s.sku)
          .run();
      } else {
        await db
          .prepare("UPDATE products SET nama_accurate = ?, nama_accurate_normalized = ?, updated_at = ?, kledo_synced_at = ? WHERE sku = ?")
          .bind(s.nama, norm, at, at, s.sku)
          .run();
      }
      if (berubah) produkUbah++;
    }
    await db
      .prepare("INSERT INTO kledo_map (jenis, kledo_id, lokal_id, nama_snapshot, terakhir_dilihat) VALUES ('produk', ?, ?, ?, ?) ON CONFLICT(jenis, kledo_id) DO UPDATE SET lokal_id = excluded.lokal_id, nama_snapshot = excluded.nama_snapshot, terakhir_dilihat = excluded.terakhir_dilihat")
      .bind(String(s.kledoId), s.sku, s.nama, at)
      .run();
  }

  // Deteksi bentrok: satu `sku` lokal dipakai lebih dari satu id Kledo.
  const petaProduk = await db
    .prepare("SELECT lokal_id, COUNT(*) AS n FROM kledo_map WHERE jenis = 'produk' GROUP BY lokal_id HAVING n > 1")
    .all<{ lokal_id: string; n: number }>();
  for (const b of petaProduk.results ?? []) {
    catat("produk", b.lokal_id, `Bentrok: satu SKU "${b.lokal_id}" dipetakan ke ${b.n} id Kledo berbeda. Nilai D1 tidak ditimpa otomatis — perlu keputusan manusia.`);
  }

  // ══ TAHAP 3: STOK ══
  const hStok = await kledoAmbilStok(klien, idKledoProduk);
  if (!hStok.ok) {
    await akhiriLaporan(db, syncId, "sebagian", { pesan: `Stok: ${hStok.error}`, durasiMs: Date.now() - mulai, galat });
    return { syncId, status: "sebagian", gudangBaru, gudangUbah, produkBaru, produkUbah, hppDipertahankan, stokBaris: 0, stokDrift: 0, galat: galat.length, durasiMs: Date.now() - mulai };
  }

  // Peta sku -> qty lama, agar drift bisa dihitung tanpa query per baris.
  const qtyLama = await db.prepare("SELECT sku, warehouse_id, qty FROM stock_by_bin").all<{ sku: string; warehouse_id: string; qty: number }>();
  const petaQtyLama = new Map<string, number>((qtyLama.results ?? []).map((r) => [`${r.sku}|${r.warehouse_id}`, r.qty]));
  const skuDariKledoId = new Map<string, string>(siap.map((s) => [String(s.kledoId), s.sku]));

  const perSkuDrift = new Map<string, { lama: number; baru: number }>();

  for (const barisStok of hStok.data) {
    const sku = skuDariKledoId.get(String(barisStok.id));
    if (!sku) continue;
    const perGudang = barisStok.stocks ?? {};
    for (const kunci of Object.keys(perGudang)) {
      const w = perGudang[kunci];
      const lokalId = petaGudang.get(String(w.warehouse_id));
      // Gudang yang tidak dipetakan (mis. arsip di Kledo, atau belum terpetakan) DILEWATI,
      // bukan dibuat. `ONLINE` tidak pernah ada di peta ini.
      if (!lokalId || lokalId === GUDANG_VIRTUAL) continue;
      const qtyBaru = Math.round(Number(w.qty) || 0);
      const qtyLamaNilai = petaQtyLama.get(`${sku}|${lokalId}`) ?? 0;
      if (qtyLamaNilai !== qtyBaru) {
        await db
          .prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty")
          .bind(sku, lokalId, qtyBaru)
          .run();
        const d = perSkuDrift.get(sku) ?? { lama: 0, baru: 0 };
        d.lama += qtyLamaNilai;
        d.baru += qtyBaru;
        perSkuDrift.set(sku, d);
        stokDrift++;
        stokBaris++; // hanya baris yang BENAR-BENAR ditulis, bukan setiap baris yang dibaca
      }
    }
  }

  // Ledger: SATU baris per SKU yang berubah (bukan per baris stok) agar tidak membanjiri stock_moves.
  for (const [sku, d] of perSkuDrift) {
    await db
      .prepare("INSERT INTO stock_moves (sku, qty, jenis, source, status, qty_sistem, qty_fisik, selisih, penanda, catatan, at, by) VALUES (?, ?, 'sync_confirmed', 'sync', 'processed', ?, ?, ?, 'kledo', ?, ?, 'kledo')")
      .bind(sku, d.baru - d.lama, d.lama, d.baru, d.baru - d.lama, `[kledo] sinkron #${syncId}`, at)
      .run();
  }

  // ══ TAHAP 4: LAPORAN ══
  const status: HasilSinkron["status"] = galat.length > 0 ? "sebagian" : "sukses";
  await akhiriLaporan(db, syncId, status, { durasiMs: Date.now() - mulai, galat });
  const jumlahGalat = await db.prepare("SELECT COUNT(*) AS n FROM kledo_sync_galat WHERE sync_id = ?").bind(syncId).first<{ n: number }>();

  await db
    .prepare(`UPDATE kledo_sync SET gudang_baru = ?, gudang_ubah = ?, produk_baru = ?, produk_ubah = ?, hpp_dipertahankan = ?, stok_baris = ?, stok_drift = ? WHERE id = ?`)
    .bind(gudangBaru, gudangUbah, produkBaru, produkUbah, hppDipertahankan, stokBaris, stokDrift, syncId)
    .run();

  return {
    syncId,
    status,
    gudangBaru,
    gudangUbah,
    produkBaru,
    produkUbah,
    hppDipertahankan,
    stokBaris,
    stokDrift,
    galat: jumlahGalat?.n ?? galat.length,
    durasiMs: Date.now() - mulai,
  };
}

/** Tutup laporan sinkronisasi: status, durasi, pesan, dan seluruh galat. */
async function akhiriLaporan(
  db: D1Database,
  syncId: number,
  status: "sukses" | "sebagian" | "gagal",
  opsi: { pesan?: string; durasiMs: number; galat: Galat[] }
): Promise<void> {
  await db
    .prepare("UPDATE kledo_sync SET selesai_at = ?, status = ?, durasi_ms = ?, pesan = ?, galat = ? WHERE id = ?")
    .bind(sekarang(), status, opsi.durasiMs, String(opsi.pesan ?? "").slice(0, 500), opsi.galat.length, syncId)
    .run();
  for (const g of opsi.galat) {
    await db
      .prepare("INSERT INTO kledo_sync_galat (sync_id, bagian, ref, pesan) VALUES (?, ?, ?, ?)")
      .bind(syncId, g.bagian, g.ref, g.pesan.slice(0, 500))
      .run();
  }
}

/** Ringkasan sinkronisasi terakhir untuk ditampilkan di UI. */
export type RingkasSinkron = {
  id: number;
  mulai_at: number;
  selesai_at: number | null;
  status: string;
  pemicu: string;
  gudang_baru: number;
  gudang_ubah: number;
  produk_baru: number;
  produk_ubah: number;
  hpp_dipertahankan: number;
  stok_baris: number;
  stok_drift: number;
  galat: number;
  durasi_ms: number | null;
  pesan: string | null;
  oleh: string | null;
};

export async function sinkronTerakhir(db: D1Database): Promise<RingkasSinkron | null> {
  return db.prepare("SELECT * FROM kledo_sync ORDER BY id DESC LIMIT 1").first<RingkasSinkron>();
}

export async function galatTerakhir(db: D1Database, syncId: number, batas = 50) {
  const { results } = await db
    .prepare("SELECT bagian, ref, pesan FROM kledo_sync_galat WHERE sync_id = ? ORDER BY id LIMIT ?")
    .bind(syncId, batas)
    .all<{ bagian: string; ref: string | null; pesan: string }>();
  return results ?? [];
}
