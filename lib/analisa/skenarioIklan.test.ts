// Uji paket skenario iklan.
//
// Fokus uji ini BUKAN kualitas rencana (itu tugas AI), melainkan APA YANG DIKIRIM
// sebagai angka: paket wajib memuat angka nyata dari `baris`, wajib selalu memuat tiga
// skenario, dan wajib menyatakan terus terang saat datanya kosong. Kalau paket bisa
// kosong, AI akan mengarang — dan rencana iklan yang angkanya karangan tidak boleh
// jadi dasar belanja uang nyata.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bangunPaketSkenario, rupiah, type MasukanSkenario } from "./skenarioIklan";
import {
  PROMPT_SISTEM, PROMPT_SISTEM_SKENARIO, susunBahanSkenario, susunPesanSkenario,
} from "./ai";
import { AMBANG_CTR_SEHAT, AMBANG_DILIHAT_MIN } from "./hitung";
import type { BarisSku } from "./tipe";

/** Baris dasar: satu SKU dengan angka tetap supaya titik impasnya bisa dihitung tangan. */
function baris(ubah: Partial<BarisSku> = {}): BarisSku {
  return {
    sku: "001562", nama: "Gayung Siba", unit: 10, hppSatuan: 3712, hargaJual: 6500,
    marginSatuan: 2788, marginPersen: 42.9, kontribusi: 27880, roasImpas: 2.33,
    hppMaster: 3712, hppNaik: 0, stok: 50,
    dilihat: null, klik: null, ctr: null, cr: null, biayaIklan: null, roasAktual: null,
    organikDilihat: null, organikKunjungan: null, organikKeranjang: null,
    organikPesanan: null, organikOmzet: null,
    ...ubah,
  };
}

/** SKU bermargin ≤ 0: tidak punya titik impas (roasImpas null). */
const barisRugi = baris({ sku: "0777", nama: "Lain", marginSatuan: -500, roasImpas: null });

function masukan(ubah: Partial<MasukanSkenario> = {}): MasukanSkenario {
  return { hariKe: 3, baris: [baris()], modalIklan: 1234567, targetRoas: 4, ...ubah };
}

describe("rupiah", () => {
  it("ribuan pakai titik", () => assert.equal(rupiah(1234567), "Rp 1.234.567"));
  it("di bawah seribu tanpa titik", () => assert.equal(rupiah(999), "Rp 999"));
  it("negatif tetap terbaca", () => assert.equal(rupiah(-1500), "-Rp 1.500"));
});

