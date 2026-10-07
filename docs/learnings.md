# Learnings

Catatan singkat hal yang sudah bikin repot / penting untuk tugas berikutnya.

- **Nama field Firestore tidak dikelola pusat.** Bug `kodeBarang` vs `kode_barang` muncul
  karena tiap modul menulis string field sendiri. Kalau tambah model baru, pakai nama
  snake_case yang sama (`kode_barang`), dan di boundary baca terima dua bentuk.
- **Return shape `{actionType, note}` dipakai lintas file.** Objek ini pernah disimpan utuh
  ke `stock_movements.action_type` dan diam-diam merusak perbandingan string. Konsumen harus
  destructure `.actionType`, jangan simpan objeknya.
- **`node --test test/` tidak jalan di Node 24.** Harus `node --test "test/**/*.test.js"`
  (sudah dipasang di package.json scripts).
- **Test unit isolasi lemah.** Test `ambilActionTypeUntukPenanda` doang tetap hijau walau bug
  handler balik. Test regresi harus lewat handler dan cek nilai yang benar-benar ditulis ke
  Firestore. Ada di `test/handleScreenshotPickingList.test.js`.
- **`api/debug-env.js` sempat ke-deploy.** Jangan taruh endpoint diagnosa yang membocorkan
  struktur env. Sudah dihapus.
- **`handleHelp` sempat menyebut opname "masih pengembangan"** padahal sudah jalan. Help text
  gampang basi; cek ulang tiap nambah fitur.
- **UI formatDelta bergantung pada field yang disimpan writer.** Saat kontrak `qty` berubah jadi delta bertanda, `lib/router/handleCommand.js` ikut salah (double-prefix `--3`) padahal bukan salah satu file yang diasumsikan berubah. Perubahan kontrak data perlu grep SEMUA konsumen field, bukan cuma writer.
- **Verifikasi Wave 1 tercampur workstream lain di worktree.** git status memuat perubahan qty-delta (handleOpname/handleScreenshotPickingList/syncStokDuaArah) yang bukan Wave 1; gate harus diuji ke path Wave 1 saja, dan temuan reviewer (audit throw, 
otifikasi_terkirim) harus dicek dulu apakah janji Wave 2 (route) sebelum dihitung sebagai blocker.

- **Test "mirror route" tidak membuktikan handler route.** Wave 2 lulus `npm test` + `tsc` tanpa satu pun test yang meng-import `app/api/**/route.ts`; helper test menduplikasi urutan validasi/guard, jadi status & urutan middleware route hanya terbukti lewat pembacaan kode. Sebelum klaim "kontrak route persis", tambah test yang memanggil `POST()` atau e2e; cara sama menutup celah assert `getSession()` yang diwajibkan PRD 6.5 tapi tak ada di test.

- v3a W1+W2: laporan reviewer (test-report 211, code-review 218 + verdict CHANGES_REQUIRED, security MEDIUM-1) tertinggal dari working tree (221 test) karena perbaikan diterapkan SETELAH laporan ditulis; verifier wajib mengeksekusi gate sendiri, bukan percaya angka laporan.
- v3b Fase A+B: tooling agent menambah BOM + mojibake (`§` -> `§`) di file yang disentuh. Wajib scan SEMUA file `git status` sebelum commit (0xEF 0xBB 0xBF = BOM; perbaiki mojibake dengan decode CP1252->UTF8 berulang sampai marker hilang).
- v3b Fase B: `docs/security-review.md` verdict BLOCKED (HIGH-1 picking setengah jadi) SUDAH usang - HIGH-1 ditutup refactor ekstraksi ke `lib/dashboard/aksiDraft.js` + test E-3 yang di-mutation-test. Cek kode, bukan dokumen review, saat laporan lebih tua dari working tree.
- v3b: test baru yang (transitif) meng-import `lib/gemini/client.js` WAJIB set `process.env.GEMINI_API_KEY = ... || "dummy-gemini-key"` sebelum require, kalau tidak `node --test` hanya bilang 'test failed' tanpa sebab jelas.
- v3b guard: `draft_kirim_guard` hanya menutup dashboard<->dashboard. Route kirim `cekGuard:false` (kalau `true` bot akan menolak guard tulisan route sendiri); jalur Telegram (`routePesan.js`, `handleKonfirmasiCallback.js:47/76`) tidak boleh diubah, jadi race dashboard<->Telegram tetap terbuka dan klaim PRD S8.2/S8.5 belum tercapai.
- v3b B-W4: seed mock baru yang masuk `store.movements` MERUSAK e2e lama yang mengunci jumlah baris (`histori.spec.ts` 12, `ringkasan.spec.ts` 10 teratas). Pelajaran: seed untuk fitur baru jangan digabung ke koleksi bersama kecuali memang bagian dari kontrak lama — pisahkan (`store.pickingMovements`) dan gabung hanya di jalur yang butuh.
  - Gate: sebelum menambah seed koleksi bersama, jalankan e2e file yang mengunci COUNT (`histori`, `ringkasan`, `smoke`) lebih dulu.
