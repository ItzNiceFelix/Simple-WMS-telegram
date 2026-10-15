// lib/d1/elemenDesain.ts — Pustaka ELEMEN VEKTOR editor (migrasi 0036).
//
// KENAPA TABEL BARU, bukan menumpang `ai_latar`:
//   `ai_latar` menyimpan raster base64 (bisa megabita). Elemen di sini adalah SVG —
//   teks markup beberapa KB. Menyatukannya berarti setiap daftar elemen ikut menarik
//   kolom base64 dan kuota baca D1 terbakar untuk data yang tidak dipakai (alasan yang
//   sama dengan pemisahan ai_desain/ai_latar di 0028).
//
// KENAPA MARKUP DISIMPAN DUA KALI (`svg` DAN `elemen_json`):
//   `svg` adalah sumber yang dibaca manusia dan bisa dipakai ulang di luar aplikasi.
//   `elemen_json` adalah bentuk KANONIK yang benar-benar disisipkan ke kanvas. Kalau
//   klien harus menafsir markup SVG setiap kali menyisipkan, satu perubahan parser
//   mengubah hasil pada desain lama. Bentuk kanonik menyimpan apa yang benar-benar
//   digambar, jadi desain yang sudah disimpan tidak pernah berubah tampilannya.
//
// BATAS UKURAN — `MAKS_ELEMEN_BYTE` dihitung dari `MAKS_DOKUMEN` (256 KB, lib/d1/desain.ts):
//   Elemen yang disisipkan masuk ke `ai_desain.dokumen_json`. Satu elemen 64 KB sudah
//   memakan seperempat kuota dokumen, dan desain nyata berisi 20–60 elemen. Karena itu
//   di sini batasnya 64 KB — bukan karena DB tidak sanggup, tapi karena dokumen yang
//   dihasilkan harus masih bisa disimpan.
import { gagal, sekarang, type Hasil } from "./hasil";
import { UKURAN_ELEMEN_BAWAAN } from "@/lib/desain/skemaOperasi";
import type { ElemenLayout } from "@/lib/desain/skemaLayout";
import { FONT_AMAN, PALET_WARNA } from "@/lib/desain/skemaLayout";

/** Kategori elemen. Dipakai picker untuk mengelompokkan, bukan untuk izin. */
export const KATEGORI_ELEMEN = ["bentuk", "ikon", "panah", "hiasan"] as const;
export type KategoriElemen = (typeof KATEGORI_ELEMEN)[number];

/** Batas satu elemen (byte). Lihat catatan MAKS_DOKUMEN di atas berkas. */
export const MAKS_ELEMEN_BYTE = 64 * 1024;
/** Batas nama elemen — melindungi UI dari nama sepanjang novel (sama dengan MAKS_NAMA desain). */
const MAKS_NAMA = 120;
/** Batas markup SVG yang diterima; lebih besar dari MAKS_ELEMEN_BYTE supaya markup mentah
 *  yang belum dinormalkan masih bisa ditolak dengan pesan yang benar (bukan 500). */
const MAKS_SVG = 256 * 1024;
const MAKS_LIMIT = 200;

export type ElemenRingkas = {
  id: number;
  nama: string;
  kategori: string;
  byte: number;
  folder_id: number | null;
  at: number;
  oleh: string | null;
};

export type ElemenPenuh = ElemenRingkas & { svg: string; elemen_json: string };

const KOLOM_RINGKAS = "id, nama, kategori, byte, folder_id, at, oleh";

function namaBersih(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!s) return null;
  return s.slice(0, MAKS_NAMA);
}

function batasi(v: unknown, min: number, maks: number, bawaan: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(maks, Math.max(min, Math.trunc(n))) : bawaan;
}

/**
 * Tebak `ElemenLayout` dari markup SVG. Ini JALUR CADANGAN untuk elemen yang
 * disimpan sebelum klien mengirim bentuk kanoniknya; `elemen_json` yang ada SELALU
 * menang. Sengaja sederhana: yang dicari hanya kotak (`viewBox`) dan warna pertama —
 * menafsirkan SVG secara umum berarti menulis parser di server, dan hasil parser itulah
 * yang justru tidak stabil antar versi (lihat catatan berkas).
 */
function elemenDariSvg(svg: string): ElemenLayout {
  const vb = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  const angkaVb = vb ? vb[1]!.trim().split(/[\s,]+/).map(Number) : [];
  const lebar = angkaVb.length === 4 && Number.isFinite(angkaVb[2]) ? angkaVb[2]! : UKURAN_ELEMEN_BAWAAN;
  const tinggi = angkaVb.length === 4 && Number.isFinite(angkaVb[3]) ? angkaVb[3]! : UKURAN_ELEMEN_BAWAAN;
  const isi = (svg.match(/(?:fill|stroke)\s*=\s*"(#[0-9a-fA-F]{6})"/) ?? [])[1];
  return {
    id: "",
    // Elemen pustaka digambar sebagai bentuk (Rect/Path), bukan teks/gambar.
    jenis: "persegi",
    x: 0,
    y: 0,
    w: lebar,
    h: tinggi,
    warna: isi && PALET_WARNA.includes(isi) ? isi : PALET_WARNA[0],
    font: FONT_AMAN[0],
  };
}

