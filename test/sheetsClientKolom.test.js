// test/sheetsClientKolom.test.js
// T1: tambahKolomHeader harden grid-expand. Urutan wajib: metadata -> (expand) -> tulis header.
// Modul ASLI lib/sheets/client dipakai; `googleapis` di-stub via require.cache supaya
// spreadsheets.get/batchUpdate/values.* jadi spy tanpa kredensial.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const panggilan = [];
let gridMeta = null;
let headerStub = [];

const googleapisPath = require.resolve("googleapis");
const clientAsli = require.resolve("../lib/sheets/client");

function angkaKeHurufKolom(i) {
  let hasil = "";
  let sisa = i;
  while (sisa >= 0) {
    hasil = String.fromCharCode((sisa % 26) + 65) + hasil;
    sisa = Math.floor(sisa / 26) - 1;
  }
  return hasil;
}

function installGoogleStub() {
  const asli = require(googleapisPath);
  const stub = {
    ...asli,
    google: {
      auth: { JWT: class {} },
      sheets: () => ({
        spreadsheets: {
          get: async (params) => {
            panggilan.push({ op: "get", params });
            return { data: gridMeta };
          },
          batchUpdate: async (params) => {
            panggilan.push({ op: "batchUpdate", params });
            return { data: {} };
          },
          values: {
            get: async (params) => {
              panggilan.push({ op: "values.get", params });
              return { data: { values: [headerStub] } };
            },
            update: async (params) => {
              panggilan.push({ op: "values.update", params });
              return { data: {} };
            },
          },
        },
      }),
    },
  };
  require.cache[googleapisPath] = { id: googleapisPath, filename: googleapisPath, loaded: true, exports: stub };
  // client punya cache + instance client; hapus supaya re-load pakai stub baru.
  delete require.cache[clientAsli];
}

function siapkan(meta, header) {
  installGoogleStub();
  gridMeta = meta;
  headerStub = header;
  process.env.GOOGLE_SHEETS_ID = "ss-test";
  process.env.GOOGLE_SHEETS_CLIENT_EMAIL = "x@example.com";
  process.env.GOOGLE_SHEETS_PRIVATE_KEY = "-----BEGIN KEY-----\\nabc\\n-----END KEY-----";
  return require(clientAsli);
}

beforeEach(() => {
  panggilan.length = 0;
});

const HEADER_7 = ["No", "Kode Barang", "Nama Accurate", "HPP", "is_online", "HPP Baru", "Stok Online"];

test("header 7 sel + grid columnCount=7 -> metadata, batchUpdate (expand), lalu values.update header", async () => {
  const client = siapkan(
    { sheets: [{ properties: { title: "DATABASE_ACCURATE", sheetId: 42, gridProperties: { columnCount: 7 } } }] },
    HEADER_7
  );

  const idx = await client.tambahKolomHeader("DATABASE_ACCURATE", "Kolom Baru");
  assert.equal(idx, 7);

  assert.deepEqual(
    panggilan.map((p) => p.op),
    ["values.get", "get", "batchUpdate", "values.update"]
  );
  const expand = panggilan.find((p) => p.op === "batchUpdate");
  assert.equal(expand.params.requestBody.requests[0].appendDimension.sheetId, 42);
  assert.equal(expand.params.requestBody.requests[0].appendDimension.dimension, "COLUMNS");
  assert.equal(expand.params.requestBody.requests[0].appendDimension.length, 1);

  const tulis = panggilan.find((p) => p.op === "values.update");
  assert.equal(tulis.params.range, "DATABASE_ACCURATE!H1");
  assert.deepEqual(tulis.params.requestBody.values, [["Kolom Baru"]]);
  assert.equal(angkaKeHurufKolom(7), "H");
});

test("grid columnCount=8 (cukup lebar) -> TANPA batchUpdate, langsung values.update", async () => {
  const client = siapkan(
    { sheets: [{ properties: { title: "DATABASE_ACCURATE", sheetId: 42, gridProperties: { columnCount: 8 } } }] },
    HEADER_7
  );

  const idx = await client.tambahKolomHeader("DATABASE_ACCURATE", "Kolom Baru");
  assert.equal(idx, 7);

  const ops = panggilan.map((p) => p.op);
  assert.deepEqual(ops, ["values.get", "get", "values.update"]);
  assert.equal(ops.includes("batchUpdate"), false);
});

test("gap >1: grid columnCount=5, header 7 -> appendDimension length=3 (tepat kekurangan)", async () => {
  const client = siapkan(
    { sheets: [{ properties: { title: "DATABASE_ACCURATE", sheetId: 42, gridProperties: { columnCount: 5 } } }] },
    HEADER_7
  );

  await client.tambahKolomHeader("DATABASE_ACCURATE", "Kolom Baru");
  const expand = panggilan.find((p) => p.op === "batchUpdate");
  assert.equal(expand.params.requestBody.requests[0].appendDimension.length, 3);
});

test("sheet target tak ada di metadata -> throw error jelas", async () => {
  const client = siapkan(
    { sheets: [{ properties: { title: "SHEET_LAIN", sheetId: 1, gridProperties: { columnCount: 5 } } }] },
    ["No", "Kode Barang"]
  );

  await assert.rejects(
    () => client.tambahKolomHeader("DATABASE_ACCURATE", "Kolom Baru"),
    /tidak ditemukan di metadata/
  );
  assert.equal(panggilan.some((p) => p.op === "values.update"), false, "tidak menulis header saat sheet tak ada");
});
