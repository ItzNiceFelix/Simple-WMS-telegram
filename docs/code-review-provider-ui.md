# Code Review - UI Pilih Provider AI Multi-Provider (Working Tree)

Tanggal: 2026-09-23
Reviewer: independent (read-only)
Scope: perubahan belum di-commit. Fitur: UI pilih provider AI 5-provider.

## Verdict

**CHANGES_REQUIRED**

Alasan utama: klaim plan \(providerAi.ts facade + providerAi.js runtime duplikasi literal)\
tidak sepenuhnya benar - daftar literal diduplikasi DAN test paritas tidak mengcover
\handleSettings.js\, sehingga drift label/tombol Telegram tetap lolos. Plus bug
\process.env\ non-public di komponen klien.

---

## Temuan

### BLOCKING

#### B1. \handleSettings.js\ daftar provider + label tidak dijaga test paritas
File: \lib/handlers/handleSettings.js:5-11, 28-29\
Bukti:
- \LABEL_PROVIDER\ didefinisikan ulang penuh (5 entri) - literal ke-4 setelah
  \providerAi.js\, \egistry.js\, \iSettings.js\.
- Baris 28-29: tombol memakai array literal \["gemini","groq","kenari"]\ +
  \["openai","openrouter"]\ - literal ke-5.
- \	est/providerAiParitas.test.js:22-24\ hanya membandingkan
  \providerAi.js\ == \egistry.js\ == \iSettings.js\. \handleSettings.js\
  TIDAK di-require/dibandingkan sama sekali.
- Terbukti: ubah \providerAi.js\ jadi 4 entri -> test paritas GAGAL (terverifikasi).
  Ubah \iSettings.js\ -> GAGAL (terverifikasi). Tapi ubah \handleSettings.js\
  (mis. hapus \openrouter\ dari array tombol) -> test paritas tetap PASS dan
  \handleSettings.test.js\ juga PASS (assert hanya \datar.length === 5\, tidak
  membandingkan isi dengan sumber tunggal).
Dampak: bot Telegram bisa kehilangan/berlebih provider dibanding UI tanpa ada test
yang menangkapnya. Regresi diam-diam.
Saran: satu sumber. Minimal, tambahkan assertion di \providerAiParitas.test.js\
atau \handleSettings.test.js\ bahwa himpunan \callback_data\ dari
\	ombolSettings()\ == \PROVIDER_AI\, dan \Object.keys(LABEL_PROVIDER)\ di
handler == \PROVIDER_AI\. Lebih baik lagi: import daftar dari
\lib/dashboard/providerAi.js\ ke handler (CJS, aman).

#### B2. \process.env.AI_PROVIDER_TEXT\ non-public di komponen klien
File: \lib/dashboard/data/real.ts:489-492\ (\"use client"\, baris 1)
Bukti:
- \eal.ts\ dimuat dinamis di browser (\lib/dashboard/sumber-data.tsx:110\
  \wait import("./data/real")\), jadi \getAiSettings\ berjalan di klien.
- Next.js hanya meng-inline env \NEXT_PUBLIC_*\ ke bundle klien. \AI_PROVIDER_TEXT\
  (non-public) menjadi \undefined\ di browser.
- Tidak crash (Next sediakan \process\ shim, member statis -> \undefined\), TAPI:
  server (\lib/models/aiSettings.js:15\) memakai \AI_PROVIDER_TEXT\ untuk default,
  klien TIDAK. Saat dokumen \system_settings/ai\ belum ada / nilainya tak dikenal,
  klien selalu fallback ke \"groq"\ walau server memilih provider dari env.
- Lebih lanjut: \NEXT_PUBLIC_AI_PROVIDER_TEXT\ tidak didefinisikan di \.env.example\
  (hanya \AI_PROVIDER_TEXT\), jadi cabang pertama praktis tak pernah terisi.
Dampak: UI menampilkan provider berbeda dari yang benar-benar dipakai bot pada kasus
dokumen kosong + env diset. Inkonsistensi lintas layer.
Saran: putuskan sumber default klien. Opsi: (a) buang baca env di klien, cukup
\dalahProviderAi(p) ? p : "groq"\, server tetap otoritatif; atau (b) pakai HANYA
\NEXT_PUBLIC_AI_PROVIDER_TEXT\ di klien DAN dokumentasikan di \.env.example\.
Jangan tinggalkan baca env non-public di kode klien yang memberi kesan berfungsi.

