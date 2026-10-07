// lib/models/stokGudang.js
// Helper MURNI untuk stok per gudang (v5). File ini TIDAK mengimpor `db` dan TIDAK
// mengimpor `lib/firebase` - hanya operasi atas objek/transaksi yang di-inject pemanggil.
// Tujuannya: logika paritas `qty_per_gudang` ber-gudang-"ONLINE" <-> `stok_gudang_online`
// punya SATU sumber kebenaran yang mudah diuji tanpa Firestore.
//
// Dipakai oleh:
// - lib/models/stok.js (setQtyGudang, paritas tulis lama)
// - lib/models/permintaanGudang.js (tambah/kurang qty saat kirim/terima/tidak-terima)
//
// Aturan (BR3, architecture-v5.md:4.1):
// - `qty_per_gudang` adalah sumber angka per gudang.
// - `stok_gudang_online` adalah CERMINAN key "ONLINE" di map itu (bukan total lintas gudang).
// - Setiap tulis gudang "ONLINE" WAJIB menulis kedua field dalam operasi yang sama.

/** Kunci gudang default warisan dari versi lama (stok_gudang_online). */
const GUDANG_ONLINE = "ONLINE";

/**
 * normalisasiQtyPerGudang(data) -> Record<string, number>
 * Satu-satunya fungsi pembentuk map dari dokumen `stock` mentah (boundary baca).
 * - Bila `qty_per_gudang` absen -> fallback { "ONLINE": data.stok_gudang_online ?? 0 }.
 * - Nilai yang bukan angka terbatas dibuang (NaN, undefined, string kosong).
 */
function normalisasiQtyPerGudang(data) {
  const d = data || {};
  const map = d.qty_per_gudang;
  if (map && typeof map === "object" && !Array.isArray(map)) {
    const hasil = {};
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === "number" && Number.isFinite(v)) hasil[k] = v;
    }
    return hasil;
  }
  // Fallback dokumen lama (belum di-backfill).
  return { [GUDANG_ONLINE]: angkaAman(d.stok_gudang_online) };
}

/** Nilai key "ONLINE" (paritas `stok_gudang_online`). Relasi eksplisit (bukan fungsi paralel). */
function bacaParitasOnline(data) {
  const map = normalisasiQtyPerGudang(data);
  return map[GUDANG_ONLINE] ?? 0;
}

/** angka -> number terbatas; bukan angka -> 0. */
function angkaAman(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Payload paritas untuk tulis: hasilkan field yang harus ditulis agar
 * `qty_per_gudang[gudangId]` = nilaiBaru DAN (bila gudangId "ONLINE") `stok_gudang_online` = nilaiBaru.
 * PENTING: map dikembalikan UTUH (semua key lain dipertahankan).
 */
function payloadQtyGudang(dataLama, gudangId, nilaiBaru) {
  const map = normalisasiQtyPerGudang(dataLama);
  map[gudangId] = nilaiBaru;
  const payload = { qty_per_gudang: map };
  if (gudangId === GUDANG_ONLINE) payload.stok_gudang_online = nilaiBaru;
  return payload;
}

/**
 * Hitung nilai baru per gudang tanpa menulis.
 * Untuk gudang "ONLINE", basis = paritas online; selain itu = map[gudangId] ?? 0.
 */
function hitungNilaiBaru(dataLama, gudangId, delta) {
  const map = normalisasiQtyPerGudang(dataLama);
  const basis = gudangId === GUDANG_ONLINE ? bacaParitasOnline(dataLama) : (map[gudangId] ?? 0);
  return basis + delta;
}

module.exports = {
  GUDANG_ONLINE,
  normalisasiQtyPerGudang,
  bacaParitasOnline,
  payloadQtyGudang,
  hitungNilaiBaru,
  angkaAman,
};
