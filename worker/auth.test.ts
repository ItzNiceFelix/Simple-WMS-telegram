// worker/auth.test.ts — node:test untuk worker/auth.ts (Fase 0).
// WebCrypto tersedia di Node >= 20 (globalThis.crypto). D1 dimock minimal:
// prepare(sql).bind(...).first()/run()/all() + meta.last_row_id.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ambilTokenDariCookie,
  atributCookieSesi,
  bootstrapOwner,
  buatSesi,
  cabutSesi,
  hashPassword,
  loginTerkunci,
  setPassword,
  terbitkanKode,
  verifikasiKode,
  verifikasiPassword,
  verifikasiSesi,
  NAMA_COOKIE_SESI,
} from "./auth.ts";

type Row = Record<string, unknown>;

function buatDbMock() {
  const users: Row[] = [];
  const sessions: Row[] = [];
  const codes: Row[] = [];
  const audits: Row[] = [];
  const warehouses: Row[] = [{ id: 1, code: "ONLINE", nama: "Gudang Online" }];
  const userWarehouses: Row[] = [];
  let seq = 0;
  const db = {
    data: { users, sessions, codes, audits, warehouses, userWarehouses },
    prepare(sql: string) {
      const st = {
        _args: [] as unknown[],
        bind(...a: unknown[]) {
          st._args = a;
          return st;
        },
        async first<T>() {
          if (sql.includes("FROM users WHERE tg_id")) {
            return (users.find((u) => u.tg_id === st._args[0] && u.active === 1) ?? null) as T;
          }
          if (sql.includes("COUNT(*) AS n FROM users")) return { n: users.length } as T;
          if (sql.includes("FROM sessions WHERE token_hash")) {
            return (sessions.find((s) => s.token_hash === st._args[0] && s.revoked_at == null) ?? null) as T;
          }
          if (sql.includes("FROM users WHERE id =")) {
            return (users.find((u) => u.id === st._args[0] && u.active === 1) ?? null) as T;
          }
          if (sql.includes("FROM warehouses WHERE code")) {
            return (warehouses.find((w) => w.code === "ONLINE") ?? null) as T;
          }
          if (sql.includes("COUNT(*) AS n FROM login_audit")) {
            const n = audits.filter(
              (a) => a.tg_id === st._args[0] && a.sukses === 0 && (a.at as number) > (st._args[1] as number)
            ).length;
            return { n } as T;
          }
          if (sql.includes("FROM auth_codes WHERE tg_id")) {
            return (codes.find((c) => c.tg_id === st._args[0] && c.code_hash === st._args[1]) ?? null) as T;
          }
          return null as T;
        },
        async run() {
          if (sql.startsWith("INSERT INTO users")) {
            seq += 1;
            users.push({
              id: seq, tg_id: st._args[0], username: null, display_name: st._args[1],
              password_hash: st._args[2], role: "owner", active: 1,
            });
            return { meta: { last_row_id: seq } };
          }
          if (sql.startsWith("INSERT INTO user_warehouses")) {
            userWarehouses.push({ user_id: st._args[0], warehouse_id: st._args[1] });
            return { meta: {} };
          }
          if (sql.startsWith("INSERT INTO sessions")) {
            sessions.push({ token_hash: st._args[0], user_id: st._args[1], expires_at: st._args[2], revoked_at: null });
            return { meta: {} };
          }
          if (sql.startsWith("INSERT INTO login_audit")) {
            audits.push({ tg_id: st._args[0], sukses: st._args[3], at: Math.floor(Date.now() / 1000) });
            return { meta: {} };
          }
          if (sql.startsWith("INSERT INTO auth_codes")) {
            seq += 1;
            codes.push({
              id: seq, tg_id: st._args[0], code_hash: st._args[1], purpose: st._args[2],
              expires_at: st._args[3], used_at: null, attempts: 0,
            });
            return { meta: {} };
          }
          if (sql.startsWith("UPDATE sessions SET revoked_at")) {
            const s = sessions.find((x) => x.token_hash === st._args[1]);
            if (s) s.revoked_at = st._args[0];
            return { meta: {} };
          }
          if (sql.startsWith("UPDATE auth_codes SET attempts")) {
            const c = codes.find((x) => x.id === st._args[1]);
            if (c) {
              c.attempts = (c.attempts as number) + 1;
              (c as Row).used_at = st._args[0];
            }
            return { meta: {} };
          }
          if (sql.startsWith("UPDATE users SET password_hash")) {
            const u = users.find((x) => x.id === st._args[2]);
            if (u) u.password_hash = st._args[0];
            return { meta: {} };
          }
          return { meta: {} };
        },
        async all<T>() {
          if (sql.includes("FROM user_warehouses")) {
            return { results: userWarehouses.filter((w) => w.user_id === st._args[0]) as T[] };
          }
          return { results: [] as T[] };
        },
      };
      return st;
    },
  };
  return db as unknown as D1Database & { data: Record<string, Row[]> };
}

