// Uji peta produk Shopee. Data tiruan MENIRU bentuk nyata `parentskudetail*.xlsx`,
// termasuk cacatnya: dua kolom bernama sama, baris induk tanpa SKU, dan nol depan.
// Justru cacat itulah yang diuji — di file bersih, semua baris kode ini akan lolos
// padahal di produksi salah.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KOL, bangunPeta, bacaAngka, bersih, deteksiKolom, type SkorSku } from "./peta";

/** Bikin satu baris ekspor Shopee (kolom 0..34, sesuai KOL). */
function baris(kolom: {
  kodeProduk?: string; produk?: string; kodeVariasiShopee?: string;
  namaVariasi?: string; skuVariasi?: string; skuInduk?: string;
  omzet?: string; pesanan?: string;
  dilihat?: string; klik?: string; kunjungan?: string; keranjang?: string; tanpaBeli?: string;
}): unknown[] {
  const r: unknown[] = new Array(KOL.keranjang + 1).fill("");
  if (kolom.kodeProduk !== undefined) r[KOL.kodeProduk] = kolom.kodeProduk;
  if (kolom.produk !== undefined) r[KOL.produk] = kolom.produk;
  if (kolom.kodeVariasiShopee !== undefined) r[KOL.kodeVariasiShopee] = kolom.kodeVariasiShopee;
  if (kolom.namaVariasi !== undefined) r[KOL.namaVariasi] = kolom.namaVariasi;
  if (kolom.skuVariasi !== undefined) r[KOL.skuVariasi] = kolom.skuVariasi;
  if (kolom.skuInduk !== undefined) r[KOL.skuInduk] = kolom.skuInduk;
  if (kolom.omzet !== undefined) r[KOL.omzet] = kolom.omzet;
  if (kolom.pesanan !== undefined) r[KOL.pesanan] = kolom.pesanan;
  if (kolom.dilihat !== undefined) r[KOL.dilihat] = kolom.dilihat;
  if (kolom.klik !== undefined) r[KOL.klik] = kolom.klik;
  if (kolom.kunjungan !== undefined) r[KOL.kunjungan] = kolom.kunjungan;
  if (kolom.keranjang !== undefined) r[KOL.keranjang] = kolom.keranjang;
  if (kolom.tanpaBeli !== undefined) r[KOL.tanpaBeli] = kolom.tanpaBeli;
  return r;
}

/** Header tiruan yang meniru judul nyata `parentskudetail*.xlsx` (40 kolom).
 *  Dua kolom `Kode Variasi` (3 dan 6) dan `Total Penjualan (...)` sengaja apa adanya —
 *  justru keduanya yang dulu merusak pembacaan per nama. */
const HEADER: unknown[] = (() => {
  const h: unknown[] = new Array(40).fill("");
  h[0] = "Kode Produk"; h[1] = "Produk"; h[2] = "Status Produk Saat Ini";
  h[3] = "Kode Variasi"; h[4] = "Nama Variasi"; h[5] = "Status Variasi Saat Ini";
  h[6] = "Kode Variasi"; h[7] = "SKU Induk";
  h[8] = "Total Penjualan (Pesanan Dibuat) (IDR)"; h[9] = "Penjualan (Pesanan Siap Dikirim) (IDR)";
  h[10] = "Jumlah Produk Dilihat"; h[11] = "Produk Diklik"; h[12] = "Persentase Klik";
  h[13] = "Tingkat Konversi Pesanan (Pesanan Dibuat)"; h[14] = "Tingkat Konversi Pesanan (Pesanan Siap Dikirim)";
  h[15] = "Pesanan Dibuat"; h[16] = "Pesanan Siap Dikirim";
  h[17] = "Produk (Pesanan Dibuat)"; h[18] = "Produk (Pesanan Siap Dikirim)";
  h[19] = "Total Pembeli (Pesanan Dibuat)"; h[20] = "Total Pembeli (Pesanan Siap Dikirim)";
  h[27] = "Pengunjung Produk (Kunjungan)"; h[29] = "Pengunjung Melihat Tanpa Membeli";
  h[33] = "Pengunjung Produk (Menambahkan Produk ke Keranjang)";
  h[34] = "Dimasukkan ke Keranjang (Produk)";
  h[35] = "Tingkat Konversi Produk Dimasukkan ke Keranjang";
  return h;
})();

