// lib/ai/panggil.ts — Jalur impor nilai yang stabil untuk pemakai provider AI.
// `lib/ai/provider.ts` sedang dibangun/diubah agen lain; file ini tipis supaya
// pemanggil tidak menyentuh file yang sedang diedit. Tidak boleh ada peran ganda:
// semua nilai tetap berasal dari provider.ts.
export { panggilTeks, panggilGambar } from "./provider";
