// lib/d1/labaPreset.ts — Adapter D1 untuk mesin laba murni (A3).
// Muat preset + rules aktif + tier + kategori + SKU → hitungLabaPreset → simpan laba_snapshot.
// Lapis 1 anti-dobel: registry laba_order per (preset_id, no_pesanan); klasifikasi
// baru/sama/berubah saat preview; simpan default tambah_baru (hanya No baru ditulis).
import { hitungLabaPreset, type AgregatPreset, type BarisPreset, type OrderPreset } from "@/lib/laba/hitungLabaPreset";
import { tanggalJakarta } from "./labaShopee";

export type SiapHitung = {
  presetId: number; statusToko: string;
  /**
   * Batas atas tanggal yang sedang dihitung. Dipakai saat satu file diimpor sebagai
   * BANYAK snapshot harian: syarat berbasis volume (`kuota_pesanan_gratis`,
   * `min_pesanan_terselesaikan`) harus dinilai dengan volume kumulatif SAMPAI tanggal itu,
   * bukan volume hari itu saja. Kosong = pakai penghitung tersimpan apa adanya (perilaku
   * impor satu-tanggal yang lama tidak berubah).
   */
  sampaiTanggal?: string;
  rules: {
    id: number; jenis: string; kategori: string; status_toko: string | null;
    basis: "persen" | "flat"; unit: "per_baris" | "per_order"; nilai: number;
    plafon: number | null; plafon_per_qty: number | null; priority: number;
    valid_from: string; valid_to: string | null; aktif: number;
    kode_program: string | null; ukuran: string | null; syarat_json: string | null;
    status_verifikasi: string | null;
  }[];
  tierAdmin: Map<string, number>;
  kategoriTabel: Map<string, string>;
  grupGo: Map<string, string>;
  iklanPersen: number | null;
  pesananKumulatif: number | null;
  bergabungSejak: string | null;
  uploadPertama: string | null;
};
export type StatusKlas = "baru" | "sama" | "berubah";
export type KlasOrder = { no_pesanan: string; status: StatusKlas; tanggal_lama: string | null; order: OrderPreset };
export type Klasifikasi = { baru: number; sama: number; berubah: number; contoh: KlasOrder[] };
export type ModeSimpan = "tambah_baru" | "timpa_semua";
/** Muat semua data hitung untuk satu preset. Null bila preset tak ada/terhapus. */
export async function siapkanHitung(
  db: D1Database,
  presetId: number,
  sampaiTanggal?: string,
  batasKumulatif = 0
): Promise<SiapHitung | null> {
  const preset = await db.prepare(
    "SELECT id, status_toko FROM seller_presets WHERE id = ? AND dihapus_at IS NULL"
  ).bind(presetId).first<{ id: number; status_toko: string }>();
  if (!preset) return null;

  const { results: rules } = await db.prepare(
    "SELECT id, jenis, kategori, status_toko, basis, unit, nilai, plafon, plafon_per_qty, priority, " +
    "valid_from, valid_to, aktif, kode_program, ukuran, syarat_json, status_verifikasi FROM fee_rules " +
    "WHERE preset_id = ? AND aktif = 1"
  ).bind(presetId).all<SiapHitung["rules"][number]>();

  // Toggle program: rule program hanya dipakai bila toggle aktif.
  const { results: toggles } = await db.prepare(
    "SELECT kode_program, aktif, aktif_sejak, aktif_sampai FROM preset_program WHERE preset_id = ?"
  ).bind(presetId).all<{ kode_program: string; aktif: number; aktif_sejak: string | null; aktif_sampai: string | null }>();
  const toggleAktif = new Map(toggles.map((t) => [t.kode_program, t]));
  const rulesAktif = rules.filter((r) => {
    if (!r.kode_program) return true;
    return toggleAktif.get(r.kode_program)?.aktif === 1;
  });

  const { results: tiers } = await db.prepare("SELECT tier, persen_final FROM tier_admin")
    .all<{ tier: string; persen_final: number }>();
  const { results: kats } = await db.prepare("SELECT kategori_path, tier, grup_go FROM kategori_tarif")
    .all<{ kategori_path: string; tier: string; grup_go: string | null }>();

  const penghitung = await db.prepare(
    "SELECT pesanan_selesai_kumulatif, bergabung_sejak, upload_produk_pertama FROM preset_penghitung WHERE preset_id = ?"
  ).bind(presetId).first<{
    pesanan_selesai_kumulatif: number; bergabung_sejak: string | null; upload_produk_pertama: string | null;
  }>();

  // Rasio iklan bulan berjalan: ads_harian ÷ omzet registry (null bila tak ada data).
  const bulan = tanggalJakarta().slice(0, 7);
  const ads = await db.prepare(
    "SELECT COALESCE(SUM(biaya_iklan_bersih), 0) AS total FROM ads_harian WHERE preset_id = ? AND tanggal LIKE ?"
  ).bind(presetId, `${bulan}%`).first<{ total: number }>();
  const jual = await db.prepare(
    "SELECT COALESCE(SUM(omzet), 0) AS total FROM laba_order WHERE preset_id = ? AND tanggal_snapshot LIKE ?"
  ).bind(presetId, `${bulan}%`).first<{ total: number }>();
  const iklanPersen = ads && jual && jual.total > 0 && ads.total > 0
    ? Math.round((ads.total / jual.total) * 1000) / 10
    : null;

  /**
   * Volume kumulatif sampai `sampaiTanggal`. Dihitung dari registry laba_order (order
   * status dihitung), bukan dari kolom tersimpan: kolom `pesanan_selesai_kumulatif`
   * adalah angka SEPANJANG WAKTU dan tidak bisa dipakai menjawab "berapa sampai hari X"
   * saat satu file dipecah menjadi beberapa tanggal. Kosong = pakai kolom tersimpan.
   */
  let pesananKumulatif = penghitung?.pesanan_selesai_kumulatif ?? null;
  if (sampaiTanggal) {
    // Dihitung dari registry sampai `sampaiTanggal` — bukan dari kolom tersimpan, yang hanya
    // menyimpan angka sepanjang waktu dan tidak bisa menjawab "berapa sampai hari X" saat satu
    // file dipecah menjadi beberapa tanggal. Saat tanggal itu dihitung, registry sudah memuat
    // tanggal SEBELUMNYA; order hari ini ditambahkan oleh pemanggil (`batasKumulatif`).
    const kum = await db.prepare(
      "SELECT COUNT(*) AS n FROM laba_order WHERE preset_id = ? AND tanggal_snapshot < ?"
    ).bind(presetId, sampaiTanggal).first<{ n: number }>();
    pesananKumulatif = (kum?.n ?? 0) + batasKumulatif;
  }

  return {
    presetId, statusToko: preset.status_toko, sampaiTanggal, rules: rulesAktif,
    tierAdmin: new Map(tiers.map((t) => [t.tier, t.persen_final])),
    kategoriTabel: new Map(kats.map((k) => [k.kategori_path, k.tier])),
    grupGo: new Map(kats.filter((k) => k.grup_go).map((k) => [k.kategori_path, k.grup_go as string])),
    iklanPersen,
    pesananKumulatif,
    bergabungSejak: penghitung?.bergabung_sejak ?? null,
    uploadPertama: penghitung?.upload_produk_pertama ?? null,
  };
}

