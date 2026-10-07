// app/api/stok/gudang/route.ts
// POST /api/stok/gudang - DISPATCHER aksi qty gudang (v5 F2 + v5.2):
//   aksi: set-qty | mutasi-gudang. Admin + owner (BR7 scope tulis).
// Pola guard: tolakOrigin -> sesi -> rate limit -> role -> validasi -> scope -> model -> audit.
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
const { validasiAksiStokGudang } = require("../../../../lib/dashboard/validasiGudangV5.js") as {
  validasiAksiStokGudang: (b: unknown) =>
    | { ok: true; status: number; aksi: "set-qty"; kodeBarang: string; gudangId: string; qty: number }
    | {
        ok: true;
        status: number;
        aksi: "mutasi-gudang";
        kodeBarang: string;
        dariGudangId: string;
        keGudangId: string;
        qty: number;
      }
    | { ok: false; status: number; error: string };
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const origin = tolakOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);

  const token = ambilTokenDariCookie(request.headers.get("cookie"));
  const sesi = token ? verifikasiTokenSesi(token, { now: Date.now() }) : null;
  if (!sesi) {
    return json({ ok: false, error: "Sesi kedaluwarsa. Buka ulang dari Telegram." }, 401);
  }

  const batas = cekRateLimit(`stok-gudang:${sesi.uid}`, 30);
  if (!batas.ok) {
    console.warn("[stok_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  // Role dari admins (sumber kebenaran). Guest (termasuk tanpa dokumen admin) ditolak di sini.
  let role = "guest";
  let gudangAdmin: string | null = null;
  try {
    const { ambilAdmin } = require("../../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string; gudang_id?: unknown } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
    gudangAdmin = admin.gudang_id != null && String(admin.gudang_id).trim() !== "" ? String(admin.gudang_id) : null;
  } catch (e) {
    console.error("[stok_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }

  if (role === "guest") {
    console.warn("[stok_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "guest" }));
    return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiAksiStokGudang(body);
  if (!valid.ok) {
    console.warn("[stok_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, valid.status);
  }

  const { ambilGudangAktif } = require("../../../../lib/models/gudang.js") as {
    ambilGudangAktif: (id: string) => Promise<unknown | null>;
  };
  const { setQtyGudang, mutasiStokGudang } = require("../../../../lib/models/stok.js") as {
    setQtyGudang: (kode: string, gudangId: string, qty: number, oleh: string) => Promise<Record<string, number> | null>;
    mutasiStokGudang: (
      kode: string,
      dariGudangId: string,
      keGudangId: string,
      qty: number,
      oleh: string
    ) => Promise<{ ok: true; qty_per_gudang: Record<string, number> } | { ok: false; status: number; error: string }>;
  };
  const { catatPergerakanStok } = require("../../../../lib/models/stockMovements.js") as {
    catatPergerakanStok: (a: Record<string, unknown>) => Promise<unknown>;
  };

  try {
    if (valid.aksi === "set-qty") {
      // BR7: admin ter-scope hanya boleh menulis gudang miliknya. Owner bebas.
      if (role === "admin" && gudangAdmin !== null && valid.gudangId !== gudangAdmin) {
        console.warn("[stok_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "di_luar_scope" }));
        return json({ ok: false, error: "Anda hanya dapat mengubah stok gudang Anda." }, 403);
      }

      const gudang = await ambilGudangAktif(valid.gudangId);
      if (!gudang) return json({ ok: false, error: "Gudang tidak dikenal." }, 400);

      const hasil = await setQtyGudang(valid.kodeBarang, valid.gudangId, valid.qty, sesi.uid);
      if (hasil === null) return json({ ok: false, error: "Stok produk tidak ditemukan." }, 404);

      // G2: audit set-qty (best-effort SETELAH commit). Pakai NILAI BARU (qty) karena
      // set-qty adalah penetapan absolut - tidak butuh selisih untuk audit.
      const peringatanAudit = await auditSetQtyStokGudang({
        catatPergerakanStok,
        kodeBarang: valid.kodeBarang,
        gudangId: valid.gudangId,
        qty: valid.qty,
        uid: sesi.uid,
      });

      console.info("[stok_gudang_v5_success]", JSON.stringify({ uid: sesi.uid, aksi: "set-qty", kode: valid.kodeBarang, gudang: valid.gudangId, qty: valid.qty }));
      return json({ ok: true, qty_per_gudang: hasil, ...(peringatanAudit ? { peringatan_audit: true } : {}) });
    }

    // aksi === "mutasi-gudang"
    const dariGudangId = valid.dariGudangId;
    const keGudangId = valid.keGudangId;

    // BR7: admin hanya boleh memindah DARI gudangnya. Owner bebas.
    if (role === "admin" && gudangAdmin !== null && dariGudangId !== gudangAdmin) {
      console.warn("[stok_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "di_luar_scope" }));
      return json({ ok: false, error: "Anda hanya dapat memindah dari gudang Anda." }, 403);
    }

    // P1: KEDUA gudang harus aktif. Tidak aktif -> 400 "Gudang tidak dikenal."
    const [dariAktif, keAktif] = await Promise.all([
      ambilGudangAktif(dariGudangId),
      ambilGudangAktif(keGudangId),
    ]);
    if (!dariAktif || !keAktif) return json({ ok: false, error: "Gudang tidak dikenal." }, 400);

    // Guard idempotensi (D10): best-effort, gagal guard JANGAN blokir operasi sah.
    await guardMutasiBestEffort(sesi.uid, valid.kodeBarang, dariGudangId, keGudangId, valid.qty);

    const hasil = await mutasiStokGudang(valid.kodeBarang, dariGudangId, keGudangId, valid.qty, sesi.uid);
    if (!hasil.ok) {
      console.warn("[stok_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, aksi: "mutasi-gudang", alasan: hasil.error }));
      return json({ ok: false, error: hasil.error }, hasil.status);
    }

    // D3: DUA entri audit (keluar `-qty` dari `dari`, masuk `+qty` ke `ke`). Best-effort.
    const peringatanAudit = await auditMutasiStokGudang({
      catatPergerakanStok,
      kodeBarang: valid.kodeBarang,
      dariGudangId,
      keGudangId,
      qty: valid.qty,
      uid: sesi.uid,
    });

    console.info("[stok_gudang_v5_success]", JSON.stringify({ uid: sesi.uid, aksi: "mutasi-gudang", kode: valid.kodeBarang, dari: dariGudangId, ke: keGudangId, qty: valid.qty }));
    return json({ ok: true, qty_per_gudang: hasil.qty_per_gudang, ...(peringatanAudit ? { peringatan_audit: true } : {}) });
  } catch (e) {
    console.error("[stok_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memperbarui stok gudang." }, 500);
  }
}

/**
 * Audit set-qty (G2). Satu entri `koreksi_manual`. qty = nilai BARU (bukan selisih) karena
 * set-qty menetapkan nilai absolut, sehingga tidak ada delta yang bermakna untuk dihitung.
 * Best-effort (BR10): gagal -> log + return true (peringatan_audit), TIDAK rollback.
 */
async function auditSetQtyStokGudang(a: {
  catatPergerakanStok: (x: Record<string, unknown>) => Promise<unknown>;
  kodeBarang: string;
  gudangId: string;
  qty: number;
  uid: string;
}): Promise<boolean> {
  try {
    await a.catatPergerakanStok({
      kode_barang: a.kodeBarang,
      qty: a.qty,
      type: "koreksi_manual",
      action_type: "set_qty_gudang",
      gudang_id: a.gudangId,
      source: "web_dashboard",
      created_by: a.uid,
    });
    return false;
  } catch (e) {
    console.error("[stok_gudang_v5_audit_failed]", JSON.stringify({ aksi: "set-qty", kode: a.kodeBarang, pesan: String(e) }));
    return true;
  }
}

/**
 * Audit mutasi (D3). DUA entri `koreksi_manual` bertanda: keluar `-qty` dari gudang asal,
 * masuk `+qty` ke gudang tujuan. Best-effort: gagal -> `peringatan_audit: true`, tidak rollback.
 */
async function auditMutasiStokGudang(a: {
  catatPergerakanStok: (x: Record<string, unknown>) => Promise<unknown>;
  kodeBarang: string;
  dariGudangId: string;
  keGudangId: string;
  qty: number;
  uid: string;
}): Promise<boolean> {
  const dasar = {
    kode_barang: a.kodeBarang,
    type: "koreksi_manual",
    action_type: "mutasi_gudang",
    source: "web_dashboard",
    created_by: a.uid,
  };
  let gagal = false;
  // Dua tulis terpisah: kegagalan satu sisi tidak membatalkan sisi lain (audit best-effort).
  try {
    await a.catatPergerakanStok({ ...dasar, qty: -a.qty, gudang_id: a.dariGudangId });
  } catch (e) {
    gagal = true;
    console.error("[stok_gudang_v5_audit_failed]", JSON.stringify({ aksi: "mutasi-gudang", sisi: "keluar", kode: a.kodeBarang, pesan: String(e) }));
  }
  try {
    await a.catatPergerakanStok({ ...dasar, qty: a.qty, gudang_id: a.keGudangId });
  } catch (e) {
    gagal = true;
    console.error("[stok_gudang_v5_audit_failed]", JSON.stringify({ aksi: "mutasi-gudang", sisi: "masuk", kode: a.kodeBarang, pesan: String(e) }));
  }
  return gagal;
}

/**
 * Guard idempotensi mutasi (D10). Best-effort: error I/O -> catat log, JANGAN blokir.
 * Koleksi `stokGudang`, kunci `mutasi:${uid}`, pembanding `{kode, dari, ke, qty}` (TTL 10s).
 */
async function guardMutasiBestEffort(
  uid: string,
  kodeBarang: string,
  dariGudangId: string,
  keGudangId: string,
  qty: number
): Promise<void> {
  try {
    const { KOLEKSI, kunciGuard, tulisGuard } = require("../../../../lib/dashboard/guardV5.js") as {
      KOLEKSI: { stokGudang: string };
      kunciGuard: (aksi: string, uid: string) => string;
      tulisGuard: (db: unknown, koleksi: string, kunci: string, payload?: Record<string, unknown>) => Promise<void>;
    };
    const { db } = require("../../../../lib/firebase.js") as { db: unknown };
    await tulisGuard(db, KOLEKSI.stokGudang, kunciGuard("mutasi", uid), {
      kode: kodeBarang,
      dari: dariGudangId,
      ke: keGudangId,
      qty,
    });
  } catch (e) {
    console.error("[stok_gudang_v5_guard_failed]", JSON.stringify({ pesan: String(e) }));
  }
}
