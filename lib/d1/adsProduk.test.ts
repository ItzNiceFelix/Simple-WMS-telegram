// lib/d1/adsProduk.test.ts — Uji parser iklan + penulisan akumulatif ke `ads_produk`.
//
// Mock D1 dibuat manual (pola sama dengan lib/d1/order.test.ts): uji ini menguji SQL
// akumulatif kita, bukan D1. Kalau ON CONFLICT berubah jadi timpa, uji ini gagal.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bacaCsv, bacaPeriode, cariBarisHeader, imporIklan, parseIklan, totalIklan } from "./adsProduk";
import type { Hasil } from "./hasil";

const BOM = "\uFEFF";
const PEMBUKA = "Semua Laporan Iklan CPC - Shopee Indonesia\r\nUsername,tokohanaa\r\nNama Toko,tokohanaa\r\nID Toko,9277069\r\n";
const WAKTU = "Waktu Laporan Dibuat,14/10/2026 13:47\r\nPeriode,14/10/2026 - 14/10/2026\r\n\r\n";
const HEADER = "Urutan,Nama Iklan,Status,Jenis Iklan,Kode Produk,Tampilan Iklan,Mode Bidding,Penempatan Iklan,Tanggal Mulai,Tanggal Selesai,Dilihat,Jumlah Klik,Persentase Klik,Tambah ke Keranjang,Persentase Tambah ke Keranjang,Konversi,Konversi Langsung,Tingkat konversi,Tingkat Konversi Langsung,Biaya per Konversi,Biaya per Konversi Langsung,Produk Terjual,Terjual Langsung,Omzet Penjualan,Penjualan Langsung (GMV Langsung),Biaya,Efektifitas Iklan,Efektivitas Langsung,ACOS,ACOS Langsung,Jumlah Produk Dilihat,Jumlah Klik Produk,Persentase Klik Produk,Voucher Amount,Vouchered Sales";

/** 35 sel: hanya kolom yang dibaca yang penting; sisanya "-". */
function baris(nama: string, kode: string, status: string, dilihat: string, klik: string, omzet: string, biaya: string): string {
  const sel = Array<string>(35).fill("-");
  sel[0] = "1";
  sel[1] = nama;
  sel[2] = status;
  sel[3] = "Iklan Produk";
  sel[4] = kode;
  sel[10] = dilihat;
  sel[11] = klik;
  sel[23] = omzet;
  sel[25] = biaya;
  return sel.join(",");
}

const KODE_A = "20076426310";
const KODE_B = "18676008716";

function teksUji(barisData: string[]): string {
  return BOM + PEMBUKA + WAKTU + HEADER + "\r\n" + barisData.join("\r\n") + "\r\n";
}

type Row = Record<string, unknown>;

function buatDb() {
  const ads = new Map<string, Row>();
  const db = {
    ads,
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...a: unknown[]) {
          st._args = a;
          return st;
        },
        async first(): Promise<unknown> {
          const a = st._args;
          if (sql.startsWith("SELECT COUNT(*) AS n, COALESCE(SUM(biaya), 0) AS biaya FROM ads_produk")) {
            const [presetId, dari, sampai] = a;
            const cocok = [...ads.values()].filter(
              (r) => Number(r["preset_id"]) === Number(presetId) && String(r["tanggal"]) >= String(dari) && String(r["tanggal"]) <= String(sampai)
            );
            return { n: cocok.length, biaya: cocok.reduce((s, r) => s + Number(r["biaya"] ?? 0), 0) };
          }
          return null;
        },
        async run() {
          if (st._sql.startsWith("UPDATE ads_produk")) return { meta: {} };
          return { meta: {} };
        },
      };
      return st;
    },
    async batch(stmts: { _sql: string; _args: unknown[] }[]) {
      for (const s of stmts) {
        if (!s._sql.startsWith("INSERT INTO ads_produk")) continue;
        // Meniru ON CONFLICT(preset_id, tanggal, sku) DO UPDATE SET biaya = excluded.biaya, ...
        const [presetId, tanggal, sku, biaya, klik, dilihat, omzet] = s._args as [number, string, string, number, number, number, number];
        const k = `${presetId}|${tanggal}|${sku}`;
        const lama = ads.get(k);
        ads.set(k, {
          preset_id: presetId,
          tanggal,
          sku,
          biaya,
          klik: Number(lama?.["klik"] ?? 0) + klik,
          dilihat: Number(lama?.["dilihat"] ?? 0) + dilihat,
          omzet_iklan: Number(lama?.["omzet_iklan"] ?? 0) + omzet,
          at: s._args[7],
        });
      }
      return [];
    },
  };
  return db as unknown as D1Database & { ads: Map<string, Row> };
}

