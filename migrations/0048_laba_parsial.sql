-- 0048_laba_parsial.sql — tandai hari yang cakupannya tidak utuh.
--
-- KENAPA PERLU:
--   `potongPerTanggal` sudah tahu hari mana yang PARSIAL (hari tepi berkas Order.all: export
--   dimulai/diakhiri di tengah hari). Pengetahuan itu hanya hidup selama satu request impor
--   dan hilang setelahnya, sehingga grafik tren memperlakukan hari setengah jadi sebagai hari
--   penuh: batangnya tampak anjlok, delta harian tampak "penjualan turun 60%", padahal yang
--   kurang hanya jamnya.
--
-- KENAPA NULL, BUKAN 0:
--   Snapshot yang diimpor SEBELUM kolom ini ada tidak pernah dinilai. Mengisinya 0 berarti
--   mengklaim "hari itu penuh" tanpa dasar — persis kebohongan yang ingin dihindari.
--   NULL = belum dinilai; UI tidak menggambar penanda apa pun.
ALTER TABLE laba_snapshot ADD COLUMN parsial INTEGER;
PRAGMA optimize;
