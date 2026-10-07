// lib/router/routePesan.js
// Titik masuk logika setelah webhook menerima update dari Telegram.
// Tanggung jawab di sini: (1) filter apakah bot perlu merespon (DM vs grup),
// (2) gating akses (admin terdaftar / belum / lagi kenalan), (3) dispatch ke handler.
//
// Batch 8: alur approval akses baru (bagian 4H) sudah disambung penuh. Sekaligus nutup
// TODO wiring numpuk dari Batch 5-7 (screenshot + pending-check picking list, /sync_stok
// + konfirmasi kolom, pending-check opname) — bukan batch baru, tapi memang harus
// dibereskan biar fitur2 itu jalan end-to-end.
//
// Gap tersisa (di luar scope, lihat markdown skema bagian 7.3 utk detail):
// 1. Jawaban custom nama kolom (bukan "ya") di konfirmasi tambah kolom Sheets blm ditangani.
// 2. Belum ada pemicu MULAI opname baru (handleOpname()) — direncanakan natural via chat
//    Gemini (tool baru), belum dikerjakan di batch ini.

const {
  kirimPesan,
  jawabCallbackQuery,
  unduhFileSebagaiBase64,
} = require("../telegram/kirimPesan");
const {
  apakahBotHarusMerespon,
  apakahBolehProsesScreenshot,
} = require("../telegram/apakahBotHarusMerespon");
const { handleCommand } = require("./handleCommand");
const { isAdmin, updateUsernameAdmin } = require("../models/admins");
const {
  handleAksesBaru,
  apakahMenungguKenalan,
  lanjutkanKenalan,
} = require("../handlers/handleAksesBaru");
const { handleApprovalCallback } = require("../handlers/handleApprovalCallback");
const { handleSettingsCallback } = require("../handlers/handleSettings");
const { handleKonfirmasiCallback } = require("../handlers/handleKonfirmasiCallback");
const { handleChatBiasa } = require("../gemini/chatHandler");
const {
  apakahAdaPendingPickingList,
  konfirmasiPickingList,
} = require("../handlers/konfirmasiPickingList");
const { handleScreenshotPickingList } = require("../handlers/handleScreenshotPickingList");
const {
  apakahAdaPendingSyncStok,
  konfirmasiSyncStok,
  apakahMintaKonfirmasiKolom,
  konfirmasiTambahKolom,
  batalkanTambahKolom,
} = require("../sheets/syncStokDuaArah");
const { handleOpname, apakahAdaPendingOpname, konfirmasiOpname } = require("../handlers/handleOpname");

// Bangun objek konteks yang dipakai konsisten di semua handler turunan.
function buatCtx(message) {
  return {
    message,
    chatId: message.chat.id,
    telegramUserId: message.from.id,
    telegramUsername: message.from.username,
    telegramDisplayName: [message.from.first_name, message.from.last_name]
      .filter(Boolean)
      .join(" "),
  };
}

// Gerbang akses: return true kalau boleh lanjut diproses sbg admin biasa, false kalau
// harus berhenti di sini (lagi kenalan, lagi ditunggu approval, atau cooldown/diam).
async function gatingAkses(ctx) {
  const sudahAdmin = await isAdmin(ctx.telegramUserId);
  if (sudahAdmin) return true;

  // User sudah di-approve Super Admin tapi belum resmi masuk `admins` → lagi sesi
  // "kenalan" (nunggu jawaban nama). Dicek DULUAN, sebelum ke handleAksesBaru, biar
  // gak ketimpa alur request-baru (bagian 4H poin 2).
  if (await apakahMenungguKenalan(ctx.telegramUserId)) {
    if (ctx.message.text) {
      await lanjutkanKenalan(ctx.telegramUserId, ctx.chatId, ctx.message.text);
    } else {
      await kirimPesan(ctx.chatId, "Namanya siapa ya? Boleh diketik ya 🙂");
    }
    return false;
  }

  // Belum admin & bukan lagi kenalan → serahkan ke handleAksesBaru.js (bagian 4H):
  // urus entry access_requests, notif Super Admin, balas standar, atau diam (cooldown).
  await handleAksesBaru({
    telegramUserId: ctx.telegramUserId,
    chatId: ctx.chatId,
    telegramUsername: ctx.telegramUsername,
    telegramDisplayName: ctx.telegramDisplayName,
  });
  return false;
}

