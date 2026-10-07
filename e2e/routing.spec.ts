import { test, expect } from "@playwright/test";

const HALAMAN_STAFF = [
  { href: "/", judul: "Ringkasan" },
  { href: "/stok", judul: "Stok" },
  { href: "/histori", judul: "Histori" },
  { href: "/draft", judul: "Draft Pending" },
  { href: "/permintaan", judul: "Permintaan Harian" },
  { href: "/kata-kunci", judul: "Kata Kunci" },
  { href: "/admin", judul: "Admin" },
  { href: "/pengaturan", judul: "Pengaturan" },
];

test.describe("routing H1..H9 (owner)", () => {
  for (const h of HALAMAN_STAFF) {
    test(`buka ${h.href} sebagai owner`, async ({ page }) => {
      await page.goto(`/?role=owner`);
      await page.goto(`${h.href}?role=owner`);
      await expect(page.getByRole("heading", { name: h.judul, level: 1 })).toBeVisible();
    });
  }

  test("detail produk tampil", async ({ page }) => {
    await page.goto("/produk/BRG-001?role=owner");
    await expect(page.getByRole("heading", { name: "Detail Produk", level: 1 })).toBeVisible();
    await expect(page.getByText("BRG-001").first()).toBeVisible();
  });

  test("navigasi utama berpindah halaman", async ({ page }) => {
    // Desktop: sidebar (hidden md:flex). Mobile: bottom nav.
    // Keduanya memuat tautan /stok; pilih yang terlihat pada viewport aktif.
    await page.goto("/?role=owner");
    const tautan = page.locator('a[data-nav="/stok"]:visible').first();
    await expect(tautan).toBeVisible();
    await tautan.click();
    await expect(page).toHaveURL(/\/stok/);
    await expect(page.getByRole("heading", { name: "Stok", level: 1 })).toBeVisible();
  });
});
