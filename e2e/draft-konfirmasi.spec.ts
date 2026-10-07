import { test, expect, type Page } from "@playwright/test";

// Fase B / A2 - Konfirmasi draft dari /draft (opname, sync, picking batch). PRD v3b 10.3/10.4 (B6).
// Mode mock. Seed:
//   opname od-001 owner 900001 | od-orphan owner null
//   sync   sd-001 (sheets_manual) + sd-002 (sheets_ketinggalan) owner 900002 | sd-orphan owner null
//   picking batch 900004 siap | 900001 sebagian | 900002 sebagian (+mv-008 pending)
// Sesi mock: user.id SELALU "900001" (MOCK_SESSION), apa pun ?role=-nya. Karena itu gerbang
// admin (String(uid) === String(owner_user_id)) berarti admin hanya berhak atas draft owner 900001.

type Role = "owner" | "admin" | "guest";

async function buka(page: Page, role: Role = "owner", extra = "") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/draft?role=${role}${extra}`);
  await expect(page.getByRole("heading", { name: "Draft Pending", level: 1 })).toBeVisible();
}

test.describe("A2 konfirmasi draft - opname", () => {
  test("tombol konfirmasi/batal tampil untuk draft ber-owner", async ({ page }) => {
    await buka(page, "owner");
    await expect(page.getByTestId("kartu-opname-od-001")).toBeVisible();
    await expect(page.getByTestId("konfirmasi-opname-od-001")).toBeVisible();
    await expect(page.getByTestId("batalkan-opname-od-001")).toBeVisible();
    await expect(page.getByTestId("badge-pemilik-diketahui-od-001")).toBeVisible();
  });

  test("draft orphan: badge pemilik tak diketahui, TANPA tombol", async ({ page }) => {
    await buka(page, "owner");
    await expect(page.getByTestId("badge-pemilik-tak-diketahui-od-orphan")).toBeVisible();
    await expect(page.getByTestId("kartu-opname-od-orphan")).toContainText("Proses lewat Telegram");
    await expect(page.getByTestId("konfirmasi-opname-od-orphan")).toHaveCount(0);
    await expect(page.getByTestId("batalkan-opname-od-orphan")).toHaveCount(0);
  });

  test("konfirmasi opname: dialog ringkasan -> OK -> toast + kartu hilang", async ({ page }) => {
    await buka(page, "owner");
    await page.getByTestId("konfirmasi-opname-od-001").click();
    const dialog = page.getByTestId("dialog-konfirmasi-opname");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("3");
    await expect(dialog).toContainText("klarifikasi");

    await page.getByTestId("konfirmasi-opname-ok-od-001").click();
    await expect(page.getByText("Draft diproses.")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("kartu-opname-od-001")).toHaveCount(0);
  });

  test("batalkan opname: dialog -> OK -> kartu hilang", async ({ page }) => {
    await buka(page, "owner");
    await page.getByTestId("batalkan-opname-od-001").click();
    const dialog = page.getByTestId("dialog-batalkan-opname");
    await expect(dialog).toBeVisible();
    await page.getByTestId("batalkan-opname-ok-od-001").click();
    await expect(page.getByText("Draft dibatalkan.")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("kartu-opname-od-001")).toHaveCount(0);
  });
});

test.describe("A2 konfirmasi draft - picking batch", () => {
  test("batch siap tampil dengan ringkasan + tombol, konfirmasi -> kartu hilang", async ({ page }) => {
    await buka(page, "owner");
    const ringkasan = page.getByTestId("ringkasan-picking-batch-900004");
    await expect(ringkasan).toBeVisible();
    await expect(ringkasan).toContainText("2 item siap diproses, 0 dilewati");
    await page.getByTestId("konfirmasi-picking-batch-900004").click();
    const dialog = page.getByTestId("dialog-konfirmasi-picking");
    await expect(dialog).toBeVisible();
    await page.getByTestId("konfirmasi-picking-ok-900004").click();
    await expect(page.getByText("Draft diproses.")).toBeVisible();
    await expect(page.getByTestId("kartu-picking-900004")).toHaveCount(0);
  });

  test("batch sebagian: badge Diproses sebagian + TANPA tombol (E-3)", async ({ page }) => {
    await buka(page, "owner");
    // 900001 punya mv-001 (processed) + pk-001..003 (pending) -> batch setengah jadi.
    await expect(page.getByTestId("badge-picking-sebagian-900001")).toBeVisible();
    await expect(page.getByTestId("konfirmasi-picking-batch-900001")).toHaveCount(0);
    await expect(page.getByTestId("batalkan-picking-batch-900001")).toHaveCount(0);
    // 900002 juga sebagian (punya movement processed di MOVEMENT_SEEDS).
    await expect(page.getByTestId("kartu-picking-900002")).toBeVisible();
    await expect(page.getByTestId("badge-picking-sebagian-900002")).toBeVisible();
  });

  // TERBATAS: seed mock selalu punya batch pending untuk tiap owner (900001/900002/900004),
  // dan role guest ditolak ButuhAkses (bukan empty state). Menguji empty-picking menuntut owner
  // tanpa movement di mock-data.ts. Elemen `empty-picking` ada di `app/draft/page.tsx` dan tampil
  // di produksi bila tak ada movement pending. Di-skip secara sadar, BUKAN karena bug.
  test.skip("empty state picking (butuh owner tanpa batch di seed)", async () => {});
});

test.describe("A2 konfirmasi draft - sync", () => {
  test("tombol per kelompok tampil; konfirmasi -> kartu hilang / sisa kelompok", async ({ page }) => {
    await buka(page, "owner");
    await expect(page.getByTestId("kartu-sync-sd-001")).toBeVisible();
    await page.getByTestId("konfirmasi-sync-sd-001").click();
    const dialog = page.getByTestId("dialog-konfirmasi-sync");
    await expect(dialog).toBeVisible();
    await page.getByTestId("konfirmasi-sync-ok-sd-001").click();
    // sd-001 (`sheets_manual`) berbagi pemilik dengan sd-002 -> konfirmasi satu kelompok
    // menyisakan kelompok lain (sisa), bukan menghabiskan semuanya.
    await expect(page.getByText("Sebagian diproses. Masih ada kelompok lain yang menunggu.")).toBeVisible();
    await expect(page.getByTestId("kartu-sync-sd-001")).toHaveCount(0);
    // Kelompok lain milik pemilik sama tetap menunggu.
    await expect(page.getByTestId("kartu-sync-sd-002")).toBeVisible();
  });

  test("konfirmasi-sync-semua tampil saat >=2 draft sync dan berfungsi", async ({ page }) => {
    await buka(page, "owner");
    // Seed: sd-001 + sd-002 (keduanya milik 900002) -> 2 draft yang boleh diaksi. sd-orphan TIDAK dihitung.
    const semua = page.getByTestId("konfirmasi-sync-semua");
    await expect(semua).toBeVisible();
    await semua.click();
    const dialog = page.getByTestId("dialog-konfirmasi-sync");
    await expect(dialog).toBeVisible();
    await page.getByTestId("konfirmasi-sync-semua-ok").click();
    await expect(page.getByText("Draft diproses.")).toBeVisible();
    await expect(page.getByTestId("kartu-sync-sd-001")).toHaveCount(0);
  });
});

test.describe("A2 konfirmasi draft - izin", () => {
  test("admin: tombol hanya pada draft miliknya (uid mock 900001)", async ({ page }) => {
    await buka(page, "admin");
    // Miliknya (owner 900001): od-001 -> ada tombol; batch 900001 memang sebagian (tanpa tombol).
    await expect(page.getByTestId("konfirmasi-opname-od-001")).toBeVisible();
    // Bukan miliknya (owner 900002): sd-001 -> tombol disembunyikan + teks pembatas.
    await expect(page.getByTestId("konfirmasi-sync-sd-001")).toHaveCount(0);
    await expect(page.getByTestId("kartu-sync-sd-001")).toContainText(
      "Hanya pembuat draft atau owner"
    );
  });

  test("guest ditolak halaman /draft", async ({ page }) => {
    await page.goto("/?role=guest");
    await page.goto("/draft?role=guest");
    await expect(page.getByTestId("akses-ditolak")).toBeVisible();
  });
});

test.describe("A2 konfirmasi draft - B6 401 mid-write", () => {
  test("401: dialog TETAP terbuka + toast sesi kedaluwarsa + tombol Buka ulang", async ({ page }) => {
    await buka(page, "owner", "&mock-401=konfirmasi-draft");
    await page.getByTestId("konfirmasi-opname-od-001").click();
    const dialog = page.getByTestId("dialog-konfirmasi-opname");
    await expect(dialog).toBeVisible();

    await page.getByTestId("konfirmasi-opname-ok-od-001").click();
    await expect(page.getByText("Sesi kedaluwarsa. Buka ulang dari Telegram.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buka ulang" })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("kartu-opname-od-001")).toBeVisible();
  });
});