// Cek draft/pertanyaan yang lagi nunggu konfirmasi, sebelum teks admin diteruskan ke
// Gemini sbg chat biasa. Urutan penting: konfirmasi kolom dicek PALING DULUAN krn
// keyed per chatId (bukan per telegramUserId spt 3 lainnya) & muncul SEBELUM draft
// sync stok sempat dibuat (mulaiSyncStok berhenti duluan kalau kolom belum ada).
async function cekDraftPending(ctx) {
  if (await apakahMintaKonfirmasiKolom(ctx.chatId)) {
    const jawaban = ctx.message.text.trim().toLowerCase();
    if (jawaban === "ya" || jawaban === "iya" || jawaban === "ok") {
      await konfirmasiTambahKolom(ctx.chatId);
    } else if (jawaban === "batal" || jawaban === "tidak" || jawaban === "gak jadi") {
      await batalkanTambahKolom(ctx.chatId);
    } else {
      // Admin kasih nama kolom custom / jawaban lain — belum ditangani (konfirmasiTambahKolom
      // hardcode nama kolom default "Stok Online"), lihat catatan gap di bawah.
      await kirimPesan(
        ctx.chatId,
        'Sementara cuma bisa pakai nama kolom default "Stok Online". Balas *ya* buat lanjut tambah kolom itu, atau *batal*.',
        { parseMode: "Markdown" }
      );
    }
    return true;
  }
  if (await apakahAdaPendingPickingList(ctx.telegramUserId)) {
    await konfirmasiPickingList(ctx.telegramUserId, ctx.message.text);
    return true;
  }
  if (await apakahAdaPendingSyncStok(ctx.telegramUserId)) {
    await konfirmasiSyncStok(ctx.telegramUserId, ctx.message.text);
    return true;
  }
  if (await apakahAdaPendingOpname(ctx.telegramUserId)) {
    await konfirmasiOpname(ctx.telegramUserId, ctx.message.text);
    return true;
  }
  return false;
}

// Caption foto menentukan alur: ada kata "opname" (whole-word, case-insensitive) atau
// diawali "hitung" → opname; selain itu (termasuk caption kosong) → picking list.
function adalahFotoOpname(caption) {
  return /\bopname\b/i.test(caption) || /^\s*hitung\b/i.test(caption);
}

async function routeMessage(message) {
  if (!apakahBotHarusMerespon(message)) {
    return; // diam, sesuai aturan grup di bagian 4G.
  }

  const ctx = buatCtx(message);
  await updateUsernameAdmin(ctx.telegramUserId, ctx.telegramUsername);

  const bolehLanjut = await gatingAkses(ctx);
  if (!bolehLanjut) return;

  // Foto via DM, hanya diproses via DM (bukan grup), sesuai keputusan. Telegram kirim beberapa
  // resolusi per foto di message.photo (array terurut kecil→besar); ambil yg terakhir (resolusi
  // terbesar) biar ekstraksi Gemini vision paling akurat.
  //
  // Bedain picking list vs opname dari CAPTION (keduanya sama-sama message.photo):
  //   - caption ada kata "opname" (whole-word) ATAU diawali "hitung" → foto opname
  //   - selain itu (termasuk tanpa caption) → foto picking list (backward compatible)
  if (message.photo && apakahBolehProsesScreenshot(message)) {
    const fotoTerbesar = message.photo[message.photo.length - 1];
    const caption = message.caption || "";
    const untukOpname = adalahFotoOpname(caption);
    try {
      const { base64Image, mimeType } = await unduhFileSebagaiBase64(fotoTerbesar.file_id);
      if (untukOpname) {
        await handleOpname({
          telegramUserId: ctx.telegramUserId,
          chatId: ctx.chatId,
          sumber: "screenshot",
          base64Image,
          mimeType,
        });
      } else {
        await handleScreenshotPickingList({
          telegramUserId: ctx.telegramUserId,
          chatId: ctx.chatId,
          base64Image,
          mimeType,
        });
      }
    } catch (error) {
      console.error("Gagal proses foto:", error);
      await kirimPesan(
        ctx.chatId,
        untukOpname
          ? "Gagal proses foto opname tadi, boleh dicoba kirim ulang? 🙏"
          : "Gagal proses foto picking list tadi, boleh dicoba kirim ulang? 🙏"
      );
    }
    return;
  }

  if (message.text?.trim().startsWith("/")) {
    // Command selalu diproses duluan (mis. /reset harus bisa motong draft yg nyangkut).
    await handleCommand(ctx);
    return;
  }

  if (message.text) {
    const adaDraftDiproses = await cekDraftPending(ctx);
    if (adaDraftDiproses) return;

    await handleChatBiasa({
      telegramUserId: ctx.telegramUserId,
      chatId: ctx.chatId,
      teksPesan: message.text,
    });
    return;
  }

  // Tipe pesan lain (sticker, voice, dokumen, dll) — belum ada kebutuhan spesifik.
  await kirimPesan(ctx.chatId, "Maaf, tipe pesan ini belum bisa saya proses 🙏");
}

