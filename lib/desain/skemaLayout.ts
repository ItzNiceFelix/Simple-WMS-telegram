// lib/desain/skemaLayout.ts — Skema layout banner: bentuk data + validasi. FUNGSI MURNI.
//
// Kenapa murni (tanpa D1, jaringan, atau fabric):
//   Bentuk inilah satu-satunya hal yang dikirim/diterima AI (Fase 4) dan dirender kanvas
//   (Fase 5/7). Kalau validasinya butuh DB atau DOM, aturan ini hanya bisa diuji lewat
//   peramban dan cepat atau lambat tiap pemanggil punya salinan aturannya sendiri.
//   Di sini masukannya eksplisit (objek mentah) dan keluarannya pasti.
//
// DUA KEPUTUSAN YANG MENGIKAT:
//   1. Koordinat TERNORMALISASI 0..1, bukan piksel. Layout yang dibuat untuk 1080x1080
//      harus bisa dipindah ke 1200x628 tanpa ditulis ulang. Pengecualian: `ukuran` font
//      dalam piksel dokumen — teks harus tetap seukuran banner, bukan ikut menyusut.
//   2. Validator TIDAK PERNAH melempar. Masukan datang dari AI dan dari dokumen lama
//      yang mungkin rusak; yang dibutuhkan pemanggil adalah jawaban "pakai ini" atau
//      "tolak, ini alasannya" — bukan exception yang menggagalkan seluruh permintaan.

/** Jenis elemen yang bisa dirender ke kanvas. Di luar daftar ini = dibuang. */
export type JenisElemen = "teks" | "persegi" | "lingkaran" | "garis" | "gambar";

/** Satu elemen layout. Semua field opsional SELALU terisi setelah `validasiLayout`. */
export type ElemenLayout = {
  id: string;
  jenis: JenisElemen;
  // Koordinat TERNORMALISASI 0..1 relatif kanvas (pola PosterLLaVa) supaya tidak
  // bergantung preset ukuran. 0,0 = kiri atas.
  x: number; y: number; w: number; h: number;
  rotasi?: number;          // derajat, default 0
  // teks
  teks?: string;
  font?: string;            // salah satu FONT_AMAN
  ukuran?: number;          // piksel dokumen (bukan normalized!)
  tebal?: boolean; miring?: boolean; garisBawah?: boolean;
  perataan?: "kiri" | "tengah" | "kanan";
  warna?: string;           // hex #rrggbb
  warnaGaris?: string;
  tebalGaris?: number;
  radiusSudut?: number;
  opasitas?: number;        // 0..1
};

/** Satu banner. `elemen` = urutan z-order, index 0 paling bawah. */
export type LayoutBanner = {
  versi: 1;
  latarBelakang: string;    // hex
  elemen: ElemenLayout[];
};

/** Ukuran dokumen dalam piksel. Kunci = string "lebarxtinggi". */
export type UkuranPiksel = { lebar: number; tinggi: number };

/** Kotak elemen dalam piksel dokumen — bentuk yang diterima fabric (left/top/width/height). */
export type KotakPiksel = { left: number; top: number; width: number; height: number };

/**
 * Font yang aman dipakai tanpa memuat berkas. Wajib: semua lingkungan render (peramban
 * pengguna, Worker untuk pratinjau) harus punya font ini, kalau tidak teks kelihatan
 * berbeda dari maksud desainernya.
 */
export const FONT_AMAN: readonly string[] = [
  "Arial", "Georgia", "Courier New", "Verdana", "Tahoma", "Impact",
];

/** Palet kecil warna serasi (8 hex). AI hanya boleh memilih dari sini. */
export const PALET_WARNA: readonly string[] = [
  "#000000", "#ffffff", "#1d4ed8", "#0ea5e9",
  "#dc2626", "#f59e0b", "#16a34a", "#6b7280",
];

