import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalisasiSheetShopee, normalisasiStatus } from "./orderImportShopee";

const HDR = { "Waktu Pesanan Dibuat": "2026-10-11 20:12", "Username (Pembeli)": "budi", "Nama Produk": "Produk Uji", "Status Pesanan": "Perlu Dikirim" };

describe("orderImportShopee.normalisasiStatus", () => {
  it("allowlist pendek + status panjang pengembalian dihitung", () => {
    assert.equal(normalisasiStatus("Perlu Dikirim"), "perlu_dikirim");
    assert.equal(normalisasiStatus("Sedang Dikirim"), "sedang_dikirim");
    assert.equal(normalisasiStatus("Telah Dikirim"), "telah_dikirim");
    assert.equal(normalisasiStatus("Selesai"), "selesai");
    assert.equal(normalisasiStatus("Pesanan diterima, namun Pembeli masih dapat mengajukan pengembalian hingga 2026-10-18."), "selesai");
  });
  it("status di luar hitungan", () => {
    assert.equal(normalisasiStatus("Batal"), "batal");
    assert.equal(normalisasiStatus("Belum Bayar"), "belum_bayar");
    assert.equal(normalisasiStatus("Pembatalan diajukan"), "pembatalan_diajukan");
    assert.equal(normalisasiStatus("Entah Apa"), "");
  });
});

