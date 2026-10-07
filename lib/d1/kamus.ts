// lib/d1/kamus.ts — Keyword notes di D1 (Fase 1, paritas keywordNotes.js).
// raw_text unik case-insensitive; dedup digabung saat migrasi.
import { gagal, sekarang, type Hasil } from "./db";

export type Keyword = {
  id: number; raw_text: string; interpreted_as: string; confidence: string;
  usage_count: number; last_used: number | null;
};

export async function catatKeyword(db: D1Database, teks: string, interpretasi: "STOK" | "MINTA" | "MINTA_SISA"): Promise<void> {
  const norm = teks.trim();
  if (!norm) return;
  const at = sekarang();
  await db
    .prepare(`INSERT INTO keyword_notes (raw_text, interpreted_as, confidence, usage_count, first_seen, last_used)
      VALUES (?, ?, 'guessed', 1, ?, ?)
      ON CONFLICT(raw_text) DO UPDATE SET usage_count = usage_count + 1, last_used = excluded.last_used`)
    .bind(norm, interpretasi, at, at)
    .run();
}

export async function listKeywords(db: D1Database, limit = 200): Promise<Keyword[]> {
  const { results } = await db
    .prepare("SELECT id, raw_text, interpreted_as, confidence, usage_count, last_used FROM keyword_notes ORDER BY last_used DESC NULLS LAST LIMIT ?")
    .bind(Math.min(limit, 500))
    .all<Keyword>();
  return results;
}

export async function konfirmasiKeyword(db: D1Database, id: number, interpretasi: "STOK" | "MINTA" | "MINTA_SISA", oleh: string | null): Promise<Hasil<{ keyword: Keyword }>> {
  const at = sekarang();
  const r = await db
    .prepare("UPDATE keyword_notes SET interpreted_as = ?, confidence = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?")
    .bind(interpretasi, oleh, at, id)
    .run();
  if ((r.meta.changes ?? 0) !== 1) return gagal(404, "Penanda tidak ditemukan.");
  const keyword = await db.prepare("SELECT id, raw_text, interpreted_as, confidence, usage_count, last_used FROM keyword_notes WHERE id = ?").bind(id).first<Keyword>();
  if (!keyword) return gagal(500, "Gagal membaca penanda.");
  return { ok: true, keyword };
}
