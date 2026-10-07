// test/konfirmasiBotV3b.test.js
// B-W1 regresi bot v3b (PRD §6.5 T4a-T4i): signature objek/string dua bentuk, `kirimNotifikasi`,
// `cekGuard` (B2), return eksplisit (B3), `owner_user_id` additive (R-E).
// Tujuan utama: membuktikan BOT TIDAK BERUBAH PERILAKU pada default/jalur lama.
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

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-gemini-key";
const { installMockFirestore } = require("./helpers/mockFirestore");

// Stub kirimPesan SEBELUM modul pemakainya di-load. `kirimPesanDenganTombol` WAJIB ada karena
// handleOpname mengimpornya saat load.
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
    kirimPesanDenganTombol: async (chatId, teks) => {
      terkirim.push({ chatId, teks, tombol: true });
      return { ok: true };
    },
  },
};

// Stub lib/sheets/client supaya applyDraft tidak butuh kredensial Google Sheets.
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

const { konfirmasiOpname, handleOpname } = require("../lib/handlers/handleOpname");
const { konfirmasiPickingList } = require("../lib/handlers/konfirmasiPickingList");
const { konfirmasiSyncStok, KONDISI } = require("../lib/sheets/syncStokDuaArah");

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  terkirim.length = 0;
}

beforeEach(() => resetStore());

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedOpnameSesi(uid, draftId, chatId = 900) {
  await db.collection("sessions").doc(String(uid)).set({
    pendingOpname: { chatId, draftId, dibuatPada: new Date() },
  });
}

async function seedDraftOpname(draftId, items) {
  await db.collection("opname_drafts").doc(draftId).set({
    items,
    status: "pending_confirmation",
    owner_user_id: "111",
    created_at: new Date(),
  });
}

function itemWajar(kode, qtySistem, qtyFisik) {
  return {
    kategori: "selisih_wajar",
    kode_barang: kode,
    nama_accurate: `Nama ${kode}`,
    qty_sistem: qtySistem,
    qty_fisik: qtyFisik,
    selisih: qtyFisik - qtySistem,
  };
}

async function movementsDariKoleksi() {
  const snap = await db.collection("stock_movements").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------------
// OPNAME
// ---------------------------------------------------------------------------

test("T4a: konfirmasiOpname(uid,'ya',fromUserId) string lama -> confirmed_by PERSIS String(fromUserId) + kirimPesan dipanggil", async () => {
  await seedOpnameSesi("111", "draft-1");
  await seedDraftOpname("draft-1", [itemWajar("BRG-1", 10, 8)]);
  await db.collection("stock").doc("BRG-1").set({ stok_gudang_online: 10 });

  const fromUserId = 999;
  const hasil = await konfirmasiOpname("111", "ya", fromUserId);

  assert.equal(hasil.ok, true);
  const movements = await movementsDariKoleksi();
  assert.equal(movements.length, 1);
  // ASSERT NILAI PERSIS (bukan truthy) — R-A.
  assert.equal(movements[0].confirmed_by, String(fromUserId));
  assert.equal(movements[0].created_by, String(fromUserId));
  assert.equal(movements[0].requested_by, "111");
  assert.ok(terkirim.length > 0, "kirimPesan jalur lama tetap dipanggil");
  // draft diproses + pending dibersihkan
  assert.equal((await db.collection("opname_drafts").doc("draft-1").get()).data().status, "processed");
  assert.equal((await db.collection("sessions").doc("111").get()).data().pendingOpname, undefined);
});

test("T4b: konfirmasiOpname objek {kirimNotifikasi:false} -> mutasi jalan, kirimPesan NOL", async () => {
  await seedOpnameSesi("111", "draft-2");
  await seedDraftOpname("draft-2", [itemWajar("BRG-2", 5, 3)]);
  await db.collection("stock").doc("BRG-2").set({ stok_gudang_online: 5 });

  const hasil = await konfirmasiOpname("111", "ya", { confirmedBy: "888", kirimNotifikasi: false });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.diproses, 1);
  assert.equal(terkirim.length, 0, "kirimPesan TIDAK dipanggil saat kirimNotifikasi:false");
  const movements = await movementsDariKoleksi();
  assert.equal(movements.length, 1, "mutasi stok tetap terjadi");
  assert.equal(movements[0].confirmed_by, "888");
  const stok = await db.collection("stock").doc("BRG-2").get();
  assert.equal(stok.data().stok_gudang_online, 3, "stok tetap di-apply");
});

