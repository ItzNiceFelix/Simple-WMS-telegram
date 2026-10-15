// lib/d1/aiAnalisaSetting.ts — Setting analisa mendalam PER USER.
// Satu baris per tg_id: tiap user punya reasoning + plafon token + kedalaman sendiri.
// Jalur baca TIDAK pernah insert (default dikembalikan di memori) supaya halaman
// tidak menulis DB hanya karena dibuka.
import { gagal, sekarang, type Hasil } from "./hasil";
// Konstanta tinggal di modul tanpa-import supaya klien bisa memakainya tanpa menyalin.
import { KEDALAMAN_SAH, MAKS_TOKEN_MIN, MAKS_TOKEN_MAKS } from "@/lib/analisa/tipe";

export type AnalisaSetting = {
  tg_id: string;
  reasoning: string;
  maks_token: number;
  kedalaman: string;
};

export const DEFAULT_SETTING: Omit<AnalisaSetting, "tg_id"> = {
  reasoning: "",
  maks_token: 16000,
  kedalaman: "sedang",
};

/** Kedalaman sah — hanya mengubah panjang INSTRUKSI, tidak memotong output. */

/** Batas plafon token. Terlalu kecil = jawaban terpotong; terlalu besar = cuma jadi plafon, bukan izin. */

const KOLOM = "tg_id, reasoning, maks_token, kedalaman";

export async function ambilSettingAnalisa(db: D1Database, tgId: string): Promise<AnalisaSetting> {
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_analisa_setting WHERE tg_id = ?`).bind(tgId).first<AnalisaSetting>();
  return baris ?? { tg_id: tgId, ...DEFAULT_SETTING };
}

export async function simpanSettingAnalisa(
  db: D1Database,
  tgId: string,
  patch: { reasoning?: unknown; maks_token?: unknown; kedalaman?: unknown }
): Promise<Hasil<{ setting: AnalisaSetting }>> {
  const lama = await ambilSettingAnalisa(db, tgId);
  const reasoning = String(patch.reasoning ?? lama.reasoning ?? "").trim();
  if (!/^[a-z_]{0,20}$/.test(reasoning)) {
    return gagal(400, "Nilai reasoning tidak sah (hanya huruf kecil/garis bawah, maks 20 karakter).");
  }
  const maks_token = patch.maks_token === undefined ? lama.maks_token : Number(patch.maks_token);
  if (!Number.isInteger(maks_token) || maks_token < MAKS_TOKEN_MIN || maks_token > MAKS_TOKEN_MAKS) {
    return gagal(400, `maks_token harus bilangan bulat ${MAKS_TOKEN_MIN}–${MAKS_TOKEN_MAKS}.`);
  }
  const kedalaman = String(patch.kedalaman ?? lama.kedalaman ?? DEFAULT_SETTING.kedalaman).trim();
  if (!(KEDALAMAN_SAH as readonly string[]).includes(kedalaman)) {
    return gagal(400, `Kedalaman tidak sah. Pilihan: ${KEDALAMAN_SAH.join(", ")}.`);
  }

  await db
    .prepare(
      "INSERT INTO ai_analisa_setting (tg_id, reasoning, maks_token, kedalaman, diperbarui_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(tg_id) DO UPDATE SET reasoning = excluded.reasoning, maks_token = excluded.maks_token, " +
        "kedalaman = excluded.kedalaman, diperbarui_at = excluded.diperbarui_at"
    )
    .bind(tgId, reasoning, maks_token, kedalaman, sekarang())
    .run();
  return { ok: true, setting: await ambilSettingAnalisa(db, tgId) };
}
