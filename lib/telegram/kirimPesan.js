// lib/telegram/kirimPesan.js
// Wrapper tipis di atas Telegram Bot API (method sendMessage, answerCallbackQuery, dst).
// Semua request pakai fetch bawaan Node 18+ (tersedia di runtime Vercel), tidak perlu
// tambahan library seperti node-telegram-bot-api supaya lebih ringan.

const TELEGRAM_API_BASE = "https://api.telegram.org";
const BATAS_WAKTU_TELEGRAM_MS = 30000;

function ambilBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("Env variable TELEGRAM_BOT_TOKEN belum diisi.");
  }
  return token;
}

// Helper dasar: panggil method apapun di Telegram Bot API.
async function panggilTelegramApi(method, payload) {
  const token = ambilBotToken();
  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;

  const response = await fetchDenganTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data = await response.json();

  if (!data.ok) {
    // Jangan throw keras di sini supaya 1 kegagalan kirim pesan tidak bikin seluruh
    // handler crash — cukup log, biar pemanggil yang putuskan mau retry atau tidak.
    console.error(`Telegram API error (${method}):`, data.description || data);

    // Kasus umum: payload pakai parse_mode (Markdown/MarkdownV2) tapi teksnya dinamis
    // (balasan Gemini, nama produk, dll) yang kebetulan mengandung karakter spesial
    // (* _ ` [ ]) tak berpasangan → Telegram tolak dgn "can't parse entities".
    // Daripada pesan gagal terkirim sama sekali, retry sekali sebagai plain text.
    if (
      payload.parse_mode &&
      typeof data.description === "string" &&
      data.description.toLowerCase().includes("can't parse entities")
    ) {
      console.error(`Retrying ${method} tanpa parse_mode karena entity parsing gagal.`);
      const { parse_mode, ...payloadTanpaParseMode } = payload;
      const retryResponse = await fetchDenganTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadTanpaParseMode),
      });
      data = await retryResponse.json();
      if (!data.ok) {
        console.error(`Telegram API error (${method}) setelah retry:`, data.description || data);
      }
    }
  }

  return data;
}

async function fetchDenganTimeout(url, opsi) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BATAS_WAKTU_TELEGRAM_MS);
  try {
    return await fetch(url, { ...opsi, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Kirim pesan teks biasa. `opsi` bisa berisi reply_markup (keyboard), parse_mode, dll.
async function kirimPesan(chatId, teks, opsi = {}) {
  return panggilTelegramApi("sendMessage", {
    chat_id: chatId,
    text: teks,
    parse_mode: opsi.parseMode || "Markdown",
    reply_markup: opsi.replyMarkup,
    reply_to_message_id: opsi.replyToMessageId,
    disable_web_page_preview: true,
  });
}

// Kirim teks plain TANPA parse_mode. Dipakai utk pesan berisi data dinamis (nama produk)
// yang rawan "can't parse entities" & mudah di-copy apa adanya (PRD v3a §3.4/§3.5).
async function kirimPesanPlain(chatId, teks) {
  return panggilTelegramApi("sendMessage", {
    chat_id: chatId,
    text: teks,
    disable_web_page_preview: true,
  });
}

// Helper khusus untuk kirim pesan dengan inline keyboard (tombol Setujui/Tolak, dsb).
// tombolTombol: array of array of { text, callback_data } — sesuai format grid Telegram.
async function kirimPesanDenganTombol(chatId, teks, tombolTombol, opsi = {}) {
  return kirimPesan(chatId, teks, {
    ...opsi,
    replyMarkup: { inline_keyboard: tombolTombol },
  });
}

// Batas aman Telegram utk 1 pesan teks (limit resmi 4096 char) — dikasih sedikit
// margin buat suffix "(Part N/M)" yg ditambahkan di bawah.
const BATAS_PANJANG_PESAN = 3900;

// Kirim pesan panjang, otomatis dipecah jadi beberapa pesan berurutan kalau teksnya
// melebihi batas Telegram. Dipecah per baris (bukan potong tengah kata/baris) biar
// tetap rapi dibaca, dan tiap bagian dikasih penanda "(Part N/M)" kalau memang lebih dari 1.
// Dipakai misalnya utk listProdukOnlineBesertaStok yang daftarnya bisa panjang.
async function kirimPesanPanjang(chatId, teks, opsi = {}) {
  if (teks.length <= BATAS_PANJANG_PESAN) {
    return [await kirimPesan(chatId, teks, opsi)];
  }

  const baris = teks.split("\n");
  const bagianBagian = [];
  let bagianSekarang = "";

  for (const b of baris) {
    const calon = bagianSekarang ? `${bagianSekarang}\n${b}` : b;
    if (calon.length > BATAS_PANJANG_PESAN && bagianSekarang) {
      bagianBagian.push(bagianSekarang);
      bagianSekarang = b;
    } else {
      bagianSekarang = calon;
    }
  }
  if (bagianSekarang) bagianBagian.push(bagianSekarang);

  const hasil = [];
  for (let i = 0; i < bagianBagian.length; i++) {
    const penanda = bagianBagian.length > 1 ? `\n\n_(Part ${i + 1}/${bagianBagian.length})_` : "";
    hasil.push(await kirimPesan(chatId, bagianBagian[i] + penanda, opsi));
  }
  return hasil;
}

// Wajib dipanggil tiap kali terima callback_query, walau tidak ada pesan balasan —
// kalau tidak, tombol di UI Telegram user akan terus loading/spinner.
async function jawabCallbackQuery(callbackQueryId, opsi = {}) {
  return panggilTelegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: opsi.teks,
    show_alert: opsi.showAlert || false,
  });
}

// Edit teks & keyboard pesan yang sudah terkirim — dipakai misalnya setelah Super Admin
// tekan Setujui/Tolak, supaya tombol lama hilang dan diganti status hasil keputusan.
async function editPesan(chatId, messageId, teksBaru, opsi = {}) {
  return panggilTelegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: teksBaru,
    parse_mode: opsi.parseMode || "Markdown",
    reply_markup: opsi.replyMarkup,
  });
}

