// lib/d1/aiTool.ts — Katalog tool AI + peta kata kunci (bisa diatur dari UI).
// Tujuan: admin bisa memperbaiki pemilihan tool tanpa deploy — mis. menambah kata
// "persediaan" yang biasa dipakai, atau mematikan tool yang sudah punya UI sendiri.
import { gagal, sekarang, type Hasil } from "./hasil";

export type ToolAi = {
  nama: string;
  label: string;
  deskripsi: string;
  jenis: "baca" | "tulis";
  perlu_konfirmasi: number;
  aktif: number;
  urutan: number;
  kata: string[];
};

type BarisTool = Omit<ToolAi, "kata" | "jenis"> & { jenis: string };

const KOLOM = "nama, label, deskripsi, jenis, perlu_konfirmasi, aktif, urutan";

/** Normalisasi kata kunci: lowercase, buang tanda baca berlebih, rapikan spasi. */
export function normalKata(v: string): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/** Daftar tool + kata kuncinya (kata diurutkan, hanya yang aktif). */
export async function daftarTool(db: D1Database, hanyaAktif = false): Promise<ToolAi[]> {
  const sql = `SELECT ${KOLOM} FROM ai_tool${hanyaAktif ? " WHERE aktif = 1" : ""} ORDER BY urutan, nama`;
  const { results } = await db.prepare(sql).all<BarisTool>();
  const { results: kata } = await db
    .prepare("SELECT tool, kata FROM ai_tool_kata WHERE aktif = 1 ORDER BY urutan, kata")
    .all<{ tool: string; kata: string }>();

  const petaKata = new Map<string, string[]>();
  for (const k of kata ?? []) {
    const arr = petaKata.get(k.tool) ?? [];
    arr.push(k.kata);
    petaKata.set(k.tool, arr);
  }
  return (results ?? []).map((t) => ({
    ...t,
    jenis: t.jenis === "tulis" ? "tulis" : "baca",
    kata: petaKata.get(t.nama) ?? [],
  }));
}

/** Peta kata -> nama tool, untuk pemilihan tool selektif (hemat token). */
export async function petaKataTool(db: D1Database): Promise<Map<string, string[]>> {
  const { results } = await db
    .prepare(
      "SELECT k.kata AS kata, k.tool AS tool FROM ai_tool_kata k JOIN ai_tool t ON t.nama = k.tool " +
        "WHERE k.aktif = 1 AND t.aktif = 1 ORDER BY k.urutan"
    )
    .all<{ kata: string; tool: string }>();
  const peta = new Map<string, string[]>();
  for (const r of results ?? []) {
    const arr = peta.get(r.kata) ?? [];
    if (!arr.includes(r.tool)) arr.push(r.tool);
    peta.set(r.kata, arr);
  }
  return peta;
}

/** Tambah/ubah tool. Upsert supaya seed bisa dijalankan berulang tanpa menggandakan. */
export async function simpanTool(
  db: D1Database,
  data: { nama: string; label: string; deskripsi?: string; jenis?: string; perluKonfirmasi?: boolean; aktif?: boolean; urutan?: number }
): Promise<Hasil<{ tool: ToolAi }>> {
  const nama = String(data.nama ?? "").trim();
  if (!nama) return gagal(400, "Nama tool wajib diisi.");
  const label = String(data.label ?? "").trim() || nama;
  const jenis = data.jenis === "tulis" ? "tulis" : "baca";
  await db
    .prepare(
      "INSERT INTO ai_tool (nama, label, deskripsi, jenis, perlu_konfirmasi, aktif, urutan) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(nama) DO UPDATE SET label = excluded.label, deskripsi = excluded.deskripsi, " +
        "jenis = excluded.jenis, perlu_konfirmasi = excluded.perlu_konfirmasi, aktif = excluded.aktif, urutan = excluded.urutan"
    )
    .bind(nama, label, String(data.deskripsi ?? "").slice(0, 300), jenis, data.perluKonfirmasi ? 1 : 0, data.aktif === false ? 0 : 1, data.urutan ?? 0)
    .run();
  const semua = await daftarTool(db);
  const tool = semua.find((t) => t.nama === nama);
  if (!tool) return gagal(500, "Gagal menyimpan tool.");
  return { ok: true, tool };
}

export async function setAktifTool(db: D1Database, nama: string, aktif: boolean): Promise<Hasil<{ tool: ToolAi }>> {
  const r = await db.prepare("UPDATE ai_tool SET aktif = ? WHERE nama = ?").bind(aktif ? 1 : 0, String(nama ?? "").trim()).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Tool tidak ditemukan.");
  const semua = await daftarTool(db);
  const tool = semua.find((t) => t.nama === String(nama).trim());
  if (!tool) return gagal(404, "Tool tidak ditemukan.");
  return { ok: true, tool };
}

