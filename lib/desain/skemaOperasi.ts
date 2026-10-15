// lib/desain/skemaOperasi.ts — Kosakata OPERASI KANVAS untuk AI editor. FUNGSI MURNI.
//
// KENAPA KOSAKATA BARU, bukan memakai ulang `LayoutBanner`:
//   `skemaLayout` adalah bahasa TEMPLATE: satu banner utuh, koordinat ternormalisasi, dan
//   pemakaiannya selalu "ganti seluruh kanvas". Itu cukup untuk tombol "Buat layout", tapi
//   tidak bisa menyatakan hal yang paling sering diminta user editor: "pindahkan judul ke
//   atas", "hapus elemen ini", "kecilkan harga". Bahasa yang hanya punya "banner utuh"
//   memaksa setiap permintaan kecil jadi RELAYOUT PENUH — pekerjaan user yang tidak
//   diminta ikut terhapus.
//
// KENAPA FLAT, BUKAN UNION (pembatas keras, bukan selera):
//   Skema ini dikirim sebagai parameter tool ke penyedia. Gemini TIDAK mendukung
//   `union`/`oneOf`/`anyOf` di skema parameter tool (terdokumentasi di rujukan
//   `fancyboi999/Loomic`; Gemini ada di rantai provider repo ini). Skema union tidak
//   ditolak dengan error yang jelas — ia membuat pemanggilan tool gagal/melantur, dan
//   yang terlihat user hanyalah AI "tidak mengerti". Karena itu bentuknya SATU objek:
//   `op` (string diskriminan) + SEMUA field tiap op sebagai properti opsional. Field yang
//   tidak relevan diabaikan; tidak ada `oneOf` di mana pun, termasuk bersarang.
//
// DUA TINGKAT BAHASA (ini inti desainnya):
//   1. OP OPERASIONAL — mengubah dokumen yang SUDAH ada: pindah, ukuran, hapus, gaya,
//      lapisan, sejajar, kelompok, latar. Non-destruktif secara default.
//   2. OP BANGUN ULANG — `bangun_ulang` membawa satu banner utuh dan MENGGANTI isi kanvas.
//      Ini disetujui pemilik produk, tapi karena destruktif ia harus EKSPLISIT: satu op
//      bernama jelas, bukan efek samping dari op lain.
//
// YANG MEMBEDAKAN berkas ini dari `skemaLayout`: di sini id elemen TIDAK dibuat di server.
// Id adalah wewenang dokumen kanvas (objek fabric sudah punya `id`); server hanya
// memvalidasi bentuk perintah, bukan menciptakan identitas.
//
// Validator TIDAK PERNAH melempar. Masukan datang dari AI; yang dibutuhkan pemanggil
// adalah "pakai ini" atau "tolak, ini alasannya".

import { FONT_AMAN, PALET_WARNA, UKURAN_PRESET, type ElemenLayout, type LayoutBanner } from "./skemaLayout";

/** Satu op. Field opsional SELALU ditulis setelah `validasiOperasi` (kosong pun jelas). */
export type OperasiKanvas = {
  op: string;
  // rujukan elemen
  id?: string;
  ids?: string[];
  // teks / bentuk baru
  teks?: string;
  font?: string;
  ukuran?: number;
  warna?: string;
  // geometri (piksel dokumen)
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotasi?: number;
  // gaya
  tebal?: boolean;
  miring?: boolean;
  garisBawah?: boolean;
  opasitas?: number;
  // urutan lapisan: "atas" | "bawah" | "depan" | "belakang"
  arah?: string;
  // sejajar: "kiri" | "tengah" | "kanan" | "atas" | "tengah_v" | "bawah"
  sisi?: string;
  // distribusi: "horizontal" | "vertikal"
  sumbu?: string;
  // latar
  latarBelakang?: string;
  // bangun_ulang: satu banner utuh (sudah lolos validasiLayout)
  layout?: LayoutBanner;
  // sisipkan_elemen: id baris ai_elemen (pustaka elemen vektor)
  elemen_id?: number;
};

/** Hasil validasi: daftar op bersih, atau alasan penolakan. `dibuang` = op tak dikenal/dilewati. */
export type HasilValidasiOperasi =
  | { ok: true; operasi: OperasiKanvas[]; dibuang: number }
  | { ok: false; error: string };

