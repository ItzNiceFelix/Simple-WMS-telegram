// scripts/migrate-firestore-to-d1.mjs
// Migrasi sekali jalan Firestore → D1 Simple-WMS (Fase 1, PRD §4).
// Pakai: GOOGLE_APPLICATION_CREDENTIALS=<service-account.json>
//        node scripts/migrate-firestore-to-d1.mjs [--apply] [--db simple-wms]
//
// TANPA --apply = dry-run: baca Firestore, validasi, cetak ringkasan +
// discrepancy, TANPA tulis D1. DENGAN --apply = tulis via batch D1 chunk 100.
// Prinsip PRD E4: discrepancy = LAPORAN, jangan auto-timpa.
import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const DB = (process.argv.find((a) => a.startsWith("--db=")) || "--db=simple-wms").slice(5);

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("[migrasi] Set GOOGLE_APPLICATION_CREDENTIALS ke service-account.json Firestore.");
  process.exit(2);
}

const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { readFileSync } = await import("node:fs");

initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const fs = getFirestore();

const keEpoch = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return Math.floor(v > 1e12 ? v / 1000 : v);
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  }
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  if (typeof v.toDate === "function") return Math.floor(v.toDate().getTime() / 1000);
  return null;
};
const keTeks = (v) => (v == null ? null : String(v));
const keBool = (v) => (v === true ? 1 : 0);

function normalisasiQty(data) {
  const out = {};
  const map = data?.qty_per_gudang;
  if (map && typeof map === "object") {
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  }
  const legacy = typeof data?.stok_gudang_online === "number" ? data.stok_gudang_online : 0;
  return { ONLINE: legacy };
}

