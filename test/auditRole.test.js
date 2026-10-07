// test/auditRole.test.js
// Opsi D (PRD v2 §8.2): updateRoleAdmin mencatat audit role SENDIRI (default
// catatAudit:true); handleSetRole TIDAK lagi mencatat manual (harus tepat 1 baris).
// Test (b) WAJIB merah sebelum panggilan audit manual di handleSetRole dihapus.
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
process.env.SUPER_ADMIN_ID = "111";

const { installMockFirestore } = require("./helpers/mockFirestore");

// Stub kirimPesan supaya handleSetRole tidak menyentuh jaringan.
const kirimPesanPath = require.resolve("../lib/telegram/kirimPesan");
require.cache[kirimPesanPath] = {
  id: kirimPesanPath,
  filename: kirimPesanPath,
  loaded: true,
  exports: {
    kirimPesan: async () => ({ ok: true }),
    kirimPesanDenganTombol: async () => ({ ok: true }),
  },
};

const mock = installMockFirestore();
const db = mock.db;

const admins = require("../lib/models/admins");
const { handleSetRole } = require("../lib/handlers/handleSetRole");

async function hitungAudit() {
  const snap = await db.collection("admin_role_changes").get();
  return snap.docs.length;
}

beforeEach(async () => {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  await db.collection("admins").doc("111").set({ name: "Bos", role: "owner" });
  await db.collection("admins").doc("222").set({ name: "Adm", role: "guest" });
});

test("(a) updateRoleAdmin sukses -> tepat 1 baris audit", async () => {
  const hasil = await admins.updateRoleAdmin("222", "admin", "111");
  assert.equal(hasil.error, undefined);
  assert.equal(await hitungAudit(), 1);
  const doc = (await db.collection("admin_role_changes").get()).docs[0].data();
  assert.equal(doc.target_user_id, "222");
  assert.equal(doc.target_name, "Adm");
  assert.equal(doc.old_role, "guest");
  assert.equal(doc.new_role, "admin");
  assert.equal(doc.changed_by, "111");
});

test("(b) handleSetRole sukses -> tepat 1 baris audit (bukan 2)", async () => {
  await handleSetRole({ telegramUserId: "111", chatId: "111", argumen: ["222", "admin"] });
  assert.equal(await hitungAudit(), 1);
});

test("(c) guard gagal -> 0 baris audit", async () => {
  // Ubah role diri sendiri.
  let hasil = await admins.updateRoleAdmin("111", "admin", "111");
  assert.ok(hasil.error);
  assert.equal(await hitungAudit(), 0);

  // Turunkan owner terakhir (satu-satunya owner).
  hasil = await admins.updateRoleAdmin("111", "guest", "999");
  assert.ok(hasil.error);
  assert.equal(await hitungAudit(), 0);

  // Role tidak berubah.
  hasil = await admins.updateRoleAdmin("222", "guest", "111");
  assert.ok(hasil.error);
  assert.equal(await hitungAudit(), 0);
});

test("(d) catatAudit:false -> 0 baris audit", async () => {
  const hasil = await admins.updateRoleAdmin("222", "admin", "111", { catatAudit: false });
  assert.equal(hasil.error, undefined);
  assert.equal(await hitungAudit(), 0);
});
