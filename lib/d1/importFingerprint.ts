// lib/d1/importFingerprint.ts — Anti-dobel file impor (B1).
// Fingerprint = sha256 atas baris ternormalisasi + nama file, sehingga urutan baris
// tidak mengubah hasil (baris diurut dulu). WebCrypto tersedia di Cloudflare Workers.
import { sekarang } from "./db";
import type { ShopeeAdvanceRow, ShopeeOrderRow } from "./orderImportShopee";

export type TipeImport = "orders_toship" | "advance" | "pesanan_lain";

export type ImportFileRow = {
  id: number;
  tipe: string;
  file: string;
  file_hash: string;
  no_json: string;
  batch_id: number | null;
  at: number;
  by: string | null;
};

/** Serialisasi nilai kanvas: primitif di-trim; objek/array di-JSON-kan (kunci diurut)
 *  supaya dua struktur berbeda tidak bertabrakan jadi "[object Object]". */
function nilaiKanvas(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return JSON.stringify(Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => (void (acc[k] = o[k]), acc), {}));
  }
  return String(v).trim();
}

/** Baris ternormalisasi-urut: nilai di-string-kan, kolom kosong dibuang, baris diurut leksikografis. */
function barisKanvas(rows: Record<string, unknown>[]): string {
  const siap = rows.map((r) =>
    Object.keys(r)
      .sort()
      .filter((k) => nilaiKanvas(r[k]) !== "")
      .map((k) => `${k}=${nilaiKanvas(r[k])}`)
      .join("\u001f"),
  );
  siap.sort();
  return siap.join("\u001e");
}

/** sha256 heksadesimal atas baris ternormalisasi-urut + nama file. */
export async function hitungFingerprint(rows: (ShopeeOrderRow | ShopeeAdvanceRow)[], file: string): Promise<string> {
  const kanvas = `${file}\u001d${barisKanvas(rows)}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(kanvas));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Baris `import_files` untuk (tipe, hash) atau null. */
export async function cekFileSudahAda(db: D1Database, tipe: TipeImport, hash: string): Promise<ImportFileRow | null> {
  return db
    .prepare("SELECT id, tipe, file, file_hash, no_json, batch_id, at, by FROM import_files WHERE tipe = ? AND file_hash = ?")
    .bind(tipe, hash)
    .first<ImportFileRow>();
}

export type CatatImport = {
  tipe: TipeImport;
  file: string;
  hash: string;
  no_json: string[];
  batch_id?: number | null;
  by?: string | null;
};

/** Catat file impor (idempoten via UNIQUE(tipe, file_hash)); kembalikan id baris. */
export async function catatImportFile(db: D1Database, data: CatatImport): Promise<number> {
  const ins = await db
    .prepare("INSERT INTO import_files (tipe, file, file_hash, no_json, batch_id, at, by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tipe, file_hash) DO NOTHING")
    .bind(data.tipe, data.file, data.hash, JSON.stringify(data.no_json), data.batch_id ?? null, sekarang(), data.by ?? null)
    .run();
  const id = Number(ins.meta.last_row_id);
  if (id > 0) return id;
  const lama = await cekFileSudahAda(db, data.tipe, data.hash);
  return lama ? lama.id : 0;
}
