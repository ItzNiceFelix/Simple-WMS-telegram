// test/aiRoute.test.js
// Verifikasi independen klaim #4: ROUTE ASLI app/api/pengaturan/ai/route.ts menerima
// kelima provider dan menolak yang lain dengan pesan "Provider AI tidak dikenal.".
// Memanggil POST() sungguhan (pola test/permintaanRouteV5.test.js). Tidak mengubah implementasi.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

process.env.DASHBOARD_SESSION_SECRET = process.env.DASHBOARD_SESSION_SECRET || "rahasia-uji-ai-route";
process.env.DASHBOARD_ALLOWED_ORIGINS = "https://mini.example.com";

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const { buatTokenSesi } = require("../lib/dashboard/auth/sesi");
const { resetRateLimit } = require("../lib/dashboard/auth/guard");

const ORIGIN = "https://mini.example.com";
const AUTH_DATE = Math.floor(Date.now() / 1000) - 5;

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

const { POST } = muatRoute("app/api/pengaturan/ai/route.ts");

async function seedAdmin({ uid = "111", role = "owner" } = {}) {
  await db.collection("admins").doc(uid).set({ name: "Admin " + uid, role });
}

function req({ origin = ORIGIN, cookie = null, body = {} } = {}) {
  const headers = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  if (cookie) headers.cookie = "dat_sesi=" + cookie;
  return new Request("https://mini.example.com/api/pengaturan/ai", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function panggil(payload, { cookie = null, origin = ORIGIN } = {}) {
  const res = await POST(req({ origin, cookie, body: payload }));
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  resetRateLimit();
});

test("#4 owner + kelima provider valid -> 200 ok & tersimpan", async () => {
  await seedAdmin({ role: "owner" });
  const token = buatTokenSesi({ userId: "111", role: "owner", authDate: AUTH_DATE });
  for (const provider of ["gemini", "groq", "kenari", "openai", "openrouter"]) {
    const r = await panggil({ provider }, { cookie: token });
    assert.equal(r.status, 200, `provider=${provider} harus 200: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.pengaturan.textProvider, provider);
  }
});

test("#4 provider tak dikenal -> 400 pesan PERSIS 'Provider AI tidak dikenal.'", async () => {
  await seedAdmin({ role: "owner" });
  const token = buatTokenSesi({ userId: "111", role: "owner", authDate: AUTH_DATE });
  for (const provider of ["foo", "", "gpt-4o", "kenari "]) {
    const r = await panggil({ provider }, { cookie: token });
    assert.equal(r.status, 400, `provider=${JSON.stringify(provider)} harus 400`);
    assert.equal(r.body.error, "Provider AI tidak dikenal.");
  }
});

test("#4 provider campuran huruf besar dinormalkan lowercase -> 200 (route.ts:49)", async () => {
  await seedAdmin({ role: "owner" });
  const token = buatTokenSesi({ userId: "111", role: "owner", authDate: AUTH_DATE });
  const r = await panggil({ provider: "KENARI" }, { cookie: token });
  assert.equal(r.status, 200);
  assert.equal(r.body.pengaturan.textProvider, "kenari");
});

test("#4 admin (non-owner) -> 403 walau provider valid", async () => {
  await seedAdmin({ uid: "222", role: "admin" });
  const token = buatTokenSesi({ userId: "222", role: "admin", authDate: AUTH_DATE });
  const r = await panggil({ provider: "kenari" }, { cookie: token });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "Hanya owner yang dapat mengubah pengaturan.");
});

test("#4 tanpa sesi -> 401", async () => {
  const r = await panggil({ provider: "kenari" });
  assert.equal(r.status, 401);
  assert.match(r.body.error, /Sesi kedaluwarsa/);
});

test("#4 origin tidak diizinkan -> 403 sebelum sesi", async () => {
  await seedAdmin({ role: "owner" });
  const token = buatTokenSesi({ userId: "111", role: "owner", authDate: AUTH_DATE });
  const r = await panggil({ provider: "kenari" }, { cookie: token, origin: "https://jahat.example.com" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "Origin tidak diizinkan.");
});
