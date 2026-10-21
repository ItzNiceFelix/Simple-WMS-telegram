// app/api/laba/route.ts — Hitung laba per preset (A3, mesin baru hitungLabaPreset).
// POST { aksi:'hitung'|'simpan', presetId, rows, file?, mode? }.
// GET ?aksi=muat&presetId=&tanggal= | ?aksi=list&presetId=&limit= | ?aksi=pdf&presetId=&tanggal= | ?aksi=total&presetId=&dari=&sampai=
//     | ?aksi=overlap&presetId=&dari=&sampai= | ?aksi=export-csv&presetId=&dari=&sampai=.
import { getDb } from "@/lib/d1/db";
import { potongPerTanggal, rentangDariNamaBerkas } from "@/lib/analisa/potongHarian";
import { hitungDanSimpan, siapkanHitung, totalRegistry } from "@/lib/d1/labaPreset";
import { barisCsv, cariOverlap, daftarPerNo } from "@/lib/d1/labaLaporan";
import { bangunPdfLaba } from "@/lib/d1/labaPdf";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

const MAKS_BARIS = 10000;

function presetIdBody(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi");
  const presetId = Number(url.searchParams.get("presetId"));
  if (!Number.isInteger(presetId) || presetId <= 0) {
    return json({ ok: false, error: "presetId wajib diisi." }, 400);
  }
  const db = getDb();

  if (aksi === "muat") {
    const tanggal = (url.searchParams.get("tanggal") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ ok: false, error: "Tanggal harus YYYY-MM-DD." }, 400);
    const snap = await db.prepare("SELECT * FROM laba_snapshot WHERE preset_id = ? AND tanggal = ?")
      .bind(presetId, tanggal).first<Record<string, unknown>>();
    if (!snap) return json({ ok: true, snapshot: null });
    return json({
      ok: true,
      snapshot: {
        tanggal: snap["tanggal"], jml_order: snap["jml_order"], jml_baris: snap["jml_baris"],
        omzet: snap["omzet"], hpp: snap["hpp"], biaya: snap["biaya"], pajak: (snap["pajak"] as number) ?? 0, laba: snap["laba"],
        tolak: JSON.parse(String(snap["tolak_json"] ?? "[]")),
        rincian: JSON.parse(String(snap["rincian_json"] ?? "[]")),
        peringatan: JSON.parse(String(snap["peringatan_json"] ?? "[]")),
        file: snap["file"],
      },
    });
  }

  if (aksi === "list") {
    const limitRaw = Number(url.searchParams.get("limit") ?? "30");
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 30;
    const { results } = await db.prepare(
      "SELECT tanggal, jml_order, laba FROM laba_snapshot WHERE preset_id = ? ORDER BY tanggal DESC LIMIT ?"
    ).bind(presetId, limit).all<{ tanggal: string; jml_order: number; laba: number }>();
    return json({ ok: true, daftar: results });
  }

  if (aksi === "pdf") {
    const tanggal = (url.searchParams.get("tanggal") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ ok: false, error: "Tanggal harus YYYY-MM-DD." }, 400);
    const snap = await db.prepare("SELECT * FROM laba_snapshot WHERE preset_id = ? AND tanggal = ?")
      .bind(presetId, tanggal).first<Record<string, unknown>>();
    if (!snap) return json({ ok: false, error: "Snapshot tidak ditemukan." }, 404);
    const preset = await db.prepare("SELECT nama, status_toko FROM seller_presets WHERE id = ?")
      .bind(presetId).first<{ nama: string; status_toko: string }>();
    const omzet = Number(snap["omzet"] ?? 0);
    const laba = Number(snap["laba"] ?? 0);
    const pdf = await bangunPdfLaba({
      presetNama: preset?.nama ?? `#${presetId}`, statusToko: preset?.status_toko ?? "-",
      tanggal: String(snap["tanggal"]), file: String(snap["file"] ?? ""),
      jml_order: Number(snap["jml_order"] ?? 0), jml_baris: Number(snap["jml_baris"] ?? 0),
      omzet, hpp: Number(snap["hpp"] ?? 0), biaya: Number(snap["biaya"] ?? 0),
      pajak: Number(snap["pajak"] ?? 0), laba, margin: omzet > 0 ? (laba / omzet) * 100 : 0,
      tolak: JSON.parse(String(snap["tolak_json"] ?? "[]")),
      peringatan: JSON.parse(String(snap["peringatan_json"] ?? "[]")),
      rincian: JSON.parse(String(snap["rincian_json"] ?? "[]")),
    });
    return new Response(pdf as unknown as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="laba-${presetId}-${tanggal}.pdf"`,
      },
    });
  }
  if (aksi === "total") {
    const dari = (url.searchParams.get("dari") ?? "").trim();
    const sampai = (url.searchParams.get("sampai") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dari) || !/^\d{4}-\d{2}-\d{2}$/.test(sampai)) return json({ ok: false, error: "dari/sampai harus YYYY-MM-DD." }, 400);
    return json({ ok: true, total: await totalRegistry(db, presetId, dari, sampai) });
  }
  // Lapis 3: daftar No. Pesanan yang dihitung dobel (muncul di >1 tanggal_snapshot).
  if (aksi === "overlap") {
    const dari = (url.searchParams.get("dari") ?? "").trim();
    const sampai = (url.searchParams.get("sampai") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dari) || !/^\d{4}-\d{2}-\d{2}$/.test(sampai)) return json({ ok: false, error: "dari/sampai harus YYYY-MM-DD." }, 400);
    return json({ ok: true, ...(await cariOverlap(db, presetId, dari, sampai)) });
  }
  // Lapis 3: export CSV per No dari registry (bukan agregat SKU).
  if (aksi === "export-csv") {
    const dari = (url.searchParams.get("dari") ?? "").trim();
    const sampai = (url.searchParams.get("sampai") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dari) || !/^\d{4}-\d{2}-\d{2}$/.test(sampai)) return json({ ok: false, error: "dari/sampai harus YYYY-MM-DD." }, 400);
    const csv = barisCsv(await daftarPerNo(db, presetId, dari, sampai));
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="laba-${presetId}-${dari}_${sampai}.csv"`,
      },
    });
  }
  return json({ ok: false, error: "Aksi tidak dikenal (muat/list/pdf/total/overlap/export-csv)." }, 400);
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  if (aksi !== "hitung" && aksi !== "simpan") return json({ ok: false, error: "Aksi tidak dikenal (hitung/simpan)." }, 400);

  const presetId = presetIdBody(body.presetId);
  if (!presetId) return json({ ok: false, error: "presetId wajib diisi." }, 400);
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) return json({ ok: false, error: "Rows kosong." }, 400);
  if (rows.length > MAKS_BARIS) return json({ ok: false, error: `Maksimal ${MAKS_BARIS} baris per hitung.` }, 400);
  const file = typeof body.file === "string" ? body.file.trim().slice(0, 120) : "";

  const db = getDb();

  // ── Potong per tanggal penjualan ──
  // Satu export Order.all memuat rentang (mis. 7 hari). Snapshot disimpan per tanggal, jadi
  // file dipotong dulu; `tanggal` yang diketik user TIDAK dipakai lagi — itu sumber
  // snapshot tumpang-tindih di produksi (satu rentang masuk ke satu tanggal).
  const potongan = potongPerTanggal(
    rows as Record<string, unknown>[],
    rentangDariNamaBerkas(file)
  );
  if (potongan.perTanggal.length === 0) {
    return json({
      ok: false,
      error:
        "Tidak ada baris dengan kolom \"Waktu Pesanan Dibuat\" yang terbaca — tanggal penjualan " +
        `tidak bisa ditentukan (${potongan.tanpaTanggal} baris tanpa tanggal). Periksa berkasnya.`,
    }, 422);
  }

  const mode = body.mode === "timpa_semua" ? "timpa_semua" : "tambah_baru";
  const tanggalAwal = potongan.tanggalPenuh[0] ?? potongan.perTanggal[0].tanggal;

  // Konteks D-5 SATU berkas: status semua No (semua tanggal) + rentang tanggalnya.
  // Tanpa ini, tiap tanggal yang dihitung menuduh order tanggal lain "hilang dari file".
  const statusBerkas = new Map<string, string>();
  for (const p of potongan.perTanggal) {
    for (const r of p.baris) {
      const no = String(r["No. Pesanan"] ?? "").trim();
      if (no) statusBerkas.set(no, String(r["Status Pesanan"] ?? "").trim());
    }
  }
  const tanggalUrut = potongan.perTanggal.map((p) => p.tanggal);
  const berkas = {
    status: statusBerkas,
    dari: tanggalUrut[0],
    sampai: tanggalUrut[tanggalUrut.length - 1],
  };

  // Konteks kumulatif: syarat berbasis volume dinilai "sampai tanggal ini", bukan per hari.
  // Dihitung sekali di awal agar satu file = satu pembacaan registry, bukan satu per tanggal.
  const siap = await siapkanHitung(db, presetId, tanggalAwal);
  if (!siap) return json({ ok: false, error: "Preset tidak ditemukan." }, 404);

  let agregat;
  let klasifikasi;
  const ringkasTanggal: { tanggal: string; jml_order: number; omzet: number; laba: number; parsial: boolean }[] = [];
  try {
    for (const p of potongan.perTanggal) {
      const hasil = await hitungDanSimpan(
        db, siap, p.baris, file, p.tanggal, user.tg_id, aksi === "simpan", mode, berkas
      );
      // Agregat yang dikembalikan = jumlah seluruh tanggal pada berkas; angka per tanggal
      // tetap tersedia di `ringkasTanggal` supaya UI bisa memeriksa potongannya.
      ringkasTanggal.push({
        tanggal: p.tanggal,
        jml_order: hasil.agregat.jml_order,
        omzet: hasil.agregat.omzet,
        laba: hasil.agregat.laba,
        parsial: potongan.tanggalParsial.includes(p.tanggal),
      });
      agregat = hasil.agregat;
      klasifikasi = hasil.klasifikasi;
    }
  } catch (e) {
    // Lapis 2 D-1: simpan diblokir (SKU tanpa kategori) → 422 dengan pesan jelas.
    return json({ ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan perhitungan." }, 422);
  }

  const ringkas = {
    tanggal: ringkasTanggal,
    tanggalPenuh: potongan.tanggalPenuh,
    tanggalParsial: potongan.tanggalParsial,
    tanpaTanggal: potongan.tanpaTanggal,
  };
  if (aksi === "hitung") {
    return json({ ok: true, agregat, klasifikasi, ...ringkas, estimasi_kasar: agregat?.estimasi_kasar ?? false });
  }
  return json({ ok: true, agregat, klasifikasi, ...ringkas, estimasi_kasar: agregat?.estimasi_kasar ?? false });
}
