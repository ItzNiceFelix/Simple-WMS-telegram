// lib/handlers/handleAksesBaru.js
// Batch 8 — Alur approval akses user baru (bagian 4H)
// Ditangani di sini: gating awal (belum_pernah/pending/cooldown/boleh_request_baru)
// + sesi "kenalan" (nama) setelah Super Admin approve.
// Callback tombol Setujui/Tolak ada di file terpisah: handleApprovalCallback.js

const {
  ambilAccessRequest,
  buatAccessRequestBaru,
  tentukanStatusAkses,
} = require("../models/accessRequests");
const { tambahAdmin, ambilSemuaAdminByRole } = require("../models/admins");
const {
  kirimPesan,
  kirimPesanDenganTombol,
} = require("../telegram/kirimPesan");


const PESAN_TUNGGU =
  "Ditunggu ya, sedang dikonfirmasi dulu sama admin utama 🙏";
const PESAN_TOLAK_HALUS = "Maaf, saat ini belum bisa saya bantu ya.";

/**
 * Dipanggil dari routePesan.js sebelum ke Gemini, KHUSUS user yg belum ada di `admins`.
 * Menentukan status akses & bertindak sesuai (kirim notif approval / balas standar / diam).
 */
async function handleAksesBaru({
  telegramUserId,
  chatId,
  telegramUsername,
  telegramDisplayName,
}) {
  const status = await tentukanStatusAkses(telegramUserId);

  switch (status) {
    case "belum_pernah":
    case "boleh_request_baru": {
      await buatAccessRequestBaru(telegramUserId, {
        username: telegramUsername || null,
        displayName: telegramDisplayName,
      });
      await kirimNotifKeSuperAdmin({
        telegramUserId,
        telegramUsername,
        telegramDisplayName,
      });
      await kirimPesan(chatId, PESAN_TUNGGU);
      return;
    }

    case "pending": {
      // sudah ada entry pending → jangan notif Super Admin berulang, cukup balas user
      await kirimPesan(chatId, PESAN_TUNGGU);
      return;
    }

    case "cooldown": {
      // masih dalam window rejected_until → diam total, gak proses/balas apapun
      return;
    }

    case "approved": {
      // status approved tapi belum masuk admins → seharusnya lagi nunggu jawaban "kenalan"
      // routePesan.js harusnya sudah cek apakahMenungguKenalan() duluan sebelum sampai sini,
      // tapi jaga-jaga kalau kepanggil langsung: anggap ini pesan nama, teruskan.
      return { perluDiprosesSebagaiKenalan: true };
    }

    default:
      return;
  }
}

/**
 * Cek apakah user ini sudah di-approve Super Admin tapi belum jawab nama (belum masuk `admins`).
 * Dipanggil dari routePesan.js SEBELUM handleAksesBaru/handleChatBiasa, mirip pola
 * apakahAdaPendingPickingList/apakahAdaPendingOpname.
 */
async function apakahMenungguKenalan(telegramUserId) {
  const req = await ambilAccessRequest(telegramUserId);
  return !!req && req.status === "approved";
}

/**
 * Proses jawaban nama dari user yg lagi di sesi "kenalan", lalu resmikan jadi admin (role guest).
 */
async function lanjutkanKenalan(telegramUserId, chatId, namaJawaban) {
  const namaBersih = (namaJawaban || "").trim();
  if (!namaBersih) {
    await kirimPesan(chatId, "Namanya siapa ya? Boleh diketik ulang 🙂");
    return;
  }

  const req = await ambilAccessRequest(telegramUserId);
  await tambahAdmin(telegramUserId, {
    name: namaBersih,
    role: "guest",
    username: req?.telegram_username || null,
    approvedBy: req && req.resolved_by ? req.resolved_by : null,
  });

  await kirimPesan(
    chatId,
    `Siap kenal, ${namaBersih}! Sekarang udah bisa pakai bot ini ya. Ketik /help kalau butuh panduan.`
  );

  const daftarOwner = await ambilSemuaAdminByRole("owner");
  for (const owner of daftarOwner) {
    const targetChatId = owner.telegram_user_id || owner.id;
    if (targetChatId) {
      // FIX: Hindari kata 'user_id' agar Telegram Markdown tidak error
      await kirimPesan(
        targetChatId,
        `Proses approval selesai — ${namaBersih} (ID User: ${telegramUserId}) sudah resmi jadi admin (role: guest).`
      );
    }
  }
}

async function kirimNotifKeSuperAdmin({
  telegramUserId,
  telegramUsername,
  telegramDisplayName,
}) {
  const daftarOwner = await ambilSemuaAdminByRole("owner");
  
  if (!daftarOwner.length) {
    console.error("kirimNotifKeSuperAdmin: gak ada admin role owner di Firestore.");
    return;
  }

  // FIX: Kita amankan garis bawah (_) bawaan dari nama/username Telegram dengan mengubahnya jadi spasi/hilang
  const amanUsername = telegramUsername ? telegramUsername.replace(/_/g, "") : "";
  const amanDisplayName = telegramDisplayName ? telegramDisplayName.replace(/_/g, " ") : "";

  const identitas = amanUsername
    ? `@${amanUsername} (${amanDisplayName})`
    : amanDisplayName;

  // FIX: Hindari kata 'user_id'
  const teks =
    `Ada user baru minta akses:\n` +
    `${identitas}\nID User: ${telegramUserId}`;

  for (const owner of daftarOwner) {
    const targetChatId = owner.telegram_user_id || owner.id; 
    
    if (targetChatId) {
      await kirimPesanDenganTombol(targetChatId, teks, [
        [
          { text: "✅ Setujui", callback_data: `approve:${telegramUserId}` },
          { text: "❌ Tolak", callback_data: `reject:${telegramUserId}` },
        ],
      ]);
    } else {
      console.error("Gagal kirim notif: chat ID owner tidak ditemukan di data.", owner);
    }
  }
}
module.exports = {
  handleAksesBaru,
  apakahMenungguKenalan,
  lanjutkanKenalan,
  PESAN_TOLAK_HALUS,
};
