// test/accessRequests.test.js
// Versi tipis dari scripts/verifikasi-revoke-admin.js (script itu self-execute
// dan process.exit, jadi tidak cocok dijalankan dari node:test).
// Dua assertion sama: approved -> "approved", revoked -> "boleh_request_baru".

const crypto = require("crypto");
const test = require("node:test");
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

const { installMockFirestore } = require("./helpers/mockFirestore");
const { db } = installMockFirestore();

const { tentukanStatusAkses } = require("../lib/models/accessRequests");

test("approved -> approved", async () => {
  await db.collection("access_requests").doc("approved-user").set({ status: "approved" });
  assert.equal(await tentukanStatusAkses("approved-user"), "approved");
});

test("revoked -> boleh_request_baru", async () => {
  await db.collection("access_requests").doc("revoked-user").set({ status: "revoked" });
  assert.equal(await tentukanStatusAkses("revoked-user"), "boleh_request_baru");
});
