-- 0009_order_fulfill_source.sql — external handoff distinct from WMS stock deduction.
ALTER TABLE orders ADD COLUMN stok_dikurangi INTEGER NOT NULL DEFAULT 0 CHECK (stok_dikurangi IN (0,1));
ALTER TABLE orders ADD COLUMN no_resi TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_orders_resi ON orders(no_resi);
