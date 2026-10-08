// e2e/tma.spec.ts — Auto-login Telegram Mini App (initData HMAC).
// Di sini diuji lapis guard route (app/api/auth/tma/route.ts):
//   1. POST tanpa Origin di production → 403 (tolakOriginD1, server uji
//      berjalan NODE_ENV=production via `next start`).
//   2. POST Origin asing → 403 (bukan di allowlist & bukan *.workers.dev akun).
// Lapis initData — 400 kosong / 401 hash salah / 403 user tak terdaftar /
// 200 + Set-Cookie — TIDAK dicapai end-to-end lokal: semua route ber-getDb()
// memanggil getCloudflareContext() dan gagal 500 tanpa binding wrangler.
// Lapis itu diuji UNIT di app/api/auth/tma/route.test.ts (masuk `npm run test:worker`).
import { test, expect } from "@playwright/test";

test("POST /api/auth/tma tanpa Origin → 403 (tolakOriginD1)", async ({ request }) => {
  const res = await request.post("/api/auth/tma", { data: { initData: "" } });
  expect(res.status()).toBe(403);
});

test("POST /api/auth/tma Origin asing → 403 (di luar allowlist)", async ({ request }) => {
  const res = await request.post("/api/auth/tma", {
    headers: { origin: "https://jahat.example.com" },
    data: { initData: "user=%7B%22id%22%3A1%7D&auth_date=1" },
  });
  expect(res.status()).toBe(403);
});
