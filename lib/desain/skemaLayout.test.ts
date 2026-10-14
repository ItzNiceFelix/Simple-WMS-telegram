// lib/desain/skemaLayout.test.ts — Uji aturan skema layout (Fase 2/4).
// Yang diuji adalah janji ke pemanggil: validator TIDAK PERNAH melempar, selalu
// mengembalikan layout bersih, dan dokumen template bawaan lolos validatornya sendiri.
// Kalau salah satu janji itu bocor, AI (Fase 4) akan mengirim dokumen setengah bersih
// ke renderer dan kegagalannya baru kelihatan di kanvas pengguna.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FONT_AMAN, MAKS_ELEMEN, MAKS_TEKS, PALET_WARNA, UKURAN_PRESET,
  buatTemplate, daftarTemplate, kePiksel, validasiLayout,
  type ElemenLayout, type LayoutBanner,
} from "./skemaLayout";

const layoutSederhana: LayoutBanner = {
  versi: 1,
  latarBelakang: "#ffffff",
  elemen: [{ id: "t1", jenis: "teks", x: 0.5, y: 0.5, w: 0.4, h: 0.1, teks: "Halo" }],
};

describe("validasiLayout", () => {
  it("menerima layout sederhana dan mengisi default", () => {
    const hasil = validasiLayout(layoutSederhana);
    assert.equal(hasil.ok, true);
    if (!hasil.ok) return;
    const e = hasil.layout.elemen[0];
    assert.equal(e.font, "Arial"); // font tak disebut → Arial, bukan undefined
    assert.equal(e.warna, "#000000");
    assert.equal(e.perataan, "kiri");
    assert.equal(e.opasitas, 1);
    assert.equal(e.tebal, false);
  });

  it("menolak versi salah tanpa melempar", () => {
    for (const versi of [0, 2, "1", undefined, null]) {
      const hasil = validasiLayout({ versi, elemen: [] });
      assert.equal(hasil.ok, false);
    }
  });

  it("menolak elemen yang bukan array", () => {
    for (const elemen of [null, {}, "x", 5, undefined]) {
      const hasil = validasiLayout({ versi: 1, elemen });
      assert.equal(hasil.ok, false);
    }
  });

  it("tidak melempar untuk masukan sampah apa pun", () => {
    const sampah: unknown[] = [null, undefined, 0, -1, 3.14, NaN, "", "teks", [], [1, 2], {}, { versi: 1 }, { elemen: [] }, true];
    for (const s of sampah) {
      const hasil = validasiLayout(s);
      assert.ok(typeof hasil.ok === "boolean");
      if (!hasil.ok) assert.equal(typeof hasil.error, "string");
    }
  });

  it("menjepit koordinat di luar 0..1 dan memperbaiki w/h nol", () => {
    const hasil = validasiLayout({
      versi: 1,
      latarBelakang: "#fff",
      elemen: [{ id: "a", jenis: "persegi", x: -3, y: 9, w: 0, h: -1 }],
    });
    assert.equal(hasil.ok, true);
    if (!hasil.ok) return;
    const e = hasil.layout.elemen[0];
    assert.equal(e.x, 0);
    assert.equal(e.y, 1);
    assert.equal(e.w, 0.01); // bukan 0: elemen nol-lebar tak bisa diklik
    assert.equal(e.h, 0.01);
    assert.equal(hasil.layout.latarBelakang, "#ffffff"); // #fff tidak valid → default
  });

  it("membuang elemen berjenis tak dikenal dan melaporkannya", () => {
    const hasil = validasiLayout({
      versi: 1,
      latarBelakang: "#000000",
      elemen: [
        { id: "ok", jenis: "lingkaran", x: 0, y: 0, w: 0.1, h: 0.1 },
        { id: "x1", jenis: "segitiga", x: 0, y: 0, w: 0.1, h: 0.1 },
        { id: "x2", jenis: undefined, x: 0, y: 0, w: 0.1, h: 0.1 },
        null,
      ],
    });
    assert.equal(hasil.ok, true);
    if (!hasil.ok) return;
    assert.equal(hasil.layout.elemen.length, 1);
    assert.equal(hasil.dibuang, 3);
  });

  it("memotong elemen melebihi batas dan teks melebihi 400 karakter", () => {
    const banyak = Array.from({ length: MAKS_ELEMEN + 5 }, (_, i) => ({
      id: `e${i}`, jenis: "persegi", x: 0, y: 0, w: 0.1, h: 0.1,
    }));
    const hasil = validasiLayout({ versi: 1, latarBelakang: "#000000", elemen: banyak });
    assert.equal(hasil.ok, true);
    if (!hasil.ok) return;
    assert.equal(hasil.layout.elemen.length, MAKS_ELEMEN);

    const panjang = validasiLayout({
      versi: 1,
      latarBelakang: "#000000",
      elemen: [{ id: "t", jenis: "teks", x: 0, y: 0, w: 0.5, h: 0.1, teks: "a".repeat(1000) }],
    });
    assert.equal(panjang.ok, true);
    if (!panjang.ok) return;
    assert.equal(panjang.layout.elemen[0].teks?.length, MAKS_TEKS);
  });

  it("mengganti font asing dengan Arial dan membuat id ganda jadi unik", () => {
    const hasil = validasiLayout({
      versi: 1,
      latarBelakang: "#000000",
      elemen: [
        { id: "sama", jenis: "teks", x: 0, y: 0, w: 0.5, h: 0.1, teks: "a", font: "Comic Sans" },
        { id: "sama", jenis: "teks", x: 0, y: 0.2, w: 0.5, h: 0.1, teks: "b", font: FONT_AMAN[1] },
      ],
    });
    assert.equal(hasil.ok, true);
    if (!hasil.ok) return;
    assert.equal(hasil.layout.elemen[0].font, "Arial");
    assert.equal(hasil.layout.elemen[1].font, FONT_AMAN[1]);
    assert.notEqual(hasil.layout.elemen[0].id, hasil.layout.elemen[1].id);
  });
});

