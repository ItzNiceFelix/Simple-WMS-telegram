// test/mockParitas.test.js
// B-03 — paritas guard tulis mode mock vs server (PRD §9.1/DoD).
// Menguji LANGSUNG modul guard yang dipakai mock.ts (CJS murni; mock.ts sendiri
// tidak dapat di-require dari test CJS). Semua fungsi meneruskan ke validator server
// yang sama, jadi lolosnya test ini = mock tidak lebih longgar dari route.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  SUPER_ADMIN_ENV_MOCK,
  isSuperAdminEnvMock,
  superAdminMock,
  validasiHppMock,
  guardHapusMock,
} = require("../lib/dashboard/data/mock-paritas");

// ---------------------------------------------------------------- F1 ubahHpp

test("ubahHpp mock: hpp null ditolak (server 400)", () => {
  const r = validasiHppMock({ kode_barang: "BRG-001", hpp: null });
  assert.equal(r.ok, false);
  assert.equal(r.error, "HPP harus bilangan bulat >= 0.");
});

test("ubahHpp mock: hpp string ditolak", () => {
  const r = validasiHppMock({ kode_barang: "BRG-001", hpp: "90000" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "HPP harus bilangan bulat >= 0.");
});

test("ubahHpp mock: hpp non-integer / negatif ditolak", () => {
  for (const hpp of [1.5, -1, Number.NaN]) {
    const r = validasiHppMock({ kode_barang: "BRG-001", hpp });
    assert.equal(r.ok, false, `hpp=${hpp} harus ditolak`);
    assert.equal(r.error, "HPP harus bilangan bulat >= 0.");
  }
});

test("ubahHpp mock: hpp_baru null diterima (hapus HPP baru)", () => {
  const r = validasiHppMock({ kode_barang: "BRG-001", hpp_baru: null });
  assert.equal(r.ok, true);
  assert.equal(r.hppBaru, null);
});

test("ubahHpp mock: hpp_baru string ditolak", () => {
  const r = validasiHppMock({ kode_barang: "BRG-001", hpp_baru: "90000" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "HPP baru harus bilangan bulat >= 0.");
});

test("ubahHpp mock: tanpa field perubahan ditolak", () => {
  const r = validasiHppMock({ kode_barang: "BRG-001" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Tidak ada perubahan yang dikirim.");
});

test("ubahHpp mock: payload valid diterima", () => {
  const r = validasiHppMock({ kode_barang: "BRG-001", hpp: 90000, hpp_baru: null });
  assert.equal(r.ok, true);
  assert.equal(r.kodeBarang, "BRG-001");
  assert.equal(r.adaHpp, true);
  assert.equal(r.hpp, 90000);
  assert.equal(r.adaHppBaru, true);
  assert.equal(r.hppBaru, null);
});

// ---------------------------------------------------------------- F4b hapusAdmin

test("hapusAdmin mock: super admin (env) tidak dapat dihapus", () => {
  const r = guardHapusMock({
    requesterId: "900002",
    targetId: SUPER_ADMIN_ENV_MOCK[0],
    targetAdmin: { role: "owner" },
    jumlahOwner: 2,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.error, "Super admin (env) tidak dapat dihapus dari dashboard.");
});

test("hapusAdmin mock: guard urut sendiri -> tidak ada -> owner terakhir", () => {
  let r = guardHapusMock({
    requesterId: "900001",
    targetId: "900001",
    targetAdmin: { role: "owner" },
    jumlahOwner: 2,
  });
  assert.equal(r.error, "Tidak boleh menghapus akun sendiri.");

  r = guardHapusMock({ requesterId: "900001", targetId: "999", targetAdmin: null, jumlahOwner: 0 });
  assert.equal(r.status, 404);
  assert.equal(r.error, "User tidak ditemukan di daftar admin.");

  r = guardHapusMock({
    requesterId: "900002",
    targetId: "900003",
    targetAdmin: { role: "owner" },
    jumlahOwner: 1,
  });
  assert.equal(r.status, 400);
  assert.equal(r.error, "Owner terakhir tidak boleh dihapus.");
});

test("hapusAdmin mock: admin biasa (bukan env) boleh dihapus", () => {
  const r = guardHapusMock({
    requesterId: "900001",
    targetId: "900003",
    targetAdmin: { role: "guest" },
    jumlahOwner: 1,
  });
  assert.equal(r.ok, true);
});

test("isSuperAdminEnvMock: hanya id di daftar env", () => {
  assert.equal(isSuperAdminEnvMock(SUPER_ADMIN_ENV_MOCK[0]), true);
  assert.equal(isSuperAdminEnvMock("900003"), false);
  assert.equal(typeof isSuperAdminEnvMock("900003"), "boolean");
});

test("superAdminMock: owner true, admin/guest false (boolean)", () => {
  for (const role of ["owner", "admin", "guest"]) {
    assert.equal(typeof superAdminMock(role), "boolean");
  }
  assert.equal(superAdminMock("owner"), true);
  assert.equal(superAdminMock("admin"), false);
  assert.equal(superAdminMock("guest"), false);
});
