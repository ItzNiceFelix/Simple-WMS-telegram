// lib/d1/hargaJualPreset.ts — Adapter D1: resolusi otomatis komponen harga jual
// dari fee_rules + kategori_tarif, untuk satu SKU pada satu preset.
// Prinsip: fee ADMIN/PROGRAM/PAJAK/PROSES diambil otomatis (bisa di-override user di UI);
// OPEX + volume tetap input manual (tidak diambil dari sini).
import { cocok, pilihAturan, type Aturan } from "@/lib/laba/aturanBiaya";
import { resolveTier, TIER_UNKNOWN } from "@/lib/laba/kategori";
import type { KomponenFee } from "@/lib/laba/hitungHargaJual";

export type KomponenAuto = {
  sku: string;
  nama: string | null;
  hpp: number;
  tier: string;
  grupGo: string | null;
  ukuranKhusus: boolean;
  feePersen: KomponenFee[];
  feeFlat: KomponenFee[];
  programTersedia: { kode: string; nama: string; aktif: boolean; persen: number }[];
  peringatan: string[];
};

type BarisProduk = {
  sku: string; nama_accurate: string | null; hpp: number | null; kategori: string | null;
  tier_override: string | null; ukuran_khusus: number; go_override: string | null;
  updated_at: number | null;
};

/** Ambil aturan aktif preset (bentuk mentah dari D1). */
async function ambilRules(db: D1Database, presetId: number): Promise<Aturan[]> {
  const { results } = await db.prepare(
    "SELECT id, jenis, kategori, status_toko, basis, unit, nilai, plafon, plafon_per_qty, priority, " +
    "valid_from, valid_to, aktif, kode_program, ukuran, syarat_json, status_verifikasi FROM fee_rules " +
    "WHERE preset_id = ? AND aktif = 1"
  ).bind(presetId).all<Aturan>();
  return results;
}

/** Program yang aktif (toggle) untuk preset. */
async function ambilProgramAktif(db: D1Database, presetId: number): Promise<Map<string, string>> {
  const { results } = await db.prepare(
    "SELECT pp.kode_program, COALESCE(pk.nama, pp.kode_program) AS nama FROM preset_program pp " +
    "LEFT JOIN program_katalog pk ON pk.kode_program = pp.kode_program WHERE pp.preset_id = ? AND pp.aktif = 1"
  ).bind(presetId).all<{ kode_program: string; nama: string }>();
  return new Map(results.map((r) => [r.kode_program, r.nama]));
}

/**
 * Resolusi komponen harga untuk satu SKU. Null bila SKU/preset tidak ada.
 * Yang di-auto: fee admin (per tier), program aktif, pajak, flat per order.
 */
