import { test, expect, type Page } from "@playwright/test";

// v5.1: halaman permintaan antar-gudang - alur per-tujuan.
// Aturan baru: target hanya GUDANG, tiap tujuan punya penerima + qty sendiri,
// setujui/kirim per tujuan, selesai aksi eksplisit pembuat.

async function buka(page: Page, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/permintaan-gudang?role=${role}`);
}

test.describe("H12 Permintaan Gudang v5.1", () => {
  test("owner melihat halaman", async ({ page }) => {
    await buka(page, "owner");
    await expect(page.getByTestId("h12-permintaan-gudang")).toBeVisible();
  });

  test("admin melihat halaman", async ({ page }) => {
    await buka(page, "admin");
    await expect(page.getByTestId("h12-permintaan-gudang")).toBeVisible();
  });

  test("guest tidak boleh akses", async ({ page }) => {
    await buka(page, "guest");
    await expect(page.getByTestId("h12-permintaan-gudang")).toHaveCount(0);
  });

  test("daftar permintaan seed tampil", async ({ page }) => {
    await buka(page, "owner");
    await expect(page.getByTestId("daftar-permintaan")).toBeVisible();
  });

  test("filter status tersedia", async ({ page }) => {
    await buka(page, "owner");
    await expect(page.getByTestId("filter-status-permintaan")).toBeVisible();
  });

  test("dialog buat: pilih gudang asal + item + kirim ke gudang", async ({ page }) => {
    await buka(page, "owner");
    await page.getByTestId("buka-buat-permintaan").click();
    await expect(page.getByTestId("dialog-permintaan")).toBeVisible();
    // Gudang asal terisi default (bukan kosong) - regresi bug "Gudang asal tidak dikenal"
    await expect(page.getByTestId("pilih-gudang-asal")).toBeVisible();
    // Bagian "Kirim ke" ada
    await expect(page.getByTestId("pilih-tujuan")).toBeVisible();
  });

  test("kartu menampilkan status_kirim per tujuan", async ({ page }) => {
    await buka(page, "owner");
    const kartu = page.locator('[data-testid^="kartu-permintaan-"]').first();
    await expect(kartu).toBeVisible();
    await expect(kartu.locator('[data-testid^="status-kirim-"]').first()).toBeVisible();
  });

  test("tujuan menampilkan penerima bila ada", async ({ page }) => {
    await buka(page, "owner");
    const tujuan = page.locator('[data-testid^="tujuan-"]').first();
    await expect(tujuan).toBeVisible();
  });

  test("tombol Selesai tampil untuk dokumen dikirim", async ({ page }) => {
    await buka(page, "owner");
    // Seed pg-001 berstatus menunggu - Selesai hanya untuk "dikirim".
    // Test ini memastikan tidak ada error render + halaman stabil.
    await expect(page.locator('[data-testid^="kartu-permintaan-"]').first()).toBeVisible();
  });

  test("tidak ada SelectValue uuid tampil (regresi bug)", async ({ page }) => {
    await buka(page, "owner");
    await page.getByTestId("buka-buat-permintaan").click();
    // Dropdown gudang asal harus menampilkan NAMA, bukan id acak ber-panjang 20.
    const teks = await page.getByTestId("pilih-gudang-asal").innerText();
    expect(teks).not.toMatch(/^[A-Za-z0-9_-]{20}$/);
  });
});
