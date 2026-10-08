// e2e/tma.spec.ts — Auto-login Telegram Mini App (initData HMAC).
// Kontrak lapis guard route (app/api/auth/tma/route.ts):
//   1. tolakOriginD1 — Origin tak di allowlist → 403 (diuji di sini; server uji
//      jalan NODE_ENV=production via `next start`).
//   2. verifikasiInitData — initData kosong → 400, hash hilang → 400,
//      hash salah → 401. Diuji unit di worker/auth.test.ts.
// Lapis 2 TIDAK bisa dicapai end-to-end di e2e lokal: semua route ber-getDb()
// memanggil getCloudflareContext() dan gagal 500 tanpa binding wrangler
// (initOpenNextCloudflareForDev sengaja tak dipanggil — lihat next.config.mjs).
// Karena itu e2e menembak TANPA Origin: menetapkan batas guard origin (403)
// yang membuktikan hal yang sama pentingnya — route tak bocor tanpa Origin.
// Sesi D1 diverifikasi terpisah di worker/auth.test.ts + preview deploy.
import { test, expect } from "@playwright/test";

test("POST /api/auth/tma tanpa Origin → 403 (tolakOriginD1)", async ({ request }) => {
  const res = await request.post("/api/auth/tma", { data: {} });
  expect(res.status()).toBe(403);
});

test("POST /api/auth/tma Origin tak diizinkan → 403", async ({ request }) => {
  const res = await request.post("/api/auth/tma", {
    headers: { origin: "https://jahat.example.com" },
    data: { initData: "user=%7B%22id%22%3A1%7D&auth_date=1" },
  });
  expect(res.status()).toBe(403);
});
