// scripts/lib/firebaseCli.mjs
// Helper bersama skrip v5: token + akses Firestore REST via Firebase CLI.
// TIDAK butuh firebase-admin, ADC, atau gcloud.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROJECT = process.env.FIREBASE_PROJECT_ID || "bot-admin-toko-a0c47";
export const ROOT = "https://firestore.googleapis.com/v1/";
export const BASE = ROOT + "projects/" + PROJECT + "/databases/(default)/documents/";

/** Token dari config Firebase CLI. Keluar dengan pesan jelas bila tidak ada/kedaluwarsa. */
export function token() {
  const cfgPath = join(homedir(), ".config", "configstore", "firebase-tools.json");
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch {
    console.error("[firebase-cli] tidak bisa baca: " + cfgPath);
    console.error("[firebase-cli] jalankan: npx firebase login");
    process.exit(1);
  }
  const t = cfg?.tokens?.access_token;
  if (!t) {
    console.error("[firebase-cli] access_token tidak ada. Jalankan: npx firebase login");
    process.exit(1);
  }
  const exp = Number(cfg?.tokens?.expires_at || 0);
  if (exp && Date.now() > exp) {
    console.error("[firebase-cli] token KEDALUWARSA. Jalankan: npx firebase login:ci");
    process.exit(1);
  }
  return t;
}

/** Baca seluruh dokumen sebuah koleksi (paginasi otomatis). */
export async function semua(koleksi, tok) {
  const out = [];
  let pageToken = "";
  do {
    const url = BASE + koleksi + "?pageSize=1000" + (pageToken ? "&pageToken=" + pageToken : "");
    const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    if (res.status === 401) {
      console.error("[firebase-cli] 401 - token ditolak. Jalankan: npx firebase login:ci");
      process.exit(1);
    }
    if (!res.ok) {
      console.error("[firebase-cli] gagal baca " + koleksi + ": " + res.status);
      process.exit(1);
    }
    const j = await res.json();
    out.push(...(j.documents || []));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

/** Field Firestore -> number | null. */
export function angka(field) {
  if (!field) return null;
  const raw = field.integerValue ?? field.doubleValue;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
