# Pemetaan Endpoint Kledo API untuk WMS Jembatan

Sumber: `kledo-api-reference.md` (54.052 baris). Nomor baris merujuk file itu.
Base URL: `https://{subdomain}.api.kledo.com/api/v1/` (baris 3). Auth: Bearer token (baris 5).
Total path 2004, operasi 2487 (baris 7-9).

> Batasan dokumen: file ini adalah daftar operasi (path + parameter). Skema request/response
> yang direferensikan dengan backtick, mis. `` `FinanceWarehouse` ``, **tidak didefinisikan** di file.
> Dari 924 blok JSON, semuanya adalah contoh inline untuk body (multipart/form-data, form-urlencoded,
> atau ref schema). **Tidak ada satu pun contoh response JSON aktual.** Semua response dinyatakan
> hanya sebagai "`200`: successful operation". Bagian response di bawah ditandai sesuai fakta ini.

---

## A. Warehouses

### A.1 CRUD `/finance/warehouses` (baris 31880)

- `GET` — parameter query: `include_deletable` (default 0), `exclude_qty`, `include_archive` (0/1/2; 2 = archived only), `is_canvas_warehouse` (0/1), `include_racks` (0/1). Catatan penting baris 31896: default hanya gudang induk; qty induk sudah roll-up stok rak.
- `POST` — body ref `` `FinanceWarehouse` `` (baris 31907). **Skema tidak didefinisikan di file** → field body POST TIDAK ADA DI DOKUMENTASI.
- `/finance/warehouses/{id}` (baris 32311): `GET` (param `product`, `cat_ids`, `per_page`, `sort_by`, `order_by`, `show_columns`, `export`, `export_type`), `PUT` body ref `` `FinanceWarehouse` ``, `DELETE`.
- `show_columns` valid contoh (baris 32329): `id,name,code,photo,unit_id,category_name`.

**Kesimpulan field warehouse:** field body/response lengkap TIDAK ADA DI DOKUMENTASI. Tidak ada bukti field `coordinate` di objek warehouse — koordinat pakai endpoint terpisah (lihat A.4). `pinnedProducts` dan `racks` adalah sub-resource terpisah (A.3, A.4). Field `is_active` pada warehouse TIDAK ADA DI DOKUMENTASI.

### A.2 Archive / unarchive (ada, bukan `is_active`)

- `PATCH /finance/warehouses/{id}/archive` (baris 32367)
- `PATCH /finance/warehouses/{id}/unarchive` (baris 32829)
- Filter arsip: `include_archive` di GET list (baris 31894).

### A.3 `coordinate`, `racks`, `pinnedProducts`

- `PUT /finance/warehouses/{id}/coordinate` (baris 32424). Body persis:
```json
{
    "latitude": string
    "longitude": string
}
```
- `GET/POST /finance/warehouses/{id}/racks` (baris 32631). Racks = **child warehouse**. POST buat rak baru, maksimal 50 rak aktif per gudang (baris 32650). Body persis:
```json
{
    "name": string
    "code": string
    "desc": string
}
```
- `PATCH/DELETE /finance/warehouses/{id}/racks/{rackId}` (baris 32671). PATCH body:
```json
{
    "name": string
    "code": string
    "desc": string
    "is_active": boolean
}
```
Delete hanya bila rak tidak punya pergerakan stok (baris 32701). Di sini `is_active` ada — untuk **rak**, bukan gudang.
- `GET/POST /finance/warehouses/{id}/pinnedProducts` (baris 32573). POST body: `{ "product_ids": array of integer }`.
- `DELETE /finance/warehouses/{id}/pinnedProducts/{product}` (baris 32611) — unpin.
- `GET/POST /finance/warehouses/{id}/contactGroups` (baris 32386). POST body: `{ "ids": array of integer }` — menempelkan contact group ke gudang.

### A.4 RBAC per gudang: `/finance/warehouses/{id}/roles`

- `GET /finance/warehouses/{id}/roles` (baris 32714). Parameter `role_id` ditandai **In: path** (meski path tidak memuatnya — kemungkinan bug dokumentasi; diperlakukan sebagai filter).
- `POST /finance/warehouses/{id}/roles` (baris 32732) — "Menambahkan semua role ke warehouse". Body persis:
```json
{
    "roles": array of integer
}
```
- `POST /finance/warehouses/{id}/roles/{role}` (baris 32753) — add/update satu role. **Tidak ada body didokumentasikan.**
- `DELETE /finance/warehouses/{id}/roles/{role}` — hapus role dari gudang.

