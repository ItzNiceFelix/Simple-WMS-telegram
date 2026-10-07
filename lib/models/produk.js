// lib/models/produk.js
// CRUD dasar untuk koleksi `products` (master data produk, gabungan DATABASE_ACCURATE + Mapping).
// Fuzzy matching nama produk (cariProdukByNama versi pintar) ada di Batch 5 (lib/matching/),
// di sini baru fungsi dasar akses Firestore.

const { db } = require("../firebase");

const KOLEKSI = "products";

// --- Cache in-memory utk listSemuaProduk() ---
// Kenapa: fungsi ini sebelumnya dipanggil BERULANG KALI per invocation (misal sekali per
// baris picking list) dan tiap panggilan narik SELURUH koleksi `products` dari Firestore
// (1 read per dokumen). Screenshot 20 baris x 300 produk = 6000 reads dari satu foto —
// ini penyebab utama kuota Firestore jebol dalam hitungan jam.
//
// Cache module-level (hidup selama Lambda/Vercel function instance masih warm, biasanya
// beberapa menit sampai belasan menit) + TTL pendek, supaya:
// - Dalam SATU invocation (satu webhook call), berapa kalipun listSemuaProduk() dipanggil,
//   Firestore cuma di-hit sekali.
// - Lintas invocation yang beruntun di instance yang sama (warm start), masih hemat selama
//   belum lewat TTL.
// - Data produk memang jarang berubah drastis dalam hitungan menit, jadi TTL singkat aman.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit
const _cacheProduk = {
  semua: null, // array semua produk (tanpa filter), termasuk timestamp
  timestamp: 0,
};

// --- Cache terpisah utk produk is_online_product == true ---
// Kenapa dipisah dari cache "semua" di atas: katalog total bisa ribuan produk, tapi
// yang online (dibaca/ditulis/dihapus bot secara rutin — reminder harian, /sync_stok)
// biasanya cuma puluhan. Kalau numpang di cache "semua" (_ambilSemuaProdukMentahDenganCache),
// tiap cold-cache hanyaOnline:true tetap bayar biaya baca SELURUH katalog, padahal cuma
// butuh sebagian kecil. Query Firestore langsung dgn where("is_online_product","==",true)
// bikin biayanya sebanding jumlah produk online (~puluhan), bukan total katalog (~ribuan) —
// gak butuh composite index krn cuma 1 field equality.
const _cacheProdukOnline = {
  data: null,
  timestamp: 0,
};

function _cacheMasihValid() {
  return _cacheProduk.semua !== null && Date.now() - _cacheProduk.timestamp < CACHE_TTL_MS;
}

function _cacheOnlineMasihValid() {
  return _cacheProdukOnline.data !== null && Date.now() - _cacheProdukOnline.timestamp < CACHE_TTL_MS;
}

// Dipanggil setelah ada perubahan data produk (simpanProduk/updateProduk) supaya
// pemanggil berikutnya tidak baca data basi dari cache.
function invalidasiCacheProduk() {
  _cacheProduk.semua = null;
  _cacheProduk.timestamp = 0;
  _cacheProdukOnline.data = null;
  _cacheProdukOnline.timestamp = 0;
}

