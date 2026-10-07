// test/casModelFirestore.test.js
// Bukti semantik CAS transaksi (race) pada DOKUMEN permintaan_gudang yang SAMA - API v5.1.
//
// Kunci argumen: mockFirestore MEN-SERIALISASI runTransaction lewat antrean mutex
// (lihat helpers/mockFirestore.js baris ~128-151), persis seperti Firestore asli.
// Karena itu dua pemanggilan `Promise.all` benar-benar mengeksekusi transaksi
// berurutan: transaksi kedua membaca state SETELAH transaksi pertama commit ->
// CAS/create-only benar-benar teruji (bukan sekadar dua tulisan lolos).
//
// Perubahan v5.1 yang dicerminkan di sini:
// - setujui/kirim PER TUJUAN: setujuiTujuan(id, i, oleh) / kirimPermintaan(id, i, oleh);
//   gate = penerima tujuan (user_penerima_id) atau owner.
// - terima/tidakTerima gate = PEMBUAT (created_by) atau owner.
// - tutupTujuanPermintaan(id, i, catatan, oleh) tetap owner-only; stok tidak berubah.
// - `selesai` aksi eksplisit pembuat (selesaiPermintaan); hitungStatusDokumen tetap
//   mengembalikan "dikirim" walau semua tujuan final (P6).
//
// Prinsip: cepat, ringan, deterministik. Tanpa network/browser.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const m = require("../lib/models/permintaanGudang");

const ADMIN = "111"; // admin gudang asal D12 (PEMBUAT dokumen)
const OWNER = "999001"; // owner
const USER_D13 = "900002"; // admin gudang D13 (penerima tujuan D13)
const KODE = "B1";

function kosongkan() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}
beforeEach(kosongkan);

/** Fixture dasar: gudang D12/D13/D14 aktif, admin/owner, stok B1. */
async function siapkan({ stokAsal = 100 } = {}) {
  const tulis = async (col, id, data) => db.collection(col).doc(id).set(data);
  await tulis("gudang", "D12", { nama: "D12", aktif: true });
  await tulis("gudang", "D13", { nama: "D13", aktif: true });
  await tulis("gudang", "D14", { nama: "D14", aktif: true });
  await tulis("admins", ADMIN, { name: "Admin", role: "admin", gudang_id: "D12" });
  await tulis("admins", OWNER, { name: "Owner", role: "owner", gudang_id: "D12" });
  await tulis("admins", USER_D13, { name: "Budi", role: "admin", gudang_id: "D13" });
  await tulis("stock", KODE, {
    stok_gudang_online: stokAsal,
    qty_per_gudang: { ONLINE: stokAsal, D12: stokAsal },
  });
}

/** Stok satu gudang (baca ternormalisasi). */
async function qty(gudangId) {
  const doc = await db.collection("stock").doc(KODE).get();
  const map = doc.data().qty_per_gudang || {};
  return map[gudangId] ?? 0;
}

/** Aktor gate setujui/kirim: penerima tujuan bila ada, jika tidak owner (fallback Q2). */
function penerimaTujuan(entri) {
  return entri && entri.user_penerima_id ? entri.user_penerima_id : OWNER;
}

/**
 * Buat + setujui + kirim SEMUA tujuan (per tujuan, v5.1) -> dokumen `dikirim`,
 * stok asal turun sebesar total qty tiap tujuan.
 * Tujuan default: D13 dengan penerima USER_D13.
 */
async function kirimSiap({ tujuan, items = [{ kode_barang: KODE, qty: 5 }] } = {}) {
  const buat = await m.buatPermintaan({
    dari_gudang_id: "D12",
    tujuan: tujuan || [{ tipe: "gudang", id: "D13", user_penerima_id: USER_D13 }],
    items,
    oleh: ADMIN,
  });
  assert.equal(buat.ok, true, JSON.stringify(buat));
  const id = buat.permintaan.permintaan_id;

  for (let i = 0; i < buat.permintaan.tujuan.length; i += 1) {
    const oleh = penerimaTujuan(buat.permintaan.tujuan[i]);
    const setuju = await m.setujuiTujuan(id, i, oleh);
    assert.equal(setuju.ok, true, `setujui tujuan ${i}: ${JSON.stringify(setuju)}`);
    const kirim = await m.kirimPermintaan(id, i, oleh);
    assert.equal(kirim.ok, true, `kirim tujuan ${i}: ${JSON.stringify(kirim)}`);
  }
  return id;
}

