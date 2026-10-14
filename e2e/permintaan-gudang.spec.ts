import { test, expect, type Page } from "@playwright/test";

// v5 F9: filter stok per gudang. F8: toggle is_online dari dashboard.
//
// Filter "Hanya produk online" DIHAPUS (keputusan 2026-10-14): halaman stok harus
// menampilkan SEMUA produk. Filter itu dulu default AKTIF, sehingga 692 dari 1174 produk
// (termasuk hasil sinkron Kledo) tersembunyi dari daftar DAN dari pencarian — sebab
// penyaringannya dilakukan server-side, bukan di klien. Uji di bawah mengunci perilaku baru.

async function bukaStok(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/stok?role=${role}`);
  await expect(page.getByRole("heading", { name: "Stok", level: 1 })).toBeVisible();
}

test.describe("H2 Stok - filter gudang (v5 F9)", () => {
  test("filter online sudah tidak ada lagi", async ({ page }) => {
    await bukaStok(page, "owner");
    await expect(page.getByTestId("filter-online-stok")).toHaveCount(0);
    await expect(page.getByTestId("toggle-hanya-online")).toHaveCount(0);
  });

  test("dropdown filter gudang tersedia", async ({ page }) => {
    await bukaStok(page, "owner");
    await expect(page.getByTestId("filter-gudang-stok")).toBeVisible();
  });

  test("guest dapat melihat stok (read lintas gudang, R5)", async ({ page }) => {
    await bukaStok(page, "guest");
    await expect(page.getByTestId("filter-gudang-stok")).toBeVisible();
    await expect(page.getByTestId(/^baris-/).first()).toBeVisible();
  });

  test("toggle online per baris tidak terlihat untuk guest", async ({ page }) => {
    await bukaStok(page, "guest");
    await expect(page.getByTestId(/^toggle-online-/)).toHaveCount(0);
  });

  test("owner melihat kontrol toggle online per baris", async ({ page }) => {
    await bukaStok(page, "owner");
    await expect(page.locator('[data-testid^="toggle-online-"]:visible').first()).toBeVisible();
  });

  test("daftar stok memuat tanpa error", async ({ page }) => {
    await bukaStok(page, "owner");
    await expect(page.locator("body")).not.toContainText("Gagal memuat");
    await expect(page.getByTestId(/^baris-/).first()).toBeVisible();
  });
});
