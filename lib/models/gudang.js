// lib/models/gudang.js
// CRUD master gudang (v5). Daftar gudang flat, configurable, maksimum 50 (BR15).
// Gudang TIDAK dihapus keras, hanya `aktif:false`, supaya referensi `gudang_id` lama tetap valid.
const { db } = require("../firebase");
const KOLEKSI = "gudang";

/** Batas keras jumlah gudang (BR15). */
const MAKS_GUDANG = 50;

/** Cek id aman dipakai sebagai Firestore doc id. */
function idGudangValid(id) {
  if (typeof id !== "string" || !id.trim()) return false;
  if (id.includes("/") || id === "." || id === "..") return false;
  return !/[\u0000-\u001f\u007f]/.test(id);
}

async function ambilGudang(gudangId) {
  if (gudangId === null || gudangId === undefined) return null;
  const doc = await db.collection(KOLEKSI).doc(String(gudangId)).get();
  if (!doc.exists) return null;
  return { gudang_id: doc.id, ...doc.data() };
}

/** Ada DAN aktif (dipakai validasi tulis). */
async function ambilGudangAktif(gudangId) {
  const g = await ambilGudang(gudangId);
  return g && g.aktif === true ? g : null;
}

/** Semua gudang. `{semua:true}` menyertakan yang nonaktif (owner). */
async function ambilSemuaGudang({ semua = false } = {}) {
  const snapshot = await db.collection(KOLEKSI).get();
  let daftar = snapshot.docs.map((doc) => ({ gudang_id: doc.id, ...doc.data() }));
  if (!semua) daftar = daftar.filter((g) => g.aktif === true);
  // Pengurutan: urutan asc, sekunder nama asc (stabil walau urutan bertabrakan).
  daftar.sort((a, b) => {
    const ua = typeof a.urutan === "number" ? a.urutan : Number.MAX_SAFE_INTEGER;
    const ub = typeof b.urutan === "number" ? b.urutan : Number.MAX_SAFE_INTEGER;
    if (ua !== ub) return ua - ub;
    return String(a.nama || "").localeCompare(String(b.nama || ""), "id");
  });
  return daftar;
}

async function jumlahGudang() {
  const snapshot = await db.collection(KOLEKSI).get();
  return snapshot.docs.length;
}

/** Cek duplikat nama (case-insensitive, trim) pada gudang AKTIF. `kecualiId` untuk aksi edit. */
async function namaDipakai(nama, kecualiId = null) {
  const target = String(nama || "").trim().toLowerCase();
  const daftar = await ambilSemuaGudang({ semua: false });
  return daftar.some(
    (g) => String(g.nama || "").trim().toLowerCase() === target && String(g.gudang_id) !== String(kecualiId ?? "")
  );
}

/**
 * tambahGudang({nama, oleh}) -> {ok, gudang} | {ok:false, status, error}
 * Batas 50 ditegakkan di sini (bukan hanya UI). Duplikat nama aktif ditolak.
 */
async function tambahGudang({ nama, oleh = null }) {
  const jumlah = await jumlahGudang();
  if (jumlah >= MAKS_GUDANG) {
    return { ok: false, status: 400, error: "Maksimal 50 gudang." };
  }
  if (await namaDipakai(nama)) {
    return { ok: false, status: 409, error: "Nama gudang sudah dipakai." };
  }
  const existing = await ambilSemuaGudang({ semua: true });
  const urutan = existing.reduce((maks, g) => Math.max(maks, typeof g.urutan === "number" ? g.urutan : -1), -1) + 1;
  const payload = {
    nama: String(nama).trim(),
    aktif: true,
    urutan,
    created_at: new Date(),
    created_by: oleh ? String(oleh) : null,
  };
  const ref = await db.collection(KOLEKSI).add(payload);
  return { ok: true, gudang: { gudang_id: ref.id, ...payload } };
}

/** Buat gudang dengan ID EKSPLISIT (dipakai migrasi "ONLINE"). Idempoten: ada -> tidak menimpa. */
async function pastikanGudang(gudangId, { nama, oleh = "migrasi" } = {}) {
  const ada = await ambilGudang(gudangId);
  if (ada) return { ok: true, gudang: ada, sudahAda: true };
  const payload = {
    nama: nama || String(gudangId),
    aktif: true,
    urutan: 0,
    created_at: new Date(),
    created_by: oleh,
  };
  await db.collection(KOLEKSI).doc(String(gudangId)).set(payload);
  return { ok: true, gudang: { gudang_id: String(gudangId), ...payload }, sudahAda: false };
}

/** Edit nama gudang. */
async function editGudang(gudangId, { nama, oleh = null }) {
  const ada = await ambilGudang(gudangId);
  if (!ada) return { ok: false, status: 404, error: "Gudang tidak ditemukan." };
  if (await namaDipakai(nama, gudangId)) {
    return { ok: false, status: 409, error: "Nama gudang sudah dipakai." };
  }
  await db.collection(KOLEKSI).doc(String(gudangId)).set(
    { nama: String(nama).trim(), updated_at: new Date(), updated_by: oleh ? String(oleh) : null },
    { merge: true }
  );
  return { ok: true, gudang: await ambilGudang(gudangId) };
}

/**
 * nonaktifGudang(gudangId) -> {ok, gudang, peringatan_referensi}
 * Tidak rollback walau masih dirujuk; kembalikan jumlah referensi (T11c).
 */
async function nonaktifGudang(gudangId, { oleh = null } = {}) {
  const ada = await ambilGudang(gudangId);
  if (!ada) return { ok: false, status: 404, error: "Gudang tidak ditemukan." };
  await db.collection(KOLEKSI).doc(String(gudangId)).set(
    { aktif: false, nonaktif_at: new Date(), nonaktif_by: oleh ? String(oleh) : null },
    { merge: true }
  );
  const peringatan = await hitungReferensiGudang(gudangId);
  return { ok: true, gudang: await ambilGudang(gudangId), peringatan_referensi: peringatan };
}

async function aktifkanGudang(gudangId, { oleh = null } = {}) {
  const ada = await ambilGudang(gudangId);
  if (!ada) return { ok: false, status: 404, error: "Gudang tidak ditemukan." };
  await db.collection(KOLEKSI).doc(String(gudangId)).set(
    { aktif: true, updated_at: new Date(), updated_by: oleh ? String(oleh) : null },
    { merge: true }
  );
  return { ok: true, gudang: await ambilGudang(gudangId) };
}

/** Jumlah referensi ke gudang: admins.gudang_id + stock.qty_per_gudang[key] (T11c). */
async function hitungReferensiGudang(gudangId) {
  const id = String(gudangId);
  const [adminsSnap, stockSnap] = await Promise.all([
    db.collection("admins").get(),
    db.collection("stock").get(),
  ]);
  const adminCount = adminsSnap.docs.filter((d) => String(d.data().gudang_id ?? "") === id).length;
  const stockKeyCount = stockSnap.docs.filter((d) => {
    const map = d.data().qty_per_gudang;
    return map && typeof map === "object" && Object.prototype.hasOwnProperty.call(map, id);
  }).length;
  return adminCount + stockKeyCount;
}

module.exports = {
  MAKS_GUDANG,
  idGudangValid,
  ambilGudang,
  ambilGudangAktif,
  ambilSemuaGudang,
  jumlahGudang,
  namaDipakai,
  tambahGudang,
  pastikanGudang,
  editGudang,
  nonaktifGudang,
  aktifkanGudang,
  hitungReferensiGudang,
};
