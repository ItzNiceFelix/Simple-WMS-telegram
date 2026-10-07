import { test, expect, type Page } from "@playwright/test";

// Wave 3e — F2 Kata Kunci (PRD v3a 6.2/6.3, 7.1, 14).
// Mock: 4 note — kw-001 guessed (MINTA_SISA), kw-002 confirmed (MINTA),
// kw-003 confirmed (STOK), kw-004 guessed (interpreted_as null).

type Role = "owner" | "admin" | "guest";

async function buka(page: Page, role: Role = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/kata-kunci?role=${role}`);
  await expect(page.getByRole("heading", { name: "Kata Kunci", level: 1 })).toBeVisible();
  await expect(page.getByTestId("tabel-kata-kunci")).toBeVisible();
}

test.describe("H9 Kata Kunci — owner", () => {
  test("tabel + badge confidence", async ({ page }) => {
    await buka(page);
    await expect(page.getByTestId("badge-confidence-kw-001")).toHaveText("Belum dikonfirmasi");
    await expect(page.getByTestId("badge-confidence-kw-002")).toHaveText("Terkonfirmasi");
    await expect(page.getByTestId("baris-kata-kunci-kw-001")).toContainText("sisa gdg");
    await expect(page.getByTestId("baris-kata-kunci-kw-001")).toContainText("Permintaan Sisa (Buffer)");
  });

  test("filter Belum Dikonfirmasi menyisakan note guessed", async ({ page }) => {
    await buka(page);
    await page.getByTestId("filter-kata-kunci").getByText("Belum Dikonfirmasi").click();
    await expect(page.getByTestId("baris-kata-kunci-kw-001")).toBeVisible();
    await expect(page.getByTestId("baris-kata-kunci-kw-004")).toBeVisible();
    await expect(page.getByTestId("baris-kata-kunci-kw-002")).toHaveCount(0);
    await expect(page.getByTestId("baris-kata-kunci-kw-003")).toHaveCount(0);
  });

  test("owner melihat Select + tombol Konfirmasi", async ({ page }) => {
    await buka(page);
    await expect(page.getByTestId("pilih-interpretasi-kw-001")).toBeVisible();
    await expect(page.getByTestId("konfirmasi-kw-001")).toBeVisible();
  });

  test("konfirmasi sukses -> toast + confidence jadi Terkonfirmasi", async ({ page }) => {
    await buka(page);
    await page.getByTestId("pilih-interpretasi-kw-004").click();
    await page.getByRole("option", { name: "Potong Stok Gudang Online" }).click();
    await page.getByTestId("konfirmasi-kw-004").click();

    await expect(page.getByText("Interpretasi penanda diperbarui")).toBeVisible();
    await expect(page.getByTestId("badge-confidence-kw-004")).toHaveText("Terkonfirmasi");
  });

  test("konfirmasi tanpa memilih interpretasi -> tombol disabled", async ({ page }) => {
    await buka(page);
    // kw-004 belum punya interpretasi -> tombol Konfirmasi disabled sampai dipilih.
    await expect(page.getByTestId("konfirmasi-kw-004")).toBeDisabled();
    await page.getByTestId("pilih-interpretasi-kw-004").click();
    await page.getByRole("option", { name: "Masukkan ke Permintaan Gudang Cabang" }).click();
    await expect(page.getByTestId("konfirmasi-kw-004")).toBeEnabled();
  });

  test("401 mid-write: toast sesi kedaluwarsa, pilihan DIPERTAHANKAN", async ({ page }) => {
    await page.goto("/?role=owner");
    await page.goto("/kata-kunci?role=owner&mock-401=1");
    await expect(page.getByTestId("tabel-kata-kunci")).toBeVisible();

    await page.getByTestId("pilih-interpretasi-kw-004").click();
    await page.getByRole("option", { name: "Potong Stok Gudang Online" }).click();
    await page.getByTestId("konfirmasi-kw-004").click();

    await expect(page.getByText("Sesi kedaluwarsa. Buka ulang dari Telegram.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buka ulang" })).toBeVisible();
    // Pilihan tidak dikembalikan ke nilai lama (form DIPERTAHANKAN).
    await expect(page.getByTestId("pilih-interpretasi-kw-004")).toContainText(
      "Potong Stok Gudang Online"
    );
    // Nilai tersimpan di state Select (bukan direset).
    await expect(page.getByTestId("pilih-interpretasi-kw-004")).not.toContainText(
      "Pilih interpretasi"
    );
  });
});

test.describe("H9 Kata Kunci — admin read-only", () => {
  test("admin melihat tabel + filter TANPA Select/tombol ubah", async ({ page }) => {
    await buka(page, "admin");
    await expect(page.getByTestId("badge-confidence-kw-001")).toBeVisible();
    for (const id of ["kw-001", "kw-002", "kw-003", "kw-004"]) {
      await expect(page.getByTestId(`pilih-interpretasi-${id}`)).toHaveCount(0);
      await expect(page.getByTestId(`konfirmasi-${id}`)).toHaveCount(0);
    }
  });

  test("label interpretasi dirender sebagai teks (bukan Select)", async ({ page }) => {
    await buka(page, "admin");
    await expect(page.getByTestId("baris-kata-kunci-kw-002")).toContainText(
      "Masukkan ke Permintaan Gudang Cabang"
    );
  });

  test("guest ditolak", async ({ page }) => {
    await page.goto("/?role=guest");
    await page.goto("/kata-kunci?role=guest");
    await expect(page.getByTestId("akses-ditolak")).toBeVisible();
  });
});

test.describe("H9 Kata Kunci — nav", () => {
  test("nav memuat Kata Kunci untuk owner & admin, tidak untuk guest", async ({ page }) => {
    const { width } = page.viewportSize() ?? { width: 1280 };
    // Mobile: tujuan non-utama hanya dirender setelah Sheet "Lainnya" dibuka.
    const bukaBilaMobile = async () => {
      if (width >= 768) return;
      await page.getByRole("button", { name: "Menu lainnya" }).click();
    };

    for (const role of ["owner", "admin"] as const) {
      await page.goto(`/?role=${role}`);
      await bukaBilaMobile();
      await expect(page.locator('a[data-nav="/kata-kunci"]:visible').first()).toBeVisible();
    }

    await page.goto("/?role=guest");
    await expect(page.locator('a[data-nav="/kata-kunci"]')).toHaveCount(0);
  });
});
