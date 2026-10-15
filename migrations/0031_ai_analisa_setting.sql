-- 0031_ai_analisa_setting.sql — Setting analisa mendalam PER USER (halaman /analisa).
--
-- Tiap user punya baris sendiri: user A pilih reasoning 'high' + narasi panjang,
-- user B 'minimal' + ringkas, tidak saling ganggu. Kosong = pakai default model.
--
-- KENAPA ADA PLAFON `maks_token` (dulu tidak ada batas sama sekali):
--   Tanpa plafon, permintaan bisa meminta token lebih banyak daripada yang sanggup
--   dikirim penyedia dalam satu balasan. Penyedia TIDAK selalu membalas error untuk itu —
--   sebagian membalas 200 dengan penanda `incomplete`/`length` dan teks yang terpotong.
--   Akibatnya token sudah TERBAYAR tapi jawaban yang terlihat user tidak lengkap, tanpa
--   pesan kesalahan apa pun. Nilai 16000 adalah plafon SENGAJA LONGGAR: cukup untuk
--   narasi analisa panjang, tapi masih menahan permintaan yang jelas keliru.
--
-- KENAPA `kedalaman` berupa INSTRUKSI, bukan pemotongan output:
--   `kedalaman` mengubah PANJANG INSTRUKSI yang dikirim ke model (minta ringkas /
--   sedang / panjang). Ia TIDAK memotong keluaran dan TIDAK membatasi apa pun setelah
--   model menjawab. Memotong keluaran akan membuang kesimpulan di bagian akhir tanpa
--   jejak; menyuruh model menyesuaikan panjang jauh lebih aman karena model tetap
--   menyelesaikan kalimatnya. Karena itu kolom ini disimpan sebagai instruksi prompt,
--   dan `maks_token` tetap terpisah sebagai plafon teknis permintaan.
--
-- CHECK: tiga nilai kedalaman dipagari di skema, bukan hanya di TypeScript, supaya
-- baris yang salah tidak bisa masuk lewat jalur lain (skrip, impor manual).
CREATE TABLE IF NOT EXISTS ai_analisa_setting (
  tg_id         TEXT PRIMARY KEY,
  reasoning     TEXT NOT NULL DEFAULT '',              -- '' = default model; nilai sah dari ai_model.reasoning_pilihan
  maks_token    INTEGER NOT NULL DEFAULT 16000,        -- plafon LONGGAR; cegah balasan 'incomplete' yang tokennya tetap terbayar
  kedalaman     TEXT NOT NULL DEFAULT 'sedang' CHECK (kedalaman IN ('ringkas','sedang','panjang')), -- INSTRUKSI panjang, bukan pemotongan output
  diperbarui_at INTEGER NOT NULL DEFAULT (unixepoch())
);
