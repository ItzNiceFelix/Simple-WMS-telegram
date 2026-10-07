// test/draftKonfirmasiV3b.test.js
// B-W2/B-W3 v3b (PRD §11 T2a-T2e + T5a-T5f): validator `konfirmasi-draft`, helper `draftOwner.js`,
// guard `draft_kirim_guard`, sync per-kelompok, picking batch, fail-closed draft tanpa owner,
// anti-pemalsuan body, dan kontrak string route.ts (pesan error PERSIS tabel §5.4).
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

// Stub Sheets + Telegram agar tidak menyentuh network.
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

const mock = installMockFirestore();
const db = mock.db;

const { validasiAksiAdmin, validasiKonfirmasiDraft } = require("../lib/dashboard/validasiTulisV3a");
const draftOwner = require("../lib/dashboard/draftOwner");
const { kunciGuard, guardAktif } = require("../lib/dashboard/draftGuard");
const { konfirmasiOpname } = require("../lib/handlers/handleOpname");
const { konfirmasiPickingList } = require("../lib/handlers/konfirmasiPickingList");
const { konfirmasiSyncStok, KONDISI } = require("../lib/sheets/syncStokDuaArah");

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  terkirim.length = 0;
}
beforeEach(() => resetStore());

// ---------------------------------------------------------------------------
// Validator (§5.4 tabel pesan)
// ---------------------------------------------------------------------------

test("validator: konfirmasi-draft dikenali dispatcher (5 aksi total)", () => {
  const r = validasiAksiAdmin({ aksi: "konfirmasi-draft", jenis: "opname", draft_id: "d1", aksi_draft: "apply" });
  assert.equal(r.ok, true);
  assert.equal(r.aksi, "konfirmasi-draft");
  assert.equal(r.jenis, "opname");
  assert.equal(r.draftId, "d1");
  assert.equal(r.aksiDraft, "apply");
});

test("validator: jenis/aksi_draft/batch/draft tidak valid -> 400 pesan PERSIS", () => {
  let r = validasiKonfirmasiDraft({ jenis: "xyz", aksi_draft: "apply", draft_id: "d" });
  assert.equal(r.status, 400);
  assert.equal(r.error, "Jenis draft tidak dikenal.");

  r = validasiKonfirmasiDraft({ jenis: "opname", aksi_draft: "hapus", draft_id: "d" });
  assert.equal(r.error, "Aksi draft tidak dikenal.");

  r = validasiKonfirmasiDraft({ jenis: "picking", aksi_draft: "apply" });
  assert.equal(r.error, "Batch picking tidak ditemukan.");

  r = validasiKonfirmasiDraft({ jenis: "opname", aksi_draft: "apply" });
  assert.equal(r.error, "Draft tidak ditemukan.");
});

test("validator: kondisi hanya untuk sync + nilai valid PERSIS", () => {
  let r = validasiKonfirmasiDraft({ jenis: "opname", aksi_draft: "apply", draft_id: "d", kondisi: "konflik" });
  assert.equal(r.error, "Kondisi hanya untuk draft sync.");

  r = validasiKonfirmasiDraft({ jenis: "sync", aksi_draft: "apply", draft_id: "d", kondisi: "ngawur" });
  assert.equal(r.error, "Kondisi tidak dikenal.");

  r = validasiKonfirmasiDraft({ jenis: "sync", aksi_draft: "apply", draft_id: "d" });
  assert.equal(r.ok, true);
  assert.equal(r.kondisi, "semua", "absen -> semua");

  for (const k of ["sheets_ketinggalan", "sheets_manual", "konflik", "produk_baru", "semua"]) {
    assert.equal(validasiKonfirmasiDraft({ jenis: "sync", aksi_draft: "apply", draft_id: "d", kondisi: k }).ok, true, k);
  }
});

