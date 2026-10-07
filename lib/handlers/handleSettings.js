const { isSuperAdmin } = require("../models/admins");
const { ambilPengaturanAI, simpanProviderAI } = require("../models/aiSettings");
const { PROVIDER_AI, LABEL_PROVIDER } = require("../dashboard/providerAi.js");
const { kirimPesan, kirimPesanDenganTombol, jawabCallbackQuery, editPesan } = require("../telegram/kirimPesan");

function labelProvider(provider) {
  return LABEL_PROVIDER[provider] || provider;
}

function teksSettings(pengaturan) {
  return `*Pengaturan AI*\n\nProvider teks saat ini: *${labelProvider(pengaturan.textProvider)}*\n\nPilih provider:`;
}

// 5 provider dipecah 2 baris biar tidak berdesakan di Telegram.
function tombolSettings(provider) {
  const buat = (p) => ({
    text: `${provider === p ? "✅ " : ""}${LABEL_PROVIDER[p]}`,
    callback_data: `settings_ai:${p}`,
  });
  return [
    PROVIDER_AI.slice(0, 3).map(buat),
    PROVIDER_AI.slice(3).map(buat),
  ];
}

async function handleSettings(ctx) {
  if (!(await isSuperAdmin(ctx.telegramUserId))) {
    await kirimPesan(ctx.chatId, "Perintah ini hanya bisa Super Admin.");
    return;
  }

  const pengaturan = await ambilPengaturanAI({ paksa: true });
  await kirimPesanDenganTombol(ctx.chatId, teksSettings(pengaturan), tombolSettings(pengaturan.textProvider));
}

async function handleSettingsCallback({ callbackQueryId, callbackData, chatId, messageId, fromUserId }) {
  if (!(await isSuperAdmin(fromUserId))) {
    await jawabCallbackQuery(callbackQueryId, { teks: "Cuma Super Admin yang bisa mengubah settings.", showAlert: true });
    return;
  }

  const provider = callbackData.split(":")[1];
  const hasil = await simpanProviderAI(provider, fromUserId);
  if (hasil.error) {
    await jawabCallbackQuery(callbackQueryId, { teks: hasil.error, showAlert: true });
    return;
  }

  await jawabCallbackQuery(callbackQueryId, { teks: `Provider diubah ke ${labelProvider(provider)}.` });
  await editPesan(chatId, messageId, teksSettings(hasil.pengaturan), {
    replyMarkup: { inline_keyboard: tombolSettings(hasil.pengaturan.textProvider) },
  });
}

module.exports = { handleSettings, handleSettingsCallback, tombolSettings, LABEL_PROVIDER };