async function semuaDok(koleksi) {
  const snap = await fs.collection(koleksi).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function wrangler(sql, params) {
  // Tulis via wrangler d1 execute --command dengan binding positional JSON.
  const cmd = ["d1", "execute", DB, "--remote", "--command", sql];
  if (params) cmd.push("--json");
  return execFileSync("npx", ["wrangler", ...cmd], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const stmts = [];
const q = (sql, ...args) => stmts.push(
  sql.replace(/\?/g, () => {
    const a = args.shift();
    if (a == null) return "NULL";
    if (typeof a === "number") return String(a);
    return `'${String(a).replace(/'/g, "''")}'`;
  })
);
const laporkan = [];
const catat = (koleksi, id, masalah) => laporkan.push({ koleksi, id, masalah });

// ── gudang ──
const gudang = await semuaDok("gudang");
const gudangAda = new Set(["ONLINE"]);
for (const g of gudang) {
  gudangAda.add(String(g.id ?? g.gudang_id));
  q(`INSERT OR IGNORE INTO warehouses (id, code, nama, aktif, urutan, is_online, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    String(g.id ?? g.gudang_id), String(g.id ?? g.gudang_id), String(g.nama ?? g.id),
    g.aktif === false ? 0 : 1, Number(g.urutan) || 0, 0,
    keEpoch(g.created_at), keTeks(g.created_by), keEpoch(g.updated_at), keTeks(g.updated_by));
}

// ── admins → users + user_warehouses ──
const admins = await semuaDok("admins");
for (const a of admins) {
  const tg = Number(a.id ?? a.telegram_user_id);
  if (!Number.isInteger(tg)) {
    catat("admins", a.id, "tg_id non-numerik, dilewati");
    continue;
  }
  q(`INSERT OR IGNORE INTO users (tg_id, username, display_name, role, active, jabatan, added_at, approved_by,
       role_updated_at, role_updated_by, gudang_updated_at, gudang_updated_by, jabatan_updated_at, jabatan_updated_by)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    tg, keTeks(a.telegram_username), String(a.name ?? ""), ["owner", "admin"].includes(a.role) ? a.role : "guest",
    keTeks(a.jabatan), keEpoch(a.added_at), keTeks(a.approved_by), keEpoch(a.role_updated_at), keTeks(a.role_updated_by),
    keEpoch(a.gudang_updated_at), keTeks(a.gudang_updated_by), keEpoch(a.jabatan_updated_at), keTeks(a.jabatan_updated_by));
  if (a.gudang_id != null && String(a.gudang_id).trim() !== "") {
    const gid = String(a.gudang_id);
    if (!gudangAda.has(gid)) catat("admins", a.id, `gudang_id ${gid} tak ada di master`);
    else q(`INSERT OR IGNORE INTO user_warehouses (user_id, warehouse_id)
            VALUES ((SELECT id FROM users WHERE tg_id = ?), ?)`, tg, gid);
  }
}

// ── products + stock + stock_by_bin + OPENING ──
const products = await semuaDok("products");
const stock = await semuaDok("stock");
const stockMap = new Map(stock.map((s) => [s.id ?? s.kode_barang, s]));
for (const p of products) {
  const sku = String(p.id ?? p.kode_barang);
  q(`INSERT OR IGNORE INTO products (sku, nama_accurate, nama_accurate_normalized, hpp, hpp_baru,
       is_online_product, online_updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sku, String(p.nama_accurate ?? sku), String(p.nama_accurate ?? sku).toLowerCase(),
    p.hpp ?? null, p.hpp_baru ?? null, keBool(p.is_online_product),
    keTeks(p.online_updated_by), keEpoch(p.updated_at));
  for (const v of Array.isArray(p.variants) ? p.variants : []) {
    if (v?.variasi) q(`INSERT OR IGNORE INTO product_variants (sku, variasi) VALUES (?, ?)`, sku, String(v.variasi));
    if (v?.nama_shopee) {
      q(`INSERT INTO mp_products (sku, marketplace, nama_mp) VALUES (?, 'shopee', ?)`, sku, String(v.nama_shopee));
    }
  }
  const kw = new Set();
  for (const k of Array.isArray(p.search_keywords) ? p.search_keywords : []) {
    const norm = String(k).trim().toLowerCase();
    if (norm && !kw.has(norm)) {
      kw.add(norm);
      q(`INSERT OR IGNORE INTO product_search_keywords (sku, keyword) VALUES (?, ?)`, sku, norm);
    }
  }
  const s = stockMap.get(sku);
  if (!s) {
    catat("products", sku, "tanpa dokumen stock (tanpa baris stock_by_bin)");
    continue;
  }
  const map = normalisasiQty(s);
  for (const [gid, qty] of Object.entries(map)) {
    if (!gudangAda.has(gid)) {
      catat("stock", sku, `key gudang ${gid} tak ada di master, dilewati`);
      continue;
    }
    q(`INSERT OR REPLACE INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?)`, sku, gid, qty);
    q(`INSERT INTO stock_moves (sku, qty, jenis, gudang_id, source, status, at, by)
       VALUES (?, ?, 'OPENING', ?, 'sync', 'processed', ?, 'migrasi')`,
      sku, qty, gid, keEpoch(s.last_updated) ?? Math.floor(Date.now() / 1000));
  }
  q(`UPDATE products SET stok_min = ?, last_stock_updated = ?, last_stock_updated_by = ?,
       last_synced_at = ?, last_synced_value = ? WHERE sku = ?`,
    s.reorder_point ?? null, keEpoch(s.last_updated), keTeks(s.last_updated_by),
    keEpoch(s.last_synced_at), s.last_synced_value ?? null, sku);
}
for (const s of stock) {
  const sku = String(s.id ?? s.kode_barang);
  if (!products.some((p) => String(p.id ?? p.kode_barang) === sku)) {
    catat("stock", sku, "tanpa dokumen products (orphan)");
  }
}

// ── stock_movements → stock_moves ──
const moves = await semuaDok("stock_movements");
for (const m of moves) {
  q(`INSERT OR IGNORE INTO stock_moves (ref_client_id, sku, nama_terbaca, variasi, qty, jenis, gudang_id,
       action_type, qty_sistem, qty_fisik, selisih, penanda, catatan, source, status,
       created_by, created_by_username, created_by_name, requested_by, requested_by_username,
       requested_by_name, confirmed_by, resolved_by, at, by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    keTeks(m.id_movement), String(m.kode_barang ?? ""), keTeks(m.nama_terbaca), keTeks(m.variasi),
    m.qty ?? null, m.type ?? "koreksi_manual",
    m.gudang_id ? String(m.gudang_id) : null, keTeks(m.action_type),
    m.qty_sistem ?? null, m.qty_fisik ?? null, m.selisih ?? null,
    keTeks(m.penanda), keTeks(m.catatan), m.source ?? "manual_chat", m.status ?? "processed",
    keTeks(m.created_by), keTeks(m.created_by_username), keTeks(m.created_by_name),
    keTeks(m.requested_by), keTeks(m.requested_by_username), keTeks(m.requested_by_name),
    keTeks(m.confirmed_by), keTeks(m.resolved_by),
    keEpoch(m.created_at) ?? Math.floor(Date.now() / 1000), keTeks(m.created_by));
}

// ── keyword_notes (dedup case-insensitive) ──
const kws = await semuaDok("keyword_notes");
const kwLihat = new Map();
for (const k of kws) {
  const norm = String(k.raw_text ?? "").trim().toLowerCase();
  if (!norm) continue;
  const ada = kwLihat.get(norm);
  if (!ada) kwLihat.set(norm, k);
  else {
    ada.usage_count = (ada.usage_count || 1) + (k.usage_count || 1);
    if (k.confidence === "confirmed") {
      ada.confidence = "confirmed";
      ada.interpreted_as = k.interpreted_as;
    }
    catat("keyword_notes", k.id, `duplikat case-insensitive dari '${ada.raw_text}', digabung`);
  }
}
for (const k of kwLihat.values()) {
  q(`INSERT OR IGNORE INTO keyword_notes (raw_text, interpreted_as, confidence, usage_count,
       first_seen, last_used, confirmed_by, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    String(k.raw_text).trim(), k.interpreted_as ?? "MINTA", k.confidence ?? "guessed",
    k.usage_count ?? 1, keEpoch(k.first_seen), keEpoch(k.last_used),
    keTeks(k.confirmed_by), keEpoch(k.confirmed_at));
}

// ── access_requests ──
for (const a of await semuaDok("access_requests")) {
  const tg = Number(a.id ?? a.telegram_user_id);
  if (!Number.isInteger(tg)) {
    catat("access_requests", a.id, "tg_id non-numerik, dilewati");
    continue;
  }
  q(`INSERT OR REPLACE INTO access_requests (tg_id, status, requested_at, telegram_username,
       telegram_display_name, rejected_until, resolved_by, resolved_at, revoked_by, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    tg, a.status ?? "pending", keEpoch(a.requested_at), keTeks(a.telegram_username),
    keTeks(a.telegram_display_name), keEpoch(a.rejected_until), keTeks(a.resolved_by),
    keEpoch(a.resolved_at), keTeks(a.revoked_by), keEpoch(a.revoked_at));
}

// ── sessions (bot) → bot_sessions ──
for (const s of await semuaDok("sessions")) {
  const tg = Number(s.id ?? s.telegram_user_id);
  if (!Number.isInteger(tg)) continue;
  const hist = Array.isArray(s.history) ? s.history.slice(-10).map((h) => ({
    role: h.role, content: String(h.content ?? "").slice(0, 2000), ts: keEpoch(h.ts),
  })) : [];
  const pend = (f) => (s[f] == null ? null : JSON.stringify(s[f]).slice(0, 20000));
  q(`INSERT OR REPLACE INTO bot_sessions (tg_id, history_json, last_updated, pending_action_json,
       pending_batch_action_json, pending_opname_json, pending_picking_list_json,
       pending_sync_stok_json, pending_konfirmasi_cakupan_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    tg, JSON.stringify(hist), keEpoch(s.last_updated), pend("pendingAction"),
    pend("pendingBatchAction"), pend("pendingOpname"), pend("pendingPickingList"),
    pend("pendingSyncStok"), pend("pendingKonfirmasiCakupan"));
}

// ── product_changes + admin_role_changes ──
for (const c of await semuaDok("product_changes")) {
  q(`INSERT INTO product_changes (sku, field, lama, baru, oleh, at) VALUES (?, ?, ?, ?, ?, ?)`,
    String(c.sku ?? c.kode_barang ?? ""), String(c.field ?? ""), keTeks(c.lama),
    keTeks(c.baru), keTeks(c.oleh), keEpoch(c.at) ?? Math.floor(Date.now() / 1000));
}
for (const c of await semuaDok("admin_role_changes")) {
  q(`INSERT INTO admin_role_changes (tg_id, role_lama, role_baru, catatan, oleh, at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    keTeks(c.tg_id ?? c.telegram_user_id), keTeks(c.role_lama), keTeks(c.role_baru),
    keTeks(c.catatan), keTeks(c.oleh), keEpoch(c.at) ?? Math.floor(Date.now() / 1000));
}

// Koleksi dokumen-kompleks (permintaan_gudang, opname_gudang, daily_requests):
// dimigrasi di skrip bagian 2 setelah lib/d1 stabil (struktur tujuan[]/items[]
// butuh logika gabung duplikat + fallback items dokumen — lihat mapping).
// Sengaja TIDAK di-inline di sini agar tidak setengah jadi.

console.log(`[migrasi] koleksi: gudang=${gudang.length} admins=${admins.length} products=${products.length} stock=${stock.length} moves=${moves.length}`);
console.log(`[migrasi] statement D1: ${stmts.length}, discrepancy: ${laporkan.length}`);
for (const l of laporkan.slice(0, 50)) console.log(`  ! ${l.koleksi}/${l.id}: ${l.masalah}`);
if (laporkan.length > 50) console.log(`  ... +${laporkan.length - 50} lagi`);

if (!APPLY) {
  console.log("[migrasi] DRY-RUN selesai. Tambah --apply untuk tulis ke D1.");
  process.exit(0);
}

const CHUNK = 100;
for (let i = 0; i < stmts.length; i += CHUNK) {
  const batch = stmts.slice(i, i + CHUNK).join(";\n");
  wrangler(`BEGIN;\n${batch};\nCOMMIT;`);
  console.log(`[migrasi] batch ${i / CHUNK + 1}/${Math.ceil(stmts.length / CHUNK)} ok`);
}
console.log("[migrasi] SELESAI. Jalankan verifikasi count per tabel.");
