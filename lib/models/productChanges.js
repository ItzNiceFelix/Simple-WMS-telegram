// lib/models/productChanges.js
// Audit perubahan data master produk (HPP, HPP baru, reorder point).
// Satu baris per field yang berubah. Ditulis HANYA oleh route server (admin SDK),
// bot tidak pernah menyentuh koleksi ini di v2.
const { db } = require("../firebase");

async function catatPerubahanProduk({ kodeBarang, field, nilaiLama, nilaiBaru, changedBy }) {
  const payload = {
    kode_barang: kodeBarang,
    field,
    nilai_lama: nilaiLama ?? null,
    nilai_baru: nilaiBaru ?? null,
    changed_by: String(changedBy),
    created_at: new Date(),
  };
  const ref = await db.collection("product_changes").add(payload);
  return { id: ref.id, ...payload };
}

module.exports = { catatPerubahanProduk };