// Hapus inline keyboard dari pesan yang sudah terkirim TANPA ubah teksnya — dipakai
// setelah admin pencet salah satu tombol konfirmasi, biar tombolnya gak nyangkut/kepencet
// dobel (apalagi di grup, semua orang boleh mencet, jadi rawan race kalau tombolnya nyangkut).
async function hapusTombolPesan(chatId, messageId) {
  return panggilTelegramApi("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

// Hapus pesan status sementara setelah proses selesai atau dialihkan ke alur lain.
async function hapusPesan(chatId, messageId) {
  if (!messageId) return null;
  return panggilTelegramApi("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

// Kirim indikator "sedang mengetik..." — dipakai sebelum proses yang agak lama
// (misal panggil Gemini) supaya user tahu bot tidak diam/macet.
async function kirimAksiSedangMengetik(chatId) {
  return panggilTelegramApi("sendChatAction", {
    chat_id: chatId,
    action: "typing",
  });
}

// Peta ekstensi umum Telegram → mime type. Telegram gak selalu kasih mime type
// eksplisit di update (khususnya `photo`, isinya array resolusi tanpa mime) — jadi
// ditebak dari ekstensi file_path hasil getFile. Fallback jpeg krn paling umum utk
// foto dari kamera/screenshot HP.
const PETA_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function tebakMimeDariPath(filePath) {
  const ekstensi = String(filePath || "").split(".").pop()?.toLowerCase();
  return PETA_MIME[ekstensi] || "image/jpeg";
}

// Ambil path file di server Telegram dari file_id (method getFile bawaan Bot API).
async function ambilInfoFile(fileId) {
  const data = await panggilTelegramApi("getFile", { file_id: fileId });
  if (!data.ok) {
    throw new Error(`Gagal ambil info file dari Telegram: ${data.description || "unknown error"}`);
  }
  return data.result.file_path; // contoh: "photos/file_123.jpg"
}

// Download isi file dari Telegram lalu ubah jadi base64 — dipakai utk kirim foto
// (screenshot picking list/opname) ke Gemini vision, yang butuh base64Image + mimeType,
// bukan file_id. Endpoint download BEDA dari endpoint API biasa (pakai /file/bot<token>/,
// bukan /bot<token>/), jadi gak lewat panggilTelegramApi().
async function unduhFileSebagaiBase64(fileId) {
  const token = ambilBotToken();
  const filePath = await ambilInfoFile(fileId);

  const url = `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`;
  const response = await fetchDenganTimeout(url);
  if (!response.ok) {
    throw new Error(`Gagal download file dari Telegram (status ${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64Image = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = tebakMimeDariPath(filePath);

  return { base64Image, mimeType };
}

module.exports = {
  panggilTelegramApi,
  kirimPesan,
  kirimPesanPlain,
  kirimPesanDenganTombol,
  kirimPesanPanjang,
  jawabCallbackQuery,
  editPesan,
  hapusTombolPesan,
  hapusPesan,
  kirimAksiSedangMengetik,
  unduhFileSebagaiBase64,
};