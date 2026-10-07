// lib/models/admins.js
// CRUD untuk koleksi `admins` — whitelist pengguna bot (owner/admin/guest).

const { db } = require("../firebase");
const { catatPerubahanRole } = require("./adminRoleChanges");

const KOLEKSI = "admins";

async function ambilAdmin(telegramUserId) {
  const doc = await db.collection(KOLEKSI).doc(String(telegramUserId)).get();
  if (!doc.exists) return null;
  return { telegram_user_id: doc.id, ...doc.data() };
}

async function isAdmin(telegramUserId) {
  const admin = await ambilAdmin(telegramUserId);
  return admin !== null;
}

// Cek Super Admin: role "owner" di Firestore ATAU cocok dengan env SUPER_ADMIN_ID
// (source of truth cadangan, tetap jalan walau ada masalah di data Firestore — bagian 4H).
function isSuperAdminDariEnv(telegramUserId) {
  const superAdminEnv = process.env.SUPER_ADMIN_ID;
  if (!superAdminEnv) return false;
  // Siap-siap kalau nanti diubah jadi array (dipisah koma), sesuai catatan di dokumen.
  const daftarSuperAdmin = superAdminEnv.split(",").map((id) => id.trim());
  return daftarSuperAdmin.includes(String(telegramUserId));
}

async function isSuperAdmin(telegramUserId) {
  if (isSuperAdminDariEnv(telegramUserId)) return true;
  const admin = await ambilAdmin(telegramUserId);
  return admin?.role === "owner";
}

async function ambilIdentitasAdmin(telegramUserId, { username = null, name = null } = {}) {
  if (telegramUserId === null || telegramUserId === undefined) {
    return { telegram_user_id: null, telegram_username: username, name };
  }
  const admin = await ambilAdmin(telegramUserId);
  return {
    telegram_user_id: String(telegramUserId),
    telegram_username: username || admin?.telegram_username || null,
    name: name || admin?.name || null,
  };
}

// Tambah admin baru. approvedBy diisi user_id Super Admin yang approve (null kalau owner/admin awal).
async function tambahAdmin(telegramUserId, { name, role = "guest", approvedBy = null, username = null, jabatan = null, gudang_id = null }) {
  const payload = {
    name,
    telegram_username: username || null,
    role, // "owner" | "admin" | "guest"
    // v5: jabatan (label kosmetik) + gudang_id (scope kerja). TIDAK memengaruhi permission.
    jabatan: jabatan || null,
    gudang_id: gudang_id ? String(gudang_id) : null,
    added_at: new Date(),
    approved_by: approvedBy,
  };
  await db.collection(KOLEKSI).doc(String(telegramUserId)).set(payload);
  return { telegram_user_id: String(telegramUserId), ...payload };
}

async function updateNamaAdmin(telegramUserId, namaBaru) {
  await db.collection(KOLEKSI).doc(String(telegramUserId)).update({ name: namaBaru });
  return ambilAdmin(telegramUserId);
}

async function updateUsernameAdmin(telegramUserId, username) {
  if (!username) return;
  const ref = db.collection(KOLEKSI).doc(String(telegramUserId));
  const doc = await ref.get();
  if (!doc.exists) return;
  await ref.set(
    { telegram_username: username },
    { merge: true }
  );
}

// Opsi D (PRD v2 §8.2): model mencatat audit role SENDIRI supaya tidak mungkin
// lupa (audit bocor). `catatAudit: false` = escape hatch utk skrip/migrasi non-audit.
async function updateRoleAdmin(telegramUserId, roleBaru, diubahOleh, { catatAudit = true } = {}) {
  const admin = await ambilAdmin(telegramUserId);
  if (!admin) return { error: "User belum terdaftar sebagai admin." };
  if (String(telegramUserId) === String(diubahOleh)) {
    return { error: "Tidak boleh mengubah role diri sendiri." };
  }

  const roleLama = admin.role || "guest";
  if (roleLama === roleBaru) return { error: `Role user sudah ${roleBaru}.` };

  if (roleLama === "owner" && roleBaru !== "owner") {
    const owners = await ambilSemuaAdminByRole("owner");
    if (owners.length <= 1) return { error: "Owner terakhir tidak boleh diturunkan rolenya." };
  }

  await db.collection(KOLEKSI).doc(String(telegramUserId)).update({
    role: roleBaru,
    role_updated_at: new Date(),
    role_updated_by: String(diubahOleh),
  });

  // Audit SETELAH update sukses. Audit gagal TIDAK rollback (PRD §4.3) tapi tidak boleh
  // melempar: throw di sini akan disalahartikan caller sebagai "update gagal". Kegagalan
  // dilaporkan lewat flag `peringatan_audit` supaya route tetap 200 dan update()
  // yang benar-benar gagal tetap terlihat sebagai error.
  let peringatanAudit = false;
  if (catatAudit) {
    try {
      await catatPerubahanRole({
        targetUserId: telegramUserId,
        targetName: admin.name,
        roleLama,
        roleBaru,
        changedBy: diubahOleh,
      });
    } catch (e) {
      console.error(
        "[audit_write_failed]",
        JSON.stringify({ target: String(telegramUserId), pesan: String(e) })
      );
      peringatanAudit = true;
    }
  }

  return { adminLama: admin, adminBaru: await ambilAdmin(telegramUserId), peringatan_audit: peringatanAudit };
}

