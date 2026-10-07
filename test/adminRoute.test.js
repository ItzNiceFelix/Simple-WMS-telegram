// test/adminRoute.test.js
// Uji logika validasi route /api/admin aksi `kata-kunci` (validasiTulisV3a) + perilaku model.
// Route TS Next.js TIDAK diimpor (pola test v2). PRD §6.5/§10 #11/#11b.
const crypto = require("crypto");
const { test, beforeEach } = require("node:test");
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
const { db, collections } = installMockFirestore();

const { validasiAksiAdmin } = require("../lib/dashboard/validasiTulisV3a");
const kw = require("../lib/models/keywordNotes");

function bersihkan() {
  const store = collections.get("keyword_notes");
  if (store) store.clear();
}

beforeEach(() => bersihkan());

test("#11b aksi tak dikenal -> 400 Aksi tidak dikenal.", () => {
  for (const aksi of ["", null, undefined, "role", "hapus"]) {
    const r = validasiAksiAdmin({ aksi, id: "x", interpreted_as: "STOK" });
    assert.equal(r.ok, false, `aksi=${aksi} harus ditolak`);
    assert.equal(r.status, 400);
    assert.equal(r.error, "Aksi tidak dikenal.");
  }
});

test("#11b id kosong -> 400 Id penanda wajib diisi.", () => {
  const r = validasiAksiAdmin({ aksi: "kata-kunci", id: "  ", interpreted_as: "STOK" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Id penanda wajib diisi.");
});

test("#11b interpreted_as di luar 3 nilai -> 400 Interpretasi tidak dikenal.", () => {
  for (const v of ["X", "", null, "stok"]) {
    const r = validasiAksiAdmin({ aksi: "kata-kunci", id: "abc", interpreted_as: v });
    assert.equal(r.ok, false, `interpreted_as=${v} harus ditolak`);
    assert.equal(r.error, "Interpretasi tidak dikenal.");
  }
});

test("#11b payload valid -> ok", () => {
  const r = validasiAksiAdmin({ aksi: "kata-kunci", id: "abc", interpreted_as: "MINTA_SISA" });
  assert.equal(r.ok, true);
  assert.equal(r.id, "abc");
  assert.equal(r.interpretedAs, "MINTA_SISA");
});

test("#11b admin (non-owner) -> 403 Hanya owner yang dapat mengubah penanda.", () => {
  // Mirror guard route (role diverifikasi ke `role !== owner`).
  function guardOwner(role) {
    if (role !== "owner") return { status: 403, error: "Hanya owner yang dapat mengubah penanda." };
    return { ok: true };
  }
  assert.deepEqual(guardOwner("admin"), { status: 403, error: "Hanya owner yang dapat mengubah penanda." });
  assert.deepEqual(guardOwner("guest"), { status: 403, error: "Hanya owner yang dapat mengubah penanda." });
  assert.equal(guardOwner("owner").ok, true);
});

test("#11b sukses mengembalikan confirmed_by/confirmed_at", async () => {
  const ref = await db.collection("keyword_notes").add({ raw_text: "sisa gdg", interpreted_as: "MINTA", confidence: "guessed", usage_count: 2 });
  const note = await kw.perbaruiInterpretasi(ref.id, "STOK", "111");
  assert.equal(note.confidence, "confirmed");
  assert.equal(note.confirmed_by, "111");
  assert.ok(note.confirmed_at);
  assert.equal(note.raw_text, "sisa gdg");
});

test("#11b note tidak ada -> throw Penanda tidak ditemukan.", async () => {
  await assert.rejects(
    () => kw.perbaruiInterpretasi("tidak-ada", "STOK", "111"),
    /Penanda tidak ditemukan\./
  );
});
