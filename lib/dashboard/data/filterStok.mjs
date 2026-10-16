// lib/dashboard/data/filterStok.mjs
// Logika filter stok v5 (F9) - SATU sumber kebenaran untuk real.ts DAN mock.ts.
// ESM (bukan CJS) karena berkas ini masuk ke GRAFIK KLIEN: real.ts/mock.ts diimpor oleh
// lib/dashboard/sumber-data.tsx yang ber-"use client". Berkas CJS di grafik klien membuat
// React Refresh menyuntik `import.meta.webpackHot` ke modul yang diparse sebagai CJS, dan
// `next dev` gagal "Cannot use 'import.meta' outside a module" -> SEMUA route 500.
// Test CJS mengimpornya lewat dynamic `import()` (lihat test/stockFilter.test.js).
//
// Aturan (PRD F9, BR):
// - is_online hanya menyaring bila caller MENGISI: true -> hanya online, "semua" -> jangan
//   filter, tidak diisi -> jangan filter. Dulu default-nya true sehingga halaman yang lupa
//   mengisi diam-diam kehilangan produk non-online (dan pencarian pun tak menemukannya).
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
export function nilaiUntukFilter(stok, gudangId) {
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
export function lolosFilter(baris, filter, punyaKeyGudang) {
  const f = filter || {};
  const fOnline = f.is_online;
  if (fOnline !== undefined && fOnline !== "semua" && baris.is_online_product !== fOnline) return false;
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
export function bacaQtyPerGudang(data) {
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
export function nilaiBarisUntukFilter(stok, gudangId, sertakanTanpaGudang) {
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
export function terapkanFilter(baris, filter) {
  const f = filter || {};
  const fOnline = f.is_online;
  return baris.filter((r) => {
    if (fOnline !== undefined && fOnline !== "semua" && r.is_online_product !== fOnline) return false;
    if (f.gudang_id) {
      const map = r.qty_per_gudang && typeof r.qty_per_gudang === "object" ? r.qty_per_gudang : {};
      const punyaKey = Object.prototype.hasOwnProperty.call(map, f.gudang_id);
      if (!punyaKey && !f.sertakan_tanpa_gudang) return false;
    }
    return true;
  });
}

// Ekspor default (objek yang sama dengan CJS lama) supaya pemanggil `filterStok.terapkanFilter(...)`
// di real.ts/mock.ts tidak perlu diubah sama sekali. Fungsi-fungsinya sendiri sudah
// `export function`, jadi named export tersedia tanpa blok `export { ... }` tambahan —
// blok itu justru bentrok ("Duplicate export") di parser ESM.
export default { nilaiUntukFilter, lolosFilter, bacaQtyPerGudang, nilaiBarisUntukFilter, terapkanFilter };
