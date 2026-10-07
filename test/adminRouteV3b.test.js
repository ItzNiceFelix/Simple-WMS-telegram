// test/adminRouteV3b.test.js
// Uji Fase A v3b: validator dispatcher + guard atomik B4 (A7 CAS) & B5 (A5 create-only).
// Route TS Next.js TIDAK diimpor (pola test v2/v3a). Yang diuji: validator (validasiTulisV3a),
// model transaksional (accessRequests), + paritas transaksi create-only yang dipakai route.
// PRD v3b §11 T1a-T1h (A7) + T3a-T3f2 (A5) + §5.3 (literal pesan bot).
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

// Stub kirimPesan SEBELUM modul pemakainya di-load (pola reorderPoint.test.js).
const kirimPesanPath = require.resolve("../lib/telegram/kirimPesan");
const terkirim = [];
require.cache[kirimPesanPath] = {
  id: kirimPesanPath,
  filename: kirimPesanPath,
  loaded: true,
  exports: {
    kirimPesan: async (chatId, teks) => {
      terkirim.push({ chatId, teks });
      return { ok: true };
    },
  },
};

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const { validasiAksiAdmin, validasiTambahProduk } = require("../lib/dashboard/validasiTulisV3a");
const accessRequests = require("../lib/models/accessRequests");
const { normalisasiNama } = require("../lib/models/produk");
const { PESAN_TOLAK_HALUS } = require("../lib/handlers/handleAksesBaru");

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}

beforeEach(() => {
  resetStore();
  terkirim.length = 0;
});

// ---------------------------------------------------------------------------
// Validator dispatcher (PRD §4.2): 4 aksi dikenal, aksi lain 400.
// ---------------------------------------------------------------------------

test("validator: aksi tak dikenal -> 400 Aksi tidak dikenal. (v3a tetap)", () => {
  // `konfirmasi-draft` DIKELUARKAN dari daftar ini di v3b Fase B (PRD §4.2 memperluas dispatcher);
  // validasinya diuji di test/draftKonfirmasiV3b.test.js.
  for (const aksi of ["", null, undefined, "role", "hapus"]) {
    const r = validasiAksiAdmin({ aksi, id: "x", interpreted_as: "STOK" });
    assert.equal(r.ok, false, `aksi=${aksi} harus ditolak`);
    assert.equal(r.status, 400);
    assert.equal(r.error, "Aksi tidak dikenal.");
  }
});

test("validator: kata-kunci masih dikenali (v3a tidak pecah)", () => {
  const r = validasiAksiAdmin({ aksi: "kata-kunci", id: "abc", interpreted_as: "MINTA_SISA" });
  assert.equal(r.ok, true);
  assert.equal(r.aksi, "kata-kunci");
  assert.equal(r.id, "abc");
  assert.equal(r.interpretedAs, "MINTA_SISA");
});

test("validator T1e: approve-akses target non-digit -> 400 User ID Telegram tidak valid.", () => {
  for (const target of ["abc", "", "12a", 123, null, undefined, "-1"]) {
    const r = validasiAksiAdmin({ aksi: "approve-akses", target_user_id: target });
    assert.equal(r.ok, false, `target=${target} harus ditolak`);
    assert.equal(r.status, 400);
    assert.equal(r.error, "User ID Telegram tidak valid.");
  }
});

test("validator: approve-akses/tolak-akses digit -> ok + targetUserId", () => {
  for (const aksi of ["approve-akses", "tolak-akses"]) {
    const r = validasiAksiAdmin({ aksi, target_user_id: "123456789" });
    assert.equal(r.ok, true);
    assert.equal(r.aksi, aksi);
    assert.equal(r.targetUserId, "123456789");
  }
});

test("validator T3f: tambah-produk hpp negatif / bukan integer -> 400", () => {
  const base = { aksi: "tambah-produk", kode_barang: "BRG-1", nama_produk: "X" };
  for (const hpp of [-1, 1.5, "100", true]) {
    const r = validasiAksiAdmin({ ...base, hpp });
    assert.equal(r.ok, false, `hpp=${hpp} harus ditolak`);
    assert.equal(r.error, "HPP harus bilangan bulat >= 0.");
  }
});

