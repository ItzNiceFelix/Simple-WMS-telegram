// Build mode REAL untuk menguji guard R11 (tanpa initData -> layar "Buka dari Telegram").
// TIDAK memakai NEXT_PUBLIC_ALLOW_MOCK: build ini memang produksi-like.
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  NEXT_PUBLIC_DASHBOARD_DATA: "real",
  NEXT_PUBLIC_ALLOW_MOCK: "",
  NEXT_PUBLIC_MOCK_DELAY: "0",
};

const r = spawnSync("npx", ["next", "build"], { stdio: "inherit", shell: true, env });
process.exit(r.status ?? 1);
