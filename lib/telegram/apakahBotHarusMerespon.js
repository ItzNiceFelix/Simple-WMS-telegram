// lib/telegram/apakahBotHarusMerespon.js
// Aturan (bagian 4G dokumen skema):
// - DM (private chat): bot selalu merespon semua pesan seperti biasa.
// - Grup: default DIAM, hanya merespon kalau di-mention, di-reply, atau lewat command (/...).
// - Screenshot picking list TIDAK termasuk trigger di grup — tetap hanya diproses via DM,
//   jadi dicek terpisah, bukan bagian dari fungsi umum ini.

function ambilUsernameBotDariEnv() {
  // Contoh: "toko_admin_bot" (tanpa "@"), diisi di env setelah bot dibuat via BotFather.
  const username = process.env.TELEGRAM_BOT_USERNAME || null;
  // Username kosong = deteksi mention/reply di grup tidak bisa bekerja akurat.
  // Jangan menyamarkan jadi "null OK" — log warning supaya ops melihatnya di log.
  if (!username) {
    onceWarnUsernameKosong();
  }
  return username;
}

let _sudahWarnUsername = false;
function onceWarnUsernameKosong() {
  if (_sudahWarnUsername) return;
  _sudahWarnUsername = true;
  console.warn("TELEGRAM_BOT_USERNAME tidak diisi — mention/reply detection di grup tidak akan akurat (fallback ke command/DM saja).");
}

function apakahPesanDiawaliCommand(message) {
  const teks = message?.text || "";
  return teks.trim().startsWith("/");
}

function apakahBotDiMention(message) {
  const teks = message?.text || message?.caption || "";
  const entities = message?.entities || message?.caption_entities || [];
  const usernameBot = ambilUsernameBotDariEnv();
  if (!usernameBot) return false;

  return entities.some((entity) => {
    if (entity.type !== "mention") return false;
    const potongan = teks.substring(entity.offset, entity.offset + entity.length);
    // potongan berupa "@nama_bot", buang "@" sebelum dibandingkan.
    return potongan.replace(/^@/, "").toLowerCase() === usernameBot.toLowerCase();
  });
}

function apakahMerupakanReplyKeBot(message) {
  const pengirimAsalReply = message?.reply_to_message?.from;
  if (!pengirimAsalReply) return false;
  const usernameBot = ambilUsernameBotDariEnv();
  if (!usernameBot) return false;
  return (
    pengirimAsalReply.is_bot &&
    pengirimAsalReply.username?.toLowerCase() === usernameBot.toLowerCase()
  );
}

// Fungsi utama dipanggil dari router untuk setiap update message masuk.
function apakahBotHarusMerespon(message) {
  const tipeChat = message?.chat?.type;

  if (tipeChat === "private") {
    return true;
  }

  // Grup atau supergroup: default diam kecuali salah satu trigger berikut terpenuhi.
  if (tipeChat === "group" || tipeChat === "supergroup") {
    return (
      apakahPesanDiawaliCommand(message) ||
      apakahBotDiMention(message) ||
      apakahMerupakanReplyKeBot(message)
    );
  }

  // Tipe chat lain (channel, dsb) — belum ada kebutuhan, default diam.
  return false;
}

// Dipakai router untuk cek khusus: apakah pesan ini boleh diproses sebagai screenshot
// picking list. Sesuai keputusan, ini HANYA berlaku di DM, walau grup sedang "aktif merespon".
function apakahBolehProsesScreenshot(message) {
  return message?.chat?.type === "private";
}

module.exports = {
  apakahBotHarusMerespon,
  apakahBolehProsesScreenshot,
  apakahPesanDiawaliCommand,
  apakahBotDiMention,
  apakahMerupakanReplyKeBot,
};