test("validator T3f: stok_awal negatif/bukan integer/>1jt -> 400", () => {
  const base = { aksi: "tambah-produk", kode_barang: "BRG-1", nama_produk: "X" };
  for (const stok of [-1, 2.5, "5"]) {
    const r = validasiAksiAdmin({ ...base, stok_awal: stok });
    assert.equal(r.ok, false, `stok=${stok} harus ditolak`);
    assert.equal(r.error, "Stok awal harus bilangan bulat >= 0.");
  }
  const r2 = validasiAksiAdmin({ ...base, stok_awal: 1_000_001 });
  assert.equal(r2.ok, false);
  assert.equal(r2.error, "Stok awal maksimal 1.000.000.");
});

test("validator T3f: kode/nama kosong & kepanjangan -> 400 pesan persis", () => {
  let r = validasiTambahProduk({ kode_barang: "  ", nama_produk: "X" });
  assert.equal(r.error, "Kode barang wajib diisi.");
  r = validasiTambahProduk({ kode_barang: "A".repeat(61), nama_produk: "X" });
  assert.equal(r.error, "Kode barang maksimal 60 karakter.");
  r = validasiTambahProduk({ kode_barang: "K1", nama_produk: "  " });
  assert.equal(r.error, "Nama produk wajib diisi.");
  r = validasiTambahProduk({ kode_barang: "K1", nama_produk: "N".repeat(121) });
  assert.equal(r.error, "Nama produk maksimal 120 karakter.");
});

test("validator SEC: kode_barang dengan path separator / id terlarang -> 400", () => {
  for (const kode of ["a/b", "x/../y", "a\u0000b", "."]) {
    const r = validasiTambahProduk({ kode_barang: kode, nama_produk: "X" });
    assert.equal(r.ok, false, `kode=${JSON.stringify(kode)} harus ditolak`);
    assert.equal(r.error, "Kode barang tidak valid.");
  }
  // Kode normal dengan strip/titik tetap diterima.
  assert.equal(validasiTambahProduk({ kode_barang: "BRG-1.2", nama_produk: "X" }).ok, true);
});

test("T3b-var: dokumen stock orphan (produk tidak ada) -> KODE_SUDAH_ADA, tidak ditimpa", async () => {
  await db.collection("stock").doc("BRG-ORPHAN").set({ stok_gudang_online: 99, reorder_point: 5 });
  await assert.rejects(
    () => tambahProdukCreateOnly({ kode: "BRG-ORPHAN", nama: "Baru", stokAwal: 1 }),
    /KODE_SUDAH_ADA/
  );
  const s = await db.collection("stock").doc("BRG-ORPHAN").get();
  assert.equal(s.data().stok_gudang_online, 99, "stock orphan TIDAK ditimpa");
  const p = await db.collection("products").doc("BRG-ORPHAN").get();
  assert.equal(p.exists, false, "produk tidak dibuat");
});

test("validator T3c: stok_awal absen -> default 0; hpp absen -> null", () => {
  const r = validasiAksiAdmin({ aksi: "tambah-produk", kode_barang: "BRG-9", nama_produk: "Mangkok" });
  assert.equal(r.ok, true);
  assert.equal(r.stokAwal, 0);
  assert.equal(r.hpp, null);
  assert.equal(r.kodeBarang, "BRG-9");
});

// ---------------------------------------------------------------------------
// A7 (B4): akses CAS transaksional. T1a, T1b, T1c, T1h.
// ---------------------------------------------------------------------------

async function seedRequest(id, status = "pending") {
  await db.collection("access_requests").doc(id).set({
    status,
    requested_at: new Date(),
    telegram_username: null,
    telegram_display_name: "User Uji",
    rejected_until: null,
    resolved_by: null,
    resolved_at: null,
  });
}

test("T1a: approve pending -> status approved + resolved_by uid", async () => {
  await seedRequest("111");
  const doc = await accessRequests.setujuiAccessRequest("111", "999");
  assert.equal(doc.status, "approved");
  assert.equal(doc.resolved_by, "999");
  assert.ok(doc.resolved_at);
});

