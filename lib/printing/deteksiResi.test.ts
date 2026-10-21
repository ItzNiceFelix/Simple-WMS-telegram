// lib/printing/deteksiResi.test.ts — kotak resi dari piksel halaman.
//
// Yang dijaga: halaman berpita frame tebal dipisah jadi kotak resi + daftar produk, halaman
// tanpa frame tidak dipecah, dan watermark abu-abu terang tidak dianggap isi.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AMBANG_KOSONG, INFO_PENUH, deteksiKotakTinta, fraksiTinta } from "./deteksiResi";

/** Kanvas RGBA putih dengan kotak hitam dan garis vertikal. */
function gambar(w: number, h: number, cat: (x: number, y: number, px: (r: number, g: number, b: number) => void) => void) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      d[k] = 255; d[k + 1] = 255; d[k + 2] = 255; d[k + 3] = 255;
      cat(x, y, (r, g, b) => { d[k] = r; d[k + 1] = g; d[k + 2] = b; });
    }
  }
  return d;
}

const hitam = (x: number, y: number, px: (r: number, g: number, b: number) => void) => px(0, 0, 0);

describe("deteksiKotakTinta", () => {
  it("halaman putih: tinta 0, kotak penuh", () => {
    const w = 100;
    const h = 140;
    const r = deteksiKotakTinta(gambar(w, h, () => {}), w, h);
    assert.equal(r.ink, 0);
    assert.deepEqual(r.info, INFO_PENUH);
    assert.ok(r.ink < AMBANG_KOSONG);
  });

  it("halaman kosong di bawah ambang, halaman bertinta di atas", () => {
    const w = 100;
    const h = 140;
    const kosong = deteksiKotakTinta(gambar(w, h, () => {}), w, h);
    const berisi = deteksiKotakTinta(gambar(w, h, (x, y, px) => { if (x < 60 && y < 60) hitam(x, y, px); }), w, h);
    assert.ok(kosong.ink < AMBANG_KOSONG);
    assert.ok(berisi.ink > AMBANG_KOSONG);
  });

  it("frame tebal dipisah jadi kotak resi (H) dan bagian bawah (T)", () => {
    const w = 200;
    const h = 300;
    // Garis vertikal penuh dari y=10 sampai y=200 di x=10 dan x=190, plus isi di atas.
    const d = gambar(w, h, (x, y, px) => {
      const garisTegak = (x === 10 || x === 190) && y >= 10 && y <= 200;
      const garisDatar = (y === 10 || y === 200) && x >= 10 && x <= 190;
      const isiResi = y > 20 && y < 190 && x > 20 && x < 180 && (x + y) % 7 === 0;
      const isiBawah = y > 215 && y < 290 && x > 20 && x < 180 && (x + y) % 5 === 0;
      if (garisTegak || garisDatar || isiResi || isiBawah) hitam(x, y, px);
    });
    const { info } = deteksiKotakTinta(d, w, h);
    assert.ok(info.T, "bagian bawah harus terdeteksi");
    assert.ok(info.H.y1 <= info.T.y0, "H harus berakhir sebelum T mulai");
    assert.ok(info.H.y0 < info.T.y0);
    assert.ok(info.U.y0 <= info.H.y0);
  });

  it("tanpa frame: T null, H = U", () => {
    const w = 200;
    const h = 300;
    const d = gambar(w, h, (x, y, px) => {
      if (y > 20 && y < 280 && x > 20 && x < 180 && (x * y) % 11 === 0) hitam(x, y, px);
    });
    const { info } = deteksiKotakTinta(d, w, h);
    assert.equal(info.T, null);
    assert.deepEqual(info.H, info.U);
  });

  it("watermark abu-abu terang tidak dianggap tinta", () => {
    const w = 100;
    const h = 140;
    const abu = (x: number, y: number, px: (r: number, g: number, b: number) => void) => px(235, 235, 235);
    const r = deteksiKotakTinta(gambar(w, h, abu), w, h);
    assert.equal(r.ink, 0);
    assert.deepEqual(r.info, INFO_PENUH);
  });

  it("ukuran nol tidak melempar", () => {
    const r = deteksiKotakTinta(new Uint8ClampedArray(0), 0, 0);
    assert.equal(r.ink, 0);
    assert.deepEqual(r.info, INFO_PENUH);
  });

  it("fraksiTinta: putih = 0, satu garis tipis > ambang kosong", () => {
    const w = 150;
    const h = 200;
    assert.equal(fraksiTinta(gambar(w, h, () => {}), w, h), 0);
    // Satu baris teks tipis (1 px abu) masih harus melewati ambang "kosong".
    const tipis = gambar(w, h, (x, y, px) => { if (y === 100 && x > 10 && x < 140 && x % 3 !== 0) px(90, 90, 90); });
    const f = fraksiTinta(tipis, w, h);
    assert.ok(f > AMBANG_KOSONG, `fraksi ${f} harus > ${AMBANG_KOSONG}`);
  });

  it("fraksiTinta: ukuran nol tidak membagi nol", () => {
    assert.equal(fraksiTinta(new Uint8ClampedArray(0), 0, 0), 0);
  });
});