/** Hitung + (opsional) simpan snapshot per (preset_id, tanggal). */
export async function hitungDanSimpan(
  db: D1Database, siap: SiapHitung, rows: BarisPreset[], file: string,
  tanggal: string, oleh: string | null, simpan: boolean, mode: ModeSimpan = "tambah_baru",
  berkas?: { status: Map<string, string>; dari: string; sampai: string }
): Promise<{ tanggal: string; agregat: AgregatPreset; klasifikasi: Klasifikasi }> {
  // Lapis 2 D-5: status lama untuk deteksi No yang jadi Batal/hilang dari file.
  const { results: lamaRows } = await db.prepare(
    "SELECT no_pesanan, status_pesanan, tanggal_snapshot FROM laba_order WHERE preset_id = ?"
  ).bind(siap.presetId).all<{ no_pesanan: string; status_pesanan: string; tanggal_snapshot: string }>();
  const dataLama = new Map(lamaRows.map((x) => [x.no_pesanan, { status_pesanan: x.status_pesanan, tanggal_snapshot: x.tanggal_snapshot }]));

  const agregat = await hitungLabaPreset(rows, {
    preset: { id: siap.presetId, status_toko: siap.statusToko },
    tanggal,
    rules: siap.rules,
    tierAdmin: siap.tierAdmin,
    kategoriTabel: siap.kategoriTabel,
    grupGo: siap.grupGo,
    ambilSku: async (sku) => {
      const p = await db.prepare(
        "SELECT hpp, nama_accurate, kategori, tier_override, pre_order, ukuran_khusus, go_override, updated_at FROM products WHERE sku = ?"
      ).bind(sku).first<{
        hpp: number | null; nama_accurate: string | null; kategori: string | null; tier_override: string | null;
        pre_order: number; ukuran_khusus: number; go_override: string | null; updated_at: number | null;
      }>();
      if (!p) return null;
      return {
        hpp: p.hpp, nama: p.nama_accurate, kategori: p.kategori, tierOverride: p.tier_override,
        preOrder: p.pre_order === 1, ukuranKhusus: p.ukuran_khusus === 1, goOverride: p.go_override,
        updatedAt: p.updated_at ?? null,
      };
    },
    konteks: {
      iklanPersen: siap.iklanPersen, pesananKumulatif: siap.pesananKumulatif,
      bergabungSejak: siap.bergabungSejak, uploadPertama: siap.uploadPertama,
    },
    dataLama,
    statusBerkas: berkas?.status,
    rentangBerkas: berkas ? { dari: berkas.dari, sampai: berkas.sampai } : undefined,
  });
  const klasifikasi = await klasifikasikan(db, siap.presetId, agregat.orders);
  if (simpan && agregat.jml_baris_belum_terpetakan > 0) {
    // Lapis 2 D-1: SKU tanpa kategori = tier admin tak diketahui → laba bisa salah → blokir simpan.
    const contoh = agregat.sku_belum_terpetakan.slice(0, 5).join(", ");
    throw new Error(
      `Simpan dibatalkan: ${agregat.jml_baris_belum_terpetakan} baris SKU belum punya kategori tarif ` +
      `(contoh: ${contoh}). Petakan kategori produk di master stok lalu hitung ulang.`
    );
  }
  if (simpan) {
    const at = Math.floor(Date.now() / 1000);
    const abaikanLama = mode !== "timpa_semua";

    // GABUNG, BUKAN TIMPA.
    //
    // KENAPA: satu hari bisa dicakup BEBERAPA berkas (Order.all.20261014_20261015 dan
    // 20261015_20261016 sama-sama memuat 15 Okt). Dulu `INSERT OR REPLACE` membuat berkas
    // terakhir MENGGANTI snapshot hari itu dengan cakupan yang lebih sempit: pada data nyata
    // 15 Okt berakhir 170 order padahal registry sudah memuat 175, dan 14 Okt 240 padahal 267.
    // Omzet/laba harian jadi lebih kecil dari kenyataan tanpa gejala apa pun.
    //
    // Sekarang baris order digabung per `no_pesanan` (registry sudah unik per No), lalu
    // total snapshot = jumlah seluruh order milik tanggal itu. Order yang sama tidak
    // dihitung dua kali, dan berkas dengan cakupan lebih luas tidak bisa "kalah".
    const lama = await db
      .prepare(
        "SELECT jml_order, jml_baris, omzet, hpp, biaya, pajak, laba, no_json, rincian_json, biaya_jenis_json FROM laba_snapshot WHERE preset_id = ? AND tanggal = ?"
      )
      .bind(siap.presetId, tanggal)
      .first<{ jml_order: number; jml_baris: number; omzet: number; hpp: number; biaya: number; pajak: number; laba: number; no_json: string; rincian_json: string; biaya_jenis_json: string | null }>();

    // Himpunan nomor order yang sudah tercatat untuk tanggal ini.
    const nomorLama = new Set<string>();
    if (lama && abaikanLama) {
      try {
        const arr = JSON.parse(lama.no_json) as unknown;
        if (Array.isArray(arr)) for (const x of arr) if (typeof x === "string") nomorLama.add(x);
      } catch {
        // no_json rusak = anggap kosong; lebih baik menghitung ulang daripada gagal simpan.
      }
    }

    // Order di berkas ini yang BELUM tercatat pada tanggal itu.
    const baru = agregat.orders.filter((x) => !nomorLama.has(x.no_pesanan));
    const tambahan = baru.length > 0
      ? {
          jml_order: baru.length,
          // `OrderPreset` tidak membawa jumlah baris per order; jumlah baris hanya dipakai
          // tampilan. Pakai 0 agar tidak mengarang angka — total uang tetap dari agregat order.
          jml_baris: 0,
          omzet: baru.reduce((a, x) => a + x.omzet, 0),
          hpp: baru.reduce((a, x) => a + x.hpp, 0),
          biaya: baru.reduce((a, x) => a + x.biaya, 0),
          pajak: baru.reduce((a, x) => a + x.pajak, 0),
          laba: baru.reduce((a, x) => a + x.laba, 0),
        }
      : { jml_order: 0, jml_baris: 0, omzet: 0, hpp: 0, biaya: 0, pajak: 0, laba: 0 };

    // `timpa_semua` = user minta hitung ulang bersih: pakai angka berkas ini apa adanya.
    const gabung = lama && abaikanLama
      ? {
          jml_order: lama.jml_order + tambahan.jml_order,
          jml_baris: lama.jml_baris + tambahan.jml_baris,
          omzet: lama.omzet + tambahan.omzet,
          hpp: lama.hpp + tambahan.hpp,
          biaya: lama.biaya + tambahan.biaya,
          pajak: lama.pajak + tambahan.pajak,
          laba: lama.laba + tambahan.laba,
        }
      : {
          jml_order: agregat.jml_order,
          jml_baris: agregat.jml_baris,
          omzet: agregat.omzet,
          hpp: agregat.hpp,
          biaya: agregat.biaya,
          pajak: agregat.pajak,
          laba: agregat.laba,
        };

    // Rincian per SKU: gabungkan juga. SKU yang sudah ada di rincian lama dan muncul lagi
    // di berkas ini akan terhitung dua kali bila kita hanya menambah — karena itu rincian
    // hanya diambil dari berkas ini saat `timpa_semua`, dan untuk mode gabung rincian lama
    // dipertahankan sebagai dasar sementara (lihat catatan keterbatasan di bawah).
    const rincianLama: unknown[] = (() => {
      if (!lama || !abaikanLama) return [];
      try {
        const v = JSON.parse(lama.rincian_json ?? "[]");
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    })();

    // Pecahan biaya per jenis: pada mode gabung, snapshot lama sudah memuat biaya order yang
    // tercatat sebelumnya. Karena itu yang ditambahkan HANYA pecahan order BARU — memakai
    // total berkas akan menghitung ulang biaya order lama setiap kali file yang tumpang
    // tindih diimpor, dan komposisi biaya membengkak melebihi `biaya` totalnya.
    const biayaJenisLama: Record<string, number> = (() => {
      if (!lama || !abaikanLama) return {};
      const mentah = lama.biaya_jenis_json ?? "{}";
      try {
        const v = JSON.parse(mentah) as unknown;
        if (!v || typeof v !== "object" || Array.isArray(v)) return {};
        const out: Record<string, number> = {};
        for (const [k, n] of Object.entries(v)) {
          if (typeof n === "number" && Number.isFinite(n) && n !== 0) out[k] = n;
        }
        return out;
      } catch {
        return {};
      }
    })();
    const biayaJenisGabung: Record<string, number> = { ...biayaJenisLama };
    const sumberJenis = lama && abaikanLama ? baru : agregat.orders;
    for (const x of sumberJenis) {
      for (const [k, n] of Object.entries(x.biayaJenis)) {
        if (!Number.isFinite(n) || n === 0) continue;
        biayaJenisGabung[k] = (biayaJenisGabung[k] ?? 0) + n;
      }
    }

    const stmts: D1PreparedStatement[] = [
      db.prepare(
        "INSERT OR REPLACE INTO laba_snapshot (preset_id, tanggal, jml_order, jml_baris, omzet, hpp, biaya, pajak, laba, " +
        "tolak_json, rincian_json, peringatan_json, no_json, file, at, by, biaya_jenis_json) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        siap.presetId, tanggal, gabung.jml_order, gabung.jml_baris, gabung.omzet, gabung.hpp,
        gabung.biaya, gabung.pajak, gabung.laba, JSON.stringify(agregat.tolak),
        // Rincian per SKU hanya akurat bila seluruh hari berasal dari satu berkas. Untuk mode
        // gabung, rincian dipertahankan dari snapshot lama dan TIDAK ditambah angka berkas ini
        // (menambah akan menghitung SKU yang sama dua kali). Total uang di atas tetap benar
        // karena dihitung dari `laba_order` yang unik per No.
        JSON.stringify(rincianLama.length > 0 ? rincianLama : agregat.rincian),
        JSON.stringify(agregat.peringatan),
        JSON.stringify([...new Set([...nomorLama, ...agregat.orders.map((x) => x.no_pesanan)])]),
        file.slice(0, 120), at, oleh, JSON.stringify(biayaJenisGabung)
      ),
    ];
    for (const x of agregat.orders) {
      const sql = abaikanLama
        ? "INSERT OR IGNORE INTO laba_order (preset_id, no_pesanan, tanggal_snapshot, tanggal_pesanan, status_pesanan, omzet, hpp, biaya, pajak, laba, hash_baris, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        : "INSERT INTO laba_order (preset_id, no_pesanan, tanggal_snapshot, tanggal_pesanan, status_pesanan, omzet, hpp, biaya, pajak, laba, hash_baris, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(preset_id, no_pesanan) DO UPDATE SET tanggal_snapshot = excluded.tanggal_snapshot, tanggal_pesanan = excluded.tanggal_pesanan, " +
          "status_pesanan = excluded.status_pesanan, omzet = excluded.omzet, hpp = excluded.hpp, biaya = excluded.biaya, " +
          "pajak = excluded.pajak, laba = excluded.laba, hash_baris = excluded.hash_baris, at = excluded.at";
      stmts.push(db.prepare(sql).bind(siap.presetId, x.no_pesanan, tanggal, x.tanggal_pesanan, x.status_pesanan, x.omzet, x.hpp, x.biaya, x.pajak, x.laba, x.hash_baris, at));
    }
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
    await db.prepare(
      "INSERT INTO preset_penghitung (preset_id, pesanan_selesai_kumulatif) VALUES (?, ?) " +
      "ON CONFLICT(preset_id) DO UPDATE SET pesanan_selesai_kumulatif = " +
      "(SELECT COUNT(*) FROM laba_order WHERE preset_id = excluded.preset_id)"
    ).bind(siap.presetId, 0).run();
  }
  return { tanggal, agregat, klasifikasi };
}
/** Klasifikasi tiap No terhadap registry: baru (belum ada), sama (hash cocok), berubah (hash beda). */
export async function klasifikasikan(db: D1Database, presetId: number, orders: OrderPreset[]): Promise<Klasifikasi> {
  const lihat = new Map(orders.map((x) => [x.no_pesanan, x]));
  const lama = new Map<string, { tanggal_snapshot: string; hash_baris: string }>();
  const kunci = [...lihat.keys()];
  for (let i = 0; i < kunci.length; i += 50) {
    const potong = kunci.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db.prepare(
      `SELECT no_pesanan, tanggal_snapshot, hash_baris FROM laba_order WHERE preset_id = ? AND no_pesanan IN (${tanda})`
    ).bind(presetId, ...potong).all<{ no_pesanan: string; tanggal_snapshot: string; hash_baris: string }>();
    for (const r of results) lama.set(r.no_pesanan, r);
  }
  let baru = 0; let sama = 0; let berubah = 0;
  const contoh: KlasOrder[] = [];
  for (const x of lihat.values()) {
    const l = lama.get(x.no_pesanan);
    const status: StatusKlas = !l ? "baru" : l.hash_baris === x.hash_baris ? "sama" : "berubah";
    if (status === "baru") baru += 1; else if (status === "sama") sama += 1; else berubah += 1;
    if (contoh.length < 50 && status !== "baru") contoh.push({ no_pesanan: x.no_pesanan, status, tanggal_lama: l?.tanggal_snapshot ?? null, order: x });
  }
  return { baru, sama, berubah, contoh };
}
/** Total periode dari registry (distinct No), bukan SUM snapshot — anti dobel overlap. */
export async function totalRegistry(db: D1Database, presetId: number, dari: string, sampai: string): Promise<{ jml_order: number; omzet: number; hpp: number; biaya: number; pajak: number; laba: number }> {
  const r = await db.prepare(
    "SELECT COUNT(*) AS jml_order, COALESCE(SUM(omzet), 0) AS omzet, COALESCE(SUM(hpp), 0) AS hpp, " +
    "COALESCE(SUM(biaya), 0) AS biaya, COALESCE(SUM(pajak), 0) AS pajak, COALESCE(SUM(laba), 0) AS laba " +
    "FROM laba_order WHERE preset_id = ? AND tanggal_snapshot >= ? AND tanggal_snapshot <= ?"
  ).bind(presetId, dari, sampai).first<{ jml_order: number; omzet: number; hpp: number; biaya: number; pajak: number; laba: number }>();
  return { jml_order: r?.jml_order ?? 0, omzet: r?.omzet ?? 0, hpp: r?.hpp ?? 0, biaya: r?.biaya ?? 0, pajak: r?.pajak ?? 0, laba: r?.laba ?? 0 };
}
