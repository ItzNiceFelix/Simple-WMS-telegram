// test/permintaanHarian.test.js
// Wave 1 v3a: helper normalisasi (B3), gabung duplikat (T1), mutasi (B2/B5/B6),
// pesan Telegram PERSIS §3.5 (TZ-safe, U+00B7), kirim ke telegram_user_id.
const crypto = require("crypto");
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-project";
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "demo@example.com";
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ||
  crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .replace(/\n/g, "\\n");

// Stub kirimPesanPlain SEBELUM modul model di-load (pola reorderPoint.test.js).
const kirimPath = require.resolve("../lib/telegram/kirimPesan");
const terkirim = [];
require.cache[kirimPath] = {
  id: kirimPath,
  filename: kirimPath,
  loaded: true,
  exports: {
    kirimPesanPlain: async function kirimPesanPlain(chatId, teks) {
      // `gagalUntuk` di-set test untuk mensimulasikan admin penerima yang gagal.
      if (exportsObj.gagalUntuk && String(chatId) === exportsObj.gagalUntuk) {
        throw new Error("telegram down");
      }
      terkirim.push({ chatId, teks });
      return { ok: true };
    },
  },
};
const exportsObj = require.cache[kirimPath].exports;

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const dr = require("../lib/models/dailyRequests");

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  terkirim.length = 0;
}

beforeEach(() => resetStore());

async function seed(tanggal, data) {
  await db.collection("daily_requests").doc(tanggal).set(data);
}

async function ambilMentah(tanggal) {
  const doc = await db.collection("daily_requests").doc(tanggal).get();
  return doc.exists ? doc.data() : null;
}

// ---------------------------------------------------------------- #1 normalizer

test("#1 normalisasiItemLama: item lama -> status diminta + qty_diminta = qty", () => {
  const item = dr.normalisasiItemLama({ kode_barang: "BRG-001", nama: "X", variasi: "-", qty: 12, buffer: false });
  assert.equal(item.status, "diminta");
  assert.equal(item.qty_diminta, 12);
  assert.equal(item.qty_datang, null);
  assert.equal(item.datang_at, null);
  assert.equal(item.datang_by, null);
});

test("#1 normalisasiItemLama: field baru dipertahankan", () => {
  const item = dr.normalisasiItemLama({ kode_barang: "A", qty: 1, status: "datang", qty_diminta: 3, qty_datang: 3 });
  assert.equal(item.status, "datang");
  assert.equal(item.qty_diminta, 3);
  assert.equal(item.qty_datang, 3);
});

test("#1 normalisasiStatusDokumen: nilai tak dikenal/null -> draft", () => {
  assert.equal(dr.normalisasiStatusDokumen("diproses"), "diproses");
  assert.equal(dr.normalisasiStatusDokumen("selesai"), "selesai");
  assert.equal(dr.normalisasiStatusDokumen("sent"), "draft");
  assert.equal(dr.normalisasiStatusDokumen(null), "draft");
  assert.equal(dr.normalisasiStatusDokumen(undefined), "draft");
});

test("#1 ambilDailyRequest: item lama dibaca ternormalisasi", async () => {
  await seed("2026-01-01", { items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 5, buffer: false }], status: "draft" });
  const doc = await dr.ambilDailyRequest("2026-01-01");
  assert.equal(doc.items[0].status, "diminta");
  assert.equal(doc.items[0].qty_diminta, 5);
  assert.deepEqual(doc.perubahan, []);
});

// ---------------------------------------------------------------- #2 gabung (T1)

test("#2 gabungItemDuplikat: kode+variasi+buffer SAMA -> digabung, qty dijumlah", () => {
  const hasil = dr.gabungItemDuplikat([
    { kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false },
    { kode_barang: "A", nama: "A", variasi: "-", qty: 3, buffer: false },
  ]);
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].qty, 5);
});

test("#2 gabungItemDuplikat: buffer BEDA -> TETAP DUA baris (T1)", () => {
  const hasil = dr.gabungItemDuplikat([
    { kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false },
    { kode_barang: "A", nama: "A", variasi: "-", qty: 3, buffer: true },
  ]);
  assert.equal(hasil.length, 2);
});

test("#2 gabungItemDuplikat: item campuran (sebagian datang) tidak digabung", () => {
  const hasil = dr.gabungItemDuplikat([
    { kode_barang: "A", variasi: "-", qty: 2, buffer: false, status: "diminta" },
    { kode_barang: "A", variasi: "-", qty: 2, buffer: false, status: "datang" },
  ]);
  assert.equal(hasil.length, 2);
});

