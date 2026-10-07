// lib/dashboard/data/filterStok.js
// Logika filter stok v5 (F9) - SATU sumber kebenaran untuk real.ts DAN mock.ts.
// CJS murni supaya bisa diuji langsung node --test (mock.ts/real.ts tidak dapat di-require).
//
// Aturan (PRD F9, BR):
// - is_online default true -> hanya produk online (paritas perilaku lama).
// - is_online "semua" -> jangan filter.
// - gudang_id -> nilai baris = qty_per_gudang[gudang_id]; key absen -> null.
// - sertakan_tanpa_gudang=false (default) -> baris tanpa key gudang itu disembunyikan.
//
// Fungsi murni: tidak menyentuh db/network. Input = baris mentah + filter, output = keputusan.

/**
 * Nilai qty untuk satu baris menurut filter gudang.
 * @param {{ stok_gudang_online: number | null; qty_per_gudang?: Record<string, number> } | null} stok
 * @param {string | null | undefined} gudangId
 * @returns {number | null}
 */
function nilaiUntukFilter(stok, gudangId) {
  if (!gudangId) return stok ? (typeof stok.stok_gudang_online === "number" ? stok.stok_gudang_online : null) : null;
  const map = stok && stok.qty_per_gudang;
  if (!map || typeof map !== "object") return null;
  const v = map[gudangId];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Apakah baris lolos filter?
 * @param {{ is_online_product: boolean; stok_gudang_online: number | null }} baris - nilai sudah hasil nilaiUntukFilter
 * @param {{ gudang_id?: string | null; is_online?: boolean | "semua"; sertakan_tanpa_gudang?: boolean }} filter
 * @param {boolean} punyaKeyGudang - apakah map punya key gudang target (untuk sembunyikan null)
 * @returns {boolean}
 */
function lolosFilter(baris, filter, punyaKeyGudang) {
  const f = filter || {};
  const fOnline = f.is_online === undefined ? true : f.is_online;
  if (fOnline !== "semua" && baris.is_online_product !== fOnline) return false;
  if (f.gudang_id) {
    if (baris.stok_gudang_online === null && !punyaKeyGudang && !f.sertakan_tanpa_gudang) return false;
    if (baris.stok_gudang_online === null && !f.sertakan_tanpa_gudang) return false;
  }
  return true;
}

/**
 * Normalisasi map qty per gudang dari dokumen mentah.
 * Dokumen lama tanpa map -> { ONLINE: stok_gudang_online } (BR3/Q4a).
 * @param {{ stok_gudang_online?: unknown; qty_per_gudang?: unknown } | null | undefined} data
 * @returns {Record<string, number>}
 */
function bacaQtyPerGudang(data) {
  if (!data) return {};
  const map = data.qty_per_gudang;
  if (map && typeof map === "object" && !Array.isArray(map)) {
    const out = {};
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  }
  const legacy = data.stok_gudang_online;
  return typeof legacy === "number" && Number.isFinite(legacy) ? { ONLINE: legacy } : {};
}

/** Nilai stok_gudang_online efektif untuk filter gudang. Keluar = null bila tak ada key & tidak disertakan. */
function nilaiBarisUntukFilter(stok, gudangId, sertakanTanpaGudang) {
  if (!gudangId) {
    return stok && typeof stok.stok_gudang_online === "number" ? stok.stok_gudang_online : null;
  }
  const map = bacaQtyPerGudang(stok);
  if (Object.prototype.hasOwnProperty.call(map, gudangId)) return map[gudangId];
  return sertakanTanpaGudang ? null : null;
}

/**
 * Terapkan filter ke daftar baris (sudah berbentuk StockRow calon - punya is_online_product,
 * stok_gudang_online, qty_per_gudang). Murni, tanpa efek samping.
 * @param {Array<Record<string, unknown>>} baris
 * @param {{ gudang_id?: string | null; is_online?: boolean | "semua"; sertakan_tanpa_gudang?: boolean }} filter
 * @returns {Array<Record<string, unknown>>}
 */
function terapkanFilter(baris, filter) {
  const f = filter || {};
  const fOnline = f.is_online === undefined ? true : f.is_online;
  return baris.filter((r) => {
    if (fOnline !== "semua" && r.is_online_product !== fOnline) return false;
    if (f.gudang_id) {
      const map = r.qty_per_gudang && typeof r.qty_per_gudang === "object" ? r.qty_per_gudang : {};
      const punyaKey = Object.prototype.hasOwnProperty.call(map, f.gudang_id);
      if (!punyaKey && !f.sertakan_tanpa_gudang) return false;
    }
    return true;
  });
}

module.exports = { nilaiUntukFilter, lolosFilter, bacaQtyPerGudang, nilaiBarisUntukFilter, terapkanFilter };