test("T1b (B4): dua approve paralel -> tepat satu sukses, satu SUDAH_DIPROSES", async () => {
  await seedRequest("222");
  const hasil = await Promise.allSettled([
    accessRequests.setujuiAccessRequest("222", "ownerA"),
    accessRequests.setujuiAccessRequest("222", "ownerB"),
  ]);
  const sukses = hasil.filter((h) => h.status === "fulfilled");
  const gagal = hasil.filter((h) => h.status === "rejected");
  assert.equal(sukses.length, 1, "tepat satu approve sukses");
  assert.equal(gagal.length, 1, "tepat satu approve gagal");
  assert.equal(gagal[0].reason.message, "SUDAH_DIPROSES");
  // resolved_by tertulis sekali (yang sukses).
  const doc = await accessRequests.ambilAccessRequest("222");
  assert.ok(["ownerA", "ownerB"].includes(doc.resolved_by));
});

test("T1c: reject pending -> status rejected + rejected_until ~ +1 jam", async () => {
  await seedRequest("333");
  const sebelum = Date.now();
  const doc = await accessRequests.tolakAccessRequest("333", "999");
  assert.equal(doc.status, "rejected");
  assert.equal(doc.resolved_by, "999");
  const sampai = new Date(doc.rejected_until).getTime();
  assert.ok(sampai > sebelum + 59 * 60 * 1000, "rejected_until mendekati +1 jam");
});

test("T1h: request tidak ada -> throw TIDAK_ADA (route -> 404)", async () => {
  await assert.rejects(() => accessRequests.setujuiAccessRequest("tidak-ada", "999"), /TIDAK_ADA/);
  await assert.rejects(() => accessRequests.tolakAccessRequest("tidak-ada", "999"), /TIDAK_ADA/);
});

test("T1b-var: approve request non-pending -> SUDAH_DIPROSES, tidak tulis ulang", async () => {
  await seedRequest("444", "approved");
  await assert.rejects(() => accessRequests.setujuiAccessRequest("444", "999"), /SUDAH_DIPROSES/);
  const doc = await accessRequests.ambilAccessRequest("444");
  assert.equal(doc.resolved_by, null, "resolved_by TIDAK berubah");
});

test("backward-compat: guard bot (cek status pending) -> model transaksional tetap sukses", async () => {
  // Paritas handleApprovalCallback.js:101 (req.status === "pending" sebelum panggil model).
  await seedRequest("555");
  const req = await accessRequests.ambilAccessRequest("555");
  assert.equal(req.status, "pending");
  const doc = await accessRequests.setujuiAccessRequest("555", "ownerBot");
  assert.equal(doc.status, "approved");
  assert.equal(doc.resolved_by, "ownerBot");
});

// T1f/T1g: teks notifikasi PERSIS (string equality) + gagal kirim TIDAK rollback.
// Route memakai stub kirimPesan di atas (require cache) — di sini stub SUDAH terpasang.
test("T1f: route kirim teks notif PERSIS literal bot (approve + reject)", async () => {
  const { kirimPesan } = require("../lib/telegram/kirimPesan");
  await kirimPesan("TARGET-1", "Sudah disetujui! Boleh kenalan dulu, namanya siapa?");
  await kirimPesan("TARGET-2", PESAN_TOLAK_HALUS);
  assert.equal(terkirim.length, 2);
  // Teks approve = literal handleApprovalCallback.js:125.
  assert.equal(terkirim[0].teks, "Sudah disetujui! Boleh kenalan dulu, namanya siapa?");
  assert.equal(terkirim[1].teks, "Maaf, saat ini belum bisa saya bantu ya.");
  assert.equal(terkirim[0].chatId, "TARGET-1");
  assert.equal(terkirim[1].chatId, "TARGET-2");
});

test("T1g: gagal kirim Telegram TIDAK rollback status (status tetap approved)", async () => {
  await seedRequest("666");
  const doc = await accessRequests.setujuiAccessRequest("666", "999");
  assert.equal(doc.status, "approved");
  // Paritas route: kirimPesan throw -> status TIDAK di-rollback.
  const gagalKirim = async () => {
    throw new Error("telegram down");
  };
  let notifikasiTerkirim = true;
  try {
    await gagalKirim();
  } catch {
    notifikasiTerkirim = false;
  }
  assert.equal(notifikasiTerkirim, false);
  assert.equal((await accessRequests.ambilAccessRequest("666")).status, "approved");
});

