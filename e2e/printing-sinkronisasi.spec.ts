// e2e/printing-sinkronisasi.spec.ts — Cetak resi (mock) + halaman Sinkronisasi.
//
// Yang dijaga di sini adalah tiga kerusakan yang pernah terjadi dan tidak terlihat dari
// kode: daftar toko kosong karena salah kunci JSON, pemicu Select yang tidak bisa dibuka,
// dan skeleton riwayat yang tidak pernah selesai. Dialign ke perilaku yang terlihat user.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * PDF uji 3 halaman: 1 penuh teks, 2 KOSONG, 3 tipis. Halaman 2 sengaja kosong supaya
 * deteksi "terlihat kosong" punya sesuatu untuk ditandai. Dibuat di dalam tes (bukan berkas
 * fixture) agar spec tetap jalan walau berkas sementara dibersihkan.
 */
async function pdfUji(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const isi = [
    "No. Pesanan: 261014JEHUR52M  No. Resi: SPXID06668320437A",
    "",
    "Penerima: Budi",
  ];
  for (const teks of isi) {
    const p = d.addPage([283.46, 425.2]);
    p.drawRectangle({ x: 0, y: 0, width: 283.46, height: 425.2, color: rgb(1, 1, 1) });
    if (teks) p.drawText(teks, { x: 14, y: 300, size: 9, font: f });
  }
  return Buffer.from(await d.save());
}

const PRESETS = {
  ok: true,
  presets: [
    { id: 1, nama: "Shopee Utama", status_toko: "non_star" },
    { id: 2, nama: "Toko Kedua", status_toko: "star" },
  ],
};

const LOG = {
  ok: true,
  perJenis: {
    order: [{ jenis: "order", file: "Order.all.xlsx", baris: 12, gagal: 0, ringkas: "2 potong", at: 1760700000, oleh: "1" }],
    laba: [],
    performa: [],
    iklan: [],
  },
};

async function pilihDariSelect(page: Page, testid: string, label: string) {
  await page.getByTestId(testid).click();
  await page.getByRole("option", { name: label }).click();
}

test("printing: daftar toko termuat, pemicu bisa dibuka, tombol cetak membuka dialog print", async ({ page }) => {
  await page.route("**/api/preset", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRESETS) });
  });
  await page.route("**/api/printing?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: {} }) });
  });
  // Dialog cetak tidak boleh benar-benar membuka jendela printer.
  await page.addInitScript(() => {
    (window as unknown as { print: () => void }).print = () => {
      (window as unknown as { __dicetak?: number }).__dicetak = ((window as unknown as { __dicetak?: number }).__dicetak ?? 0) + 1;
    };
  });

  await page.goto("/printing?role=owner");
  await expect(page.getByTestId("printing-preset")).toContainText("Shopee Utama");
  await pilihDariSelect(page, "printing-preset", "Toko Kedua");
  await expect(page.getByTestId("printing-preset")).toContainText("Toko Kedua");
  await expect(page.getByTestId("nama-toko-wm")).toHaveValue("Toko Kedua");

  // Ikon preset tampil sebagai gambar, bukan kotak kosong.
  await expect(page.getByTestId("preset-fragile").locator("img")).toBeVisible();

  // Tanpa berkas: tidak ada yang dicetak.
  await expect(page.getByTestId("tombol-cetak")).toBeDisabled();

  await page.getByTestId("berkas-resi").setInputFiles({ name: "resi-uji.pdf", mimeType: "application/pdf", buffer: await pdfUji() });
  await expect(page.getByTestId("daftar-berkas")).toContainText("resi-uji.pdf");
  await expect(page.getByTestId("pratinjau-resi")).toBeVisible();
  // Berkas masuk → tombol aktif tanpa perlu memilih toko lagi.
  await expect(page.getByTestId("tombol-cetak")).toBeEnabled();

  await page.getByTestId("preset-cod").click();
  await expect(page.getByTestId("posisi-watermark")).toContainText("Cap tengah");

  // Halaman: halaman 2 kosong harus DITANDAI tapi TIDAK dihapus otomatis.
  await page.getByTestId("buka-halaman-0").click();
  await expect(page.getByTestId("halaman-1")).toBeVisible();
  await expect(page.getByTestId("halaman-3")).toBeVisible();
  await expect(page.getByTestId("saran-kosong-2")).toBeVisible();
  await expect(page.getByTestId("saran-kosong-1")).toHaveCount(0);
  await expect(page.getByTestId("cetak-halaman-2")).toBeChecked();
  await expect(page.getByTestId("jumlah-cetak")).toContainText("3 halaman");

  // Lepas centang halaman 2 → halaman itu tidak ikut dicetak, halaman 3 tetap.
  await page.getByTestId("cetak-halaman-2").uncheck();
  await expect(page.getByTestId("halaman-2")).toContainText("TIDAK DICETAK");
  await expect(page.getByTestId("jumlah-cetak")).toContainText("2 halaman");
  await expect(page.getByTestId("pratinjau-resi")).toBeVisible();

  await page.getByTestId("tombol-cetak").click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __dicetak?: number }).__dicetak ?? 0)).toBeGreaterThan(0);
  await expect(page.locator("#area-cetak-printing img")).toHaveCount(2);
});

test("sinkronisasi: daftar toko termuat, riwayat selesai dimuat, ganti toko memicu muat ulang", async ({ page }) => {
  let diminta: string[] = [];
  await page.route("**/api/preset", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRESETS) });
  });
  await page.route("**/api/sinkronisasi?*", async (route) => {
    diminta.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LOG) });
  });

  await page.goto("/sinkronisasi?role=owner");
  await expect(page.getByTestId("sinkron-preset")).toContainText("Shopee Utama");
  await expect(page.getByTestId("terakhir-order")).toContainText("Order.all.xlsx");
  await expect(page.getByTestId("kosong-laba")).toBeVisible();
  // Bukan skeleton lagi: tidak ada lagi kerangka memuat di kartu mana pun.
  await expect(page.locator("[data-testid='kartu-sinkron'] [data-slot='skeleton']")).toHaveCount(0);

  await pilihDariSelect(page, "sinkron-preset", "Toko Kedua");
  await expect.poll(() => diminta.some((u) => u.includes("presetId=2"))).toBe(true);
});
