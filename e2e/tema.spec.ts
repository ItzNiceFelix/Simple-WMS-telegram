import { test, expect, type Page } from "@playwright/test";

// A6.1 — Tema terang/gelap (PRD FR-NFR-02, 25; ui-spec 6). Selalu mode mock (PRD I2).
// Toggle di header (theme-toggle.tsx): aria-label "Ganti ke mode gelap"/"Ganti ke mode terang".
// Preferensi disimpan di localStorage key "tema" ("terang"|"gelap").

const TOMBOL_GELAP = 'button[aria-label="Ganti ke mode gelap"]:visible';
const TOMBOL_TERANG = 'button[aria-label="Ganti ke mode terang"]:visible';

async function buka(page: Page, href = "/") {
  await page.goto("/?role=owner");
  await page.goto(`${href}?role=owner`, { waitUntil: "networkidle" });
}

function gelap(page: Page) {
  return page.evaluate(() => document.documentElement.classList.contains("dark"));
}

test.describe("tema — toggle manual", () => {
  test("klik toggle menambah class dark, klik lagi menghapusnya", async ({ page }) => {
    await buka(page);
    const tombol = page.locator(TOMBOL_GELAP).first();
    await expect(tombol).toBeVisible();
    expect(await gelap(page)).toBe(false);

    await tombol.click();
    await expect(page.locator(TOMBOL_TERANG).first()).toBeVisible();
    expect(await gelap(page)).toBe(true);

    await page.locator(TOMBOL_TERANG).first().click();
    await expect(page.locator(TOMBOL_GELAP).first()).toBeVisible();
    expect(await gelap(page)).toBe(false);
  });
  test("preferensi bertahan setelah reload", async ({ page }) => {
    await buka(page);
    await page.locator(TOMBOL_GELAP).first().click();
    expect(await gelap(page)).toBe(true);

    await page.reload({ waitUntil: "networkidle" });
    expect(await gelap(page)).toBe(true);
    await expect(page.locator(TOMBOL_TERANG).first()).toBeVisible();

    // Kembali ke terang lalu reload.
    await page.locator(TOMBOL_TERANG).first().click();
    await page.reload({ waitUntil: "networkidle" });
    expect(await gelap(page)).toBe(false);
    await expect(page.locator(TOMBOL_GELAP).first()).toBeVisible();
  });

  test("preferensi bertahan saat berpindah halaman", async ({ page }) => {
    await buka(page, "/stok");
    await page.locator(TOMBOL_GELAP).first().click();
    await expect(page.getByRole("heading", { name: "Stok", level: 1 })).toBeVisible();

    await page.locator('a[data-nav="/histori"]:visible').first().click();
    await expect(page.getByRole("heading", { name: "Histori", level: 1 })).toBeVisible();
    expect(await gelap(page)).toBe(true);
  });
});

test.describe("tema — ikut preferensi sistem", () => {
  test.use({ colorScheme: "dark" });

  test("prefers-color-scheme: dark langsung memakai class dark", async ({ page }) => {
    await buka(page);
    await expect(page.locator(TOMBOL_TERANG).first()).toBeVisible();
    expect(await gelap(page)).toBe(true);
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("preferensi tersimpan menang atas preferensi sistem", async ({ page }) => {
    await buka(page);
    // Sistem gelap → pilih terang secara manual → tetap terang setelah reload.
    await page.locator(TOMBOL_TERANG).first().click();
    expect(await gelap(page)).toBe(false);

    await page.reload({ waitUntil: "networkidle" });
    expect(await gelap(page)).toBe(false);
    await expect(page.locator(TOMBOL_GELAP).first()).toBeVisible();
  });
});

test.describe("tema — preferensi terang (eksplisit)", () => {
  test.use({ colorScheme: "light" });

  test("default sistem terang → tanpa class dark", async ({ page }) => {
    await buka(page);
    await expect(page.locator(TOMBOL_GELAP).first()).toBeVisible();
    expect(await gelap(page)).toBe(false);
  });
});

test.describe("tema gelap — tidak ada teks hilang / kontras rusak", () => {
  for (const { href, judul } of [
    { href: "/", judul: "Ringkasan" },
    { href: "/stok", judul: "Stok" },
  ]) {
    test(`${href} tetap terbaca di mode gelap`, async ({ page }) => {
      await buka(page, href);
      await page.evaluate(() => window.localStorage.setItem("tema", "gelap"));
      await page.reload({ waitUntil: "networkidle" });

      expect(await gelap(page)).toBe(true);
      await expect(page.getByRole("heading", { name: judul, level: 1 })).toBeVisible();

      // Tidak ada elemen teks yang sepenuhnya transparan (teks hilang).
      const takTerlihat = await page.evaluate(() => {
        const hasil: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          if (el.children.length > 0) continue;
          const teks = (el.textContent ?? "").trim();
          if (teks === "" || !el.offsetParent) continue;
          const s = getComputedStyle(el);
          if (s.visibility === "hidden" || s.display === "none") continue;
          // "rgba(..., 0)" atau "transparent" → teks tak terlihat.
          if (s.color === "transparent" || /rgba?\([^)]*,\s*0(\.0+)?\s*\)$/.test(s.color)) {
            hasil.push(el.className);
          }
        }
        return hasil;
      });
      expect(takTerlihat).toEqual([]);
    });
  }

  test("mode gelap memakai token kartu/latar berbeda (bukan tetap terang)", async ({ page }) => {
    await buka(page, "/stok");
    const terang = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.evaluate(() => window.localStorage.setItem("tema", "gelap"));
    await page.reload({ waitUntil: "networkidle" });
    const gelapWarna = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(gelapWarna).not.toBe(terang);
  });
});
