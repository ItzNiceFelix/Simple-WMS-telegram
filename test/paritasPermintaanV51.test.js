// test/paritasPermintaanV51.test.js
// v5.1 - PARITAS mock.ts <-> lib/models/permintaanGudang.js untuk permintaan ANTAR-GUDANG.
//
// mock.ts adalah TypeScript dan tidak bisa di-require langsung dari test CJS. Pola yang
// dipakai test/permintaanRouteV5.test.js: transpile TypeScript in-test (typescript
// devDependency) lalu compile sebagai CJS. Di sini kita MEMUAT mock.ts yang asli, jadi
// method DataSource yang diuji adalah kode produksi, bukan reimplementasi.
//
// Setiap test memuat ulang modul mock (cache dibuang) supaya store internal + MOCK_SESSION
// kembali ke seed -> deterministik & terisolasi. TIDAK ada file produksi yang diubah.
//
// Sumber acuan (source of truth): lib/models/permintaanGudang.js.
// Aturan v5.1 yang dibuktikan:
//  1. Tujuan hanya gudang (tipe "user" ditolak model).
//  2. status_kirim per tujuan.
//  3. user_penerima_id + snapshot nama.
//  4. items per tujuan (qty boleh beda).
//  5. Gate setujui/kirim/tolak-tujuan = penerima tujuan atau owner.
//  6. Gate terima/tidak-terima/selesai = pembuat atau owner.
//  7. kirim turunkan stok asal sebesar qty tujuan itu saja.
//  8. selesai syarat semua tujuan final.
//  9. hitungStatusDokumen TIDAK auto-selesai (P6).
//
// Beberapa aturan DITEMUKAN TIDAK PARITAS (mock lebih longgar dari model). Test yang
// menandai "KETIDAKSESUAIAN" sengaja meng-characterization-kan perilaku mock saat ini +
// source-grep sisi model, supaya divergensi terlihat, tidak disembunyikan. Detail di
// docs/test-report.md.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

process.env.NEXT_PUBLIC_MOCK_DELAY = "0";

const AKAR = path.join(__dirname, "..");

// ---- Loader TypeScript -> CJS (tanpa mengubah file produksi) -----------------
// 1) hook .ts; 2) resolver untuk import relatif tanpa ekstensi (../format -> ../format.ts).
Module._extensions[".ts"] = function (m, filename) {
  const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  m._compile(js, filename);
};
const _resolveAsli = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, opts) {
  try {
    return _resolveAsli.call(this, request, parent, isMain, opts);
  } catch (e) {
    if (request.startsWith(".") && parent && parent.filename) {
      const base = path.resolve(path.dirname(parent.filename), request);
      for (const ext of [".ts", ".tsx"]) {
        if (fs.existsSync(base + ext)) return base + ext;
      }
      if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
        for (const ext of [".ts", ".tsx", ".js"]) {
          const idx = path.join(base, "index" + ext);
          if (fs.existsSync(idx)) return idx;
        }
      }
    }
    throw e;
  }
};

const TS_MOCK = ["mock.ts", "mock-data.ts", "normalisasi.ts"].map((f) =>
  path.join(AKAR, "lib", "dashboard", "data", f)
);

/** Muat ulang mock.ts segar (buang cache) -> store + MOCK_SESSION kembali ke seed. */
function muatSegar() {
  for (const f of TS_MOCK) delete require.cache[f];
  const mock = require(TS_MOCK[0]);
  const mockData = require(TS_MOCK[1]);
  return { mock, mockData };
}

// Helper skenario -----------------------------------------------------------------
const SUMBER = "ONLINE"; // seed hanya ONLINE + D12; ONLINE punya qty_per_gudang via stok_gudang_online
const KODE = "BRG-001"; // seed stok_gudang_online = 42

/** Datasource owner (uid mock 900001, role owner). */
function dsOwner({ mock }) {
  return mock.makeMockDataSource(() => "owner");
}

