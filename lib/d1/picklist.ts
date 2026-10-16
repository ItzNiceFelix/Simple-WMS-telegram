// lib/d1/picklist.ts — Agregat read-only item order pending untuk picklist.
import { gagal, type Hasil } from "./hasil";

export type PickTarget = { mp: string; no: string };
/**
 * `perlu_sku` = baris ini SKU-nya belum/tidak ada di master. Dipakai picklist untuk
 * membedakannya dari barang normal, dan untuk memisahkannya ke tabel bawah.
 * `sku_asal` = SKU yang tertulis di file marketplace (kosong bila file memang tidak menulis).
 */
export type PickRow = {
  sku: string;
  nama: string;
  qty: number;
  variasi?: string;
  perlu_sku?: boolean;
  sku_asal?: string;
};
export type Picklist = { orders: number; units: number; rows: PickRow[] };
export type PaketPicklist = {
  no_resi: string;
  no_pesanan: string[];
  jasa_kirim: string;
  rows: PickRow[];
  units: number;
  /** Jumlah baris bermasalah di paket ini; dipakai untuk memperingatkan saat mencetak. */
  perlu_sku?: number;
};

/**
 * Kunci urut picklist yang sah — allowlist BEKU, sama pola dengan KOLOM_URUT_ORDER.
 *
 * Daftarnya sengaja hanya atribut BARIS (barang) dan lokasi: itu yang dicari picker saat
 * menyisir rak. "Urutkan per nama produk" adalah permintaan nyata owner (PDF ikut urutan yang
 * dipilih di layar), dan "lokasi" adalah default lama yang tidak boleh berubah diam-diam.
 *
 * Nilai tak dikenal TIDAK ditolak: jatuh ke `default` supaya cetak ulang picklist lama tetap
 * menghasilkan urutan yang sama walau klien mengirim kunci yang sudah usang.
 */
export const KUNCI_URUT_PICKLIST = ["default", "sku", "nama", "lokasi"] as const;
export type KunciUrutPicklist = (typeof KUNCI_URUT_PICKLIST)[number];

/** Arah urut eksplisit; default `asc` (A–Z) karena itu yang diharapkan saat orang menyortir
 *  nama produk di layar. `desc` disediakan supaya Z–A tidak perlu kunci kedua. */
export type ArahUrutPicklist = "asc" | "desc";

/**
 * Urutkan baris picklist menurut allowlist. Dipakai SEMUA berkas PDF picklist supaya
 * "urutkan per nama produk lalu cetak" menghasilkan lembar yang benar-benar urut nama —
 * bukan urut per paket dengan nama urut hanya di dalam paket.
 *
 * PENTING: pemanggil TANPA kunci (default) harus mendapat urutan LAMA apa adanya. Karena itu
 * pengurutan hanya dilakukan di sini, setelah pemanggil lama selesai menyusun urutannya —
 * dan `default` berarti "jangan sentuh".
 *
 * ── SENGAJA BEDA dari `urutkanBarisGabung` (lib/d1/picklistGabungPdf.ts) ──
 * Dua fungsi ini TIDAK boleh disatukan, dan bedanya bukan kecelakaan:
 *   • Di sini `default` = JANGAN URUTKAN (kembalikan apa adanya). Fungsi ini melayani
 *     picklist datar lama (mode `pisah`/paket), yang urutan lamanya adalah urutan datang
 *     dari kueri; menyentuhnya akan mengubah urutan lembar yang sudah dicetak owner.
 *   • Di `urutkanBarisGabung`, `default` = URUTKAN lokasi→nama (tanpa tiebreak SKU), karena
 *     lembar gabungan order+advance selalu butuh urutan yang pasti.
 * Menyeragamkan keduanya diam-diam akan membuat ulang cetakan lama berbeda urutan. Jangan
 * "rapikan" ini tanpa keputusan owner dan tanpa mengecek ulang berkas cetak lama.
 */
export function urutkanBaris<T extends { sku: string; nama: string; lokasi?: string }>(
  baris: T[],
  kunci: KunciUrutPicklist,
  arah: ArahUrutPicklist = "asc"
): T[] {
  if (kunci === "default") return baris;
  // `localeCompare("id")` untuk nama/sku, dan `?? ""` untuk lokasi yang memang opsional.
  const banding = (a: T, b: T): number => {
    if (kunci === "sku") return a.sku.localeCompare(b.sku, "id");
    if (kunci === "nama") return a.nama.localeCompare(b.nama, "id");
    return (a.lokasi ?? "").localeCompare(b.lokasi ?? "", "id");
  };
  // Tiebreaker SKU: SKU unik di dalam satu picklist agregat, jadi urutannya total dan cetak
  // ulang menghasilkan lembar yang identik. Tanpa itu dua baris bernama sama bisa bertukar
  // tempat antar cetakan dan picker mengira barangnya berbeda.
  const hasil = [...baris].sort((a, b) => {
    const c = banding(a, b);
    return (c !== 0 ? c : a.sku.localeCompare(b.sku, "id")) * (arah === "desc" ? -1 : 1);
  });
  return hasil;
}

