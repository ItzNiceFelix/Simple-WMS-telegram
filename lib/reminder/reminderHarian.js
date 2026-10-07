// lib/reminder/reminderHarian.js
// Reminder PROAKTIF harian (alur D poin 2, bagian 4): dipanggil GitHub Actions terjadwal pagi.
// Hitung proyeksi kebutuhan dari TREN stock_movements (bukan cuma snapshot reorder_point saat
// ini kayak cekReorderPoint.js), kirim ringkasan ke Telegram — berpotensi ganti proses manual
// kirim Excel ke gudang sebelah (motivasi asli di bagian 1).
//
// Proyeksi sederhana dulu: rata-rata pemakaian harian N hari terakhir (default 7) dari
// stock_movements type "keluar_resi", dibandingkan stok sekarang → perkiraan berapa hari lagi
// habis. TIDAK pakai model statistik rumit — cukup buat sinyal awal, bisa ditingkatkan nanti
// kalau data histori sudah cukup banyak utk pola musiman dll (di luar scope Batch 7).

const { db } = require("../firebase");
const { listSemuaProduk } = require("../models/produk");
const { ambilStok } = require("../models/stok");
const { ambilSemuaAdminByRole } = require("../models/admins");
const { kirimPesan } = require("../telegram/kirimPesan");

const JUMLAH_HARI_TREN = 7;
const AMBANG_HARI_PERKIRAAN_HABIS = 3; // proyeksi habis dalam <=3 hari → masuk ringkasan

/**
 * Entry point dipanggil dari script CLI (scripts/jalankanReminderHarian.js, dibuat di bawah)
 * yang dipanggil GitHub Actions. BUKAN dipanggil dari webhook Telegram — ini job terjadwal
 * murni, gak ada draft/konfirmasi (cuma notifikasi info, gak mengubah data apapun).
 */
async function jalankanReminderHarian() {
  const semuaProdukOnline = await listSemuaProduk({ hanyaOnline: true });
  const batasWaktuTren = new Date(Date.now() - JUMLAH_HARI_TREN * 24 * 60 * 60 * 1000);

  const hasilProyeksi = [];

  for (const produk of semuaProdukOnline) {
    const stok = await ambilStok(produk.kode_barang);
    if (!stok) continue;

    const rataRataPemakaianHarian = await hitungRataRataPemakaianHarian(produk.kode_barang, batasWaktuTren);
    if (rataRataPemakaianHarian <= 0) continue; // gak ada pemakaian dlm periode tren, gak bisa diproyeksi

    const perkiraanHariHabis = stok.stok_gudang_online / rataRataPemakaianHarian;
    if (perkiraanHariHabis <= AMBANG_HARI_PERKIRAAN_HABIS) {
      hasilProyeksi.push({
        kode_barang: produk.kode_barang,
        nama_accurate: produk.nama_accurate,
        stok_sekarang: stok.stok_gudang_online,
        rata_rata_harian: rataRataPemakaianHarian,
        perkiraan_hari_habis: perkiraanHariHabis,
      });
    }
  }

  hasilProyeksi.sort((a, b) => a.perkiraan_hari_habis - b.perkiraan_hari_habis); // paling mendesak dulu

  if (hasilProyeksi.length === 0) {
    console.log("[reminder-harian] gak ada produk yg perlu diproyeksikan hari ini.");
    return { jumlahDiproses: semuaProdukOnline.length, jumlahPerluDiperhatikan: 0 };
  }

  const teks = susunTeksRingkasanHarian(hasilProyeksi);
  const penerima = [...(await ambilSemuaAdminByRole("owner")), ...(await ambilSemuaAdminByRole("admin"))];

  for (const admin of penerima) {
    // ambilSemuaAdminByRole() mengembalikan `telegram_user_id`, bukan `id` (bug B1).
    await kirimPesan(admin.telegram_user_id, teks, { parseMode: "Markdown" });
  }

  return { jumlahDiproses: semuaProdukOnline.length, jumlahPerluDiperhatikan: hasilProyeksi.length };
}

/**
 * Rata-rata qty keluar per hari dalam periode tren, dari stock_movements type "keluar_resi"
 * dgn action_type "kurangi_stok" saja (yg benar2 ngurangin stok online, bukan yg diminta ke
 * gudang sebelah — perlu_request gak representasi pemakaian stok online).
 */
async function hitungRataRataPemakaianHarian(kodeBarang, batasWaktuTren) {
  const snapshot = await db
    .collection("stock_movements")
    .where("kode_barang", "==", kodeBarang)
    .where("type", "==", "keluar_resi")
    .where("action_type", "==", "kurangi_stok")
    .where("status", "==", "processed")
    .where("created_at", ">=", batasWaktuTren)
    .get();

  if (snapshot.empty) return 0;

  // qty = DELTA BERTANDA: keluar_resi/kurangi_stok bernilai negatif. Pemakaian = magnitudo,
  // jadi pakai Math.abs — kalau dijumlah apa adanya hasilnya negatif dan guard `<= 0` di
  // atas bikin SEMUA produk dilewati (reminder mati).
  const totalQty = snapshot.docs.reduce((total, doc) => total + Math.abs(doc.data().qty || 0), 0);
  return totalQty / JUMLAH_HARI_TREN;
}

function susunTeksRingkasanHarian(hasilProyeksi) {
  const baris = [`📊 *Proyeksi Stok Menipis* (${hasilProyeksi.length} produk, ≤${AMBANG_HARI_PERKIRAAN_HABIS} hari lagi)\n`];
  for (const p of hasilProyeksi) {
    const hariBulat = Math.max(0, Math.floor(p.perkiraan_hari_habis));
    baris.push(
      `- ${p.nama_accurate}: sisa ${p.stok_sekarang} (rata² ${p.rata_rata_harian.toFixed(1)}/hari) → perkiraan habis ~${hariBulat} hari lagi`
    );
  }
  baris.push("\nPertimbangkan minta stok ke gudang sebelah utk item di atas.");
  return baris.join("\n");
}

module.exports = { jalankanReminderHarian, hitungRataRataPemakaianHarian };