Field RBAC = daftar **role id** (`roles: integer[]`). Detail permission per role ada di endpoint `/roles` (baris 52390) — TIDAK ADA DI DOKUMENTASI isi field-nya.

### A.5 `summary` dan `transactions`

- `GET /finance/warehouses/summary` (baris 31936) — "Get stats summary for warehouse". Body/response TIDAK ADA DI DOKUMENTASI.
- `GET /finance/warehouses/{id}/summary` (baris 32786) — dijelaskan: popover ringkasan berisi **foto, nama, kode, total qty** (qty selaras daftar gudang). 200 + 404. Bentuk JSON TIDAK ADA DI DOKUMENTASI.
- `GET /finance/warehouses/{id}/transactions` (baris 32806) — param `per_page`, `sort_by`, `order_by`, `search`. Isi response TIDAK ADA DI DOKUMENTASI.

**Implikasi WMS:** cache nama/kode/qty gudang dari `/finance/warehouses` + `include_racks=1`. Endpoint `{id}/summary` cukup untuk kartu popover. RBAC gudang memetakan role Kledo ke warehouse — tapi karena admin gudang tidak punya akun Kledo, RBAC Kledo TIDAK bisa dipakai langsung; otorisasi harus di Firestore.

---

## B. Warehouse Transfers (INTI permintaan antar gudang)

### B.1 List + create `/finance/warehouses/transfers` (baris 31972)

`GET` param: `warehouse_id`, `product_id` (contoh `1,2,3`), `status_id`, `date_from`, `date_to`, `per_page`, `sort_by`, `order_by`, `search`, `export` (xls/csv).

`POST` — body ref `` `CreateFinanceWarehouseTransferAPIRequest` `` (baris 32004). **Skema tidak ada di file → body request persis TIDAK ADA DI DOKUMENTASI.** Field wajib, format item (product_id/qty/warehouse asal-tujuan) TIDAK ADA DI DOKUMENTASI. JANGAN asumsi menyamai material request/issue.

### B.2 Detail / update / delete

- `GET /finance/warehouses/transfers/{id}` (baris 32131). Param `include_stock_before`, `include_product_detail` (0/1).
- `PUT /finance/warehouses/transfers/{id}` — body ref `` `UpdateFinanceWarehouseTransferAPIRequest` `` (baris 32161). Skema TIDAK ADA.
- `DELETE /finance/warehouses/transfers/{id}`.

### B.3 Alur approval

- `GET /finance/warehouses/transfers/{id}/approve` (baris 32181) — **perhatikan: GET, bukan POST.** Hanya param `id`.
- `POST /finance/warehouses/transfers/{id}/reject` (baris 32265). Body (`multipart/form-data`) persis:
```json
{
    "reason_id": integer
    "other": string
}
```
- `POST /finance/warehouses/transfers/{id}/revert` (baris 32292) — membatalkan approval/penolakan terakhir.

**Status apa saja:** TIDAK ADA DI DOKUMENTASI. Tidak ada enumerasi status (draft/pending/approved/rejected) untuk transfer di file. Filter tersedia hanya `status_id` (integer) tanpa daftar nilai.

### B.4 Efek stok: langsung atau setelah approve?

TIDAK ADA DI DOKUMENTASI untuk warehouse transfer. Bukti tidak langsung:
- Ada `GET .../approve` → workflow draft→approved (baris 32181).
- Ada `include_stock_before` di GET detail (baris 32144) → dokumen berpengaruh ke stok.
- **Tidak ada penjelasan apakah stok berubah saat create atau saat approve.** JANGAN asumsi.

Bandingkan dengan Material Issue (bagian E) yang **eksplisit** menyatakan stok keluar pada approval level terakhir — untuk transfer tidak ada pernyataan setara.

### B.5 Endpoint pendukung

