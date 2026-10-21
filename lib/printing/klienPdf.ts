// lib/printing/klienPdf.ts — Helper pdf.js sisi klien untuk halaman Printing. KLIEN saja.
//
// Worker pdf.js DILAYANI SENDIRI (`public/pdf.worker.min.mjs`): CDN mematikan halaman saat
// offline atau saat CSP memblokir jsdelivr.
import type * as PdfJsModule from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

export type PdfJs = typeof PdfJsModule;

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

let pdfjsSiap: Promise<PdfJs> | null = null;

/** Muat pdf.js sekali per tab. */
export function muatPdfJs(): Promise<PdfJs> {
  if (!pdfjsSiap) {
    pdfjsSiap = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = `${BASE_PATH}/pdf.worker.min.mjs?v=${mod.version}`;
      return mod;
    });
  }
  return pdfjsSiap;
}

/** Buka dokumen lalu tutup lagi: buffer + worker resource tidak bocor. */
export async function denganDokumen<T>(
  pdfjs: PdfJs,
  bytes: Uint8Array,
  pakai: (doc: PDFDocumentProxy) => Promise<T>
): Promise<T> {
  const tugas = pdfjs.getDocument({ data: bytes.slice(0) });
  try {
    return await pakai(await tugas.promise);
  } finally {
    void tugas.destroy();
  }
}

/** Render satu halaman ke canvas baru pada lebar target (px). */
export async function renderHalaman(
  pdfjs: PdfJs,
  doc: PDFDocumentProxy,
  indeks: number,
  lebarPx: number,
  latarPutih = true
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const page = await doc.getPage(indeks + 1);
  const dasar = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: lebarPx / dasar.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas tidak tersedia.");
  if (latarPutih) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  return { canvas, width: dasar.width, height: dasar.height };
}

/** Ubah logo jadi hitam-putih (ambang 160) lalu PNG. */
export async function kePngHitamPutih(f: File): Promise<{ png: Uint8Array; rasio: number }> {
  const bitmap = await createImageBitmap(f);
  const skala = Math.min(1, 400 / bitmap.width);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bitmap.width * skala));
  c.height = Math.max(1, Math.round(bitmap.height * skala));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const g = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
    const b = g < 160 ? 0 : 255;
    d.data[i] = b;
    d.data[i + 1] = b;
    d.data[i + 2] = b;
    d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  const { promise, resolve } = Promise.withResolvers<Blob | null>();
  c.toBlob(resolve, "image/png");
  const blob = await promise;
  if (!blob) throw new Error("Logo gagal diproses.");
  return { png: new Uint8Array(await blob.arrayBuffer()), rasio: c.width / c.height };
}
