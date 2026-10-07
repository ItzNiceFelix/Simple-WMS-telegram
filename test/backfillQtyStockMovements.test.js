// test/backfillQtyStockMovements.test.js
// Uji logika normalisasi tanda qty di script migrasi (pure function hitungQtyTarget).
const crypto = require("crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-project";
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "demo@example.com";
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ||
  crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .replace(/\n/g, "\\n");

const { hitungQtyTarget } = require("../scripts/backfillQtyStockMovements");

test("kurangi_stok -> qty negatif", () => {
  assert.deepEqual(hitungQtyTarget({ action_type: "kurangi_stok", qty: 3 }), { aksi: "ubah", qty: -3 });
  assert.deepEqual(hitungQtyTarget({ action_type: "kurangi_stok", qty: -3 }), { aksi: "ubah", qty: -3 });
});

test("tambah_stok -> qty positif", () => {
  assert.deepEqual(hitungQtyTarget({ action_type: "tambah_stok", qty: -5 }), { aksi: "ubah", qty: 5 });
});

test("opname -> qty = selisih", () => {
  assert.deepEqual(hitungQtyTarget({ type: "opname", selisih: -2, qty: 8 }), { aksi: "ubah", qty: -2 });
});

test("opname tanpa selisih -> dilewati", () => {
  assert.deepEqual(hitungQtyTarget({ type: "opname", selisih: null }), { aksi: "lewati" });
});

test("source web_dashboard dilewati (sudah benar)", () => {
  assert.deepEqual(hitungQtyTarget({ source: "web_dashboard", action_type: "kurangi_stok", qty: -3 }), {
    aksi: "lewati",
  });
});

test("sync_confirmed tanpa info stok sebelumnya -> manual (tidak menebak)", () => {
  assert.deepEqual(hitungQtyTarget({ type: "sync_confirmed", qty: 10 }), { aksi: "manual", qty: 0 });
});

test("action_type lain (perlu_request) -> dilewati", () => {
  assert.deepEqual(hitungQtyTarget({ action_type: "perlu_request", qty: 4 }), { aksi: "lewati" });
});