- `POST/DELETE /finance/warehouses/transfers/attachments` (baris 32012).
- Import: `uploadImport` (multipart `file`), `executeImport` (`{"url": string}`) — baris 32047/32110.
- Mass delete: `inputMassDelete` (POST) + `executeMassDelete` (DELETE), body `{"id": array of integer}` — baris 32068/32089.
- `GET /finance/warehouses/transfers/{id}/logs` (baris 32239) — audit trail, param tanggal/user/per_page.
- Download PDF: `GET /finance/warehouses/transfer/{id}/download/{key}/{name}` (baris 31950) — perhatikan **tunggal** `transfer`, bukan `transfers`.

**Implikasi WMS:** transfer adalah kandidat tepat untuk "permintaan antar gudang" karena ada asal-tujuan gudang di level dokumen. **Blocker:** body POST tidak terdokumentasi. Harus tangkap payload dari UI Kledo (network capture) atau uji langsung, sebelum bangun jembatan.

---

## C. Stock per gudang (KRITIS)

### C.1 BATCH — `/finance/products/stocks` (baris 20506) ⭐ PALING PENTING

> "Display stock of multiple products in many warehouses"
> Param: `product_ids` (**required**, string, contoh `1,2,3`), `warehouse_ids` (opsional, contoh `1,2,3`, default semua), `trans_date` (opsional, stok per tanggal).

Ini endpoint batch: satu request untuk banyak produk × banyak gudang. **Inilah yang menggantikan N request per produk.** Bentuk response TIDAK ADA DI DOKUMENTASI.

### C.2 `/finance/products/{id}/stocks` (baris 21166)

Stok satu produk di banyak gudang. Param `warehouse_ids`, `trans_date`. Response TIDAK ADA DI DOKUMENTASI.

### C.3 `/finance/products/{id}/warehouseQtyStats` (baris 21328)

"Get sale and purchase product stats" / "warehouse qty Stats". Hanya param `id`. Response TIDAK ADA DI DOKUMENTASI — meski deskripsi singkat menyebut 200 "Warehouse Qty Stats".

### C.4 `/finance/products/stockMovementStats` (baris 20443)

Statistik pergerakan stok **lintas produk**. Param: `search`, `cat_ids`, `movement_stock_daterange` (enum daily/monthly/yearly), `custom_daterange`, `date_from`, `date_to`. Response TIDAK ADA DI DOKUMENTASI.

### C.5 `/finance/products/{id}/stockMovements` (baris 21137)

Riwayat pergerakan **satu produk**. Param: `tag_ids`, `trans_type_ids`, `date_from`, `date_to`, `per_page`, `sort_by`, `order_by`, `page`, `export`. **Ada pagination** (`per_page` + `page`).
`show_columns` valid (baris 21159): `trans_date,trans_type,desc,reference,price,avg_price,qty_movement,qty`.
Field response lain TIDAK ADA DI DOKUMENTASI, tapi kolom `show_columns` memberi tahu field yang ada.

### C.6 `/finance/products/{id}/stockMovementStats` (baris 21114)

Statistik pergerakan satu produk. Param `daterange`, `custom_daterange`, `date_from`, `date_to`.

### C.7 Laporan stok per gudang (alternatif batch besar)

- `GET /reportings/warehouseStock` (baris 52256) — **required `date`**, filter `cat_ids`, `hide_zero_qty`, `warehouse_ids` (contoh `1,2,3`), `per_page`, `page`, `export`, `include_archive` (0/1/2). Cocok untuk tarik seluruh stok per gudang sekali jalan.
- `GET /reportings/warehouseStock/massExport` (baris 52316) — Excel multi-sheet per gudang induk. Param `per_page` "Jumlah produk per sheet (default 100). Kirim besar untuk seluruh data." (baris 52335). **Pagination default 100.**
- `GET /reportings/inventorySummary` (baris 47503) — ringkasan stok, required `date`, ada `hide_zero_qty`.
- `GET /reportings/inventoryStockMovement` (baris 47312) & `/inventoryStockMovementDetail` (baris 47399) — pergerakan stok lintas produk + filter `warehouse_id`.
- `GET /reportings/inventoryWarehouseTransfer` (baris 47721) & `/detail` (baris 47748) — laporan transfer. Param `warehouse_id` bisa multi koma.

