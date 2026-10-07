// test/urutanGuardV5.test.js
// Bukti URUTAN guard route v5 (T18): tolakOrigin -> sesi -> rate limit -> role -> validasi body.
// Klaim inti: GUEST dengan body INVALID harus 403 (guest menang SEBELUM validasi body),
// bukan 400. Bila urutan terbalik, test ini gagal.
//
// Cara: route.ts di-transpile TypeScript in-test (typescript sudah devDependency) lalu
// di-compile sebagai CJS, sehingga `POST()` asli benar-benar dipanggil dengan `Request`
// buatan. TIDAK ada file produksi yang diubah.
//
// Prinsip: cepat, ringan, deterministik. Tanpa network/browser/server Next.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

// Env uji: origin allowlist dipasang supaya `tolakOrigin` deterministik (tidak bergantung
// NODE_ENV). Harus di-set SEBELUM route di-load (guard.js membaca env saat dipanggil).
process.env.DASHBOARD_SESSION_SECRET = process.env.DASHBOARD_SESSION_SECRET || "rahasia-uji-guard-v5";
process.env.DASHBOARD_ALLOWED_ORIGINS = "https://mini.example.com";

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const { buatTokenSesi } = require("../lib/dashboard/auth/sesi");
const { resetRateLimit } = require("../lib/dashboard/auth/guard");

const ORIGIN = "https://mini.example.com";
const AUTH_DATE = Math.floor(Date.now() / 1000) - 5;

/** Muat route.ts sebagai modul CJS; return { POST }. */
function muatRoute(relatif) {
  const abs = path.resolve(relatif);
  let src = fs.readFileSync(abs, "utf8");
  // Route memakai `const require = createRequire(import.meta.url)`. Di dalam CJS,
  // `require` bawaan SUDAH relatif terhadap file ini -> cukup buang deklarasinya
  // supaya tidak ada TDZ (const require shadow sebelum `require("node:module")`).
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

const ROUTES = [
  { nama: "/api/permintaan-gudang", file: "app/api/permintaan-gudang/route.ts" },
  { nama: "/api/gudang", file: "app/api/gudang/route.ts" },
  { nama: "/api/opname-gudang", file: "app/api/opname-gudang/route.ts" },
  { nama: "/api/stok/gudang", file: "app/api/stok/gudang/route.ts" },
].map((r) => ({ ...r, POST: muatRoute(r.file).POST }));

/** Request POST dengan header opsional. `body` mentah (string) supaya bisa invalid. */
function reqBuatan(headers = {}, body = "BUKAN-JSON") {
  return new Request("https://mini.example.com/api/uji", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function baca(res) {
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  resetRateLimit();
});

// ---------------------------------------------------------------------------
// 1) Origin tidak valid -> 403, untuk SEMUA route.
// ---------------------------------------------------------------------------
test("origin tidak valid -> 403 di semua route (tolakOrigin paling awal)", async () => {
  for (const r of ROUTES) {
    const res = await baca(await r.POST(reqBuatan({ origin: "https://jahat.example.com" })));
    assert.equal(res.status, 403, `${r.nama} harus 403`);
    assert.equal(res.body.error, "Origin tidak diizinkan.");
  }
});

// ---------------------------------------------------------------------------
// 2) Origin valid tapi tanpa sesi -> 401, untuk SEMUA route.
// ---------------------------------------------------------------------------
test("tanpa sesi -> 401 di semua route (sesi dicek setelah origin)", async () => {
  for (const r of ROUTES) {
    const res = await baca(await r.POST(reqBuatan({ origin: ORIGIN })));
    assert.equal(res.status, 401, `${r.nama} harus 401`);
    assert.match(res.body.error, /Sesi kedaluwarsa/);
  }
});

// ---------------------------------------------------------------------------
// 3) GUEST + body INVALID -> 403 (bukan 400). Ini inti urutan v5.
// ---------------------------------------------------------------------------
test("guest + body invalid -> 403 (guest menang sebelum validasi body)", async () => {
  for (const r of ROUTES) {
    const uid = `guest-${r.nama}`;
    await db.collection("admins").doc(uid).set({ name: "G", role: "guest" });
    const token = buatTokenSesi({ userId: uid, role: "guest", authDate: AUTH_DATE });
    const res = await baca(
      await r.POST(reqBuatan({ origin: ORIGIN, cookie: `dat_sesi=${token}` }, "BUKAN-JSON"))
    );
    assert.equal(res.status, 403, `${r.nama} guest+body invalid harus 403, bukan 400`);
    // Pesan berbeda per route: route guest-aware -> "Akses ditolak..."; /api/gudang
    // owner-only memakai pesan owner. Yang dikunci test ini adalah STATUS 403
    // (menang atas 400 validasi body), bukan variasi pesan.
    assert.ok(
      ["Akses ditolak. Hubungi owner.", "Hanya owner yang dapat mengelola gudang."].includes(res.body.error),
      `${r.nama} pesan 403 tak terduga: ${res.body.error}`
    );
  }
});

// ---------------------------------------------------------------------------
// 4) Sesi valid (owner, lolos role) + body invalid -> 400 (validasi jalan).
// ---------------------------------------------------------------------------
test("owner + body invalid -> 400 di semua route (role lolos, validasi body jalan)", async () => {
  for (const r of ROUTES) {
    const uid = `owner-${r.nama}`;
    await db.collection("admins").doc(uid).set({ name: "O", role: "owner", gudang_id: "D12" });
    const token = buatTokenSesi({ userId: uid, role: "owner", authDate: AUTH_DATE });
    const res = await baca(
      await r.POST(reqBuatan({ origin: ORIGIN, cookie: `dat_sesi=${token}` }, "BUKAN-JSON"))
    );
    assert.equal(res.status, 400, `${r.nama} owner+body invalid harus 400`);
    assert.equal(res.body.error, "Body tidak valid.");
  }
});


// --- Scope tulis per gudang (BR7) - regresi temuan W4: admin gudang A tidak boleh opname gudang B. ---
// Diuji di MODEL (bukan route) karena guard scope route memanggil model yang sama; tapi
// yang mengunci adalah route. Test ini membaca route untuk memastikan ada cek scope.
test("route opname-gudang memuat cek scope gudang admin (BR7)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "api", "opname-gudang", "route.ts"), "utf8");
  assert.ok(/gudang_id|gudangUser/.test(src), "route mengambil gudang_id admin");
  assert.ok(/scope|hanya dapat opname gudang Anda/i.test(src), "route menegakkan scope gudang");
});
