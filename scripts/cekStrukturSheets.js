// scripts/cekStrukturSheets.js
// READ-ONLY. Diagnosa struktur Sheets nyata buat validasi /sync_stok:
//  - lebar grid tiap sheet (nentuin B1: tambahKolomHeader nulis di luar grid?)
//  - header DATABASE_ACCURATE + posisi "Stok Online" (B6)
//  - apakah kolom B (Kode Barang) padat / ada baris bolong (B2)
//  - baris contoh buat lihat lebar baris nyata
//
// Pakai:
//   node --env-file=.env.local scripts/cekStrukturSheets.js
// atau export env dulu:
//   GOOGLE_SHEETS_ID=... GOOGLE_SHEETS_CLIENT_EMAIL=... GOOGLE_SHEETS_PRIVATE_KEY=... node scripts/cekStrukturSheets.js
//
// TIDAK menulis apa pun (scope read-only di bawah). Aman dijalankan di spreadsheet produksi.

const { google } = require("googleapis");

const SHEET_UTAMA = "DATABASE_ACCURATE";
const NAMA_KOLOM_STOK = "Stok Online";

function normalisasiHeader(t) {
  return String(t || "").trim().toLowerCase();
}

function bikinClient() {
  let privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY || "";
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
  privateKey = privateKey.replace(/\\n/g, "\n");

  if (!process.env.GOOGLE_SHEETS_ID || !process.env.GOOGLE_SHEETS_CLIENT_EMAIL || !privateKey) {
    throw new Error("Env kurang: butuh GOOGLE_SHEETS_ID, GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY");
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function main() {
  const sheets = bikinClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  console.log("# CEK STRUKTUR SHEETS (read-only)\n");

  // --- 1. Metadata: lebar grid tiap sheet (B1) ---
  console.log("## 1. Dimensi grid per sheet");
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  console.log(`   Spreadsheet: "${meta.data.properties.title}"`);
  const grid = {};
  for (const sh of meta.data.sheets) {
    const g = sh.properties.gridProperties;
    grid[sh.properties.title] = { rows: g.rowCount, cols: g.columnCount };
    console.log(`   - ${sh.properties.title}: rows=${g.rowCount} cols=${g.columnCount}`);
  }
  console.log("");

  // --- 2. Header UTAMA (B1 lanjutan + B6) ---
  console.log(`## 2. Header ${SHEET_UTAMA} (baris 1)`);
  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SHEET_UTAMA}!1:1` });
  const header = (headerRes.data.values || [])[0] || [];
  header.forEach((v, i) => {
    const huruf = String.fromCharCode(65 + i);
    console.log(`   [${i}] ${huruf}: ${JSON.stringify(v)}`);
  });
  console.log(`   header value.length = ${header.length}`);
  const idxStok = header.findIndex((h) => normalisasiHeader(h) === normalisasiHeader(NAMA_KOLOM_STOK));
  console.log(`   posisi "${NAMA_KOLOM_STOK}": ${idxStok === -1 ? "TIDAK ADA" : `index ${idxStok} (kolom ${String.fromCharCode(65 + idxStok)})`}`);
  const gridUtama = grid[SHEET_UTAMA];
  if (gridUtama) {
    if (idxStok === -1) {
      const target = header.length; // kolom yang bakal ditulis tambahKolomHeader
      const targetCol = gridUtama.cols;
      console.log(`   >> B1: tambahKolomHeader akan tulis index ${target} (${String.fromCharCode(65 + target)}) ` +
        `tapi grid cuma ${targetCol} kolom -> ${target + 1 > targetCol ? "DI LUAR GRID (BUG TERKONFIRMASI)" : "masih dalam grid"}`);
    } else {
      console.log(`   >> B1: kolom sudah ada, tak akan menambah kolom.`);
    }
  }
  console.log("");

  // --- 3. Sampel 8 baris data (B2: kolom B padat?) ---
  console.log(`## 3. Sampel data ${SHEET_UTAMA} (baris 2-9)`);
  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SHEET_UTAMA}!A2:Z10` });
  const rows = dataRes.data.values || [];
  let kodeKosong = 0;
  rows.forEach((row, i) => {
    const kode = row[1];
    if (!kode || !String(kode).trim()) kodeKosong++;
    console.log(`   row${i + 2}: len=${row.length} | B=${JSON.stringify(kode)} | ${JSON.stringify(row)}`);
  });
  console.log(`   kode_kosong_di_sampel = ${kodeKosong} / ${rows.length}`);
  console.log("");

  // --- 4. Hitung baris bolong sepanjang kolom B (B2: kode duplikat/kosong) ---
  console.log(`## 4. Integritas kolom B (Kode Barang)`);
  const kolomB = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SHEET_UTAMA}!B2:B` });
  const nilaiB = (kolomB.data.values || []).map((r) => String((r && r[0]) || "").trim());
  const kodeAsli = nilaiB.filter(Boolean);
  const unik = new Set(kodeAsli);
  const duplikat = kodeAsli.length - unik.size;
  const kosongTotal = nilaiB.length - kodeAsli.length;
  console.log(`   total baris dibaca = ${nilaiB.length}`);
  console.log(`   kode terisi = ${kodeAsli.length} | unik = ${unik.size} | duplikat = ${duplikat} | kosong = ${kosongTotal}`);
  console.log(`   >> B2: ${duplikat > 0 ? "ADA KODE DUPLIKAT -> findIndex bisa timpa baris salah (BUG TERKONFIRMASI)" : "kode unik (aman)"}`);
  console.log(`   >> B2: ${kosongTotal > 0 ? "ADA BARIS BOLONG di kolom B -> findIndex bisa geser (cek manual)" : "kolom B padat (aman)"}`);
  console.log("");

  console.log("# SELESAI. Copy seluruh output ini ke chat.");
}

main().catch((e) => {
  console.error("GAGAL:", e.message);
  console.error("Pastikan env GOOGLE_SHEETS_* sudah diset (lihat .env.example bagian GOOGLE SHEETS).");
  process.exitCode = 1;
});
