# Riset WMS: Table-Stakes vs Pembeda — Konteks Toko/UMKM Indonesia

Tanggal riset: 2026-09-16. Metode: dokumentasi produk + artikel industri. Setiap klaim ada URL.
Label: **[V]** = praktik industri terverifikasi (dokumentasi produk/standar), **[O]** = opini sumber (artikel/blog tanpa verifikasi produk), **[I]** = inferensi penulis dari fakta terverifikasi.

Konteks proyek: bot Telegram + dashboard Next.js admin toko, backend jadi jembatan Kledo. Kledo sudah punya `warehouses`, `warehouses/transfers`, `stockAdjustments`, `materialRequests`, `materialIssues`, `warehouses/{id}/racks`, `warehouses/{id}/roles` (lihat `kledo-api-reference.md`). Jadi WMS ini lapisan operasional + akses staf tanpa lisensi Kledo — **bukan pengganti Kledo**.

---

## A. Fitur table-stakes WMS

Klasifikasi industri: **basic WMS** = inventory + location control; **advanced** = analisis kapasitas/labor; **controlled** = tukar data dengan sistem lain. Sebagian besar WMS di luar Asia Timur hari ini level *advanced*. ERP warehouse module cenderung kalah canggih dari WMS khusus. **[V]**
Sumber: https://en.wikipedia.org/wiki/Warehouse_management_system
Sumber: https://en.wikipedia.org/wiki/Inventory_management_software

Artinya: untuk kasus toko 2–5 gudang, target realistis = **basic WMS yang cukup**. Bukan advanced/automated.

### A1. Master data

| Sub-fitur | Status | Bukti |
|---|---|---|
| Produk/SKU | Wajib **[V]** | Semua produk (Odoo, ERPNext) punya item master. https://docs.frappe.io/erpnext/stock |
| Lokasi/gudang | Wajib **[V]** | ERPNext: warehouse bisa bertingkat `Warehouse > Room > Row > Shelf > Bin`. https://docs.frappe.io/erpnext/warehouse |
| Rak/bin sebagai child gudang | Wajib (opsional detail) **[V]** | Kledo: `/finance/warehouses/{id}/racks`, `include_racks` roll-up stok rak ke induk. `kledo-api-reference.md:31884,32631` |
| UoM + konversi satuan | Separuh wajib **[V]** | Odoo punya modul Units of Measure + Packaging (dus). https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html |
| Warehouse type (transit, scrap, dsb) | Wajib kalau ada transfer in-transit **[V]** | ERPNext: warehouse type `Transit`. https://docs.frappe.io/erpnext/stock-entry (bagian *Add to Transit*) |

Catatan penting **A7 (multi-UoM dus→pcs)**: sangat relevan di Indonesia (jual grosir dus, ecer pcs), tapi **jangan bangun engine konversi penuh di v4**. Kledo sendiri sudah punya `/finance/units` dan `product_conversion` **[V]** (`kledo-api-reference.md`, tag "Finance Unit", enum `product_conversion`). Jadi soal konversi sebaiknya **delegasi ke Kledo**, WMS hanya menampilkan. **[I]**

### A2. Penerimaan (receiving/GRN)

- Wajib: Material Receipt (tambah stok ke target warehouse). **[V]** https://docs.frappe.io/erpnext/stock-entry-purpose
- Partial receipt: didukung via mekanisme backorder/sisa dokumen. **[V]** (konsep partial receipt = umum di ERP; Odoo punya multi-package / reception report) https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/reception_report.html
- QC / quality inspection: **opsional** untuk toko retail, wajib hanya kalau ada produk rusak/expired. **[V]** ERPNext punya flag "Inspection Required" pada Stock Entry → Quality Inspection. https://docs.frappe.io/erpnext/stock-entry
- Kledo sendiri: penerimaan masuk lewat purchase delivery / purchase invoice, bukan modul "GRN" terpisah. **[V]** `kledo-api-reference.md` (tag Finance Purchase Delivery)

### A3. Pengeluaran (picking, packing, shipping)

