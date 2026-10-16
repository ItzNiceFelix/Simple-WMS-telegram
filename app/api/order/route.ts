// app/api/order/route.ts — Import pesanan 2-fase + transisi fulfill + daftar order (stok, tanpa laba).
// POST { aksi:'preview', rows } → validasi per baris → import_batches(tipe='pesanan') + import_errors → { batch_id, total, sukses, gagal, peringatan }.
// POST { aksi:'konfirmasi', batch_id } → imporPesanan → { ok, order, item }.
// POST { aksi:'preview-shopee', ordersRows, advanceRows } → klasifikasi + tebak SKU → batch 'preview' (klien memegang barisnya).
// POST { aksi:'mulai-impor', namaBerkas, totalBaris } → batch bertahap baru (atau lanjutkan yang belum selesai) → { batchId, sudahBaris }.
// POST { aksi:'impor-potong', batchId, potongan, nomorPotong } → commit SATU potongan → { tersimpan, dilewati, progressBaris }.
// POST { aksi:'selesai-impor', batchId } → tutup batch bertahap → { ok, order, item, batch_id, dilewati }.
// POST { aksi:'transisi', marketplace, no_pesanan, ke } → transisiFulfill.
// POST { aksi:'hapus', targets:[{ marketplace, no_pesanan }] } → hapus baris order (koreksi salah impor).
// GET ?aksi=daftar&dari=&sampai=&tanggal=&mp=&status=&sku=&urut=&arah=&halaman=&ukuran=
//   → { ok, orders, ekspor, total, halaman, ukuran, jumlah_halaman, urut, arah } (header+item+fee, tanpa laba).
//   `tanggal=YYYY-MM-DD` = satu hari penuh (menang atas dari/sampai); urut ∈ {marketplace, no_pesanan,
//   no_resi, tanggal, status_fulfill}, default tanggal desc.
// GET ?aksi=picklist-pdf&targets=[]&mode=&urut=&arah=&inline= → PDF; `urut` ∈ {default, sku, nama, lokasi}.
// Semua owner/admin.
import { getDb } from "@/lib/d1/db";
import { ambilProduk, ambilProdukBanyak, normalisasiNama } from "@/lib/d1/produk";
import {
  ambilOrderBanyak, imporPesanan, listOrder, listOrderBerSku, transisiFulfill,
  KOLOM_URUT_ORDER, type ArahUrut, type BarisPesanan, type KolomUrutOrder,
} from "@/lib/d1/order";
import { transisiFulfillBatch, type KeFulfill } from "@/lib/d1/orderTransisi";
import { buatPicklist, buatPicklistPaket, KUNCI_URUT_PICKLIST, type ArahUrutPicklist, type KunciUrutPicklist, type PaketPicklist } from "@/lib/d1/picklist";
import { bangunPdfPicklist } from "@/lib/d1/picklistPdf";
import { bangunPdfPicklistPaket } from "@/lib/d1/picklistPaketPdf";
import { bangunPdfPicklistGabung, gabungPerSku, type BarisPickGabung } from "@/lib/d1/picklistGabungPdf";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { potongOnlineUntukOrder } from "@/lib/d1/stokOnline";
import { catatEksporPicklist } from "@/lib/d1/picklistEkspor";
import { listBooking, type BookingRow } from "@/lib/d1/advanceBelumSku";
import { normalisasiSheetShopee, normalisasiStatus, type GabunganOrder, type ShopeeAdvanceRow, type ShopeeOrderRow, type ShopeeBooking, type BarisBelumSku } from "@/lib/d1/orderImportShopee";
import { hitungFingerprint, cekFileSudahAda, catatImportFile } from "@/lib/d1/importFingerprint";
import { klasifikasikanImport, type OrderBaru } from "@/lib/d1/orderKlasifikasi";
import { simpanBooking, tebakSku, tandaiBelumMp, compareNama, type TebakanSku } from "@/lib/d1/advanceBelumSku";
import { isiResiGrup } from "@/lib/d1/resiGrup";
import { petaEkspor } from "@/lib/d1/picklistEkspor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Header template 7 kolom (tanpa fee/pajak — laba pindah ke /laba per preset).
const HEADER_PESANAN = ["NoPesanan*", "Marketplace*", "Tanggal*", "SKU*", "Qty*", "HargaSatuan*", "Buyer"];

const KE_VALID = ["pack", "kirim", "selesai", "batal"];
// B5-A: cap 500 baris (konsisten excel produk); konfirmasi batch 50 tetap.
const MAKS_BARIS = 500;
// Ukuran potongan untuk kueri SKU. 20 kueri serentak: cukup untuk menyembunyikan latensi
// jaringan, tapi jauh di bawah batas kueri bersamaan D1/Worker — Promise.all atas ratusan
// kueri sekaligus justru di-throttle dan lebih lambat daripada potongan.
const UKURAN_BATCH_SKU = 20;
// Anggaran tebak SKU per preview. Satu grup = 4 kueri; tanpa batas ini berkas ekspor lebar
// (ratusan grup) menghabiskan anggaran CPU Worker dan request mati sebagai 500 buta.
const MAKS_GRUP_TEBAK = 40;
/**
 * Batas UKURAN preview (byte JSON), pengganti batas baris.
 *
 * Batas baris dihapus karena bukan batas yang nyata: yang benar-benar gagal adalah request
 * yang terlalu besar untuk dikirim/dibaca, bukan "jumlah barisnya banyak". Dengan angka baris,
 * berkas 601 baris ditolak padahal bisa diproses, sementara berkas 600 baris dengan kolom
 * sangat lebar tetap bisa mengirim muatan lebih besar dari yang 601 baris.
 *
 * 8 MB dipilih sebagai plafon muatan request yang masih aman bagi Worker (batas keras platform
 * 100 MB jauh di atas kemampuan memori Free, dan preview menyimpan hasil parse sementara).
 * Melewatinya = 413 dengan pesan yang menyebut angka nyatanya, bukan penolakan tanpa sebab.
 */
const MAKS_BYTE_PREVIEW = 8 * 1024 * 1024;
/**
 * Jumlah baris per potongan impor BERTAHAP (jalur `mulai-impor` → `impor-potong` → `selesai-impor`).
 *
 * Kenapa ada potongan sama sekali: Worker Free dibatasi ~50 KUERI per invokasi (bukan 50
 * pernyataan — `db.batch()` mengirim banyak pernyataan dalam SATU panggilan, jadi satu batch
 * = satu kueri). Jalur konfirmasi lama memanggil `ambilProduk` per baris, dan TIAP panggilan
 * itu satu kueri: berkas 5000 baris = ~5000 kueri, jauh di atas plafon, dan request mati di
 * tengah. Memotong di klien memberi tiap request anggaran kueri yang segar.
 *
 * Angka 200 dihitung dari anggaran, bukan ditebak. Biaya satu potongan 200 baris:
 *   - `ambilProdukBanyak`: 1 kueri per 100 SKU unik (prefetch, lihat susunPernyataanOrder);
 *   - `db.batch` pernyataan impor: 1 kueri per 50 pernyataan, ~8-12 kueri;
 *   - `siapkanProdukPenanda`: 1 kueri; SELECT batch + UPDATE progres: 2 kueri.
 * Total kasus terburuk terukur ≈ 17 dari 50. Sisanya sengaja disisakan untuk fallback
 * per-pernyataan saat satu batch ditolak (lihat `jalankanPernyataan`), yang biayanya lebih
 * mahal dan dibatasi `batasFallback`.
 *
 * Turunkan bila log produksi menunjukkan potongan masih kehabisan anggaran; NAIKKAN hanya
 * setelah diukur ulang — batas sebenarnya adalah 50 kueri/invokasi, bukan angka ini.
 */
const UKURAN_POTONG = 200;
const MODE_PICKLIST = ["per_paket", "pisah", "gabung", "gabung-order"] as const;
type ModePicklist = (typeof MODE_PICKLIST)[number];

/**
 * Petakan tiap item lewat `fn` dengan maksimum `ukuran` tugas serentak, hasil URUT sesuai input.
 * Dipakai jalur preview: sebelumnya loop `for ... await` menumpuk latensi linier per SKU/grup
 * (ratusan kueri berurutan) sampai anggaran CPU Worker habis. Semua sekaligus juga salah —
 * D1/Worker membatasi kueri bersamaan. Potongan tetap = cepat tapi tidak membanjiri.
 */
async function mapPotong<T, R>(item: T[], ukuran: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const hasil: R[] = [];
  for (let i = 0; i < item.length; i += ukuran) {
    hasil.push(...(await Promise.all(item.slice(i, i + ukuran).map(fn))));
  }
  return hasil;
}

/** Ada resi gabungan (jumlah_order > 1) di antara targets → default picklist per paket (D3). */
async function pakaiPerPaket(db: D1Database, targets: { mp: string; no: string }[]): Promise<boolean> {
  const noList = [...new Set(targets.map((t) => t.no).filter(Boolean))];
  if (noList.length === 0) return false;
  for (let i = 0; i < noList.length; i += 50) {
    const potong = noList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM orders o JOIN resi_grup g ON g.no_resi = o.no_resi WHERE o.no_pesanan IN (${tanda}) AND g.jumlah_order > 1`)
      .bind(...potong)
      .first<{ n: number }>();
    if ((row?.n ?? 0) > 0) return true;
  }
  return false;
}

/** Ringkasan review sebelum cetak: status fulfill + grup resi + sisa bayar COD (info saja). */
async function ringkasReview(db: D1Database, targets: { mp: string; no: string }[]): Promise<{ no_pesanan: string; no_resi: string; status: string; grup: number; sesuaKriteria: number }[]> {
  const noList = [...new Set(targets.map((t) => t.no).filter(Boolean))];
  const keluar: { no_pesanan: string; no_resi: string; status: string; grup: number; sesuaKriteria: number }[] = [];
  for (let i = 0; i < noList.length; i += 50) {
    const potong = noList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT o.no_pesanan, o.no_resi, o.status_fulfill, COALESCE(g.jumlah_order, 1) AS grup, COALESCE(g.sesuai_kriteria, 1) AS sesuaKriteria
         FROM orders o LEFT JOIN resi_grup g ON g.no_resi = o.no_resi WHERE o.no_pesanan IN (${tanda})`,
      )
      .bind(...potong)
      .all<{ no_pesanan: string; no_resi: string; status_fulfill: string; grup: number; sesuaKriteria: number }>();
    for (const r of results) keluar.push({ no_pesanan: r.no_pesanan, no_resi: r.no_resi, status: r.status_fulfill, grup: r.grup, sesuaKriteria: r.sesuaKriteria });
  }
  return keluar;
}

type BarisGagal = { baris: number; pesan: string };
function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/**
 * SKU penanda untuk baris yang belum punya SKU sah.
 *
 * Awalan "+" membuat penanda TIDAK BENTROK dengan SKU asli (produksi: nol produk berawalan
 * "+"). Tapi awalan itu SENDIRI TIDAK CUKUP: FK `order_items.sku → products(sku)` tetap
 * menuntut barisnya ADA di `products`. Versi lama berkas ini mengklaim sebaliknya, dan
 * akibatnya setiap baris bertanda menjatuhkan seluruh konfirmasi sebagai 500
 * (`FOREIGN KEY constraint failed`) — produksi menunjukkan `products WHERE sku LIKE '+%'`
 * = 0 dan `order_items WHERE perlu_sku=1` = 0, artinya fitur ini tidak pernah sekali pun
 * berhasil. Sekarang tiap penanda juga DISISIPKAN ke `products` (lihat `siapkanProdukPenanda`)
 * supaya FK terpenuhi dan barisnya benar-benar tersimpan.
 *
 * Sengaja deterministik dari (order, nama, variasi) supaya impor ulang file yang sama
 * menghasilkan penanda identik — bukan baris baru yang menumpuk.
 */
function skuPenandaPerluSku(noPesanan: string, nama: string, variasi: string): string {
  const bahan = `${noPesanan}|${nama}|${variasi}`;
  let h = 0;
  for (let i = 0; i < bahan.length; i++) h = (Math.imul(31, h) + bahan.charCodeAt(i)) | 0;
  return `+PERLU-SKU-${(h >>> 0).toString(36).toUpperCase()}`;
}