async function routeCallbackQuery(callbackQuery) {
  const data = callbackQuery.data || "";

  if (data.startsWith("settings_ai:")) {
    await handleSettingsCallback({
      callbackQueryId: callbackQuery.id,
      callbackData: data,
      chatId: callbackQuery.message.chat.id,
      messageId: callbackQuery.message.message_id,
      fromUserId: callbackQuery.from.id,
    });
    return;
  }

  // Callback approval Super Admin ("approve:<id>" / "reject:<id>") — bagian 4H poin 2-3.
  // Batch 9: Juga handle revoke callbacks ("revoke_confirm:<id>" / "revoke_cancel:<id>").
  if (
    data.startsWith("approve:") ||
    data.startsWith("reject:") ||
    data.startsWith("revoke_confirm:") ||
    data.startsWith("revoke_cancel:")
  ) {
    await handleApprovalCallback({
      callbackQueryId: callbackQuery.id,
      callbackData: data,
      chatId: callbackQuery.message.chat.id,
      messageId: callbackQuery.message.message_id,
      fromUserId: callbackQuery.from.id,
    });
    return;
  }

  // Callback tombol konfirmasi (pa:/pb:/op:/ss:/kolom:/pl:/cp:) — kurangiStok/tambahStok
  // (tunggal & batch), opname, /sync_stok, tambah kolom Sheets, picking list, konfirmasi
  // cakupan pencarian produk. Semua admin di chat itu boleh mencet (bukan cuma yang mulai
  // aksinya), sesuai keputusan.
  if (
    data.startsWith("pa:") ||
    data.startsWith("pb:") ||
    data.startsWith("op:") ||
    data.startsWith("ss:") ||
    data.startsWith("kolom:") ||
    data.startsWith("pl:") ||
    data.startsWith("cp:")
  ) {
    await handleKonfirmasiCallback({
      callbackQueryId: callbackQuery.id,
      callbackData: data,
      chatId: callbackQuery.message.chat.id,
      messageId: callbackQuery.message.message_id,
      fromUserId: callbackQuery.from.id,
    });
    return;
  }

  // Callback lain yang belum dikenal.
  await jawabCallbackQuery(callbackQuery.id, { teks: "Aksi ini belum dikenal." });
}

// Entry point dipanggil dari api/webhook.js dengan raw `update` object dari Telegram.
async function routePesan(update) {
  try {
    if (update.message) {
      await routeMessage(update.message);
    } else if (update.callback_query) {
      await routeCallbackQuery(update.callback_query);
    }
    // Tipe update lain (edited_message, my_chat_member, dll) — diabaikan dulu, belum
    // ada kebutuhan spesifik untuk sekarang.
  } catch (error) {
    console.error("Error saat routePesan:", error);
    // Webhook tetap harus balas 200 ke Telegram supaya Telegram tidak retry terus-menerus
    // mengirim update yang sama. Tapi kalau memungkinkan (ada chatId valid), coba kirim
    // notifikasi singkat ke user — kalau notif ini juga gagal, diamkan, log saja.
    try {
      const targetChatId =
        update.message?.chat?.id || update.callback_query?.message?.chat?.id;
      if (targetChatId) {
        await kirimPesan(
          targetChatId,
          "Aduh, ada masalah di sistem saya sebentar. Bisa coba lagi beberapa saat? 🙏"
        );
      }
    } catch (notifError) {
      console.error("Gagal kirim notif error ke user (tidak fatal):", notifError);
    }
  }
}

module.exports = { routePesan, adalahFotoOpname };