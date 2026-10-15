// lib/desain/aiEditor.ts — Prompt + skema TOOL untuk AI editor kanvas. FUNGSI MURNI.
//
// Dipisah dari route supaya aturan yang diuji adalah LARANGANNYA (jangan mengubah
// struktur yang tidak disebut, jangan mengarang id, jangan memakai warna di luar palet),
// bukan gaya bahasa prompt.
//
// ── PEMBATAS KERAS: SKEMA TOOL HARUS FLAT ─────────────────────────────────────
// Gemini TIDAK mendukung `union`/`oneOf`/`anyOf` di skema parameter tool (terdokumentasi
// di rujukan `fancyboi999/Loomic`; Gemini ada di rantai provider repo ini dan bukan
// provider yang bisa dilewati). Karena itu SATU properti menggambarkan SEMUA op:
// `operasi` = array objek dengan `op` sebagai diskriminan dan SELURUH field tiap op
// sebagai properti opsional bertipe tunggal. Tidak ada `oneOf`, tidak ada `anyOf`,
// tidak ada union bersarang — konsekuensinya model bisa mengirim field yang tidak
// relevan untuk suatu op, dan itu MEMANG ditangani: `bersihkanOp` (lib/desain/skemaOperasi.ts)
// mengabaikan field yang tidak dipakai op tersebut.
//
// KENAPA TOOL, bukan sekadar "balas JSON":
//   Bentuk balasan JSON-be bas bisa apa saja; skema tool adalah kontrak yang diperiksa
//   provider SEBELUM model menjawab, jadi field yang salah nama tertangkap lebih awal.
//   Sekaligus jalur ini sudah ada di provider.ts (param `tool`), tidak ada mekanisme baru.

import type { ElemenKatalog } from "./skemaOperasi";
import { BENTUK_SAH, OP_DIKENAL } from "./skemaOperasi";
import { FONT_AMAN, PALET_WARNA, type ElemenLayout } from "./skemaLayout";

/** Nama tool. Dipakai route untuk mengenali balasan sekaligus sebagai dokumentasi. */
export const NAMA_TOOL_EDITOR = "terapkan_operasi_kanvas";

/**
 * Skema parameter tool — FLAT, satu objek, tanpa union/oneOf/anyOf di level mana pun.
 * `additionalProperties: true` disengaja: model yang menambah field asing masih bisa
 * dipakai (field itu diabaikan validator), sedangkan menolaknya membuat seluruh
 * pemanggilan gagal hanya karena satu properti tambahan.
 */
export const SKEMA_TOOL_EDITOR: Record<string, unknown> = {
  type: "function",
  function: {
    name: NAMA_TOOL_EDITOR,
    description:
      "Ubah kanvas desain banner lewat daftar operasi. Operasi dijalankan berurutan dari atas ke bawah.",
    parameters: {
      type: "object",
      additionalProperties: true,
      properties: {
        operasi: {
          type: "array",
          description: "Daftar operasi, urut. Kosong berarti tidak ada perubahan.",
          items: {
            type: "object",
            additionalProperties: true,
            properties: {
              op: {
                type: "string",
                description:
                  "Jenis operasi. Salah satu dari: " + OP_DIKENAL.join(", ") + ".",
              },
              id: { type: "string", description: "Id satu elemen pada kanvas (dari daftar elemen di pesan)." },
              ids: {
                type: "array",
                items: { type: "string" },
                description: "Beberapa id elemen (untuk kelompok/sejajar/distribusi/hapus banyak).",
              },
              teks: { type: "string", description: "Isi teks baru (op tambah_teks / ubah_gaya)." },
              font: { type: "string", description: "Nama font. Salah satu dari: " + FONT_AMAN.join(", ") + "." },
              ukuran: { type: "number", description: "Ukuran font dalam piksel dokumen (bukan 0..1)." },
              warna: {
                type: "string",
                description: "Warna hex dari palet ini saja: " + PALET_WARNA.join(", ") + ".",
              },
              x: { type: "number", description: "Posisi kiri, piksel dokumen." },
              y: { type: "number", description: "Posisi atas, piksel dokumen." },
              w: { type: "number", description: "Lebar, piksel dokumen." },
              h: { type: "number", description: "Tinggi, piksel dokumen." },
              rotasi: { type: "number", description: "Sudut putar derajat, 0-359." },
              tebal: { type: "boolean", description: "Teks tebal." },
              miring: { type: "boolean", description: "Teks miring." },
              garisBawah: { type: "boolean", description: "Teks bergaris bawah." },
              opasitas: { type: "number", description: "Transparansi 0..1." },
              arah: { type: "string", description: "Untuk op lapisan: atas, bawah, depan, atau belakang." },
              sisi: {
                type: "string",
                description: "Untuk op sejajar: kiri, tengah, kanan, atas, tengah_v, atau bawah.",
              },
              sumbu: { type: "string", description: "Untuk op distribusi: horizontal atau vertikal." },
              latarBelakang: {
                type: "string",
                description: "Warna latar kanvas, hex dari palet: " + PALET_WARNA.join(", ") + ".",
              },
              elemen_id: {
                type: "integer",
                description: "Untuk op sisipkan_elemen: id dari daftar PUSTAKA ELEMEN di pesan.",
              },
              layout: {
                type: "object",
                additionalProperties: true,
                description:
                  "HANYA untuk op bangun_ulang: satu banner utuh {versi:1, latarBelakang, elemen:[...]}. Mengganti SELURUH isi kanvas (kecuali latar terkunci).",
              },
            },
            required: ["op"],
          },
        },
      },
      required: ["operasi"],
    },
  },
};

