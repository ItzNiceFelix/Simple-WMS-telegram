// test/syncStokReplay.test.js
// R4: replay END-TO-END /sync_stok tanpa network — mock Sheets stateful + mock Firestore.
// mensimulasikan siklus penuh: mulaiSyncStok -> konfirmasiSyncStok("ya semua") -> assert
// nilai AKHIR benar-benar tertulis di mock Sheets (stateful), bukan spy no-op.
//
// Skenario 4 kondisi sekaligus dalam satu sheet:
//  (a) sheets_ketinggalan — Firestore berubah, sheet basi -> di-overwrite
//  (b) sheets_manual      — sheet diedit manual, Firestore tetap acuan -> di-overwrite
//  (c) konflik            — dua-duanya beda -> Firestore menang
//  (d) produk_baru        — baris belum ada -> dibuat di akhir, kolom A terisi, header utuh
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

// Stub telegram sebelum modul pemakainya di-load.
const terkirim = [];
const kirimPath = require.resolve("../lib/telegram/kirimPesan");
require.cache[kirimPath] = {
  id: kirimPath,
  filename: kirimPath,
  loaded: true,
  exports: {
    kirimPesan: async (chatId, teks) => {
      terkirim.push({ chatId, teks });
      return { ok: true };
    },
    kirimPesanDenganTombol: async (chatId, teks) => {
      terkirim.push({ chatId, teks, tombol: true });
      return { ok: true };
    },
  },
};

const { installMockSheets } = require("./helpers/mockSheets");

const NAMA = "DATABASE_ACCURATE";
const HEADER = ["No", "Kode Barang", "Nama Accurate", "HPP/unit", "HPP BARU", "Stok Online", "is_online"];
const INDEX_STOK = 5; // "Stok Online"

// Seed awal: header + 3 baris nyata-style. Kolom F (Stok Online) mulai basi/diedit.
function seedAwal() {
  return {
    [NAMA]: [
      [...HEADER],
      ["1", "100331", "Akun Produk 100331", "15000", "", "4", "TRUE"],   // (a) sheet ketinggalan: FS 9
      ["2", "SDA1", "Sabun Daun A1", "8000", "", "12", "TRUE"],          // (b) sheets manual: FS 7
      ["3", "100500", "Bonbon 100500", "12000", "", "3", "TRUE"],        // (c) konflik: FS 5 vs sheet 3
    ],
  };
}

// Pasang stub sheets di require.cache SEBELUM require modul sync.
const mockSheets = installMockSheets(seedAwal());
const sheetsPath = require.resolve("../lib/sheets/client");
require.cache[sheetsPath] = {
  id: sheetsPath,
  filename: sheetsPath,
  loaded: true,
  exports: {
    bacaRange: mockSheets.bacaRange,
    tulisRange: mockSheets.tulisRange,
    ambilHeader: mockSheets.ambilHeader,
    tambahKolomHeader: mockSheets.tambahKolomHeader,
    tambahBarisBaru: mockSheets.tambahBarisBaru,
    angkaKeHurufKolom: mockSheets.angkaKeHurufKolom,
  },
};

const { installMockFirestore } = require("./helpers/mockFirestore");
const mockFs = installMockFirestore();
const db = mockFs.db;
const { mulaiSyncStok, konfirmasiSyncStok, KONDISI } = require("../lib/sheets/syncStokDuaArah");
const { invalidasiCacheProduk } = require("../lib/models/produk");

function resetSheets() {
  mockSheets.sheets.clear();
  const seed = seedAwal();
  for (const [k, v] of Object.entries(seed)) mockSheets.sheets.set(k, v.map((r) => [...r]));
}

beforeEach(() => {
  for (const key of mockFs.collections.keys()) mockFs.collections.get(key).clear();
  terkirim.length = 0;
  resetSheets();
  invalidasiCacheProduk();
});

async function seedProduk(kode, nama, isOnline = true) {
  await db.collection("products").doc(kode).set({ kode_barang: kode, nama_accurate: nama, is_online_product: isOnline });
}

// Cari nilai kolom Stok Online utk kode di state mock sheets saat ini.
function bacaStokSheet(kode) {
  const rows = mockSheets.sheets.get(NAMA) || [];
  const row = rows.find((r) => String(r[1] || "").trim() === kode);
  return row ? Number(row[INDEX_STOK]) || 0 : null;
}

