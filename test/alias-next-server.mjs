// test/alias-next-server.mjs — stub minimal `next/server` untuk harness test:worker.
// Esbuild mengganti `next/server` → path di sini (workaround: `--external:next/server`
// menghasilkan specifier tanpa .js yang gagal di resolusi ESM Node).
// Hanya NextResponse.json yang dipakai lib/d1/route.ts.
export const NextResponse = {
  json(body, init) {
    const status = typeof init === "number" ? init : init?.status ?? 200;
    return Response.json(body, { status });
  },
};
