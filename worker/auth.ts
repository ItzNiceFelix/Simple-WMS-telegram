// worker/auth.ts — Auth inti Simple-WMS-telegram (Fase 0).
// PRD F1: login web telegramId+password (bukan Mini App), password di-set di
// Profile TMA, lupa password via kode verifikasi bot.
// Kriptografi: WebCrypto (Workers tidak punya bcrypt native) — PBKDF2-SHA256
// 100k iterasi + salt 16 byte untuk password; SHA-256 hex untuk code_hash dan
// token_hash. Sesi: token opaque 32 byte, hanya hash disimpan di D1.
// Konvensi: prepared statements + .bind() (skill cloudflare-d1), INTEGER detik.

const PBKDF2_ITER = 100_000;
const SESSION_TTL_DETIK = 12 * 3600; // 12 jam (sama seperti scaFlow)
const CODE_TTL_DETIK = 10 * 60; // kode OTP 10 menit
const RATE_GAGAL_MAKS = 5; // kunci 15 menit setelah 5 gagal
const RATE_KUNCI_DETIK = 15 * 60;

export const NAMA_COOKIE_SESI = "swt_sesi";

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlKeBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(teks: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(teks));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function acakKode6(): string {
  // 6 digit; bias modulo % 1_000_000 tidak berarti untuk OTP umur 10 menit
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

/** Buat hash password format: pbkdf2$iter$salt_b64$hash_b64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITER, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(bits)}`;
}

/** Verifikasi password; false bila format salah (perbandingan constant-time). */
export async function verifikasiPassword(password: string, tersimpan: string): Promise<boolean> {
  const bag = tersimpan.split("$");
  if (bag.length !== 4 || bag[0] !== "pbkdf2") return false;
  const iter = Number(bag[1]);
  if (!Number.isInteger(iter) || iter < 10_000) return false;
  try {
    const salt = b64urlKeBytes(bag[2]);
    const harap = b64urlKeBytes(bag[3]);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
      "deriveBits",
    ]);
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: salt as BufferSource, iterations: iter, hash: "SHA-256" },
        key,
        256
      )
    );
    if (bits.length !== harap.length) return false;
    let beda = 0;
    for (let i = 0; i < bits.length; i++) beda |= bits[i] ^ harap[i];
    return beda === 0;
  } catch {
    return false;
  }
}

export type Pengguna = {
  id: number;
  tg_id: string;
  username: string | null;
  display_name: string;
  password_hash: string | null;
  role: string;
  active: number;
};

/** Ambil user aktif by tg_id. */
export async function ambilPengguna(db: D1Database, tgId: string): Promise<Pengguna | null> {
  return db
    .prepare(
      "SELECT id, tg_id, username, display_name, password_hash, role, active FROM users WHERE tg_id = ? AND active = 1"
    )
    .bind(tgId)
    .first<Pengguna>();
}

/** Cek kunci rate-limit login: true bila masih terkunci. */
export async function loginTerkunci(db: D1Database, tgId: string, sekarang: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM login_audit WHERE tg_id = ? AND sukses = 0 AND at > ?")
    .bind(tgId, sekarang - RATE_KUNCI_DETIK)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= RATE_GAGAL_MAKS;
}

export async function catatLogin(
  db: D1Database,
  tgId: string,
  sukses: boolean,
  ip: string | null,
  ua: string | null,
  alasan: string | null
): Promise<void> {
  await db
    .prepare("INSERT INTO login_audit (tg_id, ip, ua, sukses, alasan) VALUES (?, ?, ?, ?, ?)")
    .bind(tgId, ip, ua, sukses ? 1 : 0, alasan)
    .run();
}

/** Buat sesi baru; mengembalikan token mentah (hanya hash disimpan). */
export async function buatSesi(
  db: D1Database,
  userId: number,
  ip: string | null,
  ua: string | null,
  sekarang = Math.floor(Date.now() / 1000)
): Promise<{ token: string; expiresAt: number }> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  const expiresAt = sekarang + SESSION_TTL_DETIK;
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?)")
    .bind(tokenHash, userId, expiresAt, ip, ua)
    .run();
  return { token, expiresAt };
}

/** Verifikasi token sesi dari cookie; null bila tidak valid/kedaluwarsa/dicabut. */
export async function verifikasiSesi(
  db: D1Database,
  token: string,
  sekarang = Math.floor(Date.now() / 1000)
): Promise<(Pengguna & { scope_gudang: number[] }) | null> {
  if (!token || token.length < 20) return null;
  const tokenHash = await sha256Hex(token);
  const sesi = await db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(tokenHash)
    .first<{ user_id: number; expires_at: number }>();
  if (!sesi || sesi.expires_at <= sekarang) return null;
  const user = await db
    .prepare("SELECT id, tg_id, username, display_name, password_hash, role, active FROM users WHERE id = ? AND active = 1")
    .bind(sesi.user_id)
    .first<Pengguna>();
  if (!user) return null;
  const { results } = await db
    .prepare("SELECT warehouse_id FROM user_warehouses WHERE user_id = ?")
    .bind(user.id)
    .all<{ warehouse_id: number }>();
  return { ...user, scope_gudang: results.map((r) => r.warehouse_id) };
}

