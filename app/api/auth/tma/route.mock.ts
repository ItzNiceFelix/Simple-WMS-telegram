// app/api/auth/tma/route.mock.ts — mock D1 bersama untuk route.test.ts
// dan harness alias esbuild (lihat package.json test:worker). File .ts biasa
// (bukan .test.ts) supaya tak dijalankan node:test dan bisa di-import alias.
export type Row = Record<string, unknown>;

/** Mock D1 minimal pola worker/auth.test.ts: prepare(sql).bind(...).first()/run()/all(). */
export function buatDbMock(users: Row[]) {
  const sessions: Row[] = [];
  const audits: Row[] = [];
  let seq = 0;
  const stmt = (sql: string, args: unknown[]) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    async first<T>(): Promise<T | null> {
      if (sql.includes("FROM users WHERE tg_id")) {
        const u = users.find((x) => x.tg_id === args[0] && x.active === 1);
        return (u ?? null) as T | null;
      }
      return null;
    },
    async run() {
      if (sql.includes("INSERT INTO sessions")) {
        sessions.push({
          token_hash: args[0], user_id: args[1], expires_at: args[2], ip: args[3], ua: args[4],
          revoked_at: null, id: ++seq,
        });
      } else if (sql.includes("INSERT INTO login_audit")) {
        audits.push({ tg_id: args[0], ip: args[1], ua: args[2], sukses: args[3], alasan: args[4] });
      }
      return { success: true, meta: { last_row_id: seq } };
    },
    async all<T>() { return { results: [] as T[] }; },
  });
  return { db: { prepare: (sql: string) => stmt(sql, []) }, sessions, audits };
}

