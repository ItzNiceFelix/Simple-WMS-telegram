// test/permintaanGudang.test.js
// Unit test model `permintaan_gudang` v5.1 via mock Firestore in-memory.
// Aturan: target gudang saja, penerima opsional, status per-tujuan (status + status_kirim),
// kirim per tujuan (stok asal turun sebesar qty tujuan), selesai eksplisit (P6).
// Cepat, deterministik, tanpa browser/network.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const m = require("../lib/models/permintaanGudang");

const KODE = "B1";
const ADMIN = "111";    // Pembuat (admin D12)
const PENERIMA = "222"; // admin D13
const OWNER = "900001"; // owner
const LAIN = "333";     // admin D14: bukan penerima, bukan owner, bukan pembuat

function kosongkan() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}
beforeEach(kosongkan);

async function siapkan({ stokAsal = 100 } = {}) {
  const tulis = (col, id, data) => db.collection(col).doc(id).set(data);
  await tulis("gudang", "D12", { nama: "D12", aktif: true });
  await tulis("gudang", "D13", { nama: "D13", aktif: true });
  await tulis("gudang", "D14", { nama: "D14", aktif: true });
  await tulis("admins", ADMIN, { name: "Pembuat", role: "admin", gudang_id: "D12" });
  await tulis("admins", PENERIMA, { name: "Penerima D13", role: "admin", gudang_id: "D13" });
  await tulis("admins", OWNER, { name: "Owner", role: "owner" });
  await tulis("admins", LAIN, { name: "Lain D14", role: "admin", gudang_id: "D14" });
  await tulis("stock", KODE, { stok_gudang_online: stokAsal, qty_per_gudang: { ONLINE: stokAsal, D12: stokAsal } });
}

async function qty(gudangId) {
  const d = await db.collection("stock").doc(KODE).get();
  const map = (d.data() || {}).qty_per_gudang || {};
  return map[gudangId] ?? 0;
}

const ITEM = (q) => ({ kode_barang: KODE, nama: "Barang", qty: q });

async function buat({ dari = "D12", tujuan = [{ tipe: "gudang", id: "D13" }], items = [ITEM(5)], oleh = ADMIN } = {}) {
  const h = await m.buatPermintaan({ dari_gudang_id: dari, tujuan, items, oleh });
  assert.equal(h.ok, true, JSON.stringify(h));
  return h.permintaan;
}

/** Buat satu tujuan D13 (penerima null) lalu setujui + kirim oleh OWNER (fallback). */
async function kirimOwner({ tujuan, items } = {}) {
  const p = await buat({ tujuan, items });
  const s = await m.setujuiTujuan(p.permintaan_id, 0, OWNER);
  assert.equal(s.ok, true, JSON.stringify(s));
  const k = await m.kirimPermintaan(p.permintaan_id, 0, OWNER);
  assert.equal(k.ok, true, JSON.stringify(k));
  return p.permintaan_id;
}

// ===========================================================================
// hitungStatusDokumen (murni, turunan)
// ===========================================================================

test("hitungStatusDokumen: array kosong -> menunggu", () => {
  assert.equal(m.hitungStatusDokumen([]), "menunggu");
});

test("hitungStatusDokumen: semua status_kirim menunggu -> menunggu", () => {
  assert.equal(
    m.hitungStatusDokumen([{ status: "menunggu", status_kirim: "menunggu" }]),
    "menunggu"
  );
  assert.equal(
    m.hitungStatusDokumen([
      { status: "menunggu", status_kirim: "menunggu" },
      { status: "ditolak", status_kirim: "menunggu" },
    ]),
    "menunggu"
  );
});

test("hitungStatusDokumen: sebagian disetujui, sebagian menunggu -> disetujui", () => {
  assert.equal(
    m.hitungStatusDokumen([
      { status: "menunggu", status_kirim: "disetujui" },
      { status: "menunggu", status_kirim: "menunggu" },
    ]),
    "disetujui"
  );
});

