// lib/dashboard/comboboxFilter.js
// Logika filter murni untuk Combobox (satu sumber kebenaran: CJS, dipakai
// components/ui/combobox.tsx DAN test/combobox.test.js). Tanpa dependensi.
"use strict";

// items: [{ value, label }]. Query kosong -> semua item (referensi asli).
// Match case-insensitive pada label ATAU value.
function filterItems(items, query) {
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

// Label dari value. Tidak ketemu -> value itu sendiri. value null/kosong -> null.
function labelTerpilih(items, value) {
  if (value == null || value === "") return null;
  const daftar = Array.isArray(items) ? items : [];
  const ketemu = daftar.find((it) => it && it.value === value);
  return ketemu ? ketemu.label : value;
}

module.exports = { filterItems, labelTerpilih };
