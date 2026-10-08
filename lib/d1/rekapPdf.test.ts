// lib/d1/rekapPdf.test.ts — node:test untuk builder PDF rekap (Fase 3a, Task 8).
// Pure module (tanpa D1) → bundle esbuild langsung, pola notify.test.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bangunPdfRekap, type AgregatRekapPdf } from "./rekapPdf";

const KOSONG: AgregatRekapPdf = { order: 0, omzet: 0, hpp: 0, biaya: 0, pph: 0, ppn: 0, laba: 0 };

describe("bangunPdfRekap", () => {
  it("tanpa pesanan → PDF valid diawali %PDF dan diakhiri %%EOF", async () => {
    const bytes = await bangunPdfRekap([], KOSONG);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
    assert.equal(new TextDecoder().decode(bytes.slice(-6)).trim(), "%%EOF");
  });

  it("2 baris + agregat → bytes > 1000 dan header dokumen utuh", async () => {
    const bytes = await bangunPdfRekap(
      [
        { no_pesanan: "SHP-1", marketplace: "shopee", omzet: 200000, hpp: 120000, biaya: 8000, pph: 1000, ppn: 0, laba: 71000 },
        { no_pesanan: "TKP-9", marketplace: "tokopedia", omzet: 50000, hpp: 30000, biaya: 500, pph: 250, ppn: 0, laba: 19250 },
      ],
      { order: 2, omzet: 250000, hpp: 150000, biaya: 8500, pph: 1250, ppn: 0, laba: 90250 }
    );
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
    assert.ok(bytes.byteLength > 1000, `bytes ${bytes.byteLength} harus > 1000`);
  });

  it("angka ter-format ribuan + nilai besar tetap menghasilkan struktur PDF sehat", async () => {
    const bytes = await bangunPdfRekap(
      [{ no_pesanan: "X".repeat(40), marketplace: "shopee", omzet: 1234567890, hpp: 987654321, biaya: 12345, pph: 6172839, ppn: 135802469, laba: 123000000 }],
      { order: 1, omzet: 1234567890, hpp: 987654321, biaya: 12345, pph: 6172839, ppn: 135802469, laba: 123000000 }
    );
    const teks = new TextDecoder("latin1").decode(bytes);
    assert.equal(teks.slice(0, 5), "%PDF-");
    // pdf-lib menulis objek dalam object stream terkompresi → cek katalog + trailer.
    assert.match(teks, /\/Root \d+ 0 R/);
    assert.match(teks, /startxref/);
    assert.equal(teks.slice(-6).trim(), "%%EOF");
  });
});
