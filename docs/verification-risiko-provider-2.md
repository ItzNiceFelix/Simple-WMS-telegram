# Verifikasi Independen - Perbaikan MEDIUM Risiko Provider (Putaran 2)

Verifier: verifier independen (read-only atas `lib/**`).
Basis: working tree (belum commit), di atas commit `d0de701`.
Temuan asal: `docs/code-review-risiko-provider.md` (MEDIUM-1..4 + bug baru `client.js`).
Aturan: kode implementasi TIDAK diubah; hanya menambah test baru di `test/`.

## Ringkasan

| # | Klaim | Status |
|---|-------|--------|
| M1 | `npm test` rekursif -> test `test/ai/*` ikut gate | TERBUKTI |
| M2 | `gemini` di chain dihormati (SDK, urutan benar) | TERBUKTI |
| M3 | Error akhir merinci semua provider + sebut provider terpilih | TERBUKTI |
| M4 | `env.js` tak hardcode; `apiKeyEnv` gemini dari registry | TERBUKTI (sisa catatan) |
| BUG | `client.js` tak throw saat require; lazy `perluFallbackProvider` | TERBUKTI |

Gate: `npm test` = **588 pass / 0 fail**; `npx tsc --noEmit` exit 0.

---

## M1 - `npm test` glob tak rekursif

**Klaim perbaikan:** `package.json` `"test": "node --test \"test/**/*.test.js\""`.

**Metode:** baca `package.json`; jalankan `npm test` sebelum & sesudah menambah test verifier.

**Bukti:**
- `package.json:12` -> `"test": "node --test \"test/**/*.test.js\""`.
- Sebelum test verifier ditambah: `npm test` -> `tests 579 pass 579 fail 0`
  (review asal: 560; 19 test baru `test/ai` dari implementer kini TERHITUNG).
- Output `npm test` memuat baris test `test/ai/` nyata: `PROVIDER_VALID == 5 provider`,
  `balikanProvider kind gemini -> isGemini true`, `WORST#1b: semua key kompatibel kosong`.
- Sesudah 9 test verifier ditambah: `tests 588 pass 588 fail 0`.

**Status: TERBUKTI.** Sebelum 560 -> sesudah 579 (implementer) -> 588 (verifier); test `test/ai/*` ikut gate.

---

## M2 - `gemini` di `fallbackChain` dilewati / urutan dilanggar

**Klaim perbaikan:** `registry.js` `PRESET_PROVIDER.gemini.kind = "gemini"`; `index.js`
memakai `adapter.isGemini` dan menghormati urutan chain.

**Metode:** file test baru `test/ai/urutanChainVerifier.test.js` (probe sendiri, tanpa
mempercayai test implementer). Chain `["gemini","groq"]`, `textProvider:"kenari"`,
KENARI key ada + respons 429, GEMINI + GROQ key ada. `global.fetch` di-instrumentasi;
SDK Gemini di-mock (jangan keluar jaringan).

**Bukti output aktual:**
```
Kenari gagal (Provider Kenari error 429: rate limited), coba provider lain...
=== M2 PROBE ===
geminiDipanggil: 1
fetchUrls: ["https://api.kenari.id/v1/chat/completions"]
hasil text: dari gemini
✔ M2: fallbackChain [gemini,groq] -> gemini dipanggil SEBELUM groq (tanpa fetch groq)
Kenari gagal (...429...), coba provider lain...
Gemini juga gagal (gemini 503)
=== M2b PROBE ===
geminiDipanggil: 1 | fetchUrls: [".../kenari...",".../groq..."]
hasil text: dari groq
✔ M2b: gemini gagal -> groq dipanggil SESUDAHNYA
```
- Hanya 1 URL ter-fetch (kenari). **Tidak ada fetch groq** -> Gemini benar-benar
  dipanggil lebih dulu. Sesuai urutan chain.
- Pasangan negatif M2b: saat Gemini gagal (503), Groq baru di-fetch -> urutan tak terbalik.

**Status: TERBUKTI.** Kode `registry.js:9-15` (`kind:"gemini"`) + `index.js:48-51`
(`adapter.isGemini` -> `generateContentDenganGeminiSaja`) konsisten dengan bukti eksekusi.

---

## M3 - Error akhir menyesatkan / semua key kosong

**Klaim perbaikan:** `index.js` mengumpulkan semua kegagalan, melempar
`Semua provider AI gagal. Rincian - ...`.

**Metode:** file baru `test/ai/m3SemuaKeyKosongVerifier.test.js`. Semua key
(kenari/groq/openai/openrouter/gemini) kosong, `textProvider:"kenari"`,
`fallbackChain` default (tak di-set). Tangkap error.

**Bukti output aktual:**
```
=== M3 ERROR AKHIR ===
name: Error
message: Semua provider AI gagal. Rincian - Kenari: Provider Kenari tidak dapat dipakai: KENARI_API_KEY belum di-set | Gemini: GEMINI_API_KEY belum di-set di environment variable | Groq: Provider Groq tidak dapat dipakai: GROQ_API_KEY belum di-set
perluFallbackProvider: undefined
peringatanProvider: true
✔ M3: semua key kosong + textProvider kenari -> error rinci, sebut Kenari, tidak crash
```
- Menyebut **Kenari** (provider terpilih) + env key yang hilang. Tidak lagi hanya
  menyalahkan Gemini.
- `error.name = "Error"`, bukan `TypeError` -> **tidak crash**.
- Flag `peringatanProvider: true` menandai ini kegagalan terkelola.

