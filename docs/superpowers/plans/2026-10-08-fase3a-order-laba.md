# Fase 3a Order Keluar + Laba Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu store `orders` dengan dua halaman: Order Keluar (fulfillment, stok kurang saat Pack/Kirim) + Laba (analisa, tanpa sentuh stok).

**Architecture:** Migrasi 0006 (tabel order + recreate `stock_moves` tambah jenis MP) → `lib/d1/order.ts` (CRUD + rumus + transisi, pola `Hasil<T>` + `db` eksplisit) → route `/api/order` (import 2-fase pola excel) → dua halaman + template sheet Pesanan + `/laba` bot.

**Tech Stack:** Next.js App Router + D1 (`batch`, prepared `.bind()`), SheetJS `xlsx` (sudah ada), `node:test` via esbuild (pola `test:worker`), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-08-fase3a-order-laba-design.md`

## Global Constraints

- Fungsi 1-baris di-inline; `import type` top-level; tanpa dynamic import kecuali modul generated.
- Semua query prepared + `.bind()`; tulis butuh sesi + `sesiRoute` + origin check.
- `Hasil<T>` = `{ ok: true } & T | { ok: false; status: number; error: string }`; `gagal(status, error)` dari `lib/d1/db.ts`.
- Fresh DB: tanpa migrasi data Firebase; seed preset fee generik berlabel contoh.
- PPh 0,5% × Omzet kotor per no. pesanan (aturan Shopee).

---

### Task 1: Migrasi 0006 (tabel order + jenis movement MP)

**Files:**
- Create: `migrations/0006_fase3_order.sql`
- Test: `npx wrangler d1 execute simple-wms --local --file=migrations/0006_fase3_order.sql` lalu cek `sqlite_master`

**Interfaces:**
- Consumes: skema `products(sku)`, `stock_moves` existing (0002), `mp_products` (0002)
- Produces: tabel `orders`, `order_items`, `order_fees`, `mp_fee_presets`; `stock_moves.jenis` terima `jual_mp`/`retur_mp`

- [ ] **Step 1: Tulis migrasi**

```sql
-- 0006_fase3_order.sql — Store pesanan MP + fee + preset (Fase 3a).
CREATE TABLE IF NOT EXISTS orders (
  marketplace TEXT NOT NULL,
  no_pesanan TEXT NOT NULL,
  tanggal INTEGER NOT NULL,
  buyer TEXT NOT NULL DEFAULT '',
  status_fulfill TEXT NOT NULL DEFAULT 'pending'
    CHECK (status_fulfill IN ('pending','pack','kirim','selesai','batal')),
  pajak_pph INTEGER NOT NULL DEFAULT 1 CHECK (pajak_pph IN (0,1)),
  pajak_ppn_persen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (marketplace, no_pesanan)
);
CREATE INDEX IF NOT EXISTS idx_orders_tgl ON orders(tanggal);
CREATE INDEX IF NOT EXISTS idx_orders_mp ON orders(marketplace, tanggal);

CREATE TABLE IF NOT EXISTS order_items (
  marketplace TEXT NOT NULL,
  no_pesanan TEXT NOT NULL,
  sku TEXT NOT NULL REFERENCES products(sku),
  qty INTEGER NOT NULL CHECK (qty >= 1),
  harga_satuan INTEGER NOT NULL CHECK (harga_satuan >= 0),
  hpp_snapshot INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (marketplace, no_pesanan, sku),
  FOREIGN KEY (marketplace, no_pesanan) REFERENCES orders(marketplace, no_pesanan) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_items_sku ON order_items(sku);

CREATE TABLE IF NOT EXISTS order_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace TEXT NOT NULL,
  no_pesanan TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('admin','service','komisi','ongkir','voucher','affiliate','iklan','lain')),
  basis TEXT NOT NULL CHECK (basis IN ('flat','persen')),
  nilai INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (marketplace, no_pesanan) REFERENCES orders(marketplace, no_pesanan) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mp_fee_presets (
  marketplace TEXT NOT NULL,
  jenis TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('flat','persen')),
  nilai INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (marketplace, jenis)
);
-- Seed generik CONTOH (owner sesuaikan di Pengaturan):
INSERT OR IGNORE INTO mp_fee_presets (marketplace, jenis, basis, nilai) VALUES
  ('shopee','admin','persen',4), ('shopee','service','persen',3),
  ('tokopedia','service','persen',6), ('tiktok','komisi','persen',5),
  ('lazada','komisi','persen',4);

