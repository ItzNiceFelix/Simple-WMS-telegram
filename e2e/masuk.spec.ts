// e2e/masuk.spec.ts — Halaman login web (PRD F1, Fase 1).
// Mock mode: halaman /masuk harus render form telegramId+password + alur lupa.
import { test, expect } from "@playwright/test";

test("halaman /masuk render form login", async ({ page }) => {
  await page.goto("/masuk");
  await expect(page.getByRole("heading", { name: /masuk simple-wms/i })).toBeVisible();
  await expect(page.getByLabel(/telegramid/i).first()).toBeVisible();
  await expect(page.getByLabel(/^password$/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /^masuk$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /lupa password/i })).toBeVisible();
});

test("alur lupa password tampil 3 tahap", async ({ page }) => {
  await page.goto("/masuk");
  await page.getByRole("button", { name: /lupa password/i }).click();
  await expect(page.getByRole("button", { name: /kirim kode via bot/i })).toBeVisible();
  await page.getByRole("button", { name: /kembali masuk/i }).click();
  await expect(page.getByRole("button", { name: /^masuk$/i })).toBeVisible();
});
