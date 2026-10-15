-- 0036_ai_editor.sql — Editor jadi TUJUAN AI kelas satu + pustaka elemen vektor.
--
-- MENGAPA SATU MIGRASI UNTUK DUA HAL:
--   Keduanya lahir dari keputusan produk yang sama ("AI masuk ke EDITOR, bukan cuma
--   generate gambar"), dan keduanya menyentuh jalur yang sama (editor kanvas). Dipecah
--   dua berkas berarti dua deploy terpisah yang salah satunya bisa jalan tanpa yang lain
--   (AI sanggup menyebut `op:add_element` padahal tabel elemennya belum ada). Satu berkas
--   = satu keadaan skema, tidak ada jendela setengah jadi.
--
-- ── BAGIAN 1: ai_editor_setting ───────────────────────────────────────────────
--   Editor sebelumnya MEMANGGIL AI TANPA reasoning/maks_token/model sama sekali
--   (app/api/desain/layout/route.ts) — satu-satunya jalur AI di repo ini yang begitu.
--   Akibatnya model penalaran memakai default provider, dan plafon token tidak ada,
--   padahal jawabannya harus JSON penuh. Kolom di sini menutup itu dengan pola yang
--   SAMA seperti ai_analisa_setting/ai_gambar_setting: satu baris per tg_id, dibaca
--   tanpa pernah insert (default hidup di memori, lihat lib/d1/aiEditorSetting.ts).
--
--   `maks_token` DEFAULT 8000, bukan 16000 seperti analisa: keluaran editor adalah
--   JSON canvas-op yang panjangnya dihitung (tens of ops), bukan narasi bebas. Plafon
--   longgar hanya memperbesar peluang balasan terpotong di tengah JSON, dan JSON
--   terpotong = dokumen tidak bisa dipakai sama sekali.
--
-- ── BAGIAN 2: ai_elemen ───────────────────────────────────────────────────────
--   Pustaka elemen VEKTOR (SVG) — bukan raster. Latar raster sudah punya tabelnya
--   sendiri (`ai_latar`); menyimpannya bercampur berarti daftar elemen ikut menarik
--   base64 megabita padahal yang dibutuhkan hanya markup. Karena itu `svg` TEXT,
--   bukan BLOB base64.
--
--   BATAS `byte` MENGHORMATI `MAKS_DOKUMEN` (256 KB, lib/d1/desain.ts): elemen yang
--   disisipkan AI masuk ke `ai_desain.dokumen_json`, jadi satu elemen yang lebih besar
--   dari sisa kuota dokumen membuat desainnya mustahil disimpan. Batas per elemen
--   ditetapkan lapisan data (bukan CHECK di skema) supaya angkanya bisa dinaikkan
--   tanpa migrasi; yang dipagari di skema hanya bentuk yang membatalkan baris.

-- ── Setting editor PER USER (pola 0031). ──
CREATE TABLE IF NOT EXISTS ai_editor_setting (
  tg_id         TEXT PRIMARY KEY,
  reasoning     TEXT NOT NULL DEFAULT '',          -- '' = default model; nilai sah dari ai_model.reasoning_pilihan
  maks_token    INTEGER NOT NULL DEFAULT 8000,     -- plafon JSON canvas-op; JSON terpotong = tidak bisa dipakai
  diperbarui_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Pustaka elemen vektor, per preset toko (pola ai_latar). ──
-- `svg` disimpan sebagai markup, bukan base64: yang dirender fabric adalah Path-nya,
-- dan markup bisa dibaca/diperiksa manusia saat ada elemen rusak.
-- `elemen_json` adalah bentuk kanonik yang benar-benar disisipkan ke kanvas
-- (`lib/desain/skemaElemen.ts`), disimpan jadi supaya bentuknya stabil walau parser
-- SVG di sisi klien berubah versi.
-- folder_id ON DELETE SET NULL: menghapus folder tidak boleh membuang elemen —
-- alasan yang sama dengan ai_latar/ai_desain di 0028.
CREATE TABLE IF NOT EXISTS ai_elemen (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id    INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  folder_id    INTEGER REFERENCES desain_folder(id) ON DELETE SET NULL,
  nama         TEXT NOT NULL DEFAULT 'Elemen',
  kategori     TEXT NOT NULL DEFAULT 'bentuk' CHECK (kategori IN ('bentuk','ikon','panah','hiasan')),
  svg          TEXT NOT NULL,
  elemen_json  TEXT NOT NULL,
  byte         INTEGER NOT NULL DEFAULT 0,
  at           INTEGER NOT NULL DEFAULT (unixepoch()),
  oleh         TEXT
);

-- Daftar terpanas: "elemen preset ini, terbaru dulu" — sama dengan pola idx_ai_latar_daftar.
CREATE INDEX IF NOT EXISTS idx_ai_elemen_daftar ON ai_elemen(preset_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_elemen_kategori ON ai_elemen(preset_id, kategori, at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_elemen_folder ON ai_elemen(folder_id);

PRAGMA optimize;