- v3b: `sebagian` (E-3 batch picking setengah jadi) sempat dihitung dari daftar yang SUDAH difilter `pending_confirmation` -> selalu `false`, UI tidak pernah menandai batch setengah jadi. Pola salah ini mudah terulang: hitung properti turunan dari SUMBER PENUH, bukan dari hasil filter yang menyempitkan. Kini dihitung dari seluruh movement pemilik (paritas `ambilBatchPicking`).
- v3b: tool agent menimpa `docs/test-report.md` (file tracked berisi laporan v3a) alih-alih membuat file baru. Verifikasi `git status` setelah setiap delegasi tester/reviewer; pindahkan laporannya ke nama berversi (`-v3b-a2.md`) dan pulihkan file aslinya.
- **Composite index Firestore tidak terlihat gate mana pun.** `where(status==) + orderBy(created_at)` baru butuh index komposit; tanpa itu query GAGAL di deploy nyata sementara `npm test`, `tsc`, dan e2e semuanya hijau (mock tidak menyentuh Firestore). Gejala di UI: "Coba lagi"/"Periksa koneksi" HANYA di halaman yang memakai query itu. Selalu jalankan `firebase firestore:indexes --project bot-admin-toko-a0c47` untuk melihat index yang BENAR-BENAR ter-deploy, jangan percaya file lokal. Dikunci oleh `test/indexFirestore.test.js`.
- **Gejala "halaman tertentu saja rusak" menunjuk ke query/Collection spesifik**, bukan auth atau bundle. `/` dan `/draft` rusak sedangkan `/stok` aman -> bedanya `listPickingDrafts` (query `stock_movements` ber-equality `status`). Pola ini cepat mempersempit dugaan.

