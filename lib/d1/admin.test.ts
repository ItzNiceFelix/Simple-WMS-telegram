// lib/d1/admin.test.ts — Tipe bind tg_id & validasi input admin.
//
// KENAPA TEST INI ADA: `users.tg_id` bertipe TEXT di D1. SQLite meng-coerce literal
// (`WHERE tg_id = 1346251915` cocok), TAPI parameter bind bertipe INTEGER TIDAK
// di-coerce terhadap kolom TEXT — hasilnya query selalu 0 baris, sehingga semua aksi
// admin menjawab "User belum terdaftar." walau user ada. Bug ini tak terlihat di
// query manual CLI, hanya lewat bind. Test ini mengunci tipe argumennya.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ambilAdmin, tambahAdmin, ubahNama, ubahRole } from "./admin";

type Row = Record<string, unknown>;

/** DB tiruan yang MEREKAM argumen bind, agar tipe bisa diperiksa. */
function buatDb(users: Row[] = []) {
  const bind: { sql: string; args: unknown[] }[] = [];
  const db = {
    bind,
    users,
    prepare(sql: string) {
      const st = {
        _args: [] as unknown[],
        bind(...a: unknown[]) {
          st._args = a;
          bind.push({ sql, args: a });
          return st;
        },
        async first(): Promise<unknown> {
          // Cocokkan hanya bila tipe argumen SAMA dengan isi kolom (meniru SQLite D1:
          // TEXT vs INTEGER tidak cocok pada bind).
          const target = st._args[0];
          return users.find((u) => u["tg_id"] === target) ?? null;
        },
        async all(): Promise<{ results: Row[] }> {
          const target = st._args[0];
          return { results: users.filter((u) => u["tg_id"] === target) };
        },
        async run() {
          if (sql.startsWith("INSERT INTO users")) {
            users.push({ id: users.length + 1, tg_id: st._args[0], display_name: st._args[1], role: st._args[2], active: 1, username: null });
          }
          return { meta: { changes: 1, last_row_id: users.length } };
        },
      };
      return st;
    },
  };
  return db as unknown as D1Database & { bind: typeof bind; users: Row[] };
}

const USER = { id: 6, tg_id: "1346251915", display_name: "", role: "guest", active: 1, username: null };

describe("admin: tipe bind tg_id", () => {
  it("ambilAdmin meng-bind tg_id sebagai STRING (kolom users.tg_id TEXT)", async () => {
    const db = buatDb([USER]);
    const hasil = await ambilAdmin(db, "1346251915");
    assert.ok(hasil, "user harus ketemu — kalau null, tg_id di-bind sebagai number");
    const q = db.bind.find((b) => b.sql.includes("FROM users u WHERE u.tg_id = ?"));
    assert.equal(typeof q?.args[0], "string", `tg_id harus string, dapat ${typeof q?.args[0]}`);
  });

  it("ambilAdmin menemukan user walau diberi number (dikonversi internal ke string)", async () => {
    const db = buatDb([USER]);
    assert.ok(await ambilAdmin(db, 1346251915));
  });

  it("ambilAdmin null untuk user tidak ada (bukan crash)", async () => {
    const db = buatDb([USER]);
    assert.equal(await ambilAdmin(db, "999999999"), null);
  });

  it("ubahRole meng-bind tg_id sebagai string di UPDATE", async () => {
    const db = buatDb([USER]);
    await ubahRole(db, "1346251915", "admin", "1817932703");
    const upd = db.bind.find((b) => b.sql.startsWith("UPDATE users SET role"));
    assert.equal(typeof upd?.args[3], "string", `tg_id UPDATE harus string, dapat ${typeof upd?.args[3]}`);
  });

  it("ubahNama meng-bind tg_id sebagai string di UPDATE", async () => {
    const db = buatDb([USER]);
    await ubahNama(db, "1346251915", "Bagus", "1817932703");
    const upd = db.bind.find((b) => b.sql.startsWith("UPDATE users SET display_name"));
    assert.equal(typeof upd?.args[1], "string", `tg_id UPDATE harus string, dapat ${typeof upd?.args[1]}`);
  });

  it("owner terakhir tidak bisa didemosi (guard tetap jalan)", async () => {
    const db = buatDb([{ ...USER, role: "owner" }]);
    const h = await ubahRole(db, "1346251915", "guest", "1817932703");
    assert.equal(h.ok, false);
    if (h.ok) return;
    assert.match(h.error, /[Oo]wner terakhir/);
  });
});

describe("admin: validasi input", () => {
  it("tambahAdmin menerima telegramId numerik (dulu selalu gagal: Number.isInteger(string))", async () => {
    const db = buatDb([]);
    const h = await tambahAdmin(db, "123456789", "Budi", "guest", "1817932703");
    assert.equal(h.ok, true, h.ok ? "" : h.error);
  });

  it("tambahAdmin menolak telegramId bukan angka", async () => {
    const db = buatDb([]);
    const h = await tambahAdmin(db, "bukan-angka", "Budi", "guest", "1817932703");
    assert.equal(h.ok, false);
  });

  it("tambahAdmin menolak role di luar daftar", async () => {
    const db = buatDb([]);
    const h = await tambahAdmin(db, "123456789", "Budi", "superadmin", "1817932703");
    assert.equal(h.ok, false);
  });

  it("ubahNama menolak nama kosong", async () => {
    const db = buatDb([USER]);
    const h = await ubahNama(db, "1346251915", "   ", "1817932703");
    assert.equal(h.ok, false);
  });
});
