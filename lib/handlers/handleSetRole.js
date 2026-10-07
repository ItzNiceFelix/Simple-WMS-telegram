const { isSuperAdmin, updateRoleAdmin } = require("../models/admins");
const { kirimPesan } = require("../telegram/kirimPesan");

const ROLE_VALID = ["owner", "admin", "guest"];

async function handleSetRole(ctx) {
  if (!(await isSuperAdmin(ctx.telegramUserId))) {
    await kirimPesan(ctx.chatId, "Perintah ini hanya bisa Super Admin.");
    return;
  }

  const [targetUserId, roleBaru] = ctx.argumen || [];
  const roleNormal = String(roleBaru || "").toLowerCase();
  if (!/^\d+$/.test(String(targetUserId || "")) || !ROLE_VALID.includes(roleNormal)) {
    await kirimPesan(ctx.chatId, "Format: `/set_role <user_id> <owner|admin|guest>`", { parseMode: "Markdown" });
    return;
  }

  // Audit ditangani di dalam updateRoleAdmin (Opsi D) — jangan catat manual lagi.
  const hasil = await updateRoleAdmin(targetUserId, roleNormal, ctx.telegramUserId);
  if (hasil.error) {
    await kirimPesan(ctx.chatId, hasil.error);
    return;
  }

  await kirimPesan(ctx.chatId, `Role ${hasil.adminLama.name || targetUserId} diubah dari ${hasil.adminLama.role} menjadi ${roleNormal}.`);
  try {
    await kirimPesan(targetUserId, `Role kamu di bot diubah menjadi ${roleNormal} oleh Super Admin.`);
  } catch (error) {
    console.error("Gagal mengirim notifikasi perubahan role:", error);
  }
}

module.exports = { handleSetRole };