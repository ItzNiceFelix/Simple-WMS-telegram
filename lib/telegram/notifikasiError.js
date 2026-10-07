// lib/telegram/notifikasiError.js
// Notifikasi kegagalan job cron terjadwal (GitHub Actions) ke owner. Dipakai dari
// scripts/jalankanSyncMasterData.js & scripts/jalankanReminderHarian.js di blok .catch
// supaya kegagalan tidak diam-diam cuma muncul di log Actions.
//
// Best-effort: fungsi ini TIDAK PERNAH throw. Kalau notifikasi sendiri gagal (mis.
// Telegram API down), cukup di-log — jangan sampai menutupi error asli yang mau dilaporkan.

const { ambilSemuaAdminByRole } = require("../models/admins");
const { kirimPesan } = require("./kirimPesan");

const BATAS_PESAN_ERROR = 500;

function potongPesanError(error) {
  const teks = error instanceof Error ? error.message : String(error);
  if (teks.length <= BATAS_PESAN_ERROR) return teks;
  return `${teks.slice(0, BATAS_PESAN_ERROR)}…`;
}

function susunTeksNotif(namaJob, error) {
  const waktu = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  return [
    `🚨 *Job cron gagal: ${namaJob}*`,
    "",
    `*Error:* ${potongPesanError(error)}`,
    `*Waktu:* ${waktu} WIB`,
    "",
    "Cek log GitHub Actions untuk detail lengkap.",
  ].join("\n");
}

async function kirimNotifErrorCron(namaJob, error) {
  try {
    let penerima = await ambilSemuaAdminByRole("owner");
    if (penerima.length === 0) penerima = await ambilSemuaAdminByRole("admin");
    if (penerima.length === 0) {
      console.error(`[notif-error] ${namaJob}: tidak ada owner/admin untuk diberi tahu.`);
      return;
    }

    const teks = susunTeksNotif(namaJob, error);
    for (const admin of penerima) {
      const chatId = admin.telegram_user_id;
      if (!chatId) continue;
      await kirimPesan(chatId, teks, { parseMode: "Markdown" });
    }
  } catch (err) {
    console.error(`[notif-error] gagal kirim notifikasi utk "${namaJob}":`, err);
  }
}

module.exports = { kirimNotifErrorCron, susunTeksNotif, potongPesanError };
