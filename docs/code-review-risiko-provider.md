# Code Review - Penutupan Risiko Multi-Provider AI

Reviewer: code-reviewer independen (READ-ONLY).
Basis: working tree di atas commit `d0de701` (plan `docs/plan-risiko-provider.md`).
Perintah: `git status/diff`, baca kode, `node --test ...`, probe eksekusi langsung.

## Verdict: CHANGES_REQUIRED

Tidak ada BLOCKING. D1 inti (key absen tidak fatal, fallback jalan) TERBUKTI.
Tapi ada 4 MEDIUM yang harus ditutup sebelum merge: (1) test D1 tidak ikut gate
`npm test`, (2) klaim "gemini di chain = kosmetik" salah - urutan fallback benar-benar
dilanggar, (3) pesan error akhir menyesatkan saat semua key kosong, (4) `env.js`
diam-diam meng-hardcode `GEMINI_API_KEY` alih-alih sumber tunggal.

---

## Temuan per severity

### MEDIUM-1. Test D1 tidak ikut gate `npm test` (proses, semua D1)
- File: `package.json` (`"test": "node --test test/*.test.js"`), vs
  `test/ai/fallbackKeyAbsen.test.js`, `test/ai/fallbackTanpaChain.test.js`,
  `test/ai/semuaKeyKosong.test.js`, `test/ai/openaiCompatKeyAbsen.test.js`,
  `test/ai/registry.test.js`, `test/ai/index.test.js`.
- Bukti: glob `test/*.test.js` tidak rekursif. `npm test` -> `tests 560` tanpa
  satu pun test `test/ai/`. `node --test test/ai/*.test.js` -> `tests 13 pass 13`.
  Plan gate berkata "`npm test` 0 fail (jumlah test naik sesuai test baru)" - gate
  ini tidak menyentuh inti D1/R2.
- Dampak: regresi D1 lolos CI hijau. Verifikasi D1 hanya jalan kalau orang ingat
  perintah eksplisit.
- Saran: ubah script jadi `node --test "test/**/*.test.js"` (Node 20+ mendukung glob
  di `--test` bila dikutip), atau tambah script `test:ai`. Konfirmasi jumlah test naik
  di output `npm test`.

### MEDIUM-2. `gemini` di fallbackChain dilewati di loop; urutan benar-benar dilanggar
- File: `lib/ai/index.js:75-84` + `lib/ai/registry.js:58-83` + `lib/ai/registry.js:9-13`.
- Bukti kode: `PRESET_PROVIDER.gemini = {}` (tanpa `kind`), jadi `balikanProvider`
  TIDAK masuk cabang `kind === "gemini"` (registry.js:61) dan membuat adapter
  OpenAI-compatible dengan `apiKeyEnv: undefined`, `label: "custom"`. Adapter ini
  selalu gagal (`keyKosong()` true) -> dilewati sebagai error layak-fallback.
- Bukti eksekusi (probe, chain `["gemini","groq"]`, KENARI key ada + 429, GEMINI key
  ada, GROQ key ada): urutan aktual `KENARI -> GROQ -> GEMINI`, BUKAN
  `KENARI -> GEMINI`. Gemini baru dipanggil lewat catch-all `index.js:88` setelah loop
  habis.
- Dampak: admin mengonfigurasi gemini sebagai fallback pertama, tapi provider lain
  dipakai lebih dulu bila keynya ada. Ini bug semantik, bukan "kosmetik" seperti klaim
  `docs/verification-risiko-provider.md:40-45`. (Catatan: D1 justru memperbaiki crash
  lama - di baseline `buatProviderOpenAiCompat` throw tak terjaga di `index.js:77`,
  di luar try, sehingga seluruh dispatcher bisa crash keras. Jadi bukan regresi D1.)
- Saran: di loop, deteksi `prov === "gemini"` dan delegasikan ke
  `generateContentDenganGeminiSaja` (atau tandai `kind: "gemini"` di preset agar
  `balikanProvider` mengembalikan adapter `isGemini` yang benar). Minimal: jangan
  bangun adapter fetch untuk gemini.

### MEDIUM-3. Pesan error akhir menyesatkan saat semua key kosong
- File: `lib/ai/index.js:87-89` -> `lib/gemini/client.js:7-9`.
- Bukti eksekusi: `textProvider: "kenari"`, semua key kompatibel kosong ->
  error ke admin `Error: GEMINI_API_KEY belum di-set di environment variable`,
  `perluFallbackProvider: undefined`. Admin tidak pernah memilih Gemini, tapi pesan
  menyalahkan Gemini. `test/ai/semuaKeyKosong.test.js` hanya meng-assert
  `!(err instanceof TypeError)` sehingga meloloskan pesan menyesatkan ini.
- Dampak: admin salah diagnosa (mengira butuh Gemini, padahal yang salah provider
  pilihannya sendiri yang tak punya key). Plan `docs/plan-risiko-provider.md:75`
  sudah memperingatkan risiko ini; belum ditutup.
