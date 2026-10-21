// e2e/printing-studio.spec.ts — Studio Printing (halaman `/printing`).
//
// Yang dijaga adalah perilaku yang TIDAK terlihat dari kode: deteksi kotak resi memisahkan
// resi panjang jadi 2 lembar, tabel qty terbaca dari teks PDF (bukan dari sistem), penanda
// qty mengubah jumlah gambar di PDF, dan urutan cetak benar-benar mengubah urutan halaman.
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

declare global {
  interface Window {
    /** Penghitung stub `window.print()` yang dipasang `addInitScript`. */
    __dicetak?: number;
  }
}

/**
 * PDF 2 halaman:
 *   hlm 1 — resi normal dengan tabel produk (2 baris, qty 2 dan 1)
 *   hlm 2 — KOSONG (untuk deteksi halaman kosong)
 * Tabel digambar dengan posisi kolom yang sama seperti label Shopee supaya `bacaQtyHalaman`
 * punya sesuatu yang realistis untuk dibaca.
 */
async function pdfResi(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([283.46, 425.2]);
  p.drawText("No. Pesanan: 261017T83MDDK4", { x: 20, y: 400, size: 10, font: f });
  p.drawText("Resi: SPXID06668320437A", { x: 20, y: 385, size: 10, font: f });
  p.drawLine({ start: { x: 15, y: 370 }, end: { x: 268, y: 370 }, thickness: 2, color: rgb(0, 0, 0) });
  p.drawLine({ start: { x: 15, y: 130 }, end: { x: 268, y: 130 }, thickness: 2, color: rgb(0, 0, 0) });
  p.drawLine({ start: { x: 15, y: 130 }, end: { x: 15, y: 370 }, thickness: 2, color: rgb(0, 0, 0) });
  p.drawLine({ start: { x: 268, y: 130 }, end: { x: 268, y: 370 }, thickness: 2, color: rgb(0, 0, 0) });
  // Header tabel
  p.drawText("Nama Produk", { x: 20, y: 115, size: 8, font: f });
  p.drawText("SKU", { x: 120, y: 115, size: 8, font: f });
  p.drawText("Variasi", { x: 175, y: 115, size: 8, font: f });
  p.drawText("Qty", { x: 245, y: 115, size: 8, font: f });
  p.drawText("Kaos", { x: 20, y: 100, size: 8, font: f });
  p.drawText("SKU-B", { x: 120, y: 100, size: 8, font: f });
  p.drawText("Merah", { x: 175, y: 100, size: 8, font: f });
  p.drawText("2", { x: 247, y: 100, size: 8, font: f });
  p.drawText("Tas", { x: 20, y: 85, size: 8, font: f });
  p.drawText("SKU-A", { x: 120, y: 85, size: 8, font: f });
  p.drawText("Hitam", { x: 175, y: 85, size: 8, font: f });
  p.drawText("1", { x: 247, y: 85, size: 8, font: f });
  d.addPage([283.46, 425.2]);
  return Buffer.from(await d.save());
}

/** PDF 1 halaman dengan satu baris tabel (SKU tertentu) — untuk uji urutan lintas berkas. */
async function pdfSatuHalaman(sku: string, no: string): Promise<Buffer> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([283.46, 425.2]);
  p.drawText(`No. Pesanan: ${no}`, { x: 20, y: 400, size: 10, font: f });
  p.drawText("Nama Produk", { x: 20, y: 300, size: 8, font: f });
  p.drawText("SKU", { x: 120, y: 300, size: 8, font: f });
  p.drawText("Qty", { x: 245, y: 300, size: 8, font: f });
  p.drawText("Produk", { x: 20, y: 285, size: 8, font: f });
  p.drawText(sku, { x: 120, y: 285, size: 8, font: f });
  p.drawText("1", { x: 247, y: 285, size: 8, font: f });
  return Buffer.from(await d.save());
}

/** PDF 2 halaman resi normal (tanpa tabel qty) — untuk uji urutan & sort. */
async function pdfDuaResi(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const no of ["261017TAAA1111", "261017TBBB2222"]) {
    const p = d.addPage([283.46, 425.2]);
    p.drawText(`No. Pesanan: ${no}`, { x: 20, y: 380, size: 10, font: f });
  }
  return Buffer.from(await d.save());
}

