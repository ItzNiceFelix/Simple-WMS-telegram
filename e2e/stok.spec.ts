import { test, expect, type Page } from "@playwright/test";

// A2 — H2 Stok + H3 Detail Produk + Dialog Koreksi. Selalu mode mock (PRD I2).
// Data mock: BRG-004 = -5 (minus), BRG-003 = 3/reorder 10 (menipis), BRG-006 = 0/reorder 5 (menipis).

async function bukaStok(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/stok?role=${role}`);
  await expect(page.getByRole("heading", { name: "Stok", level: 1 })).toBeVisible();
}

// Desktop (>=768px) merender tabel; mobile merender kartu (ul md:hidden).
// Helper viewport-agnostik: pilih representasi yang VISIBLE di viewport aktif.
// - desktop: <tr data-testid="baris-KODE"> (testid per baris)
// - mobile : <li> pembungkus kartu (tanpa testid) -> dicari via tautan detail produknya
// `:visible` menyaring representasi yang disembunyikan (md:hidden / hidden md:block),
// jadi assertion teks & testid turunan (koreksi-KODE) tetap bermakna di kedua viewport.
function baris(page: Page, kode: string) {
  return page.locator(
    `[data-testid="baris-${kode}"]:visible, li:has(a[href="/produk/${kode}"]):visible`
  );
}

test.describe("H2 Stok", () => {
  test("merender baris produk dari mock", async ({ page }) => {
    await bukaStok(page);
    await expect(baris(page, "BRG-004")).toBeVisible();
    await expect(baris(page, "BRG-003")).toBeVisible();
    await expect(baris(page, "BRG-001").getByRole("link")).toContainText("Kemeja Flanel");
  });

  test("cari memfilter kode/nama (case-insensitive)", async ({ page }) => {
    await bukaStok(page);
    const cari = page.getByTestId("cari-stok");
    await cari.fill("chino");
    await expect(baris(page, "BRG-003")).toBeVisible();
    await expect(baris(page, "BRG-001")).toHaveCount(0);

    await cari.fill("brg-004");
    await expect(baris(page, "BRG-004")).toBeVisible();
    await expect(baris(page, "BRG-003")).toHaveCount(0);
  });

  test("filter Perlu Minta Gudang Cabang menampilkan produk minus + Kurang", async ({ page }) => {
    await bukaStok(page);
    await page.getByTestId("filter-minus").click();
    await expect(baris(page, "BRG-004")).toBeVisible();
    await expect(baris(page, "BRG-004")).toContainText("Kurang 5");
    await expect(baris(page, "BRG-001")).toHaveCount(0);
  });

  test("empty state khusus filter minus", async ({ page }) => {
    await bukaStok(page);
    await page.getByTestId("filter-minus").click();
    await page.getByTestId("cari-stok").fill("tidak-ada-produk-ini");
    await expect(page.getByTestId("empty-stok")).toContainText("Tidak ada produk minus.");
  });

  test("empty state filter biasa", async ({ page }) => {
    await bukaStok(page);
    await page.getByTestId("cari-stok").fill("zzz-tidak-ada");
    await expect(page.getByTestId("empty-stok")).toBeVisible();
    await expect(page.getByTestId("empty-stok")).toContainText("Tidak ada produk cocok.");
  });

  test("guest TIDAK melihat tombol Koreksi", async ({ page }) => {
    await bukaStok(page, "guest");
    await expect(baris(page, "BRG-004")).toBeVisible();
    // Representasi aktif (baris tabel / kartu) tidak memuat tombol Koreksi untuk guest.
    await expect(baris(page, "BRG-004").getByText("Koreksi")).toHaveCount(0);
  });

  test("owner melihat tombol Koreksi", async ({ page }) => {
    await bukaStok(page, "owner");
    await expect(baris(page, "BRG-004").getByTestId("koreksi-BRG-004")).toBeVisible();
  });
});

test.describe("Dialog Koreksi Stok", () => {
  async function bukaDialog(page: Page, kode = "BRG-001") {
    await baris(page, kode).getByTestId(`koreksi-${kode}`).click();
    const dialog = page.getByTestId("dialog-koreksi");
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test("validasi per mode", async ({ page }) => {
    await bukaStok(page);
    const dialog = await bukaDialog(page);
    await expect(page.getByTestId("dialog-stok-sekarang")).toHaveText("42");

    // Tambah: 0 invalid, -1 invalid (bukan bilangan non-negatif)
    await dialog.getByLabel("Jumlah").fill("0");
    await page.getByTestId("submit-koreksi").click();
    await expect(page.getByTestId("error-qty")).toHaveText("Jumlah harus bilangan bulat >= 1.");
    await dialog.getByLabel("Jumlah").fill("-1");
    await page.getByTestId("submit-koreksi").click();
    await expect(page.getByTestId("error-qty")).toHaveText("Jumlah harus bilangan bulat >= 1.");

    // Timpa: 0 valid, kosong invalid
    await page.getByTestId("mode-timpa").click();
    await dialog.getByLabel("Jumlah fisik").fill("");
    await page.getByTestId("submit-koreksi").click();
    await expect(page.getByTestId("error-qty")).toHaveText("Jumlah fisik harus bilangan bulat >= 0.");
    await dialog.getByLabel("Jumlah fisik").fill("0");
    await expect(page.getByTestId("preview-hasil")).toBeVisible();
  });

  test("submit tambah stok sukses -> toast + angka berubah", async ({ page }) => {
    await bukaStok(page);
    const dialog = await bukaDialog(page);
    await dialog.getByLabel("Jumlah").fill("5");
    await expect(page.getByTestId("preview-hasil")).toContainText("47");
    await page.getByTestId("submit-koreksi").click();

    await expect(page.getByText("Stok diperbarui")).toBeVisible();
    await expect(dialog).toBeHidden();
    // Baris BRG-001 sekarang stok 47.
    await expect(baris(page, "BRG-001")).toContainText("47");
    await expect(baris(page, "BRG-001").getByTestId("koreksi-BRG-001")).toBeVisible();
  });
});