test("replay 4 kondisi: sheets_ketinggalan + sheets_manual + konflik + produk_baru ditulis ke Sheets", async () => {
  const uid = "111";

  // (a) 100331: FS berubah (9), sheet 4 -> ketinggalan.
  await seedProduk("100331", "Akun Produk 100331");
  await db.collection("stock").doc("100331").set({ qty_per_gudang: { ONLINE: 9 }, stok_gudang_online: 9, last_synced_value: 4 });
  // (b) SDA1: sheet 12, FS 7, last_synced 7 -> sheet manual (di-overwrite jadi 7).
  await seedProduk("SDA1", "Sabun Daun A1");
  await db.collection("stock").doc("SDA1").set({ qty_per_gudang: { ONLINE: 7 }, stok_gudang_online: 7, last_synced_value: 7 });
  // (c) 100500: FS 5, sheet 3, last_synced 4 -> dua-duanya berubah dari basis & beda -> konflik (FS menang jadi 5).
  await seedProduk("100500", "Bonbon 100500");
  await db.collection("stock").doc("100500").set({ qty_per_gudang: { ONLINE: 5 }, stok_gudang_online: 5, last_synced_value: 4 });
  // (d) 200999: ada di FS, tak ada baris di sheet -> produk_baru.
  await seedProduk("200999", "Produk Baru 200999");
  await db.collection("stock").doc("200999").set({ qty_per_gudang: { ONLINE: 15 }, stok_gudang_online: 15, last_synced_value: null });

  // --- Siklus: mulai (bikin draft) -> konfirmasi semua ---
  await mulaiSyncStok(uid, 900);
  const draftCount = (await db.collection("sync_stok_drafts").get()).docs.length;
  assert.equal(draftCount, 4, "4 kelompok kondisi -> 4 draft");

  const hasil = await konfirmasiSyncStok(uid, "ya semua", { kirimNotifikasi: false });
  assert.equal(hasil.ok, true);
  assert.equal(hasil.diproses, 4, "4 item diproses (3 update + 1 insert)");

  // --- Assert nilai AKHIR di mock Sheets STATE ---
  assert.equal(bacaStokSheet("100331"), 9, "(a) sheets_ketinggalan -> FS menang");
  assert.equal(bacaStokSheet("SDA1"), 7, "(b) sheets_manual -> FS tetap acuan");
  assert.equal(bacaStokSheet("100500"), 5, "(c) konflik -> FS menang");

  const rowsAkhir = mockSheets.sheets.get(NAMA);
  const barisBaru = rowsAkhir.find((r) => String(r[1] || "").trim() === "200999");
  assert.ok(barisBaru, "(d) baris produk baru dibuat");
  assert.equal(Number(barisBaru[INDEX_STOK]), 15, "produk baru: stok = nilai firestore");
  assert.equal(String(barisBaru[0] ?? "").trim(), "4", "produk baru: kolom A No = jumlah baris berisi (3)+1");
  assert.equal(barisBaru[2], "Produk Baru 200999");

  // Header tak berubah.
  assert.deepEqual((mockSheets.sheets.get(NAMA) || [])[0], HEADER, "header tidak berubah");

  // stock_movements bertambah 4, id deterministik `sync_<draftId>_<kode>`.
  const movements = (await db.collection("stock_movements").get()).docs.map((d) => d.id);
  assert.equal(movements.length, 4, "4 movement tercatat");
  assert.ok(movements.every((id) => id.startsWith("sync_")), "semua pakai id deterministik");

  // Session pendingSyncStok dibersihkan setelah semua draft selesai.
  const sesi = (await db.collection("sessions").doc(uid).get()).data();
  assert.equal(sesi.pendingSyncStok, undefined, "pending dibersihkan setelah semua selesai");
});

test("replay produk_baru: beberapa item -> kolom A naik benar per baris", async () => {
  const uid = "222";
  await seedProduk("300001", "Baru Tiga Satu");
  await db.collection("stock").doc("300001").set({ qty_per_gudang: { ONLINE: 1 }, stok_gudang_online: 1, last_synced_value: null });
  await seedProduk("300002", "Baru Tiga Dua");
  await db.collection("stock").doc("300002").set({ qty_per_gudang: { ONLINE: 2 }, stok_gudang_online: 2, last_synced_value: null });
  await seedProduk("300003", "Baru Tiga Tiga");
  await db.collection("stock").doc("300003").set({ qty_per_gudang: { ONLINE: 3 }, stok_gudang_online: 3, last_synced_value: null });

  await mulaiSyncStok(uid, 900);
  const hasil = await konfirmasiSyncStok(uid, "ya semua", { kirimNotifikasi: false });
  assert.equal(hasil.diproses, 3);

  const rows = mockSheets.sheets.get(NAMA);
  const noA = ["300001", "300002", "300003"].map((k) => {
    const r = rows.find((row) => String(row[1] || "").trim() === k);
    return String(r[0] ?? "").trim();
  });
  // Baris 1-3 terisi (No 1..3), jadi insert pertama No=4, dst.
  assert.deepEqual(noA, ["4", "5", "6"], "kolom A naik berurutan tiap insert");
});

test("replay: retry 'ya semua' -> tidak dobel movement & tidak dobel baris produk baru", async () => {
  const uid = "333";
  await seedProduk("100331", "Akun Produk 100331");
  await db.collection("stock").doc("100331").set({ qty_per_gudang: { ONLINE: 9 }, stok_gudang_online: 9, last_synced_value: 4 });
  await seedProduk("400001", "Baru Empat Satu");
  await db.collection("stock").doc("400001").set({ qty_per_gudang: { ONLINE: 8 }, stok_gudang_online: 8, last_synced_value: null });

  await mulaiSyncStok(uid, 900);
  await konfirmasiSyncStok(uid, "ya semua", { kirimNotifikasi: false });
  const mvPertama = (await db.collection("stock_movements").get()).docs.length;
  const barisSetelahPertama = (mockSheets.sheets.get(NAMA) || []).length;

  // Paksa retry: draft lama masih `processed` tapi session direset (simulasi redelivery).
  // Buat ulang pending ke draft yang sama (id tetap) supaya apply diulang.
  const drafts = (await db.collection("sync_stok_drafts").get()).docs.map((d) => ({ id: d.id }));
  await db.collection("sessions").doc(uid).set({ pendingSyncStok: { chatId: 900, draftIds: drafts.map((d) => d.id) } });
  // Kembalikan status draft ke pending supaya filter tidak skip, TAPI pushed_items tetap ada.
  for (const d of drafts) await db.collection("sync_stok_drafts").doc(d.id).update({ status: "pending_confirmation" });

  await konfirmasiSyncStok(uid, "ya semua", { kirimNotifikasi: false });

  const mvKedua = (await db.collection("stock_movements").get()).docs.length;
  assert.equal(mvKedua, mvPertama, "retry tidak menambah movement (id deterministik overwrite)");

  const barisSetelahRetry = (mockSheets.sheets.get(NAMA) || []).length;
  assert.equal(barisSetelahRetry, barisSetelahPertama, "retry tidak menambah baris produk baru (pushed_items skip)");
});