test("hitungStatusDokumen: semua dikirim, ada status belum final -> dikirim", () => {
  assert.equal(
    m.hitungStatusDokumen([
      { status: "diterima", status_kirim: "dikirim" },
      { status: "menunggu", status_kirim: "dikirim" },
    ]),
    "dikirim"
  );
});

test("hitungStatusDokumen: semua dikirim + semua final -> TETAP dikirim (P6: selesai aksi eksplisit)", () => {
  assert.equal(
    m.hitungStatusDokumen([
      { status: "diterima", status_kirim: "dikirim" },
      { status: "ditutup", status_kirim: "dikirim" },
    ]),
    "dikirim"
  );
});

test("hitungStatusDokumen: semua dikirim + ada status ditolak -> ditolak", () => {
  assert.equal(
    m.hitungStatusDokumen([
      { status: "ditolak", status_kirim: "dikirim" },
      { status: "diterima", status_kirim: "dikirim" },
    ]),
    "ditolak"
  );
});

// ===========================================================================
// buatPermintaan - target gudang saja, penerima, qty per tujuan
// ===========================================================================

test("buat: sukses -> menunggu, entri status_kirim menunggu, snapshot, dedupe gudang sama", async () => {
  await siapkan();
  const h = await m.buatPermintaan({
    dari_gudang_id: "D12",
    tujuan: [
      { tipe: "gudang", id: "D13" },
      { tipe: "gudang", id: "D13" },
      { tipe: "gudang", id: "D14" },
    ],
    items: [ITEM(5)],
    oleh: ADMIN,
  });
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal(h.permintaan.status, "menunggu");
  assert.equal(h.permintaan.tujuan.length, 2, "gudang duplikat di-dedupe");
  assert.ok(h.permintaan.tujuan.every((t) => t.status === "menunggu" && t.status_kirim === "menunggu"));
  assert.equal(h.permintaan.tujuan[0].gudang_id_snapshot, "D13");
  assert.equal(h.permintaan.tujuan[1].gudang_id_snapshot, "D14");
  assert.deepEqual(h.permintaan.tujuan_ids, ["gudang:D13", "gudang:D14"]);
  assert.equal(h.permintaan.created_by, ADMIN);
  assert.equal(h.permintaan.items[0].qty, 5);
});

test("buat: tipe user / tak dikenal / id kosong / gudang asal -> 400", async () => {
  await siapkan();
  for (const tujuan of [[{ tipe: "user", id: PENERIMA }], [{ tipe: "cabang", id: "D13" }], [{ tipe: "gudang", id: "" }]]) {
    const h = await m.buatPermintaan({ dari_gudang_id: "D12", tujuan, items: [ITEM(1)], oleh: ADMIN });
    assert.equal(h.ok, false, JSON.stringify(h));
    assert.equal(h.status, 400);
    assert.equal(h.error, "Tujuan hanya boleh gudang.");
  }
  const asal = await m.buatPermintaan({
    dari_gudang_id: "D12",
    tujuan: [{ tipe: "gudang", id: "D12" }],
    items: [ITEM(1)],
    oleh: ADMIN,
  });
  assert.equal(asal.ok, false);
  assert.equal(asal.status, 400);
  assert.equal(asal.error, "Gudang asal tidak boleh jadi tujuan.");
});

test("buat: tujuan kosong -> 'Pilih minimal satu tujuan.'; items kosong -> 'Permintaan belum berisi item.'", async () => {
  await siapkan();
  const a = await m.buatPermintaan({ dari_gudang_id: "D12", tujuan: [], items: [ITEM(1)], oleh: ADMIN });
  assert.equal(a.ok, false);
  assert.equal(a.status, 400);
  assert.equal(a.error, "Pilih minimal satu tujuan.");

  const b = await m.buatPermintaan({
    dari_gudang_id: "D12",
    tujuan: [{ tipe: "gudang", id: "D13" }],
    items: [],
    oleh: ADMIN,
  });
  assert.equal(b.ok, false);
  assert.equal(b.status, 400);
  assert.equal(b.error, "Permintaan belum berisi item.");
});