/**
 * Picklist PER PAKET (F18/D4): satu lembar per no_resi, daftar semua order di grup.
 * Qty per baris diambil APA ADANYA dari `order_items` (file gabungan sudah total paket)
 * — TIDAK ada agregasi ulang lintas order. Resi tanpa grup jadi paket satu-order.
 * Order TANPA resi tetap diekspor sebagai paket sendiri (no_resi = ""): resi bisa belum
 * terbit saat picklist dicetak, dan menggagalkan seluruh cetakan karena satu order
 * ber-resi kosong tidak dapat diterima.
 */
export async function buatPicklistPaket(
  db: D1Database,
  targets: PickTarget[],
  urut: KunciUrutPicklist = "default",
  arah: ArahUrutPicklist = "asc"
): Promise<Hasil<{ paket: PaketPicklist[] }>> {
  const unik = [...new Map(targets.map((t) => [`${t.mp}|${t.no}`, t])).values()];
  if (unik.length === 0) return gagal(400, "Pilih minimal satu order.");
  const noList = unik.map((t) => t.no);
  const grup = new Map<string, { resi: string; items: string[] }>();
  for (let i = 0; i < noList.length; i += 50) {
    const potong = noList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT no_pesanan, no_resi FROM orders WHERE marketplace = 'shopee' AND no_pesanan IN (${tanda})`)
      .bind(...potong)
      .all<{ no_pesanan: string; no_resi: string }>();
    for (const r of results) grup.set(r.no_pesanan, { resi: r.no_resi, items: [r.no_pesanan] });
  }
  const resiList = [...new Set([...grup.values()].map((g) => g.resi).filter(Boolean))];
  const isiGrup = new Map<string, { no_json: string; jasa_kirim: string }>();
  for (let i = 0; i < resiList.length; i += 50) {
    const potong = resiList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT no_resi, no_json, jasa_kirim FROM resi_grup WHERE no_resi IN (${tanda})`)
      .bind(...potong)
      .all<{ no_resi: string; no_json: string; jasa_kirim: string }>();
    for (const r of results) isiGrup.set(r.no_resi, { no_json: r.no_json, jasa_kirim: r.jasa_kirim });
  }
  const paketMap = new Map<string, PaketPicklist>();
  for (const t of unik) {
    const no = t.no;
    const resi = grup.get(no)?.resi ?? "";
    // Kunci per order bila resi kosong — pakai `""` akan menumpuk semua order tanpa
    // resi menjadi satu paket palsu.
    const kunci = resi || `NO-RESI:${no}`;
    let paket = paketMap.get(kunci);
    if (!paket) {
      let noPesanan: string[] = [no];
      const g = isiGrup.get(resi);
      if (g) {
        try {
          const parsed = JSON.parse(g.no_json) as unknown;
          if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string") && parsed.length > 0) noPesanan = parsed;
        } catch {
          noPesanan = [no];
        }
      }
      paket = { no_resi: resi, no_pesanan: noPesanan, jasa_kirim: g?.jasa_kirim ?? "", rows: [], units: 0 };
      paketMap.set(kunci, paket);
    }
    const items = await db
      .prepare(`SELECT i.sku, p.nama_accurate AS nama, i.qty, i.variasi, i.nama_shopee, i.perlu_sku, i.sku_asal
        FROM order_items i LEFT JOIN products p ON p.sku = i.sku
        WHERE i.marketplace = 'shopee' AND i.no_pesanan = ?`)
      .bind(no)
      .all<{
        sku: string; nama: string | null; qty: number; variasi: string | null;
        nama_shopee: string | null; perlu_sku: number | null; sku_asal: string | null;
      }>();
    for (const item of items.results) {
      // LEFT JOIN, bukan JOIN: dengan INNER JOIN baris yang SKU-nya tidak ada di master
      // HILANG tanpa jejak, sehingga picklist tercetak tidak lengkap dan tidak ada yang tahu.
      // Sekarang barisnya tetap tampil dengan penanda supaya checker bisa memutuskan.
      const bermasalah = item.perlu_sku === 1 || !item.nama;
      const nama = item.nama ?? item.nama_shopee ?? "";
      // Variasi ditempel PER BARIS: SKU sama bisa punya varian beda antar order dalam satu
      // paket (mis. 001699 HIJAU di O-A, BIRU di O-B). Map per-SKU akan menimpa salah satunya.
      paket.rows.push({
        sku: item.sku,
        nama,
        qty: Number(item.qty),
        variasi: item.variasi || "",
        perlu_sku: bermasalah,
        sku_asal: item.sku_asal || "",
      });
      paket.units += Number(item.qty);
      if (bermasalah) paket.perlu_sku = (paket.perlu_sku ?? 0) + 1;
    }
  }
  return { ok: true, paket: urutkanPaket([...paketMap.values()], urut, arah) };
}

