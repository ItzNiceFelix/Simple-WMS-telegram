// lib/d1/akses.test.ts — Approve resmikan users (anti-nyangkut); tolak cooldown; CAS pending.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mintaAkses, putuskanAkses } from "./akses";

type Row = Record<string, unknown>;

function buatDbAkses() {
  const reqs: Record<string, Row> = {};
  const users: Record<string, Row> = {};
  const db = {
    data: { reqs, users },
    prepare(sql: string) {
      const st = {
        _args: [] as unknown[],
        bind(...a: unknown[]) {
          st._args = a;
          return st;
        },
        async first(): Promise<unknown> {
          const a = st._args;
          if (sql.includes("FROM access_requests WHERE tg_id")) {
            const r = reqs[String(a[0])];
            if (!r) return null;
            if (sql.includes("AND status = 'pending'") && r["status"] !== "pending") return null;
            return r;
          }
          return null;
        },
        async run() {
          const a = st._args;
          if (sql.startsWith("INSERT INTO access_requests")) {
            const id = String(a[0]);
            reqs[id] = { tg_id: Number(id), status: "pending", requested_at: a[1], telegram_username: a[2], telegram_display_name: a[3] };
            return { meta: {} };
          }
          if (sql.startsWith("UPDATE access_requests SET status")) {
            const id = String(a[a.length - 1]);
            const r = reqs[id];
            if (!r || r["status"] !== "pending") return { meta: { changes: 0 } };
            if (sql.includes("'approved'")) {
              r["status"] = "approved";
              r["resolved_by"] = a[0];
              r["resolved_at"] = a[1];
              r["rejected_until"] = null;
            } else {
              r["status"] = "rejected";
              r["resolved_by"] = a[0];
              r["resolved_at"] = a[1];
              r["rejected_until"] = a[2];
            }
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO users")) {
            const id = String(a[0]);
            users[id] = { tg_id: id, username: a[1], display_name: a[2], role: "guest", active: 1, approved_by: a[5] };
            return { meta: {} };
          }
          return { meta: {} };
        },
        async all(): Promise<{ results: Row[] }> {
          return { results: [] };
        },
      };
      return st;
    },
  };
  return db as unknown as D1Database;
}

describe("putuskanAkses", () => {
  it("approve buat baris users guest (anti-nyangkut)", async () => {
    const db = buatDbAkses();
    const m = await mintaAkses(db, 111, "budi", "Budi");
    assert.equal(m.ok, true);
    const h = await putuskanAkses(db, 111, true, "1");
    assert.equal(h.ok, true);
    const u = (db as unknown as { data: { users: Record<string, Row> } }).data.users["111"];
    assert.ok(u, "users harus ada setelah approve");
    assert.equal(u["role"], "guest");
    assert.equal(u["display_name"], "Budi");
    // Approve kedua = CAS tolak
    const h2 = await putuskanAkses(db, 111, true, "1");
    assert.equal(h2.ok, false);
  });

  it("tolak set cooldown; minta lagi dalam cooldown = 429", async () => {
    const db = buatDbAkses();
    await mintaAkses(db, 222, null, "Ani");
    const h = await putuskanAkses(db, 222, false, "1");
    assert.equal(h.ok, true);
    const lagi = await mintaAkses(db, 222, null, "Ani");
    assert.equal(lagi.ok, false);
    assert.equal((lagi as { status: number }).status, 429);
  });

  it("approve tanpa request = 409", async () => {
    const db = buatDbAkses();
    const h = await putuskanAkses(db, 999, true, "1");
    assert.equal(h.ok, false);
  });
});