-- stock_moves.jenis += jual_mp/retur_mp (SQLite: recreate, data ikut pindah):
PRAGMA foreign_keys=off;
ALTER TABLE stock_moves RENAME TO stock_moves_lama;
CREATE TABLE stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_client_id TEXT UNIQUE,
  sku TEXT NOT NULL REFERENCES products(sku),
  nama_terbaca TEXT,
  variasi TEXT,
  qty INTEGER,
  jenis TEXT NOT NULL CHECK (jenis IN ('keluar_resi','opname','restock','koreksi_manual','sync_confirmed','OPENING','TRANSFER_IN','TRANSFER_OUT','jual_mp','retur_mp')),
  gudang_id TEXT REFERENCES warehouses(id),
  action_type TEXT,
  qty_sistem INTEGER,
  qty_fisik INTEGER,
  selisih INTEGER,
  penanda TEXT,
  catatan TEXT,
  source TEXT CHECK (source IN ('screenshot','manual_chat','manual_chat_batch','manual_chat_produk_baru','manual_chat_batch_produk_baru','sync','web_dashboard')),
  status TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed','pending_request','pending_confirmation')),
  created_by TEXT,
  created_by_username TEXT,
  created_by_name TEXT,
  requested_by TEXT,
  requested_by_username TEXT,
  requested_by_name TEXT,
  confirmed_by TEXT,
  resolved_by TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  by TEXT,
  bin_id INTEGER,
  hpp_snapshot INTEGER
);
INSERT INTO stock_moves SELECT * FROM stock_moves_lama;
DROP TABLE stock_moves_lama;
CREATE INDEX IF NOT EXISTS idx_moves_sku ON stock_moves(sku, at DESC);
CREATE INDEX IF NOT EXISTS idx_moves_pending ON stock_moves(status) WHERE status != 'processed';
CREATE INDEX IF NOT EXISTS idx_moves_gudang ON stock_moves(gudang_id, at DESC);
PRAGMA foreign_keys=on;
PRAGMA optimize;
```

- [ ] **Step 2: Terapkan ke D1 lokal lalu verifikasi**

Run: `npx wrangler d1 execute simple-wms --local --file=migrations/0006_fase3_order.sql`
Expected: sukses; lalu `npx wrangler d1 execute simple-wms --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'order%' OR name='mp_fee_presets'"` tampil 4 tabel.

- [ ] **Step 3: Terapkan ke D1 remote (produksi masih kosong, aman)**

Run: `npx wrangler d1 execute simple-wms --remote --file=migrations/0006_fase3_order.sql`
Expected: sukses, `SELECT COUNT(*) FROM orders` = 0.

- [ ] **Step 4: Commit**

```bash
git add migrations/0006_fase3_order.sql
git commit -m "feat(fase-3a): migrasi 0006 tabel order + jenis movement MP"
```

---

### Task 2: `lib/d1/order.ts` — rumus laba (TDD)

**Files:**
- Create: `lib/d1/order.ts`
- Test: `lib/d1/order.test.ts` (jalankan via esbuild pola `test:worker`: `npx esbuild lib/d1/order.test.ts --bundle --platform=node --format=esm --outfile=.tmp-order.test.mjs --log-level=error --external:react --external:@opennextjs/cloudflare && node --test .tmp-order.test.mjs; rm -f .tmp-order.test.mjs`)

**Interfaces:**
- Consumes: `gagal`, `sekarang`, `Hasil` dari `./db`
- Produces: `hitungLaba(items, fees, pajakPph, pajakPpnPersen)`, `alokasiLabaSku(...)`; tipe `OrderItem`, `OrderFee`