test("validator SEC: owner_user_id di body DIABAIKAN (tidak ada di hasil)", () => {
  const r = validasiKonfirmasiDraft({
    jenis: "opname",
    aksi_draft: "apply",
    draft_id: "d",
    owner_user_id: "PALSU",
  });
  assert.equal(r.ok, true);
  assert.equal(r.ownerUserId, undefined, "validasi TIDAK membaca owner_user_id dari body");
});

// ---------------------------------------------------------------------------
// draftOwner helper (§7)
// ---------------------------------------------------------------------------

test("draftOwner: owner semua; admin hanya sendiri; guest tolak (403)", () => {
  const doc = { owner_user_id: "111" };
  assert.equal(draftOwner.otorisasiDraft("owner", "999", doc).ok, true);
  assert.equal(draftOwner.otorisasiDraft("admin", "111", doc).ok, true);
  const tolak = draftOwner.otorisasiDraft("admin", "222", doc);
  assert.equal(tolak.ok, false);
  assert.equal(tolak.status, 403);
  assert.equal(tolak.error, "Hanya owner atau pembuat draft yang dapat mengonfirmasi.");
  assert.equal(draftOwner.otorisasiDraft("guest", "111", doc).ok, false);
});

test("T5d-helper: draft tanpa owner -> 409 fail-closed termasuk owner", () => {
  for (const role of ["owner", "admin"]) {
    const r = draftOwner.otorisasiDraft(role, "111", { status: "pending_confirmation" });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.equal(r.error, "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram.");
  }
});

test("draftOwner: fallback created_by/requested_by (picking movement)", () => {
  assert.equal(draftOwner.ambilOwnerDraft({ created_by: "222" }), "222");
  assert.equal(draftOwner.ambilOwnerDraft({ requested_by: "333" }), "333");
  assert.equal(draftOwner.ambilOwnerDraft({ owner_user_id: "", created_by: "444" }), "444", "kosong -> fallback");
  assert.equal(draftOwner.ambilOwnerDraft({}), null);
});

test("draftOwner: kelompokkanBatchPicking + statusBatchPicking (E-3)", () => {
  const ms = [
    { id: "a", created_by: "111", status: "pending_confirmation" },
    { id: "b", created_by: "111", status: "pending_confirmation" },
    { id: "c", created_by: "222", status: "pending_confirmation" },
  ];
  const peta = draftOwner.kelompokkanBatchPicking(ms);
  assert.equal(peta.get("111").length, 2);
  assert.equal(peta.get("222").length, 1);
  assert.equal(draftOwner.statusBatchPicking(peta.get("111")), "siap");
  assert.equal(
    draftOwner.statusBatchPicking([{ status: "processed" }, { status: "pending_confirmation" }]),
    "sebagian"
  );
  assert.equal(draftOwner.statusBatchPicking([{ status: "processed" }]), "sudah");
});

// ---------------------------------------------------------------------------
// guard (§8.5) + T2d/E-6/E-7
// ---------------------------------------------------------------------------

test("T2d/E-6: guard aktif <10s -> true; kedaluwarsa -> false", async () => {
  await db.collection("draft_kirim_guard").doc("opname:x").set({ at: Date.now() });
  assert.equal(await guardAktif(db, kunciGuard("opname", "x")), true);
  await db.collection("draft_kirim_guard").doc("opname:y").set({ at: Date.now() - 60_000 });
  assert.equal(await guardAktif(db, kunciGuard("opname", "y")), false);
  assert.equal(await guardAktif(db, kunciGuard("opname", "tak-ada")), false);
});

test("E-7: guard dengan `at` null -> TIDAK memblokir (best-effort)", async () => {
  await db.collection("draft_kirim_guard").doc("sync:z").set({ at: null });
  assert.equal(await guardAktif(db, "sync:z"), false);
});

