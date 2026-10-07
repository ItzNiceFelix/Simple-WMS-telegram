# Discovery v5 — Dashboard Multi-Gudang, Permintaan, Opname, Is-Online, Role Jabatan

Status: discovery (masalah + scope + alur level tinggi). Bukan PRD.
Tanggal: 2026-09-16.
Keputusan terkunci: D1(a), D2(a), D3(a), D4(a), D5(c). Tanpa integrasi Kledo/ERP.

---

## 1. Problem statement

Saat ini dashboard hanya punya SATU wadah stok: `stock/{kode_barang}.stok_gudang_online` (`lib/models/stok.js:26`).
Tidak ada cara membedakan barang yang ada di Gudang A vs Gudang B — padahal user
menyebut ada "gudang sebelah" dan ingin memindahkan barang antar lokasi.

Akibatnya dari sudut pandang user:
- **Barang milik lebih dari satu lokasi tercampur jadi satu angka.** Saat 2 lokasi
  menjual barang yang sama, stok terlihat "lebih banyak" dari kenyataan, dan tidak ada
  cara tahu berapa yang benar-benar ada di masing-masing lokasi. Keputusan beli jadi salah.
- **Minta barang ke gudang sebelah harus lewat chat/lisan.** Tidak ada jejak siapa minta apa,
  siapa kirim, kapan diterima, dan berapa yang akhirnya sampai. Kalau barang tidak sampai,
  tidak ada bukti.
- **Stok opname hanya menimpa satu angka.** `timpaStokOpname` (`lib/models/stok.js:86`) langsung
  menulis nilai fisik tanpa membedakan lokasi; selisih opname hilang tanpa persetujuan owner.
- **Filter stok dipaksa ke produk online saja.** `rowsStok()` di `real.ts:166-168` hanya
  memproses `semuaProdukOnline()`, jadi item non-online tak pernah muncul walau user ingin
  membacanya; dan `is_online_product` hanya bisa diubah lewat bot (`lib/models/produk.js:101-106`)
  — tidak ada tombol di dashboard.
- **Jabatan tidak ada.** `admins.role` hanya `owner|admin|guest` (`lib/models/admins.js:53`);
  user ingin menamai jabatan ("Admin Stok") tanpa mengubah level permission, dan ingin
  menandai lokasi kerja tiap user supaya tahu siapa di gudang mana.

Kenapa fitur ini perlu: tanpa lokasi gudang, permintaan antar-gudang, dan opname ber-approval,
satu-satunya cara kerja adalah ingatan orang. Begitu ada >1 lokasi, data stok berhenti bisa dipercaya.

---

## 2. Target user & peran

| Peran | Level (tetap) | Kebutuhan utama |
|---|---|---|
| Owner | `owner` | approve opname berselisih, kelola gudang/jabatan, lihat semua lokasi |
| Admin (mis. "Admin Stok", "Admin Toko") | `admin` | input opname, buat permintaan, flag is-online & gudang item, lihat lokasi sendiri |
| Guest | `guest` | baca (read-only), tanpa tulis |

Tambahan konsep (baru):
- **Jabatan (editable, kosmetik)** — label bebas yang dipakai untuk tampilan & "Kirim ke".
  TIDAK menentukan permission. Permission tetap diturunkan dari `level` (`owner|admin|guest`).
  Ini pola RBAC yang memisahkan job title dari permission; risiko role explosion bila label
  ikut jadi penentu akses (lihat `docs/research-dashboard-wms.md:156-171`).
- **Lokasi gudang user** — flag `gudang_id` (tunggal) ke `gudang` tempat user bekerja.
  Dipakai untuk default filter dan sebagai target "Kirim ke: User".
- **Lokasi gudang item** — stok per gudang (map `qty_per_gudang`), terpisah dari
  `is_online_product` (keputusan D1(a)).

---

## 3. Scope: MASUK

