// scripts/migrate-backfill-v5.mjs
// Migrasi v5 (PRD bagian 10 langkah 2): isi `qty_per_gudang["ONLINE"]` untuk semua dokumen
// `stock` + selaraskan `stok_gudang_online` (aturan pemenang tunggal T8).
//
// KREDENSIAL: memakai token dari Firebase CLI (~/.config/configstore/firebase-tools.json).
// TIDAK butuh firebase-admin, ADC, atau gcloud. Kalau token kedaluwarsa, jalankan
// `npx firebase login:ci` (atau `firebase login`) dulu.
//
// ATURAN PEMENANG (T8):
// - Bila `qty_per_gudang["ONLINE"]` SUDAH ADA -> nilai itu MENANG; `stok_gudang_online` diselaraskan.
// - Bila tidak ada tapi `stok_gudang_online` ada -> backfill dari situ.
// - Bila keduanya tidak ada -> keduanya 0.
//
// URUTAN AMAN (docs/plan-v5.md bagian 13):
//   1. Backup dulu: node scripts/backup-stock-v5.mjs
//   2. node scripts/verify-backfill.mjs            (baseline, read-only)
//   3. Pastikan gudang "ONLINE" ada: node scripts/ensure-gudang-online-v5.mjs
//   4. node scripts/migrate-backfill-v5.mjs        (DRY RUN - default)
//   5. node scripts/migrate-backfill-v5.mjs --apply
//   6. node scripts/verify-backfill.mjs            (harus exit 0)
//
// Idempoten: menjalankan dua kali memberi hasil sama.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "bot-admin-toko-a0c47";
const ROOT = "https://firestore.googleapis.com/v1/";
const BASE = ROOT + "projects/" + PROJECT + "/databases/(default)/documents/";
const APPLY = process.argv.includes("--apply");

function token() {
  const cfgPath = join(homedir(), ".config", "configstore", "firebase-tools.json");
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch {
    console.error("[migrate-v5] tidak bisa baca config Firebase CLI: " + cfgPath);
    console.error("[migrate-v5] jalankan: npx firebase login");
    process.exitCode = 1;
  }
  const t = cfg?.tokens?.access_token;
  if (!t) {
    console.error("[migrate-v5] access_token tidak ada di config. Jalankan: npx firebase login");
    process.exitCode = 1;
  }
  const exp = Number(cfg?.tokens?.expires_at || 0);
  if (exp && Date.now() > exp) {
    console.error("[migrate-v5] token KEDALUWARSA. Jalankan: npx firebase login:ci");
    process.exitCode = 1;
  }
  return t;
}

async function semua(koleksi, tok) {
  const out = [];
  let pageToken = "";
  do {
    const url = BASE + koleksi + "?pageSize=1000" + (pageToken ? "&pageToken=" + pageToken : "");
    const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    if (res.status === 401) {
      console.error("[migrate-v5] 401 - token ditolak. Jalankan: npx firebase login:ci");
      process.exitCode = 1;
    }
    if (!res.ok) {
      console.error("[migrate-v5] gagal baca " + koleksi + ": " + res.status);
      process.exitCode = 1;
    }
    const j = await res.json();
    out.push(...(j.documents || []));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

function angka(field) {
  if (!field) return null;
  const raw = field.integerValue ?? field.doubleValue;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const tok = token();
  const docs = await semua("stock", tok);
  const mode = APPLY ? "APPLY (menulis)" : "DRY RUN (tidak menulis)";
  console.log("[migrate-v5] project: " + PROJECT);
  console.log("[migrate-v5] mode: " + mode);
  console.log("[migrate-v5] dokumen stock: " + docs.length);

  let ubah = 0;
  let sudahSama = 0;
  let gagal = 0;

  for (const d of docs) {
    const kode = d.name.split("/").pop();
    const f = d.fields || {};
    const map = f.qty_per_gudang?.mapValue?.fields || {};
    const punyaKey = Object.prototype.hasOwnProperty.call(map, "ONLINE");
    const legacy = angka(f.stok_gudang_online);

    const pemenang = punyaKey ? (angka(map.ONLINE) ?? 0) : (legacy ?? 0);

    if (punyaKey && pemenang === legacy) {
      sudahSama++;
      continue;
    }

    if (!APPLY) {
      ubah++;
      console.log("  akan ubah: " + kode + " -> " + pemenang);
      continue;
    }

    const fields = {
      qty_per_gudang: { mapValue: { fields: { ...map, ONLINE: { integerValue: String(pemenang) } } } },
      stok_gudang_online: { integerValue: String(pemenang) },
    };
    const url =
      ROOT +
      d.name +
      "?updateMask.fieldPaths=qty_per_gudang&updateMask.fieldPaths=stok_gudang_online";
    const res = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      gagal++;
      console.error("  GAGAL " + kode + ": " + res.status);
      continue;
    }
    ubah++;
  }

  console.log("[migrate-v5] " + (APPLY ? "diubah" : "akan diubah") + ": " + ubah);
  console.log("[migrate-v5] sudah sama: " + sudahSama);
  console.log("[migrate-v5] gagal: " + gagal);
  if (!APPLY) console.log("[migrate-v5] jalankan ulang dengan --apply untuk menulis.");
  process.exitCode = gagal > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("[migrate-v5] error:", String(e));
  process.exitCode = 1;
});
