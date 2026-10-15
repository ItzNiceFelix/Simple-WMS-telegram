// app/api/analisa/route.ts — Analisa produk (cepat + mendalam).
//
// GET  ?aksi=preset                      → daftar preset + tanggal snapshot tersedia
// GET  ?aksi=cepat&presetId=&tanggal=    → analisa cepat (angka murni, tanpa AI)
// GET  ?aksi=saran-iklan&presetId=&tanggal= → ROAS titik impas + urutan prioritas
// GET  ?aksi=estimasi-iklan&presetId=&items=sku:modal:target,… → estimasi per SKU (angka murni)
// POST { aksi:'mendalam', ... }          → narasi AI (T8; dibalas jelas bila belum siap)
// POST { aksi:'mendalam-stream', ... }   → narasi AI sebagai text/event-stream (potongan bertahap)
//
// PRINSIP: angka SELALU dari lib/analisa/hitung.ts. AI tidak pernah menghitung.
// Karena itu endpoint `cepat` tidak menyentuh AI sama sekali.
import { getDb, getEnvAi, getKunciEnkripsi } from "@/lib/d1/db";
import {
  adaPerforma, ambilSnapshot, daftarPresetAnalisa, daftarTanggalSnapshot, historiPerSku,
  metrikIklanPerSku, performaPerSku, petaHppMaster, petaStok, totalIklanPeriode,
} from "@/lib/d1/analisa";
import type { MasukanEstimasi } from "@/lib/analisa/iklanEstimasi";
import { estimasiIklan, ringkasEstimasi } from "@/lib/analisa/iklanEstimasi";
import { ambilSettingAnalisa } from "@/lib/d1/aiAnalisaSetting";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { imporIklan, parseIklan } from "@/lib/d1/adsProduk";
import { petaSkuDariKodeProduk } from "@/lib/d1/shopeePeta";
import { analisaMendalam, susunBahan, susunPesanMendalam, type Kedalaman } from "@/lib/analisa/ai";
import { panggilTeksStream } from "@/lib/ai/provider";
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