async function siapkan(page: Page) {
  await page.route("**/api/preset", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, presets: [{ id: 1, nama: "Shopee Utama", status_toko: "non_star" }] }),
    });
  });
  await page.route("**/api/printing?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: {} }) });
  });
  // Dialog cetak tidak boleh benar-benar membuka jendela printer.
  await page.addInitScript(() => {
    // Stub dialog print; penghitung disimpan di window agar bisa diperiksa tes.
    Object.assign(window, { __dicetak: 0, print: () => { Object.assign(window, { __dicetak: (window.__dicetak ?? 0) + 1 }); } });
  });
  await page.goto("/printing?role=owner");
}

test("studio: template, deteksi kosong, dan tabel qty terbaca", async ({ page }) => {
  await siapkan(page);

  await expect(page.getByTestId("printing-preset")).toContainText("Shopee Utama");
  await expect(page.getByTestId("daftar-template").getByRole("button")).toHaveCount(4);
  await expect(page.getByTestId("kanvas-posisi")).toBeVisible();
  await expect(page.getByTestId("tombol-cetak")).toBeDisabled();

  await page.getByTestId("berkas-resi").setInputFiles({ name: "resi-uji.pdf", mimeType: "application/pdf", buffer: await pdfResi() });
  await expect(page.getByTestId("daftar-berkas")).toContainText("resi-uji.pdf");
  await expect(page.getByTestId("daftar-berkas")).toContainText("261017T83MDDK4");

  // Halaman 2 kosong → langsung dilewati.
  await expect(page.getByTestId("halaman-2")).toContainText("kosong");
  await expect(page.getByTestId("halaman-2")).toContainText("lewati");

  // Tabel qty terbaca dari teks PDF: total 3, dan halaman bertanda qty > 1.
  await expect(page.getByTestId("halaman-1")).toContainText("qty 3");
  await expect(page.getByTestId("jumlah-cetak")).toContainText("1 dicetak");
  await expect(page.getByTestId("jumlah-cetak")).toContainText("qty lebih dari 1");
  await expect(page.getByTestId("tombol-cetak")).toContainText("Cetak 1 resi");
});

test("studio: klik halaman membalik lewati, ringkasan ikut berubah", async ({ page }) => {
  await siapkan(page);
  await page.getByTestId("berkas-resi").setInputFiles({ name: "resi-uji.pdf", mimeType: "application/pdf", buffer: await pdfResi() });
  await expect(page.getByTestId("tombol-cetak")).toContainText("Cetak 1 resi");

  await page.getByTestId("halaman-2").click();
  await expect(page.getByTestId("halaman-2")).not.toContainText("lewati");
  await expect(page.getByTestId("tombol-cetak")).toContainText("Cetak 2 resi");

  await page.getByTestId("lewati-kosong").click();
  await expect(page.getByTestId("tombol-cetak")).toContainText("Cetak 1 resi");
});

test("studio: filter hanya kosong dan hanya qty > 1", async ({ page }) => {
  await siapkan(page);
  await page.getByTestId("berkas-resi").setInputFiles({ name: "resi-uji.pdf", mimeType: "application/pdf", buffer: await pdfResi() });
  await expect(page.getByTestId("halaman-1")).toBeVisible();

  await page.getByTestId("hanya-kosong").click();
  await expect(page.getByTestId("halaman-1")).toHaveCount(0);
  await expect(page.getByTestId("halaman-2")).toBeVisible();
  await page.getByTestId("hanya-kosong").click();

  await page.getByTestId("hanya-qty").click();
  await expect(page.getByTestId("halaman-1")).toBeVisible();
  await expect(page.getByTestId("halaman-2")).toHaveCount(0);
});

test("studio: penanda qty mengubah hasil PDF, mode mati tidak", async ({ page }) => {
  await siapkan(page);
  await page.getByTestId("berkas-resi").setInputFiles({ name: "resi-uji.pdf", mimeType: "application/pdf", buffer: await pdfResi() });
  await expect(page.getByTestId("tombol-cetak")).toContainText("Cetak 1 resi");

  // Penanda menambah gambar; ukuran gambar kanvas pratinjau harus tetap ada.
  await expect(page.getByTestId("kanvas-posisi")).toBeVisible();
  const kanvas = page.getByTestId("kanvas-posisi");
  const sebelum = await kanvas.screenshot();
  await page.getByTestId("gaya-qty").click();
  await page.getByRole("option", { name: "Lingkaran pada N" }).click();
  await expect.poll(async () => (await kanvas.screenshot()).equals(sebelum)).toBe(false);
});

