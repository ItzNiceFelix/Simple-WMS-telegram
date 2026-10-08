// e2e/order-laba.spec.ts — Halaman Order + Laba (Fase 3a, mock mode).
// Halaman fetch LANGSUNG /api/order (tanpa DataSource); e2e JANGAN sentuh D1
// remote — intercept /api/order dengan fixture + uji render/filter/dialog
// via data-testid Task 6. Pola buka ?role=owner ikut spec existing.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Fixture konsisten dgn hitungLaba (lib/d1/order.ts):
// omzet 200000; hpp 2×60000; biaya admin 4% = 8000; pph 5‰ = 1000;
// laba = 200000 − 120000 − 8000 − 1000 = 71000 (margin 35.5%).
// Agregat 1 order sama nilainya — sengaja identik agar selisih fixture
// per-order vs agregat tidak lagi menyesatkan.
const REKAP = {
  ok: true,
  orders: [
    {
      marketplace: "shopee",
      no_pesanan: "SHP-1",
      tanggal: 1728288000,
      buyer: "Budi",
      status_fulfill: "pending",
      pajak_pph: true,
      pajak_ppn_persen: 0,
      items: [{ sku: "BRG-001", qty: 2, harga_satuan: 100000, hpp_snapshot: 60000, subtotal: 200000 }],
      fees: [{ jenis: "admin", basis: "persen", nilai: 4, amount: 8000 }],
      omzet: 200000,
      hpp: 120000,
      biaya: 8000,
      pph: 1000,
      ppn: 0,
      laba: 71000,
      margin: 35.5,
    },
  ],
  agregat: { order: 1, omzet: 200000, hpp: 120000, biaya: 8000, pph: 1000, ppn: 0, laba: 71000, margin: 35.5 },
};

async function pasangRekap(page: Page) {
  await page.route("**/api/order?*rekap*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REKAP) });
  });
}

test("order: render + filter + dialog transisi tampil", async ({ page }) => {
  await pasangRekap(page);
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await expect(page.getByTestId("muat-ulang-order")).toBeVisible();
  await expect(page.getByTestId("filter-status-order")).toBeVisible();
  await expect(page.getByTestId("filter-mp-order")).toBeVisible();
  await expect(page.getByTestId("order-SHP-1")).toBeVisible();
  await expect(page.getByTestId("transisi-pack-SHP-1")).toBeVisible();
  await page.getByTestId("transisi-pack-SHP-1").click();
  await expect(page.getByTestId("dialog-transisi-order")).toBeVisible();
  await expect(page.getByTestId("konfirmasi-transisi-order")).toBeVisible();
  await page.getByTestId("batal-transisi-order").click();
  await page.getByTestId("filter-status-order").click();
  await page.getByRole("option", { name: "pending", exact: true }).click();
});

test("laba: render + kartu agregat + filter tampil", async ({ page }) => {
  await pasangRekap(page);
  await page.goto("/?role=owner");
  await page.goto("/laba?role=owner");
  await expect(page.getByTestId("muat-ulang-laba")).toBeVisible();
  await expect(page.getByTestId("export-laba")).toBeVisible();
  await expect(page.getByTestId("filter-dari-laba")).toBeVisible();
  await expect(page.getByTestId("filter-sampai-laba")).toBeVisible();
  await expect(page.getByTestId("filter-mp-laba")).toBeVisible();
  await expect(page.getByTestId("filter-sku-laba")).toBeVisible();
  await expect(page.getByTestId("kartu-agregat-laba")).toBeVisible();
  await page.getByTestId("filter-mp-laba").fill("shopee");
  await expect(page.getByTestId("kartu-agregat-laba")).toBeVisible();
});

test("order+laba kosong: empty state tampil", async ({ page }) => {
  await page.route("**/api/order?*rekap*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, orders: [], agregat: { order: 0, omzet: 0, hpp: 0, biaya: 0, pph: 0, ppn: 0, laba: 0, margin: 0 } }),
    });
  });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await expect(page.getByTestId("order-kosong")).toBeVisible();
  await page.goto("/laba?role=owner");
  await expect(page.getByTestId("laba-kosong")).toBeVisible();
});
