// lib/ai/chat.ts — Orkestrator chat AI (Fase C, §5.C5).
// Alur: susun prompt sistem → potong riwayat → pilih tool → panggil provider →
// loop tool-call sampai `maksLoopTool`. Tool tulis TIDAK dieksekusi di sini;
// dikembalikan sebagai `perluKonfirmasi` supaya bot menanyakan ya/tidak dulu.
//
// Impor nilai provider hanya lewat `./panggil` — itu pemutus siklus tipe-saja.
import { gagal, type Hasil } from "@/lib/d1/hasil";
import type { AiSettings } from "@/lib/d1/pengaturan";
import type { BagianChat } from "@/lib/ai/http";
import { listGudang } from "@/lib/d1/gudang";
import { daftarTool, petaKataTool } from "@/lib/d1/aiTool";
import { daftarSpesifikasiTool, jalankanTool, opsiGudang } from "@/lib/ai/tools";
import { daftarGudangPrompt, susunPromptSistem } from "@/lib/ai/prompt";
import { potongRiwayat, pilihTool } from "@/lib/ai/hematToken";
import { panggilTeks } from "@/lib/ai/panggil";

export type HasilChat =
  | {
      ok: true;
      balasan: string;
      perluKonfirmasi?: { aksi: string; arg: Record<string, unknown>; ringkas: string };
      tokenMasuk: number;
      tokenKeluar: number;
      provider: string;
      model: string;
    }
  | { ok: false; error: string };

export type MasukanChat = {
  pesan: string;
  riwayat: BagianChat[];
  user: { tg_id: string };
  settings: AiSettings;
  kunci: string;
  env?: { AI_KEY_ENCRYPTION_KEY?: string; KENARI_BASE_URL?: string };
};

/** Tool tulis = wajib konfirmasi. Ambil dari katalog `ai_tool`, bukan hardcode. */
async function petaToolTulis(db: D1Database): Promise<Set<string>> {
  const semua = await daftarTool(db, true);
  return new Set(semua.filter((t) => t.jenis === "tulis" || t.perlu_konfirmasi === 1).map((t) => t.nama));
}

function parseArgumen(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Orkestrator satu putaran chat. `riwayat` TIDAK memuat pesan terbaru —
 * fungsi ini yang menambahkannya, supaya pemanggil tidak pernah salah susun.
 */
export async function balasChat(db: D1Database, m: MasukanChat): Promise<HasilChat> {
  const settings = m.settings;
  const gudangAktif = await listGudang(db, false);
  const promptSistem = `${susunPromptSistem(settings)}\n\n${daftarGudangPrompt(gudangAktif.map((g) => ({ id: g.id, nama: g.nama })))}`;

  const semuaTool = await daftarTool(db, true);
  const namaAktif = semuaTool.map((t) => t.nama);
  const peta = await petaKataTool(db);
  const pilih = pilihTool(m.pesan, peta, namaAktif, settings.saatTakCocok);

  if (pilih.mode === "tolak" && pilih.nama.length === 0) {
    return {
      ok: true,
      balasan:
        "Maaf, aku belum paham maksudnya. Contoh: <code>stok 001163</code>, <code>tambah 5 001163 di D12</code>, atau <code>stok menipis</code>.",
      tokenMasuk: 0,
      tokenKeluar: 0,
      provider: "-",
      model: "-",
    };
  }

  const toolSpesifikasi = daftarSpesifikasiTool(pilih.nama);
  const riwayat = potongRiwayat(m.riwayat, settings.maksRiwayat);
  const pesan: BagianChat[] = [
    { role: "system", teks: promptSistem },
    ...riwayat,
    { role: "user", teks: m.pesan },
  ];

  const ctx = { db, kunci: m.kunci, env: m.env };
  const tulis = await petaToolTulis(db);
  let tokenMasuk = 0;
  let tokenKeluar = 0;
  let provider = "-";
  let model = "-";
  const maksLoop = settings.maksLoopTool > 0 ? settings.maksLoopTool : 5;

  for (let putaran = 0; putaran < maksLoop; putaran++) {
    const h = await panggilTeks(ctx, { pesan, tool: toolSpesifikasi.length > 0 ? toolSpesifikasi : undefined }, "teks");
    if (!h.ok) return { ok: false, error: h.error };
    tokenMasuk += h.tokenMasuk;
    tokenKeluar += h.tokenKeluar;
    provider = h.provider;
    model = h.model;

    const panggilan = h.toolCall ?? [];
    if (panggilan.length === 0) {
      return {
        ok: true,
        balasan: h.teks.trim() || "Tidak ada yang bisa kusampaikan.",
        tokenMasuk,
        tokenKeluar,
        provider,
        model,
      };
    }

    const asistenPesan: BagianChat = {
      role: "assistant",
      teks: h.teks,
      toolCallId: panggilan[0].id,
      namaTool: panggilan[0].nama,
    };

    // Tool tulis: JANGAN jalankan. Kembalikan niatnya supaya bot minta ya/tidak.
    const perluTulis = panggilan.find((p: { nama: string }) => tulis.has(p.nama));
    if (perluTulis) {
      const arg = parseArgumen(perluTulis.argumen);
      const ringkas = await ringkasAksi(db, perluTulis.nama, arg);
      return {
        ok: true,
        balasan: ringkas,
        perluKonfirmasi: { aksi: perluTulis.nama, arg, ringkas },
        tokenMasuk,
        tokenKeluar,
        provider,
        model,
      };
    }

    pesan.push(asistenPesan);
    for (const p of panggilan) {
      const arg = parseArgumen(p.argumen);
      const r: Hasil<{ hasil: unknown; ringkas: string }> = await jalankanTool(db, p.nama, arg, m.user);
      pesan.push({
        role: "tool",
        teks: r.ok ? r.ringkas : `GAGAL: ${r.error}`,
        toolCallId: p.id,
        namaTool: p.nama,
      });
    }
  }

  return {
    ok: true,
    balasan: "Terlalu banyak langkah tool. Coba tanya lebih spesifik.",
    tokenMasuk,
    tokenKeluar,
    provider,
    model,
  };
}

/**
 * Ringkasan maksud tool tulis untuk tombol konfirmasi. Memakai `jalankanTool`
 * dengan gudang yang sudah disebut; bila gudang belum disebut, jalankan tetap
 * mengembalikan pesan "ke gudang mana?" — artinya AI belum bisa dipanggil
 * sebelum admin memilih gudang.
 */
async function ringkasAksi(db: D1Database, nama: string, arg: Record<string, unknown>): Promise<string> {
  const r = await jalankanTool(db, nama, arg, { tg_id: "pratinjau" });
  if (r.ok) return r.ringkas;
  if (r.error.includes("ke gudang mana")) return `${r.error}\n\nBalas dengan kode/nama gudang, lalu ulangi perintah.`;
  return `Tidak bisa melanjutkan: ${r.error}\n\nDaftar gudang: ${await opsiGudang(db)}`;
}

/** Dipakai bot untuk menandai kegagalan sebelum pesan dikirim (cegah impor gagal yang tak terpakai). */
export const gagalChat = (error: string): HasilChat => gagal(400, error) as unknown as HasilChat;
