# Riset Dashboard WMS Ringan — Firestore Multi-Gudang

Tanggal akses semua sumber: **2026-09-16** (kecuali dinyatakan lain).
Lingkup: fakta + perbandingan. Tidak ada rekomendasi arsitektur final.

---

## A. Model multi-gudang di Firestore

### A.1 Batas teknis Firestore (dokumen)

| Batas | Nilai | Sumber |
|---|---|---|
| Ukuran maksimum dokumen | 1 MiB (1,048,576 bytes) | https://firebase.google.com/docs/firestore/quotas (akses 2026-09-16) |
| Ukuran maksimum field value | 1 MiB - 89 bytes (1,048,487 bytes) | https://firebase.google.com/docs/firestore/quotas |
| Kedalaman maksimum map/array | 20 level | https://firebase.google.com/docs/firestore/quotas |
| Ukuran maksimum API request | 10 MiB | https://firebase.google.com/docs/firestore/quotas |
| Maksimum nested `match` di Security Rules | 10 | https://firebase.google.com/docs/firestore/quotas |
| Maksimum path segment di nested match | 100 | https://firebase.google.com/docs/firestore/quotas |
| Maksimum path capture variable | 20 | https://firebase.google.com/docs/firestore/quotas |
| Maksimum function call depth (rules) | 20 | https://firebase.google.com/docs/firestore/quotas |
| Maksimum argumen function (rules) | 7 | https://firebase.google.com/docs/firestore/quotas |
| Maksimum let bindings per function (rules) | 10 | https://firebase.google.com/docs/firestore/quotas |
| Maksimum ekspresi dievaluasi per request (rules) | 1,000 | https://firebase.google.com/docs/firestore/quotas |
| Ukuran ruleset | 256 KB source / 250 KB compiled | https://firebase.google.com/docs/firestore/quotas |
| Free tier baca / tulis / hapus | 50.000 / 20.000 / 20.000 per hari | https://firebase.google.com/docs/firestore/quotas |

Catatan penting: **tidak ditemukan** klaim resmi "hotspot write 1/detik per dokumen" di dokumentasi Firebase. Yang terdokumentasi adalah:

- Dokumen di-update berulang: "The exact maximum rate that an app can update a single document depends highly on the workload." (kualitatif, tanpa angka tetap) — https://firebase.google.com/docs/firestore/best-practices (akses 2026-09-16).
- Batas kuantitatif resmi: **500 writes/detik** ke collection yang punya field ber-index dengan nilai berurutan (mis. timestamp); juga rekomendasi "500/50/5 rule" (500 ops/detik lalu naik 50% tiap 5 menit) untuk collection baru — https://firebase.google.com/docs/firestore/best-practices.
- Hindari dokumen ID monotonik naik (mis. `Product 1`, `Product 2`); Firestore pakai scatter algorithm jadi auto-ID aman dari hotspot — https://firebase.google.com/docs/firestore/best-practices.
- Batas index: array/map besar bisa mendekati **40.000 index entries per dokumen** — https://firebase.google.com/docs/firestore/best-practices.

[INFERENSI] Klaim "1 write/detik per dokumen" yang beredar umum kemungkinan merujuk pada batas praktis longgar atau RTDB, bukan angka resmi Firestore. Dokumentasi resmi menyebut 500/detik pada kondisi tertentu.

### A.2 Tiga pola penyimpanan stok per gudang

Firebase punya halaman resmi "Choose a data structure" yang membandingkan tepat tiga opsi ini — https://firebase.google.com/docs/firestore/manage-data/structure-data (akses 2026-09-16):

| Pola | Kelebihan (klaim resmi) | Keterbatasan (klaim resmi) |
|---|---|---|
| (a) Nested map `qty_per_gudang` dalam 1 dokumen produk | "easy to set up and streamlines your data structure" untuk list sederhana & fixed | "isn't as scalable"; dokumen ikut membesar -> retrieval makin lambat |
| (b) Root-level collection terpisah per (produk,gudang) | Baik untuk relasi many-to-many; query kuat per collection | "Getting data that is naturally hierarchical might become increasingly complex" |
| (c) Subcollection di dalam dokumen | Ukuran parent tak berubah saat list tumbuh; dapat query penuh + collection group query | "You can't easily delete subcollections" |

