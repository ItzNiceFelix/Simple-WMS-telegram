// lib/ai/tools.ts — Katalog 9 tool AI yang SADAR MULTI-GUDANG (Fase C, §9.1).
// Aturan yang tidak boleh dilanggar (keputusan user, §9.1):
//   - Baca TANPA menyebut gudang → tampilkan SEMUA gudang, rincian per gudang.
//     Tidak ada default, tidak ada tebakan.
//   - Baca DENGAN gudang → hanya gudang itu, namanya disebut.
//   - Tulis SELALU butuh gudang eksplisit. Tidak disebut → sistem bertanya.
// Semua angka datang dari `bacaQtyPerGudang` langsung — BUKAN dari
// app/api/baca/route.ts (route itu diam-diam jatuh ke ONLINE → semua 0).
import { gagal, type Hasil } from "@/lib/d1/hasil";
import { bacaQtyPerGudang, mutasiAntarGudang, ubahRelatif } from "@/lib/d1/stok";
import { ambilProduk, cariProduk } from "@/lib/d1/produk";
import { listGudang, type Gudang } from "@/lib/d1/gudang";

export type SpesifikasiTool = {
  nama: string;
  deskripsi: string;
  parameter: Record<string, unknown>;
};

/** Konteks argumen yang dikirim AI: `gudang` = kode ATAU nama gudang. */
type ArgTool = Record<string, unknown>;

