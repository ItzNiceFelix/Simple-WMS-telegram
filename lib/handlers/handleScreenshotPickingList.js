// lib/handlers/handleScreenshotPickingList.js
// Orkestrasi utama alur C (bagian 4): terima screenshot picking list dari DM admin →
// ekstrak → cek keyword_notes → fuzzy match produk → simpan draft ke stock_movements
// (status pending_confirmation) → tampilkan ringkasan → TUNGGU konfirmasi admin.
//
// PENTING: file ini TIDAK langsung apply kurangiStok/tambahStok. Itu tugas
// konfirmasiPickingList.js setelah admin jawab "ya". Lihat bagian 4C poin 5-6 skema.

const { ekstrakPickingList } = require("../gemini/ekstrakPickingList");
const { cariProdukByNama } = require("../matching/cariProdukByNama");
const { ambilActionTypeUntukPenanda } = require("../models/keywordNotes");
const { catatPergerakanStok } = require("../models/stockMovements");
const { listSemuaProduk } = require("../models/produk");
const { kirimPesan, kirimPesanDenganTombol, editPesan, hapusPesan } = require("../telegram/kirimPesan");

// TODO Batch 5 lanjutan/housekeeping: sessions.js belum punya fungsi resmi
// simpanPendingPickingList/hapusPendingPickingList (pola sama seperti catatan TODO
// pendingAction di 7.4). Sementara akses db langsung di sini via lib/firebase.js,
// biar konsisten dgn cara chatHandler.js Batch 4 menangani hal serupa. Bisa dirapikan
// jadi fungsi resmi lib/models/sessions.js pas refactor batch nanti.
const { db } = require("../firebase");

/**
 * Entry point dipanggil dari routePesan.js saat DM admin berisi foto/dokumen gambar.
 * @param {object} ctx
 * @param {string|number} ctx.telegramUserId
 * @param {string|number} ctx.chatId
 * @param {string} ctx.base64Image
 * @param {string} ctx.mimeType
 */
async function handleScreenshotPickingList({ telegramUserId, chatId, base64Image, mimeType }) {
  let statusMessageId = null;
  try {
    const status = await kirimPesan(chatId, "Sedang membaca screenshot...");
    statusMessageId = status?.ok ? status.result?.message_id : null;
  } catch (err) {
    console.error("[handleScreenshotPickingList] gagal mengirim pesan status:", err);
  }

  let barisMentah;
  try {
    barisMentah = await ekstrakPickingList(base64Image, mimeType);
  } catch (err) {
    await hapusStatus(chatId, statusMessageId);
    await kirimPesan(
      chatId,
      "Waduh, gagal baca screenshot-nya. Coba kirim ulang fotonya, pastikan jelas dan gak buram ya."
    );
    console.error("[handleScreenshotPickingList] gagal ekstraksi:", err);
    return;
  }

  if (barisMentah.length === 0) {
    await hapusStatus(chatId, statusMessageId);
    await kirimPesan(
      chatId,
      "Gak ketemu baris picking list di gambar ini. Coba pastikan foto/screenshot-nya jelas ya."
    );
    return;
  }

  await ubahStatus(chatId, statusMessageId, "Sedang mencocokkan produk...");
  const hasilProses = await prosesSemuaBaris(barisMentah, telegramUserId);

  const movementIds = hasilProses.map((item) => item.movementId);
  await simpanPendingPickingList(telegramUserId, chatId, movementIds);

  const teksRingkasan = susunTeksRingkasan(hasilProses);
  await hapusStatus(chatId, statusMessageId);
  await kirimPesanDenganTombol(chatId, teksRingkasan, [
    [
      { text: "✅ Ya, lanjutkan", callback_data: `pl:ya:${telegramUserId}` },
      { text: "❌ Batal", callback_data: `pl:batal:${telegramUserId}` },
    ],
  ]);
}

async function ubahStatus(chatId, messageId, teks) {
  if (!messageId) return;
  try {
    await editPesan(chatId, messageId, teks);
  } catch (err) {
    console.error("[handleScreenshotPickingList] gagal memperbarui status:", err);
  }
}

async function hapusStatus(chatId, messageId) {
  if (!messageId) return;
  try {
    await hapusPesan(chatId, messageId);
  } catch (err) {
    console.error("[handleScreenshotPickingList] gagal menghapus status:", err);
  }
}

/**
 * Proses tiap baris: cek keyword_notes utk action_type, fuzzy match produk,
 * lalu catat sebagai stock_movements pending_confirmation.
 * Diproses berurutan (bukan Promise.all) supaya urutan log & ringkasan konsisten
 * dengan urutan baris di screenshot — lebih gampang ditelusuri admin kalau ada masalah.
 */