- Wajib: picking list + delivery. **[V]** Odoo: picking methods (batch, cluster, wave) dan removal strategies (FIFO/LIFO/FEFO). https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/shipping_receiving/picking_methods/batch.html
- Untuk toko kecil: cukup **picking list sederhana + konfirmasi** (proyek ini sudah punya). Batch/cluster/wave = YAGNI.
- Kledo: `materialIssues` = pengeluaran material (stok keluar). **[V]** `kledo-api-reference.md:32714+` (Material Issue: "Stok tidak cukup, serial tidak valid" → 400)

### A4. Transfer antar-lokasi

- Wajib. **[V]** ERPNext: Stock Entry purpose "Material Transfer" (source→target). https://docs.frappe.io/erpnext/stock-entry-purpose
- In-transit: **wajib kalau pengiriman antar-gudang tidak instan**. **[V]** ERPNext: "Add to Transit" — buat Transit warehouse, entry #1 source→transit, entry #2 transit→target via "End Transit". https://docs.frappe.io/erpnext/stock-entry
- Kledo: `/finance/warehouses/transfers` dengan alur `approve`/`reject`/`revert`. **[V]** `kledo-api-reference.md:32181,32265,32292`

### A5. Penyesuaian stok (adjustment, opname)

- Wajib. **[V]** ERPNext Stock Reconciliation: set qty aktual vs book, selisih masuk "Difference Account" (default Stock Adjustment). https://docs.frappe.io/erpnext/stock-reconciliation
- Odoo: Inventory Adjustments + Cycle Counts terpisah. https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/cycle_counts.html
- Kledo: `/finance/stockAdjustments` dengan `approve`/`reject`/`revert`/`logs`. **[V]** `kledo-api-reference.md:30574,30828,30912,30939`

### A6. Pelacakan batch/lot/serial/expiry

| Tipe | Wajib untuk toko retail? | Bukti |
|---|---|---|
| Lot/batch | Opsional (wajib utk FMCG/expired) **[V]** | Odoo lot numbers + expiration dates; removal FEFO. https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/lots.html |
| Serial number | Opsional (wajib utk elektronik bergaransi) **[V]** | Odoo serial numbers; Kledo punya tag "Product serial" **[V]** `kledo-api-reference.md` |
| Expiry | Opsional **[V]** | Odoo expiration dates |

Rekomendasi: **jangan bangun** batch/serial sendiri di v4 kalau Kledo sudah punya. Tampilkan saja. **[I]**

### A8. Reorder point / min-max / replenishment

- Wajib minimal: reorder point + laporan replenishment. **[V]** Odoo reordering rules (min/max, lead time, replenishment report). https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html
- Reorder point didefinisikan sebagai level stok yang memicu replenishment. **[V]** https://en.wikipedia.org/wiki/Inventory_management_software (bagian *Reorder point*)
- ERPNext: reorder level/warehouse-wise + lead time. https://docs.frappe.io/erpnext/warehouse
- Proyek ini sudah punya `reorder_point` di skema `stock/{kode}` **[V]** (`docs/dashboard-prd-v3b.md:400,412`).

### A9. Laporan

| Laporan | Status | Bukti |
|---|---|---|
| Kartu stok / stock ledger | Wajib **[V]** | ERPNext Stock Ledger https://docs.frappe.io/erpnext/stock-reconciliation |
| Stok per gudang | Wajib **[V]** | Kledo `/reportings/warehouseStock`; ERPNext Stock Balance |
| Valuasi | Wajib (akuntansi) **[V]** | Odoo inventory valuation (Perpetual/Automatic) https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/inventory_valuation_config.html |
| Aging | Opsional/nice-to-have **[V]** | Odoo Inventory Aging report |
| Transfer & adjustment report | Wajib **[V]** | Kledo `/reportings/inventoryWarehouseTransfer`, `/reportings/inventoryStockAdjustment` |

---

## B. RBAC berlapis khas WMS

### B1. Pemisahan role vs scope

