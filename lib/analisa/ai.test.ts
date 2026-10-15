// Uji bahan prompt analisa mendalam.
//
// Fokus uji ini BUKAN kualitas bahasa AI, melainkan APA YANG DIKIRIM ke AI. Kalau bahan
// salah (mis. memuat data mentah), AI punya kesempatan menghitung ulang — dan angka
// analisa tidak lagi bisa diaudit. Itu satu-satunya hal yang bisa diuji di sini, dan
// justru yang paling penting.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { susunBahan, PROMPT_SISTEM, ATURAN_KEDALAMAN, susunPesan } from "./ai";
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
    dilihat: null, klik: null, ctr: null, cr: null, biayaIklan: null, roasAktual: null,
  },
];

/** Baris dengan data iklan lengkap — dipakai menguji blok KEPUTUSAN IKLAN. */
function barisIklan(ubah: Partial<BarisSku> = {}): BarisSku {
  return {
    ...barisUji[0],
    dilihat: 2000, klik: 80, ctr: 4, cr: 12.5, biayaIklan: 10000, roasAktual: 5,
    ...ubah,
  };
}

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

  it("hanya mengirim 20 SKU teratas (bahan tidak membengkak)", () => {
    const banyak: BarisSku[] = Array.from({ length: 40 }, (_, i) => ({
      ...barisUji[0], sku: `SKU-${String(i).padStart(3, "0")}`, kontribusi: 1000 - i,
    }));
    const b = susunBahan(hasilUji({ baris: banyak }));
    assert.match(b, /20 SKU PENYUMBANG TERBESAR:/);
    assert.match(b, /SKU-000/);
    assert.match(b, /SKU-019/);
    assert.doesNotMatch(b, /SKU-020/, "SKU ke-21 tidak boleh ikut");
  });

  it("TIDAK memuat data mentah (tidak ada bahan untuk menghitung ulang)", () => {
    const b = susunBahan(hasilUji());
    // Tidak boleh ada JSON mentah / daftar transaksi. Bahan hanya angka hasil hitung.
    assert.doesNotMatch(b, /\{"/, "tidak ada JSON mentah");
    assert.doesNotMatch(b, /no_pesanan|rincian_json|hash_baris/);
  });
});

describe("susunBahan — blok KEPUTUSAN IKLAN", () => {
  it("muncul saat ada data iklan, memuat angka + keputusan + alasan", () => {
    const b = susunBahan(hasilUji({ baris: [barisIklan()] }));
    assert.match(b, /KEPUTUSAN IKLAN/);
    assert.match(b, /dilihat 2000/);
    assert.match(b, /klik 80/);
    assert.match(b, /CTR 4%/);
    assert.match(b, /CR 12\.5%/);
    assert.match(b, /ROAS aktual 5/);
    assert.match(b, /ROAS impas 2\.33/);
    // ROAS 5 ≥ impas 2,33 dan CTR 4% ≥ ambang → naikkan.
    assert.match(b, /keputusan naikkan/);
    assert.match(b, /alasan:/);
  });

  it("TIDAK muncul saat data iklan kosong (jangan bahas iklan dari ketiadaan data)", () => {
    const b = susunBahan(hasilUji({ baris: [barisUji[0]] }));
    assert.doesNotMatch(b, /KEPUTUSAN IKLAN/);
    assert.doesNotMatch(b, /keputusan naikkan|keputusan hentikan/);
  });

  it("ROAS aktual di bawah titik impas -> keputusan hentikan", () => {
    const b = susunBahan(hasilUji({ baris: [barisIklan({ roasAktual: 1.2 })] }));
    assert.match(b, /keputusan hentikan/);
  });

  it("tayangan di bawah ambang -> belum_cukup_data, bukan tebakan", () => {
    const b = susunBahan(hasilUji({ baris: [barisIklan({ dilihat: 50, klik: 2, ctr: 4 })] }));
    assert.match(b, /keputusan belum_cukup_data/);
  });
});

describe("kedalaman mengubah INSTRUKSI, bukan pemotongan bahan", () => {
  it("ringkas menyebut maksimum 3 temuan", () => {
    assert.match(ATURAN_KEDALAMAN.ringkas, /maksimum 3 temuan/);
  });

  it("sedang menyebut maksimum 5 temuan", () => {
    assert.match(ATURAN_KEDALAMAN.sedang, /maksimum 5 temuan/);
  });

  it("panjang tidak menyebut batas jumlah temuan", () => {
    assert.match(ATURAN_KEDALAMAN.panjang, /tidak ada batas jumlah temuan/i);
    assert.match(ATURAN_KEDALAMAN.panjang, /menjelaskan per produk/i);
    assert.doesNotMatch(ATURAN_KEDALAMAN.panjang, /maksimum \d+ temuan/i);
  });

  it("ketiganya tetap mewajibkan angka", () => {
    for (const k of ["ringkas", "sedang", "panjang"] as const) {
      assert.match(ATURAN_KEDALAMAN[k], /angka/i, `kedalaman ${k} wajib menyebut angka`);
    }
  });

  it("bahan yang sama dikirim untuk semua kedalaman (instruksi, bukan pemotongan)", () => {
    const h = hasilUji({ baris: [barisIklan()] });
    const bahan = susunBahan(h);
    const ringkas = susunPesan(bahan, "ringkas");
    const panjang = susunPesan(bahan, "panjang");
    assert.ok(ringkas.teks.includes(bahan) && panjang.teks.includes(bahan));
    assert.notEqual(ringkas.teks, panjang.teks, "instruksinya berbeda");
  });
});

describe("PROMPT_SISTEM — aturan rekomendasi (riset praktik instruksi model)", () => {
  it("mewajibkan angka pemicu untuk setiap rekomendasi", () => {
    assert.match(PROMPT_SISTEM, /angka pemicu/i);
    assert.match(PROMPT_SISTEM, /harus dicabut/i);
  });

  it("melarang frasa lindung saat memberi rekomendasi", () => {
    assert.match(PROMPT_SISTEM, /frasa lindung/i);
    for (const frasa of ["tergantung", "perlu dipertimbangkan", "bisa jadi", "salah satu opsi"]) {
      assert.ok(PROMPT_SISTEM.includes(frasa), `frasa "${frasa}" harus dilarang`);
    }
    assert.match(PROMPT_SISTEM, /datanya kurang/i);
  });

  it("TIDAK lagi memaku angka 5 temuan di prompt (batas ikut kedalaman)", () => {
    assert.doesNotMatch(PROMPT_SISTEM, /Paling banyak 5 temuan/);
  });

  it("mempertahankan aturan lama: arah temuan tidak boleh dibalik", () => {
    assert.match(PROMPT_SISTEM, /JANGAN membalik arah temuan/);
  });

  it("struktur pesan: bahan dulu, instruksi di akhir", () => {
    const bahan = susunBahan(hasilUji());
    const teks = susunPesan(bahan, "sedang").teks;
    assert.ok(teks.indexOf(bahan) < teks.indexOf(ATURAN_KEDALAMAN.sedang));
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
