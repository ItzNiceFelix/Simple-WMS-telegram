import { test, expect, type Page } from "@playwright/test";

// A5 — Matriks izin per role (PRD 8.1, v3a 7; 20). Selalu mode mock (PRD I2).
// Role disuntik lewat ?role= HANYA di mode mock (R11).
// Halaman staff: /draft, /permintaan, /kata-kunci, /admin, /pengaturan → guest ditolak.

const HALAMAN_STAFF = ["/draft", "/permintaan", "/kata-kunci", "/admin", "/pengaturan"];
const HALAMAN_SEMUA = ["/", "/stok", "/histori"];

type Role = "owner" | "admin" | "guest";

/** Masuk dengan role mock lewat query param. */
async function pilihRole(page: Page, role: Role) {
  await page.goto(`/?role=${role}`);
}

test.describe("matriks izin (PRD 8.1)", () => {
  test("guest ditolak di kelima halaman staff", async ({ page }) => {
    for (const href of HALAMAN_STAFF) {
      await pilihRole(page, "guest");
      await page.goto(`${href}?role=guest`);
      await expect(page.getByTestId("akses-ditolak")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Akses ditolak" })).toBeVisible();
    }
  });

  test("guest tetap melihat Ringkasan, Stok, Histori", async ({ page }) => {
    const judul: Record<string, string> = {
      "/": "Ringkasan",
      "/stok": "Stok",
      "/histori": "Histori",
    };
    for (const href of HALAMAN_SEMUA) {
      await pilihRole(page, "guest");
      await page.goto(`${href}?role=guest`);
      await expect(page.getByTestId("akses-ditolak")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: judul[href], level: 1 })).toBeVisible();
    }
  });

  test("admin membuka kelima halaman staff", async ({ page }) => {
    for (const href of HALAMAN_STAFF) {
      await pilihRole(page, "admin");
      await page.goto(`${href}?role=admin`);
      await expect(page.getByTestId("akses-ditolak")).toHaveCount(0);
    }
  });

  test("admin tidak dapat mengubah provider AI", async ({ page }) => {
    await pilihRole(page, "admin");
    await page.goto("/pengaturan?role=admin");
    await expect(page.getByTestId("kartu-provider")).toBeVisible();
    await expect(page.getByTestId("pilih-provider")).toBeDisabled();
    await expect(page.getByTestId("simpan-provider")).toBeDisabled();
    await expect(page.getByTestId("catatan-owner")).toBeVisible();

    // Paksa klik tombol simpan: tidak ada toast sukses, nilai tetap Groq.
    await page.getByTestId("simpan-provider").click({ force: true });
    await expect(page.getByText("Pengaturan disimpan")).toHaveCount(0);
    await expect(page.getByTestId("provider-aktif")).toHaveText("Groq");
  });

  test("owner dapat mengubah provider AI", async ({ page }) => {
    await pilihRole(page, "owner");
    await page.goto("/pengaturan?role=owner");
    await expect(page.getByTestId("provider-aktif")).toHaveText("Groq");

    await page.getByTestId("pilih-provider").click();
    await page.getByRole("option", { name: "Gemini" }).click();
    await page.getByTestId("simpan-provider").click();

    await expect(page.getByText("Pengaturan disimpan")).toBeVisible();
    await expect(page.getByTestId("provider-aktif")).toHaveText("Gemini");
  });

  test("admin read-only di /kata-kunci (tanpa kontrol ubah)", async ({ page }) => {
    await pilihRole(page, "admin");
    await page.goto("/kata-kunci?role=admin");
    await expect(page.getByTestId("tabel-kata-kunci")).toBeVisible();
    await expect(page.getByTestId("pilih-interpretasi-kw-001")).toHaveCount(0);
    await expect(page.getByTestId("konfirmasi-kw-001")).toHaveCount(0);
  });

  test("nav guest tidak memuat tautan staff", async ({ page }) => {
    await pilihRole(page, "guest");
    await page.goto("/?role=guest");

    // Sidebar (desktop): tautan staff tidak dirender.
    const sidebar = page.getByRole("navigation", { name: "Navigasi utama" });
    for (const label of ["Draft", "Permintaan", "Kata Kunci", "Admin", "Pengaturan"]) {
      await expect(sidebar.getByRole("link", { name: label })).toHaveCount(0);
    }

    // Bottom nav (mobile) + Sheet "Lainnya": tidak memuat tautan staff.
    const bawah = page.getByRole("navigation", { name: "Navigasi bawah" });
    for (const label of ["Draft", "Permintaan", "Kata Kunci", "Admin", "Pengaturan"]) {
      await expect(bawah.getByText(label, { exact: true })).toHaveCount(0);
    }
    // Guest hanya punya 3 tujuan utama → tombol "Lainnya" tidak muncul.
    await expect(bawah.getByRole("button", { name: "Menu lainnya" })).toHaveCount(0);
  });
});