describe("bacaCsv", () => {
  it("buang BOM, tangani CRLF, dan jaga koma di dalam kutip tetap satu kolom", () => {
    const teks =
      BOM +
      'Urutan,Nama Iklan,Kode Produk\r\n' +
      '9,"Rak Kosmetik Plastik 3 Susun - Desain Panda Lucu, Mudah Dirapikan, 17x14x18 cm",51011327218\r\n';
    const rows = bacaCsv(teks);
    assert.equal(rows[0][0], "Urutan");
    assert.equal(rows.length, 2);
    assert.equal(rows[1].length, 3);
    assert.equal(rows[1][1], "Rak Kosmetik Plastik 3 Susun - Desain Panda Lucu, Mudah Dirapikan, 17x14x18 cm");
    assert.equal(rows[1][2], "51011327218");
  });

  it("kutip ganda di dalam kutip jadi satu kutip harfiah", () => {
    const rows = bacaCsv('a,"Rak 17"" x 14"", tinggi",b\n');
    assert.deepEqual(rows[0], ["a", 'Rak 17" x 14", tinggi', "b"]);
  });
});

describe("cariBarisHeader", () => {
  it("menemukan header di indeks 7 — setelah 7 baris pembuka (6 metadata + 1 kosong)", () => {
    const rows = bacaCsv(teksUji([baris("Iklan A", KODE_A, "Berjalan", "1", "0", "0", "0")]));
    assert.equal(cariBarisHeader(rows), 7);
    assert.equal(rows[7][0], "Urutan");
  });

  it("-1 bila tidak ada baris 'Urutan'", () => {
    assert.equal(cariBarisHeader(bacaCsv("Username,tokohanaa\nfoo,bar\n")), -1);
  });
});

describe("bacaPeriode", () => {
  it("parse DD/MM/YYYY - DD/MM/YYYY ke ISO", () => {
    const rows = bacaCsv(teksUji([]));
    assert.deepEqual(bacaPeriode(rows, 6), { dari: "2026-10-14", sampai: "2026-10-14" });
  });
});

describe("parseIklan", () => {
  const teks = teksUji([
    baris("Grup Iklan 08/10/2026 - 1", "-", "Berjalan", "194", "3", "441500", "0"),
    baris("Lunch Box TRI J 4in1", KODE_A, "Berjalan", "345", "0", "56464", "441.500"),
    baris("TERMOS NASI 17 TRI J", KODE_B, "Dijeda", "-", "-", "-", "19362"),
    "",
  ]);

  it("hitung baris tanpa kode produk (iklan grup) sebagai dilewatiTanpaKode", () => {
    const h = parseIklan(teks);
    assert.equal(h.barisHeader, 7);
    assert.equal(h.dilewatiTanpaKode, 1);
    assert.equal(h.baris.length, 2);
    assert.deepEqual(h.periode, { dari: "2026-10-14", sampai: "2026-10-14" });
  });

  it("klik/dilihat '-' jadi null, bukan 0", () => {
    const h = parseIklan(teks);
    const a = h.baris.find((b) => b.kodeProduk === KODE_A);
    const b = h.baris.find((b) => b.kodeProduk === KODE_B);
    assert.equal(a?.klik, 0);
    assert.equal(a?.dilihat, 345);
    assert.equal(b?.klik, null);
    assert.equal(b?.dilihat, null);
    assert.equal(b?.omzetIklan, 0);
  });

  it('biaya "441.500" -> 441500 (titik = ribuan) dan "19362" -> 19362', () => {
    const h = parseIklan(teks);
    assert.equal(h.baris.find((b) => b.kodeProduk === KODE_A)?.biaya, 441500);
    assert.equal(h.baris.find((b) => b.kodeProduk === KODE_B)?.biaya, 19362);
  });

  it("header tidak ada -> hasil kosong, bukan lempar", () => {
    const h = parseIklan("Username,tokohanaa\r\nfoo,bar\r\n");
    assert.equal(h.barisHeader, -1);
    assert.equal(h.baris.length, 0);
  });
});