Pola nyata di industri: **role** (fungsi kerja) dan **scope/atribut resource** adalah dua dimensi terpisah.
- RBAC: permission di-assign ke role, user dapat permission lewat role (bukan langsung). **[V]** https://en.wikipedia.org/wiki/Role-based_access_control
- ABAC memperluas RBAC dengan atribut resource (mis. gudang mana) + konteks (waktu, lokasi). **[V]** ibid.
- Kledo mengimplementasi pola persis ini: role global (`/finance/roles`) + **penugasan role per gudang** `/finance/warehouses/{id}/roles` dan `/finance/warehouses/{id}/roles/{role}`. **[V]** `kledo-api-reference.md:32714,32753`

Jadi: `user -> role[]` (level) × `user -> warehouse[]` (scope). Untuk 10 staf, cukup junction table dua kolom. **[I]**

### B2. UI umum

- Pola umum: dropdown/tab "Gudang aktif" di header untuk user multi-gudang; user single-gudang tidak melihat switcher. **[I]** (inferensi pola; tidak ada dokumentasi produk yang menyebut eksplisit "header switcher" — jangan klaim sebagai terverifikasi).
- Admin panel: matriks `user × gudang` dengan checkbox. **[I]**
- Kledo menyediakan manager role per warehouse via endpoint roles di atas, bukan via UI yang terdokumentasi publik. **[V]** `kledo-api-reference.md:32714`

### B3. Bahaya keamanan RBAC multi-lokasi

- Bahaya utama: **filter gudang tidak diterapkan di server**, hanya disembunyikan di UI. User gudang A bisa lihat/edit stok gudang B via API langsung. Ini kelas bug authorization/IDOR. **[I]** — didukung prinsip RBAC bahwa permission harus di-enforce, bukan hanya di-assign. **[V]** https://en.wikipedia.org/wiki/Role-based_access_control
- Separation of duties: NIST/ANSI standard mendefinisikan level **Constrained RBAC** yang menambah separation of duties. **[V]** ibid.
- Praktik aman: scope gudang diambil dari sesi server-side (seperti proyek ini sudah lakukan: `ambilAdmin` ambil role dari Firestore, BUKAN dari body) **[V]** `docs/dashboard-prd-v3b.md:256`. Lanjutkan pola ini untuk tiap query stok: **wajib `where warehouse_id in (user.scope)` di server**, bukan filter di memori/UI.
- Catatan kritis dari audit proyek: filter `status`+`action_type` saat ini dilakukan **di memori** (`docs/dashboard-prd-v3b.md:452`). Untuk data multi-gudang, filter scope harus di query, bukan di memori. **[I]**
- Role explosion = risiko RBAC saat role terlalu banyak. **[V]** https://en.wikipedia.org/wiki/Role-based_access_control

---

## C. Transfer antar-gudang — pola benar

### C1. Kenapa butuh status in-transit

Kalau transfer langsung pindah stok (gudang A -10, gudang B +10 dalam satu operasi), lalu barang nyata hilang/rusak di jalan, atau gudang B belum terima, sistem sudah bilang barang ada di B padahal fisik belum. Itu sumber selisih opname. Solusinya: stok keluar gudang asal masuk ke **virtual location "Transit"** dulu, baru masuk gudang tujuan setelah diterima. **[V]** ERPNext mendokumentasikan tepat pola ini ("Add to Transit" + warehouse type Transit + "End Transit"). https://docs.frappe.io/erpnext/stock-entry

Konsekuensi: stok transit harus **muncul di laporan** (in-transit inventory) supaya tidak "hilang" dari akuntansi. ERPNext melacaknya sebagai warehouse tersendiri. **[V]** ibid.

### C2. Approval berlapis

Pola nyata dari Kledo (produk Indonesia, langsung relevan):
`draft -> submit -> approve/reject -> (revert)`, plus `logs` audit. **[V]**
- `POST /finance/materialRequests/{id}/submit` (draft→submitted)
- `POST .../approve`, `.../reject` (dengan `reason_id`+`other`), `.../revert` (batalkan keputusan approval terakhir), `.../draft` (tarik dari alur ke draft; butuh permission `material_request_approve`)
- `POST /finance/warehouses/transfers/{id}/approve|reject|revert`
`kledo-api-reference.md:16823,16891,16912,16975,17004,17025,32181,32265,32292`

