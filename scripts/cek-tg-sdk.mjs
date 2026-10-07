// Verifikasi SDK Telegram benar-benar dimuat dan window.Telegram.WebApp tersedia.
// (Tidak menguji initData asli — itu hanya ada di Telegram nyata.)
import { chromium } from "playwright";

const BASE = process.env.CEK_BASE || "http://127.0.0.1:3100";
const b = await chromium.launch();
const p = await b.newPage();

const gagal = [];
p.on("pageerror", (e) => gagal.push(`pageerror: ${e.message}`));
p.on("requestfailed", (r) => {
  if (r.url().includes("telegram-web-app")) gagal.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`);
});

await p.goto(`${BASE}/?role=owner`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);

const adaScript = await p.locator('script[src*="telegram-web-app"]').count();
const adaTelegram = await p.evaluate(() => typeof window.Telegram !== "undefined");
const adaWebApp = await p.evaluate(() => typeof window.Telegram?.WebApp !== "undefined");
const sdkVersion = await p.evaluate(() => window.Telegram?.WebApp?.version ?? null);

console.log("script_tag:", adaScript);
console.log("window.Telegram:", adaTelegram);
console.log("Telegram.WebApp:", adaWebApp);
console.log("SDK version:", sdkVersion);
console.log("masalah:", gagal.length ? gagal.join(" ;; ") : "none");

await b.close();
process.exit(adaScript > 0 && adaWebApp ? 0 : 1);
