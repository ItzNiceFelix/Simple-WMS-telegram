# Plan: Menutup Risiko Sisa Multi-Provider AI

Tanggal: 2026-09-23
Baseline: commit `d0de701` (UI multi-provider v5.3).
Sumber risiko: `docs/code-review-provider-ui.md` + `docs/verification-provider-ui.md` (bagian "Gap") + audit kode baru.

## Risiko terverifikasi (bukan asumsi)

### R1 - Drift nilai vs tipe `PROVIDER_AI` tak terjaring tsc (MEDIUM)
- `lib/dashboard/providerAi.js` (nilai, CJS) dan `lib/dashboard/providerAi.d.ts` (tipe union) adalah dua file terpisah.
- tsc memakai `.d.ts`; bundler/runtime memakai `.js`. Tambah provider ke-6 di `.js` tanpa `.d.ts` -> tsc tetap exit 0.
- Satu-satunya penjaga: `test/providerAiParitas.test.js` (nilai saja, bukan tipe).
- Bukti: mutation test 5->2 menangkap nilai, tapi `5 -> 6 di .js saja` tidak dijaga tsc.

### R2 - Provider key absen -> request GAGAL TOTAL, bukan fallback (HIGH)
- `lib/ai/adapters/openaiCompat.js:113` melempar `Provider ${label}: ${apiKeyEnv} belum di-set` di waktu pembuatan adapter.
- `apakahErrorBolehFallback` (index.js:9-23) TIDAK mengenali pola pesan itu -> `throw err` di `index.js:58`.
- Akibat: owner pilih `kenari` tanpa set `KENARI_API_KEY` -> bot mati untuk SEMUA pesan teks, bukan jatuh ke Gemini.
- Ini konflik langsung dengan klaim "dispatcher akan fallback" (jawaban orchestrator pada review UI) dan dengan pola Groq lama yang "soft-warn".

### R3 - `.env.example` + `lib/config/env.js` belum tahu provider baru (MEDIUM)
- `.env.example` masih: `# groq (default) atau gemini` + hanya `GROQ_API_KEY`. Tidak ada `KENARI_*`, `OPENAI_API_KEY`, `OPENROUTER_*`, `*_BASE_URL`, `*_MODEL_TEXT`.
- `lib/config/env.js` hanya warn `GROQ_API_KEY`; provider lain tidak diperiksa sama sekali.
- Ada mojibake lama (`�`) di `.env.example` + `env.js` (baris komentar) - ikut dibersihkan.

### R4 - Provider tanpa key terpilih tanpa peringatan UI (LOW)
- Dashboard membolehkan memilih `kenari` walau `KENARI_API_KEY` absen (menyatu dengan R2; UI-level).
- Pilihan: v1 cukup bergantung pada R2 fix (fallback), tanpa cek key di UI (key = env server, UI tak boleh tahu).

## Keputusan desain

### D1 (R2) - Key absen = error "layak fallback", bukan fatal
Ubah `openaiCompat.js`: JANGAN throw saat key absen. Buat adapter yang tetap ada, tapi:
- tandai `adapter.konfigurasiTidakLengkap = true` + `alasanTidakLengkap` (mis. `"KENARI_API_KEY belum di-set"`), dan
- `panggilOpenAiCompat` melempar error bertanda `err.perluFallbackProvider = true` dengan pesan yang jelas.
Lalu:
- Tambah tanda itu ke `apakahErrorBolehFallback` (index.js) DAN `apakahErrorBolehFallback` (openaiCompat.js) -> `if (err?.perluFallbackProvider) return true`.
- Hasil: key absen -> dispatcher turun ke provider berikutnya di `fallbackChain`, akhirnya Gemini.
- Alternatif ditolak: tetap throw di konstruksi (perilaku sekarang) = bot mati; atau skip provider tanpa key di dispatcher (butuh info key, bocorkan ke UI).

