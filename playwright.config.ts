import { defineConfig, devices } from "@playwright/test";

// Playwright SELALU mode MOCK (PRD I2). Tidak boleh menembak Firestore/Telegram nyata.
//
// Efisiensi (audit-e2e.md): 3 project blanket x 150 spec = 450 eksekusi (~617s) terlalu
// berat. Sekarang: mayoritas spec hanya jalan di "desktop"; spec layout-sensitif jalan di
// "desktop-viewport" + "mobile". Project "tablet" dibuang, digantikan 1 test batas 768px.
//
// Gate cepat harian: npm run e2e:fast  (~155s)
// Gate penuh sebelum rilis: npm run e2e:full  (~205s)

/** Spec yang perlu diuji lintas viewport (layout/overflow/breakpoint). */
const LAYOUT_SENSITIVE = [
  "**/responsif.spec.ts",
  "**/stok.spec.ts",
  "**/tambah-produk.spec.ts",
  "**/histori.spec.ts",
  "**/kata-kunci.spec.ts",
];

/** Semua spec kecuali yang layout-sensitif. */
const DESKTOP_ONLY = ["**/*.spec.ts", ...LAYOUT_SENSITIVE.map((p) => "!" + p)];

export default defineConfig({
  testDir: "./e2e",
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  // Reporter html hanya saat CI (menambah waktu + artifact di lokal).
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : [["line"]],
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      testMatch: DESKTOP_ONLY,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "desktop-viewport",
      testMatch: LAYOUT_SENSITIVE,
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "mobile",
      testMatch: LAYOUT_SENSITIVE,
      use: { ...devices["Mobile Chrome"], viewport: { width: 360, height: 640 } },
    },
  ],
  webServer: {
    command: "npx next start -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      NEXT_PUBLIC_DASHBOARD_DATA: "mock",
      NEXT_PUBLIC_MOCK_DELAY: "0",
    },
  },
});
