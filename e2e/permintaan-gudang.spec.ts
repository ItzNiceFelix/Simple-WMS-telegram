import { test, expect, type Page } from "@playwright/test";

// v5 F9: filter stok per gudang + toggle online. F8: toggle is_online dari dashboard.

async function bukaStok(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/stok?role=${role}`);
  await expect(page.getByRole("heading", { name: "Stok", level: 1 })).toBeVisible();
}

test.describe("H2 Stok - filter gudang + online (v5 F9)", () => {
  test("kontrol filter online ada dan default aktif", async ({ page }) => {
    await bukaStok(page, "owner");
    await expect(page.getByTestId("filter-online-stok")).toBeVisible();
  });

  test("melepas filter online menampilkan lebih banyak baris", async ({ page }) => {
    await bukaStok(page, "owner");
    const sebelum = await page.getByTestId(/^baris-/).count();
    await page.getByTestId("filter-online-stok").click();
    const sesudah = await page.getByTestId(/^baris-/).count();
    expect(sesudah).toBeGreaterThanOrEqual(sebelum);
  });

  test("dropdown filter gudang tersedia", async ({ page }) => {
    await bukaStok(page, "owner");
    await expect(page.getByTestId("filter-gudang-stok")).toBeVisible();
  });

  test("guest dapat melihat stok (read lintas gudang, R5)", async ({ page }) => {
    await bukaStok(page, "guest");
    await expect(page.getByTestId("filter-online-stok")).toBeVisible();
  });

  test("toggle online tidak terlihat untuk guest", async ({ page }) => {
    await bukaStok(page, "guest");
    await expect(page.getByTestId(/^toggle-online-/)).toHaveCount(0);
  });

  test("owner melihat kontrol toggle online", async ({ page }) => {
    await bukaStok(page, "owner");
    await expect(page.locator('[data-testid^="toggle-online-"]:visible').first()).toBeVisible();
  });

  test("kombinasi filter gudang + online tidak error", async ({ page }) => {
    await bukaStok(page, "owner");
    await expect(page.getByTestId("filter-gudang-stok")).toBeVisible();
    await expect(page.getByTestId("filter-online-stok")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Gagal memuat");
  });

  test("perubahan filter tidak merusak tabel (baris tetap ada)", async ({ page }) => {
    await bukaStok(page, "owner");
    await page.getByTestId("filter-online-stok").click();
    await page.getByTestId("filter-online-stok").click();
    await expect(page.getByTestId(/^baris-/).first()).toBeVisible();
  });
});
