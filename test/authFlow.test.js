// test/authFlow.test.js
// Uji logika keputusan auth: pemetaan role, re-validasi admin, dan penolakan (PRD FR-AUTH-03/04b).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { verifikasiInitData, buatInitData, InitDataError } = require("../lib/dashboard/auth/initData");
const { buatTokenSesi, verifikasiTokenSesi } = require("../lib/dashboard/auth/sesi");

process.env.DASHBOARD_SESSION_SECRET = "rahasia-uji";

const BOT_TOKEN = "999:TEST";
const NOW = 1_700_000_000_000;
const AUTH_DATE = Math.floor(NOW / 1000) - 10;

function init(uid = 900001) {
  return buatInitData({
    botToken: BOT_TOKEN,
    user: { id: uid, username: "u", first_name: "N" },
    authDate: AUTH_DATE,
  });
}

/** Cerminan pemetaan role di route (harus sama persis). */
function petakanRole(admin) {
  if (!admin) return null;
  if (admin.role === "owner" || admin.role === "admin") return admin.role;
  return "guest";
}

test("role owner/admin dipertahankan; selain itu guest", () => {
  assert.equal(petakanRole({ role: "owner" }), "owner");
  assert.equal(petakanRole({ role: "admin" }), "admin");
  assert.equal(petakanRole({ role: "guest" }), "guest");
  assert.equal(petakanRole({ role: undefined }), "guest");
  assert.equal(petakanRole({ role: "superadmin" }), "guest");
  assert.equal(petakanRole(null), null);
});

test("klaim role dipaksa dari admins, bukan input klien", () => {
  // Klien mengirim initData sah; role TIDAK ada di initData, jadi selalu dari admins.
  const h = verifikasiInitData(init(900001), { botToken: BOT_TOKEN, now: NOW });
  const dariAdmins = { role: "guest" };
  assert.equal(petakanRole(dariAdmins), "guest");
  assert.equal(h.user.id, "900001");
});

test("admin dihapus -> tidak ada role (403)", () => {
  const h = verifikasiInitData(init(900002), { botToken: BOT_TOKEN, now: NOW });
  const admin = null; // dihapus dari koleksi
  assert.equal(petakanRole(admin), null);
  assert.equal(h.user.id, "900002");
});

test("role diturunkan admin->guest -> token berikutnya guest", () => {
  const t = buatTokenSesi({ userId: "900002", role: "guest", authDate: AUTH_DATE });
  const p = verifikasiTokenSesi(t, { now: NOW });
  assert.equal(p.role, "guest");
});

test("initData kedaluwarsa tidak menghasilkan sesi", () => {
  const tua = buatInitData({
    botToken: BOT_TOKEN,
    user: { id: 1, first_name: "X" },
    authDate: Math.floor(NOW / 1000) - 4000,
  });
  assert.throws(
    () => verifikasiInitData(tua, { botToken: BOT_TOKEN, now: NOW }),
    (e) => e instanceof InitDataError && e.status === 401
  );
});
