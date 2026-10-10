// lib/laba/hitungLabaPreset.ts — Hitung laba per preset murni (E2/E-R3, tanpa D1).
// Perilaku §4 v1 + perubahan §5.1–5.4 + rumus resmi §4 v2.
// Dasar admin per baris: Harga Awal − diskon penjual − voucher penjual (T-V1).
// Biaya file v1 (voucher/diskon sebagai biaya) DIHAPUS — sudah masuk dasar.

import { cocok, feePersen, feePlafonQty, pilihAturan, type Aturan } from "./aturanBiaya";
import { resolveTier, TIER_UNKNOWN } from "./kategori";
import { evaluasiSyarat, parseSyarat, type KonteksSyarat } from "./syarat";

export type BarisPreset = Record<string, unknown>;

export type TolakPreset = { no_pesanan: string; alasan: string };
export type RincianSkuPreset = {
  sku: string; unit: number; hppSatuan: number; hargaJual: number;
  marginSatuan: number; marginPersen: number; kontribusi: number;
};
export type AgregatPreset = {
  jml_order: number; jml_baris: number; omzet: number; hpp: number;
  biaya: number; laba: number; tolak: TolakPreset[]; rincian: RincianSkuPreset[];
  peringatan: string[]; jml_baris_belum_terpetakan: number;
};

export type InfoSku = {
  hpp: number | null; kategori: string | null; tierOverride: string | null;
  preOrder: boolean; ukuranKhusus: boolean; goOverride: string | null;
};

export type OpsiHitung = {
  preset: { id: number; status_toko: string };
  tanggal: string;
  rules: Aturan[];
  tierAdmin: Map<string, number>;
  kategoriTabel: Map<string, string>;
  ambilSku: (sku: string) => Promise<InfoSku | null>;
  konteks: Omit<KonteksSyarat, "tanggal">;
  grupGo?: Map<string, string>;
};

