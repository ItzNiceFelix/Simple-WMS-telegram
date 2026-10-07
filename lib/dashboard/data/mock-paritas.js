// lib/dashboard/data/mock-paritas.js
// Guard tulis mode mock — paritas server (PRD v2 §9.1: "mock wajib menyimulasikan
// guard SAMA PERSIS dengan server"). CJS murni supaya bisa diuji langsung `node --test`
// (mock.ts tidak dapat di-require dari test CJS).
//
// Tidak ada logika validasi baru di sini: `validasiHppMock`/`guardHapusMock` hanya
// meneruskan ke validator server yang sama (`validasiTulisV2.js`) supaya mock TIDAK
// PERNAH lebih longgar dari route (mock longgar = test UI hijau palsu).

const { validasiHpp, alasanTolakHapus } = require("../validasiTulisV2");

// Paritas env SUPER_ADMIN_ID: id super admin "env" di mode mock. Di produksi env ini
// menunjuk akun owner; mock memakai id owner seed (900001). Seperti server, akun ini
// tidak dapat dihapus dari dashboard (urutan guard: setelah owner-terakhir).
const SUPER_ADMIN_ENV_MOCK = ["900001"];

/**
 * @param {string} id
 * @returns {boolean}
 */
function isSuperAdminEnvMock(id) {
  return SUPER_ADMIN_ENV_MOCK.includes(String(id));
}

/**
 * Paritas F5/Q3 `getSession()` mock: super admin diri sendiri = role owner.
 * Mock TIDAK memakai daftar env di sini karena uid mock selalu 900001 sementara role
 * di-switch lewat query; DoD §6.5 menuntut admin/guest -> false.
 * @param {string} role
 * @returns {boolean}
 */
function superAdminMock(role) {
  return role === "owner";
}

/**
 * Paritas F1 `validasiHpp` route: `hpp` wajib integer >= 0 (null/string ditolak);
 * `hpp_baru` boleh integer >= 0 ATAU null. Pesan error persis route.
 * @param {unknown} req
 * @returns {{ ok: true; kodeBarang: string; adaHpp: boolean; hpp: number | undefined; adaHppBaru: boolean; hppBaru: number | null | undefined } | { ok: false; error: string }}
 */
function validasiHppMock(req) {
  return validasiHpp(req);
}

/**
 * Paritas F4b `alasanTolakHapus` route: sendiri -> tidak ada -> owner terakhir ->
 * super-admin-env. `superAdminEnv` diisi dari daftar env mock.
 * @param {{ requesterId: string; targetId: string; targetAdmin: { role?: string } | null; jumlahOwner: number }} a
 * @returns {{ ok: true } | { ok: false; status: number; error: string }}
 */
function guardHapusMock({ requesterId, targetId, targetAdmin, jumlahOwner }) {
  return alasanTolakHapus({
    requesterId,
    targetId,
    targetAdmin,
    jumlahOwner,
    superAdminEnv: isSuperAdminEnvMock(targetId),
  });
}

module.exports = {
  SUPER_ADMIN_ENV_MOCK,
  isSuperAdminEnvMock,
  superAdminMock,
  validasiHppMock,
  guardHapusMock,
};