async function prosesSemuaBaris(barisMentah, telegramUserId) {
  const hasil = [];

  // FIX kuota Firestore: sebelumnya cariProdukByNama() di-panggil per baris TANPA data
  // produk preloaded, jadi tiap baris narik ulang seluruh koleksi `products` dari Firestore
  // (1 read per dokumen produk). Screenshot 20 baris x 300 produk = 6000 reads dari SATU
  // foto. Sekarang: ambil sekali di sini (lewat cache listSemuaProduk()), dipakai ulang
  // utk semua baris di batch ini → jadi paling banyak 1 query ke Firestore per screenshot
  // (atau 0 kalau cache masih hangat).
  const semuaProduk = await listSemuaProduk({ hanyaOnline: false });

  for (const baris of barisMentah) {
    const { actionType } = await ambilActionTypeUntukPenanda(baris.penanda);
    const hasilMatch = await cariProdukByNama(baris.nama_terbaca, baris.variasi, semuaProduk);

    const movementId = await catatPergerakanStok({
      kode_barang: hasilMatch.produkTerpilih ? hasilMatch.produkTerpilih.kode_barang : null,
      nama_terbaca: baris.nama_terbaca,
      variasi: baris.variasi,
      // qty = DELTA BERTANDA hanya utk aksi yg benar-benar mengubah stok (kurangi_stok).
      // perlu_request/perlu_request_buffer bukan delta stok — qty-nya MAGNITUDO permintaan
      // yang dipakai apa adanya oleh konfirmasiPickingList.js (tambahItemKeDailyRequest),
      // jadi tetap positif.
      qty: actionType === "kurangi_stok" ? -Math.abs(baris.qty) : Math.abs(baris.qty),
      type: "keluar_resi",
      penanda: baris.penanda,
      action_type: actionType,
      source: "screenshot",
      status: "pending_confirmation",
      created_by: telegramUserId,
    });

    hasil.push({
      movementId,
      baris,
      actionType,
      statusMatch: hasilMatch.status,
      produkTerpilih: hasilMatch.produkTerpilih,
      kandidat: hasilMatch.kandidat,
    });
  }

  return hasil;
}

/**
 * Simpan referensi draft ke sessions, dipakai konfirmasiPickingList.js saat admin balas.
 * Ganti draft lama kalau ada (admin kirim screenshot baru sebelum konfirmasi draft sebelumnya
 * — anggap yang lama dibatalkan, jangan numpuk dua draft aktif sekaligus).
 */
async function simpanPendingPickingList(telegramUserId, chatId, movementIds) {
  await db
    .collection("sessions")
    .doc(String(telegramUserId))
    .set(
      {
        pendingPickingList: {
          chatId,
          movementIds,
          dibuatPada: new Date(),
        },
      },
      { merge: true }
    );
}

/**
 * Susun teks ringkasan dikelompokkan 3 kategori sesuai bagian 4C poin 5:
 * item jelas / item ragu / item tak ketemu — biar admin gampang scan sebelum konfirmasi.
 */
function susunTeksRingkasan(hasilProses) {
  const jelas = hasilProses.filter((h) => h.statusMatch === "jelas");
  const ragu = hasilProses.filter((h) => h.statusMatch === "ragu");
  const tidakKetemu = hasilProses.filter((h) => h.statusMatch === "tidak_ketemu");

  const baris = [];
  baris.push(`*Ringkasan Picking List* (${hasilProses.length} baris)\n`);

  if (jelas.length > 0) {
    baris.push(`✅ *Cocok jelas* (${jelas.length}):`);
    for (const h of jelas) {
      baris.push(
        `- ${h.produkTerpilih.nama_accurate} ${formatVariasi(h.baris.variasi)} x${h.baris.qty} → _${labelActionType(h.actionType)}_`
      );
    }
    baris.push("");
  }

  if (ragu.length > 0) {
    baris.push(`⚠️ *Perlu dicek* (${ragu.length}) — nama gak yakin, pilih manual nanti:`);
    for (const h of ragu) {
      const daftarKandidat = h.kandidat.map((k) => k.produk.nama_accurate).join(" / ");
      baris.push(`- "${h.baris.nama_terbaca}" ${formatVariasi(h.baris.variasi)} x${h.baris.qty} → mirip: ${daftarKandidat}`);
    }
    baris.push("");
  }

  if (tidakKetemu.length > 0) {
    baris.push(`❌ *Gak ketemu produknya* (${tidakKetemu.length}):`);
    for (const h of tidakKetemu) {
      baris.push(`- "${h.baris.nama_terbaca}" ${formatVariasi(h.baris.variasi)} x${h.baris.qty}`);
    }
    baris.push("");
  }

  baris.push("Tekan tombol di bawah buat lanjutkan item yang cocok jelas, atau kasih tau kalau ada yang perlu dikoreksi dulu.");

  return baris.join("\n");
}

function formatVariasi(variasi) {
  return variasi && variasi !== "-" ? `(${variasi})` : "";
}

function labelActionType(actionType) {
  if (actionType === "kurangi_stok") return "kurangi stok gudang online";
  if (actionType === "perlu_request") return "minta ke gudang sebelah";
  if (actionType === "perlu_request_buffer") return "minta ke gudang sebelah (sisakan buffer)";
  return actionType;
}

module.exports = { handleScreenshotPickingList };
  
