-- 0029_stok_online.sql — Stok gudang ONLINE jadi tanggung jawab user repo (bukan Kledo).
--
-- Kenapa dimulai dari NOL: gudang ONLINE tidak ada di Kledo, jadi tidak ada sync yang
-- mengisi atau mengoreksinya. Nilai lamanya berasal dari era Firestore, bukan dari hitungan
-- manusia — kalau dibiarkan, tombol "kekurangan" akan mengeluh soal angka yang tidak
-- dipercaya siapa pun. User menandai sendiri produk mana yang stoknya di ONLINE.
UPDATE products SET is_online_product = 0 WHERE is_online_product <> 0;

-- Sisa era lama: kolom ini dulu berarti "WMS sudah memotong stok untuk order ini".
-- Sekarang dipakai sebagai kunci idempotensi cetak picklist online — cetak ulang TIDAK
-- boleh memotong dua kali, dan itulah satu-satunya cara aman memotong saat mencetak.
-- Tidak di-DROP supaya data lama tetap bisa ditelusuri; hanya artinya yang dipertajam.
-- (Nilai 0/1 sudah cukup: potong terjadi di cetak pertama, tidak ada percobaan kedua.)
