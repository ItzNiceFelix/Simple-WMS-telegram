// lib/gemini/rateLimit.js
// Sliding-window limiter AI per user.
//
// PENTING: ini memori IN-MEMORY per warm instance saja (bukan distributed). Di Vercel
// serverless, tiap instance punya Map sendiri, jadi batas efektif bisa lebih longgar
// kalau request tersebar ke beberapa instance. Anggap ini SOFT GUARD biar satu admin
// gak ngehajar Gemini/Groq sendirian — BUKAN kuota keras.
// ponytail: skipped: distributed rate limit, add when multi-instance abuse is real.

const JENDELA_MS = 60_000;

const BATAS_PER_MENIT = Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 20;

/** @type {Map<string, number[]>} telegramUserId -> timestamp panggilan AI terakhir */
const riwayat = new Map();

/**
 * Cek apakah user sudah lewat batas dalam jendela 60 detik terakhir.
 * Efek samping: mencatat timestamp panggilan ini kalau belum kena limit.
 * @param {string|number} telegramUserId
 * @returns {boolean} true kalau harus DIBLOKIR
 */
function apakahKenaRateLimit(telegramUserId) {
  const kunci = String(telegramUserId);
  const sekarang = Date.now();
  const batasAwal = sekarang - JENDELA_MS;

  const terpakai = (riwayat.get(kunci) || []).filter((t) => t > batasAwal);

  if (terpakai.length >= BATAS_PER_MENIT) {
    riwayat.set(kunci, terpakai); // simpan yg masih relevan, buang yg kedaluwarsa
    return true;
  }

  terpakai.push(sekarang);
  riwayat.set(kunci, terpakai);
  return false;
}

module.exports = { apakahKenaRateLimit };
