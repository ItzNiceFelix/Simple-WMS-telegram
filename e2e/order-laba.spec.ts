// e2e/order-laba.spec.ts — Halaman Order (daftar stok, mock) + Laba per preset (mock).
// Order fetch LANGSUNG /api/order?aksi=daftar; Laba fetch LANGSUNG /api/laba (presetId wajib).
// e2e JANGAN sentuh D1 remote — intercept dengan fixture. Pola ?role=owner ikut spec existing.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Fixture daftar order (tanpa laba — laba pindah ke /laba per preset).
const DAFTAR = {
  ok: true,
  orders: [
    {
      marketplace: "shopee",
      no_pesanan: "SHP-1",
      tanggal: 1728288000,
      buyer: "Budi",
      status_fulfill: "pending",
      items: [{ sku: "BRG-001", qty: 2, harga_satuan: 100000, hpp_snapshot: 60000, subtotal: 200000 }],
      fees: [],
    },
  ],
};

const SNAPSHOT = {
  ok: true,
  snapshot: {
    tanggal: "2026-10-08",
    jml_order: 3,
    jml_baris: 5,
    omzet: 100000,
    hpp: 60000,
    biaya: 4000,
    laba: 36000,
    tolak: [{ no_pesanan: "SHP-X", alasan: "SKU kosong (ref + induk kosong)" }],
    rincian: [
      { sku: "BRG-001", unit: 3, hppSatuan: 15000, hargaJual: 30000, marginSatuan: 12000, marginPersen: 40, kontribusi: 36000 },
    ],
    peringatan: [],
    file: "Order.all.20261008_20261008.xlsx",
  },
};

async function pasangDaftar(page: Page) {
  await page.route("**/api/order?*daftar*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DAFTAR) });
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
  await pasangDaftar(page);
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
  await page.route("**/api/preset", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, presets: [{ id: 1, nama: "Shopee Utama", status_toko: "non_star", jml_aturan: 1 }] }),
    });
  });
  await page.goto("/?role=owner");
  await page.goto("/laba?role=owner");
  await expect(page.getByTestId("kartu-preset-1")).toBeVisible();
  await expect(page.getByTestId("muat-ulang-laba")).toBeVisible();
  await expect(page.getByTestId("filter-tanggal-laba")).toBeVisible();
  await expect(page.getByTestId("kartu-agregat-laba")).toBeVisible();
  await expect(page.getByTestId("tolak-laba")).toBeVisible();
  await expect(page.getByTestId("daftar-tanggal-laba")).toBeVisible();
  await expect(page.getByTestId("rincian-sku-laba")).toBeVisible();
  await expect(page.getByTestId("rincian-BRG-001")).toBeVisible();
});

test("order+laba kosong: empty state tampil", async ({ page }) => {
  await page.route("**/api/order?*daftar*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, orders: [] }),
    });
  });
  await pasangLaba(page, null);
  await page.route("**/api/preset", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, presets: [{ id: 1, nama: "Shopee Utama", status_toko: "non_star", jml_aturan: 1 }] }),
    });
  });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await expect(page.getByTestId("order-kosong")).toBeVisible();
  await page.goto("/laba?role=owner");
  await expect(page.getByTestId("laba-kosong")).toBeVisible();
});
