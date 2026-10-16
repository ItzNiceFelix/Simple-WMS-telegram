// app/api/desain/layout/route.ts — Permintaan bahasa manusia → OPERASI KANVAS (Fase 4→7).
//
// KENAPA MODEL TEKS, bukan model gambar:
//   Estetika konsisten datang dari pola "template + slot" dan dari dokumen yang bisa
//   diedit ulang. Model gambar tidak bisa menjamin keduanya — hasilnya gambar jadi,
//   bukan kanvas.
//
// APA YANG DIPERBAIKI (defect nyata, bukan penyempurnaan):
//   Dulu route ini memanggil `panggilTeks(ctx, { pesan })` TANPA reasoning, TANPA
//   maksToken, TANPA modelDiminta. Itu satu-satunya jalur AI di repo ini tanpa kendali
//   model sama sekali: model penalaran memakai default provider (bisa timeout karena
//   jatah waktunya pendek), dan tidak ada plafon token padahal jawabannya JSON penuh.
//   Sekarang pola mengikuti lib/analisa/ai.ts:262-279 — reasoning + maksToken dari
//   setting PER USER (lib/d1/aiEditorSetting.ts + app/api/ai/editor/setting), dan
//   `hanyaModelDipilih: true` supaya model yang tidak dipilih user tidak pernah dipakai.
//   Sejak migrasi 0037 user juga boleh memilih MODEL-nya sendiri (kolom `model_editor`,
//   disimpan sebagai kunci izin `provider\0model`) — sebelumnya editor selalu jatuh ke
//   model teks global milik bot chat, padahal menyusun skrip canvas-op adalah tugas lain.
//   Model pilihan user dikirim apa adanya; yang memutuskan boleh/tidak hanya allowlist
//   role di lib/ai/provider.ts.
//
// KENAPA TOOL, BUKAN "BALAS JSON":
//   Skema parameter tool diperiksa provider SEBELUM model menjawab, jadi salah nama
//   field tertangkap lebih awal. Parameternya FLAT (satu objek, `op` sebagai diskriminan,
//   semua field tiap op opsional) — Gemini tidak mendukung union/oneOf/anyOf di skema
//   tool, lihat lib/desain/aiEditor.ts.
//
// KENAPA 502 untuk jawaban model yang rusak (bukan 500):
//   Kegagalan ada di sisi hilir (model), bukan bug server; 502 + cuplikan respons membuat
//   admin bisa membedakan "model melantur" dari "route salah".
import { getDb, getEnvAi, getKunciEnkripsi } from "@/lib/d1/db";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { panggilTeks, type Konteks } from "@/lib/ai/provider";
import type { BagianChat } from "@/lib/ai/http";
import { ambilSettingEditor } from "@/lib/d1/aiEditorSetting";
import { daftarElemen } from "@/lib/d1/elemenDesain";
import { NAMA_TOOL_EDITOR, SPESIFIKASI_TOOL_EDITOR, susunPromptEditor, type ElemenKanvasRingkas } from "@/lib/desain/aiEditor";
import { destruktif, validasiOperasi, type ElemenKatalog } from "@/lib/desain/skemaOperasi";
import {
  MAKS_ELEMEN,
  UKURAN_PRESET,
  buatTemplate,
  daftarTemplate,
  validasiLayout,
  type LayoutBanner,
} from "@/lib/desain/skemaLayout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batas panjang permintaan. 600 = cukup untuk satu brief promo, masih muat di prompt. */
const MAKS_PERMINTAAN = 600;
/** Panjang cuplikan respons model di pesan error — cukup untuk mendiagnosis, tidak membanjiri UI. */
const MAKS_CUPLIKAN = 300;
/** Batas elemen kanvas yang dikirim ke prompt. Di atas ini prompt membengkak tanpa guna
 *  (dan kanvas sendiri tidak pernah bisa melewati MAKS_ELEMEN). */
const MAKS_ELEMEN_PROMPT = MAKS_ELEMEN;

/** String dari body apa pun bentuknya; `undefined`/`null` jadi "". */
function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/**
 * Ambil objek JSON dari jawaban model: buang pagar ```json, lalu ambil objek/array pertama.
 * Dipakai untuk JALUR CADANGAN saja (model yang menjawab JSON, bukan memanggil tool);
 * dukungan ini dipertahankan karena sebagian provider di rantai kadang mengabaikan tool.
 */
function parseJsonLonggar(teks: string): unknown | null {
  const bersih = teks.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "").trim();
  const kandidat = [bersih];
  const awalObj = bersih.indexOf("{");
  const akhirObj = bersih.lastIndexOf("}");
  if (awalObj >= 0 && akhirObj > awalObj) kandidat.push(bersih.slice(awalObj, akhirObj + 1));
  const awalArr = bersih.indexOf("[");
  const akhirArr = bersih.lastIndexOf("]");
  if (awalArr >= 0 && akhirArr > awalArr) kandidat.push(bersih.slice(awalArr, akhirArr + 1));
  for (const k of kandidat) {
    try {
      return JSON.parse(k);
    } catch {
      // coba bentuk berikutnya
    }
  }
  return null;
}

