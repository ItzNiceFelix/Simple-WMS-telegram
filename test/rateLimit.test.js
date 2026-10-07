// test/rateLimit.test.js
// Rate limiter in-memory: di bawah batas lolos, lewat batas diblokir. Tanpa Firestore.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AI_RATE_LIMIT_PER_MINUTE = "3";

const { apakahKenaRateLimit } = require("../lib/gemini/rateLimit");

test("di bawah batas -> lolos", () => {
  const user = "uji-bawah";
  assert.equal(apakahKenaRateLimit(user), false);
  assert.equal(apakahKenaRateLimit(user), false);
  assert.equal(apakahKenaRateLimit(user), false);
});

test("lewat batas -> diblokir", () => {
  const user = "uji-atas";
  assert.equal(apakahKenaRateLimit(user), false);
  assert.equal(apakahKenaRateLimit(user), false);
  assert.equal(apakahKenaRateLimit(user), false);
  assert.equal(apakahKenaRateLimit(user), true, "panggilan ke-4 harus diblokir");
  assert.equal(apakahKenaRateLimit(user), true, "tetap diblokir dalam jendela yg sama");
});

test("user beda -> punya hitungan sendiri", () => {
  const user = "uji-beda";
  assert.equal(apakahKenaRateLimit(user), false);
  assert.equal(apakahKenaRateLimit(user), false);
  assert.equal(apakahKenaRateLimit(user), false);
  assert.equal(apakahKenaRateLimit("uji-bawah"), true, "user lain tetap kena limitnya sendiri");
});
