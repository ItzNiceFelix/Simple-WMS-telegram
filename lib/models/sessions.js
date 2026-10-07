// lib/models/sessions.js
// CRUD untuk koleksi `sessions` — memori percakapan per admin (sliding window).
// Window ~10-15 turn terakhir, auto-reset kalau sudah lama tidak aktif (30 menit).

const { db } = require("../firebase");

const KOLEKSI = "sessions";
const MAKS_TURN_DISIMPAN = 5;
const DURASI_AUTO_RESET_MENIT = 10;

async function ambilSession(telegramUserId) {
  const doc = await db.collection(KOLEKSI).doc(String(telegramUserId)).get();
  if (!doc.exists) return null;
  return { telegram_user_id: doc.id, ...doc.data() };
}

function apakahSessionExpired(session) {
  if (!session || !session.last_updated) return true;
  const lastUpdated = session.last_updated.toDate?.() || new Date(session.last_updated);
  const menitBerlalu = (Date.now() - lastUpdated.getTime()) / (1000 * 60);
  return menitBerlalu > DURASI_AUTO_RESET_MENIT;
}

// Ambil session yang siap dipakai: kalau tidak ada atau sudah expired, dianggap history kosong.
async function ambilSessionAktif(telegramUserId) {
  const session = await ambilSession(telegramUserId);
  if (!session || apakahSessionExpired(session)) {
    return { telegram_user_id: String(telegramUserId), history: [], last_updated: null };
  }
  return session;
}

async function tambahPesanKeSession(telegramUserId, role, content) {
  const ref = db.collection(KOLEKSI).doc(String(telegramUserId));
  const hasil = await db.runTransaction(async (trx) => {
    const doc = await trx.get(ref);
    const data = doc.exists ? doc.data() : {};
    const now = new Date();
    const lastUpdated = data.last_updated?.toDate?.() || new Date(data.last_updated || now);
    const menitBerlalu = (Date.now() - lastUpdated.getTime()) / (1000 * 60);
    const expired = menitBerlalu > DURASI_AUTO_RESET_MENIT;
    const historyLama = (!doc.exists || expired) ? [] : (data.history || []);
    const historyBaru = [...historyLama, { role, content, ts: now }].slice(-MAKS_TURN_DISIMPAN);
    trx.set(ref, { history: historyBaru, last_updated: now }, { merge: true });
    return { history: historyBaru, last_updated: now };
  });
  return { telegram_user_id: String(telegramUserId), ...hasil };
}

async function resetSession(telegramUserId) {
  const payload = { history: [], last_updated: new Date() };
  await db.collection(KOLEKSI).doc(String(telegramUserId)).set(payload, { merge: true });
  return { telegram_user_id: String(telegramUserId), ...payload };
}

// Semua field "pending*" yang pernah dipakai lintas fitur (kurangiStok/tambahStok,
// opname, picking list, sync stok, dan konfirmasi cakupan pencarian produk).
// Dipakai command /batal — beda dari /reset yang cuma bersihin history percakapan.
// Kalau nanti nambah state pending baru, WAJIB didaftarkan di sini juga.
const SEMUA_FIELD_PENDING = [
  "pendingAction",
  "pendingBatchAction", // batch kurangiStok/tambahStok (banyak produk dalam 1 pesan)
  "pendingOpname",
  "pendingPickingList",
  "pendingSyncStok",
  "pendingKonfirmasiCakupan",
];

async function hapusSemuaPendingState(telegramUserId) {
  const admin = require("firebase-admin");
  const payload = { last_updated: admin.firestore.FieldValue.serverTimestamp() };
  for (const field of SEMUA_FIELD_PENDING) {
    payload[field] = admin.firestore.FieldValue.delete();
  }
  await db.collection(KOLEKSI).doc(String(telegramUserId)).set(payload, { merge: true });
}

module.exports = {
  ambilSession,
  ambilSessionAktif,
  apakahSessionExpired,
  tambahPesanKeSession,
  resetSession,
  hapusSemuaPendingState,
};