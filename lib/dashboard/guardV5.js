/**
 * lib/dashboard/guardV5.js
 * Guard dobel-proses untuk aksi tulis v5 (BR11 kategori A). Server-only (firestore.rules deny).
 *
 * Pola sama dengan lib/dashboard/draftGuard.js + app/api/stok/mutasi/route.ts:132-147:
 * dokumen per (aksi, uid), payload pembanding, TTL 10 detik. BEST-EFFORT: kegagalan guard
 * TIDAK boleh memblokir tulis yang sah (pengaman utama = CAS transaksi).
 *
 * CJS murni supaya bisa dipakai route TS via createRequire.
 */
const TTL_MS = 10_000;

/** Koleksi guard v5 (semua server-only, deny di firestore.rules). */
const KOLEKSI = {
  permintaan: "permintaan_gudang_guard",
  opname: "opname_gudang_guard",
  gudang: "gudang_guard",
  stokGudang: "stok_gudang_guard",
  produkOnline: "produk_online_guard",
};

function kunciGuard(aksi, uid) {
  return String(aksi) + ":" + String(uid);
}

/**
 * Guard aktif? Aktif = dokumen ada, field waktu dalam TTL, DAN payload pembanding cocok.
 * pembanding opsional: objek {field: value} yang harus sama supaya dianggap duplikat.
 * Bila pembanding tidak cocok -> BUKAN duplikat (aksi berbeda, boleh jalan).
 */
async function guardAktif(db, koleksi, kunci, pembanding = null, now = Date.now()) {
  const doc = await db.collection(koleksi).doc(kunci).get();
  if (!doc.exists) return false;
  const data = doc.data() || {};
  const ms = normalisasiMillis(data.at);
  if (!Number.isFinite(ms) || now - ms > TTL_MS) return false;
  if (pembanding) {
    for (const [k, v] of Object.entries(pembanding)) {
      if (JSON.stringify(data[k]) !== JSON.stringify(v)) return false;
    }
  }
  return true;
}

/** Tulis guard. Best-effort: caller menangkap error (jangan blokir tulis sah). */
async function tulisGuard(db, koleksi, kunci, payload = {}) {
  await db.collection(koleksi).doc(kunci).set({ ...payload, at: Date.now() }, { merge: false });
}

function normalisasiMillis(at) {
  if (typeof at === "number") return at;
  if (at instanceof Date) return at.getTime();
  if (at && typeof at.toMillis === "function") return at.toMillis();
  if (at && typeof at.seconds === "number") return at.seconds * 1000;
  return NaN;
}

module.exports = { TTL_MS, KOLEKSI, kunciGuard, guardAktif, tulisGuard, normalisasiMillis };
