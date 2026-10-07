// lib/handlers/konfirmasiPickingList.js
// Proses jawaban admin terhadap draft picking list (sessions.pendingPickingList).
// Dipanggil dari routePesan.js / chatHandler.js SEBELUM pesan diteruskan ke Gemini —
// sama pola dengan pengecekan sessions.pendingAction di chatHandler.js Batch 4.
//
// Apply beneran ke stock hanya terjadi di sini, setelah admin bilang "ya" (bagian 4C poin 6):
// - action_type "kurangi_stok"                        → kurangiStok() + update stock_movements jadi "processed"
// - action_type "perlu_request" / "perlu_request_buffer" → masuk daily_requests hari itu

const { db } = require("../firebase");
const { FieldValue } = require("firebase-admin/firestore");
const { kurangiStok } = require("../models/stok");
const { tambahItemKeDailyRequest, formatTanggal } = require("../models/dailyRequests");
const { kirimPesan } = require("../telegram/kirimPesan");
const { kunciGuard, guardAktif } = require("../dashboard/draftGuard");

/**
 * Cek apakah admin ini punya draft picking list yang lagi ditunggu. Dipanggil paling awal
 * tiap pesan masuk dari admin (mirip pengecekan pendingAction), sebelum ke Gemini.
 * @returns {Promise<boolean>} true kalau pesan ini SUDAH ditangani sebagai jawaban konfirmasi
 *   (caller harus stop, jangan teruskan ke Gemini lagi)
 */
async function apakahAdaPendingPickingList(telegramUserId) {
  const sessionDoc = await db.collection("sessions").doc(String(telegramUserId)).get();
  const session = sessionDoc.data();
  return Boolean(session && session.pendingPickingList);
}

/**
 * Proses jawaban admin terhadap draft yang pending.
 * Hanya menangani jawaban sederhana "ya"/"batal" di Batch 5 ini — koreksi manual per-item
 * (misal admin bilang "yang nomor 2 harusnya produk X") disengaja BELUM ditangani di sini,
 * catat sebagai TODO housekeeping biar gak overreach dari scope Batch 5 yang disepakati.
 *
 * Kontrak v3b §6.1/§6.6: return selalu OBJEK `{ ok, alasan?, ... }` (dulu boolean mentah).
 * `kirimNotifikasi:false` (jalur dashboard) HANYA mematikan pengiriman pesan; mutasi tetap jalan.
 *
 * @param {string|number} telegramUserId
 * @param {string} teksJawaban - pesan mentah dari admin
 * @param {{sumber?: string, confirmedBy?: string|number, kirimNotifikasi?: boolean, cekGuard?: boolean}} [opsi]
 */
