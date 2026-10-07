// worker/index.ts — custom worker Simple-WMS-telegram (Fase 0).
// /api/* → worker/api.ts (health + auth F1). Non-API → ASSETS statis
// (cf-assets/). Fase 1 mengganti fallback ini dengan static import handler
// OpenNext yang digenerate saat build (.open-next/worker.js) + re-export
// pola custom-worker (skill cloudflare-nextjs → references/advanced.md).
import { tanganiApi } from "./api";
import type { Env } from "./api";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const api = await tanganiApi(request, env);
    if (api) return api;
    const url = new URL(request.url);
    if (url.pathname === "/" || !url.pathname.includes(".")) {
      url.pathname = "/index.html";
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event: ScheduledEvent, _env: Env, ctx: ExecutionContext) {
    // Fase 0: placeholder cron. Fase 1+: drain notify_queue + kirim laporan.
    console.log(
      `[scheduled] cron fired at ${new Date(event.scheduledTime).toISOString()} (cron: ${event.cron})`
    );
    ctx.waitUntil(Promise.resolve());
  },
} satisfies ExportedHandler<CloudflareEnv>;