/** Bentuk kanonik elemen: pakai `elemen` kiriman klien bila bentuknya masuk akal, jika tidak tebak dari SVG. */
function kanonikDari(svg: string, elemen: unknown): ElemenLayout {
  if (typeof elemen === "object" && elemen !== null && !Array.isArray(elemen)) {
    const e = elemen as Record<string, unknown>;
    const w = Number(e.w);
    const h = Number(e.h);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return {
        id: "",
        // Bentuk kanonik elemen pustaka selalu digambar sebagai persegi/lingkaran/garis;
        // `JenisElemen` (lib/desain/skemaLayout.ts) tidak punya anggota "bentuk" — kategori
        // pustaka ("ikon", "panah") adalah pengelompokan UI, BUKAN jenis render.
        jenis: e.jenis === "lingkaran" || e.jenis === "garis" || e.jenis === "teks" ? e.jenis : "persegi",
        x: 0,
        y: 0,
        w,
        h,
        ...(typeof e.warna === "string" && PALET_WARNA.includes(e.warna) ? { warna: e.warna } : {}),
        ...(typeof e.font === "string" && FONT_AMAN.includes(e.font) ? { font: e.font } : {}),
      };
    }
  }
  return elemenDariSvg(svg);
}

export async function daftarElemen(
  db: D1Database,
  presetId: number,
  filter: { kategori?: string; q?: string; limit?: number } = {}
): Promise<ElemenRingkas[]> {
  const where = ["preset_id = ?"];
  const bind: (string | number)[] = [presetId];
  const kategori = String(filter.kategori ?? "").trim();
  if (kategori && (KATEGORI_ELEMEN as readonly string[]).includes(kategori)) {
    where.push("kategori = ?");
    bind.push(kategori);
  }
  const q = String(filter.q ?? "").trim();
  if (q) {
    where.push("nama LIKE ?");
    bind.push(`%${q}%`);
  }
  bind.push(batasi(filter.limit, 1, MAKS_LIMIT, MAKS_LIMIT));
  const { results } = await db
    .prepare(`SELECT ${KOLOM_RINGKAS} FROM ai_elemen WHERE ${where.join(" AND ")} ORDER BY at DESC LIMIT ?`)
    .bind(...bind)
    .all<ElemenRingkas>();
  return results ?? [];
}

/** Elemen penuh termasuk `svg` + `elemen_json`. null bila tidak ada / preset lain. */
export async function ambilElemen(db: D1Database, presetId: number, id: number): Promise<ElemenPenuh | null> {
  const r = await db
    .prepare(`SELECT ${KOLOM_RINGKAS}, svg, elemen_json FROM ai_elemen WHERE id = ? AND preset_id = ?`)
    .bind(id, presetId)
    .first<ElemenPenuh>();
  return r ?? null;
}

export type InputElemen = {
  id?: number;
  nama?: unknown;
  kategori?: unknown;
  svg?: unknown;
  elemen?: unknown;
  folder_id?: number | null;
  oleh?: string | null;
};

/**
 * Simpan elemen baru atau perbarui yang lama (`id` ada = update).
 * Batas ukuran dan bentuk diperiksa DI SINI (bukan di route) supaya jalur tulis lain
 * tidak bisa menyelipkan elemen raksasa yang membuat dokumennya mustahil disimpan.
 */
export async function simpanElemen(
  db: D1Database,
  presetId: number,
  data: InputElemen
): Promise<Hasil<{ id: number }>> {
  const svg = typeof data.svg === "string" ? data.svg.trim() : "";
  if (!svg) return gagal(400, "Markup SVG elemen kosong.");
  if (svg.length > MAKS_SVG) return gagal(413, `Markup SVG terlalu besar (maks ${Math.trunc(MAKS_SVG / 1024)} KB).`);
  // Hanya markup SVG yang diterima: sesuatu yang menyebut <script> tidak boleh masuk
  // pustaka yang nanti dirender di kanvas (dan bisa dipakai ulang lintas user preset).
  if (!/<svg[\s>]/i.test(svg) || /<script[\s>]/i.test(svg)) {
    return gagal(400, "Elemen harus markup <svg> tanpa <script>.");
  }

  const kanonik = kanonikDari(svg, data.elemen);
  const elemenJson = JSON.stringify(kanonik);
  const byte = svg.length + elemenJson.length;
  if (byte > MAKS_ELEMEN_BYTE) {
    return gagal(413, `Elemen terlalu besar untuk dokumen (maks ${Math.trunc(MAKS_ELEMEN_BYTE / 1024)} KB).`);
  }

  const kategori = String(data.kategori ?? "").trim();
  const kategoriSah = (KATEGORI_ELEMEN as readonly string[]).includes(kategori) ? kategori : "bentuk";
  const at = sekarang();
  const nama = namaBersih(data.nama) ?? "Elemen";

  if (data.id === undefined) {
    const r = await db
      .prepare(
        "INSERT INTO ai_elemen (preset_id, folder_id, nama, kategori, svg, elemen_json, byte, at, oleh) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
      )
      .bind(presetId, data.folder_id ?? null, nama, kategoriSah, svg, elemenJson, byte, at, data.oleh ?? null)
      .first<{ id: number }>();
    if (!r) return gagal(500, "Gagal menyimpan elemen");
    return { ok: true, id: r.id };
  }

  const r = await db
    .prepare(
      "UPDATE ai_elemen SET nama = ?, kategori = ?, svg = ?, elemen_json = ?, byte = ?, folder_id = ? " +
        "WHERE id = ? AND preset_id = ?",
    )
    .bind(nama, kategoriSah, svg, elemenJson, byte, data.folder_id ?? null, data.id, presetId)
    .run();
  if (!r.meta.changes) return gagal(404, "Elemen tidak ditemukan");
  return { ok: true, id: data.id };
}

export async function hapusElemen(db: D1Database, presetId: number, id: number): Promise<Hasil<{ id: number }>> {
  const r = await db.prepare("DELETE FROM ai_elemen WHERE id = ? AND preset_id = ?").bind(id, presetId).run();
  if (!r.meta.changes) return gagal(404, "Elemen tidak ditemukan");
  return { ok: true, id };
}
