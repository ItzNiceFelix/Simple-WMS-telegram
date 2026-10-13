// lib/ai/parserGambar.ts — Deteksi perintah `@gambar` di teks atau caption foto.
// Dipakai bersama jalur teks & caption supaya aturannya cuma ada di satu tempat.
export type PerintahGambar = { adaPerintah: boolean; prompt: string };

/**
 * Pesan yang DIAWALI `@gambar` (case-insensitive, boleh beda spasi setelahnya)
 * dianggap perintah gambar. Sisa teks (setelah `@gambar`) di-trim jadi prompt.
 * Pesan lain → adaPerintah false, prompt apa adanya (trim).
 */
export function parsePerintahGambar(teks: string): PerintahGambar {
  const bersih = (teks ?? "").trim();
  const cocok = /^@gambar\b/i.exec(bersih);
  if (!cocok) return { adaPerintah: false, prompt: bersih };
  return { adaPerintah: true, prompt: bersih.slice(cocok[0].length).trim() };
}
