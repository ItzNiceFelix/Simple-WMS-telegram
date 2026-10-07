// lib/dashboard/pesan.ts
// Pesan & aksi lintas-komponen (dipakai dialog tulis v2).

/**
 * Pesan server saat cookie sesi kedaluwarsa (401). Route v2 mengirim string ini apa adanya
 * (PRD v1 §11.2); UI memakainya untuk memicu toast khusus + tombol "Buka ulang" dan
 * MEMPERTAHANKAN isian form (dialog tidak ditutup).
 */
export const SESI_KEDALUWARSA = "Sesi kedaluwarsa. Buka ulang dari Telegram.";

/** Id sesi kedaluwarsa (401) dari pesan error tulisan. */
export function sesiKedaluwarsa(pesan: string | null | undefined): boolean {
  return pesan === SESI_KEDALUWARSA;
}

/** Buka ulang Mini App dari Telegram bila memungkinkan; fallback reload. */
export function bukaUlangTelegram(): void {
  const wa = (window as unknown as { Telegram?: { WebApp?: { close?: () => void; openLink?: (u: string) => void } } })
    .Telegram?.WebApp;
  // Tidak ada API resmi "reopen"; tutup (bila di dalam Mini App) lalu reload sebagai fallback.
  if (wa?.close) wa.close();
  window.location.reload();
}