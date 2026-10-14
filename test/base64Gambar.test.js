// test/base64Gambar.test.js
// Regresi bug CPU: konversi base64 gambar dulu loop PER BYTE, di jalur yang dipanggil
// tiap gambar dari provider OpenAI-compatible (termasuk Kenari).
//
// Kenapa ini penting: Workers Free hanya 10 ms CPU per request. Terukur pada Node 22
// (500 KB x 30 putaran, semua hasil identik):
//   per byte + btoa ............ 654 ms
//   potongan 8192 + spread ..... 677 ms   ← menggoda tapi LEBIH LAMBAT
//   Buffer.toString("base64") .... 24 ms   ← dipakai sekarang (~28x)
//
// Yang dikunci uji ini: hasil Buffer HARUS byte-identik dengan cara lama untuk semua
// ukuran (termasuk 0, 1, dan tepat di batas potongan) dan semua nilai byte (termasuk 0
// dan >= 128 — di sanalah konversi naif biasanya rusak karena utf8/latin1 tertukar).
//
// Cermin dari `binerKeBase64` / `base64KeBiner` di `lib/ai/adapterOpenai.ts`.
// File itu TypeScript + impor Worker, tak bisa di-require test CJS.
const { test } = require("node:test");
const assert = require("node:assert/strict");

/** Cara LAMA — pembanding kebenaran. Jangan dihapus: inilah definisi "identik". */
function lamaKeBase64(buf) {
  let biner = "";
  for (const b of buf) biner += String.fromCharCode(b);
  return btoa(biner);
}

/** Cara LAMA untuk arah sebaliknya. */
function lamaKeBiner(base64) {
  const biner = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(biner.length));
  for (let i = 0; i < biner.length; i++) bytes[i] = biner.charCodeAt(i);
  return bytes;
}

/** Cermin produksi. */
function binerKeBase64(buf) {
  return Buffer.from(buf).toString("base64");
}
function base64KeBiner(base64) {
  const b = Buffer.from(base64, "base64");
  const bytes = new Uint8Array(new ArrayBuffer(b.length));
  bytes.set(b);
  return bytes;
}

/** Semua nilai byte 0..255 perlu diuji: konversi yang salah utf8/latin1 lolos bila hanya ASCII. */
function contohByte(n) {
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) buf[i] = i % 256;
  return buf;
}

test("base64 identik dengan cara lama untuk semua ukuran batas", () => {
  for (const n of [0, 1, 2, 3, 4, 255, 256, 8191, 8192, 8193, 65536, 500000]) {
    assert.equal(binerKeBase64(contohByte(n)), lamaKeBase64(contohByte(n)), `ukuran ${n}`);
  }
});

test("byte bernilai tinggi (>=128) tidak rusak", () => {
  // Bila konversi memakai utf8 alih-alih latin1, byte >=128 akan berubah dan hasilnya beda.
  // Nilai acuan dihitung dari byte mentah 0,127,128,129,200,254,255.
  const buf = new Uint8Array([0, 127, 128, 129, 200, 254, 255]);
  assert.equal(binerKeBase64(buf), lamaKeBase64(buf));
  assert.equal(binerKeBase64(buf), "AH+Agcj+/w==");
});

test("balik arah: base64 -> byte identik dengan cara lama", () => {
  for (const n of [0, 1, 7, 8192, 8193, 500000]) {
    const buf = contohByte(n);
    const b64 = binerKeBase64(buf);
    assert.deepEqual(Array.from(base64KeBiner(b64)), Array.from(lamaKeBiner(b64)), `ukuran ${n}`);
  }
});

test("putaran penuh tidak mengubah byte (round-trip)", () => {
  for (const n of [0, 1, 7, 8192, 8193, 500000]) {
    const buf = contohByte(n);
    assert.deepEqual(Array.from(base64KeBiner(binerKeBase64(buf))), Array.from(buf), `ukuran ${n}`);
  }
});

test("data URL tanpa padding tetap benar (base64 dari provider)", () => {
  // Provider bisa mengirim base64 tanpa padding '='. Buffer harus tetap menerimanya.
  for (const n of [1, 2, 3, 4, 5]) {
    const buf = contohByte(n);
    const tanpaPad = lamaKeBase64(buf).replace(/=+$/, "");
    assert.deepEqual(Array.from(base64KeBiner(tanpaPad)), Array.from(buf), `tanpa padding, ukuran ${n}`);
  }
});

test("Buffer menghasilkan base64 standar RFC 4648", () => {
  // Vektor uji resmi: "foobar" -> "Zm9vYmFy", dan kasus padding 1/2 byte.
  assert.equal(binerKeBase64(Buffer.from("foobar", "latin1")), "Zm9vYmFy");
  assert.equal(binerKeBase64(Buffer.from("fo", "latin1")), "Zm8=");
  assert.equal(binerKeBase64(Buffer.from("f", "latin1")), "Zg==");
});