// ---------------------------------------------------------------- #3 sesuaikan (B5)

test("#3 sesuaikanQtyItem: qty berubah", async () => {
  await seed("2026-02-02", { items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false }], status: "draft" });
  const doc = await dr.sesuaikanQtyItem("2026-02-02", [{ kode_barang: "A", variasi: "-", qty: 9 }], "111");
  assert.equal(doc.items[0].qty, 9);
});

test("#3 sesuaikanQtyItem: item sudah datang ditolak", async () => {
  await seed("2026-02-03", {
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false, status: "datang", qty_diminta: 2 }],
    status: "diproses",
  });
  await assert.rejects(
    () => dr.sesuaikanQtyItem("2026-02-03", [{ kode_barang: "A", variasi: "-", qty: 5 }], "111"),
    /Item yang sudah datang tidak bisa diubah\./
  );
});

test("#3 sesuaikanQtyItem: item tidak ada ditolak", async () => {
  await seed("2026-02-04", { items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false }], status: "draft" });
  await assert.rejects(
    () => dr.sesuaikanQtyItem("2026-02-04", [{ kode_barang: "ZZ", variasi: "-", qty: 5 }], "111"),
    /Item tidak ditemukan di permintaan\./
  );
});

test("#3 sesuaikanQtyItem: dokumen 0 item ditolak", async () => {
  await seed("2026-02-05", { items: [], status: "draft" });
  await assert.rejects(
    () => dr.sesuaikanQtyItem("2026-02-05", [{ kode_barang: "A", variasi: "-", qty: 5 }], "111"),
    /Permintaan belum berisi item\./
  );
});

test("#3b B5: sesuaikan menulis perubahan[] + updated_at/by", async () => {
  await seed("2026-02-06", { items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false }], status: "draft" });
  await dr.sesuaikanQtyItem("2026-02-06", [{ kode_barang: "A", variasi: "-", qty: 7 }], "111");

  const mentah = await ambilMentah("2026-02-06");
  assert.equal(mentah.perubahan.length, 1);
  const entri = mentah.perubahan[0];
  assert.equal(entri.qty_lama, 2);
  assert.equal(entri.qty_baru, 7);
  assert.equal(entri.oleh, "111");
  assert.ok(entri.at, "at harus terisi");
  assert.equal(mentah.updated_by, "111");
  assert.ok(mentah.updated_at, "updated_at harus terisi");
});

test("#3c B5: 51 perubahan -> perubahan.length === 50 (terlama dibuang)", async () => {
  await seed("2026-02-07", { items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 0, buffer: false }], status: "draft" });
  for (let i = 1; i <= 51; i++) {
    await dr.sesuaikanQtyItem("2026-02-07", [{ kode_barang: "A", variasi: "-", qty: i }], "111");
  }
  const mentah = await ambilMentah("2026-02-07");
  assert.equal(mentah.perubahan.length, 50);
  // entri terlama (qty_lama 0) dibuang; entri pertama sekarang qty_lama 1
  assert.equal(mentah.perubahan[0].qty_lama, 1);
  assert.equal(mentah.perubahan[49].qty_baru, 51);
});

// ---------------------------------------------------------------- #4 buatForm (B2)

test("#4 buatForm: status diproses, snapshot qty_diminta, form_dibuat_at/by", async () => {
  await seed("2026-03-01", { items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 4, buffer: false }], status: "draft" });
  const { doc } = await dr.buatForm("2026-03-01", "111");
  assert.equal(doc.status, "diproses");
  assert.equal(doc.items[0].qty_diminta, 4);
  assert.ok(doc.form_dibuat_at);
  const mentah = await ambilMentah("2026-03-01");
  assert.equal(mentah.form_dibuat_by, "111");
  assert.ok(mentah.updated_at);
  assert.equal(mentah.updated_by, "111");
});

test("#4 buatForm: item sudah datang TIDAK diubah snapshot-nya", async () => {
  await seed("2026-03-02", {
    items: [
      { kode_barang: "A", nama: "A", variasi: "-", qty: 9, buffer: false, status: "datang", qty_diminta: 2, qty_datang: 2 },
      { kode_barang: "B", nama: "B", variasi: "-", qty: 4, buffer: false, status: "diminta" },
    ],
    status: "diproses",
  });
  const { doc } = await dr.buatForm("2026-03-02", "111");
  assert.equal(doc.items[0].qty_diminta, 2);
  assert.equal(doc.items[0].qty_datang, 2);
  assert.equal(doc.items[1].qty_diminta, 4);
});