- **G1 Master gudang**: tambah / edit / nonaktifkan gudang + list gudang editable tanpa batas jumlah.
- **G2 Flag gudang per item**: set lokasi gudang tiap item lewat dashboard; tulis qty per gudang.
- **G3 Flag gudang per user**: tetapkan satu gudang kerja ke tiap admin.
- **G4 Role editable (jabatan)**: label jabatan bebas per user, level permission tetap.
- **G5 Permintaan antar-gudang**: tombol "Buat Permintaan", multi-item, status `menunggu`->`disetujui`/`ditolak`->`dikirim`->`diterima`.
- **G6 "Kirim ke" multiple**: pilih target berupa Gudang dan/atau User (User menampilkan jabatannya), jamak.
- **G7 Stok opname dari dashboard**: input qty fisik per item; selisih != 0 wajib approve owner.
- **G8 Flag is-online dari dashboard**: tombol toggle `is_online_product` (butuh dashboard baca seluruh item).
- **G9 Filter stok by gudang + by is-online**: default filter = `is_online_product == true`; bisa dilepas untuk melihat item non-online. Filter gudang masuk akal dengan G1/G2.

---

## 4. Scope: TIDAK MASUK

- **Integrasi Kledo/ERP/sheets master apa pun** — keputusan user; seluruh data murni Firestore lokal.
- **Gudang transit / in-transit** — keputusan D3(a); cukup `dikirim`->`diterima`, tanpa lokasi virtual
  (`docs/research-dashboard-wms.md:144-150`).
- **Approval berlapis permintaan** — keputusan D4(a); satu langkah `disetujui` eksplisit sudah cukup,
  tanpa hierarki approver.
- **Reorder point per gudang** — `reorder_point` tetap satu nilai per produk (`stock/{kode}`).
  Menambah per-gudang menambah kompleksitas alert tanpa bukti kebutuhan.
- **Barcode / QR / scanner** — tidak diminta; input tetap manual.
- **Batch / lot / expiry / serial number** — fitur WMS level Advanced/Controlled, bukan basic
  (`docs/research-dashboard-wms.md:104-128`).
- **Hierarki gudang (gudang di dalam gudang) / bin-location** — bukan kebutuhan; daftar flat.
- **Slotting/putaway/picking optimization, wave planning** — over-engineering UMKM <10 gudang.
- **Permission granular per-jabatan** — jabatan kosmetik; permission tetap mapped ke level tetap.
- **Migrasi paksa riwayat `stock_movements` lama ke per-gudang** — riwayat lama tetap apa adanya.

---

## 5. Model data usulan (level konsep, bukan skema final)

- **`gudang/{gudang_id}`** (BARU) — `nama` (editable), `aktif`, `urutan`, `dibuat_at/by`.
  Daftar gudang bebas ditambah tanpa batas.
- **`products/{kode_barang}`** — tetap `is_online_product` global (D1(a), `lib/models/produk.js:104`).
  Tidak menyimpan data gudang (D1(a): gudang konsep terpisah dari flag online).
- **`stock/{kode_barang}`** — tambah `qty_per_gudang: { <gudang_id>: <angka> }` (D2(a)).
  `stok_gudang_online` dipertahankan sebagai agregat/total untuk backward-compat; butuh aturan
  tunggal kapan ia disinkronkan (pertanyaan terbuka Q4). Batas 1 MiB/dokumen
  (`research-dashboard-wms.md:14`) aman untuk jumlah gudang kecil.
- **`admins/{uid}`** — tambah `jabatan` (string bebas) + `gudang_id` (string, opsional).
  `role` TETAP sumber permission (`lib/models/admins.js:53`).
- **`permintaan_gudang/{autoId}`** (BARU) — header: `dari_gudang_id`, `tujuan[]`
  (tiap entri `{tipe: "gudang"|"user", id}`), `status`, `dibuat_by/at`, `riwayat_status[]`;
  `items[]`: `{ kode_barang, qty, qty_terkirim, qty_diterima }`.