test("buat: penerima kosong -> null; diisi dari gudang tujuan -> id + nama", async () => {
  await siapkan();
  const a = await buat({ tujuan: [{ tipe: "gudang", id: "D13" }] });
  assert.equal(a.tujuan[0].user_penerima_id, null);
  assert.equal(a.tujuan[0].user_penerima_nama, null);

  const b = await buat({ tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: PENERIMA }] });
  assert.equal(b.tujuan[0].user_penerima_id, PENERIMA);
  assert.equal(b.tujuan[0].user_penerima_nama, "Penerima D13");
});

test("buat: penerima bukan dari gudang tujuan -> 400 'Penerima harus dari gudang tujuan.'", async () => {
  await siapkan();
  const h = await m.buatPermintaan({
    dari_gudang_id: "D12",
    tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: ADMIN }],
    items: [ITEM(1)],
    oleh: ADMIN,
  });
  assert.equal(h.ok, false);
  assert.equal(h.status, 400);
  assert.equal(h.error, "Penerima harus dari gudang tujuan.");
});

test("buat: items tujuan array kosong -> 400 'Tujuan belum berisi item.'", async () => {
  await siapkan();
  const h = await m.buatPermintaan({
    dari_gudang_id: "D12",
    tujuan: [{ tipe: "gudang", id: "D13", items: [] }],
    items: [ITEM(1)],
    oleh: ADMIN,
  });
  assert.equal(h.ok, false);
  assert.equal(h.status, 400);
  assert.equal(h.error, "Tujuan belum berisi item.");
});

test("buat: tujuan tanpa items -> fallback items dokumen", async () => {
  await siapkan();
  const p = await buat({ tujuan: [{ tipe: "gudang", id: "D13" }], items: [ITEM(7)] });
  assert.equal(p.tujuan[0].items.length, 1);
  assert.equal(p.tujuan[0].items[0].qty, 7);
});

test("buat: qty beda per tujuan tersimpan (P7)", async () => {
  await siapkan();
  const p = await buat({
    tujuan: [
      { tipe: "gudang", id: "D13", items: [ITEM(3)] },
      { tipe: "gudang", id: "D14", items: [ITEM(5)] },
    ],
    items: [ITEM(3)],
  });
  assert.equal(p.tujuan[0].items[0].qty, 3);
  assert.equal(p.tujuan[1].items[0].qty, 5);
  assert.equal(p.items[0].qty, 3, "items dokumen tetap referensi");
});

// ===========================================================================
// setujuiTujuan / tolakTujuanPermintaan
// ===========================================================================

test("setujuiTujuan: oleh penerima -> disetujui", async () => {
  await siapkan();
  const p = await buat({ tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: PENERIMA }] });
  const h = await m.setujuiTujuan(p.permintaan_id, 0, PENERIMA);
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal(h.status, "disetujui");
  assert.equal(h.tujuan[0].status_kirim, "disetujui");
  assert.equal(h.tujuan[0].disetujui_oleh, PENERIMA);
});

test("setujuiTujuan: bukan penerima & bukan owner -> 403", async () => {
  await siapkan();
  const p = await buat({ tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: PENERIMA }] });
  const h = await m.setujuiTujuan(p.permintaan_id, 0, LAIN);
  assert.equal(h.ok, false);
  assert.equal(h.status, 403);
  assert.equal(h.error, "Hanya penerima tujuan ini yang dapat menyetujui.");
});

test("setujuiTujuan: penerima null -> owner boleh, non-owner 403", async () => {
  await siapkan();
  const a = await buat({ tujuan: [{ tipe: "gudang", id: "D13" }] });
  const owner = await m.setujuiTujuan(a.permintaan_id, 0, OWNER);
  assert.equal(owner.ok, true, JSON.stringify(owner));

  const b = await buat({ tujuan: [{ tipe: "gudang", id: "D13" }] });
  const lain = await m.setujuiTujuan(b.permintaan_id, 0, LAIN);
  assert.equal(lain.ok, false);
  assert.equal(lain.status, 403);
});

