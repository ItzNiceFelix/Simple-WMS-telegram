// worker/index.ts — custom worker Simple-WMS-telegram (Fase 1).
// Re-export handler OpenNext (.open-next/worker.js, digenerate saat build) +
// handler scheduled() untuk cron + router /api/* kustom (auth Fase 0).
// Pola: skill cloudflare-nextjs → references/advanced.md (Custom Worker).
// Static import: modul diketahui saat author time (pola adapter), hanya
// path-nya generated — build OpenNext SELALU menghasilkan file ini sebelum
// wrangler deploy, jadi static import aman dan gagal saat build bila hilang.
import { tanganiApi } from "./api";
import type { Env } from "./api";
// @ts-ignore — `.open-next/worker.js` digenerate oleh `opennextjs-cloudflare build`
import { default as handler } from "../.open-next/worker.js";

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    // /api/auth/* + /api/health + /api/setup/* ditangani langsung (auth Fase 0,
    // tidak lewat Next). Route /api/stok|produk|gudang|... tetap milik Next
    // (app/api/*) sampai cutover Worker penuh di Fase 2.
    const api = await tanganiApi(request, env as Env);
    if (api) return api;
    return handler.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    // Fase 1: placeholder cron. Fase 2+: drain notify_queue + kirim laporan.
    console.log(
      `[scheduled] cron fired at ${new Date(controller.scheduledTime).toISOString()} (cron: ${controller.cron})`
    );
    ctx.waitUntil(Promise.resolve());
  },
} satisfies ExportedHandler<CloudflareEnv>;
