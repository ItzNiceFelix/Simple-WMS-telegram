// Uji bahan prompt analisa mendalam.
//
// Fokus uji ini BUKAN kualitas bahasa AI, melainkan APA YANG DIKIRIM ke AI. Kalau bahan
// salah (mis. memuat data mentah), AI punya kesempatan menghitung ulang — dan angka
// analisa tidak lagi bisa diaudit. Itu satu-satunya hal yang bisa diuji di sini, dan
// justru yang paling penting.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { susunBahan, PROMPT_SISTEM, PROMPT_SISTEM_SKENARIO, ATURAN_KEDALAMAN, susunPesan, susunPesanSkenario, type KonteksBahan } from "./ai";
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
    organikDilihat: null, organikKunjungan: null, organikKeranjang: null, organikPesanan: null, organikOmzet: null,
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

describe("PROMPT_SISTEM — batas keras hanya pada angka", () => {
  it("melarang menghitung ulang angka", () => {
    assert.match(PROMPT_SISTEM, /DILARANG menghitung ulang/i);
    assert.match(PROMPT_SISTEM, /menjumlahkan/);
  });

  it("melarang mengarang angka dan menaksir", () => {
    assert.match(PROMPT_SISTEM, /mengarang angka/i);
    assert.match(PROMPT_SISTEM, /menaksir/);
    assert.match(PROMPT_SISTEM, /datanya belum ada/i);
  });

  it("mewajibkan menyebut data apa yang kurang bila tak cukup menjawab", () => {
    assert.match(PROMPT_SISTEM, /data\s+apa\s+yang\s+kurang/i);
  });

  it("membebaskan tafsir: hipotesis, prioritas, sebab-akibat, kritik", () => {
    assert.match(PROMPT_SISTEM, /berhipotesis/);
    assert.match(PROMPT_SISTEM, /sebab-akibat/);
    assert.match(PROMPT_SISTEM, /mengkritik/i);
  });

  it("melarang mengklaim tahu GMV MAX / AUTO ROAS", () => {
    // Peringatan user: "informasi SANGAT terkini tentang GMV MAX"; sistem ini tidak
    // punya itu, jadi AI harus dilarang mengklaimnya.
    assert.match(PROMPT_SISTEM, /GMV MAX/);
    assert.match(PROMPT_SISTEM, /AUTO ROAS/);
    assert.match(PROMPT_SISTEM, /DILARANG mengklaim tahu/i);
  });

  it("melarang menyebut target ROAS sebagai yang terbaik", () => {
    assert.match(PROMPT_SISTEM, /yang terbaik/);
    assert.match(PROMPT_SISTEM, /titik impas/i);
  });

  it("TIDAK memaksa struktur jawaban lama", () => {
    // Struktur dipaku = narasi terasa diatur; bentuk jawaban kini bebas.
    assert.doesNotMatch(PROMPT_SISTEM, /kutip judul temuan apa adanya/i);
    assert.doesNotMatch(PROMPT_SISTEM, /jangan menambahkan penilaian sendiri/i);
    assert.doesNotMatch(PROMPT_SISTEM, /Satu paragraf ringkasan/i);
    assert.doesNotMatch(PROMPT_SISTEM, /Daftar prioritas tindakan/i);
    assert.doesNotMatch(PROMPT_SISTEM, /Yang belum bisa dinilai/);
    assert.doesNotMatch(PROMPT_SISTEM, /frasa lindung/i);
    assert.match(PROMPT_SISTEM, /BENTUK JAWABAN: bebas/i);
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

describe("susunBahan — konteks opsional", () => {
  it("tanpa konteks menghasilkan potongan kunci yang sama dengan perilaku lama", () => {
    // Pemanggil lama (route, analisaMendalam) hanya mengirim `h`; keluarannya tidak
    // boleh berubah. Potongan kunci dibandingkan terhadap string yang diharapkan.
    const b = susunBahan(hasilUji());
    const lama = [
      "PERIODE: 2026-10-13 (preset #1)",
      "RINGKASAN: omzet Rp 65000, laba Rp 27880, margin 42.9%, 10 pesanan, 1 SKU terjual.",
      "TEMUAN (sudah dihitung, kutip apa adanya):",
      "- [masalah serius] 2 SKU merugi setiap kali terjual: Harga jual lebih rendah daripada biaya.",
    ];
    for (const potongan of lama) assert.ok(b.includes(potongan), `bahan lama harus memuat: ${potongan}`);
  });

  it("konteks kosong/undefined tidak menambah blok apa pun", () => {
    const tanpa = susunBahan(hasilUji());
    assert.equal(susunBahan(hasilUji(), {}), tanpa);
    assert.equal(susunBahan(hasilUji(), undefined), tanpa);
    assert.doesNotMatch(tanpa, /TREN HARIAN|PER JAM|KLASIFIKASI PRODUK|KOMPOSISI BIAYA|PERTANYAAN PENGGUNA/);
  });

  it("konteks terisi menambahkan blok berlabel jelas", () => {
    const konteks: KonteksBahan = {
      trenHarian: "13 Okt: omzet Rp 65000; 14 Okt: omzet Rp 70000",
      perJam: "19:00-21:00 menyumbang 40% pesanan",
      fastSlowDead: "Cepat: 001562; Lambat: -; Mati: -",
      komposisiBiaya: "HPP 57%, admin 0%, pajak 0%",
      pertanyaan: "Kenapa laba turun padahal omzet naik?",
    };
    const b = susunBahan(hasilUji(), konteks);
    assert.match(b, /TREN HARIAN \(sudah dihitung sistem\):/);
    assert.match(b, /PER JAM \(sudah dihitung sistem\):/);
    assert.match(b, /KLASIFIKASI PRODUK:/);
    assert.match(b, /KOMPOSISI BIAYA:/);
    assert.match(b, /PERTANYAAN PENGGUNA:/);
    assert.ok(b.includes(konteks.pertanyaan!));
    // Bahan lama tetap utuh di depan blok konteks.
    assert.ok(b.indexOf("PERIODE: 2026-10-13") < b.indexOf("TREN HARIAN"));
  });

  it("blok konteks hanya muncul untuk field yang diisi", () => {
    const b = susunBahan(hasilUji(), { pertanyaan: "Stok mana yang harus didahulukan?" });
    assert.match(b, /PERTANYAAN PENGGUNA:/);
    assert.doesNotMatch(b, /TREN HARIAN/);
    assert.doesNotMatch(b, /KOMPOSISI BIAYA/);
  });
});

describe("susunPesan — pertanyaan pengguna", () => {
  it("tanpa pertanyaan tidak menambah instruksi menjawab pertanyaan", () => {
    assert.doesNotMatch(susunPesan("bahan", "sedang").teks, /Jawab langsung pertanyaan/);
  });

  it("dengan pertanyaan memuat instruksi menjawab langsung, bukan merangkum", () => {
    const teks = susunPesan("bahan", "sedang", "Produk mana yang harus dihentikan?").teks;
    assert.match(teks, /Jawab langsung pertanyaan pengguna/);
    assert.match(teks, /bukan sekadar merangkum/);
    assert.ok(teks.includes("Produk mana yang harus dihentikan?"));
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

describe("kedalaman hanya mengatur PANJANG, bukan struktur", () => {
  it("ringkas sekitar 150 kata, sedang sekitar 350 kata", () => {
    assert.match(ATURAN_KEDALAMAN.ringkas, /150 kata/);
    assert.match(ATURAN_KEDALAMAN.sedang, /350 kata/);
  });

  it("panjang tanpa batas praktis", () => {
    assert.match(ATURAN_KEDALAMAN.panjang, /tanpa batas praktis/i);
  });

  it("tidak ada kedalaman yang mengatur jumlah temuan atau bentuk jawaban", () => {
    for (const k of ["ringkas", "sedang", "panjang"] as const) {
      assert.doesNotMatch(ATURAN_KEDALAMAN[k], /temuan/i, `kedalaman ${k} tidak boleh mengatur temuan`);
      assert.doesNotMatch(ATURAN_KEDALAMAN[k], /paragraf|daftar prioritas|bagian/i);
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

  it("struktur pesan: bahan dulu, instruksi di akhir", () => {
    const bahan = susunBahan(hasilUji());
    const teks = susunPesan(bahan, "sedang").teks;
    assert.ok(teks.indexOf(bahan) < teks.indexOf(ATURAN_KEDALAMAN.sedang));
  });
});

describe("PROMPT_SISTEM_SKENARIO — menilai sendiri, bukan mengikuti urutan", () => {
  it("meminta AI menilai sendiri hentikan/naikkan/tahan dengan alasan berangka", () => {
    assert.match(PROMPT_SISTEM_SKENARIO, /dihentikan, dinaikkan, atau ditahan/);
    assert.match(PROMPT_SISTEM_SKENARIO, /alasan berangka/);
  });

  it("TIDAK memaksa mengikuti urutan skenario", () => {
    assert.doesNotMatch(PROMPT_SISTEM_SKENARIO, /urutan sama/);
    assert.doesNotMatch(PROMPT_SISTEM_SKENARIO, /Ikuti TIGA skenario/);
    assert.match(PROMPT_SISTEM_SKENARIO, /bahan pertimbangan/);
  });

  it("melarang mengarang angka dan menyebut target ROAS terbaik", () => {
    assert.match(PROMPT_SISTEM_SKENARIO, /mengarang angka/i);
    assert.match(PROMPT_SISTEM_SKENARIO, /yang terbaik/);
    assert.match(PROMPT_SISTEM_SKENARIO, /GMV MAX/);
  });

  it("susunPesanSkenario tidak memuat frasa 'urutan sama'", () => {
    const pesan = susunPesanSkenario(
      {
        fakta: ["omzet Rp 1000"],
        skenario: [{ id: "naikkan", judul: "Naikkan modal", kapan: "ROAS di atas 2", angka: ["ROAS 3"], langkah: ["tambah modal bertahap"] }],
      },
      1
    );
    for (const p of pesan) assert.doesNotMatch(p.teks, /urutan sama/);
    assert.match(pesan[1].teks, /Nilai sendiri dari paket/);
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

  it("metrik organik IKUT dikirim ke AI saat ada, dan diberi label organik", async () => {
    const fx = JSON.parse(JSON.stringify(barisUji[0])) as BarisSku;
    const m: MasukanAnalisa = {
      presetId: 1, periode: "2026-10-13",
      snapshot: {
        jml_order: 10, omzet: 65000, hpp: 37120, biaya: 0, pajak: 0, laba: 27880,
        rincian: [{
          sku: fx.sku, nama: fx.nama, unit: fx.unit, hppSatuan: fx.hppSatuan,
          hargaJual: fx.hargaJual, marginSatuan: fx.marginSatuan,
          marginPersen: fx.marginPersen, kontribusi: fx.kontribusi,
        }],
      },
      hppMaster: new Map(), stok: null, biayaIklan: null, jmlSnapshot: 3, adaPerforma: true,
      performaPerSku: new Map([[fx.sku, { dilihat: 400, klik: 20, kunjungan: 120, keranjang: 8, pesanan: 3, omzet: 300000, tanpaBeli: 100 }]]),
    };
    const b = susunBahan(analisaCepat(m));
    assert.match(b, /ORGANIK \(tanpa iklan\)/);
    assert.match(b, /kunjungan 120/);
    assert.match(b, /CR organik 2\.5%/);
  });

  it("tanpa data organik -> tidak ada kalimat ORGANIK di bahan (null bukan nol)", async () => {
    const b = susunBahan(hasilUji());
    assert.ok(!/ORGANIK/.test(b), "SKU tanpa baris performa tidak boleh menambah kalimat kosong");
  });
});
