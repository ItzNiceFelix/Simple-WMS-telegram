import { test, expect, type Page } from "@playwright/test";

// A5 — Konten H5 Draft, H6 Permintaan, H7 Admin, H8 Pengaturan. Mode mock (PRD I2).
// Mock: 1 opname draft (3 item) + 1 sync draft (2 item); daily hari ini (tanggal relatif)
// & kemarin; 3 admins, 2 perubahan peran, 3 access request; provider "groq".

async function buka(page: Page, href: string, role: "owner" | "admin" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`${href}?role=${role}`);
}

/** Id tanggal lokal "YYYY-MM-DD" relatif hari ini (mock: dokumen hari ini + kemarin). */
function tanggalId(offsetHari: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetHari);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test.describe("H5 Draft", () => {
  test("menampilkan dua seksi draft + tombol Tinjau di Telegram", async ({ page }) => {
    await buka(page, "/draft");
    await expect(page.getByTestId("h5-draft")).toBeVisible();
    await expect(page.getByTestId("kartu-opname-od-001")).toBeVisible();
    await expect(page.getByTestId("kartu-sync-sd-001")).toBeVisible();
    await expect(page.getByTestId("kartu-opname-od-001")).toContainText("3 item");
    await expect(page.getByTestId("kartu-sync-sd-001")).toContainText("2 item");
    // v3b: kondisi seed kini salah satu KONDISI_VALID (`sheets_manual`), bukan "selisih"
    // yang ditolak validator server.
    await expect(page.getByTestId("kartu-sync-sd-001")).toContainText("sheets_manual");

    const tombol = page.getByTestId("tinjau-telegram");
    // v3b A2: hanya kartu yang LAYAK aksi (ber-owner) merender tombol Telegram: od-001,
    // sd-001, sd-002 = 3. Kartu orphan, batch picking, dan batch sebagian memakai teks pengganti.
    await expect(tombol).toHaveCount(3);
    await expect(tombol.first()).toHaveAttribute("href", "https://t.me/");
    await expect(tombol.first()).toHaveAttribute("target", "_blank");
    await expect(tombol.first()).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("ringkas item opname tampil (kode + kategori)", async ({ page }) => {
    await buka(page, "/draft");
    const kartu = page.getByTestId("kartu-opname-od-001");
    await expect(kartu).toContainText("Celana Chino Slim Fit");
    await expect(kartu).toContainText("BRG-003");
    await expect(kartu).toContainText("selisih_kecil");
  });
});

test.describe("H6 Permintaan", () => {
  test("menampilkan item hari ini + badge Buffer", async ({ page }) => {
    await buka(page, "/permintaan");
    await expect(page.getByTestId("h6-permintaan")).toBeVisible();
    const hariIni = page.getByTestId("seksi-hari-ini");
    await expect(hariIni.getByTestId("item-BRG-004")).toBeVisible();
    await expect(hariIni.getByTestId("item-BRG-003")).toContainText("Buffer");
    await expect(hariIni.getByTestId("item-BRG-004")).not.toContainText("Buffer");
    await expect(hariIni.getByTestId("item-BRG-003")).toContainText("7");
  });

  test("riwayat menampilkan dokumen hari sebelumnya", async ({ page }) => {
    await buka(page, "/permintaan");
    await expect(page.getByTestId(`riwayat-${tanggalId(-1)}`)).toBeVisible();
    await expect(page.getByTestId(`riwayat-${tanggalId(-1)}`)).toContainText("1 item");
  });
});

test.describe("H7 Admin", () => {
  test("menampilkan 3 admin", async ({ page }) => {
    await buka(page, "/admin");
    await expect(page.getByTestId("h7-admin")).toBeVisible();
    const baris = page.getByTestId("tabel-admin").locator("tbody tr");
    await expect(baris).toHaveCount(3);
    await expect(page.getByTestId("admin-900001")).toContainText("Budi Owner");
    await expect(page.getByTestId("admin-900001")).toContainText("Owner");
    await expect(page.getByTestId("admin-900002")).toContainText("@admin_gudang");
    await expect(page.getByTestId("admin-900003")).toContainText("Guest");
  });

  test("menampilkan perubahan peran", async ({ page }) => {
    await buka(page, "/admin");
    const daftar = page.getByTestId("daftar-perubahan").locator("li");
    await expect(daftar).toHaveCount(2);
    await expect(page.getByTestId("perubahan-rc-002")).toContainText("Siti Admin");
    await expect(page.getByTestId("perubahan-rc-002")).toContainText("Admin");
  });

  test("menampilkan 3 permintaan akses", async ({ page }) => {
    await buka(page, "/admin");
    const daftar = page.getByTestId("daftar-akses").locator("li");
    await expect(daftar).toHaveCount(3);
    await expect(page.getByTestId("akses-900010")).toContainText("Dewi Calon");
    await expect(page.getByTestId("akses-900010")).toContainText("Menunggu");
    await expect(page.getByTestId("akses-900011")).toContainText("Ditolak");
    // rejected_until ditampilkan (mock: 30 menit setelah T0).
    await expect(page.getByTestId("akses-900011")).toContainText("Ditolak sampai");
    await expect(page.getByTestId("akses-900012")).toContainText("Disetujui");
  });
});

test.describe("H8 Pengaturan", () => {
  test("menampilkan provider aktif", async ({ page }) => {
    await buka(page, "/pengaturan");
    await expect(page.getByTestId("h8-pengaturan")).toBeVisible();
    await expect(page.getByTestId("kartu-provider")).toBeVisible();
    await expect(page.getByTestId("provider-aktif")).toHaveText("Groq");
  });

  test("dropdown provider menampilkan 5 opsi", async ({ page }) => {
    await buka(page, "/pengaturan");
    await page.getByTestId("pilih-provider").click();
    for (const label of ["Gemini", "Groq", "Kenari", "OpenAI", "OpenRouter"]) {
      await expect(page.getByRole("option", { name: label })).toBeVisible();
    }
  });
});
