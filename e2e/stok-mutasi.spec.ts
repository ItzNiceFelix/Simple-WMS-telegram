import { test, expect, type Page } from "@playwright/test";

// v5.2 (D6) - mode Mutasi di dialog Stok per Gudang. Selalu mode mock (PRD I2).
// Data mock: gudang aktif = ONLINE (urutan 0) + D12 ("Gudang D12", urutan 1).
// BRG-001 qty_per_gudang = { ONLINE: 42 }, jadi stok asal default (ONLINE) = 42.

async function bukaStok(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/stok?role=${role}`);
  await expect(page.getByRole("heading", { name: "Stok", level: 1 })).toBeVisible();
}

// Viewport desktop (project "desktop" 1280x800) -> baris tabel ber-testid.
// Helper viewport-agnostik, paritas stok.spec.ts.
function baris(page: Page, kode: string) {
  return page.locator(
    `[data-testid="baris-${kode}"]:visible, li:has(a[href="/produk/${kode}"]):visible`
  );
}

async function bukaDialogGudang(page: Page, kode = "BRG-001") {
  await baris(page, kode).getByTestId(`stok-gudang-${kode}`).click();
  const dialog = page.getByTestId("dialog-stok-gudang");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Dialog Stok per Gudang - mode Mutasi", () => {
  test("owner buka dialog dari tombol Gudang di /stok", async ({ page }) => {
    await bukaStok(page);
    const dialog = await bukaDialogGudang(page);
    await expect(dialog).toContainText("BRG-001");
    await expect(page.getByTestId("mode-stok-gudang")).toBeVisible();
  });

  test("toggle ke mode Mutasi menampilkan field asal/tujuan", async ({ page }) => {
    await bukaStok(page);
    await bukaDialogGudang(page);
    await expect(page.getByTestId("input-qty-gudang")).toBeVisible();

    await page.getByTestId("mode-mutasi").click();
    await expect(page.getByTestId("pilih-gudang-asal")).toBeVisible();
    await expect(page.getByTestId("pilih-gudang-tujuan")).toBeVisible();
    await expect(page.getByTestId("input-qty-mutasi")).toBeVisible();
    await expect(page.getByTestId("input-qty-gudang")).toHaveCount(0);
  });

  test("mode Set qty tetap tampil field set-qty (regresi)", async ({ page }) => {
    await bukaStok(page);
    await bukaDialogGudang(page);
    await page.getByTestId("mode-mutasi").click();
    await expect(page.getByTestId("pilih-gudang-asal")).toBeVisible();

    await page.getByTestId("mode-set-qty").click();
    await expect(page.getByTestId("pilih-gudang-stok")).toBeVisible();
    await expect(page.getByTestId("input-qty-gudang")).toBeVisible();
    await expect(page.getByTestId("submit-stok-gudang")).toBeVisible();
    await expect(page.getByTestId("pilih-gudang-asal")).toHaveCount(0);
  });

  test("guest tidak melihat tombol Gudang", async ({ page }) => {
    await bukaStok(page, "guest");
    await expect(baris(page, "BRG-001")).toBeVisible();
    await expect(baris(page, "BRG-001").getByText("Gudang", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("stok-gudang-BRG-001")).toHaveCount(0);
  });

  test("dialog punya pilihan gudang asal + tujuan", async ({ page }) => {
    await bukaStok(page);
    await bukaDialogGudang(page);
    await page.getByTestId("mode-mutasi").click();

    const asal = page.getByTestId("pilih-gudang-asal");
    await expect(asal).toContainText("ONLINE");

    // Tujuan default = gudang aktif pertama selain asal (D12) dan TIDAK sama dengan asal.
    const tujuan = page.getByTestId("pilih-gudang-tujuan");
    await expect(tujuan).toContainText("Gudang D12");
    await expect(tujuan).not.toContainText("ONLINE");
  });

  test("info stok asal tampil sesuai qty gudang asal", async ({ page }) => {
    await bukaStok(page);
    await bukaDialogGudang(page);
    await page.getByTestId("mode-mutasi").click();
    await expect(page.getByTestId("info-stok-asal")).toHaveText("42");
  });
});
