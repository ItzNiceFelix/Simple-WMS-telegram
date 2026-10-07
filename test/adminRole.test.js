// test/adminRole.test.js
// PRD §4.7 — ubah role admin via model updateRoleAdmin (Opsi D: audit di dalam model).
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

// Mirror keputusan route: non-owner ditolak sebelum model dipanggil.
// Audit berjalan DI DALAM model (Opsi D) dan tidak melempar — dilaporkan via
// `peringatan_audit`. Throw = kegagalan model nyata -> 500.
async function ubahRoleRoute({ requesterId, requesterRole, targetUserId, roleBaru }) {
  if (requesterRole !== "owner") return { status: 403, error: "Hanya owner yang dapat mengubah role." };
  let hasil;
  try {
    hasil = await admins.updateRoleAdmin(targetUserId, roleBaru, requesterId);
  } catch (e) {
    return { status: 500, error: "Gagal mengubah role." };
  }
  if (hasil.error) return { status: 400, error: hasil.error };
  const respons = { status: 200, role_lama: hasil.adminLama.role, role_baru: hasil.adminBaru.role };
  if (hasil.peringatan_audit) respons.peringatan_audit = true;
  return respons;
}

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}

async function seedAdmin(id, data) {
  await db.collection("admins").doc(id).set({ name: `User ${id}`, role: "guest", ...data });
}

async function jumlahRowRole() {
  return (await db.collection("admin_role_changes").get()).docs.length;
}

beforeEach(() => resetStore());

test("1. owner guest->admin: doc berubah + 1 audit row", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "guest" });
  const hasil = await ubahRoleRoute({ requesterId: "1", requesterRole: "owner", targetUserId: "2", roleBaru: "admin" });
  assert.equal(hasil.status, 200);
  assert.equal(hasil.role_lama, "guest");
  assert.equal(hasil.role_baru, "admin");

  assert.equal((await admins.ambilAdmin("2")).role, "admin");
  assert.equal(await jumlahRowRole(), 1);
  const row = (await db.collection("admin_role_changes").get()).docs[0].data();
  assert.equal(row.old_role, "guest");
  assert.equal(row.new_role, "admin");
  assert.equal(row.changed_by, "1");
});

test("2. non-owner: role tidak berubah, 0 audit row", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "guest" });
  const hasil = await ubahRoleRoute({ requesterId: "9", requesterRole: "admin", targetUserId: "2", roleBaru: "admin" });
  assert.equal(hasil.status, 403);
  assert.equal((await admins.ambilAdmin("2")).role, "guest");
  assert.equal(await jumlahRowRole(), 0);
});

test("3. ubah role diri sendiri ditolak, 0 audit row", async () => {
  await seedAdmin("1", { role: "owner" });
  const hasil = await ubahRoleRoute({ requesterId: "1", requesterRole: "owner", targetUserId: "1", roleBaru: "admin" });
  assert.equal(hasil.status, 400);
  assert.equal(hasil.error, "Tidak boleh mengubah role diri sendiri.");
  assert.equal(await jumlahRowRole(), 0);
});

test("4. owner terakhir diturunkan ditolak, 0 audit row", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "guest" });
  const hasil = await ubahRoleRoute({ requesterId: "2", requesterRole: "owner", targetUserId: "1", roleBaru: "admin" });
  assert.equal(hasil.status, 400);
  assert.equal(hasil.error, "Owner terakhir tidak boleh diturunkan rolenya.");
  assert.equal((await admins.ambilAdmin("1")).role, "owner");
  assert.equal(await jumlahRowRole(), 0);
});

test("5. role sama ditolak, 0 audit row", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "admin" });
  const hasil = await ubahRoleRoute({ requesterId: "1", requesterRole: "owner", targetUserId: "2", roleBaru: "admin" });
  assert.equal(hasil.status, 400);
  assert.equal(hasil.error, "Role user sudah admin.");
  assert.equal(await jumlahRowRole(), 0);
});

test("6. target belum terdaftar ditolak, 0 audit row", async () => {
  await seedAdmin("1", { role: "owner" });
  const hasil = await ubahRoleRoute({ requesterId: "1", requesterRole: "owner", targetUserId: "404", roleBaru: "admin" });
  assert.equal(hasil.status, 400);
  assert.equal(hasil.error, "User belum terdaftar sebagai admin.");
  assert.equal(await jumlahRowRole(), 0);
});

test("7. audit throw: doc admins tetap berubah + [audit_write_failed] dilog", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "guest" });

  const asliAdd = db.collection("admin_role_changes").add;
  // Monkeypatch: .add pada koleksi audit melempar.
  const origCollection = db.collection;
  db.collection = (name) => {
    const ref = origCollection(name);
    if (name === "admin_role_changes") {
      ref.add = async () => {
        throw new Error("audit down");
      };
    }
    return ref;
  };

  const logs = [];
  const origErr = console.error;
  console.error = (...a) => logs.push(a.join(" "));

  let hasil;
  try {
    hasil = await ubahRoleRoute({ requesterId: "1", requesterRole: "owner", targetUserId: "2", roleBaru: "admin" });
  } finally {
    console.error = origErr;
    db.collection = origCollection;
    void asliAdd;
  }

  assert.equal(hasil.status, 200);
  assert.equal(hasil.peringatan_audit, true);
  assert.equal((await admins.ambilAdmin("2")).role, "admin", "update sudah commit sebelum audit gagal");
  assert.ok(
    logs.some((l) => l.includes("[audit_write_failed]")),
    "log [audit_write_failed] harus muncul"
  );
});

test("8. setelah sukses, ada 1 row baru yang terbaca via get()", async () => {
  await seedAdmin("1", { role: "owner" });
  await seedAdmin("2", { role: "guest" });
  await ubahRoleRoute({ requesterId: "1", requesterRole: "owner", targetUserId: "2", roleBaru: "admin" });
  const snap = await db.collection("admin_role_changes").get();
  assert.equal(snap.docs.length, 1);
  assert.equal(snap.docs[0].data().target_user_id, "2");
});

test("9. catatPerubahanRole langsung menulis row audit yang benar", async () => {
  await catatPerubahanRole({ targetUserId: 2, targetName: "User 2", roleLama: "guest", roleBaru: "admin", changedBy: 1 });
  const snap = await db.collection("admin_role_changes").get();
  assert.equal(snap.docs.length, 1);
  assert.equal(snap.docs[0].data().new_role, "admin");
});