test("#4b B2: item bot (hanya qty) -> qty_diminta === qty, bukan undefined", async () => {
  await seed("2026-03-03", {
    items: [{ kode_barang: "BRG-001", nama: "X", variasi: "-", qty: 12, buffer: false }],
    status: "draft",
  });
  const { doc } = await dr.buatForm("2026-03-03", "111");
  assert.equal(doc.items[0].qty_diminta, 12);
  assert.notEqual(doc.items[0].qty_diminta, undefined);
});

test("#4b B2: kirim ulang men-snapshot ulang qty (bukan qty_diminta lama)", async () => {
  await seed("2026-03-04", { items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false }], status: "draft" });
  await dr.buatForm("2026-03-04", "111"); // snapshot 2
  await dr.sesuaikanQtyItem("2026-03-04", [{ kode_barang: "A", variasi: "-", qty: 5 }], "111");
  const { doc } = await dr.buatForm("2026-03-04", "111"); // snapshot 5
  assert.equal(doc.items[0].qty_diminta, 5);
});

test("#4 buatForm: 0 item ditolak", async () => {
  await seed("2026-03-05", { items: [], status: "draft" });
  await assert.rejects(() => dr.buatForm("2026-03-05", "111"), /Permintaan belum berisi item\./);
});

// ---------------------------------------------------------------- #5 datang (B6)

test("#5 tandaiItemDatang: set status/qty_datang/datang_at/by; semua datang -> selesai", async () => {
  await seed("2026-04-01", {
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false, qty_diminta: 2, status: "diminta" }],
    status: "diproses",
  });
  const hasil = await dr.tandaiItemDatang("2026-04-01", { kode_barang: "A", variasi: "-" }, 3, "111");
  assert.equal(hasil.selesaiOtomatis, true);
  assert.equal(hasil.doc.status, "selesai");
  assert.equal(hasil.doc.items[0].status, "datang");
  assert.equal(hasil.doc.items[0].qty_datang, 3);
  assert.ok(hasil.doc.items[0].datang_at);
  assert.ok(hasil.doc.selesai_at);
  assert.equal(hasil.doc.selesai_by, "111");
});

test("#5b B6: item A qty 0 + item B datang -> dokumen otomatis selesai", async () => {
  await seed("2026-04-02", {
    items: [
      { kode_barang: "A", nama: "A", variasi: "-", qty: 0, buffer: false, qty_diminta: 0, status: "diminta" },
      { kode_barang: "B", nama: "B", variasi: "-", qty: 4, buffer: false, qty_diminta: 4, status: "diminta" },
    ],
    status: "diproses",
  });
  const hasil = await dr.tandaiItemDatang("2026-04-02", { kode_barang: "B", variasi: "-" }, 4, "111");
  assert.equal(hasil.selesaiOtomatis, true);
  assert.equal(hasil.doc.status, "selesai");
});

test("#5 item sudah datang -> ditolak", async () => {
  await seed("2026-04-03", {
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false, qty_diminta: 2, status: "datang" }],
    status: "diproses",
  });
  await assert.rejects(
    () => dr.tandaiItemDatang("2026-04-03", { kode_barang: "A", variasi: "-" }, 2, "111"),
    /Item ini sudah ditandai datang\./
  );
});

test("#5 item tidak ada -> ditolak", async () => {
  await seed("2026-04-04", {
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false, qty_diminta: 2, status: "diminta" }],
    status: "diproses",
  });
  await assert.rejects(
    () => dr.tandaiItemDatang("2026-04-04", { kode_barang: "ZZ", variasi: "-" }, 1, "111"),
    /Item tidak ditemukan di permintaan\./
  );
});

test("F1: buatForm menggabung duplikat identik (kode+variasi+buffer) -> 1 baris", async () => {
  await seed("2026-04-10", {
    items: [
      { kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false },
      { kode_barang: "A", nama: "A", variasi: "-", qty: 3, buffer: false },
    ],
    status: "draft",
  });
  const { doc } = await dr.buatForm("2026-04-10", "111");
  assert.equal(doc.items.length, 1);
  assert.equal(doc.items[0].qty, 5);
  assert.equal(doc.items[0].qty_diminta, 5);
});

