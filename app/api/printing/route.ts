// app/api/printing/route.ts — Catat & baca status "resi sudah dicetak".
//
// POST { presetId, noPesanan: string[], noResi?: Record<string,string>, file? }
//      → upsert order_cetak untuk order yang DIKENAL sistem.
// GET  ?presetId=&noPesanan=a,b,c → waktu cetak terakhir per nomor.
//
// KENAPA DI SINI, BUKAN DI /api/order:
//   Mencetak BUKAN mengubah order: status pemenuhan tidak berubah karena kertas keluar dari
//   printer. Menumpangkannya ke route order akan mencampur dua domain (pemenuhan vs cetak)
//   dan membuat setiap perubahan cetak terlihat seperti perubahan order di audit.
//
// KENAPA HANYA NOMOR YANG DIKENAL:
//   Halaman Printing menerima PDF dari marketplace apa pun (TikTok, Tokopedia). Baris yang
//   ordernya tidak ada di D1 tetap dicetak, tetapi TIDAK dictat — mencatat nomor asing akan
//   mengisi tabel dengan baris yang tidak pernah bisa ditampilkan di halaman Order.
import { getDb } from "@/lib/d1/db";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batas nomor per panggilan: satu cetak massal wajar < 500 resi; di atas itu kemungkinan salah kirim. */
const MAKS_NOMOR = 500;

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const url = new URL(request.url);
  const presetId = Number(url.searchParams.get("presetId"));
  if (!Number.isInteger(presetId) || presetId <= 0) {
    return json({ ok: false, error: "presetId wajib diisi." }, 400);
  }
  // `?noPesanan=a,b,c` — dibatasi supaya URL tidak melewati batas panjang dan query tidak
  // memuat ratusan parameter (D1 membatasi jumlah parameter per pernyataan).
  const nomor = (url.searchParams.get("noPesanan") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAKS_NOMOR);
  if (nomor.length === 0) return json({ ok: true, status: {} });

  const db = getDb();
  const status: Record<string, { dicetak_at: number; no_resi: string }> = {};
  const tanda = nomor.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT no_pesanan, no_resi, dicetak_at FROM order_cetak WHERE preset_id = ? AND no_pesanan IN (${tanda})`)
    .bind(presetId, ...nomor)
    .all<{ no_pesanan: string; no_resi: string; dicetak_at: number }>();
  for (const r of results ?? []) {
    status[r.no_pesanan] = { dicetak_at: r.dicetak_at, no_resi: r.no_resi };
  }
  return json({ ok: true, status });
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
  const mentah = Array.isArray(body.noPesanan) ? body.noPesanan : [];
  const nomor = [...new Set(mentah.map((n) => String(n ?? "").trim()).filter(Boolean))].slice(0, MAKS_NOMOR);
  if (nomor.length === 0) return json({ ok: false, error: "noPesanan kosong." }, 400);

  const resi = (body.noResi && typeof body.noResi === "object" ? body.noResi : {}) as Record<string, unknown>;
  const file = typeof body.file === "string" ? body.file.trim().slice(0, 200) : "";
  const oleh = String(sesi.user.tg_id ?? "");
  const db = getDb();

  // Hanya nomor yang benar-benar ada di `orders` preset ini. Nomor asing dilewati diam-diam:
  // halaman Printing memang boleh mencetak resi toko yang belum terdaftar di sistem.
  const dikenal = new Set<string>();
  for (let i = 0; i < nomor.length; i += 90) {
    const bagian = nomor.slice(i, i + 90);
    const tanda = bagian.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT no_pesanan FROM orders WHERE preset_id = ? AND no_pesanan IN (${tanda})`)
      .bind(presetId, ...bagian)
      .all<{ no_pesanan: string }>();
    for (const r of results ?? []) dikenal.add(r.no_pesanan);
  }
  const dictat = nomor.filter((n) => dikenal.has(n));
  if (dictat.length === 0) return json({ ok: true, tercatat: 0, tidakDikenal: nomor.length });

  const stmts = dictat.map((n) =>
    db
      .prepare(
        "INSERT INTO order_cetak (preset_id, no_pesanan, no_resi, dicetak_at, oleh, file) VALUES (?, ?, ?, unixepoch(), ?, ?) " +
          // Upsert: yang disimpan adalah cetak TERAKHIR. no_resi ikut diperbarui karena resi
          // bisa berganti (ganti kurir) dan baris ini harus mencerminkan yang benar-benar dicetak.
          "ON CONFLICT(preset_id, no_pesanan) DO UPDATE SET no_resi = excluded.no_resi, dicetak_at = excluded.dicetak_at, oleh = excluded.oleh, file = excluded.file"
      )
      .bind(presetId, n, String(resi[n] ?? "").trim(), oleh, file)
  );
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));

  return json({ ok: true, tercatat: dictat.length, tidakDikenal: nomor.length - dictat.length });
}