/** Op yang dikenali. Di luar daftar ini dibuang (dicatat di `dibuang`). */
export const OP_DIKENAL: readonly string[] = [
  "tambah_teks",
  "tambah_bentuk",
  "sisipkan_elemen",
  "pindah",
  "ubah_ukuran",
  "hapus",
  "ubah_gaya",
  "lapisan",
  "sejajar",
  "distribusi",
  "kelompok",
  "pisah_kelompok",
  "latar",
  "bangun_ulang",
];

export const BENTUK_SAH: readonly string[] = ["persegi", "lingkaran", "garis", "segitiga", "bintang"];
export const ARAH_SAH: readonly string[] = ["atas", "bawah", "depan", "belakang"];
export const SISI_SAH: readonly string[] = ["kiri", "tengah", "kanan", "atas", "tengah_v", "bawah"];
export const SUMBU_SAH: readonly string[] = ["horizontal", "vertikal"];

/**
 * Batas jumlah op per permintaan. 40 = cukup untuk satu skrip penyuntingan nyata
 * (tambah 3 objek + rapikan), dan masih di bawah `MAKS_ELEMEN` (60) sehingga hasilnya
 * tidak otomatis melewati batas dokumen.
 */
export const MAKS_OPERASI = 40;

/**
 * Op yang MENGOSONGKAN kanvas sebelum bekerja. Dipakai UI untuk memberi tahu user
 * (dan menegaskan bahwa langkah ini bisa dibatalkan dengan Undo) sebelum menerapkan.
 * Satu tempat, bukan pemeriksaan `op === "bangun_ulang"` yang disalin ke beberapa berkas.
 */
export const OP_DESTRUKTIF: readonly string[] = ["bangun_ulang"];

export function destruktif(operasi: readonly OperasiKanvas[]): boolean {
  return operasi.some((o) => OP_DESTRUKTIF.includes(o.op));
}

