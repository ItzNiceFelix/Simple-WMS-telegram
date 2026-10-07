# Verifikasi Independen - Penutupan Risiko Multi-Provider AI

Tanggal: 2026-09-23
Verifier: agen verifier independen (bukan implementer).
Basis: `docs/plan-risiko-provider.md`, working tree di atas commit `d0de701`.
Aturan: implementasi TIDAK diubah; hanya test baru ditambahkan.

## Ringkasan

| Klaim | Metode | Bukti (perintah + output ringkas) | Status |
|---|---|---|---|
| D1/R2: provider terpilih tanpa API key TIDAK bikin bot gagal total, turun ke fallback | Eksekusi skenario terburuk + baca kode | `node --test test/ai/fallbackTanpaChain.test.js` -> pass 1; `node --test test/ai/semuaKeyKosong.test.js` -> pass 1; `test/ai/fallbackKeyAbsen.test.js` -> pass | TERBUKTI |
| D2/R1: drift `.js` (nilai) vs `.d.ts` (tipe) tertangkap test, bukan cuma nilai | Mutation test manual pada `providerAi.d.ts` | buang `"openrouter"` -> `test/providerAiTipeParitas.test.js` FAIL 1 (`actual` tanpa openrouter); restore bersih | TERBUKTI |
| D3/R3: `peringatkanProviderTanpaKey()` warn provider default tanpa key, tidak warn bila key ada, tidak crash provider tak dikenal | Panggil fungsi langsung + override `console.warn` | `test/envProvider.test.js` pass 4; `test/envProviderManualVerifier.test.js` pass 5 (output JSON dicatat) | TERBUKTI |
| #4: `test/ai/index.test.js` diperbaiki (bukan skip/hapus); `registry.test.js` bermakna | `grep` skip/todo + `git diff` | 0 `test.skip`/`todo`; diff index.test.js mengganti mock rusak dgn `installMockFirestore`; registry.test.js +46 baris nyata | TERBUKTI |
| #5: `npx tsc --noEmit` exit 0, `npm test` 0 fail | Jalankan gate | `TSC_EXIT=0`; `npm test` -> tests 560 pass 560 fail 0 skipped 0 todo 0 | TERBUKTI |

## Gate

- `npx tsc --noEmit` -> `TSC_EXIT=0`.
- `npm test` (glob `test/*.test.js`) -> `tests 560`, `pass 560`, `fail 0`, `skipped 0`, `todo 0`, exit 0.
- `node --test test/ai/*.test.js test/providerAiTipeParitas.test.js test/envProvider.test.js`
  -> `tests 18`, `pass 18`, `fail 0`, exit 0.

Catatan: `npm test` HANYA memuat `test/*.test.js` di root, jadi test baru di `test/ai/`
tidak ikut gate `npm test`. Test `test/ai/*` terbukti lewat perintah eksplisit di atas.

## Channel terburuk yang diuji (skenario #1)

### #1a - `textProvider: "kenari"`, `KENARI_API_KEY` kosong, TANPA `fallbackChain` di dokumen
Test baru: `test/ai/fallbackTanpaChain.test.js`.
- Dokumen settings tanpa field `fallbackChain` -> dispatcher pakai default `["gemini", "groq"]`.
- `global.fetch` dipasang agar hanya groq yang boleh menjawab; fetch kenari = gagal.
- Hasil: pass. Log aktual:
  - `Kenari gagal (Provider Kenari tidak dapat dipakai: KENARI_API_KEY belum di-set), coba provider lain...`
  - `custom juga gagal (Provider custom tidak dapat dipakai: undefined belum di-set)`
- Request SAMPAI ke Groq (`response.text() == "dari groq"`). Fetch kenari TIDAK pernah terjadi
  (key absen -> error sebelum fetch). Bot TIDAK throw total. TERBUKTI.

Temuan sampingan (bukan blocker): saat chain memuat `"gemini"`, `PRESET_PROVIDER.gemini` = `{}`,
sehingga dispatcher mencoba gemini sebagai adapter OpenAI-compatible dengan `apiKeyEnv: undefined`
(label `"custom"`). Adapter ini selalu gagal (keyKosong true karena env undefined) dan jatuh ke
provider berikutnya. Karena D1 menandai error itu layak-fallback, hasil akhir tetap benar - tapi
menghasilkan log `custom juga gagal` yang bisa membingungkan. Jalur "gemini langsung" baru dipakai
SETELAH loop chain habis. Ini perilaku lama (bukan regresi D1), dicatat sebagai gap kosmetik.

### #1b - SEMUA key provider OpenAI-compatible kosong + `textProvider: "kenari"`
Test baru: `test/ai/semuaKeyKosong.test.js`.
- Hapus `KENARI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`.
- `fallbackChain: ["kenari","groq","openai","openrouter"]`.
- Hasil: pass. `fetchCount == 0` (tak ada fetch karena semua key kosong). Error akhir:
  - `name: Error | message: GEMINI_API_KEY belum di-set di environment variable`
- Bukan `TypeError`, bukan crash. Pesan akhir jelas. TERBUKTI.

## Test baru yang ditambahkan verifier (semua pass)