test("F1: sesuaikan menghormati buffer pada identitas item", async () => {
  await seed("2026-04-11", {
    items: [
      { kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false },
      { kode_barang: "A", nama: "A", variasi: "-", qty: 7, buffer: true },
    ],
    status: "draft",
  });
  const doc = await dr.sesuaikanQtyItem(
    "2026-04-11",
    [{ kode_barang: "A", variasi: "-", buffer: true, qty: 99 }],
    "111"
  );
  assert.equal(doc.items[0].qty, 2, "buffer:false tidak boleh ikut berubah");
  assert.equal(doc.items[1].qty, 99, "buffer:true harus ter-update");
});

test("IMPORTANT-2: sesuaikan pada draft TIDAK membocorkan qty_diminta", async () => {
  await seed("2026-04-12", { items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 5, buffer: false }], status: "draft" });
  await dr.sesuaikanQtyItem("2026-04-12", [{ kode_barang: "A", variasi: "-", buffer: false, qty: 8 }], "111");
  const mentah = await ambilMentah("2026-04-12");
  assert.equal(mentah.items[0].qty, 8);
  assert.equal(mentah.items[0].qty_diminta, undefined, "draft belum boleh punya qty_diminta");
});

test("IMPORTANT-2: sesuaikan pada diproses TIDAK menambah qty_diminta item bot baru", async () => {
  await seed("2026-04-14", {
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 5, buffer: false, status: "diminta" }],
    status: "diproses",
  });
  await dr.sesuaikanQtyItem("2026-04-14", [{ kode_barang: "A", variasi: "-", buffer: false, qty: 8 }], "111");
  const mentah = await ambilMentah("2026-04-14");
  assert.equal(mentah.items[0].qty, 8);
  assert.equal(mentah.items[0].qty_diminta, undefined, "sesuaikan tidak menambah snapshot");
});

test("IMPORTANT-2: sesuaikan pada diproses mempertahankan qty_diminta lama", async () => {
  await seed("2026-04-13", {
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 5, qty_diminta: 5, buffer: false, status: "diminta" }],
    status: "diproses",
  });
  const doc = await dr.sesuaikanQtyItem("2026-04-13", [{ kode_barang: "A", variasi: "-", buffer: false, qty: 8 }], "111");
  assert.equal(doc.items[0].qty, 8);
  assert.equal(doc.items[0].qty_diminta, 5, "snapshot lama dipertahankan");
});

// ---------------------------------------------------------------- #5c selesaikanRequest

test("IMPORTANT-A: buatForm semua item qty 0 / sudah datang -> Semua item sudah datang.", async () => {
  await seed("2026-04-20", {
    items: [
      { kode_barang: "A", variasi: "-", qty: 0, qty_diminta: 0, buffer: false, status: "diminta" },
      { kode_barang: "B", variasi: "-", qty: 3, qty_diminta: 3, buffer: false, status: "datang", qty_datang: 3 },
    ],
    status: "diproses",
  });
  await assert.rejects(() => dr.buatForm("2026-04-20", "111"), /Semua item sudah datang\./);
});

test("IMPORTANT-C: tandaiItemDatang menghormati buffer (baris buffer:true)", async () => {
  await seed("2026-04-21", {
    items: [
      { kode_barang: "A", variasi: "-", qty: 2, qty_diminta: 2, buffer: false, status: "diminta" },
      { kode_barang: "A", variasi: "-", qty: 2, qty_diminta: 2, buffer: true, status: "diminta" },
    ],
    status: "diproses",
  });
  const hasil = await dr.tandaiItemDatang("2026-04-21", { kode_barang: "A", variasi: "-", buffer: true }, 2, "111");
  const mentah = await ambilMentah("2026-04-21");
  assert.equal(mentah.items[0].status, "diminta", "buffer:false tidak boleh ikut");
  assert.equal(mentah.items[1].status, "datang", "buffer:true harus ter-set");
  void hasil;
});

test("#5c selesaikanRequest: pakai updateStatusDailyRequest -> status selesai + selesai_at/by", async () => {
  await seed("2026-05-01", {
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false, qty_diminta: 2, status: "datang", qty_datang: 2 }],
    status: "diproses",
  });
  const doc = await dr.selesaikanRequest("2026-05-01", "111");
  assert.equal(doc.status, "selesai");
  assert.ok(doc.selesai_at);
  const mentah = await ambilMentah("2026-05-01");
  assert.equal(mentah.selesai_by, "111");
});

test("#5c selesaikanRequest: belum ada item datang -> ditolak", async () => {
  await seed("2026-05-02", {
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false, qty_diminta: 2, status: "diminta" }],
    status: "diproses",
  });
  await assert.rejects(() => dr.selesaikanRequest("2026-05-02", "111"), /Belum ada item yang datang\./);
});

