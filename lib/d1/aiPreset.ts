// lib/d1/aiPreset.ts — Preset prompt untuk image gen (foto produk listing).
// Preset awal disetel untuk kebutuhan Shopee/Tokopedia: latar bersih, produk jelas.
import { gagal, sekarang, type Hasil } from "./hasil";

export type PresetPrompt = {
  id: number;
  nama: string;
  kategori: string;
  prompt: string;
  urutan: number;
  aktif: number;
  dibuat_at: number;
};

const KOLOM = "id, nama, kategori, prompt, urutan, aktif, dibuat_at";

export async function daftarPreset(db: D1Database, kategori?: string, hanyaAktif = false): Promise<PresetPrompt[]> {
  const syarat: string[] = [];
  const args: unknown[] = [];
  if (kategori) { syarat.push("kategori = ?"); args.push(kategori); }
  if (hanyaAktif) syarat.push("aktif = 1");
  const sql = `SELECT ${KOLOM} FROM ai_preset_prompt${syarat.length ? ` WHERE ${syarat.join(" AND ")}` : ""} ORDER BY kategori, urutan, id`;
  const { results } = await db.prepare(sql).bind(...args).all<PresetPrompt>();
  return results ?? [];
}

export async function tambahPreset(
  db: D1Database,
  data: { nama: string; prompt: string; kategori?: string; urutan?: number }
): Promise<Hasil<{ preset: PresetPrompt }>> {
  const nama = String(data.nama ?? "").trim().slice(0, 80);
  const prompt = String(data.prompt ?? "").trim();
  if (!nama) return gagal(400, "Nama preset wajib diisi.");
  if (!prompt) return gagal(400, "Isi prompt wajib diisi.");
  const r = await db
    .prepare("INSERT INTO ai_preset_prompt (nama, kategori, prompt, urutan, aktif, dibuat_at) VALUES (?, ?, ?, ?, 1, ?)")
    .bind(nama, String(data.kategori ?? "produk").trim() || "produk", prompt, data.urutan ?? 0, sekarang())
    .run();
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_preset_prompt WHERE id = ?`).bind(Number(r.meta.last_row_id)).first<PresetPrompt>();
  if (!baris) return gagal(500, "Gagal menyimpan preset.");
  return { ok: true, preset: baris };
}

export async function ubahPreset(
  db: D1Database,
  id: number,
  data: { nama?: string; prompt?: string; kategori?: string; urutan?: number; aktif?: boolean }
): Promise<Hasil<{ preset: PresetPrompt }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const ada = await db.prepare(`SELECT ${KOLOM} FROM ai_preset_prompt WHERE id = ?`).bind(id).first<PresetPrompt>();
  if (!ada) return gagal(404, "Preset tidak ditemukan.");
  const sesudah = {
    nama: data.nama !== undefined ? String(data.nama).trim().slice(0, 80) : ada.nama,
    prompt: data.prompt !== undefined ? String(data.prompt).trim() : ada.prompt,
    kategori: data.kategori !== undefined ? String(data.kategori).trim() || "produk" : ada.kategori,
    urutan: data.urutan !== undefined ? data.urutan : ada.urutan,
    aktif: data.aktif !== undefined ? (data.aktif ? 1 : 0) : ada.aktif,
  };
  if (!sesudah.nama) return gagal(400, "Nama preset wajib diisi.");
  if (!sesudah.prompt) return gagal(400, "Isi prompt wajib diisi.");
  await db
    .prepare("UPDATE ai_preset_prompt SET nama = ?, prompt = ?, kategori = ?, urutan = ?, aktif = ? WHERE id = ?")
    .bind(sesudah.nama, sesudah.prompt, sesudah.kategori, sesudah.urutan, sesudah.aktif, id)
    .run();
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_preset_prompt WHERE id = ?`).bind(id).first<PresetPrompt>();
  if (!baris) return gagal(500, "Gagal mengubah preset.");
  return { ok: true, preset: baris };
}

export async function hapusPreset(db: D1Database, id: number): Promise<Hasil<{ dihapus: true }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const r = await db.prepare("DELETE FROM ai_preset_prompt WHERE id = ?").bind(id).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Preset tidak ditemukan.");
  return { ok: true, dihapus: true };
}

/**
 * Seed preset awal foto produk. Idempoten: nama yang sudah ada dilewati,
 * supaya suntingan user tidak tertimpa.
 */
export const SEED_PRESET: { nama: string; kategori: string; urutan: number; prompt: string }[] = [
  {
    nama: "Latar putih bersih",
    kategori: "latar",
    urutan: 1,
    prompt: "Place the product on a pure white seamless background (#FFFFFF). Studio product photography, soft even lighting from both sides, subtle natural shadow directly under the product, sharp focus on the product, no props, no text. Keep the product exactly as it is — same shape, color, proportions, and details.",
  },
  {
    nama: "Latar kayu hangat",
    kategori: "latar",
    urutan: 2,
    prompt: "Place the product on a warm light wood table surface with a softly blurred neutral background behind it. Natural soft daylight from one side, gentle shadow, sharp focus on the product. Keep the product exactly as it is — no changes to its shape, color, or details.",
  },
  {
    nama: "Latar marmer",
    kategori: "latar",
    urutan: 3,
    prompt: "Place the product on a clean white marble surface with subtle grey veins, softly blurred background. Bright even lighting, soft reflection under the product, sharp focus. Keep the product unchanged.",
  },
  {
    nama: "Studio lighting lembut",
    kategori: "gaya",
    urutan: 4,
    prompt: "Re-light the product with professional studio lighting: large softbox from front-left, subtle fill light from right, gentle rim light to separate the product from background. No harsh shadows, no blown highlights, accurate colors. Keep the product itself unchanged.",
  },
  {
    nama: "Tanpa bayangan keras",
    kategori: "gaya",
    urutan: 5,
    prompt: "Keep the product exactly as it is but soften the shadow beneath it. Diffuse the harsh shadow into a soft natural contact shadow that grounds the product. Do not change the product, its color, or its position.",
  },
  {
    nama: "Sudut 45 derajat",
    kategori: "gaya",
    urutan: 6,
    prompt: "Show the product from a 45-degree top-down angle so its shape, depth, and dimensions are clearly visible. Clean neutral background, soft studio lighting, sharp focus. Keep the product's design, color, and proportions exactly the same.",
  },
  {
    nama: "Perbaiki pencahayaan saja",
    kategori: "gaya",
    urutan: 7,
    prompt: "Improve only the lighting and color balance of this product photo: brighten evenly, fix white balance, reduce noise, sharpen the product. Do NOT change the product's shape, color, texture, or position. Keep the original background.",
  },
  {
    nama: "Hapus latar belakang",
    kategori: "latar",
    urutan: 8,
    prompt: "Remove the background completely and replace it with pure white. Keep the product edge clean with no halo. The product itself must remain identical — same shape, color, and details.",
  },
];

export async function seedPreset(db: D1Database): Promise<{ jumlah: number }> {
  for (const p of SEED_PRESET) {
    const ada = await db.prepare("SELECT id FROM ai_preset_prompt WHERE nama = ?").bind(p.nama).first<{ id: number }>();
    if (ada) continue;
    await tambahPreset(db, { nama: p.nama, kategori: p.kategori, prompt: p.prompt, urutan: p.urutan });
  }
  return { jumlah: SEED_PRESET.length };
}
