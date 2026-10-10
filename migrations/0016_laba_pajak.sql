-- 0016_laba_pajak.sql — Pajak terpisah di snapshot laba (tampil "Estimasi PPh terbayarkan").
-- Snapshot lama: pajak = 0 (tak diketahui). Biaya tetap total termasuk pajak.
ALTER TABLE laba_snapshot ADD COLUMN pajak INTEGER NOT NULL DEFAULT 0;
PRAGMA optimize;
