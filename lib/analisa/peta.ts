// lib/analisa/peta.ts — Peta produk Shopee -> SKU kita. FUNGSI MURNI, tanpa akses DB.
//
// Kenapa murni: aturan pemetaan inilah yang menentukan omzet menempel ke SKU mana.
// Salah di sini = seluruh laporan laba per produk salah, dan salahnya tidak kelihatan.
// Karena itu masukannya eksplisit (baris mentah + master SKU) dan bisa diuji tanpa DB.
//
// KENAPA KOLOM DIBACA PER POSISI, BUKAN PER NAMA: (dipertahankan sebagai CADANGAN)
// File `parentskudetail*.xlsx` punya DUA kolom berjudul `Kode Variasi` (posisi 3 dan 6).
// Membaca lewat nama kolom dengan "temu pertama" akan mengambil yang pertama — dan yang
// pertama itu kode variasi SHOPEE (contoh `138333482525`), bukan SKU kita. Setiap baris
// lalu akan dianggap "SKU tak ada di master".
//
// KENAPA [6] DIDAHULUKAN ATAS [7]:
// [6] `Kode Variasi` (kedua) berisi SKU kita dan menutup 97,6% omzet.
// [7] `SKU Induk` juga SKU kita, tapi hanya menutup 20,9% — kalau [7] dipakai lebih dulu,
// ribuan baris variasi akan dipetakan lewat induknya dan variasi kehilangan SKU-nya.
//
// DETEKSI-HEADER DENGAN CADANGAN POSISI (perubahan 2026-10):
// Ekspor `parentskudetail*.xlsx` — SATU-SATUNYA format performa PRODUK yang diimpor di sini
// (performa IKLAN punya jalur sendiri, `lib/d1/adsProduk.ts`). 40 kolom:
//   0 Kode Produk | 1 Produk | 3 Kode Variasi (Shopee) | 4 Nama Variasi |
//   6 Kode Variasi (SKU kita, DUPLIKAT judul) | 7 SKU Induk |
//   8 Total Penjualan (Pesanan Dibuat) (IDR) | 10 Jumlah Produk Dilihat | 11 Produk Diklik |
//   15 Pesanan Dibuat | 27 Pengunjung Produk (Kunjungan) | 29 Pengunjung Melihat Tanpa Membeli |
//   34 Dimasukkan ke Keranjang (Produk)
//
// Kolom dicari lewat NAMA (case-insensitive, trim), dan HANYA bila nama tidak ketemu
// barulah posisi di `KOL` dipakai — supaya file yang sudah bekerja tidak pernah rusak.
// Kekhususan yang WAJIB: `Kode Variasi` diambil yang TERAKHIR (kolom 3 = kode Shopee,
// kolom 6 = SKU kita) dan `Total Penjualan (...)` dicocokkan dengan `includes` karena
// judulnya panjang dan bisa berubah akhiran mata uangnya.

/** Indeks kolom CADANGAN pada ekspor `parentskudetail*.xlsx`. Lihat catatan di atas. */
export const KOL: KolomPeta = {
  kodeProduk: 0, produk: 1, kodeVariasiShopee: 3, namaVariasi: 4,
  skuVariasi: 6, skuInduk: 7, omzet: 8, pesanan: 15,
  dilihat: 10, klik: 11, kunjungan: 27, tanpaBeli: 29, keranjang: 34,
};

/** Kolom peta yang sudah ditentukan. */
export type KolomPeta = {
  kodeProduk: number; produk: number; kodeVariasiShopee: number; namaVariasi: number;
  skuVariasi: number; skuInduk: number; omzet: number; pesanan: number;
  dilihat: number; klik: number; kunjungan: number; tanpaBeli: number; keranjang: number;
};

/** Judul header yang cocok dengan `cocok` (sudah lowercase), atau `-1`.
 *  `terakhir` = ambil kemunculan TERAKHIR — dipakai `Kode Variasi` yang muncul dua kali. */
function cariKolom(judul: string[], cocok: (h: string) => boolean, terakhir = false): number {
  return terakhir ? judul.findLastIndex(cocok) : judul.findIndex(cocok);
}

/**
 * Tentukan indeks kolom dari BARIS HEADER: cari lewat nama dulu, jatuh ke posisi `KOL`.
 *
 * Memakai nama saja tidak cukup (judul bisa bergeser) dan memakai posisi saja sudah
 * terbukti salah (dua kolom `Kode Variasi`); gabungan keduanya membuat file tetap terbaca.
 */
