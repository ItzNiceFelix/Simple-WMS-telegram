# Code Review — A2 UI / B-W4 + B-W5 (belum di-commit)

Reviewer independen. Read-only. Base commit: `73f5b19` ("feat(dashboard): v3b - A7 approve akses, A5 tambah produk, A2 konfirmasi draft").
Perubahan di-review: `git diff` working tree + file untracked.

## Ringkasan gate (bukti)

| Gate | Perintah | Hasil |
|---|---|---|
| Unit test | `npm test` | **310 pass / 0 fail** (7 test baru `paritasA2Data.test.js`) |
| Typecheck | `npx tsc --noEmit` | **exit 0** |
| Playwright | TIDAK dijalankan (aturan keras: `next dev`/Playwright dilarang) | — |

## Verdict: **CHANGES_REQUIRED**

Ada 1 temuan **BLOCKING** (visibilitas tombol "Konfirmasi Semua" untuk admin = pelanggaran matriks izin §7.1/§10.3) dan 2 **IMPORTANT** (paritas mock↔server pada jalur sync & picking). Semua temuan bersifat UI/mock — tidak ada data korup; server tetap fail-closed.

---

## BLOCKING

### B-1. `Konfirmasi Semua` (sync) tampil untuk admin pada draft MILIK ORANG LAIN

- Lokasi: `app/draft/page.tsx:172-176`
- Kode:
  ```tsx
  aksi={
    bolehAksi && sync.length >= 2 ? (
      <KonfirmasiSemuaSync draftId={sync[0].id} onSukses={muat} />
    ) : null
  }
  ```
  `bolehAksi = role === "owner" || role === "admin"` (baris 118). **Tidak ada filter owner.**
- Bukti pelanggaran kontrak:
  - PRD §7.1: admin hanya boleh konfirmasi draft miliknya (`owner_user_id === sesi.uid`).
  - PRD §10.3: baris "Admin + draft orang lain | Tombol konfirmasi **DISEMBUNYIKAN**".
  - Kartu per-draft (`DraftSync`, baris 356) SUDAH memakai `gerbangAksi` dan menyembunyikan tombol dengan benar. Tombol seksi ini luput.
- Dampak nyata: admin melihat tombol "Konfirmasi Semua" meskipun semua draft sync bukan miliknya; klik -> `konfirmasiDraft({jenis:"sync", draft_id: sync[0].id, kondisi:"semua"})` -> server 403 `"Hanya owner atau pembuat draft yang dapat mengonfirmasi."`. Tidak ada mutasi data (aman), tetapi:
  - melanggar matriks izin yang disetujui (BLOCKING sesuai kriteria tugas: "tombol muncul padahal server akan 403"),
  - e2e `e2e/draft-konfirmasi.spec.ts` hanya menguji kartu (`konfirmasi-sync-sd-001`), TIDAK menguji tombol seksi untuk admin -> gap test menyembunyikan regresi ini.
- Perbaikan minimal: hitung hanya draft yang berhak, mis. `syncYangBoleh = sync.filter(d => gerbangAksi(role, uid, d.owner_user_id) === "aksi")` lalu syarat `syncYangBoleh.length >= 2` dan pakai `syncYangBoleh[0].id`.

---

## IMPORTANT

### I-1. Paritas mock↔server salah pada apply sync: mock TIDAK membatasi ke pemilik

- Lokasi: `lib/dashboard/data/mock.ts:663-675`
  ```ts
  const drafts = store.syncDrafts.filter((d) => d.status === "pending_confirmation");
  const dipilih = kondisi === "semua" ? drafts : drafts.filter((d) => d.kondisi === kondisi);
  ```
- Server: route memanggil `konfirmasiSyncStok(ownerUserId, "ya semua")` (route.ts:458). Fungsi bot membaca `sessions/{ownerUserId}.pendingSyncStok` -> **ter-scope per pemilik**. Mock justru memproses SELURUH `store.syncDrafts` pending lintas pemilik (dan termasuk draft orphan).
- Bukti nyata di seed saat ini: `e2e/draft-konfirmasi.spec.ts:108-119` klik "Konfirmasi Semua" (draft_id `sd-001`, owner `900002`) lalu meng-assert `sd-001` hilang. Mock juga menandai `sd-orphan` (owner null) `processed`. **Di server, `sd-orphan` tidak akan ikut** (bukan milik sesi owner 900002) dan route akan mengembalikan 409 `"Pemilik draft tidak dapat diverifikasi..."` bila `sd-orphan` dijadikan `sync[0]`.
- Dampak nyata: perilaku mock TIDAK merepresentasikan server; e2e "Konfirmasi Semua" hijau palsu (lolos dengan semantik berbeda). Verifikasi manual di mock memberi keyakinan berlebih.
- Perbaikan minimal: filter `drafts` dengan owner yang diotorisasi, mis. `ambilOwnerDraft(dokumen) === ownerUserId` (ownerUserId dari draft target), atau tirukan scope sesi (`ownerUserId`).

