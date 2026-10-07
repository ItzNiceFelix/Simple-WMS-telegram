// open-next.config.ts — Simple-WMS-telegram Fase 0.
// Konfigurasi default (kosong): tanpa incremental cache / queue / tag cache.
// Tier caching (R2/DO/D1-tag) diputuskan di Fase 1 setelah paritas dashboard.
// Lihat skill cloudflare-nextjs: references/open-next.config.ts untuk Tier 1-3.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
