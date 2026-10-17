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
  /**
   * Rentang data yang dipakai sebagai kunci `performa_produk`: `YYYY-MM-DD_YYYY-MM-DD`
   * (tanggal paling awal _ paling akhir) atau `YYYY-MM-DD` bila hanya satu tanggal.
   *
   * KENAPA periode wajib terisi: tabel berkunci (preset, periode, sku). Selama importer
   * menulis periode kosong, SETIAP impor menimpa impor sebelumnya pada kunci yang sama —
   * riwayat hilang, sehingga delta antar periode dan ranking ikut mustahil.
   */
  periode: string;
};

/** `YYYY-MM-DD` dari objek Date menurut zona Jakarta. `en-CA` memang berformat ISO. */
const formatIsoJakarta = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Periode untuk kolom `performa_produk` — rentang tanggal data, atau tanggal impor.
 *
 * `YYYY-MM-DD_YYYY-MM-DD` (paling awal _ paling akhir) bila berkas punya tanggal,
 * `YYYY-MM-DD` bila seluruh baris bertanggal sama, dan tanggal impor WIB dua kali
 * bila tidak ada tanggal sama sekali.
 *
 * KENAPA lewat NAMA header yang mengandung `tanggal`/`waktu`/`date`: `HasilPeta`/
 * `BarisPeta` tidak punya field tanggal (hanya kolom yang sudah dipetakan), dan
 * mengarang posisi kolom berisiko tertukar bila ekspor bergeser. Kolom tanggal tidak
 * memengaruhi angka, jadi tidak perlu masuk `KOL`/`deteksiKolom`; bila tidak ketemu
 * atau isinya tak dikenali, impor tetap jalan dengan tanggal impor.
 *
 * Bentuk sel yang diterima hanya yang tidak ambigu: `YYYY-MM-DD`, `DD/MM/YYYY`
 * (konvensi ekspor Shopee, lihat `lib/d1/adsProduk.ts`), dan serial Excel (`raw: true`
 * mengembalikan angka). `D/M/YYYY` satu digit DITOLAK karena urutan hari/bulan tak pasti.
 */
/** Teks sel yang sudah dirapikan; sel kosong/null jadi "". */
function bersih(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function periodeDariTanggal(rows: unknown[][]): string {
  const kol = (rows[0] ?? [])
    .map((h, i) => (/tanggal|waktu|date/i.test(bersih(h)) ? i : -1))
    .filter((i) => i >= 0);
  let awal: string | null = null;
  let akhir: string | null = null;
  for (let i = 1; i < rows.length; i++) {
    for (const k of kol) {
      const sel = rows[i]?.[k];
      let iso: string | null;
      if (typeof sel === "number") {
        // Serial Excel: 25569 = 1970-01-01. Batas 20000..80000 menyaring sel angka lain
        // (jumlah, persen) agar tidak dikira tanggal.
        iso =
          Number.isFinite(sel) && sel > 20000 && sel < 80000
            ? formatIsoJakarta.format(new Date(Math.round((sel - 25569) * 86400000)))
            : null;
      } else {
        const teks = bersih(sel);
        const mIso = /^(\d{4})-(\d{2})-(\d{2})/.exec(teks);
        const mDmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(teks);
        iso = mIso ? `${mIso[1]}-${mIso[2]}-${mIso[3]}` : mDmy ? `${mDmy[3]}-${mDmy[2]}-${mDmy[1]}` : null;
      }
      if (iso === null) continue;
      if (awal === null || iso < awal) awal = iso;
      if (akhir === null || iso > akhir) akhir = iso;
    }
  }
  if (awal === null || akhir === null) {
    const hariIni = formatIsoJakarta.format(new Date());
    return `${hariIni}_${hariIni}`;
  }
  return awal === akhir ? awal : `${awal}_${akhir}`;
}

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
  // Periode diturunkan dari RENTANG DATA berkas, bukan dari tanggal impor saja: dengan
  // periode kosong setiap impor menimpa impor sebelumnya pada kunci (preset, periode, sku),
  // sehingga riwayat hilang dan delta/ranking antar periode mustahil dihitung.
  const periode = periodeDariTanggal(rows);

  await simpanPetaProduk(db, hasil.baris);
  await simpanPertanyaan(db, hasil.pertanyaan);
  // Hanya baris ber-SKU sah yang masuk `performa_produk` (lihat catatan di `simpanPerforma`).
  await simpanPerforma(db, presetId, periode, hasil.baris);

  return {
    ok: true,
    ringkas: hasil.ringkas,
    jumlahBaris: hasil.baris.length,
    jumlahPertanyaan: hasil.pertanyaan.length,
    jumlahPerforma: hasil.baris.length,
    periode,
  };
}
