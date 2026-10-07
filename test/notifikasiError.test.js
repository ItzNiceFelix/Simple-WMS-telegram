// test/notifikasiError.test.js
// Pastikan notifikasi kegagalan cron best-effort: mengirim ke owner dan TIDAK
// pernah melempar error ke caller walau pengiriman Telegram sendiri gagal.

const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-project";
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "demo@example.com";
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ||
  crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .replace(/\n/g, "\\n");

const { installMockFirestore } = require("./helpers/mockFirestore");

// Stub kirimPesan lewat require cache SEBELUM modul yang memakainya di-load.
const kirimPesanPath = require.resolve("../lib/telegram/kirimPesan");
const terkirim = [];
let kirimPesanStub = async (chatId, teks) => {
  terkirim.push({ chatId, teks });
  return { ok: true };
};
require.cache[kirimPesanPath] = {
  id: kirimPesanPath,
  filename: kirimPesanPath,
  loaded: true,
  exports: { kirimPesan: (...args) => kirimPesanStub(...args) },
};

const { db } = installMockFirestore();
const { kirimNotifErrorCron, potongPesanError, susunTeksNotif } = require("../lib/telegram/notifikasiError");
const { tambahAdmin } = require("../lib/models/admins");

test("kirim ke owner dan pesan memuat nama job & error", async () => {
  terkirim.length = 0;
  kirimPesanStub = async (chatId, teks) => {
    terkirim.push({ chatId, teks });
    return { ok: true };
  };
  await tambahAdmin("111", { name: "Bos", role: "owner" });

  await kirimNotifErrorCron("Sync Master Data", new Error("sheet tidak ditemukan"));

  assert.equal(terkirim.length, 1);
  assert.equal(terkirim[0].chatId, "111");
  assert.match(terkirim[0].teks, /Sync Master Data/);
  assert.match(terkirim[0].teks, /sheet tidak ditemukan/);
});

test("pengiriman yang throw tidak propagate ke caller", async () => {
  kirimPesanStub = async () => {
    throw new Error("Telegram down");
  };

  // Tidak boleh throw.
  await assert.doesNotReject(() => kirimNotifErrorCron("Reminder Harian", new Error("boom")));
});

test("potongPesanError memotong di ~500 char", () => {
  const panjang = potongPesanError(new Error("x".repeat(900)));
  assert.equal(panjang.length, 501); // 500 + ellipsis
  assert.ok(panjang.endsWith("…"));
  assert.equal(potongPesanError(new Error("pendek")).length, "pendek".length);
});

test("susunTeksNotif menyertakan arahan cek log Actions", () => {
  const teks = susunTeksNotif("Reminder Harian", new Error("gagal"));
  assert.match(teks, /GitHub Actions/);
  assert.match(teks, /Reminder Harian/);
});
