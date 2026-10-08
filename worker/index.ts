// worker/index.ts — custom worker Simple-WMS-telegram (Fase 2).
// /api/telegram/webhook → worker/bot.ts (webhook + command D1).
// /api/* lain → worker/api.ts (auth Fase 0). Sisanya → OpenNext.
// scheduled() → cron notify (worker/notify.ts).
// Pola: skill cloudflare-nextjs → references/advanced.md (Custom Worker).
import { tanganiApi } from "./api";
import { tanganiWebhook } from "./bot";
import { drainTick } from "./notify";
import type { Env } from "./api";
// @ts-ignore — `.open-next/worker.js` digenerate oleh `opennextjs-cloudflare build`
import { default as handler } from "../.open-next/worker.js";

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const e = env as Env;
    const url = new URL(request.url);
    if (url.pathname === "/api/telegram/webhook") {
      return tanganiWebhook(request, e, ctx);
    }
    const api = await tanganiApi(request, e);
    if (api) return api;
    return (handler as { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> }).fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    // Cron notify queue (Fase 2): drain antrean Telegram tiap tick.
    ctx.waitUntil(
      drainTick(env as Env).catch((err) => console.error("[cron]", err instanceof Error ? err.message : err))
    );
    console.log(`[scheduled] ${new Date(controller.scheduledTime).toISOString()} (${controller.cron})`);
  },
} satisfies ExportedHandler<CloudflareEnv>;
