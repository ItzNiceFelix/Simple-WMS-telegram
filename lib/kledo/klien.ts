// lib/kledo/klien.ts — Klien HTTP Kledo.
//
// BATAS MUTLAK: modul ini HANYA MEMBACA. Tidak ada POST/PUT/PATCH/DELETE ke Kledo.
// Satu-satunya metode HTTP di sini adalah GET, dan itu disengaja — bukan kelalaian.
//
// Bentuk respons Kledo (diverifikasi live 2026-10-14):
//   Tunggal : { success, data: {...}, message, time }
//   Berpaginasi: { success, data: { data: [...], current_page, last_page, per_page, total }, ... }
//   Berhasil = status 200 DAN success === true.
//
// Batas yang DIUKUR, bukan diasumsikan:
//   - `per_page` dipatok 100 oleh Kledo (minta 200/500 tetap 100).
//   - `product_ids` tahan 200+.
//   - Tidak ada 429 selama ~30 request pengukuran; tetap ditangani (defensif).

export type OpsiKledo = {
  subdomain: string;
  token: string;
  timeoutMs?: number;
  /** Maks percobaan ulang untuk 5xx/429/error jaringan. Default 3. */
  retry?: number;
};

export type HasilKledo<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/** Halaman hasil list. `selesai=true` berarti tidak ada halaman berikutnya. */
export type Halaman<T> = {
  baris: T[];
  halaman: number;
  totalHalaman: number;
  total: number;
  selesai: boolean;
};

export const PER_PAGE_MAKS = 100;
/** Potongan `product_ids` terbukti aman di 200. */
export const CHUNK_PRODUK = 200;

const JEDA_MS = [1000, 2000, 4000];

