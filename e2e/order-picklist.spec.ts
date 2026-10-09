// e2e/order-picklist.spec.ts — Seleksi order + bulk transition + picklist (mock mode).
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

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
      fees: [],
      omzet: 200000,
      hpp: 120000,
      biaya: 0,
      pph: 0,
      ppn: 0,
      laba: 80000,
      margin: 40,
    },
    {
      marketplace: "shopee",
      no_pesanan: "SHP-2",
      tanggal: 1728288000,
      buyer: "Sari",
      status_fulfill: "pending",
      pajak_pph: true,
      pajak_ppn_persen: 0,
      items: [{ sku: "BRG-001", qty: 1, harga_satuan: 100000, hpp_snapshot: 60000, subtotal: 100000 }],
      fees: [],
      omzet: 100000,
      hpp: 60000,
      biaya: 0,
      pph: 0,
      ppn: 0,
      laba: 40000,
      margin: 40,
    },
  ],
  agregat: { order: 2, omzet: 300000, hpp: 180000, biaya: 0, pph: 0, ppn: 0, laba: 120000, margin: 40 },
};

async function pasang(page: Page, batch: { ok: boolean; count?: number; error?: string } = { ok: true, count: 2 }) {
  await page.route("**/api/order?*rekap*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REKAP) });
  });
  await page.route("**/api/order", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(batch) });
  });
}

test("pilih semua menandai order dan menampilkan jumlah", async ({ page }) => {
  await pasang(page);
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await expect(page.getByTestId("toolbar-bulk-order")).toBeVisible();
  await expect(page.getByTestId("jumlah-terpilih-order")).toHaveText("0 dipilih");
  await page.getByTestId("pilih-semua-order").click();
  await expect(page.getByTestId("jumlah-terpilih-order")).toHaveText("2 dipilih");
  await expect(page.getByTestId("pilih-SHP-1")).toBeChecked();
});

test("bulk pack mengirim satu request batch", async ({ page }) => {
  await pasang(page);
  const dikirim: unknown[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/order")) dikirim.push(r.postDataJSON());
  });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await page.getByTestId("pilih-semua-order").click();
  await page.getByTestId("bulk-pack-order").click();
  await expect.poll(() => dikirim.length).toBeGreaterThan(0);
  const body = dikirim[0] as { aksi: string; targets: unknown[] };
  expect(body.aksi).toBe("transisi-batch");
  expect(body.targets).toHaveLength(2);
});

test("picklist membuka endpoint PDF dengan target terpilih", async ({ page }) => {
  await pasang(page);
  let url = "";
  page.on("popup", (p) => {
    url = p.url();
  });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await page.getByTestId("pilih-SHP-2").check();
  await page.getByTestId("download-picklist-order").click();
  await expect.poll(() => url).toContain("aksi=picklist-pdf");
  expect(url).toContain("SHP-2");
});

test("bulk gagal menampilkan pesan server", async ({ page }) => {
  await pasang(page, { ok: false, error: "Stok BRG-001 tidak cukup untuk pilihan ini (1 < 3)." });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await page.getByTestId("pilih-semua-order").click();
  await page.getByTestId("bulk-pack-order").click();
  await expect(page.getByText(/tidak cukup/)).toBeVisible();
});