- Saran: bila semua provider chain gagal karena key absen, lempar satu Error ringkas
  yang menyebut provider terpilih + env key yang hilang, e.g.
  `Provider "kenari" tidak dapat dipakai: KENARI_API_KEY belum di-set (dan tidak ada fallback ber-key)`,
  dengan `perluFallbackProvider`/flag lain agar tidak dianggap sukses. Perkuat
  `semuaKeyKosong.test.js` untuk assert isi pesan, bukan hanya tipe error.

### MEDIUM-4. `env.js` hardcode `GEMINI_API_KEY`, bertentangan dengan sumber tunggal
- File: `lib/config/env.js:17-21`.
- Bukti: cabang gemini memakai literal `process.env.GEMINI_API_KEY`; provider lain
  lewat `PRESET_PROVIDER[nama].apiKeyEnv`. `PRESET_PROVIDER.gemini = {}` sehingga
  memang tidak punya `apiKeyEnv`. Konsekuensi: kalau `apiKeyEnv` gemini kelak
  ditambahkan ke registry, `env.js` tidak ikut.
- Dampak: drift sunyi (tidak tertangkap test) antara pesan config dan registry.
- Saran: tambahkan `gemini: { label: "Gemini", apiKeyEnv: "GEMINI_API_KEY" }` ke
  `PRESET_PROVIDER` (tanpa baseUrl), lalu hapus cabang khusus di `env.js`. Ini juga
  memperbaiki MEDIUM-2 (preset gemini tak lagi `{}`), asalkan `balikanProvider` tetap
  menangani gemini sebagai non-fetch.

---

### LOW-1. `test/ai/index.test.js` `muatUlang()` mengutak-atik `module.exports`
- File: `test/ai/index.test.js:35-52`. `Object.keys(mod).forEach(k => delete mod[k])`
  memutasi objek exports di tempat (jika tidak frozen), lalu menghapus cache. Fragile:
  tes lain yang menyimpan referensi bisa terpengaruh. Tidak menimbulkan kegagalan
  sekarang (terisolasi per-file), tapi rawan saat test tumbuh.
- Saran: cukup `delete require.cache[...]`, jangan mutasi `exports`.

### LOW-2. Mock gemini menempel ke `require.cache` langsung
- File: `test/ai/fallbackKeyAbsen.test.js:58,72` memutasi
  `require.cache[...].exports.generateContentDenganGeminiSaja`. Pola `index.test.js`
  (simpan fungsi asli, restore di `finally`) lebih aman; di sini restore hanya
  mengandalkan `asliGemini` yang diambil dari property (ok, tapi mudah bocor bila
  test gagal sebelum `try`).
- Saran: samakan pola restore-guard seperti `index.test.js`.

### LOW-3. Duplikasi cakupan test
- `test/ai/registry.test.js:16-25` meng-overlap `test/providerAiParitas.test.js` dan
  `test/providerAiTipeParitas.test.js` (preset punya apiKeyEnv/baseUrl/label).
  `test/envProviderManualVerifier.test.js` hampir identik dengan
  `test/envProvider.test.js` (duplikat 5 kasus). Bukan bug, tapi menambah noise
  pemeliharaan.
- Saran: pangkas salah satu (manual verifier cukup bila diperlukan saat review).

### NIT-1. Pesan `Provider custom ... undefined belum di-set`
- File: `lib/ai/adapters/openaiCompat.js:120`. Saat `apiKeyEnv` undefined (gemini
  preset), pesan menampilkan string `undefined`. Setelah MEDIUM-2/4 diperbaiki ini
  hilang; kalau tidak, minimal fallback ke `label` sebagai ganti `undefined`.

### NIT-2. Test `HARAPAN` + `length === 5` sedikit tautologis
- File: `test/providerAiTipeParitas.test.js:11,32-34`: membandingkan `PROVIDER_AI`
  dengan konstanta `HARAPAN` yang sama. Nilainya tetap berguna sebagai guard "tepat 5",
  tapi bukan paritas `js` vs `dts` (yang sudah dikerjakan test baris 24-26).
- Saran: biarkan, atau beri komentar bahwa ini guard panjang, bukan paritas.

---

## Klaim diverifikasi + cara