test("T4g: konfirmasiOpname 'batal' -> status draft dibatalkan + pendingOpname dihapus", async () => {
  await seedOpnameSesi("111", "draft-3");
  await seedDraftOpname("draft-3", [itemWajar("BRG-3", 5, 3)]);

  const hasil = await konfirmasiOpname("111", "batal", { kirimNotifikasi: false });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.dibatalkan, true);
  assert.equal((await db.collection("opname_drafts").doc("draft-3").get()).data().status, "dibatalkan");
  assert.equal((await db.collection("sessions").doc("111").get()).data().pendingOpname, undefined);
  assert.equal(terkirim.length, 0);
});

// ---------------------------------------------------------------------------
// SYNC (T4c/T4d)
// ---------------------------------------------------------------------------

async function seedSyncSesi(uid, draftIds, chatId = 900) {
  await db.collection("sessions").doc(String(uid)).set({ pendingSyncStok: { chatId, draftIds } });
}

async function seedDraftSync(id, kondisi, items = [{ kode_barang: "S1", nama_accurate: "Satu", nilai_firestore: 4, index_kolom: 3 }]) {
  await db.collection("sync_stok_drafts").doc(id).set({
    kondisi,
    items,
    index_kolom: 3,
    status: "pending_confirmation",
    owner_user_id: "111",
    created_at: new Date(),
  });
}

test("T4c: konfirmasiSyncStok string lama -> apply + confirmed_by PERSIS String(fromUserId) + pesan terkirim", async () => {
  await seedSyncSesi("111", ["sd-1"]);
  await seedDraftSync("sd-1", KONDISI.SHEETS_KETINGGALAN);
  await db.collection("stock").doc("S1").set({ stok_gudang_online: 4 });
  await db.collection("products").doc("S1").set({ nama_accurate: "Satu" });

  const hasil = await konfirmasiSyncStok("111", `ya ${KONDISI.SHEETS_KETINGGALAN}`, 777);

  assert.equal(hasil.ok, true);
  assert.equal(hasil.diproses, 1);
  const movements = await movementsDariKoleksi();
  assert.equal(movements.length, 1);
  assert.equal(movements[0].confirmed_by, String(777));
  assert.ok(terkirim.length > 0);
  assert.equal((await db.collection("sync_stok_drafts").doc("sd-1").get()).data().status, "processed");
});

test("T4d: konfirmasiSyncStok objek {kirimNotifikasi:false} -> mutasi jalan, kirimPesan NOL", async () => {
  await seedSyncSesi("111", ["sd-2"]);
  await seedDraftSync("sd-2", KONDISI.SHEETS_KETINGGALAN);
  await db.collection("stock").doc("S1").set({ stok_gudang_online: 4 });
  await db.collection("products").doc("S1").set({ nama_accurate: "Satu" });

  const hasil = await konfirmasiSyncStok("111", `ya ${KONDISI.SHEETS_KETINGGALAN}`, {
    confirmedBy: "888",
    kirimNotifikasi: false,
  });

  assert.equal(hasil.ok, true);
  assert.equal(terkirim.length, 0);
  const movements = await movementsDariKoleksi();
  assert.equal(movements.length, 1);
  assert.equal(movements[0].confirmed_by, "888");
});

// ---------------------------------------------------------------------------
// PICKING (T4e)
// ---------------------------------------------------------------------------

async function seedPickingSesi(uid, movementIds, chatId = 900) {
  await db.collection("sessions").doc(String(uid)).set({ pendingPickingList: { chatId, movementIds } });
}

async function seedMovement(id, { kode = "P1", action = "kurangi_stok", qty = 2, variasi = "-" } = {}) {
  await db.collection("stock_movements").doc(id).set({
    kode_barang: kode,
    nama_terbaca: "Produk",
    variasi,
    qty,
    action_type: action,
    status: "pending_confirmation",
    created_by: "222",
  });
}

test("T4e: konfirmasiPickingList {kirimNotifikasi:false} -> stok berubah, kirimPesan NOL (R-C sumber bukan teks)", async () => {
  await seedPickingSesi("111", ["mv-1"]);
  await seedMovement("mv-1", { kode: "P1", qty: 2 });
  await db.collection("stock").doc("P1").set({ stok_gudang_online: 10 });

  const hasil = await konfirmasiPickingList("111", "ya", {
    sumber: "dokumen",
    confirmedBy: "888",
    kirimNotifikasi: false,
  });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.diproses, 1);
  assert.equal(hasil.dilewati, 0);
  assert.equal(hasil.batch_id, "111");
  assert.equal(terkirim.length, 0, "nol pesan — R-C tidak kena");
  assert.equal((await db.collection("stock").doc("P1").get()).data().stok_gudang_online, 8);
  const mv = await db.collection("stock_movements").doc("mv-1").get();
  assert.equal(mv.data().status, "processed");
  assert.equal(mv.data().confirmed_by, "888");
});