test("E-7: tulisGuardDraft (runTransaction throw) -> log [draft_guard_failed] & LANJUT tanpa blokir", async () => {
  const { tulisGuardDraft } = require("../lib/dashboard/aksiDraft");
  const errorAsli = db.runTransaction;
  const logAsli = console.error;
  const logs = [];
  console.error = (...a) => logs.push(a.join(" "));

  db.runTransaction = async () => {
    throw new Error("firestore down");
  };
  const hasil = await tulisGuardDraft(db, "opname:err", "uid-1");
  db.runTransaction = errorAsli;
  console.error = logAsli;

  assert.equal(hasil.duplikat, false, "guard gagal TIDAK memblokir aksi sah");
  assert.ok(logs.some((l) => l.includes("[draft_guard_failed]")), "log kontrak [draft_guard_failed]");
});

test("E-7b: tulisGuardDraft normal -> invocation kedua terdeteksi duplikat (CAS)", async () => {
  const { tulisGuardDraft } = require("../lib/dashboard/aksiDraft");
  const pertama = await tulisGuardDraft(db, "opname:cas", "uid-1");
  const kedua = await tulisGuardDraft(db, "opname:cas", "uid-2");
  assert.equal(pertama.duplikat, false);
  assert.equal(kedua.duplikat, true, "panggilan < TTL -> duplikat (409)");
});

// ---------------------------------------------------------------------------
// A2 alur fungsi bot (T5a/T5b/T2c) — memakai fungsi bot nyata lewat db mock
// ---------------------------------------------------------------------------

async function movements() {
  const snap = await db.collection("stock_movements").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

test("T5a: sync 'ya semua' -> semua draft processed, pendingSyncStok hilang", async () => {
  await db.collection("sessions").doc("111").set({ pendingSyncStok: { chatId: 1, draftIds: ["s1", "s2"] } });
  for (const id of ["s1", "s2"]) {
    await db.collection("sync_stok_drafts").doc(id).set({
      kondisi: id === "s1" ? KONDISI.SHEETS_KETINGGALAN : KONDISI.KONFLIK,
      items: [{ kode_barang: "K1", nama_accurate: "K", nilai_firestore: 3, index_kolom: 3 }],
      index_kolom: 3,
      status: "pending_confirmation",
      owner_user_id: "111",
    });
  }
  await db.collection("stock").doc("K1").set({ stok_gudang_online: 3 });
  await db.collection("products").doc("K1").set({ nama_accurate: "K" });

  const hasil = await konfirmasiSyncStok("111", "ya semua", { confirmedBy: "777", kirimNotifikasi: false });
  assert.equal(hasil.ok, true);
  assert.equal(hasil.sisa, 0);
  assert.equal((await db.collection("sync_stok_drafts").doc("s1").get()).data().status, "processed");
  assert.equal((await db.collection("sync_stok_drafts").doc("s2").get()).data().status, "processed");
  assert.equal((await db.collection("sessions").doc("111").get()).data().pendingSyncStok, undefined);
  assert.equal((await movements()).length, 2, "dua movement sync_confirmed");
});

test("T2c: sync sebagian -> draftIds SISA dipertahankan (R4 — jangan hapus sesi)", async () => {
  await db.collection("sessions").doc("111").set({ pendingSyncStok: { chatId: 1, draftIds: ["s1", "s2"] } });
  await db.collection("sync_stok_drafts").doc("s1").set({
    kondisi: KONDISI.SHEETS_KETINGGALAN,
    items: [{ kode_barang: "K1", nama_accurate: "K", nilai_firestore: 3, index_kolom: 3 }],
    index_kolom: 3,
    status: "pending_confirmation",
    owner_user_id: "111",
  });
  await db.collection("sync_stok_drafts").doc("s2").set({
    kondisi: KONDISI.KONFLIK,
    items: [{ kode_barang: "K1", nama_accurate: "K", nilai_firestore: 3, index_kolom: 3 }],
    index_kolom: 3,
    status: "pending_confirmation",
    owner_user_id: "111",
  });
  await db.collection("stock").doc("K1").set({ stok_gudang_online: 3 });
  await db.collection("products").doc("K1").set({ nama_accurate: "K" });

  const hasil = await konfirmasiSyncStok("111", `ya ${KONDISI.SHEETS_KETINGGALAN}`, {
    confirmedBy: "777",
    kirimNotifikasi: false,
  });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.sisa, 1);
  assert.equal((await db.collection("sync_stok_drafts").doc("s1").get()).data().status, "processed");
  assert.equal((await db.collection("sync_stok_drafts").doc("s2").get()).data().status, "pending_confirmation", "sisa TETAP pending");
  const sesi = (await db.collection("sessions").doc("111").get()).data();
  assert.ok(sesi.pendingSyncStok, "pendingSyncStok TETAP ADA");
  assert.deepEqual(sesi.pendingSyncStok.draftIds, ["s2"], "draftIds sisa dipertahankan");
});

