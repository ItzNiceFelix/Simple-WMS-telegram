// test/bacaUidToken.test.js
// Regresi bug "Coba lagi" di mode real: `masukDenganCustomToken` dulu SKIP login saat
// `currentUser` sudah ada, sehingga sesi Firebase lama (token kedaluwarsa / tanpa claim
// `role`) terus dipakai -> Security Rules menolak semua read. Perbaikan membandingkan uid
// dari payload custom token server; pengurai itu diuji di sini supaya bentuk JWT tak terduga
// (sub bukan string, token rusak) gagal dengan AMAN (null -> login bersih, bukan skip).
const { test } = require("node:test");
const assert = require("node:assert/strict");

// Salinan murni dari `lib/dashboard/data/klien-firebase.ts` (`bacaUidDariToken`). File itu
// TypeScript + "use client" sehingga tidak bisa di-require test CJS; menyalin 10 baris lebih
// murah daripada menambah bundler. Bila logika produksi berubah, test ini WAJIB ikut berubah.
function bacaUidDariToken(token) {
  try {
    const bagian = token.split(".")[1];
    if (!bagian) return null;
    const base64 = bagian.replace(/-/g, "+").replace(/_/g, "/");
    const padat = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(padat, "base64").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function buatJwt(payload) {
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.sig`;
}

test("uid diambil dari payload custom token", () => {
  assert.equal(bacaUidDariToken(buatJwt({ sub: "900001", role: "owner" })), "900001");
});

test("sub bukan string -> null (login bersih, bukan skip)", () => {
  assert.equal(bacaUidDariToken(buatJwt({ sub: 123 })), null);
});

test("token tanpa sub -> null", () => {
  assert.equal(bacaUidDariToken(buatJwt({ role: "owner" })), null);
});

test("token rusak/kosong -> null, tidak melempar", () => {
  for (const buruk of ["", "abc", "a.!!!.c", "a..c"]) {
    assert.equal(bacaUidDariToken(buruk), null);
  }
});