async function konfirmasiPickingList(
  telegramUserId,
  teksJawaban,
  { sumber = "teks", confirmedBy = telegramUserId, kirimNotifikasi = true, cekGuard = false } = {}
) {
  const sessionRef = db.collection("sessions").doc(String(telegramUserId));
  const sessionDoc = await sessionRef.get();
  const pending = sessionDoc.data()?.pendingPickingList;

  // B3: return eksplisit (dulu `return false`) — caller bisa bedakan no-op dari sukses.
  if (!pending) return { ok: false, alasan: "tidak_ada_pending" };

  const { chatId, movementIds } = pending;

  // B2: guard dibaca SEBELUM mutasi; batch_id = pemilik sesi (telegramUserId).
  if (cekGuard) {
    try {
      if (await guardAktif(db, kunciGuard("picking", telegramUserId))) {
        return { ok: false, alasan: "guard_aktif" };
      }
    } catch (e) {
      console.error("[draft_guard_failed]", JSON.stringify({ jenis: "picking", pesan: String(e) }));
    }
  }

  const jawabanNormalized = teksJawaban.trim().toLowerCase();

  const jawabanBatal =
    jawabanNormalized === "batal" || jawabanNormalized === "gak jadi" || jawabanNormalized === "tidak";
  const jawabanYa = jawabanNormalized === "ya" || jawabanNormalized === "iya" || jawabanNormalized === "ok";

  if (jawabanBatal) {
    await hapusPendingPickingList(sessionRef);
    if (kirimNotifikasi) {
      await kirimPesan(chatId, "Oke, dibatalkan. Draft picking list tadi gak diproses.");
    }
    return { ok: true, dibatalkan: true };
  }

  if (!jawabanYa) {
    // Jawaban dari tombol selalu "ya"/"batal" (lihat handleKonfirmasiCallback.js), jadi
    // baris ini praktis cuma kena kalau sumber "teks" dan admin ketik sesuatu di luar itu.
    if (sumber === "teks") {
      if (kirimNotifikasi) {
        await kirimPesan(
          chatId,
          "Masih nunggu konfirmasi draft picking list sebelumnya. Tekan tombol di pesan sebelumnya, atau balas *batal*.",
          { parseMode: "Markdown" }
        );
      }
    }
    return { ok: false, alasan: "jawaban_tak_dikenal" };
  }

  const movements = await ambilMovementsByIds(movementIds);

  // Hanya proses movement yang punya kode_barang (hasil match "jelas") — sesuai ringkasan
  // yang ditampilkan handleScreenshotPickingList.js: item ragu/tak ketemu SENGAJA dilewati
  // dulu di Batch 5 ini, biar gak salah apply ke produk yang salah.
  const bisaDiproses = movements.filter((m) => m.kode_barang);
  const dilewati = movements.filter((m) => !m.kode_barang);

  let jumlahKurangiStok = 0;
  let jumlahMintaGudang = 0;

  for (const movement of bisaDiproses) {
    if (movement.action_type === "kurangi_stok") {
      await kurangiStok(movement.kode_barang, movement.qty, confirmedBy);
      await tandaiMovementProcessed(movement.id);
      await tandaiMovementConfirmedBy(movement.id, confirmedBy);
      jumlahKurangiStok += 1;
    } else if (movement.action_type === "perlu_request" || movement.action_type === "perlu_request_buffer") {
      await tambahItemKeDailyRequest(ambilTanggalHariIni(), {
        kode_barang: movement.kode_barang,
        nama: movement.nama_terbaca,
        variasi: movement.variasi,
        qty: movement.qty,
        buffer: movement.action_type === "perlu_request_buffer",
      });
      await tandaiMovementStatus(movement.id, "pending_request");
      jumlahMintaGudang += 1;
    }
  }

  await hapusPendingPickingList(sessionRef);

  if (kirimNotifikasi) {
    const teksHasil = susunTeksHasil(jumlahKurangiStok, jumlahMintaGudang, dilewati.length);
    await kirimPesan(chatId, teksHasil, { parseMode: "Markdown" });
  }
  return {
    ok: true,
    diproses: jumlahKurangiStok + jumlahMintaGudang,
    dilewati: dilewati.length,
    batch_id: String(telegramUserId),
  };
}

async function ambilMovementsByIds(movementIds) {
  const hasil = [];
  for (const id of movementIds) {
    const doc = await db.collection("stock_movements").doc(id).get();
    if (doc.exists) hasil.push({ id: doc.id, ...doc.data() });
  }
  return hasil;
}

async function tandaiMovementProcessed(movementId) {
  await db.collection("stock_movements").doc(movementId).update({ status: "processed" });
}

async function tandaiMovementConfirmedBy(movementId, confirmedBy) {
  const { ambilIdentitasAdmin } = require("../models/admins");
  const identitas = await ambilIdentitasAdmin(confirmedBy);
  await db.collection("stock_movements").doc(movementId).update({
    confirmed_by: String(confirmedBy),
    confirmed_by_username: identitas.telegram_username,
    confirmed_by_name: identitas.name,
    confirmed_at: new Date(),
  });
}

async function tandaiMovementStatus(movementId, status) {
  await db.collection("stock_movements").doc(movementId).update({ status });
}

function ambilTanggalHariIni() {
  // dipisah jadi fungsi kecil biar konsisten kalau nanti dailyRequests.js
  // formatTanggal() diubah timezone-nya — satu titik pemanggilan
  return formatTanggal(new Date());
}

async function hapusPendingPickingList(sessionRef) {
  await sessionRef.update({ pendingPickingList: FieldValue.delete() });
}

function susunTeksHasil(jumlahKurangiStok, jumlahMintaGudang, jumlahDilewati) {
  const baris = ["✅ Selesai diproses."];
  if (jumlahKurangiStok > 0) baris.push(`- ${jumlahKurangiStok} item dikurangi dari stok gudang online.`);
  if (jumlahMintaGudang > 0) baris.push(`- ${jumlahMintaGudang} item masuk daftar minta ke gudang sebelah hari ini.`);
  if (jumlahDilewati > 0) {
    baris.push(
      `- ${jumlahDilewati} item dilewati (produk gak ketemu/ragu) — cek manual via chat biasa kalau perlu.`
    );
  }
  return baris.join("\n");
}

module.exports = { apakahAdaPendingPickingList, konfirmasiPickingList };
