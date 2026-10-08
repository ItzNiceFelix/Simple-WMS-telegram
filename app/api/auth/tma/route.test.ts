// app/api/auth/tma/route.test.ts — node:test untuk route POST /api/auth/tma (Fase 3a, Task 8).
// Harness: esbuild bundle + alias (lihat package.json test:worker):
//   - @/lib/d1/db    → stub { getDb } (route tak bisa hidup tanpa binding wrangler)
//   - @/lib/d1/route → modul ASLI; guard origin lolos karena Request memakai
//     Origin host workers.dev akun sendiri (diterima tolakOriginD1, lihat
//     lib/d1/route.ts). Guard origin sendiri diuji e2e di e2e/tma.spec.ts.
// Fokus di sini: kontrak lapis ke-2 — initData → 400/401/403/200.
// worker/auth.ts dipakai ASLI (WebCrypto ada di Node >= 20) dengan mock D1.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { POST } from "./route";
import { buatDbMock, type Row } from "./route.mock";
// Stub mengarahkan resolusi ke lib/dashboard/auth/initData.js nyata (alias
// --alias:@/lib/dashboard/auth/initData.js=./test/alias-initdata.mjs).
import { buatInitData } from "@/lib/dashboard/auth/initData.js";

const BOT_TOKEN = "123456:TEST-TOKEN-initdata";
const ASAL = "https://simple-wms-telegram.bagus-deva-nov-p.workers.dev";

// Diisi oleh test sebelum tiap panggilan; alias @/lib/d1/db mengembalikannya.
declare global {
  // eslint-disable-next-line no-var
  var __TMA_TEST_DB__: ReturnType<typeof buatDbMock>["db"] | undefined;
}

function initDataValid(userId: string): string {
  return buatInitData({
    botToken: BOT_TOKEN,
    user: { id: userId, username: "uji", first_name: "Uji" },
    authDate: Math.floor(Date.now() / 1000),
  });
}

function req(initData: string): Request {
  return new Request(`${ASAL}/api/auth/tma`, {
    method: "POST",
    headers: { origin: ASAL, "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
}

function pasangDb(users: Row[]) {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  const mock = buatDbMock(users);
  globalThis.__TMA_TEST_DB__ = mock.db;
  return mock;
}

async function bacaJson(res: Response): Promise<{ ok: boolean; error?: string }> {
  return (await res.json()) as { ok: boolean; error?: string };
}

describe("POST /api/auth/tma", () => {
  it("initData kosong → 400", async () => {
    pasangDb([]);
    const res = await POST(req(""));
    assert.equal(res.status, 400);
    const body = await bacaJson(res);
    assert.equal(body.ok, false);
    // 400 dicapai SETELAH guard origin lolos → origin tidak memblokir.
    assert.match(String(body.error), /initData/i);
  });

  it("hash salah → 401", async () => {
    pasangDb([]);
    const res = await POST(req("user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef"));
    assert.equal(res.status, 401);
    const body = await bacaJson(res);
    assert.equal(body.ok, false);
  });

  it("initData valid tetapi user tak terdaftar → 403", async () => {
    pasangDb([]);
    const res = await POST(req(initDataValid("99999")));
    assert.equal(res.status, 403);
    const body = await bacaJson(res);
    assert.equal(body.ok, false);
    assert.match(String(body.error), /terdaftar/i);
  });

  it("initData valid + user terdaftar → 200 + Set-Cookie sesi", async () => {
    const mock = pasangDb([
      { id: 7, tg_id: "88888", username: "budi", display_name: "Budi", password_hash: null, role: "owner", active: 1 },
    ]);
    const res = await POST(req(initDataValid("88888")));
    assert.equal(res.status, 200);
    const body = await bacaJson(res);
    assert.equal(body.ok, true);
    assert.match(String(res.headers.get("set-cookie")), /swt_sesi=/);
    assert.equal(mock.sessions.length, 1);
  });
});