/**
 * Keputusan (a) — sisipkan produk penanda, JANGAN buang FK (lihat brief keputusan 1).
 *
 * FK `order_items.sku → products(sku)` adalah jaring pengaman yang berguna untuk baris
 * normal: tanpanya, SKU yang salah ketik ikut tersimpan dan baru ketahuan saat picklist
 * kosong. Yang salah bukan FK-nya, tapi kode yang menulis penanda tanpa menyiapkan
 * barisnya. Jadi yang diperbaiki: penanda dibuat MEMENUHI FK.
 *
 * Pilihan (b) membuang FK ditolak karena: (1) SQLite tidak bisa DROP CONSTRAINT, jadi harus
 * recreate `order_items` — risiko jauh lebih besar daripada satu INSERT OR IGNORE; (2) FK
 * yang sama juga melindungi jalur lain (impor excel, kledo, transisi) yang tidak boleh
 * kehilangan penjagaannya; (3) `perlu_sku` sudah ada tepat untuk membedakan baris bertanda
 * dari produk asli, jadi tidak perlu melonggarkan skema.
 *
 * Nama produknya menerangkan asalnya supaya terbaca jelas di picklist/daftar produk sebagai
 * "belum dipetakan", bukan sebagai barang nyata. HPP 0 (bukan NULL) supaya laba tidak
 * menghitung null sebagai tak diketahui; `perlu_sku=1` yang menandai barisnya bermasalah.
 */
