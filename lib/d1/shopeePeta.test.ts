// lib/d1/shopeePeta.test.ts — Uji CRUD peta Shopee dengan D1 tiruan (pola lib/d1/order.test.ts).
// Yang diuji adalah PERILAKU YANG MAHAL KALAU SALAH: keputusan manusia tidak boleh tertimpa,
// "" harus tersimpan sebagai keputusan (bukan null), dan pecahan query tidak melewati batas D1.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  daftarPertanyaanBelum,
  daftarSkuMaster,
  jawabPertanyaan,
  petaSkuDariKodeProduk,
  simpanPertanyaan,
} from "./shopeePeta";
import type { PertanyaanPeta } from "@/lib/analisa/peta";

type Row = Record<string, unknown>;

function buatDbPeta() {
  // Kunci baris = `jenis|acuan`, sama dengan UNIQUE (jenis, acuan) di migrasi 0027.
  const putusan: Record<string, Row> = {};
  const shopeeProduk: Row[] = [];
  const products: Row[] = [
    { sku: "A-1", nama_accurate: "Kaos A" },
    { sku: "A-2", nama_accurate: "Kaos A Variasi" },
    { sku: "B-1", nama_accurate: "Celana B" },
  ];
  const panggilan: string[] = [];
  const db = {
    data: { putusan, shopeeProduk, products, panggilan, batch: 0 },
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...a: unknown[]) {
          st._args = a;
          return st;
        },
        async run() {
          const a = st._args;
          panggilan.push(sql);
          if (sql.startsWith("INSERT INTO peta_putusan")) {
            const k = `${a[0]}|${a[1]}`;
            const lama = putusan[k];
            if (lama) {
              // WAJIB meniru DO UPDATE pada kolom pesanan/omzet/nama/kandidat SAJA —
              // kalau mock ikut menulis diputuskan_*, uji tidak membuktikan apa pun.
              lama["pesanan"] = a[3];
              lama["omzet"] = a[4];
              lama["nama_shopee"] = a[2];
              lama["kandidat_json"] = a[5];
            } else {
              putusan[k] = {
                jenis: a[0], acuan: a[1], nama_shopee: a[2], pesanan: a[3], omzet: a[4],
                kandidat_json: a[5], diputuskan_sku: null, diputuskan_at: null, diputuskan_oleh: null,
              };
            }
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE peta_putusan SET diputuskan_sku")) {
            const k = `${a[3]}|${a[4]}`;
            const row = putusan[k];
            if (!row) return { meta: { changes: 0 } };
            row["diputuskan_sku"] = a[0];
            row["diputuskan_at"] = a[1];
            row["diputuskan_oleh"] = a[2];
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO shopee_produk")) {
            const k = `${a[0]}|${a[1]}`;
            const lama = shopeeProduk.find((r) => `${r["kode_produk"]}|${r["sku"]}` === k);
            if (lama) {
              lama["tingkat"] = a[2]; lama["variasi"] = a[3];
              lama["kode_variasi_shopee"] = a[4]; lama["nama_shopee"] = a[5];
            } else {
              shopeeProduk.push({
                kode_produk: a[0], sku: a[1], tingkat: a[2], variasi: a[3],
                kode_variasi_shopee: a[4], nama_shopee: a[5],
              });
            }
            return { meta: { changes: 1 } };
          }
          return { meta: {} };
        },
        async all(): Promise<{ results: unknown[] }> {
          const a = st._args;
          panggilan.push(sql);
          if (sql.includes("FROM peta_putusan")) {
            let r = Object.values(putusan);
            if (sql.includes("diputuskan_at IS NULL")) r = r.filter((x) => x["diputuskan_at"] == null);
            r = [...r].sort((x, y) => Number(y["pesanan"]) - Number(x["pesanan"]) || Number(y["omzet"]) - Number(x["omzet"]));
            return { results: r.slice(0, Number(a[0])) };
          }
          if (sql.startsWith("SELECT sku, nama_accurate FROM products WHERE sku IN")) {
            const mau = new Set(a.map(String));
            return { results: products.filter((p) => mau.has(String(p["sku"]))) };
          }
          if (sql.startsWith("SELECT sku FROM products")) return { results: products };
          if (sql.startsWith("SELECT kode_produk, sku, tingkat FROM shopee_produk")) {
            const mau = new Set(a.map(String));
            const r = shopeeProduk
              .filter((p) => mau.has(String(p["kode_produk"])))
              // Tiru ORDER BY CASE tingkat WHEN 'variasi' THEN 0 ELSE 1 END, sku.
              .sort((x, y) => (x["tingkat"] === y["tingkat"] ? String(x["sku"]).localeCompare(String(y["sku"])) : x["tingkat"] === "variasi" ? -1 : 1));
            return { results: r };
          }
          return { results: [] };
        },
      };
      return st;
    },
    async batch(stmts: { _sql: string; _args: unknown[] }[]) {
      db.data.batch += 1;
      const hasil: { meta: { changes: number } }[] = [];
      for (const s of stmts) hasil.push((await this.prepare(s._sql).bind(...s._args).run()) as { meta: { changes: number } });
      return hasil;
    },
  };
  return db as unknown as D1Database & { data: { putusan: Record<string, Row>; shopeeProduk: Row[]; products: Row[]; panggilan: string[]; batch: number } };
}

