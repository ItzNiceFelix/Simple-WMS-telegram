// Uji bahan prompt analisa mendalam.
//
// Fokus uji ini BUKAN kualitas bahasa AI, melainkan APA YANG DIKIRIM ke AI. Kalau bahan
// salah (mis. memuat data mentah), AI punya kesempatan menghitung ulang — dan angka
// analisa tidak lagi bisa diaudit. Itu satu-satunya hal yang bisa diuji di sini, dan
// justru yang paling penting.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { susunBahan, PROMPT_SISTEM } from "./ai";
import { analisaCepat, type MasukanAnalisa } from "./hitung";
import type { BarisSku, HasilAnalisa, Temuan } from "./tipe";

function temuanUji(): Temuan {
  return {
    kode: "sku_merugi",
    keparahan: "kritis",
    judul: "2 SKU merugi setiap kali terjual",
    penjelasan: "Harga jual lebih rendah daripada biaya.",
    angka: { nilai: 15000, satuan: "rupiah", jumlahTerkena: 2, dariTotal: 500000 },
    contohSku: [
      { sku: "0543", nama: "Mainan Tali", nilai: -150 },
      { sku: "0777", nama: "Lain", nilai: -250 },
    ],
  };
}

const barisUji: BarisSku[] = [
  {
    sku: "001562", nama: "Gayung Siba", unit: 10, hppSatuan: 3712, hargaJual: 6500,
    marginSatuan: 2788, marginPersen: 42.9, kontribusi: 27880, roasImpas: 2.33,
    hppMaster: 3712, hppNaik: 0, stok: 50,
  },
];

function hasilUji(ubah: Partial<HasilAnalisa> = {}): HasilAnalisa {
  return {
    ringkasan: {
      periode: "2026-10-13", presetId: 1, jmlSku: 1, jmlOrder: 10,
      omzet: 65000, hpp: 37120, biaya: 0, pajak: 0, laba: 27880,
      marginPersen: 42.9, marginSatuanRata: 2788, marginPersenMedian: 42.9,
      kontribusi10Teratas: 27880, persen10Teratas: 100,
    },
    temuan: [temuanUji()],
    baris: barisUji,
    kurang: [],
    jmlSnapshot: 3,
    ...ubah,
  };
}

describe("PROMPT_SISTEM — batas keras saran iklan", () => {
  it("melarang menghitung ulang angka", () => {
    assert.match(PROMPT_SISTEM, /DILARANG menghitung ulang/i);
  });

  it("melarang mengarang angka", () => {
    assert.match(PROMPT_SISTEM, /mengarang angka/i);
  });

  it("melarang mengklaim tahu GMV MAX / AUTO ROAS", () => {
    // Peringatan user: "informasi SANGAT terkini tentang GMV MAX"; sistem ini tidak
    // punya itu, jadi AI harus dilarang mengklaimnya.
    assert.match(PROMPT_SISTEM, /GMV MAX/);
    assert.match(PROMPT_SISTEM, /AUTO ROAS/);
    assert.match(PROMPT_SISTEM, /DILARANG mengklaim tahu/i);
  });

  it("mewajibkan menyebut data yang belum tersedia", () => {
    assert.match(PROMPT_SISTEM, /data yang belum tersedia/i);
    assert.match(PROMPT_SISTEM, /SEBUTKAN/i);
  });

  it("menegaskan hanya titik impas yang dihitung", () => {
    assert.match(PROMPT_SISTEM, /TITIK IMPAS/);
  });
});

