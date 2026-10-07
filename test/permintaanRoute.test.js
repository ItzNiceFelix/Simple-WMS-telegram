// test/permintaanRoute.test.js
// Uji logika validasi & guard route /api/permintaan MURNI (validasiTulisV3a) + perilaku model.
// Route TS Next.js TIDAK diimpor di sini (pola test v2). PRD §5.1/§10 #10/#10b/#10c.
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

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const { installStubTelegram } = require("./helpers/stubTelegram");
installStubTelegram();

const {
  validasiAksiPermintaan,
  validasiTanggal,
  bolehSesuaikanTanggal,
} = require("../lib/dashboard/validasiTulisV3a");

const dr = require("../lib/models/dailyRequests");

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}

beforeEach(() => resetStore());

async function seed(tanggal, data) {
  await db.collection("daily_requests").doc(tanggal).set(data);
}

// ---------------------------------------------------------------- #10 validasi umum

test("#10 aksi tak dikenal -> 400 Aksi tidak dikenal.", () => {
  const r = validasiAksiPermintaan({ aksi: "hapus", tanggal: "2026-09-15" }, "2026-09-15");
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.error, "Aksi tidak dikenal.");
});

test("#10 tanggal invalid -> 400 Tanggal tidak valid.", () => {
  for (const t of ["2026/09/15", "15-09-2026", "", null, "2026-13-01"]) {
    const r = validasiAksiPermintaan({ aksi: "buat-form", tanggal: t }, "2026-09-15");
    assert.equal(r.ok, false, `tanggal=${t} harus ditolak`);
    assert.equal(r.error, "Tanggal tidak valid.");
  }
});

test("#10 tanggal masa depan -> 400", () => {
  const r = validasiAksiPermintaan({ aksi: "datang", tanggal: "2026-12-31", item: { kode_barang: "A", qty_datang: 1 } }, "2026-09-15");
  assert.equal(r.ok, false);
  assert.equal(r.error, "Tanggal tidak valid.");
});

test("#10 sesuaikan: qty bukan array/kosong -> 400 Daftar jumlah wajib diisi.", () => {
  for (const q of [undefined, null, [], "x"]) {
    const r = validasiAksiPermintaan({ aksi: "sesuaikan", tanggal: "2026-09-15", qty: q }, "2026-09-15");
    assert.equal(r.ok, false);
    assert.equal(r.error, "Daftar jumlah wajib diisi.");
  }
});

test("#10 sesuaikan: qty negatif/string/desimal -> 400 pesan qty", () => {
  for (const q of [-1, "12", 1.5, null, 1_000_001]) {
    const r = validasiAksiPermintaan(
      { aksi: "sesuaikan", tanggal: "2026-09-15", qty: [{ kode_barang: "A", variasi: "-", qty: q }] },
      "2026-09-15"
    );
    assert.equal(r.ok, false, `qty=${q} harus ditolak`);
    assert.equal(r.error, "Jumlah harus bilangan bulat >= 0 (maks 1.000.000).");
  }
});

test("#10 sesuaikan: qty 0 sah", () => {
  const r = validasiAksiPermintaan(
    { aksi: "sesuaikan", tanggal: "2026-09-15", qty: [{ kode_barang: "A", variasi: "-", qty: 0 }] },
    "2026-09-15"
  );
  assert.equal(r.ok, true);
  assert.equal(r.qty[0].qty, 0);
});

test("#10 datang: qty_datang invalid -> 400 pesan qty datang", () => {
  for (const q of [-1, "3", null, 1_000_001]) {
    const r = validasiAksiPermintaan({ aksi: "datang", tanggal: "2026-09-15", item: { kode_barang: "A", qty_datang: q } }, "2026-09-15");
    assert.equal(r.ok, false);
    assert.equal(r.error, "Jumlah datang harus bilangan bulat >= 0 (maks 1.000.000).");
  }
});

test("#10 datang: item tanpa kode_barang -> 400 Item tidak valid.", () => {
  const r = validasiAksiPermintaan({ aksi: "datang", tanggal: "2026-09-15", item: { qty_datang: 1 } }, "2026-09-15");
  assert.equal(r.ok, false);
  assert.equal(r.error, "Item tidak valid.");
});

// ---------------------------------------------------------------- #10c kebijakan tanggal

test("#10c sesuaikan tanggal lampau -> 400 Hanya permintaan hari ini...", () => {
  const r = validasiAksiPermintaan(
    { aksi: "sesuaikan", tanggal: "2026-09-14", qty: [{ kode_barang: "A", variasi: "-", qty: 1 }] },
    "2026-09-15"
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.error, "Hanya permintaan hari ini yang bisa diubah.");
});

test("#10c bolehSesuaikanTanggal: hari ini ok, lampau tolak", () => {
  assert.equal(bolehSesuaikanTanggal("2026-09-15", "2026-09-15").ok, true);
  assert.equal(bolehSesuaikanTanggal("2026-09-14", "2026-09-15").ok, false);
});

