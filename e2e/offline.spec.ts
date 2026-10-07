import { test, expect, type Page, type Request } from "@playwright/test";

// A6.1 — Isolasi jaringan (PRD 38.3/38.4, I2). Selalu mode mock.
// Mode mock TIDAK BOLEH menembak Firestore/Telegram, dan halaman tetap merender
// meski semua domain eksternal diblokir.

const HALAMAN = ["/", "/stok", "/histori", "/draft", "/permintaan", "/kata-kunci", "/admin", "/pengaturan", "/produk/BRG-001"];

/** Domain terlarang (spesifik, bukan suffix "googleapis.com" yang menelan semua). */
const DOMAIN_TERLARANG = [
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "googleapis.com",
  "api.telegram.org",
  "t.me",
];

function domainTerlarang(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return DOMAIN_TERLARANG.some(
    (d) => url.hostname === d || url.hostname.endsWith(`.${d}`)
  );
}

/** Tautan statis (navigasi <a href>) tidak di-fetch browser — abaikan. */
function diFetch(req: Request): boolean {
  return !["document"].includes(req.resourceType()) || !req.isNavigationRequest();
}

async function buka(page: Page, href: string, role: "owner" | "guest" = "owner") {
  await page.goto(`/?role=${role}`);
  await page.goto(`${href}?role=${role}`, { waitUntil: "networkidle" });
  await expect(page.locator("main")).toBeVisible();
}

/** Panel filter H4 tertutup default di mobile (ui-spec 3.H4). */
async function bukaFilterIfMobile(page: Page) {
  const trigger = page.getByTestId("toggle-filter-histori");
  if (await trigger.isVisible()) {
    await trigger.click();
    await expect(page.getByTestId("panel-filter-histori")).toBeVisible();
  }
}

test.describe("isolasi jaringan — tidak ada request eksternal", () => {
  for (const href of HALAMAN) {
    test(`${href} tidak menembak Firestore/Telegram`, async ({ page }) => {
      const eksternal: string[] = [];
      const catat = (req: Request) => {
        if (diFetch(req) && domainTerlarang(req.url())) {
          eksternal.push(`${req.method()} ${req.url()}`);
        }
      };
      page.on("request", catat);

      await buka(page, href);
      // Beri waktu agar efek samping (jika ada) terlihat.
      await page.waitForTimeout(400);

      page.off("request", catat);
      expect(eksternal, `request eksternal pada ${href}`).toEqual([]);
    });
  }

  test("interaksi menulis (dialog Koreksi) tidak menembak jaringan nyata", async ({ page }) => {
    const eksternal: string[] = [];
    page.on("request", (req) => {
      if (diFetch(req) && domainTerlarang(req.url())) eksternal.push(req.url());
    });

    await buka(page, "/stok");
    await page.locator('[data-testid="koreksi-BRG-001"]:visible').first().click();
    const dialog = page.getByTestId("dialog-koreksi");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Jumlah").fill("2");
    await page.getByTestId("submit-koreksi").click();
    await expect(page.getByText("Stok diperbarui")).toBeVisible();
    await page.waitForTimeout(300);

    expect(eksternal).toEqual([]);
  });

  test("pencarian & filter tidak menembak jaringan nyata", async ({ page }) => {
    const eksternal: string[] = [];
    page.on("request", (req) => {
      if (diFetch(req) && domainTerlarang(req.url())) eksternal.push(req.url());
    });

    await buka(page, "/histori");
    await bukaFilterIfMobile(page);
    await page.getByTestId("filter-dari").fill("2026-09-15");
    await page.getByTestId("mode-status").click();
    await page.getByTestId("filter-status").click();
    await page.getByRole("option", { name: "Menunggu konfirmasi", exact: true }).click();
    await page.waitForTimeout(300);

    expect(eksternal).toEqual([]);
  });
});

test.describe("isolasi jaringan — tetap merender saat eksternal diblokir", () => {
  for (const href of HALAMAN) {
    test(`${href} tetap tampil dengan domain eksternal diblokir`, async ({ page }) => {
      const diblokir: string[] = [];
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (domainTerlarang(url) && diFetch(route.request())) {
          diblokir.push(url);
          return route.abort();
        }
        return route.continue();
      });

      await buka(page, href);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("h1")).toBeVisible();
      expect(diblokir, `permintaan eksternal diblokir pada ${href}`).toEqual([]);
    });
  }
});

// Regresi: SDK Telegram WAJIB dimuat di setiap halaman. Tanpa ini window.Telegram.WebApp
// tidak ada dan Mini App selalu menampilkan "Buka dari Telegram" (bug produksi).
test("SDK Telegram dimuat di dokumen", async ({ page }) => {
  await page.goto("/?role=owner");
  const src = await page.locator('script[src*="telegram-web-app"]').count();
  expect(src).toBeGreaterThan(0);
});
