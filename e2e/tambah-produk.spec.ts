import { test, expect, type Page } from "@playwright/test";

// Fase A / A5 — Tambah Produk (owner + admin). PRD v3b §10.2/§10.4 (B6). Mode mock.
// Mock produk: BRG-001..BRG-008. Kode duplikat -> 409 dengan pesan pol a `kode "X" sudah dipakai produk lain`.

type Role = "owner" | "admin" | "guest";

async function bukaStok(page: Page, role: Role = "owner", extra = "") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/stok?role=${role}${extra}`);
  await expect(page.getByRole("heading", { name: "Stok", level: 1 })).toBeVisible();
}

function baris(page: Page, kode: string) {
  return page.locator(
    `[data-testid="baris-${kode}"]:visible, li:has(a[href="/produk/${kode}"]):visible`
  );
}

test.describe("A5 Tambah Produk — buka dialog", () => {
  for (const role of ["owner", "admin"] as Role[]) {
    test(`${role} melihat tombol Tambah Produk + membuka dialog`, async ({ page }) => {
      await bukaStok(page, role);
      await page.getByTestId("buka-tambah-produk").click();
      await expect(page.getByTestId("dialog-tambah-produk")).toBeVisible();
      await expect(page.getByTestId("simpan-produk")).toBeDisabled();
    });
  }

  test("guest tidak melihat tombol Tambah Produk", async ({ page }) => {
    await bukaStok(page, "guest");
    await expect(page.getByTestId("buka-tambah-produk")).toHaveCount(0);
  });
});

test.describe("A5 Tambah Produk — validasi klien", () => {
  test("simpan disabled sampai kode + nama terisi", async ({ page }) => {
    await bukaStok(page);
    await page.getByTestId("buka-tambah-produk").click();
    await expect(page.getByTestId("simpan-produk")).toBeDisabled();

    await page.getByTestId("input-kode-produk").fill("BRG-999");
    await expect(page.getByTestId("simpan-produk")).toBeDisabled();
    await page.getByTestId("input-nama-produk").fill("Produk Uji");
    await expect(page.getByTestId("simpan-produk")).toBeEnabled();
  });

  test("hpp non-integer -> error inline, dialog tetap terbuka", async ({ page }) => {
    await bukaStok(page);
    await page.getByTestId("buka-tambah-produk").click();
    await page.getByTestId("input-kode-produk").fill("BRG-999");
    await page.getByTestId("input-nama-produk").fill("Produk Uji");
    await page.getByTestId("input-hpp-produk").fill("abc");
    await page.getByTestId("simpan-produk").click();

    await expect(page.getByTestId("error-tambah-produk")).toContainText(
      "HPP harus bilangan bulat >= 0."
    );
    await expect(page.getByTestId("dialog-tambah-produk")).toBeVisible();
    await expect(page.getByTestId("input-hpp-produk")).toHaveValue("abc");
  });

  test("stok awal non-integer -> error inline", async ({ page }) => {
    await bukaStok(page);
    await page.getByTestId("buka-tambah-produk").click();
    await page.getByTestId("input-kode-produk").fill("BRG-999");
    await page.getByTestId("input-nama-produk").fill("Produk Uji");
    await page.getByTestId("input-stok-awal-produk").fill("1.5");
    await page.getByTestId("simpan-produk").click();

    await expect(page.getByTestId("error-tambah-produk")).toContainText(
      "Stok awal harus bilangan bulat >= 0."
    );
    await expect(page.getByTestId("dialog-tambah-produk")).toBeVisible();
  });
});

test.describe("A5 Tambah Produk — simpan", () => {
  test("submit sukses -> toast + produk muncul di daftar", async ({ page }) => {
    await bukaStok(page);
    await page.getByTestId("buka-tambah-produk").click();
    await page.getByTestId("input-kode-produk").fill("BRG-999");
    await page.getByTestId("input-nama-produk").fill("Produk Uji Baru");
    await page.getByTestId("input-hpp-produk").fill("50000");
    await page.getByTestId("input-stok-awal-produk").fill("7");
    await page.getByTestId("simpan-produk").click();

    await expect(page.getByText(/Produk BRG-999 ditambahkan/)).toBeVisible();
    await expect(page.getByTestId("dialog-tambah-produk")).toBeHidden();
    await expect(baris(page, "BRG-999")).toBeVisible();
    await expect(baris(page, "BRG-999")).toContainText("Produk Uji Baru");
  });

  test("409 kode duplikat -> pesan di field kode (bukan toast generik)", async ({ page }) => {
    await bukaStok(page);
    await page.getByTestId("buka-tambah-produk").click();
    await page.getByTestId("input-kode-produk").fill("BRG-001");
    await page.getByTestId("input-nama-produk").fill("Duplikat Uji");
    await page.getByTestId("simpan-produk").click();

    await expect(page.getByTestId("error-kode-produk")).toContainText(
      'kode "BRG-001" sudah dipakai produk lain'
    );
    // Dialog tetap terbuka, isian lain dipertahankan.
    await expect(page.getByTestId("dialog-tambah-produk")).toBeVisible();
    await expect(page.getByTestId("input-nama-produk")).toHaveValue("Duplikat Uji");
  });

  test("B6 — 401 mid-write: dialog TETAP terbuka + isian TIDAK reset", async ({ page }) => {
    await bukaStok(page, "owner", "&mock-401=tambah-produk");
    await page.getByTestId("buka-tambah-produk").click();
    await page.getByTestId("input-kode-produk").fill("BRG-998");
    await page.getByTestId("input-nama-produk").fill("Produk 401");
    await page.getByTestId("input-hpp-produk").fill("12345");
    await page.getByTestId("input-stok-awal-produk").fill("3");
    await page.getByTestId("simpan-produk").click();

    await expect(page.getByText("Sesi kedaluwarsa. Buka ulang dari Telegram.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buka ulang" })).toBeVisible();
    await expect(page.getByTestId("dialog-tambah-produk")).toBeVisible();
    // Isian TIDAK reset.
    await expect(page.getByTestId("input-kode-produk")).toHaveValue("BRG-998");
    await expect(page.getByTestId("input-nama-produk")).toHaveValue("Produk 401");
    await expect(page.getByTestId("input-hpp-produk")).toHaveValue("12345");
    await expect(page.getByTestId("input-stok-awal-produk")).toHaveValue("3");
  });
});