describe("bacaAngka", () => {
  it("membuang titik ribuan Indonesia", () => {
    assert.equal(bacaAngka("1.234.567"), 1234567);
    assert.equal(bacaAngka("12.196.885"), 12196885);
  });

  it("koma desimal dibulatkan, titik tunggal dibaca ribuan", () => {
    // "538.5" di ekspor Shopee adalah 538,5 (desimal) -> 539, BUKAN 5385.
    assert.equal(bacaAngka("538.5"), 539);
    assert.equal(bacaAngka("1.234,6"), 1235);
  });

  it("nilai kosong dan tak sah jadi 0", () => {
    assert.equal(bacaAngka(null), 0);
    assert.equal(bacaAngka(undefined), 0);
    assert.equal(bacaAngka("-"), 0);
    assert.equal(bacaAngka("abc"), 0);
    assert.equal(bacaAngka(""), 0);
  });

  it("number langsung dibulatkan", () => {
    assert.equal(bacaAngka(1250000), 1250000);
    assert.equal(bacaAngka(538.5), 539);
    assert.equal(bacaAngka(Number.NaN), 0);
  });

  it("teks berformat Rp tetap terbaca", () => {
    assert.equal(bacaAngka("Rp 1.500.000"), 1500000);
    assert.equal(bacaAngka("-1.500"), -1500);
  });
});

describe("bersih", () => {
  it("kosong jadi string kosong", () => {
    assert.equal(bersih(null), "");
    assert.equal(bersih(undefined), "");
    assert.equal(bersih("-"), "");
    assert.equal(bersih("  "), "");
  });

  it("teks dipangkas spasinya", () => {
    assert.equal(bersih(" BIRU "), "BIRU");
    assert.equal(bersih("COKLAT"), "COKLAT");
  });
});