### MEDIUM

#### M1. Duplikasi literal tetap ada meski plan mengklaim "satu sumber"
File: \lib/dashboard/providerAi.js:11,14-20\
Bukti: \providerAi.js\ (CJS) berisi literal \PROVIDER_AI\ + \LABEL_PROVIDER\;
\providerAi.ts:11-17\ meng-hardcode ulang union tipe \["gemini",...,"openrouter"]\
sebagai cast \s readonly [...]\. Jadi literal ada di: \providerAi.js\,
\providerAi.ts\ (tipe), \egistry.js\ (via keys), \iSettings.js\, dan
\handleSettings.js\. Plan (baris 29-31) menyatakan idealnya import nilai dari
\egistry.js\; implementasi memilih shim terpisah, sehingga "satu literal" tidak
tercapai - hanya "satu literal di JS + tipe manual di TS".
Dampak: union tipe di \providerAi.ts\ bisa drift dari nilai runtime tanpa tsc gagal
(cast \s\ mematikan pengecekan). Test paritas tidak membandingkan tipe TS.
Saran: derive tipe dari nilai tanpa hardcode:
\export type ProviderAi = (typeof PROVIDER_AI_NILAI)[number];\ (tanpa cast union
manual), atau generate dari registry. Hilangkan cast \s readonly [...]\.

#### M2. \dalahProviderAi(v: string)\ dipanggil dengan \unknown\/non-string di guard runtime
File: \lib/dashboard/providerAi.ts:23-24\, \pp/pengaturan/page.tsx:152\
Bukti: signature TS \(v: string)\. \Select\ \onValueChange\ dapat memberi nilai
\string\; guard \ !== null && adalahProviderAi(v)\ OK. Tapi \mock.ts:1266\
memanggil \dalahProviderAi(provider)\ dengan \provider: string\ dari DataSource
(OK), dan \eal.ts:492,494\ dengan hasil \String(...)\/lowercase (OK). Namun
fungsi runtime \providerAi.js:27\ \PROVIDER_AI.includes(v)\ aman untuk non-string
(mengembalikan false). Risiko rendah, tapi tipe sempit (\string\) berbeda dari
perilaku runtime yang menerima apa pun. \providerAi.ts:23\ mendeklarasikan
\: string\ sementara \dalahProviderAiNilai\ menerima \ny\.
Dampak: ketidakcocokan tipe/realita; pemanggil masa depan dengan \unknown\ harus
cast.
Saran: ubah parameter jadi \: unknown\ di kedua shim.

### LOW

#### L1. Label provider Telegram tidak diformat dari satu map
File: \lib/handlers/handleSettings.js:13-15\
Bukti: \labelProvider\ punya fallback \|| provider\ mengembalikan kode mentah.
Untuk callback tak dikenal (\settings_ai:foo\), \simpanProviderAI\ menolak
dengan error sebelum label dipakai - jadi alur normal aman. Tapi pada
\handleSettingsCallback\ jalur error, \labelProvider(provider)\ di baris 56 hanya
dipanggil setelah sukses. Tidak ada bug langsung; hanya duplikasi map (lihat B1).
Dampak: rendah; tercakup B1.
Saran: hapus duplikasi dengan import map dari \providerAi.js\.

#### L2. \e2e/staff.spec.ts\ test dropdown baru hanya cek visible, tidak cek urutan/terpilih
File: \e2e/staff.spec.ts:110-116\
Bukti: loop assert \getByRole("option", { name }) .toBeVisible()\ untuk 5 label.
Tidak mengassert jumlah total opsi = 5 (bisa lolos bila ada opsi ekstra), tidak
mengassert provider aktif ter-ceklis.
Dampak: rendah, cakupan longgar.
Saran: tambah assert count 5 option; opsional assert nilai terpilih.

