#!/usr/bin/env node
// scripts/jalankan-tes-worker.mjs — Jalankan uji Worker/`lib` (bundle esbuild → node:test).
//
// KENAPA SKRIP, BUKAN RANTAI `&&` DI package.json:
//   Rantai eksplisit itu panjangnya ~7.900 karakter. Menambah SATU berkas uji lagi
//   melewati batas command line Windows (8191) dan SELURUH perintah gagal dengan
//   "The command line is too long." — jadi gelarnya bukan ruang, tapi tembok: berkas uji
//   baru tidak bisa masuk sama sekali. Daftar manual juga berarti berkas uji yang lupa
//   didaftarkan TIDAK PERNAH jalan (dan tidak ada yang memberi tahu).
//
// Karena itu daftarnya DISCOVER, bukan ditulis: `lib/**/*.test.ts` + `app/**/*.test.ts`
// + berkas `worker/*.test.ts` yang eksplisit. Urutan deterministik (alfabetis) supaya
// keluaran dua kali jalan bisa dibandingkan. `test/**/*.test.js` tetap ditangani `npm test`.
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const akar = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR_UJI = ["lib", "app", "worker"];

/** Semua `*.test.ts` di bawah `dir`, alfabetis, tanpa `node_modules`/`.next`. */
function cariTes(dir) {
  const keluar = [];
  const tumpukan = [join(akar, dir)];
  while (tumpukan.length > 0) {
    const kini = tumpukan.pop();
    let isi;
    try {
      isi = readdirSync(kini, { withFileTypes: true });
    } catch {
      continue; // direktori tidak ada = bukan galat; cukup tidak ada uji di sana
    }
    for (const e of isi) {
      if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
      const penuh = join(kini, e.name);
      if (e.isDirectory()) tumpukan.push(penuh);
      else if (e.name.endsWith(".test.ts")) keluar.push(penuh);
    }
  }
  return keluar;
}

