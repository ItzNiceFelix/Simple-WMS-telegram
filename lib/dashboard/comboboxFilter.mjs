// lib/dashboard/comboboxFilter.mjs
// Logika filter murni untuk Combobox — SATU sumber kebenaran untuk
// components/ui/combobox.tsx DAN test/combobox.test.js. Tanpa dependensi.
//
// ESM (bukan CJS) karena berkas ini masuk ke GRAFIK KLIEN: combobox.tsx ber-"use client",
// dan berkas CJS di grafik klien membuat React Refresh menyuntik `import.meta.webpackHot`
// ke modul yang diparse sebagai CJS, lalu `next dev` gagal dengan "Cannot use 'import.meta'
// outside a module" dan SELURUH route 500 — termasuk /analisa. Build produksi tidak
// terpengaruh, jadi gejalanya hanya muncul saat `npm run dev`.
// Test CJS mengimpornya lewat dynamic `import()` (lihat test/combobox.test.js).

/**
 * Saring item menurut kata kunci. Query kosong -> semua item (referensi asli).
 * Pencocokan case-insensitive pada label ATAU value.
 * @param {{ value: string; label: string }[]} items
 * @param {string | null | undefined} query
 */
export function filterItems(items, query) {
  const daftar = Array.isArray(items) ? items : [];
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return daftar;
  return daftar.filter((it) => {
    if (!it) return false;
    const label = String(it.label ?? "").toLowerCase();
    const value = String(it.value ?? "").toLowerCase();
    return label.includes(q) || value.includes(q);
  });
}

/**
 * Label dari value. Tidak ketemu -> value itu sendiri. value null/kosong -> null.
 * @param {{ value: string; label: string }[]} items
 * @param {string | null | undefined} value
 */
export function labelTerpilih(items, value) {
  if (value == null || value === "") return null;
  const daftar = Array.isArray(items) ? items : [];
  const ketemu = daftar.find((it) => it && it.value === value);
  return ketemu ? ketemu.label : value;
}
