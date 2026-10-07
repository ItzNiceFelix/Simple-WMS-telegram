// lib/d1/guard.ts — Guard dobel-proses di D1 (Fase 1, paritas guardV5.js +
// draftGuard.js). Best-effort: error I/O JANGAN blokir tulis sah (pengaman
// utama = CAS transaksi). TTL 10 detik, pembanding JSON.
export const TTL_DETIK = 10;

export const SCOPE = {
  permintaan: "permintaan_gudang_guard",
  opname: "opname_gudang_guard",
  gudang: "gudang_guard",
  stokGudang: "stok_gudang_guard",
  produkOnline: "produk_online_guard",
  mutasi: "stok_mutasi_guard",
  permintaanForm: "permintaan_form_guard",
  draftKirim: "draft_kirim_guard",
} as const;

export function kunciGuard(aksi: string, uid: string): string {
  return `${aksi}:${uid}`;
}

/** Guard aktif? Dokumen ada + dalam TTL + pembanding cocok. */
export async function guardAktif(
  db: D1Database,
  scope: string,
  kunci: string,
  pembanding: Record<string, unknown> | null = null,
  now = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT payload_json, at FROM guards WHERE scope = ? AND key = ?")
      .bind(scope, kunci)
      .first<{ payload_json: string | null; at: number }>();
    if (!row || now - row.at > TTL_DETIK) return false;
    if (pembanding) {
      let data: Record<string, unknown> = {};
      try {
        data = row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : {};
      } catch {
        return false;
      }
      for (const [k, v] of Object.entries(pembanding)) {
        if (JSON.stringify(data[k]) !== JSON.stringify(v)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Tulis guard (best-effort, tangkap error di caller bila perlu). */
export async function tulisGuard(
  db: D1Database,
  scope: string,
  kunci: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await db
    .prepare("INSERT INTO guards (scope, key, payload_json, at) VALUES (?, ?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET payload_json = excluded.payload_json, at = excluded.at")
    .bind(scope, kunci, JSON.stringify(payload), Math.floor(Date.now() / 1000))
    .run();
}
