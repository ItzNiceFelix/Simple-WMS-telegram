// test/helpers/stubTelegram.js
// Stub modul lib/telegram/kirimPesan lewat require cache SEBELUM modul yang memakainya
// di-load (pola reorderPoint.test.js). Mencegah test menyentuh Telegram API nyata.
function installStubTelegram() {
  const path = require.resolve("../../lib/telegram/kirimPesan");
  const terkirim = [];
  require.cache[path] = {
    id: path,
    filename: path,
    loaded: true,
    exports: {
      kirimPesan: async (chatId, teks) => {
        terkirim.push({ chatId, teks });
        return { ok: true };
      },
      kirimPesanPlain: async (chatId, teks) => {
        terkirim.push({ chatId, teks });
        return { ok: true };
      },
    },
  };
  return { terkirim };
}

module.exports = { installStubTelegram };
