// lib/handlers/handleRevokeAdmin.js
// Batch 9 — Alur revoke admin (bagian 5A)
// Ditangani di sini: validasi user_id, kirim konfirmasi dgn inline button.
// Callback tombol Yakin/Batal ada di handleApprovalCallback.js.

const { ambilAdmin, hapusAdmin } = require("../models/admins");
const { revokeAccessRequest } = require("../models/accessRequests");
const {
  kirimPesan,
  kirimPesanDenganTombol,
} = require("../telegram/kirimPesan");

/**
 * Mulai alur revoke: validasi user_id, cek apakah user exist & bukan diri sendiri,
 * terus kirim konfirmasi dgn inline button ke Super Admin.
 */
async function mulaiRevokeAdmin(telegramUserId, chatId, targetUserIdStr) {
  const targetUserId = parseInt(targetUserIdStr, 10);

  // Validasi format
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    await kirimPesan(
      chatId,
      "Format user ID salah. Contoh: `/revoke_admin 123456789`",
      { parseMode: "Markdown" }
    );
    return;
  }

  // Cek apakah user exist di admin list
  const targetAdmin = await ambilAdmin(targetUserId);
  if (!targetAdmin) {
    await kirimPesan(
      chatId,
      `User ${targetUserId} belum ada di daftar admin.`
    );
    return;
  }

  // Cek apakah coba revoke diri sendiri
  if (targetUserId === telegramUserId) {
    await kirimPesan(
      chatId,
      "Tidak boleh revoke diri sendiri 😅"
    );
    return;
  }

  // Kirim konfirmasi dgn inline button
  const tombolTombol = [
    [
      { text: "✅ Yakin", callback_data: `revoke_confirm:${targetUserId}` },
      { text: "❌ Batal", callback_data: `revoke_cancel:${targetUserId}` },
    ],
  ];

  const namaTarget = targetAdmin.name || `(${targetUserId})`;
  await kirimPesanDenganTombol(
    chatId,
    `Yakin mau revoke *${namaTarget}* (${targetUserId})?`,
    tombolTombol,
    { parseMode: "Markdown" }
  );
}

/**
 * Eksekusi revoke: hapus dari collection, kirim notif ke target user & Super Admin.
 */
async function eksekusiRevokeAdmin(targetUserId, fromUserId, chatId, messageId) {
  const targetAdmin = await ambilAdmin(targetUserId);
  if (!targetAdmin) {
    // User sudah dihapus sebelumnya atau gak valid
    return { error: "User tidak ditemukan" };
  }

  // Hapus dari admins collection dan tutup status access lama agar user harus request ulang.
  await hapusAdmin(targetUserId);
  await revokeAccessRequest(targetUserId, fromUserId);

  // Notif ke target user (kalo dia punya chat history)
  try {
    await kirimPesan(
      targetUserId,
      `Akses admin kamu sudah dicabut oleh Super Admin. Terima kasih sudah membantu! 👋`
    );
  } catch (err) {
    // Ignore error — mungkin user belum pernah chat dgn bot
    console.error(`Gagal kirim notif ke target user ${targetUserId}:`, err);
  }

  return { success: true, targetAdmin };
}

module.exports = {
  mulaiRevokeAdmin,
  eksekusiRevokeAdmin,
};
