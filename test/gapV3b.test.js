// test/gapV3b.test.js
// Tester independen (Fase B v3b) — menutup GAP yang tidak diuji suite existing:
//   G1. Callback prefix `pl` dengan hasil bot `{ok:false}` -> tutupCallback alert
//       "Sudah diproses sebelumnya atau kadaluarsa." (R12, PRD §6.6). T4f hanya menguji `op`/`ss`.
//   G2. `cekGuard:true` untuk sync PER-KONDISI (bukan "semua"): guard draft kelompok itu memblokir,
//       guard draft kelompok LAIN tidak (fungsi `kunciDraftUntukKondisi`).
//   G3. `cekGuard:true` untuk sync "semua"/"batal": guard pada SALAH SATU draft sesi memblokir.
//   G4. Picking `batal` dengan `{kirimNotifikasi:false}` -> dibatalkan, pending dihapus, nol pesan.
// Semua memakai jalur produksi nyata (modul bot + handleKonfirmasiCallback), bukan reimplementasi.
const crypto = require("crypto");
const { test, beforeEach } = require("node:test");
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

const kirimPath = require.resolve("../lib/telegram/kirimPesan");
const terkirim = [];
require.cache[kirimPath] = {
  id: kirimPath,
  filename: kirimPath,
  loaded: true,
  exports: {
    kirimPesan: async (chatId, teks, opsi) => {
      terkirim.push({ chatId, teks, opsi });
      return { ok: true };
    },
    kirimPesanDenganTombol: async () => ({ ok: true }),
  },
};
const sheetsPath = require.resolve("../lib/sheets/client");
require.cache[sheetsPath] = {
  id: sheetsPath,
  filename: sheetsPath,
  loaded: true,
  exports: {
    bacaRange: async () => [["", "S1"]],
    tulisRange: async () => ({ ok: true }),
    ambilHeader: async () => [],
    tambahKolomHeader: async () => ({ ok: true }),
    tambahBarisBaru: async () => ({ ok: true }),
    angkaKeHurufKolom: (i) => String.fromCharCode(65 + i),
  },
};

const mock = installMockFirestore();
const db = mock.db;
const { konfirmasiPickingList } = require("../lib/handlers/konfirmasiPickingList");
const { konfirmasiSyncStok, KONDISI } = require("../lib/sheets/syncStokDuaArah");

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  terkirim.length = 0;
}
beforeEach(() => resetStore());

async function seedSyncSesi(uid, draftIds) {
  await db.collection("sessions").doc(String(uid)).set({ pendingSyncStok: { chatId: 900, draftIds } });
}
async function seedDraftSync(id, kondisi) {
  await db.collection("sync_stok_drafts").doc(id).set({
    kondisi,
    items: [{ kode_barang: "S1", nama_accurate: "Satu", nilai_firestore: 4, index_kolom: 3 }],
    index_kolom: 3,
    status: "pending_confirmation",
    owner_user_id: "111",
  });
}

// ---------------------------------------------------------------------------
// G1: callback `pl` -> hasil.ok:false memicu alert "Sudah diproses sebelumnya/kadaluarsa"
// ---------------------------------------------------------------------------
test("G1: callback pl hasil {ok:false} -> tutupCallback alert (R12)", async () => {
  const panggilan = [];
  function stub(relPath, exports) {
    const full = require.resolve(relPath);
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
  }
  const alerts = [];
  stub("../lib/handlers/handleOpname", { konfirmasiOpname: async () => ({ ok: true }) });
  stub("../lib/sheets/syncStokDuaArah", {
    konfirmasiSyncStok: async () => ({ ok: true }),
    konfirmasiTambahKolom: async () => {},
    batalkanTambahKolom: async () => {},
    KONDISI: { SHEETS_KETINGGALAN: "sheets_ketinggalan" },
  });
  stub("../lib/handlers/konfirmasiPickingList", {
    konfirmasiPickingList: async (...args) => {
      panggilan.push(args);
      return { ok: false, alasan: "tidak_ada_pending" };
    },
  });
  stub("../lib/gemini/chatHandler", {
    prosesPendingActionViaTombol: async () => true,
    prosesPendingBatchActionViaTombol: async () => true,
    prosesKonfirmasiCakupanViaTombol: async () => true,
  });
  stub("../lib/telegram/kirimPesan", {
    jawabCallbackQuery: async (id, opsi) => {
      alerts.push(opsi);
      return { ok: true };
    },
    hapusTombolPesan: async () => ({ ok: true }),
  });
  delete require.cache[require.resolve("../lib/handlers/handleKonfirmasiCallback")];
  const { handleKonfirmasiCallback } = require("../lib/handlers/handleKonfirmasiCallback");

  await handleKonfirmasiCallback({
    callbackQueryId: "cb-pl",
    callbackData: "pl:ya:PEMILIK",
    chatId: 1,
    messageId: 2,
    fromUserId: "54321",
  });

  assert.equal(panggilan.length, 1, "konfirmasiPickingList dipanggil");
  assert.deepEqual(panggilan[0], ["PEMILIK", "ya", { sumber: "tombol", confirmedBy: "54321" }]);
  assert.equal(alerts.length, 1, "tutupCallback memanggil jawabCallbackQuery satu kali");
  assert.equal(alerts[0].showAlert, true, "ok:false -> alert, bukan 'Diproses'");
  assert.equal(alerts[0].teks, "Sudah diproses sebelumnya atau kadaluarsa.");
});

