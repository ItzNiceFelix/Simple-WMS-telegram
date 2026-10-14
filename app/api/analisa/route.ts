// app/api/analisa/route.ts — Analisa produk (cepat + mendalam).
//
// GET  ?aksi=preset                      → daftar preset + tanggal snapshot tersedia
// GET  ?aksi=cepat&presetId=&tanggal=    → analisa cepat (angka murni, tanpa AI)
// GET  ?aksi=saran-iklan&presetId=&tanggal= → ROAS titik impas + urutan prioritas
// POST { aksi:'mendalam', ... }          → narasi AI (T8; dibalas jelas bila belum siap)
//
// PRINSIP: angka SELALU dari lib/analisa/hitung.ts. AI tidak pernah menghitung.
// Karena itu endpoint `cepat` tidak menyentuh AI sama sekali.
import { getDb } from "@/lib/d1/db";
import {
  adaPerforma, ambilSnapshot, daftarPresetAnalisa, daftarTanggalSnapshot,
  petaHppMaster, petaStok, totalIklanPeriode,
} from "@/lib/d1/analisa";
import { json, sesiRoute } from "@/lib/d1/route";
import {
  analisaCepat, janganDiiklankan, urutSaranIklan,
  AMBANG_MARGIN_TIPIS, type MasukanAnalisa,
} from "@/lib/analisa/hitung";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rentang tanggal periode: dari tanggal-7 hari sampai tanggal (inklusif). */
function rentangMundur(tanggal: string, hari: number): { dari: string; sampai: string } {
  const d = new Date(`${tanggal}T00:00:00Z`);
  const dari = new Date(d.getTime() - hari * 86400000).toISOString().slice(0, 10);
  return { dari, sampai: tanggal };
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi") ?? "preset";
  const db = getDb();

  if (aksi === "preset") {
    const preset = await daftarPresetAnalisa(db);
    const pertama = preset[0]?.id ?? 0;
    const tanggal = pertama > 0 ? await daftarTanggalSnapshot(db, pertama) : [];
    return json({ ok: true, preset, tanggal });
  }

  const presetId = Number(url.searchParams.get("presetId"));
  if (!Number.isInteger(presetId) || presetId <= 0) {
    return json({ ok: false, error: "presetId wajib diisi." }, 400);
  }
  const tanggal = (url.searchParams.get("tanggal") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return json({ ok: false, error: "Tanggal harus YYYY-MM-DD." }, 400);
  }

  const snap = await ambilSnapshot(db, presetId, tanggal);
  if (!snap) {
    return json({ ok: false, error: `Belum ada data laba untuk ${tanggal}. Impor file laba dulu di halaman Laba.` }, 404);
  }

  const semuaTanggal = await daftarTanggalSnapshot(db, presetId);
  const { dari, sampai } = rentangMundur(tanggal, 6);
  const [hppMaster, stok, biayaIklan, performaAda] = await Promise.all([
    petaHppMaster(db, snap.rincian.map((r) => r.sku)),
    petaStok(db),
    totalIklanPeriode(db, presetId, dari, sampai),
    adaPerforma(db, presetId),
  ]);

  const masukan: MasukanAnalisa = {
    presetId,
    periode: tanggal,
    snapshot: {
      jml_order: snap.jml_order, omzet: snap.omzet, hpp: snap.hpp,
      biaya: snap.biaya, pajak: snap.pajak, laba: snap.laba, rincian: snap.rincian,
    },
    hppMaster,
    stok,
    biayaIklan,
    jmlSnapshot: semuaTanggal.length,
    adaPerforma: performaAda,
  };

  const hasil = analisaCepat(masukan);

  if (aksi === "cepat") {
    return json({ ok: true, ...hasil, tanggalTersedia: semuaTanggal, ambangMarginTipis: AMBANG_MARGIN_TIPIS });
  }

  if (aksi === "saran-iklan") {
    // Batas keras: angka ini TITIK IMPAS dari biaya sendiri, bukan target dari platform.
    // Kalimat keterbatasan dikirim dari server supaya UI tidak bisa lupa menampilkannya.
    const aman = urutSaranIklan(hasil.baris);
    const jangan = janganDiiklankan(hasil.baris);
    return json({
      ok: true,
      aman: aman.slice(0, 50),
      jangan: jangan.slice(0, 50),
      jumlahAman: aman.length,
      jumlahJangan: jangan.length,
      biayaIklan,
      adaBiayaIklan: biayaIklan !== null,
      keterbatasan:
        "Angka ini TITIK IMPAS, dihitung dari biaya toko Anda sendiri (HPP, admin, program, pajak). " +
        "Bukan target yang dijamin menguntungkan. Perilaku setelan iklan Shopee (GMV MAX/AUTO ROAS) " +
        "tidak dapat diverifikasi sistem ini — uji dengan anggaran kecil dan pantau hasilnya " +
        "sebelum menerapkan menyeluruh.",
    });
  }

  return json({ ok: false, error: `Aksi tidak dikenal: ${aksi}` }, 400);
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 10);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  return json(
    {
      ok: false,
      error:
        "Analisa mendalam (AI) belum tersedia. Analisa cepat di halaman ini sudah lengkap dan tidak butuh AI — " +
        "angka dihitung dari data Anda sendiri sehingga bisa diaudit.",
    },
    501
  );
}
