-- 0012_fee_desimal.sql — Nilai fee desimal (mis. admin 3.5%): INTEGER → REAL.
-- Buat ulang kedua tabel fee, pindahkan data (nilai lama bulat, aman).
PRAGMA foreign_keys = OFF;
CREATE TABLE order_fees_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace TEXT NOT NULL,
  no_pesanan TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('admin','service','komisi','ongkir','voucher','affiliate','iklan','lain')),
  basis TEXT NOT NULL CHECK (basis IN ('flat','persen')),
  nilai REAL NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (marketplace, no_pesanan) REFERENCES orders(marketplace, no_pesanan) ON DELETE CASCADE
);
INSERT INTO order_fees_new (id, marketplace, no_pesanan, jenis, basis, nilai, amount)
  SELECT id, marketplace, no_pesanan, jenis, basis, nilai, amount FROM order_fees;
DROP TABLE order_fees;
ALTER TABLE order_fees_new RENAME TO order_fees;
CREATE TABLE mp_fee_presets_new (
  marketplace TEXT NOT NULL,
  jenis TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('flat','persen')),
  nilai REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (marketplace, jenis)
);
INSERT INTO mp_fee_presets_new (marketplace, jenis, basis, nilai)
  SELECT marketplace, jenis, basis, nilai FROM mp_fee_presets;
DROP TABLE mp_fee_presets;
ALTER TABLE mp_fee_presets_new RENAME TO mp_fee_presets;
PRAGMA foreign_keys = ON;
PRAGMA optimize;
