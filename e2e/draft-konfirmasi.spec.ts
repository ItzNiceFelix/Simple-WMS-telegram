import { test, expect, type Page } from "@playwright/test";

// Fase B / A2 - Konfirmasi draft dari /draft. Halaman INI hanya punya seksi picking list (PRD v3b
// 10.3/10.4 B6); seksi opname & sync dihapus karena `real.ts` selalu mengembalikan `[]` untuk
// keduanya (draft opname/sync hanya hidup di jalur Telegram) -> request-nya membuang rate limit.
// Mode mock. Seed picking:
//   batch 900004 siap | 900001 sebagian (mv-001 processed) | 900002 sebagian (mv-004/007 dll processed)
// Sesi mock: user.id SELALU "900001" (MOCK_SESSION), apa pun ?role=-nya. Karena itu gerbang
// admin (String(uid) === String(owner_user_id)) berarti admin hanya berhak atas batch owner 900001.

type Role = "owner" | "admin" | "guest";

async function buka(page: Page, role: Role = "owner", extra = "") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/draft?role=${role}${extra}`);
  await expect(page.getByRole("heading", { name: "Draft Pending", level: 1 })).toBeVisible();
}

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

test.describe("A2 konfirmasi draft - izin", () => {
  test("admin: tombol hanya pada batch miliknya (uid mock 900001)", async ({ page }) => {
    await buka(page, "admin");
    // Batch 900001 SENDIRI memang sebagian di seed (mv-001 processed) -> kartu dirender tanpa
    // tombol, hanya badge + teks Telegram. Kepemilikan tidak bisa dibuktikan dari tombolnya
    // (tak satu pun batch owner 900001 "siap"), jadi diuji lewat badge pembatas: hanya batch
    // non-miliknya yang menampilkan "Hanya pembuat draft atau owner".
    await expect(page.getByTestId("kartu-picking-900001")).toBeVisible();
    await expect(page.getByTestId("kartu-picking-900001")).not.toContainText("Hanya pembuat draft");
    await expect(page.getByTestId("konfirmasi-picking-batch-900001")).toHaveCount(0);
    // Bukan miliknya (owner 900002, juga sebagian): badge pembatas, TANPA tombol.
    await expect(page.getByTestId("kartu-picking-900002")).toContainText(
      "Hanya pembuat draft atau owner"
    );
    await expect(page.getByTestId("konfirmasi-picking-batch-900002")).toHaveCount(0);
    await expect(page.getByTestId("batalkan-picking-batch-900002")).toHaveCount(0);
    // 900004 SIAP tapi bukan milik admin -> pembatas + tetap TANPA tombol (inti gerbang admin).
    await expect(page.getByTestId("kartu-picking-900004")).toContainText(
      "Hanya pembuat draft atau owner"
    );
    await expect(page.getByTestId("konfirmasi-picking-batch-900004")).toHaveCount(0);
    await expect(page.getByTestId("batalkan-picking-batch-900004")).toHaveCount(0);
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
    await page.getByTestId("konfirmasi-picking-batch-900004").click();
    const dialog = page.getByTestId("dialog-konfirmasi-picking");
    await expect(dialog).toBeVisible();

    await page.getByTestId("konfirmasi-picking-ok-900004").click();
    await expect(page.getByText("Sesi kedaluwarsa. Buka ulang dari Telegram.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buka ulang" })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("kartu-picking-900004")).toBeVisible();
  });
});