### I-2. Divergensi mock↔server pada isi batch picking (`pickingMovements` vs seluruh movement)

- Lokasi: `lib/dashboard/data/mock.ts:368-372` (sumber pending = `store.pickingMovements` saja) vs `real.ts:557-561` (sumber pending = `listMovements({status})` = SELURUH movement).
- Bukti kode: seed `MOCK_MOVEMENTS` memuat `mv-008` (owner `900002`, `status:"pending_confirmation"`, `action_type:"kurangi_stok"`, `source:"manual_chat"`). Di `real.ts`, movement ini **masuk** batch picking owner 900002 -> batch berisi 3 movement (mv-008 + pk-004 + pk-005). Di mock, batch 900002 hanya 2 movement (`pk-004`,`pk-005`) karena `mv-008` hidup di `store.movements`.
  - Efek: `siap` berbeda (real 3, mock 2) dan `movements.length` berbeda. e2e `"2 item siap diproses, 0 dilewati"` (spec:67) hanya benar untuk mock, BUKAN untuk produksi.
- Ini BUKAN sekadar artefak mock: aturan produksi (PRD §5.4) "`status==pending_confirmation` + `action_type != null` dikelompokkan per owner" akan menganggap movement `koreksi_manual`/`manual_chat` sebagai anggota "picking batch", lalu konfirmasi memanggil `konfirmasiPickingList` yang membaca `sessions.pendingPickingList` — koleksi yang berbeda. Risiko: kartu "Picking List" menampilkan movement non-picking dan `siap` meleset.
- Dampak nyata: label/ringkasan batch di produksi bisa menyesatkan; mock menyembunyikannya sehingga issue tidak terdeteksi.
- Perbaikan minimal (mock, agar paritas): jadikan `store.pickingMovements` = seed dari `MOCK_PICKING_MOVEMENTS` + movement `source:"screenshot"` dari `MOCK_MOVEMENTS` yang pending & ber-`action_type`, dan baca pending dari gabungan yang sama seperti real. Perbaikan produksi (di luar scope A2 UI): persempit kriteria batch (mis. `source === "screenshot"`).
- Catatan: test baru `test/paritasA2Data.test.js` (dan `docs/test-report-v3b-a2.md` §5 Gap 1) mengakui divergensi mock/real ini TIDAK tertangkap unit test. Temuan ini mengkonfirmasi gap tersebut nyata.

---

## NIT / INFO

### N-1 (NIT). `Konfirmasi Semua` memakai `sync[0]` yang bisa draft orphan / tidak berhak
- `app/draft/page.tsx:174` — `draftId={sync[0].id}`. Bila draft pertama orphan (owner null), server 409 fail-closed (aman), tapi UX menyesatkan. Selesaikan bersama B-1 (pilih draft pertama yang berhak).

### N-2 (NIT). Duplikasi `data-testid` lintas dialog sync
- `data-testid="batal-konfirmasi-sync"` ada di `KonfirmasiSemuaSync` (`page.tsx:481`) DAN `AksiDraft` sync (`page.tsx:702`). Saat ini aman karena Radix hanya me-mount konten dialog yang terbuka (satu aktif pada satu waktu). Fragile: bila kelak `forceMount`/dua dialog terbuka, locator Playwright strict-mode akan gagal. Tidak memblokir.

### N-3 (NIT). PRD menyebut "tooltip", implementasi hanya teks
- `app/draft/page.tsx:260` menampilkan teks statis `"Hanya pembuat draft atau owner"`, bukan tooltip. e2e hanya cek `toContainText` -> kontrak test lolos. Sesuai minimal.

### N-4 (INFO). Bounded query pada E-3 (`limit` tidak konsisten)
- Server `aksiDraft.js:43-49` memakai `limit(100)`; `real.ts:558/579` memakai default `limit(200)` (`listMovements`). Bila pemilik punya >100/200 movement, movement `processed` lama bisa tak terlihat -> UI menampilkan tombol padahal server 409 "sebagian". Fail-closed di server, jadi aman; risiko UX saja. Tradeoff N7 yang diakui.

