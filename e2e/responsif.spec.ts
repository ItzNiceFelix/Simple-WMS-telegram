import { test, expect, type Page } from "@playwright/test";

// A6.1 — Responsif (PRD FR-NFR-04, 25, 38.3; ui-spec 2, 6). Selalu mode mock (PRD I2).
// Breakpoint shell = md (768px): < 768 bottom nav + tanpa sidebar; >= 768 sidebar.
// Target sentuh >= 44px pada mobile (ui-spec 6).

const HALAMAN = ["/", "/stok", "/histori", "/draft", "/permintaan", "/kata-kunci", "/admin", "/pengaturan"];

async function buka(page: Page, href: string, role: "owner" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`${href}?role=${role}`, { waitUntil: "networkidle" });
  await expect(page.locator("main")).toBeVisible();
}

/** Lebar viewport aktif (dari project Playwright). */
async function viewport(page: Page) {
  return page.viewportSize() ?? { width: 1280, height: 800 };
}

const terlihat = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.some((e) => e.getClientRects().length > 0));

test.describe("responsif — tanpa scroll horizontal", () => {
  for (const href of HALAMAN) {
    test(`${href} tidak overflow`, async ({ page }) => {
      await buka(page, href);
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(m.sw, `${href}: scrollWidth ${m.sw} > clientWidth ${m.cw}`).toBeLessThanOrEqual(
        m.cw + 1
      );
    });
  }

  test("halaman stok tidak overflow setelah filter aktif", async ({ page }) => {
    await buka(page, "/stok");
    await page.getByTestId("filter-minus").click();
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
  });

  test("halaman histori tidak overflow setelah filter dibuka", async ({ page }) => {
    await buka(page, "/histori");
    const trigger = page.getByTestId("toggle-filter-histori");
    if (await trigger.isVisible()) {
      await trigger.click();
      await expect(page.getByTestId("panel-filter-histori")).toBeVisible();
    }
    await page.getByTestId("mode-jenis").click();
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
  });

  test("halaman permintaan tidak overflow dengan dialog terbuka", async ({ page }) => {
    await buka(page, "/permintaan");
    await page.getByTestId("tombol-ubah-jumlah").click();
    await expect(page.getByTestId("dialog-ubah-jumlah")).toBeVisible();
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
    await page.getByRole("button", { name: "Batal" }).click();
  });
});

test.describe("responsif — navigasi sesuai breakpoint", () => {
  test("shell menampilkan nav yang benar pada viewport aktif", async ({ page }) => {
    await buka(page, "/");
    const { width } = await viewport(page);
    const bawah = await terlihat(page, '[aria-label="Navigasi bawah"]');
    const sidebar = await terlihat(page, "aside");

    if (width < 768) {
      expect(bawah, "bottom nav wajib terlihat < 768px").toBe(true);
      expect(sidebar, "sidebar wajib tersembunyi < 768px").toBe(false);
    } else {
      expect(sidebar, "sidebar wajib terlihat >= 768px").toBe(true);
      expect(bawah, "bottom nav wajib tersembunyi >= 768px").toBe(false);
    }
  });

  test("navigasi berpindah halaman pada viewport aktif", async ({ page }) => {
    await buka(page, "/");
    const tautan = page.locator('a[data-nav="/stok"]:visible').first();
    await expect(tautan).toBeVisible();
    await tautan.click();
    await expect(page.getByRole("heading", { name: "Stok", level: 1 })).toBeVisible();
  });
});

test.describe("responsif — target sentuh mobile", () => {
  test("setiap tombol/tautan nav utama >= 44px", async ({ page }) => {
    await buka(page, "/");
    const { width } = await viewport(page);
    test.skip(width >= 768, "aturan target sentuh hanya untuk mobile");

    const nav = page.locator('[aria-label="Navigasi bawah"]');
    const kotak = await nav
      .locator("a, button")
      .evaluateAll((els) => els.map((e) => ({ t: (e.textContent ?? "").trim(), h: e.getBoundingClientRect().height })));
    expect(kotak.length).toBeGreaterThan(0);
    for (const k of kotak) {
      expect(k.h, `target sentuh "${k.t}" hanya ${k.h}px`).toBeGreaterThanOrEqual(44);
    }
  });

  test("tombol header (tema) >= 44px pada mobile", async ({ page }) => {
    await buka(page, "/");
    const { width } = await viewport(page);
    test.skip(width >= 768, "aturan target sentuh hanya untuk mobile");
    const h = await page
      .locator('button[aria-label^="Ganti ke mode"]:visible')
      .first()
      .evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
  });

  test("kontrol header lain (pemilih peran) >= 44px pada mobile", async ({ page }) => {
    await buka(page, "/");
    const { width } = await viewport(page);
    test.skip(width >= 768, "aturan target sentuh hanya untuk mobile");
    const kotak = await page
      .locator('header [role="combobox"]:visible')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(kotak.length).toBeGreaterThan(0);
    for (const h of kotak) expect(h).toBeGreaterThanOrEqual(44);
  });

  test("tombol aksi permintaan >= 44px pada mobile", async ({ page }) => {
    await buka(page, "/permintaan");
    const { width } = await viewport(page);
    test.skip(width >= 768, "aturan target sentuh hanya untuk mobile");
    const kotak = await page
      .locator('[data-testid^="tombol-"]:visible')
      .evaluateAll((els) => els.map((e) => ({ t: e.getAttribute("data-testid"), h: e.getBoundingClientRect().height })));
    expect(kotak.length).toBeGreaterThan(0);
    for (const k of kotak) {
      expect(k.h, `target sentuh "${k.t}" hanya ${k.h}px`).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("responsif — guest", () => {
  for (const href of ["/", "/stok", "/histori"]) {
    test(`${href} tanpa overflow untuk guest`, async ({ page }) => {
      await buka(page, href, "guest");
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
    });
  }
});
