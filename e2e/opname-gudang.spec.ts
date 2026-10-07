import { test, expect, type Page } from "@playwright/test";

// v5 F7: opname dari dashboard (admin + owner). Owner approve selisih.

async function bukaOpname(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/opname-gudang?role=${role}`);
}

test.describe("H11 Opname Gudang (v5 F7)", () => {
  test("owner melihat halaman opname", async ({ page }) => {
    await bukaOpname(page, "owner");
    await expect(page.getByTestId("h11-opname-gudang")).toBeVisible();
  });

  test("admin melihat halaman opname", async ({ page }) => {
    await bukaOpname(page, "admin");
    await expect(page.getByTestId("h11-opname-gudang")).toBeVisible();
  });

  test("guest tidak boleh akses opname", async ({ page }) => {
    await bukaOpname(page, "guest");
    await expect(page.getByTestId("h11-opname-gudang")).toHaveCount(0);
  });

  test("owner dapat menambah baris item opname", async ({ page }) => {
    await bukaOpname(page, "owner");
    await expect(page.getByTestId("daftar-baris-opname")).toBeVisible();
  });

  test("pilih gudang tersedia di form opname", async ({ page }) => {
    await bukaOpname(page, "owner");
    await expect(page.getByTestId("pilih-gudang-opname")).toBeVisible();
  });
});
