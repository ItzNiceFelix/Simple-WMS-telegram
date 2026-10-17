// app/api/sinkronisasi/route.ts — Riwayat impor per toko per jenis berkas.
//
// GET  ?presetId=&jenis=        → impor terakhir per jenis (atau satu jenis) untuk halaman Sinkronisasi
// POST { presetId, jenis, file, baris, gagal, ringkas }
//                               → catat satu impor selesai
//
// KENAPA DICATAT DI SINI, BUKAN DI TIAP ROUTE IMPOR:
//   Impor sudah tersebar di tiga route lama (/api/order, /api/laba, /api/analisa). Menambah
//   penulisan log di ketiganya berarti tiga tempat yang harus ingat mencatat — dan satu yang
//   lupa akan menghasilkan halaman Sinkronisasi yang berbohong. Klien mencatat satu kali
//   setelah impor selesai; route impor lama tidak diubah perilakunya.
import { getDb } from "@/lib/d1/db";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Jenis impor yang boleh dicatat — allowlist, supaya tabel tidak jadi tempat sampah. */
const JENIS = { order: true, laba: true, performa: true, iklan: true } as const;
type Jenis = keyof typeof JENIS;

type BarisLog = {
  jenis: Jenis;
  file: string;
  baris: number;
  gagal: number;
  ringkas: string;
  at: number;
  oleh: string | null;
};

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const url = new URL(request.url);
  const presetId = Number(url.searchParams.get("presetId"));
  if (!Number.isInteger(presetId) || presetId <= 0) {
    return json({ ok: false, error: "presetId wajib diisi." }, 400);
  }
  const jenisDiminta = (url.searchParams.get("jenis") ?? "").trim();

  const db = getDb();
  // Ambil 10 terakhir per jenis, lalu klien memakai yang pertama. Dibatasi di SQL (bukan
  // memuat seluruh tabel) karena riwayat impor tumbuh tiap hari tanpa batas.
  const { results } = await db
    .prepare(
      "SELECT jenis, file, baris, gagal, ringkas, at, oleh FROM sinkron_log " +
        "WHERE preset_id = ?" + (jenisDiminta ? " AND jenis = ?" : "") +
        " ORDER BY at DESC LIMIT 40"
    )
    .bind(...(jenisDiminta ? [presetId, jenisDiminta] : [presetId]))
    .all<BarisLog>();

  const perJenis: Record<string, BarisLog[]> = { order: [], laba: [], performa: [], iklan: [] };
  for (const r of results ?? []) {
    if (perJenis[r.jenis]) perJenis[r.jenis].push(r);
  }
  return json({ ok: true, perJenis });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const body = await bacaBody(request);
  const presetId = Number(body.presetId);
  if (!Number.isInteger(presetId) || presetId <= 0) {
    return json({ ok: false, error: "presetId wajib diisi." }, 400);
  }
  const jenis = String(body.jenis ?? "").trim() as Jenis;
  if (!JENIS[jenis]) {
    return json({ ok: false, error: `jenis harus salah satu: ${Object.keys(JENIS).join(", ")}` }, 400);
  }
  const angka = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };

  await getDb()
    .prepare(
      "INSERT INTO sinkron_log (preset_id, jenis, file, baris, gagal, ringkas, oleh) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      presetId,
      jenis,
      typeof body.file === "string" ? body.file.trim().slice(0, 200) : "",
      angka(body.baris),
      angka(body.gagal),
      typeof body.ringkas === "string" ? body.ringkas.trim().slice(0, 500) : "",
      String(sesi.user.tg_id ?? "")
    )
    .run();
  return json({ ok: true });
}