test("setujuiTujuan ulang -> 409 'Tujuan ini sudah diproses.'", async () => {
  await siapkan();
  const p = await buat({ tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: PENERIMA }] });
  await m.setujuiTujuan(p.permintaan_id, 0, PENERIMA);
  const h = await m.setujuiTujuan(p.permintaan_id, 0, PENERIMA);
  assert.equal(h.ok, false);
  assert.equal(h.status, 409);
  assert.equal(h.error, "Tujuan ini sudah diproses.");
});

test("tolakTujuanPermintaan (P1): status ditolak, status_kirim tetap menunggu", async () => {
  await siapkan();
  const p = await buat({ tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: PENERIMA }] });
  const h = await m.tolakTujuanPermintaan(p.permintaan_id, 0, PENERIMA);
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal(h.tujuan[0].status, "ditolak");
  assert.equal(h.tujuan[0].status_kirim, "menunggu");
  assert.equal(h.tujuan[0].ditolak_oleh, PENERIMA);
  assert.equal(h.status, "menunggu", "status dokumen turunan tetap menunggu");
});

test("setujuiTujuan: index di luar array -> 409 'Tujuan tidak ditemukan.'", async () => {
  await siapkan();
  const p = await buat();
  for (const idx of [1, -1, 99]) {
    const h = await m.setujuiTujuan(p.permintaan_id, idx, OWNER);
    assert.equal(h.ok, false, JSON.stringify(h));
    assert.equal(h.status, 409);
    assert.equal(h.error, "Tujuan tidak ditemukan.");
  }
});

// ===========================================================================
// kirimPermintaan - PER TUJUAN, stok asal turun sebesar qty tujuan itu
// ===========================================================================

test("kirimPermintaan: stok asal turun sebesar qty tujuan itu saja", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimOwner({ tujuan: [{ tipe: "gudang", id: "D13" }], items: [ITEM(5)] });
  assert.equal(await qty("D12"), 95);
  assert.equal(await qty("D13"), 0, "stok tujuan belum naik saat kirim");
  const d = await m.ambilPermintaan(id);
  assert.equal(d.status, "dikirim");
  assert.equal(d.tujuan[0].status_kirim, "dikirim");
});

test("kirimPermintaan: qty beda per tujuan -> stok asal turun bertahap (P7)", async () => {
  await siapkan({ stokAsal: 100 });
  const p = await buat({
    tujuan: [
      { tipe: "gudang", id: "D13", items: [ITEM(3)] },
      { tipe: "gudang", id: "D14", items: [ITEM(5)] },
    ],
    items: [ITEM(3)],
  });
  assert.equal((await m.setujuiTujuan(p.permintaan_id, 0, OWNER)).ok, true);
  assert.equal((await m.setujuiTujuan(p.permintaan_id, 1, OWNER)).ok, true);

  assert.equal((await m.kirimPermintaan(p.permintaan_id, 0, OWNER)).ok, true);
  assert.equal(await qty("D12"), 97, "turun 3 untuk tujuan A");
  assert.equal((await m.kirimPermintaan(p.permintaan_id, 1, OWNER)).ok, true);
  assert.equal(await qty("D12"), 92, "turun 5 untuk tujuan B");

  assert.equal((await m.terimaPermintaan(p.permintaan_id, 0, ADMIN)).ok, true);
  assert.equal(await qty("D13"), 3);
  assert.equal((await m.terimaPermintaan(p.permintaan_id, 1, ADMIN)).ok, true);
  assert.equal(await qty("D14"), 5);
});

test("kirimPermintaan: belum disetujui -> 409 'Permintaan belum disetujui.'", async () => {
  await siapkan();
  const p = await buat();
  const h = await m.kirimPermintaan(p.permintaan_id, 0, OWNER);
  assert.equal(h.ok, false);
  assert.equal(h.status, 409);
  assert.equal(h.error, "Permintaan belum disetujui.");
});

test("kirimPermintaan ulang -> 409 'Permintaan sudah dikirim.'; stok tidak turun dua kali", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimOwner({ items: [ITEM(5)] });
  assert.equal(await qty("D12"), 95);
  const h = await m.kirimPermintaan(id, 0, OWNER);
  assert.equal(h.ok, false);
  assert.equal(h.status, 409);
  assert.equal(h.error, "Permintaan sudah dikirim.");
  assert.equal(await qty("D12"), 95);
});