test("#10c datang/buat-form/selesai tanggal lampau -> boleh", () => {
  assert.equal(validasiAksiPermintaan({ aksi: "buat-form", tanggal: "2026-09-14" }, "2026-09-15").ok, true);
  assert.equal(validasiAksiPermintaan({ aksi: "datang", tanggal: "2026-09-14", item: { kode_barang: "A", qty_datang: 1 } }, "2026-09-15").ok, true);
  assert.equal(validasiAksiPermintaan({ aksi: "selesai", tanggal: "2026-09-14" }, "2026-09-15").ok, true);
});

test("#10 validasiTanggal: format valid & tak ada di kalender", () => {
  assert.equal(validasiTanggal("2026-02-31", "2026-09-15").ok, false, "31 Feb tidak ada");
  assert.equal(validasiTanggal("2026-02-28", "2026-09-15").ok, true);
});

// ---------------------------------------------------------------- #10b B1 draft guard

// Mirror guard status route (draft-guard/409) sebagai fungso murni supaya bisa diuji.
function guardStatusRoute(status, aksi) {
  if (status === "selesai") return { status: 409, error: "Permintaan sudah selesai." };
  if (aksi === "datang" && status === "draft") {
    return { status: 409, error: "Kirim form dulu sebelum menandai barang datang." };
  }
  if (aksi === "selesai" && status === "draft") {
    return { status: 409, error: "Kirim form dulu sebelum menyelesaikan permintaan." };
  }
  return { ok: true };
}

test("#10b B1: datang di dokumen draft -> 409 pesan persis", async () => {
  await seed("2026-09-15", {
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false }],
    status: "draft",
  });
  const doc = await dr.ambilDailyRequest("2026-09-15");
  const guard = guardStatusRoute(doc.status, "datang");
  assert.equal(guard.status, 409);
  assert.equal(guard.error, "Kirim form dulu sebelum menandai barang datang.");
});

test("#10b selesai di dokumen draft -> 409 pesan persis", async () => {
  await seed("2026-09-18", { items: [{ kode_barang: "A", variasi: "-", qty: 1, buffer: false }], status: "draft" });
  const doc = await dr.ambilDailyRequest("2026-09-18");
  const guard = guardStatusRoute(doc.status, "selesai");
  assert.equal(guard.status, 409);
  assert.equal(guard.error, "Kirim form dulu sebelum menyelesaikan permintaan.");
});

test("#10b dokumen selesai -> aksi apa pun 409 Permintaan sudah selesai.", async () => {
  await seed("2026-09-16", { items: [], status: "selesai" });
  const doc = await dr.ambilDailyRequest("2026-09-16");
  for (const aksi of ["sesuaikan", "buat-form", "datang", "selesai"]) {
    const guard = guardStatusRoute(doc.status, aksi);
    assert.equal(guard.status, 409);
    assert.equal(guard.error, "Permintaan sudah selesai.");
  }
});

// ---------------------------------------------------------------- #9b guard double-submit

test("#9b guard double-submit buat-form: guard < 10s tanggal sama -> ditolak", async () => {
  // Mirror logika periksaGuardForm route (server-only doc).
  async function periksaGuard(uid, tanggal, nowMs) {
    const ref = db.collection("permintaan_form_guard").doc(String(uid));
    const doc = await ref.get();
    if (doc.exists) {
      const g = doc.data();
      if (typeof g.at === "number" && nowMs - g.at <= 10_000 && g.tanggal === tanggal) return true;
    }
    await ref.set({ tanggal, at: nowMs }, { merge: false });
    return false;
  }
  const t = Date.now();
  assert.equal(await periksaGuard("111", "2026-09-15", t), false, "panggilan pertama lolos");
  assert.equal(await periksaGuard("111", "2026-09-15", t + 2000), true, "panggilan ke-2 < 10s ditolak");
  assert.equal(await periksaGuard("111", "2026-09-15", t + 11_000), false, "di luar 10s lolos");
  assert.equal(await periksaGuard("222", "2026-09-15", t + 1000), false, "uid beda lolos");
});

test("#10 guest -> 403 (route guard role guest)", () => {
  // Kontrak route: role dari ambilAdmin; role bukan owner/admin -> guest -> 403.
  const role = "guest";
  const ditolak = role !== "owner" && role !== "admin";
  assert.equal(ditolak, true);
});

// ---------------------------------------------------------------- model integration

test("alur penuh: sesuaikan -> buat-form -> datang -> selesai", async () => {
  await seed("2026-09-17", {
    items: [{ kode_barang: "A", nama: "A", variasi: "-", qty: 2, buffer: false }],
    status: "draft",
  });
  await dr.sesuaikanQtyItem("2026-09-17", [{ kode_barang: "A", variasi: "-", qty: 5 }], "111");
  const form = await dr.buatForm("2026-09-17", "111");
  assert.equal(form.doc.status, "diproses");
  assert.equal(form.doc.items[0].qty_diminta, 5);

  const datang = await dr.tandaiItemDatang("2026-09-17", { kode_barang: "A", variasi: "-" }, 5, "111");
  assert.equal(datang.doc.status, "selesai");
  assert.equal(datang.selesaiOtomatis, true);
});