- **`opname_gudang/{autoId}`** (BARU) — `gudang_id`, `items[]` dengan
  `{ kode_barang, qty_sistem, qty_fisik, selisih }`, `status` (`menunggu_approval`|`disetujui`|`ditolak`),
  `dibuat_by`, `disetujui_oleh`. Pola serupa `opname_drafts` yang sudah ada, tapi ber-approval.
- **`system_settings`** — menyimpan setelan filter default bila perlu (mis. default lokasi).

---

## 6. Alur utama

**(i) Tambah/edit gudang** — owner buka master gudang -> "Tambah Lokasi Gudang" -> isi nama ->
simpan `gudang/{id}`. Edit = ubah `nama`; item & user yang menunjuk `gudang_id` sama otomatis
ikut berubah tampilannya. Gudang tidak dihapus keras (nonaktif) agar referensi lama tetap valid.

**(ii) Flag item ke gudang** — admin buka detail/filter stok -> pilih item -> set qty per gudang
atau tetapkan gudang. Menulis `qty_per_gudang[gudang_id]` + `last_updated/by`. Audit ke
`stock_movements` dengan penanda gudang.

**(iii) Flag user ke gudang** — owner buka daftar user -> pilih gudang kerja (dan isi jabatan).
Menulis `admins/{uid}.gudang_id` + `jabatan`. Perubahan permission (`role`) tetap lewat
`updateRoleAdmin` (`lib/models/admins.js:79`) dengan audit yang sudah ada.

**(iv) Buat permintaan + "Kirim ke" multiple** — user buka "Buat Permintaan" -> pilih gudang asal ->
tambah item + qty -> "Kirim ke" pilih satu atau banyak target (Gudang dan/atau User; User
menampilkan jabatan) -> simpan `permintaan_gudang` status `menunggu`.
Penerima (atau siapa pun berwenang sesuai D4(a)) -> `disetujui` atau `ditolak`.
Saat `dikirim`: stok asal turun. Saat `diterima`: stok tujuan naik. Tanpa transit (D3(a)).
Catatan: dengan target multiple, pertanyaan "satu dokumen banyak tujuan atau pecah per tujuan?"
tidak bisa dijawab dari konteks (Q1).

**(v) Opname -> approval owner** — admin input qty fisik per item di gudang tertentu ->
sistem hitung `selisih = qty_fisik - qty_sistem`. Selisih 0 -> langsung diproses.
Selisih != 0 -> dokumen `opname_gudang` masuk `menunggu_approval`; owner menyetujui/menolak.
Hanya setelah disetujui `qty_per_gudang` ditulis ulang. Selaras D5(c), tanpa auto-approve.

**(vi) Flag is-online dari dashboard** — dashboard membaca seluruh item (bukan hanya yang online —
lihat `lib/models/produk.js:159`; jalur full-scan sudah ada dan sudah di-cache) lalu render toggle
per item. Toggle memanggil route server yang menulis `products/{kode}.is_online_product`.
Filter stok default `is_online_product == true`; user bisa melepas filter untuk melihat non-online,
dan menambah filter gudang.

---

## 7. Risiko & asumsi

- **R1 — Enforce filter gudang di SERVER, bukan UI.** Repo ini punya preseden bug otorisasi
  (pelajaran "mirror route tidak membuktikan handler", `docs/learnings.md:24`). Filter gudang
  yang hanya di UI = IDOR: user bisa minta gudang mana pun via body. Semua route baru
  (permintaan, opname, mutasi per gudang, list stok per gudang) WAJIB memverifikasi ulang
  keanggotaan gudang dari `admins/{uid}` di server, persis pola role ditegakkan di
  `app/api/stok/mutasi/route.ts:87-103`.
