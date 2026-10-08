// e2e/tma.spec.ts — Auto-login Telegram Mini App (initData HMAC).
// Tanpa initData valid → route menolak; web biasa tetap /masuk password.
import { test, expect } from "@playwright/test";

test("POST /api/auth/tma tanpa initData → 400/401", async ({ request }) => {
  const res = await request.post("/api/auth/tma", { data: {} });
  expect([400, 401]).toContain(res.status());
});

test("POST /api/auth/tma initData palsu → 401", async ({ request }) => {
  const res = await request.post("/api/auth/tma", {
    data: { initData: "user=%7B%22id%22%3A1%7D&auth_date=1&hash=00" },
  });
  expect(res.status()).toBe(401);
});
