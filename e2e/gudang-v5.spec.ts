import { test, expect, type Page } from "@playwright/test";

// v5 F1: master gudang (owner only). Mode mock. Responsif: kartu mobile + tabel desktop.

async function bukaGudang(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/gudang?role=${role}`);
}

function barisGudang(page: Page, id: string) {
  return page.locator(`[data-testid="baris-gudang-${id}"]:visible, [data-testid="daftar-gudang-kartu"] a:visible`);
}

test.describe("H10 Gudang (v5 F1)", () => {
  test("owner melihat halaman + daftar gudang seed", async ({ page }) => {
    await bukaGudang(page, "owner");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("h10-gudang")).toBeVisible();
    await expect(page.getByTestId("baris-gudang-ONLINE").first()).toBeVisible();
  });

  test("admin tidak boleh akses master gudang", async ({ page }) => {
    await bukaGudang(page, "admin");
    await expect(page.getByTestId("h10-gudang")).toHaveCount(0);
  });

  test("guest tidak boleh akses master gudang", async ({ page }) => {
    await bukaGudang(page, "guest");
    await expect(page.getByTestId("h10-gudang")).toHaveCount(0);
  });

  test("tombol tambah gudang membuka dialog", async ({ page }) => {
    await bukaGudang(page, "owner");
    await page.getByTestId("buka-tambah-gudang").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("dialog tambah: nama kosong tidak bisa submit", async ({ page }) => {
    await bukaGudang(page, "owner");
    await page.getByTestId("buka-tambah-gudang").click();
    const dialog = page.getByRole("dialog");
    const simpan = dialog.getByRole("button", { name: /simpan|tambah/i });
    await expect(simpan).toBeDisabled();
  });

  test("tombol edit gudang membuka dialog", async ({ page }) => {
    await bukaGudang(page, "owner");
    await page.locator('[data-testid="edit-gudang-ONLINE"]:visible').first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
