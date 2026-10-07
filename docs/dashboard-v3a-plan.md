# Rencana Eksekusi v3a (Permintaan Harian + Keyword Notes)

> Turunan operasional dari `docs/dashboard-prd-v3a.md` (1153 baris, kontrak mengikat)
> dan `docs/dashboard-prd-v3a-review.md` (6 blocking sudah ditutup di PRD).
> Dokumen ini = URUTAN KERJA, GATE, DELEGASI. Bukan pengganti PRD.

## Fakta terverifikasi

| Item | Nilai |
|---|---|
| Route API existing | 8 `route.ts` + `api/webhook.js` = **9/12** |
| Setelah v3a | +`/api/permintaan` +`/api/admin` = **11/12**, sisa **1** |
| `konfirmasiKeyword` | ada (`keywordNotes.js:59`), **nol pemanggil** = dead code |
| `updateStatusDailyRequest` | ada (`dailyRequests.js:63`), **nol pemanggil** = dead code -> dipakai ulang |
| `sumber-data.tsx:220` | sudah `satisfies DataSource` -> `tsc` MENAGIH method baru |
| Jalur baca UI daily_requests | `real.ts:344` client SDK + cast mentah, BUKAN model -> normalizer wajib di sini (B3) |

## Wave & gate

| Wave | Isi | File | Gate |
|---|---|---|---|
| **W1** | Model + helper + validasi + test | `lib/models/dailyRequests.js`, `keywordNotes.js`, `telegram/kirimPesan.js`, `dashboard/format.ts`, `dashboard/validasiTulisV3a.js`, `test/*` | `npm test` hijau |
| **W2** | 2 route gabungan + test | `app/api/permintaan/route.ts`, `app/api/admin/route.ts`, `test/*Route.test.js` | `npm test` hijau + `tsc` exit 0 |
| **W3a** | Kontrak data BEKU | `dashboard/types.ts`, `data/index.ts` | (bagian W3) |
| **W3b/c** | mock + real + dataKosong (normalizer B3) | `data/mock.ts`, `data/real.ts`, `data/mock-data.ts`, `sumber-data.tsx` | `tsc` exit 0 |
| **W3d/e** | UI + nav | `app/permintaan/page.tsx`, `app/kata-kunci/page.tsx`, `components/dashboard/*`, `nav-config.ts` | `tsc` + `e2e` hijau |
| **W4** | rules + deploy doc | `firestore.rules`, `docs/dashboard-deploy.md` | rules ok |
| **W5** | e2e + verifikasi | `e2e/*.spec.ts` | `npm run e2e` hijau |

## Paralelisasi

- W1 -> W2 (serial: route butuh model).
- W3a (kontrak beku) bisa mulai SETELAH W2 selesai (butuh bentuk respons final).
- W3d/e (UI) paralel dengan W3b/c (data) SETELAH W3a beku.
- W4/W5 setelah W3.

## 6 blocking yang WAJIB terbukti di test

| Kode | Bukti wajib |
|---|---|
| B1 | `datang` di dokumen `draft` -> 409 pesan persis "Kirim form dulu sebelum menandai barang datang." |
| B2 | `buat-form` snapshot `qty_diminta = qty` untuk SEMUA item belum datang, termasuk item bot yang cuma punya `qty` |
| B3 | item lama (hanya `{kode_barang,nama,variasi,qty,buffer}`) tampil benar di UI via normalizer `real.ts`/`mock.ts` |
| B4 | `dataKosong()` lengkap 6 method; `tsc --noEmit` exit 0 karena `satisfies` menagih |
| B5 | `sesuaikan` menulis entri `perubahan[]` (max 50) + `updated_at`/`updated_by`, bukan cuma `console.info` |
| B6 | item `qty 0` auto-selesai, tidak menghalangi auto-`selesai`, dan `selesai` manual tersedia |

## Aturan keras (jangan dilanggar)

- **Budget function 11/12.** TIDAK BOLEH tambah route baru di luar 2 yang ditetapkan. Tidak ada `/api/kata-kunci`.
- Route lama `admin/role`, `admin/tambah`, `admin/hapus` TIDAK diubah.
- `tambahItemKeDailyRequest` TIDAK diubah (dipakai bot produksi).
- **v3b di luar scope**: jangan sentuh `lib/gemini/**`, `lib/router/**`, `lib/handlers/**` (kecuali `keywordNotes.js`/`dailyRequests.js` yang memang model).
- Semua mutasi array `daily_requests` wajib `db.runTransaction`.
- Pesan Telegram WAJIB plain (tanpa parse_mode), pakai `admin.telegram_user_id` (BUKAN `admin.id`).
- **JANGAN mematikan proses node apa pun** (kill/taskkill/Stop-Process/kill-port dilarang). Ada 9router berjalan.

## DoD akhir

`npm test` hijau (test baru S10) + `npx tsc --noEmit` exit 0 + `npm run e2e` hijau +
budget 11/12 terbukti + 6 blocking terbukti + rules tidak membuka tulis client.