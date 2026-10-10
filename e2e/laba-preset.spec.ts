// e2e/laba-preset.spec.ts — Preset toko + kartu upload per preset + stok kategori (mock).
// Pola ?role=owner ikut spec existing. JANGAN sentuh D1 remote.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const PRESETS = {
  ok: true,
  presets: [
    { id: 1, nama: "Shopee Utama", marketplace: "shopee", status_toko: "non_star", jml_aturan: 23 },
    { id: 2, nama: "Toko Kedua", marketplace: "shopee", status_toko: "star", jml_aturan: 5 },
  ],
};

const ATURAN = {
  ok: true,
  aturan: [
    {
      id: 1, jenis: "admin", kode_program: null, kategori: "T10", status_toko: null,
      ukuran: null, basis: "persen", unit: "per_baris", nilai: 10, plafon: null,
      plafon_per_qty: null, valid_from: "2026-01-01", valid_to: null, aktif: 1,
      syarat_json: null, sumber: "seed:test", verifikasi: "resmi",
    },
  ],
  program: [{ kode_program: "gratis_ongkir_xtra", nama: "Gratis Ongkir XTRA", aktif: 0, aktif_sejak: null, aktif_sampai: null }],
};

const SNAPSHOT = {
  ok: true,
  snapshot: {
    tanggal: "2026-10-09", jml_order: 2, jml_baris: 3, omzet: 150000, hpp: 90000,
    biaya: 15000, pajak: 750, laba: 44250, tolak: [],
    rincian: [{ sku: "BRG-001", nama: "Piring Kupu", unit: 3, hppSatuan: 30000, hargaJual: 50000, marginSatuan: 15000, marginPersen: 30, kontribusi: 45000 }],
    peringatan: ["tanpa kategori: X"],
    file: "Order.all.xlsx",
  },
};

const DAFTAR = { ok: true, daftar: [{ tanggal: "2026-10-09", jml_order: 2, laba: 45000 }] };

async function pasang(page: Page) {
  await page.route("**/api/preset", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRESETS) });
  });
  await page.route("**/api/preset/1/aturan", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ATURAN) });
  });
  await page.route("**/api/laba?*muat*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SNAPSHOT) });
  });
  await page.route("**/api/laba?*list*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DAFTAR) });
  });
}

test("stok: badge kategori + filter belum terpetakan", async ({ page }) => {
  await pasang(page);
  await page.goto("/?role=owner");
  await page.goto("/stok?role=owner");
  await expect(page.getByTestId("kat-kosong-BRG-001")).toBeVisible();
  await expect(page.getByTestId("kat-belum-BRG-004")).toBeVisible();
  await expect(page.getByTestId("ringkasan-kategori-stok")).toBeVisible();
  await page.getByTestId("filter-belum-petakan").click();
  await expect(page.getByTestId("baris-BRG-004")).toBeVisible();
});

test("laba: kartu PPh + nama produk + tombol export + kolom GO stok", async ({ page }) => {
  await pasang(page);
  await page.goto("/laba?role=owner");
  await page.getByTestId("tanggal-2026-10-09").click();
  await expect(page.getByTestId("kartu-agregat-laba")).toContainText("Estimasi PPh terbayarkan");
  await expect(page.getByTestId("rincian-BRG-001")).toContainText("Piring Kupu");
  await expect(page.getByTestId("export-laba-pdf")).toBeVisible();
  await expect(page.getByTestId("export-laba-jpg-ringkas")).toBeVisible();
  await expect(page.getByTestId("export-laba-jpg-lengkap")).toBeVisible();
  await page.goto("/stok?role=owner");
  await expect(page.getByTestId("go-BRG-001")).toBeVisible();
});