/** Buat permintaan 2 tujuan dengan qty BEDA; return { ds, id, t0, t1 }. */
async function buatDuaTujuan(mock, { qty0 = 2, qty1 = 3, penerima = null } = {}) {
  const ds = dsOwner({ mock });
  const g1 = (await ds.tambahGudang({ aksi: "tambah", nama: "Gudang Paritas A" })).gudang.gudang_id;
  const g2 = (await ds.tambahGudang({ aksi: "tambah", nama: "Gudang Paritas B" })).gudang.gudang_id;
  const r = await ds.buatPermintaanGudang({
    dari_gudang_id: SUMBER,
    items: [{ kode_barang: KODE, qty: qty0 + qty1 }],
    tujuan: [
      { tipe: "gudang", id: g1, user_penerima_id: penerima, items: [{ kode_barang: KODE, qty: qty0 }] },
      { tipe: "gudang", id: g2, items: [{ kode_barang: KODE, qty: qty1 }] },
    ],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { ds, id: r.permintaan.id, t0: g1, t1: g2 };
}

async function qtyGudang(ds, gudangId) {
  const baris = await ds.listStock({ gudang_id: gudangId, is_online: "semua" });
  return baris.find((b) => b.kode_barang === KODE)?.stok_gudang_online ?? 0;
}

beforeEach(() => {
  // muatSegar dipanggil per-test; hook tidak perlu reset manual.
});

// ---------------------------------------------------------------------------
// 1. Tujuan hanya gudang + status_kirim per tujuan (aturan 1 & 2)
// ---------------------------------------------------------------------------
test("buat: tipe tujuan dinormalisasi ke gudang, tiap tujuan status_kirim 'menunggu'", async () => {
  const { mock } = muatSegar();
  const { id, t0, t1 } = await buatDuaTujuan(mock);
  const dok = (await dsOwner({ mock }).listPermintaanGudang()).find((d) => d.id === id);
  assert.equal(dok.tujuan.length, 2);
  for (const t of dok.tujuan) {
    assert.equal(t.tipe, "gudang", "mock v5.1 memaksa tipe gudang");
    assert.equal(t.status_kirim, "menunggu");
    assert.equal(t.status, "menunggu");
  }
  assert.deepEqual(dok.tujuan.map((t) => t.id), [t0, t1]);
  assert.deepEqual(dok.tujuan_ids, ["gudang:" + t0, "gudang:" + t1]);
});

// ---------------------------------------------------------------------------
// 2. status_kirim per tujuan INDEPENDEN (aturan 2)
// ---------------------------------------------------------------------------
test("setujui tujuan 0: hanya status_kirim tujuan 0 maju, dokumen jadi 'disetujui'", async () => {
  const { mock } = muatSegar();
  const { ds, id } = await buatDuaTujuan(mock);
  const r = await ds.setujuiTujuanGudang({ id, tujuan_index: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.permintaan.tujuan[0].status_kirim, "disetujui");
  assert.equal(r.permintaan.tujuan[1].status_kirim, "menunggu");
  // Paritas hitungStatusDokumen: sebagian disetujui -> dokumen "disetujui".
  assert.equal(r.permintaan.status, "disetujui");
});

// ---------------------------------------------------------------------------
// 3. items per tujuan (qty boleh beda) (aturan 4)
// ---------------------------------------------------------------------------
test("items per tujuan tersimpan terpisah (qty 2 dan 3 tidak digabung)", async () => {
  const { mock } = muatSegar();
  const { id } = await buatDuaTujuan(mock, { qty0: 2, qty1: 7 });
  const dok = (await dsOwner({ mock }).listPermintaanGudang()).find((d) => d.id === id);
  assert.deepEqual(dok.tujuan[0].items, [{ kode_barang: KODE, qty: 2 }]);
  assert.deepEqual(dok.tujuan[1].items, [{ kode_barang: KODE, qty: 7 }]);
  // items dokumen tetap daftar acuan (total).
  assert.deepEqual(dok.items, [{ kode_barang: KODE, qty: 9 }]);
});

// ---------------------------------------------------------------------------
// 4. user_penerima_id + snapshot nama (aturan 3)
// ---------------------------------------------------------------------------
test("penerima tujuan disimpan id + snapshot nama admin", async () => {
  const { mock, mockData } = muatSegar();
  const ds = dsOwner({ mock });
  const g1 = (await ds.tambahGudang({ aksi: "tambah", nama: "Gudang Penerima" })).gudang.gudang_id;
  await ds.setGudangUser({ target_user_id: "900002", gudang_id: g1 });
  const r = await ds.buatPermintaanGudang({
    dari_gudang_id: SUMBER,
    items: [{ kode_barang: KODE, qty: 1 }],
    tujuan: [{ tipe: "gudang", id: g1, user_penerima_id: "900002" }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.permintaan.tujuan[0].user_penerima_id, "900002");
  assert.equal(typeof r.permintaan.tujuan[0].user_penerima_nama, "string");
  assert.equal(r.permintaan.tujuan[0].user_penerima_nama, "Siti Admin");
  void mockData;
});

// ---------------------------------------------------------------------------
// 5. Gate setujui = penerima tujuan atau owner (aturan 5)
// ---------------------------------------------------------------------------
test("gate setujui: non-penerima non-owner ditolak; penerima diterima", async () => {
  const { mock, mockData } = muatSegar();
  const ds = dsOwner({ mock });
  const g1 = (await ds.tambahGudang({ aksi: "tambah", nama: "Gudang Gate" })).gudang.gudang_id;
  await ds.setGudangUser({ target_user_id: "900002", gudang_id: g1 });
  const r = await ds.buatPermintaanGudang({
    dari_gudang_id: SUMBER,
    items: [{ kode_barang: KODE, qty: 1 }],
    tujuan: [{ tipe: "gudang", id: g1, user_penerima_id: "900002" }],
  });
  const id = r.permintaan.id;

  // Stranger non-owner -> ditolak.
  mockData.MOCK_SESSION.user.id = "900099";
  mockData.MOCK_SESSION.gudangId = null;
  const stranger = mock.makeMockDataSource(() => "admin");
  const tolak = await stranger.setujuiTujuanGudang({ id, tujuan_index: 0 });
  assert.equal(tolak.ok, false);
  assert.equal(tolak.error, "Hanya penerima tujuan ini yang dapat menyetujui.");

  // Penerima (900002) -> diterima.
  mockData.MOCK_SESSION.user.id = "900002";
  mockData.MOCK_SESSION.gudangId = g1;
  const penerima = mock.makeMockDataSource(() => "admin");
  const ok = await penerima.setujuiTujuanGudang({ id, tujuan_index: 0 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.permintaan.tujuan[0].status_kirim, "disetujui");
});

// ---------------------------------------------------------------------------
// 6. Gate terima = pembuat atau owner (aturan 6)
// ---------------------------------------------------------------------------
test("gate terima: non-pembuat non-owner ditolak; pembuat diterima", async () => {
  const { mock, mockData } = muatSegar();
  // Gudang kerja admin 900002 diarahkan ke ONLINE (punya stok seed) supaya kirim bisa sukses.
  const owner0 = mock.makeMockDataSource(() => "owner");
  await owner0.setGudangUser({ target_user_id: "900002", gudang_id: SUMBER });
  // Admin 900002 membuat permintaan dari gudangnya (ONLINE) ke D12.
  mockData.MOCK_SESSION.user.id = "900002";
  mockData.MOCK_SESSION.gudangId = SUMBER;
  const admin = mock.makeMockDataSource(() => "admin");
  const r = await admin.buatPermintaanGudang({
    dari_gudang_id: SUMBER,
    items: [{ kode_barang: KODE, qty: 1 }],
    tujuan: [{ tipe: "gudang", id: "D12" }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = r.permintaan.id;
  assert.equal(r.permintaan.created_by, "900002");

  // Setujui + kirim sebagai owner (fallback) supaya entri berstatus_kirim "dikirim".
  mockData.MOCK_SESSION.user.id = "900001";
  mockData.MOCK_SESSION.gudangId = null;
  const owner = mock.makeMockDataSource(() => "owner");
  await owner.setujuiTujuanGudang({ id, tujuan_index: 0 });
  await owner.kirimPermintaanGudang({ id, tujuan_index: 0 });

  // Stranger -> ditolak.
  mockData.MOCK_SESSION.user.id = "900099";
  const stranger = mock.makeMockDataSource(() => "admin");
  const tolak = await stranger.terimaPermintaanGudang({ id, tujuan_index: 0 });
  assert.equal(tolak.ok, false);
  assert.equal(tolak.error, "Hanya pembuat permintaan yang dapat mengonfirmasi.");

  // Pembuat (900002) -> diterima.
  mockData.MOCK_SESSION.user.id = "900002";
  const pembuat = mock.makeMockDataSource(() => "admin");
  const ok = await pembuat.terimaPermintaanGudang({ id, tujuan_index: 0 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.permintaan.tujuan[0].status, "diterima");
});

// ---------------------------------------------------------------------------
// 7. kirim turunkan stok asal sebesar qty tujuan itu saja (aturan 7)
// ---------------------------------------------------------------------------
test("kirim per tujuan: stok asal turun hanya sebesar qty tujuan itu (bertahap)", async () => {
  const { mock } = muatSegar();
  const { ds, id } = await buatDuaTujuan(mock, { qty0: 2, qty1: 3 });
  assert.equal(await qtyGudang(ds, SUMBER), 42, "stok awal seed");

  await ds.setujuiTujuanGudang({ id, tujuan_index: 0 });
  let r = await ds.kirimPermintaanGudang({ id, tujuan_index: 0 });
  assert.equal(r.ok, true);
  assert.equal(await qtyGudang(ds, SUMBER), 40, "turun 2 saja, bukan total 5");

  await ds.setujuiTujuanGudang({ id, tujuan_index: 1 });
  r = await ds.kirimPermintaanGudang({ id, tujuan_index: 1 });
  assert.equal(r.ok, true);
  assert.equal(await qtyGudang(ds, SUMBER), 37, "turun 3 lagi -> total 5");
  // Kedua tujuan sudah dikirim -> dokumen "dikirim".
  assert.equal(r.permintaan.status, "dikirim");
});

// ---------------------------------------------------------------------------
// 8. P6: semua tujuan final TIDAK auto-'selesai' (aturan 9)
// ---------------------------------------------------------------------------
test("P6: setelah semua tujuan diterima, dokumen tetap 'dikirim' (bukan 'selesai')", async () => {
  const { mock } = muatSegar();
  const { ds, id } = await buatDuaTujuan(mock);
  for (const i of [0, 1]) {
    await ds.setujuiTujuanGudang({ id, tujuan_index: i });
    await ds.kirimPermintaanGudang({ id, tujuan_index: i });
    await ds.terimaPermintaanGudang({ id, tujuan_index: i });
  }
  const dok = (await ds.listPermintaanGudang()).find((d) => d.id === id);
  assert.ok(dok.tujuan.every((t) => t.status === "diterima"), "semua tujuan final");
  assert.equal(dok.status, "dikirim", "P6: selesai butuh aksi eksplisit, bukan turunan");
});

// ---------------------------------------------------------------------------
// 9. selesai syarat semua tujuan final (aturan 8) + hasil akhir 'selesai'
// ---------------------------------------------------------------------------
test("selesai: ditolak saat ada tujuan belum final; sukses saat semua final", async () => {
  const { mock } = muatSegar();
  const ds = dsOwner({ mock });

  // Satu tujuan: kirim, belum terima -> selesai ditolak.
  const { id } = await buatDuaTujuan(mock);
  await ds.setujuiTujuanGudang({ id, tujuan_index: 0 });
  await ds.kirimPermintaanGudang({ id, tujuan_index: 0 });
  const awal = await ds.selesaiPermintaanGudang({ id });
  assert.equal(awal.ok, false);
  assert.equal(awal.error, "Masih ada tujuan yang belum selesai.");

  // Lengkapi semua tujuan -> selesai sukses.
  await ds.terimaPermintaanGudang({ id, tujuan_index: 0 });
  await ds.setujuiTujuanGudang({ id, tujuan_index: 1 });
  await ds.kirimPermintaanGudang({ id, tujuan_index: 1 });
  await ds.terimaPermintaanGudang({ id, tujuan_index: 1 });
  const akhir = await ds.selesaiPermintaanGudang({ id });
  assert.equal(akhir.ok, true, JSON.stringify(akhir));
  assert.equal(akhir.status, "selesai");
});

// ---------------------------------------------------------------------------
// 10. KETIDAKSESUAIAN: tipe tujuan "user" diterima mock, ditolak model
// ---------------------------------------------------------------------------
test("PARITAS tipe user: mock MENOLAK seperti model", async () => {
  const { mock } = muatSegar();
  const ds = dsOwner({ mock });
  const r = await ds.buatPermintaanGudang({
    dari_gudang_id: SUMBER,
    items: [{ kode_barang: KODE, qty: 1 }],
    tujuan: [{ tipe: "user", id: "900002" }],
  });
  // PARITAS: mock menolak tipe user sama seperti model (divergensi sudah ditutup).
  assert.equal(r.ok, false, "mock menolak tipe user (paritas model)");
  assert.equal(r.error, "Tujuan hanya boleh gudang.");
});

test("KETIDAKSESUAIAN tipe user: model permintaanGudang.js memuat penolakan 'Tujuan hanya boleh gudang.'", () => {
  const src = fs.readFileSync(path.join(AKAR, "lib", "models", "permintaanGudang.js"), "utf8");
  assert.ok(/tipe !== "gudang"/.test(src), "model menolak tipe selain gudang");
  assert.ok(src.includes("Tujuan hanya boleh gudang."), "pesan penolakan ada di model");
});

// ---------------------------------------------------------------------------
// 11. KETIDAKSESUAIAN: mock tidak memvalidasi gudang tujuan / qty / penerima gudang
// ---------------------------------------------------------------------------
test("PARITAS validasi buat: mock menolak gudang tak dikenal/qty invalid/stok hilang", async () => {
  const { mock } = muatSegar();
  const ds = dsOwner({ mock });

  const takDikenal = await ds.buatPermintaanGudang({
    dari_gudang_id: SUMBER,
    items: [{ kode_barang: KODE, qty: 1 }],
    tujuan: [{ tipe: "gudang", id: "GUDANG-TIDAK-ADA" }],
  });
  assert.equal(takDikenal.ok, false, "mock cek gudang tujuan (paritas model)");
  assert.equal(takDikenal.error, "Gudang tujuan tidak dikenal.");

  const qtyNol = await ds.buatPermintaanGudang({
    dari_gudang_id: SUMBER,
    items: [{ kode_barang: KODE, qty: 0 }],
    tujuan: [{ tipe: "gudang", id: "D12" }],
  });
  assert.equal(qtyNol.ok, false, "mock cek qty integer >= 1 (paritas model)");
  assert.equal(qtyNol.error, "Jumlah item harus bilangan bulat >= 1.");

  const stokHilang = await ds.buatPermintaanGudang({
    dari_gudang_id: SUMBER,
    items: [{ kode_barang: "TIDAK-ADA", qty: 1 }],
    tujuan: [{ tipe: "gudang", id: "D12" }],
  });
  assert.equal(stokHilang.ok, false, "mock cek stok kode (paritas model)");
  assert.equal(stokHilang.error, "Stok produk tidak ditemukan.");
});

test("PARITAS validasi buat: pesan penolakan ada di model DAN mock.ts", () => {
  const model = fs.readFileSync(path.join(AKAR, "lib", "models", "permintaanGudang.js"), "utf8");
  const mockSrc = fs.readFileSync(path.join(AKAR, "lib", "dashboard", "data", "mock.ts"), "utf8");
  // Catatan: "Stok produk tidak ditemukan." TIDAK dimasukkan - mock.ts memuatnya di jalur
  // kirim (stok asal), hanya TIDAK di jalur buat. Itu sendiri bagian dari divergensi.
  for (const pesan of [
    "Gudang tujuan tidak dikenal.",
    "Jumlah item harus bilangan bulat >= 1.",
    "Gudang asal tidak boleh jadi tujuan.",
    "Penerima harus dari gudang tujuan.",
  ]) {
    assert.ok(model.includes(pesan), "model memuat: " + pesan);
    // PARITAS: mock juga memuat pesan yang sama (divergensi sudah ditutup).
    assert.ok(mockSrc.includes(pesan), "mock.ts memuat (paritas): " + pesan);
  }
});

// ---------------------------------------------------------------------------
// 12. KETIDAKSESUAIAN: penerima tidak divalidasi berasal dari gudang tujuan (Q3)
// ---------------------------------------------------------------------------
test("PARITAS penerima: mock menolak admin luar gudang tujuan (Q3)", async () => {
  const { mock } = muatSegar();
  const ds = dsOwner({ mock });
  const g1 = (await ds.tambahGudang({ aksi: "tambah", nama: "Gudang Q3" })).gudang.gudang_id;
  // 900002 tergabung di D12, BUKAN g1.
  const r = await ds.buatPermintaanGudang({
    dari_gudang_id: SUMBER,
    items: [{ kode_barang: KODE, qty: 1 }],
    tujuan: [{ tipe: "gudang", id: g1, user_penerima_id: "900002" }],
  });
  // PARITAS: mock menolak penerima dari luar gudang tujuan (Q3), sama seperti model.
  assert.equal(r.ok, false, "mock menolak penerima luar gudang (paritas model)");
  assert.equal(r.error, "Penerima harus dari gudang tujuan.");
});
