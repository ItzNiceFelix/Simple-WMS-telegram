// worker/notify.test.ts — node:test untuk notify queue (Fase 2).
// Mock D1 minimal + stub fetch Bot API via global.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { antreNotifikasi, drainQueue } from "./notify";
import type { Env } from "./api";

type Row = Record<string, unknown>;

function buatDbMock() {
  const queue: Row[] = [];
  const users: Row[] = [{ tg_id: 111, notify_problem: 1, active: 1 }];
  const groups: Row[] = [];
  let seq = 0;
  const db = {
    data: { queue, users, groups },
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...a: unknown[]) {
          st._args = a;
          return st;
        },
        async first<T>() {
          return null as T;
        },
        async run() {
          if (st._sql.startsWith("INSERT INTO notify_queue")) {
            seq += 1;
            queue.push({ id: seq, kind: st._args[0], payload: st._args[1], target_user: st._args[2] ?? null, target_group: st._args[3] ?? null, sent_at: null, attempts: 0 });
            return { meta: {} };
          }
          if (st._sql.startsWith("UPDATE notify_queue SET sent_at")) {
            const q = queue.find((x) => x.id === st._args[1]);
            if (q) q.sent_at = st._args[0];
            return { meta: {} };
          }
          if (st._sql.startsWith("UPDATE notify_queue SET attempts")) {
            const q = queue.find((x) => x.id === (st._args.length === 3 ? st._args[2] : st._args[1]));
            if (q) {
              if (st._sql.includes("attempts = attempts + 1")) q.attempts = (q.attempts as number) + 1;
              else q.attempts = st._args[0];
            }
            return { meta: {} };
          }
          if (st._sql.startsWith("UPDATE groups SET chat_id")) {
            const g = groups.find((x) => x.chat_id === st._args[1]);
            if (g) {
              g.chat_id = st._args[0];
              g.chat_type = "supergroup";
              g.last_error = null;
            }
            return { meta: {} };
          }
          if (st._sql.startsWith("UPDATE notify_queue SET target_group")) {
            for (const q of queue) if (q.target_group === st._args[1] && q.sent_at == null) q.target_group = st._args[0];
            return { meta: {} };
          }
          if (st._sql.startsWith("DELETE FROM notify_queue")) {
            const i = queue.findIndex((x) => x.id === st._args[0]);
            if (i >= 0) queue.splice(i, 1);
            return { meta: {} };
          }
          if (st._sql.startsWith("DELETE FROM groups")) {
            const chat = st._args[0];
            const cocok = groups.filter((x) => x.chat_id === chat).map((x) => x.id as number);
            if (cocok.length > 1) {
              const min = Math.min(...cocok);
              for (let i = groups.length - 1; i >= 0; i--) if (groups[i].chat_id === chat && groups[i].id !== min) groups.splice(i, 1);
            }
            return { meta: {} };
          }
          if (st._sql.startsWith("UPDATE groups SET status")) {
            const g = groups.find((x) => x.chat_id === st._args[1]);
            if (g) {
              g.status = "left";
              g.last_error = st._args[0];
            }
            return { meta: {} };
          }
          return { meta: {} };
        },
        async all<T>() {
          if (st._sql.includes("FROM users WHERE notify_problem")) {
            return { results: users as T[] };
          }
          if (st._sql.includes("FROM groups WHERE")) {
            return { results: groups as T[] };
          }
          if (st._sql.includes("FROM notify_queue WHERE sent_at IS NULL")) {
            return { results: queue.filter((q) => q.sent_at == null && (q.attempts as number) < 5).slice(0, 25) as T[] };
          }
          return { results: [] as T[] };
        },
      };
      return st;
    },
    async batch(stmts: { _sql: string; _args: unknown[] }[]) {
      for (const s of stmts) await this.prepare(s._sql).bind(...s._args).run();
      return [];
    },
  };
  return db as unknown as D1Database & { data: Record<string, Row[]> };
}

describe("notify queue + drain", () => {
  it("antre + drain terkirim + tandai sent_at", async () => {
    const terkirim: string[] = [];
    const fetchAsli = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async () => {
      terkirim.push("ok");
      return { ok: true } as Response;
    };
    try {
      const db = buatDbMock();
      const env = { DB: db, TELEGRAM_BOT_TOKEN: "x" } as unknown as Env;
      await antreNotifikasi(env.DB, "info", "halo", 111);
      assert.equal(db.data.queue.length, 1);
      const h = await drainQueue(env);
      assert.equal(h.terkirim, 1);
      assert.equal(h.gagal, 0);
      assert.ok(db.data.queue[0].sent_at != null);
    } finally {
      globalThis.fetch = fetchAsli;
    }
  });

  it("gagal kirim → attempts+1, tidak hangus", async () => {
    const fetchAsli = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async () => ({ ok: false, status: 400, text: async () => "Bad Request: chat not found" }) as Response;
    try {
      const db = buatDbMock();
      const env = { DB: db, TELEGRAM_BOT_TOKEN: "x" } as unknown as Env;
      await antreNotifikasi(env.DB, "info", "halo", 999);
      const h = await drainQueue(env);
      assert.equal(h.terkirim, 0);
      assert.equal(db.data.queue[0].attempts, 1);
      assert.equal(db.data.queue[0].sent_at, null);
    } finally {
      globalThis.fetch = fetchAsli;
    }
  });

  it("grup upgrade → chat_id pindah + retry terkirim", async () => {
    const fetchAsli = globalThis.fetch;
    let panggil = 0;
    (globalThis as Record<string, unknown>).fetch = async () => {
      panggil += 1;
      if (panggil === 1) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ ok: false, description: "Bad Request: group chat was upgraded to a supergroup chat", parameters: { migrate_to_chat_id: -100456 } }) } as Response;
      }
      return { ok: true } as Response;
    };
    try {
      const db = buatDbMock();
      db.data.groups.push({ id: 1, chat_id: -123, title: "G", chat_type: "group", status: "active" });
      const env = { DB: db, TELEGRAM_BOT_TOKEN: "x" } as unknown as Env;
      await antreNotifikasi(env.DB, "info", "halo", null, -123);
      const h = await drainQueue(env);
      assert.equal(h.terkirim, 1);
      assert.equal(h.gagal, 0);
      assert.equal(db.data.groups[0].chat_id, -100456);
      assert.ok(db.data.queue[0].sent_at != null);
    } finally {
      globalThis.fetch = fetchAsli;
    }
  });
});
