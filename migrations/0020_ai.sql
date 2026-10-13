-- 0020_ai.sql — Sistem AI: kredensial terenkripsi + katalog model + preset prompt
--              + peta kata kunci tool + pencatatan pemakaian.
-- Konvensi: IF NOT EXISTS, TEXT, INTEGER rupiah/unixepoch, waktu unixepoch.
-- Kredensial: ciphertext AES-GCM (WebCrypto). Plaintext TIDAK PERNAH masuk DB.

-- ── Kredensial provider. Satu provider boleh punya >1 baris (mis. kunci berbeda per tim). ──
CREATE TABLE IF NOT EXISTS ai_kredensial (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,                 -- groq|gemini|kenari|openai|openrouter
  label       TEXT NOT NULL DEFAULT '',      -- nama bebas, mis. "Groq utama"
  ciphertext  TEXT NOT NULL,                 -- base64
  iv          TEXT NOT NULL,                 -- base64, 12 byte
  tag         TEXT NOT NULL,                 -- base64, 16 byte
  /** 4 karakter terakhir plaintext, untuk ditampilkan sebagai mask (mis. "••••3f2a"). */
  ujung       TEXT NOT NULL DEFAULT '',
  aktif       INTEGER NOT NULL DEFAULT 1,
  dibuat_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  dibuat_oleh TEXT,
  uji_at      INTEGER,                       -- terakhir diuji
  uji_hasil   TEXT                           -- JSON: {ok, latencyMs, model, error}
);
CREATE INDEX IF NOT EXISTS idx_ai_kred_provider ON ai_kredensial(provider, aktif);

-- ── Katalog model. Sumber awal: GET /v1/models provider; user bisa tambah manual. ──
CREATE TABLE IF NOT EXISTS ai_model (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,
  model_id    TEXT NOT NULL,                 -- mis. openai/gpt-oss-120b
  label       TEXT NOT NULL DEFAULT '',
  jenis       TEXT NOT NULL DEFAULT 'teks',  -- teks|gambar|vision
  aktif       INTEGER NOT NULL DEFAULT 1,
  ditambah_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (provider, model_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_model_prov ON ai_model(provider, jenis, aktif);

-- ── Preset prompt untuk image gen (foto produk listing marketplace). ──
CREATE TABLE IF NOT EXISTS ai_preset_prompt (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nama      TEXT NOT NULL,
  kategori  TEXT NOT NULL DEFAULT 'produk',  -- produk|latar|gaya|lain
  prompt    TEXT NOT NULL,
  urutan    INTEGER NOT NULL DEFAULT 0,
  aktif     INTEGER NOT NULL DEFAULT 1,
  dibuat_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ai_preset_kat ON ai_preset_prompt(kategori, urutan);

-- ── Katalog tool AI. Aktif/nonaktif + penanda tool tulis (berbahaya). ──
CREATE TABLE IF NOT EXISTS ai_tool (
  nama             TEXT PRIMARY KEY,         -- mis. "cekStok"
  label            TEXT NOT NULL,
  deskripsi        TEXT NOT NULL DEFAULT '',
  jenis            TEXT NOT NULL DEFAULT 'baca',  -- baca|tulis
  perlu_konfirmasi INTEGER NOT NULL DEFAULT 0,
  aktif            INTEGER NOT NULL DEFAULT 1,
  urutan           INTEGER NOT NULL DEFAULT 0
);

-- ── Peta kata kunci -> tool. DIATUR DARI UI (bukan hardcode), agar bisa diperbaiki
--    tanpa deploy saat admin memakai istilah yang berbeda. ──
CREATE TABLE IF NOT EXISTS ai_tool_kata (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  tool    TEXT NOT NULL,
  kata    TEXT NOT NULL,                     -- satu kata/frasa, lowercase
  urutan  INTEGER NOT NULL DEFAULT 0,
  aktif   INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tool, kata)
);
CREATE INDEX IF NOT EXISTS idx_ai_kata ON ai_tool_kata(kata, aktif);

-- ── Pemakaian API per hari: agar biaya terpantau. ──
CREATE TABLE IF NOT EXISTS ai_pemakaian (
  tanggal      TEXT NOT NULL,                -- YYYY-MM-DD (WIB)
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  jenis        TEXT NOT NULL,                -- teks|gambar|vision
  panggilan    INTEGER NOT NULL DEFAULT 0,
  token_masuk  INTEGER NOT NULL DEFAULT 0,
  token_keluar INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tanggal, provider, model, jenis)
);