Contoh resmi arah (c) diberikan Firebase untuk data yang tumbuh seiring waktu (chat: `rooms/{room}/messages`), lihat sumber yang sama. Halaman ini **tidak** menyebut kasus stok/gudang secara eksplisit.

### A.3 Kapan map vs subcollection menang?

- Dokumentasi resmi Firebase di atas adalah satu-satunya panduan resmi yang ditemukan; ia memberi kriteria umum (fixed & simple -> map; tumbuh -> subcollection/collection), bukan aturan stok.
- [TIDAK DITEMUKAN] Dokumentasi resmi Firebase spesifik "inventory per warehouse, map vs subcollection".
- Contoh praktik industri yang ditemukan (bukan Firestore): ERPNext menyimpan saldo sebagai kombinasi unik Item x Warehouse — "ERPNext maintains stock balance for every distinct combination of Item and Warehouse" — https://docs.frappe.io/erpnext/warehouse (updated 2026-04-27, akses 2026-09-16). Ini menyerupai pola (b) di level konsep.
- InvenTree: setiap *Stock Item* adalah "a physical quantity of the Part in a specific location" dan tiap Part bisa punya banyak stock item di lokasi berbeda — https://docs.inventree.org/en/latest/stock/ (akses 2026-09-16). Konsep: stok = pasangan (part, location).

[INFERENSI] Dalam Firestore, map `qty_per_gudang` cocok bila jumlah gudang kecil, tetap, dan tidak query lintas gudang; dokumen per (produk,gudang) unggul untuk query agregasi lintas gudang dan menghindari batas 1 MiB; subcollection unggul bila gudang sangat banyak/bervariasi. Ini inferensi dari kriteria resmi di A.2, bukan pernyataan vendor.

### A.4 Pola RBAC "scope per lokasi/tenant"

- Firebase punya solusi resmi "Secure data access for users and groups" (pola role disimpan sebagai map di dokumen target, mis. `roles: {uid: "owner"}`) — https://firebase.google.com/docs/firestore/solutions/role-based-access (last updated 2026-09-10, akses 2026-09-16).
- Pola resmi tsb membaca role dari **resource dokumen itu sendiri** dan/atau dari dokumen lain via `get()`. Contoh `function getRole(rsc) { return rsc.data.roles[request.auth.uid]; }`.
- [TIDAK DITEMUKAN] Halaman resmi Firebase yang secara eksplisit mendemonstrasikan pola "tenant/lokasi scope" (mis. `allowed_locations` array di dokumen user). Yang ada adalah pola role-map per dokumen dan warning tentang "Large Groups".

---

## B. Firestore Security Rules untuk multi-gudang

### B.1 Bisakah rules membaca `lokasi_gudang` dari custom claims atau dokumen user?

Ya, keduanya didukung.

**Dari custom claims (ID token):**
- Custom claims bisa dibaca di rules via `request.auth.token.<claim>` / `auth.token.<claim>`. Contoh resmi (RTDB) `.read": "auth.token.admin === true"` — https://firebase.google.com/docs/auth/admin/custom-claims (akses 2026-09-16).
- Claims di-set dari privileged server (Admin SDK) dan dipropagasi ke ID token — sumber sama.
- **Batas ukuran payload custom claims: 1000 bytes**, jika lebih akan error — https://firebase.google.com/docs/auth/admin/custom-claims. (Penting bila `lokasi_gudang` adalah array besar.)
- Firebase menyarankan claims hanya untuk kontrol akses, bukan menyimpan data profil; "Custom claims are limited in size" — sumber sama.
- [INFERENSI] Karena Firestore rules mewarisi `request.auth.token`, array `lokasi_gudang` di claim bisa dipakai, tapi berisiko melewati 1000 bytes jika gudang/user banyak.

**Dari dokumen user via `get()`:**
- `get()` dan `exists()` dapat mengevaluasi request terhadap dokumen lain; path harus lengkap, variabel di-escape `$(variable)` — https://firebase.google.com/docs/firestore/security/rules-conditions (akses 2026-09-16).
- Contoh resmi persis untuk pola ini: `get(/databases/$(database)/documents/users/$(request.auth.uid)).data.admin == true` — sumber sama.
- Pola resmi role-based-access juga pakai `get()` untuk baca role dari dokumen parent — https://firebase.google.com/docs/firestore/solutions/role-based-access.

