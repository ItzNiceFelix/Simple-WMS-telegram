// lib/reminder/cekReorderPoint.js
// Reminder REAKTIF (alur D poin 1, bagian 4): dipanggil LANGSUNG dari dalam
// kurangiStok()/tambahStok() (lib/models/stok.js) tiap kali stok berubah — disepakati
// sebelum Batch 7 mulai, BUKAN dipanggil terpisah dari tiap caller (konfirmasiPickingList dkk).
//
// PENTING utk Batch 7 lanjutan: file ini cuma nyediain fungsi cekDanNotifikasiReorderPoint().
// lib/models/stok.js SENDIRI (file Batch 2, sudah ada) belum manggil fungsi ini — perlu 1 baris
// tambahan di ujung kurangiStok()/tambahStok() di sana. Dicatat sbg TODO wiring, sama pola
// TODO wiring routePesan.js di batch-batch sebelumnya (bukan diam-diam diasumsikan sudah jalan).

const { ambilStok } = require("../models/stok");
const { ambilProdukByKode } = require("../models/produk");
const { ambilSemuaAdminByRole } = require("../models/admins");
const { kirimPesan } = require("../telegram/kirimPesan");

/**
 * Cek apakah stok produk tertentu sekarang di bawah reorder_point, kalau iya kirim notifikasi
 * ke semua admin (role owner+admin, bukan guest — lihat catatan role bagian 4H, guest belum
 * tentu perlu ikut notifikasi operasional kayak gini).
 *
 * @param {string} kodeBarang
 * @returns {Promise<boolean>} true kalau notifikasi dikirim (di bawah reorder_point)
 */
async function cekDanNotifikasiReorderPoint(kodeBarang) {
  const stok = await ambilStok(kodeBarang);
  if (!stok || stok.reorder_point === null || stok.reorder_point === undefined) {
    return false; // reorder_point belum diset utk produk ini, gak ada yg bisa dicek
  }

  if (stok.stok_gudang_online > stok.reorder_point) {
    return false; // masih aman
  }

  const produk = await ambilProdukByKode(kodeBarang);
  const namaProduk = produk ? produk.nama_accurate : kodeBarang;

  const adminOwner = await ambilSemuaAdminByRole("owner");
  const adminBiasa = await ambilSemuaAdminByRole("admin");
  const penerimaNotif = [...adminOwner, ...adminBiasa];

  const teks = `⚠️ *Stok Menipis*\n${namaProduk} tersisa ${stok.stok_gudang_online} (reorder point: ${stok.reorder_point}). Pertimbangkan minta stok ke gudang sebelah.`;

  for (const admin of penerimaNotif) {
    // ambilSemuaAdminByRole() mengembalikan field `telegram_user_id` (id dokumen
    // admins/{telegram_user_id}) — BUKAN `id`. Pakai `admin.id` = argumen undefined
    // = notifikasi tidak pernah terkirim (bug B1).
    await kirimPesan(admin.telegram_user_id, teks, { parseMode: "Markdown" });
  }

  return true;
}

module.exports = { cekDanNotifikasiReorderPoint };