/** Elemen kanvas kiriman klien → bentuk ramping untuk prompt. Masukan tidak dipercaya. */
function elemenPrompt(v: unknown): ElemenKanvasRingkas[] {
  if (!Array.isArray(v)) return [];
  const hasil: ElemenKanvasRingkas[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    const id = teks(e.id);
    if (!id) continue;
    const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
    const baris: ElemenKanvasRingkas = {
      id: id.slice(0, 120),
      jenis: teks(e.jenis) || "lain",
      x: num(e.x),
      y: num(e.y),
      w: num(e.w),
      h: num(e.h),
    };
    const t = teks(e.teks);
    if (t) baris.teks = t;
    hasil.push(baris);
    if (hasil.length >= MAKS_ELEMEN_PROMPT) break;
  }
  return hasil;
}

/**
 * Pustaka elemen preset → daftar untuk prompt. Hanya id/nama/kategori: `svg` dan
 * `elemen_json` TIDAK ikut (daftar ringan tidak menyentuh kolom berat, lihat
 * lib/d1/elemenDesain.ts) — bentuk kanoniknya dibaca KLIEN saat benar-benar
 * menyisipkan, satu permintaan ber-id.
 * Pustaka kosong bukan kegagalan: op `sisipkan_elemen` jadi no-op di klien.
 */
