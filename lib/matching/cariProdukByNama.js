// lib/matching/cariProdukByNama.js
// Fuzzy matching nama produk dari screenshot picking list ke koleksi `products`.
// Kenapa perlu ini: nama produk beda di 3 tempat (Nama Accurate, Nama Shopee, nama
// informal/tulisan tangan di picking list) — exact match gak cukup (lihat bagian 1a skema).
//
// Strategi: bukan pakai library fuzzy searching berat (hemat cold start Vercel function),
// cukup normalisasi + token overlap scoring + sedikit toleransi typo (levenshtein ringan
// hanya dipakai sebagai tie-breaker, bukan metode utama).

const { listSemuaProduk, normalisasiNama } = require("../models/produk");

const AMBANG_YAKIN = 0.72;    // skor >= ini dianggap "match jelas"
const AMBANG_RAGU = 0.45;     // skor di antara AMBANG_RAGU dan AMBANG_YAKIN dianggap "ragu", di bawahnya "tak ketemu"
const MAKS_KANDIDAT_RAGU = 3; // maksimal kandidat ditampilkan kalau statusnya ragu

/**
 * Cari produk yang paling cocok untuk satu nama_terbaca dari picking list.
 * Cocokkan terhadap nama_accurate_normalized DAN search_keywords (termasuk nama Shopee & variasi)
 * biar nama informal di picking list yang lebih mirip nama Shopee tetap kena.
 *
 * @param {string} namaTerbaca - nama produk mentah dari hasil ekstraksi screenshot
 * @param {string} variasi - variasi dari picking list, "-" kalau tanpa varian
 * @param {Array<object>|null} daftarProdukPreloaded - opsional, daftar produk yang SUDAH
 *   di-fetch sebelumnya (misal via listSemuaProduk() sekali di awal loop pemanggil).
 *   Kalau dikasih, fungsi ini TIDAK akan fetch ulang ke Firestore/cache — dipakai oleh
 *   pemanggil yang mencocokkan banyak baris sekaligus (handleScreenshotPickingList,
 *   handleOpname) supaya satu batch cuma butuh 1x ambil data produk, bukan 1x per baris.
 * @returns {Promise<{
 *   status: "jelas" | "ragu" | "tidak_ketemu",
 *   produkTerpilih: object | null,     // hanya diisi kalau status "jelas"
 *   kandidat: Array<{produk: object, skor: number}>   // diisi kalau status "ragu", kosong kalau lainnya
 * }>}
 */
async function cariProdukByNama(namaTerbaca, variasi = "-", daftarProdukPreloaded = null) {
  // hanyaOnline: false sengaja — barang yang baru pertama kali muncul di picking list
  // justru salah satu sinyal dia harus mulai ditandai is_online_product (lihat bagian 5,
  // keputusan "tagging organik"). Kalau difilter di sini, produk itu gak akan pernah ketemu.
  const semuaProduk = daftarProdukPreloaded || (await listSemuaProduk({ hanyaOnline: false }));

  const namaNormalized = normalisasiNama(namaTerbaca);
  const variasiNormalized = variasi === "-" ? "" : normalisasiNama(variasi);

  const skorSemua = semuaProduk.map((produk) => ({
    produk,
    skor: hitungSkorKecocokan(namaNormalized, variasiNormalized, produk),
  }));

  skorSemua.sort((a, b) => b.skor - a.skor);

  const terbaik = skorSemua[0];
  if (!terbaik || terbaik.skor < AMBANG_RAGU) {
    return { status: "tidak_ketemu", produkTerpilih: null, kandidat: [] };
  }

  if (terbaik.skor >= AMBANG_YAKIN) {
    return { status: "jelas", produkTerpilih: terbaik.produk, kandidat: [] };
  }

  // Status ragu: tampilkan beberapa kandidat teratas biar admin pilih manual saat konfirmasi
  const kandidatRagu = skorSemua
    .filter((item) => item.skor >= AMBANG_RAGU)
    .slice(0, MAKS_KANDIDAT_RAGU);

  return { status: "ragu", produkTerpilih: null, kandidat: kandidatRagu };
}