function sebagaiTeks(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** SKU: huruf besar, tanpa spasi (paritas perilaku bot lama). */
function sebagaiSku(v: unknown): string {
  return sebagaiTeks(v).toUpperCase().replace(/\s+/g, "");
}

function sebagaiQty(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(sebagaiTeks(v));
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/**
 * Isi kolom `gudang` → id gudang NYATA dari tabel `warehouses`.
 * Kode (`GMV0LJYS5`/`ONLINE`) dan nama (`Gudang D12`) dua-duanya diterima,
 * case-insensitive. Mengembalikan `undefined` bila kolom kosong (bukan galat).
 */
async function cariGudang(db: D1Database, isian: unknown): Promise<Gudang | undefined | "tidak-ada"> {
  const teks = sebagaiTeks(isian);
  if (!teks) return undefined;
  const gudang = await listGudang(db, true);
  const bawah = teks.toLowerCase();
  const ketemu =
    gudang.find((g) => g.id.toLowerCase() === bawah) ??
    gudang.find((g) => g.code.toLowerCase() === bawah) ??
    gudang.find((g) => g.nama.toLowerCase() === bawah) ??
    gudang.find((g) => g.nama.toLowerCase().includes(bawah) || bawah.includes(g.nama.toLowerCase()));
  return ketemu ?? "tidak-ada";
}

/** Nama tampil gudang: pakai `nama`; bila kosong/sama dengan id, pakai id. */
function namaGudang(g: Gudang): string {
  return g.nama && g.nama !== g.id ? g.nama : g.id;
}

/** Peta id → nama untuk seluruh gudang (termasuk nonaktif, agar qty lama tetap ada namanya). */
async function petaNamaGudang(db: D1Database): Promise<Map<string, string>> {
  const semua = await listGudang(db, true);
  const peta = new Map<string, string>();
  for (const g of semua) peta.set(g.id, namaGudang(g));
  return peta;
}

/**
 * Susun rincian stok. Tanpa gudang → SEMUA baris stok + total.
 * Dengan gudang → satu baris saja (gudang yang tidak punya baris stok = 0).
 */
async function rincianStok(
  db: D1Database,
  sku: string,
  namaProduk: string,
  satuGudang?: Gudang
): Promise<string> {
  const qty = await bacaQtyPerGudang(db, sku);
  const petaNama = await petaNamaGudang(db);
  const baris: string[] = [`${sku} — ${namaProduk}`];

  if (satuGudang) {
    const q = qty[satuGudang.id] ?? 0;
    baris.push(`  ${namaGudang(satuGudang)} : ${q}`);
    baris.push(`Total: ${q}`);
    return baris.join("\n");
  }

  // Semua gudang: HANYA yang punya baris stok (termasuk qty 0 yang tercatat),
  // supaya daftar tidak dibanjiri 40 gudang kosong. Gudang ber-stok diurutkan dulu.
  const idsAda = Object.keys(qty);
  if (idsAda.length === 0) {
    baris.push("  (belum ada baris stok di gudang mana pun)");
    baris.push("Total: 0");
    return baris.join("\n");
  }
  const urut = idsAda.sort((a, b) => (qty[b] ?? 0) - (qty[a] ?? 0) || a.localeCompare(b));
  let total = 0;
  for (const id of urut) {
    const q = qty[id] ?? 0;
    total += q;
    const nama = petaNama.get(id) ?? id;
    baris.push(`  ${id === nama ? nama : `${nama} (${id})`} : ${q}`);
  }
  baris.push(`Total: ${total}`);
  return baris.join("\n");
}

/** Daftar gudang aktif untuk pesan "ke gudang mana?" — dari DB, bukan hardcode. */
export async function opsiGudang(db: D1Database): Promise<string> {
  const daftar = await listGudang(db, false);
  if (daftar.length === 0) return "(belum ada gudang aktif)";
  return daftar.map((g) => (g.nama && g.nama !== g.id ? `${namaGudang(g)} / ${g.id}` : g.id)).join(" / ");
}

/** Pertanyaan baku saat tool tulis dipanggil tanpa gudang (§9.1). */
async function pesanButuhGudang(db: D1Database, aksi: string, sku: string, qty: number | null): Promise<string> {
  const opsi = await opsiGudang(db);
  const jumlah = qty === null ? "" : ` ${qty} pcs`;
  return `${aksi}${jumlah} <code>${sku}</code> ke gudang mana? ${opsi}`;
}

/** Sembilan tool, urut sesuai `urutan` di katalog `ai_tool`. */
const NAMA_TOOL = [
  "cekStok",
  "cariProduk",
  "cekProdukStokMenipis",
  "listProdukOnline",
  "daftarGudang",
  "tambahStok",
  "kurangiStok",
  "mutasiAntarGudang",
  "stokBanyakProduk",
] as const;

/**
 * Skema JSON-Schema yang dikirim ke provider. Hanya tool yang aktif + dipilih
 * (hematToken) yang dikirim — ini lapis 2 penghematan token.
 */
export function daftarSpesifikasiTool(namaAktif: string[]): SpesifikasiTool[] {
  const semua: Record<string, SpesifikasiTool> = {
    cekStok: {
      nama: "cekStok",
      deskripsi:
        "Cek jumlah stok SATU produk. Tanpa `gudang` → hasilkan rincian untuk SEMUA gudang + total (JANGAN menebak gudang). Dengan `gudang` → hanya gudang itu.",
      parameter: {
        type: "object",
        properties: {
          sku: { type: "string", description: "Kode barang (SKU), mis. 001163." },
          namaProduk: { type: "string", description: "Nama produk bila SKU belum diketahui." },
          gudang: { type: "string", description: "Kode atau nama gudang, mis. GMV0LJYS5 / Gudang D12. Kosongkan bila admin tidak menyebut gudang." },
        },
      },
    },
    cariProduk: {
      nama: "cariProduk",
      deskripsi: "Cari produk berdasarkan nama atau SKU. Balikan daftar SKU + nama.",
      parameter: {
        type: "object",
        properties: { kataKunci: { type: "string", description: "Nama produk atau potongan SKU." } },
        required: ["kataKunci"],
      },
    },
    cekProdukStokMenipis: {
      nama: "cekProdukStokMenipis",
      deskripsi: "Produk yang stoknya di bawah batas reorder (stok_min). Tanpa `gudang` → memakai gudang ONLINE sebagai basis paritas lama.",
      parameter: {
        type: "object",
        properties: { gudang: { type: "string", description: "Kode/nama gudang (opsional)." } },
      },
    },
    listProdukOnline: {
      nama: "listProdukOnline",
      deskripsi: "Daftar produk yang ditandai online beserta stoknya per gudang.",
      parameter: { type: "object", properties: {} },
    },
    daftarGudang: {
      nama: "daftarGudang",
      deskripsi: "Daftar gudang aktif beserta kode dan namanya. Pakai ini bila perlu tahu gudang mana yang valid sebelum bertanya ke admin.",
      parameter: { type: "object", properties: {} },
    },
    tambahStok: {
      nama: "tambahStok",
      deskripsi:
        "Tambah stok satu produk. WAJIB menyebut `gudang` (kode/nama). Bila `gudang` kosong, sistem TIDAK menebak — ia mengembalikan pertanyaan 'ke gudang mana?'. Butuh konfirmasi admin.",
      parameter: {
        type: "object",
        properties: {
          sku: { type: "string", description: "Kode barang." },
          namaProduk: { type: "string", description: "Nama produk bila SKU belum diketahui." },
          qty: { type: "integer", description: "Jumlah pcs yang ditambah." },
          gudang: { type: "string", description: "Kode atau nama gudang tujuan. WAJIB." },
          alasan: { type: "string", description: "Alasan singkat, mis. barang datang." },
        },
        required: ["qty"],
      },
    },
    kurangiStok: {
      nama: "kurangiStok",
      deskripsi:
        "Kurangi stok satu produk. WAJIB menyebut `gudang`. Bila kosong → sistem bertanya 'ke gudang mana?'. Butuh konfirmasi admin.",
      parameter: {
        type: "object",
        properties: {
          sku: { type: "string", description: "Kode barang." },
          namaProduk: { type: "string", description: "Nama produk bila SKU belum diketahui." },
          qty: { type: "integer", description: "Jumlah pcs yang dikurangi." },
          gudang: { type: "string", description: "Kode atau nama gudang asal. WAJIB." },
          alasan: { type: "string", description: "Alasan singkat, mis. rusak / koreksi." },
        },
        required: ["qty"],
      },
    },
    mutasiAntarGudang: {
      nama: "mutasiAntarGudang",
      deskripsi: "Pindahkan qty satu produk ANTAR gudang. WAJIB dua gudang: `dariGudang` dan `keGudang`. Butuh konfirmasi admin.",
      parameter: {
        type: "object",
        properties: {
          sku: { type: "string", description: "Kode barang." },
          namaProduk: { type: "string", description: "Nama produk bila SKU belum diketahui." },
          qty: { type: "integer", description: "Jumlah pcs yang dipindah." },
          dariGudang: { type: "string", description: "Gudang asal (kode/nama). WAJIB." },
          keGudang: { type: "string", description: "Gudang tujuan (kode/nama). WAJIB." },
        },
        required: ["qty"],
      },
    },
    stokBanyakProduk: {
      nama: "stokBanyakProduk",
      deskripsi: "Cek stok BEBERAPA produk sekaligus dalam satu panggilan. Berguna bila admin menyebut beberapa SKU dalam satu pesan.",
      parameter: {
        type: "object",
        properties: {
          daftar: {
            type: "array",
            items: { type: "string" },
            description: "Daftar SKU, mis. [\"001163\", \"001164\"].",
          },
          gudang: { type: "string", description: "Kode/nama gudang (opsional). Kosong = semua gudang." },
        },
        required: ["daftar"],
      },
    },
  };
  return NAMA_TOOL.filter((n) => namaAktif.includes(n)).map((n) => semua[n]);
}

/** Resolusi SKU dari `sku` atau `namaProduk` (tool baca maupun tulis). */
async function resolusiProduk(
  db: D1Database,
  arg: ArgTool
): Promise<{ sku: string; nama: string } | { gagal: Hasil<never> }> {
  const sku = sebagaiSku(arg.sku);
  if (sku) {
    const p = await ambilProduk(db, sku);
    if (!p) return { gagal: gagal(404, `Produk ${sku} tidak ditemukan.`) };
    return { sku: p.sku, nama: p.nama_accurate };
  }
  const kunci = sebagaiTeks(arg.namaProduk);
  if (!kunci) return { gagal: gagal(400, "Sebutkan SKU atau nama produk.") };
  const hasil = await cariProduk(db, kunci, 5);
  if (hasil.length === 0) return { gagal: gagal(404, `Tidak ada produk yang cocok dengan "${kunci}".`) };
  if (hasil.length > 1) {
    const daftar = hasil.map((h) => `${h.sku} — ${h.nama_accurate}`).join("\n");
    return { gagal: gagal(409, `Ada beberapa produk mirip "${kunci}". Pilih satu:\n${daftar}`) };
  }
  return { sku: hasil[0].sku, nama: hasil[0].nama_accurate };
}

/**
 * Jalankan tool. Tool `baca` aman dijalankan langsung; tool `tulis`
 * (`perluKonfirmasi`) TIDAK dieksekusi oleh chat.ts — orchestrator yang
 * memutuskan kapan memanggil fungsi ini setelah admin menjawab "ya".
 */
export async function jalankanTool(
  db: D1Database,
  nama: string,
  arg: ArgTool,
  user: { tg_id: string }
): Promise<Hasil<{ hasil: unknown; ringkas: string }>> {
  const oleh = user.tg_id;

  if (nama === "daftarGudang") {
    const daftar = await listGudang(db, false);
    if (daftar.length === 0) return { ok: true, hasil: [], ringkas: "Belum ada gudang aktif." };
    const baris = daftar.map((g) => `• ${namaGudang(g)} (<code>${g.id}</code>)`).join("\n");
    return { ok: true, hasil: daftar, ringkas: `Daftar gudang aktif:\n${baris}` };
  }

  if (nama === "cariProduk") {
    const kunci = sebagaiTeks(arg.kataKunci) || sebagaiTeks(arg.namaProduk) || sebagaiTeks(arg.sku);
    if (!kunci) return gagal(400, "Sebutkan kata kunci pencarian.");
    const hasil = await cariProduk(db, kunci, 10);
    if (hasil.length === 0) return { ok: true, hasil: [], ringkas: `Tidak ada produk yang cocok dengan "${kunci}".` };
    const baris = hasil.map((h) => `<code>${h.sku}</code> ${h.nama_accurate}`).join("\n");
    return { ok: true, hasil, ringkas: `Kecocokan untuk "${kunci}":\n${baris}` };
  }

  if (nama === "listProdukOnline") {
    const { results } = await db
      .prepare(
        `SELECT p.sku AS sku, p.nama_accurate AS nama FROM products p
         WHERE p.is_online_product = 1 ORDER BY p.sku LIMIT 50`
      )
      .all<{ sku: string; nama: string }>();
    if (results.length === 0) return { ok: true, hasil: [], ringkas: "Belum ada produk yang ditandai online." };
    const potongan: string[] = [];
    for (const r of results) potongan.push(await rincianStok(db, r.sku, r.nama));
    return {
      ok: true,
      hasil: results,
      ringkas: `Produk online (${results.length}):\n\n${potongan.join("\n\n")}`,
    };
  }

  if (nama === "cekProdukStokMenipis") {
    const g = await cariGudang(db, arg.gudang);
    if (g === "tidak-ada") return gagal(404, `Gudang "${sebagaiTeks(arg.gudang)}" tidak dikenal.`);
    const gudangId = g ? g.id : "ONLINE"; // paritas lib/d1/stok.ts stokDiBawahReorder
    const { results } = await db
      .prepare(
        `SELECT p.sku AS sku, p.nama_accurate AS nama, b.qty AS qty, p.stok_min AS stok_min
         FROM stock_by_bin b JOIN products p ON p.sku = b.sku
         WHERE p.stok_min IS NOT NULL AND b.qty < p.stok_min AND b.warehouse_id = ?
         ORDER BY b.qty ASC LIMIT 30`
      )
      .bind(gudangId)
      .all<{ sku: string; nama: string; qty: number; stok_min: number }>();
    if (results.length === 0) return { ok: true, hasil: [], ringkas: "Tidak ada stok di bawah reorder point." };
    const baris = results.map((r) => `<code>${r.sku}</code> ${r.nama}: <b>${r.qty}</b> (min ${r.stok_min})`).join("\n");
    return { ok: true, hasil: results, ringkas: `Stok menipis (${gudangId}):\n${baris}` };
  }

  if (nama === "stokBanyakProduk") {
    const daftar = Array.isArray(arg.daftar) ? arg.daftar.map((x) => sebagaiSku(x)).filter(Boolean) : [];
    const satu = sebagaiSku(arg.sku);
    const skus = daftar.length > 0 ? daftar : satu ? [satu] : [];
    if (skus.length === 0) return gagal(400, "Sebutkan daftar SKU.");
    const g = await cariGudang(db, arg.gudang);
    if (g === "tidak-ada") return gagal(404, `Gudang "${sebagaiTeks(arg.gudang)}" tidak dikenal.`);
    const potongan: string[] = [];
    const ditemukan: { sku: string; ada: boolean }[] = [];
    for (const sku of skus.slice(0, 20)) {
      const p = await ambilProduk(db, sku);
      if (!p) {
        potongan.push(`${sku} — (produk tidak ditemukan)`);
        ditemukan.push({ sku, ada: false });
        continue;
      }
      potongan.push(await rincianStok(db, p.sku, p.nama_accurate, g || undefined));
      ditemukan.push({ sku, ada: true });
    }
    return { ok: true, hasil: ditemukan, ringkas: potongan.join("\n\n") };
  }

  if (nama === "cekStok") {
    const p = await resolusiProduk(db, arg);
    if ("gagal" in p) return p.gagal;
    const g = await cariGudang(db, arg.gudang);
    if (g === "tidak-ada") return gagal(404, `Gudang "${sebagaiTeks(arg.gudang)}" tidak dikenal.`);
    return { ok: true, hasil: await bacaQtyPerGudang(db, p.sku), ringkas: await rincianStok(db, p.sku, p.nama, g || undefined) };
  }

  if (nama === "tambahStok" || nama === "kurangiStok") {
    const p = await resolusiProduk(db, arg);
    if ("gagal" in p) return p.gagal;
    const qty = sebagaiQty(arg.qty);
    if (qty === null || qty < 1) return gagal(400, "Jumlah harus bilangan bulat >= 1.");
    // Tulis SELALU butuh gudang eksplisit. Tidak ada default, tidak ada tebakan.
    const g = await cariGudang(db, arg.gudang);
    if (g === undefined) {
      return gagal(400, await pesanButuhGudang(db, nama === "tambahStok" ? "Tambah" : "Kurangi", p.sku, qty));
    }
    if (g === "tidak-ada") return gagal(404, `Gudang "${sebagaiTeks(arg.gudang)}" tidak dikenal. Sebutkan kode/nama yang benar.`);
    const delta = nama === "tambahStok" ? qty : -qty;
    const r = await ubahRelatif(db, p.sku, g.id, delta, oleh, "koreksi_manual", "bot_telegram");
    if (!r.ok) return r;
    const arah = nama === "tambahStok" ? "ditambah" : "dikurangi";
    return {
      ok: true,
      hasil: { sku: p.sku, gudang: g.id, qty: r.nilai_baru },
      ringkas: `${p.sku} — ${p.nama}\n  ${namaGudang(g)} : <b>${r.nilai_baru}</b> (${arah} ${qty})`,
    };
  }

  if (nama === "mutasiAntarGudang") {
    const p = await resolusiProduk(db, arg);
    if ("gagal" in p) return p.gagal;
    const qty = sebagaiQty(arg.qty);
    if (qty === null || qty < 1) return gagal(400, "Jumlah harus bilangan bulat >= 1.");
    const dari = await cariGudang(db, arg.dariGudang);
    const ke = await cariGudang(db, arg.keGudang);
    if (dari === undefined || ke === undefined) {
      return gagal(400, `Pindah ${qty} pcs <code>${p.sku}</code> dari gudang mana ke gudang mana? ${await opsiGudang(db)}`);
    }
    if (dari === "tidak-ada" || ke === "tidak-ada") return gagal(404, "Salah satu gudang tidak dikenal. Sebutkan kode/nama yang benar.");
    const r = await mutasiAntarGudang(db, p.sku, dari.id, ke.id, qty, oleh);
    if (!r.ok) return r;
    return {
      ok: true,
      hasil: { sku: p.sku, dari: dari.id, ke: ke.id, qty },
      ringkas: `${p.sku} — ${p.nama}\n  ${namaGudang(dari)} → ${namaGudang(ke)}: <b>${qty}</b> pcs`,
    };
  }

  return gagal(400, `Tool "${nama}" tidak dikenal.`);
}
