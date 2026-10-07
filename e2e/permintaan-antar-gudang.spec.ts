import { test, expect, type Page } from "@playwright/test";

// v5 F5/F6: halaman permintaan antar-gudang. Mode mock.

async function buka(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/permintaan-gudang?role=${role}`);
}

test.describe("H12 Permintaan Gudang (v5 F5/F6)", () => {
  test("owner melihat halaman", async ({ page }) => {
    await buka(page, "owner");
    await expect(page.getByTestId("h12-permintaan-gudang")).toBeVisible();
  });

  test("admin melihat halaman", async ({ page }) => {
    await buka(page, "admin");
    await expect(page.getByTestId("h12-permintaan-gudang")).toBeVisible();
  });

  test("guest tidak boleh akses", async ({ page }) => {
    await buka(page, "guest");
    await expect(page.getByTestId("h12-permintaan-gudang")).toHaveCount(0);
  });

  test("daftar permintaan seed tampil", async ({ page }) => {
    await buka(page, "owner");
    await expect(page.getByTestId("daftar-permintaan")).toBeVisible();
  });

  test("filter status tersedia", async ({ page }) => {
    await buka(page, "owner");
    await expect(page.getByTestId("filter-status-permintaan")).toBeVisible();
  });

  test("tombol buat permintaan membuka dialog", async ({ page }) => {
    await buka(page, "owner");
    await page.getByTestId("buka-buat-permintaan").click();
    await expect(page.getByTestId("dialog-permintaan")).toBeVisible();
  });
});
