// e2e/advance-pilih.spec.ts — Pilih semua + kolom resi di halaman Advance (mock mode).
//
// Kenapa ini diuji: daftar advance bisa ratusan baris, dan sebelum tombol pilih-semua ada,
// satu-satunya cara memilih adalah klik per baris. Kolom resi juga diuji karena picklist
// fisik butuh resi terlihat sebelum dicetak.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const DAFTAR = {
  ok: true,
  booking: [
    {
      booking_sn: "BS-1", no_resi: "SPXID001", sku: "BRG-001", variasi: "Merah",
      nama_produk: "Produk A", opsi_kirim: "SPX", antar_ke: "Pickup",
      booking_at: "2026-10-11", batas_kirim: "2026-10-12", qty: 1, status: "menunggu",
    },
    {
      booking_sn: "BS-2", no_resi: "", sku: "BRG-002", variasi: "",
      nama_produk: "Produk B", opsi_kirim: "SPX", antar_ke: "Pickup",
      booking_at: "2026-10-11", batas_kirim: "2026-10-12", qty: 2, status: "menunggu",
    },
  ],
};

async function pasang(page: Page): Promise<void> {
  await page.route("**/api/advance?*daftar*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DAFTAR) });
  });
}

test("pilih semua dari header menandai semua booking", async ({ page }) => {
  await pasang(page);
  await page.goto("/?role=owner");
  await page.goto("/advance?role=owner");
  await expect(page.getByTestId("jumlah-dipilih-advance")).toHaveText("0 dipilih");
  await page.getByTestId("pilih-semua-advance").check();
  await expect(page.getByTestId("jumlah-dipilih-advance")).toHaveText("2 dipilih");
  await expect(page.getByTestId("pilih-advance-BS-1")).toBeChecked();
  await expect(page.getByTestId("pilih-advance-BS-2")).toBeChecked();
});

test("tombol pilih semua bisa mengosongkan kembali", async ({ page }) => {
  await pasang(page);
  await page.goto("/?role=owner");
  await page.goto("/advance?role=owner");
  await page.getByTestId("pilih-semua-tombol-advance").click();
  await expect(page.getByTestId("jumlah-dipilih-advance")).toHaveText("2 dipilih");
  await page.getByTestId("pilih-semua-tombol-advance").click();
  await expect(page.getByTestId("jumlah-dipilih-advance")).toHaveText("0 dipilih");
  await expect(page.getByTestId("kirim-advance-borongan")).toBeDisabled();
});

test("kolom resi menampilkan resi, dan tanda '-' bila belum ada", async ({ page }) => {
  await pasang(page);
  await page.goto("/?role=owner");
  await page.goto("/advance?role=owner");
  await expect(page.getByTestId("resi-advance-BS-1")).toHaveText("SPXID001");
  await expect(page.getByTestId("resi-advance-BS-2")).toHaveText("-");
});