### N-5 (INFO). `getRingkasan` menambah 2 query Firestore
- `real.ts:243` memanggil `this.listPickingDrafts()` yang memanggil `listMovements` DUA kali (pending + semua). Setiap load ringkasan +2 query. Minor perf.

### N-6 (INFO). Guard `draft_kirim_guard` (409 "Draft sedang diproses.") tidak disimulasikan mock
- Didokumentasikan di `mock.ts:507-508`. PRD §10.3 mencantumkan state 409 "sedang diproses" tetapi tidak ada e2e/unit yang menutupnya. Mock lebih longgar pada guard ini (satu-satunya guard yang sengaja dilewati).

### N-7 (INFO). Seed sync `kondisi:"selisih"` invalid vs server
- `mock-data.ts:252` memakai `"selisih"`, tidak ada di `KONDISI_VALID` (`validasiTulisV3a.js:185`). UI meng-OMIT kondisi (`KONDISI_DIKENAL`, `page.tsx:54-60`) sehingga server memperlakukan `"semua"`. Akibatnya e2e "sync per kelompok" (`spec:95-106`) sebenarnya menguji jalur "semua", bukan per-kelompok. Cakupan test menyesatkan, walau UX-seed sengaja.

---

## FALSE ALARM (tampak salah, ternyata BENAR)

1. **`this.listPickingDrafts()` di dalam `getRingkasan` (`real.ts:243`) — `this` aman.** `getRingkasan` dipanggil sebagai method object: `data.getRingkasan()` (`app/page.tsx:44`), bukan didestruktur. `this` = objek `DataSource`. Tidak ada consumer yang mengambil `getRingkasan` tanpa binding. **BENAR.**
2. **`e2e/staff.spec.ts:32-33` mengharap tepat 2 tombol `tinjau-telegram` — tidak regresi.** `DraftPicking` (`page.tsx:560-579`) hanya render `AksiDraft`, TANPA `TombolTelegram`; kartu orphan juga tidak render (hanya saat `gerbang === "aksi"`). Jadi tetap 2. **BENAR.**
3. **`listMovements` (histori) tidak menampilkan seed picking di mock — sesuai kontrak.** `mock.ts:462` memakai `store.movements.slice()`, bukan `pickingMovements`. Di produksi keduanya memang koleksi yang sama (`stock_movements`), jadi pemisahan hanya untuk melindungi count e2e (`histori.spec.ts`=12, `ringkasan.spec.ts`=10). **BENAR (dengan catatan I-2).**
4. **`sebagian` (E-3) kini dihitung dari SELURUH movement pemilik, bukan pending.** `mock.ts:392` `movementBatch(batchId)` = `[...store.movements, ...store.pickingMovements]`; `real.ts:603` `perOwnerSemua.get(batchId)`. Regresi lama (selalu `false`) sudah diperbaiki. Bukti: test `test/paritasA2Data.test.js` #4 dan `test/draftKonfirmasiV3b.test.js` T5/E-3. **BENAR.**
5. **State 401 tidak menutup dialog / tidak reset state di semua aksi.** Telusuri:
   - `AksiDraft.kirim` (`page.tsx:626-634`): `tampilkanGagalTulis` mengembalikan `true` -> `setDialog(null)`/`onSukses()` TIDAK dipanggil. `finally` hanya `setMengirim(false)`. Aman untuk opname/sync/picking + batal.
   - `KonfirmasiSemuaSync.kirim` (`page.tsx:439-445`): sama.
   - `catch` (`page.tsx:635-637`, `446-448`): hanya toast generik, dialog tetap terbuka.
   **BENAR.**
6. **`KonfirmasiDraftRequest`/`KonfirmasiDraftResponse` cocok dengan route.** Server mengembalikan `{ok:true, jenis, aksi_draft, ...hasil}` (`route.ts:481`) dan error `{ok:false, error}` (`route.ts:399/412/418/424/475/477`). Body route membaca `jenis`, `draft_id`/`batch_id`, `aksi_draft`, `kondisi` (`validasiTulisV3a.js:189-221`). Type tidak membaca `owner_user_id` dari body (anti-pemalsuan) — sesuai. **BENAR.**
7. **Status 404/403/409 tidak dibedakan di `KonfirmasiDraftResponse`** — bukan bug: UI hanya butuh string pesan (`tampilkanGagalTulis`). **BENAR.**
8. **`PickingBatchDoc.batch_id` = telegram user id pemilik; orphan dikelompokkan kunci `""` -> `owner_user_id:null`.** Server `ambilBatchPicking(db, "")` tidak akan pernah menemukan orphan (`null === ""` false), tapi UI menyembunyikan tombol (`gerbangAksi` -> `tanpa_pemilik`). Tidak reachable. **BENAR (fail-closed).**

