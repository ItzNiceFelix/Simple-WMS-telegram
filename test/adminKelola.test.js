// test/adminKelola.test.js
// PRD §5.7 — tambah / hapus admin. Model primitives + guard murni alasanTolakHapus.
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
const mock = installMockFirestore();
const db = mock.db;

const admins = require("../lib/models/admins");
const { catatPerubahanRole } = require("../lib/models/adminRoleChanges");
const { revokeAccessRequest, ambilAccessRequest, buatAccessRequestBaru } = require("../lib/models/accessRequests");
const { validasiTambahAdmin, alasanTolakHapus } = require("../lib/dashboard/validasiTulisV2");

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}

async function seedAdmin(id, data) {
  await db.collection("admins").doc(id).set({ name: `User ${id}`, role: "guest", ...data });
}

// Mirror route tambah: validasi -> owner-only -> duplikat -> tambahAdmin -> audit.
async function tambahRoute({ body, requesterId, requesterRole }) {
  const valid = validasiTambahAdmin(body);
  if (!valid.ok) return { status: 400, error: valid.error };
  if (requesterRole !== "owner") return { status: 403, error: "Hanya owner yang dapat menambah admin." };
  if (await admins.ambilAdmin(valid.telegramUserId)) {
    return { status: 409, error: "User sudah terdaftar sebagai admin." };
  }
  const admin = await admins.tambahAdmin(valid.telegramUserId, {
    name: valid.name,
    role: valid.role,
    approvedBy: requesterId,
    username: valid.username,
  });
  await catatPerubahanRole({
    targetUserId: valid.telegramUserId,
    targetName: valid.name,
    roleLama: null,
    roleBaru: valid.role,
    changedBy: requesterId,
  });
  return { status: 201, admin };
}

// Mirror route hapus: validasi -> owner-only -> target -> guard -> hapus -> revoke -> audit.
async function hapusRoute({ targetUserId, requesterId, requesterRole }) {
  if (requesterRole !== "owner") return { status: 403, error: "Hanya owner yang dapat menghapus admin." };
  const targetAdmin = await admins.ambilAdmin(targetUserId);
  const superAdminEnv = admins.isSuperAdminDariEnv(targetUserId);
  let jumlahOwner = 0;
  if (targetAdmin?.role === "owner") jumlahOwner = (await admins.ambilSemuaAdminByRole("owner")).length;

  const tolak = alasanTolakHapus({
    requesterId,
    targetId: targetUserId,
    targetAdmin,
    jumlahOwner,
    superAdminEnv,
  });
  if (!tolak.ok) return { status: tolak.status, error: tolak.error };

  await admins.hapusAdmin(targetUserId);
  await revokeAccessRequest(targetUserId, requesterId);
  await catatPerubahanRole({
    targetUserId,
    targetName: targetAdmin.name,
    roleLama: targetAdmin.role,
    roleBaru: "dihapus",
    changedBy: requesterId,
  });
  return { status: 200, telegram_user_id: targetUserId, nama: targetAdmin.name };
}

async function jumlahRowRole() {
  return (await db.collection("admin_role_changes").get()).docs.length;
}

beforeEach(() => resetStore());

test("1. owner tambah user role admin -> doc ada, approved_by owner", async () => {
  await seedAdmin("1", { role: "owner" });
  const hasil = await tambahRoute({
    body: { telegram_user_id: "2", name: "Budi", role: "admin" },
    requesterId: "1",
    requesterRole: "owner",
  });
  assert.equal(hasil.status, 201);
  const doc = (await db.collection("admins").doc("2").get()).data();
  assert.equal(doc.role, "admin");
  assert.equal(doc.approved_by, "1");
});

test("2. id sudah ada -> 409, data lama tidak tertimpa", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { name: "Lama", role: "guest" });
  const hasil = await tambahRoute({
    body: { telegram_user_id: "2", name: "Baru", role: "admin" },
    requesterId: "1",
    requesterRole: "owner",
  });
  assert.equal(hasil.status, 409);
  assert.equal(hasil.error, "User sudah terdaftar sebagai admin.");
  const doc = (await db.collection("admins").doc("2").get()).data();
  assert.equal(doc.name, "Lama");
  assert.equal(doc.role, "guest");
});

test("3. non-owner tambah -> 403, tidak ada doc", async () => {
  await seedAdmin("1", { role: "owner" });
  const hasil = await tambahRoute({
    body: { telegram_user_id: "3", name: "X", role: "admin" },
    requesterId: "9",
    requesterRole: "admin",
  });
  assert.equal(hasil.status, 403);
  assert.equal((await db.collection("admins").doc("3").get()).exists, false);
});

test("4. owner hapus guest -> doc hilang", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "guest" });
  const hasil = await hapusRoute({ targetUserId: "2", requesterId: "1", requesterRole: "owner" });
  assert.equal(hasil.status, 200);
  assert.equal((await db.collection("admins").doc("2").get()).exists, false);
});