Jadi pemisahan tugas (requester ≠ approver) didukung native Kledo. **[V]**
Catatan RBAC: `materialRequests/{id}/draft` "butuh permission `material_request_approve`" → level permission di atas role. **[V]** `kledo-api-reference.md:16912`

Untuk 10 staf & 2–5 gudang: 3 tahap (peminta → penyetuju admin/owner → penerima di gudang tujuan) sudah cukup; jangan lebih. **[I]**

### C3. Transfer sebagian (kirim 10, terima 8)

Pola industri: dokumen sumber punya qty kirim; dokumen penerimaan punya qty terima; selisih menimbulkan **backorder/discrepancy**. **[V]** Odoo backorder pada receipt/delivery (konsep partial receipt). https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/reception_report.html
Rekomendasi konkret: 2 baris qty (`qty_kirim`, `qty_diterima`) + status `partial`; selisih 2 unit tetap di lokasi transit sampai ada keputusan (lanjut kirim / adjustment / tulis sebagai loss). **[I]** — berbasis fakta in-transit ERPNext. **[V]** https://docs.frappe.io/erpnext/stock-entry

---

## D. Opname / cycle count

### D1. Full opname vs cycle count

- Full physical inventory = hitung semua, operasi berhenti. **Cycle count** = subset kecil, berulang, tanpa hentikan operasi. **[V]** https://en.wikipedia.org/wiki/Cycle_count
- Cycle count biasanya pakai **ABC analysis** (Pareto: nilai/usage tinggi dihitung lebih sering). **[V]** ibid.
- Untuk toko kecil 2–5 gudang: **cycle count berbasis rak/kategori** lebih cocok (tersedia di Kledo sebagai `racks` + di Odoo sebagai Cycle Counts). **[V]** https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/cycle_counts.html
- Method cycle count yang umum: Pareto, hybrid (cost×usage), usage-only, opportunity-based, SPC, geographic. **[V]** https://en.wikipedia.org/wiki/Cycle_count
- Risiko cycle count jelek: item multi-lokasi + lag paperwork → salah adjustment sampai stok di-nol-kan. **[V]** ibid (bagian *Risks*).

### D2. Frozen stock saat opname

- Odoo: saat sesi cycle count aktif, produk/lokasi di-set "frozen" sehingga tidak bisa dipakai transaksi. **[V]** https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/cycle_counts.html
- ERPNext: Stock Reconciliation mengambil qty saat itu dan menimpa; bisa upload CSV + scan barcode. **[V]** https://docs.frappe.io/erpnext/stock-reconciliation
- Praktik sederhana: kunci (freeze) lokasi/rak selama sesi; transaksi ke lokasi terkunci ditolak 409. **[I]** — pola Odoo frozen. **[V]** ibid.

### D3. Selisih & approval

- ERPNext: selisih masuk "Difference Account" (default **Stock Adjustment**), cost center default Main. **[V]** https://docs.frappe.io/erpnext/stock-reconciliation
- Kledo: `stockAdjustments` punya `approve`/`reject`/`revert` + `logs` → adjustment adalah dokumen ber-approval, bukan edit langsung. **[V]** `kledo-api-reference.md:30828,30912,30939`
- Rekomendasi: selisih < threshold (mis. 2% nilai rak) auto-approve; di atas threshold wajib approve owner. Audit trail tidak boleh dihapus. **[I]**

---

## E. Integrasi WMS ↔ akuntansi (Kledo/Accurate)

### E1. Source of truth

Pola industri: **ERP/akuntansi adalah transactional system of record**; modul gudang ERP fokus pada metrik finansial dan "cenderung kurang canggih dari WMS khusus". WMS khusus fokus operasional. **[V]** https://en.wikipedia.org/wiki/Warehouse_management_system (bagian *Comparison with other software packages*)

Untuk proyek ini: Kledo = **source of truth** untuk qty & valuasi (karena punya stock ledger + journal). WMS = lapisan operasional yang **menulis dokumen ke Kledo**, bukan menyimpan ledger stok tandingan. **[I]** — berbasis fakta di atas + stack Kledo yang sudah punya transfers/adjustments. **[V]** `kledo-api-reference.md`

Konsekuensi desain: jangan bikin ledger stok ganda dengan angka independen. Simpan **state dokumen** (draft/pending kirim/dst) di sisi WMS; qty final selalu baca/tulis Kledo. **[I]**