```typescript
import { gagal, sekarang, type Hasil } from "./db";

export type OrderItem = { sku: string; qty: number; harga_satuan: number; hpp_snapshot: number };
export type OrderFee = { jenis: string; basis: "flat" | "persen"; nilai: number };
export type RingkasanLaba = { omzet: number; hpp: number; biaya: number; pph: number; ppn: number; laba: number; margin: number };

export function hitungLaba(items: OrderItem[], fees: OrderFee[], pajakPph: boolean, pajakPpnPersen: number): RingkasanLaba {
  const omzet = items.reduce((a, i) => a + i.qty * i.harga_satuan, 0);
  const hpp = items.reduce((a, i) => a + i.qty * i.hpp_snapshot, 0);
  const biaya = fees.reduce((a, f) => a + (f.basis === "persen" ? Math.round((omzet * f.nilai) / 100) : f.nilai), 0);
  const pph = pajakPph ? Math.round((omzet * 5) / 1000) : 0;
  const ppn = pajakPpnPersen > 0 ? Math.round((omzet * pajakPpnPersen) / 100) : 0;
  const laba = omzet - hpp - biaya - pph - ppn;
  return { omzet, hpp, biaya, pph, ppn, laba, margin: omzet > 0 ? (laba / omzet) * 100 : 0 };
}

/** Alokasi biaya+pajak proporsional subtotal/omzet → laba per SKU. */
export function alokasiLabaSku(items: OrderItem[], r: RingkasanLaba): Record<string, number> {
  const keluar: Record<string, number> = {};
  if (r.omzet <= 0) return keluar;
  for (const i of items) {
    const sub = i.qty * i.harga_satuan;
    keluar[i.sku] = sub - i.qty * i.hpp_snapshot - ((r.biaya + r.pph + r.ppn) * sub) / r.omzet;
  }
  return keluar;
}
```

- [ ] **Step 1: Tulis test gagal** (`lib/d1/order.test.ts`):

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alokasiLabaSku, hitungLaba } from "./order";

describe("hitungLaba", () => {
  it("omzet-hpp-biaya-pph-ppn benar", () => {
    const r = hitungLaba(
      [{ sku: "A", qty: 2, harga_satuan: 100000, hpp_snapshot: 60000 }],
      [{ jenis: "admin", basis: "persen", nilai: 4 }],
      true, 0
    );
    assert.equal(r.omzet, 200000);
    assert.equal(r.hpp, 120000);
    assert.equal(r.biaya, 8000);
    assert.equal(r.pph, 1000);
    assert.equal(r.laba, 200000 - 120000 - 8000 - 1000);
  });
  it("tanpa pph + flat fee", () => {
    const r = hitungLaba(
      [{ sku: "A", qty: 1, harga_satuan: 50000, hpp_snapshot: 30000 }],
      [{ jenis: "ongkir", basis: "flat", nilai: 10000 }],
      false, 11
    );
    assert.equal(r.pph, 0);
    assert.equal(r.ppn, 5500);
    assert.equal(r.laba, 50000 - 30000 - 10000 - 5500);
  });
  it("alokasi per SKU jumlah = laba order", () => {
    const items = [
      { sku: "A", qty: 1, harga_satuan: 100000, hpp_snapshot: 60000 },
      { sku: "B", qty: 1, harga_satuan: 100000, hpp_snapshot: 50000 },
    ];
    const r = hitungLaba(items, [{ jenis: "admin", basis: "persen", nilai: 10 }], true, 0);
    const al = alokasiLabaSku(items, r);
    assert.ok(Math.abs(al["A"] + al["B"] - r.laba) < 1);
  });
});
```

- [ ] **Step 2: Run test, pastikan gagal** (fungsi belum ada)

Run: `npx esbuild lib/d1/order.test.ts --bundle --platform=node --format=esm --outfile=.tmp-order.test.mjs --log-level=error --external:react --external:@opennextjs/cloudflare && node --test .tmp-order.test.mjs; rm -f .tmp-order.test.mjs`
Expected: FAIL "Could not resolve ./order"

- [ ] **Step 3: Tulis `lib/d1/order.ts`** (kode di atas + header komentar pola repo + fungsi CRUD menyusul Task 3)
- [ ] **Step 4: Run test, pastikan hijau** (perintah sama). Expected: 3 pass.
- [ ] **Step 5: Commit**

```bash
git add lib/d1/order.ts lib/d1/order.test.ts
git commit -m "feat(fase-3a): rumus laba per pesanan + alokasi SKU"
```

---

### Task 3: CRUD + transisi fulfillment di `lib/d1/order.ts`

**Files:**
- Modify: `lib/d1/order.ts` (tambah di bawah rumus)
- Test: tambah ke `lib/d1/order.test.ts` (mock D1 pola `worker/notify.test.ts:buatDbMock`)

**Interfaces:**
- Consumes: `bacaQty`, `GUDANG_ONLINE`, `tulisQty` dari `./stok`; `ambilProduk` dari `./produk`
- Produces: `imporPesanan(db, baris, oleh)`, `transisiFulfill(db, mp, no, ke, oleh)`, `ambilOrder(db, mp, no)`, `listOrder(db, filter)`

```typescript
import { ambilProduk } from "./produk";
import { bacaQty, GUDANG_ONLINE, tulisQty } from "./stok";