## Ketidakcocokan pesan/status mock vs server (tabel temuan)

| Kasus | Pesan server (`route.ts`/`aksiDraft.js`) | Pesan mock (`mock.ts`) | Cocok? |
|---|---|---|---|
| jenis invalid | "Jenis draft tidak dikenal." (400) | sama | ✅ |
| aksi_draft invalid | "Aksi draft tidak dikenal." (400) | sama | ✅ |
| kondisi non-sync | "Kondisi hanya untuk draft sync." (400) | sama | ✅ |
| kondisi invalid | "Kondisi tidak dikenal." (400) | sama | ✅ |
| picking tanpa batch_id | "Batch picking tidak ditemukan." (400) | sama | ✅ |
| non-picking tanpa draft_id | "Draft tidak ditemukan." (400) | sama | ✅ |
| role guest | "Akses ditolak. Hubungi owner." (403) | sama | ✅ |
| draft tidak ada | "Draft tidak ditemukan." (404) | sama | ✅ |
| batch tidak ada | "Batch picking tidak ditemukan." (404) | sama | ✅ |
| owner null | "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram." (409) | sama | ✅ |
| admin bukan pembuat | "Hanya owner atau pembuat draft yang dapat mengonfirmasi." (403) | sama | ✅ |
| draft sudah diproses | "Draft ini sudah diproses sebelumnya." (409) | sama | ✅ |
| batch sebagian | "Batch picking ini diproses sebagian. Selesaikan lewat Telegram." (409) | sama | ✅ |
| batch sudah | "Batch picking ini sudah diproses sebelumnya." (409) | sama | ✅ |
| kondisi sync kosong | "Tidak ada draft kelompok itu yang masih pending." (409) | sama | ✅ |
| **guard 10s** | "Draft sedang diproses." (409) | **TIDAK ADA** | ❌ (N-6, disengaja) |
| **model throw** | "Gagal memproses draft." (500) | **TIDAK ADA** (mock abaikan bot) | ❌ (disengaja) |
| **bot ok:false** | "Draft sedang diproses atau..." / "Draft ini sudah diproses sebelumnya." (409) | **TIDAK ADA** | ❌ (disengaja) |

Seluruh pesan validasi/otorisasi/status cocok literal. Tiga baris terakhir adalah penyederhanaan mock yang didokumentasikan.

## Yang sudah DIVERIFIKASI dan BENAR

- Paritas pesan & urutan guard opname/sync/picking: 15 baris cocok literal (tabel di atas).
- E-3 dihitung dari seluruh movement pemilik (mock & real).
- 401 tidak menutup dialog di semua jalur; `tampilkanGagalTulis` dipakai bersama (bukan ad-hoc).
- `pickingMovements` terpisah: histori mock tetap 12 baris; `konfirmasiDraft` picking benar membaca/mengubah batch dari gabungan (`movementBatch`).
- `mutasiStok` (`store.movements.unshift`) tidak perlu menyentuh `pickingMovements` (fitur lain).
- `this` di `getRingkasan` aman (dipanggil sebagai method).
- `draftPending` mock & real konsisten menambah jumlah BATCH (bukan movement).
- Otorisasi kartu per-draft benar: owner semua, admin hanya miliknya, orphan fail-closed, guest ditolak.
- `dataKosong` + `real.ts` + `mock.ts` memenuhi `DataSource` (`satisfies`) — `tsc` exit 0.
- Layout `<ul>` flex (bukan tabel lebar) -> tidak render tabel pada 360px.
- Unit test 310/0, tsc 0.

## Aturan yang dipatuhi saat review

- Read-only: tidak ada file yang diubah. Tidak ada `kill`/`taskkill`/`Stop-Process`.
- Tidak menjalankan `next dev`/`next start`/Playwright. Hanya `npm test` + `npx tsc --noEmit`.
- Laporan ditulis hanya ke `docs/code-review-bw4.md`.