### E2. Risiko sinkronisasi dua arah

- Event-driven architecture: emitor tidak tahu consumer; integrasi lewat event dapat loose coupling tapi **sulit di-test**, rawan *fallacies of distributed computing*, dan rawan **data loss** kalau komponen crash sebelum event diteruskan. Mitigasi: persist in-transit events, dequeue hanya setelah ack ("client acknowledge mode"). **[V]** https://en.wikipedia.org/wiki/Event-driven_architecture
- Event driven punya **integration events** yang lebih kompleks payload-nya untuk konsistensi antar bounded context. **[V]** ibid
- Idempotence: retry aman hanya jika operasi idempoten. HTTP: GET/PUT/DELETE harus idempoten, POST tidak. Untuk event stream: idempoten = hasil sama walau pesan diterima >1 kali. **[V]** https://en.wikipedia.org/wiki/Idempotence
- Dua-duanya punya trade-off: payload penuh (cepat, tapi risiko multi systems-of-record / stamp coupling) vs payload ID saja (hemat bandwidth, lebih lambat, coupling lebih rendah). **[V]** https://en.wikipedia.org/wiki/Event-driven_architecture
- Catatan proyek ini: `konfirmasiOpname`/`konfirmasiSyncStok` **tidak punya guard idempotensi eksplisit**; bisa apply ulang kalau `pending*` sudah dibersihkan (`docs/dashboard-prd-v3b.md:192-199`). Ini persis risiko yang diperingatkan teori idempotence. **[V]** https://en.wikipedia.org/wiki/Idempotence

### E3. Event-driven vs polling

- EDA: producer tidak tahu consumer, komunikasi lewat channel, cocok untuk loose coupling + skalabilitas horizontal. Tapi kompleks & susah di-test. **[V]** https://en.wikipedia.org/wiki/Event-driven_architecture
- Kledo menyediakan **Webhook** endpoint (tag "Webhook") → memungkinkan event-driven push dari Kledo. **[V]** `kledo-api-reference.md` (tags, "Webhook")
- Webhook Kledo bersifat **idempoten-friendly**: "jika sudah pernah diproses... tetap mengembalikan 200" → penerima wajib dedup by event id. **[V]** `kledo-api-reference.md:30393`
- Untuk skala 10 staf: **webhook + polling rekonsiliasi harian** sudah cukup; jangan bikin message broker. **[I]**

### E4. Konflik (stok beda antar sistem)

- Prinsip: satu sistem jadi authoritative; sistem lain tidak menimpa nilai authoritative, hanya mengusulkan dokumen. **[I]**
- Teori distributed transaction: 2PC menyelesaikan atomic commit lintas sistem, tapi **blocking** dan butuh manual intervention pada kegagalan tertentu. Untuk dua SaaS via HTTP, 2PC tidak praktis → pakai **saga/idempotent retry + reconciliation**. **[V]** https://en.wikipedia.org/wiki/Two-phase_commit_protocol (bagian *Disadvantages*)
- Praktik: jalankan job rekonsiliasi yang membandingkan qty WMS↔Kledo; kalau beda, tampilkan sebagai **discrepancy**, jangan auto-timpa. Keputusan manusia/owner. **[I]**
- Kompleksitas: finding right balance jumlah event sulit; event terlalu banyak membanjiri sistem, terlalu sedikit bikin proses berlebih; error handling butuh error-handler terpisah. **[V]** https://en.wikipedia.org/wiki/Event-driven_architecture

---

## F. Fitur yang sering diabaikan di WMS buatan sendiri (jebakan)

