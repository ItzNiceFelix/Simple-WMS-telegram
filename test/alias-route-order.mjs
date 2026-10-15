// test/alias-route-order.mjs — stub modul @/lib/d1/route untuk uji route order.
//
// `sesiRoute()` asli memanggil getCloudflareContext() (tak ada di luar Worker) dan
// requireSession (cookie + D1). Uji `konfirmasi-shopee` tidak sedang menguji autentikasi —
// itu sudah punya e2e sendiri — jadi di sini sesi diganti user admin tetap. `json` dan
// `bacaBody` tetap sama seperti aslinya supaya kontrak respons tidak berubah.
const user = { tg_id: "1", is_admin: true, role: "owner" };

export async function sesiRoute() {
  return { ok: true, user };
}

export function json(body, status = 200) {
  return Response.json(body, { status });
}

export async function bacaBody(req) {
  try {
    const b = await req.json();
    return typeof b === "object" && b !== null ? b : {};
  } catch {
    return {};
  }
}
