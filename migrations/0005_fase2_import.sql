-- 0005_fase2_import.sql — Riwayat import Excel (Fase 2, PRD F3).
CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipe TEXT NOT NULL,
  file TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  sukses INTEGER NOT NULL DEFAULT 0,
  gagal INTEGER NOT NULL DEFAULT 0,
  gudang_id TEXT NOT NULL DEFAULT 'ONLINE',
  payload_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','done','batal')),
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  by TEXT
);
CREATE INDEX IF NOT EXISTS idx_import_status ON import_batches(status, at DESC);

CREATE TABLE IF NOT EXISTS import_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  baris INTEGER NOT NULL,
  pesan TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_err ON import_errors(batch_id);
PRAGMA optimize;