**Implikasi WMS:** untuk "lihat stok per gudang", pakai `/finance/products/stocks` (batch by product_ids+warehouse_ids) untuk lookup terjadwal, atau `/reportings/warehouseStock` (semua produk, per tanggal) untuk sinkronisasi penuh ke Firestore cache. Hindari pola 1 request/produk.

---

## D. Stock Adjustments (untuk opname)

### D.1 `/finance/stockAdjustments` (baris 30574)

`GET` param: `warehouse_id`, `date_from`, `date_to`, `per_page`, `sort_by`, `order_by`, `tags`, `search`.

`POST` body persis (baris 30602):
```json
{
    "trans_date": string (date)
    "warehouse_id": integer
    "account_id": integer
    "type_id": integer
    "ref_number": string
    "memo": string
    "pic_user_id": integer
    "counted_by_user_id": integer
    "attachment": array of string
    "items": array of {
      "product_id": integer
      "actual_qty": integer
      "diff_qty": integer
      "price": number
      "serial_numbers": array of {
        "product_serial_number_id": integer
        "code": integer
        "qty": integer
      }
    }
    "tags": array of integer
}
```

**Stok absolut vs delta:** item memuat **`actual_qty`** DAN **`diff_qty`** bersamaan. Kehadiran `actual_qty` (qty fisik hasil hitung) + `diff_qty` (selisih) mengindikasikan opname absolut: kirim qty fisik, sistem/klien menghitung selisih. **Tapi mana yang wajib dan bagaimana relasi keduanya TIDAK DIJELASKAN DI DOKUMENTASI** → verifikasi runtime.

`generateImport` (baris 30711) param `type_id` (1/2), `account_id`, `warehouse_id`, `trans_date`, `include_all_tracked`.

### D.2 Alur approve (POST) — beda dari transfer

- `POST /finance/stockAdjustments/{id}/approve` (baris 30828).
- `POST /finance/stockAdjustments/{id}/reject` (baris 30912). Body (`multipart/form-data`):
```json
{
    "reason_id": integer
    "other": string
}
```
- `POST /finance/stockAdjustments/{id}/revert` (baris 30939).

Status enum TIDAK ADA DI DOKUMENTASI.

### D.3 vs `/finance/healthCheck/stockMovementModifier` (baris 11782)

- Deskripsi: "Modifikasi stock movement qty dan Clear log dispatch healthcheck" — **endpoint healthcheck/internal**, satu `movement_id` + `qty`:
```json
{
    "movement_id": number
    "qty": number
}
```
Ini mengubah baris stock movement langsung (bukan dokumen penyesuaian resmi, tanpa approval, tanpa jurnal/ref). **Bukan alat opname.** Stock Adjustment = dokumen resmi + approval + nomor + tags. stockMovementModifier = patch data mentah (kemungkinan besar khusus maintenance Kledo, bukan untuk integrasi).

---

## E. Material Requests & Material Issues

Keduanya **modul Material** (bisa mati per perusahaan: response `404` = "Modul Material tidak aktif di perusahaan ini").

### E.1 `/finance/materialRequests` (baris 16589) — PERMINTAAN

`POST` body persis (baris 16623):
```json
{
    "trans_date": string (date)
    "warehouse_id": integer
    "location": string
    "contact_id": integer
    "memo": string
    "attachment": array of string
    "items": array of {
      "product_id": integer
      "qty": number (float)
      "unit_id": integer
      "unit_conv": number (float)
      "tag_ids": array of integer
      "tag_id": integer
      "desc": string
    }
}
```
- Hanya punya **satu** `warehouse_id` (gudang permintaan), tanpa gudang tujuan. Ada `location` (teks), `contact_id`.
- `GET` list param `issuable` (baris 16613): bila 1, hanya permintaan yang masih bisa dikeluarkan (status issuable 3,4,5 DAN masih ada sisa qty). **Ini satu-satunya enumerasi status yang muncul: 3, 4, 5 = issuable.**
- Status lain (materialIssues, baris 15900): `1 = posted, 2 = void, 111 = menunggu persetujuan, 112 = ditolak approver`.

