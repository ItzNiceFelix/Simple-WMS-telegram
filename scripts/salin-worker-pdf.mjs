// scripts/salin-worker-pdf.mjs — salin worker pdf.js ke public/ agar dilayani sendiri.
//
// KENAPA: `pdfjs-dist` butuh worker terpisah. Memuatnya dari CDN berarti Printing mati
// saat offline/CSP memblokir jsdelivr — dan WebView Telegram tidak selalu punya jaringan
// stabil. Worker HARUS seversi dengan paketnya, jadi salinan disegarkan tiap install/build.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const akar = dirname(dirname(fileURLToPath(import.meta.url)));
let paket;
try {
  paket = require.resolve("pdfjs-dist/package.json");
} catch {
  // pdfjs-dist belum terpasang (mis. install parsial): jangan gagalkan install.
  console.log("[worker-pdf] pdfjs-dist belum ada, salinan dilewati.");
  process.exit(0);
}

const sumber = join(dirname(paket), "build", "pdf.worker.min.mjs");
const tujuanDir = join(akar, "public");
const tujuan = join(tujuanDir, "pdf.worker.min.mjs");
if (!existsSync(sumber)) {
  console.log("[worker-pdf] worker tidak ditemukan di paket, salinan dilewati.");
  process.exit(0);
}
mkdirSync(tujuanDir, { recursive: true });
if (existsSync(tujuan) && readFileSync(tujuan).equals(readFileSync(sumber))) {
  console.log("[worker-pdf] sudah seversi dengan pdfjs-dist.");
  process.exit(0);
}
copyFileSync(sumber, tujuan);
const versi = JSON.parse(readFileSync(paket, "utf8")).version;
console.log(`[worker-pdf] public/pdf.worker.min.mjs disalin untuk pdfjs-dist ${versi}.`);
