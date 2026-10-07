// test/permintaanRouteV5.test.js
// Uji ROUTE ASLI app/api/permintaan-gudang/route.ts (v5.1): urutan guard + pemetaan aksi.
// Memanggil POST() sungguhan dengan Request buatan. Route di-transpile TypeScript in-test
// (pola test/urutanGuardV5.test.js), tanpa server/browser/network.
//
// Fokus: URUTAN guard (origin -> sesi -> rate limit -> role -> validasi body) dan
// PEMETAAN aksi -> fungsi model (spy), BUKAN logika model (sudah di test/permintaanGudang.test.js).
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

// Env uji SEBELUM route/guard di-load.
process.env.DASHBOARD_SESSION_SECRET = process.env.DASHBOARD_SESSION_SECRET || "rahasia-uji-route-v5";
process.env.DASHBOARD_ALLOWED_ORIGINS = "https://mini.example.com";

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

// Stub Telegram SEBELUM notifikasi di-require (dipanggil route saat sukses aksi).
const { installStubTelegram } = require("./helpers/stubTelegram");
installStubTelegram();

const { buatTokenSesi } = require("../lib/dashboard/auth/sesi");
const { resetRateLimit } = require("../lib/dashboard/auth/guard");
const model = require("../lib/models/permintaanGudang");

const ORIGIN = "https://mini.example.com";
const AUTH_DATE = Math.floor(Date.now() / 1000) - 5;

/** Muat route.ts sebagai CJS; return { POST }. Tiru test/urutanGuardV5.test.js. */
function muatRoute(relatif) {
  const abs = path.resolve(relatif);
  let src = fs.readFileSync(abs, "utf8");
  src = src.replace(/const require = createRequire\(import\.meta\.url\);/g, "");
  src = src.replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(abs).href));
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = new Module(abs, module);
  mod.filename = abs;
  mod.paths = Module._nodeModulePaths(path.dirname(abs));
  mod._compile(js, abs);
  return mod.exports;
}

const { POST } = muatRoute("app/api/permintaan-gudang/route.ts");

// ---------------------------------------------------------------------------
// Spy model: ganti method model agar test MENGUNCI pemetaan aksi tanpa butuh
// dokumen permintaan nyata. Semua aksi sukses -> { ok:true, ... }.
// ---------------------------------------------------------------------------
const NAMA_METHOD_MODEL = [
  "buatPermintaan",
  "ubahItemPermintaan",
  "setujuiTujuan",
  "tolakTujuanPermintaan",
  "tolakPermintaan",
  "batalPermintaan",
  "kirimPermintaan",
  "terimaPermintaan",
  "tidakTerimaPermintaan",
  "tutupTujuanPermintaan",
  "selesaiPermintaan",
];

let panggilan = [];
let pulihkan = null;

function pasangSpy() {
  panggilan = [];
  const asli = {};
  for (const nama of NAMA_METHOD_MODEL) {
    asli[nama] = model[nama];
    model[nama] = async (...args) => {
      panggilan.push({ nama, args });
      return {
        ok: true,
        permintaan_id: "P1",
        status: "menunggu",
        tujuan: [{ tipe: "gudang", id: "D13", status: "menunggu", status_kirim: "menunggu", items: [] }],
      };
    };
  }
  pulihkan = () => {
    for (const nama of NAMA_METHOD_MODEL) model[nama] = asli[nama];
  };
}

// ---------------------------------------------------------------------------
// Seed & helper request
// ---------------------------------------------------------------------------
async function seedAdmin({ uid = "111", role = "admin", gudang_id = "D12" } = {}) {
  await db.collection("admins").doc(uid).set({ name: "Admin " + uid, role, gudang_id });
}

async function seedMaster() {
  await db.collection("gudang").doc("D12").set({ nama: "D12", aktif: true });
  await db.collection("gudang").doc("D13").set({ nama: "D13", aktif: true });
  await db.collection("stock").doc("B1").set({ stok_gudang_online: 100, qty_per_gudang: { ONLINE: 100, D12: 100 } });
}

function req({ origin = ORIGIN, cookie = null, body = "{}", raw = null } = {}) {
  const headers = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  if (cookie) headers.cookie = "dat_sesi=" + cookie;
  return new Request("https://mini.example.com/api/permintaan-gudang", {
    method: "POST",
    headers,
    body: raw !== null ? raw : JSON.stringify(body),
  });
}

