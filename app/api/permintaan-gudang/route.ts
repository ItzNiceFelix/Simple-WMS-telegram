// app/api/permintaan-gudang/route.ts
// POST /api/permintaan-gudang - permintaan antar-gudang (v5 F5/F6).
//   aksi: buat | ubah-item | setujui | setujui-tujuan | tolak-tujuan | tolak | batal |
//         kirim | terima | tidak-terima | tutup-tujuan | selesai
// Pola guard v5 (T18): tolakOrigin -> sesi -> rate limit -> role -> validasi body.
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
const { validasiAksiPermintaanGudang } = require("../../../lib/dashboard/validasiPermintaanGudangV5.js") as {
  validasiAksiPermintaanGudang: (b: unknown) => Record<string, unknown> & { ok: boolean; status: number; aksi?: string; error?: string };
};

type Hasil = { ok: boolean; status?: number; error?: string; [k: string]: unknown };

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

  const batas = cekRateLimit(`permintaan-gudang:${sesi.uid}`, 30);
  if (!batas.ok) {
    console.warn("[permintaan_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  // Role dari admins (sumber kebenaran), bukan sesi/body.
  let role = "guest";
  let gudangUser: string | null = null;
  try {
    const { ambilAdmin } = require("../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string; gudang_id?: string | null } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) {
      console.warn("[permintaan_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "bukan_admin" }));
      return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    }
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
    gudangUser = admin.gudang_id ? String(admin.gudang_id) : null;
  } catch (e) {
    console.error("[permintaan_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }

  // Guest tidak boleh aksi tulis apa pun (F5.3) - ditolak SEBELUM validasi body (T18).
  if (role === "guest") {
    console.warn("[permintaan_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "guest" }));
    return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiAksiPermintaanGudang(body);
  if (!valid.ok) {
    console.warn("[permintaan_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, valid.status);
  }

  const model = require("../../../lib/models/permintaanGudang.js") as {
    buatPermintaan: (a: Record<string, unknown>) => Promise<Hasil>;
    ubahItemPermintaan: (id: string, items: unknown, oleh: string) => Promise<Hasil>;
    ambilPermintaan: (id: string) => Promise<Record<string, unknown> | null>;
    setujuiTujuan: (id: string, idx: number, oleh: string) => Promise<Hasil>;
    tolakTujuanPermintaan: (id: string, idx: number, oleh: string) => Promise<Hasil>;
    tolakPermintaan: (id: string, oleh: string) => Promise<Hasil>;
    batalPermintaan: (id: string, oleh: string) => Promise<Hasil>;
    kirimPermintaan: (id: string, idx: number, oleh: string) => Promise<Hasil>;
    terimaPermintaan: (id: string, idx: number, oleh: string) => Promise<Hasil>;
    tidakTerimaPermintaan: (id: string, idx: number, oleh: string) => Promise<Hasil>;
    tutupTujuanPermintaan: (id: string, idx: number, catatan: string, oleh: string) => Promise<Hasil>;
    selesaiPermintaan: (id: string, oleh: string) => Promise<Hasil>;
  };
  const { kirimNotifikasiPermintaan } = require("../../../lib/notifikasi/permintaanGudang.js") as {
    kirimNotifikasiPermintaan: (a: { aksi: string; permintaan: Record<string, unknown>; tujuan?: unknown }) => Promise<{ terkirim: boolean }>;
  };

  try {
    const aksi = valid.aksi;
    let hasil: Hasil;

    if (aksi === "buat") {
      // Admin hanya boleh minta dari gudangnya sendiri; owner bebas (F5.3).
      const dari = String(valid.dariGudangId ?? "");
      if (role === "admin" && gudangUser && dari !== gudangUser) {
        return json({ ok: false, error: "Anda hanya dapat meminta dari gudang Anda." }, 403);
      }
      if (role === "admin" && !gudangUser) {
        return json({ ok: false, error: "Akun Anda belum punya gudang." }, 403);
      }
      hasil = await model.buatPermintaan({ dari_gudang_id: dari, tujuan: valid.tujuan, items: valid.items, oleh: sesi.uid });
    } else if (aksi === "ubah-item") {
      hasil = await model.ubahItemPermintaan(String(valid.id), valid.items, sesi.uid);
    } else if (aksi === "setujui" || aksi === "setujui-tujuan") {
      hasil = await model.setujuiTujuan(String(valid.id), Number(valid.tujuanIndex), sesi.uid);
    } else if (aksi === "tolak-tujuan") {
      hasil = await model.tolakTujuanPermintaan(String(valid.id), Number(valid.tujuanIndex), sesi.uid);
    } else if (aksi === "tolak") {
      hasil = await model.tolakPermintaan(String(valid.id), sesi.uid);
    } else if (aksi === "batal") {
      hasil = await model.batalPermintaan(String(valid.id), sesi.uid);
    } else if (aksi === "kirim") {
      hasil = await model.kirimPermintaan(String(valid.id), Number(valid.tujuanIndex), sesi.uid);
    } else if (aksi === "terima") {
      hasil = await model.terimaPermintaan(String(valid.id), Number(valid.tujuanIndex), sesi.uid);
    } else if (aksi === "tidak-terima") {
      hasil = await model.tidakTerimaPermintaan(String(valid.id), Number(valid.tujuanIndex), sesi.uid);
    } else if (aksi === "tutup-tujuan") {
      // OWNER ONLY (F5.3).
      if (role !== "owner") {
        return json({ ok: false, error: "Hanya owner yang dapat menutup tujuan." }, 403);
      }
      hasil = await model.tutupTujuanPermintaan(String(valid.id), Number(valid.tujuanIndex), String(valid.catatan), sesi.uid);
    } else if (aksi === "selesai") {
      hasil = await model.selesaiPermintaan(String(valid.id), sesi.uid);
    } else {
      return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
    }

    if (!hasil.ok) {
      console.warn("[permintaan_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, aksi, alasan: hasil.error }));
      return json({ ok: false, error: hasil.error }, hasil.status ?? 400);
    }

    // Notifikasi SETELAH commit (P5/BR10). Fail-safe: gagal notif TIDAK menggagalkan respons.
    try {
      const idx = Number(valid.tujuanIndex);
      const punyaIdx = Number.isInteger(idx) && idx >= 0;
      // PENTING: model mengembalikan { ok, permintaan: { permintaan_id, tujuan, items, ... } }.
      // Data dokumen ada di dalam `hasil.permintaan`, BUKAN di level atas `hasil`.
      const dok = (hasil.permintaan ?? hasil) as Record<string, unknown>;
      const tujuanList = Array.isArray(dok.tujuan) ? (dok.tujuan as unknown[]) : [];
      const tujuanNotif = punyaIdx ? tujuanList[idx] : undefined;
      const notif = await kirimNotifikasiPermintaan({
        aksi: aksi === "setujui-tujuan" ? "setujui" : aksi,   // tolak-tujuan diteruskan apa adanya
        permintaan: dok,
        tujuan: tujuanNotif,
      });
      // Q7: catat hasil notifikasi supaya UI bisa menampilkan peringatan bila gagal.
      // Best-effort - kegagalan catat tidak menggagalkan respons.
      try {
        const { catatNotifikasi } = require("../../../lib/models/permintaanGudang.js") as {
          catatNotifikasi: (id: string, i: number | null, t: boolean) => Promise<void>;
        };
        const idNotif = String(dok.permintaan_id ?? valid.id ?? "");
        if (idNotif) await catatNotifikasi(idNotif, punyaIdx ? idx : null, notif.terkirim === true);
      } catch (e2) {
        console.error("[permintaan_gudang_v5_notif_catat]", JSON.stringify({ pesan: String(e2) }));
      }
    } catch (e) {
      console.error("[permintaan_gudang_v5_notif]", JSON.stringify({ uid: sesi.uid, aksi, pesan: String(e) }));
    }

    console.info("[permintaan_gudang_v5_success]", JSON.stringify({ uid: sesi.uid, aksi }));
    return json(hasil);
  } catch (e) {
    console.error("[permintaan_gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "server", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memproses permintaan." }, 500);
  }
}
