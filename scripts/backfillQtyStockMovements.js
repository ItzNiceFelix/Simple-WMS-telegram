// scripts/backfillQtyStockMovements.js
// Migrasi data lama: normalisasi tanda field `qty` di koleksi `stock_movements`.
// Kontrak: qty = DELTA BERTANDA (negatif = stok berkurang). Jalur BOT lama menulis
// magnitudo positif walau arahnya mengurangi, merusak UI histori & rata-rata pemakaian
// harian (lib/reminder/reminderHarian.js). Jalur web_dashboard sudah benar -> JANGAN disentuh.
//
// Default DRY-RUN (hanya cetak). Jalankan dgn `--apply` untuk benar-benar menulis.
//   node scripts/backfillQtyStockMovements.js           # dry-run
//   node scripts/backfillQtyStockMovements.js --apply   # tulis
// Idempoten: cek nilai target dulu, dokumen yang sudah benar dilewati.

const { db } = require("../lib/firebase");

const KOLEKSI = "stock_movements";
const APPLY = process.argv.includes("--apply");

// Hitung qty target. Return { qty, aksi } — aksi: "ubah" | "lewati" | "manual".
function hitungQtyTarget(data) {
  if (data.source === "web_dashboard") return { aksi: "lewati" }; // sudah bertanda benar

  const qty = Number(data.qty) || 0;

  if (data.type === "sync_confirmed") {
    // Delta seharusnya = nilai baru - stok sebelum sync. Data lama tidak menyimpan
    // stok sebelumnya, jadi tidak bisa dihitung ulang -> jangan menebak.
    const stokSebelum = data.stok_sebelum;
    if (stokSebelum === undefined || stokSebelum === null) {
      return { aksi: "manual", qty: 0 };
    }
    const nilaiBaru = data.qty_sistem_baru ?? data.nilai ?? data.qty_fisik;
    if (nilaiBaru === undefined || nilaiBaru === null) {
      return { aksi: "manual", qty: 0 };
    }
    return { aksi: "ubah", qty: nilaiBaru - stokSebelum };
  }

  if (data.type === "opname") {
    if (data.selisih === undefined || data.selisih === null) return { aksi: "lewati" };
    return { aksi: "ubah", qty: data.selisih };
  }

  if (data.action_type === "kurangi_stok") return { aksi: "ubah", qty: -Math.abs(qty) };
  if (data.action_type === "tambah_stok") return { aksi: "ubah", qty: Math.abs(qty) };

  return { aksi: "lewati" };
}

async function main() {
  console.log(`[backfill-qty] mode: ${APPLY ? "APPLY (menulis)" : "DRY-RUN (tidak menulis)"}`);
  const snapshot = await db.collection(KOLEKSI).get();

  let diperiksa = 0;
  let diubah = 0;
  const manual = [];

  for (const doc of snapshot.docs) {
    diperiksa++;
    const data = doc.data();
    const { aksi, qty } = hitungQtyTarget(data);

    if (aksi === "lewati") continue;

    if (aksi === "manual") {
      // JANGAN menebak dan jangan menyentuh dokumen: data lama tidak punya info utk
      // menghitung delta sync. Cukup catat id-nya utk ditinjau manual.
      manual.push(doc.id);
      continue;
    }

    if ((Number(data.qty) || 0) === qty) continue; // sudah benar -> idempoten

    diubah++;
    console.log(`  ${doc.id}: qty ${data.qty} -> ${qty} (type=${data.type} action_type=${data.action_type})`);
    if (APPLY) await db.collection(KOLEKSI).doc(doc.id).update({ qty });
  }

  console.log(`[backfill-qty] diperiksa: ${diperiksa}, diubah: ${diubah}, manual: ${manual.length}`);
  if (manual.length > 0) {
    console.log(
      `[backfill-qty] PERLU TINJAU MANUAL (sync_confirmed lama tanpa info delta, TIDAK diubah): ${manual.join(", ")}`
    );
  }
  if (!APPLY && diubah > 0) console.log("[backfill-qty] ini dry-run. Jalankan ulang dgn --apply untuk menulis.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[backfill-qty] gagal:", err);
    process.exitCode = 1;
  });
}

module.exports = { hitungQtyTarget };