async function panggil(payload, { cookie = null, origin = ORIGIN, raw = null } = {}) {
  const res = await POST(req({ origin, cookie, body: payload, raw }));
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  resetRateLimit();
  if (pulihkan) pulihkan();
  pasangSpy();
  await seedMaster();
});

afterEach(() => {
  if (pulihkan) pulihkan();
});

// ---------------------------------------------------------------------------
// 1) Origin tidak valid -> 403 (guard paling awal).
// ---------------------------------------------------------------------------
test("1. origin tidak valid -> 403 sebelum sesi/body", async () => {
  await seedAdmin();
  const r = await panggil({ aksi: "selesai", id: "P1" }, { origin: "https://jahat.example.com" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "Origin tidak diizinkan.");
  assert.equal(panggilan.length, 0, "model tidak boleh dipanggil");
});

// ---------------------------------------------------------------------------
// 2) Tanpa sesi -> 401.
// ---------------------------------------------------------------------------
test("2. tanpa sesi -> 401", async () => {
  const r = await panggil({ aksi: "selesai", id: "P1" });
  assert.equal(r.status, 401);
  assert.match(r.body.error, /Sesi kedaluwarsa/);
  assert.equal(panggilan.length, 0);
});

// ---------------------------------------------------------------------------
// 3) Guest -> 403 SEBELUM validasi body (body invalid tetap 403, bukan 400).
// ---------------------------------------------------------------------------
test("3. guest + body invalid -> 403 (guest menang sebelum validasi body)", async () => {
  await seedAdmin({ uid: "555", role: "guest" });
  const token = buatTokenSesi({ userId: "555", role: "guest", authDate: AUTH_DATE });
  const r = await panggil(null, { cookie: token, raw: "BUKAN-JSON" });
  assert.equal(r.status, 403, "guest harus 403, bukan 400");
  assert.equal(r.body.error, "Akses ditolak. Hubungi owner.");
  assert.equal(panggilan.length, 0);
});

// ---------------------------------------------------------------------------
// 4) Admin valid + aksi tak dikenal -> 400 "Aksi tidak dikenal."
// ---------------------------------------------------------------------------
test("4. admin + aksi tak dikenal -> 400 Aksi tidak dikenal.", async () => {
  await seedAdmin();
  const token = buatTokenSesi({ userId: "111", role: "admin", authDate: AUTH_DATE });
  const r = await panggil({ aksi: "aksi-ngawur", id: "P1" }, { cookie: token });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "Aksi tidak dikenal.");
  assert.equal(panggilan.length, 0);
});

// ---------------------------------------------------------------------------
// 5) Aksi `selesai` -> selesaiPermintaan (BUKAN setujuiTujuan).
// ---------------------------------------------------------------------------
test("5. aksi selesai -> memanggil selesaiPermintaan, bukan setujuiTujuan", async () => {
  await seedAdmin();
  const token = buatTokenSesi({ userId: "111", role: "admin", authDate: AUTH_DATE });
  const r = await panggil({ aksi: "selesai", id: "P1" }, { cookie: token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const nama = panggilan.map((p) => p.nama);
  assert.deepEqual(nama, ["selesaiPermintaan"]);
  assert.deepEqual(panggilan[0].args, ["P1", "111"]);
});

// ---------------------------------------------------------------------------
// 6) Aksi `setujui-tujuan` butuh tujuan_index -> tanpa itu 400.
// ---------------------------------------------------------------------------
test("6. setujui-tujuan tanpa tujuan_index -> 400 Tujuan tidak ditemukan.", async () => {
  await seedAdmin();
  const token = buatTokenSesi({ userId: "111", role: "admin", authDate: AUTH_DATE });
  const r = await panggil({ aksi: "setujui-tujuan", id: "P1" }, { cookie: token });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "Tujuan tidak ditemukan.");
  assert.equal(panggilan.length, 0);
});

// ---------------------------------------------------------------------------
// 7) Aksi `kirim` butuh tujuan_index -> tanpa itu 400.
// ---------------------------------------------------------------------------
test("7. kirim tanpa tujuan_index -> 400 Tujuan tidak ditemukan.", async () => {
  await seedAdmin();
  const token = buatTokenSesi({ userId: "111", role: "admin", authDate: AUTH_DATE });
  const r = await panggil({ aksi: "kirim", id: "P1" }, { cookie: token });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "Tujuan tidak ditemukan.");
  assert.equal(panggilan.length, 0);
});