export async function cabutSesi(db: D1Database, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?")
    .bind(Math.floor(Date.now() / 1000), tokenHash)
    .run();
}

/** Terbitkan kode OTP (reset/link); mengembalikan kode mentah untuk dikirim via bot. */
export async function terbitkanKode(
  db: D1Database,
  tgId: string,
  purpose: "reset" | "link" | "otp",
  sekarang = Math.floor(Date.now() / 1000)
): Promise<{ kode: string; expiresAt: number }> {
  const kode = acakKode6();
  const codeHash = await sha256Hex(`${purpose}:${tgId}:${kode}`);
  const expiresAt = sekarang + CODE_TTL_DETIK;
  await db
    .prepare("INSERT INTO auth_codes (tg_id, code_hash, purpose, expires_at) VALUES (?, ?, ?, ?)")
    .bind(tgId, codeHash, purpose, expiresAt)
    .run();
  return { kode, expiresAt };
}

/** Verifikasi kode OTP sekali pakai; false bila kedaluwarsa/terpakai/habis percobaan. */
export async function verifikasiKode(
  db: D1Database,
  tgId: string,
  purpose: "reset" | "link" | "otp",
  kode: string,
  sekarang = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const codeHash = await sha256Hex(`${purpose}:${tgId}:${kode}`);
  const row = await db
    .prepare("SELECT id, expires_at, used_at, attempts FROM auth_codes WHERE tg_id = ? AND code_hash = ? AND purpose = ?")
    .bind(tgId, codeHash, purpose)
    .first<{ id: number; expires_at: number; used_at: number | null; attempts: number }>();
  if (!row || row.used_at !== null || row.expires_at <= sekarang || row.attempts >= 5) return false;
  await db
    .prepare("UPDATE auth_codes SET attempts = attempts + 1, used_at = ? WHERE id = ?")
    .bind(sekarang, row.id)
    .run();
  return true;
}

export async function setPassword(
  db: D1Database,
  userId: number,
  password: string,
  sekarang = Math.floor(Date.now() / 1000)
): Promise<void> {
  if (password.length < 6) throw new Error("Password minimal 6 karakter.");
  const hash = await hashPassword(password);
  await db.prepare("UPDATE users SET password_hash = ?, password_set_at = ? WHERE id = ?").bind(hash, sekarang, userId).run();
}

/** Bootstrap: user pertama = owner + scope gudang ONLINE. Dipakai sekali saat setup. */
export async function bootstrapOwner(
  db: D1Database,
  tgId: string,
  displayName: string,
  password: string
): Promise<Pengguna> {
  const ada = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  if ((ada?.n ?? 0) > 0) throw new Error("Owner sudah ada.");
  const hash = await hashPassword(password);
  const sekarang = Math.floor(Date.now() / 1000);
  const hasil = await db
    .prepare("INSERT INTO users (tg_id, display_name, password_hash, password_set_at, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)")
    .bind(tgId, displayName, hash, sekarang, sekarang)
    .run();
  const userId = Number(hasil.meta.last_row_id);
  const gudang = await db.prepare("SELECT id FROM warehouses WHERE code = 'ONLINE'").first<{ id: number }>();
  if (gudang) {
    await db.prepare("INSERT INTO user_warehouses (user_id, warehouse_id) VALUES (?, ?)").bind(userId, gudang.id).run();
  }
  const user = await db
    .prepare("SELECT id, tg_id, username, display_name, password_hash, role, active FROM users WHERE id = ?")
    .bind(userId)
    .first<Pengguna>();
  if (!user) throw new Error("Gagal membuat owner.");
  return user;
}

/** Atribut Set-Cookie sesi (HttpOnly, SameSite=Lax, Secure bila https). */
export function atributCookieSesi(token: string, https: boolean, maxAge = SESSION_TTL_DETIK): string {
  const bag = [`${NAMA_COOKIE_SESI}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (https) bag.push("Secure");
  return bag.join("; ");
}

export function cookieHapusSesi(https: boolean): string {
  const bag = [`${NAMA_COOKIE_SESI}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (https) bag.push("Secure");
  return bag.join("; ");
}

/** Baca token sesi dari header Cookie. */
export function ambilTokenDariCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const bagian of cookieHeader.split(";")) {
    const idx = bagian.indexOf("=");
    if (idx < 0) continue;
    if (bagian.slice(0, idx).trim() === NAMA_COOKIE_SESI) return bagian.slice(idx + 1).trim();
  }
  return null;
}
