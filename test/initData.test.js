// test/initData.test.js
// Verifikasi initData Telegram (PRD 11.1/11.2, FR-AUTH-01/02/03).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  InitDataError,
  verifikasiInitData,
  buatInitData,
  susunDataCheckString,
} = require("../lib/dashboard/auth/initData");

const BOT_TOKEN = "123456:TEST-TOKEN-abc";
const USER = { id: 900001, username: "owner_toko", first_name: "Budi" };
const NOW = 1_700_000_000_000; // ms
const AUTH_DATE = Math.floor(NOW / 1000) - 30; // 30 detik lalu

function valid(extra, { user = USER, authDate = AUTH_DATE } = {}) {
  return buatInitData({ botToken: BOT_TOKEN, user, authDate, extra });
}

test("initData valid -> user terparse, id string", () => {
  const hasil = verifikasiInitData(valid(), { botToken: BOT_TOKEN, now: NOW });
  assert.equal(hasil.user.id, "900001");
  assert.equal(hasil.user.username, "owner_toko");
  assert.equal(hasil.authDate, AUTH_DATE);
});

test("user.id numerik dinormalkan ke string", () => {
  const hasil = verifikasiInitData(
    valid(null, { user: { id: 42, first_name: "X" } }),
    { botToken: BOT_TOKEN, now: NOW }
  );
  assert.equal(typeof hasil.user.id, "string");
  assert.equal(hasil.user.id, "42");
});

test("hash salah -> 401", () => {
  const salah = valid().replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64));
  assert.throws(
    () => verifikasiInitData(salah, { botToken: BOT_TOKEN, now: NOW }),
    (e) => e instanceof InitDataError && e.status === 401
  );
});

test("hash kosong/hilang -> 400", () => {
  const tanpaHash = valid().replace(/&?hash=[0-9a-f]+/, "");
  assert.throws(
    () => verifikasiInitData(tanpaHash, { botToken: BOT_TOKEN, now: NOW }),
    (e) => e instanceof InitDataError && e.status === 400
  );
});

test("hash panjang beda -> 401 bukan 500", () => {
  const pendek = valid().replace(/hash=[0-9a-f]+/, "hash=abc");
  assert.throws(
    () => verifikasiInitData(pendek, { botToken: BOT_TOKEN, now: NOW }),
    (e) => e instanceof InitDataError && e.status === 401
  );
});

test("token salah -> 401", () => {
  assert.throws(
    () => verifikasiInitData(valid(), { botToken: "token-lain", now: NOW }),
    (e) => e instanceof InitDataError && e.status === 401
  );
});

test("initData kedaluwarsa (> 3600s) -> 401", () => {
  const tua = valid(null, { authDate: Math.floor(NOW / 1000) - 3601 });
  assert.throws(
    () => verifikasiInitData(tua, { botToken: BOT_TOKEN, now: NOW }),
    (e) => /kedaluwarsa/.test(e.message) && e.status === 401
  );
});

test("auth_date di masa depan (> 60s) -> 401", () => {
  const depan = valid(null, { authDate: Math.floor(NOW / 1000) + 120 });
  assert.throws(
    () => verifikasiInitData(depan, { botToken: BOT_TOKEN, now: NOW }),
    (e) => e instanceof InitDataError && e.status === 401
  );
});

test("auth_date hilang / NaN / non-integer -> 401", () => {
  for (const bad of ["", "abc", "1.5"]) {
    const rusak = buatInitData({
      botToken: BOT_TOKEN,
      user: USER,
      authDate: AUTH_DATE,
    }).replace(/auth_date=\d+/, `auth_date=${bad}`);
    assert.throws(
      () => verifikasiInitData(rusak, { botToken: BOT_TOKEN, now: NOW }),
      (e) => e instanceof InitDataError && e.status === 401,
      `auth_date=${bad} harus ditolak`
    );
  }
});

test("user JSON rusak -> 401", () => {
  const params = new URLSearchParams(valid());
  params.set("user", "{bukan json");
  const { susunDataCheckString: susun, hitungHash: hh } = require("../lib/dashboard/auth/initData");
  params.set("hash", hh(susun(params), BOT_TOKEN));
  assert.throws(
    () => verifikasiInitData(params.toString(), { botToken: BOT_TOKEN, now: NOW }),
    (e) => e instanceof InitDataError && e.status === 401
  );
});

test("user array / id objek -> 401", () => {
  for (const badUser of [[{ id: 1 }], { id: { x: 1 } }]) {
    const params = new URLSearchParams(
      buatInitData({ botToken: BOT_TOKEN, user: USER, authDate: AUTH_DATE })
    );
    params.set("user", JSON.stringify(badUser));
    const { susunDataCheckString: susun, hitungHash: hh } = require("../lib/dashboard/auth/initData");
    params.set("hash", hh(susun(params), BOT_TOKEN));
    assert.throws(
      () => verifikasiInitData(params.toString(), { botToken: BOT_TOKEN, now: NOW }),
      (e) => e instanceof InitDataError && e.status === 401
    );
  }
});

test("data_check_string urut abjad key ASCII", () => {
  const params = new URLSearchParams();
  params.set("user", "{}");
  params.set("auth_date", "1");
  params.set("query_id", "q");
  const s = susunDataCheckString(params);
  assert.equal(s, "auth_date=1\nquery_id=q\nuser={}");
});

test("initData kosong / bukan string -> 400", () => {
  for (const bad of ["", null, undefined, 123]) {
    assert.throws(
      () => verifikasiInitData(bad, { botToken: BOT_TOKEN, now: NOW }),
      (e) => e instanceof InitDataError && e.status === 400
    );
  }
});

test("tanpa botToken -> 500 (konfigurasi server)", () => {
  assert.throws(
    () => verifikasiInitData(valid(), { botToken: "", now: NOW }),
    (e) => e instanceof InitDataError && e.status === 500
  );
});