// ---------------------------------------------------------------------------
// 8) Aksi `tolak-tujuan` dikenal -> diteruskan ke tolakTujuanPermintaan (bukan 400).
// ---------------------------------------------------------------------------
test("8. tolak-tujuan dikenal -> tolakTujuanPermintaan(id, index, uid)", async () => {
  await seedAdmin();
  const token = buatTokenSesi({ userId: "111", role: "admin", authDate: AUTH_DATE });
  const r = await panggil({ aksi: "tolak-tujuan", id: "P1", tujuan_index: 0 }, { cookie: token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(panggilan.map((p) => p.nama), ["tolakTujuanPermintaan"]);
  assert.deepEqual(panggilan[0].args, ["P1", 0, "111"]);
});

// ---------------------------------------------------------------------------
// 9) Aksi `setujui` (alias) -> diteruskan sebagai setujui-tujuan (setujuiTujuan).
// ---------------------------------------------------------------------------
test("9. setujui (alias) -> setujuiTujuan(id, index, uid)", async () => {
  await seedAdmin();
  const token = buatTokenSesi({ userId: "111", role: "admin", authDate: AUTH_DATE });
  const r = await panggil({ aksi: "setujui", id: "P1", tujuan_index: 0 }, { cookie: token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(panggilan.map((p) => p.nama), ["setujuiTujuan"]);
  assert.deepEqual(panggilan[0].args, ["P1", 0, "111"]);
});

// ---------------------------------------------------------------------------
// 10) `setujui` masih dikenal (tidak 400) - regresi aksi lama tak boleh hilang.
// ---------------------------------------------------------------------------
test("10. setujui masih dikenal (bukan Aksi tidak dikenal)", async () => {
  await seedAdmin();
  const token = buatTokenSesi({ userId: "111", role: "admin", authDate: AUTH_DATE });
  const r = await panggil({ aksi: "setujui", id: "P1", tujuan_index: 0 }, { cookie: token });
  assert.notEqual(r.status, 400);
  assert.notEqual(r.body.error, "Aksi tidak dikenal.");
});

// ---------------------------------------------------------------------------
// 11) Rate limit: request ke-31 -> 429.
// ---------------------------------------------------------------------------
test("11. rate limit per uid: request ke-31 -> 429", async () => {
  await seedAdmin();
  const token = buatTokenSesi({ userId: "111", role: "admin", authDate: AUTH_DATE });
  let terakhir = null;
  for (let i = 0; i < 31; i += 1) {
    terakhir = await panggil({ aksi: "aksi-ngawur", id: "P1" }, { cookie: token });
  }
  assert.equal(terakhir.status, 429, "request ke-31 harus 429");
  assert.match(terakhir.body.error, /Terlalu banyak permintaan/);
});

// ---------------------------------------------------------------------------
// 12) tutup-tujuan OWNER only: admin -> 403 (dicek di route, sesuai tabel 3.3).
// ---------------------------------------------------------------------------
test("12. tutup-tujuan oleh admin -> 403 (owner only)", async () => {
  await seedAdmin({ uid: "111", role: "admin", gudang_id: "D12" });
  const token = buatTokenSesi({ userId: "111", role: "admin", authDate: AUTH_DATE });
  const r = await panggil(
    { aksi: "tutup-tujuan", id: "P1", tujuan_index: 0, catatan: "rusak" },
    { cookie: token }
  );
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "Hanya owner yang dapat menutup tujuan.");
  assert.equal(panggilan.length, 0);
});

// ---------------------------------------------------------------------------
// 13) Aksi `buat` -> buatPermintaan memakai dari_gudang_id dari body.
// ---------------------------------------------------------------------------
test("13. buat -> buatPermintaan(dari_gudang_id=D12, oleh uid)", async () => {
  await seedAdmin();
  const token = buatTokenSesi({ userId: "111", role: "admin", authDate: AUTH_DATE });
  const r = await panggil(
    {
      aksi: "buat",
      dari_gudang_id: "D12",
      tujuan: [{ tipe: "gudang", id: "D13" }],
      items: [{ kode_barang: "B1", qty: 5 }],
    },
    { cookie: token }
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(panggilan.map((p) => p.nama), ["buatPermintaan"]);
  assert.equal(panggilan[0].args[0].dari_gudang_id, "D12");
  assert.equal(panggilan[0].args[0].oleh, "111");
});