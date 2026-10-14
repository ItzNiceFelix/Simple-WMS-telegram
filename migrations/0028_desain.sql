-- 0028_desain.sql — Studio Gambar mode Editor: elemen desain + latar AI.
--
-- Kenapa dua tabel: yang KECIL (dokumen elemen, 2–20 KB) dan yang BESAR (raster base64,
-- bisa megabita) dipakai berbeda. Daftar desain dibuka terus-menerus; kalau raster
-- disimpan satu tabel, setiap daftar ikut menarik megabita dan kuota baca D1 terbakar.
-- Jadi `ai_latar` dipisah supaya daftar desain tetap ringan.
--
-- Yang TIDAK disimpan: gambar hasil render desain. Yang disimpan hanya elemen JSON
-- (Fabric toJSON) — render ulang selalu bisa, jadi raster berulang tidak perlu ada.
-- Latar AI adalah pengecualian karena raster-nya TIDAK bisa dihasilkan ulang dari teks.

-- ── Folder bersarang untuk merapikan aset. ──
-- parent_id menunjuk dirinya sendiri; klien yang menyusun pohon (query di sini selalu
-- datar). ON DELETE CASCADE: menghapus folder ikut membuang anaknya, sesuai harapan
-- pengguna yang menghapus satu cabang.
CREATE TABLE IF NOT EXISTS desain_folder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  parent_id INTEGER REFERENCES desain_folder(id) ON DELETE CASCADE,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  oleh TEXT
);
CREATE INDEX IF NOT EXISTS idx_desain_folder_pohon ON desain_folder(preset_id, parent_id);

-- ── Latar raster (AI atau unggahan manual). ──
-- Dibuat SEBELUM ai_desain karena ai_desain.latar_id mengacu ke sini; SQLite tidak
-- mengharuskan urutan ini, tapi berkas yang dibaca manusia harus urut supaya jelas.
-- `byte` disimpan eksplisit supaya indikator kuota tidak perlu membaca base64.
CREATE TABLE IF NOT EXISTS ai_latar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES desain_folder(id) ON DELETE SET NULL,
  nama TEXT NOT NULL DEFAULT 'Latar',
  mime TEXT NOT NULL,
  base64 TEXT NOT NULL,
  byte INTEGER NOT NULL DEFAULT 0,
  folder_manual INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  oleh TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_latar_daftar ON ai_latar(preset_id, at DESC);

-- ── Elemen desain editable (Fabric toJSON), TANPA raster. ──
-- folder_id SET NULL (bukan CASCADE): menghapus folder tidak boleh membuang desain —
-- desain hanya kehilangan tempat, bukan isinya.
-- ai_desain.latar_id SET NULL: latar dihapus user, desain tetap ada dengan latar kosong;
-- itu lebih baik daripada menghapus pekerjaan yang tidak diminta.
CREATE TABLE IF NOT EXISTS ai_desain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES desain_folder(id) ON DELETE SET NULL,
  nama TEXT NOT NULL DEFAULT 'Tanpa nama',
  ukuran TEXT NOT NULL,
  dokumen_json TEXT NOT NULL DEFAULT '{}',
  latar_id INTEGER REFERENCES ai_latar(id) ON DELETE SET NULL,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  oleh TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_desain_terbaru ON ai_desain(preset_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_desain_folder ON ai_desain(folder_id);

PRAGMA optimize;
