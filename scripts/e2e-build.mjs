// Build khusus E2E: mengaktifkan mock + bypass guard R11 secara eksplisit.
// TIDAK dipakai untuk deploy. Deploy nyata tidak set NEXT_PUBLIC_ALLOW_MOCK.
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  NEXT_PUBLIC_DASHBOARD_DATA: "mock",
  NEXT_PUBLIC_ALLOW_MOCK: "true",
  NEXT_PUBLIC_MOCK_DELAY: "0",
};

const r = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env,
});
process.exit(r.status ?? 1);
