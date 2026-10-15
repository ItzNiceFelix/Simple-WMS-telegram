// Uji pencatatan picklist yang dicetak.
//
// Yang dijaga bukan "berhasil menulis", tapi hal yang mahal kalau salah: satu pesanan yang
// dicetak dengan cara berbeda harus tampak sebagai BEBERAPA cara (itu inti permintaan user),
// sementara cetak ulang dengan cara yang sama tetap satu baris — kalau tidak, tag di halaman
// order akan berbohong soal mode mana yang sebenarnya sudah dijalankan.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { catatEksporPicklist, petaEkspor } from "./picklistEkspor";

type Row = {
  marketplace: string;
  no_pesanan: string;
  mode: string;
  at: number;
  oleh: string | null;
  jumlah_cetak: number;
};

type DbUji = {
  rows: Row[];
  prepare(sql: string): unknown;
  batch(sts: { _sql: string; _args: unknown[] }[]): Promise<unknown[]>;
};

function buatDb(): DbUji {
  const rows: Row[] = [];
  const db = {
    rows,
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...a: unknown[]) {
          st._args = a;
          return st;
        },
        async all<T>() {
          // Pola "(marketplace = ? AND no_pesanan = ?) OR (...)" — argumen berpasangan.
          const a = st._args;
          const pasangan: [string, string][] = [];
          for (let i = 0; i < a.length; i += 2) pasangan.push([String(a[i]), String(a[i + 1])]);
          const out = rows
            .filter((r) => pasangan.some(([mp, no]) => mp === r.marketplace && no === r.no_pesanan))
            .map((r) => ({ marketplace: r.marketplace, no_pesanan: r.no_pesanan, mode: r.mode }));
          return { results: out as T[] };
        },
      };
      return st;
    },
    async batch(sts: { _sql: string; _args: unknown[] }[]) {
      for (const s of sts) {
        const [mp, no, mode, at, oleh] = s._args as [string, string, string, number, string | null];
        const ada = rows.find((r) => r.marketplace === mp && r.no_pesanan === no && r.mode === mode);
        if (ada) {
          ada.jumlah_cetak += 1;
          ada.at = at;
          ada.oleh = oleh;
        } else {
          rows.push({ marketplace: mp, no_pesanan: no, mode, at, oleh, jumlah_cetak: 1 });
        }
      }
      return [];
    },
  };
  return db;
}

const target = { mp: "shopee", no: "SHP-1" };

describe("catatEksporPicklist", () => {
  it("cetak pertama menulis satu baris dengan jumlah_cetak 1", async () => {
    const db = buatDb();
    await catatEksporPicklist(db as never, [target], "per_paket", "u1");
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0]!.jumlah_cetak, 1);
    assert.equal(db.rows[0]!.mode, "per_paket");
    assert.equal(db.rows[0]!.oleh, "u1");
  });

  it("cetak ulang mode sama TIDAK menambah baris", async () => {
    const db = buatDb();
    await catatEksporPicklist(db as never, [target], "pisah", "u1");
    await catatEksporPicklist(db as never, [target], "pisah", "u2");
    assert.equal(db.rows.length, 1, "tetap satu baris");
    assert.equal(db.rows[0]!.jumlah_cetak, 2, "cetakan kedua terhitung");
    assert.equal(db.rows[0]!.oleh, "u2", "pencetak terakhir diperbarui");
  });

  it("mode berbeda untuk pesanan sama jadi baris terpisah", async () => {
    const db = buatDb();
    await catatEksporPicklist(db as never, [target], "per_paket", "u1");
    await catatEksporPicklist(db as never, [target], "gabung", "u1");
    await catatEksporPicklist(db as never, [target], "gabung-order", "u1");
    assert.equal(db.rows.length, 3, "satu pesanan boleh punya beberapa mode");
    assert.deepEqual(
      db.rows.map((r) => r.mode).sort(),
      ["gabung", "gabung-order", "per_paket"]
    );
    assert.deepEqual(
      db.rows.map((r) => r.jumlah_cetak),
      [1, 1, 1]
    );
  });

  it("target duplikat dalam satu cetakan tetap satu baris", async () => {
    const db = buatDb();
    await catatEksporPicklist(db as never, [target, target], "pisah", "u1");
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0]!.jumlah_cetak, 1, "satu lembar, bukan dua");
  });

  it("menolak mode tak sah dan tidak menulis apa pun", async () => {
    const db = buatDb();
    await assert.rejects(() => catatEksporPicklist(db as never, [target], "mode-ngawur", "u1"));
    assert.equal(db.rows.length, 0);
  });

  it("daftar target kosong tidak menyentuh DB", async () => {
    const db = buatDb();
    await catatEksporPicklist(db as never, [], "pisah", "u1");
    assert.equal(db.rows.length, 0);
  });
});

describe("petaEkspor", () => {
  it("mengembalikan daftar mode per mp|no", async () => {
    const db = buatDb();
    await catatEksporPicklist(db as never, [target], "per_paket", "u1");
    await catatEksporPicklist(db as never, [target], "gabung", "u1");
    await catatEksporPicklist(db as never, [{ mp: "tokopedia", no: "TP-9" }], "pisah", "u1");

    const peta = await petaEkspor(db as never, [
      target,
      { mp: "tokopedia", no: "TP-9" },
      { mp: "shopee", no: "BELUM-PERNAH" },
    ]);
    assert.deepEqual(peta.get("shopee|SHP-1")?.sort(), ["gabung", "per_paket"]);
    assert.deepEqual(peta.get("tokopedia|TP-9"), ["pisah"]);
    assert.equal(peta.get("shopee|BELUM-PERNAH"), undefined, "pesanan belum pernah dicetak tidak punya entri");
  });

  it("daftar kosong mengembalikan peta kosong tanpa kueri", async () => {
    const db = buatDb();
    const peta = await petaEkspor(db as never, []);
    assert.equal(peta.size, 0);
  });
});