#### L3. Komentar \eal.ts\ menyebut env non-public seolah dipakai klien
File: \lib/dashboard/data/real.ts:488\
Bukti: komentar "default (env AI_PROVIDER_TEXT bila valid, else groq)" - menyesatkan
karena di klien env itu \undefined\ (lihat B2).
Dampak: rendah (kognitif).
Saran: perbarui komentar setelah B2 diputuskan.

### NIT

- \pp/pengaturan/page.tsx:162\ cast \LABEL_PROVIDER[v as keyof typeof LABEL_PROVIDER]\
  - jika shim mengembalikan \Record<ProviderAi,string>\, kunci \string\ butuh cast.
  Bisa dibersihkan dengan helper \labelProvider(v)\.
- \lib/ai/registry.js:48-50\: komentar perbaikan duplikat gemini bagus; \PRESET_PROVIDER.gemini\
  adalah objek kosong placeholder - perlu dicatat bahwa \Object.keys\ bergantung pada
  urutan deklarasi (gemini lebih dulu). Terpenuhi.

---

## Klaim yang diverifikasi

| Klaim | Cara | Hasil |
|---|---|---|
| Test paritas gagal bila \providerAi.js\ diubah | copy backup, edit 5->4, \
ode --test test/providerAiParitas.test.js\, restore | GAGAL (2 fail), lalu restore verified 5 entri. Terbukti. |
| Test paritas gagal bila \iSettings.js\ diubah | edit 5->4, run, restore | GAGAL (1 fail). Terbukti. |
| Test paritas TIDAK mengcover \handleSettings.js\ | grep require di test; baca isi test | Terbukti - hanya 3 modul. B1. |
| \egistry.js\ \PROVIDER_VALID\ kini 5 (bukan 6) | \
ode -e\ Object.keys vs concat | \["gemini","groq","kenari","openai","openrouter"]\; concat lama = 6. Benar. |
| Tidak ada tempat lain hardcode 2 provider di kode produksi | grep \"gemini"\|\"groq"\ exclude docs/node_modules | Sisa: \lib/ai/index.js:43\ (\	extProvider === "gemini"\ - cabang SDK khusus, benar), \egistry.js:61\ (\kind === "gemini"\ - benar). Tidak ada bug. |
| Konsumen \	extProvider\ type-mismatch | grep \	extProvider\|AiSettingsDoc\ di \*.ts | Hanya \	ypes.ts\, \eal.ts\, \mock.ts\, \mock-data.ts\, \index.ts\. Semua kompatibel dgn \ProviderAi\; tsc exit 0 (diberikan). |
| Callback \settings_ai:<provider>\ cocok router | baca \lib/router/routePesan.js:212\ | \data.startsWith("settings_ai:")\ -> \handleSettingsCallback\. \callbackData.split(":")[1]\ ambil provider. Cocok untuk 5 provider. |
| \eal.ts\ \process.env\ aman di browser | baca \sumber-data.tsx:110\ dynamic import; cek \.env.example\ | \eal.ts\ jalan di klien; env non-public = \undefined\. Tidak crash, tapi inkonsisten. B2. |
| data-testid e2e lengkap | grep page.tsx | \h8-pengaturan:108\, \kartu-provider:123\, \provider-aktif:135\, \pilih-provider:159\, \simpan-provider:188\, \catatan-owner:196\ - semua ada. |
| Select render 5 opsi | baca page.tsx:167-171 map \PROVIDER_AI\ | 5 \SelectItem\. Benar. |
| Guard \dalahProviderAi\ null-safe | baca page.tsx:152 | \ !== null && adalahProviderAi(v)\ - benar. |
| Tidak ada regresi test | \
ode --test test/providerAiParitas.test.js test/handleSettings.test.js\ | 6 pass / 0 fail. |
| Read-only: tidak ada file permanen diubah | \git diff --stat\ setelah edit+restore | Sama seperti awal (8 file, 58+/23-). Bersih. |

---

## Catatan proses

- Semua edit verifikasi dilakukan dengan backup+restore; \git status\ akhir identik
  dengan awal (5 untracked: plan + 2 shim + 2 test).
- \docs/test-report.md\ tidak disentuh.
- \docs/plan-provider-ui.md\ memuat klaim "satu sumber" yang tidak sepenuhnya
  tercapai (lihat M1).