- **R2 — Seed baru merusak e2e yang mengunci COUNT.** `e2e/histori.spec.ts` (`toHaveCount(12)`)
  dan `e2e/ringkasan.spec.ts` (10 baris teratas) mengunci jumlah baris; seed ke koleksi bersama
  merusak keduanya (pelajaran `docs/learnings.md:31-32`). Seed data gudang/permintaan/opname v5
  HARUS dipisah dari koleksi yang sudah dihitung e2e, dan e2e pengunci COUNT dijalankan lebih dulu.
- **R3 — Backfill data lama.** 1107 `products` + 33 `stock` + ~10 `admins` existing belum punya
  konsep gudang. `qty_per_gudang` kosong / `gudang_id` null harus tetap bisa dibaca (fallback ke
  `stok_gudang_online`), dan keputusan kapan/harus-kah backfill tidak bisa dijawab dari konteks (Q4).
- **R4 — Koleksi baru butuh `firestore.rules` eksplisit.** Saat ini semua koleksi `allow write: if false`
  dan default `match /{document=**} { allow read, write: if false; }` (`firestore.rules:18-38`).
  Koleksi `gudang`, `permintaan_gudang`, `opname_gudang` TIDAK terbaca sama sekali sampai
  ditambahkan eksplisit (read untuk role yang tepat), tanpa itu dashboard balas kosong/denied
  walau route server menulisnya.
- **R5 — Composite index.** Query `where(per-status) + orderBy(created_at)` butuh index komposit
  yang tidak terlihat gate mana pun sedangkan mock selalu hijau (`docs/learnings.md:35`).
  Koleksi permintaan/opname v5 kemungkinan butuh index; harus dicek ke project nyata.
- **R6 — DataSource 3x + test paritas.** Setiap method baru harus diimplementasi di
  `index.ts`/`real.ts`/`mock.ts` + test paritas (`lib/dashboard/data/index.ts:65-115`).
  Ini biaya kerja nyata, bukan opsional.
- **R7 — Nama field konsisten.** Pakai snake_case (`gudang_id`, `qty_per_gudang`) sesuai
  pelajaran `docs/learnings.md:5-7`; jangan campur camelCase.
- **R8 — Reorder point lama.** Karena aggregat tetap satu angka, notifikasi reorder yang ada
  (`lib/models/stok.js:132`) tidak boleh berubah perilakunya tanpa keputusan.

**Asumsi:** jumlah gudang kecil (<10); `qty_per_gudang` map aman dari batas 1 MiB; level permission
cukup `owner/admin/guest`; approval opname hanya owner.

---

## 8. Pertanyaan terbuka untuk user

1. **Bentuk target multiple "Kirim ke":** satu dokumen permintaan dengan banyak tujuan
   (satu status untuk semua), atau pecah menjadi satu dokumen per tujuan (tiap tujuan punya
   status kirim/terima sendiri)? Implikasinya besar: stok asal turun sekali vs per tujuan.
2. **Siapa yang berwenang menekan `disetujui`** pada D4(a) — "bebas" itu tepatnya: siapa pun
   yang menerima, hanya owner/admin, atau hanya gudang tujuan? D4(a) tidak menyebut penekan tombol.
3. **Filter gudang default per user:** apakah otomatis mengikuti `gudang_id` user, atau selalu
   "semua gudang" sampai user memilih? Berpengaruh ke apa yang dilihat tiap hari.
4. **Arti `stok_gudang_online` setelah ada `qty_per_gudang`:** tetap total lintas gudang
   (aggregat) atau hanya milik satu gudang khusus? Dan apakah 33 dokumen `stock` existing
   perlu di-backfill ke gudang default, atau dibiarkan kosong dan diisi bertahap?
5. **Jabatan hanya kosmetik atau perlu baca khusus:** apakah "Kirim ke: User" harus bisa
   mengirim ke SEMUA user (termasuk guest), atau hanya user dengan gudang_id terisi?