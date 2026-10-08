// e2e/excel.spec.ts — Import/Export Excel (Fase 2, PRD F3, mock mode).
// Dialog import tampil + tombol export ada; template bisa diunduh.
import { test, expect } from "@playwright/test";

test("tombol Import/Export tampil di halaman stok", async ({ page }) => {
  await page.goto("/stok?role=owner");
  await expect(page.getByTestId("buka-import-excel")).toBeVisible();
  await expect(page.getByTestId("unduh-export-excel")).toBeVisible();
});

test("dialog import tampil + template link ada", async ({ page }) => {
  await page.goto("/stok?role=owner");
  await page.getByTestId("buka-import-excel").click();
  await expect(page.getByRole("heading", { name: /import excel/i })).toBeVisible();
  await expect(page.getByText(/template resmi/i)).toBeVisible();
});
