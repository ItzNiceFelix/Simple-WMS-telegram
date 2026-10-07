import { test, expect } from "@playwright/test";

// Regresi boot (mode mock): DataSource mode mock siap sinkron, jadi konten harus langsung
// render tanpa splash dan tanpa error palsu "Gagal memuat".
// Bug produksi sebelumnya: halaman menembak data source sebelum siap -> flash "Gagal memuat
// ringkasan" lalu reload sendiri. Diverifikasi di mode REAL oleh scripts/cek-splash-real.mjs.
test.describe("boot mode mock", () => {
  test("konten langsung tampil tanpa splash", async ({ page }) => {
    await page.goto("/?role=owner");
    await expect(page.getByRole("heading", { name: "Ringkasan", level: 1 })).toBeVisible();
    await expect(page.getByTestId("splash-awal")).toHaveCount(0);
  });

  test("tidak ada flash 'Gagal memuat' saat pembukaan pertama", async ({ page }) => {
    const muncul: string[] = [];
    page.on("console", (m) => {
      if (/Gagal memuat/.test(m.text())) muncul.push(m.text());
    });
    await page.goto("/?role=owner");
    // Sampel beberapa saat pertama.
    await page.waitForTimeout(1200);
    await expect(page.getByText("Gagal memuat ringkasan")).toHaveCount(0);
    expect(muncul).toEqual([]);
  });

  test("semua halaman boot tanpa splash", async ({ page }) => {
    for (const href of ["/stok", "/histori", "/draft", "/permintaan", "/admin", "/pengaturan"]) {
      await page.goto(`${href}?role=owner`);
      await expect(page.getByTestId("splash-awal")).toHaveCount(0);
      await expect(page.locator("h1")).toBeVisible();
    }
  });
});
