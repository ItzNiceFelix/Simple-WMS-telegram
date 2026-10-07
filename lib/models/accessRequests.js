// lib/models/accessRequests.js
// CRUD untuk koleksi `access_requests` — antrean approval Super Admin untuk user baru
// yang DM bot (alur lengkap ada di bagian 4H dokumen).

const { db } = require("../firebase");

const KOLEKSI = "access_requests";
const DURASI_COOLDOWN_MS = 60 * 60 * 1000; // 1 jam, sesuai keputusan di dokumen

async function ambilAccessRequest(telegramUserId) {
  const doc = await db.collection(KOLEKSI).doc(String(telegramUserId)).get();
  if (!doc.exists) return null;
  return { telegram_user_id: doc.id, ...doc.data() };
}

// Dipanggil saat user baru (belum ada entry sama sekali) DM bot pertama kali.
async function buatAccessRequestBaru(telegramUserId, { username, displayName }) {
  const payload = {
    status: "pending",
    requested_at: new Date(),
    telegram_username: username || null,
    telegram_display_name: displayName,
    rejected_until: null,
    resolved_by: null,
    resolved_at: null,
  };
  await db.collection(KOLEKSI).doc(String(telegramUserId)).set(payload);
  return { telegram_user_id: String(telegramUserId), ...payload };
}

// v3b B4: compare-and-set ATOMIK. Di dalam transaksi BACA dokumen, lalu tulis HANYA bila
// status === "pending"; selain itu batalkan transaksi & lempar sentinel:
//   - Error("TIDAK_ADA")     -> dokumen tidak ada            (route -> 404)
//   - Error("SUDAH_DIPROSES") -> status != "pending"          (route -> 409)
// Signature TIDAK berubah: (telegramUserId, superAdminId). Guard bot lama
// (handleApprovalCallback.js:101) tetap sukses karena status memang masih "pending".
async function _ubahStatusAccessRequest(telegramUserId, superAdminId, buatPayload) {
  const ref = db.collection(KOLEKSI).doc(String(telegramUserId));
  const payload = buatPayload(superAdminId);
  await db.runTransaction(async (trx) => {
    const doc = await trx.get(ref);
    if (!doc.exists) throw new Error("TIDAK_ADA");
    if (doc.data().status !== "pending") throw new Error("SUDAH_DIPROSES");
    trx.update(ref, payload);
  });
  // Write SUDAH commit di titik ini. Read-back HANYA untuk melengkapi nilai balikan; bila
  // read-back gagal, JANGAN lempar (itu akan membuat pemanggil melihat 500 padahal sukses).
  const idStr = String(telegramUserId);
  try {
    const lengkap = await ambilAccessRequest(telegramUserId);
    if (lengkap) return lengkap;
  } catch (e) {
    console.error("[access_request_readback_failed]", idStr, e);
  }
  return { telegram_user_id: idStr, ...payload };
}

async function setujuiAccessRequest(telegramUserId, superAdminId) {
  return _ubahStatusAccessRequest(telegramUserId, superAdminId, (by) => ({
    status: "approved",
    resolved_by: by,
    resolved_at: new Date(),
  }));
}

// rejected_until = sekarang + 1 jam, sesuai cooldown "diam total" di bagian 4H.
async function tolakAccessRequest(telegramUserId, superAdminId) {
  return _ubahStatusAccessRequest(telegramUserId, superAdminId, (by) => ({
    status: "rejected",
    rejected_until: new Date(Date.now() + DURASI_COOLDOWN_MS),
    resolved_by: by,
    resolved_at: new Date(),
  }));
}

// Saat admin di-revoke, status akses lama harus ditutup agar user perlu request ulang.
async function revokeAccessRequest(telegramUserId, superAdminId) {
  const payload = {
    status: "revoked",
    rejected_until: null,
    resolved_by: superAdminId,
    resolved_at: new Date(),
    revoked_by: superAdminId,
    revoked_at: new Date(),
  };

  const ref = db.collection(KOLEKSI).doc(String(telegramUserId));
  const existing = await ref.get();
  if (existing.exists) {
    await ref.update(payload);
  } else {
    await ref.set(payload);
  }

  return ambilAccessRequest(telegramUserId);
}

// Cek apakah user masih dalam window cooldown "diam total" setelah ditolak.
function apakahMasihDalamCooldown(accessRequest) {
  if (!accessRequest || accessRequest.status !== "rejected") return false;
  if (!accessRequest.rejected_until) return false;
  const rejectedUntil =
    accessRequest.rejected_until.toDate?.() || new Date(accessRequest.rejected_until);
  return rejectedUntil.getTime() > Date.now();
}

// Helper status gabungan dipakai router: menentukan langkah bot berikutnya untuk user ini.
// Return salah satu: "belum_pernah" | "pending" | "cooldown" | "boleh_request_baru" | "approved" | "rejected_expired"
async function tentukanStatusAkses(telegramUserId) {
  const req = await ambilAccessRequest(telegramUserId);
  if (!req) return "belum_pernah";
  if (req.status === "pending") return "pending";
  if (req.status === "approved") return "approved";
  if (req.status === "revoked") return "boleh_request_baru";
  if (req.status === "rejected") {
    return apakahMasihDalamCooldown(req) ? "cooldown" : "boleh_request_baru";
  }
  return "belum_pernah";
}

module.exports = {
  ambilAccessRequest,
  buatAccessRequestBaru,
  setujuiAccessRequest,
  tolakAccessRequest,
  revokeAccessRequest,
  apakahMasihDalamCooldown,
  tentukanStatusAkses,
};
