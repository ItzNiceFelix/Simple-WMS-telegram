// lib/handlers/handleApprovalCallback.js
// Batch 8 — Proses tombol inline "Setujui"/"Tolak" dari notif Super Admin (bagian 4H).
// callback_data format: "approve:{telegram_user_id}" / "reject:{telegram_user_id}"
// Batch 9 — Tambah callback untuk revoke: "revoke_confirm:{user_id}" / "revoke_cancel:{user_id}"

const {
  ambilAccessRequest,
  setujuiAccessRequest,
  tolakAccessRequest,
} = require("../models/accessRequests");
const { isSuperAdmin } = require("../models/admins");
const {
  kirimPesan,
  jawabCallbackQuery,
  editPesan,
} = require("../telegram/kirimPesan");
const { PESAN_TOLAK_HALUS } = require("./handleAksesBaru");
const { eksekusiRevokeAdmin } = require("./handleRevokeAdmin");

/**
 * Dipanggil dari routePesan.js saat update berupa callback_query dgn data "approve:"/"reject:"/"revoke_confirm:"/"revoke_cancel:".
 */
async function handleApprovalCallback({
  callbackQueryId,
  callbackData,
  chatId,
  messageId,
  fromUserId, // siapa yg pencet tombol — divalidasi harus Super Admin
}) {
  const [aksi, targetUserId] = callbackData.split(":");

  if (!(await isSuperAdmin(fromUserId))) {
    await jawabCallbackQuery(callbackQueryId, {
      teks: "Cuma Super Admin yang bisa proses ini.",
      showAlert: true,
    });
    return;
  }

  // Batch 9: Revoke callbacks — tangani duluan sebelum cek accessRequests
  // (karena revoke tidak pakai accessRequests collection)
  if (aksi === "revoke_confirm") {
    let result;
    try {
      result = await eksekusiRevokeAdmin(targetUserId, fromUserId, chatId, messageId);
    } catch (error) {
      console.error("Gagal eksekusi revoke admin:", error);
      await jawabCallbackQuery(callbackQueryId, {
        teks: "Gagal memproses revoke, silakan coba lagi.",
        showAlert: true,
      });
      return;
    }
    if (result.error) {
      await jawabCallbackQuery(callbackQueryId, {
        teks: result.error,
        showAlert: true,
      });
      return;
    }
    await jawabCallbackQuery(callbackQueryId, { teks: "✅ Revoke berhasil" });
    // editPesan/kirimPesan di bawah bukan inti aksi revoke — kalau gagal (misal pesan
    // sudah kedaluwarsa), log saja, tidak membatalkan revoke yang sudah terekskusi.
    try {
      await editPesan(
        chatId,
        messageId,
        `✅ Revoke berhasil — ${result.targetAdmin.name} (${targetUserId}) sudah dihapus dari admin list.`
      );
      await kirimPesan(chatId, `Akses admin dari *${result.targetAdmin.name}* sudah dicabut.`, {
        parseMode: "Markdown",
      });
    } catch (error) {
      console.error("Gagal kirim notif tambahan setelah revoke (revokenya sendiri sudah sukses):", error);
    }
    return;
  }

  if (aksi === "revoke_cancel") {
    await jawabCallbackQuery(callbackQueryId, { teks: "Dibatalkan" });
    try {
      await editPesan(chatId, messageId, `❌ Revoke dibatalkan — user_id: ${targetUserId}`);
    } catch (error) {
      console.error("Gagal edit pesan saat batalkan revoke (tidak fatal):", error);
    }
    return;
  }

  // Batch 8: Approve/Reject callbacks — perlu cek accessRequests
  let req;
  try {
    req = await ambilAccessRequest(targetUserId);
  } catch (error) {
    console.error("Gagal ambil access request:", error);
    await jawabCallbackQuery(callbackQueryId, {
      teks: "Gagal memproses, silakan coba lagi.",
      showAlert: true,
    });
    return;
  }
  if (!req || req.status !== "pending") {
    await jawabCallbackQuery(callbackQueryId, {
      teks: "Request ini sudah diproses sebelumnya.",
      showAlert: true,
    });
    return;
  }

  if (aksi === "approve") {
    try {
      await setujuiAccessRequest(targetUserId, fromUserId);
    } catch (error) {
      console.error("Gagal approve access request:", error);
      await jawabCallbackQuery(callbackQueryId, {
        teks: "Gagal menyimpan approval, silakan coba lagi.",
        showAlert: true,
      });
      return;
    }
    await jawabCallbackQuery(callbackQueryId, { teks: "Disetujui ✅" });
    try {
      await editPesan(chatId, messageId, `✅ Disetujui — user_id: ${targetUserId}`);
      await kirimPesan(
        targetUserId,
        "Sudah disetujui! Boleh kenalan dulu, namanya siapa?"
      );
    } catch (error) {
      // Approve sudah tersimpan di DB; notif tambahan gagal tidak boleh bikin user
      // mengira approval gagal. Log saja.
      console.error("Gagal kirim notif setelah approve (approvalnya sendiri sudah sukses):", error);
    }
    return;
  }

  if (aksi === "reject") {
    try {
      await tolakAccessRequest(targetUserId, fromUserId);
    } catch (error) {
      console.error("Gagal reject access request:", error);
      await jawabCallbackQuery(callbackQueryId, {
        teks: "Gagal menyimpan penolakan, silakan coba lagi.",
        showAlert: true,
      });
      return;
    }
    await jawabCallbackQuery(callbackQueryId, { teks: "Ditolak" });
    try {
      await editPesan(chatId, messageId, `❌ Ditolak — user_id: ${targetUserId}`);
      await kirimPesan(targetUserId, PESAN_TOLAK_HALUS);
    } catch (error) {
      // Tolakan sudah tersimpan di DB; notif tambahan gagal tidak fatal.
      console.error("Gagal kirim notif setelah reject (penolakannya sendiri sudah sukses):", error);
    }
    return;
  }

  // aksi gak dikenal — jaga-jaga
  await jawabCallbackQuery(callbackQueryId, {
    teks: "Aksi gak dikenali.",
    showAlert: true,
  });
}

module.exports = { handleApprovalCallback };
