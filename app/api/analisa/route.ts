// app/api/analisa/route.ts — Analisa produk (cepat + mendalam).
//
// GET  ?aksi=preset                      → daftar preset + tanggal snapshot tersedia
// GET  ?aksi=cepat&presetId=&tanggal=    → analisa cepat (angka murni, tanpa AI)
// GET  ?aksi=saran-iklan&presetId=&tanggal= → ROAS titik impas + urutan prioritas
// GET  ?aksi=estimasi-iklan&presetId=&items=sku:modal:target,… → estimasi per SKU (angka murni)
// GET  ?aksi=model-analisa                → model yang AKAN dipakai analisa + provider yang dilewati
// GET  ?aksi=tren&presetId=&tanggal=&rentang=7|14|30 → seri harian, delta, per jam, komposisi biaya, produk
// GET  ?aksi=detail-produk&presetId=&periode=&pembanding= → funnel, organik vs iklan, bucket, ranking SKU
// POST { aksi:'mendalam', ... }          → narasi AI; presetId/tanggal kosong = snapshot terakhir
// POST { aksi:'saran-iklan-stream', ... } → paket skenario iklan + narasi bertahap (text/event-stream)
//
// KEPERCAYAAN: `aksi=mendalam` TIDAK membaca blok konteks dari body. Angka yang masuk prompt
// dihitung ulang di server dari DB untuk preset/tanggal yang diminta — body klien bisa diubah
// siapa pun yang punya sesi, jadi angka kiriman browser tidak boleh dipakai sebagai "sudah
// dihitung sistem". Hanya modal/target/hariKe (asumsi yang diisi user) yang datang dari UI.
//
// PRINSIP: angka SELALU dari lib/analisa/hitung.ts. AI tidak pernah menghitung.
// Karena itu endpoint `cepat` tidak menyentuh AI sama sekali.
import { getDb, getEnvAi, getKunciEnkripsi } from "@/lib/d1/db";
import type { RincianSnapshot } from "@/lib/d1/analisa";
import {
  adaPerforma, ambilSnapshot, cakupanData, daftarPeriodePerforma, daftarPresetAnalisa,
  daftarTanggalSnapshot, historiPerSku, iklanHarianPerSku, metrikIklanPerSku, orderPerJam,
  orderPerJamPerTanggal, performaPerSku, performaSemuaSku, petaHppMaster,
  petaStok, snapshotRentang, totalIklanPeriode, trenSkuRentang, volumeSkuRentang,
} from "@/lib/d1/analisa";
import {
  bandingkan, deltaHarian, geserHari, jendelaSebelum, jumlahBiayaJenis, komposisiBiaya,
  komposisiBiayaJenis, ringkasRentang, seriHarian,
  type BarisProdukTren,
} from "@/lib/analisa/tren";
import type { MasukanEstimasi } from "@/lib/analisa/iklanEstimasi";
import { estimasiIklan, ringkasEstimasi } from "@/lib/analisa/iklanEstimasi";
import { ambilSettingAnalisa } from "@/lib/d1/aiAnalisaSetting";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { imporIklan, parseIklan } from "@/lib/d1/adsProduk";
import { petaSkuDariKodeProduk } from "@/lib/d1/shopeePeta";
import { analisaMendalam, susunPesanSkenario, type Kedalaman, type KonteksBahan } from "@/lib/analisa/ai";
import { bangunPaketSkenario } from "@/lib/analisa/skenarioIklan";
import { panggilTeksStream } from "@/lib/ai/provider";
import { ambilPengaturanAI } from "@/lib/d1/pengaturan";
import { ambilKredensial } from "@/lib/d1/aiKredensial";
import type { HasilAnalisa } from "@/lib/analisa/tipe";
import { bahanTren } from "@/lib/analisa/tren";
import {
  analisaCepat, janganDiiklankan, kelasProduk, urutSaranIklan,
  AMBANG_MARGIN_TIPIS, type MasukanAnalisa,
} from "@/lib/analisa/hitung";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rentang tanggal periode: dari tanggal-7 hari sampai tanggal (inklusif). */
function rentangMundur(tanggal: string, hari: number): { dari: string; sampai: string } {
  const d = new Date(`${tanggal}T00:00:00Z`);
  const dari = new Date(d.getTime() - hari * 86400000).toISOString().slice(0, 10);
  return { dari, sampai: tanggal };
}

/**
 * Tanggal `YYYY-MM-DD` menurut WIB. Server berjalan di zona yang tidak dijamin, jadi
 * "hari ini" dihitung eksplisit di Jakarta; memakai jam server membuat cutoff per jam
 * bergeser 7 jam dan hari yang belum selesai ikut dianggap lengkap.
 */
