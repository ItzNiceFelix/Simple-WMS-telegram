-- 0039_order_daftar_urut.sql — Index untuk daftar order yang kini dipaginasi, difilter tanggal,
-- dan diurutkan server-side.
--
-- BELUM DIJALANKAN. Ditulis supaya keputusannya tercatat dan siap dieksekusi sendiri; tidak ada
-- perubahan perilaku sebelum diterapkan (SQLite tetap memakai index lama atau scan).
--
-- KENAPA PERLU:
--   Index yang ada (`idx_orders_tgl` = tanggal, `idx_orders_mp` = (marketplace, tanggal)) TIDAK
--   memuat kolom tiebreaker. Daftar sekarang selalu menambahkan `marketplace ASC, no_pesanan ASC`
--   di belakang kolom urut (lihat TIEBREAKER_ORDER di lib/d1/order.ts) supaya paginasi tidak
--   menduplikasi/menjatuhkan baris saat `tanggal` seri — dan `tanggal` SERI MASSAL, karena satu
--   batch impor menulis tanggal yang sama ke ratusan order.
--   Tanpa `no_pesanan` di index, SQLite harus mengurutkan ulang hasil scan (temp B-tree) untuk
--   setiap halaman. Untuk data harian (puluhan–ratusan baris per hari, karena filter tanggal
--   sudah menyaring dulu) biayanya kecil. Index di bawah menjaga biaya itu tetap kecil juga
--   saat daftar dibuka TANPA filter tanggal dan tabelnya sudah puluhan ribu baris.
--
-- KENAPA (tanggal DESC, marketplace, no_pesanan) dan bukan (marketplace, no_pesanan):
--   Urutan default daftar adalah tanggal DESC; pengguna yang membuka /order tanpa mengubah apa
--   pun harus dilayani index ini apa adanya. Dua kolom terakhir mengikuti TIEBREAKER_ORDER
--   dengan arah ASC — arah tiap kolom di index harus sama dengan arah di query, dan arah pada
--   index di bawah sudah persis itu.
--
-- CATATAN: SQLite TIDAK memakai index ini untuk `ORDER BY no_resi` / `status_fulfill` (kolom
-- urut alternatif). Dua kunci itu tetap dijawab dengan temp B-tree. Menambah index terpisah
-- untuk keduanya belum dibenarkan oleh pola pemakaian mana pun yang terukur; tambahkan bila
-- daftar tanpa filter tanggal mulai terasa lambat pada salah satu urutan itu.
CREATE INDEX IF NOT EXISTS idx_orders_urut_daftar ON orders (tanggal DESC, marketplace ASC, no_pesanan ASC);

PRAGMA optimize;