test("5. hapus akun sendiri ditolak, doc tetap", async () => {
  await seedAdmin("1", { role: "owner" });
  const hasil = await hapusRoute({ targetUserId: "1", requesterId: "1", requesterRole: "owner" });
  assert.equal(hasil.status, 400);
  assert.equal(hasil.error, "Tidak boleh menghapus akun sendiri.");
  assert.equal((await db.collection("admins").doc("1").get()).exists, true);
});

test("6. hapus owner terakhir ditolak, doc tetap", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "owner" });
  // target 2 dihapus oleh 1 -> masih 2 owner, boleh. Uji yg tdk boleh: satu-satunya owner.
  await db.collection("admins").doc("2").delete();
  const hasil = await hapusRoute({ targetUserId: "1", requesterId: "9", requesterRole: "owner" });
  // requester bukan target, tapi hanya 1 owner -> tolak
  assert.equal(hasil.status, 400);
  assert.equal(hasil.error, "Owner terakhir tidak boleh dihapus.");
  assert.equal((await db.collection("admins").doc("1").get()).exists, true);
});

test("7. super admin (env) tidak bisa dihapus walau terdaftar", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "admin" });
  process.env.SUPER_ADMIN_ID = "1, 2 ,3";
  try {
    const hasil = await hapusRoute({ targetUserId: "2", requesterId: "1", requesterRole: "owner" });
    assert.equal(hasil.status, 400);
    assert.equal(hasil.error, "Super admin (env) tidak dapat dihapus dari dashboard.");
    assert.equal((await db.collection("admins").doc("2").get()).exists, true);
  } finally {
    delete process.env.SUPER_ADMIN_ID;
  }
});

test("8. target tidak ada -> 404", async () => {
  await seedAdmin("1", { role: "owner" });
  const hasil = await hapusRoute({ targetUserId: "404", requesterId: "1", requesterRole: "owner" });
  assert.equal(hasil.status, 404);
  assert.equal(hasil.error, "User tidak ditemukan di daftar admin.");
});

test('9. hapus tulis 1 audit row new_role "dihapus" + revoke access_requests', async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "guest" });
  await buatAccessRequestBaru("2", { username: null, displayName: "User 2" });

  const hasil = await hapusRoute({ targetUserId: "2", requesterId: "1", requesterRole: "owner" });
  assert.equal(hasil.status, 200);
  assert.equal(hasil.nama, "User 2");

  const rows = (await db.collection("admin_role_changes").get()).docs;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data().new_role, "dihapus");

  const req = await ambilAccessRequest("2");
  assert.notEqual(req.status, "pending");
  assert.equal(req.status, "revoked");
});

test("9b. hapusAdmin throw -> 0 audit row", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "guest" });

  const origCollection = db.collection;
  db.collection = (name) => {
    const ref = origCollection(name);
    if (name === "admins") {
      const origDoc = ref.doc;
      ref.doc = (id) => {
        const d = origDoc(id);
        if (String(id) === "2") d.delete = async () => { throw new Error("delete down"); };
        return d;
      };
    }
    return ref;
  };

  let threw = false;
  try {
    await hapusRoute({ targetUserId: "2", requesterId: "1", requesterRole: "owner" });
  } catch {
    threw = true;
  } finally {
    db.collection = origCollection;
  }
  assert.equal(threw, true, "hapusAdmin throw harus merambat sebelum audit");
  assert.equal(await jumlahRowRole(), 0);
});

test("11. telegram_username: @ di depan / spasi ditolak, kosong -> null", () => {
  // '@' di depan = 400 (PRD §5.3), bukan di-strip diam-diam.
  let r = validasiTambahAdmin({ telegram_user_id: "2", name: "Budi", telegram_username: "@budi" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Username tidak valid.");

  r = validasiTambahAdmin({ telegram_user_id: "2", name: "Budi", telegram_username: "bu di" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Username tidak valid.");

  // Kosong -> null (opsional), bukan error.
  r = validasiTambahAdmin({ telegram_user_id: "2", name: "Budi", telegram_username: "  " });
  assert.equal(r.ok, true);
  assert.equal(r.username, null);

  // Tidak dikirim -> null.
  r = validasiTambahAdmin({ telegram_user_id: "2", name: "Budi" });
  assert.equal(r.ok, true);
  assert.equal(r.username, null);

  // Valid -> tersimpan tanpa '@' (tidak ada '@' di depan).
  r = validasiTambahAdmin({ telegram_user_id: "2", name: "Budi", telegram_username: "budi" });
  assert.equal(r.ok, true);
  assert.equal(r.username, "budi");
});

test('10. isSuperAdminDariEnv dukung daftar koma "1, 2 ,3"', () => {
  process.env.SUPER_ADMIN_ID = "1, 2 ,3";
  try {
    assert.equal(admins.isSuperAdminDariEnv("2"), true);
    assert.equal(admins.isSuperAdminDariEnv("3"), true);
    assert.equal(admins.isSuperAdminDariEnv("4"), false);
  } finally {
    delete process.env.SUPER_ADMIN_ID;
  }
});
