// lib/analisa/ringkas-gagal.test.ts — Bukti bahwa daftar percobaan panjang benar-benar diringkas.
//
// Kasus nyata dari produksi: 1 model lambat timeout, lalu 22 model kenari + 46 model gemini
// "dilewati: anggaran total 100000ms habis" (semuanya digantikan 68 baris identik), plus
// provider groq tanpa kredensial. Yang diuji: baris yang AMAN ditampilkan tidak lagi membanjiri.
//
// Jalankan: npx esbuild lib/analisa/ringkas-gagal.test.ts --bundle --platform=node --format=esm \
//   --outfile=.tmp-ringkas.test.mjs && node --test .tmp-ringkas.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { NYATA_TAMPIL, ringkasGagal, saranGagal, type Upaya } from "./ringkas-gagal";

const upayaProduksi: Upaya[] = [
  { provider: "groq", model: "-", error: "tidak ada kredensial aktif" },
  { provider: "kenari", model: "solar-mini4:free", error: "Timeout provider setelah 60000ms" },
  ...Array.from({ length: 22 }, (_, i) => ({
    provider: "kenari",
    model: `kenari-model-${i}`,
    error: "dilewati: anggaran total 100000ms habis",
  })),
  ...Array.from({ length: 46 }, (_, i) => ({
    provider: "gemini",
    model: `gemini-2.5-${i}`,
    error: "dilewati: anggaran total 100000ms habis",
  })),
];

test("dilewati dikelompokkan per provider, bukan puluhan baris", () => {
  const r = ringkasGagal(upayaProduksi);
  assert.equal(r.dilewati.length, 2);
  assert.deepEqual(
    r.dilewati.map((g) => [g.provider, g.jumlah]),
    [["kenari", 22], ["gemini", 46]]
  );
  assert.equal(r.jumlahDilewati, 68);
  // Angka anggaran yang sama di semua baris dibuang dari ringkasan.
  assert.equal(r.dilewati[0].alasan.includes("100000ms"), false);
  // Baris yang ditampilkan apa adanya = percobaan nyata saja.
  assert.equal(r.nyata.length, 1);
  assert.equal(r.nyata[0].model, "solar-mini4:free");
  assert.ok(NYATA_TAMPIL >= 1);
});

test("provider tanpa kredensial tidak dihitung sebagai percobaan nyata", () => {
  const r = ringkasGagal(upayaProduksi);
  assert.deepEqual(r.tanpaKredensial, ["groq"]);
  const saran = saranGagal(r);
  assert.equal(saran[0].includes("groq"), true);
  assert.equal(saran[0].includes("Kredensial Provider"), true);
});

test("semua timeout -> sarankan turunkan reasoning + hindari model :free", () => {
  const r = ringkasGagal([
    { provider: "kenari", model: "a:free", error: "Timeout provider setelah 60000ms" },
    { provider: "kenari", model: "b:free", error: "Timeout provider setelah 60000ms" },
  ]);
  assert.equal(r.semuaTimeout, true);
  const saran = saranGagal(r).join(" ");
  assert.equal(/reasoning/i.test(saran), true);
  assert.equal(saran.includes(":free"), true);
});

test("tanpa dilewati dan tanpa kredensial hilang -> tidak ada saran palsu", () => {
  const r = ringkasGagal([{ provider: "kenari", model: "x", error: "HTTP 500 dari provider" }]);
  assert.equal(r.semuaTimeout, false);
  assert.equal(r.jumlahDilewati, 0);
  assert.deepEqual(r.tanpaKredensial, []);
  assert.deepEqual(saranGagal(r), []);
});

test("alasan dilewati yang berbeda tetap dipertahankan apa adanya", () => {
  const r = ringkasGagal([
    { provider: "kenari", model: "a", error: "dilewati: anggaran total 100000ms habis" },
    { provider: "kenari", model: "b", error: "dilewati: kuota harian habis" },
  ]);
  assert.equal(r.dilewati.length, 1);
  assert.equal(r.dilewati[0].jumlah, 2);
  assert.equal(r.dilewati[0].alasan, "anggaran total 100000ms habis");
});
