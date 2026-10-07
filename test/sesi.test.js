// test/sesi.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.DASHBOARD_SESSION_SECRET = "rahasia-uji-panjang";

const {
  buatTokenSesi,
  verifikasiTokenSesi,
  atributCookie,
  ambilTokenDariCookie,
  UMUR_SESI_DETIK,
} = require("../lib/dashboard/auth/sesi");

const AUTH_DATE = 1_700_000_000; // detik
const NOW = AUTH_DATE * 1000 + 60_000; // 1 menit setelah auth

test("token sesi valid -> payload sesuai", () => {
  const token = buatTokenSesi({ userId: 900001, role: "owner", authDate: AUTH_DATE });
  const payload = verifikasiTokenSesi(token, { now: NOW });
  assert.equal(payload.uid, "900001");
  assert.equal(payload.role, "owner");
  assert.equal(payload.exp, AUTH_DATE + UMUR_SESI_DETIK);
});

test("token tampered -> null", () => {
  const token = buatTokenSesi({ userId: 1, role: "guest", authDate: AUTH_DATE });
  const [p] = token.split(".");
  assert.equal(verifikasiTokenSesi(`${p}.salah`, { now: NOW }), null);
});

test("token kedaluwarsa (auth_date + 60 menit) -> null", () => {
  const token = buatTokenSesi({ userId: 1, role: "admin", authDate: AUTH_DATE });
  const lewat = (AUTH_DATE + UMUR_SESI_DETIK + 1) * 1000;
  assert.equal(verifikasiTokenSesi(token, { now: lewat }), null);
});

test("token diformat salah -> null", () => {
  for (const bad of ["", "abc", "a.b.c", null, 123]) {
    assert.equal(verifikasiTokenSesi(bad, { now: NOW }), null);
  }
});

test("cookie sesi punya atribut wajib", () => {
  const c = atributCookie("tok", { maxAge: 3600 });
  for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=3600"]) {
    assert.ok(c.includes(attr), `cookie harus memuat ${attr}`);
  }
});

test("ambilTokenDariCookie mengekstrak nilai", () => {
  assert.equal(ambilTokenDariCookie("a=1; dat_sesi=xyz; b=2"), "xyz");
  assert.equal(ambilTokenDariCookie("a=1"), null);
  assert.equal(ambilTokenDariCookie(undefined), null);
});