test("T2c/E-5: sync kelompok yang tidak pending -> alasan kondisi_kosong", async () => {
  await db.collection("sessions").doc("111").set({ pendingSyncStok: { chatId: 1, draftIds: ["s1"] } });
  await db.collection("sync_stok_drafts").doc("s1").set({
    kondisi: KONDISI.KONFLIK,
    items: [],
    index_kolom: 3,
    status: "pending_confirmation",
    owner_user_id: "111",
  });

  const hasil = await konfirmasiSyncStok("111", `ya ${KONDISI.SHEETS_KETINGGALAN}`, { kirimNotifikasi: false });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.alasan, "kondisi_kosong");
});

test("T5b: picking batch -> semua movement diproses; kurangiStok N kali; batch_id dikembalikan", async () => {
  await db.collection("sessions").doc("111").set({ pendingPickingList: { chatId: 1, movementIds: ["m1", "m2"] } });
  for (const id of ["m1", "m2"]) {
    await db.collection("stock_movements").doc(id).set({
      kode_barang: "P1",
      nama_terbaca: "Produk",
      variasi: "-",
      qty: 2,
      action_type: "kurangi_stok",
      status: "pending_confirmation",
      created_by: "111",
    });
  }
  await db.collection("stock").doc("P1").set({ stok_gudang_online: 10 });

  const hasil = await konfirmasiPickingList("111", "ya", {
    sumber: "dokumen",
    confirmedBy: "777",
    kirimNotifikasi: false,
  });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.diproses, 2, "dua movement dikurangi");
  assert.equal(hasil.batch_id, "111");
  assert.equal((await db.collection("stock").doc("P1").get()).data().stok_gudang_online, 6);
  assert.equal((await db.collection("stock_movements").doc("m1").get()).data().status, "processed");
  assert.equal((await db.collection("stock_movements").doc("m2").get()).data().status, "processed");
  assert.equal((await db.collection("sessions").doc("111").get()).data().pendingPickingList, undefined);
});

test("T2e/T5f: dua konfirmasi batch paralel -> tepat satu sukses (guard + state sesi)", async () => {
  await db.collection("sessions").doc("111").set({ pendingPickingList: { chatId: 1, movementIds: ["m1"] } });
  await db.collection("stock_movements").doc("m1").set({
    kode_barang: "P1",
    nama_terbaca: "Produk",
    variasi: "-",
    qty: 2,
    action_type: "kurangi_stok",
    status: "pending_confirmation",
    created_by: "111",
  });
  await db.collection("stock").doc("P1").set({ stok_gudang_online: 10 });

  // Jalur NYATA route: guard ditulis TRANSAKSIONAL (CAS) SEBELUM panggil bot — invocation kedua kalah.
  const { kunciGuard: kk } = require("../lib/dashboard/draftGuard");
  const guardRef = db.collection("draft_kirim_guard").doc(kk("picking", "111"));
  async function lewatGuard() {
    const duplikat = await db.runTransaction(async (trx) => {
      const doc = await trx.get(guardRef);
      if (doc.exists && Date.now() - doc.data().at <= 10_000) return true;
      trx.set(guardRef, { at: Date.now() }, { merge: false });
      return false;
    });
    if (duplikat) return { ok: false, alasan: "guard_aktif" };
    return konfirmasiPickingList("111", "ya", { sumber: "dokumen", confirmedBy: "aaa", kirimNotifikasi: false });
  }
  const hasil = await Promise.all([lewatGuard(), lewatGuard()]);

  const sukses = hasil.filter((h) => h.ok);
  const gagal = hasil.filter((h) => !h.ok);
  assert.equal(sukses.length, 1, "tepat satu konfirmasi memproses");
  assert.equal(gagal.length, 1);
  assert.equal(gagal[0].alasan, "guard_aktif", "invocation kedua ditolak guard dokumen");
  assert.equal((await db.collection("stock").doc("P1").get()).data().stok_gudang_online, 8, "stok TIDAK dobel-kurang");
});

