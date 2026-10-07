import { test, expect, type Page } from "@playwright/test";

// A4 — H1 Ringkasan. Selalu mode mock (PRD I2).
// Data mock: BRG-004 = -5 dan BRG-008 = -2 (keduanya online → minus),
// BRG-003/BRG-006 menipis. Blok minus diurut kekurangan terbesar.
// Guest: kartu draft & permintaan TIDAK dirender (PRD 15 catatan E2, FR-READ-01).

async function bukaRingkasan(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await expect(page.getByRole("heading", { name: "Ringkasan", level: 1 })).toBeVisible();
  await expect(page.getByTestId("h1-ringkasan")).toBeVisible();
}

test.describe("H1 Ringkasan", () => {
  test("owner melihat kelima kartu statistik", async ({ page }) => {
    await bukaRingkasan(page, "owner");
    await expect(page.getByTestId("kartu-total-produk")).toBeVisible();
    await expect(page.getByTestId("kartu-menipis")).toBeVisible();
    await expect(page.getByTestId("kartu-minus")).toBeVisible();
    await expect(page.getByTestId("kartu-draft")).toBeVisible();
    await expect(page.getByTestId("kartu-permintaan")).toBeVisible();
  });

  test("guest tidak melihat kartu draft & permintaan, tetap melihat Stok Minus", async ({
    page,
  }) => {
    await bukaRingkasan(page, "guest");
    await expect(page.getByTestId("kartu-minus")).toBeVisible();
    await expect(page.getByTestId("kartu-total-produk")).toBeVisible();
    await expect(page.getByTestId("kartu-menipis")).toBeVisible();
    await expect(page.getByTestId("kartu-draft")).toHaveCount(0);
    await expect(page.getByTestId("kartu-permintaan")).toHaveCount(0);
    await expect(page.getByText("Draft Pending")).toHaveCount(0);
    await expect(page.getByText("Permintaan Hari Ini")).toHaveCount(0);
  });

  test("blok Perlu Minta Gudang Cabang menampilkan kekurangan absolut", async ({ page }) => {
    await bukaRingkasan(page);
    const blok = page.getByTestId("blok-minta-gudang");
    await expect(blok.getByTestId("baris-minus-BRG-004")).toContainText("Kurang 5");
    await expect(blok.getByTestId("baris-minus-BRG-008")).toContainText("Kurang 2");
    const kode = await blok.locator('[data-testid^="baris-minus-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-testid"))
    );
    // Urut kekurangan terbesar: BRG-004 (5) sebelum BRG-008 (2).
    expect(kode).toEqual(["baris-minus-BRG-004", "baris-minus-BRG-008"]);
    // Baris menautkan ke detail produk.
    await expect(blok.getByTestId("baris-minus-BRG-004").getByRole("link")).toHaveAttribute(
      "href",
      "/produk/BRG-004"
    );
  });

  test("blok Stok Menipis menautkan ke detail produk", async ({ page }) => {
    await bukaRingkasan(page);
    const blok = page.getByTestId("blok-menipis");
    await expect(blok.getByTestId("baris-menipis-BRG-003")).toBeVisible();
    await expect(blok.getByTestId("baris-menipis-BRG-003").getByRole("link")).toHaveAttribute(
      "href",
      "/produk/BRG-003"
    );
  });

  test("Pergerakan Terakhir merender 10 baris dan delta apa adanya", async ({ page }) => {
    await bukaRingkasan(page);
    const baris = page.getByTestId("blok-pergerakan").locator('[data-testid^="baris-pergerakan-"]');
    await expect(baris).toHaveCount(10);
    // H1 memakai formatDelta(m.qty) apa adanya (sama seperti H4). Mock menyimpan
    // qty SIGNED (kurangi → negatif), jadi minus tampil minus.
    await expect(page.getByTestId("delta-mv-001")).toHaveText("-5");
    await expect(page.getByTestId("delta-mv-003")).toHaveText("+12");
    await expect(page.getByTestId("delta-mv-006")).toHaveText("-2");
    await expect(
      page.getByTestId("blok-pergerakan").getByTestId("baris-pergerakan-mv-001").getByRole("link")
    ).toHaveAttribute("href", "/produk/BRG-004");
    // Pelaku + waktu dirender.
    await expect(page.getByTestId("baris-pergerakan-mv-001")).toContainText("Siti Admin");
  });

  test("kartu Stok Minus menautkan ke /stok", async ({ page }) => {
    await bukaRingkasan(page);
    await expect(page.getByTestId("kartu-minus")).toHaveAttribute("href", "/stok");
  });

  test("kartu Stok Minus membawa nilai kekurangan", async ({ page }) => {
    await bukaRingkasan(page);
    // Mock: BRG-004 (-5) dan BRG-008 (-2) keduanya online → itemMinus = 2.
    await expect(page.getByTestId("kartu-minus")).toContainText("2");
  });
});