test("kirimPermintaan: stok asal kurang -> 409 'Stok gudang asal tidak cukup.'", async () => {
  await siapkan({ stokAsal: 2 });
  const p = await buat({ items: [ITEM(5)] });
  await m.setujuiTujuan(p.permintaan_id, 0, OWNER);
  const h = await m.kirimPermintaan(p.permintaan_id, 0, OWNER);
  assert.equal(h.ok, false);
  assert.equal(h.status, 409);
  assert.equal(h.error, "Stok gudang asal tidak cukup.");
  assert.equal(await qty("D12"), 2);
});

test("kirimPermintaan: bukan penerima & bukan owner -> 403", async () => {
  await siapkan();
  const p = await buat({ tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: PENERIMA }] });
  await m.setujuiTujuan(p.permintaan_id, 0, PENERIMA);
  const h = await m.kirimPermintaan(p.permintaan_id, 0, LAIN);
  assert.equal(h.ok, false);
  assert.equal(h.status, 403);
  assert.equal(h.error, "Hanya penerima tujuan ini yang dapat menyetujui.");
});

test("kirimPermintaan: penerima null -> owner fallback bisa kirim", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimOwner({ items: [ITEM(4)] });
  assert.equal(await qty("D12"), 96);
  assert.equal((await m.ambilPermintaan(id)).tujuan[0].status_kirim, "dikirim");
});

// ===========================================================================
// terima / tidak-terima / tutup-tujuan
// ===========================================================================

test("terimaPermintaan: pembuat & owner -> stok gudang tujuan naik; entri diterima", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimOwner({ items: [ITEM(5)] });
  const h = await m.terimaPermintaan(id, 0, ADMIN);
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal(h.tujuan[0].status, "diterima");
  assert.equal(await qty("D13"), 5);
  assert.equal(await qty("D12"), 95);

  const id2 = await kirimOwner({ items: [ITEM(2)] });
  const h2 = await m.terimaPermintaan(id2, 0, OWNER);
  assert.equal(h2.ok, true, JSON.stringify(h2));
  assert.equal(await qty("D13"), 7);
});

test("terimaPermintaan: bukan pembuat & bukan owner -> 403", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimOwner({ items: [ITEM(5)] });
  const h = await m.terimaPermintaan(id, 0, PENERIMA);
  assert.equal(h.ok, false);
  assert.equal(h.status, 403);
  assert.equal(h.error, "Hanya pembuat permintaan yang dapat mengonfirmasi.");
});

test("terimaPermintaan: belum dikirim -> 409 'Permintaan belum dikirim.'", async () => {
  await siapkan();
  const p = await buat();
  await m.setujuiTujuan(p.permintaan_id, 0, OWNER);
  const h = await m.terimaPermintaan(p.permintaan_id, 0, ADMIN);
  assert.equal(h.ok, false);
  assert.equal(h.status, 409);
  assert.equal(h.error, "Permintaan belum dikirim.");
});

test("terimaPermintaan ulang -> 409 'Tujuan ini sudah diterima.'; stok tidak naik dua kali", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimOwner({ items: [ITEM(5)] });
  await m.terimaPermintaan(id, 0, ADMIN);
  const h = await m.terimaPermintaan(id, 0, ADMIN);
  assert.equal(h.ok, false);
  assert.equal(h.status, 409);
  assert.equal(h.error, "Tujuan ini sudah diterima.");
  assert.equal(await qty("D13"), 5);
});

test("tidakTerimaPermintaan: stok kembali ke gudang ASAL", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimOwner({ items: [ITEM(5)] });
  assert.equal(await qty("D12"), 95);
  const h = await m.tidakTerimaPermintaan(id, 0, ADMIN);
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal(h.tujuan[0].status, "tidak_terima");
  assert.equal(await qty("D12"), 100);
  assert.equal(await qty("D13"), 0);
});

