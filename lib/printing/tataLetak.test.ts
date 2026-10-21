// lib/printing/tataLetak.test.ts — rencana satu vs dua lembar.
//
// Yang dijaga: resi normal tetap satu lembar (tidak dipecah tanpa alasan), resi panjang
// dipecah hanya bila pengecilannya melewati ambang, dan sambungan tidak pernah keluar dari
// tinggi lembar.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { INFO_PENUH, type InfoResi } from "./deteksiResi";
import { rencanaHalaman, type OpsiRencana } from "./tataLetak";

const W = 283.46;
const H = 425.2;

const opsi = (ubah: Partial<OpsiRencana> = {}): OpsiRencana => ({
  tinggiMm: 150,
  cropMm: 0,
  resi: { x: 0, y: 0, w: 100, h: 130 },
  mode: "auto",
  ambangPecah: 0.85,
  ...ubah,
});

describe("rencanaHalaman", () => {
  it("tanpa info: satu lembar, seluruh halaman", () => {
    const r = rencanaHalaman(null, W, H, opsi());
    assert.equal(r.pecah, false);
    assert.equal(r.parts.length, 1);
    assert.equal(r.parts[0].pg, 0);
    assert.equal(r.parts[0].x0, 0);
    assert.equal(r.parts[0].y1, H);
    assert.ok(r.parts[0].dw <= 100 + 1e-9);
    assert.ok(r.parts[0].dh <= 130 + 1e-9);
  });

  it("resi normal (T null) tetap satu lembar walau mode auto", () => {
    const info: InfoResi = { ...INFO_PENUH, T: null };
    const r = rencanaHalaman(info, W, H, opsi());
    assert.equal(r.pecah, false);
  });

  it("resi panjang melewati ambang → dua lembar, sambungan mulai dari kotak resi", () => {
    const info: InfoResi = {
      U: { x0: 0.05, y0: 0.02, x1: 0.95, y1: 0.98 },
      H: { x0: 0.05, y0: 0.02, x1: 0.95, y1: 0.35 },
      T: { x0: 0.05, y0: 0.36, x1: 0.95, y1: 0.98 },
    };
    const r = rencanaHalaman(info, W, H, opsi());
    assert.equal(r.pecah, true);
    assert.equal(r.parts.length, 2);
    assert.equal(r.parts[0].pg, 0);
    assert.equal(r.parts[1].pg, 1);
    assert.ok(r.parts[1].dy >= 0);
    assert.ok(r.parts[1].dy + r.parts[1].dh <= 150);
    assert.ok(r.parts[1].dw <= 100 + 1e-9);
  });

  it("mode kecil: tidak pernah memecah", () => {
    const info: InfoResi = {
      U: { x0: 0.05, y0: 0.02, x1: 0.95, y1: 0.98 },
      H: { x0: 0.05, y0: 0.02, x1: 0.95, y1: 0.1 },
      T: { x0: 0.05, y0: 0.11, x1: 0.95, y1: 0.98 },
    };
    const r = rencanaHalaman(info, W, H, opsi({ mode: "kecil" }));
    assert.equal(r.pecah, false);
    assert.equal(r.parts.length, 1);
  });

  it("ambang rendah: resi pendek pun tidak dipecah", () => {
    const info: InfoResi = {
      U: { x0: 0.05, y0: 0.02, x1: 0.95, y1: 0.98 },
      H: { x0: 0.05, y0: 0.02, x1: 0.95, y1: 0.9 },
      T: { x0: 0.05, y0: 0.91, x1: 0.95, y1: 0.98 },
    };
    const r = rencanaHalaman(info, W, H, opsi({ ambangPecah: 0.1 }));
    assert.equal(r.pecah, false);
  });

  it("crop bawah memperpendek potongan yang ditempel", () => {
    const tanpa = rencanaHalaman(INFO_PENUH, W, H, opsi());
    const potong = rencanaHalaman(INFO_PENUH, W, H, opsi({ cropMm: 20 }));
    assert.ok(potong.parts[0].y1 < tanpa.parts[0].y1);
    // Tinggi tempel tidak pernah melebihi kotak resi, dan tidak membesar karena crop.
    assert.ok(potong.parts[0].dh <= 130 + 1e-9);
    assert.ok(potong.parts[0].dh <= tanpa.parts[0].dh + 1e-9);
  });

  it("crop tidak pernah memakan lebih dari tinggi halaman - 40 pt", () => {
    const r = rencanaHalaman(INFO_PENUH, W, H, opsi({ cropMm: 1000 }));
    assert.ok(r.parts[0].y1 - r.parts[0].y0 >= 20);
  });
});
