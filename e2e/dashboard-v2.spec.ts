import { test, expect, type Page } from "@playwright/test";

// Wave 3d — aksi tulis v2 (F1-F4) di mode mock (PRD v2 §2-§5, §12; PRD v1 §11.2).
// Data mock: produk BRG-001 (HPP 85000, hpp_baru 88000), stok BRG-001 = 42/reorder 10.
// Admin: 900001 owner, 900002 admin, 900003 guest.

type Role = "owner" | "admin" | "guest";

async function buka(page: Page, href: string, role: Role = "owner", extra = "") {
  await page.goto(`/?role=${role}`);
  await page.goto(`${href}?role=${role}${extra}`);
}

// ---------------------------------------------------------------- F1 HPP

test.describe("F1 Edit HPP (owner only)", () => {
  test("owner membuka dialog + simpan sukses", async ({ page }) => {
    await buka(page, "/produk/BRG-001", "owner");
    await expect(page.getByTestId("nilai-hpp")).toContainText("85.000");

    await page.getByTestId("buka-dialog-hpp").click();
    const dialog = page.getByTestId("dialog-hpp");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("input-hpp")).toHaveValue("85000");

    await page.getByTestId("input-hpp").fill("90000");
    await page.getByTestId("submit-hpp").click();

    await expect(page.getByText("HPP diperbarui")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("nilai-hpp")).toContainText("90.000");

    // B-01: buka ulang setelah refetch -> isian sinkron nilai BARU (bukan state basi).
    await page.getByTestId("buka-dialog-hpp").click();
    await expect(page.getByTestId("dialog-hpp")).toBeVisible();
    await expect(page.getByTestId("input-hpp")).toHaveValue("90000");
    await page.getByRole("button", { name: "Batal" }).click();
  });

  test("guest & admin tidak melihat kontrol tulis HPP", async ({ page }) => {
    for (const role of ["admin", "guest"] as Role[]) {
      await buka(page, "/produk/BRG-001", role);
      await expect(page.getByTestId("kartu-info-produk")).toBeVisible();
      await expect(page.getByTestId("buka-dialog-hpp")).toHaveCount(0);
    }
  });

  test("guest tidak melihat tombol Edit Reorder (matriks izin)", async ({ page }) => {
    await buka(page, "/produk/BRG-001", "guest");
    await expect(page.getByTestId("kartu-stok-produk")).toBeVisible();
    await expect(page.getByTestId("buka-dialog-koreksi")).toHaveCount(0);
    await expect(page.getByTestId("buka-dialog-reorder")).toHaveCount(0);
  });

  test("admin melihat Edit Reorder tetapi tidak Edit HPP", async ({ page }) => {
    await buka(page, "/produk/BRG-001", "admin");
    await expect(page.getByTestId("buka-dialog-reorder")).toBeVisible();
    await expect(page.getByTestId("buka-dialog-hpp")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------- 401 mid-write

test.describe("401 mid-write (PRD v1 §11.2)", () => {
  test("HPP: toast sesi kedaluwarsa, dialog tidak tutup, isian dipertahankan", async ({ page }) => {
    await buka(page, "/produk/BRG-001", "owner", "&mock-401=1");
    await page.getByTestId("buka-dialog-hpp").click();
    await page.getByTestId("input-hpp").fill("95000");
    await page.getByTestId("submit-hpp").click();

    await expect(page.getByText("Sesi kedaluwarsa. Buka ulang dari Telegram.")).toBeVisible();
    await expect(page.getByTestId("dialog-hpp")).toBeVisible();
    await expect(page.getByTestId("input-hpp")).toHaveValue("95000");
    await expect(page.getByRole("button", { name: "Buka ulang" })).toBeVisible();
  });
});

// ---------------------------------------------------------------- F3 role

test.describe("F3 Ubah role admin", () => {
  test("owner mengubah guest -> admin (tanpa AlertDialog untuk non-owner target)", async ({ page }) => {
    await buka(page, "/admin", "owner");
    const aksi = page.getByTestId("aksi-role-900003");
    await expect(aksi).toBeVisible();
    await page.getByTestId("pilih-role-900003").click();
    await page.getByRole("option", { name: "Admin" }).click();
    await page.getByTestId("simpan-role-900003").click();

    await expect(page.getByText("Role Rina Guest diubah menjadi Admin.")).toBeVisible();
    await expect(page.getByTestId("admin-900003")).toContainText("Admin");
  });

  test("promosi ke owner wajib konfirmasi ekstra", async ({ page }) => {
    await buka(page, "/admin", "owner");
    await page.getByTestId("pilih-role-900003").click();
    await page.getByRole("option", { name: "Owner" }).click();
    await page.getByTestId("simpan-role-900003").click();

    const konfirmasi = page.getByTestId("konfirmasi-role-900003");
    await expect(konfirmasi).toBeVisible();
    await expect(konfirmasi).toContainText("hak setara Anda");
    await page.getByTestId("konfirmasi-role-ok-900003").click();
    await expect(page.getByText(/Role Rina Guest diubah menjadi Owner/)).toBeVisible();
  });

  test("baris sendiri: aksi disabled (tidak boleh ubah role diri sendiri)", async ({ page }) => {
    await buka(page, "/admin", "owner");
    await expect(page.getByTestId("pilih-role-900001")).toBeDisabled();
    await expect(page.getByTestId("simpan-role-900001")).toBeDisabled();
  });

  test("admin tidak melihat kolom aksi sama sekali", async ({ page }) => {
    await buka(page, "/admin", "admin");
    await expect(page.getByTestId("aksi-role-900003")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------- F4 kelola admin

test.describe("F4 Kelola admin", () => {
  test("owner menambah admin baru -> muncul di tabel", async ({ page }) => {
    await buka(page, "/pengaturan", "owner");
    await expect(page.getByTestId("kelola-admin")).toBeVisible();
    await page.getByTestId("buka-tambah-admin").click();
    await expect(page.getByTestId("dialog-tambah-admin")).toBeVisible();

    await page.getByTestId("input-user-id").fill("900999");
    await page.getByTestId("input-nama-admin").fill("Budi Baru");
    await page.getByTestId("submit-tambah-admin").click();

    await expect(page.getByText("Admin Budi Baru ditambahkan.")).toBeVisible();
    await expect(page.getByTestId("kelola-admin-900999")).toContainText("Budi Baru");
  });

  test("tambah user yang sudah ada -> error inline, dialog tetap terbuka", async ({ page }) => {
    await buka(page, "/pengaturan", "owner");
    await page.getByTestId("buka-tambah-admin").click();
    await page.getByTestId("input-user-id").fill("900002");
    await page.getByTestId("input-nama-admin").fill("Duplikat");
    await page.getByTestId("submit-tambah-admin").click();

    await expect(page.getByTestId("error-tambah-admin")).toContainText("User sudah terdaftar sebagai admin.");
    await expect(page.getByTestId("dialog-tambah-admin")).toBeVisible();
    await expect(page.getByTestId("input-user-id")).toHaveValue("900002");
  });

  test("hapus admin -> konfirmasi -> hilang dari tabel", async ({ page }) => {
    await buka(page, "/pengaturan", "owner");
    await page.getByTestId("hapus-admin-900003").click();
    const konfirmasi = page.getByTestId("konfirmasi-hapus-admin");
    await expect(konfirmasi).toBeVisible();
    await expect(konfirmasi).toContainText("Rina Guest");
    await expect(konfirmasi).toContainText("Akses tulis berhenti seketika");
    await page.getByTestId("konfirmasi-hapus-ok").click();

    await expect(page.getByText("Admin Rina Guest dihapus.")).toBeVisible();
    await expect(page.getByTestId("kelola-admin-900003")).toHaveCount(0);
  });

  test("tambah owner kedua lalu hapus sukses (owner > 1)", async ({ page }) => {
    await buka(page, "/pengaturan", "owner");
    await page.getByTestId("buka-tambah-admin").click();
    await page.getByTestId("input-user-id").fill("900777");
    await page.getByTestId("input-nama-admin").fill("Owner Kedua");
    await page.getByTestId("pilih-role-baru").click();
    await page.getByRole("option", { name: "Owner" }).click();
    await page.getByTestId("submit-tambah-admin").click();
    await expect(page.getByTestId("kelola-admin-900777")).toBeVisible();

    await page.getByTestId("hapus-admin-900777").click();
    await page.getByTestId("konfirmasi-hapus-ok").click();
    await expect(page.getByTestId("kelola-admin-900777")).toHaveCount(0);
  });

  test("owner terakhir: tombol hapus baris sendiri disabled", async ({ page }) => {
    await buka(page, "/pengaturan", "owner");
    await expect(page.getByTestId("hapus-admin-900001")).toBeDisabled();
  });

  test("admin/guest tidak melihat seksi Kelola Admin", async ({ page }) => {
    for (const role of ["admin", "guest"] as Role[]) {
      await buka(page, "/pengaturan", role);
      if (role === "guest") {
        await expect(page.getByTestId("akses-ditolak")).toBeVisible();
      } else {
        await expect(page.getByTestId("kelola-admin")).toHaveCount(0);
      }
    }
  });
});

// ---------------------------------------------------------------- F5 super admin

test.describe("F5 Status super admin", () => {
  test("owner melihat status + catatan keterbatasan env", async ({ page }) => {
    await buka(page, "/pengaturan", "owner");
    await expect(page.getByTestId("kartu-super-admin")).toBeVisible();
    await expect(page.getByTestId("status-super-admin")).toHaveText("Ya");
    await expect(page.getByTestId("catatan-super-admin")).toContainText(/tidak dapat diubah dari dashboard/i);
  });
});