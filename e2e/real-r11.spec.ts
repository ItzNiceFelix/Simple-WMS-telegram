import { test, expect } from "@playwright/test";

// R11 (PRD 32): di mode REAL, query param role WAJIB diabaikan dan tanpa initData Telegram
// pengguna melihat layar "Buka dari Telegram", bukan data.
//
// Test ini TIDAK ikut suite mock (webServer memakai build mock). Verifikasinya:
//   node scripts/e2e-build-real.mjs
//   npx next start -p 3105      # job terpisah
//   node scripts/cek-real.mjs   # exit 0 = lulus
//
// Di suite utama test ini di-skip agar tidak salah menguji build mock.
test.describe("mode real — bypass mock ditolak (R11)", () => {
  test.skip(
    process.env.NEXT_PUBLIC_DASHBOARD_DATA !== "real",
    "Butuh build mode real + server 3105; jalankan scripts/cek-real.mjs"
  );

  test("query ?role=owner diabaikan; tidak ada data tanpa initData", async ({ page }) => {
    await page.goto("/?role=owner");
    await expect(page.getByTestId("buka-dari-telegram")).toBeVisible();
    await expect(page.getByText("Total Produk Online")).toHaveCount(0);
  });
});