/** Kedalaman narasi AI dari permintaan; tak dikenal/kosong = "sedang" (perilaku lama). */
function bacaKedalaman(v: unknown): Kedalaman {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "ringkas" || t === "panjang" ? t : "sedang";
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi") ?? "preset";
  const db = getDb();

  if (aksi === "estimasi-iklan") {
    // Dihitung dari histori per SKU (lib/d1) + lib/analisa/iklanEstimasi (murni).
    // Sengaja SEBELUM validasi tanggal: estimasi ini per SKU, bukan per tanggal.
    const idPreset = Number(url.searchParams.get("presetId"));
    if (!Number.isInteger(idPreset) || idPreset <= 0) {
      return json({ ok: false, error: "presetId wajib diisi." }, 400);
    }
    const histori = await historiPerSku(db, idPreset);

    // `items` = "sku:modal:target" dipisah koma. Tiap SKU punya modal & target sendiri,
    // jadi tidak bisa dikirim lewat parameter bersama tanpa mencampur biaya antar SKU.
    const mentah = (url.searchParams.get("items") ?? "").trim();
    if (mentah === "") {
      // Belum ada pilihan → balas daftar SKU yang PUNYA histori supaya UI bisa menawarkan.
      const tersedia = [...histori.entries()]
        .map(([sku, hari]) => ({ sku, jmlHari: hari.length }))
        .sort((a, b) => a.sku.localeCompare(b.sku));
      return json({ ok: true, items: [], baris: [], tersedia });
    }

    const diminta: MasukanEstimasi[] = [];
    for (const potong of mentah.split(",")) {
      const [skuMentah, modalMentah, targetMentah] = potong.split(":");
      const sku = (skuMentah ?? "").trim();
      if (sku === "") continue; // potongan rusak dilewati, bukan membatalkan seluruh permintaan
      const modalIklan = Number((modalMentah ?? "").trim() || 0);
      const targetRoas = Number((targetMentah ?? "").trim() || 0);
      diminta.push({
        sku,
        nama: null,
        histori: histori.get(sku) ?? [],
        modalIklan: Number.isFinite(modalIklan) && modalIklan > 0 ? modalIklan : 0,
        targetRoas: Number.isFinite(targetRoas) && targetRoas > 0 ? targetRoas : 0,
      });
    }

    const hppMaster = await petaHppMaster(db, diminta.map((d) => d.sku));
    const baris = diminta.map((d) =>
      estimasiIklan({ ...d, hppMaster: hppMaster.get(d.sku) ?? null })
    );
    return json({ ok: true, baris, ringkas: ringkasEstimasi(baris) });
  }

  if (aksi === "preset") {
    const preset = await daftarPresetAnalisa(db);
    // Tanggal dikembalikan PER PRESET, bukan hanya untuk preset pertama. Snapshot tidak
    // selalu ada di preset pertama (di produksi: preset 1 kosong, preset 2 punya 3 snapshot),
    // dan mengasumsikan preset pertama membuat halaman tampil kosong padahal datanya ada.
    const petaTanggal: Record<string, string[]> = {};
    for (const p of preset) {
      petaTanggal[String(p.id)] = await daftarTanggalSnapshot(db, p.id);
    }
    const pertamaDenganData = preset.find((p) => (petaTanggal[String(p.id)] ?? []).length > 0) ?? preset[0];
    const idAwal = pertamaDenganData?.id ?? 0;
    return json({
      ok: true,
      preset,
      tanggal: idAwal > 0 ? (petaTanggal[String(idAwal)] ?? []) : [],
      presetAwal: idAwal,
      tanggalPerPreset: petaTanggal,
    });
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
  const [hppMaster, stok, biayaIklan, performaAda, iklanPerSku, performa] = await Promise.all([
    petaHppMaster(db, snap.rincian.map((r) => r.sku)),
    petaStok(db),
    totalIklanPeriode(db, presetId, dari, sampai),
    adaPerforma(db, presetId),
    metrikIklanPerSku(db, presetId, dari, sampai),
    performaPerSku(db, presetId, tanggal),
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
    iklanPerSku,
    performaPerSku: performa,
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
  const sesi = await sesiRoute(request, 5);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const db = getDb();
  const oleh = String(sesi.user.tg_id ?? "");
  const body = await bacaBody(request);
  const aksi = String(body.aksi ?? "").trim();

  if (aksi === "impor-iklan") {
    const presetId = Number(body.presetId);
    if (!Number.isInteger(presetId) || presetId <= 0) {
      return json({ ok: false, error: "presetId wajib diisi." }, 400);
    }
    const teks = String(body.teks ?? "");
    if (!teks.trim()) return json({ ok: false, error: "Isi berkas iklan kosong." }, 400);

    // Peta Kode Produk → SKU dibaca dari `shopee_produk` (hasil impor Performa Produk).
    // Tanpa peta, baris iklan tidak bisa dipastikan milik SKU mana — dan menebak lewat
    // kemiripan nama DILARANG untuk data uang.
    // Kode produk diambil lewat `parseIklan` (bukan split koma) karena nama iklan bisa
    // memuat koma di dalam tanda kutip — split naif akan menggeser kolomnya.
    const kode = [...new Set(parseIklan(teks).baris.map((b) => b.kodeProduk))];
    const petaArr = await petaSkuDariKodeProduk(db, kode.slice(0, 500));
    const peta = new Map<string, string>();
    for (const [kp, daftar] of petaArr) {
      // SKU variasi sudah didahulukan oleh query; ambil yang pertama sebagai pilihan utama.
      if (daftar.length > 0) peta.set(kp, daftar[0].sku);
    }

    const h = await imporIklan(db, teks, presetId, oleh, peta);
    return json(h, h.ok ? 200 : h.status);
  }

  if (aksi !== "mendalam" && aksi !== "mendalam-stream") {
    return json({ ok: false, error: `Aksi tidak dikenal: ${aksi || "(kosong)"}` }, 400);
  }

  if (aksi === "mendalam-stream") {
    // Dijalankan lewat alirMendalam: seluruh validasi yang gagal SEBELUM stream dimulai
    // pun tetap dibalas sebagai event error (lihat komentar di fungsinya).
    return alirMendalam(db, oleh, body);
  }

  // Rakit ulang masukan yang SAMA dengan endpoint cepat, supaya AI menerima angka
  // yang persis sama dengan yang dilihat user di halaman. Kalau dihitung terpisah,
  // narasi dan tabel bisa berbeda dan tidak ada yang tahu mana yang benar.
  const presetId = Number(body.presetId);
  const tanggal = String(body.tanggal ?? "").trim();
  if (!Number.isInteger(presetId) || presetId <= 0) {
    return json({ ok: false, error: "presetId wajib diisi." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return json({ ok: false, error: "Tanggal harus YYYY-MM-DD." }, 400);
  }
  const snap = await ambilSnapshot(db, presetId, tanggal);
  if (!snap) return json({ ok: false, error: `Belum ada data laba untuk ${tanggal}.` }, 404);

  const semuaTanggal = await daftarTanggalSnapshot(db, presetId);
  const { dari, sampai } = rentangMundur(tanggal, 6);
  const [hppMaster, stok, biayaIklan, performaAda, iklanPerSku, performa] = await Promise.all([
    petaHppMaster(db, snap.rincian.map((r) => r.sku)),
    petaStok(db),
    totalIklanPeriode(db, presetId, dari, sampai),
    adaPerforma(db, presetId),
    metrikIklanPerSku(db, presetId, dari, sampai),
    performaPerSku(db, presetId, tanggal),
  ]);

  const hasil = analisaCepat({
    presetId,
    periode: tanggal,
    snapshot: {
      jml_order: snap.jml_order, omzet: snap.omzet, hpp: snap.hpp,
      biaya: snap.biaya, pajak: snap.pajak, laba: snap.laba, rincian: snap.rincian,
    },
    hppMaster,
    stok,
    biayaIklan,
    iklanPerSku,
    performaPerSku: performa,
    jmlSnapshot: semuaTanggal.length,
    adaPerforma: performaAda,
  });

  // Reasoning + plafon token + kedalaman dari pengaturan PER USER; kosong = default model.
  const setting = await ambilSettingAnalisa(db, oleh);
  const kedalaman = bacaKedalaman(setting.kedalaman);
  const hasilAi = await analisaMendalam(
    { db, kunci: getKunciEnkripsi(), env: getEnvAi() },
    hasil,
    {
      reasoning: setting.reasoning,
      maksToken: setting.maks_token,
      kedalaman,
    }
  );
  if (!hasilAi.ok) {
    // `upaya` = daftar provider/model yang dicoba + alasan tiap kegagalan (timeout berapa
    // milidetik, status berapa). Tanpa ini user hanya tahu "gagal" dan tidak bisa membedakan
    // model yang mengantre di sisi penyedia dari kredensial yang salah. Tidak memuat kredensial.
    return json(
      { ok: false, error: hasilAi.error, upaya: hasilAi.upaya ?? [], reasoning: setting.reasoning || "(default model)", kedalaman },
      hasilAi.status
    );
  }

  return json({
    ok: true,
    ...hasilAi.data,
    reasoning: setting.reasoning || "(default model)",
    kedalaman,
  });
}

/**
 * Narasi AI sebagai text/event-stream (`aksi=mendalam-stream`).
 * Alasan endpoint terpisah, bukan mengubah `mendalam`: pemakai lama (halaman/klien
 * yang menunggu JSON utuh) tidak boleh berubah perilakunya hanya karena ada jalur baru.
 * Gate sesi/role SAMA seperti aksi lain — streaming bukan alasan melewati pemeriksaan.
 */
async function alirMendalam(
  db: D1Database,
  oleh: string,
  body: Record<string, unknown>
): Promise<Response> {
  const presetId = Number(body.presetId);
  const tanggal = String(body.tanggal ?? "").trim();
  const encoder = new TextEncoder();
  // Error sebelum potongan pertama TIDAK dikembalikan sebagai status bukan-200: header
  // sudah terkirim saat stream dimulai, jadi status tak bisa diubah lagi dan klien
  // hanya akan melihat "gagal membaca respons". Karena itu kesalahan dikirim sebagai
  // event `{"error": "..."}` dengan status tetap 200, dan komentar di bawah menjelaskan
  // kontraknya ke pemanggil.
  const alir = new ReadableStream<Uint8Array>({
    async start(controller) {
      const kirim = (v: unknown): void => controller.enqueue(encoder.encode(`data: ${JSON.stringify(v)}\n\n`));
      const tutup = (): void => controller.close();
      const galat = (pesan: string): void => {
        kirim({ error: pesan });
        tutup();
      };
      if (!Number.isInteger(presetId) || presetId <= 0) return galat("presetId wajib diisi.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return galat("Tanggal harus YYYY-MM-DD.");
      const snap = await ambilSnapshot(db, presetId, tanggal);
      if (!snap) return galat(`Belum ada data laba untuk ${tanggal}.`);

      const semuaTanggal = await daftarTanggalSnapshot(db, presetId);
      const { dari, sampai } = rentangMundur(tanggal, 6);
      const [hppMaster, stok, biayaIklan, performaAda, iklanPerSku, performa] = await Promise.all([
        petaHppMaster(db, snap.rincian.map((r) => r.sku)),
        petaStok(db),
        totalIklanPeriode(db, presetId, dari, sampai),
        adaPerforma(db, presetId),
        metrikIklanPerSku(db, presetId, dari, sampai),
        performaPerSku(db, presetId, tanggal),
      ]);
      // Angka SAMA dengan aksi `cepat`/`mendalam` — satu sumber hitung, bukan hitung ulang.
      const hasil = analisaCepat({
        presetId,
        periode: tanggal,
        snapshot: {
          jml_order: snap.jml_order, omzet: snap.omzet, hpp: snap.hpp,
          biaya: snap.biaya, pajak: snap.pajak, laba: snap.laba, rincian: snap.rincian,
        },
        hppMaster,
        stok,
        biayaIklan,
        iklanPerSku,
        performaPerSku: performa,
        jmlSnapshot: semuaTanggal.length,
        adaPerforma: performaAda,
      });

      const setting = await ambilSettingAnalisa(db, oleh);
      const kedalaman = bacaKedalaman(setting.kedalaman);
      const aliran = await panggilTeksStream(
        { db, kunci: getKunciEnkripsi(), env: getEnvAi() },
        {
          pesan: susunPesanMendalam(susunBahan(hasil), kedalaman),
          reasoning: setting.reasoning,
          ...(setting.maks_token !== undefined ? { maksToken: setting.maks_token } : {}),
        }
      );
      if (!aliran.ok) return galat(aliran.error);

      try {
        for await (const p of aliran.potongan) {
          if (p.delta) kirim({ delta: p.delta });
        }
      } catch (e) {
        // Kegagalan SETELAH potongan pertama tidak difallback (teks sudah sampai ke user);
        // sampaikan sebabnya supaya jawaban yang terpotong tidak terlihat seperti selesai.
        return galat(e instanceof Error ? e.message : String(e));
      }
      kirim({ selesai: true, provider: aliran.provider, model: aliran.model });
      tutup();
    },
  });
  return new Response(alir, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Cloudflare/proxy tidak boleh menahan buffer; tanpa ini potongan baru sampai setelah selesai.
      "X-Accel-Buffering": "no",
    },
  });
}
