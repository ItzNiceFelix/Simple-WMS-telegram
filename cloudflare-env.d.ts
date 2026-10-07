// cloudflare-env.d.ts — ditulis manual (Fase 1).
// `wrangler types` crash di sandbox PRoot pada tahap "runtime types"
// (tcmalloc mmap), tapi tahap "project types" berhasil tercetak.
// Sinkron dengan wrangler.jsonc: DB (simple-wms) + ASSETS.
// Regenerasi saat binding berubah — di CI atau mesin non-PRoot.
/// <reference types="@cloudflare/workers-types" />
interface CloudflareEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  TELEGRAM_BOT_TOKEN?: string;
  SUPER_ADMIN_ID?: string;
}