// ---------------------------------------------------------------------------
// T5d: fail-closed draft tanpa owner (route kontrak) — helper + string route
// ---------------------------------------------------------------------------

test("T5d: draft tanpa owner_user_id -> 409 fail-closed (owner TIDAK dikecualikan)", async () => {
  await db.collection("opname_drafts").doc("lama").set({ items: [], status: "pending_confirmation" });
  const doc = (await db.collection("opname_drafts").doc("lama").get()).data();
  const r = draftOwner.otorisasiDraft("owner", "111", doc);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.error, "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram.");
});

test("E-3: siapkanKonfirmasiDraft() -> batch setengah jadi 409 fail-closed (helper NYATA route)", async () => {
  const { siapkanKonfirmasiDraft } = require("../lib/dashboard/aksiDraft");
  await db.collection("stock_movements").doc("ma").set({
    kode_barang: "P1", nama_terbaca: "P", variasi: "-", qty: 2,
    action_type: "kurangi_stok", status: "processed", created_by: "111",
  });
  await db.collection("stock_movements").doc("mb").set({
    kode_barang: "P1", nama_terbaca: "P", variasi: "-", qty: 2,
    action_type: "kurangi_stok", status: "pending_confirmation", created_by: "111",
  });
  await db.collection("stock").doc("P1").set({ stok_gudang_online: 10 });

  const r = await siapkanKonfirmasiDraft(db, { jenis: "picking", batchId: "111" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.error, "Batch picking ini diproses sebagian. Selesaikan lewat Telegram.");
  assert.equal((await db.collection("stock").doc("P1").get()).data().stok_gudang_online, 10, "stok TIDAK disentuh");
});

test("E-3b: siapkanKonfirmasiDraft() -> batch SEMUA processed = 409 sudah diproses", async () => {
  const { siapkanKonfirmasiDraft } = require("../lib/dashboard/aksiDraft");
  await db.collection("stock_movements").doc("mc").set({
    kode_barang: "P1", nama_terbaca: "P", variasi: "-", qty: 2,
    action_type: "kurangi_stok", status: "processed", created_by: "111",
  });
  const r = await siapkanKonfirmasiDraft(db, { jenis: "picking", batchId: "111" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.error, "Batch picking ini sudah diproses sebelumnya.");
});

test("I-4: siapkanKonfirmasiDraft() -> owner dari MOVEMENT, bukan batch_id body", async () => {
  const { siapkanKonfirmasiDraft, otorisasi } = require("../lib/dashboard/aksiDraft");
  await db.collection("stock_movements").doc("m1").set({
    kode_barang: "P1", nama_terbaca: "P", variasi: "-", qty: 2,
    action_type: "kurangi_stok", status: "pending_confirmation", created_by: "111",
  });
  // Body batch_id = "111" (id batch), bukan sumber otoritas: owner tetap dari movement.
  const r = await siapkanKonfirmasiDraft(db, { jenis: "picking", batchId: "111" });
  assert.equal(r.ok, true);
  assert.equal(r.ownerUserId, "111");
  assert.equal(r.kunci, "picking:111");
  assert.equal(otorisasi("admin", "999", r.ownerUserId).ok, false, "admin lain ditolak");
  assert.equal(otorisasi("admin", "111", r.ownerUserId).ok, true);
});

test("I-4b: batch_id menunjuk pemilik tanpa movement -> 404 (body tidak menciptakan batch)", async () => {
  const { siapkanKonfirmasiDraft } = require("../lib/dashboard/aksiDraft");
  const r = await siapkanKonfirmasiDraft(db, { jenis: "picking", batchId: "999" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(r.error, "Batch picking tidak ditemukan.");
});

test("siapkanKonfirmasiDraft(): opname draft tidak ada -> 404 Draft tidak ditemukan.", async () => {
  const { siapkanKonfirmasiDraft } = require("../lib/dashboard/aksiDraft");
  const r = await siapkanKonfirmasiDraft(db, { jenis: "opname", draftId: "tidak-ada" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(r.error, "Draft tidak ditemukan.");
});

test("validasiStatusDraft(): sync kelompok salah -> 409 E-5; opname processed -> 409", async () => {
  const { validasiStatusDraft } = require("../lib/dashboard/aksiDraft");
  const syncDoc = { id: "s1", status: "pending_confirmation", kondisi: KONDISI.KONFLIK, owner_user_id: "111" };
  const r = validasiStatusDraft("sync", syncDoc, KONDISI.SHEETS_KETINGGALAN, "111");
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.error, "Tidak ada draft kelompok itu yang masih pending.");

  const opnameDoc = { id: "o1", status: "processed", owner_user_id: "111" };
  assert.equal(validasiStatusDraft("opname", opnameDoc, null, "111").error, "Draft ini sudah diproses sebelumnya.");
});

test("validasiStatusDraft(): draft tanpa owner -> fail-closed 409 (termasuk owner)", () => {
  const { validasiStatusDraft } = require("../lib/dashboard/aksiDraft");
  const r = validasiStatusDraft("opname", { id: "o", status: "pending_confirmation" }, null, "");
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.error, "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram.");
});

test("T5e: anti-pemalsuan — owner dari DOKUMEN, body diabaikan", () => {
  const dokumen = { owner_user_id: "111" };
  // Admin 111 (pembuat) sukses walau body mengaku owner lain; admin 222 gagal walau body klaim.
  assert.equal(draftOwner.otorisasiDraft("admin", "111", dokumen).ok, true);
  assert.equal(draftOwner.otorisasiDraft("admin", "222", dokumen).ok, false);
  // Bahkan owner dashboard tetap mengikuti dokumen (owner boleh semua, tapi owner_user_id
  // yang diteruskan ke bot HARUS dari dokumen).
  assert.equal(draftOwner.otorisasiDraft("owner", "999", dokumen).ownerUserId, "111");
});

// ---------------------------------------------------------------------------
// Kontrak string route.ts (pesan PERSIS §5.4) — bukan tautologi: file produksi nyata
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const ROUTE_SRC = fs.readFileSync(path.join(__dirname, "..", "app", "api", "admin", "route.ts"), "utf8");
// Pesan §5.4 hidup di helper murni `aksiDraft.js` (single source of truth, diuji langsung di atas);
// route memakai helper itu. Cek kedua sumber supaya pesan tidak bisa berubah diam-diam.
const HELPER_SRC = fs.readFileSync(path.join(__dirname, "..", "lib", "dashboard", "aksiDraft.js"), "utf8");
const draftOwnerSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "dashboard", "draftOwner.js"), "utf8");

test("route kontrak: pesan §5.4 PERSIS + guard + pemanggilan bot dgn opsi dashboard", () => {
  const pesan = [
    "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram.",
    "Hanya owner atau pembuat draft yang dapat mengonfirmasi.",
    "Draft ini sudah diproses sebelumnya.",
    "Draft tidak ditemukan.",
    "Batch picking tidak ditemukan.",
    "Tidak ada draft kelompok itu yang masih pending.",
    "Batch picking ini sudah diproses sebelumnya.",
    "Batch picking ini diproses sebagian. Selesaikan lewat Telegram.",
  ];
  const gabung = `${ROUTE_SRC}\n${HELPER_SRC}\n${draftOwnerSrc}`;
  for (const p of pesan) assert.ok(gabung.includes(p), `kode produksi harus memuat ${JSON.stringify(p)}`);
  // Fase 1: konfirmasi-draft DITUNDA ke Fase 2 (butuh bot/Sheets di Worker).
  // Route menjawab 501 eksplisit — bukan early-return senyap, bukan sukses palsu.
  assert.ok(ROUTE_SRC.includes('"konfirmasi-draft"'), "route menangani aksi konfirmasi-draft");
  assert.ok(ROUTE_SRC.includes("501"), "route menjawab 501 selama Fase 1");
  assert.ok(ROUTE_SRC.includes("Fase 2"), "route menyebut Fase 2 sebagai alasan");
});

test("route: TIDAK ada early-return senyap di 3 fungsi bot (B3)", () => {
  const sumber = [
    fs.readFileSync(path.join(__dirname, "..", "lib", "handlers", "handleOpname.js"), "utf8"),
    fs.readFileSync(path.join(__dirname, "..", "lib", "handlers", "konfirmasiPickingList.js"), "utf8"),
    fs.readFileSync(path.join(__dirname, "..", "lib", "sheets", "syncStokDuaArah.js"), "utf8"),
  ];
  for (const s of sumber) {
    assert.ok(!/if \(!pending\) return;/.test(s), "tidak boleh `if (!pending) return;` senyap");
    assert.ok(!/if \(!pending\) return false;/.test(s), "tidak boleh `if (!pending) return false;`");
    assert.ok(s.includes('alasan: "tidak_ada_pending"'));
  }
});

test("route: :47 dan :76 handleKonfirmasiCallback TIDAK diubah (N2); :68 pakai Boolean(hasil?.ok)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "handlers", "handleKonfirmasiCallback.js"), "utf8");
  assert.ok(src.includes("await konfirmasiOpname(idPemilik, jawabanTeks, fromUserId);"), ":47 tetap string");
  assert.ok(src.includes("await konfirmasiSyncStok(idPemilik, jawabanTeks, fromUserId);"), ":76 tetap string");
  assert.ok(src.includes("Boolean(hasil?.ok)"), ":68 memetakan objek -> boolean");
});

test("route: routePesan.js TIDAK diubah (mengabaikan return)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "router", "routePesan.js"), "utf8");
  assert.ok(src.includes("await konfirmasiPickingList(ctx.telegramUserId, ctx.message.text);"));
  assert.ok(src.includes("await konfirmasiSyncStok(ctx.telegramUserId, ctx.message.text);"));
  assert.ok(src.includes("await konfirmasiOpname(ctx.telegramUserId, ctx.message.text);"));
});

test("rules: draft_kirim_guard server-only", () => {
  const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  assert.ok(rules.includes("match /draft_kirim_guard/{id}  { allow read, write: if false; }"));
  assert.ok(!/match \/sessions\//.test(rules), "sessions tetap tanpa match (deny total)");
});

test("route v3b terdaftar (batas jumlah route internal sudah DIHAPUS, v5)", () => {
  // Catatan: batas "12 function" adalah kebijakan internal yang DIHAPUS user saat v5.
  // Vercel Hobby = 2048 routes/deployment; tidak ada cap 12. Test ini tidak lagi mengunci
  // JUMLAH route (rapuh tiap fitur baru) - hanya memastikan route v3b masih ada.
  const routeDir = path.join(__dirname, "..", "app", "api");
  assert.ok(fs.existsSync(path.join(routeDir, "admin", "route.ts")), "route /api/admin ada");
  assert.ok(fs.existsSync(path.join(routeDir, "stok", "mutasi", "route.ts")), "route /api/stok/mutasi ada");
});