Alur approval material request:
- `POST .../{id}/submit` (baris 17025) — draft → submitted.
- `POST .../{id}/approve` (baris 16823).
- `POST .../{id}/reject` (baris 16975) — body `{"reason_id": integer, "other": string}` (application/json).
- `POST .../{id}/revert` (baris 17004) — batalkan keputusan approval terakhir.
- `POST .../{id}/cancel` (baris 16891).
- `POST .../{id}/draft` (baris 16912) — tarik keluar dari alur approval jadi draf (beda dari revert yang hanya mundur satu langkah). Dokumen yang sudah pegang persetujuan butuh permission `material_request_approve`.

### E.2 `/finance/materialIssues` (baris 15885) — PENGELUARAN

`POST` body persis (baris 15920):
```json
{
    "trans_date": string (date)
    "warehouse_id": integer
    "account_id": integer
    "contact_id": integer
    "memo": string
    "attachment": array of string
    "items": array of {
      "material_request_item_id": integer
      "product_id": integer
      "qty": number (float)
      "unit_id": integer
      "unit_conv": number (float)
      "tag_ids": array of integer
      "tag_id": integer
      "desc": string
      "serials": array of {
        "product_serial_number_id": integer
        "qty": number (float)
      }
    }
}
```
Item mengikat ke **`material_request_item_id`** → material issue adalah realisasi pengeluaran dari material request. Response `400`: "Stok tidak cukup, serial tidak valid, atau baris Material Request tidak issuable".

**Efek stok eksplisit** (baris 16142): "Pada persetujuan level **TERAKHIR** stok ikut dikeluarkan dan jurnalnya terbentuk; sebelum itu dokumen tetap menunggu level berikutnya." Reject: stok tidak tersentuh (baris 16252). Revert hanya untuk dokumen yang belum posted; dokumen posted harus `void` (baris 16281).

Alur: `approve` (16135), `reject` (16245), `revert` (16274), `void` (16295).
`GET` param `status_id` (baris 15900): 1 posted, 2 void, 111 menunggu persetujuan, 112 ditolak approver.

### E.3 Mana yang cocok untuk "permintaan barang dari gudang sebelah"?

- **Warehouse Transfer** (bagian B): model asal→tujuan antar gudang yang benar, tapi body POST tidak terdokumentasi.
- **Material Request + Material Issue** (E.1+E.2): **terdokumentasi penuh** (body, alur, efek stok). Modelnya permintaan (request) → pengeluaran (issue) dengan pengikatan item, tapi **tidak ada pasangan gudang tujuan di dalam satu dokumen** — hanya `warehouse_id` sumber/permintaan. Transfer antar gudang tidak direpresentasikan sebagai dua gudang dalam satu dokumen.

**Kesimpulan:** kalau butuh lintas gudang eksplisit → transfer (setelah body ditemukan). Kalau butuh alur approval dokumen + realisasi pengeluaran yang terdokumentasi → material request/issue, dengan gudang tujuan dipetakan di Firestore (approval WMS) lalu dieksekusi sebagai transfer atau issue di Kledo. **TIDAK ADA DI DOKUMENTASI** bahwa material request mendukung gudang tujuan.

---

## F. Products & Contacts

### F.1 List produk `/finance/products` (baris 19492)

Filter utama: `search`, `search_column`, `code`, `cat_ids`, `include_warehouse_qty` (0/1), `include_archive` (0/1/2), `is_sell`, `is_purchase`, `is_track`, `include_stats`, `include_total`, `product_type_id` (0 reguler/1 paket/2 manufaktur), `variant_type_ids`, `stock_status`, `per_page`, `sort_by`, `order_by`, `show_columns`, `is_have_attachment`, `sn_type`, `manage_expiry`, `has_modifier`, `warehouse_id`.
`show_columns` valid (baris 19523): `id,name,photo,code,description,category,base_price,price,qty,hpp,is_track,unit_id`.
**Ada pagination** (`per_page` + `page`). **Max per page: TIDAK ADA DI DOKUMENTASI untuk products** (tidak ada embel-embel "max"). Bukti lain: beberapa endpoint lain menyebut "max 100" (baris 7410, 33612, 43762) dan export default 1000. **Untuk `/finance/products`, batas TIDAK dinyatakan.**

Endpoint pembantu: `/finance/products/summary` (20620), `/finance/products/suggestionPerPage` (20576), `/finance/products/export` (20079), `/finance/products/overview` (20324).