export function deteksiKolom(header: unknown[]): KolomPeta {
  const judul = Array.from(header ?? [], (v) => bersih(v).toLowerCase());
  // Sebagian sel header bisa kosong -> jangan pernah menjadikan `null` sebagai judul cocok.
  const ada = (nama: string) => judul.indexOf(nama);

  const ambil = (kandidat: number[], posisi: number): number => {
    for (const i of kandidat) if (i >= 0) return i;
    return posisi;
  };

  const kodeProduk = ambil([ada("kode produk")], KOL.kodeProduk);
  const produk = ambil([ada("produk")], KOL.produk);
  // `Kode Variasi` muncul DUA KALI; yang benar yang TERAKHIR (SKU kita, kolom 6).
  const skuVariasi = ambil([cariKolom(judul, (h) => h === "kode variasi", true)], KOL.skuVariasi);
  const skuInduk = ambil([ada("sku induk")], KOL.skuInduk);
  const namaVariasi = ambil([ada("nama variasi")], KOL.namaVariasi);
  const omzet = ambil([cariKolom(judul, (h) => h.includes("total penjualan (pesanan dibuat)"))], KOL.omzet);
  const pesanan = ambil([ada("pesanan dibuat")], KOL.pesanan);
  const dilihat = ambil([ada("jumlah produk dilihat")], KOL.dilihat);
  const klik = ambil([ada("produk diklik")], KOL.klik);
  const kunjungan = ambil([ada("pengunjung produk (kunjungan)")], KOL.kunjungan);
  const tanpaBeli = ambil([ada("pengunjung melihat tanpa membeli")], KOL.tanpaBeli);
  const keranjang = ambil([ada("dimasukkan ke keranjang (produk)")], KOL.keranjang);
  // Kode variasi SHOPEE tidak punya judul pembeda (judulnya sama dengan SKU kita), jadi posisi.
  const kodeVariasiShopee = KOL.kodeVariasiShopee;

  return { kodeProduk, produk, kodeVariasiShopee, namaVariasi, skuVariasi, skuInduk, omzet, pesanan, dilihat, klik, kunjungan, tanpaBeli, keranjang };
}

/** Satu kandidat SKU dari mesin pencocokan. HANYA tampilan — tidak pernah jadi keputusan. */
export type SkorSku = { sku: string; nama: string | null; skor: number };

/** Mesin pencocokan (lib/matching) dipakai lewat antarmuka sempit agar peta tetap murni. */
type KandidatMesin = { cari: (nama: string) => SkorSku[] };

/** Satu baris peta: produk Shopee -> SKU kita. */
export type BarisPeta = {
  kodeProduk: string;
  sku: string;
  /** Dari kolom `skuVariasi` = "variasi"; dari kolom `skuInduk` = "induk". */
  tingkat: "variasi" | "induk";
  variasi: string | null;
  kodeVariasiShopee: string | null;
  namaShopee: string;
  /** Metrik periode ini — HANYA dari baris induk, lihat aturan 4 di `bangunPeta`. */
  dilihat: number;
  klik: number;
  kunjungan: number;
  keranjang: number;
  tanpaBeli: number;
  pesanan: number;
  omzet: number;
};

/** Pertanyaan yang menunggu jawaban manusia; di-dedup per (jenis, kodeProduk). */
export type PertanyaanPeta = {
  jenis: "tanpa_sku" | "sku_tak_ada_master";
  kodeProduk: string;
  namaShopee: string;
  variasi: string | null;
  pesanan: number;
  omzet: number;
  kandidat: SkorSku[];
};

export type HasilPeta = {
  baris: BarisPeta[];
  pertanyaan: PertanyaanPeta[];
  ringkas: {
    kodeProdukTotal: number;
    terpetakan: number;
    pesananTotal: number;
    pesananTerpetakan: number;
    omzetTotal: number;
    omzetTerpetakan: number;
  };
};

/**
 * Angka dari sel ekspor. Nilainya teks berformat Indonesia: "1.234.567", "538.5".
 *
 * Titik SELALU pemisah ribuan (ekspor Shopee memakai titik untuk ribuan, bukan desimal),
 * jadi "538.5" = 5385, sesuai spec: "538.5" -> 539? Bukan — lihat catatan di bawah.
 *
 * CATATAN PENTING: spec menyebut `"538.5"` harus jadi 539 (koma desimal). Itu benar
 * HANYA bila titik dipakai sebagai desimal. Di file nyata titik adalah ribuan DAN
 * ekspor tidak pernah memakai titik desimal, sehingga aturan yang dipakai:
 *   - "1.234.567" -> 1234567 (titik ribuan)
 *   - "538.5"    -> 5385  ... kecuali bila angka hanya punya SATU titik dan digit
 *                   setelahnya < 3, itu desimal -> dibulatkan 539.
 * Selalu integer; nilai tak dikenali -> 0.
 */
