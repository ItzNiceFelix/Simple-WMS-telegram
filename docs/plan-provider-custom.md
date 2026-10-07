# Plan: Provider AI Custom (Kenari.id)

## Status quo
- `lib/gemini/client.js`: dispatch `textProvider` `gemini` vs (default/else) `groq`.
- `lib/gemini/groqClient.js`: OpenAI-compatible fetch adapter untuk Groq. 3 bug baru di-fix
  (parallel_tool_calls, text loss, non-JSON), test 5 kasus.
- `lib/models/aiSettings.js`: `PROVIDER_VALID = ["gemini","groq"]`. Firestore `system_settings/ai`
  cuma simpan `textProvider`.
- `lib/handlers/handleSettings.js` + `app/api/pengaturan/ai/route.ts`: UI/REST ganti provider dari
   daftar statis `["gemini","groq"]`.
- `lib/config/env.js`: env fail-fast, Groq key cuma warning.

## Riset Kenari.id (webfetch)
- Homepage + docs (kenari.id/docs) memperingkas: **satu endpoint OpenAI-compatible chat
  completions**, fallback otomatis ke model lain di balik layar, BYOK atau beli token Rupiah,
  satu API key.
- Endpoint chat completions: `https://api.kenari.id/v1/chat/completions` (OpenAI-compatible
  termasuk `tools`, `parallel_tool_calls`, error schema standar 429/400/503).
- Auth: `Authorization: Bearer <key>`.
- Model: rute otomatis; default model "openai/gpt-oss-120b"-style (lihat /docs/models). User dapat
  override nama model lewat `model` field — endpoint tetap sama.
- Fallback model: **sudah built-in** di Kenari (routing otomatis ke provider sehat). Jadi kita
  JARANG perlu fallback cross-provider; Kenari satu-satunya jadi cukup *primary*. Namun tetap
  pertahankan *fallback to Gemini* di kode bila Kenari error 429/503/non-JSON (pola Groq sekarang).
- Anthropic format (`messages` / Bedrock-style) ada di `/docs/messages` — **beda endpoint** (bukan
  chat completions). Karena bot cuma butuh tool-calling OpenAI-compat, pakai chat completions
  compat, bukan Anthropic. Jadi "Anthropic support" = opsi terpisah **bukan sekarang**.

Keputusan: scope v1 = satu provider OpenAI-compatible (Kenari). Anthropic-compatible endpoint
ditunda sampai diminta; arsitektur factory sudah siap menampungnya nanti.

## Desain

### 8.1 Generalisasi adapter
Ganti `groqClient.js` dengan `lib/gemini/openaiCompatClient.js`:
- `buatProviderOpenAiCompat(config)`: factory.
  - `config.label` (debug/log)
  - `config.baseUrl`
  - `config.apiKeyEnv`
  - `config.defaultModel`
  - `config.fallbackChain` (opsional, daftar label) — v1 single provider, gunanya kalau mau
    turun ke model alternatif di Kenari via `model` override + retry.
- Ekspor `konversiContentsKeMessages`, `konversiToolsKeOpenAi`, `konversiResponOpenAiKeGeminiShape`,
  `apakahErrorOpenAiCompatBolehFallback`, `panggilOpenAiCompat`, `buatProviderOpenAiCompat`.
- `groqClient.js` jadi **thin re-export** wrapper di atas factory (backward compat; test lama tetap jalan).

### 8.2 Konfigurasi provider
Firestore `system_settings/ai` bertambah field opsional:
- `textProvider`: `"gemini" | "groq" | "kenari"`.
- `kenari`: `{ baseUrl?, model? }` (opsional; default env).

Env:
- `KENARI_API_KEY` (wajib bila provider=`kenari`).
- `KENARI_BASE_URL` default `https://api.kenari.id/v1/chat/completions`.
- `KENARI_MODEL_TEXT` default nama model Kenari (lihat docs).
- `KENARI_TIMEOUT_MS` default 30000.

### 8.3 Dispatcher (client.js)
```
switch (textProvider) {
  case "gemini": -> Gemini
  case "kenari": -> panggilOpenAiCompat(kenariConfig)  [fallback ke Gemini bila 429/503/nonjson]
  case "groq":   -> panggilOpenAiCompat(groqConfig)     [fallback ke Gemini]  (existing)
}
```
Error fallback detection reusable: `apakahErrorOpenAiCompatBolehFallback`.

### 8.4 Settings UI (Telegram + Web)
- `handleSettings.js`: render tombol tambahan Kenari sesuai Firestore/DEFAULT.
- `app/api/pengaturan/ai/route.ts`: POST set `textProvider` termasuk `kenari`.
- Pilihan "Custom OpenAI-compatible": input manual `baseUrl` + `apiKey` + `model`.
  - **Security:** API key **tidak pernah** disimpan di Firestore oleh bot; cukup label provider +
    model override. Key tetap env. Jika user memang butuh BYOK dinamis → simpan **terenkripsi**
    di Firestore? Tidak — scope v1: key via env, labeled preset. Custom key-field ditunda (butuh
    KMS/encryption schema baru). Dokumentasikan batasan.

### 8.5 Env validation
- `.env.example`: tambah `KENARI_*`.
- `env.js`: warning bila `KENARI_API_KEY` kosong tapi provider opsi `kenari` (mirip Groq warning).

### 8.6 Test
- `test/openaiCompatClient.test.js`: kontrak generic (parallel_tool_calls, text loss, non-JSON,
  429 fallback, 400 tidak fallback).
- `test/groqClient.test.js`: tetap — verifikasi wrapper re-export tidak break.

## File urutan eksekusi
1. `lib/gemini/openaiCompatClient.js` (+ factory).
2. Refactor `lib/gemini/groqClient.js` re-export.
3. `lib/gemini/client.js`: kasih branch `kenari` + fallback.
4. `lib/models/aiSettings.js`: provider list + default kenari.
5. `lib/handlers/handleSettings.js` + `app/api/pengaturan/ai/route.ts`: UI/REST.
6. `.env.example` + `lib/config/env.js`.
7. Test baru + regression.

## Risiko / batasan
- Kenari BYOK vs beli token: jika admin pilih BYOK, key tetap harus env-level (tidak dinamis via bot).
- Anthropic-compatible endpoint (messages API) belum didukung — butuh adapter terpisah. Skip v1.
- Fallback chain cross-provider (kenari→gemini→groq) butuh `totalTimeout` global — pakai pola
  Gemini `batasTotal` existing yang sudah ada di `pengaturan.totalTimeoutMs`.

## Skor kebutuhan
- Custom OpenAI-Compatible endpoint (Kenari): langsung butuh `baseurl` + `key` configurable via UI? **Tidak** (v1 key via env). Tapi endpoint `baseUrl` configurable via env cukup, dan label provider cukup hardcoded Kenari. Jadi UI hanya pilih "Kenari" dari radio.