/** Satu elemen kanvas yang boleh dirujuk AI; bentuknya sengaja ramping. */
export type ElemenKanvasRingkas = {
  id: string;
  jenis: string;
  teks?: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Ringkas elemen kanvas untuk prompt. Angka dibulatkan: model tidak butuh presisi
 * sub-piksel, dan angka bulat mengurangi peluang model menyalin angka desimal panjang
 * lalu salah ketik. `terkunci` = objek latar — disebut TERPISAH supaya model tidak
 * mengira ia boleh dipindah/dihapus.
 */
export function ringkasElemenKanvas(elemen: ElemenKanvasRingkas[]): string {
  if (elemen.length === 0) return "(kanvas kosong)";
  return elemen
    .map((e) => {
      const bagian = [`${e.id}`, e.jenis, `x=${Math.round(e.x)}`, `y=${Math.round(e.y)}`, `w=${Math.round(e.w)}`, `h=${Math.round(e.h)}`];
      if (e.teks) bagian.push(`teks="${e.teks.slice(0, 60)}"`);
      return bagian.join(" ");
    })
    .join("\n");
}

/** Baris pustaka elemen untuk prompt: id + nama + kategori. Markup SVG TIDAK dikirim. */
export function ringkasElemenKatalog(daftar: ElemenKatalog[]): string {
  if (daftar.length === 0) return "(pustaka elemen kosong)";
  return daftar.map((e) => `${e.id}\t${e.nama}\t${e.kategori}`).join("\n");
}

export type KonteksPrompt = {
  ukuran: string;
  lebar: number;
  tinggi: number;
  elemen: ElemenKanvasRingkas[];
  punyaLatar: boolean;
  katalog: ElemenKatalog[];
  permintaan: string;
};

/**
 * Prompt pengguna. ATURAN MENGIKAT ditulis sebagai larangan bernomor, bukan saran:
 * model yang "merapikan sendiri" pekerjaan user adalah keluhan yang paling mahal di
 * fitur ini — user kehilangan desain yang tidak diminta diubah.
 */
export function susunPromptEditor(k: KonteksPrompt): string {
  return [
    `Kamu menyunting banner toko (bukan membuat gambar baru) berukuran ${k.lebar}x${k.tinggi} piksel (${k.ukuran}).`,
    "",
    "ATURAN MENGIKAT:",
    "1. JANGAN mengubah elemen yang tidak disebut permintaan user. Pekerjaan user itu berharga.",
    "2. Koordinat x/y/w/h dalam PIXEL DOKUMEN (bukan 0..1). x=0 y=0 adalah kiri atas.",
    "3. Rujuk elemen yang SUDAH ada lewat `id` dari daftar di bawah. JANGAN mengarang id.",
    "4. Warna HANYA dari palet ini: " + PALET_WARNA.join(", ") + ".",
    "5. Font HANYA dari daftar ini: " + FONT_AMAN.join(", ") + ".",
    "6. Bentuk yang bisa ditambah: " + BENTUK_SAH.join(", ") + ".",
    "7. Pakai `bangun_ulang` HANYA bila user meminta tata letak dibuat ulang dari nol. Op itu",
    "   MENGHAPUS seluruh isi kanvas (kecuali latar terkunci). Untuk permintaan kecil",
    "   (tambah/pindah/ubah warna/hapus satu objek) pakai op yang sesuai — JANGAN bangun_ulang.",
    "8. Balas HANYA lewat pemanggilan fungsi " + NAMA_TOOL_EDITOR + ". Tanpa penjelasan tambahan.",
    "",
    k.punyaLatar
      ? "CATATAN: kanvas punya LATAR TERKUNCI di dasar tumpukan. Jangan memindahkan atau menghapusnya."
      : "CATATAN: kanvas belum punya latar terkunci.",
    "",
    "ELEMEN YANG ADA DI KANVAS SAAT INI (id jenis x y w h):",
    ringkasElemenKanvas(k.elemen),
    "",
    "PUSTAKA ELEMEN VEKTOR (id<TAB>nama<TAB>kategori) — pakai op sisipkan_elemen + elemen_id:",
    ringkasElemenKatalog(k.katalog),
    "",
    `Permintaan user: ${k.permintaan}`,
  ].join("\n");
}

/** Elemen dari pustaka → `ElemenLayout` siap-render, dengan id dokumen ditentukan klien. */
export function layoutDariElemen(e: ElemenLayout, id: string): ElemenLayout {
  return { ...e, id };
}
