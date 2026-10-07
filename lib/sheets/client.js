// lib/sheets/client.js
// Init Google Sheets API client, pola singleton mirip lib/firebase.js —
// cache instance biar gak re-auth tiap panggilan (warm start Vercel).

const { google } = require("googleapis");

let sheetsClientCache = null;

/**
 * Ambil instance Google Sheets API v4 siap pakai (sudah auth service account).
 * @returns {import("googleapis").sheets_v4.Sheets}
 */
function ambilSheetsClient() {
  if (sheetsClientCache) return sheetsClientCache;

  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY
    ? process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined;

  if (!process.env.GOOGLE_SHEETS_CLIENT_EMAIL || !privateKey || !process.env.GOOGLE_SHEETS_ID) {
    throw new Error(
      "Env variable Google Sheets belum lengkap. Cek GOOGLE_SHEETS_ID, GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY"
    );
  }

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsClientCache = google.sheets({ version: "v4", auth });
  return sheetsClientCache;
}

// ponytail: skipped retry, add when Google timeout/5xx is frequent enough to matter —
// caller/CRON can rerun, a hung call here just burns the 300s Vercel budget for nothing.
const SHEETS_TIMEOUT_MS = Number(process.env.SHEETS_TIMEOUT_MS) || 20000;

/**
 * Reject kalau operasi Sheets gak selesai dalam SHEETS_TIMEOUT_MS. Bukan batalin request
 * ke Google (googleapis gak expose AbortSignal di sini), tapi bikin function Vercel balik
 * gagal cepat drpd nunggu sampai 300s. `label` dipakai buat pesan error yg gampang dilacak.
 */
function denganTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Google Sheets timeout (${SHEETS_TIMEOUT_MS}ms): ${label}`)),
      SHEETS_TIMEOUT_MS
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Baca satu range dari spreadsheet (GOOGLE_SHEETS_ID di env).
 * @param {string} rangeA1 - contoh "DATABASE_ACCURATE!A2:E1083"
 * @returns {Promise<string[][]>} array baris, tiap baris array kolom (raw string dari Sheets)
 */
async function bacaRange(rangeA1) {
  const sheets = ambilSheetsClient();
  const res = await denganTimeout(
    sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: rangeA1,
    }),
    `values.get ${rangeA1}`
  );
  return res.data.values || [];
}

/**
 * Tulis (overwrite) satu range dengan data baru.
 * @param {string} rangeA1
 * @param {(string|number)[][]} values
 */
async function tulisRange(rangeA1, values) {
  const sheets = ambilSheetsClient();
  await denganTimeout(
    sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: rangeA1,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    }),
    `values.update ${rangeA1}`
  );
}

/**
 * Ambil metadata sheet (dipakai buat cek header kolom, misal deteksi kolom stok online
 * sudah ada atau belum — lihat alur F poin 3).
 * @param {string} namaSheet - contoh "DATABASE_ACCURATE"
 * @returns {Promise<string[]>} isi baris header (baris 1) sheet tsb
 */
async function ambilHeader(namaSheet) {
  const baris = await bacaRange(`${namaSheet}!1:1`);
  return baris[0] || [];
}

/**
 * Tambah kolom baru ke akhir header sheet. Dipakai HANYA setelah admin konfirmasi
 * (lihat alur F poin 3 — bot gak boleh diam-diam ubah struktur Sheets).
 * @param {string} namaSheet
 * @param {string} namaKolomBaru
 * @returns {Promise<number>} index kolom baru (0-based)
 */
async function tambahKolomHeader(namaSheet, namaKolomBaru) {
  const headerSekarang = await ambilHeader(namaSheet);
  const indexKolomBaru = headerSekarang.length;
  const hurufKolom = angkaKeHurufKolom(indexKolomBaru);

  const sheets = ambilSheetsClient();

  // B1: menulis header ke kolom di luar lebar grid akan gagal. Baca metadata dulu,
  // perluas grid (appendDimension) kalau kolom baru >= columnCount, baru tulis header.
  const meta = await denganTimeout(
    sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      fields: "sheets.properties",
    }),
    `spreadsheets.get ${namaSheet}`
  );
  const sheetProps = (meta.data.sheets || []).find((s) => s.properties?.title === namaSheet)?.properties;
  if (!sheetProps) {
    // Diam-diam lanjut = nulis ke sheet yang salah/tak ada. Lempar biar keliatan.
    throw new Error(`Sheet "${namaSheet}" tidak ditemukan di metadata spreadsheet`);
  }

  const columnCount = sheetProps.gridProperties?.columnCount ?? 0;
  if (indexKolomBaru >= columnCount) {
    await denganTimeout(
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        requestBody: {
          requests: [
            {
              appendDimension: {
                sheetId: sheetProps.sheetId,
                dimension: "COLUMNS",
                // Tambah tepat sebanyak kekurangan — kalau gap >1 (header mentok tepi grid),
                // length:1 tetap bikin values.update di luar grid & gagal.
                length: indexKolomBaru - columnCount + 1,
              },
            },
          ],
        },
      }),
      `spreadsheets.batchUpdate appendDimension ${namaSheet}`
    );
  }

  await tulisRange(`${namaSheet}!${hurufKolom}1`, [[namaKolomBaru]]);
  return indexKolomBaru;
}

/**
 * Tambah satu baris baru di akhir sheet (dipakai buat produk baru yang belum punya
 * baris di Sheets sama sekali — lihat KONDISI.PRODUK_BARU di syncStokDuaArah.js).
 * Pakai values.append (bukan hitung row index manual) biar aman dari race condition
 * kalau ada baris baru masuk di antara waktu baca & tulis.
 * @param {string} namaSheet
 * @param {(string|number)[]} rowValues - satu baris, index 0 = kolom A
 */
async function tambahBarisBaru(namaSheet, rowValues) {
  const sheets = ambilSheetsClient();
  await denganTimeout(
    sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `${namaSheet}!A:A`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    }),
    `values.append ${namaSheet}`
  );
}

/**
 * Konversi index kolom 0-based ke huruf kolom A1 notation (0→A, 25→Z, 26→AA, dst).
 */
function angkaKeHurufKolom(index) {
  let hasil = "";
  let sisa = index;
  while (sisa >= 0) {
    hasil = String.fromCharCode((sisa % 26) + 65) + hasil;
    sisa = Math.floor(sisa / 26) - 1;
  }
  return hasil;
}

module.exports = {
  ambilSheetsClient,
  bacaRange,
  tulisRange,
  ambilHeader,
  tambahKolomHeader,
  tambahBarisBaru,
  angkaKeHurufKolom,
};