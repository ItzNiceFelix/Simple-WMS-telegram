// test/guardD1.test.js — Urutan guard route D1 (pengganti urutanGuardV5, Fase 1).
// Kontrak: origin -> sesi -> rate-limit -> role -> validasi -> model.
// Memeriksa kode produksi nyata (sesiRoute + lib/d1/route.ts), bukan perilaku mock.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTE_SRC = fs.readFileSync(path.join(__dirname, "..", "lib", "d1", "route.ts"), "utf8");

test("sesiRoute: urutan origin -> sesi -> rate-limit", () => {
  const iOrigin = ROUTE_SRC.indexOf("const origin = tolakOriginD1(request);");
  const iSesi = ROUTE_SRC.indexOf("await requireSession(db, request)");
  const iRate = ROUTE_SRC.indexOf("cekRateLimitD1(`d1:");
  assert.ok(iOrigin >= 0 && iSesi > iOrigin && iRate > iSesi, "urutan origin -> sesi -> rate-limit");
});

test("route tulis: sesiRoute dipanggil SEBELUM validasi body", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "api", "stok", "mutasi", "route.ts"), "utf8");
  const iSesi = src.indexOf("sesiRoute(request");
  const iBody = src.indexOf("bacaBody(request)");
  assert.ok(iSesi >= 0 && iSesi < iBody, "sesiRoute sebelum bacaBody");
});

test("route tulis: guest ditolak sebelum validasi body (is_admin)", () => {
  for (const f of [
    ["stok", "mutasi", "route.ts"],
    ["permintaan-gudang", "route.ts"],
    ["opname-gudang", "route.ts"],
  ]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "app", "api", ...f), "utf8");
    const iGuard = src.indexOf("!user.is_admin");
    const iBody = src.indexOf("bacaBody(request)");
    assert.ok(iGuard >= 0 && iGuard < iBody, `${f.join("/")} menolak guest sebelum bacaBody`);
  }
});

test("D1: index ledger + gudang ada di skema", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "0002_fase1_skema.sql"), "utf8");
  for (const idx of ["idx_moves_sku", "idx_moves_pending", "idx_dest_wh", "idx_sbb_sku", "idx_users_role", "idx_sbb_wh"]) {
    assert.ok(sql.includes(idx), `skema memuat ${idx}`);
  }
});
