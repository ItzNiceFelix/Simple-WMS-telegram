import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catatImportFile, cekFileSudahAda, hitungFingerprint } from "./importFingerprint";

type Row = Record<string, unknown>;

function buatDb(awal: Row[] = []) {
  const files: Row[] = [...awal];
  let seq = files.length;
  const db = {
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...a: unknown[]) { st._args = a; return st; },
        async first(): Promise<unknown> {
          if (sql.includes("FROM import_files")) {
            return files.find((f) => f["tipe"] === st._args[0] && f["file_hash"] === st._args[1]) ?? null;
          }
          return null;
        },
        async run() {
          if (sql.includes("INTO import_files")) {
            const [tipe, file, hash, no_json, batch_id, at, by] = st._args;
            if (files.some((f) => f["tipe"] === tipe && f["file_hash"] === hash)) return { meta: { last_row_id: 0 } };
            files.push({ id: ++seq, tipe, file, file_hash: hash, no_json, batch_id, at, by });
            return { meta: { last_row_id: seq } };
          }
          return { meta: { last_row_id: 0 } };
        },
      };
      return st;
    },
  };
  return { db: db as unknown as D1Database, files };
}

describe("hitungFingerprint", () => {
  it("deterministik dan tidak bergantung urutan baris", async () => {
    const a = await hitungFingerprint([{ "No. Pesanan": "A", Jumlah: 1 }, { "No. Pesanan": "B", Jumlah: 2 }], "f.xlsx");
    const b = await hitungFingerprint([{ "No. Pesanan": "B", Jumlah: 2 }, { "No. Pesanan": "A", Jumlah: 1 }], "f.xlsx");
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("beda isi / beda nama file → beda hash", async () => {
    const a = await hitungFingerprint([{ "No. Pesanan": "A" }], "f.xlsx");
    const b = await hitungFingerprint([{ "No. Pesanan": "A" }], "g.xlsx");
    const c = await hitungFingerprint([{ "No. Pesanan": "B" }], "f.xlsx");
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  it("nilai objek/array berbeda tidak bertabrakan jadi '[object Object]'", async () => {
    const a = await hitungFingerprint([{ x: { a: 1 } }], "f.xlsx");
    const b = await hitungFingerprint([{ x: { a: 2 } }], "f.xlsx");
    assert.notEqual(a, b);
  });

  it("kunci objek berbeda urutan → hash sama (kanonik)", async () => {
    const a = await hitungFingerprint([{ x: { a: 1, b: 2 } }], "f.xlsx");
    const b = await hitungFingerprint([{ x: { b: 2, a: 1 } }], "f.xlsx");
    assert.equal(a, b);
  });

  it("kolom bernilai kosong dibuang, nilai '=' tetap ikut", async () => {
    const a = await hitungFingerprint([{ k: "=", kosong: "" }], "f.xlsx");
    const b = await hitungFingerprint([{ k: "=" }], "f.xlsx");
    const c = await hitungFingerprint([{ kosong: "" }], "f.xlsx");
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

describe("cekFileSudahAda / catatImportFile", () => {
  it("catat lalu cek mengembalikan baris", async () => {
    const { db } = buatDb();
    const hash = await hitungFingerprint([{ "No. Pesanan": "A" }], "f.xlsx");
    const id = await catatImportFile(db, { tipe: "orders_toship", file: "f.xlsx", hash, no_json: ["A"], by: "t1" });
    assert.ok(id > 0);
    const found = await cekFileSudahAda(db, "orders_toship", hash);
    assert.equal(found?.id, id);
    assert.equal(found?.no_json, '["A"]');
  });

  it("hash sama tipe beda = file berbeda", async () => {
    const { db } = buatDb();
    const hash = "x".repeat(64);
    await catatImportFile(db, { tipe: "orders_toship", file: "f.xlsx", hash, no_json: [] });
    assert.equal(await cekFileSudahAda(db, "advance", hash), null);
    assert.notEqual(await cekFileSudahAda(db, "orders_toship", hash), null);
  });

  it("catat dua kali tidak menggandakan, kembalikan id lama", async () => {
    const { db, files } = buatDb();
    const hash = "y".repeat(64);
    const id1 = await catatImportFile(db, { tipe: "orders_toship", file: "f.xlsx", hash, no_json: ["A"] });
    const id2 = await catatImportFile(db, { tipe: "orders_toship", file: "f.xlsx", hash, no_json: ["A"] });
    assert.equal(id1, id2);
    assert.equal(files.length, 1);
  });
});
