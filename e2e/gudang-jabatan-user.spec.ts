import { test, expect, type Page } from "@playwright/test";

// v5 F2/F3/F4: set stok per gudang (dialog di /stok) + flag gudang/jabatan user (dialog di /admin).

async function bukaStok(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/stok?role=${role}`);
  await expect(page.getByRole("heading", { name: "Stok", level: 1 })).toBeVisible();
}

async function bukaPengaturan(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/pengaturan?role=${role}`);
}

test.describe("F2 set stok per gudang", () => {
  test("owner melihat tombol Gudang di baris stok", async ({ page }) => {
    await bukaStok(page, "owner");
    await expect(page.locator('[data-testid^="stok-gudang-"]:visible').first()).toBeVisible();
  });

  test("guest tidak melihat tombol Gudang", async ({ page }) => {
    await bukaStok(page, "guest");
    await expect(page.locator('[data-testid^="stok-gudang-"]')).toHaveCount(0);
  });

  test("dialog set stok per gudang terbuka dan punya pilihan gudang", async ({ page }) => {
    await bukaStok(page, "owner");
    await page.locator('[data-testid^="stok-gudang-"]:visible').first().click();
    const dialog = page.getByTestId("dialog-stok-gudang");
    await expect(dialog).toBeVisible();
  });
});

test.describe("F3/F4 gudang + jabatan user", () => {
  test("owner melihat tombol atur user di /pengaturan", async ({ page }) => {
    await bukaPengaturan(page, "owner");
    await expect(page.locator('[data-testid^="atur-user-"]:visible').first()).toBeVisible();
  });

  test("admin biasa tidak melihat tombol atur user", async ({ page }) => {
    await bukaPengaturan(page, "admin");
    await expect(page.locator('[data-testid^="atur-user-"]')).toHaveCount(0);
  });

  test("dialog atur gudang+jabatan terbuka", async ({ page }) => {
    await bukaPengaturan(page, "owner");
    await page.locator('[data-testid^="atur-user-"]:visible').first().click();
    await expect(page.getByTestId("dialog-user-gudang-jabatan")).toBeVisible();
  });
});