test("T4e-var: picking sumber 'teks' + kirimNotifikasi:false jawaban tak dikenal -> pesan nol, return eksplisit", async () => {
  await seedPickingSesi("111", ["mv-2"]);
  await seedMovement("mv-2");

  const hasil = await konfirmasiPickingList("111", "apa ya", { sumber: "teks", kirimNotifikasi: false });

  assert.equal(hasil.ok, false);
  assert.equal(hasil.alasan, "jawaban_tak_dikenal");
  assert.equal(terkirim.length, 0, "pesan 'masih nunggu' TIDAK terkirim saat kirimNotifikasi:false");
  assert.equal((await db.collection("stock_movements").doc("mv-2").get()).data().status, "pending_confirmation");
});

// ---------------------------------------------------------------------------
// T4f: regresi callback `handleKonfirmasiCallback` prefix op/ss argumen ketiga = fromUserId
// ---------------------------------------------------------------------------

test("T4f: callback op/ss memanggil dengan argumen ketiga fromUserId (bentuk PERSIS lama)", async () => {
  // Spy: ganti modul handler dengan stub SEBELUM handleKonfirmasiCallback di-load.
  const panggilan = { op: [], ss: [], pl: [] };
  function stub(relPath, exports) {
    const full = require.resolve(relPath);
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
  }
  stub("../lib/handlers/handleOpname", {
    konfirmasiOpname: async (...args) => {
      panggilan.op.push(args);
      return { ok: true };
    },
  });
  stub("../lib/sheets/syncStokDuaArah", {
    konfirmasiSyncStok: async (...args) => {
      panggilan.ss.push(args);
      return { ok: true };
    },
    konfirmasiTambahKolom: async () => {},
    batalkanTambahKolom: async () => {},
    KONDISI: { SHEETS_KETINGGALAN: "sheets_ketinggalan" },
  });
  stub("../lib/handlers/konfirmasiPickingList", {
    konfirmasiPickingList: async (...args) => {
      panggilan.pl.push(args);
      return { ok: true };
    },
  });
  stub("../lib/gemini/chatHandler", {
    prosesPendingActionViaTombol: async () => true,
    prosesPendingBatchActionViaTombol: async () => true,
    prosesKonfirmasiCakupanViaTombol: async () => true,
  });
  stub("../lib/telegram/kirimPesan", {
    jawabCallbackQuery: async () => ({ ok: true }),
    hapusTombolPesan: async () => ({ ok: true }),
  });

  // Hapus cache handler callback supaya di-load ulang dengan stub di atas.
  delete require.cache[require.resolve("../lib/handlers/handleKonfirmasiCallback")];
  const { handleKonfirmasiCallback } = require("../lib/handlers/handleKonfirmasiCallback");

  await handleKonfirmasiCallback({
    callbackQueryId: "cb1",
    callbackData: "op:ya:PEMILIK",
    chatId: 1,
    messageId: 2,
    fromUserId: "54321",
  });
  await handleKonfirmasiCallback({
    callbackQueryId: "cb2",
    callbackData: "ss:semua:PEMILIK",
    chatId: 1,
    messageId: 2,
    fromUserId: "54321",
  });

  assert.equal(panggilan.op.length, 1);
  assert.deepEqual(panggilan.op[0], ["PEMILIK", "ya", "54321"], "op: argumen ketiga = fromUserId (string lama, N2)");
  assert.equal(panggilan.ss.length, 1);
  assert.deepEqual(panggilan.ss[0], ["PEMILIK", "ya semua", "54321"], "ss: argumen ketiga = fromUserId (string lama, N2)");
});

// ---------------------------------------------------------------------------
// T4h: B3 no-op eksplisit (pending kosong) — ketiga fungsi
// ---------------------------------------------------------------------------

test("T4h: pending kosong -> ketiga fungsi return {ok:false,alasan:'tidak_ada_pending'} TANPA mutasi & TANPA pesan", async () => {
  const a = await konfirmasiOpname("999", "ya");
  const b = await konfirmasiPickingList("999", "ya");
  const c = await konfirmasiSyncStok("999", "ya semua");

  for (const h of [a, b, c]) {
    assert.equal(h.ok, false);
    assert.equal(h.alasan, "tidak_ada_pending");
  }
  assert.equal(terkirim.length, 0);
  assert.equal((await movementsDariKoleksi()).length, 0);
});

// ---------------------------------------------------------------------------
// T4i: B2 guard bot (cekGuard:true) — guard aktif -> tolak tanpa apply & tanpa hapus pending
// ---------------------------------------------------------------------------

