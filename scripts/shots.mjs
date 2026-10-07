import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3100";
const HAL = ["/", "/stok", "/histori", "/draft", "/permintaan", "/admin", "/pengaturan", "/produk/BRG-004"];
const OUT = "test-results/visual";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();

for (const [nama, vp] of [["mobile", { width: 360, height: 640 }], ["desktop", { width: 1280, height: 800 }]]) {
  const ctx = await b.newContext({ viewport: vp });
  const p = await ctx.newPage();
  for (const hal of HAL) {
    const slug = hal === "/" ? "h1-ringkasan" : hal.replace(/\//g, "-").replace(/^-/, "");
    await p.goto(`${BASE}${hal}?role=owner`, { waitUntil: "networkidle" });
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${OUT}/${nama}-${slug}.png`, fullPage: true });
  }
  // mode gelap: H2 + H1
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/?role=owner`, { waitUntil: "networkidle" });
  await p2.getByRole("button", { name: /mode gelap/i }).click();
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: `${OUT}/${nama}-h1-gelap.png`, fullPage: true });
  await ctx.close();
}

await b.close();
console.log("shots done");
