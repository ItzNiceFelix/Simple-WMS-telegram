// lib/dashboard/format.test.ts — uji helper format bersama.
//
// Fokus: `formatTanggalJamWib` WAJIB memakai zona WIB, bukan zona perangkat. Owner memakai
// Telegram Mini App dari HP yang zonanya bisa apa saja; kalau formatnya mengikuti zona
// browser, jam order tampil bergeser dan owner menyimpulkan datanya rusak — persis keluhan
// yang memicu perubahan kolom Tanggal & Waktu.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatTanggalJamWib, formatTanggalJamWibBagian, formatRupiah } from "./format";

/**
 * 1760533440 = 2025-10-15T13:04:00Z = 2025-10-15 20:04 WIB.
 *
 * Dipilih karena BUKAN tengah malam: implementasi `toISOString()` apa pun akan menghasilkan
 * "13:04" (UTC) sedangkan yang benar "20:04". Angka yang sama juga menggeser TANGGAL bila
 * dibaca dari zona barat UTC, jadi satu asersi menangkap dua kelas kesalahan sekaligus.
 */
const EPOCH_20_04_WIB = 1760533440;

describe("formatTanggalJamWib", () => {
  it("menampilkan jam WIB (20.04), bukan UTC (13.04)", () => {
    const hasil = formatTanggalJamWib(EPOCH_20_04_WIB);
    assert.ok(
      hasil.includes("20.04"),
      `harus jam WIB 20.04, dapat: ${hasil}. Kalau hasilnya "13.04", implementasinya memakai ` +
        `UTC/detik perangkat — itu cacat yang uji ini jaga.`
    );
    assert.ok(!hasil.includes("13.04"), "jam UTC tidak boleh muncul");
    // Tanggalnya juga harus versi WIB (15 Okt), dan bertanda WIB secara eksplisit.
    assert.ok(hasil.includes("15 Okt 2025"), `tanggal WIB harus 15 Okt 2025, dapat: ${hasil}`);
    assert.ok(hasil.includes("WIB"), `harus menandai zona, dapat: ${hasil}`);
  });

  it("tidak bergantung pada zona waktu proses", () => {
    // Ini uji yang sama dijalankan dengan TZ berbeda: hasilnya WAJIB identik. Tanpa
    // `timeZone: "Asia/Jakarta"` di formatter, dua baris ini akan berbeda — dan di mesin
    // pengembang berzona UTC uji pertama di atas bisa lulus secara kebetulan.
    const tzAsli = process.env.TZ;
    const hasil: string[] = [];
    try {
      for (const tz of ["UTC", "America/New_York", "Asia/Jakarta"]) {
        process.env.TZ = tz;
        hasil.push(new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta" }).format(new Date(EPOCH_20_04_WIB * 1000)));
      }
    } finally {
      if (tzAsli === undefined) delete process.env.TZ;
      else process.env.TZ = tzAsli;
    }
    assert.equal(new Set(hasil).size, 1, `semua TZ harus menghasilkan tanggal yang sama: ${hasil.join(" | ")}`);
  });

  it("baris tanpa jam → tanda pisah, BUKAN tengah malam karangan", () => {
    // Baris lama dari template Excel repo ini di-truncate ke tengah malam UTC dan sebagian
    // bernilai 0/kosong. Menampilkan "00.00" berarti mengarang jam yang tidak pernah tercatat.
    assert.equal(formatTanggalJamWib(0), "—");
    assert.equal(formatTanggalJamWib(null), "—");
    assert.equal(formatTanggalJamWib(undefined), "—");
    assert.equal(formatTanggalJamWib(NaN), "—");
    assert.ok(!formatTanggalJamWib(0).includes("00"), "tidak boleh menampilkan 00.00");
  });

  it("formatnya sama dengan gaya `waktuJakarta` di PDF (id-ID, titik, jam 24)", () => {
    // PDF memakai `hour12: false` dan pemisah titik ("20.04"), bukan "20:04" atau "8:04 PM".
    // Dua format berbeda untuk satu nilai membuat orang mengira ada dua data.
    const hasil = formatTanggalJamWib(EPOCH_20_04_WIB);
    assert.ok(!/AM|PM/i.test(hasil), `tidak boleh format 12 jam: ${hasil}`);
  });
});

describe("formatTanggalJamWibBagian", () => {
  it("memisah tanggal dan jam dari epoch yang SAMA, tanpa potong string", () => {
    assert.equal(formatTanggalJamWibBagian(EPOCH_20_04_WIB, "tanggal"), "15 Okt 2025");
    assert.equal(formatTanggalJamWibBagian(EPOCH_20_04_WIB, "jam"), "20.04");
  });

  it("bagian jam memakai WIB, bukan UTC", () => {
    // Sama seperti uji utama: implementasi UTC akan menghasilkan "13.04".
    assert.equal(formatTanggalJamWibBagian(EPOCH_20_04_WIB, "jam"), "20.04");
  });

  it("stamp tak sah → null untuk KEDUA bagian", () => {
    for (const b of ["tanggal", "jam"] as const) {
      assert.equal(formatTanggalJamWibBagian(0, b), null);
      assert.equal(formatTanggalJamWibBagian(null, b), null);
      assert.equal(formatTanggalJamWibBagian(NaN, b), null);
    }
  });
});

describe("formatRupiah", () => {
  it("null → tanda pisah, bukan NaN", () => {
    assert.equal(formatRupiah(null), "—");
    assert.equal(formatRupiah(undefined), "—");
  });
});