### F.2 `/finance/contacts` (baris 6869)

Filter: `search` (nama/email/company/address/phone), `name`, `type_id` (dari `init.finance.contact_type`), `group_id`, `include_deletable`, `include_archive` (0/1/2), `include_stats`, `per_page`, `sort_by`, `order_by`, `page`, `show_columns`, `is_have_attachment`, `province_id`, `city_id`.
`show_columns` valid (baris 6893): `photo,name,type,company,address,email,phone,payable,receivable,group,shipping_address,village,district,ref_number,finance_term_id,description,geo_tagged`.
Body POST ref `` `FinanceContact` `` — skema TIDAK ADA DI DOKUMENTASI. Ada `shippingAddress` (7681) dan `billingAddress` (7344) sebagai sub-resource.

### F.3 `/finance/contactGroups` (baris 6643) — model "gudang"?

- `GET` param `search`, `limit` (default 100).
- `POST` body ref `` `FinanceContactGroup` `` — skema TIDAK ADA DI DOKUMENTASI.
- `contactGroups/{id}/activate` (6767) / `deactivate` (6786), `{id}/roles` (6831).
- **Relasi gudang: `/finance/warehouses/{id}/contactGroups`** (baris 32386) — memetakan group kontak ke gudang. GET ambil, POST `{"ids": [...]}` tambah.

**Kesimpulan:** contactGroups adalah grup kontak (customer/supplier), BUKAN gudang. Bisa dipakai sebagai tag wilayah/sales, bukan model gudang. Model "gudang" yang benar adalah entity warehouse. JANGAN pakai contactGroup sebagai gudang.

---

## G. Auth & Rate limit

### G.1 Personal Access Token

- `POST /personal-access-tokens` (baris 40328) — "Generate a new short personal access token". Body persis:
```json
{
    "name": string
    "expires_in_days": integer
}
```
Response 201; 422 validation; 401 unauthorized. **Nilai token hanya muncul sekali saat create (implikasi umum PAT) — pernyataan eksplisit TIDAK ADA DI DOKUMENTASI.**
- `GET /personal-access-tokens` (40302) — list + filter `name`, `created_at_from/to`, `expires_at_from/to`, `last_used_at_from/to`, `per_page`, `page`.
- `DELETE /personal-access-tokens/{identifier}` (40370) — revoke by ID numerik atau short token string.
- `GET /personal-access-tokens/{tokenId}` (40391) — detail.
- `GET /personal-access-tokens/stats` (40355).
- `DELETE /personal-access-tokens` (40345) — revoke semua.

Jalur paralel lama: `/authentication/user/apikeys` (baris 908) GET/POST (`name` query), DELETE `/{id}`.

### G.2 Rate limit

**TIDAK ADA DI DOKUMENTASI.** Pencarian untuk `rate limit`, `429`, `throttle`, `X-RateLimit` di seluruh file tidak menghasilkan apa pun. Asumsikan tidak ada jaminan; tangani 429 secara defensif walau tak disebut.

### G.3 Bootstrap: `/inits`, `/options`, `/setup`

- `GET /inits` (baris 35018) — data awal sebelum halaman load (username, country, channel type, dll). Param `v`, header `x-module`, `device_id`.
- `GET /inits/finance` (baris 35040) — config finance. Kemungkinan sumber `contact_type` (dipakai `type_id` di contacts, baris 6883).
- `GET /inits/public` (baris 35054) — tanpa login.
- `GET /options` (baris 39937) + `PUT /options` (ref `` `Option` ``), `GET /options/{name}` (40280), `GET /options/lock_date` (40042), `/options/notifications` (40084), `/options/lock_date` berguna untuk tahu tanggal buku terkunci (penting: stock adjustment & issue tolak "tanggal terkunci").
- `/setup/clear` (baris 52535) — TIDAK ADA DI DOKUMENTASI detail; terlihat destruktif, jangan dipakai.

**Implikasi WMS:** API key = Personal Access Token (buat sekali via endpoint POST PAT atau dari UI Kledo). Simpan di secret manager. Bootstrap config finance via `/inits/finance`; cek `lock_date` sebelum kirim adjustment/issue.

---

