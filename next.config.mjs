import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mode data di-inject sebagai LITERAL saat build. `env` men-substitusi
// process.env.NAMA di klien DAN server, jadi tak bergantung pada heuristik
// NEXT_PUBLIC_ (yang bisa gagal meng-inline → runtime baca `i.env.*` = undefined
// → fallback "mock" di produksi → guard R11 meledak).
//
// NODE_ENV TIDAK perlu didaftarkan: Next sudah mengganti `process.env.NODE_ENV`
// dengan literal build ("production"/"development") di semua bundel.
const NEXT_PUBLIC_DASHBOARD_DATA =
  process.env.NEXT_PUBLIC_DASHBOARD_DATA || (process.env.NODE_ENV === "production" ? "real" : "mock");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_DASHBOARD_DATA },
  // Semua halaman dipaksa statis (0 function). Route tulis hidup di app/api/*/route.ts.
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
  outputFileTracingRoot: __dirname,
  // firebase-admin (+ jwks-rsa/jose) tidak dibundel esbuild: butuh gRPC/native
  // yang tak ada di Workers, dan memang dibuang saat cutover D1 (Fase 1).
  serverExternalPackages: ["firebase-admin", "jose", "jwks-rsa", "@google-cloud/firestore"],
};

export default nextConfig;

// CATATAN: initOpenNextCloudflareForDev() SENGAJA tidak dipanggil di sini.
// Ia memuat workerd native yang crash (TCMalloc mmap) di sandbox PRoot ARM —
// bahkan dalam dynamic import bersyarat (Next mengevaluasi config dengan cara
// yang tetap mengeksekusi top-level await). Untuk `next dev` dengan binding
// lokal, buat next.config.dev.mjs terpisah atau jalankan di mesin non-PRoot.
// Build/prod tidak butuh init ini (binding di-resolve saat runtime Worker).
