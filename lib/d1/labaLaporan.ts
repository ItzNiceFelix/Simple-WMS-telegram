// lib/d1/labaLaporan.ts — Lapis 3: laporan overlap + export CSV per No (registry laba_order).
// Read-only. Tidak mengubah skema, mesin hitung, ataupun mode simpan Lapis 1/2.
export type BarisOverlap = {
  no_pesanan: string; tanggal_list: string[]; jumlah_snapshot: number;
  omzet_total: number; laba_total: number; selisih_omzet: number;
  /** false = No tak ada di registry (mis. registry sudah di-timpa); angka omzet/laba dianggap 0. */
  ada_di_registry: boolean;
};

type BarisRegistry = {
  no_pesanan: string; tanggal_snapshot: string; tanggal_pesanan: string; status_pesanan: string;
  omzet: number; hpp: number; biaya: number; pajak: number; laba: number;
};

export const MAKS_OVERLAP = 200;
export const KOLOM_CSV = ["no_pesanan", "tanggal_snapshot", "tanggal_pesanan", "status_pesanan", "omzet", "hpp", "biaya", "pajak", "laba"] as const;

/** Bungkus sel CSV: kutip ganda digandakan + sel berisiko (koma/kutip/newline) dikutip. */
export function selCsv(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const perlu = /[",\r\n]/.test(s) || s !== s.trim();
  return perlu ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV per No (satu baris per No di registry, bukan agregat SKU). CRLF + header. */
export function barisCsv(rows: BarisRegistry[]): string {
  const baris = [KOLOM_CSV.join(",")];
  for (const r of rows) {
    baris.push([
      selCsv(r.no_pesanan), selCsv(r.tanggal_snapshot), selCsv(r.tanggal_pesanan), selCsv(r.status_pesanan),
      selCsv(r.omzet), selCsv(r.hpp), selCsv(r.biaya), selCsv(r.pajak), selCsv(r.laba),
    ].join(","));
  }
  return `${baris.join("\r\n")}\r\n`;
}

/** Baca no_json toleran: kolom bisa string JSON, sudah array (driver), atau tak ada → []. */
function bacaJsonArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string" || v === "") return [];
  try {
    const p: unknown = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function bacaBaris(rows: BarisRegistry[]): BarisRegistry[] {
  return rows.map((r) => ({
    no_pesanan: String(r.no_pesanan ?? ""),
    tanggal_snapshot: String(r.tanggal_snapshot ?? ""),
    tanggal_pesanan: String(r.tanggal_pesanan ?? ""),
    status_pesanan: String(r.status_pesanan ?? ""),
    omzet: Number(r.omzet ?? 0),
    hpp: Number(r.hpp ?? 0),
    biaya: Number(r.biaya ?? 0),
    pajak: Number(r.pajak ?? 0),
    laba: Number(r.laba ?? 0),
  }));
}

/** Baris registry per No pada rentang tanggal_snapshot (urut No, lalu tanggal). */
export async function daftarPerNo(db: D1Database, presetId: number, dari: string, sampai: string): Promise<BarisRegistry[]> {
  const r = await db.prepare(
    "SELECT no_pesanan, tanggal_snapshot, tanggal_pesanan, status_pesanan, omzet, hpp, biaya, pajak, laba " +
    "FROM laba_order WHERE preset_id = ? AND tanggal_snapshot >= ? AND tanggal_snapshot <= ? ORDER BY no_pesanan"
  ).bind(presetId, dari, sampai).all<BarisRegistry>();
  return bacaBaris(r.results ?? []);
}

/** No. Pesanan muncul di >1 tanggal snapshot dalam rentang (overlap = hitung ulang dobel).
 *  Sumber: laba_snapshot.no_json (daftar No per tanggal, migrasi 0018) — registry laba_order
 *  ber-PK (preset_id, no_pesanan) sehingga hanya menyimpan SATU baris per No (tak bisa dipakai
 *  untuk deteksi lintas tanggal). Snapshot lama tanpa no_json bernilai '[]' → tak terdeteksi. */
export async function cariOverlap(
  db: D1Database, presetId: number, dari: string, sampai: string, maks = MAKS_OVERLAP
): Promise<{ jml_overlap: number; batas: number; daftar: BarisOverlap[]; jml_snapshot_tanpa_daftar: number }> {
  // Rentang 90 hari ≈ ≤90 baris snapshot → baca langsung, tanpa query IN.
  const snap = await db.prepare(
    "SELECT tanggal, no_json FROM laba_snapshot WHERE preset_id = ? AND tanggal >= ? AND tanggal <= ? ORDER BY tanggal"
  ).bind(presetId, dari, sampai).all<{ tanggal: string; no_json: string }>();

  const hariPerNo = new Map<string, string[]>();
  let tanpaDaftar = 0;
  for (const s of snap.results ?? []) {
    const no = Array.isArray(s.no_json) ? (s.no_json as unknown[]) : bacaJsonArray(s.no_json);
    if (no.length === 0) {
      tanpaDaftar += 1;
      continue;
    }
    const tanggal = String(s.tanggal);
    for (const raw of no) {
      const kunci = String(raw);
      const hari = hariPerNo.get(kunci) ?? [];
      if (!hari.includes(tanggal)) hari.push(tanggal);
      hariPerNo.set(kunci, hari);
    }
  }
  const dobel = [...hariPerNo.entries()]
    .filter(([, hari]) => hari.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, maks);
  if (dobel.length === 0) return { jml_overlap: 0, batas: maks, daftar: [], jml_snapshot_tanpa_daftar: tanpaDaftar };

  // Angka dari registry (snapshot terakhir per No); No yang tak ada di registry → 0 + ditandai.
  const angka = new Map<string, { omzet: number; laba: number }>();
  for (let i = 0; i < dobel.length; i += 50) {
    const potong = dobel.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const r = await db.prepare(
      "SELECT no_pesanan, omzet, laba FROM laba_order " +
      `WHERE preset_id = ? AND no_pesanan IN (${tanda})`
    ).bind(presetId, ...potong.map((x) => x[0])).all<{ no_pesanan: string; omzet: number; laba: number }>();
    for (const x of r.results ?? []) angka.set(String(x.no_pesanan), { omzet: Number(x.omzet ?? 0), laba: Number(x.laba ?? 0) });
  }
  const daftar = dobel.map(([no_pesanan, hari]) => {
    const a = angka.get(no_pesanan);
    return {
      no_pesanan,
      tanggal_list: [...hari].sort(),
      jumlah_snapshot: hari.length,
      omzet_total: a?.omzet ?? 0,
      laba_total: a?.laba ?? 0,
      // Perkiraan omzet dobel: (jumlah snapshot - 1) × omzet yang tersimpan di registry.
      selisih_omzet: (hari.length - 1) * (a?.omzet ?? 0),
      ada_di_registry: a !== undefined,
    };
  });
  return { jml_overlap: daftar.length, batas: maks, daftar, jml_snapshot_tanpa_daftar: tanpaDaftar };
}
