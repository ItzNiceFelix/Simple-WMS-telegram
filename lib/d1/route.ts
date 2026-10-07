// lib/d1/route.ts — Helper route Next.js → D1 (Fase 1 cutover).
// Pola tiap route: tolakOrigin → requireSession (cookie swt_sesi, D1) →
// rate-limit sederhana → role dari DB (bukan body) → validasi → lib/d1/*.
// Menggantikan: lib/dashboard/auth/sesi.js (HMAC stateless) +
// lib/models/*.js (Firestore) untuk jalur dashboard. Bot Telegram (lib/)
// tetap Firestore sampai Fase 2.
import { NextResponse } from "next/server";
import { getDb } from "./db";
import { requireSession, type SesiPengguna } from "./auth";

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

// --- Origin (paritas guard.js; tanpa require CJS) ---
export function tolakOriginD1(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Tanpa Origin: browser same-origin GET (fetch navigasi) tidak selalu kirim
    // Origin; CSRF butuh browser yang SELALU kirim Origin untuk POST lintas-situs.
    // Jadi GET tanpa Origin diizinkan, POST tanpa Origin ditolak di produksi.
    if (request.method === "GET") return { ok: true };
    if (process.env.NODE_ENV === "production") {
      return { ok: false, status: 403, error: "Origin tidak diizinkan." };
    }
    return { ok: true };
  }
  const raw = process.env.DASHBOARD_ALLOWED_ORIGINS || "";
  const daftar = raw.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  const norm = String(origin).trim().replace(/\/+$/, "");
  if (daftar.includes(norm)) return { ok: true };
  // Preview deployments (*.workers.dev akun sendiri): host berubah tiap versi,
  // tak praktis masuk allowlist. Aman karena subdomain akun sendiri.
  try {
    if (new URL(norm).hostname.endsWith(".bagus-deva-nov-p.workers.dev")) return { ok: true };
  } catch {
    // abaikan, lanjut ke penolakan
  }
  if (daftar.length === 0 && process.env.NODE_ENV !== "production") return { ok: true };
  return { ok: false, status: 403, error: "Origin tidak diizinkan." };
}
const _catatan = new Map<string, number[]>();
const WINDOW_MS = 60_000;

export function cekRateLimitD1(kunci: string, maksPerMenit: number): { ok: true } | { ok: false; status: number; error: string } {
  const now = Date.now();
  const arr = (_catatan.get(kunci) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= maksPerMenit) {
    return { ok: false, status: 429, error: "Terlalu banyak permintaan. Coba lagi sebentar lagi." };
  }
  arr.push(now);
  _catatan.set(kunci, arr);
  return { ok: true };
}

// --- Sesi: gabungan origin+rate+sesi dalam satu panggilan ---
export async function sesiRoute(
  request: Request,
  batasPerMenit = 60
): Promise<{ ok: true; user: SesiPengguna } | { ok: false; status: number; error: string }> {
  const origin = tolakOriginD1(request);
  if (!origin.ok) return origin;
  const db = getDb();
  const sesi = await requireSession(db, request);
  if (!sesi.ok) return { ok: false, status: sesi.status, error: sesi.error };
  const batas = cekRateLimitD1(`d1:${sesi.user.tg_id}`, batasPerMenit);
  if (!batas.ok) return batas;
  return { ok: true, user: sesi.user };
}

export async function bacaBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return typeof b === "object" && b !== null ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
