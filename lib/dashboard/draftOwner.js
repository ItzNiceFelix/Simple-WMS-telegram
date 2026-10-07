// lib/dashboard/draftOwner.js
// A2 (v3b §7): resolusi + otorisasi PEMILIK draft/batch dari SUMBER SERVER, bukan body.
// Server-only (dipakai route `POST /api/admin`). CJS murni supaya bisa di-unit-test.
//
// Aturan (PRD §7.1/§7.2/§7.3):
//   - owner  -> boleh semua draft
//   - admin  -> HANYA draft miliknya (`owner_user_id === sesi.uid`)
//   - draft lama tanpa penanda pemilik -> FAIL-CLOSED (409), termasuk untuk owner.
//   - body TIDAK pernah dipakai sebagai sumber owner (anti-pemalsuan, N1).

const PESAN_PEMILIK_TAK_DIKENAL = "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram.";

/**
 * Ambil `owner_user_id` dari dokumen draft.
 * Sumber: `owner_user_id` (opname/sync, additive bot v3b) ?? `created_by` ?? `requested_by`
 * (picking list movement — `handleScreenshotPickingList.js:131`).
 * @returns {string|null} null bila tidak dapat ditentukan -> route 409 fail-closed.
 */
function ambilOwnerDraft(dokumen) {
  if (!dokumen) return null;
  for (const kandidat of [dokumen.owner_user_id, dokumen.created_by, dokumen.requested_by]) {
    if (kandidat !== null && kandidat !== undefined && String(kandidat).trim() !== "") {
      return String(kandidat);
    }
  }
  return null;
}

/**
 * Otorisasi pemilik (PRD §7.1). Mengembalikan `{ ok:false, status, error }` atau `{ ok:true, ownerUserId }`.
 * @param {"owner"|"admin"|"guest"} role
 * @param {string} uid - sesi.uid (telegram user id pelaku dashboard)
 * @param {object|null} dokumen - draft/batch (batch = movement perwakilan)
 */
function otorisasiDraft(role, uid, dokumen) {
  const ownerUserId = ambilOwnerDraft(dokumen);
  if (!ownerUserId) {
    return { ok: false, status: 409, error: PESAN_PEMILIK_TAK_DIKENAL };
  }
  if (role === "owner") return { ok: true, ownerUserId };
  if (role === "admin" && String(uid) === ownerUserId) return { ok: true, ownerUserId };
  return { ok: false, status: 403, error: "Hanya owner atau pembuat draft yang dapat mengonfirmasi." };
}

/**
 * Kelompokkan movement picking per pemilik (batch) — PRD §5.4 B1: unit konfirmasi = satu batch
 * (satu sesi `pendingPickingList`), bukan per-movement.
 * Movement tanpa pemilik TIDAK dibuang di sini; route yang memutuskan fail-closed (E-2).
 * @param {Array<{id:string, created_by?:unknown, requested_by?:unknown, status?:string}>} movements
 * @returns {Map<string, object[]>} ownerUserId -> movements
 */
function kelompokkanBatchPicking(movements) {
  const peta = new Map();
  for (const m of movements || []) {
    const owner = ambilOwnerDraft(m);
    // Movement tanpa pemilik masuk keranjang khusus agar tetap terlihat oleh route (fail-closed).
    const kunci = owner ?? "";
    if (!peta.has(kunci)) peta.set(kunci, []);
    peta.get(kunci).push(m);
  }
  return peta;
}

/**
 * Status batch: "siap" (semua pending), "sebagian" (campuran -> E-3 fail-closed),
 * "sudah" (semua sudah diproses -> 409).
 */
function statusBatchPicking(movements, statusPending = "pending_confirmation") {
  const list = movements || [];
  if (list.length === 0) return "kosong";
  const pending = list.filter((m) => m.status === statusPending).length;
  if (pending === list.length) return "siap";
  if (pending === 0) return "sudah";
  return "sebagian";
}

module.exports = {
  PESAN_PEMILIK_TAK_DIKENAL,
  ambilOwnerDraft,
  otorisasiDraft,
  kelompokkanBatchPicking,
  statusBatchPicking,
};
