// lib/printing/ekstraksi.test.ts — uji pembacaan nomor dari TEKS label.
//
// Fixture = potongan teks yang BENAR-BENAR diekstrak dari sampel di C:\Users\Hanaa\Documents\Printing
// (spx 1.pdf, JNE.pdf, anteraja.pdf, instant.pdf). Teks PDF menyisipkan spasi aneh
// ("T ap", "No.Pesanan") — itu yang diuji, bukan teks yang sudah dirapikan.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bacaNomorDariHalaman, bacaNomorLabel } from "./ekstraksi";

describe("bacaNomorLabel", () => {
  it("SPX: nomor resi dari label 'Resi:' dan nomor pesanan dari 'No.Pesanan'", () => {
    const teks =
      "Resi: SPXID06668320437A tokohanaa SPXID06668320437A Penerima: 6285183053714 " +
      "Pesan: (261017T83MDDK4) TLH-B-11 No.Pesanan: 261017T83MDDK4 COD Cek Dulu: T idak";
    assert.deepEqual(bacaNomorLabel(teks), {
      noPesanan: "261017T83MDDK4",
      noResi: "SPXID06668320437A",
      marketplace: "shopee",
    });
  });

  it("JNE: nomor resi 'CM' dibaca dari label 'No. Resi:'", () => {
    const teks = "No. Pesanan: 261017TD3VCXWC Penerima: tokohanaa No. Resi: CM03230749348 Reguler";
    assert.deepEqual(bacaNomorLabel(teks), {
      noPesanan: "261017TD3VCXWC",
      noResi: "CM03230749348",
      marketplace: "shopee",
    });
  });

  it("Anteraja: resi 14 digit, bukan nomor telepon penerima", () => {
    const teks =
      "No. Pesanan: 261017T57GNRS1 11004533974115 Penerima: 11004533974115 tokohanaa 6285183053714 " +
      "No. Resi: 11004533974115";
    const h = bacaNomorLabel(teks);
    assert.equal(h.noPesanan, "261017T57GNRS1");
    assert.equal(h.noResi, "11004533974115");
  });

  it("Instant: tanpa baris resi → noResi null, bukan angka acak", () => {
    const teks =
      "SAMEDA Y INST ANT 80053 / No. Pesanan: 261017TKEXPD8F Kode Pengambilan: 7NEY " +
      "Penerima: 6285188664402 800 gr COD Cek Dulu: T idak";
    const h = bacaNomorLabel(teks);
    assert.equal(h.noPesanan, "261017TKEXPD8F");
    assert.equal(h.noResi, null);
  });

  it("halaman tanpa teks (PDF gambar) → semua null, tidak mengarang", () => {
    assert.deepEqual(bacaNomorLabel(""), { noPesanan: null, noResi: null, marketplace: null });
  });

  it("label TikTok dikenali sebagai tiktok tanpa memaksa pola resi", () => {
    const h = bacaNomorLabel("TikTok Shop No. Pesanan: 58392100445511");
    assert.equal(h.marketplace, "tiktok");
    assert.equal(h.noPesanan, "58392100445511");
  });
});

describe("bacaNomorDariHalaman", () => {
  it("halaman pertama yang memuat nomor menang; halaman lanjutan tidak menimpanya", () => {
    const h = bacaNomorDariHalaman([
      "No. Resi: SPXID06668320437A No.Pesanan: 261017T83MDDK4",
      "Lanjutan item tanpa nomor sama sekali",
    ]);
    assert.equal(h.noPesanan, "261017T83MDDK4");
    assert.equal(h.noResi, "SPXID06668320437A");
  });

  it("semua halaman tanpa nomor → null (label tetap boleh dicetak)", () => {
    assert.deepEqual(bacaNomorDariHalaman(["x", "y"]), { noPesanan: null, noResi: null, marketplace: null });
  });
});
