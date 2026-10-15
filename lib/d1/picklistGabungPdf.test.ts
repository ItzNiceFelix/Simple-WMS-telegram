// Uji penggabungan baris picklist gabungan (order + advance).
//
// Yang dijaga: penggabungan TIDAK boleh menyatukan barang yang harus diambil dari tempat
// berbeda. Kalau salah gabung, picker mengambil satu tumpukan padahal harusnya dua —
// kesalahannya baru ketahuan setelah paket dikirim ke pembeli.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gabungPerSku, bangunPdfPicklistGabung, type BarisPickGabung } from "./picklistGabungPdf";

const b = (o: Partial<BarisPickGabung> & { sku: string }): BarisPickGabung => ({
  jenis: "order",
  nama: "Piring Melamin",
  lokasi: "GDG-A",
  qty: 1,
  kunci: "RESI-1",
  kirimKe: "SHP-1",
  ...o,
});

describe("gabungPerSku", () => {
  it("menggabungkan baris identik dari order berbeda dan menjumlahkan qty", () => {
    const hasil = gabungPerSku([
      b({ sku: "A", qty: 3, kunci: "RESI-1" }),
      b({ sku: "A", qty: 2, kunci: "RESI-2" }),
    ]);
    assert.equal(hasil.length, 1);
    assert.equal(hasil[0]!.qty, 5);
    assert.equal(hasil[0]!.rincian.length, 2, "asal-usul tetap disimpan untuk checker");
  });

  it("TIDAK menggabungkan SKU berbeda", () => {
    const hasil = gabungPerSku([b({ sku: "A", qty: 3 }), b({ sku: "B", qty: 2 })]);
    assert.equal(hasil.length, 2);
  });

  it("TIDAK menggabungkan lokasi gudang berbeda walau SKU sama", () => {
    const hasil = gabungPerSku([
      b({ sku: "A", lokasi: "GDG-A", qty: 3 }),
      b({ sku: "A", lokasi: "GDG-B", qty: 2 }),
    ]);
    assert.equal(hasil.length, 2, "diambil dari dua rak berbeda, tidak boleh jadi satu baris");
    assert.deepEqual(hasil.map((r) => r.qty).sort(), [2, 3]);
  });

  it("menggabungkan order dan advance untuk SKU + lokasi yang sama", () => {
    const hasil = gabungPerSku([
      b({ sku: "A", jenis: "order", qty: 2, kunci: "RESI-9" }),
      b({ sku: "A", jenis: "advance", qty: 4, kunci: "BK-7", kirimKe: "JNE" }),
    ]);
    assert.equal(hasil.length, 1);
    assert.equal(hasil[0]!.qty, 6);
    assert.deepEqual(hasil[0]!.rincian.map((r) => r.jenis).sort(), ["advance", "order"]);
  });

  it("mengurutkan per lokasi supaya picker menyisir rak berurutan", () => {
    const hasil = gabungPerSku([
      b({ sku: "B", lokasi: "GDG-Z" }),
      b({ sku: "A", lokasi: "GDG-A" }),
    ]);
    assert.deepEqual(hasil.map((r) => r.lokasi), ["GDG-A", "GDG-Z"]);
  });

  it("daftar kosong menghasilkan daftar kosong", () => {
    assert.deepEqual(gabungPerSku([]), []);
  });
});

describe("bangunPdfPicklistGabung", () => {
  it("menghasilkan PDF valid", async () => {
    const bytes = await bangunPdfPicklistGabung([
      b({ sku: "A", qty: 3, jenis: "order" }),
      b({ sku: "B", qty: 2, jenis: "advance", kunci: "BK-1", kirimKe: "JNE" }),
    ]);
    assert.ok(bytes.length > 800, `PDF terlalu kecil: ${bytes.length} byte`);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  });

  it("PDF kosong tetap terbentuk, bukan melempar", async () => {
    const bytes = await bangunPdfPicklistGabung([]);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  });

  it("banyak baris tetap jadi PDF (paginasi tidak rusak)", async () => {
    const banyak: BarisPickGabung[] = [];
    for (let i = 0; i < 120; i++) banyak.push(b({ sku: `SKU-${i}`, nama: `Produk ${i}`, qty: i + 1 }));
    const bytes = await bangunPdfPicklistGabung(banyak);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
    assert.ok(bytes.length > 2000);
  });
});
