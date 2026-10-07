import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
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
