// test/paritasA2Data.test.js
// A2 (v3b Fase B) — MENGUNCI paritas data/UI-gerbang yang TIDAK bisa diuji e2e:
//
//  1. Rumus ringkasan batch "N siap / M dilewati" = movement ber-`kode_barang` truthy (N) vs
//     sisanya (M). Rumus ini hidup di `mock.ts`/`real.ts` (TS, TIDAK bisa di-require dari test
//     CJS) DAN di jalur CJS nyata `lib/handlers/konfirmasiPickingList.js:101-102`. Karena itu
//     kita kunci LEWAT jalur CJS produksi itu: jumlah `diproses` (N) dan `dilewati` (M) yang
//     dikembalikan handler HARUS konsisten dengan aturan truthy `kode_barang`, untuk data batch
//     CAMPURAN (sebagian ber-kode, sebagian kosong). Ini bukan duplikasi mock — ini kontrak
//     bersama yang dipakai mock.ts/real.ts.
//
//  2. REGRESI E-3 "sebagian": dulu di `mock.ts`/`real.ts` `sebagian` dihitung dari daftar yang
//     sudah difilter `status === "pending_confirmation"`, sehingga SELALU false (batch setengah
//     jadi lolos ke UI). Sekarang harus dari SELURUH movement pemilik itu (paritas
//     `ambilBatchPicking` `aksiDraft.js:43-50`). Test di bawah membuktikan lewat kode produksi
//     NYATA: batch dengan satu movement `processed` + sisanya `pending` WAJIB terdeteksi
//     "sebagian" (409). Kalau `ambilBatchPicking` kembali memfilter pending-only, test GAGAL.
//
// Semua memakai jalur produksi (modul bot nyata + `siapkanKonfirmasiDraft`), bukan reimplementasi.
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

// Stub Sheets + Telegram agar tidak menyentuh network (pola draftKonfirmasiV3b.test.js).
function stubModule(relPath, exports) {
  const full = require.resolve(relPath);
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
}
const terkirim = [];
stubModule("../lib/telegram/kirimPesan", {
  kirimPesan: async (chatId, teks) => {
    terkirim.push({ chatId, teks });
    return { ok: true };
  },
  kirimPesanDenganTombol: async () => ({ ok: true }),
});
stubModule("../lib/sheets/client", {
  bacaRange: async () => [["", "S1"]],
  tulisRange: async () => ({ ok: true }),
  ambilHeader: async () => [],
  tambahKolomHeader: async () => ({ ok: true }),
  tambahBarisBaru: async () => ({ ok: true }),
  angkaKeHurufKolom: (i) => String.fromCharCode(65 + i),
});

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const { konfirmasiPickingList } = require("../lib/handlers/konfirmasiPickingList");
const { siapkanKonfirmasiDraft } = require("../lib/dashboard/aksiDraft");

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  terkirim.length = 0;
}
beforeEach(() => resetStore());

async function seedSesi(uid, movementIds) {
  await db.collection("sessions").doc(String(uid)).set({ pendingPickingList: { chatId: 900, movementIds } });
}
async function seedMovement(id, { kode = "P1", status = "pending_confirmation", owner = "111" } = {}) {
  await db.collection("stock_movements").doc(id).set({
    kode_barang: kode,
    nama_terbaca: "Produk",
    variasi: "-",
    qty: 2,
    action_type: "kurangi_stok",
    status,
    created_by: owner,
  });
}

// ---------------------------------------------------------------------------
// 1. Rumus "N siap / M dilewati" — truthy `kode_barang`, data CAMPURAN.
// ---------------------------------------------------------------------------

test("ringkasan batch: N siap = movement ber-kode_barang, M dilewati = sisanya (batch campuran)", async () => {
  // Data CAMPURAN sengaja: 2 ber-kode + 2 tanpa kode. Kalau aturan `kode_barang` truthy
  // digeser (mis. menghitung semua movement "siap", atau memakai field lain), angka ini berubah.
  await seedSesi("111", ["s1", "s2", "s3", "s4"]);
  await seedMovement("s1", { kode: "P1" });
  await seedMovement("s2", { kode: "P2" });
  await seedMovement("s3", { kode: "" }); // produk tak ketemu -> DILEWATI
  await seedMovement("s4", { kode: "" }); // produk tak ketemu -> DILEWATI
  await db.collection("stock").doc("P1").set({ stok_gudang_online: 10 });
  await db.collection("stock").doc("P2").set({ stok_gudang_online: 10 });

  const hasil = await konfirmasiPickingList("111", "ya", {
    sumber: "dokumen",
    confirmedBy: "777",
    kirimNotifikasi: false,
  });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.diproses, 2, "N = movement ber-kode_barang truthy");
  assert.equal(hasil.dilewati, 2, "M = movement tanpa kode_barang");
  // Penanda "dilewati" TIDAK boleh ikut diproses ke stok (fail-safe produk ragu).
  assert.equal((await db.collection("stock_movements").doc("s3").get()).data().status, "pending_confirmation");
  assert.equal((await db.collection("stock_movements").doc("s4").get()).data().status, "pending_confirmation");
  assert.equal((await db.collection("stock_movements").doc("s1").get()).data().status, "processed");
});

test("ringkasan batch: semua tanpa kode_barang -> N=0, M=len (tidak ada satu pun diproses)", async () => {
  await seedSesi("111", ["t1", "t2"]);
  await seedMovement("t1", { kode: "" });
  await seedMovement("t2", { kode: "" });

  const hasil = await konfirmasiPickingList("111", "ya", {
    sumber: "dokumen",
    confirmedBy: "777",
    kirimNotifikasi: false,
  });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.diproses, 0);
  assert.equal(hasil.dilewati, 2);
});

