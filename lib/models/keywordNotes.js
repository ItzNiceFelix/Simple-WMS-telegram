// lib/models/keywordNotes.js
// CRUD untuk koleksi `keyword_notes` — kamus adaptif arti penanda kolom picking list.
// Aturan kunci: penanda baru otomatis tersimpan sebagai "guessed" saat pertama muncul,
// lalu jadi "confirmed" setelah admin verifikasi via chat (flow konfirmasi menyusul).

const { db } = require("../firebase");

const KOLEKSI = "keyword_notes";

// Normalisasi ringan supaya "Sisa Gdg" dan "sisa gdg" dianggap entry yang sama.
function normalisasiRaw(rawText) {
  return (rawText || "").trim().toLowerCase();
}

// Cari entry berdasarkan teks penanda mentah (exact match setelah normalisasi).
// Fuzzy matching antar-keyword (kalau nanti dibutuhkan) menyusul di batch ekstraksi.
async function cariKeywordNote(rawText) {
  const kunci = normalisasiRaw(rawText);
  if (!kunci) return null;
  const snapshot = await db
    .collection(KOLEKSI)
    .where("raw_text", "==", kunci)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

// Simpan usulan interpretasi baru dari AI (selalu "guessed" saat pertama kali muncul).
async function simpanKeywordBaru(rawText, interpretedAs) {
  const kunci = normalisasiRaw(rawText);
  const payload = {
    raw_text: kunci,
    interpreted_as: interpretedAs, // "STOK" | "MINTA" | "MINTA_SISA"
    confidence: "guessed",
    first_seen: new Date(),
    last_used: new Date(),
    usage_count: 1,
  };
  const ref = await db.collection(KOLEKSI).add(payload);
  return { id: ref.id, ...payload };
}

// Naikkan usage_count & last_used tiap kali keyword yang sama dipakai lagi.
async function catatPemakaianKeyword(keywordNoteId) {
  const ref = db.collection(KOLEKSI).doc(keywordNoteId);
  await db.runTransaction(async (trx) => {
    const doc = await trx.get(ref);
    if (!doc.exists) return;
    trx.update(ref, {
      usage_count: (doc.data().usage_count || 0) + 1,
      last_used: new Date(),
    });
  });
}

// Dipanggil setelah admin mengonfirmasi arti penanda lewat chat.
async function konfirmasiKeyword(keywordNoteId, interpretedAsFinal) {
  await db.collection(KOLEKSI).doc(keywordNoteId).update({
    interpreted_as: interpretedAsFinal,
    confidence: "confirmed",
    last_used: new Date(),
  });
  const doc = await db.collection(KOLEKSI).doc(keywordNoteId).get();
  return { id: doc.id, ...doc.data() };
}

// Helper utama dipakai alur C: kembalikan action_type final dari teks penanda mentah.
// Default aman "MINTA" -> action_type "perlu_request" kalau belum dikenali/belum confirmed.
function petakanInterpretasiKeActionType(interpretedAs) {
  const peta = {
    STOK: "kurangi_stok",
    MINTA: "perlu_request",
    MINTA_SISA: "perlu_request_buffer",
  };
  return peta[interpretedAs] || "perlu_request";
}

// Penanda "bermakna" yang layak dipelajari: bukan kosong, bukan "-", minimal 2 char.
function penandaBermakna(rawText) {
  const kunci = normalisasiRaw(rawText);
  return kunci.length >= 2 && kunci !== "-";
}

async function ambilActionTypeUntukPenanda(rawText) {
  const note = await cariKeywordNote(rawText);
  if (!note) {
    // Belum pernah dilihat -> default aman MINTA. Kalau penanda bermakna, simpan sebagai
    // "guessed" supaya kamus benar-benar belajar dari pemakaian (dulu tidak pernah ditulis).
    if (!penandaBermakna(rawText)) {
      return { actionType: "perlu_request", note: null };
    }
    const noteBaru = await simpanKeywordBaru(rawText, "MINTA");
    return { actionType: "perlu_request", note: noteBaru };
  }
  // Hitung pemakaian tiap resolusi. Non-fatal: kegagalan counter tidak boleh
  // menggagalkan ekstraksi picking list.
  try {
    await catatPemakaianKeyword(note.id);
  } catch (err) {
    console.error("[keywordNotes] gagal catat pemakaian:", err);
  }
  if (note.confidence === "confirmed") {
    return { actionType: petakanInterpretasiKeActionType(note.interpreted_as), note };
  }
  // Masih "guessed" -> tetap default aman MINTA sampai admin konfirmasi.
  return { actionType: "perlu_request", note };
}

// ---------------------------------------------------------------------------
// v3a (PRD §6) — daftar + konfirmasi interpretasi penanda (halaman /kata-kunci).
// ---------------------------------------------------------------------------

const INTERPRETASI_VALID = ["STOK", "MINTA", "MINTA_SISA"];

// `last_used` bisa Firestore Timestamp (punya toDate) atau Date/ISO. Normalisasi ke ms
// untuk urutan desc; note tanpa last_used dianggap paling lama.
function waktuMs(nilai) {
  if (!nilai) return 0;
  if (typeof nilai.toDate === "function") return nilai.toDate().getTime();
  if (nilai instanceof Date) return nilai.getTime();
  const t = Date.parse(nilai);
  return Number.isNaN(t) ? 0 : t;
}

// Semua note + id, urut `last_used` desc (PRD §6.1).
async function listKeywordNotes() {
  const snapshot = await db.collection(KOLEKSI).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => waktuMs(b.last_used) - waktuMs(a.last_used));
}

// Ubah interpretasi penanda + audit ringan (confirmed_by/confirmed_at, PRD §9.2).
// Delegasi ke konfirmasiKeyword yang sudah ada — logika "confirmed" TIDAK diduplikasi.
async function perbaruiInterpretasi(id, interpretedAs, oleh) {
  if (!INTERPRETASI_VALID.includes(interpretedAs)) {
    throw new Error("Interpretasi tidak dikenal.");
  }
  // Guard eksplisit: `.update()` pada doc tak ada lempar error Firestore generik -> route
  // akan jadi 500, bukan 404 kontrak. Cek keberadaan dulu (PRD §6.5).
  const ada = await db.collection(KOLEKSI).doc(id).get();
  if (!ada.exists) throw new Error("Penanda tidak ditemukan.");
  const note = await konfirmasiKeyword(id, interpretedAs);
  const audit = { confirmed_by: oleh, confirmed_at: new Date() };
  await db.collection(KOLEKSI).doc(id).update(audit);
  return { ...note, ...audit };
}

module.exports = {
  cariKeywordNote,
  simpanKeywordBaru,
  catatPemakaianKeyword,
  konfirmasiKeyword,
  petakanInterpretasiKeActionType,
  ambilActionTypeUntukPenanda,
  listKeywordNotes,
  perbaruiInterpretasi,
};