| # | Jebakan | Bukti/status |
|---|---|---|
| F1 | **Stok negatif** dibiarkan lolos. Kledo menolak: "Stok tidak cukup... 400" pada Material Issue. **[V]** `kledo-api-reference.md:32714+` | Enforcement harus di server. **[V]** |
| F2 | **Pembulatan satuan** dus→pcs: 1 dus ≠ integer pcs kalau ada pecahan. Odoo pisahkan UoM vs Packaging. **[V]** https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html | Simpan qty dalam satuan dasar (integer). **[I]** |
| F3 | **Timezone**: dokumen ber-timestamp; Kledo punya `property_timezone` & time format. **[V]** `kledo-api-reference.md` (Option schema). Simpan UTC, render WIB. **[I]** |
| F4 | **Audit trail tidak bisa dihapus**: Kledo sediakan `.../logs` untuk materialRequests, stockAdjustments, transfers, warehouses. **[V]** `kledo-api-reference.md:16933,30886,32239,32476`. Transaksi submitted hanya bisa cancel+amend (ERPNext). **[V]** https://docs.frappe.io/erpnext/stock-entry | Jangan expose delete; pakai revert/cancel + log. |
| F5 | **Idempotensi konfirmasi ganda**: tanpa guard, klik/retry dobel menggandakan movement. **[V]** teori: https://en.wikipedia.org/wiki/Idempotence; temuan proyek: `docs/dashboard-prd-v3b.md:192-199` | Wajib idempotency key per dokumen. **[I]** |
| F6 | **Filter scope gudang di memori/UI**, bukan server. Lihat B3. **[I]** | Wajib `where warehouse_id in scope` di server. |
| F7 | **Transfer tanpa in-transit** → selisih opname. **[V]** https://docs.frappe.io/erpnext/stock-entry | Lihat C1. |
| F8 | **Stok transit tidak masuk laporan** → dianggap hilang. **[I]** | Transit = location riil yang dilaporkan. **[V]** ibid |
| F9 | **Partial receive tidak dilacak** → qty kirim dianggap qty terima. **[V]** konsep backorder partial receipt. https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/reception_report.html | Simpan qty_kirim vs qty_terima. |
| F10 | **Reconciliation tidak ada** → drift diam-diam antara WMS & Kledo. **[I]** | Job harian + laporan discrepancy. |
| F11 | **Error handling event hilang** → data loss saat crash. **[V]** https://en.wikipedia.org/wiki/Event-driven_architecture | Persist in-transit, dequeue setelah ack. |
| F12 | **Role explosion**: bikin role per gudang, bukan scope. **[V]** https://en.wikipedia.org/wiki/Role-based_access_control | Role tetap sedikit, scope terpisah. |
| F13 | **Cycle count tanpa freeze** → adjustment salah lalu stok di-nol-kan. **[V]** https://en.wikipedia.org/wiki/Cycle_count (Risks) | Freeze lokasi selama sesi. **[V]** Odoo frozen: https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/cycle_counts.html |
| F14 | **Barcode**: entry manual rawan salah. ERPNext dukung scan mode + barcode scanner untuk opname. **[V]** https://docs.frappe.io/erpnext/stock-reconciliation | Nice-to-have, bukan v4 blocker. |

---

## G. Rekomendasi prioritas v4 / v5 / jangan pernah (YAGNI)

Asumsi: 2–5 gudang, ~10 staf, backend jembatan Kledo.

### HARUS ada di v4

| Fitur | Alasan | Rujukan |
|---|---|---|
| Master gudang + rak (baca dari Kledo) | Fondasi lokasi | Kledo `/finance/warehouses`, `/{id}/racks` **[V]** `kledo-api-reference.md:31880,32631` |
| Stok per gudang di setiap query (bukan `stok_gudang_online` tunggal) | Multi-lokasi inti | Skema saat ini single-lokasi `docs/dashboard-prd-v3b.md:400` **[V]** |
| RBAC: role + scope gudang, enforced **di server** | Keamanan. Kledo pola role-per-warehouse **[V]** `kledo-api-reference.md:32714` | RBAC **[V]** https://en.wikipedia.org/wiki/Role-based_access_control |
| Transfer antar-gudang **dengan in-transit** | Hindari selisih | ERPNext Add to Transit **[V]** https://docs.frappe.io/erpnext/stock-entry |
| Transfer approval berlapis (peminta→penyetuju→penerima) | Pemisahan tugas. Kledo native **[V]** `kledo-api-reference.md:32181,32265,32292` | SoD NIST **[V]** https://en.wikipedia.org/wiki/Role-based_access_control |
| Partial receive (qty_kirim vs qty_diterima) | Kenyataan lapangan | Backorder partial **[V]** Odoo |
| Adjustment/opname jadi dokumen ber-approval (bukan edit langsung) | Audit. Kledo **[V]** `kledo-api-reference.md:30828,30912` | ERPNext Difference Account **[V]** |
| Idempotency key pada semua konfirmasi draft | Cegah double-apply | Temuan proyek [`dashboard-prd-v3b.md:192`] + teori **[V]** https://en.wikipedia.org/wiki/Idempotence |
| Audit trail append-only + `logs` | Kepatuhan | Kledo `.../logs` **[V]** |
| Kartu stok / stock ledger view | Laporan dasar | ERPNext Stock Ledger **[V]** |
| Reorder point per gudang | Isi ulang otomatis | Odoo reordering rules **[V]** |
| Webhook Kledo + dedup event id | Sinkron real-time tanpa broker | Kledo Webhook idempoten **[V]** `kledo-api-reference.md:30393` |
| Job rekonsiliasi qty WMS↔Kledo harian | Cegah drift | Konsistensi antar sistem **[V]** EDA/2PC |