describe("bangunPeta", () => {
  const master = new Set(["001770", "1212", "0174", "AAA", "BBB", "001203"]);

  it("produk yang SUDAH terpetakan lewat variasi TIDAK memunculkan pertanyaan", () => {
    // Kenapa ini penting: baris induk selalu kosong ketiga kolom SKU-nya, dan selalu
    // datang SEBELUM baris variasinya. Kalau pertanyaan diambil sambil jalan, setiap
    // produk akan ditanyakan dari baris induknya walau SKU-nya ada di baris variasi
    // di bawahnya — di file nyata itu menghasilkan 564 pertanyaan palsu yang menutupi
    // 22 pertanyaan sungguhan.
    const rows = [
      HEADER,
      baris({ kodeProduk: "28753717561", produk: "Kemeja", kodeVariasiShopee: "-", namaVariasi: "-", skuVariasi: "-", skuInduk: "-", omzet: "5.000.000", pesanan: "100" }),
      baris({ kodeProduk: "28753717561", produk: "Kemeja", kodeVariasiShopee: "138333482525", namaVariasi: "BIRU", skuVariasi: "001770", omzet: "5.000.000", pesanan: "100" }),
      baris({ kodeProduk: "28753717561", produk: "Kemeja", kodeVariasiShopee: "138333482526", namaVariasi: "COKLAT", skuVariasi: "1212", omzet: "5.000.000", pesanan: "100" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.baris.length, 2);
    assert.deepEqual(h.baris.map((b) => b.tingkat), ["variasi", "variasi"]);
    assert.deepEqual(h.baris.map((b) => b.sku), ["001770", "1212"]);
    assert.equal(h.baris[0].variasi, "BIRU");
    assert.equal(h.baris[0].kodeVariasiShopee, "138333482525");
    assert.equal(h.baris[0].namaShopee, "Kemeja");
    assert.equal(h.pertanyaan.length, 0, "sudah terpetakan -> tidak ada pertanyaan");
    // Pesanan/omzet tetap dihitung dari baris induk saja (tidak berlipat ganda).
    assert.equal(h.ringkas.pesananTotal, 100);
    assert.equal(h.ringkas.omzetTotal, 5000000);
    assert.equal(h.ringkas.pesananTerpetakan, 100);
    assert.equal(h.ringkas.terpetakan, 1);
  });

  it("produk TANPA SKU sama sekali tetap jadi pertanyaan (pesanan dari baris induk)", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "999", produk: "Rak Buku", kodeVariasiShopee: "-", namaVariasi: "-", skuVariasi: "-", skuInduk: "-", omzet: "1.000.000", pesanan: "23" }),
      baris({ kodeProduk: "999", produk: "Rak Buku", kodeVariasiShopee: "555111", namaVariasi: "TANPADUS", skuVariasi: "-", skuInduk: "-", omzet: "1.000.000", pesanan: "23" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.baris.length, 0, "tidak ada SKU yang cocok");
    assert.equal(h.pertanyaan.length, 1);
    assert.equal(h.pertanyaan[0].jenis, "tanpa_sku");
    assert.equal(h.pertanyaan[0].pesanan, 23);
    assert.equal(h.pertanyaan[0].omzet, 1000000);
  });

  it("satu produk dengan baris induk DAN variasi asing hanya jadi SATU pertanyaan", () => {
    // Bentuk nyata: baris induk tanpa SKU, lalu variasi yang SKU-nya tidak ada di master.
    // Dulu kunci dedup memakai (jenis, kodeProduk), sehingga produk yang sama muncul DUA
    // kali di Peta SKU — user diminta memutuskan produk yang sama dua kali.
    const rows = [
      HEADER,
      baris({ kodeProduk: "P4990", produk: "Nama produk 4990", kodeVariasiShopee: "-", namaVariasi: "-", skuVariasi: "-", skuInduk: "-", omzet: "19.990", pesanan: "7" }),
      baris({ kodeProduk: "P4990", produk: "Nama produk 4990", kodeVariasiShopee: "V1", namaVariasi: "Merah", skuVariasi: "SKU-ASING", skuInduk: "-", omzet: "19.990", pesanan: "7" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.pertanyaan.length, 1, "satu produk = satu pertanyaan");
    // Jenis yang menang: yang punya SKU (lebih berguna untuk dicocokkan ke master).
    assert.equal(h.pertanyaan[0].jenis, "sku_tak_ada_master");
    assert.equal(h.pertanyaan[0].kodeProduk, "P4990");
    // Pesanan dihitung sekali (dari baris induk), tidak dobel.
    assert.equal(h.pertanyaan[0].pesanan, 7);
  });

  it("kolom 6 kosong tapi kolom 7 terisi -> tingkat induk", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "900", produk: "Topi", kodeVariasiShopee: "111", namaVariasi: "HITAM", skuVariasi: "-", skuInduk: "0174", omzet: "200.000", pesanan: "4" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.baris.length, 1);
    assert.equal(h.baris[0].tingkat, "induk");
    assert.equal(h.baris[0].sku, "0174");
  });

  it("PRIORITAS: kolom 6 menang atas kolom 7 walau keduanya ada di master", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "901", produk: "Kaos", kodeVariasiShopee: "222", namaVariasi: "MERAH", skuVariasi: "AAA", skuInduk: "BBB", omzet: "300.000", pesanan: "6" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.baris.length, 1);
    assert.equal(h.baris[0].sku, "AAA");
    assert.equal(h.baris[0].tingkat, "variasi");
  });

  it("SKU tidak ada di master jadi pertanyaan sku_tak_ada_master", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "902", produk: "Celana", kodeVariasiShopee: "333", namaVariasi: "BIRU", skuVariasi: "999999", omzet: "400.000", pesanan: "3" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.baris.length, 0);
    assert.equal(h.pertanyaan.length, 1);
    assert.equal(h.pertanyaan[0].jenis, "sku_tak_ada_master");
  });

  it("NOL DEPAN TIDAK DIBUANG: 1203 != 001203", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "903", produk: "Sepatu", kodeVariasiShopee: "444", namaVariasi: "PUTIH", skuVariasi: "1203", omzet: "400.000", pesanan: "3" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.baris.length, 0, "1203 tidak boleh dianggap 001203");
    assert.equal(h.pertanyaan.length, 1);
    assert.equal(h.pertanyaan[0].jenis, "sku_tak_ada_master");
  });

  it("pesanan/omzet HANYA dari baris induk", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "904", produk: "Jaket", kodeVariasiShopee: "-", skuVariasi: "001770", skuInduk: "-", omzet: "1.000.000", pesanan: "10" }),
      baris({ kodeProduk: "904", produk: "Jaket", kodeVariasiShopee: "555", namaVariasi: "BIRU", skuVariasi: "001770", omzet: "999.000.000", pesanan: "9999" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.ringkas.pesananTotal, 10, "baris variasi tidak boleh ikut menjumlah");
    assert.equal(h.ringkas.omzetTotal, 1000000);
    assert.equal(h.ringkas.pesananTerpetakan, 10);
    assert.equal(h.ringkas.omzetTerpetakan, 1000000);
    assert.equal(h.ringkas.kodeProdukTotal, 1);
    assert.equal(h.ringkas.terpetakan, 1);
  });

  it("satu kodeProduk boleh muncul berkali-kali (varian) — tidak di-dedup", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "905", produk: "Kaos", kodeVariasiShopee: "-", omzet: "900.000", pesanan: "9" }),
      baris({ kodeProduk: "905", produk: "Kaos", kodeVariasiShopee: "1", namaVariasi: "S", skuVariasi: "AAA" }),
      baris({ kodeProduk: "905", produk: "Kaos", kodeVariasiShopee: "2", namaVariasi: "M", skuVariasi: "BBB" }),
      baris({ kodeProduk: "905", produk: "Kaos", kodeVariasiShopee: "3", namaVariasi: "L", skuVariasi: "001770" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.baris.length, 3);
    assert.equal(h.ringkas.terpetakan, 1);
  });

  it("pertanyaan di-dedup per (jenis, kodeProduk)", () => {
    const rows = [
      HEADER,
      // Kedua baris sama-sama punya SKU tak dikenal -> satu jenis, satu kodeProduk -> satu pertanyaan.
      baris({ kodeProduk: "906", produk: "Tas", kodeVariasiShopee: "1", namaVariasi: "S", skuVariasi: "888", omzet: "700.000", pesanan: "7" }),
      baris({ kodeProduk: "906", produk: "Tas", kodeVariasiShopee: "2", namaVariasi: "M", skuVariasi: "777" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.pertanyaan.length, 1);
    assert.equal(h.pertanyaan[0].jenis, "sku_tak_ada_master");
    // Angka tetap 0: kedua baris itu VARIASI (kolom kode variasi Shopee terisi),
    // dan aturan "angka hanya dari baris induk" berlaku juga untuk pertanyaan.
    assert.equal(h.pertanyaan[0].omzet, 0);
    assert.equal(h.pertanyaan[0].pesanan, 0);
  });

  it("dedup tanpa_sku menjumlahkan induk yang muncul lebih dari sekali", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "913", produk: "Tas", kodeVariasiShopee: "-", skuVariasi: "-", skuInduk: "-", omzet: "700.000", pesanan: "7" }),
      baris({ kodeProduk: "913", produk: "Tas", kodeVariasiShopee: "-", skuVariasi: "-", skuInduk: "-", omzet: "300.000", pesanan: "3" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.pertanyaan.length, 1);
    assert.equal(h.pertanyaan[0].jenis, "tanpa_sku");
    assert.equal(h.pertanyaan[0].omzet, 1000000);
    assert.equal(h.pertanyaan[0].pesanan, 10);
  });

  it("baris tanpa kode produk dilewati", () => {
    const rows = [HEADER, baris({ produk: "Yatim" }), baris({ kodeProduk: "   ", produk: "Kosong" })];
    const h = bangunPeta(rows, master);
    assert.equal(h.baris.length, 0);
    assert.equal(h.pertanyaan.length, 0);
    assert.equal(h.ringkas.kodeProdukTotal, 0);
  });

  it("kandidat maks 5 dan TIDAK memengaruhi pemetaan", () => {
    const mesin = {
      cari: (nama: string): SkorSku[] =>
        Array.from({ length: 7 }, (_, i) => ({ sku: i === 0 ? "AAA" : `X${i}`, nama, skor: 1 - i / 10 })),
    };
    const rows = [
      HEADER,
      baris({ kodeProduk: "907", produk: "Sandal", kodeVariasiShopee: "1", skuVariasi: "999999", omzet: "500.000", pesanan: "5" }),
    ];
    const h = bangunPeta(rows, master, mesin);
    assert.equal(h.pertanyaan[0].kandidat.length, 5);
    // Mesin menyarankan "AAA" (ada di master) tapi SKU aslinya "999999" — saran tidak dipakai.
    assert.equal(h.baris.length, 0, "kandidat tidak boleh membuat SKU dipakai");
    assert.equal(h.pertanyaan[0].jenis, "sku_tak_ada_master");
  });

  it("tanpa mesin, kandidat kosong", () => {
    const rows = [HEADER, baris({ kodeProduk: "908", produk: "Ikat Pinggang", kodeVariasiShopee: "-", omzet: "1.000", pesanan: "1" })];
    const h = bangunPeta(rows, master);
    assert.deepEqual(h.pertanyaan[0].kandidat, []);
  });

  it("cocok master apa adanya setelah trim", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "909", produk: "Belt", kodeVariasiShopee: "1", skuVariasi: " AAA ", omzet: "1.000", pesanan: "1" }),
    ];
    const h = bangunPeta(rows, master);
    assert.equal(h.baris.length, 1);
    assert.equal(h.baris[0].sku, "AAA");
  });

  it("ringkas menghitung total vs terpetakan secara nyata", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "910", produk: "A", kodeVariasiShopee: "-", skuVariasi: "AAA", omzet: "1.000.000", pesanan: "100" }),
      baris({ kodeProduk: "911", produk: "B", kodeVariasiShopee: "-", skuVariasi: "888", omzet: "3.000.000", pesanan: "300" }),
      baris({ kodeProduk: "912", produk: "C", kodeVariasiShopee: "-", skuVariasi: "-", skuInduk: "-", omzet: "6.000.000", pesanan: "600" }),
    ];
    const h = bangunPeta(rows, master);
    assert.deepEqual(h.ringkas, {
      kodeProdukTotal: 3,
      terpetakan: 1,
      pesananTotal: 1000,
      pesananTerpetakan: 100,
      omzetTotal: 10000000,
      omzetTerpetakan: 1000000,
    });
  });

  it("header saja tidak menghasilkan apa pun", () => {
    const h = bangunPeta([HEADER], master);
    assert.equal(h.baris.length, 0);
    assert.equal(h.pertanyaan.length, 0);
    assert.equal(h.ringkas.kodeProdukTotal, 0);
    assert.equal(h.ringkas.pesananTotal, 0);
  });
});