**Status: TERBUKTI.** Catatan: `perluFallbackProvider` pada error akhir tetap
`undefined`; penanda yang dipakai kini `peringatanProvider`. Tidak ada konsumen yang
mensyaratkan `perluFallbackProvider` untuk error akhir (error dilempar ke luar, bukan
di-fallback lagi).

---

## M4 - `env.js` hardcode `GEMINI_API_KEY`

**Klaim perbaikan:** `env.js` tanpa cabang hardcode; `PRESET_PROVIDER.gemini.apiKeyEnv = "GEMINI_API_KEY"`.

**Metode:** baca `lib/config/env.js` + `lib/ai/registry.js`; file baru
`test/envM4Verifier.test.js` memanggil `peringatkanProviderTanpaKey()`.

**Bukti:**
- `grep GEMINI_API_KEY lib/config/env.js` -> 1 match, hanya di baris 44 `wajibkanEnv(..., "GEMINI_API_KEY")`
  untuk **webhook** (kebutuhan keras, bukan cabang warn). Cabang `peringatkanProviderTanpaKey`
  kini murni lewat `PRESET_PROVIDER[nama].apiKeyEnv` (`env.js:17-27`), tanpa literal gemini.
- `registry.js:14` -> `apiKeyEnv: "GEMINI_API_KEY"`; `kind:"gemini"`, `label:"Gemini"`.
- Probe output:
```
=== M4 REGISTRY ===
gemini: {"kind":"gemini","label":"Gemini","apiKeyEnv":"GEMINI_API_KEY"}
=== M4 WARN (key kosong) ===
["GEMINI_API_KEY belum diisi - provider Gemini tidak akan berfungsi (fallback provider lain tetap jalan)."]
=== M4 WARN (key ada) === []
✔ M4: registry gemini punya apiKeyEnv GEMINI_API_KEY
✔ M4: env gemini tanpa key -> warn menyebut GEMINI_API_KEY
✔ M4: env gemini dengan key -> TIDAK warn
```
- Key kosong -> warn menyebut `GEMINI_API_KEY`; key diisi -> nol warn.

**Status: TERBUKTI.** Sisa catatan (bukan MEDIUM-4): `env.js:44` masih memakai literal
`GEMINI_API_KEY` di daftar env WAJIB webhook. Ini by-design (webhook butuh Gemini), bukan
"drift sunyi" yang dimaksud temuan.

---

## BUG baru - `lib/gemini/client.js` throw di top-level

**Klaim perbaikan:** throw dihapus; `ambilGenAI()` lazy melempar `perluFallbackProvider`.

**Metode:** file baru `test/ai/clientGeminiKeyAbsenVerifier.test.js`. Tanpa
`GEMINI_API_KEY`: (a) `require` modul; (b) panggil `ambilGenAI()`; (c) panggil
`generateContentDenganGeminiSaja(...)`.

**Bukti output aktual:**
```
=== CLIENT PROBE ===
require throw? TIDAK
ambilGenAI err: GEMINI_API_KEY belum di-set di environment variable | perluFallbackProvider: true
generateContent err: GEMINI_API_KEY belum di-set di environment variable | perluFallbackProvider: true
✔ bug client.js: require tanpa GEMINI_API_KEY tidak throw
✔ bug client.js: ambilGenAI() melempar perluFallbackProvider saat key absen
✔ bug client.js: generateContentDenganGeminiSaja reject dgn perluFallbackProvider
```
- `require` modul **tidak throw** (dulu crash) -> dispatcher bisa memperlakukan key absen
  sebagai kegagalan layak-fallback.
- Pemanggilan melempar error dengan `perluFallbackProvider === true` (terkelola).

**Status: TERBUKTI** (`lib/gemini/client.js:10-19`, `53-70`).

---

## Test baru yang ditambahkan verifier

| File | Isi | Hasil |
|---|---|---|
| `test/ai/urutanChainVerifier.test.js` | M2 probe urutan chain + pasangan negatif | 2 pass |
| `test/ai/m3SemuaKeyKosongVerifier.test.js` | M3 semua key kosong, cek pesan + non-crash | 1 pass |
| `test/ai/clientGeminiKeyAbsenVerifier.test.js` | BUG client.js require + lazy error | 3 pass |
| `test/envM4Verifier.test.js` | M4 registry + warn gemini | 3 pass |
| **Total** | | **9 pass** |

Semua `process.env` yang diset di-restore (`afterEach` + `after`, juga `global.fetch` dan
mock SDK Gemini). Kode `lib/**` tidak diubah.

## Temuan yang MASIH terbuka

- **LOW-1** (`test/ai/index.test.js:35-52`): `muatUlang()` masih memutasi `module.exports`
  sebelum `delete require.cache`. Belum ditutup. Tidak menggagalkan gate.
- **LOW-2** (`test/ai/fallbackKeyAbsen.test.js:58,72`): mock gemini di `require.cache`
  langsung; restore hanya lewat `finally` (bukan `afterEach`). Belum ditutup.
- **LOW-3**: duplikasi cakupan `test/envProviderManualVerifier.test.js` vs
  `test/envProvider.test.js`. Belum ditutup (bukan bug).
- **NIT-2**: `test/providerAiTipeParitas.test.js` `HARAPAN` + `length === 5` masih
  sebagian tautologis. Belum ditutup.
- **Catatan by-design**: `env.js:44` mewajibkan `GEMINI_API_KEY` untuk webhook (literal).
  Bukan bagian MEDIUM-4 (yang soal cabang warn), tapi tetap titik hardcode tersisa bila
  registry kelak berubah.

Tidak ada temuan MEDIUM yang masih terbuka. Tidak ada regresi: 588 test pass, `tsc` exit 0.

VERIFIED
