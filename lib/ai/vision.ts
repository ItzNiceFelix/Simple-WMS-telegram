// lib/ai/vision.ts — Ekstraksi picking list dari screenshot (vision).
// Port `lib/gemini/ekstrakPickingList.js` (stack Firestore/Node) ke D1/Workers:
// gambar dikirim lewat `panggilTeks(..., "vision")`, hasil JSON divalidasi ketat,
// baris rusak DIBUANG (bukan menggagalkan seluruh permintaan).
import type { Hasil } from "@/lib/d1/hasil";
import type { BagianChat } from "./http";
import type { Konteks } from "./provider";
import { panggilTeks } from "./panggil";

export type BarisPicking = { sku: string; nama?: string; qty: number; gudang?: string };

// Prompt khusus ekstraksi — tugasnya beda dari chat biasa: murni JSON array.
const PROMPT_EKSTRAKSI = `Kamu membaca screenshot picking list marketplace Indonesia (Shopee / TikTok Shop).
Gambar biasanya berupa tabel berisi kode SKU, nama produk, dan qty.
Tugasmu: ekstrak setiap baris jadi objek { "sku": string, "nama": string, "qty": number, "gudang": string }.
- "sku" wajib: kode SKU apa adanya dari gambar (huruf/angka, pertahankan apa adanya).
- "qty" wajib: angka > 0 hasil pembacaan kolom quantity.
- "nama" dan "gudang" opsional: isi kalau ada di gambar, kalau tidak ada biarkan "".
ABAIKAN header tabel, logo, banner promo, dan footer. Jangan mengarang baris yang tidak ada.
Balas HANYA JSON array (tanpa backtick markdown, tanpa penjelasan). Kalau gambar bukan picking list atau tidak terbaca, balas: []`;

/** Bersihkan pagar ```json ... ``` bila model tetap membungkus jawabannya. */
function bersihkanJsonFence(teks: string): string {
  return teks.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
}

/** Validasi satu baris; kembalikan null bila tidak masuk akal (drop, jangan teruskan data rusak). */
function barisValid(v: unknown): BarisPicking | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const sku = String(r.sku ?? "").trim();
  const qty = Number(r.qty);
  if (!sku || !Number.isFinite(qty) || qty <= 0) return null;
  const nama = String(r.nama ?? "").trim();
  const gudang = String(r.gudang ?? "").trim();
  return { sku, qty, ...(nama ? { nama } : {}), ...(gudang ? { gudang } : {}) };
}

/** Ambil array JSON dari jawaban model (array langsung, atau `{ baris: [...] }`). */
function keArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && "baris" in parsed && Array.isArray(parsed.baris)) return parsed.baris;
  return null;
}

export async function ekstrakPickingList(
  ctx: Konteks,
  gambar: { mime: string; base64: string }
): Promise<Hasil<{ baris: BarisPicking[]; catatan?: string }>> {
  const pesan: BagianChat[] = [{ role: "user", teks: PROMPT_EKSTRAKSI, gambar: [gambar] }];
  const r = await panggilTeks(ctx, { pesan }, "vision");
  if (!r.ok) return r;

  const teksBersih = bersihkanJsonFence(r.teks.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(teksBersih);
  } catch {
    return { ok: true, baris: [], catatan: `Balasan model bukan JSON yang sah (${r.provider}/${r.model}); tidak ada baris yang bisa dibaca.` };
  }

  const mentah = keArray(parsed);
  if (!mentah) {
    return { ok: true, baris: [], catatan: `Balasan model bukan array JSON (${r.provider}/${r.model}); tidak ada baris yang bisa dibaca.` };
  }

  const baris: BarisPicking[] = [];
  let dibuang = 0;
  for (const b of mentah) {
    const v = barisValid(b);
    if (v) baris.push(v);
    else dibuang++;
  }

  return {
    ok: true,
    baris,
    ...(dibuang > 0 ? { catatan: `${dibuang} baris dibuang karena SKU kosong atau qty tidak valid.` } : {}),
  };
}
