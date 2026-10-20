// app/api/analisa/peta/route.ts — Tool tanya SKU (impor performa + jawaban batch).
//
// GET  ?aksi=pertanyaan&semua=0|1   → daftar pertanyaan yang menunggu jawaban
// POST { aksi:'impor-performa', file } → unggah xlsx Performa Produk Shopee
// POST { aksi:'jawab', jawaban:[{jenis, acuan, sku}] } → simpan jawaban batch
//
// ATURAN MENGIKAT: sistem TIDAK PERNAH menebak SKU. Pertanyaan yang belum dijawab tetap
// ada di daftar dan barisnya TIDAK dipakai analisa. Kandidat hanya untuk tampilan.
import { getDb } from "@/lib/d1/db";
import { json, sesiRoute } from "@/lib/d1/route";
import { imporPerforma } from "@/lib/d1/shopeePetaImpor";
import {
  daftarPertanyaanBelum,
  daftarPertanyaanSemua,
  daftarSkuMaster,
  jawabPertanyaan,
  type JawabanSku,
} from "@/lib/d1/shopeePeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batas ukuran unggahan: file performa nyata ~180 KB; 8 MB sudah sangat longgar. */
const MAKS_BYTE = 8 * 1024 * 1024;

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const url = new URL(request.url);
  const db = getDb();
  const semua = url.searchParams.get("semua") === "1";
  // Toko WAJIB: pertanyaan milik toko lain tidak boleh tampil di sini (lihat migrasi 0044).
  const presetId = Number(url.searchParams.get("presetId"));
  if (!Number.isInteger(presetId) || presetId <= 0) {
    return json({ ok: false, error: "presetId wajib diisi." }, 400);
  }
  // Satu kali baca saja: `semua=1` mengambil seluruh baris (termasuk yang sudah diputuskan),
  // lalu dipisah di memori. Dua kali baca hanya membebani D1 tanpa manfaat.
  const daftar = semua ? await daftarPertanyaanSemua(db, presetId) : await daftarPertanyaanBelum(db, presetId);
  const belum = semua ? daftar.filter((p) => p.diputuskanSku === null) : daftar;
  const diputuskan = semua ? daftar.filter((p) => p.diputuskanSku !== null) : [];

  return json({
    ok: true,
    pertanyaan: belum,
    diputuskan,
    jumlah: belum.length,
    berpesanan: belum.filter((p) => p.pesanan > 0).length,
  });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 10);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const db = getDb();
  const oleh = String(sesi.user.tg_id ?? "");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Body bukan JSON yang sah." }, 400);
  }
  const aksi = String(body.aksi ?? "").trim();

  if (aksi === "impor-performa") {
    const base64 = String(body.file ?? "").trim();
    if (!base64) return json({ ok: false, error: "File belum dipilih." }, 400);
    let buf: Uint8Array<ArrayBuffer>;
    try {
      const biner = atob(base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64);
      buf = new Uint8Array(new ArrayBuffer(biner.length));
      for (let i = 0; i < biner.length; i++) buf[i] = biner.charCodeAt(i);
    } catch {
      return json({ ok: false, error: "File tidak bisa dibaca (base64 tidak sah)." }, 400);
    }
    if (buf.length > MAKS_BYTE) {
      return json({ ok: false, error: `File terlalu besar (${Math.round(buf.length / 1024)} KB; maks 8 MB).` }, 413);
    }
    // Parse xlsx bisa melempar kalau berkasnya bukan Excel atau rusak. Ditangkap di sini
    // supaya user dapat pesan yang bisa ditindaklanjuti, bukan 500 tanpa keterangan.
    // `presetId` = toko pemilik angka; tabel `performa_produk` berkunci (preset, periode, sku)
    // sehingga tanpa ini angka dua toko saling menimpa. DITOLAK bila kosong: dulu nilai 0
    // diteruskan apa adanya, lalu INSERT-nya gagal FK (atau menulis baris yatim) sementara
    // /sinkronisasi mencatat "sukses".
    const presetId = Number(body.presetId);
    if (!Number.isInteger(presetId) || presetId <= 0) {
      return json({ ok: false, error: "Pilih toko dulu sebelum mengimpor performa." }, 400);
    }
    try {
      const h = await imporPerforma(db, buf.buffer as ArrayBuffer, oleh, presetId);
      return json(h, 200);
    } catch (e) {
      return json({ ok: false, error: `Berkas tidak bisa dibaca sebagai Excel: ${e instanceof Error ? e.message : "tidak diketahui"}.` }, 400);
    }
  }
  if (aksi === "jawab") {
    // TIGA KEADAAN yang berbeda — jangan dicampur:
    //   diputuskan_at IS NULL                    → belum dijawab, tetap tampil di daftar pertanyaan
    //   diputuskan_sku = "" + diputuskan_at terisi → SENGAJA DIABAIKAN user ("bukan produk kita"), jangan tampil lagi
    //   diputuskan_sku = "SKU-XYZ"               → dipetakan, jangan tampil lagi
    // Karena itu `sku: ""` di sini SAH: ia menandai baris sudah diputuskan (diputuskan_at diisi),
    // bukan dianggap "belum dijawab". Tanpa ini user dipaksa menjawab produk yang tidak ada di sistem.
    const presetId = Number(body.presetId);
    if (!Number.isInteger(presetId) || presetId <= 0) {
      return json({ ok: false, error: "presetId wajib diisi." }, 400);
    }
    const mentah = Array.isArray(body.jawaban) ? body.jawaban : [];
    if (mentah.length === 0) return json({ ok: false, error: "Tidak ada jawaban yang dikirim." }, 400);

    // Ambil daftar SKU master SEKALI untuk memvalidasi semua jawaban sekaligus.
    const jawaban: JawabanSku[] = [];
    const skuDiminta: string[] = [];
    for (const it of mentah) {
      const o = it as Record<string, unknown>;
      const jenis = String(o.jenis ?? "").trim();
      const acuan = String(o.acuan ?? "").trim();
      const sku = String(o.sku ?? "").trim();
      if (jenis !== "tanpa_sku" && jenis !== "sku_tak_ada_master") continue;
      if (!acuan) continue;
      jawaban.push({ jenis, acuan, sku });
      if (sku) skuDiminta.push(sku);
    }
    if (jawaban.length === 0) return json({ ok: false, error: "Tidak ada jawaban yang sah." }, 400);

    const master = await daftarSkuMaster(db, skuDiminta);

    // Validasi: SKU yang diisi WAJIB ada di master. Kalau tidak, jawaban itu DITOLAK —
    // menyimpan SKU asing membuat pemetaan menunjuk produk yang tidak ada, dan itu
    // lebih buruk daripada tidak dipetakan ("salah diam-diam").
    const sah: JawabanSku[] = [];
    const ditolak: { acuan: string; sku: string; alasan: string }[] = [];
    for (const j of jawaban) {
      if (j.sku === "") {
        sah.push(j); // "" = "bukan produk kita", sah dan disengaja
        continue;
      }
      if (master.has(j.sku)) {
        sah.push(j);
      } else {
        ditolak.push({ acuan: j.acuan, sku: j.sku, alasan: `SKU "${j.sku}" tidak ada di master produk.` });
      }
    }
    if (sah.length === 0) {
      return json({ ok: false, error: "Semua jawaban ditolak.", ditolak }, 400);
    }

    const h = await jawabPertanyaan(db, presetId, sah, oleh);
    if (!h.ok) return json(h, h.status);
    // `h` sudah memuat ok:true; tambahkan `ditolak` tanpa menimpa `ok`.
    return json({ ...h, ditolak });
  }

  return json({ ok: false, error: `Aksi tidak dikenal: ${aksi}` }, 400);
}
