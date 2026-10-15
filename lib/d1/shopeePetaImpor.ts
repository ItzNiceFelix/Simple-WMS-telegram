// lib/d1/shopeePetaImpor.ts — Impor ekspor Performa Produk Shopee menjadi peta produk -> SKU
// kita serta metrik performa di D1.
//
// SATU FORMAT: `parentskudetail*.xlsx` — 40 kolom, kolom 0 `Kode Produk`,
// dua kolom `Kode Variasi` (3 = kode Shopee, 6 = SKU kita), kolom 15 `Pesanan Dibuat`.
// `deteksiKolom` (lib/analisa/peta.ts) yang memutuskan kolom; di sini hanya soal baca/simpan.
//
// Baris yang punya SKU sah ditulis; baris tanpa SKU hanya menjadi pertanyaan untuk manusia.
//
// KENAPA `bangunPeta` DIPANGGIL TANPA MESIN PENCocokan (parameter `mesin` kosong):
// Kandidat hanya bantuan tampilan untuk manusia, dan jawaban atas pertanyaan TIDAK pernah
// diambil otomatis dari kandidat. Memasang mesin di sini menambah kerja per baris (ratusan
// baris) tanpa mengubah satu pun keputusan; kalau nanti kartu pertanyaan butuh saran,
// panggil mesin saat halaman dibuka — kandidat itu murah dibuat ulang, sedangkan impor mahal.
import * as XLSX from "xlsx";
import { bangunPeta, type HasilPeta } from "@/lib/analisa/peta";
import { semuaSkuMaster, simpanPertanyaan, simpanPetaProduk, simpanPerforma } from "./shopeePeta";

/** Ringkasan impor untuk ditampilkan di halaman /analisa. */
export type HasilImporPerforma = {
  ringkas: HasilPeta["ringkas"];
  jumlahBaris: number;
  jumlahPertanyaan: number;
  /** Baris yang ikut ditulis ke `performa_produk` (hanya yang SKU-nya sah). */
  jumlahPerforma: number;
};

/**
 * Impor performa produk dari buffer .xlsx.
 *
 * Menerima `ArrayBuffer` (bukan FormData) supaya bisa diuji tanpa Request; route yang
 * memutuskan sendiri cara mengambil berkas.
 *
 * `presetId` = toko pemilik angka ini (`performa_produk` berkunci preset+periode+sku).
 * Satu D1 dipakai beberapa toko, jadi tanpa ini angka dua toko akan saling menimpa.
 */
export async function imporPerforma(
  db: D1Database,
  buffer: ArrayBuffer,
  _oleh: string | null,
  presetId: number,
): Promise<{ ok: true } & HasilImporPerforma> {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // `header: 1` -> array-of-array: posisi kolom dipertahankan apa adanya, lalu `deteksiKolom`
  // menentukan kolom mana yang dipakai.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });

  const master = await semuaSkuMaster(db);
  const hasil = bangunPeta(rows, master);

  await simpanPetaProduk(db, hasil.baris);
  await simpanPertanyaan(db, hasil.pertanyaan);
  // Hanya baris ber-SKU sah yang masuk `performa_produk` (lihat catatan di `simpanPerforma`).
  await simpanPerforma(db, presetId, "", hasil.baris);

  return {
    ok: true,
    ringkas: hasil.ringkas,
    jumlahBaris: hasil.baris.length,
    jumlahPertanyaan: hasil.pertanyaan.length,
    jumlahPerforma: hasil.baris.length,
  };
}