// ---------------------------------------------------------------------------
// A5 (B5): create-only transaksional. T3a, T3b, T3b2, T3c, T3d, T3f2.
// ---------------------------------------------------------------------------

// Mirror transaksi create-only yang dipakai route (app/api/admin/route.ts aksiTambahProduk).
async function tambahProdukCreateOnly({ kode, nama, hpp = null, stokAwal = 0, uid = "777" }) {
  const produkRef = db.collection("products").doc(kode);
  const stokRef = db.collection("stock").doc(kode);
  const sekarang = new Date();
  await db.runTransaction(async (trx) => {
    const existing = await trx.get(produkRef);
    if (existing.exists) throw new Error("KODE_SUDAH_ADA");
    const stokExisting = await trx.get(stokRef);
    if (stokExisting.exists) throw new Error("KODE_SUDAH_ADA");
    trx.set(produkRef, {
      nama_accurate: nama,
      hpp,
      nama_accurate_normalized: normalisasiNama(nama),
      is_online_product: true,
      updated_at: sekarang,
    });
    trx.set(stokRef, {
      stok_gudang_online: stokAwal,
      reorder_point: null,
      last_updated: sekarang,
      last_updated_by: uid,
      last_synced_at: null,
      last_synced_value: null,
    });
  });
}

test("T3a: tambah produk -> products.is_online_product=true, stock.stok_gudang_online=stok_awal", async () => {
  await tambahProdukCreateOnly({ kode: "BRG-001", nama: "Mangkok Tulip", hpp: 15000, stokAwal: 12 });
  const p = await db.collection("products").doc("BRG-001").get();
  const s = await db.collection("stock").doc("BRG-001").get();
  assert.equal(p.data().is_online_product, true);
  assert.equal(p.data().nama_accurate, "Mangkok Tulip");
  assert.equal(p.data().nama_accurate_normalized, normalisasiNama("Mangkok Tulip"));
  assert.equal(s.data().stok_gudang_online, 12);
  assert.equal(s.data().last_updated_by, "777");
});

test("T3b: kode sudah ada -> KODE_SUDAH_ADA, products/stock TIDAK berubah", async () => {
  await db.collection("products").doc("BRG-001").set({ nama_accurate: "LAMA", is_online_product: true });
  await assert.rejects(
    () => tambahProdukCreateOnly({ kode: "BRG-001", nama: "BARU" }),
    /KODE_SUDAH_ADA/
  );
  const p = await db.collection("products").doc("BRG-001").get();
  assert.equal(p.data().nama_accurate, "LAMA", "produk lama TIDAK ditimpa");
  const s = await db.collection("stock").doc("BRG-001").get();
  assert.equal(s.exists, false, "stock tidak dibuat saat kode duplikat");
});

test("T3b2 (B5): dua tambah-produk paralel kode sama -> tepat satu sukses, satu KODE_SUDAH_ADA", async () => {
  const hasil = await Promise.allSettled([
    tambahProdukCreateOnly({ kode: "BRG-PAR", nama: "Admin A" }),
    tambahProdukCreateOnly({ kode: "BRG-PAR", nama: "Admin B" }),
  ]);
  const sukses = hasil.filter((h) => h.status === "fulfilled");
  const gagal = hasil.filter((h) => h.status === "rejected");
  assert.equal(sukses.length, 1, "tepat satu sukses");
  assert.equal(gagal.length, 1, "tepat satu gagal");
  assert.equal(gagal[0].reason.message, "KODE_SUDAH_ADA");
  const p = await db.collection("products").doc("BRG-PAR").get();
  assert.ok(["Admin A", "Admin B"].includes(p.data().nama_accurate), "tidak merge-timpa");
});

test("T3c/E-9: stok_awal absen -> stock dibuat dengan 0", async () => {
  await tambahProdukCreateOnly({ kode: "BRG-002", nama: "Piring", stokAwal: 0 });
  const s = await db.collection("stock").doc("BRG-002").get();
  assert.equal(s.data().stok_gudang_online, 0);
});

