// app/api/permintaan/route.ts
// POST /api/permintaan — aksi permintaan harian (sesuaikan/buat-form/datang/selesai).
// PRD v3a §5.1. Pola persis app/api/stok/reorder-point/route.ts.
import { createRequire } from "node:module";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

const { verifikasiTokenSesi, ambilTokenDariCookie } = require("../../../lib/dashboard/auth/sesi.js") as {
  verifikasiTokenSesi: (t: string, o: { now: number }) => { uid: string; role: string } | null;
  ambilTokenDariCookie: (c: string | null) => string | null;
};
const { tolakOrigin, cekRateLimit } = require("../../../lib/dashboard/auth/guard.js") as {
  tolakOrigin: (r: Request) => { ok: true } | { ok: false; status: number; error: string };
  cekRateLimit: (k: string, maks: number) => { ok: true } | { ok: false; status: number; error: string };
};
const { validasiAksiPermintaan } = require("../../../lib/dashboard/validasiTulisV3a.js") as {
  validasiAksiPermintaan: (
    b: unknown,
    hariIni?: string
  ) =>
    | { ok: true; status: number; aksi: string; tanggal: string; qty?: { kode_barang: string; variasi: string; buffer: boolean; qty: number }[]; item?: { kode_barang: string; variasi: string; buffer: boolean }; qtyDatang?: number }
    | { ok: false; status: number; error: string };
};
// `.ts` TIDAK bisa di-require runtime Node (Unexpected token 'export'). Pakai helper CJS.
const { idTanggalHariIni } = require("../../../lib/dashboard/formatTanggalCjs.js") as {
  idTanggalHariIni: () => string;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

// Error model -> status + pesan PERSIS tabel PRD §5.1.
const PETA_ERROR_MODEL: Record<string, { status: number; error: string }> = {
  "Permintaan tidak ditemukan.": { status: 404, error: "Permintaan tidak ditemukan." },
  "Permintaan belum berisi item.": { status: 400, error: "Permintaan belum berisi item." },
  "Item tidak ditemukan di permintaan.": { status: 404, error: "Item tidak ditemukan di permintaan." },
  "Item yang sudah datang tidak bisa diubah.": { status: 409, error: "Item yang sudah datang tidak bisa diubah." },
  "Item ini sudah ditandai datang.": { status: 409, error: "Item ini sudah ditandai datang." },
  "Belum ada item yang datang.": { status: 400, error: "Belum ada item yang datang." },
  "Semua item sudah datang.": { status: 409, error: "Semua item sudah datang." },
};

export async function POST(request: Request) {
  const origin = tolakOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);

  const token = ambilTokenDariCookie(request.headers.get("cookie"));
  const sesi = token ? verifikasiTokenSesi(token, { now: Date.now() }) : null;
  if (!sesi) {
    return json({ ok: false, error: "Sesi kedaluwarsa. Buka ulang dari Telegram." }, 401);
  }

  const batas = cekRateLimit(`permintaan:${sesi.uid}`, 30);
  if (!batas.ok) {
    console.warn("[permintaan_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const hariIni = idTanggalHariIni();
  const valid = validasiAksiPermintaan(body, hariIni);
  if (!valid.ok) {
    console.warn("[permintaan_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, valid.status);
  }
  const { aksi, tanggal } = valid;

  // Role dari admins (sumber kebenaran), bukan sesi/body.
  let role = "guest";
  try {
    const { ambilAdmin } = require("../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" || admin.role === "admin" ? admin.role : "guest";
  } catch (e) {
    console.error("[permintaan_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }
  if (role === "guest") {
    console.warn("[permintaan_reject]", JSON.stringify({ uid: sesi.uid, alasan: "guest" }));
    return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  }

  const model = require("../../../lib/models/dailyRequests.js") as {
    ambilDailyRequest: (t: string) => Promise<{
      tanggal: string;
      status: string;
      items: { kode_barang: string; variasi?: string; qty?: number; qty_diminta?: number; status?: string }[];
      perubahan?: unknown[];
      form_dibuat_at?: unknown;
    } | null>;
    sesuaikanQtyItem: (t: string, d: unknown, o: string) => Promise<{ items: unknown[]; status: string; perubahan?: unknown[] }>;
    buatForm: (t: string, o: string) => Promise<{ doc: { form_dibuat_at?: unknown }; itemsFinal: unknown[] }>;
    tandaiItemDatang: (t: string, i: unknown, q: number, o: string) => Promise<{ doc: { status: string; items: unknown[] }; selesaiOtomatis: boolean }>;
    selesaikanRequest: (t: string, o: string) => Promise<{ status: string; selesai_at?: unknown }>;
    kirimFormPermintaan: (d: unknown) => Promise<{ terkirim: number; gagal: number }>;
    updateStatusDailyRequest: (t: string, s: string) => Promise<unknown>;
  };

  // Semua aksi butuh dokumen; dokumen tidak ada -> 404. Dokumen `selesai` -> 409 (aksi apa pun).
  let doc: Awaited<ReturnType<typeof model.ambilDailyRequest>>;
  try {
    doc = await model.ambilDailyRequest(tanggal);
  } catch (e) {
    console.error("[permintaan_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memperbarui permintaan." }, 500);
  }
  if (!doc) return json({ ok: false, error: "Permintaan tidak ditemukan." }, 404);
  if (doc.status === "selesai") {
    return json({ ok: false, error: "Permintaan sudah selesai." }, 409);
  }

  // B1: `datang` hanya sah saat dokumen `diproses`.
  if (aksi === "datang" && doc.status === "draft") {
    return json({ ok: false, error: "Kirim form dulu sebelum menandai barang datang." }, 409);
  }
  // `selesai` manual hanya sah saat `diproses`.
  if (aksi === "selesai" && doc.status === "draft") {
    return json({ ok: false, error: "Kirim form dulu sebelum menyelesaikan permintaan." }, 409);
  }

  if (aksi === "sesuaikan") {
    let hasil: { items: unknown[]; status: string; perubahan?: unknown[] };
    try {
      hasil = await model.sesuaikanQtyItem(tanggal, valid.qty, sesi.uid);
    } catch (e) {
      return galatModel(e, sesi.uid);
    }
    const perubahan = Array.isArray(hasil.perubahan) ? hasil.perubahan : [];
    console.info("[permintaan_sesuaikan]", JSON.stringify({ uid: sesi.uid, tanggal }));
    return json({
      ok: true,
      tanggal,
      items: hasil.items,
      status: hasil.status,
      perubahan_terakhir: perubahan.length ? perubahan[perubahan.length - 1] : null,
    });
  }

  if (aksi === "buat-form") {
    // Idempotensi (PRD §4.3): dokumen sudah diproses & form dikirim < 30 detik oleh uid sama
    // -> 200 tanpa kirim Telegram lagi.
    const formDibuatMs = waktuMs(doc.form_dibuat_at);
    const terakhirOleh = (doc as { form_dibuat_by?: string }).form_dibuat_by;
    if (doc.status === "diproses" && formDibuatMs && Date.now() - formDibuatMs < 30_000 && terakhirOleh === sesi.uid) {
      return json({ ok: true, tanggal, status: "diproses", form_dibuat_at: doc.form_dibuat_at, dikirim_ulang: false });
    }

    // Guard double-submit best-effort 10s (PRD §4.3) — doc server-only.
    const guard = await periksaGuardForm(sesi.uid, tanggal);
    if (guard) return json({ ok: false, error: "Permintaan sedang dikirim." }, 409);

    let hasil: { doc: { form_dibuat_at?: unknown }; itemsFinal: unknown[] };
    try {
      hasil = await model.buatForm(tanggal, sesi.uid);
    } catch (e) {
      return galatModel(e, sesi.uid);
    }

    const kirim = await model.kirimFormPermintaan(hasil.doc);
    console.info(
      "[permintaan_buat_form]",
      JSON.stringify({ uid: sesi.uid, tanggal, kirim_terkirim: kirim.terkirim, kirim_gagal: kirim.gagal })
    );

    const respons: Record<string, unknown> = {
      ok: true,
      tanggal,
      status: "diproses",
      form_dibuat_at: hasil.doc.form_dibuat_at,
      dikirim_ulang: true,
      kirim_terkirim: kirim.terkirim,
      kirim_gagal: kirim.gagal,
    };
    // Gagal kirim TIDAK rollback status. Pola v2 E4.
    if (kirim.gagal > 0) respons.peringatan_kirim = true;
    return json(respons);
  }

  if (aksi === "datang") {
    let hasil: { doc: { status: string; items: unknown[] }; selesaiOtomatis: boolean };
    try {
      hasil = await model.tandaiItemDatang(tanggal, valid.item, valid.qtyDatang as number, sesi.uid);
    } catch (e) {
      return galatModel(e, sesi.uid);
    }
    console.info("[permintaan_datang]", JSON.stringify({ uid: sesi.uid, tanggal, selesai_otomatis: hasil.selesaiOtomatis }));
    return json({
      ok: true,
      tanggal,
      status: hasil.doc.status,
      selesai_otomatis: hasil.selesaiOtomatis,
      items: hasil.doc.items,
    });
  }

  // selesai
  let hasilSelesai: { status: string; selesai_at?: unknown };
  try {
    hasilSelesai = await model.selesaikanRequest(tanggal, sesi.uid);
  } catch (e) {
    return galatModel(e, sesi.uid);
  }
  console.info("[permintaan_selesai]", JSON.stringify({ uid: sesi.uid, tanggal }));
  return json({ ok: true, tanggal, status: "selesai", selesai_at: hasilSelesai.selesai_at });
}

function galatModel(e: unknown, uid: string) {
  const pesan = e instanceof Error ? e.message : String(e);
  const peta = PETA_ERROR_MODEL[pesan];
  if (peta) return json({ ok: false, error: peta.error }, peta.status);
  console.error("[permintaan_reject]", JSON.stringify({ uid, alasan: "model", pesan }));
  return json({ ok: false, error: "Gagal memperbarui permintaan." }, 500);
}

// Firestore Timestamp | Date | ISO -> ms (0 bila tak ada).
function waktuMs(nilai: unknown): number {
  if (!nilai) return 0;
  const v = nilai as { toDate?: () => Date };
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (nilai instanceof Date) return nilai.getTime();
  const t = Date.parse(String(nilai));
  return Number.isNaN(t) ? 0 : t;
}

// Guard double-submit best-effort: cek+set ATOMIK via transaction (anti TOCTOU double-tap).
// Gagal guard TIDAK memblokir aksi sah.
async function periksaGuardForm(uid: string, tanggal: string): Promise<boolean> {
  const { db } = require("../../../lib/firebase.js") as {
    db: {
      collection: (n: string) => {
        doc: (id: string) => {
          get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
          set: (p: unknown, o?: { merge: boolean }) => Promise<unknown>;
        };
      };
      runTransaction: <T>(fn: (trx: {
        get: (ref: unknown) => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
        set: (ref: unknown, p: unknown, o?: { merge: boolean }) => unknown;
      }) => Promise<T>) => Promise<T>;
    };
  };
  const guardRef = db.collection("permintaan_form_guard").doc(String(uid));
  try {
    return await db.runTransaction(async (trx) => {
      const guardDoc = await trx.get(guardRef);
      if (guardDoc.exists) {
        const g = guardDoc.data() as { tanggal?: string; at?: number };
        if (typeof g.at === "number" && Date.now() - g.at <= 10_000 && g.tanggal === tanggal) {
          console.warn("[permintaan_reject]", JSON.stringify({ uid, alasan: "duplikat" }));
          return true;
        }
      }
      trx.set(guardRef, { tanggal, at: Date.now() }, { merge: false });
      return false;
    });
  } catch (e) {
    console.error("[permintaan_guard_failed]", JSON.stringify({ pesan: String(e) }));
    return false;
  }
}
