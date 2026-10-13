// lib/ai/hematToken.ts — Tiga lapis hemat token (Fase C, §3.3).
//   1. potongRiwayat      — kirim hanya N pesan terakhir, tanpa memotong pasangan assistant+tool.
//   2. pilihTool          — kirim hanya tool yang relevan dengan pesan (kata kunci DARI DB).
//   3. gabungTeksStatis   — penanda bagian statis (prompt + deklarasi tool) untuk cache prompt.
import type { BagianChat } from "@/lib/ai/http";

/**
 * Ambil `maks` pesan terakhir. Batas digeser mundur bila jatuh TEPAT setelah
 * pesan `assistant` yang punya `toolCallId` — pasangan assistant+tool tidak
 * boleh terbelah (provider menolak tool-result yatim).
 */
export function potongRiwayat(riwayat: BagianChat[], maks: number): BagianChat[] {
  if (maks <= 0) return [];
  if (riwayat.length <= maks) return riwayat.slice();
  let mulai = riwayat.length - maks;
  while (mulai > 0 && riwayat[mulai].role === "tool") mulai--;
  return riwayat.slice(mulai);
}

export type HasilPilihTool = {
  nama: string[];
  mode: "cocok" | "semua" | "tolak";
  kataCocok: string[];
};

/** Cek kata kunci sebagai SUBSTRING kata utuh (bukan sekadar awal kata). */
function adaKata(teks: string, kata: string): boolean {
  const huruf = "a-z0-9";
  let i = teks.indexOf(kata);
  while (i !== -1) {
    const sebelum = i === 0 ? "" : teks[i - 1];
    const sesudah = i + kata.length >= teks.length ? "" : teks[i + kata.length];
    const batasKiri = sebelum === "" || !new RegExp(`[${huruf}]`).test(sebelum);
    const batasKanan = sesudah === "" || !new RegExp(`[${huruf}]`).test(sesudah);
    if (batasKiri && batasKanan) return true;
    i = teks.indexOf(kata, i + 1);
  }
  return false;
}

/**
 * Pilih tool relevan dari kata kunci yang tersimpan di DB (`ai_tool_kata`).
 * Tak ada yang cocok → `saatTakCocok` menentukan: kirim semua tool aktif
 * (jaring aman) atau balas "tidak paham".
 */
export function pilihTool(
  pesan: string,
  peta: Map<string, string[]>,
  toolAktif: string[],
  saatTakCocok: "semua_tool" | "tolak"
): HasilPilihTool {
  const teks = pesan.toLowerCase();
  const nama = new Set<string>();
  const kataCocok: string[] = [];
  for (const [kata, daftarTool] of peta) {
    const k = kata.toLowerCase().trim();
    if (!k || !adaKata(teks, k)) continue;
    kataCocok.push(k);
    for (const t of daftarTool) if (toolAktif.includes(t)) nama.add(t);
  }
  if (nama.size === 0) {
    return saatTakCocok === "semua_tool"
      ? { nama: toolAktif.slice(), mode: "semua", kataCocok: [] }
      : { nama: [], mode: "tolak", kataCocok: [] };
  }
  return { nama: toolAktif.filter((t) => nama.has(t)), mode: "cocok", kataCocok };
}

/**
 * Penanda bagian statis (prompt sistem + deklarasi tool). Nilainya sengaja
 * stabil (tanpa timestamp/urutan acak) supaya provider cache prompt melihat
 * prefix yang identik antar panggilan.
 */
export function gabungTeksStatis(): string {
  return [
    "sistem: promptSistem + daftarGudangPrompt",
    "tools: daftarSpesifikasiTool(namaAktif)",
    "cache: prefix statis (tanpa waktu, tanpa data request)",
  ].join("\n");
}
