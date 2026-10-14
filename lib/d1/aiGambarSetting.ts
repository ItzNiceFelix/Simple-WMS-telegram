// lib/d1/aiGambarSetting.ts — Setting halaman gambar PER USER.
// Satu baris per tg_id: tiap user punya model + reasoning + rasio + jumlah sendiri.
// Jalur baca TIDAK pernah insert (default dikembalikan di memori) supaya halaman
// tidak menulis DB hanya karena dibuka.
import { gagal, sekarang, type Hasil } from "./hasil";

export type GambarSetting = {
  tg_id: string;
  provider: string;
  model_id: string;
  reasoning: string;
  aspek_rasio: string;
  jumlah: number;
};

export const DEFAULT_SETTING: Omit<GambarSetting, "tg_id"> = {
  provider: "gemini",
  model_id: "",
  reasoning: "",
  aspek_rasio: "1:1",
  jumlah: 1,
};

/** Rasio sah — nilai lain ditolak (jaga-jaga; sebagian provider hanya dukung 1:1/16:9). */
export const RASIO_SAH = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;

const KOLOM = "tg_id, provider, model_id, reasoning, aspek_rasio, jumlah";

export async function ambilSettingGambar(db: D1Database, tgId: string): Promise<GambarSetting> {
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_gambar_setting WHERE tg_id = ?`).bind(tgId).first<GambarSetting>();
  return baris ?? { tg_id: tgId, ...DEFAULT_SETTING };
}

export async function simpanSettingGambar(
  db: D1Database,
  tgId: string,
  patch: { provider?: unknown; model_id?: unknown; reasoning?: unknown; aspek_rasio?: unknown; jumlah?: unknown }
): Promise<Hasil<{ setting: GambarSetting }>> {
  const lama = await ambilSettingGambar(db, tgId);
  const provider = String(patch.provider ?? lama.provider ?? "").trim() || DEFAULT_SETTING.provider;
  const model_id = String(patch.model_id ?? lama.model_id ?? "").trim().slice(0, 120);
  const reasoning = String(patch.reasoning ?? lama.reasoning ?? "").trim();
  if (!/^[a-z_]{0,20}$/.test(reasoning)) {
    return gagal(400, "Nilai reasoning tidak sah (hanya huruf kecil/garis bawah, maks 20 karakter).");
  }
  const aspek_rasio = String(patch.aspek_rasio ?? lama.aspek_rasio ?? DEFAULT_SETTING.aspek_rasio).trim();
  if (!(RASIO_SAH as readonly string[]).includes(aspek_rasio)) {
    return gagal(400, `Aspek rasio tidak sah. Pilihan: ${RASIO_SAH.join(", ")}.`);
  }
  const n = patch.jumlah === undefined ? lama.jumlah : Number(patch.jumlah);
  if (!Number.isInteger(n) || n < 1 || n > 4) return gagal(400, "Jumlah gambar harus 1–4.");

  await db
    .prepare(
      "INSERT INTO ai_gambar_setting (tg_id, provider, model_id, reasoning, aspek_rasio, jumlah, diperbarui_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(tg_id) DO UPDATE SET provider = excluded.provider, model_id = excluded.model_id, reasoning = excluded.reasoning, " +
        "aspek_rasio = excluded.aspek_rasio, jumlah = excluded.jumlah, diperbarui_at = excluded.diperbarui_at"
    )
    .bind(tgId, provider, model_id, reasoning, aspek_rasio, n, sekarang())
    .run();
  return { ok: true, setting: await ambilSettingGambar(db, tgId) };
}