describe("normalisasiSheetShopee", () => {
  it("peta SKU: Nomor Referensi menang atas SKU Induk (kasus 001485/100012)", () => {
    const r = normalisasiSheetShopee(
      [{ ...HDR, "No. Pesanan": "O-1", "Nomor Referensi SKU": "100012", "SKU Induk": "001485", Jumlah: "4", "Harga Setelah Diskon": "11.999" }],
      [],
    );
    assert.equal(r.orders.length, 1);
    assert.equal(r.orders[0].items[0].sku, "100012");
  });

  it("fallback SKU Induk bila referensi kosong", () => {
    const r = normalisasiSheetShopee([{ ...HDR, "No. Pesanan": "O-2", "SKU Induk": "induk", Jumlah: 1 }], []);
    assert.equal(r.orders[0].items[0].sku, "INDUK");
  });

  it("variasi beda dengan SKU sama tetap dua baris (001699 HIJAU & BIRU)", () => {
    const r = normalisasiSheetShopee(
      [
        { ...HDR, "No. Pesanan": "261011CEWUJFHX", "Nomor Referensi SKU": "001699", "Nama Variasi": "HIJAU", Jumlah: "1", "Harga Setelah Diskon": "10.000" },
        { ...HDR, "No. Pesanan": "261011CEWUJFHX", "Nomor Referensi SKU": "001699", "Nama Variasi": "BIRU", Jumlah: "1", "Harga Setelah Diskon": "10.000" },
      ],
      [],
    );
    assert.equal(r.orders[0].items.length, 2);
    assert.deepEqual(r.orders[0].items.map((i) => i.variasi), ["HIJAU", "BIRU"]);
  });

  it("qty bersih retur (Jumlah − Returned quantity); retur penuh = 0, baris tetap ada", () => {
    const r = normalisasiSheetShopee(
      [
        { ...HDR, "No. Pesanan": "O-3", "Nomor Referensi SKU": "A", Jumlah: "5", "Returned quantity": "2" },
        { ...HDR, "No. Pesanan": "O-4", "Nomor Referensi SKU": "B", Jumlah: "1", "Returned quantity": "1" },
      ],
      [],
    );
    assert.equal(r.orders[0].items[0].qty, 3);
    // Retur penuh: qty 0, BUKAN 1 — barang yang dikembalikan tidak boleh terhitung terjual.
    // Barisnya tetap disimpan supaya alokasi biaya per order tidak bocor.
    assert.equal(r.orders[1].items.length, 1, "baris qty 0 tidak dibuang");
    assert.equal(r.orders[1].items[0].qty, 0);
  });

  it("status panjang 'Pesanan diterima...' ikut dihitung", () => {
    const r = normalisasiSheetShopee(
      [{ ...HDR, "No. Pesanan": "O-5", "Nomor Referensi SKU": "A", Jumlah: 1, "Status Pesanan": "Pesanan diterima, namun Pembeli masih dapat mengajukan pengembalian hingga 2026-10-18." }],
      [],
    );
    assert.equal(r.orders.length, 1);
    assert.equal(r.orders[0].statusFile, "selesai");
    assert.equal(r.orders[0].statusAwal, "kirim");
  });

  it("status Batal/Belum Bayar/Pembatalan diajukan tidak dihitung", () => {
    const r = normalisasiSheetShopee(
      [
        { ...HDR, "No. Pesanan": "O-6", "Nomor Referensi SKU": "A", Jumlah: 1, "Status Pesanan": "Batal" },
        { ...HDR, "No. Pesanan": "O-7", "Nomor Referensi SKU": "A", Jumlah: 1, "Status Pesanan": "Belum Bayar" },
        { ...HDR, "No. Pesanan": "O-8", "Nomor Referensi SKU": "A", Jumlah: 1, "Status Pesanan": "Pembatalan diajukan" },
      ],
      [],
    );
    assert.equal(r.orders.length, 0);
  });

  it("advance TIDAK jadi order — dipisah ke advance[]", () => {
    const r = normalisasiSheetShopee(
      [{ ...HDR, "No. Pesanan": "O-9", "Nomor Referensi SKU": "A", Jumlah: 1 }],
      [
        { "Booking SN": "261008AAR7WFN33JJXA", "No. Resi": "SPXID06891640233A", "Nomor Referensi SKU": "100331", "Nama Variasi": "", "Nama Produk": "PISAU SET", "Opsi Pengiriman": "SPX Hemat", "Antar ke counter/ pick-up": "Pickup", "Booking Creation Date": "2026-10-09 22:08", "Pesanan Harus Dikirimkan Sebelum (Menghindari keterlambatan)": "2026-10-13 23:59" },
      ],
    );
    assert.equal(r.orders.length, 1);
    assert.equal(r.orders.some((o) => o.no_pesanan === "261008AAR7WFN33JJXA"), false);
    assert.equal(r.advance.length, 1);
    assert.deepEqual(r.advance[0], {
      booking_sn: "261008AAR7WFN33JJXA", no_resi: "SPXID06891640233A", sku: "100331", variasi: "",
      nama_produk: "PISAU SET", opsi_kirim: "SPX Hemat", antar_ke: "Pickup",
      booking_at: "2026-10-09 22:08", batas_kirim: "2026-10-13 23:59", qty: 1,
    });
  });

  it("file export rusak ditolak (>90% Nama Produk kosong)", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ "Waktu Pesanan Dibuat": "2026-10-11 20:12", "No. Pesanan": `R-${i}`, "Nomor Referensi SKU": "A", Jumlah: 1 }));
    const r = normalisasiSheetShopee(rows, []);
    assert.equal(r.orders.length, 0);
    assert.match(r.gagal[0].pesan, /tidak lengkap/);
  });

  it("opsi pengiriman/antar ke/metode pembayaran/tipe pesanan terbaca", () => {
    const r = normalisasiSheetShopee(
      [{ ...HDR, "No. Pesanan": "O-10", "Nomor Referensi SKU": "A", Jumlah: 1, "Opsi Pengiriman": "Hemat Kargo-SPX Hemat", "Antar ke counter/ pick-up": "Antar ke Counter", "Metode Pembayaran": "COD (Bayar di Tempat)", "Tipe Pesanan": "Pre-Order" }],
      [],
    );
    const o = r.orders[0];
    assert.equal(o.opsiKirim, "Hemat Kargo-SPX Hemat");
    assert.equal(o.jasaKirim, "SPX Hemat");
    assert.equal(o.tipeLayanan, "Hemat Kargo");
    assert.equal(o.antarKe, "Antar ke Counter");
    assert.equal(o.cod, true);
    assert.equal(o.preorder, true);
  });

  it("baris tanpa SKU masuk belumSku DAN order tetap dibuat (dulu order hilang)", () => {
    const r = normalisasiSheetShopee([{ ...HDR, "No. Pesanan": "O-11", Jumlah: 1, "Nama Produk": "Rak Makanan", "Nama Variasi": "MERAH,3 SSN" }], []);
    assert.equal(r.belumSku.length, 1);
    assert.equal(r.belumSku[0].order_ref, "O-11");
    assert.equal(r.belumSku[0].nama_shopee, "Rak Makanan");
    assert.equal(r.belumSku[0].variasi, "MERAH,3 SSN");
    assert.deepEqual(r.belumSku[0].order_refs, ["O-11"]);
    // Order HARUS tetap ada dengan item sku kosong — supaya bisa dipetakan manual.
    assert.equal(r.orders.length, 1);
    assert.equal(r.orders[0].items.length, 1);
    assert.equal(r.orders[0].items[0].sku, "");
    assert.equal(r.orders[0].items[0].qty, 1);
    assert.equal(r.gagal.length, 0);
  });

  it("item tanpa SKU tidak dianggap 'SKU tak dikenal' (tidak menggagalkan order)", () => {
    const r = normalisasiSheetShopee(
      [{ ...HDR, "No. Pesanan": "O-11b", Jumlah: "2", "Nama Produk": "Pisau Set", "Nama Variasi": "" }],
      [],
      () => false // master kosong: SKU "" tetap tidak boleh dianggap hilang
    );
    assert.equal(r.orders.length, 1);
    assert.equal(r.gagal.length, 0);
  });

  it("baris tanpa SKU berulang (nama+variasi sama) digabung qty-nya", () => {
    const r = normalisasiSheetShopee(
      [
        { ...HDR, "No. Pesanan": "O-11c", Jumlah: "1", "Nama Produk": "Gelas", "Nama Variasi": "biru" },
        { ...HDR, "No. Pesanan": "O-11c", Jumlah: "3", "Nama Produk": "Gelas", "Nama Variasi": "biru" },
      ],
      []
    );
    assert.equal(r.orders.length, 1);
    assert.equal(r.orders[0].items.length, 1);
    assert.equal(r.orders[0].items[0].qty, 4);
    assert.equal(r.belumSku.length, 1);
    assert.equal(r.belumSku[0].qty_total, 4);
  });

  it("produk sama di banyak order dikelompokkan jadi SATU baris preview", () => {
    const r = normalisasiSheetShopee(
      [
        { ...HDR, "No. Pesanan": "O-A", Jumlah: "2", "Nama Produk": "Pisau Set", "Nama Variasi": "" },
        { ...HDR, "No. Pesanan": "O-B", Jumlah: "1", "Nama Produk": "Pisau Set", "Nama Variasi": "" },
        { ...HDR, "No. Pesanan": "O-C", Jumlah: "3", "Nama Produk": "Pisau Set", "Nama Variasi": "" },
      ],
      []
    );
    assert.equal(r.belumSku.length, 1, "3 order produk sama = 1 baris");
    assert.equal(r.belumSku[0].jumlah_order, 3);
    assert.deepEqual(r.belumSku[0].order_refs, ["O-A", "O-B", "O-C"]);
    assert.equal(r.belumSku[0].qty_total, 6);
    assert.equal(r.belumSku[0].nama_shopee, "Pisau Set");
    // ketiga order tetap dibuat (masing-masing 1 item tanpa SKU)
    assert.equal(r.orders.length, 3);
  });

  it("variasi BEDA tidak digabung walau nama produknya sama", () => {
    const r = normalisasiSheetShopee(
      [
        { ...HDR, "No. Pesanan": "O-D", Jumlah: "1", "Nama Produk": "Rak Makanan", "Nama Variasi": "MERAH" },
        { ...HDR, "No. Pesanan": "O-E", Jumlah: "1", "Nama Produk": "Rak Makanan", "Nama Variasi": "BIRU" },
      ],
      []
    );
    assert.equal(r.belumSku.length, 2, "variasi beda harus tetap terpisah");
    const varian = r.belumSku.map((b) => b.variasi).sort();
    assert.deepEqual(varian, ["BIRU", "MERAH"]);
  });

  it("baris yg sama tak dihitung dua kali bila order sama (dedup refs)", () => {
    const r = normalisasiSheetShopee(
      [
        { ...HDR, "No. Pesanan": "O-F", Jumlah: "1", "Nama Produk": "X", "Nama Variasi": "v" },
        { ...HDR, "No. Pesanan": "O-F", Jumlah: "1", "Nama Produk": "X", "Nama Variasi": "v" },
      ],
      []
    );
    assert.equal(r.belumSku.length, 1);
    assert.equal(r.belumSku[0].jumlah_order, 1, "order sama tidak dihitung 2x");
    assert.equal(r.belumSku[0].qty_total, 2, "tapi qty tetap dijumlah");
  });

  it("SKU tak dikenal master → order TETAP dibuat, masuk Perlu SKU (dulu order dibuang)", () => {
    // Perilaku lama membuang seluruh order di sini. Itu tidak konsisten: baris tanpa SKU
    // justru lolos, sementara baris yang cuma belum masuk master dihukum lebih berat.
    // Sekarang keduanya diperlakukan sama supaya user bisa memperbaikinya.
    const r = normalisasiSheetShopee([{ ...HDR, "No. Pesanan": "O-12", "Nomor Referensi SKU": "ZZ", Jumlah: 1 }], [], (sku) => sku !== "ZZ");
    assert.equal(r.orders.length, 1, "order tidak boleh hilang");
    assert.equal(r.orders[0].items[0].sku, "ZZ", "SKU asli dibawa supaya bisa ditampilkan");
    assert.equal(r.belumSku.length, 1);
    assert.equal(r.belumSku[0].sku_asal, "ZZ");
    assert.equal(r.gagal.length, 0, "bukan kegagalan — ini antrian perbaikan");
  });

  it("Jumlah kosong/0 → gagal (bukan diam-diam jadi 1)", () => {
    const r = normalisasiSheetShopee([{ ...HDR, "No. Pesanan": "O-13", "Nomor Referensi SKU": "A", Jumlah: "" }], []);
    assert.equal(r.orders.length, 0);
    assert.match(r.gagal[0].pesan, /Jumlah 0 tidak valid/);
  });

  it("baris varian sama berulang: qty dijumlah, harga satuan pertama dipertahankan", () => {
    const r = normalisasiSheetShopee(
      [
        { ...HDR, "No. Pesanan": "O-14", "Nomor Referensi SKU": "A", "Nama Variasi": "X", Jumlah: "2", "Harga Setelah Diskon": "10.000" },
        { ...HDR, "No. Pesanan": "O-14", "Nomor Referensi SKU": "A", "Nama Variasi": "X", Jumlah: "3", "Harga Setelah Diskon": "99.999" },
      ],
      [],
    );
    assert.equal(r.orders[0].items.length, 1);
    assert.equal(r.orders[0].items[0].qty, 5);
    assert.equal(r.orders[0].items[0].harga_satuan, 10000);
  });

  it("opsi pengiriman tanpa pemisah → jasa = seluruh nilai, layanan kosong", () => {
    const r = normalisasiSheetShopee([{ ...HDR, "No. Pesanan": "O-15", "Nomor Referensi SKU": "A", Jumlah: 1, "Opsi Pengiriman": "SPX Standard" }], []);
    assert.equal(r.orders[0].jasaKirim, "SPX Standard");
    assert.equal(r.orders[0].tipeLayanan, "");
  });

  it("opsi pengiriman bertanda hubung ganda → pisah pada hubung terakhir", () => {
    const r = normalisasiSheetShopee([{ ...HDR, "No. Pesanan": "O-16", "Nomor Referensi SKU": "A", Jumlah: 1, "Opsi Pengiriman": "Reguler (Cashless)-JNE Reguler" }], []);
    assert.equal(r.orders[0].jasaKirim, "JNE Reguler");
    assert.equal(r.orders[0].tipeLayanan, "Reguler (Cashless)");
  });
});

