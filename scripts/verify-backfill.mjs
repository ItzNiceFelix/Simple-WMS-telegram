// scripts/verify-backfill.mjs
// Verifikasi READ-ONLY migrasi v5: SETIAP dokumen \`stock\` harus punya
// \`qty_per_gudang["ONLINE"]\` yang SAMA dengan \`stok_gudang_online\` (paritas BR3/Q4a).
//
// Pakai: node scripts/verify-backfill.mjs
// Exit 0 bila paritas 100%; exit 1 bila ada selisih / key hilang.
//
// HANYA MEMBACA. Tidak menulis apa pun. Aman dijalankan kapan pun.
// Memakai token Firebase CLI (tanpa firebase-admin / ADC / gcloud).
import { PROJECT, semua, token, angka } from "./lib/firebaseCli.mjs";

const tok = token();
const docs = await semua("stock", tok);

let selisih = 0;
let tanpaKey = 0;
const contohSelisih = [];
const contohTanpaKey = [];

for (const d of docs) {
  const kode = d.name.split("/").pop();
  const f = d.fields || {};
  const map = f.qty_per_gudang?.mapValue?.fields;
  const punyaKey = !!map && Object.prototype.hasOwnProperty.call(map, "ONLINE");
  const legacy = angka(f.stok_gudang_online);

  if (!punyaKey) {
    tanpaKey++;
    if (contohTanpaKey.length < 5) contohTanpaKey.push(kode);
    continue;
  }
  const nilai = angka(map.ONLINE);
  if (nilai !== legacy) {
    selisih++;
    if (contohSelisih.length < 5) contohSelisih.push({ kode, map: nilai, legacy });
  }
}

console.log("[verify-backfill] project: " + PROJECT);
console.log("[verify-backfill] koleksi stock: " + docs.length + " dokumen");
console.log("[verify-backfill] qty_per_gudang.ONLINE != stok_gudang_online : " + selisih);
console.log("[verify-backfill] tanpa key qty_per_gudang.ONLINE               : " + tanpaKey);
if (contohSelisih.length) console.log("[verify-backfill] contoh selisih:", JSON.stringify(contohSelisih));
if (contohTanpaKey.length) console.log("[verify-backfill] contoh tanpa key:", JSON.stringify(contohTanpaKey));

if (selisih > 0 || tanpaKey > 0) {
  console.log("[verify-backfill] GAGAL - jalankan migrasi (lihat docs/plan-v5.md bagian 13).");
  process.exitCode = 1;
}
console.log("[verify-backfill] OK - paritas 100%.");
process.exitCode = 0;