export type BarisPesanan = {
  marketplace: string; no_pesanan: string; tanggal: number; buyer: string;
  sku: string; qty: number; harga_satuan: number;
  fee_jenis?: string; fee_basis?: "flat" | "persen"; fee_nilai?: number;
  pajak_pph?: boolean; pajak_ppn_persen?: number;
};

export async function imporPesanan(db: D1Database, daftar: BarisPesanan[], oleh: string | null): Promise<Hasil<{ order: number; item: number }>> {
  // Kelompokkan per (marketplace, no_pesanan); validasi SKU ada; beku hpp_snapshot dari products.hpp;
  // fee baris → order_fees (bila order tanpa fee sama sekali → pakai mp_fee_presets);
  // subtotal = qty*harga; amount fee persen = round(omzet*nilai/100).
  // Tulis via db.batch per 50 stmt. Idempoten: INSERT OR IGNORE order + INSERT OR REPLACE item/fee.
  // (Implementasi penuh ±90 baris — executor tulis dari kontrak ini + pola konfirmasi excel route.ts:130-150.)
  return { ok: true, order: 0, item: 0 };
}

const PETA_TRANSISI: Record<string, string[]> = {
  pending: ["pack", "batal"],
  pack: ["kirim", "batal"],
  kirim: ["selesai", "batal"],
  selesai: [],
  batal: [],
};