describe("susunBahan", () => {
  it("memuat ringkasan angka yang sudah dihitung", () => {
    const b = susunBahan(hasilUji());
    assert.match(b, /2026-10-13/);
    assert.match(b, /omzet Rp 65000/);
    assert.match(b, /laba Rp 27880/);
    assert.match(b, /margin 42.9%/);
  });

  it("memuat temuan beserta angkanya, apa adanya", () => {
    const b = susunBahan(hasilUji());
    assert.match(b, /2 SKU merugi/);
    assert.match(b, /15000 rupiah/);
    assert.match(b, /0543/);
  });

  it("menyatakan ARAH temuan secara eksplisit (model tidak bisa membalik arti)", () => {
    // Tanpa ini, model pernah menulis "10 SKU teratas HANYA menanggung 65,5% laba" —
    // kalimat itu membalik arti temuan konsentrasi (yang sebenarnya RISIKO) menjadi
    // seolah pencapaian rendah. Arah dinyatakan di bahan supaya tidak bergantung tebakan.
    const b = susunBahan(hasilUji());
    assert.match(b, /\[masalah serius\]/, "temuan kritis ditandai arahnya");
  });

  it("temuan peringatan ditandai 'perlu diperhatikan', catatan ditandai 'catatan'", () => {
    const h = hasilUji({
      temuan: [
        { ...temuanUji(), kode: "a", keparahan: "peringatan", judul: "Margin tipis" },
        { ...temuanUji(), kode: "b", keparahan: "catatan", judul: "Catatan kecil" },
      ],
    });
    const b = susunBahan(h);
    assert.match(b, /\[perlu diperhatikan\] Margin tipis/);
    assert.match(b, /\[catatan\] Catatan kecil/);
  });

  it("menyebut ROAS impas per SKU", () => {
    const b = susunBahan(hasilUji());
    assert.match(b, /ROAS impas 2\.33/);
  });

  it("SKU bermargin <= 0 ditandai tidak ada titik impas, bukan angka palsu", () => {
    const h = hasilUji({
      baris: [{ ...barisUji[0], marginSatuan: -100, roasImpas: null }],
    });
    const b = susunBahan(h);
    assert.match(b, /tidak ada \(margin ≤ 0\)/);
  });

  it("DATA KURANG diteruskan dengan penanda WAJIB (tidak boleh hilang)", () => {
    const h = hasilUji({ kurang: ["Biaya iklan belum diimpor.", "Data kunjungan belum ada."] });
    const b = susunBahan(h);
    assert.match(b, /DATA YANG BELUM TERSEDIA/);
    assert.match(b, /Biaya iklan belum diimpor/);
    assert.match(b, /Data kunjungan belum ada/);
  });

  it("menyatakan jelas bila tidak ada data yang kurang", () => {
    const b = susunBahan(hasilUji({ kurang: [] }));
    assert.match(b, /DATA YANG BELUM TERSEDIA: tidak ada/);
  });

  it("tidak ada temuan -> dinyatakan, bukan bagian kosong tanpa keterangan", () => {
    const b = susunBahan(hasilUji({ temuan: [] }));
    assert.match(b, /tidak ada temuan yang perlu ditindaklanjuti/i);
  });

  it("hanya mengirim 10 SKU teratas (bahan tidak membengkak)", () => {
    const banyak: BarisSku[] = Array.from({ length: 40 }, (_, i) => ({
      ...barisUji[0], sku: `SKU-${String(i).padStart(3, "0")}`, kontribusi: 1000 - i,
    }));
    const b = susunBahan(hasilUji({ baris: banyak }));
    assert.match(b, /SKU-000/);
    assert.match(b, /SKU-009/);
    assert.doesNotMatch(b, /SKU-010/, "SKU ke-11 tidak boleh ikut");
  });

  it("TIDAK memuat data mentah (tidak ada bahan untuk menghitung ulang)", () => {
    const b = susunBahan(hasilUji());
    // Tidak boleh ada JSON mentah / daftar transaksi. Bahan hanya angka hasil hitung.
    assert.doesNotMatch(b, /\{"/, "tidak ada JSON mentah");
    assert.doesNotMatch(b, /no_pesanan|rincian_json|hash_baris/);
  });
});

describe("integrasi dengan analisaCepat", () => {
  it("bahan bisa disusun dari hasil analisaCepat sungguhan", () => {
    const m: MasukanAnalisa = {
      presetId: 1, periode: "2026-10-13",
      snapshot: {
        jml_order: 2, omzet: 20000, hpp: 15000, biaya: 0, pajak: 0, laba: 5000,
        rincian: [
          { sku: "A", nama: "Produk A", unit: 2, hppSatuan: 7500, hargaJual: 10000, marginSatuan: 2500, marginPersen: 25, kontribusi: 5000 },
          { sku: "B", nama: "Produk B", unit: 1, hppSatuan: 12000, hargaJual: 10000, marginSatuan: -2000, marginPersen: -20, kontribusi: -2000 },
        ],
      },
      hppMaster: new Map(), stok: null, biayaIklan: null, jmlSnapshot: 3, adaPerforma: false,
    };
    const h = analisaCepat(m);
    const b = susunBahan(h);
    assert.match(b, /omzet Rp 20000/);
    assert.match(b, /merugi/);
    assert.match(b, /DATA YANG BELUM TERSEDIA/);
    assert.match(b, /iklan/i);
  });
});
