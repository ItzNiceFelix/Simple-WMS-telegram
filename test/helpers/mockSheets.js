// test/helpers/mockSheets.js
// Mock Google Sheets client in-memory STATEFUL — meniru semantik Sheets v4 yang dipakai
// lib/sheets/client.js. Bukan no-op: bacaRange/tulisRange/append benar-benar mengubah array.
//
// Cakupan: satu sheet (DATABASE_ACCURATE). Tambah sheet lain: panggil installMockSheets dengan
// { ["NAMA_SHEET"]: [[...header], [...row]] }.
//
// TIRU Sheets:
// - Range "SHEET!A2:C" → mulai baris 2, kolom A..C. Baris 1 = header (index array 0).
// - trailing empty cell DIPANGKAS per baris (Sheets gak balikin sel kosong di ujung).
// - append menaruh baris SETELAH baris berisi terakhir.
// - tulisRange menimpa sel; baris/kolom baru di-extend seperlunya.

function angkaKeHurufKolom(index) {
  let hasil = "";
  let sisa = index;
  while (sisa >= 0) {
    hasil = String.fromCharCode((sisa % 26) + 65) + hasil;
    sisa = Math.floor(sisa / 26) - 1;
  }
  return hasil;
}

function hurufKeIndexKolom(huruf) {
  let n = 0;
  for (const ch of huruf.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Pisah "DATABASE_ACCURATE!A2:C" → { nama, kolomAwal, barisAwal, kolomAkhir }
function parseRange(rangeA1) {
  const [nama, sel] = rangeA1.includes("!") ? rangeA1.split("!") : [rangeA1, "A:ZZZ"];
  let kolomAwal = 0;
  let barisAwal = 0;
  let kolomAkhir = Infinity;

  if (/^\d+:\d+$/.test(sel)) {
    const [a, b] = sel.split(":").map(Number);
    barisAwal = a - 1;
    kolomAkhir = Infinity; // seluruh kolom
    return { nama, kolomAwal, barisAwal, kolomAkhir, sampaiBaris: b - 1 };
  }

  const m = sel.match(/^([A-Z]*)(\d*):([A-Z]*)(\d*)$/);
  if (m) {
    const [, kA, bA, kB] = m;
    if (kA) kolomAwal = hurufKeIndexKolom(kA);
    if (bA) barisAwal = Number(bA) - 1;
    if (kB) kolomAkhir = hurufKeIndexKolom(kB);
    return { nama, kolomAwal, barisAwal, kolomAkhir };
  }
  // Sel tunggal "F2" (tanpa colon) — dipakai tulisRange per-cell.
  const m3 = sel.match(/^([A-Z]+)(\d+)$/);
  if (m3) {
    const k = hurufKeIndexKolom(m3[1]);
    return { nama, kolomAwal: k, barisAwal: Number(m3[2]) - 1, kolomAkhir: k };
  }

  // "A2:A" (tanpa baris akhir)
  const m2 = sel.match(/^([A-Z]*)(\d*):([A-Z]*)$/);
  if (m2) {
    const [, kA, bA, kB] = m2;
    if (kA) kolomAwal = hurufKeIndexKolom(kA);
    if (bA) barisAwal = Number(bA) - 1;
    if (kB) kolomAkhir = hurufKeIndexKolom(kB);
    return { nama, kolomAwal, barisAwal, kolomAkhir };
  }
  return { nama, kolomAwal, barisAwal, kolomAkhir };
}

function panggangTrailing(row) {
  const r = [...row];
  while (r.length > 0 && (r[r.length - 1] === "" || r[r.length - 1] === undefined || r[r.length - 1] === null)) {
    r.pop();
  }
  return r;
}

function installMockSheets(seed = {}) {
  // sheets: Map<nama, string[][]> — selalu simpan array MENTAH (termasuk sel kosong di tengah).
  const sheets = new Map();
  for (const [nama, rows] of Object.entries(seed)) {
    sheets.set(nama, rows.map((r) => [...r]));
  }

  const storeFor = (nama) => {
    if (!sheets.has(nama)) sheets.set(nama, []);
    return sheets.get(nama);
  };

  const pastikanGrid = (arr, baris, kolom) => {
    while (arr.length <= baris) arr.push([]);
    while (arr[baris].length <= kolom) arr[baris].push("");
  };

  async function bacaRange(rangeA1) {
    const { nama, kolomAwal, barisAwal, kolomAkhir } = parseRange(rangeA1);
    const arr = storeFor(nama);
    const hasil = [];
    for (let b = barisAwal; b < arr.length; b++) {
      const barisArr = arr[b] || [];
      const slice = [];
      const akhir = kolomAkhir === Infinity ? barisArr.length - 1 : kolomAkhir;
      for (let k = kolomAwal; k <= akhir; k++) {
        const v = barisArr[k];
        slice.push(v === undefined || v === null ? "" : v);
      }
      hasil.push(panggangTrailing(slice));
    }
    return hasil;
  }

  async function tulisRange(rangeA1, values) {
    const { nama, kolomAwal, barisAwal } = parseRange(rangeA1);
    const arr = storeFor(nama);
    for (let i = 0; i < values.length; i++) {
      const rowIdx = barisAwal + i;
      const rowVals = values[i];
      for (let j = 0; j < rowVals.length; j++) {
        pastikanGrid(arr, rowIdx, kolomAwal + j);
        arr[rowIdx][kolomAwal + j] = rowVals[j];
      }
    }
    return { ok: true };
  }

  async function ambilHeader(namaSheet) {
    const arr = storeFor(namaSheet);
    return arr[0] ? panggangTrailing([...arr[0]]) : [];
  }

  // Append: baris baru ditaruh setelah baris berisi terakhir (semua kolom dianggap).
  async function tambahBarisBaru(namaSheet, rowValues) {
    const arr = storeFor(namaSheet);
    let barisTerakhirIsi = -1;
    for (let i = 0; i < arr.length; i++) {
      if ((arr[i] || []).some((v) => v !== "" && v !== undefined && v !== null)) barisTerakhirIsi = i;
    }
    const target = barisTerakhirIsi + 1;
    arr[target] = [...rowValues];
    return { ok: true };
  }

  async function tambahKolomHeader(namaSheet, namaKolomBaru) {
    const arr = storeFor(namaSheet);
    if (arr.length === 0) arr.push([]);
    const idx = arr[0].length;
    arr[0][idx] = namaKolomBaru;
    return idx;
  }

  return { sheets, bacaRange, tulisRange, ambilHeader, tambahBarisBaru, tambahKolomHeader, angkaKeHurufKolom, parseRange };
}

module.exports = { installMockSheets, angkaKeHurufKolom, hurufKeIndexKolom };