/**
 * Preset ukuran dokumen kanvas. HARUS sama dengan `components/dashboard/editor-desain.tsx`:
 * kalau berbeda, posisi yang disimpan dari editor akan meleset saat dirender ulang.
 * Batas 3 ukuran ini juga yang dipakai `lib/d1/desain.ts` (`UKURAN_SAH`).
 */
export const UKURAN_PRESET: Record<string, UkuranPiksel> = {
  "1080x1080": { lebar: 1080, tinggi: 1080 },
  "1080x1350": { lebar: 1080, tinggi: 1350 },
  "1200x628": { lebar: 1200, tinggi: 628 },
};

/** Elemen maksimum per banner. 60 = batas praktis sebelum kanvas berat & AI melantur. */
export const MAKS_ELEMEN = 60;
/** Panjang teks maksimum per elemen (karakter). */
export const MAKS_TEKS = 400;

// Default dipakai validator saat field opsional tidak ada/ salah isi.
const WARNA_BAWAAN = "#000000";
const WARNA_GARIS_BAWAAN = "#000000";
const FONT_BAWAAN = "Arial";
const UKURAN_FONT_BAWAAN = 48;
const TEBAL_GARIS_BAWAAN = 0;
const UKURAN_BAWAAN: UkuranPiksel = UKURAN_PRESET["1080x1080"];
const JENIS_SAH: readonly JenisElemen[] = ["teks", "persegi", "lingkaran", "garis", "gambar"];
const PERATAAN_SAH: readonly ("kiri" | "tengah" | "kanan")[] = ["kiri", "tengah", "kanan"];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Hasil validasi: layout bersih, atau alasan penolakan. Tidak pernah melempar. */
export type HasilValidasi = { ok: true; layout: LayoutBanner } | { ok: false; error: string };

/** Metadata template untuk UI pemilih template. `slot` = placeholder yang bisa diisi. */
export type MetadataTemplate = { nama: string; label: string; slot: string[] };

// Helper di bawah ini BUKAN pembungkus tipis: aturannya (non-finite ≠ 0, warna salah →
// default, koordinat dijepit) diulang di belasan tempat. Disatukan supaya satu perubahan
// aturan tidak perlu diburu ke seluruh berkas.

