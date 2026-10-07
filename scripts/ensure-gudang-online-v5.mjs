// scripts/ensure-gudang-online-v5.mjs
// Pastikan gudang "ONLINE" ada (PRD bagian 10 langkah 1). Idempoten: ada -> tidak menimpa.
// Dipakai sebelum migrasi supaya key qty_per_gudang["ONLINE"] punya dokumen gudang.
//
// Pakai: node scripts/ensure-gudang-online-v5.mjs
import { PROJECT, ROOT, token } from "./lib/firebaseCli.mjs";

async function main() {
  const tok = token();
  const docUrl = ROOT + "projects/" + PROJECT + "/databases/(default)/documents/gudang/ONLINE";

  const cek = await fetch(docUrl, { headers: { Authorization: "Bearer " + tok } });
  if (cek.ok) {
    console.log("[ensure-gudang] gudang/ONLINE SUDAH ADA - tidak menimpa");
    return 0;
  }
  if (cek.status !== 404) {
    console.error("[ensure-gudang] gagal cek: " + cek.status);
    return 1;
  }

  const body = {
    fields: {
      nama: { stringValue: "ONLINE" },
      aktif: { booleanValue: true },
      urutan: { integerValue: "0" },
      created_at: { timestampValue: new Date().toISOString() },
      created_by: { stringValue: "migrasi-v5" },
    },
  };
  const res = await fetch(
    ROOT + "projects/" + PROJECT + "/databases/(default)/documents/gudang?documentId=ONLINE",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    console.error("[ensure-gudang] GAGAL: " + res.status);
    return 1;
  }
  console.log("[ensure-gudang] gudang/ONLINE dibuat");
  return 0;
}

process.exitCode = await main();