### v5 (setelah v4 stabil)

- Full vs cycle count scheduling ABC (Pareto) **[V]** https://en.wikipedia.org/wiki/Cycle_count
- Frozen stock kompleks per-lokasi (v4 cukup kunci manual)
- Laporan aging & inventory turnover (Kledo sudah punya `/reportings/inventoryTurnover/{warehouseId}` **[V]** → v5 cukup pakai Kledo)
- Barcode scan mode opname **[V]** ERPNext
- Removal strategy FEFO/FIFO untuk batch/expiry **[V]** Odoo
- Approval berjenjang >3 level
- QC/quality inspection **[V]** ERPNext

### JANGAN PERNAH (YAGNI untuk 2–5 gudang / 10 staf)

| Fitur | Alasan |
|---|---|
| Message broker / event bus sendiri | 10 staf cukup webhook+polling. EDA kompleks & susah di-test **[V]** https://en.wikipedia.org/wiki/Event-driven_architecture |
| 2PC lintas WMS↔Kledo | Blocking, butuh intervensi manual **[V]** https://en.wikipedia.org/wiki/Two-phase_commit_protocol |
| Ledger stok ganda (dua source of truth) | Sumber drift; Kledo ERP = system of record **[V]** https://en.wikipedia.org/wiki/Warehouse_management_system |
| WMS/robotics/automation (WCS/WES) | Di luar level "basic WMS" **[V]** ibid |
| Slotting/putaway optimization, wave/cluster picking | Hanya relevan fasilitas besar **[V]** Odoo (fitur ada, tapi overkill) |
| YMS, dock scheduling | Fasilitas besar **[V]** ibid |
| Engine konversi UoM sendiri | Kledo sudah punya `/finance/units` + `product_conversion` **[V]** `kledo-api-reference.md` |
| Batch/serial tracking engine sendiri | Kledo punya "Product serial" **[V]** |
| Role per gudang (role explosion) | Pakai role + scope **[V]** https://en.wikipedia.org/wiki/Role-based_access_control |
| Prediksi/ML, autonomous WMS | Level autonomous, tidak relevan **[V]** https://en.wikipedia.org/wiki/Warehouse_management_system |

---

## Ringkasan 5 keputusan paling penting

1. **Kledo = source of truth stok & valuasi**; WMS simpan state dokumen operasional saja. **[V]** https://en.wikipedia.org/wiki/Warehouse_management_system + `kledo-api-reference.md`
2. **Transfer wajib lewat lokasi Transit** (Add to Transit pattern). **[V]** https://docs.frappe.io/erpnext/stock-entry
3. **RBAC = role × scope gudang, di-enforce di server**. **[V]** https://en.wikipedia.org/wiki/Role-based_access_control + Kledo roles-per-warehouse.
4. **Semua konfirmasi harus idempoten** (temuan gap saat ini). **[V]** https://en.wikipedia.org/wiki/Idempotence
5. **Jangan bangun ulang yang sudah ada di Kledo** (UoM, serial, reports, approval). **[V]** `kledo-api-reference.md`
