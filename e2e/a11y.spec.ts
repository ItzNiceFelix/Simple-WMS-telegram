import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// A6.1 — Aksesibilitas (PRD FR-NFR-03, 25, 38.3). Selalu mode mock (PRD I2).
// Aturan yang WAJIB lolos: label, button-name, color-contrast, html-has-lang,
// landmark-one-main, page-has-heading-one (ui-spec 6).

const ATURAN_WAJIB = [
  "label",
  "button-name",
  "color-contrast",
  "html-has-lang",
  "landmark-one-main",
  "page-has-heading-one",
];

const HALAMAN_OWNER = [
  "/",
  "/stok",
  "/histori",
  "/draft",
  "/permintaan",
  "/kata-kunci",
  "/admin",
  "/pengaturan",
  "/produk/BRG-001",
];
const HALAMAN_GUEST = ["/", "/stok", "/histori"];

type Role = "owner" | "admin" | "guest";

async function buka(page: Page, href: string, role: Role) {
  await page.goto(`/?role=${role}`);
  await page.goto(`${href}?role=${role}`, { waitUntil: "networkidle" });
  await expect(page.locator("main")).toBeVisible();
}

/** Pelanggaran dengan dampak critical/serious saja (sinyal yang harus nol). */
async function pelanggaranBerat(page: Page) {
  const hasil = await new AxeBuilder({ page }).analyze();
  return hasil.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node — ${v.nodes[0]?.target.join(" ")}`);
}

test.describe("a11y — tanpa pelanggaran critical/serious (owner)", () => {
  for (const href of HALAMAN_OWNER) {
    test(`${href} bersih`, async ({ page }) => {
      await buka(page, href, "owner");
      expect(await pelanggaranBerat(page)).toEqual([]);
    });
  }
});

test.describe("a11y — tanpa pelanggaran critical/serious (guest)", () => {
  for (const href of HALAMAN_GUEST) {
    test(`${href} bersih`, async ({ page }) => {
      await buka(page, href, "guest");
      expect(await pelanggaranBerat(page)).toEqual([]);
    });
  }
});

test.describe("a11y — aturan wajib (FR-NFR-03)", () => {
  for (const href of HALAMAN_OWNER) {
    test(`aturan wajib lolos di ${href}`, async ({ page }) => {
      await buka(page, href, "owner");
      const hasil = await new AxeBuilder({ page }).withRules(ATURAN_WAJIB).analyze();
      expect(
        hasil.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)
      ).toEqual([]);
    });
  }
});

test.describe("a11y — aturan wajib untuk guest", () => {
  for (const href of HALAMAN_GUEST) {
    test(`aturan wajib lolos di ${href}`, async ({ page }) => {
      await buka(page, href, "guest");
      const hasil = await new AxeBuilder({ page }).withRules(ATURAN_WAJIB).analyze();
      expect(
        hasil.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)
      ).toEqual([]);
    });
  }
});

test.describe("a11y — struktur dasar", () => {
  test("html punya lang=id", async ({ page }) => {
    await buka(page, "/", "owner");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
  });

  test("tombol ikon punya nama aksesibel", async ({ page }) => {
    await buka(page, "/", "owner");
    for (const tombol of await page.locator("button").all()) {
      const nama = (await tombol.getAttribute("aria-label")) ?? (await tombol.innerText()).trim();
      expect(nama, "setiap tombol wajib punya nama").not.toBe("");
    }
  });
});
