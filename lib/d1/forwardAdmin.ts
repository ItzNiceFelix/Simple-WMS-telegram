// lib/d1/forwardAdmin.ts — forwarder route admin (role/tambah/hapus/ubah-nama) ke /api/admin.
// WAJIB meneruskan header asli termasuk `Origin`: handler dalam memanggil tolakOriginD1,
// dan Request baru tanpa Origin akan ditolak 403 di produksi ("Origin tidak diizinkan.").
export function forwardKeAdmin(request: Request, body: Record<string, unknown>, aksi: string): Request {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(request.url.replace(/\/(role|tambah|hapus|ubah-nama)\/?$/, ""), {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, aksi }),
  });
}
