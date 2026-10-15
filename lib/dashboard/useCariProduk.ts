"use client";

// lib/dashboard/useCariProduk.ts
// Pemilih produk berbasis pencarian SERVER.
//
// Dulu tiga halaman (permintaan-gudang, opname-gudang, permintaan) memanggil
// `listStock()` tanpa limit hanya untuk mengisi satu dropdown/Combobox: seluruh katalog
// (~2000 baris JOIN products x stock_by_bin) dikirim ke klien supaya user bisa mengetik
// di kotak yang isinya sudah lengkap. Boros, dan makin boros seiring katalog tumbuh.
//
// Sekarang pencarian dilakukan di D1 (`listStockHalaman({ q })` — q dicari di SKU + nama
// lewat SQL). Hasil tetap LENGKAP untuk apa pun yang diketik user; batas 50 hanya
// memotong apa yang dikirim per ketikan, bukan apa yang bisa ditemukan.
import { useEffect, useState } from "react";

import { useData } from "@/lib/dashboard/sumber-data";
import type { StockRow } from "@/lib/dashboard/types";

/** Batas baris per pencarian; cukup untuk satu dropdown dan tetap murah di D1. */
export const LIMIT_CARI_PRODUK = 50;

/** Jeda ketikan -> request (ms). Sama dengan /stok supaya rasa pencarian konsisten. */
const JEDA_MS = 300;

export interface CariProduk {
  /** Hasil pencarian terakhir + baris nilai terpilih (maks 50 hasil). */
  daftar: StockRow[];
  /** True selagi menunggu debounce/request; daftar lama tetap dipakai agar tidak berkedip. */
  memuat: boolean;
  /** Kata kunci yang sedang diketik. */
  cari: string;
  setCari: (q: string) => void;
}

/**
 * Cari produk di server dengan debounce.
 *
 * `kodeTerpilih` TIDAK dipakai untuk memfilter; barisnya ditahan lewat `getProduk` supaya
 * label pilihan yang sudah ditetapkan tidak hilang saat user mengetik kata lain. Karena
 * itu pilihan disimpan sebagai kode (string), bukan indeks ke daftar opsi yang berubah.
 */
export function useCariProduk(kodeTerpilih: string[] = []): CariProduk {
  const data = useData();
  const [cari, setCari] = useState("");
  const [daftar, setDaftar] = useState<StockRow[]>([]);
  const [memuat, setMemuat] = useState(true);
  // Baris yang ditahan di luar hasil pencarian (nilai terpilih), di-key oleh kode.
  const [ditahan, setDitahan] = useState<StockRow[]>([]);
  const kunciTerpilih = kodeTerpilih.filter(Boolean).join("\u0000");
  const kunciDitahan = ditahan.map((r) => r.kode_barang).join("\u0000");

  useEffect(() => {
    const kode = kunciTerpilih ? kunciTerpilih.split("\u0000") : [];
    const sudah = new Set(kunciDitahan ? kunciDitahan.split("\u0000") : []);
    const perlu = kode.filter((k) => !sudah.has(k));
    if (perlu.length === 0) return;
    let batal = false;
    void (async () => {
      try {
        // `getProduk` tidak membawa qty per gudang (dipakai /stok/[kode]); `listStockHalaman`
        // membawa baris penuh, jadi nilai terpilih tetap punya `qty_per_gudang` untuk opname.
        // `q` adalah LIKE substring, jadi ambil satu halaman penuh lalu cari baris yang
        // kodenya PERSIS cocok — bukan mengandalkan urutan hasil.
        const hasil = await Promise.all(
          perlu.map((k) => data.listStockHalaman({ q: k, limit: LIMIT_CARI_PRODUK }))
        );
        if (batal) return;
        const tepat = new Map<string, StockRow>();
        for (const { rows } of hasil) for (const r of rows) tepat.set(r.kode_barang, r);
        const baris: StockRow[] = [];
        for (const k of perlu) {
          const r = tepat.get(k);
          if (r) baris.push(r);
        }
        if (baris.length > 0) setDitahan((lama) => [...lama, ...baris]);
      } catch {
        // abaikan: label pilihan boleh jatuh kembali ke kode mentah kalau detail gagal.
      }
    })();
    return () => {
      batal = true;
    };
  }, [data, kunciTerpilih, kunciDitahan]);

  useEffect(() => {
    let batal = false;
    const t = setTimeout(() => {
      setMemuat(true);
      void (async () => {
        try {
          const { rows } = await data.listStockHalaman({
            q: cari.trim() || undefined,
            limit: LIMIT_CARI_PRODUK,
          });
          if (!batal) setDaftar(rows);
        } catch {
          if (!batal) setDaftar([]);
        } finally {
          if (!batal) setMemuat(false);
        }
      })();
    }, JEDA_MS);
    return () => {
      batal = true;
      clearTimeout(t);
    };
  }, [data, cari]);

  const gabung = new Map(daftar.map((r) => [r.kode_barang, r]));
  for (const k of kodeTerpilih) {
    if (gabung.has(k)) continue;
    const r = ditahan.find((x) => x.kode_barang === k);
    if (r) gabung.set(k, r);
  }

  return { daftar: [...gabung.values()], memuat, cari, setCari };
}
