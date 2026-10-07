/**
 * lib/dashboard/validasiGudangV5.js
 * Validator aksi /api/gudang + aksi admin v5 (set-gudang-user, set-jabatan). CJS murni, tanpa I/O.
 */
const MAKS_NAMA_GUDANG = 60;
const MAKS_JABATAN = 40;
const ID_TELEGRAM = /^\d+$/;

function isObjek(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Validasi id gudang (dipakai sebagai Firestore doc id). */
function validasiIdGudang(id, pesan = "ID gudang tidak valid.") {
  if (typeof id !== "string" || !id.trim()) return { ok: false, status: 400, error: pesan };
  const v = id.trim();
  if (v.includes("/") || v === "." || v === "..") return { ok: false, status: 400, error: pesan };
  if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, status: 400, error: pesan };
  return { ok: true, gudangId: v };
}

function validasiNamaGudang(nama) {
  const n = typeof nama === "string" ? nama.trim() : "";
  if (!n) return { ok: false, status: 400, error: "Nama gudang wajib diisi." };
  if (n.length > MAKS_NAMA_GUDANG) {
    return { ok: false, status: 400, error: "Nama gudang maksimal " + MAKS_NAMA_GUDANG + " karakter." };
  }
  return { ok: true, nama: n };
}

/** Dispatcher aksi /api/gudang (F1). */
function validasiAksiGudang(body) {
  const b = isObjek(body) ? body : {};
  if (typeof b.aksi !== "string" || !b.aksi) {
    return { ok: false, status: 400, error: "Aksi tidak dikenal." };
  }

  if (b.aksi === "tambah") {
    const n = validasiNamaGudang(b.nama);
    if (!n.ok) return n;
    return { ok: true, status: 200, aksi: "tambah", nama: n.nama };
  }

  if (b.aksi === "edit") {
    const id = validasiIdGudang(b.gudang_id);
    if (!id.ok) return id;
    const n = validasiNamaGudang(b.nama);
    if (!n.ok) return n;
    return { ok: true, status: 200, aksi: "edit", gudangId: id.gudangId, nama: n.nama };
  }

  if (b.aksi === "nonaktif" || b.aksi === "aktifkan") {
    const id = validasiIdGudang(b.gudang_id);
    if (!id.ok) return id;
    return { ok: true, status: 200, aksi: b.aksi, gudangId: id.gudangId };
  }

  return { ok: false, status: 400, error: "Aksi tidak dikenal." };
}

/** Validasi aksi set-gudang-user (F3). gudang_id null = hapus penetapan. */
function validasiSetGudangUser(b) {
  if (typeof b.target_user_id !== "string" || !ID_TELEGRAM.test(b.target_user_id)) {
    return { ok: false, status: 400, error: "User ID Telegram tidak valid." };
  }
  let gudangId = null;
  if (b.gudang_id !== undefined && b.gudang_id !== null) {
    const id = validasiIdGudang(b.gudang_id, "Gudang tidak dikenal.");
    if (!id.ok) return id;
    gudangId = id.gudangId;
  }
  return { ok: true, status: 200, aksi: "set-gudang-user", targetUserId: b.target_user_id, gudangId };
}

/** Validasi aksi set-jabatan (F4). Kosong -> null (hapus label). */
function validasiSetJabatan(b) {
  if (typeof b.target_user_id !== "string" || !ID_TELEGRAM.test(b.target_user_id)) {
    return { ok: false, status: 400, error: "User ID Telegram tidak valid." };
  }
  let jabatan = null;
  if (b.jabatan !== undefined && b.jabatan !== null) {
    if (typeof b.jabatan !== "string") {
      return { ok: false, status: 400, error: "Jabatan harus teks." };
    }
    const j = b.jabatan.trim();
    // Hitung per code point (emoji dihitung 1) supaya konsisten dengan PRD F4.
    if ([...j].length > MAKS_JABATAN) {
      return { ok: false, status: 400, error: "Jabatan maksimal " + MAKS_JABATAN + " karakter." };
    }
    jabatan = j || null;
  }
  return { ok: true, status: 200, aksi: "set-jabatan", targetUserId: b.target_user_id, jabatan };
}

/** Validasi aksi set-qty per gudang (F2). */
function validasiSetQtyGudang(b) {
  const kode = typeof b.kode_barang === "string" ? b.kode_barang.trim() : "";
  if (!kode) return { ok: false, status: 400, error: "Kode barang wajib diisi." };
  const id = validasiIdGudang(b.gudang_id, "Gudang tidak dikenal.");
  if (!id.ok) return id;
  if (typeof b.qty !== "number" || !Number.isInteger(b.qty) || b.qty < 0) {
    return { ok: false, status: 400, error: "Jumlah harus bilangan bulat >= 0." };
  }
  return { ok: true, status: 200, aksi: "set-qty", kodeBarang: kode, gudangId: id.gudangId, qty: b.qty };
}

/** Validasi aksi mutasi stok antar-gudang (v5.2). */
function validasiMutasiGudang(b) {
  const kode = typeof b.kode_barang === "string" ? b.kode_barang.trim() : "";
  if (!kode) return { ok: false, status: 400, error: "Kode barang wajib diisi." };
  const dari = validasiIdGudang(b.dari_gudang_id, "Gudang tidak dikenal.");
  if (!dari.ok) return dari;
  const ke = validasiIdGudang(b.ke_gudang_id, "Gudang tidak dikenal.");
  if (!ke.ok) return ke;
  if (dari.gudangId === ke.gudangId) {
    return { ok: false, status: 400, error: "Gudang asal dan tujuan tidak boleh sama." };
  }
  if (typeof b.qty !== "number" || !Number.isInteger(b.qty) || b.qty < 1) {
    return { ok: false, status: 400, error: "Jumlah harus bilangan bulat >= 1." };
  }
  return {
    ok: true,
    status: 200,
    aksi: "mutasi-gudang",
    kodeBarang: kode,
    dariGudangId: dari.gudangId,
    keGudangId: ke.gudangId,
    qty: b.qty,
  };
}

/** Dispatcher aksi /api/stok/gudang: set-qty | mutasi-gudang. */
function validasiAksiStokGudang(b) {
  const body = isObjek(b) ? b : {};
  if (body.aksi === "set-qty") return validasiSetQtyGudang(body);
  if (body.aksi === "mutasi-gudang") return validasiMutasiGudang(body);
  return { ok: false, status: 400, error: "Aksi tidak dikenal." };
}

/** Validasi aksi toggle is-online produk (F8). */
function validasiToggleOnline(b) {
  const kode = typeof b.kode_barang === "string" ? b.kode_barang.trim() : "";
  if (!kode) return { ok: false, status: 400, error: "Kode barang wajib diisi." };
  if (kode.includes("/") || kode === "." || kode === "..") {
    return { ok: false, status: 400, error: "Kode barang tidak valid." };
  }
  if (typeof b.is_online !== "boolean") {
    return { ok: false, status: 400, error: "Status online harus boolean." };
  }
  return { ok: true, status: 200, aksi: "toggle-online", kodeBarang: kode, isOnline: b.is_online };
}

module.exports = {
  MAKS_NAMA_GUDANG,
  MAKS_JABATAN,
  isObjek,
  validasiIdGudang,
  validasiNamaGudang,
  validasiAksiGudang,
  validasiSetGudangUser,
  validasiSetJabatan,
  validasiSetQtyGudang,
  validasiMutasiGudang,
  validasiAksiStokGudang,
  validasiToggleOnline,
};