describe("imporIklan", () => {
  const teks = teksUji([
    baris("Lunch Box TRI J 4in1", KODE_A, "Berjalan", "345", "2", "56464", "441.500"),
    baris("Lunch Box TRI J varian 2", KODE_A, "Berjalan", "10", "1", "1000", "1000"),
    baris("TERMOS NASI", KODE_B, "Dijeda", "1", "0", "0", "500"),
    baris("Grup Iklan", "-", "Berjalan", "9", "1", "0", "0"),
  ]);

  it("kode tanpa peta dihitung + dicontohkan; kode dengan peta ditulis; biaya akumulatif", async () => {
    const db = buatDb();
    const peta = new Map([[KODE_A, ["SKU-A"]]]);
    const r = await imporIklan(db, teks, 7, null, peta);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.dilewatiTanpaKode, 1);
    assert.equal(r.dilewatiTanpaPeta, 1);
    assert.deepEqual(r.kodeTanpaPeta, [KODE_B]);
    assert.equal(r.tersimpan, 1);

    // Dua baris iklan dengan SKU & tanggal sama dalam SATU impor -> dijumlahkan di memori.
    const row = db.ads.get("7|2026-10-14|SKU-A");
    assert.ok(row);
    assert.equal(row["biaya"], 442500);
    assert.equal(row["klik"], 3);
    assert.equal(row["dilihat"], 355);
    assert.equal(row["omzet_iklan"], 57464);
    assert.equal(db.ads.size, 1);
  });

  it("impor kedua pada tanggal sama MENIMPA (idempoten), tidak menggandakan biaya", async () => {
    const db = buatDb();
    const peta = new Map([[KODE_A, ["SKU-A"]]]);
    await imporIklan(db, teks, 7, null, peta);
    await imporIklan(db, teks, 7, null, peta);
    assert.equal(db.ads.size, 1);
    // Dulu 885000 (dua kali lipat) karena ON CONFLICT menjumlahkan. Berkas yang sama
    // diunggah ulang tidak boleh mengubah angka.
    assert.equal(db.ads.get("7|2026-10-14|SKU-A")?.["biaya"], 442500);
  });

  it("gagal 400 bila header lebih sempit dari kolom yang dibaca (ekspor bergeser)", async () => {
    // Tanpa validasi ini, `KOL.biaya` menunjuk kolom lain dan angkanya tetap "masuk akal".
    const db = buatDb();
    const sempit = "Urutan,Username\r\n1,tokohanaa\r\n";
    const r: Hasil<unknown> = await imporIklan(db, sempit, 7, null, new Map());
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 400);
      assert.match(String(r.error), /Format ekspor Shopee Ads berubah/);
    }
  });

  it("gagal 400 bila header tidak ada", async () => {
    const db = buatDb();
    const r: Hasil<unknown> = await imporIklan(db, "Username,tokohanaa\r\nfoo,bar\r\n", 7, null, new Map());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 400);
  });
});

describe("totalIklan", () => {
  it("belum ada baris -> null (bukan nol)", async () => {
    const db = buatDb();
    assert.equal(await totalIklan(db, 7, "2026-10-01", "2026-10-31"), null);
  });

  it("ada baris -> jumlah baris & biaya benar", async () => {
    const db = buatDb();
    await imporIklan(db, teksUji([baris("Iklan A", KODE_A, "Berjalan", "1", "1", "100", "1000")]), 7, null, new Map([[KODE_A, ["SKU-A"]]]));
    await imporIklan(db, teksUji([baris("Iklan B", KODE_B, "Berjalan", "1", "1", "100", "2500")]), 7, null, new Map([[KODE_B, ["SKU-B"]]]));
    const t = await totalIklan(db, 7, "2026-10-14", "2026-10-14");
    assert.deepEqual(t, { baris: 2, biaya: 3500 });
    // Rentang di luar tanggal laporan -> null.
    assert.equal(await totalIklan(db, 7, "2026-11-01", "2026-11-30"), null);
  });
});