describe("konsistensi: TIDAK ada baris yang dibuang karena masalah SKU", () => {
  it("SKU tidak ada di master: order TETAP dibuat, baris masuk belumSku (dulu order dibuang)", () => {
    // Master hanya kenal "ADA". File menulis "TIDAK-ADA".
    const r = normalisasiSheetShopee(
      [{ ...HDR, "No. Pesanan": "O-90", Jumlah: "3", "SKU Induk": "TIDAK-ADA", "Nama Produk": "Centong Pelangi", "Nama Variasi": "MERAH" }],
      [],
      (sku) => sku === "ADA"
    );
    assert.equal(r.orders.length, 1, "order tidak boleh hilang");
    assert.equal(r.orders[0].items[0].sku, "TIDAK-ADA", "SKU asli tetap dibawa untuk ditampilkan");
    assert.equal(r.belumSku.length, 1);
    assert.equal(r.belumSku[0].sku_asal, "TIDAK-ADA", "SKU bermasalah ditandai sebagai sku_asal");
    assert.equal(r.belumSku[0].sumber, "order");
    assert.equal(r.belumSku[0].qty_total, 3);
    assert.equal(r.gagal.length, 0, "tidak dicatat sebagai gagal — ini bisa diperbaiki, bukan error");
  });

  it("advance tanpa SKU: masuk belumSku, bukan hilang (dulu dibuang diam-diam)", () => {
    const r = normalisasiSheetShopee(
      [],
      [{ ...HDR, "Booking SN": "BK-9", Jumlah: "1", "Nama Produk": "Saringan Kelapa", "Nama Variasi": "" }]
    );
    assert.equal(r.advance.length, 0, "tanpa SKU sah tidak boleh masuk booking");
    assert.equal(r.belumSku.length, 1, "harus muncul di daftar Perlu SKU");
    assert.equal(r.belumSku[0].sumber, "advance", "ditandai datang dari jalur advance");
    assert.equal(r.belumSku[0].order_ref, "BK-9");
    assert.equal(r.gagal.length, 0);
  });

  it("advance dengan SKU tak dikenal: juga masuk belumSku, bukan dibuang", () => {
    const r = normalisasiSheetShopee(
      [],
      [{ ...HDR, "Booking SN": "BK-10", Jumlah: "1", "SKU Induk": "SALAH-99", "Nama Produk": "Kemoceng", "Nama Variasi": "" }],
      () => false
    );
    assert.equal(r.advance.length, 0);
    assert.equal(r.belumSku.length, 1);
    assert.equal(r.belumSku[0].sku_asal, "SALAH-99");
    assert.equal(r.belumSku[0].sumber, "advance");
    assert.equal(r.gagal.length, 0);
  });

  it("order DAN advance bermasalah masuk daftar yang sama, dibedakan oleh sumber", () => {
    const r = normalisasiSheetShopee(
      [{ ...HDR, "No. Pesanan": "O-91", Jumlah: "1", "SKU Induk": "X", "Nama Produk": "Barang A", "Nama Variasi": "" }],
      [{ ...HDR, "Booking SN": "BK-11", Jumlah: "1", "SKU Induk": "Y", "Nama Produk": "Barang B", "Nama Variasi": "" }],
      () => false
    );
    const sumber = r.belumSku.map((b) => b.sumber).sort();
    assert.deepEqual(sumber, ["advance", "order"], "keduanya ada di satu daftar");
  });
});