- PRD v5: menambah aksi ke route existing (/api/admin) tersembunyi membutuhkan perluasan validator dispatcher (lib/dashboard/validasiTulisV3a.js), tapi PRD yang cuma bilang 
oute existing tidak mendaftar file itu. Verifier harus grep dispatcher/validator route, bukan hanya route file.
- v5 W5: agent frontend-ui STUCK ~1 jam setelah 
ext build sukses - dia render-verify manual (start server + Invoke-WebRequest) yang di sandbox diblokir Start-Process (%1 not valid Win32), lalu tetap retry. Pelajaran: JANGAN minta agent start server/browser untuk verifikasi; cukup 	sc + 
pm run e2e:build; e2e dijalankan orchestrator. Setiap delegasi WAJIB punya baris "STOP bila: <kondisi konkret>" + daftar file terlarang.
- v5 W4/W5: agent tester MENIMPA docs/test-report.md (tracked, isi laporan v3a) - pola learnings.md 26/28 berulang. Laporan versi baru harus nama berversi (mis. 	est-report-v5-w4.md) dan delegasi wajib menyebut file tracked yang DILARANG disentuh.
- v5 W4: 2 agent independen melaporkan gap yang SAMA (catatPergerakanStok tanpa param gudang_id) -> sinyal kuat bahwa gap itu nyata, bukan salah paham. Laporan paralel yang konvergen = bukti.
- v5 W4: reviewer agent menemukan IDOR nyata (/api/opname-gudang tidak cek scope gudang admin) yang orchestrator lewatkan saat menulis route. Review independen pada kode yang baru ditulis tetap bernilai walau penulisnya orchestrator sendiri.
- **createCustomToken claim != ID token claim.** createCustomToken(uid, {role}) hanya menaruh claim di CUSTOM TOKEN; Firestore rules membaca 
equest.auth.token.role dari ID TOKEN. Tanpa setCustomUserClaims(uid, claims), uthed() selalu false -> SEMUA read client SDK ditolak (rules default-deny), padahal route server (admin SDK) tetap jalan. Gejala: halaman yang baca via client SDK tampil kosong/"Coba lagi", sementara aksi tulis lewat route sukses. Terjadi di v5 (permintaan-gudang: "Gudang asal tidak dikenal" karena listGudang() gagal). SELALU panggil setCustomUserClaims sebelum createCustomToken, dan klien getIdToken(true) setelah login.
- **Regex/heuristik pengganti teks bisa menghapus file.** Mengganti blok useEffect(() => {...}, [open, gudang]) dengan mencari string useEffect(() => { menemukan kemunculan PERTAMA (di komentar header), bukan blok yang dituju -> 1433 baris page.tsx terhapus. Wajib: (a) hitung kemunculan pola, batal bila != 1; (b) sediakan git checkout sebagai pemulihan; (c) verifikasi jumlah baris sesudah tulis.
- Verifikasi provider-ui: asumsi test awal salah  -  route menormalkan provider ke lowercase (route.ts:49), jadi GEMINI SAH (bukan 400). Verifier harus baca normalisasi input di route sebelum menulis assert 'harus tolak'; kegagalan test pertama adalah asumsi verifier, bukan bug implementasi.
- Verifikasi provider-ui: e2e mock store in-memory (mock.ts:117) sehingga reload/goto penuh selalu mengembalikan seed  -  jangan pakai page.reload() untuk membuktikan persistensi tulis di mode mock; pakai navigasi klien SPA + cek refetch store, dan pisahkan secara eksplisit dari persistensi produksi (Firestore).
- Verifikasi risiko-provider: glob 
pm test = 	est/*.test.js (root saja), jadi test baru di subfolder 	est/ai/ TIDAK ikut gate 
pm test walau implementer mengklaim 'test baru menaikkan jumlah'. Verifier wajib jalankan 
ode --test test/ai/*.test.js eksplisit. Juga: PRESET_PROVIDER.gemini = {}, sehingga chain fallback default mencoba gemini sebagai adapter OpenAI-compatible piKeyEnv: undefined -> log custom juga gagal (kosmetik, hasil akhir tetap benar karena D1 menandai error itu layak-fallback).

- Verifikasi risiko-provider putaran 2: probe M2 yang meng-mock SDK gemini lewat `require.cache` HARUS require modul dulu (kalau tidak, cache kosong -> TypeError 'reading exports'); kegagalan test pertama adalah bug probe verifier, bukan bug implementasi. Pola ini sama dengan LOW-2 yang belum ditutup.

- **Tooling agent berulang kali menambah BOM (0xEF 0xBB 0xBF) ke file baru.** Terjadi di 9 file lintas dua gelombang (docs + test). Wajib jalankan scan byte sebelum commit: baca `ReadAllBytes`, cek `b[0..2] == EF BB BF`, strip bila ada. Satukan dengan scan mojibake 0xEF/0xFD.
- **`npm test` glob `test/*.test.js` tidak rekursif.** Test di `test/ai/*` TIDAK ikut gate utama selama berbulan-bulan; bug nyata (`lib/gemini/client.js` throw top-level saat `GEMINI_API_KEY` kosong -> dispatcher tak bisa fallback) hanya ketahuan setelah glob diperluas ke `test/**/*.test.js`. Cek glob test script setiap kali menambah subdirektori test.
- **Throw di top-level modul mematikan jalur fallback.** `lib/gemini/client.js` dulu `throw` saat `require` bila key absen; dispatcher yang meng-`require` di dalam `try` tetap crash karena kegagalan terjadi saat import, bukan pemanggilan. Modul provider yang optional harus lazy-init dan melempar error berpenanda (`perluFallbackProvider`) saat dipakai, bukan saat di-require.
- **Preset registry kosong (`gemini: {}`) bikin provider dilewati diam-diam.** `balikanProvider` membangun adapter fetch untuk gemini karena tak ada `kind`, lalu adapter selalu gagal -> urutan `fallbackChain` dilanggar tanpa error. Setiap provider yang tidak OpenAI-compatible WAJIB punya penanda `kind` eksplisit.
- Verifikasi sync-stok: docs/test-report.md mencatat 602 test padahal npm test nyata = 603 (drift dokumen vs gate). Angka laporan review/test JANGAN dipercaya; selalu jalankan npm test sendiri dan pakai hitungan runtime sebagai bukti.

- Verifikasi: test baru bisa lolos walau fix tidak ada (vacuous) - cek dengan mutasi balik ke perilaku lama lalu pastikan test GAGAL, bukan sekadar assert.equal pada state yang tak pernah berubah.
- Task deskripsi daftar 'files changed' tak boleh dipercaya buta: git status --short menunjukkan 11 modified + 11 untracked, jauh lebih banyak dari yang diklaim (sisa kerja belum commit). Verifier harus enumerasi sendiri, bukan ikut klaim scope.

- **qty movement `sync_confirmed` selalu 0 (pre-existing, bukan regresi fix idempotensi).** `applyDraft` hitung `qty = nilaiFirestore - bacaParitasOnline(stok)` SAAT APPLY, tapi `tandaiTersinkron`/stok sudah bernilai sama dengan `item.nilai_firestore` -> delta selalu 0. `id_movement` deterministik menutup dobel-count, tapi bila stok berubah antara draft dibuat & apply, retry bisa menimpa delta asli dgn 0. Kalau audit delta sync ingin benar: simpan `stok_sebelum` di item draft saat `mulaiSyncStok`, hitung qty dari situ.