const berkas = DIR_UJI.flatMap(cariTes).sort();
if (berkas.length === 0) {
  console.error("Tidak ada berkas *.test.ts yang ditemukan.");
  process.exit(1);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const gagal = [];
const sementara = [];

/**
 * `--define:__dirname="'.'"`.
 *
 * KENAPA ADA: `next/dist/compiled/ua-parser-js` masih CJS dan menyuntik
 * `__nccwpck_require__.ab = __dirname + "/"`. Di keluaran ESM `__dirname` tidak ada,
 * jadi bundel `app/api/**` (yang menarik Next) langsung meledak dengan
 * "ReferenceError: __dirname is not defined in ES module scope" — padahal berkas uji
 * itu sendiri tidak pernah menyentuh `__dirname`. Nilainya hanya dipakai sebagai
 * awalan path dalam cache CJS, jadi `'.'` aman dan menghentikan ledakan itu.
 */
const DEFINE_DIRNAME = ["--define:__dirname=\"'.'\""];

/**
 * Stub modul per berkas uji — DIPINDAH APA ADANYA dari rantai `&&` lama (flag `--alias`
 * yang dulu ditempel satu per satu). Stub ini yang menggantikan modul yang butuh binding
 * Worker: `getDb()` memanggil `getCloudflareContext()` yang mati di luar Worker, dan
 * `next/server`/`@/lib/d1/route` menarik Next/OpenNext yang sama matinya.
 * `--external` memasangkan hal yang sama-sama tidak perlu di-bundle.
 */
const EXTERNAL_WORKER = ["--external:react", "--external:@opennextjs/cloudflare"];
const ALIAS_NEXT = [
  "--alias:next/server=./test/alias-next-server.mjs",
  "--alias:@/lib/d1/db=./test/alias-db.mjs",
  ...EXTERNAL_WORKER,
];
const FLAG_PER_BERKAS = {
  "app/api/auth/tma/route.test.ts": [
    ...ALIAS_NEXT,
    "--alias:@/lib/dashboard/auth/initData.js=./test/alias-initdata.mjs",
    // Dipakai apa adanya: hanya `sesiRoute()` yang diganti stub, lihat catatan di berkasnya.
    "--alias:@/lib/d1/route=./lib/d1/route.ts",
  ],
  "app/api/order/route.test.ts": [
    ...ALIAS_NEXT,
    "--alias:@/lib/d1/route=./test/alias-route-order.mjs",
  ],
  "lib/d1/d1.library.test.ts": EXTERNAL_WORKER,
  "lib/d1/order.test.ts": EXTERNAL_WORKER,
  "lib/analisa/ai.test.ts": EXTERNAL_WORKER,
  // `xlsx` memuat `stream` lewat `require` dinamis; di bundel ESM itu meledak dengan
  // "Dynamic require of \"stream\" is not supported". Dibuat external supaya Node memuatnya
  // sebagai CJS biasa — isi uji tidak berubah.
  "lib/d1/shopeePetaImpor.test.ts": ["--external:xlsx"],
};

/**
 * Patch `node:module` yang dipasang SEBELUM berkas uji jalan, per berkas uji.
 *
 * KENAPA PERLU: `app/api/auth/tma/route.ts` memuat initData lewat
 * `createRequire(import.meta.url)` dengan specifier RELATIF. Di dalam bundel
 * `import.meta.url` menunjuk berkas OUTPUT (`.tmp-….test.mjs` di root repo), sehingga
 * specifier itu meleset dan tes gagal dengan "Cannot find module". `--alias:` tidak bisa
 * menolong: yang dilalui adalah `require`, bukan resolusi esbuild.
 */
const IMPORT_PER_BERKAS = {
  "app/api/auth/tma/route.test.ts": ["--import", "./test/alias-require-initdata.mjs"],
};

/** Flag bundle untuk satu berkas uji, dinormalkan ke garis miring gaya repo. */
function kunciBerkas(b) {
  return relative(akar, b).replace(/\\/g, "/");
}

function flagUntuk(b) {
  return FLAG_PER_BERKAS[kunciBerkas(b)] ?? [];
}

function importUntuk(b) {
  return IMPORT_PER_BERKAS[kunciBerkas(b)] ?? [];
}

console.log(`Menjalankan ${berkas.length} berkas uji (esbuild → node:test)…\n`);
for (const b of berkas) {
  const nama = relative(akar, b).replace(/[\\/]/g, "-").replace(/\.ts$/, "");
  const keluar = join(akar, `.tmp-${nama}.test.mjs`);
  sementara.push(keluar);

  const build = spawnSync(
    npx,
    ["esbuild", b, "--bundle", "--platform=node", "--format=esm", `--outfile=${keluar}`, ...DEFINE_DIRNAME, ...flagUntuk(b), "--log-level=error"],
    { cwd: akar, stdio: "inherit", shell: process.platform === "win32" }
  );
  if (build.status !== 0) {
    gagal.push({ berkas: b, tahap: "esbuild", status: build.status });
    continue;
  }

  const uji = spawnSync(process.execPath, [...importUntuk(b), "--test", keluar], {
    cwd: akar,
    stdio: "inherit",
    // Patch createRequire membaca root dari sini; `npm run` juga berjalan dari root repo,
    // jadi nilai ini sama dengan perilaku rantai `&&` lama.
    env: { ...process.env, TMA_TEST_ROOT: akar },
  });
  if (uji.status !== 0) gagal.push({ berkas: b, tahap: "node:test", status: uji.status });
  rmSync(keluar, { force: true });
}

for (const s of sementara) rmSync(s, { force: true });

if (gagal.length > 0) {
  console.error(`\nGAGAL (${gagal.length}/${berkas.length}):`);
  for (const g of gagal) console.error(`  ${g.berkas} — ${g.tahap} exit ${g.status}`);
  process.exit(1);
}
console.log(`\nLULUS: ${berkas.length} berkas uji.`);