/** Objek biasa (bukan null/array) — gerbang pertama setiap penelusuran. */
function objek(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Non-finite/undefined tidak boleh menyusup sebagai 0 — 0 di sini adalah nilai yang sah. */
function angka(v: unknown, bawaan: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : bawaan;
}

function teks(v: unknown, bawaan = ""): string {
  return typeof v === "string" ? v : bawaan;
}

/** Warna salah → default; bukan alasan membuang elemen (AI sering salah tipis). */
function warna(v: unknown, bawaan: string): string {
  return typeof v === "string" && HEX.test(v) ? v : bawaan;
}

function boolean(v: unknown, bawaan: boolean): boolean {
  return typeof v === "boolean" ? v : bawaan;
}

function idUnik(kandidat: unknown, dipakai: Set<string>): string {
  let id = teks(kandidat).trim() || `e${dipakai.size + 1}`;
  // Id ganda membuat reaksi UI (pilih/hapus) menyasar elemen yang salah.
  while (dipakai.has(id)) id = `${id}_`;
  dipakai.add(id);
  return id;
}

/** Bersihkan satu elemen; `null` = jenis tak dikenal, harus dibuang. */
function bersihkanElemen(mentah: unknown, dipakai: Set<string>): ElemenLayout | null {
  if (!objek(mentah)) return null;
  if (!JENIS_SAH.includes(mentah.jenis as JenisElemen)) return null;

  // Koordinat selalu dijepit ke 0..1; w/h = 0 tidak bisa dilihat/diklik, jadi 0,01
  // adalah elemen terkecil yang masih terlihat.
  const w = Math.min(1, Math.max(0, angka(mentah.w, 0.2)));
  const h = Math.min(1, Math.max(0, angka(mentah.h, 0.2)));
  const bersih: ElemenLayout = {
    id: idUnik(mentah.id, dipakai),
    jenis: mentah.jenis as JenisElemen,
    x: Math.min(1, Math.max(0, angka(mentah.x, 0))),
    y: Math.min(1, Math.max(0, angka(mentah.y, 0))),
    w: w <= 0 ? 0.01 : w,
    h: h <= 0 ? 0.01 : h,
    rotasi: angka(mentah.rotasi, 0),
    opasitas: Math.min(1, Math.max(0, angka(mentah.opasitas, 1))),
  };

  if (bersih.jenis === "teks") {
    const s = teks(mentah.teks);
    bersih.teks = s.length > MAKS_TEKS ? s.slice(0, MAKS_TEKS) : s;
    bersih.font = FONT_AMAN.includes(teks(mentah.font)) ? (mentah.font as string) : FONT_BAWAAN;
    bersih.ukuran = Math.min(400, Math.max(4, angka(mentah.ukuran, UKURAN_FONT_BAWAAN)));
    bersih.tebal = boolean(mentah.tebal, false);
    bersih.miring = boolean(mentah.miring, false);
    bersih.garisBawah = boolean(mentah.garisBawah, false);
    bersih.perataan = PERATAAN_SAH.includes(mentah.perataan as "kiri")
      ? (mentah.perataan as "kiri" | "tengah" | "kanan")
      : "kiri";
    bersih.warna = warna(mentah.warna, WARNA_BAWAAN);
    return bersih;
  }

  if (bersih.jenis === "garis") {
    bersih.warnaGaris = warna(mentah.warnaGaris, WARNA_GARIS_BAWAAN);
    bersih.tebalGaris = Math.max(1, angka(mentah.tebalGaris, 2));
    return bersih;
  }

  // persegi / lingkaran / gambar
  bersih.warna = warna(mentah.warna, bersih.jenis === "gambar" ? "#ffffff" : WARNA_BAWAAN);
  if (bersih.jenis !== "gambar") bersih.warnaGaris = warna(mentah.warnaGaris, WARNA_GARIS_BAWAAN);
  bersih.tebalGaris = Math.max(0, angka(mentah.tebalGaris, TEBAL_GARIS_BAWAAN));
  if (bersih.jenis === "persegi") bersih.radiusSudut = Math.max(0, angka(mentah.radiusSudut, 0));
  if (bersih.jenis === "gambar") bersih.teks = teks(mentah.teks, ""); // url gambar
  return bersih;
}

/**
 * Validasi + bersihkan layout mentah (dari AI, DB, atau JSON yang diedit manusia).
 *
 * TIDAK PERNAH melempar: masukan apa pun (null, angka, string, array) dijawab
 * `{ ok: false, error }`. Terlalu ketat = AI gagal terus; terlalu longgar = dokumen
 * rusak masuk DB. Karena itu salah isi ringan dijepit/diganti, sedangkan salah bentuk
 * (bukan objek, `elemen` bukan array, `versi` salah) ditolak.
 */
export function validasiLayout(mentah: unknown): HasilValidasi {
  if (!objek(mentah)) return { ok: false, error: "layout harus berupa objek" };
  if (mentah.versi !== 1) return { ok: false, error: "versi layout tidak didukung" };
  if (!Array.isArray(mentah.elemen)) return { ok: false, error: "elemen harus berupa array" };

  const dipakai = new Set<string>();
  const elemen: ElemenLayout[] = [];
  let dibuang = 0;
  for (const item of mentah.elemen) {
    if (elemen.length >= MAKS_ELEMEN) break; // kelebihan dipotong, tidak menggagalkan
    const bersih = bersihkanElemen(item, dipakai);
    if (bersih) elemen.push(bersih);
    else dibuang++;
  }

  // `dibuang` selalu ditulis (0 pun) supaya pemanggil/AI bisa melaporkan "3 elemen dilewati"
  // tanpa menebak-nebak apakah fieldnya ada.
  return {
    ok: true,
    layout: {
      versi: 1,
      latarBelakang: warna(mentah.latarBelakang, "#ffffff"),
      elemen,
      // @ts-expect-error field laporan di luar tipe LayoutBanner — disengaja agar tipe
      // dokumen tetap ketat sementara pemanggil tahu berapa elemen yang hilang.
      dibuang,
    } as LayoutBanner & { dibuang: number },
  };
}

/**
 * Konversi koordinat ternormalisasi ke piksel dokumen.
 * Preset tak dikenal → 1080x1080 (pemanggil yang mengirim kunci salah tidak boleh
 * membuat kanvas berukuran NaN).
 */
export function kePiksel(elemen: ElemenLayout, ukuran: string): KotakPiksel {
  const { lebar, tinggi } = UKURAN_PRESET[ukuran] ?? UKURAN_BAWAAN;
  return {
    left: elemen.x * lebar,
    top: elemen.y * tinggi,
    width: elemen.w * lebar,
    height: elemen.h * tinggi,
  };
}

/** Isi `{{kunci}}` dari slot. Placeholder tanpa isi DIBIARKAN sebagai teks contoh. */
function isiSlot(s: string, slot: Record<string, string>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (utuh, kunci: string) => {
    const v = slot[kunci];
    return typeof v === "string" && v.trim() !== "" ? v : utuh;
  });
}