/**
 * setGudangUser(telegramUserId, gudangId, oleh) -> {ok, admin}
 * Set lokasi kerja user. gudang_id null menghapus penetapan.
 * Audit memakai koleksi admin_role_changes dengan catatan "set_gudang" (role tidak berubah).
 * TIDAK menyentuh role (BR: lokasi != permission).
 */
async function setGudangUser(telegramUserId, gudangId, oleh) {
  const admin = await ambilAdmin(telegramUserId);
  if (!admin) return { ok: false, status: 404, error: "User belum terdaftar." };

  const lama = admin.gudang_id ?? null;
  const baru = gudangId ? String(gudangId) : null;
  await db.collection(KOLEKSI).doc(String(telegramUserId)).update({
    gudang_id: baru,
    gudang_updated_at: new Date(),
    gudang_updated_by: String(oleh),
  });

  try {
    await catatPerubahanRole({
      targetUserId: telegramUserId,
      targetName: admin.name,
      roleLama: admin.role,
      roleBaru: admin.role, // role TIDAK berubah; audit lokasi memakai koleksi yang sama
      changedBy: oleh,
      catatan: "set_gudang",
    });
  } catch (e) {
    console.error("[audit_write_failed]", JSON.stringify({ target: String(telegramUserId), pesan: String(e) }));
  }

  return { ok: true, admin: await ambilAdmin(telegramUserId), gudang_lama: lama, gudang_baru: baru };
}

/**
 * setJabatan(telegramUserId, jabatan, oleh) -> {ok, admin}
 * Label bebas, KOSMETIK. Tidak pernah jadi input otorisasi (BR8).
 */
async function setJabatan(telegramUserId, jabatan, oleh) {
  const admin = await ambilAdmin(telegramUserId);
  if (!admin) return { ok: false, status: 404, error: "User belum terdaftar." };

  const baru = typeof jabatan === "string" && jabatan.trim() ? jabatan.trim() : null;
  await db.collection(KOLEKSI).doc(String(telegramUserId)).update({
    jabatan: baru,
    jabatan_updated_at: new Date(),
    jabatan_updated_by: String(oleh),
  });
  return { ok: true, admin: await ambilAdmin(telegramUserId) };
}

/** Semua admin yang punya gudang_id terisi (dipakai "Kirim ke: User", Q5a). */
async function ambilAdminBergudang() {
  const snapshot = await db.collection(KOLEKSI).get();
  return snapshot.docs
    .map((doc) => ({ telegram_user_id: doc.id, ...doc.data() }))
    .filter((a) => a.gudang_id != null && String(a.gudang_id).trim() !== "");
}

async function ambilSemuaAdminByRole(role) {
  const snapshot = await db.collection(KOLEKSI).where("role", "==", role).get();
  return snapshot.docs.map((doc) => ({ telegram_user_id: doc.id, ...doc.data() }));
}

// Ambil semua admin dari collection (dipakai untuk /list_admins).
async function ambilSemuaAdmin() {
  const snapshot = await db.collection(KOLEKSI).get();
  return snapshot.docs.map((doc) => ({ telegram_user_id: doc.id, ...doc.data() }));
}

// Hapus admin dari collection (dipakai untuk /revoke_admin).
async function hapusAdmin(telegramUserId) {
  await db.collection(KOLEKSI).doc(String(telegramUserId)).delete();
}

module.exports = {
  ambilAdmin,
  isAdmin,
  isSuperAdmin,
  isSuperAdminDariEnv,
  ambilIdentitasAdmin,
  tambahAdmin,
  updateNamaAdmin,
  updateUsernameAdmin,
  updateRoleAdmin,
  setGudangUser,
  setJabatan,
  ambilAdminBergudang,
  ambilSemuaAdminByRole,
  ambilSemuaAdmin,
  hapusAdmin,
};
