// app/api/desain/layout/route.ts — Permintaan bahasa manusia → layout banner JSON (Fase 4).
//
// Kenapa model TEKS, bukan model gambar:
//   Estetika konsisten datang dari pola "template + slot". Model hanya mengisi teks slot
//   dan memilih warna dari palet; koordinat tetap milik template. Model gambar tidak bisa
//   menjamin itu — hasilnya gambar jadi, bukan dokumen yang bisa diedit di kanvas.
// Kenapa 502 untuk jawaban model yang rusak (bukan 500):
//   Kegagalan ada di sisi hilir (model), bukan bug server; 502 + cuplikan respons membuat
//   admin bisa membedakan "model melantur" dari "route salah".
import { getDb, getEnvAi, getKunciEnkripsi } from "@/lib/d1/db";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { panggilTeks, type Konteks } from "@/lib/ai/provider";
import type { BagianChat } from "@/lib/ai/http";
import {
  FONT_AMAN,
  MAKS_ELEMEN,
  PALET_WARNA,
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

/** String dari body apa pun bentuknya; `undefined`/`null` jadi "". Dipakai 4× di sini. */
function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/**
 * Ambil objek JSON dari jawaban model: buang pagar ```json, lalu ambil objek pertama.
 * Model sering menambah kalimat pembuka ("Berikut layoutnya:") walau sudah dilarang,
 * jadi mencari `{...}` pertama lebih andal daripada JSON.parse mentah.
 */
function parseJsonLonggar(teks: string): unknown | null {
  const bersih = teks.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "").trim();
  const kandidat = [bersih];
  const awal = bersih.indexOf("{");
  const akhir = bersih.lastIndexOf("}");
  if (awal >= 0 && akhir > awal) kandidat.push(bersih.slice(awal, akhir + 1));
  for (const k of kandidat) {
    try {
      return JSON.parse(k);
    } catch {
      // coba bentuk berikutnya
    }
  }
  return null;
}

/** Prompt pengisian slot template. Dilarang keras mengarang struktur: itu wewenang template. */
function susunPrompt(nama: string, label: string, ukuran: string, slot: string[], permintaan: string): string {
  const ukuranPiksel = UKURAN_PRESET[ukuran];
  const slotAktif = slot.length > 0 ? slot.join(", ") : "tidak ada slot";
  return [
    `Kamu mengisi teks slot layout banner ${label} (template "${nama}") berukuran ${ukuranPiksel.lebar}x${ukuranPiksel.tinggi} piksel.`,
    "ATURAN MENGIKAT:",
    "1. JANGAN mengubah struktur, koordinat, ukuran, atau jumlah elemen template. Kamu HANYA mengisi nilai teks dan warna.",
    `2. Warna HANYA boleh dari palet ini: ${PALET_WARNA.join(", ")}.`,
    `3. Font HANYA boleh dari daftar ini: ${FONT_AMAN.join(", ")}.`,
    `4. Slot yang boleh diisi: ${slotAktif}. Isi maksimum ${MAKS_ELEMEN} elemen.`,
    "5. Balas HANYA JSON (tanpa penjelasan, tanpa pagar markdown).",
    "",
    'Bentuk balasan: {"versi":1,"latarBelakang":"#RRGGBB","elemen":[{"jenis":"teks","id":"...","teks":"...","font":"...","warna":"#RRGGBB","ukuran":48}]}',
    "Sertakan elemen non-teks template apa adanya (jenis persegi/lingkaran/garis/gambar) agar tata letak tetap utuh, hanya warnanya yang boleh kamu pilih dari palet.",
    "",
    `Permintaan user: ${permintaan}`,
  ].join("\n");
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Hanya admin." }, 403);

  const body = await bacaBody(request);
  const presetId = teks(body.presetId);
  const ukuran = teks(body.ukuran);
  if (!UKURAN_PRESET[ukuran]) {
    return json({ ok: false, error: `Ukuran tidak sah. Pilihan: ${Object.keys(UKURAN_PRESET).join(", ")}.` }, 400);
  }
  const permintaan = teks(body.permintaan);
  if (!permintaan) return json({ ok: false, error: "Permintaan wajib diisi." }, 400);
  if (permintaan.length > MAKS_PERMINTAAN) {
    return json({ ok: false, error: `Permintaan maksimal ${MAKS_PERMINTAAN} karakter.` }, 400);
  }
  if (presetId && !/^[\w.:-]+$/.test(presetId)) {
    return json({ ok: false, error: "presetId tidak sah." }, 400);
  }

  const templateDiminta = teks(body.template);
  const meta = daftarTemplate();
  const dipilih = meta.find((t) => t.nama === templateDiminta) ?? meta[0];
  if (!dipilih) return json({ ok: false, error: "Tidak ada template tersedia." }, 500);

  const kunci = getKunciEnkripsi();
  if (!kunci) return json({ ok: false, error: "Kunci enkripsi AI belum diset." }, 500);
  const ctx: Konteks = { db: getDb(), kunci, env: getEnvAi() };

  // Template kosong jadi jangkar bentuk: model melihat koordinat asli lalu mengisinya,
  // sehingga struktur yang dikembalikan pasti menyerupai template.
  const kerangka = buatTemplate(dipilih.nama, ukuran, {});
  const pesan: BagianChat[] = [
    { role: "system", teks: "Kamu asisten desain yang hanya membalas JSON valid." },
    { role: "user", teks: `${susunPrompt(dipilih.nama, dipilih.label, ukuran, dipilih.slot, permintaan)}\n\nTemplate dasar (pertahankan struktur ini):\n${JSON.stringify(kerangka)}` },
  ];

  const hasil = await panggilTeks(ctx, { pesan });
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);

  const parsed = parseJsonLonggar(hasil.teks ?? "");
  if (parsed === null) {
    return json(
      { ok: false, error: `Model tidak mengembalikan JSON valid (${hasil.provider}/${hasil.model}).`, cuplikan: String(hasil.teks ?? "").slice(0, MAKS_CUPLIKAN) },
      502
    );
  }

  const bersih = validasiLayout(parsed);
  if (!bersih.ok) {
    return json({ ok: false, error: `Layout dari model ditolak: ${bersih.error}`, cuplikan: String(hasil.teks ?? "").slice(0, MAKS_CUPLIKAN) }, 502);
  }

  return json({ ok: true, layout: bersih.layout as LayoutBanner, template: dipilih.nama, provider: hasil.provider, model: hasil.model });
}