test("studio: urutan cetak menampilkan nomor urut dan header grup", async ({ page }) => {
  await siapkan(page);
  await page.getByTestId("berkas-resi").setInputFiles({ name: "dua.pdf", mimeType: "application/pdf", buffer: await pdfDuaResi() });
  await expect(page.getByTestId("halaman-1")).toBeVisible();

  // Mode off: tanpa nomor urut.
  await expect(page.getByTestId("halaman-1")).not.toContainText("#1 ·");

  await page.getByTestId("urutan-cetak").click();
  await page.getByRole("option", { name: /3\. Qty 1 dulu/ }).click();
  await expect(page.getByTestId("daftar-halaman")).toContainText("#1 · F1 · Hlm 1");
  // Tanpa tabel qty → grup "tidak terbaca".
  await expect(page.getByTestId("daftar-halaman")).toContainText("Tidak terbaca");
});

test("studio: urutan cetak lintas berkas benar-benar mengubah urutan lembar", async ({ page }) => {
  await siapkan(page);
  // Dua berkas terpisah: sort SKU harus mencampur halamannya, bukan mengelompokkan per berkas.
  await page.getByTestId("berkas-resi").setInputFiles([
    { name: "b.pdf", mimeType: "application/pdf", buffer: await pdfSatuHalaman("SKU-Z", "261017TZZZ0001") },
    { name: "a.pdf", mimeType: "application/pdf", buffer: await pdfSatuHalaman("SKU-A", "261017TAAA0001") },
  ]);
  await expect(page.getByTestId("halaman-1")).toHaveCount(2);
  await expect(page.getByTestId("tombol-cetak")).toContainText("Cetak 2 resi");

  // Asal tiap lembar dibaca dari atribut yang dipasang `cetak()` — hash piksel tidak stabil
  // antar render sehingga tidak bisa dipakai membandingkan urutan.
  const asal = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>("#area-cetak-printing img")].map(
        (img) => `${img.dataset.berkas}#${img.dataset.halaman}`
      )
    );

  const cetak = async () => {
    await page.getByTestId("tombol-cetak").click();
    await expect(page.locator("#area-cetak-printing img")).toHaveCount(2);
    return asal();
  };

  const asli = await cetak();
  expect(asli).toEqual(["b.pdf#1", "a.pdf#1"]);

  await page.getByTestId("urutan-cetak").click();
  await page.getByRole("option", { name: /1\. SKU/ }).click();
  await expect(page.getByTestId("daftar-halaman")).toContainText("#1 · F2 · Hlm 1");
  const urut = await cetak();
  expect(urut).toEqual(["a.pdf#1", "b.pdf#1"]);
});

test("studio: tombol cetak memanggil dialog print dan mencatat cetak", async ({ page }) => {
  let dicatat = 0;
  await page.route("**/api/preset", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, presets: [{ id: 1, nama: "Shopee Utama", status_toko: "non_star" }] }),
    });
  });
  await page.route("**/api/printing", async (route) => {
    dicatat += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: {} }) });
  });
  await page.addInitScript(() => {
    Object.assign(window, {
      __dicetak: 0,
      print: () => {
        Object.assign(window, { __dicetak: (window.__dicetak ?? 0) + 1 });
        window.dispatchEvent(new Event("afterprint"));
      },
    });
  });
  await page.goto("/printing?role=owner");

  await page.getByTestId("berkas-resi").setInputFiles({ name: "resi-uji.pdf", mimeType: "application/pdf", buffer: await pdfResi() });
  await expect(page.getByTestId("tombol-cetak")).toContainText("Cetak 1 resi");
  await page.getByTestId("tombol-cetak").click();

  await expect.poll(async () => page.evaluate(() => window.__dicetak ?? 0)).toBe(1);
  await expect.poll(() => dicatat).toBeGreaterThan(0);
});
