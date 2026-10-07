// test/superAdmin.test.js
// PRD §6.5 — flag superAdmin pada sesi/response auth.
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

const { isSuperAdminDariEnv } = require("../lib/models/admins");
const { superAdminMock } = require("../lib/dashboard/data/mock-paritas");

// Aturan murni yang dipakai route auth: role owner ATAU id di env SUPER_ADMIN_ID.
function hitungSuperAdmin(uid, role) {
  return role === "owner" || isSuperAdminDariEnv(String(uid));
}

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}

beforeEach(() => {
  resetStore();
  delete process.env.SUPER_ADMIN_ID;
});

test("id di daftar koma -> super admin true", () => {
  process.env.SUPER_ADMIN_ID = "1, 2 ,3";
  assert.equal(isSuperAdminDariEnv("1"), true);
  assert.equal(isSuperAdminDariEnv("2"), true);
  assert.equal(isSuperAdminDariEnv("3"), true);
});

test("id lain -> false", () => {
  process.env.SUPER_ADMIN_ID = "1,2,3";
  assert.equal(isSuperAdminDariEnv("99"), false);
});

test("env kosong -> false", () => {
  assert.equal(isSuperAdminDariEnv("1"), false);
});

test("selalu mengembalikan boolean (bukan undefined)", () => {
  assert.equal(typeof isSuperAdminDariEnv("1"), "boolean");
  process.env.SUPER_ADMIN_ID = "1";
  assert.equal(typeof isSuperAdminDariEnv("1"), "boolean");
});

test("role owner -> superAdmin true walau env kosong", () => {
  assert.equal(hitungSuperAdmin("5", "owner"), true);
});

test("role admin/guest + env kosong -> superAdmin false", () => {
  assert.equal(hitungSuperAdmin("5", "admin"), false);
  assert.equal(hitungSuperAdmin("5", "guest"), false);
});

test("role owner + id di env juga true (tidak bentrok)", () => {
  process.env.SUPER_ADMIN_ID = "5";
  assert.equal(hitungSuperAdmin("5", "owner"), true);
});
// B-02 (DoD §6.5): `getSession()` mengembalikan `superAdmin` bertipe boolean, bukan
// undefined. mock.ts getSession memakai `superAdminMock(role)` (mock-paritas.js).
test("getSession mock: superAdmin boolean + benar utk owner/admin/guest", () => {
  for (const role of ["owner", "admin", "guest"]) {
    assert.equal(typeof superAdminMock(role), "boolean");
  }
  assert.equal(superAdminMock("owner"), true);
  assert.equal(superAdminMock("admin"), false);
  assert.equal(superAdminMock("guest"), false);
});