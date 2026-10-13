// lib/d1/hasil.ts — Tipe hasil bisnis + helper gagal, TANPA dependensi runtime.
// Dipisah dari db.ts supaya kode Worker (bot, lib/ai/*) bisa memakainya tanpa
// ikut menarik @opennextjs/cloudflare + next/server ke dalam bundel.
// PENTING: file ini tidak boleh mengimpor apa pun.

/** Hasil bisnis standar: ok:true + data, atau ok:false + status HTTP + error. */
export type Hasil<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

/** Hasil gagal ringkas (memakai tipe Hasil dengan generic bebas). */
export function gagal<T = Record<string, never>>(status: number, error: string): Hasil<T> {
  return { ok: false, status, error };
}

/** Unix epoch detik saat ini — dipakai modul D1 untuk stempel waktu. */
export function sekarang(): number {
  return Math.floor(Date.now() / 1000);
}
