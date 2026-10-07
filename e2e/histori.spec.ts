import { test, expect, type Page } from "@playwright/test";

// A3 — H4 Histori. Selalu mode mock (PRD I2).
// Mock T0 = 2026-09-15T08:00:00.000Z, movement terbaru 8 menit sebelum T0,
// terlama 2600 menit (> 24 jam) sebelum T0.

const T0 = new Date("2026-09-15T08:00:00.000Z");

function tanggalLokal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function bukaHistori(page: Page, query = "") {
  await page.goto("/?role=owner");
  await page.goto(`/histori?role=owner${query}`);
  await expect(page.getByRole("heading", { name: "Histori", level: 1 })).toBeVisible();
  await expect(page.getByTestId("timeline-histori")).toBeVisible();
  await bukaFilterIfMobile(page);
}

// Panel filter tertutup default di mobile (ui-spec 3.H4). Buka dulu bila trigger terlihat.
async function bukaFilterIfMobile(page: Page) {
  const trigger = page.getByTestId("toggle-filter-histori");
  if (await trigger.isVisible()) {
    await trigger.click();
    await expect(page.getByTestId("panel-filter-histori")).toBeVisible();
  }
}

async function pilihOpsi(page: Page, triggerTestId: string, label: string) {
  await page.getByTestId(triggerTestId).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

// H2 Stok punya dua representasi: baris tabel (desktop) dan kartu (mobile).
// Helper viewport-agnostik memilih yang VISIBLE lewat selektor `:visible`.
function barisStok(page: Page, kode: string) {
  return page.locator(
    `[data-testid="baris-${kode}"]:visible, li:has(a[href="/produk/${kode}"]):visible`
  );
}

test.describe("H4 Histori", () => {
  test("timeline merender entri kronologis terbaru dulu", async ({ page }) => {
    await bukaHistori(page);
    const baris = page.getByTestId("timeline-histori").getByRole("listitem");
    await expect(baris).toHaveCount(12);

    // Terbaru (mv-001, 8 menit lalu) mendahului terlama (mv-012, 2600 menit lalu).
    const teks = await baris.allInnerTexts();
    expect(teks[0]).toContain("Jaket Bomber Hitam");
    expect(teks[teks.length - 1]).toContain("Kaos Polos");

    // Label ramah Bahasa Indonesia + tautan ke detail produk.
    await expect(page.getByTestId("movement-mv-003")).toContainText("Stok masuk");
    await expect(page.getByTestId("movement-mv-003")).toContainText("Diproses");
    await expect(
      page.getByTestId("movement-mv-003").getByRole("link", { name: /Kemeja Flanel/ })
    ).toHaveAttribute("href", "/produk/BRG-001");

    // Pelaku pakai nama, bukan id.
    await expect(page.getByTestId("movement-mv-001")).toContainText("oleh Siti Admin");
  });

  test("opname menampilkan sistem -> fisik dan selisih negatif", async ({ page }) => {
    await bukaHistori(page);
    const opname = page.getByTestId("opname-mv-006");
    await expect(opname).toBeVisible();
    await expect(opname).toContainText("2");
    await expect(opname).toContainText("0");
    // Selisih -2 tampil apa adanya dengan tanda minus.
    await expect(page.getByTestId("selisih-mv-006")).toHaveText("-2");
  });

  test("filter type memfilter (bounded: hanya type dikirim)", async ({ page }) => {
    await bukaHistori(page);
    await page.getByTestId("mode-jenis").click();
    await pilihOpsi(page, "filter-jenis", "Opname");

    await expect(page.getByTestId("timeline-histori").getByRole("listitem")).toHaveCount(1);
    await expect(page.getByTestId("movement-mv-006")).toBeVisible();
    await expect(page.getByTestId("movement-mv-001")).toHaveCount(0);
    await expect(page.getByTestId("info-halaman")).toContainText("dari 1");
  });

  test("filter status memfilter", async ({ page }) => {
    await bukaHistori(page);
    await page.getByTestId("mode-status").click();
    await pilihOpsi(page, "filter-status", "Menunggu konfirmasi");

    await expect(page.getByTestId("timeline-histori").getByRole("listitem")).toHaveCount(1);
    await expect(page.getByTestId("movement-mv-008")).toBeVisible();
    await expect(page.getByTestId("movement-mv-001")).toHaveCount(0);
  });

  test("filter kode barang (juga via query param)", async ({ page }) => {
    await bukaHistori(page, "&kode=BRG-004");
    const baris = page.getByTestId("timeline-histori").getByRole("listitem");
    await expect(baris).toHaveCount(2); // mv-001 + mv-008
    await expect(page.getByTestId("movement-mv-008")).toBeVisible();
    await expect(page.getByTestId("movement-mv-003")).toHaveCount(0);
  });

  test("rentang tanggal memfilter", async ({ page }) => {
    await bukaHistori(page);
    const hariTerbaru = tanggalLokal(T0);
    await page.getByTestId("filter-dari").fill(hariTerbaru);

    // mv-012 (2600 menit / > 1 hari lebih tua) keluar; mv-001 tetap.
    await expect(page.getByTestId("movement-mv-001")).toBeVisible();
    await expect(page.getByTestId("movement-mv-012")).toHaveCount(0);

    const total = await page
      .getByTestId("timeline-histori")
      .getByRole("listitem")
      .count();
    expect(total).toBeLessThan(12);
    expect(total).toBeGreaterThan(0);
  });

  test("kombinasi rentang + satu equality tetap boleh", async ({ page }) => {
    await bukaHistori(page);
    await page.getByTestId("mode-kode").click();
    await page.getByTestId("filter-kode").fill("BRG-004");
    await expect(page.getByTestId("timeline-histori").getByRole("listitem")).toHaveCount(2);

    await page.getByTestId("filter-dari").fill(tanggalLokal(T0));
    await expect(page.getByTestId("movement-mv-001")).toBeVisible();
    await expect(page.getByTestId("movement-mv-008")).toBeVisible();

    await page.getByTestId("hapus-filter").click();
    await expect(page.getByTestId("timeline-histori").getByRole("listitem")).toHaveCount(12);
  });

  test("empty state saat filter tak menghasilkan apa pun", async ({ page }) => {
    await bukaHistori(page);
    await page.getByTestId("filter-dari").fill("2030-01-01");
    await expect(page.getByTestId("empty-histori")).toBeVisible();
    await expect(page.getByTestId("empty-histori")).toContainText(
      "Belum ada pergerakan pada filter ini."
    );
    await expect(page.getByTestId("timeline-histori")).toHaveCount(0);
  });

  test("pagination: info rentang + tombol nonaktif saat satu halaman", async ({ page }) => {
    await bukaHistori(page);
    // Mock hanya 12 baris (< 20) → satu halaman.
    await expect(page.getByTestId("info-halaman")).toHaveText("Menampilkan 1–12 dari 12");
    await expect(page.getByTestId("halaman-sebelumnya")).toBeDisabled();
    await expect(page.getByTestId("halaman-berikutnya")).toBeDisabled();
  });

  test("pagination bekerja saat data > 20", async ({ page }) => {
    // Tambah 9 koreksi (12 + 9 = 21 > 20) lewat dialog di H2.
    await page.goto("/?role=owner");
    await page.goto("/stok?role=owner");
    for (let i = 0; i < 9; i++) {
      await barisStok(page, "BRG-001").getByTestId("koreksi-BRG-001").click();
      const dialog = page.getByTestId("dialog-koreksi");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Jumlah").fill("1");
      await page.getByTestId("submit-koreksi").click();
      await expect(dialog).toBeHidden();
    }

    // Navigasi klien (bukan reload) supaya store mock in-memory tetap hidup.
    await page.getByRole("link", { name: "Histori" }).click();
    await expect(page.getByRole("heading", { name: "Histori", level: 1 })).toBeVisible();
    await expect(page.getByTestId("timeline-histori")).toBeVisible();
    await expect(page.getByTestId("info-halaman")).toHaveText("Menampilkan 1–20 dari 21");
    await expect(page.getByTestId("halaman-sebelumnya")).toBeDisabled();

    await page.getByTestId("halaman-berikutnya").click();
    await expect(page.getByTestId("info-halaman")).toHaveText("Menampilkan 21–21 dari 21");
    await expect(page.getByTestId("timeline-histori").getByRole("listitem")).toHaveCount(1);
    await expect(page.getByTestId("halaman-berikutnya")).toBeDisabled();

    await page.getByTestId("halaman-sebelumnya").click();
    await expect(page.getByTestId("info-halaman")).toHaveText("Menampilkan 1–20 dari 21");
  });

  test("guest hanya melihat (tanpa kontrol tulis)", async ({ page }) => {
    await page.goto("/?role=guest");
    await page.goto("/histori?role=guest");
    await expect(page.getByRole("heading", { name: "Histori", level: 1 })).toBeVisible();
    await expect(page.getByTestId("timeline-histori")).toBeVisible();
    await expect(page.getByRole("button", { name: /Koreksi/ })).toHaveCount(0);
  });
});
