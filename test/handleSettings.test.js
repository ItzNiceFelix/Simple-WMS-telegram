// test/handleSettings.test.js
// Uji handler Telegram settings AI (lib/handlers/handleSettings.js) untuk 5 provider.
// Semua dependency (admins, aiSettings, telegram) di-stub lewat require.cache SEBELUM
// modul di-load, supaya test tidak menyentuh Firestore/Telegram nyata.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const stub = (relPath, exports) => {
  const p = require.resolve(relPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
  return exports;
};

let tersimpan = [];
const terkirim = [];
const diedit = [];
const jawaban = [];

stub("../lib/models/admins", {
  isSuperAdmin: async () => true,
});
stub("../lib/models/aiSettings", {
  ambilPengaturanAI: async () => ({ textProvider: "groq" }),
  simpanProviderAI: async (provider, oleh) => {
    tersimpan.push({ provider, oleh });
    return { pengaturan: { textProvider: provider, updatedAt: null, updatedBy: oleh } };
  },
});
stub("../lib/telegram/kirimPesan", {
  kirimPesan: async () => ({ ok: true }),
  kirimPesanDenganTombol: async (chatId, teks, tombol) => {
    terkirim.push({ chatId, teks, tombol });
    return { ok: true };
  },
  jawabCallbackQuery: async (id, opsi) => {
    jawaban.push({ id, opsi });
    return { ok: true };
  },
  editPesan: async (chatId, messageId, teks, opsi) => {
    diedit.push({ chatId, messageId, teks, opsi });
    return { ok: true };
  },
});

const { handleSettings, handleSettingsCallback } = require("../lib/handlers/handleSettings");

beforeEach(() => {
  tersimpan = [];
  terkirim.length = 0;
  diedit.length = 0;
  jawaban.length = 0;
});

test("handleSettings mengirim 5 tombol provider dalam 2 baris", async () => {
  await handleSettings({ telegramUserId: "1", chatId: 10 });

  assert.equal(terkirim.length, 1);
  const { teks, tombol } = terkirim[0];
  const datar = tombol.flat();
  assert.equal(datar.length, 5, "harus 5 tombol provider");
  assert.ok(tombol.length >= 2, "tombol dipecah >1 baris");
  assert.deepEqual(
    datar.map((b) => b.callback_data),
    [
      "settings_ai:gemini",
      "settings_ai:groq",
      "settings_ai:kenari",
      "settings_ai:openai",
      "settings_ai:openrouter",
    ]
  );
  // Label ter-render di tombol (teks utama hanya memuat provider aktif).
  const labelTombol = datar.map((b) => b.text.replace("✅ ", ""));
  assert.deepEqual(labelTombol, ["Gemini", "Groq", "Kenari", "OpenAI", "OpenRouter"]);
  assert.ok(teks.includes("Groq"), "teks memuat provider aktif");
});

test("tombol menandai provider aktif dengan ✅", async () => {
  await handleSettings({ telegramUserId: "1", chatId: 10 });
  const datar = terkirim[0].tombol.flat();
  const aktif = datar.filter((b) => b.text.startsWith("✅"));
  assert.equal(aktif.length, 1);
  assert.equal(aktif[0].callback_data, "settings_ai:groq");
});

test("callback settings_ai:kenari memanggil simpanProviderAI('kenari', ...)", async () => {
  await handleSettingsCallback({
    callbackQueryId: "cb1",
    callbackData: "settings_ai:kenari",
    chatId: 10,
    messageId: 55,
    fromUserId: "1",
  });

  assert.equal(tersimpan.length, 1);
  assert.equal(tersimpan[0].provider, "kenari");
  assert.equal(tersimpan[0].oleh, "1");
  // Pesan lama diedit dan menampilkan provider baru + label "Kenari".
  assert.equal(diedit.length, 1);
  assert.ok(diedit[0].teks.includes("Kenari"));
  assert.equal(diedit[0].opsi.replyMarkup.inline_keyboard.flat().length, 5);
  // Jawaban callback memakai label, bukan kode mentah.
  assert.equal(jawaban.length, 1);
  assert.ok(jawaban[0].opsi.teks.includes("Kenari"));
});
