// app/api/admin/route.ts
// POST /api/admin — route gabungan aksi admin. Diskriminator `aksi`:
//   - `kata-kunci` (v3a, owner only, PRD v3a §6.5)
//   - `approve-akses` / `tolak-akses` (v3b A7, owner only, PRD v3b §5.2)
//   - `tambah-produk` (v3b A5, owner + admin, PRD v3b §5.3)
// NOL route baru (budget function). Pola persis app/api/stok/reorder-point/route.ts.
// Route lama role/tambah/hapus TIDAK diubah.
import { createRequire } from "node:module";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

const { verifikasiTokenSesi, ambilTokenDariCookie } = require("../../../lib/dashboard/auth/sesi.js") as {
  verifikasiTokenSesi: (t: string, o: { now: number }) => { uid: string; role: string } | null;
  ambilTokenDariCookie: (c: string | null) => string | null;
};
const { tolakOrigin, cekRateLimit } = require("../../../lib/dashboard/auth/guard.js") as {
  tolakOrigin: (r: Request) => { ok: true } | { ok: false; status: number; error: string };
  cekRateLimit: (k: string, maks: number) => { ok: true } | { ok: false; status: number; error: string };
};
const { validasiAksiAdmin } = require("../../../lib/dashboard/validasiTulisV3a.js") as {
  validasiAksiAdmin: (
    b: unknown
  ) =>
    | { ok: true; status: number; aksi: string; id: string; interpretedAs: string }
    | { ok: true; status: number; aksi: string; targetUserId: string }
    | { ok: true; status: number; aksi: string; targetUserId: string; gudangId: string | null }
    | { ok: true; status: number; aksi: string; targetUserId: string; jabatan: string | null }
    | { ok: true; status: number; aksi: string; kodeBarang: string; namaProduk: string; hpp: number | null; stokAwal: number }
    | {
        ok: true;
        status: number;
        aksi: string;
        jenis: "opname" | "picking" | "sync";
        draftId?: string;
        batchId?: string;
        aksiDraft: "apply" | "batal";
        kondisi: string | null;
      }
    | { ok: false; status: number; error: string };
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const origin = tolakOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);

  const token = ambilTokenDariCookie(request.headers.get("cookie"));
  const sesi = token ? verifikasiTokenSesi(token, { now: Date.now() }) : null;
  if (!sesi) {
    return json({ ok: false, error: "Sesi kedaluwarsa. Buka ulang dari Telegram." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiAksiAdmin(body);
  if (!valid.ok) {
    console.warn("[admin_v3b_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, valid.status);
  }
  const aksi = valid.aksi;

  // Rate limit dipilih SETELAH `aksi` diketahui (PRD v3b §4.3, bucket per jenis). A2 (draft)
  // memanggil Sheets (mahal) -> bucket terpisah 20/menit supaya spam aksi murah tidak memakan kuota.
  const bucketDraft = aksi === "konfirmasi-draft";
  const batas = cekRateLimit(`admin:${sesi.uid}:${bucketDraft ? "draft" : "aksi"}`, bucketDraft ? 20 : 40);
  if (!batas.ok) {
    console.warn("[admin_v3b_reject]", JSON.stringify({ uid: sesi.uid, aksi, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  // Role dari admins (sumber kebenaran), bukan sesi/body.
  let role = "guest";
  try {
    const { ambilAdmin } = require("../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
  } catch (e) {
    console.error("[admin_v3b_reject]", JSON.stringify({ uid: sesi.uid, aksi, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }

  if (aksi === "kata-kunci") return aksiKataKunci(sesi.uid, role, valid as { id: string; interpretedAs: string });
  if (aksi === "approve-akses" || aksi === "tolak-akses") {
    return aksiAkses(aksi, sesi.uid, role, (valid as { targetUserId: string }).targetUserId);
  }
  if (aksi === "tambah-produk") {
    const v = valid as { kodeBarang: string; namaProduk: string; hpp: number | null; stokAwal: number };
    return aksiTambahProduk(sesi.uid, role, v.kodeBarang, v.namaProduk, v.hpp, v.stokAwal);
  }
  if (aksi === "konfirmasi-draft") {
    const v = valid as {
      jenis: "opname" | "picking" | "sync";
      draftId?: string;
      batchId?: string;
      aksiDraft: "apply" | "batal";
      kondisi: string | null;
    };
    return aksiKonfirmasiDraft(sesi.uid, role, v);
  }
  // v5 (Z1): aksi baru pada route existing. Owner only (F3/F4).
  if (aksi === "set-gudang-user") {
    const v = valid as { targetUserId: string; gudangId: string | null };
    return aksiSetGudangUser(sesi.uid, role, v.targetUserId, v.gudangId);
  }
  if (aksi === "set-jabatan") {
    const v = valid as { targetUserId: string; jabatan: string | null };
    return aksiSetJabatan(sesi.uid, role, v.targetUserId, v.jabatan);
  }

  // Tidak tereksekusi (validator sudah menyaring), jaga-jaga.
  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}

// --- Aksi v3a: kata-kunci (owner only) — perilaku dipertahankan apa adanya. ---
function aksiKataKunci(uid: string, role: string, valid: { id: string; interpretedAs: string }) {
  const { id, interpretedAs } = valid;
  if (role !== "owner") {
    console.warn("[admin_kata_kunci_reject]", JSON.stringify({ uid, alasan: "bukan_owner" }));
    return json({ ok: false, error: "Hanya owner yang dapat mengubah penanda." }, 403);
  }
  const { perbaruiInterpretasi } = require("../../../lib/models/keywordNotes.js") as {
    perbaruiInterpretasi: (id: string, interpretedAs: string, oleh: string) => Promise<Record<string, unknown>>;
  };
  return perbaruiInterpretasi(id, interpretedAs, uid)
    .then((note) => {
      console.info("[admin_kata_kunci_success]", JSON.stringify({ uid, id, interpreted_as: interpretedAs }));
      return json({
        ok: true,
        note: {
          id: note.id,
          raw_text: note.raw_text,
          interpreted_as: note.interpreted_as,
          confidence: note.confidence,
          usage_count: note.usage_count,
          last_used: note.last_used,
          confirmed_by: note.confirmed_by,
          confirmed_at: note.confirmed_at,
        },
      });
    })
    .catch((e: unknown) => {
      const pesan = e instanceof Error ? e.message : String(e);
      if (pesan === "Interpretasi tidak dikenal.") return json({ ok: false, error: pesan }, 400);
      if (pesan === "Penanda tidak ditemukan.") return json({ ok: false, error: pesan }, 404);
      console.error("[admin_kata_kunci_reject]", JSON.stringify({ uid, alasan: "model", pesan }));
      return json({ ok: false, error: "Gagal menyimpan interpretasi penanda." }, 500);
    });
}

// --- Aksi v3b A7: approve-akses / tolak-akses (owner only). PRD v3b §5.2. ---
async function aksiAkses(
  aksi: string,
  uid: string,
  role: string,
  targetUserId: string
) {
  if (role !== "owner") {
    console.warn("[admin_v3b_reject]", JSON.stringify({ uid, aksi, alasan: "bukan_owner" }));
    return json({ ok: false, error: "Hanya owner yang dapat memproses permintaan akses." }, 403);
  }

  const { setujuiAccessRequest, tolakAccessRequest } = require("../../../lib/models/accessRequests.js") as {
    setujuiAccessRequest: (id: string, by: string) => Promise<Record<string, unknown>>;
    tolakAccessRequest: (id: string, by: string) => Promise<Record<string, unknown>>;
  };

  let doc: Record<string, unknown>;
  try {
    doc =
      aksi === "approve-akses"
        ? await setujuiAccessRequest(targetUserId, uid)
        : await tolakAccessRequest(targetUserId, uid);
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    if (pesan === "TIDAK_ADA") return json({ ok: false, error: "Permintaan akses tidak ditemukan." }, 404);
    if (pesan === "SUDAH_DIPROSES") {
      return json({ ok: false, error: "Request ini sudah diproses sebelumnya." }, 409);
    }
    console.error("[admin_v3b_reject]", JSON.stringify({ uid, aksi, alasan: "model", pesan }));
    return json({ ok: false, error: "Gagal memproses permintaan akses." }, 500);
  }

  // Notifikasi Telegram ke user target — paritas bot. Gagal kirim TIDAK rollback status.
  const { kirimPesan } = require("../../../lib/telegram/kirimPesan.js") as {
    kirimPesan: (chatId: string, teks: string, opsi?: Record<string, unknown>) => Promise<unknown>;
  };
  const { PESAN_TOLAK_HALUS } = require("../../../lib/handlers/handleAksesBaru.js") as {
    PESAN_TOLAK_HALUS: string;
  };
  const teksNotif =
    aksi === "approve-akses"
      ? "Sudah disetujui! Boleh kenalan dulu, namanya siapa?"
      : PESAN_TOLAK_HALUS;

  let notifikasiTerkirim = true;
  try {
    await kirimPesan(targetUserId, teksNotif);
  } catch (e) {
    notifikasiTerkirim = false;
    console.error("[admin_approve_notif_gagal]", JSON.stringify({ uid, aksi, target: targetUserId, pesan: String(e) }));
  }

  console.info("[admin_approve_akses_success]", JSON.stringify({ uid, aksi, target: targetUserId, notifikasi_terkirim: notifikasiTerkirim }));
  return json({
    ok: true,
    target_user_id: targetUserId,
    status: aksi === "approve-akses" ? "approved" : "rejected",
    notifikasi_terkirim: notifikasiTerkirim,
  });
}

// --- Aksi v3b A5: tambah-produk (owner + admin). PRD v3b §5.3. B5 create-only transaksional. ---
async function aksiTambahProduk(
  uid: string,
  role: string,
  kodeBarang: string,
  namaProduk: string,
  hpp: number | null,
  stokAwal: number
) {
  if (role !== "owner" && role !== "admin") {
    console.warn("[admin_v3b_reject]", JSON.stringify({ uid, aksi: "tambah-produk", alasan: "guest" }));
    return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  }

  const { normalisasiNama, invalidasiCacheProduk } = require("../../../lib/models/produk.js") as {
    normalisasiNama: (n: string) => string;
    invalidasiCacheProduk: () => void;
  };
  const { invalidasiCacheStok } = require("../../../lib/models/stok.js") as {
    invalidasiCacheStok: () => void;
  };

  // B5: transaksi create-only — products + stock dalam SATU transaksi. Bila products/{kode}
  // sudah ada -> KODE_SUDAH_ADA (route 409). Paritas race guard bot (chatHandler.js:621-624) tapi atomik.
  let kodeSudahAda = false;
  try {
    const { db } = require("../../../lib/firebase.js") as {
      db: {
        collection: (n: string) => { doc: (id: string) => unknown };
        runTransaction: <T>(fn: (trx: {
          get: (ref: unknown) => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
          set: (ref: unknown, p: unknown, o?: { merge: boolean }) => unknown;
        }) => Promise<T>) => Promise<T>;
      };
    };
    const produkRef = db.collection("products").doc(kodeBarang);
    const stokRef = db.collection("stock").doc(kodeBarang);
    const sekarang = new Date();

    await db.runTransaction(async (trx) => {
      const existing = await trx.get(produkRef);
      if (existing.exists) throw new Error("KODE_SUDAH_ADA");
      // Create-only juga untuk `stock`: dokumen stok orphan (produk tidak ada tapi stok ada)
      // JANGAN ditimpa diam-diam (kelas bug yang ditutup B5).
      const stokExisting = await trx.get(stokRef);
      if (stokExisting.exists) throw new Error("KODE_SUDAH_ADA");
      trx.set(produkRef, {
        nama_accurate: namaProduk,
        hpp,
        nama_accurate_normalized: normalisasiNama(namaProduk),
        is_online_product: true,
        updated_at: sekarang,
      });
      trx.set(stokRef, {
        stok_gudang_online: stokAwal,
        reorder_point: null,
        last_updated: sekarang,
        last_updated_by: uid,
        last_synced_at: null,
        last_synced_value: null,
      });
    });
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    if (pesan === "KODE_SUDAH_ADA") {
      kodeSudahAda = true;
    } else {
      console.error("[admin_v3b_reject]", JSON.stringify({ uid, aksi: "tambah-produk", alasan: "model", pesan }));
      return json({ ok: false, error: "Gagal menambah produk." }, 500);
    }
  }
  if (kodeSudahAda) {
    return json({ ok: false, error: `kode "${kodeBarang}" sudah dipakai produk lain` }, 409);
  }

  invalidasiCacheProduk();
  invalidasiCacheStok();

  // Audit via stock_movements (PRD §5.3 langkah 3 / §9). Gagal audit TIDAK rollback produk.
  try {
    const { catatPergerakanStok } = require("../../../lib/models/stockMovements.js") as {
      catatPergerakanStok: (p: Record<string, unknown>) => Promise<{ id: string }>;
    };
    await catatPergerakanStok({
      kode_barang: kodeBarang,
      nama_terbaca: namaProduk,
      variasi: "-",
      qty: Math.abs(stokAwal || 0),
      type: "koreksi_manual",
      action_type: "tambah_stok",
      catatan: "produk baru didaftarkan lewat dashboard",
      source: "web_dashboard",
      status: "processed",
      created_by: uid,
      requested_by: uid,
      confirmed_by: uid,
    });
  } catch (e) {
    console.error("[admin_v3b_reject]", JSON.stringify({ uid, aksi: "tambah-produk", alasan: "audit", pesan: String(e) }));
  }

  // Reorder check setelah commit bila stok_awal > 0 — gagal TIDAK menggagalkan respons.
  if (stokAwal > 0) {
    try {
      const { cekDanNotifikasiReorderPoint } = require("../../../lib/reminder/cekReorderPoint.js") as {
        cekDanNotifikasiReorderPoint: (k: string) => Promise<unknown>;
      };
      await cekDanNotifikasiReorderPoint(kodeBarang);
    } catch (e) {
      console.error("[admin_v3b_reject]", JSON.stringify({ uid, aksi: "tambah-produk", alasan: "reorder", pesan: String(e) }));
    }
  }

  console.info("[admin_tambah_produk_success]", JSON.stringify({ uid, kode: kodeBarang, stok_awal: stokAwal }));
  return json({
    ok: true,
    produk: { kode_barang: kodeBarang, nama_accurate: namaProduk, hpp, is_online_product: true },
    stok_awal: stokAwal,
  });
}

// --- Aksi v3b Fase B: konfirmasi-draft (A2). PRD v3b §5.4 + §7 + §8. ---
// Unit konfirmasi: opname/sync = per DRAFT; picking = per BATCH (satu sesi `pendingPickingList`).
// Urutan: baca draft -> owner dari DRAFT -> otorisasi -> guard dokumen -> panggil bot
// (telegramUserId = owner, confirmedBy = sesi.uid, kirimNotifikasi:false, cekGuard:false —
// route PEMEGANG guard, bot tidak perlu baca lagi).

interface HasilBot {
  ok?: boolean;
  alasan?: string;
  diproses?: number;
  dilewati?: number;
  sisa?: number;
  dibatalkan?: boolean;
  batch_id?: string;
}

interface DokumenDraft {
  id: string;
  status?: string;
  kondisi?: string;
  owner_user_id?: unknown;
  created_by?: unknown;
  requested_by?: unknown;
}

async function aksiKonfirmasiDraft(
  uid: string,
  role: string,
  v: { jenis: "opname" | "picking" | "sync"; draftId?: string; batchId?: string; aksiDraft: "apply" | "batal"; kondisi: string | null }
) {
  if (role !== "owner" && role !== "admin") {
    console.warn("[admin_v3b_reject]", JSON.stringify({ uid, aksi: "konfirmasi-draft", alasan: "guest" }));
    return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  }

  const { db } = require("../../../lib/firebase.js") as {
    db: {
      collection: (n: string) => {
        doc: (id: string) => unknown;
        where: (f: string, op: string, v: unknown) => {
          limit: (n: number) => { get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }> };
        };
        limit: (n: number) => { get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }> };
      };
      runTransaction: <T>(fn: (trx: {
        get: (ref: unknown) => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
        set: (ref: unknown, p: unknown, o?: { merge: boolean }) => unknown;
      }) => Promise<T>) => Promise<T>;
    };
  };
  const { siapkanKonfirmasiDraft, validasiStatusDraft, otorisasi, tulisGuardDraft } = require("../../../lib/dashboard/aksiDraft.js") as {
    siapkanKonfirmasiDraft: (db: unknown, p: Record<string, unknown>) =>
      | Promise<{ ok: true; ownerUserId: string; kunci: string; dokumen: DokumenDraft | null }>
      | Promise<{ ok: false; status: number; error: string }>;
    validasiStatusDraft: (j: string, d: unknown, k: string | null, o: string) => { ok: true } | { ok: false; status: number; error: string };
    otorisasi: (role: string, uid: string, owner: string) => { ok: true; ownerUserId: string } | { ok: false; status: number; error: string };
    tulisGuardDraft: (db: unknown, kunci: string, uid: string) => Promise<{ duplikat: boolean }>;
  };

  // 1) Ambil draft/movement dari SUMBER SERVER -> owner + kunci guard. Body tidak jadi sumber.
  const siap = await siapkanKonfirmasiDraft(db, { jenis: v.jenis, draftId: v.draftId, batchId: v.batchId });
  if (!siap.ok) {
    console.warn("[admin_v3b_reject]", JSON.stringify({ uid, aksi: "konfirmasi-draft", jenis: v.jenis, alasan: siap.error }));
    return json({ ok: false, error: siap.error }, siap.status);
  }
  const { ownerUserId, kunci, dokumen } = siap;

  // 2) Otorisasi role (owner semua / admin sendiri) dengan owner dari DOKUMEN (§7.3). Tanpa
  // penanda pemilik -> fail-closed (§7.2), owner TIDAK dikecualikan.
  const izin = otorisasi(role, uid, ownerUserId);
  if (!izin.ok) {
    console.warn("[admin_v3b_reject]", JSON.stringify({ uid, aksi: "konfirmasi-draft", jenis: v.jenis, alasan: "otorisasi" }));
    const errorOtorisasi =
      izin.status === 409
        ? "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram."
        : "Hanya owner atau pembuat draft yang dapat mengonfirmasi.";
    return json({ ok: false, error: errorOtorisasi }, izin.status);
  }

  // 3) Lapis 1: status draft (opname/sync) + kondisi sync kelompok (E-5). Picking sudah dicek
  // di `siapkanKonfirmasiDraft` (E-3/sudah, status batch).
  const validStatus = validasiStatusDraft(v.jenis, dokumen, v.kondisi, ownerUserId);
  if (!validStatus.ok) return json({ ok: false, error: validStatus.error }, validStatus.status);

  // 4) Lapis 3: guard dokumen `draft_kirim_guard` (TTL 10s), best-effort.
  const guard = await tulisGuardDraft(db, kunci, uid);
  if (guard.duplikat) {
    console.warn("[draft_kirim_guard_reject]", JSON.stringify({ uid, kunci }));
    return json({ ok: false, error: "Draft sedang diproses." }, 409);
  }

  // Panggil fungsi bot yang SAMA. `cekGuard:false` di sini karena ROUTE adalah pemegang guard
  // (sudah menulis guard di langkah sebelumnya) — bot tetap MAMPU membaca guard via `cekGuard:true`
  // (B2, diuji T4i); jalur ini memilih tidak membaca ganda. Sync: bentuk teks PERSIS yang
  // dikenali `tentukanKondisiDariJawaban` (A2-2).
  let hasil: HasilBot | undefined;
  try {
    if (v.jenis === "opname") {
      const { konfirmasiOpname } = require("../../../lib/handlers/handleOpname.js") as {
        konfirmasiOpname: (t: string, j: string, o: Record<string, unknown>) => Promise<HasilBot>;
      };
      hasil = await konfirmasiOpname(ownerUserId, v.aksiDraft === "batal" ? "batal" : "ya", {
        confirmedBy: uid,
        kirimNotifikasi: false,
        cekGuard: false,
      });
    } else if (v.jenis === "picking") {
      const { konfirmasiPickingList } = require("../../../lib/handlers/konfirmasiPickingList.js") as {
        konfirmasiPickingList: (t: string, j: string, o: Record<string, unknown>) => Promise<HasilBot>;
      };
      // `sumber` BUKAN "teks" — dashboard bukan jalur chat (R-C: hindari pesan "masih nunggu").
      hasil = await konfirmasiPickingList(ownerUserId, v.aksiDraft === "batal" ? "batal" : "ya", {
        sumber: "dokumen",
        confirmedBy: uid,
        kirimNotifikasi: false,
        cekGuard: false,
      });
    } else {
      const { konfirmasiSyncStok } = require("../../../lib/sheets/syncStokDuaArah.js") as {
        konfirmasiSyncStok: (t: string, j: string, o: Record<string, unknown>) => Promise<HasilBot>;
      };
      const jawaban = v.aksiDraft === "batal" ? "batal" : `ya ${v.kondisi}`;
      hasil = await konfirmasiSyncStok(ownerUserId, jawaban, {
        confirmedBy: uid,
        kirimNotifikasi: false,
        cekGuard: false,
      });
    }
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    console.error("[admin_v3b_reject]", JSON.stringify({ uid, aksi: "konfirmasi-draft", jenis: v.jenis, alasan: "model", pesan }));
    return json({ ok: false, error: "Gagal memproses draft." }, 500);
  }

  // B3: `ok:false` dari bot BUKAN sukses (dulu return senyap -> 200 palsu).
  if (!hasil || !hasil.ok) {
    const alasan = hasil?.alasan ?? "tidak_ada_pending";
    console.warn("[konfirmasi_draft_no_op]", JSON.stringify({ uid, jenis: v.jenis, alasan }));
    if (alasan === "tidak_ada_pending") {
      return json({ ok: false, error: "Draft sedang diproses atau pemilik draft tidak dapat diverifikasi." }, 409);
    }
    return json({ ok: false, error: "Draft ini sudah diproses sebelumnya." }, 409);
  }

  console.info("[admin_konfirmasi_draft_success]", JSON.stringify({ uid, jenis: v.jenis, owner: ownerUserId, aksi_draft: v.aksiDraft }));
  return json({ ok: true, jenis: v.jenis, aksi_draft: v.aksiDraft, ...hasil });
}

// --- Aksi v5 F3: set-gudang-user (owner only). Lokasi kerja TIDAK mengubah permission. ---
async function aksiSetGudangUser(uid: string, role: string, targetUserId: string, gudangId: string | null) {
  if (role !== "owner") {
    console.warn("[admin_gudang_reject]", JSON.stringify({ uid, alasan: "bukan_owner" }));
    return json({ ok: false, error: "Hanya owner yang dapat mengatur lokasi user." }, 403);
  }
  const { ambilGudangAktif } = require("../../../lib/models/gudang.js") as {
    ambilGudangAktif: (id: string) => Promise<unknown | null>;
  };
  if (gudangId !== null) {
    const g = await ambilGudangAktif(gudangId);
    if (!g) return json({ ok: false, error: "Gudang tidak dikenal." }, 400);
  }
  const { setGudangUser } = require("../../../lib/models/admins.js") as {
    setGudangUser: (t: string, g: string | null, o: string) => Promise<{ ok: boolean; status?: number; error?: string; admin?: unknown }>;
  };
  const hasil = await setGudangUser(targetUserId, gudangId, uid);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status ?? 400);
  console.info("[admin_gudang_success]", JSON.stringify({ uid, aksi: "set-gudang-user", target: targetUserId }));
  return json({ ok: true, admin: hasil.admin });
}

// --- Aksi v5 F4: set-jabatan (owner only). Label KOSMETIK - TIDAK pernah jadi input otorisasi. ---
async function aksiSetJabatan(uid: string, role: string, targetUserId: string, jabatan: string | null) {
  if (role !== "owner") {
    console.warn("[admin_jabatan_reject]", JSON.stringify({ uid, alasan: "bukan_owner" }));
    return json({ ok: false, error: "Hanya owner yang dapat mengubah jabatan." }, 403);
  }
  const { setJabatan } = require("../../../lib/models/admins.js") as {
    setJabatan: (t: string, j: string | null, o: string) => Promise<{ ok: boolean; status?: number; error?: string; admin?: unknown }>;
  };
  const hasil = await setJabatan(targetUserId, jabatan, uid);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status ?? 400);
  console.info("[admin_jabatan_success]", JSON.stringify({ uid, aksi: "set-jabatan", target: targetUserId }));
  return json({ ok: true, admin: hasil.admin });
}

