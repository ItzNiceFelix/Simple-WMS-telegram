import { test, expect } from "@playwright/test";

// Gate A0: app boot tanpa menyentuh backend data (Firestore/API Telegram).
// Catatan: SDK UI Telegram (telegram.org/js/telegram-web-app.js) MEMANG dimuat oleh
// dashboard dan itu bukan backend data — lihat e2e/offline.spec.ts untuk isolasi penuh.
test("root tampil tanpa panggilan ke backend data", async ({ page }) => {
  const eksternal: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (/firestore|googleapis|identitytoolkit|api\.telegram\.org/i.test(url)) {
      eksternal.push(url);
    }
  });
  await page.goto("/?role=owner", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toBeVisible();
  expect(eksternal).toEqual([]);
});