/**
 * Fixture bentuk berkas NYATA yang dulu 500 di endpoint /api/order (preview-shopee).
 *
 * Aslinya: `Order.toship.20260915_20261015.xlsx`
 *   73 baris orders, 98 baris advance, 33 SKU unik, 3 baris tanpa SKU  → 39.919 byte.
 * Pembanding yang SUKSES: 6 baris orders, 0 advance, 5 SKU unik      → 10.882 byte.
 *
 * Bedanya cuma VOLUME, jadi fixture di bawah mereproduksi angkanya persis. Kalau
 * normalisasi ini sendiri yang lambat, uji waktu di blok ini yang memberi tahu; kalau
 * normalisasi cepat, penyebab 500 ada di lapisan kueri DB (bukan di sini).
 */
const FIKS = (() => {
  const ORDERS = 73, ADVANCE = 98, SKU_UNIK = 33, TANPA_SKU = 3;
  // 52 item = 49 item ber-SKU + 3 baris tanpa SKU (33 SKU unik, sisanya SKU terulang).
  const ITEM_BERSKU = ORDERS - TANPA_SKU;
  const orders: Record<string, unknown>[] = [];
  const advance: Record<string, unknown>[] = [];
  for (let i = 0; i < ITEM_BERSKU; i++) {
    orders.push({
      ...HDR,
      "No. Pesanan": `O-${String(i).padStart(3, "0")}`,
      "Nomor Referensi SKU": `SKU-${String(i % SKU_UNIK).padStart(2, "0")}`,
      "Nama Produk": `Produk ${i % SKU_UNIK}`,
      "Nama Variasi": i % 2 === 0 ? "MERAH" : "BIRU",
      Jumlah: String(1 + (i % 3)),
      "Harga Setelah Diskon": "11.999",
      "Subtotal Pesanan": "11.999",
    });
  }
  for (let i = 0; i < TANPA_SKU; i++) {
    orders.push({ ...HDR, "No. Pesanan": `O-KOSONG-${i}`, "Nama Produk": `Tanpa SKU ${i}`, "Nama Variasi": "", Jumlah: "1" });
  }
  for (let i = 0; i < ADVANCE; i++) {
    advance.push({
      ...HDR,
      "Booking SN": `BK-${String(i).padStart(3, "0")}`,
      "Nomor Referensi SKU": `SKU-${String(i % SKU_UNIK).padStart(2, "0")}`,
      "Nama Produk": `Produk ${i % SKU_UNIK}`,
      "Nama Variasi": i % 2 === 0 ? "MERAH" : "BIRU",
      Jumlah: "1",
      "No. Resi": `RESI-${i}`,
    });
  }
  const skuMaster = new Set(Array.from({ length: SKU_UNIK }, (_, i) => `SKU-${String(i).padStart(2, "0")}`));
  return { ORDERS, ADVANCE, SKU_UNIK, TANPA_SKU, orders, advance, skuMaster, total: ORDERS + ADVANCE };
})();