describe("urutan prioritas pertanyaan", () => {
  const master = new Set(["AAA"]);

  it("yang berpesanan lebih dulu; yang nol di belakang", () => {
    // Di file nyata: 22 berpesanan vs 485 tak berpesanan. Tanpa urutan ini, 22 yang
    // menentukan justru terkubur di bawah ratusan yang tidak mendesak.
    const rows = [
      HEADER,
      baris({ kodeProduk: "1", produk: "Nol", kodeVariasiShopee: "-", skuVariasi: "-", skuInduk: "-", pesanan: "0", omzet: "0" }),
      baris({ kodeProduk: "2", produk: "Kecil", kodeVariasiShopee: "-", skuVariasi: "-", skuInduk: "-", pesanan: "3", omzet: "300" }),
      baris({ kodeProduk: "3", produk: "Besar", kodeVariasiShopee: "-", skuVariasi: "-", skuInduk: "-", pesanan: "23", omzet: "9000" }),
    ];
    const h = bangunPeta(rows, master);
    assert.deepEqual(h.pertanyaan.map((p) => p.kodeProduk), ["3", "2", "1"]);
  });

  it("pesanan sama -> diurut omzet terbesar", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "A", produk: "A", kodeVariasiShopee: "-", skuVariasi: "-", skuInduk: "-", pesanan: "5", omzet: "100" }),
      baris({ kodeProduk: "B", produk: "B", kodeVariasiShopee: "-", skuVariasi: "-", skuInduk: "-", pesanan: "5", omzet: "900" }),
    ];
    const h = bangunPeta(rows, master);
    assert.deepEqual(h.pertanyaan.map((p) => p.kodeProduk), ["B", "A"]);
  });
});