describe("kePiksel", () => {
  it("mengubah koordinat ternormalisasi memakai preset", () => {
    const e: ElemenLayout = { id: "a", jenis: "persegi", x: 0.5, y: 0.25, w: 0.5, h: 0.5 };
    assert.deepEqual(kePiksel(e, "1080x1080"), { left: 540, top: 270, width: 540, height: 540 });
    assert.deepEqual(kePiksel(e, "1200x628"), { left: 600, top: 157, width: 600, height: 314 });
    // Preset tak dikenal → jatuh ke 1080x1080, bukan NaN.
    assert.deepEqual(kePiksel(e, "999x999"), { left: 540, top: 270, width: 540, height: 540 });
  });
});

describe("template", () => {
  it("tiga template bawaan tersedia dengan metadata", () => {
    const daftar = daftarTemplate();
    assert.equal(daftar.length, 3);
    for (const t of daftar) {
      assert.ok(t.label.length > 0);
      assert.ok(t.slot.length > 0);
    }
  });

  it("template lolos validatornya sendiri setelah bolak-balik JSON", () => {
    for (const t of daftarTemplate()) {
      for (const ukuran of Object.keys(UKURAN_PRESET)) {
        const layout = buatTemplate(t.nama, ukuran, {});
        const hasil = validasiLayout(JSON.parse(JSON.stringify(layout)));
        assert.equal(hasil.ok, true, `template ${t.nama} gagal divalidasi`);
        if (!hasil.ok) return;
        assert.equal(hasil.layout.elemen.length, layout.elemen.length);
      }
    }
  });

  it("mengisi slot dan meninggalkan placeholder yang kosong", () => {
    const layout = buatTemplate("promo-diskon", "1080x1080", { diskon: "50%", nama: "Kemeja" });
    const semuaTeks = layout.elemen.map((e) => e.teks ?? "").join("|");
    assert.ok(semuaTeks.includes("50%"));
    assert.ok(semuaTeks.includes("Kemeja"));
    assert.ok(semuaTeks.includes("{{harga}}")); // tidak diisi → teks contoh tetap
  });

  it("skalakan ukuran font mengikuti lebar preset", () => {
    const kecil = buatTemplate("promo-diskon", "1080x1080", {});
    const besar = buatTemplate("promo-diskon", "1200x628", {});
    const font = (l: LayoutBanner) => l.elemen.find((e) => e.id === "judul")?.ukuran ?? 0;
    assert.ok(font(besar) > font(kecil));
  });

  it("nama template tak dikenal jatuh ke template pertama", () => {
    const layout = buatTemplate("tidak-ada", "1080x1080", {});
    const hasil = validasiLayout(layout);
    assert.equal(hasil.ok, true);
    if (!hasil.ok) return;
    assert.ok(hasil.layout.elemen.length > 0);
  });

  it("palet warna seluruhnya hexvalid", () => {
    for (const w of PALET_WARNA) assert.match(w, /^#[0-9a-fA-F]{6}$/);
  });
});
