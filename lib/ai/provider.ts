// lib/ai/provider.ts — Orkestrator pemanggilan provider AI (Fase B).
// Tanggung jawab: pilih kredensial+model dari D1, jalankan fallback berlapis
// (model berikutnya di provider yang sama BARU pindah provider di `chainTeks`),
// kumpulkan SEMUA kegagalan ke pesan akhir, dan catat pemakaian ke ai_pemakaian.
// Dependensi: lib/d1/* (kredensial, katalog model, pengaturan), adapter OpenAI/Gemini.
// Tidak pernah menyimpan plaintext kredensial — hanya lewat variabel lokal.

import { ambilKredensial } from "@/lib/d1/aiKredensial";
import { daftarModel } from "@/lib/d1/aiModel";
import { himpunanIzin } from "@/lib/d1/aiIzinModel";
import { ambilPengaturanAI, type EnvAi } from "@/lib/d1/pengaturan";
import { gagal, type Hasil } from "@/lib/d1/hasil";
import { BASE_OPENAI, baseKenari, chatOpenai, gambarOpenai, type OpsiAdapter } from "./adapterOpenai";
import { chatGemini, gambarGemini, streamGemini } from "./adapterGemini";
import type { BagianChat, JawabanChat, PermintaanChat } from "./http";
import { streamJson, type PotonganStream } from "./stream";

export type ProviderNama = "gemini" | "groq" | "kenari" | "openai" | "openrouter";

export type Konteks = {
  db: D1Database;
  /** AI_KEY_ENCRYPTION_KEY — kunci dekripsi kredensial. */
  kunci: string;
  env?: EnvAi & { KENARI_BASE_URL?: string };
  /**
   * Role pemanggil, dipakai untuk menegakkan izin model (lib/d1/aiIzinModel.ts).
   *
   * OPSIONAL dengan default paling ketat: pemanggil yang lupa mengisi dianggap BUKAN
   * owner. Kalau field ini wajib, setiap entrypoint baru harus ingat mengisinya — dan
   * yang lupa akan gagal type-check; itu memang lebih baik, tetapi `Konteks` juga dibuat
   * di jalur bot/Worker yang tidak semuanya punya sesi dashboard. Default `undefined`
   * berarti "tidak diketahui" → diperlakukan sebagai non-owner (fail closed).
   */
  role?: string;
};

/** Provider OpenAI-compatible = semua kecuali gemini. */
const PROVIDER_OPENAI: ProviderNama[] = ["groq", "kenari", "openai", "openrouter"];

/** Satu-satunya definisi himpunan provider yang dikenal; jangan disalin ke tempat lain. */
function providerSah(p: string): p is ProviderNama {
  return (PROVIDER_OPENAI as string[]).concat("gemini").includes(p);
}

/**
 * Batas waktu SATU percobaan model teks.
 * Model penalaran (reasoning `high`/`xhigh`/`max`, apalagi varian `:free` yang mengantre
 * di sisi penyedia) memang lambat: 30 detik terlalu pendek dan membuat request yang
 * sebenarnya akan berhasil di-DROP lebih dulu, sehingga user hanya melihat kegagalan.
 * Tapi 60 detik juga terlalu lama: satu model lambat bisa menghabiskan hampir seluruh
 * anggaran rantai sebelum provider lain (yang kredensialnya sehat) sempat dicoba.
 * 35 detik = batas terburuk yang masih menyisakan jatah adil untuk provider berikutnya.
 */
export const TIMEOUT_TEKS_MS = 35000;

/**
 * Batas waktu SATU percobaan teks yang MEMAKAI reasoning (model benar-benar berpikir).
 * Model penalaran perlu waktu jauh lebih lama daripada jawaban biasa: dengan 35 detik
 * permintaan yang sebenarnya akan berhasil di-DROP lebih dulu — persis keluhan pemilik
 * repo ("reasoning selalu timeout"). Nilai reasoning sudah dinormalisasi di
 * lib/ai/reasoning.ts (max/xhigh → high), ini pagar waktu untuk tingkat yang sah itu.
 */
export const TIMEOUT_TEKS_REASONING_MS = 70000;

/**
 * Batas waktu SATU percobaan vision (model gambar biasa yang membaca gambar). Tidak dinaikkan.
 */
export const TIMEOUT_VISION_MS = 60000;

/**
 * Anggaran SATU provider di rantai teks (semua model provider itu dijumlahkan).
 * MASALAH YANG DIPERBAIKI: dulu hanya ada anggaran TOTAL, jadi provider pertama yang
 * lambat membakar seluruh jatah (satu model 60 detik + model berikutnya) dan provider
 * di belakangnya selalu "dilewati: anggaran total habis" — praktisnya tidak pernah
 * dicoba, padahal kredensialnya sehat. Batas per-provider membuat tiap provider dapat
 * giliran nyata.
 *
 * Perhitungan: satu provider WAJIB sanggup membiayai satu percobaan penuh model
 * pilihannya (70000ms = TIMEOUT_TEKS_REASONING_MS) DITAMBAH jatah nyata untuk
 * kandidat cadangannya. 80000 = 70000 (kandidat pertama) + 10000 sisa untuk kandidat
 * ke-2 (lihat `batasPercobaanTeks`), jadi kandidat cadangan bukan lagi hiasan.
 */
export const ANGGARAN_PROVIDER_MS = 80000;

/**
 * Anggaran TOTAL rantai teks (semua provider dijumlahkan) — pagar terakhir.
 *
 * Perhitungan SEKARANG: jumlah provider rantai default (3) × ANGGARAN_PROVIDER_MS
 * (80000) = 240000. Jadi tiap provider di rantai — berapa pun yang punya kredensial —
 * selalu kebagian satu jatah provider UTUH sebelum pagar total menyala; itulah inti
 * perbaikan "provider cadangan tidak pernah dicoba".
 *
 * CATATAN PLAFON CLOUDFLARE WORKERS: 240000 adalah batas ATAS (worst case: semua
 * provider menggantung sampai timeout), bukan waktu tunggu yang normal — angka ini
 * hanya tercapai bila SEMUA percobaan timeout. 240000 dipilih (bukan 315000 = 3 ×
 * 105000) supaya tidak melewati plafon request Worker/Cloudflare: 4 menit adalah
 * plafon terlama yang masih tercakup kebijakan request Cloudflare untuk Worker
 * berlangganan biasa, dan nilainya sama dengan `totalTimeoutMs` lama yang sudah
 * dipakai aplikasi ini. Bila ragu, angka lebih kecil lebih baik.
 *
 * CATATAN: ini anggaran jalur NON-stream (`panggilTeks`), yang pemakainya masih ada
 * (chat, vision, saran iklan). Angkanya TIDAK memperlambat jawaban biasa: batas satu
 * percobaan tetap TIMEOUT_TEKS_MS (35000), dan pagar ini baru relevan saat ada
 * percobaan yang benar-benar timeout.
 */
