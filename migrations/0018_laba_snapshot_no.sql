-- 0018_laba_snapshot_no.sql — Lapis 3: daftar No. Pesanan per snapshot laba.
-- Registry laba_order ber-PK (preset_id, no_pesanan) → hanya satu baris per No (upsert
-- tulis-ulang), jadi "No muncul di >1 tanggal" tak bisa dideteksi dari registry.
-- Snapshot laba_snapshot tetap satu baris per (preset_id, tanggal) → simpan daftar No
-- yang ikut dihitung pada tanggal itu sebagai JSON array string, urut sesuai agregat.
-- Snapshot lama (sebelum migrasi) bernilai '[]' → tak terdeteksi overlap (dicatat di UI).
-- Konvensi: IF NOT EXISTS, TEXT JSON, unixepoch waktu.
ALTER TABLE laba_snapshot ADD COLUMN no_json TEXT NOT NULL DEFAULT '[]';
PRAGMA optimize;