const tanya = (kodeProduk: string, pesanan: number, omzet: number): PertanyaanPeta => ({
  jenis: "tanpa_sku", kodeProduk, namaShopee: `Produk ${kodeProduk}`, variasi: null,
  pesanan, omzet, kandidat: [{ sku: "A-1", nama: "Kaos A", skor: 0.9 }],
});

describe("simpanPertanyaan", () => {
  it("tidak menimpa keputusan manusia pada impor berikutnya", async () => {
    const db = buatDbPeta();
    await simpanPertanyaan(db, [tanya("P1", 10, 1000)]);
    await jawabPertanyaan(db, [{ jenis: "tanpa_sku", acuan: "P1", sku: "" }], "owner1");
    assert.equal(db.data.putusan["tanpa_sku|P1"]!["diputuskan_sku"], "");

    await simpanPertanyaan(db, [tanya("P1", 99, 9999)]);

    const row = db.data.putusan["tanpa_sku|P1"]!;
    assert.equal(row["diputuskan_sku"], "", "diputuskan_sku tertimpa impor");
    assert.equal(row["diputuskan_oleh"], "owner1");
    assert.equal(row["pesanan"], 99);
    assert.equal(row["omzet"], 9999);
  });
});

describe("jawabPertanyaan", () => {
  it('menyimpan "" sebagai keputusan "bukan produk kita" dan menghitung baris hilang', async () => {
    const db = buatDbPeta();
    await simpanPertanyaan(db, [tanya("P1", 5, 500), tanya("P2", 4, 400)]);
    const r = await jawabPertanyaan(
      db,
      [
        { jenis: "tanpa_sku", acuan: "P1", sku: "" },
        { jenis: "tanpa_sku", acuan: "TIDAK-ADA", sku: "A-1" },
      ],
      "owner1",
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual({ tersimpan: r.tersimpan, diabaikan: r.diabaikan }, { tersimpan: 1, diabaikan: 1 });
    const row = db.data.putusan["tanpa_sku|P1"]!;
    assert.equal(row["diputuskan_sku"], "");
    assert.notEqual(row["diputuskan_sku"], null);
    assert.equal(row["diputuskan_at"], row["diputuskan_at"]);
    assert.ok(Number(row["diputuskan_at"]) > 0);
    assert.equal(row["diputuskan_oleh"], "owner1");
  });
});

describe("daftarPertanyaanBelum", () => {
  it("mem-parse kandidat_json dan menahan JSON rusak tanpa melempar", async () => {
    const db = buatDbPeta();
    await simpanPertanyaan(db, [tanya("P1", 10, 1000)]);
    await simpanPertanyaan(db, [tanya("P2", 20, 2000)]);
    db.data.putusan["tanpa_sku|P1"]!["kandidat_json"] = "{bukan json";
    await jawabPertanyaan(db, [{ jenis: "tanpa_sku", acuan: "P2", sku: "B-1" }], "owner1");

    const belum = await daftarPertanyaanBelum(db);
    assert.equal(belum.length, 1);
    assert.equal(belum[0]!.acuan, "P1");
    assert.deepEqual(belum[0]!.kandidat_json, []);
  });

  it("mengembalikan kandidat hasil parse dan urut pesanan terbesar", async () => {
    const db = buatDbPeta();
    await simpanPertanyaan(db, [tanya("P1", 10, 1000), tanya("P2", 30, 3000)]);
    const belum = await daftarPertanyaanBelum(db);
    assert.deepEqual(belum.map((b) => b.acuan), ["P2", "P1"]);
    assert.equal(belum[0]!.kandidat_json[0]!.sku, "A-1");
  });
});

describe("petaSkuDariKodeProduk", () => {
  it("mendahulukan tingkat variasi atas induk pada kode yang sama", async () => {
    const db = buatDbPeta();
    db.data.shopeeProduk.push(
      { kode_produk: "P1", sku: "INDUK-1", tingkat: "induk" },
      { kode_produk: "P1", sku: "VAR-1", tingkat: "variasi" },
    );
    const peta = await petaSkuDariKodeProduk(db, ["P1"]);
    assert.deepEqual(peta.get("P1"), [
      { sku: "VAR-1", tingkat: "variasi" },
      { sku: "INDUK-1", tingkat: "induk" },
    ]);
  });
});

describe("daftarSkuMaster", () => {
  it("memotong query pada 90 SKU", async () => {
    const db = buatDbPeta();
    const daftar = Array.from({ length: 100 }, (_, i) => `SKU-${i}`);
    daftar[0] = "A-1";
    const peta = await daftarSkuMaster(db, daftar);
    const kueri = db.data.panggilan.filter((s) => s.startsWith("SELECT sku, nama_accurate FROM products WHERE sku IN"));
    assert.equal(kueri.length, 2);
    assert.equal(peta.get("A-1"), "Kaos A");
  });
});
