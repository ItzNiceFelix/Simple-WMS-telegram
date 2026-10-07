// lib/models/stockMovements.js
// CRUD untuk koleksi `stock_movements` — audit trail semua perubahan stok.
// Satu fungsi generik `catatPergerakanStok`, dipakai untuk semua type (keluar_resi, opname, dst),
// field yang tidak relevan untuk suatu type cukup diisi undefined/null oleh pemanggil.

const { db } = require("../firebase");
const { ambilIdentitasAdmin } = require("./admins");

const KOLEKSI = "stock_movements";

async function catatPergerakanStok({
  kode_barang,
  nama_terbaca,
  variasi = null,
  qty,
  type, // "keluar_resi" | "opname" | "restock" | "koreksi_manual" | "sync_confirmed"
  resolved_by = null,
  penanda = null,
  action_type = null, // "kurangi_stok" | "perlu_request" | "perlu_request_buffer"
  qty_sistem = null,
  qty_fisik = null,
  selisih = null,
  catatan = null,
  // v5: gudang asal movement. null untuk movement lama (sebelum v5) - non-goal migrasi.
  gudang_id = null,
  source, // "screenshot" | "manual_chat" | "sync"
  status = "processed", // "processed" | "pending_request" | "pending_confirmation"
  created_by,
  created_by_username = null,
  created_by_name = null,
  requested_by = null,
  requested_by_username = null,
  requested_by_name = null,
  confirmed_by = null,
  // R1: id deterministik buat idempotensi. Kalau diisi -> doc(id).set() (retry = OVERWRITE,
  // bukan doc baru). Kalau null -> perilaku lama (.add) supaya semua pemanggil lain tak berubah.
  id_movement = null,
}) {
  // Normalisasi ke string (PRD A4/BR10): dokumen lama dari bot bisa bertipe angka,
  // query memakai perbandingan string. Selalu String() agar konsisten.
  const createdByStr = created_by === null || created_by === undefined ? null : String(created_by);
  const confirmedByStr = confirmed_by === null || confirmed_by === undefined ? null : String(confirmed_by);

  const identitas = await ambilIdentitasAdmin(createdByStr, {
    username: created_by_username,
    name: created_by_name,
  });
  const requesterId = requested_by ? String(requested_by) : createdByStr;
  const identitasRequester = await ambilIdentitasAdmin(requesterId, {
    username: requested_by_username,
    name: requested_by_name,
  });
  const payload = {
    kode_barang,
    nama_terbaca,
    variasi,
    qty,
    type,
    resolved_by,
    penanda,
    // v5: null untuk movement lama; diisi untuk mutasi/opname per gudang.
    gudang_id: gudang_id ? String(gudang_id) : null,
    action_type,
    qty_sistem,
    qty_fisik,
    selisih,
    catatan,
    source,
    status,
    created_at: new Date(),
    created_by: createdByStr,
    created_by_username: identitas.telegram_username,
    created_by_name: identitas.name,
    requested_by: requesterId || null,
    requested_by_username: identitasRequester.telegram_username,
    requested_by_name: identitasRequester.name,
    confirmed_by: confirmedByStr,
  };
  if (id_movement !== null && id_movement !== undefined) {
    // Id eksplisit: retry dgn id sama menimpa dokumen yang sama, tidak menambah baris baru.
    const id = String(id_movement);
    const ref = db.collection(KOLEKSI).doc(id);
    // Pertahankan created_at penulisan PERTAMA supaya retry tidak menggeser cap waktu audit.
    const ada = await ref.get();
    if (ada.exists && ada.data()?.created_at) payload.created_at = ada.data().created_at;
    await ref.set(payload);
    return { id, ...payload };
  }
  const ref = await db.collection(KOLEKSI).add(payload);
  return { id: ref.id, ...payload };
}

async function ambilPergerakanByKode(kodeBarang, maksHasil = 20) {
  const snapshot = await db
    .collection(KOLEKSI)
    .where("kode_barang", "==", kodeBarang)
    .orderBy("created_at", "desc")
    .limit(maksHasil)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function ambilPergerakanByPembuat(telegramUserId, maksHasil = 20) {
  const snapshot = await db
    .collection(KOLEKSI)
    .where("created_by", "==", String(telegramUserId))
    .orderBy("created_at", "desc")
    .limit(maksHasil)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function ambilPergerakanTerakhir(maksHasil = 20) {
  const snapshot = await db
    .collection(KOLEKSI)
    .orderBy("created_at", "desc")
    .limit(maksHasil)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// Ambil pergerakan yang masih menunggu diproses (misal item ambigu dari screenshot
// yang belum dikonfirmasi admin).
async function ambilPergerakanPending(status = "pending_confirmation", maksHasil = 50) {
  const snapshot = await db
    .collection(KOLEKSI)
    .where("status", "==", status)
    .orderBy("created_at", "desc")
    .limit(maksHasil)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function updateStatusPergerakan(movementId, statusBaru) {
  await db.collection(KOLEKSI).doc(movementId).update({ status: statusBaru });
}

module.exports = {
  catatPergerakanStok,
  ambilPergerakanByKode,
  ambilPergerakanByPembuat,
  ambilPergerakanPending,
  ambilPergerakanTerakhir,
  updateStatusPergerakan,
};