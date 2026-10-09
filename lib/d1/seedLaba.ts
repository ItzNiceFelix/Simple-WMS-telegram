// lib/d1/seedLaba.ts — Loader seed laba multi-preset (D2/D-R2, idempoten).
// Sumber: bundle/seed/shopee_fees_id.json (v0.1) + docs/riset-shopee/render/*.json (R-R2).
// Aturan: hanya timpa baris `sumber LIKE 'seed:%'`; baris owner tak tersentuh.
// Jalankan dua kali = tanpa duplikasi (upsert per kunci alami).

export type SeedRule = {
  jenis: string; kode_program: string | null; kategori: string; status_toko: string | null;
  ukuran: string | null; basis: "persen" | "flat"; unit: "per_baris" | "per_order";
  nilai: number; plafon_per_qty: number | null; syarat: unknown; valid_from: string;
  valid_to: string | null; aktif: boolean; sumber: string; verifikasi: string; catatan: string;
};

export type SeedData = {
  programs: { kode_program: string; nama: string; opsional: boolean; default_aktif: boolean }[];
  kategori_tier_admin: { tier: string; persen: number; verifikasi: string }[];
  rules: SeedRule[];
};

/** Pastikan preset seed "Shopee Utama" (non_star). Kembalikan id. */
export async function pastikanPresetUtama(db: D1Database): Promise<number> {
  const ada = await db.prepare(
    "SELECT id FROM seller_presets WHERE nama = 'Shopee Utama' AND dihapus_at IS NULL"
  ).first<{ id: number }>();
  if (ada) return ada.id;
  const ins = await db.prepare(
    "INSERT INTO seller_presets (nama, marketplace, status_toko) VALUES ('Shopee Utama','shopee','non_star')"
  ).run();
  return Number(ins.meta.last_row_id);
}

/** Muat seed ke preset. Kembalikan { preset_id, aturan, program, tier }. */
export async function muatSeed(
  db: D1Database, seed: SeedData, ops?: { presetId?: number; prefixSumber?: string }
): Promise<{ preset_id: number; aturan: number; program: number; tier: number }> {
  const prefix = ops?.prefixSumber ?? "seed:";
  const presetId = ops?.presetId ?? await pastikanPresetUtama(db);

  // 1. tier_admin (upsert per tier; persen_final = persen seed, dasar NULL sampai resmi 12,5% diputus)
  let nTier = 0;
  for (const t of seed.kategori_tier_admin) {
    await db.prepare(
      "INSERT INTO tier_admin (tier, persen_dasar, diskon_persen, persen_final, verifikasi) VALUES (?, NULL, 0, ?, ?) " +
      "ON CONFLICT(tier) DO UPDATE SET persen_final = excluded.persen_final, verifikasi = excluded.verifikasi"
    ).bind(t.tier, t.persen, t.verifikasi === "resmi_cuplikan" ? "resmi_cuplikan" : t.verifikasi).run();
    nTier++;
  }

  // 2. program_katalog (upsert per kode)
  let nProg = 0;
  for (const p of seed.programs) {
    await db.prepare(
      "INSERT INTO program_katalog (kode_program, nama, opsional) VALUES (?, ?, ?) " +
      "ON CONFLICT(kode_program) DO UPDATE SET nama = excluded.nama"
    ).bind(p.kode_program, p.nama, p.opsional ? 1 : 0).run();
    // toggle default per preset
    await db.prepare(
      "INSERT INTO preset_program (preset_id, kode_program, aktif) VALUES (?, ?, ?) " +
      "ON CONFLICT(preset_id, kode_program) DO NOTHING"
    ).bind(presetId, p.kode_program, p.default_aktif ? 1 : 0).run();
    nProg++;
  }

  // 3. fee_rules: hapus baris seed lama preset ini, lalu insert seed baru.
  // (Kunci alami tak ada kolom unik → pendekatan hapus-yang-bersumber-seed + insert.)
  await db.prepare(
    "DELETE FROM fee_rules WHERE preset_id = ? AND sumber LIKE ?"
  ).bind(presetId, `${prefix}%`).run();
  let nAturan = 0;
  for (const r of seed.rules) {
    await db.prepare(
      "INSERT INTO fee_rules (preset_id, jenis, kode_program, kategori, status_toko, ukuran, basis, unit, " +
      "nilai, plafon_per_qty, syarat_json, valid_from, valid_to, aktif, sumber, verifikasi, status_verifikasi, catatan) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      presetId, r.jenis, r.kode_program, r.kategori, r.status_toko, r.ukuran, r.basis, r.unit,
      r.nilai, r.plafon_per_qty, r.syarat ? JSON.stringify(r.syarat) : null,
      r.valid_from, r.valid_to, r.aktif ? 1 : 0,
      `${prefix}${r.sumber}`, r.verifikasi,
      r.verifikasi === "resmi" || r.verifikasi === "resmi_cuplikan" ? "terverifikasi" : "belum_diverifikasi",
      r.catatan
    ).run();
    nAturan++;
  }
  return { preset_id: presetId, aturan: nAturan, program: nProg, tier: nTier };
}

/** Migrasikan mp_fee_presets lama → fee_rules preset (D2). Idempoten via hapus + insert. */
export async function migrasiPresetLama(db: D1Database, presetId: number): Promise<number> {
  const { results } = await db.prepare(
    "SELECT marketplace, jenis, basis, nilai FROM mp_fee_presets"
  ).all<{ marketplace: string; jenis: string; basis: string; nilai: number }>();
  await db.prepare(
    "DELETE FROM fee_rules WHERE preset_id = ? AND sumber = 'migrasi preset lama'"
  ).bind(presetId).run();
  for (const p of results) {
    await db.prepare(
      "INSERT INTO fee_rules (preset_id, jenis, kategori, status_toko, basis, unit, nilai, valid_from, aktif, sumber, status_verifikasi, verifikasi) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(presetId, p.jenis, "*", null, p.basis, p.basis === "persen" ? "per_baris" : "per_order", p.nilai, "1970-01-01", 1, "migrasi preset lama", "belum_diverifikasi", "belum").run();
  }
  return results.length;
}

/** Migrasikan laba_harian → laba_snapshot preset (D2). Idempoten via INSERT OR REPLACE. */
export async function migrasiLabaLama(db: D1Database, presetId: number): Promise<number> {
  const { results } = await db.prepare(
    "SELECT tanggal, jml_order, jml_baris, omzet, hpp, biaya, laba, tolak_json, rincian_json, file, at, by FROM laba_harian"
  ).all<{
    tanggal: string; jml_order: number; jml_baris: number; omzet: number; hpp: number;
    biaya: number; laba: number; tolak_json: string; rincian_json: string | null;
    file: string; at: number; by: string | null;
  }>();
  for (const r of results) {
    await db.prepare(
      "INSERT OR REPLACE INTO laba_snapshot (preset_id, tanggal, jml_order, jml_baris, omzet, hpp, biaya, laba, " +
      "tolak_json, rincian_json, peringatan_json, file, at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)"
    ).bind(presetId, r.tanggal, r.jml_order, r.jml_baris, r.omzet, r.hpp, r.biaya, r.laba,
      r.tolak_json, r.rincian_json ?? "[]", r.file, r.at, r.by).run();
  }
  return results.length;
}
