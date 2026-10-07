# Plan: UI Pilih Provider AI Multi-Provider

## Masalah
Backend dispatcher multi-provider (v5.3) sudah ada, tetapi seluruh permukaan UI/route
masih hardcode 2 provider. Akibatnya `kenari`, `openai`, `openrouter` tak bisa dipilih
dari dashboard maupun Telegram, dan `real.ts` menormalkan balik nilai tak dikenal ke `groq`.

Bukti (audit 2026-09-23):
| Layer | File | Baris | Isi |
|---|---|---|---|
| Tipe | `lib/dashboard/types.ts` | AiSettingsDoc | `textProvider: "gemini" \| "groq"` |
| UI page | `app/pengaturan/page.tsx` | 30,32-35,157,172-173,179 | union 2 + 2 SelectItem + guard |
| REST route | `app/api/pengaturan/ai/route.ts` | 24 | `PROVIDER_VALID = ["gemini","groq"]` |
| Real data | `lib/dashboard/data/real.ts` | 488 | `p === "gemini" ? "gemini" : "groq"` |
| Mock data | `lib/dashboard/data/mock.ts` | 1265 | tolak selain gemini/groq |
| Telegram | `lib/handlers/handleSettings.js` | 5-18 | label 2 + 2 tombol |
| Model | `lib/models/aiSettings.js` | 9 | sudah 5 provider (v5.3) |
| Registry | `lib/ai/registry.js` | 8-48 | sudah 5 preset (v5.3) |

## Keputusan
1. **Satu sumber daftar provider.** `lib/ai/registry.js` sudah jadi sumber backend.
   Tambah modul bersama yang bisa dipakai CommonJS (bot/route) DAN TypeScript UI tanpa
   duplikasi string. Pilihan: simpan daftar di `lib/ai/registry.js`, lalu:
   - route CommonJS `require` langsung,
   - TS `import` dari file `.js` via `createRequire`/tipe manual (pola existing route sudah
     pakai `createRequire`), ATAU
   - ekspor ulang lewat shim TS `lib/dashboard/providerAi.ts` yang meng-import daftar
     sebagai konstanta dan mengekspor tipe `ProviderAi`.
   **Dipilih:** shim TS kecil `lib/dashboard/providerAi.ts` berisi konstanta + label + tipe,
   `import` nilai dari `../../lib/ai/registry.js` bila memungkinkan (tsconfig allowJs?).
   Terkonfirmasi: `tsconfig.json` punya `allowJs: true` -> shim TS `lib/dashboard/providerAi.ts` BISA `import { PROVIDER_VALID } from '../ai/registry.js'` lalu mengexport ulang + tipe + label. Tidak perlu duplikasi. Test paritas tetap dibuat sebagai jaring pengaman.
2. **Label tampilan** (Gemini, Groq, Kenari, OpenAI, OpenRouter) didefinisikan sekali di shim.
3. **`real.ts` tidak boleh menormalkan ke groq.** Nilai tak dikenal → fallback ke default
   (env `AI_PROVIDER_TEXT` atau `groq`) tetapi HARUS menerima kelima provider valid.
4. **Provider tanpa API key** tidak dicek di UI v1 (key = env, di luar jangkauan dashboard).
   Cukup beri keterangan bahwa key diset via env. Bila key absen saat dipakai, dispatcher
   yang akan fallback (sudah ada).
5. **Telegram** tombol dipecah 2 baris (5 tombol), tetap `settings_ai:<provider>`.
6. **Jangan ubah** PRD/e2e lama yang mengunci "Groq": `MOCK_AI_SETTINGS.textProvider` tetap
   `"groq"`, jadi `provider-aktif` tetap "Groq". Test izin existing tetap valid.

## Perubahan per file
1. `lib/dashboard/providerAi.ts` (BARU)
   - `export const PROVIDER_AI = ["gemini","groq","kenari","openai","openrouter"] as const;`
   - `export type ProviderAi = typeof PROVIDER_AI[number];`
   - `export const LABEL_PROVIDER: Record<ProviderAi, string>`
   - `export function adalahProviderAi(v: string): v is ProviderAi`
2. `lib/dashboard/types.ts`
   - `AiSettingsDoc.textProvider: ProviderAi`
3. `app/pengaturan/page.tsx`
   - pakai `PROVIDER_AI`/`LABEL_PROVIDER`/`ProviderAi` dari shim
   - Select map semua provider; guard `adalahProviderAi(v)`
   - teks deskripsi tidak menyebut "gemini dan groq" lagi
4. `app/api/pengaturan/ai/route.ts`
   - `const PROVIDER_VALID = require("../../../../lib/ai/registry.js").PROVIDER_VALID`
     (single source) atau daftar dari registry; TIDAK hardcode
5. `lib/dashboard/data/real.ts:482-492`
   - terima 5 provider; fallback default bila tak dikenal (bukan paksa groq)
6. `lib/dashboard/data/mock.ts:1260-1274`
   - validasi pakai daftar bersama; pesan error konsisten route
7. `lib/handlers/handleSettings.js`
   - `labelProvider` pakai map 5; `tombolSettings` 2 baris
8. `lib/ai/registry.js`
   - pastikan `PROVIDER_VALID` berisi 5 (gemini + 4 preset); saat ini
     `Object.keys(PRESET_PROVIDER).concat(["gemini"])` = gemini,groq,kenari,openai,openrouter OK
9. Test:
   - `test/providerAiParitas.test.js` (BARU): daftar di shim == `PROVIDER_VALID` registry ==
     `PROVIDER_VALID` aiSettings; label lengkap; `adalahProviderAi` benar.
   - `test/handleSettings.test.js` (BARU): 5 tombol muncul, callback kenari -> simpanProviderAI
     dipanggil, label benar.
   - update bila perlu: `test/mockParitas.test.js` (pastikan tak pecah), `test/groqClient.test.js`
   - e2e `e2e/staff.spec.ts` H8: tambah assert 5 opsi di `pilih-provider`.

## Urutan eksekusi (dependency)
1 shim TS (dipakai semua lain)
2 types.ts
3 real.ts + mock.ts
4 route.ts
5 page.tsx
6 handleSettings.js
7 tests
8 gate: `npm test` + `npx tsc --noEmit` + `npm run e2e:fast` (atau spec H8/izin saja)
9 review independen
10 commit + push

## Gate
- `npm test` 0 fail
- `npx tsc --noEmit` exit 0
- e2e terkait hijau (`staff.spec.ts`, `izin.spec.ts`, `dashboard-v2.spec.ts`)
- test paritas daftar provider gagal bila salah satu daftar diubah (bukti mekanis)

## Risiko
- `allowJs` TS OK (allowJs true). Risiko rendah. Test paritas tetap jaga drift.
- e2e `izin.spec.ts` mengunci `provider-aktif` = "Groq" -> aman selama mock tetap groq.
- `combobox.test.js` / `selectValueGuard.test.js` menyentuh Select -> jalankan juga.