| Klaim | Cara | Hasil |
|---|---|---|
| D1: adapter tak throw saat key absen; error `perluFallbackProvider` saat dipanggil | `node --test test/ai/openaiCompatKeyAbsen.test.js` | 3 pass |
| D1: `apakahErrorBolehFallback` kenali `perluFallbackProvider` di `openaiCompat.js` + `index.js` | baca `openaiCompat.js:94`, `index.js:11` | ada di baris pertama kedua fungsi |
| D1: provider terpilih tanpa key -> turun fallback (bukan fatal) | `test/ai/fallbackKeyAbsen.test.js`, `fallbackTanpaChain.test.js` | pass |
| D1: TANPA fallbackChain (default `["gemini","groq"]`) aman | `node --test test/ai/fallbackTanpaChain.test.js` | pass, sampai Groq |
| D1: registry `balikanProvider` tak throw saat key absen | `test/ai/registry.test.js:27` + grep konsumen | pass; konsumen hanya `index.js` (loop bungkus try) |
| D1: semua key kosong -> error akhir | probe eksekusi + `test/ai/semuaKeyKosong.test.js` | `GEMINI_API_KEY belum di-set` (lihat MEDIUM-3) |
| D1: `gemini` di chain -> urutan | probe chain `["gemini","groq"]` | `KENARI->GROQ->GEMINI` (MEDIUM-2) |
| D1 regresi: `test/ai/adapters/openaiCompat.test.js` lama masih lulus | `node --test` file itu | 6 pass; set `TEST_API_KEY` -> tak asumsi throw konstruksi |
| D2: `providerAiTipeParitas` menangkap drift `.js`/`.d.ts` | analisis regex + simulasi tambah provider | tangkap dua arah; urutan di-`sort()` sehingga himpunan sama tak gagal (benar) |
| D3: `peringatkanProviderTanpaKey` warn provider tanpa key, tak warn bila ada | `test/envProvider.test.js` | 4 pass |
| D3: `require("../ai/registry")` di `env.js` tidak baca env/side-effect/circular | probe: banding `process.env` sebelum/sesudah require | tak ada key env baru; tak ada siklus (registry tak require env) |
| D3: warn gemini benar walau tanpa `apiKeyEnv` | probe + `envProviderManualVerifier.test.js` | warn `GEMINI_API_KEY` benar |
| D3: mojibake dibersihkan | decode UTF-8 `.env.example` + `env.js` | bersih (`-`), bukan lagi `�` |
| Perbaikan `index.test.js`/`registry.test.js` | `git show d0de701:test/ai/registry.test.js` | registry.test.js baseline 0 baris; index.test.js mock lama rusak |
| Gate | `npx tsc --noEmit`; `npm test` | tsc exit 0; npm test 560 pass 0 fail; `node --test test/ai/*.test.js` 13 pass |

Catatan: working tree berubah saat review (muncul `docs/learnings.md`,
`docs/verification-risiko-provider.md`, `test/envProviderManualVerifier.test.js`,
`test/ai/fallbackTanpaChain.test.js`, `test/ai/semuaKeyKosong.test.js`). Semua sudah
ikut ditinjau.

---

## Jawaban langsung atas fokus review

1. **D1 correctness**
   - Provider terpilih tanpa key + fallback ber-key -> JALAN. OK.
   - Provider terpilih tanpa key + fallback berisi provider lain tanpa key -> provider
     itu dilewati, turun ke berikutnya; kalau semua kosong -> MEDIUM-3 (pesan Gemini
     menyesatkan).
   - Tanpa fallbackChain (default `["gemini","groq"]`) -> aman untuk sampai ke Groq,
     tapi `gemini` dilewati sebagai `custom` (MEDIUM-2, NIT-1).
   - `balikanProvider` sekarang mengembalikan adapter walau key absen -> konsumen
     hanya `index.js`; loop sudah membungkus `panggilOpenAiCompat` dengan try, jadi
     tidak ada crash baru. OK.
   - Pesan error akhir: menyesatkan (MEDIUM-3), bukan informatif soal provider terpilih.
2. **D1 regresi**: test lama lulus; tidak ada asumsi throw konstruksi (env key di-set).
3. **D2 correctness**: menangkap drift dua arah; perbandingan himpunan (sort) sehingga
   urutan beda tidak false-positive. Sah.
4. **D3 correctness**: tak ada efek samping/circular require; warn gemini benar; mojibake
   bersih. Tapi hardcode `GEMINI_API_KEY` (MEDIUM-4).
5. **Kualitas test**: tidak ada test sepenuhnya tautologis; `HARAPAN`+`length 5` paling
   dekat (NIT-2). `semuaKeyKosong.test.js` terlalu lemah (hanya cek bukan TypeError).
6. **Konsistensi**: tak ada konsumen lain yang berasumsi provider throw saat konstruksi.
   Sisa inkonsistensi: perlakuan khusus `gemini` tersebar di `index.js` + `env.js` +
   `registry.js` (MEDIUM-2/4).

## Langkah perbaikan minimum
1. Perluas script `npm test` ke `test/**/*.test.js` (MEDIUM-1).
2. Tangani `gemini` di loop fallback lewat jalur Gemini langsung (MEDIUM-2).
3. Perjelas error akhir saat semua key absen + perkuat test-nya (MEDIUM-3).
4. Pindahkan `apiKeyEnv` gemini ke registry, hapus cabang hardcode di `env.js`
   (MEDIUM-4), sekaligus menutup NIT-1.
