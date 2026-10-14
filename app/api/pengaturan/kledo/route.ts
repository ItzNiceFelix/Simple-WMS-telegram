// app/api/pengaturan/kledo/route.ts — Setelan + sinkronisasi Kledo.
//
// BATAS MUTLAK: modul ini HANYA MEMBACA Kledo. Tidak ada POST/PUT/DELETE ke Kledo.
// Satu-satunya permintaan ke Kledo adalah GET (lihat lib/kledo/klien.ts).
//
// GET  ?aksi=ringkas|galat         → baca (owner)
// POST { aksi } → tulis (owner). Aksi:
//   simpan | aktif | hapus | uji | sinkron
//
// Token TIDAK PERNAH dikembalikan sebagai plaintext. Hanya mask (••••3f2a).
import { getDb, getKunciEnkripsi } from "@/lib/d1/db";
import {
  ambilKledoById,
  catatUjiKledo,
  daftarKledo,
  hapusKledo,
  setAktifKledo,
  simpanKledo,
} from "@/lib/d1/kledoKredensial";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { ujiKoneksi } from "@/lib/kledo/klien";
import { adaSinkronBerjalan, galatTerakhir, jalankanSinkron, sinkronTerakhir } from "@/lib/kledo/sinkron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 120);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);

  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi") ?? "ringkas";
  const db = getDb();

  if (aksi === "ringkas") {
    const terakhir = await sinkronTerakhir(db);
    return json({
      ok: true,
      kredensial: await daftarKledo(db),
      kunci_enkripsi_ada: getKunciEnkripsi().length > 0,
      sinkron: terakhir,
      galat: terakhir ? await galatTerakhir(db, terakhir.id, 20) : [],
      sedang_jalan: await adaSinkronBerjalan(db),
    });
  }
  if (aksi === "galat") {
    const id = Number(url.searchParams.get("id") ?? "0");
    return json({ ok: true, galat: await galatTerakhir(db, id, 100) });
  }
  return json({ ok: false, error: `Aksi tidak dikenal: ${aksi}` }, 400);
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah integrasi Kledo." }, 403);

  const db = getDb();
  const body = await bacaBody(request);
  const aksi = teks(body.aksi);
  const oleh = String(sesi.user.tg_id ?? "");

  if (aksi === "simpan") {
    const r = await simpanKledo(
      db,
      {
        subdomain: teks(body.subdomain),
        label: teks(body.label).slice(0, 120),
        token: teks(body.token),
        oleh,
      },
      getKunciEnkripsi()
    );
    return json(r, r.ok ? 200 : r.status);
  }

  if (aksi === "aktif") {
    const r = await setAktifKledo(db, Number(body.id), body.aktif === true || body.aktif === 1);
    return json(r, r.ok ? 200 : r.status);
  }

  if (aksi === "hapus") {
    const r = await hapusKledo(db, Number(body.id));
    return json(r, r.ok ? 200 : r.status);
  }

  if (aksi === "uji") {
    const id = Number(body.id);
    const kred = id > 0 ? await ambilKledoById(db, id, getKunciEnkripsi()) : null;
    if (!kred) return json({ ok: false, error: "Kredensial tidak ditemukan atau token tidak bisa didekripsi." }, 404);
    const h = await ujiKoneksi({ subdomain: kred.subdomain, token: kred.token });
    await catatUjiKledo(db, kred.id, h.ok ? { ok: true, pesan: `${h.data.jumlahGudang} gudang` } : { ok: false, pesan: h.error });
    if (!h.ok) return json({ ok: false, error: h.error }, 400);
    return json({ ok: true, jumlahGudang: h.data.jumlahGudang });
  }

  if (aksi === "sinkron") {
    // Pagar anti-tumpang-tindih: dua sinkron bersamaan akan berebut angka stok yang sama.
    if (await adaSinkronBerjalan(db)) {
      return json({ ok: false, error: "Sinkronisasi lain masih berjalan. Tunggu sampai selesai." }, 409);
    }
    // Tanpa id → pakai kredensial aktif pertama.
    const diminta = Number(body.id);
    const kred = diminta > 0
      ? await ambilKledoById(db, diminta, getKunciEnkripsi())
      : await (async () => {
          const semua = await daftarKledo(db);
          const pertama = semua.find((k) => k.aktif === 1);
          return pertama ? ambilKledoById(db, pertama.id, getKunciEnkripsi()) : null;
        })();
    if (!kred) return json({ ok: false, error: "Belum ada kredensial Kledo aktif, atau token tidak bisa didekripsi." }, 400);

    const h = await jalankanSinkron(db, { subdomain: kred.subdomain, token: kred.token }, { pemicu: "manual", oleh });
    return json({ ok: h.status !== "gagal", ...h }, h.status === "gagal" ? 502 : 200);
  }

  return json({ ok: false, error: `Aksi tidak dikenal: ${aksi}` }, 400);
}
