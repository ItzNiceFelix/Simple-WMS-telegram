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

  it("qty bersih retur (Jumlah − Returned quantity), minimal 1", () => {
    const r = normalisasiSheetShopee(
      [
        { ...HDR, "No. Pesanan": "O-3", "Nomor Referensi SKU": "A", Jumlah: "5", "Returned quantity": "2" },
        { ...HDR, "No. Pesanan": "O-4", "Nomor Referensi SKU": "B", Jumlah: "1", "Returned quantity": "1" },
      ],
      [],
    );
    assert.equal(r.orders[0].items[0].qty, 3);
    assert.equal(r.orders[1].items[0].qty, 1);
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
    assert.deepEqual(r.belumSku[0], { order_ref: "O-11", nama_shopee: "Rak Makanan", variasi: "MERAH,3 SSN" });
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
    assert.equal(r.belumSku.length, 2);
  });

  it("SKU tak dikenal master → gagal", () => {
    const r = normalisasiSheetShopee([{ ...HDR, "No. Pesanan": "O-12", "Nomor Referensi SKU": "ZZ", Jumlah: 1 }], [], (sku) => sku !== "ZZ");
    assert.equal(r.orders.length, 0);
    assert.match(r.gagal[0].pesan, /tidak ditemukan/);
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
