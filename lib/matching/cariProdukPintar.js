// lib/matching/cariProdukPintar.js
// Engine pencarian produk TERPUSAT — dipakai semua alur yang butuh resolve nama→produk
// via chat teks biasa (tool Gemini cariProduk/cekStok/kurangiStok/tambahStok), BUKAN
// picking-list/opname (itu tetap pakai cariProdukByNama langsung dgn preload batch,
// lihat catatan di bawah kenapa dipisah).
//
// Kenapa perlu file ini (bukan langsung reuse cariProdukByNama.js apa adanya):
// 1. Prioritas kolam pencarian: cari di produk ONLINE dulu (query terindeks
//    is_online_product==true, murah ~puluhan reads), BUKAN full-scan seluruh katalog
//    (1088 produk) tiap kali admin sebut nama produk di chat. Alasan gabungan: hemat
//    read (cache 5 menit sering miss krn jeda antar-chat admin bisa lama — nunggu admin
//    lain, koneksi lemot) + akurasi (produk yg relevan buat urusan stok online ya yg
//    online, bukan seluruh katalog termasuk yg gak pernah dijual online).
// 2. Kalau TIDAK ketemu di kolam online, JANGAN otomatis full-scan diam-diam — return
//    sinyal "perlu konfirmasi cakupan" ke pemanggil, biar admin yang putuskan lewat
//    tombol: cari di semua produk / tandai sebagai produk online baru / batal.
//    (chatHandler.js yang urus tombolnya, file ini cuma logic pencarian murni.)
//
// Kenapa picking-list/opname TETAP pakai cariProdukByNama langsung, bukan lewat sini:
// alur situ sudah preload SEKALI di awal loop (lihat catatan fix kuota di
// handleScreenshotPickingList.js/handleOpname.js) dan sengaja hanyaOnline:false dari
// awal (barang di picking list yg belum online justru sinyal "harus mulai ditag online",
// bukan kasus yang perlu ditanya konfirmasi ke admin satu-satu per baris — repot).

const { cariProdukByNama } = require("./cariProdukByNama");
const { listSemuaProduk } = require("../models/produk");

/**
 * Cari 1 produk by nama, prioritas kolam online dulu.
 * @param {string} kataKunci
 * @param {string} [variasi]
 * @returns {Promise<{
 *   perluKonfirmasiCakupan: boolean,  // true kalau tidak ketemu di kolam online sama sekali
 *   status: "jelas"|"ragu"|"tidak_ketemu"|null,  // null kalau perluKonfirmasiCakupan true
 *   produkTerpilih: object|null,
 *   kandidat: Array<{produk, skor}>,
 *   kataKunci: string,  // dikembalikan apa adanya, dipakai pemanggil kalau perlu expand nanti
 * }>}
 */
async function cariProdukPintar(kataKunci, variasi = "-") {
  const produkOnline = await listSemuaProduk({ hanyaOnline: true });
  const hasilOnline = await cariProdukByNama(kataKunci, variasi, produkOnline);

  if (hasilOnline.status === "tidak_ketemu") {
    return {
      perluKonfirmasiCakupan: true,
      status: null,
      produkTerpilih: null,
      kandidat: [],
      kataKunci,
    };
  }

  // "jelas" atau "ragu" di kolam online — cukup, gak perlu expand ke full-scan.
  return {
    perluKonfirmasiCakupan: false,
    status: hasilOnline.status,
    produkTerpilih: hasilOnline.produkTerpilih,
    kandidat: hasilOnline.kandidat,
    kataKunci,
  };
}

/**
 * Expand pencarian ke SELURUH katalog (dipanggil HANYA setelah admin eksplisit pilih
 * tombol "cari di semua produk" — lihat chatHandler.js). Ini titik satu-satunya yang
 * boleh memicu full-scan listSemuaProduk({hanyaOnline:false}) dari alur chat biasa.
 * @param {string} kataKunci
 * @param {string} [variasi]
 */
async function cariProdukSemuaKatalog(kataKunci, variasi = "-") {
  const semuaProduk = await listSemuaProduk({ hanyaOnline: false });
  const hasil = await cariProdukByNama(kataKunci, variasi, semuaProduk);
  return { ...hasil, kataKunci };
}

module.exports = { cariProdukPintar, cariProdukSemuaKatalog };