// e2e/order-laba.spec.ts — Halaman Order (Fase 3a, mock) + Laba Shopee standalone.
// Order fetch LANGSUNG /api/order; Laba fetch LANGSUNG /api/laba (snapshot harian).
// e2e JANGAN sentuh D1 remote — intercept dengan fixture. Pola ?role=owner ikut spec existing.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Fixture konsisten dgn hitungLaba (lib/d1/order.ts):
// omzet 200000; hpp 2×60000; biaya admin 4% = 8000; pph 5‰ = 1000;
// laba = 200000 − 120000 − 8000 − 1000 = 71000 (margin 35.5%).
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

const SNAPSHOT = {
  ok: true,
  snapshot: {
    tanggal: "2026-10-08",
    marketplace: "shopee",
    jml_order: 3,
    jml_baris: 5,
    omzet: 100000,
    hpp: 60000,
    biaya: 4000,
    laba: 36000,
    tolak: [{ no_pesanan: "SHP-X", alasan: "SKU kosong (ref + induk kosong)" }],
    file: "Order.shipping.xlsx",
    at: 1728288000,
    by: "owner",
  },
};

async function pasangRekap(page: Page) {
  await page.route("**/api/order?*rekap*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REKAP) });
  });
}

async function pasangLaba(page: Page, snapshot: unknown) {
  await page.route("**/api/laba?*muat*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, snapshot }) });
  });
  await page.route("**/api/laba?*list*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, daftar: [{ tanggal: "2026-10-08", jml_order: 3, laba: 36000 }] }),
    });
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

test("laba: snapshot + kartu agregat + tolak tampil", async ({ page }) => {
  await pasangLaba(page, SNAPSHOT.snapshot);
  await page.goto("/?role=owner");
  await page.goto("/laba?role=owner");
  await expect(page.getByTestId("hitung-laba")).toBeVisible();
  await expect(page.getByTestId("muat-ulang-laba")).toBeVisible();
  await expect(page.getByTestId("filter-tanggal-laba")).toBeVisible();
  await expect(page.getByTestId("kartu-agregat-laba")).toBeVisible();
  await expect(page.getByTestId("tolak-laba")).toBeVisible();
  await expect(page.getByTestId("daftar-tanggal-laba")).toBeVisible();
});

test("order+laba kosong: empty state tampil", async ({ page }) => {
  await page.route("**/api/order?*rekap*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, orders: [], agregat: { order: 0, omzet: 0, hpp: 0, biaya: 0, pph: 0, ppn: 0, laba: 0, margin: 0 } }),
    });
  });
  await pasangLaba(page, null);
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await expect(page.getByTestId("order-kosong")).toBeVisible();
  await page.goto("/laba?role=owner");
  await expect(page.getByTestId("laba-kosong")).toBeVisible();
});
