// cloudflare-env.d.ts — ditulis manual (Fase 1).
// `wrangler types` crash di sandbox PRoot pada tahap "runtime types"
// (tcmalloc mmap), tapi tahap "project types" berhasil tercetak.
// Sinkron dengan wrangler.jsonc: DB (simple-wms) + ASSETS + vars.
// Regenerasi saat binding berubah — di CI atau mesin non-PRoot.
/// <reference types="@cloudflare/workers-types" />
interface CloudflareEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  SUPER_ADMIN_ID?: string;
  // vars dari wrangler.jsonc (dibaca route lewat process.env — OpenNext menyuntikkan).
  AI_PROVIDER_TEXT?: string;
  GEMINI_TIMEOUT_MS?: string;
  GEMINI_TOTAL_TIMEOUT_MS?: string;
  DASHBOARD_ALLOWED_ORIGINS?: string;
  DASHBOARD_SESSION_SECRET?: string;
  AI_KEY_ENCRYPTION_KEY?: string;
}

// OpenNext menyalurkan `vars` wrangler ke process.env saat runtime Worker, jadi route
// Node boleh membacanya. Deklarasi ini membuat tipe cocok dengan EnvAi di lib/d1/pengaturan.ts.
declare namespace NodeJS {
  interface ProcessEnv {
    AI_PROVIDER_TEXT?: string;
    GEMINI_TIMEOUT_MS?: string;
    GEMINI_TOTAL_TIMEOUT_MS?: string;
  }
}
