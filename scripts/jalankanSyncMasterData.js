// scripts/jalankanSyncMasterData.js
// Entry point CLI dipanggil dari .github/workflows/sync-master-data.yml.
// Bukan bagian dari 4 file rencana Batch 6 semula (7.3) — ditambah karena workflow
// butuh titik masuk Node biasa (bukan handler Vercel), disebut di sini biar transparan
// alasan penambahannya, sesuai aturan coding poin 2.

const { syncMasterData } = require("../lib/sheets/syncMasterData");
const { kirimNotifErrorCron } = require("../lib/telegram/notifikasiError");
const { validasiEnvCronSheets } = require("../lib/config/env");

async function main() {
  validasiEnvCronSheets();
  console.log("[sync-master-data] mulai sync...");
  const hasil = await syncMasterData();
  console.log(`[sync-master-data] selesai. Diproses: ${hasil.jumlahProdukDiproses}, gagal: ${hasil.jumlahGagal}`);

  if (hasil.jumlahGagal > 0) {
    console.error("[sync-master-data] daftar error:", JSON.stringify(hasil.error, null, 2));
    process.exitCode = 1; // biar GitHub Actions run ditandai failed, gak diam-diam sukses
  }
}

main().catch(async (err) => {
  console.error("[sync-master-data] gagal total:", err);
  await kirimNotifErrorCron("Sync Master Data", err);
  process.exitCode = 1;
});
