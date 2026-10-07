import { test, expect, type Page } from "@playwright/test";

// Verifikasi independen fitur "UI pilih provider AI multi-provider" (mock mode, PRD I2).
// HANYA file baru; tidak mengubah spec existing.
// Membuktikan: dropdown 5 opsi, owner dapat memilih KENARI dan tersimpan, admin disabled.
//
// CATATAN PERSISTENSI: mock store bersifat in-memory (lib/dashboard/data/mock.ts:117).
// Muat ulang dokumen (page.goto/reload) mem-bootstrap ulang store dan mengembalikan seed
// "groq" — perilaku ini SAMA untuk SEMUA tulis mock, bukan kekhususan provider. Bukti
// "tersimpan" = tulis masuk store + refetch `getAiSettings()` melihat nilai baru TANPA
// pemuatan dokumen ulang (navigasi klien SPA saja).

async function buka(page: Page, role: "owner" | "admin" | "guest") {
  await page.goto(`/?role=${role}`);
  await page.getByRole("link", { name: "Pengaturan" }).click();
}

const OPSI = ["Gemini", "Groq", "Kenari", "OpenAI", "OpenRouter"];

test.describe("provider UI multi-provider (verifikasi)", () => {
  test("dropdown menampilkan tepat 5 opsi provider", async ({ page }) => {
    await buka(page, "owner");
    await page.getByTestId("h8-pengaturan").waitFor();
    await page.getByTestId("pilih-provider").click();
    for (const label of OPSI) {
      await expect(page.getByRole("option", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("option")).toHaveCount(5);
  });

  test("owner memilih Kenari -> tersimpan & provider aktif jadi Kenari", async ({ page }) => {
    await buka(page, "owner");
    await expect(page.getByTestId("provider-aktif")).toHaveText("Groq");

    await page.getByTestId("pilih-provider").click();
    await page.getByRole("option", { name: "Kenari" }).click();
    await page.getByTestId("simpan-provider").click();

    await expect(page.getByText("Pengaturan disimpan")).toBeVisible();
    await expect(page.getByTestId("provider-aktif")).toHaveText("Kenari");

    // Tetap Kenari saat kembali ke halaman lewat navigasi klien (SPA): refetch dari store.
    await page.getByRole("link", { name: "Ringkasan" }).click();
    await page.getByRole("link", { name: "Pengaturan" }).click();
    await expect(page.getByTestId("provider-aktif")).toHaveText("Kenari");
  });

  test("admin: kontrol provider disabled & tidak bisa menyimpan", async ({ page }) => {
    await buka(page, "admin");
    await expect(page.getByTestId("kartu-provider")).toBeVisible();
    await expect(page.getByTestId("pilih-provider")).toBeDisabled();
    await expect(page.getByTestId("simpan-provider")).toBeDisabled();
    await expect(page.getByTestId("catatan-owner")).toBeVisible();
    await expect(page.getByTestId("provider-aktif")).toHaveText("Groq");
  });
});