// ---------------------------------------------------------------------------
// G2: sync cekGuard PER-KONDISI
// ---------------------------------------------------------------------------
test("G2: sync cekGuard per-kondisi -> guard draft kelompok itu memblokir", async () => {
  await seedSyncSesi("111", ["s1", "s2"]);
  await seedDraftSync("s1", KONDISI.SHEETS_KETINGGALAN);
  await seedDraftSync("s2", KONDISI.KONFLIK);
  await db.collection("draft_kirim_guard").doc("sync:s1").set({ at: Date.now() });

  const hasil = await konfirmasiSyncStok("111", `ya ${KONDISI.SHEETS_KETINGGALAN}`, {
    cekGuard: true,
    kirimNotifikasi: false,
  });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.alasan, "guard_aktif");
  assert.equal((await db.collection("sync_stok_drafts").doc("s1").get()).data().status, "pending_confirmation");
});

test("G2b: sync cekGuard per-kondisi -> guard kelompok LAIN tidak memblokir", async () => {
  await seedSyncSesi("111", ["s1", "s2"]);
  await seedDraftSync("s1", KONDISI.SHEETS_KETINGGALAN);
  await seedDraftSync("s2", KONDISI.KONFLIK);
  await db.collection("stock").doc("S1").set({ stok_gudang_online: 4 });
  await db.collection("products").doc("S1").set({ nama_accurate: "Satu" });
  // guard aktif HANYA untuk kelompok lain (s2/konflik), bukan s1
  await db.collection("draft_kirim_guard").doc("sync:s2").set({ at: Date.now() });

  const hasil = await konfirmasiSyncStok("111", `ya ${KONDISI.SHEETS_KETINGGALAN}`, {
    cekGuard: true,
    kirimNotifikasi: false,
  });
  assert.equal(hasil.ok, true, "guard kelompok lain TIDAK memblokir");
  assert.equal(hasil.sisa, 1);
});

// ---------------------------------------------------------------------------
// G3: sync cekGuard "semua" / batal -> guard pada salah satu draft memblokir
// ---------------------------------------------------------------------------
test("G3: sync cekGuard 'ya semua' -> guard pada salah satu draft memblokir", async () => {
  await seedSyncSesi("111", ["s1", "s2"]);
  await seedDraftSync("s1", KONDISI.SHEETS_KETINGGALAN);
  await seedDraftSync("s2", KONDISI.KONFLIK);
  await db.collection("draft_kirim_guard").doc("sync:s2").set({ at: Date.now() });

  const hasil = await konfirmasiSyncStok("111", "ya semua", { cekGuard: true, kirimNotifikasi: false });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.alasan, "guard_aktif");
});

test("G3b: sync cekGuard 'batal' -> guard pada salah satu draft memblokir", async () => {
  await seedSyncSesi("111", ["s1", "s2"]);
  await seedDraftSync("s1", KONDISI.SHEETS_KETINGGALAN);
  await seedDraftSync("s2", KONDISI.KONFLIK);
  await db.collection("draft_kirim_guard").doc("sync:s1").set({ at: Date.now() });

  const hasil = await konfirmasiSyncStok("111", "batal", { cekGuard: true, kirimNotifikasi: false });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.alasan, "guard_aktif");
  assert.ok((await db.collection("sessions").doc("111").get()).data().pendingSyncStok, "batal TIDAK dieksekusi");
});

// ---------------------------------------------------------------------------
// G4: picking batal dari dashboard (kirimNotifikasi:false)
// ---------------------------------------------------------------------------
async function seedPickingSesi(uid, movementIds) {
  await db.collection("sessions").doc(String(uid)).set({ pendingPickingList: { chatId: 900, movementIds } });
}
test("G4: picking batal {kirimNotifikasi:false} -> dibatalkan, pending hapus, nol pesan", async () => {
  await seedPickingSesi("111", ["m1"]);
  await db.collection("stock_movements").doc("m1").set({
    kode_barang: "P1", nama_terbaca: "Produk", variasi: "-", qty: 2,
    action_type: "kurangi_stok", status: "pending_confirmation", created_by: "111",
  });
  await db.collection("stock").doc("P1").set({ stok_gudang_online: 10 });

  const hasil = await konfirmasiPickingList("111", "batal", {
    sumber: "dokumen",
    confirmedBy: "888",
    kirimNotifikasi: false,
  });
  assert.equal(hasil.ok, true);
  assert.equal(hasil.dibatalkan, true);
  assert.equal(terkirim.length, 0);
  assert.equal((await db.collection("stock").doc("P1").get()).data().stok_gudang_online, 10, "stok TIDAK berubah");
  assert.equal((await db.collection("sessions").doc("111").get()).data().pendingPickingList, undefined);
});