// Bikin string pembanding: lowercase, buang spasi berlebih & simbol umum.
// Dipakai untuk isi nama_accurate_normalized & pencarian sederhana sebelum fuzzy matching hadir.
function normalisasiNama(nama) {
  if (!nama) return "";
  return nama
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function ambilProdukByKode(kodeBarang) {
  const doc = await db.collection(KOLEKSI).doc(kodeBarang).get();
  if (!doc.exists) return null;
  return { kode_barang: doc.id, ...doc.data() };
}

async function simpanProduk(kodeBarang, data) {
  const payload = {
    ...data,
    nama_accurate_normalized: normalisasiNama(data.nama_accurate),
    updated_at: new Date(),
  };
  await db.collection(KOLEKSI).doc(kodeBarang).set(payload, { merge: true });
  invalidasiCacheProduk();
  return ambilProdukByKode(kodeBarang);
}

async function updateProduk(kodeBarang, dataPartial) {
  const payload = { ...dataPartial, updated_at: new Date() };
  if (dataPartial.nama_accurate) {
    payload.nama_accurate_normalized = normalisasiNama(dataPartial.nama_accurate);
  }
  await db.collection(KOLEKSI).doc(kodeBarang).update(payload);
  invalidasiCacheProduk();
  return ambilProdukByKode(kodeBarang);
}

// Tandai produk sebagai relevan untuk stok online.
// Dipanggil otomatis begitu produk pertama kali muncul di Mapping sheet atau picking list
// (tagging organik, sesuai keputusan bagian 5 dokumen — bukan tagging manual di depan).
async function tandaiSebagaiProdukOnline(kodeBarang) {
  const produk = await ambilProdukByKode(kodeBarang);
  if (!produk) return null;
  if (produk.is_online_product) return produk; // sudah ditandai, tidak perlu tulis ulang
  return updateProduk(kodeBarang, { is_online_product: true });
}

// Toggle manual is_online_product dari dashboard (F8). Owner + admin.
// null dikembalikan kalau produk tidak ada supaya route bisa balas 404.
async function setOnlineProduk(kodeBarang, isOnline, oleh) {
  const produk = await ambilProdukByKode(kodeBarang);
  if (!produk) return null;
  return updateProduk(kodeBarang, {
    is_online_product: !!isOnline,
    online_updated_by: String(oleh),
  });
}

// Pencarian substring sederhana di nama_accurate_normalized dan search_keywords.
// Ini BUKAN fuzzy matching final — placeholder dasar sebelum Batch 5 (cariProdukByNama.js).
async function cariProdukSederhana(kataKunci, maksHasil = 10) {
  const kunci = normalisasiNama(kataKunci);
  // Pakai cache yang sama dengan listSemuaProduk() — sebelumnya fungsi ini punya
  // db.collection(KOLEKSI).get() sendiri, jadi query Gemini tool "cariProduk" bisa
  // ikut nambah beban baca walau produk sudah pernah ditarik di request yang sama.
  const semua = await _ambilSemuaProdukMentahDenganCache();
  const hasil = semua.filter((data) => {
    const cocokNama = data.nama_accurate_normalized?.includes(kunci);
    const cocokKeyword = (data.search_keywords || []).some((k) =>
      normalisasiNama(k).includes(kunci)
    );
    return cocokNama || cocokKeyword;
  });
  return hasil.slice(0, maksHasil);
}

// Ambil SEMUA produk (seluruh katalog) dari Firestore, lewat cache in-memory (lihat
// catatan cache di atas). Dipakai hanya oleh listSemuaProduk({hanyaOnline:false}) dan
// cariProdukSederhana — jalur yang memang butuh full scan (fuzzy match produk baru/belum
// ditag is_online_product). Jalur hanyaOnline:true TIDAK lewat sini lagi, lihat
// _ambilProdukOnlineDenganCache() di bawah.
async function _ambilSemuaProdukMentahDenganCache() {
  if (_cacheMasihValid()) {
    return _cacheProduk.semua;
  }
  const snapshot = await db.collection(KOLEKSI).get();
  const semua = snapshot.docs.map((doc) => ({ kode_barang: doc.id, ...doc.data() }));
  _cacheProduk.semua = semua;
  _cacheProduk.timestamp = Date.now();
  return semua;
}

// Query terpisah khusus produk online — lewat cache sendiri (_cacheProdukOnline),
// TIDAK numpang di cache "semua" supaya cold-cache-nya cuma bayar sebesar jumlah
// produk online (~puluhan), bukan seluruh katalog (~ribuan).
async function _ambilProdukOnlineDenganCache() {
  if (_cacheOnlineMasihValid()) {
    return _cacheProdukOnline.data;
  }
  const snapshot = await db.collection(KOLEKSI).where("is_online_product", "==", true).get();
  const data = snapshot.docs.map((doc) => ({ kode_barang: doc.id, ...doc.data() }));
  _cacheProdukOnline.data = data;
  _cacheProdukOnline.timestamp = Date.now();
  return data;
}

// hanyaOnline: true  → query terindeks is_online_product==true (murah, ~puluhan read).
// hanyaOnline: false → full scan katalog (perlu utk fuzzy match produk baru/belum ditag,
//                       lihat catatan di cariProdukByNama.js), tetap lewat cache "semua".
async function listSemuaProduk({ hanyaOnline = false } = {}) {
  if (hanyaOnline) return _ambilProdukOnlineDenganCache();
  return _ambilSemuaProdukMentahDenganCache();
}

module.exports = {
  normalisasiNama,
  ambilProdukByKode,
  simpanProduk,
  updateProduk,
  tandaiSebagaiProdukOnline,
  setOnlineProduk,
  cariProdukSederhana,
  listSemuaProduk,
  invalidasiCacheProduk,
};