describe("deteksiKolom — header nyata parentskudetail", () => {
  it("`Kode Variasi` diambil yang TERAKHIR (6), bukan yang pertama (3)", () => {
    // Kolom 3 = kode variasi SHOPEE (`138333482525`), kolom 6 = SKU kita.
    // Memilih yang pertama akan menandai SEMUA baris "SKU tak ada master".
    const k = deteksiKolom(HEADER);
    assert.equal(k.skuVariasi, 6);
    assert.notEqual(k.skuVariasi, 3);
    assert.equal(k.kodeProduk, 0);
    assert.equal(k.skuInduk, 7);
    assert.equal(k.namaVariasi, 4);
  });

  it("omzet/pesanan dari judul panjang, bukan dari nama pendek", () => {
    const k = deteksiKolom(HEADER);
    assert.equal(k.omzet, 8);
    assert.equal(k.pesanan, 15, "`Pesanan Dibuat`, BUKAN `Produk (Pesanan Dibuat)` di 17");
    assert.equal(k.dilihat, 10);
    assert.equal(k.klik, 11);
    assert.equal(k.kunjungan, 27);
    assert.equal(k.tanpaBeli, 29);
    assert.equal(k.keranjang, 34, "`Dimasukkan ke Keranjang`, bukan `Pengunjung ... keranjang` di 33");
  });

  it("header tak dikenal jatuh ke posisi KOL (file tetap terbaca)", () => {
    const k = deteksiKolom(["a", "b", "c", "d", "e", "f", "g", "h"]);
    assert.deepEqual(k, KOL);
  });

  it("header kosong pun jatuh ke posisi KOL", () => {
    assert.deepEqual(deteksiKolom([]), KOL);
    assert.deepEqual(deteksiKolom([null, null]), KOL);
  });

  it("cocok tanpa peduli huruf besar/kecil dan spasi", () => {
    const k = deteksiKolom(["  KODE PRODUK  ", " produk ", "  "]);
    assert.equal(k.kodeProduk, 0);
    assert.equal(k.produk, 1);
  });

  it("judul dikenali walau posisinya bergeser (deteksi tidak bergantung nomor)", () => {
    const h: unknown[] = new Array(40).fill("");
    h[5] = "Kode Produk"; h[7] = "Produk";
    h[11] = "Jumlah Produk Dilihat"; h[12] = "Produk Diklik";
    h[20] = "Pengunjung Produk (Kunjungan)"; h[21] = "Pengunjung Melihat Tanpa Membeli";
    h[25] = "Dimasukkan ke Keranjang (Produk)";
    h[30] = "Pesanan Dibuat"; h[33] = "Total Penjualan (Pesanan Dibuat) (IDR)";
    const k = deteksiKolom(h);
    assert.equal(k.kodeProduk, 5);
    assert.equal(k.produk, 7);
    assert.equal(k.omzet, 33);
    assert.equal(k.pesanan, 30);
    assert.equal(k.keranjang, 25);
    assert.equal(k.kunjungan, 20);
  });
});