export const ANGGARAN_TEKS_MS = 240000;

/**
 * Sisa anggaran minimum agar satu percobaan masih masuk akal. Di bawah ini percobaan
 * DILEWATI (dengan catatan yang menyebut alasannya): sisa 2 detik tidak cukup untuk
 * handshake apa pun, jadi meneruskannya hanya menyia-nyiakan sisa waktu provider.
 */
const MIN_SISA_MS = 3000;

/**
 * Jumlah model yang dicoba per provider: 1 model yang diminta user + 4 cadangan.
 * MASALAH YANG DIPERBAIKI: dulu SEMUA model aktif provider ikut masuk kandidat —
 * pada katalog nyata itu 23 model kenari dijejer berurutan sebelum provider
 * berikutnya (gemini) sempat dicoba. Itu bukan fallback, itu penjelajahan katalog:
 * satu provider yang sedang bermasalah menghabiskan seluruh anggaran waktu.
 * Batas ini menjaga arti "cadangan" tetap: kalau 5 model berturut-turut gagal,
 * masalahnya provider/kredensial, jadi lebih baik segera pindah provider.
 *
 * Dinaikkan dari 3 ke 5: katalog nyata sudah ~160 model, jadi hanya 2 cadangan
 * sesudah model pilihan user terlalu sedikit — satu model mati + satu kuota habis
 * sudah mengakhiri provider yang sebenarnya sehat.
 *
 * ANGGARAN: anggaran provider adalah pagar WAKTU, bukan kuota model. Kandidat pertama
 * selalu dapat jatah penuh (70000ms = TIMEOUT_TEKS_REASONING_MS saat reasoning aktif,
 * atau 35000ms = TIMEOUT_TEKS_MS saat tidak), jadi provider ini tidak mungkin
 * kehabisan anggaran sebelum model pilihannya selesai dicoba. Kandidat ke-2..5 hanya
 * kebagian SISA anggaran provider, masing-masing dibatasi TIMEOUT_TEKS_MS
 * (lihat `batasPercobaanTeks`) — jadi satu kandidat cadangan tidak bisa menelan
 * seluruh sisa, dan anggaran itu tetap menjadi pagar waktu yang nyata.
 */
export const MAKS_MODEL_PER_PROVIDER = 5;

/**
 * Batas waktu SATU percobaan kandidat teks. Dipakai `panggilTeks` DAN
 * `panggilTeksStream` supaya pembagian waktunya identik.
 *
 * Pembagian anggaran provider (inti perbaikan "satu model menelan seluruh rantai"):
 * - Kandidat PERTAMA provider (model pilihan user / peta model) mendapat jatah penuh
 *   `TIMEOUT_TEKS_REASONING_MS` saat reasoning aktif (atau `TIMEOUT_TEKS_MS` bila tidak)
 *   — ia yang paling mungkin benar, jadi tidak boleh dipotong.
 * - Kandidat ke-2 dan seterusnya berbagi SISA anggaran provider, masing-masing
 *   dibatasi `TIMEOUT_TEKS_MS` supaya tidak ada satu pun yang bisa menelan seluruh sisa.
 * - Semuanya TIDAK BOLEH melewati sisa anggaran provider maupun sisa anggaran total:
 *   satu percobaan tidak pernah "meminjam" waktu milik provider berikutnya.
 */
export function batasPercobaanTeks(pakaiReasoning: boolean, pertamaProvider: boolean, sisaProvider: number, sisaTotal: number): number {
  const dasar = pakaiReasoning ? TIMEOUT_TEKS_REASONING_MS : TIMEOUT_TEKS_MS;
  const jatah = pertamaProvider ? dasar : Math.min(dasar, TIMEOUT_TEKS_MS);
  return Math.min(jatah, sisaProvider, sisaTotal);
}

/**
 * Base URL efektif untuk provider: alamat dari kredensial menang atas bawaan.
 * Alasan: user bisa membetulkan host sendiri dari UI (mis. host Kenari berubah)
 * tanpa perlu deploy ulang.
 */
function opsiUntuk(provider: ProviderNama, apiKey: string, ctx: Konteks, timeoutMs: number, baseKred = ""): OpsiAdapter | null {
  const dariKred = String(baseKred ?? "").trim().replace(/\/+$/, "");
  if (dariKred) return { baseUrl: dariKred, apiKey, timeoutMs, provider };
  if (provider === "kenari") return { baseUrl: baseKenari(ctx.env), apiKey, timeoutMs, provider };
  const baseUrl = BASE_OPENAI[provider];
  return baseUrl ? { baseUrl, apiKey, timeoutMs, provider } : null;
}

/**
 * Tanggal WIB (UTC+7) format YYYY-MM-DD.
 * Digeser 7 jam lalu diambil bagian tanggalnya — batas hari mengikuti admin WMS,
 * bukan UTC, supaya rekap "hari ini" cocok dengan jam kerja.
 */
