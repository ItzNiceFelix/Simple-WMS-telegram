#!/usr/bin/env node
// scripts/bangun-opennext.mjs — bangun Worker OpenNext dengan izin versi Next tidak didukung.
//
// KENAPA: tim Next hanya mendukung satu major selama 2 tahun. Sejak 2026-10-21 Next 15
// melewati batas itu, dan `opennextjs-cloudflare build` menolak jalan — build yang sama
// sekali pun masih berfungsi (dipakai sampai sekarang). Tanpa flag ini `npm run deploy`
// selalu gagal sebelum menyentuh Cloudflare, jadi rilis berhenti tanpa sebab yang jelas.
//
// Flag ini HANYA membuka cek versi; seluruh langkah build tetap identik.
import { spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const r = spawnSync(npx, ["opennextjs-cloudflare", "build", "--dangerouslyUseUnsupportedNextVersion"], {
  stdio: "inherit",
  shell: true,
});
process.exit(r.status ?? 1);