export function bacaAngka(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  if (v === null || v === undefined) return 0;
  const teks = String(v).trim();
  if (teks === "" || teks === "-") return 0;
  // "-" dan simbol lain ikut tersapu: hanya digit, titik, koma, dan tanda minus yang dihitung.
  const bersihAngka = teks.replace(/[^\d.,-]/g, "");
  if (bersihAngka === "" || bersihAngka === "-") return 0;
  // Format Indonesia: koma = desimal, titik = ribuan ("1.234,6" -> 1234.6).
  // Bila TIDAK ada koma dan hanya ada satu titik dengan <3 digit di belakangnya ("538.5"),
  // titik itu dibaca desimal -> 538.5. Ekspor asli memakai titik ribuan, jadi kasus ini
  // jarang, tapi harus benar supaya pecahan tidak berubah jadi ribuan.
  const komaIdx = bersihAngka.indexOf(",");
  const titikCount = (bersihAngka.match(/\./g) ?? []).length;
  const titikDesimal = komaIdx < 0 && titikCount === 1 && bersihAngka.length - bersihAngka.indexOf(".") - 1 < 3;
  const n = titikDesimal
    ? Number(bersihAngka)
    : Number(bersihAngka.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Teks sel yang sudah rapi. Sel kosong Shopee kadang berisi "-" — itu juga kosong. */
export function bersih(v: unknown): string {
  if (v === null || v === undefined) return "";
  const teks = String(v).trim();
  return teks === "-" ? "" : teks;
}

/**
 * Bangun peta produk Shopee dari baris mentah ekspor.
 *
 * ATURAN YANG MENGIKAT (dilanggar = laporan omzet per SKU salah diam-diam):
 *   1. Baris 0 header — dilewati. Kolom ditentukan `deteksiKolom` dari header itu.
 *   2. SKU diambil dari kolom `skuVariasi` DULU, baru `skuInduk`.
 *   3. Cocok PERSIS ke master (setelah trim). Nol depan dan awalan `SKU/` TIDAK dibuang —
 *      "1203" dan "001203" adalah dua SKU berbeda; menyamakannya = menempelkan omzet
 *      ke produk yang salah.
 *   4. Pesanan, omzet, dan SELURUH metrik (dilihat/klik/kunjungan/keranjang/tanpaBeli)
 *      HANYA dibaca dari baris induk (kolom kode variasi Shopee kosong).
 *      Baris variasi mengulang angka yang sama, jadi menjumlahkannya melipatgandakan omzet.
 *   5. Satu kodeProduk boleh muncul berkali-kali (model varian) — tidak di-dedup.
 *   6. Kandidat hanya untuk tampilan; hasil pemetaan tidak boleh bergantung padanya.
 */
export function bangunPeta(rows: unknown[][], master: Set<string>, mesin?: KandidatMesin): HasilPeta {
  const baris: BarisPeta[] = [];
  const pertanyaan: PertanyaanPeta[] = [];
  const petaPertanyaan = new Map<string, PertanyaanPeta>();
  const kol = deteksiKolom(rows[0] ?? []);

  // Ringkasan dihitung dari baris induk: total = semua produk, terpetakan = yang punya SKU.
  const pesananPerProduk = new Map<string, number>();
  const omzetPerProduk = new Map<string, number>();
  const produkTerpetakan = new Set<string>();

  // Lintasan 1: kumpulkan lebih dulu siapa saja yang PUNYA SKU cocok master.
  // Kenapa harus dua lintasan: baris INDUK selalu datang SEBELUM baris variasinya di file,
  // dan baris induk itu kosong ketiga kolom SKU-nya. Kalau keputusan "ini perlu ditanya?"
  // diambil sambil jalan, setiap produk akan ditanyakan dari baris induknya padahal SKU-nya
  // ada di baris variasi di bawahnya. Hasilnya ratusan pertanyaan palsu.
  const terpetakanAwal = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const kodeProduk = bersih(row[kol.kodeProduk]);
    if (kodeProduk === "") continue;
    const sv = bersih(row[kol.skuVariasi]);
    const si = bersih(row[kol.skuInduk]);
    const s = sv !== "" ? sv : si;
    if (s !== "" && master.has(s)) terpetakanAwal.add(kodeProduk);
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const kodeProduk = bersih(row[kol.kodeProduk]);
    if (kodeProduk === "") continue;

    const namaShopee = bersih(row[kol.produk]);
    const kodeVariasiShopee = bersih(row[kol.kodeVariasiShopee]);
    const variasi = bersih(row[kol.namaVariasi]) || null;
    const iniInduk = kodeVariasiShopee === "";

    // Angka hanya sah di baris induk — lihat aturan 4.
    if (iniInduk) {
      const pesanan = bacaAngka(row[kol.pesanan]);
      const omzet = bacaAngka(row[kol.omzet]);
      pesananPerProduk.set(kodeProduk, (pesananPerProduk.get(kodeProduk) ?? 0) + pesanan);
      omzetPerProduk.set(kodeProduk, (omzetPerProduk.get(kodeProduk) ?? 0) + omzet);
    }

    // Aturan 2: SKU variasi menang atas SKU induk.
    const skuVariasi = bersih(row[kol.skuVariasi]);
    const skuInduk = bersih(row[kol.skuInduk]);
    const sku = skuVariasi !== "" ? skuVariasi : skuInduk;
    const tingkat: "variasi" | "induk" = skuVariasi !== "" ? "variasi" : "induk";

    if (sku !== "" && master.has(sku)) {
      produkTerpetakan.add(kodeProduk);
      baris.push({
        kodeProduk, sku, tingkat, variasi, kodeVariasiShopee: kodeVariasiShopee || null, namaShopee,
        dilihat: iniInduk ? bacaAngka(row[kol.dilihat]) : 0,
        klik: iniInduk ? bacaAngka(row[kol.klik]) : 0,
        kunjungan: iniInduk ? bacaAngka(row[kol.kunjungan]) : 0,
        keranjang: iniInduk ? bacaAngka(row[kol.keranjang]) : 0,
        tanpaBeli: iniInduk ? bacaAngka(row[kol.tanpaBeli]) : 0,
        pesanan: iniInduk ? bacaAngka(row[kol.pesanan]) : 0,
        omzet: iniInduk ? bacaAngka(row[kol.omzet]) : 0,
      });
      continue;
    }

    // Tidak nyambung: dicatat sebagai pertanyaan, bukan ditebak. Bila ada SKU tapi tidak
    // dikenal master -> "sku_tak_ada_master"; bila sama sekali tak ada SKU -> "tanpa_sku".
    //
    // PENTING (perbaikan): baris INDUK hampir selalu kosong ketiga kolomnya — SKU hanya
    // terisi di baris VARIASI. Tanpa penjagaan ini, setiap produk memunculkan pertanyaan
    // "tanpa_sku" dari baris induknya padahal produk itu SUDAH terpetakan lewat baris
    // variasinya: 564 pertanyaan palsu menutupi 22 yang sungguhan.
    // Jadi pertanyaan hanya dibuat bila produk ini memang BELUM punya SKU yang cocok.
    if (terpetakanAwal.has(kodeProduk)) continue;

    const jenis: PertanyaanPeta["jenis"] = sku !== "" ? "sku_tak_ada_master" : "tanpa_sku";
    const pesananBaris = iniInduk ? bacaAngka(row[kol.pesanan]) : 0;
    const omzetBaris = iniInduk ? bacaAngka(row[kol.omzet]) : 0;
    const kunci = `${jenis}|${kodeProduk}`;
    const ada = petaPertanyaan.get(kunci);
    if (ada) {
      // Dedup per (jenis, kodeProduk) — satu produk bisa punya banyak baris variasi.
      ada.pesanan += pesananBaris;
      ada.omzet += omzetBaris;
      continue;
    }
    const baru: PertanyaanPeta = {
      jenis, kodeProduk, namaShopee, variasi,
      pesanan: pesananBaris,
      omzet: omzetBaris,
      // Kandidat murni bantuan mata manusia; maks 5 agar kartu tidak banjir.
      kandidat: mesin ? mesin.cari(namaShopee).slice(0, 5) : [],
    };
    petaPertanyaan.set(kunci, baru);
    pertanyaan.push(baru);
  }

  // Urutkan pertanyaan: yang punya pesanan lebih dulu. Produk tak pernah terjual tetap
  // disertakan (bisa jadi perlu dipetakan nanti), tapi TIDAK boleh menutupi yang penting.
  // Di file nyata: 22 berpesanan vs 485 tak berpesanan — tanpa urutan ini, 22 yang
  // menentukan justru terkubur di bawah ratusan yang tidak mendesak.
  pertanyaan.sort((a, b) => b.pesanan - a.pesanan || b.omzet - a.omzet);

  // "Terpetakan" = omzet/pesanan milik produk yang minimal satu barisnya punya SKU dikenal.
  // Produk yang sama boleh punya baris tak terpetakan juga; yang dihitung tetap seluruh
  // angkanya, karena satu baris cocok sudah cukup membuktikan produk itu ada di master.
  const jumlahTerpetakan = (m: Map<string, number>) =>
    [...produkTerpetakan].reduce((a, kode) => a + (m.get(kode) ?? 0), 0);

  return {
    baris,
    pertanyaan,
    ringkas: {
      kodeProdukTotal: pesananPerProduk.size,
      terpetakan: produkTerpetakan.size,
      pesananTotal: [...pesananPerProduk.values()].reduce((a, x) => a + x, 0),
      pesananTerpetakan: jumlahTerpetakan(pesananPerProduk),
      omzetTotal: [...omzetPerProduk.values()].reduce((a, x) => a + x, 0),
      omzetTerpetakan: jumlahTerpetakan(omzetPerProduk),
    },
  };
}