function tunda(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Potong array jadi bagian-bagian berukuran `n`. */
export function potong<T>(arr: T[], n: number): T[][] {
  if (n < 1) throw new Error("potong: ukuran harus >= 1");
  const hasil: T[][] = [];
  for (let i = 0; i < arr.length; i += n) hasil.push(arr.slice(i, i + n));
  return hasil;
}

/**
 * GET satu path Kledo dengan timeout + retry terbatas.
 * `path` relatif terhadap base, mis. "/finance/warehouses?include_archive=1".
 */
export async function kledoGet<T>(opsi: OpsiKledo, path: string): Promise<HasilKledo<T>> {
  const base = `https://${opsi.subdomain}.api.kledo.com/api/v1`;
  const url = `${base}${path}`;
  const maks = Math.max(1, opsi.retry ?? 3);
  const timeoutMs = opsi.timeoutMs ?? 30000;
  let terakhir: { status: number; error: string } = { status: 0, error: "belum dipanggil" };

  for (let coba = 0; coba < maks; coba++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${opsi.token}`, Accept: "application/json" },
        signal: ac.signal,
      });
      const teks = await res.text();
      let body: unknown = null;
      try {
        body = JSON.parse(teks);
      } catch {
        // Bukan JSON: simpan potongan mentah supaya pesan errornya berguna.
        terakhir = { status: res.status, error: `Bukan JSON (HTTP ${res.status}): ${teks.slice(0, 200)}` };
        if (res.status >= 500) {
          if (coba + 1 < maks) await tunda(JEDA_MS[Math.min(coba, JEDA_MS.length - 1)]);
          continue;
        }
        return { ok: false, ...terakhir };
      }

      const b = body as { success?: boolean; data?: unknown; message?: string } | null;
      if (res.status === 200 && b?.success === true) {
        return { ok: true, data: b.data as T };
      }

      const pesan = b?.message || `HTTP ${res.status}`;
      terakhir = { status: res.status, error: `Kledo menolak (HTTP ${res.status}): ${pesan.slice(0, 300)}` };
      // 5xx dan 429 layak diulang; 4xx lain tidak (salah token/param = tidak akan berubah).
      if (res.status >= 500 || res.status === 429) {
        if (coba + 1 < maks) await tunda(JEDA_MS[Math.min(coba, JEDA_MS.length - 1)]);
        continue;
      }
      return { ok: false, ...terakhir };
    } catch (e) {
      const pesan = e instanceof Error ? e.message : String(e);
      terakhir = { status: 0, error: `Gagal menghubungi Kledo: ${pesan}` };
      if (coba + 1 < maks) await tunda(JEDA_MS[Math.min(coba, JEDA_MS.length - 1)]);
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, ...terakhir };
}

type BentukHalaman<T> = {
  data?: T[];
  current_page?: number;
  last_page?: number;
  per_page?: number;
  total?: number;
  next_page_url?: string | null;
};

/** Baca satu halaman list Kledo. */
export function bacaHalaman<T>(d: BentukHalaman<T>, halaman: number): Halaman<T> {
  const baris = Array.isArray(d?.data) ? d.data : [];
  const totalHalaman = Number(d?.last_page ?? halaman);
  const nomor = Number(d?.current_page ?? halaman);
  // Selesai bila: tidak ada baris, sudah di halaman terakhir, atau next_page_url null.
  // Dua sinyal dipakai bersama karena salah satu saja bisa meleset bila Kledo mengubah bentuk.
  const selesai = baris.length === 0 || nomor >= totalHalaman || d?.next_page_url === null;
  return { baris, halaman: nomor, totalHalaman, total: Number(d?.total ?? baris.length), selesai };
}

/** Ambil SATU halaman. Pengulangan halaman ditangani pemanggil (lihat ambilSemua). */
export async function kledoHalaman<T>(opsi: OpsiKledo, path: string, halaman: number): Promise<HasilKledo<Halaman<T>>> {
  const pemisah = path.includes("?") ? "&" : "?";
  const h = await kledoGet<BentukHalaman<T>>(opsi, `${path}${pemisah}page=${halaman}`);
  if (!h.ok) return h;
  return { ok: true, data: bacaHalaman(h.data, halaman) };
}

/**
 * Telusuri SEMUA halaman sebuah list.
 * `pagarHalaman` mencegah loop tak berujung bila Kledo mengembalikan bentuk tak terduga.
 */
export async function ambilSemua<T>(
  opsi: OpsiKledo,
  path: string,
  pagarHalaman = 200
): Promise<HasilKledo<T[]>> {
  const semua: T[] = [];
  let halaman = 1;
  for (;;) {
    const h = await kledoHalaman<T>(opsi, path, halaman);
    if (!h.ok) return h;
    semua.push(...h.data.baris);
    if (h.data.selesai) break;
    halaman = h.data.halaman + 1;
    if (halaman > pagarHalaman) {
      return { ok: false, status: 0, error: `Melebihi batas ${pagarHalaman} halaman; dihentikan agar tidak berputar tanpa henti.` };
    }
  }
  return { ok: true, data: semua };
}

// ── Bentuk data Kledo yang dipakai (diverifikasi live) ──

export type GudangKledo = {
  id: number;
  name: string;
  code: string;
  is_archive?: number;
  parent_warehouse_id?: number | null;
};

export type ProdukKledo = {
  id: number;
  name: string;
  code: string;
  avg_base_price?: number | null;
  qty?: number;
  is_archive?: number;
  variant_type_id?: number;
  bundle_type_id?: number;
  unit?: { id: number; name: string } | null;
};

export type StokGudangKledo = {
  warehouse_id: number;
  qty: number;
  avg_price?: number | null;
  product_val?: number | null;
};

export type StokProdukKledo = {
  id: string;              // id produk (string di respons stocks)
  qty: number;
  stocks: Record<string, StokGudangKledo>;
};

/** Ambil semua gudang (termasuk arsip; exclude_qty agar payload ringan). */
export function ambilGudang(opsi: OpsiKledo): Promise<HasilKledo<GudangKledo[]>> {
  return ambilSemua<GudangKledo>(opsi, "/finance/warehouses?include_archive=1&exclude_qty=1");
}

/** Ambil semua produk (termasuk arsip). `per_page` dipatok Kledo di 100. */
export function ambilProduk(opsi: OpsiKledo): Promise<HasilKledo<ProdukKledo[]>> {
  // JANGAN pakai show_columns di sini: `avg_base_price` DITOLAK sebagai kolom
  // ("Kolom avg_base_price tidak valid", HTTP 400). Kolom yang diizinkan hanya
  // id,name,photo,code,description,category,base_price,price,qty,hpp,is_track,unit_id
  // — dan `hpp` di daftar itu BUKAN nilai HPP yang dipakai (terbukti bisa 0 saat
  // avg_base_price berisi). Payload penuh lebih besar tapi benar.
  return ambilSemua<ProdukKledo>(opsi, `/finance/products?per_page=${PER_PAGE_MAKS}&include_archive=1`);
}

/**
 * Ambil stok untuk sekumpulan id produk, dipotong otomatis.
 * Kledo mewajibkan `product_ids`, jadi daftar harus dikirim (tidak ada mode "semua").
 */
export async function ambilStok(opsi: OpsiKledo, idProduk: number[]): Promise<HasilKledo<StokProdukKledo[]>> {
  const semua: StokProdukKledo[] = [];
  for (const bagian of potong(idProduk, CHUNK_PRODUK)) {
    if (bagian.length === 0) continue;
    const h = await kledoGet<StokProdukKledo[]>(opsi, `/finance/products/stocks?product_ids=${bagian.join(",")}`);
    if (!h.ok) return h;
    if (Array.isArray(h.data)) semua.push(...h.data);
  }
  return { ok: true, data: semua };
}

/**
 * Harga beli terakhir (fallback HPP). Mengembalikan map id → harga.
 *
 * BENTUK NYATA (diverifikasi live): `data` adalah OBJEK berkunci id produk, BUKAN array —
 * `{"231":{"last_buy_price":0,"last_buy_price_contact":0}}`. Versi pertama fungsi ini
 * hanya membaca array sehingga SELALU mengembalikan kosong: fallbacknya tidak pernah
 * bekerja sekali pun. Nama field-nya juga `last_buy_price`, bukan `last_price`/`price`.
 */
export async function ambilHargaBeliTerakhir(opsi: OpsiKledo, idProduk: number[]): Promise<Map<number, number>> {
  const hasil = new Map<number, number>();
  for (const bagian of potong(idProduk, CHUNK_PRODUK)) {
    if (bagian.length === 0) continue;
    const h = await kledoGet<unknown>(opsi, `/finance/products/last_buy_prices?ids=${bagian.join(",")}`);
    if (!h.ok) continue; // fallback: kegagalan di sini tidak boleh menggagalkan sinkronisasi
    const d = h.data;
    // Dua bentuk diterima: objek berkunci id (bentuk nyata) dan array (jaga-jaga).
    const daftar: { id: unknown; nilai: unknown }[] = [];
    if (Array.isArray(d)) {
      for (const it of d) {
        const o = it as Record<string, unknown>;
        daftar.push({ id: o.id, nilai: o.last_buy_price ?? o.last_price ?? o.price ?? o.base_price });
      }
    } else if (d && typeof d === "object") {
      for (const [kunci, nilai] of Object.entries(d as Record<string, unknown>)) {
        const o = nilai as Record<string, unknown> | null;
        daftar.push({ id: kunci, nilai: o?.last_buy_price ?? o?.last_price ?? o?.price ?? o?.base_price });
      }
    }
    for (const { id, nilai } of daftar) {
      const nomor = Number(id);
      const harga = Number(nilai);
      if (Number.isFinite(nomor) && Number.isFinite(harga) && harga >= 1) hasil.set(nomor, harga);
    }
  }
  return hasil;
}

/** Uji koneksi: satu panggilan ringan yang membuktikan token + subdomain benar. */
export async function ujiKoneksi(opsi: OpsiKledo): Promise<HasilKledo<{ jumlahGudang: number; sumber: string }>> {
  // /finance/warehouses BERBENTUK PAGINASI (data.data[]), jadi dibaca lewat bacaHalaman —
  // bukan `Array.isArray(h.data)`. Diverifikasi dari respons produksi.
  const h = await kledoGet<BentukHalaman<GudangKledo>>(opsi, "/finance/warehouses?exclude_qty=1");
  if (!h.ok) return h;
  const { baris } = bacaHalaman(h.data, 1);
  return { ok: true, data: { jumlahGudang: baris.length, sumber: "finance/warehouses" } };
}
