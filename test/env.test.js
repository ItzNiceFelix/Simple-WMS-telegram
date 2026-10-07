// test/env.test.js
// Validasi env fail-fast: kumpulkan SEMUA yang hilang, dan no-op saat lengkap.

const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

// Env dummy supaya require api/webhook (di test P3-B) tidak crash saat load:
// modul turunannya (lib/firebase, lib/gemini/client) init saat require.
// Yang diuji bukan nilai ini, tapi validasi call-time di dalam handler.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-project";
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "demo@example.com";
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ||
  crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .replace(/\n/g, "\\n");
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-gemini-key";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "dummy-token";

const { wajibkanEnv } = require("../lib/config/env");

// Env yang dipakai test ini — simpan nilai asli buat di-restore.
const NAMA_DIPAKAI = ["ENV_TEST_A", "ENV_TEST_B", "ENV_TEST_C"];
const asli = {};
for (const nama of NAMA_DIPAKAI) asli[nama] = process.env[nama];

function pulihkan() {
  for (const nama of NAMA_DIPAKAI) {
    if (asli[nama] === undefined) delete process.env[nama];
    else process.env[nama] = asli[nama];
  }
}

test.afterEach(pulihkan);
test.after(pulihkan);

test("wajibkanEnv menyebut SEMUA nama yang hilang dalam satu Error", () => {
  delete process.env.ENV_TEST_A;
  process.env.ENV_TEST_B = "   "; // kosong setelah trim -> tetap dianggap hilang
  delete process.env.ENV_TEST_C;

  assert.throws(
    () => wajibkanEnv(["ENV_TEST_A", "ENV_TEST_B", "ENV_TEST_C"], "unit-test"),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /unit-test/);
      assert.ok(err.message.includes("ENV_TEST_A"));
      assert.ok(err.message.includes("ENV_TEST_B"));
      assert.ok(err.message.includes("ENV_TEST_C"));
      return true;
    }
  );
});

test("wajibkanEnv tidak melempar saat semua terisi", () => {
  process.env.ENV_TEST_A = "a";
  process.env.ENV_TEST_B = "b";
  process.env.ENV_TEST_C = "c";
  assert.doesNotThrow(() => wajibkanEnv(NAMA_DIPAKAI, "unit-test"));
});

// P3-B: webhook harus balas 500 {ok:false} saat env wajib hilang (fail-fast rapi,
// bukan crash cold start). Env dihapus lalu di-restore di dalam test.
test("api/webhook.js -> 500 {ok:false} saat env wajib hilang", async () => {
  const namaWajib = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "GEMINI_API_KEY",
  ];
  const asli = {};
  for (const nama of namaWajib) asli[nama] = process.env[nama];

  try {
    // Require DULU saat env lengkap: routePesan menarik modul yang init Firebase
    // saat load, jadi kalau env dihapus sebelum require malah throw di require-time,
    // bukan di handler. Yang diuji: validasi env DI DALAM handler (call-time).
    const handler = require("../api/webhook");

    delete process.env.FIREBASE_PROJECT_ID;

    let statusKode = null;
    let bodyJson = null;
    const resFake = {
      status(kode) {
        statusKode = kode;
        return this;
      },
      json(payload) {
        bodyJson = payload;
        return this;
      },
    };
    const reqFake = { method: "POST", headers: {}, body: {} };

    await handler(reqFake, resFake);

    assert.strictEqual(statusKode, 500);
    assert.deepEqual(bodyJson, { ok: false, error: "Konfigurasi server tidak lengkap" });
  } finally {
    for (const nama of namaWajib) {
      if (asli[nama] === undefined) delete process.env[nama];
      else process.env[nama] = asli[nama];
    }
  }
});
