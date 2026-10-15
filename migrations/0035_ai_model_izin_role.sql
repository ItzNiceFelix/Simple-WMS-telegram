-- 0035_ai_model_izin_role.sql — Izin model AI PER ROLE dan PER TUJUAN (cost control).
--
-- MASALAH YANG DIPERBAIKI:
--   Katalog `ai_model` adalah daftar GLOBAL. Siapa pun yang bisa membuka halaman AI
--   (admin, designer) melihat SELURUH model — termasuk yang mahal — dan pemilih model
--   di UI hanya menyaring TAMPILAN. Menyaring di UI saja bisa ditembus: kirim saja
--   `modelGambar`/`model_id` langsung ke API dan model terlarang tetap dipanggil.
--   Jadi daftar izin harus ada di DB dan DIPERIKSA DI SERVER saat model dipilih.
--
-- KENAPA TABEL BARU, bukan menumpang peta provider di `settings.ai`:
--   Kebutuhan sebenarnya adalah "model mana yang boleh dipakai `admin` untuk GAMBAR",
--   yang pertanyaannya BEDA dari "...untuk TEKS". Peta provider (`modelTeks`/`modelGambar`)
--   hanya punya satu nilai per provider dan tidak punya dimensi role — memaksakannya ke
--   sana akan menghapus dimensi yang justru dibutuhkan.
--
-- KENAPA `allowed` sebagai kolom, bukan "ada baris = boleh":
--   Owner perlu bisa MEMATIKAN satu izin tanpa kehilangan jejak bahwa model itu pernah
--   disetujui. Baris dengan allowed=0 tetap tersimpan sebagai niat eksplisit, dan
--   membalik keputusan cukup satu UPDATE.
--
-- FAIL CLOSED (lihat lib/d1/aiIzinModel.ts):
--   Tabel KOSONG berarti non-owner TIDAK dapat model apa pun — bukan "boleh semua".
--   Arah default ini disengaja: fitur ini untuk menahan biaya, jadi kelalaian
--   konfigurasi harus berujung "tidak bisa pakai" (bisa dilaporkan user), bukan
--   "semua model terbuka" (tagihan tak terduga yang tidak terlihat siapa pun).
--
-- `owner` TIDAK PERNAH dibatasi dan TIDAK membaca tabel ini sama sekali — supaya owner
-- tidak ikut terkunci kalau migrasi ini belum diisi. Lihat pintasan di provider.ts.
--
-- CHECK `jenis`: tuJua disamakan dengan `ai_model.jenis` (teks|vision|gambar) supaya
-- join izin↔katalog selalu cocok. 'audio'/'lain' belum dipakai jalur AI mana pun hari ini.
CREATE TABLE IF NOT EXISTS ai_model_izin (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL CHECK (role IN ('high_admin','admin','designer','guest')),
  provider   TEXT NOT NULL,
  model_id   TEXT NOT NULL,
  jenis      TEXT NOT NULL CHECK (jenis IN ('teks','vision','gambar')),
  allowed    INTEGER NOT NULL DEFAULT 1,
  at         INTEGER NOT NULL DEFAULT (unixepoch()),
  oleh       TEXT
);

-- Satu keputusan per (role, provider, model, jenis). UNIQUE ini yang membuat
-- "izinkan" idempoten: menekan tombol dua kali tidak membuat baris ganda, dan
-- membalik izin cukup lewat ON CONFLICT DO UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_model_izin_unik
  ON ai_model_izin(role, provider, model_id, jenis);

-- Jalur baca terpanas: "model apa saja yang boleh untuk role X + jenis Y".
CREATE INDEX IF NOT EXISTS idx_ai_model_izin_role_jenis ON ai_model_izin(role, jenis, allowed);

PRAGMA optimize;
