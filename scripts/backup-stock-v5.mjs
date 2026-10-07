// scripts/backup-stock-v5.mjs
// Backup koleksi \`stock\` ke file JSON lokal (WAJIB sebelum migrasi destruktif).
// Read-only terhadap Firestore.
//
// Pakai: node scripts/backup-stock-v5.mjs
// Output: <tmp>/backup-v5/stock-<timestamp>.json
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROJECT, semua, token, angka } from "./lib/firebaseCli.mjs";

const tok = token();
const docs = await semua("stock", tok);
const dir = join(tmpdir(), "backup-v5");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = join(dir, "stock-" + stamp + ".json");

writeFileSync(file, JSON.stringify(docs, null, 1), "utf8");

const ringkas = docs.map((d) => {
  const kode = d.name.split("/").pop();
  const v = angka(d.fields?.stok_gudang_online);
  return kode + "=" + (v === null ? "TIDAK ADA" : v);
});

console.log("[backup-v5] project: " + PROJECT);
console.log("[backup-v5] file: " + file);
console.log("[backup-v5] dokumen: " + docs.length);
console.log("[backup-v5] nilai: " + ringkas.join(", "));
