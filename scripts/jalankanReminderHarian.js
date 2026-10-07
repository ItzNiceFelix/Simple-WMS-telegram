// scripts/jalankanReminderHarian.js
// Entry point CLI dipanggil dari .github/workflows/reminder-harian.yml.
// Sama pola scripts/jalankanSyncMasterData.js (Batch 6) — GitHub Actions butuh titik masuk
// Node biasa, bukan handler Vercel. Disebut eksplisit di sini krn ini juga di luar 4 file
// rencana awal Batch 7 (7.3), sama alasannya kayak Batch 6.

const { jalankanReminderHarian } = require("../lib/reminder/reminderHarian");
const { kirimNotifErrorCron } = require("../lib/telegram/notifikasiError");
const { validasiEnvCronReminder } = require("../lib/config/env");

async function main() {
  validasiEnvCronReminder();
  console.log("[reminder-harian] mulai cek proyeksi stok...");
  const hasil = await jalankanReminderHarian();
  console.log(
    `[reminder-harian] selesai. Produk online dicek: ${hasil.jumlahDiproses}, perlu diperhatikan: ${hasil.jumlahPerluDiperhatikan}`
  );
}

main().catch(async (err) => {
  console.error("[reminder-harian] gagal:", err);
  await kirimNotifErrorCron("Reminder Harian", err);
  process.exitCode = 1;
});
