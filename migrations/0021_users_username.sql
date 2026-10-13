-- 0021_users_username.sql — Username unik untuk login (Fase F).
-- Kolom users.username sudah ada sejak 0011 (TEXT, semua NULL di produksi).
-- Index unik PARSIAL: baris NULL/kosong tidak saling bentrok, jadi user lama
-- yang belum set username tetap sah. Login bisa pakai tg_id ATAU username.
-- Index tg_id sudah ada (idx_users_tg, 0001/0011) — tidak diduplikasi di sini.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
  ON users(lower(username)) WHERE username IS NOT NULL AND username != '';
