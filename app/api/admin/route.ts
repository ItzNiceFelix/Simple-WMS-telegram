// app/api/admin/route.ts — POST aksi admin gabungan (Fase 1: D1 cutover).
// aksi: kata-kunci (owner) | approve-akses/tolak-akses (owner) |
//       tambah-produk (owner+admin) | set-gudang-user/set-jabatan (owner)
// konfirmasi-draft (butuh bot/Sheets) DITUNDA ke Fase 2 → 501.
import { getDb } from "@/lib/d1/db";
import { hapusAdmin, setGudangUser, setJabatan, tambahAdmin, ubahRole } from "@/lib/d1/admin";
import { putuskanAkses } from "@/lib/d1/akses";
import { konfirmasiKeyword } from "@/lib/d1/kamus";
import { normalisasiNama, tambahProduk } from "@/lib/d1/produk";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

// Teks identik jalur bot (dashboard-prd-v3b §5.2 S6.1; handleApprovalCallback.js:125, handleAksesBaru.js:21).
const PESAN_SETUJU = "Sudah disetujui! Sekarang udah bisa pakai bot ini ya. Ketik /start untuk daftar perintah.";
const PESAN_TOLAK = "Maaf, saat ini belum bisa saya bantu ya.";

/** Best-effort via Bot API (pola minta-kode). Gagal → false, tanpa rollback status. */
async function beritahuTarget(chatId: number, teks: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[admin_approve_notif_gagal] TELEGRAM_BOT_TOKEN belum diset.");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: teks }),
    });
    if (!res.ok) throw new Error(`sendMessage gagal: ${res.status}`);
    return true;
  } catch (e) {
    console.error("[admin_approve_notif_gagal]", e instanceof Error ? e.message : e);
    return false;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 40);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin && !(await bacaBody(request).then((b) => b.aksi === "kata-kunci").catch(() => false))) {
    // guest ditolak kecuali handler spesifik di bawah
  }

  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  const db = getDb();
  const uid = user.tg_id;

  if (aksi === "kata-kunci") {
    if (!user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah penanda." }, 403);
    const id = Number(body.id);
    const interp = body.interpreted_as as "STOK" | "MINTA" | "MINTA_SISA";
    if (!Number.isInteger(id) || !["STOK", "MINTA", "MINTA_SISA"].includes(interp)) {
      return json({ ok: false, error: "Data tidak valid." }, 400);
    }
    const h = await konfirmasiKeyword(db, id, interp, uid);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, note: h.keyword });
  }
  if (aksi === "approve-akses" || aksi === "tolak-akses") {
    if (!user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat memproses permintaan akses." }, 403);
    const target = Number(body.target_user_id);
    if (!Number.isInteger(target)) return json({ ok: false, error: "Data tidak valid." }, 400);
    const h = await putuskanAkses(db, target, aksi === "approve-akses", uid);
    if (!h.ok) {
      if (h.error.includes("sudah diproses")) return json({ ok: false, error: "Request ini sudah diproses sebelumnya." }, 409);
      if (h.error.includes("tidak ada")) return json({ ok: false, error: "Permintaan akses tidak ditemukan." }, 404);
      return json({ ok: false, error: h.error }, h.status);
    }
    const setuju = aksi === "approve-akses";
    const terkirim = await beritahuTarget(target, setuju ? PESAN_SETUJU : PESAN_TOLAK);
    return json({ ok: true, target_user_id: String(target), status: h.status, notifikasi_terkirim: terkirim });
  }
  if (aksi === "tambah-produk") {
    if (!user.is_admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    const kode = typeof body.kode_barang === "string" ? body.kode_barang.trim() : "";
    const nama = typeof body.nama_produk === "string" ? body.nama_produk.trim() : "";
    const stokAwal = Number(body.stok_awal);
    if (!kode || !nama || !Number.isInteger(stokAwal) || stokAwal < 0) {
      return json({ ok: false, error: "Data tidak valid." }, 400);
    }
    const h = await tambahProduk(db, kode, nama, stokAwal, uid);
    if (!h.ok) {
      if (h.status === 409) return json({ ok: false, error: `kode "${kode}" sudah dipakai produk lain` }, 409);
      return json({ ok: false, error: h.error }, h.status);
    }
    void normalisasiNama;
    return json({ ok: true, admin: { kode_barang: kode } });
  }
  if (aksi === "set-gudang-user" || aksi === "set-jabatan") {
    if (!user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
    const target = String(body.target_user_id ?? "");
    if (aksi === "set-gudang-user") {
      const gid = body.gudang_id == null || body.gudang_id === "" ? null : String(body.gudang_id);
      const h = await setGudangUser(db, target, gid, uid);
      if (!h.ok) return json({ ok: false, error: h.error }, h.status);
      return json({ ok: true, admin: h.admin });
    }
    const jab = body.jabatan == null || String(body.jabatan).trim() === "" ? null : String(body.jabatan).trim().slice(0, 40);
    const h = await setJabatan(db, target, jab, uid);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, admin: h.admin });
  }
  if (aksi === "konfirmasi-draft") {
    return json({ ok: false, error: "Konfirmasi draft pindah ke Fase 2 (butuh bot/Sheets di Worker)." }, 501);
  }
  // Kompatibilitas route lama role/tambah/hapus yang memanggil /api/admin langsung:
  if (aksi === "ubah-role") {
    if (!user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
    const h = await ubahRole(db, String(body.target_user_id ?? ""), String(body.role ?? ""), uid);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, admin: h.admin });
  }
  if (aksi === "hapus-admin") {
    if (!user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
    const h = await hapusAdmin(db, String(body.target_user_id ?? ""), uid);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true });
  }
  if (aksi === "tambah-admin") {
    if (!user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
    const h = await tambahAdmin(db, String(body.target_user_id ?? ""), String(body.nama ?? ""), String(body.role ?? "guest"), uid);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, admin: h.admin });
  }
  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
