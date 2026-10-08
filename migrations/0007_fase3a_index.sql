-- 0007_fase3a_index.sql — Index order_fees (marketplace, no_pesanan) (deferred Task 1).
CREATE INDEX IF NOT EXISTS idx_fees_order ON order_fees(marketplace, no_pesanan);