| File | Isi | Hasil |
|---|---|---|
| `test/ai/fallbackTanpaChain.test.js` | #1a: kenari tanpa key + tanpa `fallbackChain` -> sampai Groq | pass 1/1 |
| `test/ai/semuaKeyKosong.test.js` | #1b: semua key kompatibel kosong -> error akhir Gemini jelas | pass 1/1 |
| `test/envProviderManualVerifier.test.js` | #3: 5 kombinasi env, output `console.warn` dicatat | pass 5/5 |

Perintah & output kunci:

```
node --test test/ai/fallbackTanpaChain.test.js        -> tests 1 pass 1 fail 0
node --test test/ai/semuaKeyKosong.test.js            -> tests 1 pass 1 fail 0
node --test test/envProviderManualVerifier.test.js    -> tests 5 pass 5 fail 0
```

Output #3 (`console.warn` aktual):
- V3a groq tanpa key -> `["GROQ_API_KEY belum diisi - provider Groq tidak akan berfungsi (fallback provider lain tetap jalan)."]`
- V3b kenari key ada -> `[]`
- V3c provider tak dikenal (`"hantu"`) -> `["AI_PROVIDER_TEXT \"hantu\" tidak dikenal - diabaikan."]` (tidak crash)
- V3d gemini tanpa key -> `["GEMINI_API_KEY belum diisi - provider Gemini tidak akan berfungsi."]`
- V3e `"KENARI"` uppercase + key ada -> `[]`

## Mutation test D2 (bukti bukan cuma nilai)

Prosedur: backup `providerAi.d.ts` -> ubah -> jalankan -> restore.

1. Buang satu provider (tidak ada test lama yang jaga TIPE):
   - `export type ProviderAi = "gemini" | "groq" | "kenari" | "openai";`
   - `node --test test/providerAiTipeParitas.test.js` -> `fail 1`, exit 1.
   - Diff diff aktual: `actual: ['gemini','groq','kenari','openai']` vs `expected: [... + 'openrouter']`.
   - RESTORE: `git diff lib/dashboard/providerAi.d.ts` -> kosong (bersih).
2. "Lolos palsu" - hanya urutan beda, himpunan sama:
   - `export type ProviderAi = "openrouter" | "openai" | "kenari" | "groq" | "gemini";`
   - `node --test test/providerAiTipeParitas.test.js` -> pass 3, exit 0.
   - Bukan bug: himpunan identik, urutan tidak relevan (test `sort()` dua sisi). Dilaporkan sesuai permintaan.

## Pemeriksaan D1 di level kode

- `lib/ai/adapters/openaiCompat.js`: `buatProviderOpenAiCompat` tidak lagi throw di konstruksi;
  `keyKosong()` dicek di dalam `panggilOpenAiCompat`, melempar `Error` dengan `err.perluFallbackProvider = true`.
- `apakahErrorBolehFallback` di `openaiCompat.js` DAN `lib/ai/index.js` menambahkan
  `if (err?.perluFallbackProvider) return true;` sebagai baris pertama.
- `test/ai/openaiCompatKeyAbsen.test.js` membuktikan: konstruksi tidak throw, panggil reject
  dengan `perluFallbackProvider === true`, pesan menyebut env + label.

## Pemeriksaan #4

- `grep test\.skip|\.skip\(|todo\(|describe\.skip|it\.skip` di `test/ai/` -> "No files found".
- `git diff test/ai/index.test.js`: mock `Module.prototype.require` yang rusak (path `../lib/...`,
  mock Firestore gagal) diganti `require("../helpers/mockFirestore")` + `require("../../lib/ai/index")`.
  File tetap dipertahankan (bukan dihapus/di-skip).
- `test/ai/registry.test.js`: file baru +46 baris, menguji `PROVIDER_VALID` 5 tanpa duplikat,
  tiap preset punya `apiKeyEnv/baseUrl/label`, `balikanProvider` tidak throw saat key absen, dan
  cabang gemini. Semua pass.

## Gap yang tersisa

1. `npm test` tidak mencakup `test/ai/*` (glob root-only) - test D1/D2 baru hanya jalan lewat
   perintah eksplisit. Rekomendasi: perluas script `test` ke `test/**/*.test.js`.
2. Log `custom juga gagal (Provider custom tidak dapat dipakai: undefined belum di-set)` muncul
   bila chain default memuat `gemini` (preset kosong). Kosmetik, tidak mengubah hasil.
   `PRESET_PROVIDER.gemini = {}` sengaja (client.js khusus); handler fallback memperlakukannya
   sebagai provider OpenAI-compatible.
3. Bila `GEMINI_API_KEY` juga kosong, error akhir datang dari client Gemini dengan pesan generik;
   sudah jelas, tapi tidak diberi penanda `perluFallbackProvider` (tidak relevan - ini fallback terakhir).
4. Tidak ada test e2e UI untuk D1-D3 (sesuai plan: tak menyentuh flow UI). Diterima.
5. D4 (UI tidak cek key) tetap batasan disengaja; tidak diuji.

## Kesimpulan

Kelima klaim TERBUKTI lewat eksekusi. Gate hijau. Tidak ada temuan yang butuh perbaikan kode;
gap 1 (glob test) dan 2 (log kosmetik) bersifat pemeliharaan, bukan kegagalan klaim.
