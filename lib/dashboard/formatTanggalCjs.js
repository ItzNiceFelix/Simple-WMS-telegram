// lib/dashboard/formatTanggalCjs.js
// Replika CJS dari `formatTanggalSingkatDariId` di `lib/dashboard/format.ts`.
// Model .js (CommonJS) tidak bisa require file .ts saat runtime Node; route TS mengimpor
// yang di format.ts. Logika WAJIB identik (diuji parity di test/permintaanHarian.test.js).
"use strict";

const NAMA_BULAN_SINGKAT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

// "2026-09-15" -> "15 Sep 2026" TANPA new Date() (anti pergeseran TZ, PRD v3a §3.5).
function formatTanggalSingkatDariId(idTanggal) {
  if (!idTanggal) return "—";
  const cocok = /^(\d{4})-(\d{2})-(\d{2})/.exec(idTanggal);
  if (!cocok) return "—";
  const namaBulan = NAMA_BULAN_SINGKAT[Number(cocok[2]) - 1];
  if (!namaBulan) return "—";
  return `${Number(cocok[3])} ${namaBulan} ${cocok[1]}`;
}

// "YYYY-MM-DD" lokal (replika CJS `idTanggalHariIni` di format.ts).
function idTanggalHariIni(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

module.exports = { formatTanggalSingkatDariId, idTanggalHariIni };