/** Ganti seluruh kata kunci satu tool (paling sederhana untuk UI: satu kotak isian). */
export async function setKataTool(db: D1Database, nama: string, daftarKata: string[]): Promise<Hasil<{ tool: ToolAi }>> {
  const tool = String(nama ?? "").trim();
  if (!tool) return gagal(400, "Nama tool wajib diisi.");
  const ada = await db.prepare("SELECT nama FROM ai_tool WHERE nama = ?").bind(tool).first<{ nama: string }>();
  if (!ada) return gagal(404, "Tool tidak ditemukan.");

  // Buang duplikat + kata kosong hasil normalisasi.
  const bersih = [...new Set((daftarKata ?? []).map(normalKata).filter(Boolean))];
  // Kata yang sudah dipakai tool LAIN dibiarkan: satu kata boleh memicu beberapa tool.
  await db.prepare("DELETE FROM ai_tool_kata WHERE tool = ?").bind(tool).run();
  if (bersih.length > 0) {
    const stmts = bersih.map((k, i) =>
      db.prepare("INSERT OR IGNORE INTO ai_tool_kata (tool, kata, urutan, aktif) VALUES (?, ?, ?, 1)").bind(tool, k, i)
    );
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  }
  const semua = await daftarTool(db);
  const hasil = semua.find((t) => t.nama === tool);
  if (!hasil) return gagal(500, "Gagal menyimpan kata kunci.");
  return { ok: true, tool: hasil };
}

export async function hapusTool(db: D1Database, nama: string): Promise<Hasil<{ dihapus: true }>> {
  const t = String(nama ?? "").trim();
  if (!t) return gagal(400, "Nama tool wajib diisi.");
  const r = await db.prepare("DELETE FROM ai_tool WHERE nama = ?").bind(t).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Tool tidak ditemukan.");
  await db.prepare("DELETE FROM ai_tool_kata WHERE tool = ?").bind(t).run();
  return { ok: true, dihapus: true };
}

/**
 * Seed katalog tool + kata kunci awal. Idempoten: aman dijalankan berkali-kali.
 * `simpanTool` memakai upsert, jadi tool yang sudah diubah user TIDAK ditimpa
 * kecuali `paksa` = true.
 */
export const SEED_TOOL: { nama: string; label: string; deskripsi: string; jenis: "baca" | "tulis"; perluKonfirmasi: boolean; urutan: number; kata: string[] }[] = [
  { nama: "cekStok", label: "Cek Stok", deskripsi: "Jumlah stok 1 produk di semua gudang (atau gudang tertentu bila disebut).", jenis: "baca", perluKonfirmasi: false, urutan: 1, kata: ["stok", "sisa", "ada berapa", "qty", "persediaan", "jumlah"] },
  { nama: "cariProduk", label: "Cari Produk", deskripsi: "Cari produk berdasarkan nama atau SKU.", jenis: "baca", perluKonfirmasi: false, urutan: 2, kata: ["cari", "kode", "sku", "nama produk", "produk apa"] },
  { nama: "cekProdukStokMenipis", label: "Stok Menipis", deskripsi: "Produk yang stoknya di bawah batas reorder.", jenis: "baca", perluKonfirmasi: false, urutan: 3, kata: ["menipis", "hampir habis", "reorder", "mau habis", "perlu restock"] },
  { nama: "listProdukOnline", label: "Daftar Produk Online", deskripsi: "Daftar produk online beserta stoknya.", jenis: "baca", perluKonfirmasi: false, urutan: 4, kata: ["daftar produk", "produk online", "kolam online"] },
  { nama: "daftarGudang", label: "Daftar Gudang", deskripsi: "Daftar gudang aktif beserta namanya.", jenis: "baca", perluKonfirmasi: false, urutan: 5, kata: ["gudang", "cabang", "lokasi", "daftar gudang"] },
  { nama: "tambahStok", label: "Tambah Stok", deskripsi: "Tambah jumlah stok 1 produk. WAJIB sebut gudang.", jenis: "tulis", perluKonfirmasi: true, urutan: 6, kata: ["tambah", "datang", "restock", "masuk", "barang datang"] },
  { nama: "kurangiStok", label: "Kurangi Stok", deskripsi: "Kurangi jumlah stok 1 produk. WAJIB sebut gudang.", jenis: "tulis", perluKonfirmasi: true, urutan: 7, kata: ["kurang", "koreksi", "hilang", "rusak", "selisih"] },
  { nama: "mutasiAntarGudang", label: "Pindah Stok antar Gudang", deskripsi: "Pindahkan qty dari satu gudang ke gudang lain.", jenis: "tulis", perluKonfirmasi: true, urutan: 8, kata: ["pindah", "transfer gudang", "mutasi", "kirim ke gudang"] },
  { nama: "stokBanyakProduk", label: "Cek Banyak SKU", deskripsi: "Cek stok beberapa SKU sekaligus dalam satu panggilan.", jenis: "baca", perluKonfirmasi: false, urutan: 9, kata: ["beberapa produk", "banyak sku", "cek beberapa"] },
];

/** Jalankan seed. `paksa` = true menimpa label/jenis tool yang sudah ada (kata kunci tetap tidak diubah). */
export async function seedTool(db: D1Database, paksa = false): Promise<{ jumlah: number }> {
  for (const t of SEED_TOOL) {
    const ada = await db.prepare("SELECT nama FROM ai_tool WHERE nama = ?").bind(t.nama).first<{ nama: string }>();
    if (ada && !paksa) continue;
    await simpanTool(db, {
      nama: t.nama, label: t.label, deskripsi: t.deskripsi, jenis: t.jenis,
      perluKonfirmasi: t.perluKonfirmasi, aktif: true, urutan: t.urutan,
    });
    // Kata kunci hanya diisi bila belum ada — supaya suntingan user tidak hilang.
    const hitung = await db.prepare("SELECT COUNT(*) AS n FROM ai_tool_kata WHERE tool = ?").bind(t.nama).first<{ n: number }>();
    if ((hitung?.n ?? 0) === 0) await setKataTool(db, t.nama, t.kata);
  }
  return { jumlah: SEED_TOOL.length };
}