const STATUS_HITUNG = ["perlu dikirim", "telah dikirim", "sedang dikirim", "selesai"];

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/** Angka Shopee: "10.879" (titik ribuan) / 10879 / "10879" → 10879. */
function angka(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim().replace(/\./g, "").replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function statusDihitung(status: string): boolean {
  const s = status.toLowerCase();
  return STATUS_HITUNG.some((x) => s.includes(x));
}

/** Dasar resmi per baris: Harga Awal − diskon penjual − voucher penjual. */
export function dasarBaris(r: BarisPreset): { dasar: number; qty: number; subtotal: number } {
  const qty = Math.max(0, angka(r["Jumlah"]) - angka(r["Returned quantity"]));
  const hargaAwal = angka(r["Harga Awal"]);
  const jml = Math.max(1, angka(r["Jumlah"]));
  const diskonUnit = hargaAwal > 0 ? Math.max(0, hargaAwal - angka(r["Harga Setelah Diskon"])) : angka(r["Diskon Dari Penjual"]) / jml;
  const voucherUnit = (angka(r["Voucher Ditanggung Penjual"]) + angka(r["Paket Diskon (Diskon dari Penjual)"])) / jml;
  const dasar = Math.max(0, Math.round((hargaAwal - diskonUnit - voucherUnit) * qty));
  return { dasar, qty, subtotal: angka(r["Subtotal Pesanan"]) };
}

export async function hitungLabaPreset(
  rows: BarisPreset[], o: OpsiHitung
): Promise<AgregatPreset> {
  const grup = new Map<string, BarisPreset[]>();
  for (const r of rows) {
    const no = teks(r["No. Pesanan"]);
    if (!no) continue;
    const d = grup.get(no) ?? [];
    d.push(r);
    grup.set(no, d);
  }

  let jml_order = 0;
  let jml_baris = 0;
  let omzet = 0;
  let hpp = 0;
  let biaya = 0;
  let jml_baris_belum_terpetakan = 0;
  const tolak: TolakPreset[] = [];
  const peringatanSet = new Set<string>();
  const perSku = new Map<string, {
    sku: string; unit: number; hppSatuan: number; harga: number;
    omzetSku: number; hppSku: number; biayaSku: number; kontribusi: number;
  }>();
  const cacheSku = new Map<string, InfoSku | null>();
  const infoSku = async (sku: string): Promise<InfoSku | null> => {
    if (!cacheSku.has(sku)) cacheSku.set(sku, await o.ambilSku(sku));
    return cacheSku.get(sku) ?? null;
  };

  const ctx: KonteksSyarat = { ...o.konteks, tanggal: o.tanggal };

  for (const [no, daftar] of grup) {
    if (!statusDihitung(teks(daftar[0]["Status Pesanan"]))) continue;

    type B = { sku: string; qty: number; dasar: number; harga: number };
    const skuBaris: B[] = [];
    let alasanTolak: string | null = null;
    for (const r of daftar) {
      const sku = teks(r["Nomor Referensi SKU"]) || teks(r["SKU Induk"]);
      if (!sku) { alasanTolak = "SKU kosong (ref + induk kosong)"; break; }
      const { dasar, qty } = dasarBaris(r);
      if (qty === 0) continue;
      skuBaris.push({ sku: sku.toUpperCase(), qty, dasar, harga: angka(r["Harga Setelah Diskon"]) });
    }
    if (alasanTolak) { tolak.push({ no_pesanan: no, alasan: alasanTolak }); continue; }
    if (skuBaris.length === 0) continue;

    // HPP master; tak cocok = tolak seorder (perilaku §4 dipertahankan).
    let hppOrder = 0;
    const infoBaris: (InfoSku & { tier: string })[] = [];
    for (const b of skuBaris) {
      const info = await infoSku(b.sku);
      if (!info || info.hpp == null) { alasanTolak = `SKU ${b.sku} tak cocok master stok`; break; }
      const { tier } = resolveTier(info.kategori, info.tierOverride, o.kategoriTabel);
      if (tier === TIER_UNKNOWN) {
        jml_baris_belum_terpetakan += 1;
        peringatanSet.add(`tanpa kategori: ${b.sku}`);
      }
      infoBaris.push({ ...info, tier });
      hppOrder += b.qty * info.hpp;
    }
    if (alasanTolak) { tolak.push({ no_pesanan: no, alasan: alasanTolak }); continue; }

    const omzetOrder = skuBaris.reduce((a, b) => a + b.dasar, 0);
    let biayaOrder = 0;
    const biayaPerBaris: number[] = skuBaris.map(() => 0);

    // Aturan per_baris (admin + program + pajak): cocok per baris.
    for (let i = 0; i < skuBaris.length; i++) {
      const b = skuBaris[i];
      const info = infoBaris[i];
      // Admin: persen dari tier; rule admin (status/tanggal/syarat) menentukan berlaku/tidak.
      const persenFinal = o.tierAdmin.get(info.tier);
      if (persenFinal != null) {
        const ruleAdmin = pilihAturan(o.rules.filter((x) => x.unit === "per_baris" && !x.kode_program && x.jenis === "admin"), {
          jenis: "admin", kategori: info.tier, status_toko: o.preset.status_toko, tanggal: o.tanggal,
        });
        let adminOk = true;
        if (ruleAdmin) {
          const syarat = parseSyarat(ruleAdmin.syarat_json);
          if (syarat) {
            const h = evaluasiSyarat(syarat, ctx);
            if (!h.ok) { peringatanSet.add(h.alasan); adminOk = false; }
          }
        }
        if (adminOk) biayaPerBaris[i] += feePersen(b.dasar, persenFinal, null);
      }
      // Program aktif per preset (toggle di lapisan API; di sini rules sudah difilter aktif).
      // Rule program menyimpan grup huruf di kolom kategori; '*' cocok semua baris.
      const grupBaris = (info.goOverride?.trim() || o.grupGo?.get(info.kategori ?? "")) ?? info.tier;
      for (const pr of o.rules.filter((x) => x.unit === "per_baris" && x.kode_program)) {
        const katCocok = pr.kategori === "*" ? "*" : (grupBaris === pr.kategori ? pr.kategori : "__tak_cocok__");
        if (!cocok(pr, { jenis: pr.jenis, kategori: katCocok, status_toko: o.preset.status_toko, tanggal: o.tanggal })) continue;
        const syarat = parseSyarat(pr.syarat_json);
        if (syarat) {
          const h = evaluasiSyarat(syarat, ctx);
          if (!h.ok) { peringatanSet.add(h.alasan); continue; }
        }
        if (pr.ukuran === "khusus" && !info.ukuranKhusus) continue;
        if (pr.ukuran === "biasa" && info.ukuranKhusus) continue;
        biayaPerBaris[i] += feePlafonQty(b.dasar, pr.nilai, pr.plafon_per_qty, b.qty);
      }
      // Pajak per baris (pph/ppn dari fee_rules).
      for (const pj of o.rules.filter((x) => (x.jenis === "pajak_pph" || x.jenis === "pajak_ppn") && x.unit === "per_baris")) {
        if (!cocok(pj, { jenis: pj.jenis, kategori: "*", status_toko: o.preset.status_toko, tanggal: o.tanggal })) continue;
        biayaPerBaris[i] += feePersen(b.dasar, pj.nilai, pj.plafon);
      }
    }
    // Aturan per_order (proses dsb): sekali per order.
    let biayaPerOrder = 0;
    for (const pr of o.rules.filter((x) => x.unit === "per_order")) {
      if (!cocok(pr, { jenis: pr.jenis, kategori: "*", status_toko: o.preset.status_toko, tanggal: o.tanggal })) continue;
      const syarat = parseSyarat(pr.syarat_json);
      if (syarat) {
        const h = evaluasiSyarat(syarat, ctx);
        if (!h.ok) { peringatanSet.add(h.alasan); continue; }
      }
      biayaPerOrder += pr.basis === "flat" ? pr.nilai : feePersen(omzetOrder, pr.nilai, pr.plafon);
    }

    const biayaOrderTotal = biayaPerBaris.reduce((a, x) => a + x, 0) + biayaPerOrder;
    biayaOrder = biayaOrderTotal;
    jml_order += 1;
    jml_baris += skuBaris.length;
    omzet += omzetOrder;
    hpp += hppOrder;
    biaya += biayaOrder;

    for (let i = 0; i < skuBaris.length; i++) {
      const b = skuBaris[i];
      const info = infoBaris[i];
      const h = info.hpp ?? 0;
      // Alokasi biaya per_order proporsional dasar (konsisten rincian lama).
      const porsi = omzetOrder > 0 ? b.dasar / omzetOrder : 0;
      const biayaAlokasi = Math.round(biayaPerBaris[i] + biayaPerOrder * porsi);
      const ada = perSku.get(b.sku);
      if (ada) {
        ada.unit += b.qty;
        ada.omzetSku += b.dasar;
        ada.hppSku += b.qty * h;
        ada.biayaSku += biayaAlokasi;
        ada.kontribusi += b.dasar - b.qty * h - biayaAlokasi;
        if (b.harga > 0) ada.harga = b.harga;
      } else {
        perSku.set(b.sku, {
          sku: b.sku, unit: b.qty, hppSatuan: h, harga: b.harga,
          omzetSku: b.dasar, hppSku: b.qty * h, biayaSku: biayaAlokasi,
          kontribusi: b.dasar - b.qty * h - biayaAlokasi,
        });
      }
    }
  }

  const rincian = [...perSku.values()]
    .map((s) => {
      const marginSatuan = s.unit > 0 ? Math.round(s.kontribusi / s.unit) : 0;
      return {
        sku: s.sku, unit: s.unit, hppSatuan: s.hppSatuan, hargaJual: s.harga,
        marginSatuan,
        marginPersen: s.omzetSku > 0 ? Math.round(((s.kontribusi / s.omzetSku) * 100) * 10) / 10 : 0,
        kontribusi: s.kontribusi,
      };
    })
    .sort((a, b) => b.kontribusi - a.kontribusi);

  return {
    jml_order, jml_baris, omzet, hpp, biaya, laba: omzet - hpp - biaya,
    tolak, rincian, peringatan: [...peringatanSet], jml_baris_belum_terpetakan,
  };
}