describe("bangunPaketSkenario", () => {
  it("selalu mengembalikan tiga skenario berurutan anjlok/bagus/stagnan", () => {
    const p = bangunPaketSkenario(masukan());
    assert.deepEqual(p.skenario.map((s) => s.id), ["roas_anjlok", "roas_bagus", "roas_stagnan"]);
    for (const s of p.skenario) {
      assert.ok(s.judul.length > 0, `${s.id} punya judul`);
      assert.ok(s.kapan.length > 0, `${s.id} punya pemicu`);
      assert.ok(s.angka.length > 0, `${s.id} punya angka pendukung`);
      assert.ok(s.langkah.length >= 3, `${s.id} punya minimal tiga langkah`);
    }
  });

  it("kapan skenario anjlok menyebut titik impas nyata dari baris", () => {
    const p = bangunPaketSkenario(masukan());
    const anjlok = p.skenario.find((s) => s.id === "roas_anjlok");
    assert.ok(anjlok);
    assert.ok(anjlok.kapan.includes("2.33"), `pemicu memuat titik impas nyata: ${anjlok.kapan}`);
    assert.ok(/\bROAS\b/.test(anjlok.kapan), "pemicu menyebut ROAS");
  });

  it("kapan stagnan menyebut rentang titik impas dari data", () => {
    const p = bangunPaketSkenario(masukan({ baris: [baris(), baris({ sku: "0002", roasImpas: 4.1 })] }));
    const stagnan = p.skenario.find((s) => s.id === "roas_stagnan");
    assert.ok(stagnan);
    assert.ok(stagnan.kapan.includes("3.22"), `pakai rata-rata titik impas: ${stagnan.kapan}`);
  });

  it("fakta menyebut jumlah SKU dan angka berformat rupiah", () => {
    const p = bangunPaketSkenario(masukan({ baris: [baris(), baris({ sku: "0002", roasImpas: 4.1 }), barisRugi] }));
    const teksFakta = p.fakta.join("\n");
    assert.ok(teksFakta.includes("3 SKU"), `jumlah SKU disebut: ${teksFakta}`);
    assert.ok(teksFakta.includes("2 di antaranya sudah punya titik impas"), "SKU bermargin positif dihitung");
    assert.ok(teksFakta.includes("Rp 1.234.567"), "modal iklan diformat rupiah");
    assert.ok(teksFakta.includes("0777"), "SKU tanpa titik impas disebut");
  });

  it("hariKe yang diisi user muncul di keluaran", () => {
    const p = bangunPaketSkenario(masukan({ hariKe: 7 }));
    assert.ok(p.fakta.some((f) => f.includes("Hari ke-7")), "fakta menyebut hari ke-7");
    assert.ok(p.skenario.every((s) => s.judul.includes("hari ke-7")), "judul tiap skenario menyebut hari ke-7");
    assert.ok(p.skenario[0].langkah.some((l) => l.includes("Hari ke-7")), "langkah memakai hari user");
  });

  it("ambang diambil dari hitung.ts, bukan ditulis ulang", () => {
    const p = bangunPaketSkenario(
      masukan({
        baris: [baris({ dilihat: 500, klik: 5, ctr: 1, biayaIklan: 1000, roasAktual: 1 })],
      })
    );
    const semua = [...p.fakta, ...p.skenario.flatMap((s) => [s.kapan, ...s.angka, ...s.langkah])].join("\n");
    assert.ok(semua.includes(`${AMBANG_CTR_SEHAT}%`), `CTR ambang ${AMBANG_CTR_SEHAT}% dipakai`);
    assert.ok(
      semua.includes(AMBANG_DILIHAT_MIN.toLocaleString("id-ID")),
      `ambang tayangan ${AMBANG_DILIHAT_MIN} dipakai`
    );
  });

  it("menghitung berapa SKU yang sudah di atas titik impas", () => {
    const p = bangunPaketSkenario(
      masukan({
        baris: [
          baris({ dilihat: 2000, klik: 80, ctr: 4, biayaIklan: 10000, roasAktual: 5 }),
          baris({ sku: "0002", dilihat: 2000, klik: 80, ctr: 4, biayaIklan: 10000, roasAktual: 1 }),
        ],
      })
    );
    const teksFakta = p.fakta.join("\n");
    assert.ok(teksFakta.includes("1 dari 2 SKU beriklan sudah melewati titik impasnya"), teksFakta);
  });

  it("data kosong: tetap tiga skenario dan fakta menyatakan belum ada data", () => {
    const p = bangunPaketSkenario(masukan({ baris: [] }));
    assert.deepEqual(p.skenario.map((s) => s.id), ["roas_anjlok", "roas_bagus", "roas_stagnan"]);
    assert.ok(p.fakta.some((f) => f.includes("Belum ada data SKU")), "fakta menyatakan data kosong");
    for (const s of p.skenario) {
      assert.ok(s.angka.length > 0, `${s.id} tetap punya angka (menyatakan belum bisa dihitung)`);
      assert.ok(s.langkah.length >= 3, `${s.id} tetap punya langkah`);
      assert.ok(s.kapan.includes("Belum bisa dipatok"), `${s.id} menyatakan ambang belum bisa dipatok`);
    }
  });

  it("semua SKU bermargin ≤ 0: titik impas disebut belum bisa dihitung", () => {
    const p = bangunPaketSkenario(masukan({ baris: [barisRugi] }));
    const teksFakta = p.fakta.join("\n");
    assert.ok(teksFakta.includes("Tidak ada satu pun SKU bermargin positif"), teksFakta);
    assert.ok(p.skenario.some((s) => s.langkah.length >= 3));
  });

  it("tidak mengubah masukan", () => {
    const daftar = [baris(), baris({ sku: "0002", roasImpas: 4.1 })];
    const salinan = daftar.map((b) => ({ ...b }));
    bangunPaketSkenario(masukan({ baris: daftar }));
    assert.deepEqual(daftar, salinan, "urutan baris masukan tidak diubah");
  });

  it("langkah tiap skenario menyebut angka, bukan imbauan kosong", () => {
    const p = bangunPaketSkenario(masukan());
    for (const s of p.skenario) {
      assert.ok(
        s.langkah.some((l) => /\d/.test(l)),
        `${s.id} punya langkah berangka: ${s.langkah.join(" | ")}`
      );
    }
  });

  it("tiga id skenario unik dan tiap langkah terisi", () => {
    const p = bangunPaketSkenario(
      masukan({ baris: [baris(), baris({ sku: "0002", roasImpas: 4.1 }), barisRugi] })
    );
    const id = p.skenario.map((s) => s.id);
    assert.equal(new Set(id).size, 3, `id skenario unik: ${id.join(", ")}`);
    for (const s of p.skenario) {
      assert.ok(s.langkah.length > 0, `${s.id} punya langkah`);
      for (const l of s.langkah) {
        assert.ok(l.trim().length > 0, `${s.id} tidak memuat langkah kosong`);
      }
    }
  });
});

