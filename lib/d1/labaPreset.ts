// lib/d1/labaPreset.ts — Adapter D1 untuk mesin laba murni (A3).
// Muat preset + rules aktif + tier + kategori + SKU → hitungLabaPreset → simpan laba_snapshot.
import { hitungLabaPreset, type AgregatPreset, type BarisPreset } from "@/lib/laba/hitungLabaPreset";
import { tanggalJakarta } from "./labaShopee";

export type SiapHitung = {
  presetId: number; statusToko: string;
  rules: {
    id: number; jenis: string; kategori: string; status_toko: string | null;
    basis: "persen" | "flat"; unit: "per_baris" | "per_order"; nilai: number;
    plafon: number | null; plafon_per_qty: number | null; priority: number;
    valid_from: string; valid_to: string | null; aktif: number;
    kode_program: string | null; ukuran: string | null; syarat_json: string | null;
  }[];
  tierAdmin: Map<string, number>;
  kategoriTabel: Map<string, string>;
  grupGo: Map<string, string>;
  iklanPersen: number | null;
  pesananKumulatif: number | null;
  bergabungSejak: string | null;
  uploadPertama: string | null;
};

/** Muat semua data hitung untuk satu preset. Null bila preset tak ada/terhapus. */
export async function siapkanHitung(db: D1Database, presetId: number): Promise<SiapHitung | null> {
  const preset = await db.prepare(
    "SELECT id, status_toko FROM seller_presets WHERE id = ? AND dihapus_at IS NULL"
  ).bind(presetId).first<{ id: number; status_toko: string }>();
  if (!preset) return null;

  const { results: rules } = await db.prepare(
    "SELECT id, jenis, kategori, status_toko, basis, unit, nilai, plafon, plafon_per_qty, priority, " +
    "valid_from, valid_to, aktif, kode_program, ukuran, syarat_json FROM fee_rules " +
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

  // Rasio iklan bulan berjalan: ads_harian ÷ omzet snapshot (null bila tak ada data).
  const bulan = tanggalJakarta().slice(0, 7);
  const ads = await db.prepare(
    "SELECT COALESCE(SUM(biaya_iklan_bersih), 0) AS total FROM ads_harian WHERE preset_id = ? AND tanggal LIKE ?"
  ).bind(presetId, `${bulan}%`).first<{ total: number }>();
  const jual = await db.prepare(
    "SELECT COALESCE(SUM(omzet), 0) AS total FROM laba_snapshot WHERE preset_id = ? AND tanggal LIKE ?"
  ).bind(presetId, `${bulan}%`).first<{ total: number }>();
  const iklanPersen = ads && jual && jual.total > 0 && ads.total > 0
    ? Math.round((ads.total / jual.total) * 1000) / 10
    : null;

  return {
    presetId, statusToko: preset.status_toko, rules: rulesAktif,
    tierAdmin: new Map(tiers.map((t) => [t.tier, t.persen_final])),
    kategoriTabel: new Map(kats.map((k) => [k.kategori_path, k.tier])),
    grupGo: new Map(kats.filter((k) => k.grup_go).map((k) => [k.kategori_path, k.grup_go as string])),
    iklanPersen,
    pesananKumulatif: penghitung?.pesanan_selesai_kumulatif ?? null,
    bergabungSejak: penghitung?.bergabung_sejak ?? null,
    uploadPertama: penghitung?.upload_produk_pertama ?? null,
  };
}

/** Hitung + (opsional) simpan snapshot per (preset_id, tanggal). */
export async function hitungDanSimpan(
  db: D1Database, siap: SiapHitung, rows: BarisPreset[], file: string,
  tanggal: string, oleh: string | null, simpan: boolean
): Promise<{ tanggal: string; agregat: AgregatPreset }> {
  const agregat = await hitungLabaPreset(rows, {
    preset: { id: siap.presetId, status_toko: siap.statusToko },
    tanggal,
    rules: siap.rules,
    tierAdmin: siap.tierAdmin,
    kategoriTabel: siap.kategoriTabel,
    grupGo: siap.grupGo,
    ambilSku: async (sku) => {
      const p = await db.prepare(
        "SELECT hpp, kategori, tier_override, pre_order, ukuran_khusus, go_override FROM products WHERE sku = ?"
      ).bind(sku).first<{
        hpp: number | null; kategori: string | null; tier_override: string | null;
        pre_order: number; ukuran_khusus: number; go_override: string | null;
      }>();
      if (!p) return null;
      return {
        hpp: p.hpp, kategori: p.kategori, tierOverride: p.tier_override,
        preOrder: p.pre_order === 1, ukuranKhusus: p.ukuran_khusus === 1, goOverride: p.go_override,
      };
    },
    konteks: {
      iklanPersen: siap.iklanPersen, pesananKumulatif: siap.pesananKumulatif,
      bergabungSejak: siap.bergabungSejak, uploadPertama: siap.uploadPertama,
    },
  });
  if (simpan) {
    await db.prepare(
      "INSERT OR REPLACE INTO laba_snapshot (preset_id, tanggal, jml_order, jml_baris, omzet, hpp, biaya, laba, " +
      "tolak_json, rincian_json, peringatan_json, file, at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      siap.presetId, tanggal, agregat.jml_order, agregat.jml_baris, agregat.omzet, agregat.hpp,
      agregat.biaya, agregat.laba, JSON.stringify(agregat.tolak), JSON.stringify(agregat.rincian),
      JSON.stringify(agregat.peringatan), file.slice(0, 120), Math.floor(Date.now() / 1000), oleh
    ).run();
    // Penghitung kumulatif: jumlah order snapshot (idempoten per tanggal via REPLACE).
    await db.prepare(
      "INSERT INTO preset_penghitung (preset_id, pesanan_selesai_kumulatif) VALUES (?, ?) " +
      "ON CONFLICT(preset_id) DO UPDATE SET pesanan_selesai_kumulatif = " +
      "(SELECT COALESCE(SUM(jml_order), 0) FROM laba_snapshot WHERE preset_id = excluded.preset_id)"
    ).bind(siap.presetId, agregat.jml_order).run();
  }
  return { tanggal, agregat };
}