### D2 (R1) - Satu sumber nilai, tipe derive, tanpa `.d.ts` manual
Ganti pendekatan dua-file dengan `lib/dashboard/providerAi.js` sebagai SATU-SATUNYA literal + JSDoc `@type` (CJS, browser-safe), dan hapus `providerAi.d.ts`. Tipe TS diambil dari JSDoc lewat `allowJs` + `checkJs` terbatas:
- Alternatif (lebih aman, tanpa mengubah tsconfig): pertahankan `.d.ts` TAPI tambah test yang membandingkan literal `.js` dengan literal di `.d.ts` (baca file, regex union) -> drift TIPE juga tertangkap, bukan hanya nilai.
- **Dipilih:** opsi alternatif (test baca `.d.ts`). Alasan: `checkJs` global berisiko memunculkan error di seluruh `lib/` dan mengubah konfigurasi proyek di luar scope fitur. Test berbasis baca-file deterministik, murah, dan gagal saat drift.
- Test baru: `test/providerAiTipeParitas.test.js` -> parse union di `providerAi.d.ts` (regex `export type ProviderAi = ...`), bandingkan himpunan dengan `PROVIDER_AI` di `.js`. Gagal bila tidak sama.

### D3 (R3) - `.env.example` + `env.js` sadar multi-provider
- `.env.example`: blok AI/PROVIDER jadi 5 provider, sebut `AI_PROVIDER_TEXT` menerima `gemini|groq|kenari|openai|openrouter`, daftar `*_API_KEY`, `*_BASE_URL` (opsional), `*_MODEL_TEXT` (opsional). Perbaiki mojibake.
- `lib/config/env.js`: tambah fungsi `peringatkanProviderTanpaKey()` yang membaca `AI_PROVIDER_TEXT` (lowercase) dan memperingatkan bila key provider default itu kosong (map provider -> env, dari registry). Panggil dari `validasiEnvWebhook` menggantikan warn Groq hardcoded. Tetap soft-warn (jangan blok start), konsisten D1 (fallback tetap jalan).
- Perbaiki mojibake di `env.js`.

### D4 (R4) - Tidak ada pekerjaan baru
UI tidak mengecek key (key server-only). Cukup D1. Dicatat sebagai batasan yang disengaja.

## File & urutan
1. `lib/ai/adapters/openaiCompat.js` - key absen jadi error layak-fallback (D1).
2. `lib/ai/index.js` - `apakahErrorBolehFallback` kenali `perluFallbackProvider` (D1).
3. `test/ai/openaiCompatKeyAbsen.test.js` (BARU) - key absen -> adapter dibuat, panggil -> error layak fallback.
4. `test/ai/fallbackKeyAbsen.test.js` (BARU) - dispatcher: provider terpilih tanpa key -> sampai ke provider berikutnya / Gemini (D1).
5. `test/providerAiTipeParitas.test.js` (BARU) - `.js` vs `.d.ts` (D2).
6. `.env.example` - blok AI 5 provider + bersih mojibake (D3).
7. `lib/config/env.js` - `peringatkanProviderTanpaKey()` (D3).
8. `test/envProvider.test.js` (BARU) - provider tanpa key -> warn, provider dengan key -> tidak warn, provider tak dikenal -> tidak crash.

Catatan: `test/ai/index.test.js` masih rusak (path `../lib/...` + mock Firestore gagal) dari commit `8f17c9f`. Perbaiki di sini: benarkan path jadi `../../lib/...` + pakai `test/helpers/mockFirestore` (pola `providerAiParitas.test.js`). Kalau tetap rapuh, hapus dan ganti dengan `test/ai/fallbackKeyAbsen.test.js` yang lebih spesifik - keputusan saat eksekusi, dilaporkan.

## Gate
- `npx tsc --noEmit` exit 0
- `npm test` 0 fail (dan jumlah test naik sesuai test baru)
- Mutation check: (a) hapus satu provider di `.js` -> `providerAiParitas` + `providerAiTipeParitas` GAGAL; (b) ubah `.d.ts` saja -> `providerAiTipeParitas` GAGAL; (c) hapus tanda `perluFallbackProvider` -> `fallbackKeyAbsen` GAGAL.
- e2e tidak wajib untuk D1-D3 (tak menyentuh UI flow), kecuali `env.test.js` existing perlu ikut hijau.

## Risiko plan
- D1 mengubah perilaku error: provider salah konfigurasi tidak lagi melempar di konstruksi. Konsumen yang mengandalkan throw itu harus dicek (grep `buatProviderOpenAiCompat`).
- D3 soft-warn: kalau provider default tanpa key DAN semua fallback juga tanpa key, pesan error akhir tetap muncul dari Gemini - pastikan pesan tidak menyesatkan.