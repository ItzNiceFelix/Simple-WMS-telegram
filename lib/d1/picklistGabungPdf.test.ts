// Uji penggabungan baris picklist gabungan (order + advance).
//
// Yang dijaga: penggabungan TIDAK boleh menyatukan barang yang harus diambil dari tempat
// berbeda. Kalau salah gabung, picker mengambil satu tumpukan padahal harusnya dua —
// kesalahannya baru ketahuan setelah paket dikirim ke pembeli.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gabungPerSku, bangunPdfPicklistGabung, type BarisPickGabung } from "./picklistGabungPdf";


/**
 * Bongkar teks yang BENAR-BENAR tergambar di PDF.
 *
 * pdf-lib menulis teks sebagai hex (`<...> Tj`) di dalam stream yang mungkin ter-deflate.
 * Membaca isinya penting: PDF yang "tidak melempar" bisa saja isinya salah — kolom kosong,
 * baris hilang, atau nama yang keliru sumbernya.
 */
async function teksPdf(bytes: Uint8Array): Promise<string[]> {
  const zlib = await import("node:zlib");
  const buf = Buffer.from(bytes);
  // Cari stream mentah lalu dekompres bila perlu.
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf.toString("latin1"))) !== null) {
    let isi = Buffer.from(m[1], "latin1");
    try {
      isi = zlib.inflateSync(isi);
    } catch {
      // tidak ter-deflate: pakai apa adanya
    }
    const teks = isi.toString("latin1");
    const reHex = /<([0-9A-Fa-f]+)>\s*Tj/g;
    let h: RegExpExecArray | null;
    while ((h = reHex.exec(teks)) !== null) out.push(Buffer.from(h[1], "hex").toString("latin1"));
  }
  return out;
}

const b = (o: Partial<BarisPickGabung> & { sku: string }): BarisPickGabung => ({
  jenis: "order",
  nama: "Piring Melamin",
  lokasi: "D12",
  lokasiLain: "",
  qty: 1,
  kunci: "RESI-1",
  kirimKe: "SHP-1",
  perluSku: false,
  skuAsal: "",
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

describe("baris perlu SKU (belum di MP)", () => {
  it("TIDAK digabung ke baris normal walau namanya sama", () => {
    const hasil = gabungPerSku([
      b({ sku: "A", qty: 3 }),
      b({ sku: "+PERLU-SKU-X", nama: "Piring Melamin", qty: 5, perluSku: true, skuAsal: "SKU-SALAH" }),
    ]);
    const normal = hasil.filter((r) => !r.perluSku);
    const bermasalah = hasil.filter((r) => r.perluSku);
    assert.equal(normal.length, 1, "baris normal tetap satu");
    assert.equal(normal[0]!.qty, 3, "qty normal tidak tercampur baris bermasalah");
    assert.equal(bermasalah.length, 1);
    assert.equal(bermasalah[0]!.qty, 5);
    assert.equal(bermasalah[0]!.skuAsal, "SKU-SALAH", "SKU asal dari file dibawa untuk ditampilkan");
  });

  it("beberapa baris bermasalah dengan produk sama tetap terpisah per SKU asal", () => {
    const hasil = gabungPerSku([
      b({ sku: "+P1", perluSku: true, skuAsal: "SALAH-1", qty: 2 }),
      b({ sku: "+P2", perluSku: true, skuAsal: "SALAH-2", qty: 4 }),
    ]);
    assert.equal(hasil.filter((r) => r.perluSku).length, 2, "SKU asal berbeda = baris berbeda");
  });

  it("baris normal tetap digabung lintas order", () => {
    const hasil = gabungPerSku([b({ sku: "A", qty: 2 }), b({ sku: "A", qty: 3, kunci: "RESI-9" })]);
    assert.equal(hasil.length, 1);
    assert.equal(hasil[0]!.qty, 5);
  });
});

describe("lokasi gudang di PDF", () => {
  it("PDF memuat tabel PERLU SKU saat ada baris bermasalah", async () => {
    const bytes = await bangunPdfPicklistGabung([
      b({ sku: "GLK", nama: "Gelas Kaca", lokasi: "D19", qty: 6 }),
      b({ sku: "+P1", nama: "Centong Pelangi", perluSku: true, skuAsal: "SALAH-99", qty: 4, lokasi: "" }),
    ]);
    const teks = await teksPdf(bytes);
    assert.ok(teks.some((t) => t.includes("PERLU SKU")), "judul tabel kedua harus ada");
    assert.ok(teks.includes("Centong Pelangi"), "nama produk bermasalah harus tampil");
    assert.ok(teks.includes("SALAH-99"), "SKU asal dari file harus tampil");
    assert.ok(teks.includes("D19"), "lokasi gudang nyata harus tampil");
  });

  it("gudang lain ditandai pada kolom lokasi", async () => {
    const bytes = await bangunPdfPicklistGabung([
      b({ sku: "X", lokasi: "D19", lokasiLain: "+D12", qty: 24 }),
    ]);
    const teks = await teksPdf(bytes);
    assert.ok(teks.some((t) => t.includes("D19") && t.includes("+D12")), "gudang mayoritas + penanda gudang lain");
  });

  it("tanpa baris bermasalah, tabel kedua TIDAK muncul", async () => {
    const bytes = await bangunPdfPicklistGabung([b({ sku: "A", qty: 1 })]);
    const teks = await teksPdf(bytes);
    assert.ok(!teks.some((t) => t.includes("PERLU SKU")), "jangan tampilkan tabel kosong");
  });
});

describe("tampilan tanpa daftar order per produk", () => {
  it("TIDAK mencetak subbaris Order/Advance (bikin pusing)", async () => {
    const bytes = await bangunPdfPicklistGabung([
      b({ sku: "A", qty: 1, kunci: "SPXID06556490134A", kirimKe: "261015N5MCBPBE" }),
      b({ sku: "A", qty: 1, kunci: "SPXID06258391972A", kirimKe: "261014M176HS98" }),
    ]);
    const teks = await teksPdf(bytes);
    const adaSubbaris = teks.some((t) => t.includes("SPXID06556490134A") || t.includes("261015N5MCBPBE"));
    assert.equal(adaSubbaris, false, "nomor order tidak boleh muncul di badan tabel");
    assert.ok(teks.includes("A"), "SKU tetap tampil");
  });
});