/**
 * Hitung skor kecocokan 0..1 antara nama_terbaca (sudah dinormalisasi) dengan satu produk.
 * Cek terhadap nama_accurate_normalized dan tiap search_keywords, ambil skor tertinggi.
 */
function hitungSkorKecocokan(namaNormalized, variasiNormalized, produk) {
  const kandidatTeks = [produk.nama_accurate_normalized, ...(produk.search_keywords || [])].filter(
    Boolean
  );

  let skorTerbaik = 0;
  for (const teks of kandidatTeks) {
    const skor = skorTokenOverlap(namaNormalized, teks);
    if (skor > skorTerbaik) skorTerbaik = skor;
  }

  // Bonus kecil kalau variasi dari picking list cocok dengan salah satu varian produk
  // (nama_shopee/variasi di sub-koleksi variants) — bantu disambiguasi produk yang punya banyak varian.
  if (variasiNormalized && Array.isArray(produk.variants)) {
    const adaVariasiCocok = produk.variants.some(
      (v) => normalisasiNama(v.variasi || "") === variasiNormalized
    );
    if (adaVariasiCocok) skorTerbaik = Math.min(1, skorTerbaik + 0.1);
  }

  return skorTerbaik;
}

/**
 * Skor overlap token sederhana (mirip Jaccard, dibobot arah "seberapa banyak token
 * pencarian ketemu di teks target") + fallback substring match utk frasa pendek.
 */
function skorTokenOverlap(teksA, teksB) {
  if (!teksA || !teksB) return 0;
  if (teksA === teksB) return 1;

  const tokenA = new Set(teksA.split(" ").filter((t) => t.length > 1));
  const tokenB = new Set(teksB.split(" ").filter((t) => t.length > 1));
  if (tokenA.size === 0 || tokenB.size === 0) return 0;

  let cocok = 0;
  for (const token of tokenA) {
    if (tokenB.has(token)) {
      cocok += 1;
    } else {
      // toleransi typo ringan: cek ada token di B yang sangat mirip (levenshtein <= 1)
      for (const tokenLain of tokenB) {
        if (Math.abs(tokenLain.length - token.length) <= 1 && levenshteinRingan(token, tokenLain) <= 1) {
          cocok += 0.8;
          break;
        }
      }
    }
  }

  // Bobot terhadap ukuran token pencarian (nama_terbaca) — biar nama pendek yang jadi
  // subset penuh dari nama produk panjang tetap dapat skor tinggi (bukan dirata-rata turun).
  const skorArahA = cocok / tokenA.size;

  // Fallback: kalau salah satu teks adalah substring teks lain (nama pendek vs nama panjang)
  // Gunakan bobot lebih tinggi buat query sangat pendek (< 3 char) yang mungkin eksak:
  // "X" cocok "X Glue" → 1.0, tapi "cuci" cocok "sabun cuci piring" → 0.55 (lebih rendah)
  let skorSubstring = 0;
  if (teksB.includes(teksA) || teksA.includes(teksB)) {
    const panjangTeksPendek = Math.min(teksA.length, teksB.length);
    if (panjangTeksPendek <= 2 && teksA.toLowerCase() === teksB.toLowerCase()) {
      skorSubstring = 1.0;
    } else if (teksB.includes(teksA) || teksA.includes(teksB)) {
      // salah satu substring lengkap, beri bobot sedikit lebih rendah daripada token match biasa
      skorSubstring = 0.55 + 0.3 * (panjangTeksPendek / 4);
    }
  }

  return Math.max(skorArahA, skorSubstring);
}

/**
 * Levenshtein distance sederhana, dibatasi early-exit karena hanya dipakai untuk token pendek
 * (nama produk sehari-hari), bukan teks panjang — gak perlu versi teroptimasi penuh.
 */
function levenshteinRingan(a, b) {
  const matriks = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) matriks[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const biaya = a[i - 1] === b[j - 1] ? 0 : 1;
      matriks[i][j] = Math.min(
        matriks[i - 1][j] + 1,
        matriks[i][j - 1] + 1,
        matriks[i - 1][j - 1] + biaya
      );
    }
  }
  return matriks[a.length][b.length];
}

module.exports = { cariProdukByNama, AMBANG_YAKIN, AMBANG_RAGU };
