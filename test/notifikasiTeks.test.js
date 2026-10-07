// test/notifikasiTeks.test.js
// REGRESI: aksi "tolak-tujuan" pernah menghasilkan teks "menyetujui" (fallback buta di
// susunTeksStatus), sehingga user yang MENOLAK menerima notif "menyetujui permintaan".
//
// Test ini mengunci teks tiap aksi + memastikan TIDAK ADA fallback yang mengaku "menyetujui".
const { test } = require("node:test");
const assert = require("node:assert/strict");

const n = require("../lib/notifikasi/permintaanGudang");

const P = { permintaan_id: "pg-1", dari_gudang_id: "ONLINE" };
const T = { tipe: "gudang", id: "D19", nama: "Gudang D19", items: [{ kode_barang: "B1", qty: 5 }] };

function teks(aksi) {
  return n.susunTeksStatus({ permintaan: P, tujuan: T, aksi });
}

test("setujui: teks menyetujui", () => {
  assert.match(teks("setujui"), /menyetujui/);
});

test("tolak-tujuan: teks MENOLAK (bukan menyetujui) - regresi bug produksi", () => {
  const s = teks("tolak-tujuan");
  assert.match(s, /menolak/);
  assert.ok(!/menyetujui/.test(s), "tolak-tujuan TIDAK boleh bilang menyetujui: " + s);
});

test("kirim: teks mengirim", () => {
  assert.match(teks("kirim"), /mengirim/);
});

test("terima: teks menerima", () => {
  assert.match(teks("terima"), /menerima/);
});

test("tidak-terima: teks tidak menerima", () => {
  assert.match(teks("tidak-terima"), /tidak menerima/);
});

test("tutup-tujuan: teks ditutup", () => {
  assert.match(teks("tutup-tujuan"), /ditutup/);
});

test("aksi tak dikenal: TIDAK pernah mengaku menyetujui", () => {
  const s = teks("aksi-ngawur");
  assert.ok(!/menyetujui/.test(s), "fallback tidak boleh bilang menyetujui: " + s);
});

test("setiap aksi dikenal menghasilkan teks berbeda (tidak ada fallback buta)", () => {
  const daftar = ["setujui", "tolak-tujuan", "kirim", "terima", "tidak-terima", "tutup-tujuan"];
  const hasil = daftar.map((a) => teks(a));
  const unik = new Set(hasil);
  assert.equal(unik.size, daftar.length, "tiap aksi harus punya teks sendiri: " + JSON.stringify(hasil, null, 1));
});

test("ubah-item tidak mengirim notifikasi apa pun", async () => {
  const hasil = await n.kirimNotifikasiPermintaan({ aksi: "ubah-item", permintaan: P });
  assert.equal(hasil.terkirim, false);
});