function salinLayout(layout: LayoutBanner): LayoutBanner {
  return { versi: 1, latarBelakang: layout.latarBelakang, elemen: layout.elemen.map((e) => ({ ...e })) };
}

/**
 * Layout contoh per template. Ditulis sebagai data, bukan string JSON: koordinat di sini
 * yang jadi acuan tata letak, dan mata manusia lebih mudah memeriksa angka yang tertata.
 * Urutan array = z-order (elemen latar lebih dulu).
 */
const TEMPLATE: Record<string, LayoutBanner> = {
  // Banner diskon: pita harga besar di kanan, klaim di kiri bawah.
  "promo-diskon": {
    versi: 1,
    latarBelakang: "#dc2626",
    elemen: [
      { id: "judul", jenis: "teks", x: 0.06, y: 0.08, w: 0.88, h: 0.18, teks: "DISKON {{diskon}}", font: "Impact", ukuran: 96, tebal: true, perataan: "tengah", warna: "#ffffff" },
      { id: "produk", jenis: "teks", x: 0.06, y: 0.3, w: 0.88, h: 0.16, teks: "{{nama}}", font: "Arial", ukuran: 56, tebal: true, perataan: "tengah", warna: "#ffffff" },
      { id: "pita", jenis: "persegi", x: 0.2, y: 0.52, w: 0.6, h: 0.16, warna: "#ffffff", radiusSudut: 16, opasitas: 1 },
      { id: "harga", jenis: "teks", x: 0.2, y: 0.55, w: 0.6, h: 0.1, teks: "{{harga}}", font: "Impact", ukuran: 72, perataan: "tengah", warna: "#dc2626" },
      { id: "klaim", jenis: "teks", x: 0.06, y: 0.78, w: 0.88, h: 0.1, teks: "{{klaim}}", font: "Arial", ukuran: 36, perataan: "tengah", warna: "#ffffff" },
    ],
  },
  // Nama produk: produk di tengah, harga di bawah.
  "nama-produk": {
    versi: 1,
    latarBelakang: "#ffffff",
    elemen: [
      { id: "nama", jenis: "teks", x: 0.08, y: 0.1, w: 0.84, h: 0.2, teks: "{{nama}}", font: "Georgia", ukuran: 64, tebal: true, perataan: "tengah", warna: "#000000" },
      { id: "gambar", jenis: "gambar", x: 0.15, y: 0.34, w: 0.7, h: 0.4, warna: "#ffffff", teks: "{{gambar}}" },
      { id: "garis", jenis: "garis", x: 0.3, y: 0.78, w: 0.4, h: 0.01, warnaGaris: "#6b7280", tebalGaris: 2 },
      { id: "harga", jenis: "teks", x: 0.08, y: 0.82, w: 0.84, h: 0.12, teks: "{{harga}}", font: "Arial", ukuran: 56, tebal: true, perataan: "tengah", warna: "#1d4ed8" },
    ],
  },
  // Info produk: daftar ciri di bawah judul.
  "info-produk": {
    versi: 1,
    latarBelakang: "#ffffff",
    elemen: [
      { id: "lingkaran", jenis: "lingkaran", x: 0.42, y: 0.06, w: 0.16, h: 0.16, warna: "#0ea5e9", opasitas: 1 },
      { id: "judul", jenis: "teks", x: 0.06, y: 0.26, w: 0.88, h: 0.12, teks: "{{nama}}", font: "Verdana", ukuran: 52, tebal: true, perataan: "tengah", warna: "#000000" },
      { id: "info", jenis: "teks", x: 0.1, y: 0.44, w: 0.8, h: 0.3, teks: "{{info}}", font: "Arial", ukuran: 36, perataan: "kiri", warna: "#000000" },
      { id: "klaim", jenis: "teks", x: 0.1, y: 0.8, w: 0.8, h: 0.1, teks: "{{klaim}}", font: "Arial", ukuran: 32, miring: true, perataan: "tengah", warna: "#16a34a" },
    ],
  },
};