export function tanggalWib(ms: number = Date.now()): string {
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** UPSERT harian: satu baris per (tanggal, provider, model, jenis). */
export async function catatPemakaian(
  db: D1Database,
  data: { tanggal?: string; provider: string; model: string; jenis: string; tokenMasuk?: number; tokenKeluar?: number }
): Promise<void> {
  const masuk = Math.max(0, Math.trunc(data.tokenMasuk ?? 0));
  const keluar = Math.max(0, Math.trunc(data.tokenKeluar ?? 0));
  await db
    .prepare(
      "INSERT INTO ai_pemakaian (tanggal, provider, model, jenis, panggilan, token_masuk, token_keluar) VALUES (?, ?, ?, ?, 1, ?, ?) " +
        "ON CONFLICT(tanggal, provider, model, jenis) DO UPDATE SET " +
        "panggilan = panggilan + 1, token_masuk = token_masuk + excluded.token_masuk, token_keluar = token_keluar + excluded.token_keluar"
    )
    .bind(data.tanggal ?? tanggalWib(), data.provider, data.model, data.jenis, masuk, keluar)
    .run();
}

/** Riwayat percobaan untuk pesan error akhir — user harus tahu provider+model apa saja yang dicoba. */
type Catatan = { provider: string; model: string; error: string };

/**
 * Ringkasan kegagalan. `rantai` = urutan provider di `chainTeks`; dipakai untuk
 * menutup pesan dengan kalimat yang menyebut provider BELUM dicoba karena
 * kredensialnya kosong. Tanpa itu user mengira sistemnya mati, padahal masalahnya
 * konfigurasi: provider sehat cuma tidak pernah kebagian giliran.
 */
function ringkasGagal(catatan: Catatan[], rantai: string[] = []): string {
  if (catatan.length === 0) return "Tidak ada provider dengan kredensial aktif dan model tersedia.";
  const badan = `Semua percobaan gagal: ${catatan.map((c) => `${c.provider}/${c.model}: ${c.error}`).join(" | ")}`;
  const tanpaKred = [...new Set(catatan.filter((c) => c.error === "tidak ada kredensial aktif").map((c) => c.provider))];
  const belumDicoba = rantai.filter((p) => !catatan.some((c) => c.provider === p) && !tanpaKred.includes(p));
  const saran: string[] = [];
  if (tanpaKred.length > 0) saran.push(`tanpa kredensial aktif: ${tanpaKred.join(", ")} (isi API key-nya di Pengaturan → Kredensial Provider)`);
  if (belumDicoba.length > 0) saran.push(`belum dicoba: ${belumDicoba.join(", ")}`);
  // Kalau SEMUA provider di rantai sudah dicoba dan semuanya bergagal, jangan tambahkan
  // kalimat penutup: tidak ada provider lain yang bisa ditawarkan ke user.
  if (saran.length === 0) return badan;
  return `${badan} — Masih ada provider yang bisa dicoba: ${saran.join("; ")}.`;
}

/**
 * Pesan saat kandidat model KOSONG.
 *
 * KENAPA dipisah dari `ringkasGagal`: sejak ada daftar izin per role, "tidak ada kandidat"
 * punya DUA sebab yang sangat berbeda tindak lanjutnya — (a) kredensial/katalog bermasalah,
 * atau (b) owner belum mengizinkan satu model pun untuk role ini. Keduanya dulu berbunyi
 * "Semua percobaan gagal: ..." sehingga user non-owner mencari masalah di kredensial
 * padahal izinnya yang kosong.
 *
 * Non-owner dengan kandidat kosong SELALU dijawab 403 + arahan ke owner: itu satu-satunya
 * tindakan yang bisa memperbaikinya, dan menyembunyikannya di balik 502 membuat user
 * mencoba ulang tanpa hasil.
 */
function gagalTanpaKandidat(
  catatan: Catatan[],
  rantai: string[],
  role: string | undefined,
  jenis: "teks" | "vision"
): Hasil<never> {
  const pemanggilNonOwner = role !== undefined && role !== "owner";
  const semuaDitolakIzin = catatan.length > 0 && catatan.every((c) => c.error.includes("tidak diizinkan"));
  if (pemanggilNonOwner && (catatan.length === 0 || semuaDitolakIzin)) {
    return gagal<never>(
      403,
      `Belum ada model ${jenis} yang diizinkan owner untuk role Anda. ` +
        `Hubungi owner untuk mengaktifkannya di Pengaturan AI → Izin Model per Role.`,
      catatan
    );
  }
  return gagal<never>(502, ringkasGagal(catatan, rantai), catatan);
}

type Kandidat = { provider: ProviderNama; model: string; apiKey: string; /** Alamat dasar dari kredensial; "" = pakai bawaan provider. */ baseUrl: string };

/**
 * Batas kandidat per provider: model yang diminta user SELALU nomor satu (kalau ada),
 * lalu maksimal `MAKS_MODEL_PER_PROVIDER - 1` model aktif lain urut `id` sebagai cadangan.
 *
 * KENAPA TIDAK SEMUA MODEL: mencoba 23 model satu provider satu per satu bukan fallback.
 * Bila tiga model berturut-turut gagal (model mati, kuota, atau provider sedang down),
 * model keempat..keduapuluh tiga hampir pasti gagal juga — yang terjadi hanyalah user
 * menunggu sampai anggaran habis tanpa provider sehat di belakangnya pernah dicoba.
 */
/**
 * Kandidat per provider saat `hanyaModelDipilih` menyala: SATU model = model yang dipilih
 * user, TANPA cadangan dari katalog.
 *
 * KENAPA: katalog `ai_model` tidak menyimpan harga (kolom `modal_masuk`/`modal_keluar` itu
 * modality: text/file), jadi sistem TIDAK BISA menilai mana model mahal. Satu-satunya cara
 * mencegah tagihan tak terduga adalah tidak pernah memakai model yang tidak dipilih user —
 * bukan menebak lewat nama model.
 *
 * Provider tanpa pilihan DILEWATI dengan catatan yang bisa ditindak; menambal dari katalog
 * justru mengembalikan lubang yang sedang ditutup. Rantai TETAP dilanjutkan ke provider
 * berikutnya yang sudah punya pilihan, jadi satu provider yang belum diisi tidak mematikan
 * seluruh analisa.
 */
function kandidatHanyaDipilih(
  provider: ProviderNama,
  modelDipilih: string | undefined,
  kred: { plaintext: string; base_url: string | null },
  catatan: Catatan[],
  izin: Set<string> | null
): Kandidat[] {
  if (!modelDipilih) {
    catatan.push({
      provider,
      model: "-",
      error: `dilewati: provider ${provider} belum punya model default dipilih — isi di Pengaturan AI → Model Default`,
    });
    return [];
  }
  // Izin model diperiksa SESUDAH kelengkapan pilihan, SEBELUM kandidat dibuat: model yang
  // tidak diizinkan owner untuk role ini tidak boleh masuk daftar kandidat sama sekali,
  // sekalipun user menulisnya sendiri di body permintaan. `izin === null` = owner → lolos.
  if (izin !== null && !izin.has(`${provider}\u0000${modelDipilih}`)) {
    catatan.push({
      provider,
      model: modelDipilih,
      error: `ditolak: model "${modelDipilih}" tidak diizinkan owner untuk role ini`,
    });
    return [];
  }
  return [{ provider, model: modelDipilih, apiKey: kred.plaintext, baseUrl: kred.base_url ?? "" }];
}

async function kandidatTeks(
  ctx: Konteks,
  jenis: "teks" | "vision",
  catatan: Catatan[],
  modelDiminta?: string,
  hanyaModelDipilih?: boolean,
  providerDiminta?: string
): Promise<{ kandidat: Kandidat[]; rantai: string[] }> {
  const set = await ambilPengaturanAI(ctx.db, ctx.env);
  const rantaiTeks = (set.chainTeks.length > 0 ? set.chainTeks : [set.textProvider || "groq"]).filter(
    (p): p is ProviderNama => providerSah(p)
  );
  const peta = jenis === "vision" ? set.modelVision : set.modelTeks;
  // Provider pembawa `modelDiminta` (bila pemanggil menyebutkannya). `modelDiminta` di bawah
  // hanya sah untuk pemiliknya, jadi provider itu harus berada di urutan pertama rantai:
  //  - provider sudah ada di rantai → DIPINDAH ke depan (tanpa duplikat);
  //  - provider SAH tapi TIDAK ada di rantai (mis. `model_editor` user menunjuk provider yang
  //    tidak ikut dikonfigurasi di `chainTeks`) → DITAMBAHKAN di depan. Tanpa cabang kedua ini
  //    permintaan user diabaikan diam-diam: rantai mulai dari provider lain yang tidak mengenal
  //    `modelDiminta`, dan model pilihan user tidak pernah masuk daftar kandidat sama sekali.
  // Provider yang tidak dikenal (bukan providerSah) tidak pernah ditambahkan — rantai apa adanya.
  const rantaiUrut =
    providerDiminta && providerSah(providerDiminta)
      ? [providerDiminta, ...rantaiTeks.filter((p) => p !== providerDiminta)]
      : rantaiTeks;
  // Izin model per role+jenis, diambil SEKALI untuk seluruh rantai: satu kueri, bukan satu
  // kueri per model. `null` = owner (tanpa batas) — lihat himpunanIzin. Non-owner tanpa izin
  // sama sekali mendapat himpunan KOSONG, sehingga tidak ada kandidat dan permintaan berhenti
  // dengan pesan yang bisa ditindaklanjuti, bukan diam-diam memakai model default.
  const izin = await himpunanIzin(ctx.db, ctx.role ?? "", jenis);
  const hasil: Kandidat[] = [];
  for (const provider of rantaiUrut) {
    const kred = await ambilKredensial(ctx.db, provider, ctx.kunci);
    if (!kred || !kred.plaintext) {
      catatan.push({ provider, model: "-", error: "tidak ada kredensial aktif" });
      continue;
    }
    const katalog = await daftarModel(ctx.db, provider, jenis);
    const aktif = katalog.filter((m) => m.aktif === 1).sort((a, b) => a.id - b.id);
    // TANPA `providerDiminta`, `modelDiminta` hanya berlaku di provider pertama (perilaku
    // lama: pemanggil lama seperti bot mengirim nama model tanpa menyebut providernya).
    const pilih = (provider === rantaiTeks[0] || provider === providerDiminta ? modelDiminta : undefined) ?? peta[provider];
    // Jalur analisa: HANYA model yang dipilih user, tanpa cadangan katalog (lihat
    // `kandidatHanyaDipilih`). Provider tanpa pilihan dilewati, rantai lanjut.
    if (hanyaModelDipilih) {
      hasil.push(...kandidatHanyaDipilih(provider, pilih, kred, catatan, izin));
      continue;
    }
    const id: string[] = [];
    if (pilih) id.push(pilih);
    for (const m of aktif) if (!id.includes(m.model_id)) id.push(m.model_id);
    // Izin disaring DI SINI, sebelum urutan `:free`/`MAKS_MODEL_PER_PROVIDER` dihitung:
    // kalau disaring sesudah pemotongan, model terlarang bisa memakan jatah slot dan
    // menggeser model yang sebenarnya boleh dipakai keluar dari daftar kandidat.
    // `izin === null` (owner) melewati penyaringan sepenuhnya — owner tidak pernah dibatasi.
    const boleh = izin === null ? id : id.filter((m) => izin.has(`${provider}\u0000${m}`));
    if (izin !== null && boleh.length < id.length) {
      // Dicatat supaya tidak tampak seperti katalog kosong: user perlu tahu modelnya ADA
      // tapi tidak diizinkan, bukan menebak-nebak kenapa daftarnya pendek.
      catatan.push({
        provider,
        model: "-",
        error: `dilewati: ${id.length - boleh.length} model tidak diizinkan owner untuk role ini`,
      });
    }
    // Model berakhiran `:free` DITARUH DI BELAKANG model berbayar. Alasan: varian gratis
    // mengantre di sisi penyedia (kuota gratis diperebutkan), jadi hampir pasti melewati
    // batas waktu — dan kandidat PERTAMA memakai jatah waktu penuh provider, artinya satu
    // model `:free` bisa membakar jatah itu tanpa hasil. Model yang DIPILIH user (atau
    // ditetapkan peta model) tetap nomor satu apa pun namanya. Pengurutan stabil, jadi
    // urutan `id` tetap terjaga di dalam masing-masing kelompok (berbayar / `:free`).
    const urut = boleh.slice(pilih && boleh[0] === pilih ? 1 : 0).sort((a, b) => Number(a.endsWith(":free")) - Number(b.endsWith(":free")));
    const urutan = pilih && boleh[0] === pilih ? [pilih, ...urut] : urut;
    // Sisanya memang sengaja TIDAK dicoba — dicatat supaya tidak ada yang menyangka
    // katalog provider ini sudah dicoba habis lalu menyimpulkan modelnya memang mati.
    const sisa = Math.max(0, urutan.length - MAKS_MODEL_PER_PROVIDER);
    if (sisa > 0) {
      catatan.push({
        provider,
        model: "-",
        error: `dilewati: hanya ${MAKS_MODEL_PER_PROVIDER} model pertama provider ini yang dicoba, ${sisa} model lain tidak dicoba`,
      });
    }
    for (const model of urutan.slice(0, MAKS_MODEL_PER_PROVIDER)) {
      hasil.push({ provider, model, apiKey: kred.plaintext, baseUrl: kred.base_url ?? "" });
    }
  }
  return { kandidat: hasil, rantai: rantaiUrut };
}

/** Satu percobaan ke satu provider+model; semua error berasal dari adapter (asli dari provider). */
async function cobaTeks(
  kandidat: Kandidat,
  pesan: BagianChat[],
  tool: unknown[] | undefined,
  ctx: Konteks,
  timeoutMs: number,
  opsiReasoning?: { reasoning?: string; reasoningHilir?: boolean; maksToken?: number }
): Promise<Hasil<{ jawaban: JawabanChat; latencyMs: number }>> {
  // Batas waktu dihitung PEMANGGIL (`batasPercobaanTeks`): satu percobaan tidak boleh
  // melewati sisa anggaran provider/total, jadi angkanya tidak boleh ditentukan di sini.
  const permintaan: PermintaanChat = {
    model: kandidat.model,
    pesan,
    tool,
    ...(opsiReasoning?.reasoning ? { reasoning: opsiReasoning.reasoning } : {}),
    ...(opsiReasoning?.reasoningHilir ? { reasoningHilir: true } : {}),
    ...(opsiReasoning?.maksToken !== undefined ? { maksToken: opsiReasoning.maksToken } : {}),
  };
  const h =
    kandidat.provider === "gemini"
      ? await chatGemini({ apiKey: kandidat.apiKey, timeoutMs }, permintaan)
      : await (async () => {
          const opsi = opsiUntuk(kandidat.provider, kandidat.apiKey, ctx, timeoutMs, kandidat.baseUrl);
          if (!opsi) return { ok: false as const, status: 400, error: `Provider ${kandidat.provider} tidak mendukung chat teks.`, latencyMs: 0 };
          return chatOpenai(opsi, permintaan);
        })();
  if (!h.ok) return { ok: false, status: h.status, error: h.error };
  return { ok: true, jawaban: h.data, latencyMs: h.latencyMs };
}

/**
 * Panggil model teks/vision dengan fallback berlapis.
 * `jenis` = "vision" memakai peta modelVision + katalog vision (model gambar biasa).
 */
export async function panggilTeks(
  ctx: Konteks,
  minta: {
    pesan: BagianChat[];
    tool?: unknown[];
    modelDiminta?: string;
    /**
     * Provider PEMBAWA `modelDiminta`. Diisi hanya kalau model yang diminta memang milik
     * provider tertentu (mis. pilihan model per user yang disimpan sebagai kunci izin
     * `provider\0model` — lihat lib/d1/aiEditorSetting.ts). Tanpa ini `modelDiminta`
     * dianggap milik provider PERTAMA di rantai; penyedia lain yang KEBAHULAN punya
     * model bernama sama lalu dipanggil dengan nama itu, dan model di provider sisa
     * rantai (yang seharusnya jadi cadangan) tidak pernah punya kandidat.
     */
    providerDiminta?: string;
    reasoning?: string;
    reasoningHilir?: boolean;
    maksToken?: number;
    /**
     * `true` = HANYA model yang dipilih user (`modelTeks`/`modelVision`) boleh dipakai;
     * provider tanpa pilihan DILEWATI dengan catatan yang bisa ditindak, TIDAK ditambal
     * dari katalog. Dipakai jalur analisa keuangan (lihat lib/analisa/ai.ts): katalog tidak
     * menyimpan harga, jadi model yang tidak dipilih user tidak boleh berjalan diam-diam.
     * Kosong/`false` = perilaku lama apa adanya (bot chat, vision).
     */
    hanyaModelDipilih?: boolean;
  },
  jenis: "teks" | "vision" = "teks"
): Promise<
  Hasil<{
    teks: string;
    provider: string;
    model: string;
    tokenMasuk: number;
    tokenKeluar: number;
    /** Panggilan tool yang diminta model (bila ada). */
    toolCall?: { id: string; nama: string; argumen: string }[];
  }>
> {
  const catatan: Catatan[] = [];
  if (!ctx.kunci && !ctx.env?.AI_KEY_ENCRYPTION_KEY) return gagal(500, "AI_KEY_ENCRYPTION_KEY belum diset.");
  const { kandidat, rantai } = await kandidatTeks(ctx, jenis, catatan, minta.modelDiminta, minta.hanyaModelDipilih, minta.providerDiminta);
  if (kandidat.length === 0) return gagalTanpaKandidat(catatan, rantai, ctx.role, jenis);

  // Anggaran hanya berlaku untuk "teks" — vision sudah dibatasi satu panggilan pendek.
  const mulai = Date.now();
  // Jam per-provider: direset tiap kali provider berganti, bukan digabung seluruh rantai.
  let providerKini = kandidat[0]!.provider;
  let mulaiProvider = mulai;
  // Kandidat ke-berapa di provider ini (0 = model pilihan user/peta model). Hanya kandidat
  // PERTAMA yang boleh memakai jatah waktu penuh; cadangan berbagi sisa — lihat
  // `batasPercobaanTeks`.
  let indeksProvider = 0;
  const pakaiReasoning = !!String(minta.reasoning ?? "").trim();
  for (const k of kandidat) {
    if (k.provider !== providerKini) {
      providerKini = k.provider;
      mulaiProvider = Date.now();
      indeksProvider = 0;
    }
    const pertamaProvider = indeksProvider === 0;
    indeksProvider += 1;
    const sisaTotal = ANGGARAN_TEKS_MS - (Date.now() - mulai);
    const sisaProvider = ANGGARAN_PROVIDER_MS - (Date.now() - mulaiProvider);
    if (jenis === "teks" && sisaTotal <= 0) {
      catatan.push({
        provider: k.provider,
        model: k.model,
        error: `dilewati: anggaran total ${ANGGARAN_TEKS_MS}ms habis`,
      });
      continue;
    }
    // Provider ini sudah kebanyakan makan waktu: sisa model provider ITU dilewati,
    // tapi rantai LANJUT ke provider berikutnya — ini inti perbaikannya.
    if (jenis === "teks" && sisaProvider <= 0) {
      catatan.push({
        provider: k.provider,
        model: k.model,
        error: `dilewati: anggaran provider ${k.provider} habis, lanjut provider berikutnya`,
      });
      continue;
    }
    // Sisa terlalu kecil untuk apa pun: percobaan diteruskan hanya akan menyia-nyiakan
    // sisa waktu provider (tanpa harapan berhasil), jadi dilewati dengan catatan jelas.
    if (jenis === "teks" && Math.min(sisaProvider, sisaTotal) < MIN_SISA_MS) {
      catatan.push({
        provider: k.provider,
        model: k.model,
        error: `dilewati: sisa anggaran terlalu kecil (provider ${sisaProvider}ms, total ${sisaTotal}ms; minimum ${MIN_SISA_MS}ms)`,
      });
      continue;
    }
    // Satu percobaan TIDAK BOLEH melewati sisa anggaran provider maupun total, dan
    // kandidat cadangan dibatasi TIMEOUT_TEKS_MS: satu model tak mungkin menelan rantai.
    const timeoutMs = jenis === "vision" ? TIMEOUT_VISION_MS : batasPercobaanTeks(pakaiReasoning, pertamaProvider, sisaProvider, sisaTotal);
    const h = await cobaTeks(k, minta.pesan, minta.tool, ctx, timeoutMs, {
      reasoning: minta.reasoning,
      reasoningHilir: minta.reasoningHilir,
      maksToken: minta.maksToken,
    });
    if (!h.ok) {
      catatan.push({ provider: k.provider, model: k.model, error: h.error });
      continue;
    }
    const masuk = h.jawaban.tokenMasuk ?? 0;
    const keluar = h.jawaban.tokenKeluar ?? 0;
    await catatPemakaian(ctx.db, {
      provider: k.provider,
      model: k.model,
      jenis,
      tokenMasuk: masuk,
      tokenKeluar: keluar,
    });
    return { ok: true, teks: h.jawaban.teks, provider: k.provider, model: k.model, tokenMasuk: masuk, tokenKeluar: keluar, toolCall: h.jawaban.toolCall };
  }
  return gagal<never>(502, ringkasGagal(catatan, rantai), catatan);
}

/**
 * Varian STREAMING dari `panggilTeks` — TIDAK menggantikannya; pemakai lama tetap
 * memakai jalur non-stream. Rantai kandidatnya SAMA (`kandidatTeks`), yang berbeda
 * hanya cara percobaannya: potongan teks dikembalikan begitu tiba, bukan menunggu
 * jawaban selesai (lihat KENAPA STREAMING di lib/ai/stream.ts).
 *
 * ATURAN PEMILIHAN PROVIDER (penting, tidak bisa dibatalkan):
 * kandidat pertama yang potongan PERTAMANYA benar-benar tiba dianggap terpilih dan
 * stream ditutup setelahnya. Setelah ada potongan sampai ke user, pindah provider
 * akan menghasilkan jawaban campur dua model — jadi kegagalan SETELAH potongan
 * pertama dilaporkan apa adanya, bukan difallback. Provider yang gagal SEBELUM ada
 * potongan (kredensial kosong, 4xx/5xx, timeout hubung, timeout menunggu potongan
 * pertama) dilewati seperti rantai biasa.
 *
 * KENAPA potongan pertama DIAMBIL SEBELUM kandidat dikunci: `streamJson`/`streamGemini`
 * mengembalikan `ok: true` begitu HEADER 2xx tiba, sementara generator pembacanya belum
 * dijalankan sama sekali. Jadi `ok: true` TIDAK berarti ada teks. Dulu kandidat langsung
 * dikunci di situ, sehingga model yang berpikir DIAM lebih lama daripada batas waktu
 * membuat generator melempar timeout SETELAH `panggilTeksStream` selesai `return` — dan
 * fallback ke provider berikutnya tidak pernah terjadi (user hanya melihat `{error}`).
 * Karena itu potongan pertama diambil di dalam try/catch sebelum kandidat dikunci:
 * fallback hanya sah selama BELUM ada satu byte pun yang sampai ke klien, dan pada titik
 * itu memang belum ada.
 *
 * Pembaca SSE berbeda per keluarga provider: OpenAI-compatible lewat `streamJson`
 * (lib/ai/stream.ts), Gemini lewat `streamGemini` (lib/ai/adapterGemini.ts) — Gemini
 * memakai bentuk event sendiri, bukan `choices[0].delta.content`.
 */
export async function panggilTeksStream(
  ctx: Konteks,
  minta: {
    pesan: BagianChat[];
    tool?: unknown[];
    modelDiminta?: string;
    /** Sama seperti `panggilTeks.providerDiminta`. */
    providerDiminta?: string;
    reasoning?: string;
    reasoningHilir?: boolean;
    maksToken?: number;
    /** Sama seperti `panggilTeks.hanyaModelDipilih` — jalur analisa TIDAK boleh memakai model lain. */
    hanyaModelDipilih?: boolean;
  }
): Promise<
  Hasil<{
    /** Kandidat yang akhirnya dipakai — dikirim ke user saat stream selesai. */
    provider: string;
    model: string;
    potongan: AsyncGenerator<PotonganStream>;
  }>
> {
  const catatan: Catatan[] = [];
  if (!ctx.kunci && !ctx.env?.AI_KEY_ENCRYPTION_KEY) return gagal(500, "AI_KEY_ENCRYPTION_KEY belum diset.");
  const { kandidat, rantai } = await kandidatTeks(ctx, "teks", catatan, minta.modelDiminta, minta.hanyaModelDipilih, minta.providerDiminta);
  if (kandidat.length === 0) return gagalTanpaKandidat(catatan, rantai, ctx.role, "teks");

  const mulai = Date.now();
  let providerKini = kandidat[0]!.provider;
  let mulaiProvider = mulai;
  // Sama seperti `panggilTeks`: kandidat pertama provider ini dapat jatah penuh, cadangan
  // berbagi sisa, dan tidak ada percobaan yang melewati sisa anggaran provider/total.
  let indeksProvider = 0;
  const pakaiReasoning = !!String(minta.reasoning ?? "").trim();
  // Menyala begitu SATU percobaan ber-reasoning gagal; memicu aturan "reasoning diturunkan"
  // di dalam loop (lihat komentarnya di sana): percobaan berikutnya dijalankan tanpa
  // reasoning bila sisa anggaran tidak cukup untuk satu percobaan reasoning penuh.
  let adaReasoningGagal = false;
  for (const k of kandidat) {
    if (k.provider !== providerKini) {
      providerKini = k.provider;
      mulaiProvider = Date.now();
      indeksProvider = 0;
    }
    const pertamaProvider = indeksProvider === 0;
    indeksProvider += 1;
    const sisaTotal = ANGGARAN_TEKS_MS - (Date.now() - mulai);
    const sisaProvider = ANGGARAN_PROVIDER_MS - (Date.now() - mulaiProvider);
    // Pagar anggaran sama seperti panggilTeks: provider yang kebablasan tidak menghentikan
    // rantai — kandidat provider berikutnya tetap dicoba.
    if (sisaTotal <= 0) {
      catatan.push({ provider: k.provider, model: k.model, error: `dilewati: anggaran total ${ANGGARAN_TEKS_MS}ms habis` });
      continue;
    }
    if (sisaProvider <= 0) {
      catatan.push({
        provider: k.provider,
        model: k.model,
        error: `dilewati: anggaran provider ${k.provider} habis, lanjut provider berikutnya`,
      });
      continue;
    }
    if (Math.min(sisaProvider, sisaTotal) < MIN_SISA_MS) {
      catatan.push({
        provider: k.provider,
        model: k.model,
        error: `dilewati: sisa anggaran terlalu kecil (provider ${sisaProvider}ms, total ${sisaTotal}ms; minimum ${MIN_SISA_MS}ms)`,
      });
      continue;
    }
    // Aturan "reasoning diturunkan": percobaan ber-reasoning yang GAGAL tidak diulang
    // dengan reasoning bila sisa anggaran lebih kecil dari satu percobaan reasoning penuh.
    // Alasan: kandidat cadangan dengan (mis.) 10 detik sisa hampir pasti timeout LAGI kalau
    // tetap dipaksa berpikir, sedangkan jawaban tanpa reasoning masih berguna bagi user —
    // dan percobaan tanpa reasoning memang memakai jatah jauh lebih pendek (TIMEOUT_TEKS_MS).
    const sisaReasoning = Math.min(sisaProvider, sisaTotal);
    const turunkanReasoning = adaReasoningGagal && sisaReasoning < TIMEOUT_TEKS_REASONING_MS;
    const pakaiReasoningKini = pakaiReasoning && !turunkanReasoning;
    // Dicatat supaya keputusan ini terlihat di pesan gagal akhir (bukan keputusan diam-diam).
    if (turunkanReasoning) {
      catatan.push({
        provider: k.provider,
        model: k.model,
        error: `reasoning diturunkan ke tanpa reasoning: sisa anggaran ${sisaReasoning}ms < ${TIMEOUT_TEKS_REASONING_MS}ms`,
      });
    }
    const reasoningPercobaan = pakaiReasoningKini ? minta.reasoning : undefined;
    // Batas waktu TANPA potongan: model yang benar-benar berpikir tidak mengirim apa pun
    // sementara ia bekerja, jadi reasoning dapat jatah panjang (sama seperti non-stream).
    // Tanpa reasoning angkanya TIDAK berubah (TIMEOUT_TEKS_MS).
    const timeoutMs = batasPercobaanTeks(pakaiReasoningKini, pertamaProvider, sisaProvider, sisaTotal);
    // Pagar TOTAL percobaan ini juga tidak boleh melewati sisa anggaran provider: stream
    // tidak boleh berjalan lebih lama daripada jatah provider yang sedang dipakainya.
    const totalMs = Math.max(1000, Math.min(sisaTotal, sisaProvider));
    // Gemini TIDAK dilewati lagi: bentuk SSE-nya sendiri (candidates[0].content.parts[].text,
    // bukan choices[0].delta.content), jadi ditangani `streamGemini` — bukan `streamJson`
    // milik provider OpenAI-compatible. Sebelumnya provider ini di-skip sehingga rantai
    // ["kenari","groq","gemini"] berakhir "tidak ada provider" walau kredensial gemini sehat.
    const s =
      k.provider === "gemini"
        ? await streamGemini({
            apiKey: k.apiKey,
            baseUrl: k.baseUrl,
            provider: k.provider,
            model: k.model,
            pesan: minta.pesan,
            tool: minta.tool,
            maksToken: minta.maksToken,
            reasoning: reasoningPercobaan,
            reasoningHilir: minta.reasoningHilir,
            timeoutMs,
            totalMs,
          })
        : await (async () => {
            const opsi = opsiUntuk(k.provider, k.apiKey, ctx, timeoutMs, k.baseUrl);
            if (!opsi) return { ok: false as const, status: 400, error: `Provider ${k.provider} tidak mendukung chat teks.` };
            return streamJson({
              baseUrl: opsi.baseUrl,
              apiKey: opsi.apiKey,
              provider: k.provider,
              model: k.model,
              pesan: minta.pesan,
              tool: minta.tool,
              maksToken: minta.maksToken,
              reasoning: reasoningPercobaan,
              reasoningHilir: minta.reasoningHilir,
              timeoutMs,
              totalMs,
            });
          })();
    if (!s.ok) {
      // Gagal SEBELUM potongan apa pun: aman pindah kandidat berikutnya.
      if (pakaiReasoningKini) adaReasoningGagal = true;
      catatan.push({ provider: k.provider, model: k.model, error: s.error });
      continue;
    }

    // `ok: true` HANYA berarti header 2xx sudah tiba; generator pembacanya belum berjalan,
    // jadi belum tentu ada teks. Potongan pertama diambil DI SINI di dalam try/catch supaya
    // kandidat yang menggantung (model berpikir diam lalu timeout) masih bisa difallback:
    // pada titik ini BELUM ada byte yang dikirim ke user, jadi mengganti provider masih sah.
    let awal: PotonganStream;
    try {
      const p = await s.iter.next();
      const nilai = p.done ? undefined : p.value;
      if (!nilai || (!nilai.delta && !nilai.pikir)) {
        // 200 lalu stream selesai tanpa satu pun potongan teks (mis. hanya `[DONE]` atau
        // hanya usage): user tidak menerima apa pun, jadi ini KEGAGALAN, bukan jawaban kosong.
        s.batalkan();
        if (pakaiReasoningKini) adaReasoningGagal = true;
        catatan.push({ provider: k.provider, model: k.model, error: "stream selesai tanpa potongan teks" });
        continue;
      }
      awal = nilai;
    } catch (e) {
      // Timeout menunggu potongan pertama / koneksi putus: kandidat berikutnya dicoba.
      s.batalkan();
      if (pakaiReasoningKini) adaReasoningGagal = true;
      catatan.push({ provider: k.provider, model: k.model, error: e instanceof Error ? e.message : String(e) });
      continue;
    }

    // Potongan pertama benar-benar tiba → kandidat ini TERKUNCI (aturan di atas). Token/usage
    // dari SSE (bila provider mengirimnya) dicatat sebagai agregat satu baris; kegagalan
    // pencatatan tidak boleh menggagalkan jawaban yang sudah terkirim ke user.
    const dalam = s.iter;
    const dipakai = { provider: k.provider, model: k.model };
    const masuk = { nilai: 0 };
    const keluar = { nilai: 0 };
    async function* potongan(): AsyncGenerator<PotonganStream> {
      let teksAda = false;
      try {
        // Potongan pertama (yang sudah tiba SEBELUM kandidat dikunci) dikeluarkan lebih dulu
        // supaya tidak ada byte yang hilang karena pengambilan awal itu.
        if (awal.delta) teksAda = true;
        yield awal;
        for await (const p of dalam) {
          if (p.tokenMasuk !== undefined) masuk.nilai = p.tokenMasuk;
          if (p.tokenKeluar !== undefined) keluar.nilai = p.tokenKeluar;
          if (p.delta) teksAda = true;
          yield p;
        }
      } finally {
        if (teksAda) {
          await catatPemakaian(ctx.db, {
            provider: dipakai.provider,
            model: dipakai.model,
            jenis: "teks",
            tokenMasuk: masuk.nilai,
            tokenKeluar: keluar.nilai,
          }).catch(() => undefined);
        }
      }
    }
    return { ok: true, provider: k.provider, model: k.model, potongan: potongan() };
  }
  return gagal<never>(502, ringkasGagal(catatan, rantai), catatan);
}

/** Panggil image gen: coba provider tepat satu model (pilihan user/peta modelGambar, lalu katalog gambar). */
export async function panggilGambar(
  ctx: Konteks,
  minta: {
    prompt: string;
    referensi?: { mime: string; base64: string }[];
    /** Hints dari setting per user (halaman /ai-gambar). Kosong = pakai pengaturan global. */
    provider?: string;
    model?: string;
    /** Nilai reasoning; diteruskan ke adapter sebagai field opsional. '' = jangan kirim. */
    reasoning?: string;
    /** Rasio aspek pilihan user; diteruskan ke adapter sebagai field opsional. */
    aspekRasio?: string;
    /** Jumlah gambar yang diminta (1..4). Kosong = 1. */
    jumlah?: number;
  }
): Promise<Hasil<{ base64: string; mime: string; provider: string; model: string; dilewati?: string }>> {
  const catatan: Catatan[] = [];
  if (!ctx.kunci && !ctx.env?.AI_KEY_ENCRYPTION_KEY) return gagal(500, "AI_KEY_ENCRYPTION_KEY belum diset.");

  const set = await ambilPengaturanAI(ctx.db, ctx.env);
  const semuaProvider = (PROVIDER_OPENAI as string[]).concat("gemini");
  const dasar = (set.chainGambar.length > 0 ? set.chainGambar : [set.imageProvider || "gemini"]).filter(
    (p): p is ProviderNama => semuaProvider.includes(p)
  );
  // Provider pilihan user (bila sah) dipindah ke depan rantai — bukan mengganti rantai,
  // supaya fallback tetap jalan saat provider pilihan sedang bermasalah.
  const pilihan = String(minta.provider ?? "").trim();
  // Provider yang PUNYA model gambar terpilih juga harus ikut rantai.
  // MASALAH YANG DIPERBAIKI: sebelumnya rantai hanya dari chainGambar. Bila user
  // sudah memilih model gambar (atau memakai pengaturan global) untuk provider yang
  // tidak ada di chainGambar, model itu tidak pernah dicoba — dan yang muncul hanya
  // "tidak ada kredensial aktif" untuk provider lain yang belum diisi kuncinya.
  const berModelGambar = Object.keys(set.modelGambar).filter(
    (p): p is ProviderNama => semuaProvider.includes(p) && !!String(set.modelGambar[p] ?? "").trim()
  );
  const dasarLengkap = [...dasar, ...berModelGambar.filter((p) => !dasar.includes(p))];
  const rantaiGambar =
    pilihan && semuaProvider.includes(pilihan)
      ? [pilihan as ProviderNama, ...dasarLengkap.filter((p) => p !== pilihan)]
      : dasarLengkap;

  // Izin model gambar untuk role pemanggil, diambil SEKALI di luar rantai.
  // `null` = owner (tanpa batas); himpunan KOSONG = non-owner tanpa izin sama sekali
  // (fail closed) — lihat himpunanIzin di lib/d1/aiIzinModel.ts.
  const izinGambar = await himpunanIzin(ctx.db, ctx.role ?? "", "gambar");

  const gagalSemua = () => {
    // Bila SEMUA kandidat gagal karena kredensial, pesannya harus menuntun user
    // ke tindakan: provider mana yang perlu diisi kuncinya. Pesan "tidak ada
    // kredensial aktif" saja membingungkan karena user sudah mengisi satu provider.
    const tanpaKred = catatan.filter((c) => c.error.includes("tidak ada kredensial"));
    if (tanpaKred.length === catatan.length && catatan.length > 0) {
      const perlu = [...new Set(tanpaKred.map((c) => c.provider))];
      return gagal<{ base64: string; mime: string; provider: string; model: string; dilewati?: string }>(
        400,
        `Tidak ada kredensial aktif untuk: ${perlu.join(", ")}. ` +
          `Isi API key provider itu di Pengaturan → Kredensial Provider, ` +
          `atau pilih provider yang kredensialnya sudah ada (mis. di Model Default).`
      );
    }
    // Semua kandidat tersaring oleh izin → pesan yang bisa ditindaklanjuti. Tanpa cabang
    // ini user hanya melihat "semua provider gagal" dan menyangka kredensialnya rusak,
    // padahal masalahnya owner belum mengizinkan model gambar untuk role-nya.
    if (izinGambar !== null && catatan.length > 0 && catatan.every((c) => c.error.includes("tidak diizinkan"))) {
      return gagal<{ base64: string; mime: string; provider: string; model: string; dilewati?: string }>(
        403,
        "Belum ada model gambar yang diizinkan owner untuk role Anda. Hubungi owner untuk mengaktifkannya di Pengaturan AI → Izin Model per Role."
      );
    }
    return gagal<{ base64: string; mime: string; provider: string; model: string; dilewati?: string }>(502, ringkasGagal(catatan));
  };

  for (const provider of rantaiGambar) {
    const kred = await ambilKredensial(ctx.db, provider, ctx.kunci);
    if (!kred || !kred.plaintext) {
      catatan.push({ provider, model: "-", error: "tidak ada kredensial aktif" });
      continue;
    }
    const katalog = (await daftarModel(ctx.db, provider, "gambar")).filter((m) => m.aktif === 1).sort((a, b) => a.id - b.id);
    const kandidatId: string[] = [];
    // Model pilihan user hanya diprioritaskan di provider pilihannya.
    const modelUser = provider === pilihan ? String(minta.model ?? "").trim() : "";
    if (modelUser) kandidatId.push(modelUser);
    const pilih = set.modelGambar[provider];
    if (pilih) kandidatId.push(pilih);
    for (const m of katalog) if (!kandidatId.includes(m.model_id)) kandidatId.push(m.model_id);

    // INI titik lubang yang sudah pernah terjadi di repo ini: `modelGambar` datang dari body
    // permintaan, jadi memfilter pilihan di dropdown TIDAK menahan siapa pun yang mengirim
    // id model langsung ke /api/ai/gambar. Izin karena itu diperiksa di sini, tempat model
    // benar-benar ditentukan — bukan di route, bukan di UI.
    // `izin === null` = owner → melewati penyaringan sepenuhnya (owner tak pernah dibatasi).
    const id = izinGambar === null ? kandidatId : kandidatId.filter((m) => izinGambar.has(`${provider}\u0000${m}`));
    if (izinGambar !== null && id.length < kandidatId.length) {
      catatan.push({
        provider,
        model: "-",
        error: `ditolak: ${kandidatId.length - id.length} model tidak diizinkan owner untuk role ini`,
      });
    }

    for (const model of id) {
      // Reasoning diteruskan ke adapter; adapter yang tidak mendukung akan
      // mengabaikannya karena `terapkanReasoning` mengembalikan objek kosong.
      const mintaGambar = {
        model,
        prompt: minta.prompt,
        referensi: minta.referensi,
        reasoning: String(minta.reasoning ?? "").trim(),
        aspekRasio: String(minta.aspekRasio ?? "").trim(),
        jumlah: Number(minta.jumlah) > 0 ? Math.min(4, Math.floor(Number(minta.jumlah))) : 1,
      };
      const h =
        provider === "gemini"
          ? await gambarGemini({ apiKey: kred.plaintext, timeoutMs: 120000 }, mintaGambar)
          : await (async () => {
              const opsi = opsiUntuk(provider, kred.plaintext, ctx, 120000, kred.base_url ?? "");
              if (!opsi) return { ok: false as const, status: 400, error: `Provider ${provider} tidak mendukung image gen.`, latencyMs: 0 };
              return gambarOpenai(opsi, mintaGambar);
            })();
      if (!h.ok) {
        catatan.push({ provider, model, error: h.error });
        continue;
      }
      await catatPemakaian(ctx.db, { provider, model, jenis: "gambar" });
      // Bila ada percobaan yang dilewati sebelum model ini berhasil, sertakan di
      // respons supaya user tahu model pilihannya bermasalah (tidak diam-diam jatuh
      // ke model lain dan membingungkan).
      const dilewati = catatan.length > 0 ? ` Dilewati: ${ringkasGagal(catatan)}` : "";
      return { ok: true, base64: h.data.base64, mime: h.data.mime, provider, model, dilewati };
    }
  }
  return gagalSemua();
}
