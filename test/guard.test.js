// test/guard.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { tolakOrigin, cekRateLimit, resetRateLimit } = require("../lib/dashboard/auth/guard");

function fakeRequest(headers = {}) {
  return { headers: { get: (k) => headers[k] ?? null } };
}

test("origin tidak di allowlist -> 403", () => {
  process.env.DASHBOARD_ALLOWED_ORIGINS = "https://mini.example.com";
  const r = tolakOrigin(fakeRequest({ origin: "https://jahat.example.com" }));
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("origin di allowlist -> lolos", () => {
  process.env.DASHBOARD_ALLOWED_ORIGINS = "https://mini.example.com";
  const r = tolakOrigin(fakeRequest({ origin: "https://mini.example.com" }));
  assert.equal(r.ok, true);
});

test("trailing slash di allowlist tetap cocok (Origin header tanpa slash)", () => {
  process.env.DASHBOARD_ALLOWED_ORIGINS = "https://bot-admin-toko.vercel.app/";
  assert.equal(
    tolakOrigin(fakeRequest({ origin: "https://bot-admin-toko.vercel.app" })).ok,
    true
  );
});

test("trailing slash di Origin juga dinormalkan", () => {
  process.env.DASHBOARD_ALLOWED_ORIGINS = "https://mini.example.com";
  assert.equal(
    tolakOrigin(fakeRequest({ origin: "https://mini.example.com/" })).ok,
    true
  );
});

test("beberapa origin dipisah koma; spasi diabaikan", () => {
  process.env.DASHBOARD_ALLOWED_ORIGINS =
    "https://a.example.com/ , https://b.example.com";
  assert.equal(tolakOrigin(fakeRequest({ origin: "https://a.example.com" })).ok, true);
  assert.equal(tolakOrigin(fakeRequest({ origin: "https://b.example.com" })).ok, true);
  assert.equal(tolakOrigin(fakeRequest({ origin: "https://c.example.com" })).ok, false);
});

test("rate limit: ke-21 dalam 60s -> 429", () => {
  resetRateLimit();
  for (let i = 0; i < 20; i++) {
    assert.equal(cekRateLimit("u:1", 20).ok, true, `ke-${i + 1} harus lolos`);
  }
  const r = cekRateLimit("u:1", 20);
  assert.equal(r.ok, false);
  assert.equal(r.status, 429);
});

test("rate limit terpisah per kunci", () => {
  resetRateLimit();
  for (let i = 0; i < 20; i++) cekRateLimit("a", 20);
  assert.equal(cekRateLimit("b", 20).ok, true);
});
