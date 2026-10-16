// lib/dashboard/data/mock-paritas.mjs
// Guard tulis mode mock — paritas server (PRD v2 §9.1: "mock wajib menyimulasikan
// guard SAMA PERSIS dengan server").
//
// ESM (bukan CJS) karena berkas ini masuk GRAFIK KLIEN: "mock.ts" mengimpornya, dan
// "mock.ts" diimpor oleh lib/dashboard/sumber-data.tsx yang ber-"use client". Berkas CJS
// di grafik klien membuat React Refresh menyuntik `import.meta.webpackHot` ke modul yang
// diparse sebagai CJS, dan `next dev` gagal "Cannot use 'import.meta' outside a module"
// -> SEMUA route 500.
//
// `validasiTulisV2.mjs` juga ESM murni tanpa dependensi, jadi diimpor biasa di sini.
//
// Tidak ada logika validasi baru di sini: `validasiHppMock`/`guardHapusMock` hanya
// meneruskan ke validator server yang sama (`validasiTulisV2.mjs`) supaya mock TIDAK
// PERNAH lebih longgar dari route (mock longgar = test UI hijau palsu).
import { validasiHpp, alasanTolakHapus } from "../validasiTulisV2.mjs";

// Paritas env SUPER_ADMIN_ID: id super admin "env" di mode mock. Di produksi env ini
// menunjuk akun owner; mock memakai id owner seed (900001). Seperti server, akun ini
// tidak dapat dihapus dari dashboard (urutan guard: setelah owner-terakhir).
export const SUPER_ADMIN_ENV_MOCK = ["900001"];

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isSuperAdminEnvMock(id) {
  return SUPER_ADMIN_ENV_MOCK.includes(String(id));
}

/**
 * Paritas F5/Q3 `getSession()` mock: super admin diri sendiri = role owner.
 * Mock TIDAK memakai daftar env di sini karena uid mock selalu 900001 sementara role
 * di-switch lewat query; DoD §6.5 menuntut admin/guest -> false.
 * @param {string} role
 * @returns {boolean}
 */
export function superAdminMock(role) {
  return role === "owner";
}

/**
 * Paritas F1 `validasiHpp` route: `hpp` wajib integer >= 0 (null/string ditolak);
 * `hpp_baru` boleh integer >= 0 ATAU null. Pesan error persis route.
 * @param {unknown} req
 * @returns {{ ok: true; kodeBarang: string; adaHpp: boolean; hpp: number | undefined; adaHppBaru: boolean; hppBaru: number | null | undefined } | { ok: false; error: string }}
 */
export function validasiHppMock(req) {
  return validasiHpp(req);
}

/**
 * Paritas F4b `alasanTolakHapus` route: sendiri -> tidak ada -> owner terakhir ->
 * super-admin-env. `superAdminEnv` diisi dari daftar env mock.
 * @param {{ requesterId: string; targetId: string; targetAdmin: { role?: string } | null; jumlahOwner: number }} a
 * @returns {{ ok: true } | { ok: false; status: number; error: string }}
 */
export function guardHapusMock({ requesterId, targetId, targetAdmin, jumlahOwner }) {
  return alasanTolakHapus({
    requesterId,
    targetId,
    targetAdmin,
    jumlahOwner,
    superAdminEnv: isSuperAdminEnvMock(targetId),
  });
}
