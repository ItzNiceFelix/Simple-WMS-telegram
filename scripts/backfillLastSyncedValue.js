// scripts/backfillLastSyncedValue.js
// PRIORITAS: nice-to-have — BUKAN perbaikan bug. Guard `bandingkanNilai` (syncStokDuaArah.js)
// sudah men-cegah konflik saat nilai Firestore == nilai Sheets walau last_synced_value kosong,
// jadi /sync_stok tetap aman tanpa script ini. Script ini hanya bantu KLASIFIKASI akurat
// (kurangi item "sheets_manual/konflik" palsu) dgn mengisi last_synced_value utk baris yang
// saat ini sudah sepakat antara Firestore & Sheets.
//
// Default DRY-RUN (hanya cetak). Jalankan dgn `--apply` untuk benar-benar menulis.
//   node scripts/backfillLastSyncedValue.js           # dry-run
//   node scripts/backfillLastSyncedValue.js --apply   # tulis
// Idempoten: hanya menyentuh kode yang nilainya sudah sama; yang beda/null dilewati.

const { db } = require("../lib/firebase");
const { listSemuaProduk } = require("../lib/models/produk");
const { ambilStok, bacaParitasOnline, tandaiTersinkron } = require("../lib/models/stok");
const { bacaRange, ambilHeader } = require("../lib/sheets/client");

const NAMA_SHEET_STOK = "DATABASE_ACCURATE";
const NAMA_KOLOM_STOK_ONLINE = "Stok Online";
const APPLY = process.argv.includes("--apply");

function normalisasiHeader(teks) {
  return String(teks || "").trim().toLowerCase();
}

/**
 * Pilih kode yang layak di-backfill: nilai Firestore (paritas online) === nilai Sheets DAN
 * bukan null/undefined. Fungsi MURNI (tanpa jaringan) supaya bisa diuji.
 *
 * @param {Map<string, number>} sheetMap - Map<kode_barang, nilai stok di Sheets>
 * @param {Map<string, object>} stokMap - Map<kode_barang, dokumen stock Firestore>
 * @returns {{kode: string, nilai: number, alasan: string}[]} alasan: "isi" untuk yang dipilih,
 *   selain itu alasan skip ("beda", "sheet_kosong", "stok_tak_ada", "stok_null")
 */
function pilihKodeBackfill(sheetMap, stokMap) {
  const hasil = [];
  for (const [kode, nilaiSheet] of sheetMap) {
    const stok = stokMap.get(kode);
    if (!stok) {
      hasil.push({ kode, nilai: null, alasan: "stok_tak_ada" });
      continue;
    }
    const nilaiFirestore = bacaParitasOnline(stok);
    if (nilaiSheet === null || nilaiSheet === undefined) {
      hasil.push({ kode, nilai: null, alasan: "sheet_kosong" });
      continue;
    }
    if (nilaiFirestore === null || nilaiFirestore === undefined) {
      hasil.push({ kode, nilai: null, alasan: "stok_null" });
      continue;
    }
    if (nilaiFirestore !== nilaiSheet) {
      hasil.push({ kode, nilai: nilaiSheet, alasan: "beda" });
      continue;
    }
    hasil.push({ kode, nilai: nilaiSheet, alasan: "isi" });
  }
  return hasil;
}

/** Temukan index kolom "Stok Online" dari baris header. */
function cariIndexKolomStok(header) {
  return header.findIndex((h) => normalisasiHeader(h) === normalisasiHeader(NAMA_KOLOM_STOK_ONLINE));
}

async function main() {
  console.log(`[backfill-lastSynced] mode: ${APPLY ? "APPLY (menulis)" : "DRY-RUN (tidak menulis)"}`);

  const header = await ambilHeader(NAMA_SHEET_STOK);
  const indexKolom = cariIndexKolomStok(header);
  if (indexKolom === -1) {
    console.log(`[backfill-lastSynced] kolom "${NAMA_KOLOM_STOK_ONLINE}" tidak ditemukan di header. Stop.`);
    return;
  }

  // Kolom A2:... cukup sampai kolom stok online (kode di kolom B).
  const barisSheet = await bacaRange(`${NAMA_SHEET_STOK}!A2:${kolomHuruf(indexKolom)}`);
  const sheetMap = new Map();
  for (const baris of barisSheet) {
    const kode = String(baris[1] || "").trim();
    if (!kode) continue;
    const raw = baris[indexKolom];
    // kolom kosong -> null (bukan 0) supaya tidak salah dianggap "sudah sama".
    sheetMap.set(kode, String(raw ?? "").trim() === "" ? null : Number(raw));
  }

  const produk = await listSemuaProduk({ hanyaOnline: true });
  const stokMap = new Map();
  for (const p of produk) {
    const stok = await ambilStok(p.kode_barang);
    if (stok) stokMap.set(p.kode_barang, stok);
  }

  const hasil = pilihKodeBackfill(sheetMap, stokMap);
  let diisi = 0;
  const dilewati = { beda: 0, sheet_kosong: 0, stok_tak_ada: 0, stok_null: 0 };

  for (const h of hasil) {
    if (h.alasan !== "isi") {
      dilewati[h.alasan] = (dilewati[h.alasan] || 0) + 1;
      continue;
    }
    const stok = stokMap.get(h.kode);
    // idempoten: sudah sepakat di nilai yang sama -> skip.
    if (stok.last_synced_value === h.nilai) continue;
    diisi++;
    console.log(`  ${h.kode}: last_synced_value -> ${h.nilai}`);
    if (APPLY) await tandaiTersinkron(h.kode, h.nilai);
  }

  console.log(
    `[backfill-lastSynced] baris sheet: ${sheetMap.size}, diisi: ${diisi}, ` +
      `dilewati: beda=${dilewati.beda} sheet_kosong=${dilewati.sheet_kosong} ` +
      `stok_tak_ada=${dilewati.stok_tak_ada} stok_null=${dilewati.stok_null}`
  );
  if (!APPLY && diisi > 0) console.log("[backfill-lastSynced] ini dry-run. Jalankan ulang dgn --apply untuk menulis.");
}

// Angka index -> huruf kolom (duplikat kecil dari lib/sheets/client.angkaKeHurufKolom,
// sengaja lokal biar script mandiri; tidak diekspor client utk kasus ini pun tidak perlu).
function kolomHuruf(index) {
  let hasil = "";
  let sisa = index;
  while (sisa >= 0) {
    hasil = String.fromCharCode((sisa % 26) + 65) + hasil;
    sisa = Math.floor(sisa / 26) - 1;
  }
  return hasil;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[backfill-lastSynced] gagal:", err);
    process.exitCode = 1;
  });
}

module.exports = { pilihKodeBackfill, cariIndexKolomStok, normalisasiHeader };
