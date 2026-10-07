# Verifikasi Independen — UI Pilih Provider AI Multi-Provider

Verifier: agen verifikasi independen. Tanggal: 2026-09-23.
Repo: `C:\Users\user\Documents\Code\Bot-Admin-Toko`.
Prinsip: setiap klaim dibuktikan dengan eksekusi, bukan laporan. Implementasi TIDAK diubah.

## Ringkasan hasil perintah

| Perintah | Exit | Hasil |
|---|---|---|
| `npx tsc --noEmit` | 0 | tanpa error |
| `npm test` (semua) | 0 | 546 tests / 546 pass / 0 fail |
| `node --test test/providerAiParitas.test.js test/handleSettings.test.js` | 0 | 6 pass / 0 fail |
| `npx playwright test e2e/staff.spec.ts e2e/izin.spec.ts --project=desktop` | 0 | 16 pass |
| `npx playwright test e2e/staff.spec.ts e2e/izin.spec.ts e2e/provider-ui.spec.ts --project=desktop` | 0 | 19 pass / 0 fail |
| `node --test test/aiRoute.test.js` (BARU) | 0 | 6 pass / 0 fail |
| `npm run e2e:build` | 0 | build sukses, route `/pengaturan` ter-render |

Catatan: `npm test` naik dari 540 -> 546 karena 6 test baru (`test/aiRoute.test.js`).

## Tabel klaim

| # | Klaim | Metode | Bukti (perintah + output ringkas) | Status |
|---|---|---|---|---|
| 1 | `/pengaturan` tampilkan dropdown 5 opsi: Gemini, Groq, Kenari, OpenAI, OpenRouter | e2e nyata + baca kode | `app/pengaturan/page.tsx:167-171` map `PROVIDER_AI`; `lib/dashboard/providerAi.js:14-20` label 5 entri. e2e: `staff.spec.ts` "dropdown provider menampilkan 5 opsi" PASS; `provider-ui.spec.ts` "dropdown menampilkan tepat 5 opsi provider" (`toHaveCount(5)` + tiap label visible) PASS. | **TERBUKTI** |
| 2 | Owner bisa pilih provider selain gemini/groq (Kenari) & tersimpan | e2e nyata (spec baru) | `e2e/provider-ui.spec.ts` "owner memilih Kenari -> tersimpan & provider aktif jadi Kenari": pilih option "Kenari", klik simpan, toast "Pengaturan disimpan", `provider-aktif` = "Kenari"; lalu nav klien ke Ringkasan -> balik Pengaturan, tetap "Kenari" (refetch `getAiSettings()` dari store). PASS. | **TERBUKTI** (lihat gap G1 soal reload penuh) |
| 3 | Admin/guest tidak bisa ubah provider (kontrol disabled) | e2e nyata | `e2e/izin.spec.ts` "admin tidak dapat mengubah provider AI": `pilih-provider` disabled, `simpan-provider` disabled, `catatan-owner` visible, klik paksa tidak ada toast, nilai tetap Groq. PASS. `provider-ui.spec.ts` "admin: kontrol provider disabled" PASS. Guest ditolak di `/pengaturan` (`guest ditolak di kelima halaman staff` PASS). | **TERBUKTI** |
| 4 | Route `POST /api/pengaturan/ai` terima kelima provider, tolak lain dengan pesan "Provider AI tidak dikenal." | test route baru memanggil `POST()` asli | GAP awal: tidak ada test yang meng-import route. Dibuat `test/aiRoute.test.js` (muat + transpile `app/api/pengaturan/ai/route.ts`, panggil `POST()`). 6 pass: 5 provider -> 200 + `textProvider` tersimpan; `foo`/``/`gpt-4o`/`kenari ` -> 400 `"Provider AI tidak dikenal."`; `KENARI` -> 200 (route lowercase, route.ts:49); admin -> 403; tanpa sesi -> 401; origin jahat -> 403. | **TERBUKTI** |
| 5 | Bot `handleSettings` tampilkan 5 tombol; callback `settings_ai:kenari` simpan "kenari" | test stub | `test/handleSettings.test.js`: "handleSettings mengirim 5 tombol provider dalam 2 baris" (callback_data urut 5, label 5, aktif ✅); "callback settings_ai:kenari memanggil simpanProviderAI('kenari', ...)" (provider `kenari`, `oleh` `1`, edit pesan 5 tombol, jawaban memuat "Kenari"). 3/3 PASS. Kode: `lib/handlers/handleSettings.js:22-31`. | **TERBUKTI** |
| 6 | `PROVIDER_VALID` konsisten di registry / aiSettings / providerAi | test paritas | `test/providerAiParitas.test.js`: "daftar shim == registry == model" deepEqual ketiganya ke `["gemini","groq","kenari","openai","openrouter"]`; label 5; `adalahProviderAi` benar. 3/3 PASS. Kode: `registry.js:50`, `aiSettings.js:9`, `providerAi.js:11`. | **TERBUKTI** |

## Test baru yang ditambahkan

1. `e2e/provider-ui.spec.ts` — 3 test (dropdown 5, owner pilih Kenari tersimpan, admin disabled). Hasil: **3 pass**.
2. `test/aiRoute.test.js` — 6 test memanggil `POST()` route asli. Hasil: **6 pass**.

Tidak ada file implementasi yang diubah. Spec existing tidak diubah.

## Gap / batasan yang tak tertutup

- **G1 (mock, bukan produksi):** e2e berjalan di mode mock (`NEXT_PUBLIC_DASHBOARD_DATA=mock`). Store mock in-memory (`lib/dashboard/data/mock.ts:117`), sehingga `page.reload()` / `page.goto()` penuh mem-bootstrap ulang dan mengembalikan seed `groq`. Ini berlaku SAMA untuk semua tulis mock (hpp, role, dll), bukan kekhususan provider. Bukti "tersimpan" e2e = store termutasi + refetch SPA. Persistensi lintas-reload yang sesungguhnya hanya dibuktikan di jalur produksi (`real.ts` -> `POST /api/pengaturan/ai` -> Firestore), yang tidak dieksekusi e2e ini.
- **G2:** Verifikasi klaim #4 memakai route yang ditranspile in-test + Firestore mock; guard sesi/role/origin dieksekusi, tetapi `simpanProviderAI` menulis ke mock Firestore, bukan Firestore nyata. Konsistensi lintas-layer (Firestore asli) di luar cakupan.
- **G3:** Test route lama (`test/adminRoute.test.js`, `test/permintaanRouteV5.test.js`) punya pola "route TS tidak diimpor"; kini `test/aiRoute.test.js` mengimpor route asli dan lulus — pola import route terbukti layak, tetapi route lain belum tentu punya test impor langsung.
- Klaim #2: pilihan "selain gemini/groq" hanya diuji dengan Kenari (OpenAI/OpenRouter belum diuji end-to-end di UI; validitasnya ditutup test paritas + test route #4).

## Kesimpulan

Semua 6 klaim TERBUKTI dengan eksekusi nyata. Typecheck bersih, 546/546 unit test lulus, 19/19 e2e terkait lulus, dan 6 test route baru lulus. Gap tersisa hanya keterbatasan mock Firestore e2e (G1-G3), bukan bukti kegagalan fitur.

VERIFIED