/** Slot yang dikenali tiap template (bukan yang benar-benar muncul di dokumen — UI butuh daftar tetap). */
const SLOT_TEMPLATE: Record<string, string[]> = {
  "promo-diskon": ["nama", "harga", "diskon", "klaim"],
  "nama-produk": ["nama", "harga", "gambar"],
  "info-produk": ["nama", "info", "klaim"],
};

const LABEL_TEMPLATE: Record<string, string> = {
  "promo-diskon": "Promo Diskon",
  "nama-produk": "Nama Produk",
  "info-produk": "Info Produk",
};

/** Daftar nama template bawaan. Dipakai UI dan prompt AI. */
export const NAMA_TEMPLATE: readonly string[] = Object.keys(TEMPLATE);

/**
 * Template siap render, dengan placeholder `{{...}}` sudah diisi dari `slot`.
 * `nama` tak dikenal → template pertama (pemilih template yang mengirim nama salah
 * lebih baik mendapat contoh daripada kanvas kosong).
 * `ukuran` tidak dipakai menghitung koordinat (ternormalisasi), tapi dipakai merapikan
 * ukuran font supaya teks template tidak kekecilan di dokumen besar.
 */
export function buatTemplate(nama: string, ukuran: string, slot: Record<string, string>): LayoutBanner {
  const sumber = TEMPLATE[nama] ?? TEMPLATE[NAMA_TEMPLATE[0]];
  const skala = (UKURAN_PRESET[ukuran] ?? UKURAN_BAWAAN).lebar / UKURAN_BAWAAN.lebar;
  const layout = salinLayout(sumber);
  layout.elemen = layout.elemen.map((e) => ({
    ...e,
    teks: e.teks === undefined ? undefined : isiSlot(e.teks, slot),
    ukuran: e.ukuran === undefined ? undefined : Math.max(4, Math.round(e.ukuran * skala)),
  }));
  return layout;
}

/** Metadata template untuk UI pemilih (nama mesin, label ramah, slot yang bisa diisi). */
export function daftarTemplate(): MetadataTemplate[] {
  return NAMA_TEMPLATE.map((nama) => ({
    nama,
    label: LABEL_TEMPLATE[nama] ?? nama,
    slot: [...(SLOT_TEMPLATE[nama] ?? [])],
  }));
}