describe("normalisasiSheetShopee — bentuk berkas besar (Order.toship 73/98)", () => {
  it("171 baris (73 orders + 98 advance) tidak melempar, orders TETAP 73", () => {
    // Item tanpa SKU tidak lagi membuang ordernya, jadi orders keluar 73 baris penuh.
    const r = normalisasiSheetShopee(FIKS.orders, FIKS.advance, (sku) => FIKS.skuMaster.has(sku));
    assert.equal(FIKS.total, 171, "fixture harus 171 baris total");
    assert.equal(r.orders.length, FIKS.ORDERS, "73 order, termasuk 3 yang barisnya tanpa SKU");
    assert.equal(r.advance.length, FIKS.ADVANCE, "98 baris advance; tiap baris booking_sn unik → 98 booking");
    assert.equal(r.gagal.length, 0, "bentuk ini bukan kegagalan data");
    assert.equal(r.belumSku.length, FIKS.TANPA_SKU, "3 produk tanpa SKU, nama beda → 3 baris preview");
    r.belumSku.forEach((b) => assert.deepEqual(b.order_refs, [`O-KOSONG-${r.belumSku.indexOf(b)}`]));
  });

  it("belumSku dikelompokkan per (nama+variasi), bukan satu grup per baris", () => {
    // Kalau pengelompokan rusak, 73 baris → 73 grup dan endpoint menembak ratusan kueri DB.
    const r = normalisasiSheetShopee(FIKS.orders, FIKS.advance, (sku) => FIKS.skuMaster.has(sku));
    assert.equal(r.belumSku.length, FIKS.TANPA_SKU, "hanya 3 grup, bukan 73");
    assert.ok(r.belumSku.length < FIKS.ORDERS, "jauh di bawah jumlah baris orders");
    assert.equal(r.belumSku.reduce((s, b) => s + b.jumlah_order, 0), FIKS.TANPA_SKU);
  });

  it("produk sama di banyak order besar tetap 1 grup dengan order_refs lengkap", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ ...HDR, "No. Pesanan": `B-${i}`, "Nama Produk": "Ember Besar", "Nama Variasi": "MERAH", Jumlah: "2" }));
    const r = normalisasiSheetShopee(rows, []);
    assert.equal(r.belumSku.length, 1, "40 baris satu produk = 1 grup");
    assert.equal(r.belumSku[0].jumlah_order, 40);
    assert.equal(r.belumSku[0].qty_total, 80);
  });

  it("input aneh dalam jumlah besar: Jumlah kosong, SKU ganda, banyak variasi — tanpa NaN", () => {
    const rows: Record<string, unknown>[] = [];
    // 20 baris Jumlah kosong → gagal, order tetap dicatat gagal (bukan NaN).
    for (let i = 0; i < 20; i++) rows.push({ ...HDR, "No. Pesanan": `J-${i}`, "Nomor Referensi SKU": "SKU-01", Jumlah: "" });
    // SKU ganda dalam satu order (baris berulang) → satu item, qty dijumlah.
    for (let i = 0; i < 20; i++) rows.push({ ...HDR, "No. Pesanan": "G-1", "Nomor Referensi SKU": "SKU-02", "Nama Variasi": "MERAH", Jumlah: "2" });
    // Satu order dengan 30 variasi berbeda → 30 item.
    for (let i = 0; i < 30; i++) rows.push({ ...HDR, "No. Pesanan": "V-1", "Nomor Referensi SKU": "SKU-03", "Nama Variasi": `VAR-${i}`, Jumlah: "1" });
    const r = normalisasiSheetShopee(rows, [], (sku) => FIKS.skuMaster.has(sku));
    // 40 = 20 pesan "Jumlah 0 tidak valid" (satu per baris) + 20 pesan "Tak ada baris barang
    // pada pesanan ini" (satu per order J-* yang jadi kosong). Dua jenis pesan, bukan dobel
    // dari baris yang sama — angkanya dikunci supaya perubahan perilaku ini terlihat.
    assert.equal(r.gagal.filter((g) => /Jumlah 0 tidak valid/.test(g.pesan)).length, 20);
    assert.equal(r.gagal.filter((g) => /Tak ada baris barang/.test(g.pesan)).length, 20);
    assert.equal(r.gagal.length, 40);
    assert.equal(r.orders.length, 2, "order G-1 dan V-1 tetap dibuat");
    const g = r.orders.find((o) => o.no_pesanan === "G-1")!;
    assert.equal(g.items.length, 1, "SKU+variasi sama digabung");
    assert.equal(g.items[0].qty, 40, "20 baris × 2");
    assert.equal(r.orders.find((o) => o.no_pesanan === "V-1")!.items.length, 30, "30 variasi = 30 item");
    for (const o of r.orders) for (const it of o.items) {
      assert.ok(Number.isFinite(it.qty) && Number.isFinite(it.harga_satuan) && Number.isFinite(it.subtotal), `${o.no_pesanan}/${it.sku}: angka harus finit`);
    }
  });

  it("normalisasi 171 baris selesai jauh di bawah anggaran CPU Worker (angka nyata dicetak)", () => {
    // Ambang longgar sengaja: yang dijaga adalah ORDE BESAR, bukan angka detik mesin ini.
    // Normalisasi murni (tanpa I/O) harus selesai dalam puluhan milidetik; lapisan DB
    // yang >450 kueri berurutan itulah pemakan waktu di endpoint preview.
    const t0 = performance.now();
    const r = normalisasiSheetShopee(FIKS.orders, FIKS.advance, (sku) => FIKS.skuMaster.has(sku));
    const ms = performance.now() - t0;
    console.log(`normalisasiSheetShopee: 171 baris dalam ${ms.toFixed(3)} ms (total ${FIKS.total} baris)`);
    assert.equal(r.orders.length + r.belumSku.length > 0, true);
    assert.ok(ms < 1000, `normalisasi tidak boleh lambat: ${ms.toFixed(1)} ms`);
  });
});