test("tutupTujuanPermintaan: owner -> ditutup, stok tetap, qty_hilang; non-owner 403", async () => {
  await siapkan({ stokAsal: 100 });
  const id = await kirimOwner({ items: [ITEM(5)] });
  const d12 = await qty("D12");
  const d13 = await qty("D13");
  const h = await m.tutupTujuanPermintaan(id, 0, "barang nyangkut", OWNER);
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal(h.tujuan[0].status, "ditutup");
  assert.equal(h.tujuan[0].catatan_alasan, "barang nyangkut");
  assert.equal(await qty("D12"), d12);
  assert.equal(await qty("D13"), d13);
  assert.equal(h.qty_hilang, 5);

  const id2 = await kirimOwner({ items: [ITEM(3)] });
  const tolak = await m.tutupTujuanPermintaan(id2, 0, "alasan", ADMIN);
  assert.equal(tolak.ok, false);
  assert.equal(tolak.status, 403);
  assert.equal(tolak.error, "Hanya owner yang dapat menutup tujuan.");
  assert.equal((await m.ambilPermintaan(id2)).tujuan[0].status, "menunggu", "tidak berubah");
});

// ===========================================================================
// selesaiPermintaan (P6)
// ===========================================================================

test("selesaiPermintaan: masih ada tujuan belum final -> 409", async () => {
  await siapkan();
  const p = await buat();
  const h = await m.selesaiPermintaan(p.permintaan_id, ADMIN);
  assert.equal(h.ok, false);
  assert.equal(h.status, 409);
  assert.equal(h.error, "Masih ada tujuan yang belum selesai.");
});

test("selesaiPermintaan: semua tujuan final -> selesai", async () => {
  await siapkan();
  const p = await buat({ tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: PENERIMA }] });
  await m.tolakTujuanPermintaan(p.permintaan_id, 0, PENERIMA);
  const h = await m.selesaiPermintaan(p.permintaan_id, ADMIN);
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal(h.status, "selesai");
  assert.equal(h.permintaan.status, "selesai");
});

test("selesaiPermintaan: bukan pembuat & bukan owner -> 403", async () => {
  await siapkan();
  const p = await buat();
  const h = await m.selesaiPermintaan(p.permintaan_id, LAIN);
  assert.equal(h.ok, false);
  assert.equal(h.status, 403);
  assert.equal(h.error, "Hanya pembuat permintaan yang dapat mengonfirmasi.");
});

// ===========================================================================
// tolakPermintaan (dokumen) / batalPermintaan
// ===========================================================================

test("tolakPermintaan: semua status_kirim menunggu -> dokumen ditolak", async () => {
  await siapkan();
  const p = await buat();
  const h = await m.tolakPermintaan(p.permintaan_id, ADMIN);
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal(h.permintaan.status, "ditolak");
  const lagi = await m.setujuiTujuan(p.permintaan_id, 0, OWNER);
  assert.equal(lagi.ok, false);
  assert.equal(lagi.status, 409);
  assert.equal(lagi.error, "Permintaan sudah ditolak.");
});

test("tolakPermintaan: sudah ada tujuan disetujui -> 409 'Permintaan sudah diproses.'", async () => {
  await siapkan();
  const p = await buat({ tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: PENERIMA }] });
  await m.setujuiTujuan(p.permintaan_id, 0, PENERIMA);
  const h = await m.tolakPermintaan(p.permintaan_id, ADMIN);
  assert.equal(h.ok, false);
  assert.equal(h.status, 409);
  assert.equal(h.error, "Permintaan sudah diproses.");
});

test("batalPermintaan: menunggu -> dibatalkan; dari dikirim -> 409", async () => {
  await siapkan({ stokAsal: 100 });
  const p = await buat();
  const h = await m.batalPermintaan(p.permintaan_id, ADMIN);
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal(h.permintaan.status, "dibatalkan");
  assert.equal(await qty("D12"), 100, "stok tidak berubah");

  const id = await kirimOwner({ items: [ITEM(5)] });
  const h2 = await m.batalPermintaan(id, ADMIN);
  assert.equal(h2.ok, false);
  assert.equal(h2.status, 409);
  assert.equal(h2.error, "Permintaan sudah diproses.");
});