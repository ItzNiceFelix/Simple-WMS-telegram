// lib/dashboard/aksiDraft.js
// Logika murni (I/O lewat injeksi `db`) untuk aksi `konfirmasi-draft` (v3b Fase B).
// Dipisah dari route TS supaya BISA diuji langsung (route Next.js tidak diimpor test CJS —
// konvensi repo), sehingga guard best-effort + fail-closed batch setengah jadi punya bukti nyata.
//
// Semua keputusan otorisasi memakai SUMBER SERVER (draft/movement), bukan body (§7.3).

const { kunciGuard, guardAktif } = require("./draftGuard");
const draftOwner = require("./draftOwner");

const TTL_GUARD_MS = 10_000;

/**
 * Lapis 3 (§8.5): tulis guard `draft_kirim_guard` via transaksi (CAS). Best-effort:
 * error tak terduga -> log `[draft_guard_failed]` lalu LANJUT (tidak memblokir aksi sah).
 * @returns {Promise<{duplikat:boolean}>}
 */
async function tulisGuardDraft(db, kunci, uid, now = Date.now()) {
  const guardRef = db.collection("draft_kirim_guard").doc(kunci);
  try {
    const duplikat = await db.runTransaction(async (trx) => {
      const doc = await trx.get(guardRef);
      if (doc.exists) {
        const g = doc.data() || {};
        if (typeof g.at === "number" && now - g.at <= TTL_GUARD_MS) return true;
      }
      trx.set(guardRef, { at: now, by: uid }, { merge: false });
      return false;
    });
    return { duplikat: duplikat === true };
  } catch (e) {
    console.error("[draft_guard_failed]", JSON.stringify({ kunci, pesan: String(e) }));
    return { duplikat: false };
  }
}

/**
 * Ambil movement anggota batch picking (satu pemilik) dari SEMUA status supaya batch setengah
 * jadi (E-3) terdeteksi. `pending` = `status == "pending_confirmation"`, query `status` tunggal
 * lalu filter pemilik di memori (pola N7, tanpa composite index).
 * @returns {Promise<Array<{id:string,status?:string}>>}
 */
async function ambilBatchPicking(db, batchId, maksHasil = 100) {
  // Satu query seluruh koleksi (dibatasi) lalu filter status+pemilik di memori — hindari
  // composite index (N7) sekaligus deteksi batch setengah jadi (movement `processed` ikut terlihat).
  const snap = await db.collection("stock_movements").limit(maksHasil).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => draftOwner.ambilOwnerDraft(m) === String(batchId));
}

/**
 * Keputusan pra-panggil-bot untuk SATU unit konfirmasi (opname/sync/picking).
 * @returns {Promise<{ok:true, ownerUserId:string, kunci:string, dokumen:object|null} | {ok:false, status:number, error:string}>}
 */
async function siapkanKonfirmasiDraft(db, { jenis, draftId, batchId }) {
  if (jenis === "picking") {
    const milikBatch = await ambilBatchPicking(db, batchId);
    if (milikBatch.length === 0) return { ok: false, status: 404, error: "Batch picking tidak ditemukan." };

    // E-3 (§8.4): batch setengah jadi TIDAK boleh diproses dashboard — fungsi bot mengulang
    // SELURUH movementIds sesi -> dobel kurangiStok. Fail-closed.
    const status = draftOwner.statusBatchPicking(milikBatch);
    if (status === "sebagian") {
      return { ok: false, status: 409, error: "Batch picking ini diproses sebagian. Selesaikan lewat Telegram." };
    }
    if (status === "sudah") {
      return { ok: false, status: 409, error: "Batch picking ini sudah diproses sebelumnya." };
    }
    // Pemilik dari MOVEMENT, bukan body (§7.3).
    const ownerUserId = draftOwner.ambilOwnerDraft(milikBatch[0]);
    return { ok: true, ownerUserId, kunci: kunciGuard("picking", ownerUserId), dokumen: null };
  }

  const koleksi = jenis === "opname" ? "opname_drafts" : "sync_stok_drafts";
  const doc = await db.collection(koleksi).doc(String(draftId)).get();
  if (!doc || !doc.exists) return { ok: false, status: 404, error: "Draft tidak ditemukan." };

  const dokumen = { id: doc.id, ...doc.data() };
  const ownerUserId = draftOwner.ambilOwnerDraft(dokumen);
  return { ok: true, ownerUserId, kunci: kunciGuard(jenis, String(draftId)), dokumen };
}

/**
 * Validasi pasca-baca: status draft (lapis 1) + kondisi sync kelompok (E-5).
 * @returns {{ok:true} | {ok:false, status:number, error:string}}
 */
function validasiStatusDraft(jenis, dokumen, kondisi, ownerUserId) {
  // Fail-closed §7.2: tanpa penanda pemilik, draft TIDAK bisa dikonfirmasi. Otorisasi role
  // sudah dilakukan route lewat `otorisasi()`; di sini hanya cek keberadaan owner.
  if (!ownerUserId) {
    return { ok: false, status: 409, error: "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram." };
  }

  if (jenis !== "picking" && dokumen && dokumen.status !== "pending_confirmation") {
    return { ok: false, status: 409, error: "Draft ini sudah diproses sebelumnya." };
  }
  if (jenis === "sync" && dokumen && kondisi && kondisi !== "semua" && dokumen.kondisi !== kondisi) {
    return { ok: false, status: 409, error: "Tidak ada draft kelompok itu yang masih pending." };
  }
  return { ok: true };
}

/**
 * Otorisasi role + owner (dipakai route). `ownerUserId` dari sumber server.
 */
function otorisasi(role, uid, ownerUserId) {
  const izin = draftOwner.otorisasiDraft(role, uid, { owner_user_id: ownerUserId });
  if (!izin.ok) {
    const error =
      izin.status === 409
        ? "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram."
        : "Hanya owner atau pembuat draft yang dapat mengonfirmasi.";
    return { ok: false, status: izin.status, error };
  }
  return { ok: true, ownerUserId: izin.ownerUserId };
}

module.exports = { tulisGuardDraft, ambilBatchPicking, siapkanKonfirmasiDraft, validasiStatusDraft, otorisasi };