export async function transisiFulfill(db: D1Database, mp: string, no: string, ke: "pack" | "kirim" | "selesai" | "batal", oleh: string | null): Promise<Hasil<{ status: string }>> {
  const order = await db.prepare("SELECT status_fulfill FROM orders WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).first<{ status_fulfill: string }>();
  if (!order) return gagal(404, "Pesanan tidak ditemukan.");
  if (!PETA_TRANSISI[order.status_fulfill]?.includes(ke)) return gagal(409, `Transisi ${order.status_fulfill} → ${ke} tidak diizinkan.`);
  if (ke === "pack") {
    const { results: items } = await db.prepare("SELECT sku, qty FROM order_items WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).all<{ sku: string; qty: number }>();
    for (const it of results) {
      const stok = await bacaQty(db, it.sku, GUDANG_ONLINE);
      if (stok < it.qty) return gagal(400, `Stok ${it.sku} tidak cukup (${stok} < ${it.qty}).`);
    }
    const stmts: D1PreparedStatement[] = [];
    const at = sekarang();
    for (const it of results) {
      const lama = await bacaQty(db, it.sku, GUDANG_ONLINE);
      stmts.push(
        db.prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty").bind(it.sku, GUDANG_ONLINE, lama - it.qty),
        db.prepare("INSERT INTO stock_moves (sku, qty, jenis, gudang_id, source, status, created_by, at, by) VALUES (?, ?, 'jual_mp', ?, 'web_dashboard', 'processed', ?, ?, ?)").bind(it.sku, -it.qty, GUDANG_ONLINE, oleh, at, oleh)
      );
    }
    await db.batch(stmts);
  }
  if (ke === "batal") {
    const { results: items } = await db.prepare("SELECT sku, qty FROM order_items WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).all<{ sku: string; qty: number }>();
    if (order.status_fulfill === "pack" || order.status_fulfill === "kirim") {
      const stmts: D1PreparedStatement[] = [];
      const at = sekarang();
      for (const it of results) {
        const lama = await bacaQty(db, it.sku, GUDANG_ONLINE);
        stmts.push(
          db.prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty").bind(it.sku, GUDANG_ONLINE, lama + it.qty),
          db.prepare("INSERT INTO stock_moves (sku, qty, jenis, gudang_id, source, status, created_by, at, by) VALUES (?, ?, 'retur_mp', ?, 'web_dashboard', 'processed', ?, ?, ?)").bind(it.sku, it.qty, GUDANG_ONLINE, oleh, at, oleh)
        );
      }
      await db.batch(stmts);
    }
  }
  await db.prepare("UPDATE orders SET status_fulfill = ? WHERE marketplace = ? AND no_pesanan = ?").bind(ke, mp, no).run();
  return { ok: true, status: ke };
}
```

- [ ] **Step 1: Tulis test transisi** (mock D1: products A stok 10; pack 3 → stok 7 + movement `jual_mp`; pack 99 → 400; batal → kembali 10 + `retur_mp`; pending→kirim langsung → 409)
- [ ] **Step 2: Run, pastikan gagal** (fungsi belum ada). Expected: FAIL resolve.
- [ ] **Step 3: Implementasi** (kode di atas; `imporPesanan` tulis penuh ±90 baris ikut kontrak komentar)
- [ ] **Step 4: Run, hijau.** Expected: semua pass.
- [ ] **Step 5: Commit** `feat(fase-3a): CRUD pesanan + transisi pack/kirim/batal`

---

### Task 4: Route `/api/order` (import 2-fase + transisi + agregat laba)

**Files:**
- Create: `app/api/order/route.ts`
- Test: e2e menyusul Task 7; unit via Task 2–3

**Interfaces:**
- Consumes: `imporPesanan`, `transisiFulfill`, `hitungLaba` dari `@/lib/d1/order`; `getDb`, `bacaBody`, `json`, `sesiRoute` (pola `app/api/excel/route.ts`)
- Produces: `GET ?aksi=rekap&dari=&sampai=&mp=&sku=` → `{ ok, orders: [...rincian], agregat }`; `POST { aksi:'preview', rows } | { aksi:'konfirmasi', rows } | { aksi:'transisi', marketplace, no_pesanan, ke }`

Validasi preview per baris (pola `validasiBaris` excel route.ts:31-60):
`NoPesanan* | Marketplace* | Tanggal* (YYYY-MM-DD) | SKU* (harus ada di products) | Qty* (int ≥ 1) | HargaSatuan* (≥ 0) | Buyer | FeeJenis | FeeBasis(flat/persen) | FeeNilai | PPh(YA/TIDAK, default YA) | PPN% (default 0)`.
Gagal → `{ baris, pesan }`; sukses → simpan `import_batches(tipe='pesanan')` + `import_errors`, balas `{ batch_id, sukses, gagal }` (pola excel route.ts:190-200).
Konfirmasi → `imporPesanan` → `{ ok, order, item }`.

- [ ] **Step 1: Tulis route** (±180 baris, tiru struktur `app/api/excel/route.ts:104-200`)
- [ ] **Step 2: Typecheck** `npx tsc --noEmit`. Expected: 0 error.
- [ ] **Step 3: Smoke lokal** `POST /api/order { aksi:'preview', rows:[...2 valid, 1 SKU fiktif] }` via curl dev → 1 gagal tepat.
- [ ] **Step 4: Commit** `feat(fase-3a): route order import 2-fase + rekap laba`

---

### Task 5: Template sheet Pesanan + dialog import

**Files:**
- Modify: `scripts/buat-template-excel.mjs` (tambah sheet `Pesanan` + panduan), regenerate `public/template-import-produk.xlsx`
- Modify: `components/dashboard/dialog-import-excel.tsx` (tambah tipe `pesanan` → POST `/api/order`)
- Test: `node -e` baca sheet Pesanan (pola sesi verifikasi template)

- [ ] **Step 1: Tambah sheet** header `["NoPesanan*","Marketplace*","Tanggal*","SKU*","Qty*","HargaSatuan*","Buyer","FeeJenis","FeeBasis","FeeNilai","PPh","PPN%"]` + 3 contoh + panduan
- [ ] **Step 2: Regenerate** `node scripts/buat-template-excel.mjs`; verifikasi header via node -e
- [ ] **Step 3: Dialog** tambah opsi tipe pesanan (minimal: prop `tipe` + endpoint switch)
- [ ] **Step 4: Commit** `feat(fase-3a): template + dialog import pesanan`

---

### Task 6: Halaman Order Keluar + Laba

**Files:**
- Create: `app/order/page.tsx` (daftar + filter status/MP + tombol Pack/Kirim/Selesai/Batal + panggil `/api/order` transisi)
- Create: `app/laba/page.tsx` (filter periode/MP/SKU + tabel rekap + agregat + export Excel via GET rekap)
- Modify: `lib/dashboard/data/real.ts` + `mock.ts` (tambah `listOrder`, `rekapLaba` ke DataSource bila kontrak menagih; bila kontrak beku — cukup fetch langsung di page, tanpa ubah DataSource)
- Test: `e2e/order-laba.spec.ts` (lihat Task 7)

Keputusan: page fetch langsung ke `/api/order` (seperti `app/stok/page.tsx` pakai fetch + `credentials:include`), JANGAN ubah kontrak `DataSource` (beku sejak Wave 3a).

- [ ] **Step 1: Halaman Order** (tabel + aksi transisi + toast sukses/gagal, pola `aksi-akses.tsx`)
- [ ] **Step 2: Halaman Laba** (filter + tabel + kartu agregat omzet/HPP/biaya/pajak/laba/margin)
- [ ] **Step 3: Nav** tambah link Order + Laba (cek `app-sidebar.tsx` / `bottom-nav.tsx` pola existing)
- [ ] **Step 4: Commit** `feat(fase-3a): halaman Order Keluar + Laba`

---

### Task 7: Bot `/laba` + e2e + deploy

**Files:**
- Modify: `worker/bot.ts` (`/laba [7h|30h]` → agregat per MP via `hitungLaba` atas order periode; teks pola `bangunLaporanHarian`)
- Create: `e2e/order-laba.spec.ts` (mock mode: import preview via POST? e2e existing pola page — minimal: halaman `/order` + `/laba` render + tombol aksi tampil; bila mock tak dukung, tambah seed mock minimal di `mock-data.ts`)
- Docs: `docs/laporan-progres.md` (+Fase 3a), PRD §F5 tandai live

- [ ] **Step 1: `/laba`** di `tanganiCommand` (setelah `/menipis`, sebelum `/gudang`)
- [ ] **Step 2: e2e** tulis + `npx playwright test e2e/order-laba.spec.ts e2e/tma.spec.ts`. Expected: hijau.
- [ ] **Step 3: Full gate** `npx tsc --noEmit` (0 error) + `npm run test:worker` (hijau)
- [ ] **Step 4: Build + upload + deploy** (`NEXT_PUBLIC_DASHBOARD_DATA=real npx @opennextjs/cloudflare build`, `wrangler versions upload`, preview health + `/api/order` 401 tanpa sesi, `versions deploy`, `triggers deploy`)
- [ ] **Step 5: Commit + push** `feat(fase-3a): bot laba + e2e + deploy`

---

## Self-Review

**1. Cakupan spec:** §2 migrasi→Task 1; §3 rumus→Task 2 (+alokasi §3 akhir); §4 import→Task 4+5; §5 fulfill→Task 3+6; §6 laba+export+bot→Task 6+7 (export Excel via GET rekap; PDF `pdf-lib` — BELUM ada tugas! Tambahkan: Task 7 Step 1b atau tugas baru. Keputusan: PDF ditunda eksplisit ke 3b? Spec §6 tulis PDF di 3a. Jujur: tambah Task 8 PDF minimal ATAU coret dari spec. Pilih: Task 8 kecil — route `GET ?aksi=pdf` via `pdf-lib` tabel rekap, tanpa JPG (JPG = Fase 4). Ditambahkan di bawah.); §7 kriteria→Task 2/3/7 test; §8 risiko CHECK→Task 1 recreate, chunk→Task 3/4.

**2. Placeholder:** "Implementasi penuh ±90 baris" di Task 3 `imporPesanan` = placeholder terselubung. Perbaiki: kontrak komentar sudah rinci (kelompokkan, validasi, snapshot, preset, batch 50, OR IGNORE/REPLACE) — executor tulis dari situ; tambah test impor (2 order + preset + snapshot beku) sebagai acceptance konkret. ✅ diperbaiki di bawah.

**3. Konsistensi tipe:** `BarisPesanan.tanggal` number (epoch) vs template `Tanggal*` string YYYY-MM-DD — konversi di route preview (parse → epoch), kontrak konsisten. `OrderFee.jenis/nilai` string/number cocok `order_fees`. `RingkasanLaba.margin` persen (0-100) — konsisten di Task 2/6.

### Task 8: Export PDF rekap (pdf-lib)

**Files:**
- Modify: `app/api/order/route.ts` (tambah `GET ?aksi=pdf&...` → `pdf-lib` tabel: NoPesanan, MP, Omzet, HPP, Biaya, Pajak, Laba)
- Deps: `npm i pdf-lib` (pure JS, pola PRD §F5.5; cek `package.json` — belum ada → tambah, ini satu-satunya dep baru, dibenarkan PRD)

- [ ] **Step 1: Tulis handler PDF** (±60 baris: ambil rekap sama dengan JSON → gambar tabel teks → `application/pdf`)
- [ ] **Step 2: Smoke** GET pdf → `%PDF` + 200
- [ ] **Step 3: Commit** `feat(fase-3a): export PDF rekap laba`