describe("bangunPeta pada header nyata", () => {
  it("metrik dilihat/klik/kunjungan terbaca di baris induk", () => {
    const rows = [
      HEADER,
      baris({ kodeProduk: "904", produk: "Jaket", kodeVariasiShopee: "-", skuVariasi: "001770", skuInduk: "-", omzet: "1.000.000", pesanan: "10", dilihat: "12.345", klik: "678", kunjungan: "999", keranjang: "111", tanpaBeli: "222" }),
    ];
    const h = bangunPeta(rows, new Set(["001770"]));
    assert.equal(h.baris.length, 1);
    assert.deepEqual(
      { d: h.baris[0].dilihat, k: h.baris[0].klik, j: h.baris[0].kunjungan, r: h.baris[0].keranjang, t: h.baris[0].tanpaBeli },
      { d: 12345, k: 678, j: 999, r: 111, t: 222 },
    );
  });

  it("metrik TIDAK dijumlah dari baris variasi", () => {
    const rows = [
      HEADER,
      // Baris INDUK: kode variasi Shopee kosong, SKU dari kolom SKU Induk.
      baris({ kodeProduk: "904", produk: "Jaket", kodeVariasiShopee: "-", skuVariasi: "-", skuInduk: "001770", omzet: "1.000.000", pesanan: "10", dilihat: "1.000", klik: "100" }),
      // Baris variasi mengulang angka yang sama -> metriknya tidak boleh terbaca.
      baris({ kodeProduk: "904", produk: "Jaket", kodeVariasiShopee: "555", namaVariasi: "BIRU", skuVariasi: "001770", omzet: "1.000.000", pesanan: "10", dilihat: "999.999", klik: "999.999" }),
    ];
    const h = bangunPeta(rows, new Set(["001770"]));
    const induk = h.baris.find((b) => b.tingkat === "induk");
    const variasi = h.baris.find((b) => b.tingkat === "variasi");
    assert.equal(induk?.dilihat, 1000);
    assert.equal(induk?.klik, 100);
    assert.equal(variasi?.dilihat, 0, "baris variasi tidak boleh membawa metrik");
    assert.equal(variasi?.klik, 0);
  });

  it("pertanyaan memakai kolom yang DIDETEKSI, bukan posisi KOL yang dipakai di baris", () => {
    // Judul dipindah ke posisi lain (8 dan 15 dikosongkan) lalu header menunjuk ke sana:
    // pertanyaan HARUS ikut kolom terdeteksi — dulu ia membaca `KOL.omzet`/`KOL.pesanan`.
    const h = HEADER.slice();
    h[8] = "";
    h[15] = "";
    h[20] = "Total Penjualan (Pesanan Dibuat) (IDR)";
    h[21] = "Pesanan Dibuat";
    const r = baris({ kodeProduk: "920", produk: "Meja", kodeVariasiShopee: "-", skuVariasi: "-", skuInduk: "-" });
    r[20] = "2.000.000";
    r[21] = "7";
    assert.equal(deteksiKolom(h).omzet, 20, "prasyarat uji: kolom omzet benar-benar bergeser");
    const out = bangunPeta([h, r], new Set(["AAA"]));
    assert.equal(out.pertanyaan.length, 1);
    assert.equal(out.pertanyaan[0].jenis, "tanpa_sku");
    assert.equal(out.pertanyaan[0].omzet, 2000000);
    assert.equal(out.pertanyaan[0].pesanan, 7);
  });
});
