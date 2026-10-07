// test/indexFirestore.test.js
// Regresi insiden produksi: query `stock_movements` dengan SATU equality + `orderBy(created_at)`
// membutuhkan COMPOSITE INDEX. Saat index `(status, created_at)` hilang, halaman Ringkasan dan
// Draft gagal di deploy nyata ("Coba lagi") padahal:
//   - npm test hijau (mock tidak menyentuh Firestore)
//   - e2e hijau (selalu mode mock)
//   - tsc hijau
// Jadi kelas bug ini TIDAK terlihat gate apa pun. Test ini membandingkan sumber kode query
// (`lib/dashboard/data/real.ts`) dengan `firestore.indexes.json` supaya ketahuan saat `npm test`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AKAR = path.join(__dirname, "..");

/** Field equality yang mungkin dipakai `MovementFilter` (urutan cek SAMA dengan real.ts). */
const FIELD_EQUALITY = ["kode_barang", "type", "status", "created_by"];

/** Field yang di-`orderBy` di listMovements. */
const FIELD_ORDER = "created_at";

/** Baca daftar index dari firestore.indexes.json. */
function bacaIndex() {
  const j = JSON.parse(fs.readFileSync(path.join(AKAR, "firestore.indexes.json"), "utf8"));
  return {
    stock_movements: j.indexes
      .filter((i) => i.collectionGroup === "stock_movements")
      .map((i) => i.fields.map((f) => ({ field: f.fieldPath, order: f.order }))),
  };
}

/**
 * Apakah ada index yang melayani `where(equality) + orderBy(order)`.
 * Aturan Firestore: field equality boleh dalam urutan bebas, TAPI field orderBy harus mengikuti
 * SETELAH seluruh field equality, dan arah orderBy harus cocok. `__name__` selalu ikut di akhir.
 */
function adaIndexPendukung(indexes, equality, orderField, orderArah) {
  return indexes.some((idx) => {
    const tanpaNama = idx.filter((f) => f.field !== "__name__");
    const eqDiIndex = tanpaNama.filter((f) => equality.includes(f.field));
    // Semua field equality harus ada di index (prefix), dan field order harus ada.
    if (eqDiIndex.length !== equality.length) return false;
    const posOrder = tanpaNama.findIndex((f) => f.field === orderField);
    if (posOrder === -1) return false;
    // Order field harus SESUDAH semua equality.
    if (posOrder < equality.length) return false;
    return tanpaNama[posOrder].order === orderArah;
  });
}

test("setiap equality + orderBy(created_at) di stock_movements punya composite index", () => {
  const idx = bacaIndex().stock_movements;
  assert.ok(idx.length > 0, "firestore.indexes.json harus memuat index stock_movements");

  // real.ts memakai cabang else-if: HANYA SATU equality yang aktif per query.
  const hilang = [];
  for (const field of FIELD_EQUALITY) {
    if (!adaIndexPendukung(idx, [field], FIELD_ORDER, "DESCENDING")) hilang.push(field);
  }

  assert.deepEqual(
    hilang,
    [],
    `Query where(${FIELD_EQUALITY.join("|")} == ...) + orderBy(created_at desc) TANPA index akan ` +
      "GAGAL di produksi (Firestore minta composite index). Index yang hilang untuk field: " +
      hilang.join(", ")
  );
});

test("real.ts masih memakai satu equality + orderBy(created_at) seperti asumsi test ini", () => {
  // Kontrak test ini bergantung pada bentuk query di real.ts. Bila berubah, test WAJIB ikut
  // diperbarui - jadi bentuk itu dikunci di sini supaya perubahan tidak diam-diam melewatkan guard.
  const sumber = fs.readFileSync(path.join(AKAR, "lib", "dashboard", "data", "real.ts"), "utf8");
  assert.ok(
    sumber.includes('orderBy("created_at", "desc")'),
    "listMovements harus masih orderBy created_at desc; perbarui guard index bila berubah."
  );
  for (const field of FIELD_EQUALITY) {
    assert.ok(
      sumber.includes(`where("${field}", "=="`),
      `listMovements harus masih mendukung equality "${field}".`
    );
  }
});
