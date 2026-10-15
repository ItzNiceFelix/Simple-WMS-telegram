// lib/d1/aiEditorSetting.ts — Setting AI EDITOR per user (migrasi 0036 + 0037).
//
// Editor dulu memanggil AI tanpa reasoning/maks_token/model sama sekali
// (app/api/desain/layout/route.ts). Berkas ini menutup itu dengan pola yang SAMA
// seperti lib/d1/aiAnalisaSetting.ts + lib/d1/aiGambarSetting.ts: satu baris per tg_id,
// jalur baca TIDAK pernah insert (default dikembalikan di memori).
//
// MODEL (0037): kolom `model_editor` menyimpan pilihan model MILIK USER, bukan hanya
// reasoning + plafon token. Sebelumnya editor selalu memakai model teks GLOBAL — model
// yang owner tetapkan untuk bot chat. Izinnya tetap milik owner: allowlist `teks` per role
// diperiksa di lib/ai/provider.ts saat model dipanggil, bukan di berkas ini.
//
// KENAPA `maks_token` ADA DI SINI (padahal editor "cuma" menghasilkan JSON):
//   Keluaran editor adalah skrip canvas-op yang panjangnya tidak bisa ditebak dari
//   kalimat permintaan user. Tanpa plafon, permintaan panjang bisa meminta lebih banyak
//   token daripada yang sanggup dikirim penyedia, dan penyedia TIDAK selalu membalas
//   error — sebagian membalas 200 dengan JSON yang TERPOTONG. JSON terpotong bukan
//   "hasil sebagian", ia tidak bisa di-parse sama sekali, jadi tokennya terbayar penuh
//   untuk hasil yang tidak bisa dipakai. Plafon 8000 (lebih ketat dari analisa) dipilih
//   karena skrip 20–40 op masih jauh di bawah itu.
import { gagal, sekarang, type Hasil } from "./hasil";

export type EditorSetting = {
  tg_id: string;
  /**
   * Model teks pilihan user untuk editor (migrasi 0037). `''` = ikut model teks GLOBAL.
   * Disimpan sebagai `"provider\u0000model_id"` (bentuk kunci yang sama dengan himpunan
   * izin, lihat lib/d1/aiIzinModel.ts) supaya:
   *   - provider pembawa model tidak perlu ditebak dari rantai saat pemakaian, dan
   *   - izin bisa diperiksa di server TANPA kueri tambahan (kunci yang sama persis).
   * Izinnya sendiri (`teks`) diperiksa ulang saat benar-benar dipanggil di
   * lib/ai/provider.ts — menyimpan di sini TIDAK berarti boleh dipakai selamanya.
   */
  model_editor: string;
  reasoning: string;
  maks_token: number;
};

export const DEFAULT_SETTING: Omit<EditorSetting, "tg_id"> = {
  model_editor: "",
  reasoning: "",
  maks_token: 8000,
};

/** Batas plafon token editor. Bawah: skrip pendek terpotong. Atas: sudah tidak masuk akal untuk JSON. */
export const MAKS_TOKEN_MIN = 512;
export const MAKS_TOKEN_MAKS = 32000;

const KOLOM = "tg_id, model_editor, reasoning, maks_token";

export async function ambilSettingEditor(db: D1Database, tgId: string): Promise<EditorSetting> {
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_editor_setting WHERE tg_id = ?`).bind(tgId).first<EditorSetting>();
  return baris ?? { tg_id: tgId, ...DEFAULT_SETTING };
}

export async function simpanSettingEditor(
  db: D1Database,
  tgId: string,
  patch: { model_editor?: unknown; reasoning?: unknown; maks_token?: unknown }
): Promise<Hasil<{ setting: EditorSetting }>> {
  const lama = await ambilSettingEditor(db, tgId);
  // Model pilihan user (migrasi 0037). Yang divalidasi di sini hanya BENTUK kuncinya;
  // keizinan modelnya milik lib/ai/provider.ts (satu tempat, semua jalur AI) — memeriksa
  // izin di sini juga berarti izin bisa dicabut owner tanpa efek apa pun sampai user
  // menyimpan ulang panelnya.
  const model_editor = String(patch.model_editor ?? lama.model_editor ?? "").trim().slice(0, 200);
  if (model_editor.includes("\n")) {
    return gagal(400, "Model editor tidak sah.");
  }
  // Nilai reasoning adalah nama tingkat milik provider ('low','high','minimal',…) —
  // polanya sama dengan dua setting AI lain, jadi validasinya sama persis.
  const reasoning = String(patch.reasoning ?? lama.reasoning ?? "").trim();
  if (!/^[a-z_]{0,20}$/.test(reasoning)) {
    return gagal(400, "Nilai reasoning tidak sah (hanya huruf kecil/garis bawah, maks 20 karakter).");
  }
  const maks_token = patch.maks_token === undefined ? lama.maks_token : Number(patch.maks_token);
  if (!Number.isInteger(maks_token) || maks_token < MAKS_TOKEN_MIN || maks_token > MAKS_TOKEN_MAKS) {
    return gagal(400, `maks_token harus bilangan bulat ${MAKS_TOKEN_MIN}–${MAKS_TOKEN_MAKS}.`);
  }

  await db
    .prepare(
      "INSERT INTO ai_editor_setting (tg_id, model_editor, reasoning, maks_token, diperbarui_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(tg_id) DO UPDATE SET model_editor = excluded.model_editor, reasoning = excluded.reasoning, " +
        "maks_token = excluded.maks_token, diperbarui_at = excluded.diperbarui_at"
    )
    .bind(tgId, model_editor, reasoning, maks_token, sekarang())
    .run();
  return { ok: true, setting: await ambilSettingEditor(db, tgId) };
}