### B.2 Batasan biaya & limit `get()`

- Limit document access call (`exists()`, `get()`, `getAfter()`): **10 per request** (single-document/query), **20** untuk multi-document reads, transaksi, batched writes — https://firebase.google.com/docs/firestore/security/rules-conditions dan https://firebase.google.com/docs/firestore/quotas.
- Melebihi limit = **permission denied**.
- Beberapa call bisa di-cache dan cache tidak dihitung ke limit — sumber sama.
- **Biaya**: "Using these functions executes a read operation ... you will be billed for reading documents even if your rules reject the request." — https://firebase.google.com/docs/firestore/security/rules-conditions. Jadi setiap evaluasi rules yang memakai `get()` menambah read billable.

### B.3 Pola resmi "user hanya akses dokumen yang gudang_id ada di scope-nya"

- Pola resmi yang ditemukan adalah **role di dalam dokumen target** (`rsc.data.roles[request.auth.uid]`), bukan scope lokasi — https://firebase.google.com/docs/firestore/solutions/role-based-access.
- Aturan penting query: **"Rules are not filters"** — query dievaluasi terhadap potensi result set; jika query bisa mengembalikan dokumen yang tidak boleh dibaca, **seluruh request gagal**. Query harus memuat constraint yang sama dengan rules — https://firebase.google.com/docs/firestore/security/rules-query (akses 2026-09-16).
- Contoh resmi: rules `resource.data.published == true` mengharuskan query `.where("published", "==", true)` — sumber sama.
- [INFERENSI] Untuk scope gudang, konsekuensinya: klien wajib menambahkan `where("gudang_id", "in", [...scope])` (atau `array-contains`), dan rules memverifikasi keanggotaan via claim atau `get()`. Ini menerapkan pola "same constraints" dari dokumentasi, bukan contoh resmi yang sudah jadi.
- `request.query` dapat dipakai untuk menolak query tanpa limit, mis. `allow list: if request.query.limit <= 10;` — https://firebase.google.com/docs/firestore/security/rules-query.
- Cloud Firestore `list`/`get` bisa dipisah; `list` berlaku untuk query/collection — sumber sama.

---

## C. Pola WMS ringan untuk UMKM

### C.1 Tingkat kompleksitas WMS (klasifikasi akademik)

Wikipedia (mengutip Tompkins, *Facilities planning*, 2010) membagi WMS jadi:
1. **Basic WMS** — inventory management + location control; data performa terbatas pada throughput; "almost indistinguishable from a basic Inventory Management System".
2. **Advanced WMS** — analisis kapasitas & level stok, tracking waktu/labor.
3. **Controlled WMS** — integrasi sistem luar (fleet/GPS/API), feedback otomasi/IoT.
4. **Autonomous WMS** — AI, predictive analytics, robot.

Sumber: https://en.wikipedia.org/wiki/Warehouse_management_system (rev 2026-08-25, akses 2026-09-16).

Definisi inti WMS: "The core function of a warehouse management system is to record the arrival and departure of inventory." — sumber sama.

### C.2 Fitur minimum yang benar-benar dipakai UMKM (<10 gudang)

- Wikipedia menyatakan banyak fasilitas kecil "may use spreadsheets or physical media like pen and paper", dan itu pun bisa dianggap WMS — https://en.wikipedia.org/wiki/Warehouse_management_system.
- InvenTree (open-source, dipakai UMKM/bengkel kecil) fitur intinya: Stock Item = (Part + Location + Quantity), stock locations hierarkis, stock tracking history otomatis, stocktake (last stocktake date), external location flag — https://docs.inventree.org/en/latest/stock/ (akses 2026-09-16).
- ERPNext minimal: Warehouse (bisa berbentuk tree), Stock Entry dengan Purpose (Material Issue/Receipt/Transfer), kuantitas per Item x Warehouse — https://docs.frappe.io/erpnext/warehouse dan https://docs.frappe.io/erpnext/stock-entry (akses 2026-09-16).
- [INFERENSI] Fitur inti yang berulang di semua referensi UMKM-scale: master lokasi, stok per lokasi, pergerakan masuk/keluar, stocktake/opname, traceability dasar (siapa/kapan).

