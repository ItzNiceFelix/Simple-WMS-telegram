-- 0015_go_override.sql — Override grup GO XTRA per SKU (kasus: Rice Bucket kena H, bukan D).
-- Grup diambil dari kategori_tarif[path].grup_go; bila go_override diisi, pakai itu.
ALTER TABLE products ADD COLUMN go_override TEXT;
PRAGMA optimize;
