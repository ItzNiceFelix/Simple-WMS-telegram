-- 0022: kapabilitas model (modal masuk/keluar) + skema reasoning.
--
-- modal_masuk / modal_keluar: CSV lowercase, mis. masuk 'text,image', keluar 'text'.
--   KOSONG = tidak diketahui.
-- reasoning_skema: '' (tidak ada) | 'level_4' (minimal/low/medium/high)
--   | 'level_3' (low/medium/high) | 'effort_openai' (minimal/low/medium/high)
--   | 'bool' (on/off saja).
-- reasoning_pilihan: CSV nilai SAH untuk model itu, mis. 'low,medium,high'.
--   Kosong bila skema ''.
-- reasoning_hilir: 1 = model bisa MENGHASILKAN reasoning yang dibaca sistem, 0 = tidak.
-- sumber: 'provider' (dari API) | 'heuristik' (tebak nama) | 'manual' (diisi user).
ALTER TABLE ai_model ADD COLUMN modal_masuk TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_model ADD COLUMN modal_keluar TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_model ADD COLUMN reasoning_skema TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_model ADD COLUMN reasoning_pilihan TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_model ADD COLUMN reasoning_hilir INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_model ADD COLUMN sumber TEXT NOT NULL DEFAULT 'manual';