async function elemenPreset(db: D1Database, presetId: number): Promise<ElemenKatalog[]> {
  if (!Number.isFinite(presetId) || presetId <= 0) return [];
  const baris = await daftarElemen(db, presetId, { limit: 200 });
  return baris.map((b) => ({
    id: b.id,
    nama: b.nama,
    kategori: b.kategori,
    svg: "",
    // Placeholder saja: prompt hanya butuh id/nama/kategori. Bentuk kanonik yang benar
    // dibaca klien dari `?id=` saat benar-benar menyisipkan.
    elemen: { id: "", jenis: "persegi", x: 0, y: 0, w: 0, h: 0 },
  }));
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Hanya admin." }, 403);

  const body = await bacaBody(request);
  const presetId = Math.trunc(Number(body.presetId));
  const ukuran = teks(body.ukuran);
  const ukuranPiksel = UKURAN_PRESET[ukuran];
  if (!ukuranPiksel) {
    return json({ ok: false, error: `Ukuran tidak sah. Pilihan: ${Object.keys(UKURAN_PRESET).join(", ")}.` }, 400);
  }
  const permintaan = teks(body.permintaan);
  if (!permintaan) return json({ ok: false, error: "Permintaan wajib diisi." }, 400);
  if (permintaan.length > MAKS_PERMINTAAN) {
    return json({ ok: false, error: `Permintaan maksimal ${MAKS_PERMINTAAN} karakter.` }, 400);
  }

  const kunci = getKunciEnkripsi();
  if (!kunci) return json({ ok: false, error: "Kunci enkripsi AI belum diset." }, 500);
  const db = getDb();
  const ctx: Konteks = { db, kunci, env: getEnvAi(), role: sesi.user.role };

  // Preset toko yang tidak sah BUKAN alasan menolak permintaan: yang hilang cuma daftar
  // pustaka elemen di prompt. `elemenPreset` sendiri yang memagari angka <= 0.
  const katalog = await elemenPreset(db, presetId);

  // Mode bangun ulang membawa template sebagai JANGKAR bentuk: model melihat koordinat
  // asli template (bukan mengarang tata letak), sama seperti perilaku lama route ini.
  // Mode incremental TIDAK mengirim template — kalau dikirim, model cenderung menyalin
  // seluruh template dan berakhir "bangun ulang" walau user hanya minta memindahkan judul.
  const modeBangunUlang = teks(body.mode) === "bangun-ulang";
  const templateDiminta = teks(body.template);
  const meta = daftarTemplate();
  const dipilih = meta.find((t) => t.nama === templateDiminta) ?? meta[0];
  let templateAnchor = "";
  if (modeBangunUlang && dipilih) {
    templateAnchor =
      `\n\nTemplate dasar "${dipilih.nama}" (pertahankan strukturnya bila memakai op bangun_ulang):\n` +
      JSON.stringify(buatTemplate(dipilih.nama, ukuran, {}));
  }

  const pesan: BagianChat[] = [
    { role: "system", teks: "Kamu asisten desain yang mengubah kanvas lewat pemanggilan fungsi saja." },
    {
      role: "user",
      teks:
        susunPromptEditor({
          ukuran,
          lebar: ukuranPiksel.lebar,
          tinggi: ukuranPiksel.tinggi,
          elemen: elemenPrompt(body.elemen),
          punyaLatar: true, // klien selalu mengirim latar terkunci terpisah; prompt tidak perlu memutuskan
          katalog,
          permintaan,
        }) +
        (modeBangunUlang
          ? "\n\nMode: BANGUN ULANG. User menyetujui kanvas dikosongkan dan disusun ulang; pakai satu op `bangun_ulang` sebagai operasi terakhir."
          : "\n\nMode: UBAH KANVAS YANG ADA. JANGAN memakai op `bangun_ulang`.") +
        templateAnchor,
    },
  ];

  // Model + reasoning + plafon token dari setting PER USER; model kosong = model teks
  // GLOBAL. Pola yang sama dengan lib/analisa/ai.ts — lihat catatan defect di kepala berkas ini.
  const setting = await ambilSettingEditor(db, sesi.user.tg_id);

  // `model_editor` disimpan sebagai KUNCI IZIN (`provider\u0000model_id`, migrasi 0037):
  // provider pembawanya dibaca dari kunci itu, bukan ditebak dari rantai. Tanpa
  // `providerDiminta`, model pilihan user di provider NON-pertama tidak akan pernah
  // terpakai — `modelDiminta` lama hanya dibaca untuk provider pertama rantai.
  // Keizinan modelnya sendiri TIDAK diperiksa di sini: penegakannya di lib/ai/provider.ts
  // (`kandidatHanyaDipilih` menolak model di luar izin role) supaya satu tempat mengikat
  // semua jalur AI, termasuk izin yang dicabut owner SETELAH baris setting tersimpan.
  const pisah = setting.model_editor.indexOf("\u0000");
  const providerModelEditor = pisah > 0 ? setting.model_editor.slice(0, pisah) : "";
  const modelDiminta = pisah > 0 ? setting.model_editor.slice(pisah + 1) : "";

  const hasil = await panggilTeks(
    ctx,
    {
      pesan,
      tool: [SPESIFIKASI_TOOL_EDITOR],
      ...(modelDiminta ? { modelDiminta, providerDiminta: providerModelEditor } : {}),
      reasoning: setting.reasoning,
      maksToken: setting.maks_token,
      // Editor menyentuh pekerjaan user: model yang tidak dipilih user TIDAK boleh
      // dipakai diam-diam. Provider tanpa pilihan dilewati dengan catatan.
      hanyaModelDipilih: true,
    },
    "teks"
  );
  if (!hasil.ok) return json({ ok: false, error: hasil.error, upaya: hasil.upaya }, hasil.status);

  // Sumber argumen: panggilan tool lebih dulu, JSON bebas sebagai cadangan.
  const panggilanTool = (hasil.toolCall ?? []).find((t) => t.nama === NAMA_TOOL_EDITOR) ?? hasil.toolCall?.[0];
  let mentah: unknown = null;
  if (panggilanTool) {
    try {
      mentah = JSON.parse(panggilanTool.argumen);
    } catch {
      return json(
        { ok: false, error: `Argumen tool ${panggilanTool.nama} bukan JSON valid.`, cuplikan: panggilanTool.argumen.slice(0, MAKS_CUPLIKAN) },
        502
      );
    }
  } else {
    mentah = parseJsonLonggar(hasil.teks ?? "");
  }

  if (mentah === null) {
    return json(
      {
        ok: false,
        error: `Model tidak memanggil ${NAMA_TOOL_EDITOR} dan tidak mengembalikan JSON (${hasil.provider}/${hasil.model}).`,
        cuplikan: String(hasil.teks ?? "").slice(0, MAKS_CUPLIKAN),
      },
      502
    );
  }

  const bersih = validasiOperasi(mentah);
  if (!bersih.ok) {
    return json(
      {
        ok: false,
        error: `Operasi dari model ditolak: ${bersih.error}`,
        cuplikan: JSON.stringify(mentah).slice(0, MAKS_CUPLIKAN),
      },
      502
    );
  }

  // Op `bangun_ulang` membawa banner utuh; jalankan lewat validator layout yang sama
  // supaya bentuk dokumennya identik dengan template bawaan (`skemaLayout`). Satu op
  // yang gagal TIDAK membatalkan seluruh skrip: ia dibuang, sisanya tetap dipakai —
  // sama seperti op tak dikenal.
  const operasi = [];
  let dibuang = bersih.dibuang;
  for (const o of bersih.operasi) {
    if (o.op !== "bangun_ulang") {
      operasi.push(o);
      continue;
    }
    const layout = validasiLayout(o.layout);
    if (!layout.ok) {
      dibuang += 1;
      continue;
    }
    operasi.push({ ...o, layout: layout.layout as LayoutBanner });
  }
  if (operasi.length === 0) {
    return json({ ok: false, error: "Semua operasi dari model ditolak validator.", cuplikan: JSON.stringify(mentah).slice(0, MAKS_CUPLIKAN) }, 502);
  }

  return json({
    ok: true,
    operasi,
    dibuang,
    destruktif: destruktif(operasi),
    provider: hasil.provider,
    model: hasil.model,
  });
}