/**
 * Bahan yang dikirim ke model untuk saran iklan. Uji ini MENGUNCI jalurnya, bukan gayanya:
 * kalau prompt skenario diam-diam kembali memakai bahan analisa umum (`susunBahan`), jawaban
 * model lagi-lagi tidak nyambung dengan pertanyaan user — persis bug yang membuat tombol
 * "Saran Langkah Iklan" membahas diagram Venn.
 */
describe("susunBahanSkenario — bahan prompt skenario iklan", () => {
  const paket = bangunPaketSkenario(masukan());

  it("menyebut KETIGA skenario beserta id, judul, dan langkahnya", () => {
    const teks = susunBahanSkenario(paket, 3);
    for (const id of ["roas_anjlok", "roas_bagus", "roas_stagnan"]) {
      assert.ok(teks.includes(`[${id}]`), `bahan memuat skenario ${id}:\n${teks}`);
    }
    for (const s of paket.skenario) {
      assert.ok(teks.includes(s.judul), `judul ${s.id} ikut terkirim`);
      assert.ok(teks.includes(s.langkah[0]), `langkah pertama ${s.id} ikut terkirim`);
    }
  });

  it("membawa angka nyata: titik impas, modal, dan hari yang dinilai", () => {
    const teks = susunBahanSkenario(paket, 3);
    assert.ok(teks.includes("2.33"), `titik impas nyata ikut terkirim:\n${teks}`);
    assert.ok(teks.includes("Rp 1.234.567"), "modal iklan ikut terkirim");
    assert.ok(teks.includes("HARI KE-3"), "hari yang dinilai disebut");
  });

  it("bukan bahan analisa umum: tanpa blok RINGKASAN/TEMUAN/KEPUTUSAN IKLAN", () => {
    const teks = susunBahanSkenario(paket, 7);
    for (const penanda of ["RINGKASAN:", "TEMUAN", "KONSENTRASI:", "KEPUTUSAN IKLAN"]) {
      assert.ok(!teks.includes(penanda), `bahan skenario tidak memuat penanda analisa umum "${penanda}"`);
    }
  });

  it("pasangan pesannya memakai prompt skenario, bukan prompt analisa umum", () => {
    const pesan = susunPesanSkenario(paket, 3);
    assert.equal(pesan[0].role, "system");
    assert.equal(pesan[0].teks, PROMPT_SISTEM_SKENARIO);
    assert.notEqual(pesan[0].teks, PROMPT_SISTEM);
    assert.ok(pesan[1].teks.includes("2.33"), "pesan user memuat bahan paket");
  });
});
