-- 0023_ai_gambar_setting.sql — Setting gambar PER USER (halaman /ai-gambar).
-- Tiap user punya baris sendiri: user A pilih reasoning 'high', user B 'minimal',
-- tidak saling ganggu. Kosong = pakai default provider.
CREATE TABLE IF NOT EXISTS ai_gambar_setting (
  tg_id         TEXT PRIMARY KEY,
  provider      TEXT NOT NULL DEFAULT 'gemini',
  model_id      TEXT NOT NULL DEFAULT '',      -- '' = model gambar dari pengaturan global
  reasoning     TEXT NOT NULL DEFAULT '',      -- '' = default provider; nilai sah dari ai_model.reasoning_pilihan
  aspek_rasio   TEXT NOT NULL DEFAULT '1:1',
  jumlah        INTEGER NOT NULL DEFAULT 1,
  diperbarui_at INTEGER NOT NULL DEFAULT (unixepoch())
);