/** Objek biasa (bukan null/array) — gerbang pertama penelusuran, sama seperti skemaLayout. */
function objek(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function angka(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function teks(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function boolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** Warna salah → undefined (bukan default): op "ubah warna" tidak boleh menimpa jadi hitam. */
function warnaSah(v: unknown): string | undefined {
  const s = teks(v);
  return s !== undefined && PALET_WARNA.includes(s) ? s : undefined;
}

/**
 * Bersihkan SATU op. `null` = op tak dikenal atau bentuknya salah → dibuang, bukan
 * menggagalkan seluruh skrip: satu op rusak dari model tidak boleh membatalkan 20 op
 * lain yang benar (AI tetap AI; melantur di satu baris itu normal).
 */
function bersihkanOp(mentah: unknown): OperasiKanvas | null {
  if (!objek(mentah)) return null;
  const op = teks(mentah.op)?.trim();
  if (!op || !OP_DIKENAL.includes(op)) return null;

  const bersih: OperasiKanvas = { op };

  const id = teks(mentah.id)?.trim();
  if (id) bersih.id = id.slice(0, 120);
  if (Array.isArray(mentah.ids)) {
    const ids = mentah.ids.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.slice(0, 120));
    if (ids.length > 0) bersih.ids = ids.slice(0, 60);
  }

  // Teks: panjangnya dibatasi 400 seperti MAKS_TEKS di skemaLayout — teks canvas yang
  // lebih panjang daripada itu tidak pernah muat di banner mana pun.
  const t = teks(mentah.teks);
  if (t !== undefined) bersih.teks = t.slice(0, 400);

  const font = teks(mentah.font);
  if (font && FONT_AMAN.includes(font)) bersih.font = font;

  const ukuran = angka(mentah.ukuran);
  if (ukuran !== undefined) bersih.ukuran = Math.min(400, Math.max(4, ukuran));

  const warna = warnaSah(mentah.warna);
  if (warna) bersih.warna = warna;

  const rotasi = angka(mentah.rotasi);
  if (rotasi !== undefined) bersih.rotasi = ((rotasi % 360) + 360) % 360;

  const opasitas = angka(mentah.opasitas);
  if (opasitas !== undefined) bersih.opasitas = Math.min(1, Math.max(0, opasitas));

  // Geometri: TIDAK dijepit ke kotak kanvas di sini. Ukuran dokumen baru diketahui
  // saat penerapan (preset bisa berganti), dan memindahkan objek keluar kanvas adalah
  // hak user — yang perlu dijaga hanya angkanya berupa angka berhingga.
  const x = angka(mentah.x);
  if (x !== undefined) bersih.x = x;
  const y = angka(mentah.y);
  if (y !== undefined) bersih.y = y;
  const w = angka(mentah.w);
  if (w !== undefined) bersih.w = Math.max(1, w);
  const h = angka(mentah.h);
  if (h !== undefined) bersih.h = Math.max(1, h);

  const tebal = boolean(mentah.tebal);
  if (tebal !== undefined) bersih.tebal = tebal;
  const miring = boolean(mentah.miring);
  if (miring !== undefined) bersih.miring = miring;
  const garisBawah = boolean(mentah.garisBawah);
  if (garisBawah !== undefined) bersih.garisBawah = garisBawah;

  const arah = teks(mentah.arah);
  if (arah && ARAH_SAH.includes(arah)) bersih.arah = arah;
  const sisi = teks(mentah.sisi);
  if (sisi && SISI_SAH.includes(sisi)) bersih.sisi = sisi;
  const sumbu = teks(mentah.sumbu);
  if (sumbu && SUMBU_SAH.includes(sumbu)) bersih.sumbu = sumbu;

  const latarBelakang = warnaSah(mentah.latarBelakang);
  if (latarBelakang) bersih.latarBelakang = latarBelakang;

  // `bangun_ulang` tanpa layout yang sah tidak punya arti apa pun — dibuang, karena
  // menerapkannya berarti mengosongkan kanvas TANPA menggambar apa-apa. Itu kehilangan
  // pekerjaan user tanpa imbalan, persis yang tidak boleh terjadi.
  if (op === "bangun_ulang") {
    if (!objek(mentah.layout)) return null;
    bersih.layout = mentah.layout as LayoutBanner;
  }

  // `sisipkan_elemen` wajib punya elemen_id: id yang salah/missing hanya menghasilkan
  // op yang selalu gagal di klien.
  if (op === "sisipkan_elemen") {
    const eid = angka(mentah.elemen_id);
    if (eid === undefined || eid <= 0) return null;
    bersih.elemen_id = Math.trunc(eid);
  }

  return bersih;
}

/**
 * Validasi skrip operasi mentah (dari AI, DB, atau JSON yang diedit manusia).
 *
 * Bentuk yang diterima: array op LANGSUNG, atau objek `{ operasi: [...] }` — model
 * kadang membungkus daftarnya, dan menolak bentuk itu hanya memaksa user mengulang.
 * Di luar dua bentuk itu → ditolak dengan alasan, bukan ditebak.
 */
export function validasiOperasi(mentah: unknown): HasilValidasiOperasi {
  let daftar: unknown[];
  if (Array.isArray(mentah)) daftar = mentah;
  else if (objek(mentah) && Array.isArray(mentah.operasi)) daftar = mentah.operasi;
  else return { ok: false, error: "operasi harus berupa array atau objek { operasi: [...] }" };

  const operasi: OperasiKanvas[] = [];
  let dibuang = 0;
  for (const item of daftar) {
    if (operasi.length >= MAKS_OPERASI) break; // kelebihan dipotong, tidak menggagalkan
    const bersih = bersihkanOp(item);
    if (bersih) operasi.push(bersih);
    else dibuang++;
  }
  if (operasi.length === 0) {
    return { ok: false, error: `Tidak ada operasi yang bisa dipakai (${dibuang} ditolak).` };
  }
  return { ok: true, operasi, dibuang };
}

/**
 * Elemen hasil pencarian pustaka, dipadatkan ke BENTUK YANG SAMA dengan op
 * (`tambah_*`/`sisipkan_elemen`), supaya klien hanya punya SATU jalur render.
 * `ElemenLayout` dari skemaLayout dipakai apa adanya sebagai sumber properti.
 */
export type ElemenKatalog = {
  id: number;
  nama: string;
  kategori: string;
  svg: string;
  /** Bentuk kanonik elemen; klien memakai ini untuk menggambar Path ke kanvas. */
  elemen: ElemenLayout;
};

/** Ukuran default elemen yang disisipkan tanpa w/h eksplisit (piksel dokumen). */
export const UKURAN_ELEMEN_BAWAAN = 200;

/** Preset tak dikenal → 1080x1080, sama dengan `kePiksel` di skemaLayout. */
export function ukuranDokumen(ukuran: string): { lebar: number; tinggi: number } {
  return UKURAN_PRESET[ukuran] ?? UKURAN_PRESET["1080x1080"]!;
}