## H. Webhook

### H.1 Endpoint Kledo yang tersedia (`## webhook`, baris 53725)

Hanya 5 endpoint, semuanya manajemen:

- `POST /webhook/regenerateSecret` (53728) — "Regenerate signing secret". → **ada mekanisme signing secret.**
- `GET/PUT /webhook/settings` (53742) — PUT body `{"name": string, "value": string}`.
- `POST /webhook/setup` (53771) — body `{"url": string}` → "Setup webhook verification url".
- `POST /webhook/test` (53792) — body `{"name": string}`.
- `POST /webhook/verify` (53813) — jalankan verifikasi URL yang sudah di-setup.

### H.2 Topik webhook

**TIDAK ADA DI DOKUMENTASI.** Tidak ada daftar topik. Tidak ada bukti topik untuk stock/warehouse/transfer. Pencarian `webhook` hanya menemukan endpoint manajemen di atas + webhook **Shopify** (baris 30334-30506), yang jelas berbeda (X-Shopify-Topic, HMAC Shopify — bukan webhook Kledo).

### H.3 Format payload & signature

**TIDAK ADA DI DOKUMENTASI.** `regenerateSecret` menyiratkan signature ada, tapi nama header, algoritma (HMAC-SHA256 vs lain), dan format payload TIDAK dinyatakan. Endpoint `/webhook/test` body `{"name": string}` menyiratkan event/topik diidentifikasi `name`, tapi nilainya tidak ada.

### H.4 URL publik HTTPS

`/webhook/setup` menerima `url` + ada `/webhook/verify` (verifikasi URL). Konteks "Setup webhook verification url" mengindikasikan URL harus dapat diverifikasi dari luar. **Syarat wajib HTTPS TIDAK ADA DI DOKUMENTASI secara eksplisit**, tapi verifikasi eksternal praktis menuntut endpoint publik. Untuk Firebase: Cloud Functions HTTPS `onRequest` memberi URL publik dengan TLS.

**Implikasi WMS:** webhook Kledo idealnya dipakai untuk sinkronisasi push (stok/transfer berubah → update Firestore). **Blocker:** daftar topik, payload, dan skema signature tidak terdokumentasi. Langkah: panggil `/webhook/settings`, `/webhook/test` dengan kandidat `name`, dan `regenerateSecret` untuk inspeksi format, atau minta daftar topik dari dokumentasi resmi Kledo (di luar file ini). Sampai itu, andalkan polling + `/reportings/warehouseStock` + `/finance/products/stocks`.

---

## Ringkasan temuan kunci & blocker

1. **BATCH stok ada:** `GET /finance/products/stocks?product_ids=1,2,3&warehouse_ids=1,2,3` (baris 20506) — tidak perlu 1 request/produk. Plus `/reportings/warehouseStock` (52256) per tanggal.
2. **Transfer POST body tidak terdokumentasi** (`CreateFinanceWarehouseTransferAPIRequest`, baris 32004) — blocker utama untuk fitur inti. Approve pakai GET (32181).
3. **Material Request/Issue terdokumentasi penuh** termasuk efek stok pada approval terakhir (16142). Tidak ada gudang tujuan dalam satu dokumen.
4. **Stock Adjustment** punya `actual_qty` + `diff_qty` (indikasi absolut), tapi relasi wajib keduanya tidak dijelaskan.
5. **`healthCheck/stockMovementModifier`** = patch data internal, bukan alat opname.
6. **Rate limit tidak didokumentasikan sama sekali.**
7. **Webhook Kledo nyaris kosong di dokumen:** ada `regenerateSecret`, `setup`, `verify`, `test`, `settings`; tanpa daftar topik, payload, atau skema signature.
8. **Skema `FinanceWarehouse`, `FinanceContact`, `Option`, dll tidak didefinisikan** — nama schema saja. Tidak ada satu contoh response JSON aktual di seluruh file.
9. RBAC gudang = daftar role id (`roles: integer[]`), bukan field rich. Untuk admin tanpa akun Kledo, otorisasi tetap harus di Firestore.
10. `is_active` hanya muncul pada **rack** dan entitas lain; gudang pakai **archive/unarchive** (32367/32829). Tidak ada `is_active` untuk warehouse.