### C.3 Fitur yang tampak penting tapi jarang dipakai (jebakan over-engineering)

- Wikipedia: WMS enterprise cenderung legacy, "inflexible and difficult to maintain"; kustomisasi mahal, "each customization can turn into a reimplementation"; software kompleks -> biaya training naik — https://en.wikipedia.org/wiki/Warehouse_management_system.
- Peneliti Erasmus menyebut WMS standar memaksa kompromi antara kemampuan sistem dan cara gudang ingin beroperasi — sumber sama.
- Wikipedia juga menyebut InvenTree/ERP kecil hanya butuh "basic inventory + location control", sementara fitur advanced (analitik efisiensi, integrasi armada, otomasi) baru muncul di level Advanced/Controlled — sumber sama.
- [INFERENSI] Contoh jebakan yang tampak penting tapi biasanya tak dipakai UMKM <10 gudang: slotting/putaway optimization, wave/cluster picking, removal strategy (FIFO/FEFO/LIFO), yard/dock scheduling, warehouse control system (WCS/WES), multi-step receipt/delivery. Semua ini fitur level Advanced/Controlled (Odoo & Wikipedia).

---

## D. Permintaan antar-gudang sederhana TANPA ERP

### D.1 Cara aplikasi inventory memodelkan permintaan antar gudang

| Sistem | Model | Status/artefak | Sumber |
|---|---|---|---|
| ERPNext | "Stock Entry" Purpose = **Material Transfer**: Source Warehouse + Target Warehouse pada baris item. Transfer antar gudang internal. | Dokumen Stock Entry (draft/submit/cancel/amend) | https://docs.frappe.io/erpnext/stock-entry (updated 2026-04-03, akses 2026-09-16) |
| ERPNext | Warehouse Type bisa di-set "Transit"; fitur **"Add to Transit"** memecah transfer jadi 2 entri (keluar -> transit -> masuk). Entri kedua lewat "End Transit" atau "Get Items From -> Transit Stock Entry" | 2 dokumen Stock Entry terpisah | https://docs.frappe.io/erpnext/stock-entry |
| Odoo | Multi-warehouse; tiap gudang punya Short Name (mis. `WH`, `WHA`); opsi **"Resupply From"**: pilih gudang sumber untuk memenuhi order. Ada konsep *Inter-warehouse replenishment* dan *Resupply Warehouses* | Aturan resupply + transfer | https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/warehouses.html (akses 2026-09-16) |
| Odoo | Transfer bisa 1-step, 2-step, atau 3-step (receipt/delivery); lokasi bisa internal/external/transit | Transfer multi-langkah | https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/ (nav: Two/Three-step receipt & delivery; Locations) |
| InvenTree | Stock Item berpindah lokasi; Stock Tracking mencatat tiap perubahan + user | Riwayat per item | https://docs.inventree.org/en/latest/stock/ |

### D.2 Apakah "in-transit" wajib?

- **Tidak wajib secara teknis untuk model sederhana.** ERPNext menyediakan Material Transfer langsung (Source -> Target) tanpa transit; fitur "Add to Transit" bersifat **opsional** ("If you want ... make two entries for that then use the Add to Transit feature") — https://docs.frappe.io/erpnext/stock-entry.
- Odoo juga mendukung transfer 1-step (langsung) selain 2/3-step — https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/ (nav).
- Virtual/transit location berguna bila ingin akuntabilitas "barang keluar belum masuk" (mis. saat barang diperjalanan). Ini konsep, bukan kewajiban software: ERPNext mewajibkan transit hanya jika memilih fitur tersebut.
- [INFERENSI] Untuk <10 gudang satu lokasi fisik milik sendiri, status `dikirim` -> `diterima` tanpa lokasi virtual cukup untuk memodelkan permintaan antar-gudang. Ini konsisten dengan ketersediaan transfer langsung di ERPNext/Odoo.
- [INFERENSI] Tanpa transit, sistem tetap perlu mencegah double-count: kurangi stok asal saat "dikirim", tambah stok tujuan saat "diterima", dan simpan status di dokumen permintaan.

---

## E. Role editable vs level permission

### E.1 Apakah "jabatan bebas + level permission tetap" praktik umum?