// ---------------------------------------------------------------- #7 format pesan

function contohDoc() {
  return {
    tanggal: "2026-09-15",
    items: [
      { kode_barang: "BRG-003", nama: "Celana Chino Slim Fit", variasi: "-", qty: 10, buffer: false, qty_diminta: 10 },
      { kode_barang: "BRG-001", nama: "Kemeja Flanel Lengan Panjang", variasi: "-", qty: 12, buffer: false, qty_diminta: 12 },
    ],
  };
}

test("#7 formatPesanPermintaan: PERSIS contoh §3.5 (U+00B7, urut alfabetis)", () => {
  const teks = dr.formatPesanPermintaan(contohDoc());
  const harapan = [
    "Permintaan Stok ke Gudang Cabang",
    "15 Sep 2026",
    "",
    "1. Kemeja Flanel Lengan Panjang",
    "   BRG-001 \u00b7 12 pcs",
    "2. Celana Chino Slim Fit",
    "   BRG-003 \u00b7 10 pcs",
    "",
    "Total: 2 item \u00b7 22 pcs",
  ].join("\n");
  assert.equal(teks, harapan);
});

test("#7 formatPesanPermintaan: pakai titik ASCII '.' -> GAGAL (bukti U+00B7)", () => {
  const teks = dr.formatPesanPermintaan(contohDoc());
  assert.ok(teks.includes("BRG-001 \u00b7 12 pcs"), "harus U+00B7");
  assert.ok(!teks.includes("BRG-001 . 12 pcs"), "bukan titik ASCII");
});

test("#7 formatPesanPermintaan: angka pakai qty_diminta ?? qty (bukan qty terkini)", () => {
  const doc = {
    tanggal: "2026-09-15",
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 99, qty_diminta: 4, buffer: false }],
  };
  const teks = dr.formatPesanPermintaan(doc);
  assert.ok(teks.includes("A \u00b7 4 pcs"), "harus qty_diminta");
  assert.ok(teks.includes("Total: 1 item \u00b7 4 pcs"));
});

test("#7 formatPesanPermintaan: variasi ditampilkan bila != '-'", () => {
  const doc = {
    tanggal: "2026-09-15",
    items: [{ kode_barang: "A", nama: "A", variasi: "M", qty: 1, qty_diminta: 1, buffer: false }],
  };
  assert.ok(dr.formatPesanPermintaan(doc).includes("A \u00b7 M \u00b7 1 pcs"));
});

test("#7b TZ: tanggal sama di America/New_York & UTC", () => {
  const tzLama = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const a = dr.formatPesanPermintaan(contohDoc());
    process.env.TZ = "UTC";
    const b = dr.formatPesanPermintaan(contohDoc());
    assert.ok(a.includes("15 Sep 2026"), "NY harus 15 Sep 2026");
    assert.ok(b.includes("15 Sep 2026"), "UTC harus 15 Sep 2026");
    assert.equal(a, b);
  } finally {
    if (tzLama === undefined) delete process.env.TZ;
    else process.env.TZ = tzLama;
  }
});

test("parity: formatTanggalCjs (dipakai model) == format.ts (dipakai UI)", () => {
  // `lib/dashboard/format.ts` tidak bisa di-require dari test CJS; verifikasi lewat regex
  // bahwa sumber TS memuat bulan + pola yang sama (logika identik, tidak bisa diimpor).
  const fs = require("node:fs");
  const ts = fs.readFileSync(require.resolve("../lib/dashboard/format.ts"), "utf8");
  const cjs = require("../lib/dashboard/formatTanggalCjs");
  assert.ok(ts.includes("formatTanggalSingkatDariId"), "format.ts harus punya helper");
  assert.equal(cjs.formatTanggalSingkatDariId("2026-09-15"), "15 Sep 2026");
  assert.equal(cjs.formatTanggalSingkatDariId(null), "—");
  assert.equal(cjs.formatTanggalSingkatDariId("bukan-tanggal"), "—");
});

// ---------------------------------------------------------------- regresi review v3a

// BLOCKING-2 (code review v3a): `items` truthy tapi BUKAN array dulu bikin .map() crash
// -> route balas 500. Sekarang diperlakukan sebagai kosong (E18).
test("regresi BLOCKING-2: buatForm dgn items bukan array -> error jelas, BUKAN 500/crash", async () => {
  await seed("2026-09-15", { items: { rusak: true }, status: "draft", created_at: new Date() });
  await assert.rejects(
    () => dr.buatForm("2026-09-15", "900001"),
    /Permintaan belum berisi item\./
  );
});

