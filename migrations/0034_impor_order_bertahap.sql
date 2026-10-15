-- 0034_impor_order_bertahap.sql — Impor order Shopee BERTAHAP (potongan per request).
--
-- KENAPA ADA MIGRASI INI:
--   Worker Free dibatasi ~50 KUERI per invokasi. Jalur konfirmasi lama memanggil `ambilProduk`
--   PER BARIS, dan tiap panggilan itu satu kueri — berkas 5000 baris = ~5000 kueri, jauh di
--   atas plafon, dan request mati di tengah. Menaikkan MAKS_BARIS_SHOPEE hanya memindahkan
--   titik matinya, bukan menghilangkannya. Solusinya berkas dipecah di KLIEN: tiap potongan
--   jadi satu invocation sendiri, jadi anggaran kuerinya segar tiap potongan.
--
-- KENAPA STATUS 'preview' DIPAKAI ULANG, bukan nilai status baru:
--   `import_batches.status` dikunci CHECK ('preview','done','batal'). SQLite tak bisa ubah
--   CHECK inline — harus bangun ulang tabel, dan `import_batches` sudah jadi target FK
--   `import_errors.batch_id`, jadi DROP/RENAME-nya berisiko gagal total (lihat pelajaran
--   migrasi 0033). Karena "sedang berjalan" dan "menunggu dikonfirmasi" sama-sama berarti
--   BELUM selesai, keduanya cukup diwakili 'preview'; yang membedakan progres adalah kolom
--   `progres_baris`/`nomor_potong` di bawah. Frontend/klien yang memutuskan lanjut atau
--   selesai, bukan mesin status DB.
--
-- KENAPA ADA `mode_impor`:
--   Batch lama (jalur 2-fase: preview → konfirmasi) dan batch baru (bertahap) sama-sama
--   berstatus 'preview'. Tanpa penanda ini, klien tak bisa tahu apakah sebuah batch masih
--   menunggu satu POST konfirmasi besar atau sedang menunggu potongan berikutnya.
--     'fase2'    = jalur lama, payload_json berisi seluruh dataset, konfirmasi sekali.
--     'bertahap' = jalur baru, baris dikirim/di-commit per potongan; payload_json KOSONG.
ALTER TABLE import_batches ADD COLUMN mode_impor TEXT NOT NULL DEFAULT 'fase2';

-- ORDER yang sudah sukses di-commit pada batch bertahap. Satuannya ORDER (bukan baris berkas):
-- klien memotong array `orders` hasil preview, jadi progres harus bisa menjawab "order ke berapa
-- yang sudah masuk" agar resume tidak melompati order untuk berkas dengan >1 item per order.
ALTER TABLE import_batches ADD COLUMN progres_baris INTEGER NOT NULL DEFAULT 0;

-- Nomor potongan terakhir yang sukses (1-basis). Dipakai untuk melanjutkan penomoran dan
-- sebagai penanda idempoten: POST potongan dengan nomor yang sudah terpakai ditolak, jadi
-- klien yang mengulang kirim karena jaringan putus tidak menyimpan baris dua kali.
ALTER TABLE import_batches ADD COLUMN nomor_potong INTEGER NOT NULL DEFAULT 0;

-- Jumlah baris yang DILEWATI (ditolak D1 per pernyataan, mis. FK) di seluruh potongan.
-- Disimpan agar laporan akhir menyebut angka sebenarnya walau request potongannya sudah
-- lama selesai — nilai ini tidak bisa direkonstruksi setelah invokasi berakhir.
ALTER TABLE import_batches ADD COLUMN dilewati INTEGER NOT NULL DEFAULT 0;

-- Cari batch belum selesai milik satu berkas supaya unggah ulang berkas yang sama bisa
-- MELANJUTKAN, bukan memulai dari nol. Bagian `at` DESC: berkas sama yang diunggah berkali-kali
-- dilanjutkan dari percobaan terbaru.
CREATE INDEX IF NOT EXISTS idx_import_progress ON import_batches (file, mode_impor, at DESC);

PRAGMA optimize;