/**
 * Terapkan urutan ke daftar paket.
 *
 * Dua tingkat, dan keduanya harus ikut: baris DI DALAM paket (yang dicari picker di rak) dan
 * urutan PAKET itu sendiri (yang menentukan lembar mana tercetak lebih dulu). Kalau hanya
 * barisnya yang diurutkan, "urut nama produk" menghasilkan 40 lembar yang masing-masing urut
 * nama — di kertas tetap tampak acak, karena yang dibaca mata adalah lembar demi lembar.
 *
 * Urutan paket mengikuti baris pertamanya setelah diurutkan, bukan resi: dengan begitu
 * paket yang memuat produk paling awal A–Z juga tercetak paling awal. `default` = biarkan
 * urutan lama (urutan target dari klien) persis seperti sebelum perubahan ini.
 */
function urutkanPaket(paket: PaketPicklist[], urut: KunciUrutPicklist, arah: ArahUrutPicklist): PaketPicklist[] {
  if (urut === "default") return paket;
  const berurut = paket.map((p) => ({
    ...p,
    // Baris di dalam paket diurutkan dengan aturan yang SAMA seperti daftar datar; `lokasi`
    // tidak ada di sini (picklist paket tidak menampilkannya), jadi dikosongkan.
    rows: urutkanBaris(
      p.rows.map((r) => ({ ...r, lokasi: "" })),
      urut,
      arah
    ),
  }));
  const balik = arah === "desc" ? -1 : 1;
  return berurut.sort((a, b) => {
    // Paket tanpa baris selalu di belakang: ia tidak punya kunci untuk dibandingkan, dan
    // menaruhnya di depan membuat lembar kosong jadi halaman pertama tiap cetakan.
    if (a.rows.length === 0 || b.rows.length === 0) return a.rows.length === 0 ? (b.rows.length === 0 ? 0 : 1) : -1;
    const ka = a.rows[0];
    const kb = b.rows[0];
    const c = urut === "nama" ? ka.nama.localeCompare(kb.nama, "id") : ka.sku.localeCompare(kb.sku, "id");
    // Tiebreak SKU lalu resi: dua paket bisa mulai dengan produk yang sama, dan tanpa
    // tiebreak urutannya berubah-ubah antar cetakan.
    return (c !== 0 ? c : (ka.sku.localeCompare(kb.sku, "id") || a.no_resi.localeCompare(b.no_resi, "id"))) * balik;
  });
}

/** Kumpulkan item dari order pending terpilih, agregat per SKU master, urut SKU. */
export async function buatPicklist(
  db: D1Database,
  targets: PickTarget[],
  urut: KunciUrutPicklist = "default",
  arah: ArahUrutPicklist = "asc"
): Promise<Hasil<Picklist>> {
  const unik = [...new Map(targets.map((t) => [`${t.mp}|${t.no}`, t])).values()];
  if (unik.length === 0) return gagal(400, "Pilih minimal satu order.");
  const rows: PickRow[] = [];
  for (const target of unik) {
    const order = await db
      .prepare("SELECT status_fulfill FROM orders WHERE marketplace = ? AND no_pesanan = ?")
      .bind(target.mp, target.no)
      .first<{ status_fulfill: string }>();
    if (!order) return gagal(404, `Pesanan ${target.no} tidak ditemukan.`);
    if (order.status_fulfill !== "pending") return gagal(409, `Pesanan ${target.no} bukan pending.`);
    const items = await db
      .prepare(`SELECT i.sku, p.nama_accurate AS nama, i.qty, i.nama_shopee, i.perlu_sku, i.sku_asal
        FROM order_items i LEFT JOIN products p ON p.sku = i.sku
        WHERE i.marketplace = ? AND i.no_pesanan = ?`)
      .bind(target.mp, target.no)
      .all<{
        sku: string; nama: string | null; qty: number;
        nama_shopee: string | null; perlu_sku: number | null; sku_asal: string | null;
      }>();
    for (const item of items.results) {
      const bermasalah = item.perlu_sku === 1 || !item.nama;
      rows.push({
        sku: item.sku,
        nama: item.nama ?? item.nama_shopee ?? "",
        qty: Number(item.qty),
        perlu_sku: bermasalah,
        sku_asal: item.sku_asal || "",
      });
    }
  }
  const bySku = new Map<string, PickRow>();
  for (const row of rows) {
    const lama = bySku.get(row.sku);
    bySku.set(row.sku, lama ? { ...lama, qty: lama.qty + row.qty } : row);
  }
  // `default` = urutan lama PERSIS (sku A–Z via localeCompare). Pemanggil lama tanpa kunci
  // harus melihat lembar yang identik dengan sebelumnya — mengubah default akan membuat
  // cetak ulang picklist lama tiba-tiba berbeda urutan tanpa ada yang meminta.
  const hasil = urut === "default"
    ? [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku))
    : urutkanBaris([...bySku.values()], urut, arah);
  return { ok: true, orders: unik.length, units: hasil.reduce((sum, row) => sum + row.qty, 0), rows: hasil };
}
