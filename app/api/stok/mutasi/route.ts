// app/api/stok/mutasi/route.ts
// POST /api/stok/mutasi — koreksi stok via server (PRD Bagian 13, 24).
// WAJIB: satu pintu ke lib/models/stok.js + audit stock_movements.
// Stok negatif = FITUR (keputusan owner I1): tidak ada guard tolak-negatif.
import { createRequire } from "node:module";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

const { verifikasiTokenSesi, ambilTokenDariCookie } = require("../../../../lib/dashboard/auth/sesi.js") as {
  verifikasiTokenSesi: (t: string, o: { now: number }) => { uid: string; role: string } | null;
  ambilTokenDariCookie: (c: string | null) => string | null;
};
const { tolakOrigin, cekRateLimit } = require("../../../../lib/dashboard/auth/guard.js") as {
  tolakOrigin: (r: Request) => { ok: true } | { ok: false; status: number; error: string };
  cekRateLimit: (k: string, maks: number) => { ok: true } | { ok: false; status: number; error: string };
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

type MutasiMode = "tambah" | "kurangi" | "timpa";

const MODE_VALID: MutasiMode[] = ["tambah", "kurangi", "timpa"];

/** Validasi qty per mode (PRD 13.1 / E6). */
function validasiQty(mode: MutasiMode, qty: unknown): { ok: true; qty: number } | { ok: false; error: string } {
  if (typeof qty !== "number" || !Number.isInteger(qty)) {
    return {
      ok: false,
      error:
        mode === "timpa"
          ? "Jumlah fisik harus bilangan bulat >= 0."
          : "Jumlah harus bilangan bulat >= 1.",
    };
  }
  if (mode === "timpa" && qty < 0) {
    return { ok: false, error: "Jumlah fisik harus bilangan bulat >= 0." };
  }
  if (mode !== "timpa" && qty < 1) {
    return { ok: false, error: "Jumlah harus bilangan bulat >= 1." };
  }
  return { ok: true, qty };
}

export async function POST(request: Request) {
  const origin = tolakOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);

  // Sesi (PRD 11.4): cookie -> sesi; role dari sesi, BUKAN body.
  const token = ambilTokenDariCookie(request.headers.get("cookie"));
  const sesi = token ? verifikasiTokenSesi(token, { now: Date.now() }) : null;
  if (!sesi) {
    return json({ ok: false, error: "Sesi kedaluwarsa. Buka ulang dari Telegram." }, 401);
  }

  const batas = cekRateLimit(`mutasi:${sesi.uid}`, 20);
  if (!batas.ok) {
    console.warn("[stock_write_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  let body: { kode_barang?: unknown; mode?: unknown; qty?: unknown; catatan?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const kodeBarang = typeof body.kode_barang === "string" ? body.kode_barang.trim() : "";
  const mode = body.mode as MutasiMode;
  if (!kodeBarang) return json({ ok: false, error: "Kode barang wajib diisi." }, 400);
  if (!MODE_VALID.includes(mode)) return json({ ok: false, error: "Mode tidak dikenal." }, 400);

  const qtyValid = validasiQty(mode, body.qty);
  if (!qtyValid.ok) {
    console.warn("[stock_write_reject]", JSON.stringify({ uid: sesi.uid, alasan: "qty" }));
    return json({ ok: false, error: qtyValid.error }, 400);
  }
  const qty = qtyValid.qty;
  const catatan = typeof body.catatan === "string" && body.catatan.trim() ? body.catatan.trim() : null;

  // Role ditegakkan server-side (PRD 11.4) — ambil ulang dari admins, bukan sesi.
  let role = "guest";
  try {
    const { ambilAdmin } = require("../../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" || admin.role === "admin" ? admin.role : "guest";
  } catch (e) {
    console.error("[stock_write_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }
  if (role === "guest") {
    console.warn("[stock_write_reject]", JSON.stringify({ uid: sesi.uid, alasan: "guest" }));
    return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  }

  const { ambilProdukByKode } = require("../../../../lib/models/produk.js") as {
    ambilProdukByKode: (k: string) => Promise<{ kode_barang: string; nama_accurate: string } | null>;
  };
  const produk = await ambilProdukByKode(kodeBarang);
  if (!produk) return json({ ok: false, error: "Produk tidak ditemukan." }, 404);

  const stok = require("../../../../lib/models/stok.js") as {
    kurangiStok: (k: string, q: number, u: string) => Promise<number>;
    tambahStok: (k: string, q: number, u: string) => Promise<number>;
    timpaStokOpname: (k: string, q: number, u: string) => Promise<{ stok_gudang_online: number } | null>;
    ambilStok: (k: string) => Promise<{ stok_gudang_online?: number } | null>;
  };
  const { catatPergerakanStok } = require("../../../../lib/models/stockMovements.js") as {
    catatPergerakanStok: (p: Record<string, unknown>) => Promise<{ id: string }>;
  };

  // Guard double-submit best-effort 10s (PRD 13.4) — server-only doc.
  const { db } = require("../../../../lib/firebase.js") as {
    db: {
      collection: (n: string) => {
        doc: (id: string) => {
          get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
          set: (p: unknown, o?: { merge: boolean }) => Promise<unknown>;
        };
      };
    };
  };
  const guardRef = db.collection("stock_write_guard").doc(String(sesi.uid));
  try {
    const guardDoc = await guardRef.get();
    if (guardDoc.exists) {
      const g = guardDoc.data() as { kode_barang?: string; mode?: string; qty?: number; at?: number };
      const baruSaja = typeof g.at === "number" && Date.now() - g.at <= 10_000;
      if (baruSaja && g.kode_barang === kodeBarang && g.mode === mode && g.qty === qty) {
        console.warn("[stock_write_reject]", JSON.stringify({ uid: sesi.uid, alasan: "duplikat" }));
        return json({ ok: false, error: "duplikat" }, 409);
      }
    }
    await guardRef.set({ kode_barang: kodeBarang, mode, qty, at: Date.now() }, { merge: false });
  } catch (e) {
    // Guard best-effort: kegagalan guard tidak boleh memblokir tulis yang sah.
    console.error("[stock_write_guard_failed]", JSON.stringify({ pesan: String(e) }));
  }

  const sebelum = (await stok.ambilStok(kodeBarang))?.stok_gudang_online ?? 0;

  let stokBaru: number;
  try {
    if (mode === "tambah") {
      stokBaru = await stok.tambahStok(kodeBarang, qty, sesi.uid);
    } else if (mode === "kurangi") {
      // BOLEH negatif — fitur, bukan error (PRD 13.2/13.6).
      stokBaru = await stok.kurangiStok(kodeBarang, qty, sesi.uid);
    } else {
      const hasil = await stok.timpaStokOpname(kodeBarang, qty, sesi.uid);
      stokBaru = hasil?.stok_gudang_online ?? qty;
    }
  } catch (e) {
    console.error("[stock_write_reject]", JSON.stringify({ uid: sesi.uid, alasan: "model", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memperbarui stok." }, 500);
  }

  // Audit wajib (BR2). Gagal audit TIDAK rollback (PRD E12/34) tapi dilog keras.
  let movementId = "";
  try {
    const isTimpa = mode === "timpa";
    const movement = await catatPergerakanStok({
      kode_barang: kodeBarang,
      nama_terbaca: produk.nama_accurate,
      variasi: "-",
      qty: isTimpa ? qty : mode === "kurangi" ? -Math.abs(qty) : Math.abs(qty),
      type: isTimpa ? "opname" : "koreksi_manual",
      action_type: mode === "tambah" ? "tambah_stok" : "kurangi_stok",
      qty_sistem: isTimpa ? sebelum : null,
      qty_fisik: isTimpa ? stokBaru : null,
      selisih: isTimpa ? stokBaru - sebelum : null,
      catatan,
      source: "web_dashboard",
      status: "processed",
      created_by: sesi.uid,
      requested_by: sesi.uid,
      confirmed_by: sesi.uid,
    });
    movementId = movement.id;
  } catch (e) {
    console.error(
      "[audit_write_failed]",
      JSON.stringify({ kode_barang: kodeBarang, movement_type: mode, pesan: String(e) })
    );
  }

  console.info(
    "[stock_write_success]",
    JSON.stringify({ uid: sesi.uid, kode: kodeBarang, mode, stok_baru: stokBaru })
  );

  return json({ ok: true, stok_baru: stokBaru, movement_id: movementId });
}
