// test/alias-initdata.mjs — stub untuk harness test:worker (lihat package.json).
// Mengarahkan resolusi modul initData ASLI ke file nyata: di bundel, `import.meta.url`
// route menunjuk file OUTPUT (.tmp-tma.test.mjs di root repo), sehingga specifier
// relatif route (../../../../lib/dashboard/auth/initData.js) meleset 4 tingkat.
// Dipakai sebagai: --alias:@/lib/dashboard/auth/initData.js=./test/alias-initdata.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Bundel ada di root repo; `npm run` juga berjalan dari root repo.
const root = process.env.TMA_TEST_ROOT || process.cwd();
const require = createRequire(pathToFileURL(resolve(root, "package.json")));

export const { buatInitData, verifikasiInitData, InitDataError } = require(
  resolve(root, "lib/dashboard/auth/initData.js")
);