test("T4i: cekGuard:true + guard aktif -> {ok:false,'guard_aktif'} tanpa apply & pending TETAP", async () => {
  // opname
  await seedOpnameSesi("111", "draft-g");
  await seedDraftOpname("draft-g", [itemWajar("G1", 5, 3)]);
  await db.collection("draft_kirim_guard").doc("opname:draft-g").set({ at: Date.now() });

  const hasilOpname = await konfirmasiOpname("111", "ya", { cekGuard: true, kirimNotifikasi: false });
  assert.equal(hasilOpname.ok, false);
  assert.equal(hasilOpname.alasan, "guard_aktif");
  assert.equal((await movementsDariKoleksi()).length, 0, "opname TIDAK apply saat guard aktif");
  assert.ok((await db.collection("sessions").doc("111").get()).data().pendingOpname, "pendingOpname TIDAK dihapus");

  // picking
  await seedPickingSesi("111", ["mvg"]);
  await seedMovement("mvg", { kode: "G2" });
  await db.collection("draft_kirim_guard").doc("picking:111").set({ at: Date.now() });

  const hasilPicking = await konfirmasiPickingList("111", "ya", { cekGuard: true, kirimNotifikasi: false });
  assert.equal(hasilPicking.ok, false);
  assert.equal(hasilPicking.alasan, "guard_aktif");
  assert.ok((await db.collection("sessions").doc("111").get()).data().pendingPickingList, "pendingPickingList TETAP");

  // sync
  await seedSyncSesi("111", ["sd-g"]);
  await seedDraftSync("sd-g", KONDISI.SHEETS_KETINGGALAN);
  await db.collection("draft_kirim_guard").doc("sync:sd-g").set({ at: Date.now() });

  const hasilSync = await konfirmasiSyncStok("111", "ya semua", { cekGuard: true, kirimNotifikasi: false });
  assert.equal(hasilSync.ok, false);
  assert.equal(hasilSync.alasan, "guard_aktif");
  assert.equal((await db.collection("sync_stok_drafts").doc("sd-g").get()).data().status, "pending_confirmation");
  assert.equal(terkirim.length, 0);
});

test("T4i-var: guard kedaluwarsa (>10s) -> tidak memblokir (Lapis 1 tetap berlaku)", async () => {
  await seedOpnameSesi("111", "draft-exp");
  await seedDraftOpname("draft-exp", [itemWajar("G3", 5, 4)]);
  await db.collection("draft_kirim_guard").doc("opname:draft-exp").set({ at: Date.now() - 60_000 });

  const hasil = await konfirmasiOpname("111", "ya", { cekGuard: true, kirimNotifikasi: false });
  assert.equal(hasil.ok, true, "guard kedaluwarsa tidak memblokir");
});

// ---------------------------------------------------------------------------
// R-E: owner_user_id additive (draft baru punya; draft lama tetap terbaca)
// ---------------------------------------------------------------------------

test("R-E: draft baru punya owner_user_id non-empty; draft lama (tanpa field) tetap terbaca", async () => {
  // Minimal: exercise jalur `simpanDraftOpname` via handleOpname teks (satu baris valid).
  await db.collection("products").doc("OWN-1").set({
    kode_barang: "OWN-1",
    nama_accurate: "Produk",
    nama_accurate_normalized: "produk",
    is_online_product: true,
  });
  await db.collection("stock").doc("OWN-1").set({ stok_gudang_online: 5 });
  await handleOpname({ telegramUserId: "424242", chatId: 1, sumber: "chat", teksPesan: "Produk - 5" });

  const snap = await db.collection("opname_drafts").get();
  assert.equal(snap.docs.length, 1);
  assert.equal(snap.docs[0].data().owner_user_id, "424242", "draft baru menulis owner_user_id");

  // Draft lama tanpa field tetap dinormalisasi sebagai "tidak diketahui" oleh konsumen (README PRD §7.2).
  await db.collection("opname_drafts").doc("lama").set({ items: [], status: "pending_confirmation" });
  const lama = await db.collection("opname_drafts").doc("lama").get();
  assert.equal(lama.data().owner_user_id, undefined, "draft lama tanpa owner_user_id (fail-closed di route)");
});

// ---------------------------------------------------------------------------
// T4b-var R-B: status draft/stok berubah TANPA kirimPesan juga di jalur batal
// ---------------------------------------------------------------------------

test("R-B: batal sync dengan kirimNotifikasi:false -> draft dibatalkan, pending dihapus, pesan nol", async () => {
  await seedSyncSesi("111", ["sd-b"]);
  await seedDraftSync("sd-b", KONDISI.KONFLIK);

  const hasil = await konfirmasiSyncStok("111", "batal", { kirimNotifikasi: false });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.dibatalkan, true);
  assert.equal((await db.collection("sync_stok_drafts").doc("sd-b").get()).data().status, "dibatalkan");
  assert.equal((await db.collection("sessions").doc("111").get()).data().pendingSyncStok, undefined);
  assert.equal(terkirim.length, 0);
});