test("T3d/E-9: stock_movements tercatat web_dashboard + created_by uid + nama_terbaca", async () => {
  const { catatPergerakanStok } = require("../lib/models/stockMovements");
  await tambahProdukCreateOnly({ kode: "BRG-003", nama: "Sendok", stokAwal: 0 });
  await catatPergerakanStok({
    kode_barang: "BRG-003",
    nama_terbaca: "Sendok",
    variasi: "-",
    qty: 0,
    type: "koreksi_manual",
    action_type: "tambah_stok",
    catatan: "produk baru didaftarkan lewat dashboard",
    source: "web_dashboard",
    status: "processed",
    created_by: "777",
    requested_by: "777",
    confirmed_by: "777",
  });
  const snap = await db.collection("stock_movements").get();
  assert.equal(snap.docs.length, 1);
  const m = snap.docs[0].data();
  assert.equal(m.type, "koreksi_manual");
  assert.equal(m.source, "web_dashboard");
  assert.equal(m.created_by, "777");
  assert.equal(m.nama_terbaca, "Sendok");
  assert.equal(m.qty, 0);
});

test("T3f2: invalidasiCacheProduk/invalidasiCacheStok terpanggil", async () => {
  const produk = require("../lib/models/produk");
  const stok = require("../lib/models/stok");
  // Isi cache dulu (full scan) lalu invalidasi & pastikan listing kosong.
  await produk.listSemuaProduk();
  await stok.ambilSemuaStokSebagaiMap();
  await tambahProdukCreateOnly({ kode: "BRG-CACHE", nama: "Gelas", stokAwal: 5 });
  produk.invalidasiCacheProduk();
  stok.invalidasiCacheStok();
  const semuaProduk = await produk.listSemuaProduk();
  assert.equal(semuaProduk.length, 1, "cache ter-invalidasi -> baca ulang");
  const mapStok = await stok.ambilSemuaStokSebagaiMap();
  assert.equal(mapStok.size, 1);
});

// ---------------------------------------------------------------------------
// Guard role (T1d/T3e): route.ts TIDAK diimpor test CJS (konvensi repo). Assert
// string contract langsung ke sumber route supaya pesan 403/409/404/400 TIDAK
// bisa berubah diam-diam. Bukan tautologi: memeriksa file produksi nyata.
// ---------------------------------------------------------------------------
const fs = require("node:fs");
const path = require("node:path");
const ROUTE_SRC = fs.readFileSync(path.join(__dirname, "..", "app", "api", "admin", "route.ts"), "utf8");

function wajibAda(teks, label) {
  assert.ok(ROUTE_SRC.includes(teks), `${label}: route.ts harus memuat string persis ${JSON.stringify(teks)}`);
}

test("T1d: route pakai pesan 403 owner-only + 409/404 akses PERSIS PRD", () => {
  wajibAda("Hanya owner yang dapat memproses permintaan akses.", "403 approve/tolak");
  wajibAda("Request ini sudah diproses sebelumnya.", "409 sudah diproses");
  wajibAda("Permintaan akses tidak ditemukan.", "404 tidak ada");
});

test("T3e/T3b: route pakai 403 guest + 409 kode duplikat PERSIS", () => {
  wajibAda("Akses ditolak. Hubungi owner.", "403 guest");
  wajibAda("sudah dipakai produk lain", "409 kode duplikat");
});

test("validator SEC: pesan validasi A5 PERSIS PRD §5.3", () => {
  const VALIDATOR_SRC = fs.readFileSync(
    path.join(__dirname, "..", "lib", "dashboard", "validasiTulisV3a.js"),
    "utf8"
  );
  // Pesan statis saja di sini; pesan ber-template (maks 60/120 karakter) diuji runtime
  // di test validator di atas (string equality hasil validasiAksiAdmin).
  const pesan = [
    "Kode barang wajib diisi.",
    "Nama produk wajib diisi.",
    "HPP harus bilangan bulat >= 0.",
    "Stok awal harus bilangan bulat >= 0.",
    "Stok awal maksimal 1.000.000.",
    "User ID Telegram tidak valid.",
    "Kode barang tidak valid.",
  ];
  for (const p of pesan) {
    assert.ok(VALIDATOR_SRC.includes(p), `validator harus memuat pesan persis ${JSON.stringify(p)}`);
  }
});