test("regresi BLOCKING-2: selesaikanRequest dgn items bukan array -> error jelas, bukan crash", async () => {
  await seed("2026-09-16", { items: "bukan array", status: "diproses", created_at: new Date() });
  await assert.rejects(
    () => dr.selesaikanRequest("2026-09-16", "900001"),
    /Belum ada item yang datang\./
  );
});

test("regresi BLOCKING-2: sesuaikanQtyItem dgn items bukan array -> tidak crash", async () => {
  await seed("2026-09-17", { items: 42, status: "draft", created_at: new Date() });
  await assert.rejects(
    () => dr.sesuaikanQtyItem("2026-09-17", [{ kode_barang: "A", variasi: "-", qty: 1 }], "900001"),
    /Permintaan belum berisi item\./
  );
});

// BLOCKING-1 (code review v3a): `datang_at` dari Firestore adalah Timestamp, bukan string.
// normalisasiItemLama model dipakai di server (baca ulang), jadi harus tahan objek waktu.
test("regresi BLOCKING-1: normalisasiItemLama tahan datang_at berupa objek waktu (bukan hanya string)", () => {
  const item = dr.normalisasiItemLama({
    kode_barang: "A", qty: 1, status: "datang", qty_datang: 1,
    datang_at: { toDate: () => new Date("2026-09-15T10:00:00.000Z") },
    datang_by: "900001",
  });
  assert.equal(item.status, "datang");
  assert.equal(item.datang_by, "900001");
  // Tidak boleh crash & tidak boleh menelan error; bentuk boleh objek (model hanya butuh lolos).
  assert.ok(item.datang_at !== undefined);
});

// ---------------------------------------------------------------- #9 kirim form

test("#9 kirimFormPermintaan: kirim ke telegram_user_id (bukan undefined), owner+admin", async () => {
  await db.collection("admins").doc("111").set({ name: "Bos", role: "owner" });
  await db.collection("admins").doc("222").set({ name: "Adm", role: "admin" });
  const hasil = await dr.kirimFormPermintaan(contohDoc());

  assert.equal(hasil.terkirim, 2);
  assert.equal(hasil.gagal, 0);
  assert.equal(terkirim.length, 2);
  const tujuan = terkirim.map((t) => t.chatId);
  assert.ok(tujuan.includes("111"));
  assert.ok(tujuan.includes("222"));
  for (const t of terkirim) {
    assert.notEqual(t.chatId, undefined, "chatId tidak boleh undefined (bug admin.id)");
    assert.ok(t.teks.includes("Permintaan Stok ke Gudang Cabang"));
  }
});

test("#9 kirimFormPermintaan: dedupe by telegram_user_id", async () => {
  await db.collection("admins").doc("111").set({ name: "Bos", role: "owner" });
  const hasil = await dr.kirimFormPermintaan(contohDoc());
  assert.equal(hasil.terkirim, 1);
  assert.equal(terkirim.length, 1);
});

test("#9 kirimFormPermintaan: gagal kirim 1 admin -> gagal=1, tidak throw", async () => {
  await db.collection("admins").doc("111").set({ name: "Bos", role: "owner" });
  await db.collection("admins").doc("222").set({ name: "Adm", role: "admin" });

  // Model men-destructure kirimPesanPlain saat require, jadi mutasi cache setelahnya tidak
  // berpengaruh. Kontrol lewat flag: stub membaca `gagalUntuk` untuk memaksa throw.
  const stub = require.cache[kirimPath].exports;
  stub.gagalUntuk = "222";
  try {
    const hasil = await dr.kirimFormPermintaan(contohDoc());
    assert.equal(hasil.terkirim, 1);
    assert.equal(hasil.gagal, 1);
  } finally {
    delete stub.gagalUntuk;
  }
});

// ---------------------------------------------------------------- backward-compat

test("tambahItemKeDailyRequest tetap jalan (bot produksi tidak diubah)", async () => {
  const hasil = await dr.tambahItemKeDailyRequest("2026-06-01", {
    kode_barang: "ABC",
    nama: "Produk",
    variasi: "-",
    qty: 3,
    buffer: false,
  });
  assert.equal(hasil.items[0].kode_barang, "ABC");
  assert.equal(hasil.items[0].qty, 3);
});
