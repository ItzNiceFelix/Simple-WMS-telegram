// lib/dashboard/data/normalisasi.ts
// Replika TS MURNI dari normalizer model server (`lib/models/dailyRequests.js`):
// `normalisasiItemLama` / `normalisasiStatusDokumen` / `gabungItemDuplikat`.
//
// B3 (PRD v3a §4.2): jalur baca UI (`real.ts` client SDK + `mock.ts`) WAJIB menormalisasi item
// saat baca. Item lama dari bot hanya `{ kode_barang, nama, variasi, qty, buffer }`; tanpa
// normalizer, `qty_diminta` = `undefined` di UI (TS mengira ada) -> pesan/angka kosong.
// Model server TIDAK pernah jalan di jalur baca UI, jadi logika ini single-sourced untuk UI.

import type {
  DailyRequestDoc,
  DailyRequestItem,
  DailyRequestStatus,
  PerubahanQty,
} from "../types";

const STATUS_DOKUMEN_VALID: DailyRequestStatus[] = ["draft", "diproses", "selesai"];

/** Status efektif dokumen; nilai tak dikenal (mis. mock lama `"sent"`) -> `"draft"`. */
export function normalisasiStatusDokumen(status: unknown): DailyRequestStatus {
  return STATUS_DOKUMEN_VALID.includes(status as DailyRequestStatus)
    ? (status as DailyRequestStatus)
    : "draft";
}

/** Konverter nilai waktu mentah -> ISO string (Firestore Timestamp/Date/ISO). */
type KeIso = (v: unknown) => string | null;

/** Default: terima apa adanya bila sudah string (mock sudah ISO). */
const keIsoIdentitas: KeIso = (v) => (typeof v === "string" ? v : null);

/** Item mentah Firestore -> bentuk kanonik (field baru terisi, tidak `undefined`).
 *  `keIso` WAJIB disuntik dari `real.ts` supaya `datang_at` (Firestore Timestamp)
 *  tidak jatuh jadi null — BUG lama: cek `typeof === "string"` tanpa konversi. */
export function normalisasiItemLama(mentah: unknown, keIso: KeIso = keIsoIdentitas): DailyRequestItem {
  const it = (mentah && typeof mentah === "object" ? mentah : {}) as Record<string, unknown>;
  const qty = typeof it.qty === "number" && Number.isFinite(it.qty) ? it.qty : 0;
  return {
    // Field lama dipertahankan (spread) lalu ditimpa bentuk kanonik.
    ...it,
    kode_barang: String(it.kode_barang ?? ""),
    nama: String(it.nama ?? ""),
    variasi: typeof it.variasi === "string" && it.variasi ? it.variasi : "-",
    qty,
    buffer: it.buffer === true,
    status: it.status === "datang" ? "datang" : "diminta",
    qty_diminta:
      typeof it.qty_diminta === "number" && Number.isFinite(it.qty_diminta)
        ? it.qty_diminta
        : qty,
    qty_datang:
      typeof it.qty_datang === "number" && Number.isFinite(it.qty_datang)
        ? it.qty_datang
        : null,
    datang_at: keIso(it.datang_at),
    datang_by: typeof it.datang_by === "string" ? it.datang_by : null,
  };
}

/**
 * Gabung HANYA bila `kode_barang` + `variasi` + `buffer` (+ status efektif) sama persis (T1).
 * `buffer` beda = baris terpisah (MINTA_SISA vs MINTA tidak boleh bercampur).
 */
export function gabungItemDuplikat(items: unknown[]): DailyRequestItem[] {
  const peta = new Map<string, DailyRequestItem>();
  for (const mentah of items ?? []) {
    const item = normalisasiItemLama(mentah, keIsoIdentitas);
    const kunci = `${item.kode_barang}::${item.variasi}::${item.buffer === true}::${item.status}`;
    const ada = peta.get(kunci);
    if (!ada) {
      peta.set(kunci, { ...item });
      continue;
    }
    ada.qty = (ada.qty ?? 0) + (item.qty ?? 0);
    ada.qty_diminta = (ada.qty_diminta ?? 0) + (item.qty_diminta ?? 0);
    if (ada.status === "datang") {
      ada.qty_datang = (ada.qty_datang ?? 0) + (item.qty_datang ?? 0);
    }
  }
  return [...peta.values()];
}

/** `perubahan[]` mentah -> array aman (E18: data rusak -> `[]`). */
export function normalisasiPerubahan(mentah: unknown): PerubahanQty[] {
  if (!Array.isArray(mentah)) return [];
  return mentah
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const x = p as Record<string, unknown>;
      return {
        key_item: String(x.key_item ?? ""),
        qty_lama: typeof x.qty_lama === "number" ? x.qty_lama : 0,
        qty_baru: typeof x.qty_baru === "number" ? x.qty_baru : 0,
        oleh: String(x.oleh ?? ""),
        at: typeof x.at === "string" ? x.at : "",
      };
    });
}

/**
 * Bentuk kanonik dokumen `daily_requests` untuk jalur baca UI.
 * `keIso` disuntik supaya `real.ts` bisa konversi Firestore Timestamp/Date -> ISO.
 */
export function normalisasiDokumen(
  tanggal: string,
  data: Record<string, unknown>,
  keIso: (v: unknown) => string | null
): DailyRequestDoc {
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    tanggal,
    items: items.map((it) => normalisasiItemLama(it, keIso)),
    status: normalisasiStatusDokumen(data.status),
    created_at: keIso(data.created_at) ?? new Date(0).toISOString(),
    form_dibuat_at: keIso(data.form_dibuat_at),
    form_dibuat_by: data.form_dibuat_by == null ? null : String(data.form_dibuat_by),
    selesai_at: keIso(data.selesai_at),
    selesai_by: data.selesai_by == null ? null : String(data.selesai_by),
    updated_at: keIso(data.updated_at),
    updated_by: data.updated_by == null ? null : String(data.updated_by),
    perubahan: normalisasiPerubahan(data.perubahan),
  };
}