// ---------------------------------------------------------------------------
// 1) Dua `terima` tujuan BERBEDA, dokumen sama, dijalankan paralel.
//    Gate terima = pembuat (ADMIN).
// ---------------------------------------------------------------------------
test("dua terima tujuan BERBEDA paralel: dua entri tercatat, tiap gudang naik TEPAT sekali", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimSiap({
    tujuan: [
      { tipe: "gudang", id: "D13", user_penerima_id: USER_D13 },
      { tipe: "gudang", id: "D14" },
    ],
  });

  const [a, b] = await Promise.all([
    m.terimaPermintaan(id, 0, ADMIN),
    m.terimaPermintaan(id, 1, ADMIN),
  ]);

  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(await qty("D13"), 5, "D13 naik tepat sekali");
  assert.equal(await qty("D14"), 5, "D14 naik tepat sekali");
  assert.equal(await qty("D12"), 90, "stok asal turun sekali untuk tiap tujuan (100 - 10)");

  const dok = await m.ambilPermintaan(id);
  assert.equal(dok.status, "dikirim", "v5.1 P6: selesai TIDAK otomatis walau semua tujuan final");
  assert.ok(dok.tujuan.every((t) => t.status === "diterima"));
});

// ---------------------------------------------------------------------------
// 2) `terima` (pembuat) vs `tutup-tujuan` (owner) tujuan SAMA -> tepat satu menang.
//    Dua tujuan agar dokumen tetap `dikirim` -> 409 yang kalah dari level ENTRI.
// ---------------------------------------------------------------------------
test("terima vs tutup-tujuan tujuan SAMA paralel: tepat satu menang, yang kalah 409, stok naik ATAU tidak (bukan keduanya)", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimSiap({
    tujuan: [
      { tipe: "gudang", id: "D13", user_penerima_id: USER_D13 },
      { tipe: "gudang", id: "D14" },
    ],
  });

  const [terima, tutup] = await Promise.all([
    m.terimaPermintaan(id, 0, ADMIN),
    m.tutupTujuanPermintaan(id, 0, "barang nyangkut", OWNER),
  ]);

  const menang = [terima, tutup].filter((r) => r.ok);
  const kalah = [terima, tutup].filter((r) => !r.ok);
  assert.equal(menang.length, 1, "tepat satu menang");
  assert.equal(kalah.length, 1, "tepat satu kalah");
  assert.equal(kalah[0].status, 409, "yang kalah 409");

  const stokD13 = await qty("D13");
  assert.ok(stokD13 === 5 || stokD13 === 0, `D13 harus 5 (terima menang) atau 0 (tutup menang), dapat ${stokD13}`);
  assert.notEqual(stokD13, 10, "tidak boleh naik dua kali");

  const dok = await m.ambilPermintaan(id);
  assert.equal(dok.tujuan[0].status === "diterima" || dok.tujuan[0].status === "ditutup", true);
});

// ---------------------------------------------------------------------------
// 3) Dua `kirim` PER TUJUAN SAMA paralel -> hanya satu menurunkan stok asal.
//    Gate kirim = penerima tujuan (USER_D13).
// ---------------------------------------------------------------------------
test("dua kirim tujuan SAMA paralel: satu ok, satu 409, stok asal turun TEPAT sekali", async () => {
  await siapkan({ stokAsal: 100 });
  const buat = await m.buatPermintaan({
    dari_gudang_id: "D12",
    tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: USER_D13 }],
    items: [{ kode_barang: KODE, qty: 5 }],
    oleh: ADMIN,
  });
  assert.equal(buat.ok, true);
  const id = buat.permintaan.permintaan_id;
  const setuju = await m.setujuiTujuan(id, 0, USER_D13);
  assert.equal(setuju.ok, true, JSON.stringify(setuju));

  const [a, b] = await Promise.all([
    m.kirimPermintaan(id, 0, USER_D13),
    m.kirimPermintaan(id, 0, USER_D13),
  ]);

  assert.equal([a, b].filter((r) => r.ok).length, 1, "tepat satu sukses");
  const gagal = [a, b].find((r) => !r.ok);
  assert.equal(gagal.status, 409);
  assert.equal(gagal.error, "Permintaan sudah dikirim.");
  assert.equal(await qty("D12"), 95, "stok asal turun tepat sekali (100 - 5)");
});

// ---------------------------------------------------------------------------
// 4) Dua `tidak-terima` tujuan SAMA paralel -> stok asal naik TEPAT sekali.
//    Gate tidak-terima = pembuat (ADMIN). Dua tujuan agar dokumen tetap `dikirim`.
// ---------------------------------------------------------------------------
test("dua tidak-terima tujuan SAMA paralel: stok asal naik TEPAT sekali, yang kalah 409", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimSiap({
    tujuan: [
      { tipe: "gudang", id: "D13", user_penerima_id: USER_D13 },
      { tipe: "gudang", id: "D14" },
    ],
  });
  assert.equal(await qty("D12"), 90, "prasyarat: stok asal turun untuk dua tujuan");

  const [a, b] = await Promise.all([
    m.tidakTerimaPermintaan(id, 0, ADMIN),
    m.tidakTerimaPermintaan(id, 0, ADMIN),
  ]);

  assert.equal([a, b].filter((r) => r.ok).length, 1, "tepat satu sukses");
  const gagal = [a, b].find((r) => !r.ok);
  assert.equal(gagal.status, 409);
  assert.equal(await qty("D12"), 95, "stok asal naik tepat sekali (kembali +5 -> 95)");
  assert.equal(await qty("D13"), 0, "stok tujuan tidak berubah");
});