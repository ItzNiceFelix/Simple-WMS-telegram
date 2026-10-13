// lib/ai/areaGambar.ts — Anotasi area gambar → prompt inpainting (Fase D).
// Alur (rencana §1.5): user klik/lingkari area → model identifikasi objek di area
// itu (`box_2d` 0–1000) → label objek disusun ke template inpainting resmi.
// Koordinat klien SELALU ternormalisasi 0–1; skala 0–1000 hanya untuk model.

/** Titik di gambar, ternormalisasi 0–1 terhadap lebar/tinggi gambar. */
export type TitikGambar = { x: number; y: number };

export type AreaGambar = {
  jenis: "titik" | "lingkaran";
  pusat: TitikGambar;
  /** Radius ternormalisasi terhadap sisi terpanjang gambar. Hanya untuk `lingkaran`. */
  radius?: number;
  komentar: string;
};

const BATAS = 1000;

/** Jepit ke 0–1 lalu bulatkan ke skala 0–1000 (presisi yang dipakai model). */
const keSkala1000 = (n: number): number =>
  Math.round((Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0) * BATAS);

/**
 * Kotak `box_2d` untuk satu area, skala 0–1000 (format Gemini `[ymin, xmin, ymax, xmax]`
 * tidak dipakai di sini — fungsi ini mengembalikan bentuk bernama supaya pemanggil
 * bisa menyusun urutan mana pun yang diminta provider).
 */
export function keKoordinatGambar(area: AreaGambar): { xmin: number; ymin: number; xmax: number; ymax: number } {
  const r = area.jenis === "lingkaran" ? Math.min(1, Math.max(0, area.radius ?? 0)) : 0;
  return {
    xmin: keSkala1000(area.pusat.x - r),
    ymin: keSkala1000(area.pusat.y - r),
    xmax: keSkala1000(area.pusat.x + r),
    ymax: keSkala1000(area.pusat.y + r),
  };
}

/** Uraian area dalam bahasa manusia — dipakai saat identifikasi gagal (fallback). */
export function uraikanArea(area: AreaGambar): string {
  const k = keKoordinatGambar(area);
  const posisi = `${k.ymin <= 333 ? "atas" : k.ymin >= 667 ? "bawah" : "tengah"}-${k.xmin <= 333 ? "kiri" : k.xmin >= 667 ? "kanan" : "tengah"}`;
  return area.jenis === "lingkaran"
    ? `area di bagian ${posisi} gambar (kotak y${k.ymin}–${k.ymax}, x${k.xmin}–${k.xmax} dari 1000)`
    : `titik di bagian ${posisi} gambar (y${k.ymin}, x${k.xmin} dari 1000)`;
}

/**
 * Prompt identifikasi objek: minta model menyebut label objek di area yang
 * ditandai user + `box_2d` 0–1000. Format `box_2d` = [ymin, xmin, ymax, xmax].
 */
export function kalimatIdentifikasi(area: AreaGambar): string {
  const k = keKoordinatGambar(area);
  const bentuk =
    area.jenis === "lingkaran"
      ? `Sebuah lingkaran menandai area di gambar ini. Kotak pembatasnya: box_2d [${k.ymin}, ${k.xmin}, ${k.ymax}, ${k.xmax}] (skala 0-1000).`
      : `Sebuah titik menandai satu area di gambar ini pada koordinat y=${k.ymin}, x=${k.xmin} (skala 0-1000).`;
  return `${bentuk}
Sebutkan objek atau bagian gambar apa yang berada di area itu, sesingkat mungkin, dalam bahasa Inggris
(mis. "the shadow under the product", "the wooden table surface", "the product's left edge").
Balas HANYA JSON: {"box_2d": [ymin, xmin, ymax, xmax], "label": "..."} dengan angka skala 0-1000. Tanpa penjelasan lain.`;
}

/** Template inpainting RESMI (rencana §1.5) — jangan diubah kata-katanya. */
export function promptInpainting(labelArea: string, komentarUser: string): string {
  const area = labelArea.trim() || "the marked area";
  const ganti = komentarUser.trim() || "look better";
  return `Using the provided image, change only the ${area} to ${ganti}. Keep everything else in the image exactly the same, preserving the original style, lighting, and composition.`;
}