export async function muatKomponenHarga(db: D1Database, presetId: number, sku: string): Promise<KomponenAuto | null> {
  const [preset, produk, rules, programAktif, kategoriRows] = await Promise.all([
    db.prepare("SELECT id FROM seller_presets WHERE id = ? AND dihapus_at IS NULL").bind(presetId).first<{ id: number }>(),
    db.prepare("SELECT sku, nama_accurate, hpp, kategori, tier_override, ukuran_khusus, go_override, updated_at FROM products WHERE sku = ?")
      .bind(sku).first<BarisProduk>(),
    ambilRules(db, presetId),
    ambilProgramAktif(db, presetId),
    db.prepare("SELECT kategori_path, tier, grup_go FROM kategori_tarif").all<{ kategori_path: string; tier: string; grup_go: string | null }>(),
  ]);
  if (!preset || !produk) return null;

  const peringatan: string[] = [];
  const kategoriTabel = new Map(kategoriRows.results.map((k) => [k.kategori_path, k.tier]));
  const { tier } = resolveTier(produk.kategori, produk.tier_override, kategoriTabel);
  const ukuranKhusus = produk.ukuran_khusus === 1;
  const grupGo = produk.go_override?.trim() || kategoriRows.results.find((k) => k.kategori_path === produk.kategori)?.grup_go || null;
  const tanggal = new Date().toISOString().slice(0, 10);

  const feePersen: KomponenFee[] = [];
  const feeFlat: KomponenFee[] = [];

  // ── Admin: resolusi per tier. Tier tak dikenal = JANGAN pakai fallback '*'. ──
  if (tier === TIER_UNKNOWN) {
    peringatan.push(
      "Kategori SKU belum dipetakan ke tier — fee admin tidak bisa ditentukan otomatis. Isi manual."
    );
  } else {
    const admin = pilihAturan(rules.filter((r) => r.jenis === "admin"), { jenis: "admin", kategori: tier, status_toko: "", tanggal });
    if (admin) {
      feePersen.push({ nama: `Admin ${tier}`, jenis: "admin", persen: admin.nilai, flat: 0, sumber: "auto" });
      if (admin.status_verifikasi !== "terverifikasi") peringatan.push(`Aturan admin ${tier} belum terverifikasi.`);
    } else {
      peringatan.push(`Aturan admin untuk tier ${tier} tidak ditemukan di preset ini.`);
    }
  }

  // ── Program aktif: cocokkan kategori = grup GO (atau '*' untuk ukuran khusus). ──
  for (const [kode, nama] of programAktif) {
    const kandidat = rules.filter((r) => r.kode_program === kode);
    if (kandidat.length === 0) continue;
    const ukuran = ukuranKhusus ? "khusus" : "biasa";
    const pilih = pilihAturan(kandidat, { jenis: "program", kategori: grupGo ?? "__tak_cocok__", status_toko: "", tanggal })
      ?? pilihAturan(kandidat.filter((r) => r.ukuran === ukuran || r.ukuran == null), { jenis: "program", kategori: "*", status_toko: "", tanggal });
    if (pilih) {
      if (pilih.plafon_per_qty != null) {
        peringatan.push(`${nama}: ada plafon Rp${pilih.plafon_per_qty}/qty — harga belum memperhitungkan plafon (perkiraan).`);
      }
      feePersen.push({ nama: `${nama}${grupGo ? ` (${grupGo})` : ""}`, jenis: "program", persen: pilih.nilai, flat: 0, sumber: "auto" });
    }
  }

  // ── Pajak: PPh + PPN bila ada. ──
  for (const jenisPajak of ["pajak_pph", "pajak_ppn"]) {
    const pj = pilihAturan(rules.filter((r) => r.jenis === jenisPajak), { jenis: jenisPajak, kategori: "*", status_toko: "", tanggal });
    if (pj) feePersen.push({ nama: jenisPajak === "pajak_pph" ? "Pajak PPh" : "Pajak PPN", jenis: jenisPajak, persen: pj.nilai, flat: 0, sumber: "auto" });
  }

  // ── Flat per order (proses, lain). ──
  for (const r of rules.filter((x) => x.unit === "per_order")) {
    if (!cocok(r, { jenis: r.jenis, kategori: "*", status_toko: "", tanggal })) continue;
    feeFlat.push({ nama: r.jenis === "proses" ? "Biaya proses" : r.jenis, jenis: r.jenis, persen: 0, flat: r.nilai, sumber: "auto" });
  }

  // ── Peringatan lunak ──
  if (produk.hpp == null) peringatan.push("HPP SKU ini kosong di master — isi manual.");
  if (produk.updated_at && Math.floor(Date.now() / 1000) - produk.updated_at > 30 * 86400) {
    const hari = Math.floor((Math.floor(Date.now() / 1000) - produk.updated_at) / 86400);
    peringatan.push(`HPP terakhir diperbarui ${hari} hari lalu — cek apakah masih akurat.`);
  }

  const programTersedia = [...programAktif].map(([kode, nama]) => {
    const r = pilihAturan(rules.filter((x) => x.kode_program === kode), { jenis: "program", kategori: grupGo ?? "__tak__", status_toko: "", tanggal });
    return { kode, nama, aktif: true, persen: r?.nilai ?? 0 };
  });

  return {
    sku: produk.sku,
    nama: produk.nama_accurate,
    hpp: produk.hpp ?? 0,
    tier,
    grupGo,
    ukuranKhusus,
    feePersen,
    feeFlat,
    programTersedia,
    peringatan,
  };
}
