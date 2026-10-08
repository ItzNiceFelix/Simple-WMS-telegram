// test/alias-require-initdata.mjs — patch `node:module`.createRequire saat bundel
// test:worker dijalankan. Route app/api/auth/tma/route.ts memuat initData lewat
// createRequire(import.meta.url); di dalam bundel `import.meta.url` = file OUTPUT
// (.tmp-tma.test.mjs di root repo) sehingga specifier relatif route meleset 4 tingkat.
// Patch menambal specifier itu ke path absolut root repo, lalu meneruskan sisanya.
// Tidak ada di bundel? Modul ini no-op.
// Dipakai via `node --import ./test/alias-require-initdata.mjs` (test:worker).
import { createRequire, syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const POLA = /(?:\.\.\/)+lib\/dashboard\/auth\/initData\.js$/;
const root = process.env.TMA_TEST_ROOT || process.cwd();
const initDataAbs = resolve(root, "lib/dashboard/auth/initData.js");

const asli = createRequire;
// createRequire(dari) mengembalikan fungsi require(id) — tambal fungsinya, bukan
// hasil createRequire-nya (itulah yang tersimpan oleh bundel).
function patched(dari) {
  const req = asli(dari);
  const fn = (spec) => req.apply(null, [POLA.test(spec) ? initDataAbs : spec]);
  fn.resolve = (spec) => req.resolve(POLA.test(spec) ? initDataAbs : spec);
  fn.cache = req.cache;
  fn.extensions = req.extensions;
  fn.main = req.main;
  return fn;
}

// ESM namespace read-only → tambal lewat binding CJS Module, lalu sinkronkan.
const m = await import("node:module");
m.default.createRequire = patched;
syncBuiltinESMExports();
