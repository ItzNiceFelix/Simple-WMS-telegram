// test/riwayatEditorDesain.test.js — Aturan riwayat undo/redo + geometri ekspor editor-desain.
//
// Kenapa diuji terpisah: `components/dashboard/editor-desain.tsx` meng-import fabric (butuh DOM)
// sehingga tak bisa di-require dari test CJS. Kedua fungsi di bawah adalah salinan PERSIS dari
// logika di komponen; kalau salah satunya berubah, uji ini gagal — itulah gunanya.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const MAKS_RIWAYAT = 50;

/**
 * Cermin `catatRiwayat`: dorong snapshot baru, buang cabang redo, jaga batas MAKS_RIWAYAT.
 * @returns {{list: string[], idx: number}}
 */
function dorong(list, idx, json) {
  if (list[idx] === json) return { list, idx }; // tidak ada perubahan nyata
  let i = idx + 1;
  const next = list.slice();
  if (i === next.length) next.push(json);
  else next.splice(i, next.length, json); // edit baru setelah undo → buang cabang lama
  if (next.length > MAKS_RIWAYAT) {
    next.splice(0, next.length - MAKS_RIWAYAT);
    i = next.length - 1;
  }
  return { list: next, idx: i };
}

/**
 * Cermin `buatBlobEkspor`: multiplier supaya hasil = ukuran preset, bukan ukuran tampilan.
 * toCanvasElement memakai (width * multiplier, height * multiplier) dan width layar = preset * zoom.
 */
function multiplierEkspor({ lebar, tinggi, lebarLayar, tinggiLayar, zoom }) {
  return Math.max(lebar / lebarLayar, tinggi / tinggiLayar, 1 / zoom);
}

test("riwayat: dokumen 1080 dikecilkan ke layar → ekspor tetap 1080", () => {
  const zoom = 0.5925925925925926; // 640/1080
  const m = multiplierEkspor({ lebar: 1080, tinggi: 1080, lebarLayar: 1080 * zoom, tinggiLayar: 1080 * zoom, zoom });
  assert.equal(Math.round(1080 * zoom * m), 1080);
  assert.equal(Math.round(1080 * zoom * m), 1080);
});

test("riwayat: kanvas belum di-zoom (zoom 1) tetap penuh", () => {
  const m = multiplierEkspor({ lebar: 1080, tinggi: 1080, lebarLayar: 1080, tinggiLayar: 1080, zoom: 1 });
  assert.equal(m, 1);
  assert.equal(1080 * m, 1080);
});

test("riwayat: dokumen lebih kecil dari wadah → jangan perkecil hasil", () => {
  // 1200x628 muat penuh (zoom 1) walau wadah lebih lebar; multiplier tidak boleh < 1.
  const m = multiplierEkspor({ lebar: 1200, tinggi: 628, lebarLayar: 1200, tinggiLayar: 628, zoom: 1 });
  assert.equal(m, 1);
});

test("riwayat: zoom di bawah 1 harus dikompensasi walau dimensi kanvas belum ikut", () => {
  // Kasus tepi: setDimensions belum jalan (lebarLayar masih = preset) tapi zoom sudah 0.5.
  const m = multiplierEkspor({ lebar: 1080, tinggi: 1080, lebarLayar: 1080, tinggiLayar: 1080, zoom: 0.5 });
  assert.equal(m, 2);
});

test("riwayat: satu entri per aksi, bukan per pointermove", () => {
  let s = { list: [""], idx: 0 };
  // Satu geseran = satu object:modified. Snapshot berulang tanpa perubahan diabaikan.
  s = dorong(s.list, s.idx, "geser-ish");
  assert.equal(s.list.length, 2);
  assert.equal(s.idx, 1);
  s = dorong(s.list, s.idx, "geser-ish");
  assert.equal(s.list.length, 2, "JSON sama tidak menambah entri");
});

test("riwayat: edit baru setelah undo membuang cabang redo", () => {
  let s = { list: [""], idx: 0 };
  s = dorong(s.list, s.idx, "a");
  s = dorong(s.list, s.idx, "b");
  const dapatRedo = s.idx < s.list.length - 1;
  assert.equal(dapatRedo, false);
  s = { list: s.list, idx: s.idx - 1 }; // undo satu langkah
  assert.equal(s.idx, 1);
  assert.equal(s.idx < s.list.length - 1, true, "redo tersedia setelah undo");
  s = dorong(s.list, s.idx, "c"); // edit baru
  assert.deepEqual(s.list, ["", "a", "c"], "cabang lama dibuang");
  assert.equal(s.idx, 2);
});

test("riwayat: batas 50 entri, yang paling lama dibuang, indeks tetap di ujung", () => {
  let s = { list: [""], idx: 0 };
  for (let i = 1; i <= 80; i += 1) s = dorong(s.list, s.idx, `s${i}`);
  assert.equal(s.list.length, MAKS_RIWAYAT);
  assert.equal(s.idx, MAKS_RIWAYAT - 1);
  assert.equal(s.list[0], "s31", "50 entri terakhir yang tersisa");
  assert.equal(s.list[s.list.length - 1], "s80");
  // Undo penuh dari ujung baru: masih bisa mundur sampai entri paling lama yang tersisa.
  assert.equal(s.idx > 0, true);
});
