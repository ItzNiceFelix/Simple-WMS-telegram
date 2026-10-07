// lib/dashboard/validasiTulisV2.js
// Validasi payload tulis dashboard v2 (PRD §2.7, §4.7, §5.7).
// CommonJS murni, tanpa dependensi — dipakai route TS via createRequire supaya
// logika validasi single-sourced dan bisa diuji langsung dari test CJS.
//
// Kontrak: setiap fungsi mengembalikan { ok:true, ...nilai } ATAU { ok:false, error }.
// Pesan error persis seperti yang dikirim route ke UI.

const ROLE_VALID = ["owner", "admin", "guest"];
const ID_DIGIT = /^\d+$/;

function isIdDigit(v) {
  return typeof v === "string" && ID_DIGIT.test(v);
}

// POST /api/produk/hpp
// { kode_barang, hpp?, hpp_baru? } — minimal satu field perubahan harus dikirim.
function validasiHpp(body) {
  const b = body && typeof body === "object" ? body : {};
  const kodeBarang = typeof b.kode_barang === "string" ? b.kode_barang.trim() : "";
  if (!kodeBarang) return { ok: false, error: "Kode barang wajib diisi." };

  const adaHpp = Object.prototype.hasOwnProperty.call(b, "hpp");
  const adaHppBaru = Object.prototype.hasOwnProperty.call(b, "hpp_baru");

  let hpp;
  if (adaHpp) {
    if (typeof b.hpp !== "number" || !Number.isInteger(b.hpp) || b.hpp < 0) {
      return { ok: false, error: "HPP harus bilangan bulat >= 0." };
    }
    hpp = b.hpp;
  }

  let hppBaru;
  if (adaHppBaru) {
    if (b.hpp_baru !== null && !(typeof b.hpp_baru === "number" && Number.isInteger(b.hpp_baru) && b.hpp_baru >= 0)) {
      return { ok: false, error: "HPP baru harus bilangan bulat >= 0." };
    }
    hppBaru = b.hpp_baru;
  }

  if (!adaHpp && !adaHppBaru) {
    return { ok: false, error: "Tidak ada perubahan yang dikirim." };
  }

  return { ok: true, kodeBarang, adaHpp, hpp, adaHppBaru, hppBaru };
}

// POST /api/stok/reorder-point
// reorder_point WAJIB ada sebagai key (null diizinkan = kosongkan).
function validasiReorderPoint(body) {
  const b = body && typeof body === "object" ? body : {};
  const kodeBarang = typeof b.kode_barang === "string" ? b.kode_barang.trim() : "";
  if (!kodeBarang) return { ok: false, error: "Kode barang wajib diisi." };

  if (!Object.prototype.hasOwnProperty.call(b, "reorder_point")) {
    return { ok: false, error: "Reorder point wajib diisi." };
  }
  const reorderPoint = b.reorder_point;
  if (reorderPoint !== null && !(typeof reorderPoint === "number" && Number.isInteger(reorderPoint) && reorderPoint >= 0)) {
    return { ok: false, error: "Reorder point harus bilangan bulat >= 0." };
  }

  return { ok: true, kodeBarang, reorderPoint };
}

// POST /api/admin/role
function validasiRole(body) {
  const b = body && typeof body === "object" ? body : {};
  const targetUserId = typeof b.target_user_id === "string" ? b.target_user_id.trim() : "";
  if (!isIdDigit(targetUserId)) return { ok: false, error: "User ID target tidak valid." };

  const roleBaru = typeof b.role_baru === "string" ? b.role_baru.toLowerCase() : "";
  if (!ROLE_VALID.includes(roleBaru)) return { ok: false, error: "Role tidak dikenal." };

  return { ok: true, targetUserId, roleBaru };
}

// POST /api/admin/tambah
function validasiTambahAdmin(body) {
  const b = body && typeof body === "object" ? body : {};
  const telegramUserId = typeof b.telegram_user_id === "string" ? b.telegram_user_id.trim() : "";
  if (!isIdDigit(telegramUserId)) return { ok: false, error: "User ID Telegram tidak valid." };

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: "Nama wajib diisi (maks 80 karakter)." };
  }

  let username = null;
  if (b.telegram_username !== undefined && b.telegram_username !== null) {
    if (typeof b.telegram_username !== "string") return { ok: false, error: "Username tidak valid." };
    const u = b.telegram_username.trim();
    // Kosong -> null (opsional); `@` di depan ATAU spasi -> 400 (PRD §5.3).
    if (u !== "") {
      if (u.startsWith("@") || /\s/.test(u)) return { ok: false, error: "Username tidak valid." };
      username = u;
    }
  }

  const role = b.role === undefined ? "guest" : typeof b.role === "string" ? b.role.toLowerCase() : "";
  if (!ROLE_VALID.includes(role)) return { ok: false, error: "Role tidak dikenal." };

  return { ok: true, telegramUserId, name, username, role };
}

// POST /api/admin/hapus
function validasiHapusAdmin(body) {
  const b = body && typeof body === "object" ? body : {};
  const telegramUserId = typeof b.telegram_user_id === "string" ? b.telegram_user_id.trim() : "";
  if (!isIdDigit(telegramUserId)) return { ok: false, error: "User ID Telegram tidak valid." };
  return { ok: true, telegramUserId };
}

// Guard hapus admin (PRD §5.7). Murni — jumlahOwner & superAdminEnv disuplai route.
// targetAdmin = dokumen admins target (atau null).
function alasanTolakHapus({ requesterId, targetId, targetAdmin, jumlahOwner, superAdminEnv }) {
  if (String(targetId) === String(requesterId)) {
    return { ok: false, status: 400, error: "Tidak boleh menghapus akun sendiri." };
  }
  if (!targetAdmin) {
    return { ok: false, status: 404, error: "User tidak ditemukan di daftar admin." };
  }
  // Urutan mengikuti PRD §5.3: owner-terakhir diperiksa sebelum super-admin-env.
  if (targetAdmin.role === "owner" && jumlahOwner <= 1) {
    return { ok: false, status: 400, error: "Owner terakhir tidak boleh dihapus." };
  }
  if (superAdminEnv) {
    return { ok: false, status: 400, error: "Super admin (env) tidak dapat dihapus dari dashboard." };
  }
  return { ok: true };
}

module.exports = {
  ROLE_VALID,
  validasiHpp,
  validasiReorderPoint,
  validasiRole,
  validasiTambahAdmin,
  validasiHapusAdmin,
  alasanTolakHapus,
};
