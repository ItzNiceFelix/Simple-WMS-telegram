// test/alias-db.mjs — stub modul @/lib/d1/db untuk harness alias esbuild test:worker.
// Route Next ber-getDb() memanggil getCloudflareContext() → tak hidup di luar worker.
// Stub mengembalikan globalThis.__TMA_TEST_DB__ (diisi test-nya sebelum panggilan).
export function getDb() {
  const db = globalThis.__TMA_TEST_DB__;
  if (!db) throw new Error("__TMA_TEST_DB__ belum dipasang oleh test.");
  return db;
}

export function sekarang() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Vars AI dari binding Worker. Route `/api/order` tidak memakainya, tetapi
 * `app/api/baca/route.ts` (yang diimpor berkas uji order untuk menguji scope produk-total)
 * mengimpornya di tingkat modul — tanpa stub ini bundel esbuild gagal sebelum satu uji pun
 * jalan. Nilai kosong = perilaku "AI belum dikonfigurasi", cukup untuk uji yang tidak AI.
 */
export function getEnvAi() {
  return {};
}

export function gagal(status, error) {
  return { ok: false, status, error };
}
