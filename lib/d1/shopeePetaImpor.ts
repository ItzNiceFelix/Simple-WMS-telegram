// lib/d1/shopeePetaImpor.ts — Impor ekspor `parentskudetail*.xlsx` (Performa Produk Shopee)
// menjadi peta produk -> SKU kita di D1.
//
// KENAPA KOLOM DIBACA PER POSISI, BUKAN PER NAMA:
// File ini punya DUA kolom berjudul `Kode Variasi` (posisi 3 dan 6). Pembacaan lewat nama
// kolom akan selalu mengambil yang pertama — dan yang pertama itu kode variasi SHOPEE
// (`138333482525`), bukan SKU kita. Akibatnya seluruh baris dianggap "SKU tak ada master".
// Posisi adalah satu-satunya penanda yang bisa dipercaya; posisinya dibekukan di KOL
// (lib/analisa/peta.ts) dan diverifikasi uji di sana.
//
// KENAPA `bangunPeta` DIPANGGIL TANPA MESIN PENCocokan (parameter `mesin` kosong):
// Kandidat hanya bantuan tampilan untuk manusia, dan jawaban atas pertanyaan TIDAK pernah
// diambil otomatis dari kandidat. Memasang mesin di sini menambah kerja per baris (ratusan
// baris) tanpa mengubah satu pun keputusan; kalau nanti kartu pertanyaan butuh saran,
// panggil mesin saat halaman dibuka — kandidat itu murah dibuat ulang, sedangkan impor mahal.
import * as XLSX from "xlsx";
import { bangunPeta, type HasilPeta } from "@/lib/analisa/peta";
import { semuaSkuMaster, simpanPertanyaan, simpanPetaProduk } from "./shopeePeta";

/** Ringkasan impor untuk ditampilkan di halaman /analisa. */
export type HasilImporPerforma = {
  ringkas: HasilPeta["ringkas"];
  jumlahBaris: number;
  jumlahPertanyaan: number;
};

/**
 * Impor performa produk dari buffer .xlsx.
 *
 * Menerima `ArrayBuffer` (bukan FormData) supaya bisa diuji tanpa Request; route yang
 * memutuskan sendiri cara mengambil berkas.
 */
export async function imporPerforma(
  db: D1Database,
  buffer: ArrayBuffer,
  _oleh: string | null,
): Promise<{ ok: true } & HasilImporPerforma> {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // `header: 1` -> array-of-array: posisi kolom dipertahankan apa adanya (lihat catatan atas).
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });

  const master = await semuaSkuMaster(db);
  const hasil = bangunPeta(rows, master);

  await simpanPetaProduk(db, hasil.baris);
  await simpanPertanyaan(db, hasil.pertanyaan);

  return {
    ok: true,
    ringkas: hasil.ringkas,
    jumlahBaris: hasil.baris.length,
    jumlahPertanyaan: hasil.pertanyaan.length,
  };
}
