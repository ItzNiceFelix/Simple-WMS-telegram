// lib/sheets/syncMasterData.js
// Alur A (bagian 4): sync SEARAH Sheets → Firestore, dipanggil terjadwal via GitHub Actions.
// Sumbernya 2 sheet: DATABASE_ACCURATE (kode_barang, nama_accurate, hpp) dan Mapping
// (nama_shopee, variasi, mark_down, checker_nama_accurate) — lihat bagian 1a skema.
//
// BEDA dari syncStokDuaArah.js: ini gak perlu review manusia / draft konfirmasi, karena
// arahnya searah dan Sheets di sini emang "sumber kebenaran" utk data master (HPP dll),
// bukan data yang bisa berubah dari 2 sisi kayak stok.

const { bacaRange } = require("./client");
const { normalisasiNama, simpanProduk, ambilProdukByKode } = require("../models/produk");

const RANGE_DATABASE_ACCURATE = "DATABASE_ACCURATE!A2:G"; // No, Kode Barang, Nama Accurate, HPP/unit, HPP Baru, Stok Online, is_online
const RANGE_MAPPING = "Mapping!A2:D"; // Nama Shopee, Variasi, Mark Down, Checker Nama Accurate

/**
 * Entry point dipanggil dari GitHub Actions workflow (script Node biasa, bukan handler bot).
 * Baca kedua sheet, gabung jadi satu bentuk `products`, tulis ke Firestore.
 * @returns {Promise<{ jumlahProdukDiproses: number, jumlahGagal: number, error: Array<{kode_barang, pesan}> }>}
 */
async function syncMasterData() {
  const [barisAccurate, barisMapping] = await Promise.all([
    bacaRange(RANGE_DATABASE_ACCURATE),
    bacaRange(RANGE_MAPPING),
  ]);

  const petaVariantsByAccurate = kelompokkanMappingByNamaAccurate(barisMapping);

  let jumlahProdukDiproses = 0;
  const errorList = [];

  for (const baris of barisAccurate) {
    const kodeBarang = String(baris[1] || "").trim();
    if (!kodeBarang) continue; // baris kosong/rusak, lewati daripada gagal total

    try {
      await sinkronSatuProduk(baris, kodeBarang, petaVariantsByAccurate);
      jumlahProdukDiproses += 1;
    } catch (err) {
      errorList.push({ kode_barang: kodeBarang, pesan: err.message });
    }
  }

  return { jumlahProdukDiproses, jumlahGagal: errorList.length, error: errorList };
}

/**
 * Kelompokkan baris Mapping berdasarkan "Checker Nama Accurate" (kolom acuan pencocokan),
 * biar tiap produk Accurate bisa tau semua variants Shopee-nya tanpa scan ulang tiap kali.
 */
function kelompokkanMappingByNamaAccurate(barisMapping) {
  const peta = new Map();

  for (const baris of barisMapping) {
    const namaShopee = String(baris[0] || "").trim();
    const variasi = String(baris[1] || "").trim() || "-";
    const markDown = Number(baris[2]) || 0;
    const checkerNamaAccurate = String(baris[3] || "").trim();

    if (!namaShopee || !checkerNamaAccurate) continue; // baris gak lengkap, gak bisa dipetakan

    const key = normalisasiNama(checkerNamaAccurate);
    if (!peta.has(key)) peta.set(key, []);
    peta.get(key).push({ nama_shopee: namaShopee, variasi, mark_down: markDown });
  }

  return peta;
}

/**
 * Sync satu baris DATABASE_ACCURATE ke Firestore.
 * is_online_product sekarang datang dari DUA sumber, digabung dengan OR:
 * 1. Tagging organik dari pemakaian nyata (picking list/Mapping, Batch 5 — lihat
 *    tandaiSebagaiProdukOnline di models/produk.js, dipanggil dari handlers, bukan dari sini).
 * 2. Kolom "is_online" di sheet (kolom G) — admin isi manual saat produk memang mau
 *    mulai ditrack stok online-nya.
 * SENGAJA OR, bukan sheet nimpa total: sync ini gak pernah MEMATIKAN flag yang sudah true
 * (baik dari organik maupun sheet sebelumnya), walau sel is_online dikosongkan lagi di sheet.
 * Alasannya: kalau sync bisa turn-off, admin lupa centang ulang / sel kehapus gak sengaja bisa
 * bikin produk yang sudah live di stok online mendadak hilang dari radar reminder & sync stok —
 * risikonya lebih besar dari sekadar "kolom is_online gak sinkron 100% dgn Firestore".
 * Kalau suatu saat butuh cara resmi UN-tag, sebaiknya lewat command/fungsi eksplisit (mis.
 * /untag_online), bukan lewat sync searah ini.
 */
async function sinkronSatuProduk(baris, kodeBarang, petaVariantsByAccurate) {
  const namaAccurate = String(baris[2] || "").trim();
  const hpp = Number(baris[3]) || 0;
  const hppBaruRaw = baris[4];
  const hppBaru = hppBaruRaw !== undefined && hppBaruRaw !== "" ? Number(hppBaruRaw) : null;
  const isOnlineDariSheet = parseBooleanSheet(baris[6]);

  const namaAccurateNormalized = normalisasiNama(namaAccurate);
  const variants = petaVariantsByAccurate.get(namaAccurateNormalized) || [];
  const searchKeywords = susunSearchKeywords(namaAccurate, variants);

  const produkSekarang = await ambilProdukByKode(kodeBarang);
  const isOnlineSekarang = produkSekarang ? produkSekarang.is_online_product === true : false;
  const isOnlineBaru = isOnlineDariSheet || isOnlineSekarang;

  await simpanProduk(kodeBarang, {
    kode_barang: kodeBarang,
    nama_accurate: namaAccurate,
    nama_accurate_normalized: namaAccurateNormalized,
    hpp,
    hpp_baru: hppBaru,
    is_online_product: isOnlineBaru,
    variants,
    search_keywords: searchKeywords,
    updated_at: new Date(),
  });
}

/**
 * Sel checkbox Excel via Sheets API biasanya balik sbg boolean true/false, tapi kadang
 * kebaca sbg angka (1/0) atau string ("TRUE"/"ya"/"v") tergantung format sel. Terima semua
 * varian umum itu, apa pun selain itu (kosong/undefined/0/"false"/dll) dianggap false.
 */
function parseBooleanSheet(nilai) {
  if (nilai === true || nilai === 1) return true;
  if (typeof nilai === "string") {
    const t = nilai.trim().toLowerCase();
    return t === "true" || t === "1" || t === "ya" || t === "v" || t === "x";
  }
  return false;
}

/**
 * Susun search_keywords: nama accurate ternormalisasi + tiap nama_shopee ternormalisasi.
 * Dipakai lib/matching/cariProdukByNama.js (Batch 5) buat fuzzy match nama informal picking list.
 */
function susunSearchKeywords(namaAccurate, variants) {
  const keywords = new Set([normalisasiNama(namaAccurate)]);
  for (const v of variants) {
    keywords.add(normalisasiNama(v.nama_shopee));
  }
  return Array.from(keywords).filter(Boolean);
}

module.exports = { syncMasterData };