function hariIniWIB(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/**
 * `YYYY-MM-DD` → `{ dari, sampai }` untuk query berbasis tanggal.
 *
 * Periode impor bisa `YYYY-MM-DD` (satu hari) atau `YYYY-MM-DD_YYYY-MM-DD`. Periode yang tidak
 * dikenali tidak boleh mengarang rentang: kedua ujung memakai teksnya apa adanya sehingga query
 * tetap valid dan hasilnya kosong, bukan melebar ke seluruh riwayat.
 */
function pecahPeriode(periode: string): { dari: string; sampai: string } {
  const m = /^(\d{4}-\d{2}-\d{2})(?:_(\d{4}-\d{2}-\d{2}))?$/.exec(periode);
  const dari = m?.[1] ?? periode.slice(0, 10);
  return { dari, sampai: m?.[2] ?? dari };
}

/**
 * Rincian snapshot TERAKHIR yang tanggalnya jatuh di dalam periode: sumber nama/harga/margin.
 * `hari` = jumlah snapshot dalam rentang, dipakai sebagai penyebut laju harian.
 */
async function rincianPeriode(
  db: D1Database,
  presetId: number,
  rentang: { dari: string; sampai: string }
): Promise<{ rincian: Map<string, RincianSnapshot>; hari: number }> {
  const { results } = await db
    .prepare("SELECT tanggal FROM laba_snapshot WHERE preset_id = ? AND tanggal BETWEEN ? AND ?")
    .bind(presetId, rentang.dari, rentang.sampai)
    .all<{ tanggal: string }>()
    .catch(() => ({ results: [] as { tanggal: string }[] }));
  const tanggal = (results ?? []).map((r) => r.tanggal).sort();
  const peta = new Map<string, RincianSnapshot>();
  const terakhir = tanggal[tanggal.length - 1];
  if (terakhir) {
    const snap = await ambilSnapshot(db, presetId, terakhir);
    for (const r of snap?.rincian ?? []) if (r.sku) peta.set(r.sku, r);
  }
  return { rincian: peta, hari: tanggal.length };
}

/** Satu baris performa produk (hasil `performaSemuaSku`). */
type BarisPerforma = {
  dilihat: number; klik: number; kunjungan: number; keranjang: number;
  pesanan: number; omzet: number; tanpaBeli: number;
};

/** Bentuk satu baris ranking Detail Produk (dihitung server, dipakai tabel & top mover). */
type RankDetail = {
  sku: string;
  nama: string | null;
  kunjungan: number | null;
  keranjang: number | null;
  pesanan: number | null;
  cr: number | null;
  omzet: number | null;
  terjual: number;
  stok: number | null;
  hariPersediaan: number | null;
  deltaKunjungan: { selisih: number; persen: number | null } | null;
  status: "fast" | "slow" | "dead" | "normal";
};

/** Urutan = urutan grafik. Label sengaja memuat batasnya supaya tooltip tidak ambigu. */
const BUCKET_STOK = ["0-7 hari", "8-14 hari", "15-30 hari", ">30 hari"] as const;
const BUCKET_CR = ["0%", "0-1%", "1-3%", ">3%"] as const;

/**
 * Rakit seluruh blok `detail-produk` dari masukan D1. Dipisah dari GET supaya bentuk respons
 * terbaca di satu tempat dan tidak ada rumus tersebar di dua cabang.
 *
 * Aturan yang mengikat sama dengan sisa berkas: angka yang tidak terukur = null, bukan 0.
 * Delta & top mover kosong/null tanpa pembanding — itu "belum dibandingkan", bukan "tidak berubah".
 */
function hitungDetailProduk(m: {
  performaSekarang: Map<string, BarisPerforma>;
  performaBanding: Map<string, BarisPerforma> | null;
  iklanSekarang: Map<string, { dilihat: number; klik: number; biaya: number; omzet: number }>;
  rincian: { rincian: Map<string, RincianSnapshot>; hari: number };
  stok: Map<string, number> | null;
  volSekarang: Map<string, { qty: number }>;
}) {
  const { performaSekarang: pNow, performaBanding: pOld, iklanSekarang, stok } = m;
  const bulat = (nilai: number, desimal = 0) => Math.round(nilai * 10 ** desimal) / 10 ** desimal;

  // Jumlahkan satu metrik; null bila periode itu TIDAK punya baris performa — menjumlah nol
  // baris menjadi 0 berbohong "tidak ada kunjungan".
  const jumlah = <T,>(peta: Map<string, T> | null, pilih: (p: T) => number): number | null => {
    if (!peta || peta.size === 0) return null;
    let a = 0;
    for (const p of peta.values()) a += pilih(p);
    return a;
  };

  // ── Ringkas ──
  const dilihat = jumlah(pNow, (p) => p.dilihat);
  const kunjungan = jumlah(pNow, (p) => p.kunjungan);
  const keranjang = jumlah(pNow, (p) => p.keranjang);
  const pesanan = jumlah(pNow, (p) => p.pesanan);
  const omzet = jumlah(pNow, (p) => p.omzet);
  const cr = (k: number | null, o: number | null) => (k && o !== null ? bulat((o / k) * 100, 2) : null);
  const ringkas = { dilihat, kunjungan, keranjang, pesanan, cr: cr(kunjungan, pesanan), omzet };

  // Delta = null bila salah satu sisi tidak ada. `persen` null bila pembanding 0 (bukan ∞).
  const deltaR = (sekarang: number | null, sebelum: number | null) =>
    sekarang === null || sebelum === null
      ? null
      : {
          selisih: sekarang - sebelum,
          persen: sebelum !== 0 ? bulat(((sekarang - sebelum) / Math.abs(sebelum)) * 100, 1) : null,
        };
  const delta = {
    dilihat: deltaR(dilihat, jumlah(pOld, (p) => p.dilihat)),
    kunjungan: deltaR(kunjungan, jumlah(pOld, (p) => p.kunjungan)),
    keranjang: deltaR(keranjang, jumlah(pOld, (p) => p.keranjang)),
    pesanan: deltaR(pesanan, jumlah(pOld, (p) => p.pesanan)),
    cr: deltaR(cr(kunjungan, pesanan), cr(jumlah(pOld, (p) => p.kunjungan), jumlah(pOld, (p) => p.pesanan))),
    omzet: deltaR(omzet, jumlah(pOld, (p) => p.omzet)),
  };

  // ── Funnel: drop = 100 − tahap÷tahap-sebelumnya×100, null bila tahap sebelumnya 0. ──
  const tahap: [string, number | null][] = [
    ["Dilihat", dilihat], ["Kunjungan", kunjungan], ["Keranjang", keranjang], ["Pesanan", pesanan],
  ];
  const funnel = tahap.map(([nama, nilai], i) => {
    const sebelum = i > 0 ? tahap[i - 1][1] : null;
    return {
      tahap: nama,
      nilai,
      dropPersen: nilai === null || !sebelum ? null : bulat((1 - nilai / sebelum) * 100, 1),
    };
  });

  // ── Organik vs iklan. Klik iklan = kunjungan berbayar; organik = sisa kunjungan. ──
  // Pesanan per sumber tetap null: Performa Produk tidak memisahkan organik/iklan dan data
  // iklan tidak memuat pesanan. Membagi total secara proporsional hanya angka karangan.
  const adaIklan = iklanSekarang.size > 0;
  const klikIklan = adaIklan ? jumlah(iklanSekarang, (x) => x.klik) : null;
  const omzetIklan = adaIklan ? jumlah(iklanSekarang, (x) => x.omzet) : null;
  const organikVsIklan = {
    organik: {
      kunjungan: kunjungan !== null && klikIklan !== null ? Math.max(0, kunjungan - klikIklan) : null,
      pesanan: null as number | null,
      cr: null as number | null,
      omzet: omzet !== null && omzetIklan !== null ? Math.max(0, omzet - omzetIklan) : null,
    },
    iklan: { kunjungan: klikIklan, pesanan: null as number | null, cr: null as number | null, omzet: omzetIklan },
    keterbatasan:
      "Pesanan per sumber tidak tersedia: ekspor Performa Produk tidak memisahkan organik dan iklan, " +
      "dan data iklan tidak memuat pesanan. Omzet iklan diambil dari data iklan.",
  };

  // ── Ranking. Laju harian dibagi hari BERDATA (min. 1): periode 2 minggu dengan satu snapshot
  // bukan laju 2 minggu, dan membaginya dengan panjang kalender membuat semua SKU tampak lambat. ──
  const hariData = Math.max(1, m.rincian.hari);
  const skuSet = new Set<string>([
    ...pNow.keys(), ...m.rincian.rincian.keys(), ...m.volSekarang.keys(),
  ]);
  const laju = new Map<string, number>();
  for (const sku of skuSet) laju.set(sku, (m.volSekarang.get(sku)?.qty ?? 0) / hariData);
  const berterjual = [...skuSet].filter((sku) => (m.volSekarang.get(sku)?.qty ?? 0) > 0);
  const rataLaju = berterjual.length
    ? berterjual.reduce((a, sku) => a + (laju.get(sku) ?? 0), 0) / berterjual.length
    : null;

  const ranking: RankDetail[] = [...skuSet].map((sku) => {
    const p = pNow.get(sku) ?? null;
    const pb = pOld?.get(sku) ?? null;
    const stokSku = stok ? (stok.get(sku) ?? 0) : null;
    const terjual = m.volSekarang.get(sku)?.qty ?? 0;
    const lajuHarian = laju.get(sku) ?? 0;
    // Satu definisi untuk kedua tab (lib/analisa/hitung.ts `kelasProduk`): dulu tab ini dan
    // tab tren punya salinan sendiri dan memberi label berbeda untuk SKU yang sama.
    const status: RankDetail["status"] = kelasProduk({ terjual, lajuHarian, stok: stokSku, rataLaju });
    return {
      sku,
      nama: m.rincian.rincian.get(sku)?.nama ?? null,
      kunjungan: p ? p.kunjungan : null,
      keranjang: p ? p.keranjang : null,
      pesanan: p ? p.pesanan : null,
      cr: p ? cr(p.kunjungan, p.pesanan) : null,
      omzet: p ? p.omzet : null,
      terjual,
      stok: stokSku,
      hariPersediaan: stokSku !== null && lajuHarian > 0 ? bulat(stokSku / lajuHarian, 1) : null,
      deltaKunjungan: p && pb
        ? {
            selisih: p.kunjungan - pb.kunjungan,
            persen: pb.kunjungan !== 0 ? bulat(((p.kunjungan - pb.kunjungan) / Math.abs(pb.kunjungan)) * 100, 1) : null,
          }
        : null,
      status,
    };
  }).sort((a, b) => (b.kunjungan ?? -1) - (a.kunjungan ?? -1) || a.sku.localeCompare(b.sku));

  // ── Bucket. SKU tanpa stok/laju/CR tidak masuk bucket mana pun: memasukkan ke "0-7 hari"
  // mengklaim barang hampir habis, padahal datanya tidak diketahui. ──
  const bucketStok = BUCKET_STOK.map((label) => ({ label, jumlah: 0 }));
  for (const r of ranking) {
    const h = r.hariPersediaan;
    if (h === null) continue;
    bucketStok[h <= 7 ? 0 : h <= 14 ? 1 : h <= 30 ? 2 : 3].jumlah += 1;
  }
  const bucketCr = BUCKET_CR.map((label) => ({ label, jumlah: 0 }));
  for (const r of ranking) {
    const v = r.cr;
    if (v === null) continue;
    bucketCr[v === 0 ? 0 : v <= 1 ? 1 : v <= 3 ? 2 : 3].jumlah += 1;
  }

  // ── Top mover: hanya yang punya delta persen (pembanding > 0). SKU baru tanpa pembanding
  // tidak boleh muncul sebagai kenaikan "tak terhingga". ──
  const mover = ranking
    .filter((r) => r.deltaKunjungan?.persen != null)
    .sort((a, b) => (b.deltaKunjungan?.persen ?? 0) - (a.deltaKunjungan?.persen ?? 0));
  const topMover = {
    naik: mover.filter((r) => (r.deltaKunjungan?.selisih ?? 0) > 0).slice(0, 5),
    turun: mover.filter((r) => (r.deltaKunjungan?.selisih ?? 0) < 0).reverse().slice(0, 5),
  };

  return { ringkas, delta, funnel, organikVsIklan, bucketStok, bucketCr, ranking, topMover };
}

/** Kedalaman narasi AI dari permintaan; tak dikenal/kosong = "sedang" (perilaku lama). */
function bacaKedalaman(v: unknown): Kedalaman {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "ringkas" || t === "panjang" ? t : "sedang";
}

/**
 * Hitung seluruh blok `tren` dari D1: seri harian, pembanding, per jam, klasifikasi produk.
 *
 * Dipakai GET `aksi=tren` DAN `aksi=mendalam`. Jalur AI TIDAK menerima blok konteks dari body
 * klien: angka yang masuk prompt harus berasal dari DB lewat fungsi ini, supaya label "dihitung
 * sistem" di prompt benar-benar bisa dipertanggungjawabkan. Satu fungsi = satu rumus untuk
 * layar dan untuk prompt.
 */
async function hitungTren(
  db: D1Database,
  idPreset: number,
  ujung: string,
  rentang: number,
  /**
   * Batas awal eksplisit. Bila diisi, `rentang` diabaikan untuk penentuan jendela dan
   * dihitung ulang dari selisih tanggal — supaya dua parameter tidak bisa saling
   * bertentangan (jendela 30 hari dengan `dari` 3 hari lalu menghasilkan pembanding 30 hari).
   */
  dariMinta?: string | null
) {
  // `dari` inklusif: 7 hari berarti ujung + 6 hari sebelumnya (7 titik, bukan 8).
  const dari = dariMinta ?? geserHari(ujung, -(rentang - 1));
  // Panjang jendela SEBENARNYA, dipakai sebagai lebar jendela pembanding. Menghitung dari
  // tanggal (bukan dari parameter) membuat pembanding selalu sepanjang jendela yang tampil.
  const panjang = Math.max(1, Math.round(
    (Date.parse(`${ujung}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / 86400000
  ) + 1);

  const sebelum = jendelaSebelum(dari, panjang);
  const [snapSekarang, snapSebelum, semuaTanggal, stok, cakupan] = await Promise.all([
    snapshotRentang(db, idPreset, dari, ujung),
    snapshotRentang(db, idPreset, sebelum.dari, sebelum.sampai),
    daftarTanggalSnapshot(db, idPreset, 200),
    petaStok(db),
    cakupanData(db, idPreset, dari, ujung),
  ]);

  const seri = seriHarian(snapSekarang, dari, ujung);
  const ringkas = ringkasRentang(seri);
  const bandingPeriode = bandingkan(seri, seriHarian(snapSebelum, sebelum.dari, sebelum.sampai), {
    tanggalAcuan: sebelum.dari, hari: panjang,
  });

  // Per jam hanya dari hari yang snapshot-nya ADA dan sudah lewat 2 hari: hari berjalan
  // masih menerima pesanan, jadi kurvanya akan tampak turun di jam terakhir — bukan
  // karena penjualan sepi, tetapi karena harinya belum selesai.
  const tanggalPerJam = snapSekarang
    .map((s) => s.tanggal)
    .filter((t) => t < geserHari(hariIniWIB(), -1));
  const perJam = await orderPerJam(db, idPreset, tanggalPerJam);
  // Seri per jam TERPISAH per tanggal: profil gabungan menyembunyikan hari yang jatuh.
  const perJamPerTanggal = await orderPerJamPerTanggal(db, idPreset, tanggalPerJam);

  const hariBerdata = Math.max(1, semuaTanggal.filter((t) => t >= dari && t <= ujung).length);
  // Nama produk diambil dari rincian snapshot TERAKHIR di rentang (bukan semua snapshot):
  // rincian_json hanya sumber nama yang tersedia di sini, dan snapshot terbaru yang
  // paling mungkin masih memuat SKU yang dijual sekarang.
  const snapshotTerakhir = snapSekarang.at(-1);
  const rincianTerakhir = snapshotTerakhir ? await ambilSnapshot(db, idPreset, snapshotTerakhir.tanggal) : null;
  const namaSku = new Map<string, string>();
  for (const r of rincianTerakhir?.rincian ?? []) {
    const nama = String(r.nama ?? "").trim();
    if (nama !== "" && !namaSku.has(r.sku)) namaSku.set(r.sku, nama);
  }
  // Produk: qty dari order NYATA, laju dibagi jumlah hari yang benar-benar punya snapshot di
  // rentang (bukan `rentang`), supaya SKU tidak tampak lambat hanya karena setengah rentang
  // belum diimpor. Qty dibatasi ke SKU yang lolos snapshot supaya sebanding dengan omzet.
  const volumeMentah = await volumeSkuRentang(db, idPreset, dari, ujung);
  const skuSnapshot = new Set((rincianTerakhir?.rincian ?? []).map((r) => r.sku));
  const volume = new Map([...volumeMentah].filter(([sku]) => skuSnapshot.has(sku)));
  // Dilaporkan, bukan disembunyikan: SKU terjual yang ditolak hitung laba tidak muncul di panel.
  const skuDikecualikan = volumeMentah.size - volume.size;
  // Rata-rata laju hanya dari SKU yang BERGERAK: memasukkan SKU mati ke rata-rata akan
  // menurunkan ambang "fast" sampai hampir semua SKU tampak laku — persis yang ingin
  // dideteksi panel ini.
  const skuBergerak = [...volume.values()].filter((v) => v.qty > 0);
  const rataLaju = skuBergerak.length > 0
    ? skuBergerak.reduce((a, v) => a + v.qty / hariBerdata, 0) / skuBergerak.length
    : 0;

  // Gabungan SKU terjual + SKU berstok: SKU yang stoknya ada tetapi tidak pernah terjual
  // justru target utama panel dead stock.
  const daftarSku = new Set<string>([...volume.keys(), ...(stok?.keys() ?? [])]);
  // Cadangan: master produk. `rincian_json` bisa kosong (snapshot lama / hasil impor yang
  // rinciannya dibuang), dan tabel produk tetap punya nama yang dipakai halaman lain.
  const tanpaNama = [...daftarSku].filter((sku) => !namaSku.has(sku));
  if (tanpaNama.length > 0) {
    // D1 membatasi jumlah parameter per query: potong per 90 (gaya sama dengan petaHppMaster).
    for (let i = 0; i < tanpaNama.length; i += 90) {
      const bagian = tanpaNama.slice(i, i + 90);
      const jawab = await db
        .prepare(`SELECT sku, nama_accurate FROM products WHERE sku IN (${bagian.map(() => "?").join(",")})`)
        .bind(...bagian)
        .all<{ sku: string; nama_accurate: string | null }>()
        .catch(() => null);
      for (const m of jawab?.results ?? []) {
        const nama = String(m.nama_accurate ?? "").trim();
        if (nama !== "") namaSku.set(m.sku, nama);
      }
    }
  }

  const produk: BarisProdukTren[] = [...daftarSku].map((sku) => {
    const qty = volume.get(sku)?.qty ?? 0;
    const lajuHarian = qty / hariBerdata;
    // Stok null = data gudang tidak ada (petaStok null), BUKAN stok nol. Hari persediaan
    // pun ikut null supaya tidak tampil "habis besok" untuk data yang tak diketahui.
    const sisa = stok === null ? null : (stok.get(sku) ?? 0);
    // Definisi dari `kelasProduk` (satu sumber dengan tab Detail Produk). Panel ini hanya punya
    // tiga label, jadi "normal" digabung ke "slow" — sama seperti perilaku sebelumnya, tetapi
    // batas dead/fast tidak lagi disalin di dua tempat.
    const kelasPenuh = kelasProduk({ terjual: qty, lajuHarian, stok: sisa, rataLaju });
    const kelas: "fast" | "slow" | "dead" = kelasPenuh === "normal" ? "slow" : kelasPenuh;
    return {
      sku,
      nama: namaSku.get(sku) ?? null,
      qty,
      lajuHarian: Math.round(lajuHarian * 100) / 100,
      stok: sisa,
      hariPersediaan: sisa === null || lajuHarian <= 0 ? null : Math.round(sisa / lajuHarian),
      kelas,
    };
  });
  // Urut qty turun: tabel 20 baris pertama harus berisi SKU yang paling berpengaruh,
  // bukan urutan alfabetis kunci Map yang tidak berarti bagi pemilik toko.
  produk.sort((a, b) => b.qty - a.qty || a.sku.localeCompare(b.sku));

  return {
    dari,
    sampai: ujung,
    rentang: panjang,
    seri,
    ringkas,
    bandingPeriode,
    perJam,
    perJamPerTanggal,
    deltaHarian: deltaHarian(seri),
    tanggalDipakai: tanggalPerJam,
    komposisiBiaya: komposisiBiaya(ringkas),
    // Pecahan per jenis: kosong untuk snapshot lama → UI jatuh ke `komposisiBiaya` dan
    // menyatakan rinciannya belum tersedia, bukan menampilkan tiga kelompok sebagai pecahan.
    komposisiJenis: komposisiBiayaJenis(jumlahBiayaJenis(seri), ringkas),
    cakupan: {
      hariRentang: cakupan.hariRentang,
      hariSnapshot: cakupan.hariSnapshot,
      hariIklan: cakupan.hariIklan,
      periodePerforma: cakupan.periodePerforma,
      adaStok: cakupan.adaStok,
    },
    // Bahan teks untuk analisa mendalam: dihitung di sini (sumber angka SAMA) dan
    // ditampilkan di UI supaya pengguna bisa memeriksa angka yang dibaca AI.
    bahanAi: bahanTren({ seri, ringkas, bandingPeriode, perJam, produk }),
    produk,
    hariBerdata,
    skuDikecualikan,
  };
}

/**
 * Preset/tanggal untuk `aksi=mendalam`.
 *
 * Body klien hanya menentukan PERIODE yang ingin dibahas; angka tetap dihitung server. Bila
 * salah satunya tidak dikirim, periode diambil dari snapshot TERAKHIR (preset yang diminta,
 * atau preset pertama yang punya data) — supaya klien lama yang tidak mengirim periode tetap
 * mendapat analisa yang sah, bukan error. Nilai yang dikirim tetapi bentuknya salah tetap
 * ditolak: menebak arti "31-12-2026" akan menghasilkan analisa untuk periode yang salah.
 */
async function presetTanggalAnalisa(
  db: D1Database,
  presetIdMentah: unknown,
  tanggalMentah: unknown
): Promise<{ ok: true; presetId: number; tanggal: string } | { ok: false; error: string }> {
  const presetTeks = String(presetIdMentah ?? "").trim();
  const tanggalTeks = String(tanggalMentah ?? "").trim();
  let presetId = 0;
  if (presetTeks !== "") {
    presetId = Number(presetTeks);
    if (!Number.isInteger(presetId) || presetId <= 0) return { ok: false, error: "presetId wajib diisi." };
  }
  if (tanggalTeks !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(tanggalTeks)) {
    return { ok: false, error: "Tanggal harus YYYY-MM-DD." };
  }
  if (presetId > 0 && tanggalTeks !== "") return { ok: true, presetId, tanggal: tanggalTeks };

  const kandidat = presetId > 0 ? [presetId] : (await daftarPresetAnalisa(db)).map((p) => p.id);
  for (const id of kandidat) {
    const [terakhir] = await daftarTanggalSnapshot(db, id, 1);
    if (terakhir) return { ok: true, presetId: id, tanggal: terakhir };
  }
  return { ok: false, error: "Belum ada snapshot laba. Impor file laba dulu di halaman Laba." };
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi") ?? "preset";
  const db = getDb();

  // Murni BACA (tanpa AI, tanpa panggilan provider): user harus tahu model mana yang akan
  // berjalan SEBELUM menekan tombol analisa — katalog tidak menyimpan harga, jadi satu-satunya
  // pengaman biaya adalah user memilih modelnya sendiri lebih dulu.
  if (aksi === "model-analisa") {
    const set = await ambilPengaturanAI(db, getEnvAi());
    // Rantai efektif = `chainTeks`, dengan cadangan `textProvider` bila rantai kosong —
    // SAMA dengan yang dipakai `kandidatTeks` di lib/ai/provider.ts. Isinya sudah disaring
    // `bersihkanChain` (hanya provider sah), jadi tidak disaring ulang di sini.
    const rantai = set.chainTeks.length > 0 ? set.chainTeks : [set.textProvider || "groq"];
    const kunci = getKunciEnkripsi();
    const chain: { provider: string; modelDipilih: string | null; siap: boolean }[] = [];
    for (const provider of rantai) {
      const modelDipilih = String(set.modelTeks[provider] ?? "").trim() || null;
      // Kredensial diperiksa HANYA untuk provider yang sudah punya pilihan: tanpa pilihan,
      // provider itu pasti dilewati analisa (lib/ai/provider.ts `kandidatHanyaDipilih`), dan
      // mendekripsi kredensial provider yang tidak akan dipakai cuma membuang kerja.
      const kred = modelDipilih && kunci ? await ambilKredensial(db, provider, kunci) : null;
      // Yang diuji adalah model YANG DIPILIH USER ada dan aktif — BUKAN "provider punya model
      // berjenis teks". Katalog menandai banyak model yang sah untuk teks sebagai `vision`
      // (mis. `deepseek-v4-1-flash`, dan muse-spark), jadi menuntut `jenis='teks'` membuat
      // analisa MUSTAHIL dijalankan walau pilihan user benar. Analisa sendiri tidak menyaring
      // jenis (`kandidatHanyaDipilih` memakai pilihan user apa adanya), jadi gate di sini harus
      // memakai ukuran yang sama — kalau tidak, tombolnya mati sementara backendnya siap.
      const adaDipilih = modelDipilih
        ? !!(await db
            .prepare("SELECT 1 AS ada FROM ai_model WHERE provider = ? AND model_id = ? AND aktif = 1")
            .bind(provider, modelDipilih)
            .first<{ ada: number }>())
        : false;
      const siap = !!modelDipilih && !!kred?.plaintext && adaDipilih;
      chain.push({ provider, modelDipilih, siap });
    }
    return json({ ok: true, chain, siapTotal: chain.some((c) => c.siap) });
  }

  if (aksi === "detail-produk") {
    // Detail per periode impor Performa Produk: funnel, organik vs iklan, bucket, ranking SKU.
    // Seluruh rumus ada di sini (bukan di komponen) supaya tabel dan grafik dialog selalu
    // berasal dari satu perhitungan, dan agar null tetap null sampai dirender.
    const idPreset = Number(url.searchParams.get("presetId"));
    if (!Number.isInteger(idPreset) || idPreset <= 0) {
      return json({ ok: false, error: "presetId wajib diisi." }, 400);
    }
    const periodeTersedia = await daftarPeriodePerforma(db, idPreset);
    // Tanpa `periode`: balas daftar pilihan saja. Menghitung blok penuh tanpa periode berarti
    // memilih periode diam-diam untuk user.
    const dimintaPeriode = (url.searchParams.get("periode") ?? "").trim();
    if (dimintaPeriode === "") return json({ ok: true, periode: periodeTersedia });

    const pembandingDiminta = (url.searchParams.get("pembanding") ?? "").trim();
    // Pembanding harus periode yang benar-benar ada; periode asing hanya membuat semua delta
    // null tanpa sebab yang terlihat, jadi diperlakukan seperti "tanpa pembanding".
    const pembanding =
      pembandingDiminta !== "" && pembandingDiminta !== dimintaPeriode && periodeTersedia.includes(pembandingDiminta)
        ? pembandingDiminta
        : null;

    const rentangSekarang = pecahPeriode(dimintaPeriode);

    const [performaSekarang, rincian, performaBanding, stok] = await Promise.all([
      performaSemuaSku(db, idPreset, dimintaPeriode),
      // Rincian snapshot hanya untuk nama/harga/margin. Daftar SKU TIDAK berasal dari sini:
      // SKU tanpa penjualan (dead stock) juga wajib muncul di ranking.
      rincianPeriode(db, idPreset, rentangSekarang),
      pembanding ? performaSemuaSku(db, idPreset, pembanding) : Promise.resolve(null),
      petaStok(db),
    ]);
    // Qty dibatasi ke SKU yang LOLOS snapshot: snapshot hanya memuat SKU yang menghasilkan laba,
    // sedangkan qty dari order mencakup semua. Mencampur keduanya membuat omzet dan qty di
    // halaman yang sama berasal dari populasi berbeda (ROAS/CR SKU jadi tidak sebanding).
    // Penyaringan dilakukan di sini (bukan lewat argumen `skuSah`) supaya jumlah SKU yang
    // dikecualikan bisa DILAPORKAN, bukan hilang diam-diam.
    const volMentah = await volumeSkuRentang(db, idPreset, rentangSekarang.dari, rentangSekarang.sampai);
    const volSekarang = new Map([...volMentah].filter(([sku]) => rincian.rincian.has(sku)));
    const skuDikecualikan = volMentah.size - volSekarang.size;
    // Metrik iklan PERIODE PEMBANDING sengaja tidak diambil: hanya iklan periode ini yang
    // dipakai (organik vs iklan), dan tidak ada blok yang membandingkan biaya antar periode.
    const iklanSekarang = await metrikIklanPerSku(db, idPreset, rentangSekarang.dari, rentangSekarang.sampai);
    // Sparkline per SKU: unit terjual tiap tanggal dalam periode ini. Diambil terpisah karena
    // hanya dipakai tabel ranking — memasukkan ke `hitungDetailProduk` akan membuat fungsi
    // murni itu bergantung pada bentuk JSON snapshot.
    const tren = await trenSkuRentang(db, idPreset, rentangSekarang.dari, rentangSekarang.sampai);

    const hasil = hitungDetailProduk({ performaSekarang, performaBanding, iklanSekarang, rincian, stok, volSekarang });
    return json({
      ok: true,
      periode: periodeTersedia,
      dipakai: dimintaPeriode,
      pembanding,
      skuDikecualikan,
      tanggalTren: tren.tanggal,
      ...hasil,
      // Deret ditempelkan SETELAH perhitungan supaya `hitungDetailProduk` tetap murni dan
      // tidak perlu tahu bentuk JSON snapshot. SKU tanpa deret tetap mendapat null, bukan
      // deret nol — bedanya "tidak diimpor" dan "tidak terjual".
      ranking: hasil.ranking.map((r) => ({ ...r, trenSku: tren.perSku.get(r.sku) ?? null })),
    });
  }

  if (aksi === "detail-sku-iklan") {
    // Data dialog Detail Produk: riwayat iklan HARIAN satu SKU pada satu periode.
    // Dihitung di sini dan bukan dikirim bersama ranking karena hanya satu SKU yang dibuka,
    // sedangkan ranking bisa ratusan baris — menggabungkannya membesarkan payload tanpa guna.
    const idPreset = Number(url.searchParams.get("presetId"));
    if (!Number.isInteger(idPreset) || idPreset <= 0) {
      return json({ ok: false, error: "presetId wajib diisi." }, 400);
    }
    const sku = (url.searchParams.get("sku") ?? "").trim();
    if (sku === "") return json({ ok: false, error: "sku wajib diisi." }, 400);
    const periode = (url.searchParams.get("periode") ?? "").trim();
    if (periode === "" || periode === "legacy") {
      return json({ ok: false, error: "periode wajib diisi." }, 400);
    }
    const { dari, sampai } = pecahPeriode(periode);
    return json({ ok: true, sku, baris: await iklanHarianPerSku(db, idPreset, sku, dari, sampai) });
  }

  if (aksi === "estimasi-iklan") {
    // Dihitung dari histori per SKU (lib/d1) + lib/analisa/iklanEstimasi (murni).
    // Sengaja SEBELUM validasi tanggal: estimasi ini per SKU, bukan per tanggal.
    const idPreset = Number(url.searchParams.get("presetId"));
    if (!Number.isInteger(idPreset) || idPreset <= 0) {
      return json({ ok: false, error: "presetId wajib diisi." }, 400);
    }
    const histori = await historiPerSku(db, idPreset);

    // `items` = "sku:modal:target" dipisah koma. Tiap SKU punya modal & target sendiri,
    // jadi tidak bisa dikirim lewat parameter bersama tanpa mencampur biaya antar SKU.
    const mentah = (url.searchParams.get("items") ?? "").trim();
    if (mentah === "") {
      // Belum ada pilihan → balas daftar SKU yang PUNYA histori supaya UI bisa menawarkan.
      const tersedia = [...histori.entries()]
        .map(([sku, hari]) => ({ sku, jmlHari: hari.length }))
        .sort((a, b) => a.sku.localeCompare(b.sku));
      return json({ ok: true, items: [], baris: [], tersedia });
    }

    const diminta: MasukanEstimasi[] = [];
    for (const potong of mentah.split(",")) {
      const [skuMentah, modalMentah, targetMentah] = potong.split(":");
      const sku = (skuMentah ?? "").trim();
      if (sku === "") continue; // potongan rusak dilewati, bukan membatalkan seluruh permintaan
      const modalIklan = Number((modalMentah ?? "").trim() || 0);
      const targetRoas = Number((targetMentah ?? "").trim() || 0);
      diminta.push({
        sku,
        nama: null,
        histori: histori.get(sku) ?? [],
        modalIklan: Number.isFinite(modalIklan) && modalIklan > 0 ? modalIklan : 0,
        targetRoas: Number.isFinite(targetRoas) && targetRoas > 0 ? targetRoas : 0,
      });
    }

    const hppMaster = await petaHppMaster(db, diminta.map((d) => d.sku));
    const baris = diminta.map((d) =>
      estimasiIklan({ ...d, hppMaster: hppMaster.get(d.sku) ?? null })
    );
    return json({ ok: true, baris, ringkas: ringkasEstimasi(baris) });
  }

  if (aksi === "tren") {
    // Rentang grafik harian + pembanding + per jam + klasifikasi produk. SELURUH rumusnya
    // ada di lib/analisa/tren.ts (murni, teruji); route ini hanya merakit masukan D1.
    const idPreset = Number(url.searchParams.get("presetId"));
    if (!Number.isInteger(idPreset) || idPreset <= 0) {
      return json({ ok: false, error: "presetId wajib diisi." }, 400);
    }
    const ujung = (url.searchParams.get("tanggal") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ujung)) {
      return json({ ok: false, error: "Tanggal harus YYYY-MM-DD." }, 400);
    }
    // Rentang: `dari`+`sampai` bebas, atau `rentang` 1/3/7/14/30. `dari` eksplisit menang
    // karena user yang mengetik tanggal tidak boleh diam-diam diabaikan.
    const dariMinta = (url.searchParams.get("dari") ?? "").trim();
    const dariSah = /^\d{4}-\d{2}-\d{2}$/.test(dariMinta) && dariMinta <= ujung ? dariMinta : null;
    const minta = Number(url.searchParams.get("rentang"));
    // 1 dan 3 ditambahkan: "hari ini saja" dan "3 hari" adalah pertanyaan yang sah dan
    // sebelumnya tidak bisa dijawab halaman ini sama sekali. Nilai lain jatuh ke 7 supaya
    // parameter rusak tidak diam-diam memanjangkan rentang.
    const rentang = minta === 1 || minta === 3 || minta === 14 || minta === 30 ? minta : 7;
    // Seluruh perhitungan ada di `hitungTren` — dipakai bersama jalur AI supaya angka di
    // layar dan angka di prompt tidak pernah berasal dari dua rumus berbeda.
    return json({ ok: true, ...(await hitungTren(db, idPreset, ujung, rentang, dariSah)) });
  }

  if (aksi === "preset") {
    const preset = await daftarPresetAnalisa(db);
    // Tanggal dikembalikan PER PRESET, bukan hanya untuk preset pertama. Snapshot tidak
    // selalu ada di preset pertama (di produksi: preset 1 kosong, preset 2 punya 3 snapshot),
    // dan mengasumsikan preset pertama membuat halaman tampil kosong padahal datanya ada.
    const petaTanggal: Record<string, string[]> = {};
    for (const p of preset) {
      // 200 = batas maksimum `daftarTanggalSnapshot`: daftar tanggal yang terpotong membuat
      // periode lama tidak bisa dipilih sama sekali, bukan sekadar tampil lebih sedikit.
      petaTanggal[String(p.id)] = await daftarTanggalSnapshot(db, p.id, 200);
    }
    const pertamaDenganData = preset.find((p) => (petaTanggal[String(p.id)] ?? []).length > 0) ?? preset[0];
    const idAwal = pertamaDenganData?.id ?? 0;
    return json({
      ok: true,
      preset,
      tanggal: idAwal > 0 ? (petaTanggal[String(idAwal)] ?? []) : [],
      presetAwal: idAwal,
      tanggalPerPreset: petaTanggal,
    });
  }

  const presetId = Number(url.searchParams.get("presetId"));
  if (!Number.isInteger(presetId) || presetId <= 0) {
    return json({ ok: false, error: "presetId wajib diisi." }, 400);
  }
  const tanggal = (url.searchParams.get("tanggal") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return json({ ok: false, error: "Tanggal harus YYYY-MM-DD." }, 400);
  }

  const snap = await ambilSnapshot(db, presetId, tanggal);
  if (!snap) {
    return json({ ok: false, error: `Belum ada data laba untuk ${tanggal}. Impor file laba dulu di halaman Laba.` }, 404);
  }

  const semuaTanggal = await daftarTanggalSnapshot(db, presetId, 200);
  const { dari, sampai } = rentangMundur(tanggal, 6);
  const [hppMaster, stok, biayaIklan, performaAda, iklanPerSku, performa] = await Promise.all([
    petaHppMaster(db, snap.rincian.map((r) => r.sku)),
    petaStok(db),
    totalIklanPeriode(db, presetId, dari, sampai),
    adaPerforma(db, presetId),
    metrikIklanPerSku(db, presetId, dari, sampai),
    performaPerSku(db, presetId, tanggal),
  ]);

  const masukan: MasukanAnalisa = {
    presetId,
    periode: tanggal,
    snapshot: {
      jml_order: snap.jml_order, omzet: snap.omzet, hpp: snap.hpp,
      biaya: snap.biaya, pajak: snap.pajak, laba: snap.laba, rincian: snap.rincian,
    },
    hppMaster,
    stok,
    biayaIklan,
    iklanPerSku,
    performaPerSku: performa,
    jmlSnapshot: semuaTanggal.length,
    adaPerforma: performaAda,
  };

  const hasil = analisaCepat(masukan);

  if (aksi === "cepat") {
    return json({ ok: true, ...hasil, tanggalTersedia: semuaTanggal, ambangMarginTipis: AMBANG_MARGIN_TIPIS });
  }

  if (aksi === "saran-iklan") {
    // Batas keras: angka ini TITIK IMPAS dari biaya sendiri, bukan target dari platform.
    // Kalimat keterbatasan dikirim dari server supaya UI tidak bisa lupa menampilkannya.
    const aman = urutSaranIklan(hasil.baris);
    const jangan = janganDiiklankan(hasil.baris);
    return json({
      ok: true,
      aman: aman.slice(0, 50),
      jangan: jangan.slice(0, 50),
      jumlahAman: aman.length,
      jumlahJangan: jangan.length,
      biayaIklan,
      adaBiayaIklan: biayaIklan !== null,
      keterbatasan:
        "Angka ini TITIK IMPAS, dihitung dari biaya toko Anda sendiri (HPP, admin, program, pajak). " +
        "Bukan target yang dijamin menguntungkan. Perilaku setelan iklan Shopee (GMV MAX/AUTO ROAS) " +
        "tidak dapat diverifikasi sistem ini — uji dengan anggaran kecil dan pantau hasilnya " +
        "sebelum menerapkan menyeluruh.",
    });
  }

  return json({ ok: false, error: `Aksi tidak dikenal: ${aksi}` }, 400);
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 5);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const db = getDb();
  const oleh = String(sesi.user.tg_id ?? "");
  const body = await bacaBody(request);
  const aksi = String(body.aksi ?? "").trim();

  if (aksi === "impor-iklan") {
    const presetId = Number(body.presetId);
    if (!Number.isInteger(presetId) || presetId <= 0) {
      return json({ ok: false, error: "presetId wajib diisi." }, 400);
    }
    const teks = String(body.teks ?? "");
    if (!teks.trim()) return json({ ok: false, error: "Isi berkas iklan kosong." }, 400);

    // Peta Kode Produk → SKU dibaca dari `shopee_produk` (hasil impor Performa Produk).
    // Tanpa peta, baris iklan tidak bisa dipastikan milik SKU mana — dan menebak lewat
    // kemiripan nama DILARANG untuk data uang.
    // Kode produk diambil lewat `parseIklan` (bukan split koma) karena nama iklan bisa
    // memuat koma di dalam tanda kutip — split naif akan menggeser kolomnya.
    // SELURUH kode, tanpa potongan. Dulu `slice(0, 500)`: kode ke-501 dan seterusnya
    // dilewati diam-diam, lalu barisnya dihitung sebagai "tanpa peta" — user melihat
    // "banyak baris tanpa peta" padahal petanya ada. `petaSkuDariKodeProduk` sudah memecah
    // query per 90 parameter, jadi jumlah besar aman.
    const kode = [...new Set(parseIklan(teks).baris.map((b) => b.kodeProduk))];
    const petaArr = await petaSkuDariKodeProduk(db, kode);
    // SEMUA SKU per kode, bukan yang pertama: satu kode produk Shopee bisa menaungi beberapa
    // variasi dengan SKU berbeda. Mengambil `daftar[0]` membuat biaya seluruh variasi
    // menumpuk ke satu SKU (ROAS/CR SKU itu salah, total toko tetap benar).
    const peta = new Map<string, string[]>();
    for (const [kp, daftar] of petaArr) {
      if (daftar.length > 0) peta.set(kp, daftar.map((d) => d.sku));
    }

    const h = await imporIklan(db, teks, presetId, oleh, peta);
    return json(h, h.ok ? 200 : h.status);
  }

  if (aksi !== "mendalam" && aksi !== "saran-iklan-stream") {
    return json({ ok: false, error: `Aksi tidak dikenal: ${aksi || "(kosong)"}` }, 400);
  }

  if (aksi === "saran-iklan-stream") {
    // Jalur TERPISAH dari `mendalam`. Lihat komentar alirSaranIklan: pertanyaan "langkah
    // iklan bertahap" butuh prompt skenario, bukan prompt analisa penjualan umum.
    return alirSaranIklan(db, oleh, body, sesi.user.role);
  }

  // Rakit ulang masukan yang SAMA dengan endpoint cepat, supaya AI menerima angka
  // yang persis sama dengan yang dilihat user di halaman. Kalau dihitung terpisah,
  // narasi dan tabel bisa berbeda dan tidak ada yang tahu mana yang benar.
  // Preset/tanggal yang tidak dikirim = "pakai snapshot terakhir". Pemanggil lama yang hanya
  // mengirim `aksi` tetap mendapat analisa yang sah, dan tidak ada lagi tanggal tebakan klien.
  const periode = await presetTanggalAnalisa(db, body.presetId, body.tanggal);
  if (!periode.ok) return json({ ok: false, error: periode.error }, 400);
  const { presetId, tanggal } = periode;
  const snap = await ambilSnapshot(db, presetId, tanggal);
  if (!snap) return json({ ok: false, error: `Belum ada data laba untuk ${tanggal}.` }, 404);

  const semuaTanggal = await daftarTanggalSnapshot(db, presetId, 200);
  const { dari, sampai } = rentangMundur(tanggal, 6);
  const [hppMaster, stok, biayaIklan, performaAda, iklanPerSku, performa] = await Promise.all([
    petaHppMaster(db, snap.rincian.map((r) => r.sku)),
    petaStok(db),
    totalIklanPeriode(db, presetId, dari, sampai),
    adaPerforma(db, presetId),
    metrikIklanPerSku(db, presetId, dari, sampai),
    performaPerSku(db, presetId, tanggal),
  ]);

  const hasil = analisaCepat({
    presetId,
    periode: tanggal,
    snapshot: {
      jml_order: snap.jml_order, omzet: snap.omzet, hpp: snap.hpp,
      biaya: snap.biaya, pajak: snap.pajak, laba: snap.laba, rincian: snap.rincian,
    },
    hppMaster,
    stok,
    biayaIklan,
    iklanPerSku,
    performaPerSku: performa,
    jmlSnapshot: semuaTanggal.length,
    adaPerforma: performaAda,
  });

  // Reasoning + plafon token + kedalaman dari pengaturan PER USER; kosong = default model.
  const setting = await ambilSettingAnalisa(db, oleh);
  const kedalaman = bacaKedalaman(setting.kedalaman);
  // Konteks tren TIDAK diambil dari body: klien bisa mengubahnya, dan angka kiriman browser
  // tidak boleh masuk prompt sebagai "sudah dihitung sistem". Dihitung di sini dari DB untuk
  // preset/tanggal yang benar-benar dipakai — rumus sama dengan `aksi=tren` di layar.
  const konteks: KonteksBahan = (await hitungTren(db, presetId, tanggal, 7)).bahanAi;
  const hasilAi = await analisaMendalam(
    { db, kunci: getKunciEnkripsi(), env: getEnvAi(), role: sesi.user.role },
    hasil,
    {
      reasoning: setting.reasoning,
      maksToken: setting.maks_token,
      kedalaman,
      konteks,
    }
  );
  if (!hasilAi.ok) {
    // `upaya` = daftar provider/model yang dicoba + alasan tiap kegagalan (timeout berapa
    // milidetik, status berapa). Tanpa ini user hanya tahu "gagal" dan tidak bisa membedakan
    // model yang mengantre di sisi penyedia dari kredensial yang salah. Tidak memuat kredensial.
    return json(
      { ok: false, error: hasilAi.error, upaya: hasilAi.upaya ?? [], reasoning: setting.reasoning || "(default model)", kedalaman },
      hasilAi.status
    );
  }

  return json({
    ok: true,
    ...hasilAi.data,
    reasoning: setting.reasoning || "(default model)",
    kedalaman,
  });
}

/**
 * Header balasan SSE untuk SEMUA jalur streaming di berkas ini. Dipakai bersama supaya
 * kontraknya satu, termasuk `X-Accel-Buffering: no` — tanpa itu Cloudflare/proxy menahan
 * potongan dan user baru melihat teks setelah model selesai (keluhan awal streaming).
 *
 * Kesalahan yang terjadi SETELAH header ini terkirim TIDAK bisa lagi mengubah status HTTP,
 * jadi jalur streaming mengirimnya sebagai event `{"error": "..."}` dengan status tetap 200;
 * kalau dibalas status non-200, klien hanya melihat "gagal membaca respons" dan sebab
 * sebenarnya hilang.
 */
const HEADER_SSE = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/**
 * Siapkan angka satu preset/tanggal untuk jalur streaming (`saran-iklan-stream`).
 * Angka WAJIB dihitung di sini, bukan diterima dari body: klien hanya memilih periode.
 * Kesalahan DIKEMBALIKAN sebagai pesan, bukan dilempar: pemanggil harus bisa membalasnya
 * sebagai event `{error}` karena status HTTP sudah terkirim saat stream dimulai.
 */
async function siapkanAnalisa(
  db: D1Database,
  presetId: number,
  tanggal: string
): Promise<{ ok: true; hasil: HasilAnalisa } | { ok: false; error: string }> {
  if (!Number.isInteger(presetId) || presetId <= 0) return { ok: false, error: "presetId wajib diisi." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return { ok: false, error: "Tanggal harus YYYY-MM-DD." };
  const snap = await ambilSnapshot(db, presetId, tanggal);
  if (!snap) return { ok: false, error: `Belum ada data laba untuk ${tanggal}.` };

  const semuaTanggal = await daftarTanggalSnapshot(db, presetId, 200);
  const { dari, sampai } = rentangMundur(tanggal, 6);
  const [hppMaster, stok, biayaIklan, performaAda, iklanPerSku, performa] = await Promise.all([
    petaHppMaster(db, snap.rincian.map((r) => r.sku)),
    petaStok(db),
    totalIklanPeriode(db, presetId, dari, sampai),
    adaPerforma(db, presetId),
    metrikIklanPerSku(db, presetId, dari, sampai),
    performaPerSku(db, presetId, tanggal),
  ]);
  // Angka SAMA dengan aksi `cepat`/`mendalam` — satu sumber hitung, bukan hitung ulang.
  return {
    ok: true,
    hasil: analisaCepat({
      presetId,
      periode: tanggal,
      snapshot: {
        jml_order: snap.jml_order, omzet: snap.omzet, hpp: snap.hpp,
        biaya: snap.biaya, pajak: snap.pajak, laba: snap.laba, rincian: snap.rincian,
      },
      hppMaster,
      stok,
      biayaIklan,
      iklanPerSku,
      performaPerSku: performa,
      jmlSnapshot: semuaTanggal.length,
      adaPerforma: performaAda,
    }),
  };
}

/**
 * Saran langkah iklan sebagai text/event-stream (`aksi=saran-iklan-stream`).
 *
 * KENAPA AKSI INI TERPISAH dari `mendalam` — inilah keluhan pemilik repo: kedua jalur
 * menjawab pertanyaan yang BERBEDA. `mendalam` memakai `PROMPT_SISTEM` (analisa penjualan
 * umum: temuan, konsentrasi laba, prioritas tindakan), sedangkan tombol "Saran Langkah
 * Iklan" menanyakan rencana BERTAHAP per keadaan iklan. Saat tombol itu memakai prompt
 * analisa umum, jawabannya tidak menyambung dengan yang ditanyakan user (di pemakaian
 * nyata: model malah membahas diagram Venn). Karena itu jalur ini memakai
 * `PROMPT_SISTEM_SKENARIO` + `susunPesanSkenario` atas paket dari `bangunPaketSkenario`.
 *
 * Urutan event sengaja begini: `{paket}` dikirim DULU supaya user melihat angka yang
 * dipakai AI (fakta + tiga skenario, sudah dihitung sistem) SEBELUM narasinya datang.
 * Angka tetap milik sistem; AI hanya menarasikan paket itu dan dilarang mengarang angka.
 */
async function alirSaranIklan(
  db: D1Database,
  oleh: string,
  body: Record<string, unknown>,
  role: string
): Promise<Response> {
  const presetId = Number(body.presetId);
  const tanggal = String(body.tanggal ?? "").trim();
  const hariKeDiminta = Number(body.hariKe);
  const modalDiminta = Number(body.modalIklan);
  const targetDiminta = Number(body.targetRoas);
  // `hariKe` 0 menghasilkan "hari ke-0" yang tidak berarti apa-apa di paket maupun judul
  // skenario. Ditolak SEBELUM stream dimulai supaya klien menerima 400 yang jelas, bukan
  // event error di tengah aliran.
  if (body.hariKe !== undefined && body.hariKe !== null && String(body.hariKe).trim() !== ""
      && (!Number.isInteger(hariKeDiminta) || hariKeDiminta < 1)) {
    return json({ ok: false, error: "Hari ke-N minimal 1." }, 400);
  }
  const encoder = new TextEncoder();
  const alir = new ReadableStream<Uint8Array>({
    async start(controller) {
      const kirim = (v: unknown): void => controller.enqueue(encoder.encode(`data: ${JSON.stringify(v)}\n\n`));
      const tutup = (): void => controller.close();
      const galat = (pesan: string): void => {
        kirim({ error: pesan });
        tutup();
      };
      const siap = await siapkanAnalisa(db, presetId, tanggal);
      if (!siap.ok) return galat(siap.error);

      // Angka dari form UI = ASUMSI YANG DIISI USER (modal & target ROAS), bukan hasil
      // hitung sistem; kosong/negatif = 0 supaya paket tetap dibangun dan MENYATAKAN
      // nilainya nol, bukan menebak modal yang tidak diisi user. `hariKe` default 1.
      const hariKe = Number.isInteger(hariKeDiminta) && hariKeDiminta >= 1 ? hariKeDiminta : 1;
      const paket = bangunPaketSkenario({
        hariKe,
        baris: siap.hasil.baris,
        modalIklan: Number.isFinite(modalDiminta) && modalDiminta > 0 ? modalDiminta : 0,
        targetRoas: Number.isFinite(targetDiminta) && targetDiminta > 0 ? targetDiminta : 0,
      });
      // Paket lebih dulu: UI menampilkan fakta + tiga skenario sebelum narasi mengalir.
      kirim({ paket });

      const setting = await ambilSettingAnalisa(db, oleh);
      // Alasan stream berakhir; kosong = provider tidak melaporkannya.
      let selesaiAlasan: string | undefined;
      const aliran = await panggilTeksStream(
        { db, kunci: getKunciEnkripsi(), env: getEnvAi(), role },
        {
          pesan: susunPesanSkenario(paket, hariKe),
          reasoning: setting.reasoning,
          // Teks pikiran diminta terpisah dari narasi (dikirim sebagai event `{pikir}`).
          reasoningHilir: true,
          ...(setting.maks_token !== undefined ? { maksToken: setting.maks_token } : {}),
          // Analisa keuangan: HANYA model yang dipilih user (lihat lib/analisa/ai.ts).
          hanyaModelDipilih: true,
        }
      );
      if (!aliran.ok) return galat(aliran.error);

      try {
        for await (const p of aliran.potongan) {
          if (p.delta) kirim({ delta: p.delta });
          // Pikiran model dikirim terpisah; `{delta}` tetap murni narasi user.
          if (p.pikir) kirim({ pikir: p.pikir });
          if (p.selesaiAlasan) selesaiAlasan = p.selesaiAlasan;
        }
      } catch (e) {
        return galat(e instanceof Error ? e.message : String(e));
      }
      kirim({ selesai: true, provider: aliran.provider, model: aliran.model, ...(selesaiAlasan ? { selesaiAlasan } : {}) });
      tutup();
    },
  });
  return new Response(alir, { status: 200, headers: HEADER_SSE });
}
