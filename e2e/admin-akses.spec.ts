import { test, expect, type Page } from "@playwright/test";

// Fase A / A7 — Proses permintaan akses (owner only). PRD v3b §10.1/§10.4 (B6). Mode mock.
// Mock: 900010 pending (Dewi Calon), 900011 rejected, 900012 approved.
// Approve/reject hanya dirender untuk owner DAN status pending.

type Role = "owner" | "admin" | "guest";

async function buka(page: Page, role: Role = "owner", extra = "") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/admin?role=${role}${extra}`);
  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
}

test.describe("A7 permintaan akses — owner", () => {
  test("tombol Setujui/Tolak hanya pada request pending", async ({ page }) => {
    await buka(page);
    await expect(page.getByTestId("setujui-akses-900010")).toBeVisible();
    await expect(page.getByTestId("tolak-akses-900010")).toBeVisible();
    // Bukan pending -> tanpa tombol aksi.
    await expect(page.getByTestId("setujui-akses-900011")).toHaveCount(0);
    await expect(page.getByTestId("tolak-akses-900011")).toHaveCount(0);
    await expect(page.getByTestId("setujui-akses-900012")).toHaveCount(0);
    await expect(page.getByTestId("tolak-akses-900012")).toHaveCount(0);
  });

  test("badge status akses per baris", async ({ page }) => {
    await buka(page);
    await expect(page.getByTestId("badge-status-akses-900010")).toHaveText("Menunggu");
    await expect(page.getByTestId("badge-status-akses-900011")).toHaveText("Ditolak");
    await expect(page.getByTestId("badge-status-akses-900012")).toHaveText("Disetujui");
  });

  test("setujui: dialog konfirmasi -> status berubah jadi Disetujui", async ({ page }) => {
    await buka(page);
    await page.getByTestId("setujui-akses-900010").click();
    const dialog = page.getByTestId("dialog-setujui-akses");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Dewi Calon");
    await expect(dialog).toContainText("kenalan");

    await page.getByTestId("konfirmasi-setujui-akses-ok").click();
    await expect(page.getByText("Akses Dewi Calon disetujui.")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("badge-status-akses-900010")).toHaveText("Disetujui");
    // Sudah diproses -> tombol aksi hilang.
    await expect(page.getByTestId("setujui-akses-900010")).toHaveCount(0);
  });

  test("tolak: dialog konfirmasi -> status berubah jadi Ditolak", async ({ page }) => {
    await buka(page);
    await page.getByTestId("tolak-akses-900010").click();
    const dialog = page.getByTestId("dialog-tolak-akses");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("1 jam");

    await page.getByTestId("konfirmasi-tolak-akses-ok").click();
    await expect(page.getByText("Akses Dewi Calon ditolak.")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("badge-status-akses-900010")).toHaveText("Ditolak");
    await expect(page.getByTestId("tolak-akses-900010")).toHaveCount(0);
  });

  test("409 request sudah diproses -> baris ditutup + refetch (tombol hilang)", async ({ page }) => {
    await buka(page);
    // Buka dua dialog aksi berurutan pada baris yang sama: yang kedua basi (409).
    await page.getByTestId("setujui-akses-900010").click();
    await page.getByTestId("konfirmasi-setujui-akses-ok").click();
    await expect(page.getByTestId("badge-status-akses-900010")).toHaveText("Disetujui");
    // Baris basi tidak lagi menawarkan aksi apa pun (guard UI = pertahanan pertama).
    await expect(page.getByTestId("setujui-akses-900010")).toHaveCount(0);
    await expect(page.getByTestId("tolak-akses-900010")).toHaveCount(0);
  });

  test("B6 — 401 mid-write: dialog TETAP terbuka + state utuh", async ({ page }) => {
    await buka(page, "owner", "&mock-401=approve-akses");
    await page.getByTestId("setujui-akses-900010").click();
    const dialog = page.getByTestId("dialog-setujui-akses");
    await expect(dialog).toBeVisible();

    await page.getByTestId("konfirmasi-setujui-akses-ok").click();
    await expect(page.getByText("Sesi kedaluwarsa. Buka ulang dari Telegram.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buka ulang" })).toBeVisible();
    // Dialog konfirmasi TIDAK ditutup, baris belum berubah.
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("badge-status-akses-900010")).toHaveText("Menunggu");
  });
});

test.describe("A7 permintaan akses — izin", () => {
  test("admin TIDAK melihat tombol Setujui/Tolak", async ({ page }) => {
    await buka(page, "admin");
    await expect(page.getByTestId("daftar-akses")).toBeVisible();
    for (const id of ["900010", "900011", "900012"]) {
      await expect(page.getByTestId(`setujui-akses-${id}`)).toHaveCount(0);
      await expect(page.getByTestId(`tolak-akses-${id}`)).toHaveCount(0);
    }
  });

  test("guest ditolak halaman /admin", async ({ page }) => {
    await page.goto("/?role=guest");
    await page.goto("/admin?role=guest");
    await expect(page.getByTestId("akses-ditolak")).toBeVisible();
  });
});