describe("hash/verifikasi password PBKDF2", () => {
  it("hash lalu verifikasi cocok; salah -> false", async () => {
    const h = await hashPassword("rahasia123");
    assert.match(h, /^pbkdf2\$100000\$/);
    assert.equal(await verifikasiPassword("rahasia123", h), true);
    assert.equal(await verifikasiPassword("salah", h), false);
    assert.equal(await verifikasiPassword("x", "format-salah"), false);
  });
});

describe("bootstrap + sesi + cookie", () => {
  it("owner pertama dibuat, sesi valid, logout mencabut", async () => {
    const db = buatDbMock();
    const owner = await bootstrapOwner(db, "12345", "Owner", "pass123");
    assert.equal(owner.role, "owner");
    await assert.rejects(() => bootstrapOwner(db, "999", "Dua", "pass123"), /sudah ada/);

    const { token } = await buatSesi(db, owner.id, "1.2.3.4", "ua");
    const sesi = await verifikasiSesi(db, token);
    assert.ok(sesi);
    assert.deepEqual(sesi.scope_gudang, [1]);

    const header = atributCookieSesi(token, false);
    assert.ok(header.includes("HttpOnly"));
    assert.equal(ambilTokenDariCookie(`${NAMA_COOKIE_SESI}=${token}; lain=1`), token);

    await cabutSesi(db, token);
    assert.equal(await verifikasiSesi(db, token), null);
  });
});

describe("rate-limit login", () => {
  it("terkunci setelah 5 gagal dalam 15 menit", async () => {
    const db = buatDbMock();
    const now = Math.floor(Date.now() / 1000);
    assert.equal(await loginTerkunci(db, "777", now), false);
    for (let i = 0; i < 5; i++) {
      const d = buatDbMock();
      // pakai db yang sama: catat 5 gagal
      await db
        .prepare("INSERT INTO login_audit (tg_id, ip, ua, sukses, alasan)")
        .bind("777", null, null, 0, null)
        .run();
      void d;
    }
    assert.equal(await loginTerkunci(db, "777", now), true);
  });
});

describe("OTP reset sekali pakai", () => {
  it("terbit -> verifikasi ok sekali -> kedua ditolak", async () => {
    const db = buatDbMock();
    const { kode } = await terbitkanKode(db, "12345", "reset");
    assert.match(kode, /^[0-9]{6}$/);
    assert.equal(await verifikasiKode(db, "12345", "reset", kode), true);
    assert.equal(await verifikasiKode(db, "12345", "reset", kode), false);
    assert.equal(await verifikasiKode(db, "12345", "reset", "000000"), false);
  });
});

describe("setPassword validasi panjang", () => {
  it("menolak < 6 karakter", async () => {
    const db = buatDbMock();
    await bootstrapOwner(db, "12345", "Owner", "pass123");
    await assert.rejects(() => setPassword(db, 1, "abc"), /minimal 6/);
  });
});