test("ringkasan batch: `kode_barang` falsy (kosong/undefined/null/0) DILEWATI; truthy (P1) diproses", async () => {
  // Kontrak mock.ts/real.ts memakai truthiness `m.kode_barang` (bukan `!= null`). Karena itu
  // `""`, `undefined`, `null`, dan `0` jatuh ke "dilewati"; `"   "` (spasi) TRUTHY -> diproses.
  // Kalau produksi diubah memakai `!= null`, `undefined`/`null` ikut "diproses" -> test GAGAL.
  await seedSesi("111", ["f-empty", "f-undef", "f-null", "f-zero", "f-kode"]);
  await seedMovement("f-empty", { kode: "" });
  await db.collection("stock_movements").doc("f-undef").set({
    nama_terbaca: "Produk", variasi: "-", qty: 2, action_type: "kurangi_stok",
    status: "pending_confirmation", created_by: "111",
  }); // tanpa field kode_barang sama sekali
  await seedMovement("f-null", { kode: null });
  await seedMovement("f-zero", { kode: 0 });
  await seedMovement("f-kode", { kode: "P1" });
  await db.collection("stock").doc("P1").set({ stok_gudang_online: 5 });

  const hasil = await konfirmasiPickingList("111", "ya", {
    sumber: "dokumen",
    confirmedBy: "777",
    kirimNotifikasi: false,
  });

  assert.equal(hasil.diproses, 1, "hanya `P1` truthy yang diproses");
  assert.equal(hasil.dilewati, 4, "kosong/undefined/null/0 semuanya dilewati");
  assert.equal((await db.collection("stock").doc("P1").get()).data().stok_gudang_online, 3);
});

// ---------------------------------------------------------------------------
// 2. REGRESI E-3: `sebagian` HARUS dari SELURUH movement pemilik, bukan pending saja.
// ---------------------------------------------------------------------------

test("E-3 (kunci regresi): batch campuran processed+pending -> 409 'sebagian', bukan 'siap'", async () => {
  // Ini yang mengikat regresi: dulu (bug) `sebagian` dihitung dari daftar pending saja.
  // Dengan data ini, kalau `ambilBatchPicking` memfilter `status === "pending_confirmation"`,
  // movement `processed` tak terlihat -> status "siap" -> `r.ok===true` -> test GAGAL.
  // Data: 1 processed + 2 pending (owner sama). Batch BUKAN siap.
  await seedMovement("e-a", { kode: "P1", status: "processed" });
  await seedMovement("e-b", { kode: "P1", status: "pending_confirmation" });
  await seedMovement("e-c", { kode: "P2", status: "pending_confirmation" });
  await db.collection("stock").doc("P1").set({ stok_gudang_online: 10 });

  const r = await siapkanKonfirmasiDraft(db, { jenis: "picking", batchId: "111" });

  assert.equal(r.ok, false, "batch setengah jadi TIDAK boleh lanjut (fail-closed)");
  assert.equal(r.status, 409);
  assert.equal(r.error, "Batch picking ini diproses sebagian. Selesaikan lewat Telegram.");
  assert.equal((await db.collection("stock").doc("P1").get()).data().stok_gudang_online, 10, "stok TIDAK disentuh");
});

test("E-3 (kunci regresi): movement processed milik owner LAIN tidak mengotori status batch ini", async () => {
  // Batch 222 murni pending; owner 111 punya movement processed. Kalau `sebagian` salah
  // dihitung lintas-pemilik (mis. dari seluruh koleksi, bukan per-owner), batch 222 akan
  // salah jadi "sebagian". Test ini mengunci bahwa pemilik dipisah.
  await seedMovement("x-111", { kode: "P1", status: "processed", owner: "111" });
  await seedMovement("x-222a", { kode: "P1", status: "pending_confirmation", owner: "222" });
  await seedMovement("x-222b", { kode: "P2", status: "pending_confirmation", owner: "222" });

  const r = await siapkanKonfirmasiDraft(db, { jenis: "picking", batchId: "222" });

  assert.equal(r.ok, true, "batch 222 (murni pending) boleh lanjut");
  assert.equal(r.ownerUserId, "222", "owner dari movement, bukan body");
  assert.equal(r.kunci, "picking:222");
});

test("E-3 (kunci regresi): semua pending -> 'siap' (jalur sukses tetap terbuka)", async () => {
  // Penjaga arah sebaliknya: jangan sampai perbaikan `sebagian` memblokir batch yang sah.
  await seedMovement("ok-a", { kode: "P1", status: "pending_confirmation" });
  await seedMovement("ok-b", { kode: "", status: "pending_confirmation" });

  const r = await siapkanKonfirmasiDraft(db, { jenis: "picking", batchId: "111" });

  assert.equal(r.ok, true, "semua pending = siap, lanjut");
  assert.equal(r.ownerUserId, "111");
});

test("E-3 (kunci regresi): semua processed -> 409 'sudah diproses sebelumnya'", async () => {
  await seedMovement("done-a", { kode: "P1", status: "processed" });
  await seedMovement("done-b", { kode: "P1", status: "processed" });

  const r = await siapkanKonfirmasiDraft(db, { jenis: "picking", batchId: "111" });

  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.error, "Batch picking ini sudah diproses sebelumnya.");
});