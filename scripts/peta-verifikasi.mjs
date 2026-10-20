#!/usr/bin/env node
// scripts/peta-verifikasi.mjs — periksa klaim `docs/map/*.md` terhadap isi repo.
//
// KENAPA:
//   Peta yang salah lebih berbahaya daripada tidak ada peta: agen akan membuka berkas
//   yang sudah dihapus dan menyimpulkan fitur "hilang". Skrip ini menyapu semua token
//   dalam backtick, lalu memastikan (a) path benar-benar ada, (b) simbol yang disebut
//   muncul di berkas/isi repo. Baris yang MEMANG menyatakan ketiadaan ("TIDAK ada",
//   "Belum diverifikasi") dilewati — verifikasi negatif tidak bisa dibuktikan mesin.
//
// Pemakaian: `node scripts/peta-verifikasi.mjs` (exit 1 bila ada temuan).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const akar = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dirPeta = join(akar, "docs/map");
const DIRS = [
  "app/", "lib/", "worker/", "test/", "e2e/", "scripts/", "migrations/", "docs/",
  "components/", "api/", "bundle/", "public/",
];
const TOPDOC = [
  "package.json", "wrangler.jsonc", "next.config.mjs", "open-next.config.ts",
  "playwright.config.ts", "tsconfig.json", "vercel.json", "firebase.json",
  "cloudflare-env.d.ts", "README.md", "PRD.md", "AGENTS.md",
];
const EXT = [".ts", ".js", ".tsx", ".jsx", ".mjs", ".json", ".sql", ".md", ".css"];
const BATAS_BYTE = 400_000;
const LEWATI = /[<>{}*$|]|^METHOD |^[0-9]+\.|\.\.\./;
const NEGATIF = /TIDAK ada|tidak ada|Belum diverifikasi/i;

const daftar = spawnSync("git", ["ls-files"], { cwd: akar, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const korpus = new Map();
for (const f of daftar) {
  const p = join(akar, f);
  try {
    if (readFileSync(p).length > BATAS_BYTE) continue;
    korpus.set(f, readFileSync(p, "utf8"));
  } catch {
    /* berkas di git tapi tidak ada di disk (mis. artefak) → abaikan */
  }
}
// docs/map bisa belum di-commit; tetap diverifikasi.
for (const f of readdirSync(dirPeta)) korpus.set(`docs/map/${f}`, readFileSync(join(dirPeta, f), "utf8"));
const blob = [...korpus.values()].join("\n");

function cariBerkas(base) {
  if (korpus.has(base)) return base;
  for (const ext of EXT) if (korpus.has(base + ext)) return base + ext;
  return null;
}
const adaSimbol = (teks, nama) => new RegExp(`\\b${nama.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(teks);
const adaDir = (p) => {
  try {
    readdirSync(join(akar, p));
    return true;
  } catch {
    return false;
  }
};

const hilangPath = [];
const hilangSimbol = [];
let cekPath = 0;
let cekSimbol = 0;

for (const f of readdirSync(dirPeta).filter((x) => x.endsWith(".md")).sort()) {
  const teks = readFileSync(join(dirPeta, f), "utf8");
  for (const baris of teks.split("\n")) {
    if (NEGATIF.test(baris)) continue;
    for (const tok of baris.matchAll(/`([^`\n]+)`/g)) {
      const t = tok[1].trim();
      if (!t || LEWATI.test(t) || /\s/.test(t)) continue;

      // `berkas.ts:sym1/sym2` — simbol di dalam satu berkas.
      const mFile = new RegExp(`^((?:${DIRS.map((d) => d.replace(/\//g, "\\/")).join("|")})[^\\s:]+?)(?:::|:)([A-Za-z_][\\w./]*)$`).exec(t);
      if (mFile) {
        const asli = cariBerkas(mFile[1]);
        if (!asli) {
          hilangPath.push([f, t, "file absent"]);
          continue;
        }
        cekPath++;
        for (const sym of mFile[2].split("/")) {
          if (!sym || /^\d+(-\d+)?$/.test(sym)) continue;
          const nama = sym.split(".")[0].split("(")[0];
          if (!adaSimbol(korpus.get(asli), nama)) hilangSimbol.push([f, `${asli}:${nama}`, "not in file"]);
        }
        continue;
      }

      // `berkas.ts` — path dengan ekstensi (jangan diperlakukan sebagai simbol).
      const berspasi = DIRS.some((d) => t.startsWith(d));
      if (berspasi && EXT.some((e) => t.endsWith(e))) {
        if (cariBerkas(t)) cekPath++;
        else hilangPath.push([f, t, "path absent"]);
        continue;
      }

      // `berkas.simbol` (berkas tanpa ekstensi).
      const mDot = new RegExp(`^((?:${DIRS.map((d) => d.replace(/\//g, "\\/")).join("|")})[^\\s:]+?)\\.([A-Za-z_]\\w*)$`).exec(t);
      if (mDot && !EXT.includes("." + mDot[2])) {
        const asli = cariBerkas(mDot[1]);
        if (asli) {
          cekPath++;
          if (!adaSimbol(korpus.get(asli), mDot[2])) hilangSimbol.push([f, t, "symbol not in file"]);
          continue;
        }
      }

      const base = t.replace(/:\d+(-\d+)?$/, "");
      if (berspasi || TOPDOC.includes(base)) {
        if (base.endsWith("/") || base.endsWith("/**")) continue;
        if (cariBerkas(base) || adaDir(base) || (/^migrations\/\d+$/.test(base) && [...korpus.keys()].some((k) => k.startsWith(base)))) {
          cekPath++;
        } else {
          hilangPath.push([f, t, "path absent"]);
        }
        continue;
      }

      // Simbol lepas (nama fungsi/kolom/config) — cari di seluruh isi repo.
      if (/^[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z0-9_]+)*$/.test(t) && (t.includes("_") || /^[a-z]+[A-Z]/.test(t) || t === t.toUpperCase())) {
        cekSimbol++;
        if (!adaSimbol(blob, t.split(".")[0])) hilangSimbol.push([f, t, "symbol absent"]);
      }
    }
  }
}

console.log(`docs=${readdirSync(dirPeta).filter((x) => x.endsWith(".md")).length} paths_checked=${cekPath} symbols_checked=${cekSimbol}`);
console.log(`missing_paths=${hilangPath.length} missing_symbols=${hilangSimbol.length}`);
for (const x of hilangPath.slice(0, 60)) console.log(" PATH", x.join(" | "));
for (const x of hilangSimbol.slice(0, 60)) console.log(" SYM ", x.join(" | "));
process.exit(hilangPath.length + hilangSimbol.length > 0 ? 1 : 0);
