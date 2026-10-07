// lib/handlers/handleKonfirmasiCallback.js
// Routing callback_query dari tombol inline konfirmasi (pengganti ketik "ya"/"batal").
// callback_data format: "<prefix>:<segmen>:<idPemilikSession>"
//   pa:ya:<telegramUserId>     / pa:tidak:<telegramUserId>       → kurangiStok/tambahStok
//   pb:ya:<telegramUserId>     / pb:tidak:<telegramUserId>       → kurangiStok/tambahStok BATCH
//                                                                   (banyak produk dalam 1 pesan)
//   op:ya:<telegramUserId>     / op:batal:<telegramUserId>       → opname
//   ss:<kondisi>:<telegramUserId> / ss:semua:.. / ss:batal:..    → /sync_stok
//   kolom:ya:<chatId>          / kolom:tidak:<chatId>            → tambah kolom "Stok Online"
//   pl:ya:<telegramUserId>     / pl:batal:<telegramUserId>       → picking list
//   cp:cari:<telegramUserId>   / cp:batal:<telegramUserId>       → konfirmasi cakupan pencarian
//                                                                   produk (expand ke semua katalog)
// Sengaja TIDAK divalidasi siapa yang boleh mencet (beda dari handleApprovalCallback.js
// yang wajib Super Admin) — keputusan: grup toko ini kecil, semua admin di situ dianggap
// boleh saling proses konfirmasi punya siapa pun, gak perlu dikunci per-user.
//
// Reuse penuh logic konfirmasiOpname/konfirmasiSyncStok/konfirmasiTambahKolom/
// prosesPendingActionViaTombol yang sudah ada (asalnya dipakai jalur teks) — tombol cuma
// ngirim jawaban teks yang sama persis, BUKAN logic baru.

const { jawabCallbackQuery, hapusTombolPesan } = require("../telegram/kirimPesan");
const {
  prosesPendingActionViaTombol,
  prosesPendingBatchActionViaTombol,
  prosesKonfirmasiCakupanViaTombol,
} = require("../gemini/chatHandler");
const { konfirmasiOpname } = require("./handleOpname");
const { konfirmasiPickingList } = require("./konfirmasiPickingList");
const { konfirmasiSyncStok, konfirmasiTambahKolom, batalkanTambahKolom, KONDISI } = require("../sheets/syncStokDuaArah");

async function handleKonfirmasiCallback({ callbackQueryId, callbackData, chatId, messageId, fromUserId }) {
  const [prefix, segmen, idPemilik] = callbackData.split(":");

  // Bungkus seluruh proses dalam try/catch: Telegram WAJIB dapat jawaban callback
  // (jawabCallbackQuery) apapun yang terjadi, kalau tidak tombol akan spinner selamanya.
  // Kalau proses aksi gagal, kirim error ke pengguna via showAlert + tetap tutup tombol.
  try {
    if (prefix === "pa") {
      const jawabanTeks = segmen === "ya" ? "ya" : "tidak";
      const berhasil = await prosesPendingActionViaTombol(idPemilik, chatId, jawabanTeks, fromUserId);
      await tutupCallback(callbackQueryId, chatId, messageId, berhasil);
      return;
    }

    if (prefix === "op") {
      const jawabanTeks = segmen === "ya" ? "ya" : "batal";
      await konfirmasiOpname(idPemilik, jawabanTeks, fromUserId);
      await tutupCallback(callbackQueryId, chatId, messageId, true);
      return;
    }

    if (prefix === "pb") {
      const jawabanTeks = segmen === "ya" ? "ya" : "tidak";
      const berhasil = await prosesPendingBatchActionViaTombol(idPemilik, chatId, jawabanTeks, fromUserId);
      await tutupCallback(callbackQueryId, chatId, messageId, berhasil);
      return;
    }

    if (prefix === "cp") {
      // segmen: "cari" (expand ke semua katalog) | "batal"
      const berhasil = await prosesKonfirmasiCakupanViaTombol(idPemilik, chatId, segmen);
      await tutupCallback(callbackQueryId, chatId, messageId, berhasil);
      return;
    }

    if (prefix === "pl") {
      const jawabanTeks = segmen === "ya" ? "ya" : "batal";
      const hasil = await konfirmasiPickingList(idPemilik, jawabanTeks, { sumber: "tombol", confirmedBy: fromUserId });
      // v3b B3: return kini objek { ok } (dulu boolean mentah) -> petakan ke boolean.
      await tutupCallback(callbackQueryId, chatId, messageId, Boolean(hasil?.ok));
      return;
    }

    if (prefix === "ss") {
      // segmen: KONDISI.SHEETS_KETINGGALAN | KONDISI.SHEETS_MANUAL | KONDISI.KONFLIK | "semua" | "batal"
      const jawabanTeks = segmen === "batal" ? "batal" : `ya ${segmen}`;
      await konfirmasiSyncStok(idPemilik, jawabanTeks, fromUserId);
      await tutupCallback(callbackQueryId, chatId, messageId, true);
      return;
    }

    if (prefix === "kolom") {
      // di sini idPemilik sebenarnya chatId (state kolom keyed per chat, bukan per user)
      if (segmen === "ya") {
        await konfirmasiTambahKolom(idPemilik);
      } else {
        await batalkanTambahKolom(idPemilik);
      }
      await tutupCallback(callbackQueryId, chatId, messageId, true);
      return;
    }

    await jawabCallbackQuery(callbackQueryId, { teks: "Aksi ini belum dikenal." });
  } catch (error) {
    console.error("Gagal proses konfirmasi callback:", error);
    await tutupCallback(callbackQueryId, chatId, messageId, false, "Terjadi kesalahan saat memproses. Silakan coba lagi.");
  }
}

async function tutupCallback(callbackQueryId, chatId, messageId, berhasil, teksError = null) {
  if (!berhasil) {
    await jawabCallbackQuery(callbackQueryId, {
      teks: teksError || "Sudah diproses sebelumnya atau kadaluarsa.",
      showAlert: true,
    });
    return;
  }
  await jawabCallbackQuery(callbackQueryId, { teks: "Diproses ✅" });
  // Hapus tombol dari pesan lama biar gak kepencet dobel (khususnya di grup, semua orang
  // boleh mencet) — kalau gagal (misal pesan kedaluwarsa/dihapus), diamkan saja, gak fatal.
  try {
    await hapusTombolPesan(chatId, messageId);
  } catch (err) {
    console.error("Gagal hapus tombol pesan lama:", err);
  }
}

module.exports = { handleKonfirmasiCallback };