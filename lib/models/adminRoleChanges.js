// Audit perubahan role admin.
const { db } = require("../firebase");

async function catatPerubahanRole({ targetUserId, targetName, roleLama, roleBaru, changedBy, catatan = null }) {
  const payload = {
    target_user_id: String(targetUserId),
    target_name: targetName || null,
    old_role: roleLama || null,
    new_role: roleBaru,
    changed_by: String(changedBy),
    // catatan opsional (v5): dipakai audit non-role (mis. "set_gudang"). Null untuk audit role biasa.
    catatan: catatan || null,
    created_at: new Date(),
  };
  const ref = await db.collection("admin_role_changes").add(payload);
  return { id: ref.id, ...payload };
}

module.exports = { catatPerubahanRole };