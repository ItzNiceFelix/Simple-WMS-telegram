/**
 * lib/dashboard/draftGuard.js
 * Guard dobel-proses lintas-jalur (`draft_kirim_guard`) — PRD v3b §8.5.
 * Dibaca route dashboard DAN bot (bila `cekGuard:true`). Server-only (firestore.rules deny).
 * CJS murni supaya bisa dipakai route TS via createRequire tanpa bundling.
 */
const TTL_MS = 10_000;

function kunciGuard(jenis, id) {
  return `${jenis}:${id}`;
}

/**
 * Baca guard. Aktif = dokumen ada & `at` < TTL.
 * `at` boleh number (route) atau Timestamp/Date (tulis dari jalur lain) — dinormalkan.
 */
async function guardAktif(db, kunci, now = Date.now()) {
  const doc = await db.collection("draft_kirim_guard").doc(kunci).get();
  if (!doc.exists) return false;
  const at = doc.data()?.at;
  let ms = NaN;
  if (typeof at === "number") ms = at;
  else if (at instanceof Date) ms = at.getTime();
  else if (at && typeof at.toMillis === "function") ms = at.toMillis();
  else if (at && typeof at.seconds === "number") ms = at.seconds * 1000;
  return Number.isFinite(ms) && now - ms <= TTL_MS;
}

module.exports = { kunciGuard, guardAktif, TTL_MS };