function siapkanProdukPenanda(db: D1Database, daftar: { sku: string; nama: string }[], at: number): D1PreparedStatement[] {
  return daftar.map((p) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO products (sku, nama_accurate, nama_accurate_normalized, hpp, is_online_product, updated_at)
         VALUES (?, ?, ?, 0, 0, ?)`,
      )
      .bind(p.sku, p.nama.slice(0, 200), normalisasiNama(p.nama).slice(0, 200), at),
  );
}

/**
 * Pernyataan impor + nomor pesanan pemiliknya.
 *
 * Nomor pesanan dibawa berdampingan dengan pernyataannya, bukan disisipkan ke SQL lalu
 * dibaca kembali: D1PreparedStatement tidak mengekspos parameter yang di-`bind`, dan
 * menebak isinya lewat cast membuat laporan `dilewati` bisa salah tanpa error tipe.
 */
type StmtOrder = { no: string; stmt: D1PreparedStatement };

/** Nama master + gudang tempat stok SKU benar-benar berada. */
type InfoSku = { nama: string; lokasi: string; lokasiLain: string };

/** Hasil satu kali penyusunan pernyataan impor (dipakai jalur konfirmasi lama DAN potongan bertahap). */
type HasilSusun = {
  stmts: StmtOrder[];
  nItem: number;
  produkPenanda: { sku: string; nama: string }[];
  /** Terisi bila ada baris tanpa SKU yang tidak ditandai belum-MP — pemanggil harus menolak. */
  pesanKurangSku?: string;
};

/**
 * Susun seluruh pernyataan D1 untuk sekumpulan order + SKU manual.
 *
 * Ada sebagai fungsi supaya jalur LAMA (`konfirmasi-shopee`, satu berkas sekali jalan) dan
 * jalur BARU (`impor-potong`, beberapa baris per request) memakai aturan yang PERSIS sama:
 * produk penanda, baris "perlu SKU", pemetaan SKU manual, dan HPP snapshot. Kalau logika ini
 * disalin, cepat atau lambat dua jalur akan berbeda perilaku untuk file yang sama.
 *
 * `ambildProduk` di-inject supaya pemanggil bisa men-cache hasil SELECT produk per potongan:
 * satu SKU yang muncul di 50 baris cukup satu kueri, dan itulah yang menjaga jalur bertahap
 * tetap di bawah anggaran subrequest.
 */
async function susunPernyataanOrder(
  db: D1Database,
  batchId: number,
  orders: GabunganOrder[],
  opsi: {
    skuManual: Map<string, string>;
    kunciBelumMp: Set<string>;
    ambilProdukCache: Map<string, { hpp: number } | null>;
  },
): Promise<HasilSusun> {
  const stmts: StmtOrder[] = [];
  let nItem = 0;
  const produkPenanda = new Map<string, { sku: string; nama: string }>();
  const { skuManual, kunciBelumMp, ambilProdukCache } = opsi;
  // Ambil SEMUA SKU yang dibutuhkan potongan ini dalam SATU kueri sebelum menyusun pernyataan.
  // Kenapa: Worker Free hanya 50 kueri per invokasi, dan satu `ambilProduk` = satu kueri —
  // memanggilnya per baris membuat potongan 200 baris langsung melewati anggaran. Prefetch
  // membuat biaya baca master jadi ~1 kueri per potongan, bukan ~1 per SKU.
  const skuDibutuhkan: string[] = [];
  for (const o of orders) {
    for (const item of o.items) {
      const kunci = `${o.no_pesanan}\u0000${item.nama_shopee}\u0000${item.variasi}`;
      const skuFinal = skuManual.get(kunci) ?? item.sku;
      if (skuFinal) skuDibutuhkan.push(skuFinal);
    }
  }
  const belumAda = skuDibutuhkan.filter((s) => !ambilProdukCache.has(s));
  if (belumAda.length > 0) {
    const banyak = await ambilProdukBanyak(db, belumAda);
    for (const s of belumAda) {
      const p = banyak.get(s);
      ambilProdukCache.set(s, p ? { hpp: p.hpp ?? 0 } : null);
    }
  }
  for (const o of orders) {
    stmts.push({
      no: o.no_pesanan,
      stmt: db
        .prepare(
          `INSERT INTO orders (marketplace, no_pesanan, tanggal, buyer, status_fulfill, pajak_pph, pajak_ppn_persen, stok_dikurangi, no_resi,
            asal_import, opsi_kirim, antar_ke, status_mp, batch_import, jasa_kirim, tipe_layanan, cod, preorder, item_json)
           VALUES ('shopee', ?, ?, ?, ?, 0, 0, 0, ?, 'orders_toship', ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(marketplace, no_pesanan) DO UPDATE SET
             tanggal = excluded.tanggal, buyer = excluded.buyer, no_resi = CASE WHEN excluded.no_resi = '' THEN orders.no_resi ELSE excluded.no_resi END,
             opsi_kirim = excluded.opsi_kirim, antar_ke = excluded.antar_ke, status_mp = excluded.status_mp, batch_import = excluded.batch_import,
             jasa_kirim = excluded.jasa_kirim, tipe_layanan = excluded.tipe_layanan, cod = excluded.cod, preorder = excluded.preorder, item_json = excluded.item_json,
             asal_import = CASE WHEN orders.asal_import = '' THEN excluded.asal_import ELSE orders.asal_import END,
             status_fulfill = CASE WHEN orders.status_fulfill = 'pending' THEN excluded.status_fulfill ELSE orders.status_fulfill END`,
        )
        .bind(
          o.no_pesanan, o.tanggal, o.buyer, o.statusAwal, o.noResi,
          o.opsiKirim, o.antarKe, o.statusMp, batchId, o.jasaKirim, o.tipeLayanan, o.cod ? 1 : 0, o.preorder ? 1 : 0, JSON.stringify(o.items),
        ),
    });
    stmts.push({ no: o.no_pesanan, stmt: db.prepare("DELETE FROM order_items WHERE marketplace = 'shopee' AND no_pesanan = ?").bind(o.no_pesanan) });
    for (const item of o.items) {
      const kunci = `${o.no_pesanan}\u0000${item.nama_shopee}\u0000${item.variasi}`;
      const skuFinal = skuManual.get(kunci) ?? item.sku;
      // Belum ada SKU sama sekali (tidak dipilih manual, tidak ditandai belum-MP):
      // hentikan supaya tidak menulis item tanpa rujukan produk.
      if (!skuFinal) {
        if (kunciBelumMp.has(kunci)) {
          // Baris TETAP disimpan sebagai item bertanda "perlu SKU" supaya ikut tercetak di
          // picklist dengan kolom pembeda. Dulu barisnya di-`continue` (tidak masuk
          // order_items) sehingga picklist memakai INNER JOIN dan barangnya raib tanpa
          // pesan — checker menerima lembar tidak lengkap tanpa tahu.
          const skuTanda = skuPenandaPerluSku(o.no_pesanan, item.nama_shopee, item.variasi);
          produkPenanda.set(skuTanda, { sku: skuTanda, nama: `[BELUM DI MP] ${item.nama_shopee}${item.variasi ? ` (${item.variasi})` : ""}` });
          stmts.push({
            no: o.no_pesanan,
            stmt: db
              .prepare(
                "INSERT INTO order_items (marketplace, no_pesanan, sku, variasi, nama_shopee, qty, harga_satuan, hpp_snapshot, subtotal, sku_asal, perlu_sku) VALUES ('shopee', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
              )
              .bind(o.no_pesanan, skuTanda, item.variasi, item.nama_shopee, item.qty, item.harga_satuan, 0, item.subtotal, ""),
          });
          nItem++;
          continue;
        }
        return { stmts, nItem, produkPenanda: [...produkPenanda.values()], pesanKurangSku: `Baris "${item.nama_shopee}" (order ${o.no_pesanan}) belum dipilih SKU — pilih SKU atau centang "Belum di MP".` };
      }
      // Cache diisi lebih dulu oleh prefetch `ambilProdukBanyak` di atas. `undefined` di sini
      // berarti prefetch tidak menutup SKU ini — tidak boleh terjadi, dan menjawabnya dengan
      // satu kueri lagi pelan-pelan menghabiskan anggaran 50 kueri. Jadi dianggap "tidak ada
      // di master": barisnya tetap disimpan sebagai penanda "perlu SKU" dan user diberi tahu,
      // bukan request-nya mati di tengah tanpa penjelasan.
      const produk = ambilProdukCache.get(skuFinal) ?? null;
      if (!produk) {
        // SKU tertulis di file tapi tidak ada di master: JANGAN buang ordernya. Simpan
        // sebagai baris bertanda supaya bisa dicetak di picklist dan diperbaiki nanti.
        const skuTanda = skuPenandaPerluSku(o.no_pesanan, item.nama_shopee, item.variasi);
        produkPenanda.set(skuTanda, { sku: skuTanda, nama: `[PERLU SKU] ${item.nama_shopee} — file: ${skuFinal}` });
        stmts.push({
          no: o.no_pesanan,
          stmt: db
            .prepare(
              "INSERT INTO order_items (marketplace, no_pesanan, sku, variasi, nama_shopee, qty, harga_satuan, hpp_snapshot, subtotal, sku_asal, perlu_sku) VALUES ('shopee', ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)",
            )
            .bind(o.no_pesanan, skuTanda, item.variasi, item.nama_shopee, item.qty, item.harga_satuan, item.subtotal, skuFinal),
        });
        nItem++;
        continue;
      }
      stmts.push({
        no: o.no_pesanan,
        stmt: db
          .prepare(
            "INSERT INTO order_items (marketplace, no_pesanan, sku, variasi, nama_shopee, qty, harga_satuan, hpp_snapshot, subtotal, sku_asal, perlu_sku) VALUES ('shopee', ?, ?, ?, ?, ?, ?, ?, ?, '', 0)",
          )
          .bind(o.no_pesanan, skuFinal, item.variasi, item.nama_shopee, item.qty, item.harga_satuan, produk.hpp ?? 0, item.subtotal),
      });
      nItem++;
    }
  }
  return { stmts, nItem, produkPenanda: [...produkPenanda.values()] };
}

/**
 * Jalankan pernyataan impor dengan fallback PER PERNYATAAN.
 *
 * `db.batch` bisa menolak satu pernyataan buruk (mis. FK) dan ikut menggagalkan seluruh
 * potongan. Menjalankan ulang satu per satu membuat baris yang sehat tetap tersimpan dan
 * baris yang buruk dilaporkan — bukan hilang tanpa jejak. Perilaku ini dipertahankan dari
 * jalur lama karena inilah yang membuat impor parsial tetap hidup.
 *
 * `batasFallback` membatasi berapa pernyataan yang boleh dicoba ulang satu-satu. Tanpa batas,
 * potongan yang SEMUA batch-nya gagal akan menjalankan satu kueri per pernyataan — ratusan
 * kueri, jauh di atas plafon 50 kueri/invokasi Worker Free — dan request mati di tengah tanpa
 * balasan. Dengan batas, sisanya dilaporkan sebagai belum dicoba supaya user bisa mengulang;
 * lebih baik tahu "N baris belum tersimpan" daripada kehilangan seluruh jawaban.
 */
async function jalankanPernyataan(
  db: D1Database,
  stmts: StmtOrder[],
  batasFallback = 30,
): Promise<{ gagalTotal: number; dilewati: { no_pesanan: string; pesan: string }[]; belumDicoba: number }> {
  const dilewati: { no_pesanan: string; pesan: string }[] = [];
  let gagalTotal = 0;
  let sisaFallback = batasFallback;
  let belumDicoba = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const potong = stmts.slice(i, i + 50);
    try {
      await db.batch(potong.map((s) => s.stmt));
    } catch {
      for (const s of potong) {
        if (sisaFallback <= 0) {
          belumDicoba++;
          continue;
        }
        sisaFallback--;
        try {
          await s.stmt.run();
        } catch (e) {
          gagalTotal++;
          dilewati.push({ no_pesanan: s.no, pesan: e instanceof Error ? e.message : "pernyataan ditolak D1" });
        }
      }
    }
  }
  return { gagalTotal, dilewati, belumDicoba };
}


/**
 * Ambil nama resmi dan LOKASI GUDANG untuk sekumpulan SKU.
 *
 * Lokasi diambil dari gudang yang benar-benar menyimpan stok, bukan dari gudang asal order
 * (tabel `orders` tidak menyimpannya) dan bukan dari gudang ONLINE (virtual, dan nyatanya
 * kosong — menulisnya membuat kolom Lokasi Gudang menyesatkan picker).
 *
 * Bila satu SKU ada di beberapa gudang, yang ditampilkan gudang dengan stok TERBANYAK
 * (tempat picker paling mungkin menemukannya), dan sisanya disebut sebagai penanda supaya
 * picker tahu harus memeriksa rak lain juga. Stok negatif diabaikan saat memilih gudang —
 * angka minus berarti catatan yang salah, bukan barang yang ada.
 */
async function infoNamaDanLokasi(
  db: D1Database,
  daftar: string[],
  /**
   * Penerjemah kode gudang → nama (`petaNamaGudang`). Dipanggil SEKALI oleh pemanggil
   * supaya jalur picklist tidak menambah satu kueri master per bagian SKU (hanya satu
   * penerjemah per request, berapa pun banyaknya potongan).
   */
  gudangNama?: (kode: string) => string
): Promise<Map<string, InfoSku>> {
  const hasil = new Map<string, InfoSku>();
  const unik = [...new Set(daftar)].filter((s) => s.length > 0 && !s.startsWith("+"));
  if (unik.length === 0) return hasil;
  for (let i = 0; i < unik.length; i += 90) {
    const potong = unik.slice(i, i + 90);
    const tanda = potong.map(() => "?").join(",");
    // Kode gudang (D12/D19) dipakai, bukan nama lengkap ("Gudang D12"), karena kolom Lokasi
    // Gudang cuma 105pt dan nama panjang + penanda gudang lain tidak muat sehingga terpotong.
    const { results } = await db
      .prepare(
        `SELECT p.sku AS sku, p.nama_accurate AS nama, b.warehouse_id AS gudang, b.qty AS qty
         FROM products p
         LEFT JOIN stock_by_bin b ON b.sku = p.sku
         WHERE p.sku IN (${tanda})`
      )
      .bind(...potong)
      .all<{ sku: string; nama: string; gudang: string | null; qty: number | null }>();
    const perSku = new Map<string, { nama: string; gudang: { nama: string; qty: number }[] }>();
    for (const r of results) {
      let e = perSku.get(r.sku);
      if (!e) { e = { nama: r.nama, gudang: [] }; perSku.set(r.sku, e); }
      if (r.gudang && r.qty != null) e.gudang.push({ nama: r.gudang, qty: r.qty });
    }
    for (const [sku, e] of perSku) {
      const positif = e.gudang.filter((g) => g.qty > 0).sort((a, b) => b.qty - a.qty);
      const utama = positif[0];
      hasil.set(sku, {
        nama: e.nama,
        // Tidak ada stok positif di gudang mana pun: jujur tulis kosong daripada menebak.
        // Picklist akan menampilkan "-", yang artinya "cek dulu" — bukan instruksi salah.
        lokasi: utama ? (gudangNama ? gudangNama(utama.nama) : utama.nama) : "",
        lokasiLain: positif.length > 1 ? `+${positif.slice(1).map((g) => (gudangNama ? gudangNama(g.nama) : g.nama)).join(", ")}` : "",
      });
    }
  }
  return hasil;
}

/**
 * Terjemahkan kode/ID gudang (`stock_by_bin.warehouse_id`) menjadi NAMA gudang.
 *
 * Diperlukan karena dua sumber menyebut gudang dengan dua cara: `stock_by_bin` menyimpan
 * ID gudang ('GMV0LJYS5'), sedangkan `advance_bookings.gudang` menyimpan CODE ('D12') —
 * lihat pemetaan Kledo di migrations/0025 yang juga memakai `code` sebagai kunci cadangan.
 * Satu kali kueri untuk SEMUA gudang (tabelnya kecil), bukan satu kueri per baris.
 *
 * Gudang tak dikenal dikembalikan APA ADANYA: menulis string kosong akan menyembunyikan
 * baris bermasalah, dan picklist yang menyuruh picker ke tempat yang salah lebih buruk
 * daripada kolom yang kelihatan aneh.
 */
async function petaNamaGudang(db: D1Database): Promise<(kode: string) => string> {
  const peta = new Map<string, string>();
  const { results } = await db.prepare("SELECT id, code, nama FROM warehouses").all<{ id: string; code: string; nama: string }>();
  for (const g of results) {
    // `code` dulu: itu tulisan pendek yang dipakai kolom Lokasi Gudang (D12/D19) — sama
    // aturan dengan app/api/baca/route.ts. `id` jadi cadangan supaya kode lama yang sudah
    // telanjur tertulis sebagai ID tetap bisa diterjemahkan.
    if (!peta.has(g.code)) peta.set(g.code, g.nama);
    if (!peta.has(g.id)) peta.set(g.id, g.nama);
  }
  return (kode: string) => peta.get(kode) ?? kode;
}

function intBaris(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : (NaN as unknown as null);
}

/**
 * Booking advance yang DIPILIH user, dari parameter `booking` (JSON array `booking_sn`).
 *
 * Kenapa parameter ini ada: tanpa itu jalur `gabung-order` menarik SELURUH booking
 * berstatus `menunggu` di database (`listBooking` global), sehingga picker menerima lembar
 * berisi advance milik orang lain — dan mode itu jadi tak bisa dipakai karena isinya tidak
 * bisa dikendalikan user. Di sini pilihan itu dibuat eksplisit.
 *
 * `undefined` = parameter tidak dikirim → perilaku LAMA (semua `menunggu`, limit 500),
 * supaya tautan cetak lama dan pemanggil non-UI tidak berubah diam-diam. Array kosong
 * dianggap "tidak memilih" juga, dengan alasan yang sama: klien yang mengirim `[]` berarti
 * "tidak menyaring", bukan "pilih nol".
 *
 * SN yang tidak ada / tidak `menunggu` DITOLAK, bukan dibuang diam-diam. Picklist yang
 * kehilangan satu booking adalah picklist yang kurang barang — persis kegagalan yang paling
 * dihindari repo ini; lebih baik teriak sekarang daripada ketahuan setelah paket dikirim.
 */
type HasilBooking = { ok: true; sn: string[] | null } | { ok: false; error: string };

function bacaBookingParam(raw: string | null): HasilBooking {
  if (raw === null || raw.trim() === "") return { ok: true, sn: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Parameter booking tidak valid (harus JSON array booking_sn)." };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: "Parameter booking harus berupa array booking_sn." };
  const sn = [...new Set(parsed.map((x) => teks(x)).filter((x) => x.length > 0))];
  if (sn.length === 0) return { ok: true, sn: null };
  if (sn.length > 500) return { ok: false, error: "Terlalu banyak booking dipilih (maksimal 500)." };
  return { ok: true, sn };
}

/**
 * Booking advance yang benar-benar akan dicetak: seluruh `menunggu` (perilaku lama) atau
 * tepat SN yang diminta, DENGAN verifikasi bahwa tiap SN memang ada dan masih `menunggu`.
 *
 * ── JENDELA 500 (kenapa verifikasi bisa salah bilang "tidak ditemukan") ──
 * Pencarian SN di bawah dibatasi `listBooking(db, { limit: 500 })` — 500 booking TERBARU
 * (`ORDER BY at DESC, booking_sn DESC`). Padanan di UI (/api/advance?aksi=daftar) mengambil
 * kandidat dengan `limit=300`. Akibatnya, begitu antrean `menunggu` melewati 500 baris, SN
 * yang SAH tapi berada di luar jendela itu akan dijawab "Booking tidak ditemukan".
 *
 * Ini AMAN (fail closed: 400, tidak ada lembar tercetak, tidak ada barang diam-diam hilang),
 * tapi pesannya menyesatkan. Kalau antrean advance pernah melewati 500, JANGAN sekadar
 * menaikkan angka di sini — ganti pencarian per-SN menjadi kueri bertarget
 * (`WHERE booking_sn IN (...)` dengan potongan 50 seperti kueri lain di repo), sehingga
 * verifikasinya tidak lagi bergantung pada jendela urutan. Batas `sn.length > 500` di
 * `bacaBookingParam` adalah pengaman bentuk yang terpisah dan tidak perlu ikut berubah.
 */
async function ambilBookingTerpilih(
  db: D1Database,
  status: string,
  sn: string[] | null
): Promise<{ ok: true; booking: BookingRow[] } | { ok: false; error: string }> {
  // Perilaku LAMA (semua `menunggu`) hanya berlaku bila `booking` TIDAK dikirim. Itu
  // dipertahankan demi tautan cetak lama dan pemanggil non-UI.
  if (sn === null) return { ok: true, booking: await listBooking(db, { status, limit: 500 }) };
  // `listBooking` memfilter satu status; pilihan user bisa saja sudah berubah status di tab
  // lain, jadi baris diambil per SN tanpa filter status lalu diperiksa satu per satu.
  // Jendela 500 di sini — lihat catatan panjang di atas fungsi ini.
  const semua = await listBooking(db, { limit: 500 });
  const peta = new Map(semua.map((b) => [b.booking_sn, b]));
  const booking: BookingRow[] = [];
  const hilang: string[] = [];
  const statusSalah: string[] = [];
  for (const s of sn) {
    const b = peta.get(s);
    if (!b) hilang.push(s);
    else if (b.status !== status) statusSalah.push(`${s} (${b.status})`);
    else booking.push(b);
  }
  if (hilang.length > 0) {
    return { ok: false, error: `Booking tidak ditemukan: ${hilang.slice(0, 5).join(", ")}${hilang.length > 5 ? ` (+${hilang.length - 5} lagi)` : ""}.` };
  }
  if (statusSalah.length > 0) {
    return { ok: false, error: `Booking bukan berstatus ${status}: ${statusSalah.slice(0, 5).join(", ")}${statusSalah.length > 5 ? ` (+${statusSalah.length - 5} lagi)` : ""}.` };
  }
  return { ok: true, booking };
}

/**
 * Jumlah ORDER yang benar-benar berkontribusi — target yang sudah dideduplikasi.
 *
 * `buatPicklist` dan `buatPicklistPaket` sama-sama memetakan kunci `${mp}|${no}` lebih dulu,
 * jadi dua entri kembar di `targets` menghasilkan SATU set baris. Memakai `targets.length`
 * untuk kepala "N order" membuat angka itu membengkak dibanding tabel di bawahnya — angka
 * yang benar untuk barisnya, tapi bohong di judul. Dedupe di sini dengan kunci yang SAMA,
 * supaya pratinjau dan PDF sepakat soal apa itu "satu order".
 */
function hitungOrderUnik(targets: { mp: string; no: string }[]): number {
  return new Map(targets.map((t) => [`${t.mp}|${t.no}`, t])).size;
}

/** `targets` query param → daftar target order (sama bentuk untuk preview dan PDF). */
function bacaTargets(raw: string): { ok: true; targets: { mp: string; no: string }[] } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("bukan array");
    const targets = (parsed as Record<string, unknown>[]).map((t) => ({ mp: teks(t.marketplace).toLowerCase(), no: teks(t.no_pesanan) }));
    return { ok: true, targets };
  } catch {
    return { ok: false, error: "Parameter targets tidak valid." };
  }
}

function tanggalKeEpoch(t: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return null;
  return Math.floor(dt.getTime() / 1000);
}

async function validasiBarisPesanan(db: D1Database, row: Record<string, unknown>, noBaris: number, cekSku: Map<string, boolean>): Promise<{ ok: true; data: BarisPesanan } | { ok: false; pesan: string }> {
  const no = teks(row["NoPesanan*"]);
  const mp = teks(row["Marketplace*"]).toLowerCase();
  if (!no) return { ok: false, pesan: `Baris ${noBaris}: NoPesanan wajib diisi.` };
  if (!mp) return { ok: false, pesan: `Baris ${noBaris}: Marketplace wajib diisi.` };
  const tanggal = tanggalKeEpoch(teks(row["Tanggal*"]));
  if (tanggal === null) return { ok: false, pesan: `Baris ${noBaris}: Tanggal harus YYYY-MM-DD valid.` };
  const sku = teks(row["SKU*"] ?? row["SKU"]).toUpperCase();
  if (!sku) return { ok: false, pesan: `Baris ${noBaris}: SKU wajib diisi.` };
  let ada = cekSku.get(sku);
  if (ada === undefined) {
    ada = (await ambilProduk(db, sku)) !== null;
    cekSku.set(sku, ada);
  }
  if (!ada) return { ok: false, pesan: `Baris ${noBaris}: SKU ${sku} tidak dikenal.` };
  const qty = intBaris(row["Qty*"]);
  if (qty === null || Number.isNaN(qty as unknown as number) || (qty as number) < 1) return { ok: false, pesan: `Baris ${noBaris}: Qty harus bilangan bulat ≥ 1.` };
  const harga = intBaris(row["HargaSatuan*"]);
  if (harga === null || Number.isNaN(harga as unknown as number) || (harga as number) < 0) return { ok: false, pesan: `Baris ${noBaris}: HargaSatuan harus bilangan bulat ≥ 0.` };
  return {
    ok: true,
    data: {
      marketplace: mp, no_pesanan: no, tanggal, buyer: teks(row["Buyer"]), sku,
      qty: qty as number, harga_satuan: harga as number,
    },
  };
}

type FilterDaftar = {
  mp?: string; status?: string; sku?: string; dari?: number; sampai?: number;
  limit: number; offset: number; halaman: number;
  kolomUrut: KolomUrutOrder; arah: ArahUrut;
};
/**
 * Plafon ukuran halaman. 200 = angka terbesar yang sudah dipakai halaman order (`limit=200`)
 * dan masih muat anggaran kueri Worker Free.
 *
 * Arithmetic anggarannya: satu halaman 200 baris = 1 kueri COUNT + 1 kueri daftar + header
 * item & fee masing-masing 200/50 = 4 potongan × 3 = 12 kueri + petaEkspor 200/50 = 4 kueri
 * = 18 kueri. Di atas 200, pemotongan 50-an membuat biayanya naik ~1 kueri per 50 baris, dan
 * plafon ~50 kueri per invokasi Worker Free tercapai di sekitar 1200 baris — plafon yang jauh
 * lebih tinggi daripada yang dibutuhkan layar tapi cukup dekat untuk jadi jebakan kalau
 * ukurannya dibiarkan bebas.
 */
const MAKS_UKURAN_HALAMAN = 200;

/** Filter query string untuk daftar order. */
function filterDariQuery(url: URL): { ok: true; filter: FilterDaftar } | { ok: false; error: string } {
  const dariTeks = url.searchParams.get("dari") || "";
  const sampaiTeks = url.searchParams.get("sampai") || "";
  const tanggalTeks = url.searchParams.get("tanggal") || "";
  const filter: FilterDaftar = {
    mp: url.searchParams.get("mp")?.trim().toLowerCase() || undefined,
    status: url.searchParams.get("status")?.trim() || undefined,
    sku: url.searchParams.get("sku")?.trim().toUpperCase() || undefined,
    limit: ((): number => {
      const n = Number(url.searchParams.get("ukuran") ?? url.searchParams.get("limit"));
      return Number.isInteger(n) && n > 0 ? Math.min(n, MAKS_UKURAN_HALAMAN) : 50;
    })(),
    offset: 0,
    halaman: 1,
    // Default = perilaku lama persis: terbaru dulu.
    kolomUrut: "tanggal",
    arah: "desc",
  };
  // `halaman` (1-basis, untuk lompat-ke-halaman) menang atas `offset` bila keduanya dikirim —
  // satu arti saja per permintaan, supaya tidak ada halaman yang isinya campur dua niat.
  const halamanParam = Number(url.searchParams.get("halaman"));
  filter.halaman = Number.isInteger(halamanParam) && halamanParam > 0 ? halamanParam : 1;
  filter.offset = (filter.halaman - 1) * filter.limit;
  // Urutan: allowlist beku. Nilai tak dikenal TIDAK ditolak dengan 400 — daftar tetap tampil
  // terurut default. Menolak halaman karena satu parameter urut yang salah hanya membuat user
  // kehilangan datanya, bukan membuat datanya lebih benar.
  const kolomParam = url.searchParams.get("urut") ?? "";
  if ((KOLOM_URUT_ORDER as readonly string[]).includes(kolomParam)) filter.kolomUrut = kolomParam as KolomUrutOrder;
  if (url.searchParams.get("arah") === "asc") filter.arah = "asc";
  if (dariTeks) {
    const d = tanggalKeEpoch(dariTeks);
    if (d === null) return { ok: false, error: "Param dari harus YYYY-MM-DD." };
    filter.dari = d;
  }
  if (sampaiTeks) {
    const s = tanggalKeEpoch(sampaiTeks);
    if (s === null) return { ok: false, error: "Param sampai harus YYYY-MM-DD." };
    filter.sampai = s + 86399;
  }
  // `tanggal=YYYY-MM-DD` = SATU hari penuh. Hari dihitung dengan `tanggalKeEpoch`, helper yang
  // sama dengan jalur impor: kolom `orders.tanggal` di-anchor ke tengah malam UTC oleh helper
  // itu, jadi batas harinya HARUS dari helper yang sama pula. Menghitungnya dengan WIB akan
  // menggeser jendela 7 jam terhadap data yang tersimpan — filter yang membuang order di
  // malam hari, tepat saat order paling banyak masuk.
  if (tanggalTeks) {
    const d = tanggalKeEpoch(tanggalTeks);
    if (d === null) return { ok: false, error: "Param tanggal harus YYYY-MM-DD." };
    filter.dari = d;
    filter.sampai = d + 86399;
  }
  return { ok: true, filter };
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi");
  if (aksi === "picklist-pdf") {
    const db = getDb();
    const tgt = bacaTargets(url.searchParams.get("targets") ?? "[]");
    if (!tgt.ok) return json({ ok: false, error: tgt.error }, 400);
    const targets = tgt.targets;
    // Pilihan booking advance (mode gabung-order). `null` = tidak menyaring (perilaku lama).
    const bk = bacaBookingParam(url.searchParams.get("booking"));
    if (!bk.ok) return json({ ok: false, error: bk.error }, 400);
    const bookingSn = bk.sn;
    // Unduh (attachment) itu default lama; `inline=1` membuat browser menampilkan PDF di viewer
    // tab baru, dari situ user memilih print/simpan sendiri. Satu bendera dibaca sekali di sini
    // supaya SEMUA mode (termasuk gabung-order) berperilaku sama.
    // ponytail: baca parameter per titik balik respons; angkat ke satu variabel bila logika
    // makin panjang.
    const disp = (file: string) => (url.searchParams.get("inline") === "1" ? `inline; filename="${file}"` : `attachment; filename="${file}"`);
    // Urutan picklist: allowlist BEKU yang sama dengan jalur lain — niatnya, bukan SQL.
    //
    // Kenapa harus dikirim ke server, bukan diurutkan di klien: PDF disusun ULANG di sini dari
    // `order_items`, jadi urutan yang user lihat di layar tidak pernah ikut ke kertas. Tanpa
    // parameter ini, "urutkan per nama produk" hanya mengubah tampilan — picker tetap menerima
    // lembar urut lokasi dan menyisir rak dalam urutan yang tidak dia pilih.
    //
    // Nilai tak dikenal TIDAK ditolak: jatuh ke `default` supaya tautan cetak lama tetap
    // menghasilkan lembar yang sama.
    const urutMinta = (url.searchParams.get("urut") ?? "").trim();
    const urutPick: KunciUrutPicklist = (KUNCI_URUT_PICKLIST as readonly string[]).includes(urutMinta)
      ? (urutMinta as KunciUrutPicklist)
      : "default";
    const arahPick: ArahUrutPicklist = url.searchParams.get("arah") === "desc" ? "desc" : "asc";
    // PDF jadi → baru dicatat. Dipanggil dari SEMUA cabang mode supaya tag "sudah dicetak"
    // tidak bisa lupa di satu jalur, tapi TIDAK menyentuh header/isi PDF yang sudah disusun
    // pemanggil (header bisa berubah sewaktu-waktu, mis. inline vs attachment).
    const kirimPdf = async (bytes: Uint8Array<ArrayBuffer>, mode: string, init: ResponseInit) => {
      await catatEksporPicklist(db, targets, mode, String(sesi.user.id));
      return new Response(bytes as BodyInit, init);
    };
    // D7-T7: per_paket = 1 lembar per no_resi (default utk resi gabungan); pisah = agregat per SKU (mode lama).
    const modeMinta = (url.searchParams.get("mode") ?? "").trim();
    if (modeMinta === "review") {
      const ringkas = await ringkasReview(db, targets);
      return json({ ok: true, ringkas });
    }
    const mode = modeMinta === "" ? ((await pakaiPerPaket(db, targets)) ? "per_paket" : "pisah") : modeMinta;
    if (mode !== "per_paket" && mode !== "pisah" && mode !== "gabung" && mode !== "gabung-order")
      return json({ ok: false, error: "Mode harus per_paket/pisah/gabung/gabung-order." }, 400);
    // Mode gabung-order = satu lembar berisi order + advance. Dipakai picker supaya tidak
    // menyisir rak dua kali untuk barang yang diambil pada saat yang sama.
    if (mode === "gabung-order") {
      // Tidak ada order DAN tidak ada pilihan booking → tidak ada apa pun untuk dicetak.
      // Diperiksa SEBELUM menarik booking: tanpa order, "perilaku lama" (semua `menunggu`)
      // akan mengirim SELURUH database ke picker — persis cacat yang sedang diperbaiki.
      if (targets.length === 0 && bookingSn === null) {
        return json({ ok: false, error: "Pilih minimal satu order atau satu booking advance." }, 400);
      }
      const st = url.searchParams.get("status") ?? "menunggu";
      const ambil = await ambilBookingTerpilih(db, st, bookingSn);
      if (!ambil.ok) return json({ ok: false, error: ambil.error }, 400);
      const booking = ambil.booking;
      // Mode ini boleh dicetak dengan HANYA advance: itu justru kasus saat mode ini paling
      // dibutuhkan — ada booking yang harus disiapkan walau belum ada order yang perlu
      // dicetak. Mode lain TIDAK ikut dilonggarkan (picklist order-only tanpa order =
      // lembar kosong), dan jalur itu tetap 400 lewat penjaga di `buatPicklistPaket`.
      if (targets.length === 0 && booking.length === 0) {
        return json({ ok: false, error: "Pilih minimal satu order atau satu booking advance." }, 400);
      }
      const pick = targets.length > 0
        ? await buatPicklistPaket(db, targets, urutPick, arahPick)
        : ({ ok: true as const, paket: [] as PaketPicklist[] });
      if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);

      // Satu query nama + gudang untuk SEMUA SKU yang terlibat, dipakai bersama oleh jalur
      // order dan advance.
      //
      // Kenapa nama diambil dari master, bukan dari `advance_bookings.nama_produk`: kolom itu
      // berisi nama SHOPEE ("Lunch Box TRI J 4in1 7+ Sendok dan Garpu") sementara jalur order
      // memakai nama master ("Lunch Box Garuda Tri J Ungu"). Dua nama untuk barang yang sama
      // dalam satu tabel membuat picker mengira barangnya beda.
      //
      // Kenapa gudang dibaca, bukan hardcode "ONLINE": gudang ONLINE adalah gudang virtual dan
      // nyatanya kosong (0 baris stok). Menulis ONLINE di kolom "Lokasi Gudang" membuat kolom
      // itu tidak berguna — picker disuruh mencari barang di tempat yang tidak menyimpannya.
      const skuTerlibat = [
        ...new Set([
          ...pick.paket.flatMap((p) => p.rows.map((r) => r.sku)),
          ...booking.map((b2) => b2.sku),
        ]),
      ];
      const gudangNama = await petaNamaGudang(db);
      const infoSku = await infoNamaDanLokasi(db, skuTerlibat, gudangNama);

      const barisGabung: BarisPickGabung[] = [
        ...pick.paket.flatMap((p) =>
          p.rows.map((r) => {
            const info = infoSku.get(r.sku);
            return {
              jenis: "order" as const,
              sku: r.sku,
              nama: info?.nama || r.nama,
              lokasi: info?.lokasi ?? "",
              lokasiLain: info?.lokasiLain ?? "",
              qty: r.qty,
              kunci: p.no_resi || p.no_pesanan.join("+"),
              kirimKe: p.no_pesanan.join("+"),
              perluSku: r.perlu_sku === true,
              skuAsal: r.sku_asal ?? "",
            };
          })
        ),
        ...booking.map((b2) => {
          const info = infoSku.get(b2.sku);
          return {
            jenis: "advance" as const,
            sku: b2.sku,
            // Nama master; `nama_produk` cuma cadangan bila SKU belum ada di master.
            nama: info?.nama || b2.nama_produk,
            lokasi: info?.lokasi ?? "",
            lokasiLain: info?.lokasiLain ?? "",
            qty: b2.qty,
            kunci: b2.booking_sn,
            kirimKe: b2.antar_ke,
            perluSku: !info?.nama,
            skuAsal: b2.sku,
          };
        }),
      ];
      if (barisGabung.length === 0) {
        // Dua sebab berbeda, dua pesan berbeda: "tidak memilih apa pun" dan "memilih sesuatu
        // yang tidak punya item" butuh tindakan user yang berbeda.
        return json(
          {
            ok: false,
            error:
              targets.length === 0 && booking.length === 0
                ? "Pilih minimal satu order atau satu booking advance."
                : "Tak ada item untuk dicetak dari pilihan ini.",
          },
          400
        );
      }
      const bytes = await bangunPdfPicklistGabung(barisGabung, { gudangDefault: "Gudang ONLINE", urut: urutPick, arah: arahPick });
      return kirimPdf(new Uint8Array(bytes), "gabung-order", {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": disp("picklist-order-advance.pdf"),
          "cache-control": "no-store",
        },
      });
    }
    // Stok gudang ONLINE dipotong DI SINI, sekali per order, karena Kledo tidak mengenal
    // gudang virtual itu. Cetak ulang aman: orders.stok_dikurangi menahan pemotongan kedua.
    const potong = await potongOnlineUntukOrder(db, targets, String(sesi.user.id));
    if (!potong.ok) return json({ ok: false, error: potong.error }, potong.status);
    const namaFile = mode === "per_paket" ? "picklist-per-paket.pdf" : mode === "gabung" ? "picklist-gabung.pdf" : "picklist.pdf";
    const header = {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": disp(namaFile),
        // Kekurangan ikut di header supaya halaman order bisa memunculkan dialog permintaan
        // TANPA panggilan kedua. Header HTTP aman untuk teks pendek ber-ASCII.
        "x-kurang-online": String(potong.kurang.length),
        "cache-control": "no-store",
      },
    };
    if (mode === "gabung") {
      const pick = await buatPicklistPaket(db, targets, urutPick, arahPick);
      if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);
      const semua = pick.paket.flatMap((p) => p.rows.map((r) => ({ sku: r.sku, nama: r.nama, qty: r.qty, variasi: r.variasi ?? "", no_resi: p.no_resi })));
      if (semua.length === 0) return json({ ok: false, error: "Tak ada item untuk dicetak." }, 400);
      const bytes = await bangunPdfPicklistPaket(semua, { mode: "gabung", judul: "PICKLIST ORDER — GABUNG PER PAKET", subjudul: `${pick.paket.length} paket`, gudang: "Gudang ONLINE" });
      return kirimPdf(new Uint8Array(bytes), "gabung", header);
    }
    if (mode === "per_paket") {
      const pick = await buatPicklistPaket(db, targets, urutPick, arahPick);
      if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);
      const bytes = await bangunPdfPicklistPaket(pick.paket, { mode: "per_paket", judul: "PICKLIST ORDER — PER PAKET", subjudul: "", gudang: "Gudang ONLINE" });
      return kirimPdf(new Uint8Array(bytes), "per_paket", header);
    }
    const pick = await buatPicklist(db, targets, urutPick, arahPick);
    if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);
    const bytes = await bangunPdfPicklist(pick.rows, pick.orders);
    return kirimPdf(new Uint8Array(bytes), "pisah", header);
  }
  // Pratinjau isi picklist SEBELUM dicetak: daftar baris yang akan masuk PDF, dalam JSON.
  //
  // Kenapa harus dari server, bukan disusun di klien dari daftar order: isi picklist
  // dihitung ULANG dari `order_items` (+ booking advance untuk mode gabung-order). Klien
  // tidak punya `lokasiLain`, tidak punya baris advance, dan tidak tahu qty gabungan —
  // pratinjau yang disusun di klien akan menjanjikan angka yang berbeda dari kertas.
  //
  // Kuncinya: fungsi yang dipanggil di sini PERSIS sama dengan cabang `picklist-pdf` di
  // atas (buatPicklistPaket / buatPicklist / gabungPerSku) dengan `urut`/`arah` yang sama,
  // dan `gabung-order` memakai derivasi `urutPick`/`arahPick` yang sama persis. Tidak ada
  // kueri SQL paralel di sini — satu-satunya cara pratinjau tidak bisa melenceng dari PDF.
  if (aksi === "preview-picklist") {
    const db = getDb();
    const tgtP = bacaTargets(url.searchParams.get("targets") ?? "[]");
    if (!tgtP.ok) return json({ ok: false, error: tgtP.error }, 400);
    const targets = tgtP.targets;
    // Kontrak `booking` DISAMAKAN dengan jalur PDF: `null` = tidak menyaring (semua
    // `menunggu`), array = tepat SN itu, SN tak dikenal/menunggu-bukan → ditolak.
    const bkP = bacaBookingParam(url.searchParams.get("booking"));
    if (!bkP.ok) return json({ ok: false, error: bkP.error }, 400);
    const bookingSn = bkP.sn;
    // Derivasi urut/arah: DISALIN APA ADANYA dari cabang picklist-pdf. Sengaja tidak
    // diekstrak ke fungsi agar tidak ada satu pun jalur PDF yang ikut berubah — PDF yang
    // sudah dicetak owner tidak boleh bergeser hanya karena ada fitur pratinjau baru.
    const urutMinta = (url.searchParams.get("urut") ?? "").trim();
    const urutPick: KunciUrutPicklist = (KUNCI_URUT_PICKLIST as readonly string[]).includes(urutMinta)
      ? (urutMinta as KunciUrutPicklist)
      : "default";
    const arahPick: ArahUrutPicklist = url.searchParams.get("arah") === "desc" ? "desc" : "asc";
    const modeMinta = (url.searchParams.get("mode") ?? "").trim();
    const mode = modeMinta === "" ? ((await pakaiPerPaket(db, targets)) ? "per_paket" : "pisah") : modeMinta;
    if (mode !== "per_paket" && mode !== "pisah" && mode !== "gabung" && mode !== "gabung-order")
      return json({ ok: false, error: "Mode harus per_paket/pisah/gabung/gabung-order." }, 400);

    const judul: Record<string, string> = {
      "gabung-order": "PICKLIST ORDER — GABUNG ORDER + ADVANCE",
      gabung: "PICKLIST ORDER — GABUNG PER PAKET",
      per_paket: "PICKLIST ORDER — PER PAKET",
      pisah: "PICKLIST ORDER — PISAH",
    };
    type BarisPreview = { no: number; nama: string; sku: string; lokasi: string; qty: number; perluSku: boolean; skuAsal: string; grup?: string };
    let kolom: string[];
    let baris: Omit<BarisPreview, "no">[];
    // Kontribusi per sisi, supaya klien bisa menulis "12 order + 40 advance". Owner
    // bingung karena mode ini diam-diam menarik advance yang tidak ia pilih; angka ini
    // membuat isi lembar terlihat SEBELUM dicetak.
    //
    // Dihitung dari target UNIK, bukan `targets.length`: helper di bawah mendedupe kunci
    // `${mp}|${no}`, jadi target kembar menghasilkan satu set baris. Memakai panjang array
    // mentah akan menulis "12 order" di atas tabel yang isinya 11 order.
    let totalOrder = hitungOrderUnik(targets);
    let totalAdvance = 0;

    if (mode === "gabung-order") {
      // Cabang ini MENGULANG perakitan baris milik picklist-pdf karena butuh
      // `BarisPickGabung[]` — bentuk ANTARA yang tidak keluar dari sana (di sana ia langsung
      // jadi PDF). Yang diulang hanya perakitan; URUTANNYA tidak disalin: `gabungPerSku`
      // diimpor dari lib yang sama dengan jalur PDF, jadi pratinjau dan lembar tercetak
      // bernomor sama karena memakai satu implementasi, bukan dua yang dijaga tetap serupa.
      // Tidak ada order DAN tidak ada pilihan booking → tidak ada apa pun untuk dicetak.
      // Diperiksa SEBELUM menarik booking: tanpa order, "perilaku lama" (semua `menunggu`)
      // akan mengirim SELURUH database ke picker — persis cacat yang sedang diperbaiki.
      if (targets.length === 0 && bookingSn === null) {
        return json({ ok: false, error: "Pilih minimal satu order atau satu booking advance." }, 400);
      }
      const st = url.searchParams.get("status") ?? "menunggu";
      const ambil = await ambilBookingTerpilih(db, st, bookingSn);
      if (!ambil.ok) return json({ ok: false, error: ambil.error }, 400);
      const booking = ambil.booking;
      // Sama seperti jalur PDF: mode ini boleh jalan dengan HANYA advance.
      if (targets.length === 0 && booking.length === 0) {
        return json({ ok: false, error: "Pilih minimal satu order atau satu booking advance." }, 400);
      }
      const pick = targets.length > 0
        ? await buatPicklistPaket(db, targets, urutPick, arahPick)
        : ({ ok: true as const, paket: [] as PaketPicklist[] });
      if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);
      totalAdvance = booking.length;
      const skuTerlibat = [
        ...new Set([...pick.paket.flatMap((p) => p.rows.map((r) => r.sku)), ...booking.map((b2) => b2.sku)]),
      ];
      const gudangNama = await petaNamaGudang(db);
      const infoSku = await infoNamaDanLokasi(db, skuTerlibat, gudangNama);
      const barisGabung: BarisPickGabung[] = [
        ...pick.paket.flatMap((p) =>
          p.rows.map((r) => {
            const info = infoSku.get(r.sku);
            return {
              jenis: "order" as const,
              sku: r.sku,
              nama: info?.nama || r.nama,
              lokasi: info?.lokasi ?? "",
              lokasiLain: info?.lokasiLain ?? "",
              qty: r.qty,
              kunci: p.no_resi || p.no_pesanan.join("+"),
              kirimKe: p.no_pesanan.join("+"),
              perluSku: r.perlu_sku === true,
              skuAsal: r.sku_asal ?? "",
            };
          })
        ),
        ...booking.map((b2) => {
          const info = infoSku.get(b2.sku);
          return {
            jenis: "advance" as const,
            sku: b2.sku,
            nama: info?.nama || b2.nama_produk,
            lokasi: info?.lokasi ?? "",
            lokasiLain: info?.lokasiLain ?? "",
            qty: b2.qty,
            kunci: b2.booking_sn,
            kirimKe: b2.antar_ke,
            perluSku: !info?.nama,
            skuAsal: b2.sku,
          };
        }),
      ];
      kolom = ["No", "Nama Produk", "SKU", "Lokasi Gudang", "Quantity Total"];
      // SEKALI urut saja: `gabungPerSku` sudah mengurutkan hasilnya (lewat
      // `urutkanBarisGabung` di lib) dan lembar PDF memakai fungsi yang sama, jadi urutan
      // pratinjau dan urutan tercetak berasal dari SATU implementasi, bukan dua salinan.
      baris = gabungPerSku(barisGabung, urutPick, arahPick).map((r) => ({
        nama: r.nama,
        sku: r.sku,
        lokasi: r.lokasiLain ? `${r.lokasi} (${r.lokasiLain})` : r.lokasi,
        qty: r.qty,
        perluSku: r.perluSku,
        skuAsal: r.skuAsal,
      }));
    } else if (mode === "pisah") {
      const pick = await buatPicklist(db, targets, urutPick, arahPick);
      if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);
      kolom = ["No", "Nama Produk", "SKU", "Quantity Total"];
      baris = pick.rows.map((r) => ({
        nama: r.nama,
        sku: r.sku,
        // `buatPicklist` tidak menghitung lokasi — kolomnya memang tidak ada di mode ini.
        lokasi: "",
        qty: r.qty,
        perluSku: r.perlu_sku === true,
        skuAsal: r.sku_asal ?? "",
      }));
    } else {
      // `gabung` dan `per_paket` memakai baris yang SAMA (satu baris per baris item, semua
      // paket) — yang membedakan klien hanya pemisahan per `grup`. `no_resi` dikosongkan
      // oleh `buatPicklistPaket` untuk order tanpa resi, dan baris tanpa grup akan
      // memisahkan dua paket palsu yang sebenarnya berbeda paket.
      const pick = await buatPicklistPaket(db, targets, urutPick, arahPick);
      if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);
      kolom = ["No", "Nama Produk", "SKU", "Quantity Total"];
      baris = pick.paket.flatMap((p) =>
        p.rows.map((r) => ({
          nama: r.nama,
          sku: r.sku,
          lokasi: "",
          qty: r.qty,
          perluSku: r.perlu_sku === true,
          skuAsal: r.sku_asal ?? "",
          // Paket tanpa resi tetap dibedakan: tanpa ini semua order tanpa resi tampak
          // satu paket di pratinjau, padahal PDF mencetaknya sebagai lembar terpisah.
          grup: p.no_resi || `NO-RESI: ${p.no_pesanan.join("+")}`,
        }))
      );
    }

    if (baris.length === 0) {
      return json(
        {
          ok: false,
          error:
            totalOrder === 0 && totalAdvance === 0
              ? "Pilih minimal satu order atau satu booking advance."
              : "Tak ada item untuk dicetak dari pilihan ini.",
        },
        400
      );
    }

    const perluSku = baris.filter((b) => b.perluSku).length;
    return json({
      ok: true,
      mode,
      urut: urutPick,
      arah: arahPick,
      kolom,
      // Nomor diberikan SETELAH urutan final, sekali di sini supaya tidak ada mode yang
      // lupa menomori ulang.
      baris: baris.map((b, i) => ({ no: i + 1, ...b })),
      total_baris: baris.length,
      total_unit: baris.reduce((s, b) => s + b.qty, 0),
      ada_bermasalah: perluSku,
      // Isi lembar terlihat sebelum dicetak: berapa order dan berapa booking yang ikut.
      total_order: totalOrder,
      total_advance: totalAdvance,
      judul: judul[mode],
    });
  }
  if (aksi !== "daftar") return json({ ok: true, header: HEADER_PESANAN });
  const f = filterDariQuery(url);
  if (!f.ok) return json({ ok: false, error: f.error }, 400);
  const db = getDb();
  const filter = {
    mp: f.filter.mp,
    status: f.filter.status,
    dari: f.filter.dari,
    sampai: f.filter.sampai,
    limit: f.filter.limit,
    offset: f.filter.offset,
    kolomUrut: f.filter.kolomUrut,
    arah: f.filter.arah,
  };
  // Jalur ber-SKU memakai subquery EXISTS supaya HIMPUNAN yang dipaginasi = himpunan yang
  // difilter; menyaring sesudah LIMIT akan memangkas halaman dan membuat footer menunjuk
  // halaman yang isinya hampir kosong.
  const halaman = f.filter.sku
    ? await listOrderBerSku(db, { ...filter, sku: f.filter.sku })
    : await listOrder(db, filter);
  const daftar = halaman.orders;
  // Header+item+fee SEMUA baris halaman dalam beberapa kueri, bukan 3 kueri per baris.
  const orders = await ambilOrderBanyak(db, daftar.map((h) => ({ mp: h.marketplace, no: h.no_pesanan })));
  // Tag "sudah diekspor" per mode: satu gelombang kueri untuk SEMUA order di daftar, bukan
  // satu kueri per baris. Kunci `${mp}|${no}` sama dengan kunci `kunciOrder` di halaman order.
  const ekspor = Object.fromEntries(await petaEkspor(db, daftar.map((h) => ({ mp: h.marketplace, no: h.no_pesanan }))));
  return json({
    ok: true,
    orders,
    ekspor,
    total: halaman.total,
    halaman: f.filter.halaman,
    ukuran: f.filter.limit,
    jumlah_halaman: Math.max(1, Math.ceil(halaman.total / f.filter.limit)),
    urut: f.filter.kolomUrut,
    arah: f.filter.arah,
  });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  const db = getDb();

  if (aksi === "transisi-batch") {
    const daftar = Array.isArray(body.targets) ? body.targets : [];
    if (daftar.length === 0) return json({ ok: false, error: "Daftar order kosong." }, 400);
    if (daftar.length > 200) return json({ ok: false, error: "Maksimal 200 order per aksi." }, 400);
    const targets: { mp: string; no: string; ke: KeFulfill }[] = [];
    for (const t of daftar as Record<string, unknown>[]) {
      const mp = teks(t.marketplace).toLowerCase();
      const no = teks(t.no_pesanan);
      const ke = teks(t.ke);
      if (!mp || !no) return json({ ok: false, error: "Marketplace + NoPesanan wajib diisi." }, 400);
      if (!KE_VALID.includes(ke)) return json({ ok: false, error: "Transisi tidak dikenal (pack/kirim/selesai/batal)." }, 400);
      targets.push({ mp, no, ke: ke as KeFulfill });
    }
    const hasil = await transisiFulfillBatch(db, targets, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, count: hasil.count, status: hasil.status });
  }

  if (aksi === "transisi") {
    const mp = teks(body.marketplace).toLowerCase();
    const no = teks(body.no_pesanan);
    const ke = teks(body.ke);
    if (!mp || !no) return json({ ok: false, error: "Marketplace + NoPesanan wajib diisi." }, 400);
    if (!KE_VALID.includes(ke)) return json({ ok: false, error: "Transisi tidak dikenal (pack/kirim/selesai/batal)." }, 400);
    const hasil = await transisiFulfill(db, mp, no, ke as "pack" | "kirim" | "selesai" | "batal", user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, status: hasil.status });
  }
  // ── Impor BERTAHAP (mulai-impor → impor-potong → selesai-impor) ────────────────────────
  // Dipakai klien untuk berkas besar. Tiap potongan = satu invocation Worker sendiri, jadi
  // anggaran 50 KUERI per invokasi di-reset tiap request. Jalur LAMA di bawah tetap ada
  // (dan tetap berfungsi untuk batch 'fase2' yang sudah terlanjur dibuat), tetapi klien
  // sekarang selalu memakai jalur bertahap — berkas kecil pun hanya jadi satu potongan,
  // sehingga jalur kecil dan besar memakai kode yang sama.
  if (aksi === "mulai-impor") {
    const file = teks(body.namaBerkas).slice(0, 120) || "orders.xlsx";
    const totalBaris = Number(body.totalBaris);
    if (!Number.isFinite(totalBaris) || totalBaris <= 0) {
      return json({ ok: false, error: "totalBaris wajib angka > 0." }, 400);
    }
    // `mulaiBaru: true` = user sengaja memilih "Mulai dari awal" untuk berkas yang sama. Batch
    // lama ditandai 'batal', BUKAN dihapus: `import_errors.batch_id` ber-ON DELETE CASCADE, jadi
    // menghapus batch ikut membuang riwayat galat per baris yang masih berguna. 'batal' sudah
    // nilai sah CHECK status (migrasi 0005), jadi tak perlu migrasi baru. Setelah ditandai,
    // batch itu otomatis tak lagi terlihat oleh SELECT resume di bawah (`status = 'preview'`).
    if (body.mulaiBaru === true) {
      await db
        .prepare("UPDATE import_batches SET status = 'batal', sukses = progres_baris WHERE file = ? AND mode_impor = 'bertahap' AND status = 'preview' AND progres_baris > 0")
        .bind(file)
        .run();
    }
    // Resume: unggah ulang berkas yang sama (tab tertutup / jaringan putus) harus MELANJUTKAN
    // batch yang sudah ada, bukan memulai dari nol. Batch tanpa progres sama saja batch baru,
    // jadi sengaja dilewati supaya baris kosong menumpuk.
    // `total` = jumlah ORDER (unit yang dipotong klien), bukan baris berkas — lihat catatan
    // di `impor-potong` soal kenapa satuan progres harus order.
    const lama = await db
      .prepare("SELECT id, progres_baris FROM import_batches WHERE file = ? AND mode_impor = 'bertahap' AND status = 'preview' AND progres_baris > 0 ORDER BY at DESC LIMIT 1")
      .bind(file)
      .first<{ id: number; progres_baris: number }>();
    if (lama) {
      return json({ ok: true, batchId: lama.id, sudahBaris: lama.progres_baris, dilanjutkan: true, ukuranPotong: UKURAN_POTONG });
    }
    const ins = await db
      .prepare("INSERT INTO import_batches (tipe, file, total, sukses, gagal, gudang_id, payload_json, status, at, by, mode_impor) VALUES ('pesanan_shopee', ?, ?, 0, 0, 'ONLINE', '[]', 'preview', ?, ?, 'bertahap')")
      .bind(file, totalBaris, Math.floor(Date.now() / 1000), user.tg_id)
      .run();
    return json({ ok: true, batchId: Number(ins.meta.last_row_id), sudahBaris: 0, dilanjutkan: false, ukuranPotong: UKURAN_POTONG });
  }

  if (aksi === "impor-potong") {
    const batchId = Number(body.batchId);
    if (!Number.isFinite(batchId) || batchId <= 0) return json({ ok: false, error: "batchId wajib angka." }, 400);
    const nomorPotong = Number(body.nomorPotong);
    if (!Number.isFinite(nomorPotong) || nomorPotong <= 0) return json({ ok: false, error: "nomorPotong wajib angka > 0." }, 400);
    const potongan = Array.isArray(body.potongan) ? (body.potongan as GabunganOrder[]) : [];
    if (potongan.length === 0) return json({ ok: false, error: "Potongan kosong." }, 400);
    if (potongan.length > UKURAN_POTONG) {
      return json({ ok: false, error: `Satu potongan maksimal ${UKURAN_POTONG} baris (dikirim ${potongan.length}).` }, 400);
    }
    const batch = await db
      .prepare("SELECT id, file, total, status, nomor_potong, progres_baris, dilewati FROM import_batches WHERE id = ? AND tipe = 'pesanan_shopee' AND mode_impor = 'bertahap'")
      .bind(batchId)
      .first<{ id: number; file: string; total: number; status: string; nomor_potong: number; progres_baris: number; dilewati: number }>();
    if (!batch) return json({ ok: false, error: "Batch impor tidak ditemukan." }, 404);
    if (batch.status === "done") return json({ ok: false, error: "Batch ini sudah selesai diimpor." }, 409);
    // Idempoten: klien boleh mengulang kirim karena jaringan putus. Potongan yang nomornya
    // sudah tercatat TIDAK diproses ulang — kalau diproses, barisnya tersimpan dua kali.
    if (nomorPotong <= batch.nomor_potong) {
      return json({ ok: true, tersimpan: 0, dilewati: 0, progressBaris: batch.progres_baris, sudahDiproses: true });
    }
    // Potongan harus berurutan: lompatan nomor menandakan klien kehilangan jawaban, dan
    // memprosesnya akan membuat `progres_baris` tak lagi mencerminkan baris yang benar masuk.
    if (nomorPotong > batch.nomor_potong + 1) {
      return json(
        { ok: false, error: `Potongan ${nomorPotong} datang terlalu jauh — potongan ${batch.nomor_potong + 1} belum dikirim. Ulangi dari potongan itu.`, progressBaris: batch.progres_baris },
        409,
      );
    }
    const skuManual = new Map<string, string>();
    if (Array.isArray(body.skuManual)) {
      for (const m of body.skuManual as Record<string, unknown>[]) {
        const ref = teks(m.order_ref);
        const nama = teks(m.nama_shopee);
        const variasi = teks(m.variasi);
        const sku = teks(m.sku).toUpperCase();
        if (ref && sku) skuManual.set(`${ref}\u0000${nama}\u0000${variasi}`, sku);
      }
    }
    const kunciBelumMp = new Set<string>();
    if (Array.isArray(body.tandaiBelumMp)) {
      for (const t of body.tandaiBelumMp as Record<string, unknown>[]) {
        const namaShopee = teks(t.nama_shopee);
        if (!namaShopee) continue;
        kunciBelumMp.add(`${teks(t.order_ref)}\u0000${namaShopee}\u0000${teks(t.variasi)}`);
        await tandaiBelumMp(db, {
          namaShopee, variasi: teks(t.variasi), orderRef: teks(t.order_ref), oleh: String(user.tg_id),
          sumber: teks(t.sumber) || "order",
          skuAsal: teks(t.sku_asal),
          qtyTotal: Number(t.qty_total) || 0,
        });
      }
    }
    // Cache SELECT produk per potongan: satu SKU yang muncul di puluhan baris cukup satu kueri.
    // Inilah penghemat utama yang membuat potongan 200 baris tetap di bawah anggaran subrequest.
    const susunan = await susunPernyataanOrder(db, batch.id, potongan, {
      skuManual,
      kunciBelumMp,
      ambilProdukCache: new Map(),
    });
    if (susunan.pesanKurangSku) return json({ ok: false, error: susunan.pesanKurangSku }, 400);
    if (susunan.produkPenanda.length > 0) {
      await db.batch(siapkanProdukPenanda(db, susunan.produkPenanda, Math.floor(Date.now() / 1000)));
    }
    const { gagalTotal, dilewati, belumDicoba } = await jalankanPernyataan(db, susunan.stmts);
    if (susunan.stmts.length > 0 && gagalTotal === susunan.stmts.length) {
      return json({ ok: false, error: `Seluruh ${susunan.stmts.length} pernyataan potongan ${nomorPotong} ditolak (masalah skema/DB). Contoh: ${dilewati[0]?.pesan ?? "-"}` }, 500);
    }
    // `dilewati` dihitung PER PERNYATAAN, bukan per order: satu order bisa menyimpan header
    // tapi kehilangan salah satu item-nya, dan menghitungnya sebagai "satu order dilewati"
    // akan melaporkan angka yang lebih kecil dari kenyataan.
    const stmtsTersimpan = susunan.stmts.length - gagalTotal - belumDicoba;
    // Progres dihitung dalam ORDER, bukan baris: klien memotong array `orders` dari hasil
    // preview, jadi resume harus bisa menjawab "order ke berapa yang sudah masuk". Menghitung
    // baris membuat berkas dengan >1 item/order melompati order yang belum dikirim (potongan
    // berikutnya dihitung dari indeks order, bukan dari jumlah baris).
    const suksesPotong = gagalTotal === 0 && belumDicoba === 0;
    const progresOrder = suksesPotong ? batch.progres_baris + potongan.length : batch.progres_baris;
    const nomorTercatat = suksesPotong ? nomorPotong : batch.nomor_potong;
    // `sukses`/`dilewati` di sini adalah AKUMULASI batch, bukan angka potongan: laporan akhir
    // harus menyebut total berkas, dan angka potongan sebelumnya sudah tak bisa dibaca lagi.
    await db
      .prepare("UPDATE import_batches SET nomor_potong = ?, progres_baris = ?, sukses = ?, dilewati = ? WHERE id = ?")
      .bind(nomorTercatat, progresOrder, progresOrder, batch.dilewati + dilewati.length, batch.id)
      .run();
    if (!suksesPotong) {
      return json(
        {
          ok: false,
          error:
            `Potongan ${nomorPotong}: ${dilewati.length} pernyataan ditolak${belumDicoba > 0 ? ` dan ${belumDicoba} belum dicoba (anggaran kueri request habis)` : ""}. ` +
            `${progresOrder} dari ${batch.total} order berkas sudah tersimpan. Tekan Konfirmasi lagi untuk mencoba potongan ini sekali lagi.`,
          tersimpan: stmtsTersimpan,
          dilewati: dilewati.length,
          belumDicoba,
          progressBaris: progresOrder,
        },
        409,
      );
    }
    return json({ ok: true, tersimpan: potongan.length, dilewati: 0, progressBaris: progresOrder });
  }

  if (aksi === "selesai-impor") {
    const batchId = Number(body.batchId);
    if (!Number.isFinite(batchId) || batchId <= 0) return json({ ok: false, error: "batchId wajib angka." }, 400);
    const batch = await db
      .prepare("SELECT id, file, total, progres_baris, dilewati, by FROM import_batches WHERE id = ? AND tipe = 'pesanan_shopee' AND mode_impor = 'bertahap'")
      .bind(batchId)
      .first<{ id: number; file: string; total: number; progres_baris: number; dilewati: number; by: string | null }>();
    if (!batch) return json({ ok: false, error: "Batch impor tidak ditemukan." }, 404);
    const hash = teks(body.hash);
    // `tandaiBelumMp`/`skuManual` TIDAK diproses di sini: keduanya sudah ditangani tiap potongan
    // (`impor-potong`) — di sanalah baris yang bersangkutan benar-benar ditulis. Memprosesnya
    // lagi di sini akan mendaftarkan produk yang sama dua kali ke daftar tunggu.
    const advance = Array.isArray(body.advance) ? (body.advance as ShopeeBooking[]) : [];
    const bookingBaru = advance.length > 0 ? await simpanBooking(db, advance, batch.id) : 0;
    const jmlResi = await isiResiGrup(db, batch.id);
    // Anti-dobel berkas dicatat di sini, bukan di `mulai-impor`: berkas yang batal di tengah
    // jalan justru HARUS bisa diunggah ulang, jadi belum boleh dianggap "sudah diimpor".
    if (hash) {
      await catatImportFile(db, {
        tipe: "orders_toship",
        file: batch.file,
        hash,
        no_json: [],
        batch_id: batch.id,
        by: String(user.tg_id),
      });
    }
    await db.prepare("UPDATE import_batches SET status = 'done', sukses = ? WHERE id = ?").bind(batch.progres_baris, batch.id).run();
    return json({
      ok: true,
      // `order` = jumlah ORDER di berkas; `item` = order yang benar-benar masuk (progres_baris).
      // Keduanya dibedakan supaya laporan tidak mengaku menyimpan order yang ternyata dilewati.
      order: batch.total,
      item: batch.progres_baris,
      advance: bookingBaru,
      advance_skip: advance.length - bookingBaru,
      resi_grup: jmlResi,
      batch_id: batch.id,
      dilewati: batch.dilewati,
    });
  }

  if (aksi === "preview-shopee") {
    const orderRows = Array.isArray(body.ordersRows) ? (body.ordersRows as ShopeeOrderRow[]) : [];
    const advanceRows = Array.isArray(body.advanceRows) ? (body.advanceRows as ShopeeAdvanceRow[]) : [];
    if (orderRows.length === 0 && advanceRows.length === 0) return json({ ok: false, error: "Sheet orders/Advance Fulfilment kosong." }, 400);
    const file = typeof body.file === "string" ? body.file.trim().slice(0, 120) : "orders.xlsx";
    // Berkas besar TIDAK lagi ditolak berdasarkan jumlah baris: preview hanya membaca, dan
    // baris hasilnya kini dipegang KLIEN (bukan disimpan sebagai satu payload_json). Batas
    // baris dipindah ke jalur impor bertahap, yang memang memprosesnya sepotong-sepotong.
    // Yang masih dijaga di sini adalah UKURAN muatan — request raksasa gagal di jaringan
    // sebelum sampai ke Worker, dan pesannya harus jelas, bukan 413 tanpa sebab.
    const byteMuatan = Number(request.headers.get("content-length") ?? 0);
    if (byteMuatan > MAKS_BYTE_PREVIEW) {
      const mb = (byteMuatan / 1024 / 1024).toFixed(1);
      const batasMb = (MAKS_BYTE_PREVIEW / 1024 / 1024).toFixed(0);
      return json(
        {
          ok: false,
          error:
            `Berkas terlalu besar untuk dibaca server: ${mb} MB (batas ${batasMb} MB). ` +
            `Isinya ${orderRows.length} baris orders + ${advanceRows.length} baris Advance Fulfilment. ` +
            "Pilih rentang tanggal lebih pendek di ekspor Shopee lalu unggah beberapa berkas terpisah.",
        },
        413,
      );
    }
    try {
      // T2: fingerprint + 3a tolak file sama.
      const hash = await hitungFingerprint([...orderRows, ...advanceRows], file);
      const sudah = await cekFileSudahAda(db, "orders_toship", hash);
      if (sudah && sudah.batch_id !== null) {
        return json({ ok: false, error: `File ini sudah pernah diimpor (batch #${sudah.batch_id}, ${sudah.file}).` }, 409);
      }
      const cekSku = new Map<string, boolean>();
      const adaSku = async (sku: string): Promise<boolean> => {
        const lama = cekSku.get(sku);
        if (lama !== undefined) return lama;
        const ada = Boolean(await ambilProduk(db, sku));
        cekSku.set(sku, ada);
        return ada;
      };
      const skuAda = new Set<string>();
      for (const r of [...orderRows, ...advanceRows]) {
        const sku = String(r["Nomor Referensi SKU"] ?? r["SKU Induk"] ?? "").trim().toUpperCase();
        if (sku) skuAda.add(sku);
      }
      // Dulu `for (const sku of skuAda) await adaSku(sku)` — 33 SKU di berkas besar = 33
      // round-trip berurutan; waktu menumpuk linier dan anggaran CPU Worker habis.
      await mapPotong([...skuAda], UKURAN_BATCH_SKU, (sku) => adaSku(sku));
      const normal = normalisasiSheetShopee(orderRows, advanceRows, (sku) => cekSku.get(sku) === true);
      // Tebak SKU per GRUP (nama+variasi identik), bukan per baris: satu grup = satu tebakan.
      // Grup di atas MAKS_GRUP_TEBAK tidak ditebak (4 kueri/grup — anggaran waktu request)
      // TAPI jumlahnya dilaporkan lewat tebakan_dilewati, tidak diam-diam disembunyikan.
      const grupTebak = normal.belumSku.slice(0, MAKS_GRUP_TEBAK);
      const grupLewat = normal.belumSku.slice(MAKS_GRUP_TEBAK);
      const tebakan = await mapPotong(grupTebak, UKURAN_BATCH_SKU, (b) => tebakSku(db, b.nama_shopee, b.variasi));
      const belumSku: (BarisBelumSku & { tebakan: TebakanSku })[] = [
        ...grupTebak.map((b, i) => ({ ...b, tebakan: tebakan[i] })),
        ...grupLewat.map((b) => ({ ...b, tebakan: { sku: "", perlu_pilih_manual: true, kandidat: [] } })),
      ];
      // Klasifikasi T3/T3b (blokir/peringatan sebelum tulis).
      const orderBaru: OrderBaru[] = normal.orders.map((o) => ({
        no_pesanan: o.no_pesanan,
        no_resi: o.noResi,
        statusFile: o.statusFile,
        jasaKirim: o.jasaKirim,
        tipeLayanan: o.tipeLayanan,
        cod: o.cod,
        preorder: o.preorder,
      }));
      const klasifikasi = await klasifikasikanImport(db, orderBaru, normal.advance.map((a) => ({ booking_sn: a.booking_sn, no_resi: a.no_resi })));
      // D3: compare nama (peringatan saja).
      const pasangan = normal.orders.flatMap((o) => o.items.map((i) => ({ sku: i.sku, nama_shopee: i.nama_shopee })));
      const compare = await compareNama(db, pasangan);
      // `payload_json` DIBIARKAN KOSONG. Dulu seluruh dataset di-JSON-kan ke kolom ini: pada
      // 5000 baris itu satu baris ~2 MB di D1 — risiko nyata (batas ukuran baris/nilai) dan
      // tak pernah dibaca lagi sejak jalur konfirmasi dipecah. Sekarang baris hasil preview
      // dipegang KLIEN di memori dan dikirim balik per potongan lewat `impor-potong`.
      const ins = await db
        .prepare("INSERT INTO import_batches (tipe, file, total, sukses, gagal, gudang_id, payload_json, status, at, by) VALUES ('pesanan_shopee', ?, ?, ?, ?, 'ONLINE', '[]', 'preview', ?, ?)")
        .bind(file, orderRows.length + advanceRows.length, normal.orders.length, normal.gagal.length, Math.floor(Date.now() / 1000), user.tg_id)
        .run();
      return json({
        ok: true,
        batch_id: Number(ins.meta.last_row_id),
        hash,
        file,
        orders: normal.orders,
        advance: normal.advance,
        belumSku,
        tebakan_dilewati: grupLewat.length,
        gagal: normal.gagal,
        klasifikasi: {
          baru: klasifikasi.baru.length,
          update: klasifikasi.update.length,
          skip: klasifikasi.skip.length,
          mundur: klasifikasi.mundur,
          resiMultiOrder: klasifikasi.resiMultiOrder,
          gandaDalamFile: klasifikasi.gandaDalamFile,
          kriteriaGabungan: klasifikasi.kriteriaGabungan,
          advanceSkip: klasifikasi.advanceSkip,
        },
        compareNama: compare,
      });
    } catch (e) {
      // Tanpa ini, timeout/kegagalan DB keluar sebagai 500 kosong dan user tidak tahu apa yang salah.
      const pesan = e instanceof Error ? e.message : "kesalahan tak dikenal";
      return json(
        {
          ok: false,
          error:
            `Preview berkas ini gagal: ${pesan}. Berkas ini terlalu besar untuk dibaca server dalam sekali jalan ` +
            `(${orderRows.length} baris orders + ${advanceRows.length} baris Advance Fulfilment). ` +
            "Coba pisah berkasnya, atau ulangi — impor besar diproses bertahap setelah ini.",
          orders: orderRows.length,
          advance: advanceRows.length,
        },
        503,
      );
    }
  }
  if (aksi === "preview") {
    const rows = body.rows;
    if (!Array.isArray(rows) || rows.length === 0) return json({ ok: false, error: "Rows kosong." }, 400);
    if (rows.length > MAKS_BARIS) return json({ ok: false, error: `Maksimal ${MAKS_BARIS} baris per import.` }, 400);
    const sukses: BarisPesanan[] = [];
    const gagal: BarisGagal[] = [];
    const cekSku = new Map<string, boolean>();
    const lihatItem = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const noBaris = i + 2;
      const r = rows[i] as Record<string, unknown>;
      if (typeof r !== "object" || r === null) {
        gagal.push({ baris: noBaris, pesan: `Baris ${noBaris}: format baris tak dikenal.` });
        continue;
      }
      const v = await validasiBarisPesanan(db, r, noBaris, cekSku);
      if (!v.ok) {
        gagal.push({ baris: noBaris, pesan: v.pesan });
        continue;
      }
      const kunci = `${v.data.marketplace} ${v.data.no_pesanan} ${v.data.sku}`;
      if (lihatItem.has(kunci)) {
        gagal.push({ baris: noBaris, pesan: `Baris ${noBaris}: duplikat (Marketplace, NoPesanan, SKU) dalam file.` });
        continue;
      }
      lihatItem.add(kunci);
      sukses.push(v.data);
    }
    const peringatan: string[] = [];
    const namaFile = typeof body.file === "string" && body.file.trim() ? body.file.trim().slice(0, 120) : "pesanan.json";
    const ins = await db.prepare("INSERT INTO import_batches (tipe, file, total, sukses, gagal, gudang_id, payload_json, status, at, by) VALUES ('pesanan', ?, ?, ?, ?, 'ONLINE', ?, 'preview', ?, ?)")
      .bind(namaFile, rows.length, sukses.length, gagal.length, JSON.stringify(sukses), Math.floor(Date.now() / 1000), user.tg_id).run();
    const batchId = Number(ins.meta.last_row_id);
    for (let i = 0; i < gagal.length; i += 100) {
      const chunk = gagal.slice(i, i + 100);
      await db.batch(chunk.map((g) => db.prepare("INSERT INTO import_errors (batch_id, baris, pesan) VALUES (?, ?, ?)").bind(batchId, g.baris, g.pesan)));
    }
    return json({ ok: true, batch_id: batchId, total: rows.length, sukses: sukses.length, gagal, peringatan });
  }

  if (aksi === "konfirmasi-shopee") {
    if (typeof body.batch_id !== "number") return json({ ok: false, error: "batch_id wajib angka." }, 400);
    const batch = await db
      .prepare("SELECT id, file, payload_json, by FROM import_batches WHERE id = ? AND status = 'preview' AND tipe = 'pesanan_shopee'")
      .bind(body.batch_id)
      .first<{ id: number; file: string; payload_json: string; by: string | null }>();
    if (!batch) return json({ ok: false, error: "Batch tidak ditemukan / sudah diproses." }, 404);
    let payload: { orders: GabunganOrder[]; advance: ShopeeBooking[]; hash?: string };
    try {
      payload = JSON.parse(batch.payload_json) as typeof payload;
    } catch {
      return json({ ok: false, error: "Payload batch rusak." }, 500);
    }
    const orders = Array.isArray(payload.orders) ? payload.orders : [];
    const advance = Array.isArray(payload.advance) ? payload.advance : [];
    if (orders.length === 0 && advance.length === 0) return json({ ok: false, error: "Tak ada order valid untuk disimpan." }, 400);
    // Tanpa hash asli, anti-dobel kosong → tolak. Jangan mengarang hash (hash array kosong
    // akan identik untuk SEMUA file sehingga file berbeda ditolak sebagai "sudah diimpor").
    if (typeof payload.hash !== "string" || payload.hash === "") {
      return json({ ok: false, error: "Batch lama tanpa fingerprint — ulangi preview file ini." }, 409);
    }
    // SKU manual dari UI (baris tanpa SKU di MP) — dipetakan ke barisnya saat commit.
    const skuManual = new Map<string, string>();
    if (Array.isArray(body.skuManual)) {
      for (const m of body.skuManual as Record<string, unknown>[]) {
        const ref = teks(m.order_ref);
        const nama = teks(m.nama_shopee);
        const variasi = teks(m.variasi);
        const sku = teks(m.sku).toUpperCase();
        if (ref && sku) skuManual.set(`${ref}\u0000${nama}\u0000${variasi}`, sku);
      }
    }
    const noList: string[] = [];
    // Produk penanda yang WAJIB disisipkan sebelum `order_items` menunjuknya (FK). Kunci =
    // SKU penanda supaya satu penanda yang muncul di beberapa baris tidak didaftarkan dua kali.
    // Item tanpa SKU yang ditandai "belum ada di MP": dicatat di sku_belum_mp untuk diurus
    // nanti, dan TIDAK ditulis ke order_items (belum punya SKU master untuk dirujuk).
    const kunciBelumMp = new Set<string>();
    if (Array.isArray(body.tandaiBelumMp)) {
      for (const t of body.tandaiBelumMp as Record<string, unknown>[]) {
        const namaShopee = teks(t.nama_shopee);
        if (!namaShopee) continue;
        const variasi = teks(t.variasi);
        const orderRef = teks(t.order_ref);
        kunciBelumMp.add(`${orderRef}\u0000${namaShopee}\u0000${variasi}`);
        await tandaiBelumMp(db, {
          namaShopee, variasi, orderRef, oleh: String(user.tg_id),
          sumber: teks(t.sumber) || "order",
          skuAsal: teks(t.sku_asal),
          qtyTotal: Number(t.qty_total) || 0,
        });
      }
    }
    // Penyusunan pernyataan dibagi dengan jalur bertahap (susunPernyataanOrder) supaya kedua
    // jalur tak pernah menyimpang aturannya.
    const susunan = await susunPernyataanOrder(db, batch.id, orders, {
      skuManual,
      kunciBelumMp,
      ambilProdukCache: new Map(),
    });
    if (susunan.pesanKurangSku) return json({ ok: false, error: susunan.pesanKurangSku }, 400);
    const stmts = susunan.stmts;
    let nItem = susunan.nItem;
    for (const o of orders) noList.push(o.no_pesanan);
    // Produk penanda WAJIB masuk sebelum order_items menunjuknya, dan tanpa penundaan: satu
    // batch terpisah yang kecil. `INSERT OR IGNORE` + pemetaan per penanda → impor ulang
    // tidak membuat duplikat.
    if (susunan.produkPenanda.length > 0) {
      const at = Math.floor(Date.now() / 1000);
      await db.batch(siapkanProdukPenanda(db, susunan.produkPenanda, at));
    }
    // Baris yang tidak bisa disimpan — dibalas ke UI, BUKAN menggagalkan seluruh berkas.
    // Sebelum ini `await db.batch(...)` telanjang: satu pernyataan buruk (mis. FK) melempar,
    // seluruh konfirmasi jadi 500, order yang sehat ikut hilang, dan pesannya tidak
    // menjelaskan apa pun.
    const { gagalTotal, dilewati, belumDicoba } = await jalankanPernyataan(db, stmts);
    // Semua pernyataan gagal = bukan satu baris buruk, tapi masalah skema/lingkungan.
    // Balas error supaya tidak berpura-pura sukses menyimpan nol baris.
    if (stmts.length > 0 && gagalTotal === stmts.length) {
      return json({ ok: false, error: `Semua ${stmts.length} pernyataan impor ditolak (masalah skema/DB), bukan satu baris. Contoh: ${dilewati[0]?.pesan ?? "-"}` }, 500);
    }
    if (belumDicoba > 0) {
      // Anggaran kueri request habis sebelum semua baris dicoba. Berkas kecil tetap dijalur ini,
      // jadi kasusnya jarang — tapi kalau terjadi, umpan baliknya harus menyebut sisa barisnya,
      // bukan mengaku "selesai" dengan angka yang lebih kecil dari isi berkas.
      return json(
        {
          ok: false,
          error: `${belumDicoba} pernyataan belum sempat dicoba karena anggaran kueri request habis. Ulangi impor berkas ini — baris yang sudah tersimpan tidak ditulis ulang.`,
          tersimpan: nItem - dilewati.length,
          dilewati: dilewati.length,
          belumDicoba,
        },
        503,
      );
    }
    nItem -= dilewati.length;
    const bookingBaru = await simpanBooking(db, advance, batch.id);
    const jmlResi = await isiResiGrup(db, batch.id);
    await catatImportFile(db, {
      tipe: "orders_toship",
      file: batch.file,
      hash: payload.hash,
      no_json: [...noList, ...advance.map((a) => a.booking_sn)],
      batch_id: batch.id,
      by: String(user.tg_id),
    });
    await db.prepare("UPDATE import_batches SET status = 'done', sukses = ? WHERE id = ?").bind(nItem, batch.id).run();
    return json({
      ok: true,
      order: orders.length,
      item: nItem,
      advance: bookingBaru,
      advance_skip: advance.length - bookingBaru,
      resi_grup: jmlResi,
      batch_id: batch.id,
      // Baris yang ditolak D1 (biasanya FK). Order lain tetap tersimpan; UI menampilkan
      // daftar ini supaya user tahu mana yang perlu diperbaiki, bukan 500 tanpa penjelasan.
      dilewati,
    });
  }
  if (aksi === "hapus") {
    const daftar = Array.isArray(body.targets) ? body.targets : [];
    if (daftar.length === 0) return json({ ok: false, error: "Daftar order kosong." }, 400);
    if (daftar.length > 200) return json({ ok: false, error: "Maksimal 200 order per aksi." }, 400);
    const targets: { mp: string; no: string }[] = [];
    for (const t of daftar as Record<string, unknown>[]) {
      const mp = teks(t.marketplace).toLowerCase();
      const no = teks(t.no_pesanan);
      if (!mp || !no) return json({ ok: false, error: "Marketplace + NoPesanan wajib diisi." }, 400);
      targets.push({ mp, no });
    }
    // Hapus = koreksi salah impor: hanya baris order (header + anak). Jalur laba (fee dihitung
    // ulang dari preset saat /laba) dan jalur stok (potong stok ada di Kledo, bukan di sini)
    // tidak disentuh — jadi tak ada angka yang perlu dikembalikan.
    // Anak (order_items, order_fees) dihapus lebih dulu: FK-nya ON DELETE CASCADE ke orders.
    let dihapus = 0;
    for (let i = 0; i < targets.length; i += 50) {
      const batch = targets.slice(i, i + 50);
      const stmts: D1PreparedStatement[] = [];
      for (const t of batch) {
        stmts.push(db.prepare("DELETE FROM order_items WHERE marketplace = ? AND no_pesanan = ?").bind(t.mp, t.no));
        stmts.push(db.prepare("DELETE FROM order_fees WHERE marketplace = ? AND no_pesanan = ?").bind(t.mp, t.no));
        stmts.push(db.prepare("DELETE FROM orders WHERE marketplace = ? AND no_pesanan = ?").bind(t.mp, t.no));
      }
      const hasil = await db.batch(stmts);
      for (let j = 2; j < hasil.length; j += 3) dihapus += hasil[j].meta.changes ?? 0;
    }
    return json({ ok: true, dihapus });
  }
  if (aksi === "konfirmasi") {
    if (typeof body.batch_id !== "number") return json({ ok: false, error: "batch_id wajib angka." }, 400);
    const batch = await db.prepare("SELECT * FROM import_batches WHERE id = ? AND status = 'preview' AND tipe = 'pesanan'").bind(body.batch_id).first<{ id: number; payload_json: string }>();
    if (!batch) return json({ ok: false, error: "Batch tidak ditemukan / sudah diproses." }, 404);
    let daftar: BarisPesanan[] = [];
    try {
      daftar = JSON.parse(batch.payload_json) as BarisPesanan[];
    } catch {
      return json({ ok: false, error: "Payload batch rusak." }, 500);
    }
    const hasil = await imporPesanan(db, daftar, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    await db.prepare("UPDATE import_batches SET status = 'done', sukses = ? WHERE id = ?").bind(hasil.item, batch.id).run();
    return json({ ok: true, order: hasil.order, item: hasil.item, batch_id: batch.id });
  }

  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