- Dalam RBAC, "role" didefinisikan sebagai **job function/title yang mendefinisikan authority level**; permission di-assign ke role, user di-assign ke role (bukan permission langsung) — https://en.wikipedia.org/wiki/Role-based_access_control (rev 2026-07-09, akses 2026-09-16).
- Jadi memisahkan **job title (yang bisa editable)** dari **set permission tetap** adalah pola RBAC yang lazim: role diberi label jabatan bebas, tetapi mapping role->permission yang tetap.
- Istilah terkait yang ditemukan:
  - **Role explosion** — masalah saat role terlalu banyak/granular sehingga sulit dikelola; kritik RBAC di sistem besar — https://en.wikipedia.org/wiki/Role-based_access_control.
  - **ABAC / policy-based access control (PBAC)** — alternatif yang mengevaluasi atribut (termasuk job title, department, location) alih-alih role statis — https://en.wikipedia.org/wiki/Attribute-based_access_control (rev 2026-08-05, akses 2026-09-16).
- [TIDAK DITEMUKAN] Istilah baku spesifik "free-text job title + fixed permission level" di sumber resmi/akademik. Konsep terdekat adalah pemisahan role (assignable) dari permission (fixed set) dalam RBAC, plus role explosion.

### E.2 Risiko bila jabatan bebas ikut jadi penentu permission

- RBAC mengingatkan **role explosion**: bila granularitas kontrol lebih halus dari yang dapat ditampung role, jumlah role meledak dan pengelolaan rumit — https://en.wikipedia.org/wiki/Role-based_access_control.
- Bila jabatan bebas (string) dipakai sebagai key permission, setiap variasi ejaan/jabatan baru berpotensi membuat "role" baru tanpa disengaja -> mapping permission tidak terkontrol dan audit sulit. [INFERENSI] (implikasi langsung dari definisi role explosion).
- RBAC punya aturan eksplisit "Role assignment / Role authorization / Permission authorization": permission hanya boleh diberikan via role yang di-otorisasi — jabatan bebas yang tidak terikat aturan permission melanggar prinsip ini — https://en.wikipedia.org/wiki/Role-based_access_control.
- ABAC menawarkan alternatif: policy Boolean atas atribut subject/object/action/context, mis. "user dapat melihat dokumen jika departemennya sama" — https://en.wikipedia.org/wiki/Attribute-based_access_control. Ini bisa memisahkan job title (atribut tampilan) dari policy akses.
- [INFERENSI] Risiko konkret lain: (1) privilege escalation bila jabatan baru dibuat tanpa definisi permission; (2) sulitnya menegakkan least privilege; (3) audit trail membingungkan karena nama jabatan berubah tanpa mengubah hak akses.

---

## Yang Tidak Ditemukan

- **Batas resmi "1 write/detik per dokumen"** di dokumentasi Firebase. Yang resmi: 500 writes/detik pada kondisi field berurutan ber-index, dan peringatan kualitatif update dokumen berulang. (https://firebase.google.com/docs/firestore/best-practices)
- **Halaman resmi Firebase** yang mendemonstrasikan pola "scope per lokasi/tenant" atau `allowed_locations` array di dokumen user. Yang tersedia hanya pola role-map per dokumen (`solutions/role-based-access`).
- **Dokumentasi resmi Firebase** tentang desain stok "per gudang" (map vs subcollection untuk inventory). Hanya ada panduan umum struktur data.
- **Studi kasus/angka spesifik "UMKM <10 gudang"** untuk fitur WMS minimum. Yang ditemukan adalah dokumentasi produk (InvenTree, ERPNext, Odoo) dan klasifikasi akademik WMS (Wikipedia).
- **Istilah baku** untuk pola "jabatan bebas + level permission tetap". Konsep terdekat: RBAC role/permission separation dan role explosion (Wikipedia RBAC).
- **Sumber primer vendor** (NetSuite, dsb.) untuk daftar fitur WMS UMKM — akses mengembalikan 403/404, tidak dipakai.
- **Halaman Wikipedia "Role engineering"** — 404 (tidak dipakai).
- **Konfirmasi resmi** apakah Firestore rules bisa membaca array claim secara langsung dengan operasi himpunan (`in`); contoh resmi yang ditemukan hanya `auth.token.<scalar> === value`. [INFERENSI] array claim kemungkinan bisa, tetapi tidak terverifikasi dari contoh resmi.
