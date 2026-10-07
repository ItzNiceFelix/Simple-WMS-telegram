// Verifikasi guard R11 mode REAL: tanpa initData Telegram -> layar "Buka dari Telegram",
// query param ?role=owner diabaikan, tidak ada data dashboard.
// Pakai: node scripts/e2e-build-real.mjs; npx next start -p 3105 (job terpisah); node scripts/cek-real.mjs
import { chromium } from "playwright";

const BASE = process.env.CEK_REAL_BASE || "http://127.0.0.1:3105";
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

let gagal = 0;
for (const jalur of ["/?role=owner", "/stok?role=admin", "/admin?role=owner", "/pengaturan?role=owner"]) {
  await p.goto(`${BASE}${jalur}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  const teks = await p.locator("body").innerText();
  const layarBenar = teks.includes("Buka dari Telegram");
  const adaData = /Total Produk Online|Stok Minus|Perlu Minta Gudang Cabang|Daftar Admin/.test(teks);
  const lolos = layarBenar && !adaData;
  if (!lolos) gagal++;
  console.log(`${lolos ? "PASS" : "FAIL"} ${jalur} — layar=${layarBenar} data=${adaData}`);
}

console.log("CONSOLE_ERRORS:", errs.slice(0, 3).join(" ;; ") || "none");
await b.close();
process.exit(gagal === 0 ? 0 : 1);
