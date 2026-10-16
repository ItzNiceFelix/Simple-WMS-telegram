// app/api/baca/route.ts — GET baca server D1 untuk dashboard (Fase 1 cutover).
// Menggantikan baca Firestore client SDK (real.ts). Scope: ?scope=stok|
// produk|gudang|opname|transfer|daily|admin|akses|histori|ai|ringkasan|model-terpakai.
// Auth: cookie swt_sesi (D1). Filter gudang ditegakkan di server (RBAC scope).
import { getDb, getEnvAi } from "@/lib/d1/db";
import { bacaQtyPerGudang } from "@/lib/d1/stok";
import { listGudang } from "@/lib/d1/gudang";
import { listOpname } from "@/lib/d1/opname";
import { listTransfer } from "@/lib/d1/transfer";
import { ambilDaily, tanggalHariIni } from "@/lib/d1/permintaan";
import { listAdmins } from "@/lib/d1/admin";
import { listAkses } from "@/lib/d1/akses";
import { listMovements } from "@/lib/d1/ledger";
import { ambilPengaturanAI } from "@/lib/d1/pengaturan";
import { daftarModel } from "@/lib/d1/aiModel";
import { himpunanIzin, JENIS_IZIN, type JenisIzin } from "@/lib/d1/aiIzinModel";
import { json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Batas irisan scope `ringkasan` (terbuka untuk guest). Angka ini SENGAJA kecil: beranda
// hanya merender 5 baris minus, 10 menipis, dan 10 pergerakan. Klien boleh memperkecil,
// tidak pernah memperbesar — `limit` dari query string tidak pernah dibaca di scope ini.
const MAKS_MINUS_RINGKASAN = 20;
const MAKS_MENIPIS_RINGKASAN = 10;
const MAKS_GERAK_RINGKASAN = 10;

function keIso(epoch: number | null): string | null {
  if (epoch == null) return null;
  return new Date(epoch * 1000).toISOString();
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 120);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  const db = getDb();
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");

  if (scope === "stok") {
    // Guest TIDAK boleh melihat stok sama sekali: /stok di balik ButuhAkses, dan
    // /api/produk/[kode] memakai scope ini juga. Ringkasan punya jalur sendiri
    // (scope=ringkasan + scope=produk?kode=), lihat catatan di scope tersebut.
    if (user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
    const gudangFilter = url.searchParams.get("gudang_id");
    // is_online harus OPT-IN: hanya menyaring bila caller benar-benar minta "true".
    // Sebelumnya `!== "false"` membuat param yang TIDAK dikirim dianggap true, sehingga
    // halaman yang sengaja tidak mengirim is_online tetap menerima subset online-saja
    // (692 dari 1174 produk hilang, termasuk semua hasil sinkron Kledo) — dan pencarian
    // pun ikut gagal karena q digabung AND dengan syarat itu.
    const onlineSaja = url.searchParams.get("is_online") === "true";
    // B5-A: cari server-side (hemat rows-read); tanpa q = perilaku lama (cap 2000).
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    // Filter status ikut ke SQL: kalau disaring di klien, hanya baris di halaman ini yang
    // tersaring sementara sisanya di halaman lain — user mengira daftar minus cuma segitu.
    const statusSaring = (url.searchParams.get("status") ?? "").trim();
    const args: unknown[] = [];
    const syarat: string[] = [];
    if (onlineSaja) syarat.push("p.is_online_product = 1");
    if (q) {
      syarat.push("(lower(p.sku) LIKE ? OR lower(p.nama_accurate) LIKE ?)");
      args.push(`%${q}%`, `%${q}%`);
    }
    // Status butuh nilai stok ONLINE, jadi memakai subquery korelasi. Hanya tiga nilai
    // yang dikenal; nilai lain diabaikan supaya param asing tidak membocorkan 500.
    if (statusSaring === "menipis") {
      syarat.push(
        "(SELECT COALESCE(qty,0) FROM stock_by_bin WHERE sku = p.sku AND warehouse_id = 'ONLINE') < COALESCE(p.stok_min, 0) AND p.stok_min IS NOT NULL AND (SELECT COALESCE(qty,0) FROM stock_by_bin WHERE sku = p.sku AND warehouse_id = 'ONLINE') >= 0"
      );
    } else if (statusSaring === "minus") {
      syarat.push(
        "(SELECT COALESCE(qty,0) FROM stock_by_bin WHERE sku = p.sku AND warehouse_id = 'ONLINE') < 0"
      );
    }
    const whereClause = syarat.length > 0 ? ` WHERE ${syarat.join(" AND ")}` : "";
    // Paginasi DIPINDAH ke lapisan produk, bukan lapisan hasil JOIN.
    //
    // Kenapa: `LIMIT ? OFFSET ?` pada JOIN products×stock_by_bin memotong di TENGAH
    // produk. Dengan 6 gudang, 2000 baris hanya menutup ~333 SKU — SKU sisanya hilang
    // tanpa pesan apa pun, dan `COUNT(DISTINCT p.sku)` tetap melaporkan 1174 sehingga
    // nomor halaman di UI menunjuk halaman yang isinya kosong. Sekarang yang dibatasi
    // adalah daftar SKU (satu baris per produk); qty semua gudang diambil per SKU itu.
    const limitParam = Number(url.searchParams.get("limit"));
    const pakaiLimit = Number.isInteger(limitParam) && limitParam >= 1;
    const limit = pakaiLimit ? Math.min(limitParam, 200) : 2000;
    const offsetParam = Number(url.searchParams.get("offset"));
    const offset = Number.isInteger(offsetParam) && offsetParam > 0 ? offsetParam : 0;

    const { results: skuRows } = await db
      .prepare(`SELECT p.sku FROM products p${whereClause} ORDER BY p.sku ASC LIMIT ? OFFSET ?`)
      .bind(...args, limit, offset)
      .all<{ sku: string }>();
    // Total memakai COUNT(*) di lapisan produk: satu SKU = satu baris, jadi jumlahnya
    // persis sebanding dengan yang dipaginasi di atas.
    const totalRow = await db
      .prepare(`SELECT COUNT(*) AS total FROM products p${whereClause}`)
      .bind(...args)
      .first<{ total: number }>();
    const total = totalRow?.total ?? 0;

    const daftarSku = skuRows.map((r) => r.sku);
    let baris: Record<string, unknown>[] = [];
    if (daftarSku.length > 0) {
      // Satu query tambahan untuk kolom produk + qty semua gudang milik SKU halaman ini.
      // Tetap perlu satu query produk karena kolom p.* tidak ikut di query SKU di atas.
      const tanda = daftarSku.map(() => "?").join(",");
      const { results } = await db
        .prepare(
          `SELECT p.sku, p.nama_accurate, p.hpp, p.is_online_product, p.stok_min, p.kategori, p.tier_override, p.pre_order, p.ukuran_khusus, p.go_override, b.warehouse_id, b.qty
           FROM products p LEFT JOIN stock_by_bin b ON b.sku = p.sku
           WHERE p.sku IN (${tanda}) ORDER BY p.sku ASC`
        )
        .bind(...daftarSku)
        .all<{
          sku: string; nama_accurate: string; hpp: number | null; is_online_product: number; stok_min: number | null;
          kategori: string | null; tier_override: string | null; pre_order: number; ukuran_khusus: number; go_override: string | null;
          warehouse_id: string | null; qty: number | null;
        }>();
      const { results: paths } = await db.prepare("SELECT kategori_path FROM kategori_tarif").all<{ kategori_path: string }>();
      const himpunan = new Set(paths.map((p) => p.kategori_path));
      const grup = new Map<string, { p: (typeof results)[number]; qtyMap: Record<string, number> }>();
      for (const r of results) {
        let g = grup.get(r.sku);
        if (!g) { g = { p: r, qtyMap: {} }; grup.set(r.sku, g); }
        if (r.warehouse_id != null && r.qty != null) g.qtyMap[r.warehouse_id] = r.qty;
      }
      baris = [];
      for (const { p, qtyMap } of grup.values()) {
        const nilai = gudangFilter ? (qtyMap[gudangFilter] ?? 0) : (qtyMap.ONLINE ?? 0);
        if (gudangFilter && !(gudangFilter in qtyMap)) continue;
        const status = nilai < 0 ? "minus" : p.stok_min != null && nilai < p.stok_min ? "menipis" : "aman";
        const terpetakan = !!p.tier_override || (!!p.kategori && himpunan.has(p.kategori));
        baris.push({
          kode_barang: p.sku, nama_accurate: p.nama_accurate, hpp: p.hpp,
          stok_gudang_online: nilai, qty_per_gudang: qtyMap,
          is_online_product: p.is_online_product === 1, reorder_point: p.stok_min,
          status, kekurangan: status === "aman" ? 0 : (p.stok_min ?? 0) - nilai,
          kategori: p.kategori, terpetakan,
          pre_order: p.pre_order === 1, ukuran_khusus: p.ukuran_khusus === 1, go_override: p.go_override ?? null,
        });
      }
    }
    return json({ ok: true, rows: baris, total, limit, offset });
  }

  // scope=kekurangan — bahan dialog "kekurangan stok" di /stok.
  //
  // Kekurangan dihitung dari `orders.stok_dikurangi = 1` yang MASIH ada qty-nya, lalu
  // dibandingkan dengan stok ONLINE sekarang. Sengaja TIDAK menyimpan tabel kekurangan
  // sendiri: stok berubah tiap hari, dan tabel simpanan akan basi tanpa ada yang
  // menyadarinya. Hitung ulang selalu benar terhadap keadaan sekarang.
  if (scope === "kekurangan") {
    if (user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
    const { results } = await db
      .prepare(
        `SELECT oi.sku AS sku, SUM(oi.qty) AS butuh, p.nama_accurate AS nama,
                COALESCE(b.qty, 0) AS stok, p.stok_min AS stok_min, p.is_online_product AS online
         FROM order_items oi
         JOIN orders o ON o.marketplace = oi.marketplace AND o.no_pesanan = oi.no_pesanan
         JOIN products p ON p.sku = oi.sku
         LEFT JOIN stock_by_bin b ON b.sku = oi.sku AND b.warehouse_id = 'ONLINE'
         WHERE o.stok_dikurangi = 1 AND p.is_online_product = 1
         GROUP BY oi.sku
         HAVING COALESCE(b.qty, 0) < SUM(oi.qty) OR (p.stok_min IS NOT NULL AND COALESCE(b.qty, 0) < p.stok_min)
         ORDER BY p.nama_accurate ASC`
      )
      .all<{ sku: string; butuh: number; nama: string; stok: number; stok_min: number | null; online: number }>();
    const baris = results.map((r) => {
      const kurangOrder = Math.max(0, r.butuh - r.stok);
      const kurangMenipis = r.stok_min != null ? Math.max(0, r.stok_min - r.stok) : 0;
      return {
        sku: r.sku,
        nama: r.nama,
        stok: r.stok,
        stok_min: r.stok_min,
        butuh: r.butuh,
        // Dua alasan berbeda bisa menimpa SKU yang sama; ambil yang paling mendesak supaya
        // angka yang diminta user tidak pernah lebih kecil dari kenyataan.
        kurang: Math.max(kurangOrder, kurangMenipis),
        alasan: kurangOrder > 0 && kurangMenipis > 0 ? "keduanya" : kurangOrder > 0 ? "order" : "menipis",
      };
    }).filter((r) => r.kurang > 0);
    return json({ ok: true, rows: baris });
  }

  if (scope === "produk") {
    const kode = url.searchParams.get("kode");
    // Produk TUNGGAL tetap terbuka untuk guest: dipakai halaman Ringkasan (`/`, menu
    // guest "Stok" -> /produk/[kode]) untuk detail satu SKU. DAFTAR seluruh katalog
    // (tanpa `kode`) adalah enumerasi — khusus staff.
    if (!kode && user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
    if (kode) {
      const p = await db.prepare("SELECT * FROM products WHERE sku = ?").bind(kode).first<Record<string, unknown>>();
      if (!p) return json({ ok: false, error: "Produk tidak ditemukan." }, 404);
      const { results: varian } = await db.prepare("SELECT variasi FROM product_variants WHERE sku = ?").bind(kode).all<{ variasi: string }>();
      const { results: kw } = await db.prepare("SELECT keyword FROM product_search_keywords WHERE sku = ?").bind(kode).all<{ keyword: string }>();
      const qtyMap = await bacaQtyPerGudang(db, kode);
      return json({
        ok: true,
        produk: {
          kode_barang: kode, nama_accurate: p.nama_accurate, hpp: p.hpp, hpp_baru: p.hpp_baru,
          is_online_product: p.is_online_product === 1,
          kategori: p.kategori ?? null, tier_override: p.tier_override ?? null,
          pre_order: p.pre_order === 1, ukuran_khusus: p.ukuran_khusus === 1,
          go_override: (p.go_override as string | null) ?? null,
          variants: varian.map((v) => ({ variasi: v.variasi })),
          search_keywords: kw.map((k) => k.keyword), updated_at: keIso(p.updated_at as number | null),
        },
        stok: { kode_barang: kode, stok_gudang_online: qtyMap.ONLINE ?? null, reorder_point: p.stok_min ?? null },
      });
    }
    const { results } = await db
      .prepare("SELECT sku, nama_accurate, hpp, is_online_product FROM products ORDER BY sku ASC LIMIT 2000")
      .all<{ sku: string; nama_accurate: string; hpp: number | null; is_online_product: number }>();
    return json({ ok: true, rows: results });
  }

  // scope=produk-total — daftar SELURUH produk untuk halaman "Produk Total".
  //
  // Kenapa di sini, bukan route baru: `baca` sudah jadi rumah scope baca ber-paginasi
  // (stok, histori) dan satu-satunya jalur GET ber-cookie yang sudah dipakai klien
  // (`bacaServer` di lib/dashboard/data/real.ts). Route baru berarti menyalin sesi,
  // json(), dan penjaga guest — tiga tempat untuk lupa.
  //
  // Halaman ini menampilkan LOKASI (aturan gudang dominan) + TOTAL qty se-gudang, dan
  // keduanya hanya bisa dihitung server. Kolom biaya (hpp) SENGAJA tidak ikut: yang
  // dirender cuma identitas + lokasi + angka total.
  if (scope === "produk-total") {
    if (user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);

    // ── Urutan: ALLOWLIST BEKU, bukan gabungan string dari klien ──
    // Kunci dari query string hanya dipakai untuk MEMILIH salah satu ekspresi di bawah;
    // nilainya tidak pernah masuk ke SQL. Kunci asing jatuh ke default (nama ASC),
    // jadi permintaan ngawur tidak pernah menghasilkan 500 atau urutan acak.
    //
    // Ekspresi di peta ini TANPA arah — arah dipasang TEPAT SEKALI di bawah. Menyimpan
    // "ASC" di dalam peta sambil menyambung `arah` lagi menghasilkan "total_qty ASC ASC":
    // SQL tidak sah dan halaman mati 500 tanpa sebab yang jelas.
    // Nama gudang diambil dari master `warehouses` lewat CODE, bukan id.
    //
    // Kenapa lewat code: halaman /produk-total dulu menampilkan ID gudang asli D1
    // ('GMV0LJYS5') di kolom "Lokasi Gudang" — picker tak bisa memakai string itu untuk
    // mencari rak. `warehouses.code` LAHIR sebagai kode pendek yang dibaca orang (D12/D19)
    // dan diisi sama dengan id saat gudang dibuat manual, jadi kode = tulisan yang sudah
    // dipakai jalur picklist. `warehouses.nama` ("Gudang D12") sengaja TIDAK dipakai: di
    // kolom 105pt nama panjang mendorong penanda "+gudang lain" keluar dari lebar tabel.
    const LOKASI: Record<string, string> = {
      utama: "(SELECT COALESCE(w.code, b2.warehouse_id) FROM stock_by_bin b2 LEFT JOIN warehouses w ON w.id = b2.warehouse_id WHERE b2.sku = stock_by_bin.sku AND b2.qty > 0 ORDER BY b2.qty DESC, b2.warehouse_id ASC LIMIT 1)",
      // Daftar SEMUA gudang ber-stok positif (kode), dipotong jadi "+sisa" di Node.
      // Sengaja tidak `GROUP_CONCAT` di SQL: urutannya harus ikut qty DESC seperti aturan
      // gudang dominan, dan GROUP_CONCAT tidak menjamin urutan subquery-nya.
      lain: "(SELECT GROUP_CONCAT(COALESCE(w.code, b2.warehouse_id), char(9)) FROM stock_by_bin b2 LEFT JOIN warehouses w ON w.id = b2.warehouse_id WHERE b2.sku = stock_by_bin.sku AND b2.qty > 0 ORDER BY b2.qty DESC, b2.warehouse_id ASC)",
    };
    const URUT: Record<string, string> = {
      nama: "p.nama_accurate COLLATE NOCASE",
      sku: "p.sku COLLATE NOCASE",
      // Lokasi = kode gudang; kosong ("tidak ada stok positif") selalu di bawah supaya
      // "belum ada di gudang mana pun" tidak menyamar sebagai urutan awal alfabet.
      // Caller tidak boleh menempelkan arah ke seluruh kunci: arah hanya masuk ke kolom
      // urutannya, sedangkan penanda kosong TETAP menaik (0 = terisi lebih dulu) apa pun
      // arahnya — urutan kosong-terakhir adalah keputusan tampilan, bukan preferensi user.
      lokasi: "CASE WHEN lokasi_utama IS NULL OR lokasi_utama = '' THEN 1 ELSE 0 END ASC, lokasi_utama COLLATE NOCASE",
      // Angka, jadi urut numerik — bukan teks ("100" harus setelah "20").
      qty: "total_qty",
    };
    const kunciMinta = (url.searchParams.get("urut") ?? "nama").trim();
    const kunci = Object.prototype.hasOwnProperty.call(URUT, kunciMinta) ? kunciMinta : "nama";
    const arah = (url.searchParams.get("arah") ?? "asc").trim().toLowerCase() === "desc" ? "DESC" : "ASC";
    // Arah disisipkan ke SETIAP kolom urutan: `lokasi` punya dua kolom. Yang ber-arah tetap
    // hanya kolom urutan; penanda kosong dibiarkan menaik.
    const ORDER_BY = URUT[kunci]
      .split(", ")
      .map((bagian) => (/ THEN \d+ ELSE \d+ END ASC$/.test(bagian) ? bagian : `${bagian} ${arah}`))
      .join(", ");

    // ── Halaman: cap KERAS di server ──
    // `ukuran` dari klien boleh diperkecil, tidak pernah diperbesar. 200 sama dengan cap
    // scope `stok`: satu halaman tetap satu request yang wajar.
    const MAKS_UKURAN = 200;
    const ukuranParam = Number(url.searchParams.get("ukuran"));
    const ukuran = Number.isInteger(ukuranParam) && ukuranParam >= 1 ? Math.min(ukuranParam, MAKS_UKURAN) : 50;
    const halamanParam = Number(url.searchParams.get("halaman"));
    const halaman = Number.isInteger(halamanParam) && halamanParam >= 1 ? halamanParam : 1;
    const offset = (halaman - 1) * ukuran;

    // ── Langkah 1: paginasi di lapisan PRODUK, bukan hasil JOIN ──
    // `LIMIT` pada JOIN products×stock_by_bin memotong di TENGAH produk: satu SKU dengan
    // 6 gudang menghabiskan 6 baris jatah, sehingga jumlah baris yang tampil tidak
    // sebanding dengan `total` dan halaman terakhir bisa kosong. Di sini yang dibatasi
    // adalah daftar SKU (satu baris per produk); total pun COUNT(*) di lapisan yang sama.
    //
    // Qty diambil sebagai agregat KOREKSI di dalam subquery yang sama supaya sorting
    // "quantity total" dan "lokasi" bisa dikerjakan SQL, bukan di klien — kalau diurutkan
    // di klien, hanya halaman yang tampil yang terurut, sisanya tetap acak.
    const { results: skuRows } = await db
      .prepare(
        `SELECT p.sku, p.nama_accurate, agg.total_qty,
                ${LOKASI.utama} AS lokasi_utama,
                ${LOKASI.lain} AS lokasi_semua
         FROM products p
         LEFT JOIN (
           SELECT sku, SUM(qty) AS total_qty FROM stock_by_bin GROUP BY sku
         ) agg ON agg.sku = p.sku
         WHERE 1 = 1
         -- Tiebreaker WAJIB. Tanpa kolom unik di ekor, dua produk dengan nama sama bisa
         -- bertukar posisi antar query; paginasi OFFSET lalu menampilkan satu baris DUA
         -- KALI sambil menjatuhkan baris lain. Kolom sku unik, jadi urutannya selalu total.
         ORDER BY ${ORDER_BY}, p.sku ASC
         LIMIT ? OFFSET ?`
      )
      .bind(ukuran, offset)
      .all<{ sku: string; nama_accurate: string | null; total_qty: number | null; lokasi_utama: string | null; lokasi_semua: string | null }>();

    // Total dari COUNT(*) di lapisan produk: satu SKU = satu baris. Ini yang membuat
    // nomor halaman di UI menunjuk halaman yang benar-benar berisi.
    const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM products").bind().first<{ total: number }>();
    const total = totalRow?.total ?? 0;

    // ── Langkah 2: penanda "+gudang lain" dari daftar yang sudah diambil di langkah 1 ──
    // Dulu ini kueri KEDUA ke `stock_by_bin`. Kini tidak perlu: daftar gudang datang
    // bersama barisnya (`lokasi_semua`), jadi aturan "dominan = qty terbesar, sisanya
    // jadi penanda" dijalankan pada data yang PERSIS sama dengan yang dipakai memilih
    // `lokasi_utama` — dua query terpisah bisa berbeda bila stok berubah di antaranya.
    const gudangLain = new Map<string, string>();
    for (const r of skuRows) {
      const lain = (r.lokasi_semua ?? "").split("\t").slice(1);
      if (lain.length > 0) gudangLain.set(r.sku, `+${lain.join(", ")}`);
    }

    return json({
      ok: true,
      rows: skuRows.map((r) => ({
        kode_barang: r.sku,
        nama_accurate: r.nama_accurate,
        // Kosong = tidak ada stok positif di gudang mana pun. Jujur kosong, bukan "-".
        lokasi_gudang: r.lokasi_utama ?? "",
        gudang_lain: gudangLain.get(r.sku) ?? "",
        quantity_total: r.total_qty ?? 0,
      })),
      total,
      halaman,
      ukuran,
      urut: kunci,
      arah: arah.toLowerCase(),
    });
  }

  if (scope === "gudang") {
    if (user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
    const semua = url.searchParams.get("semua") === "true";
    if (semua && !user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
    const daftar = await listGudang(db, semua);
    return json({
      ok: true,
      rows: daftar.map((g) => ({ gudang_id: g.id, nama: g.nama, aktif: g.aktif === 1, urutan: g.urutan })),
    });
  }

  if (scope === "opname") {
    if (user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
    const daftar = await listOpname(db, url.searchParams.get("status") ?? undefined, url.searchParams.get("gudang_id") ?? undefined);
    return json({
      ok: true,
      rows: daftar.map((o) => ({
        id: o.id, gudang_id: o.warehouse_id, status: o.status, created_by: "",
        created_at: keIso(o.created_at),
        items: o.items.map((i) => ({ kode_barang: i.sku, qty_sistem: i.qty_sistem, qty_fisik: i.qty_fisik, selisih: i.selisih, belum_terdaftar: i.belum_terdaftar === 1 })),
      })),
    });
  }

  if (scope === "transfer") {
    if (user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
    const daftar = await listTransfer(db, {
      status: url.searchParams.get("status") ?? undefined,
      dari_gudang_id: url.searchParams.get("dari_gudang_id") ?? undefined,
      tujuan_id: url.searchParams.get("tujuan_id") ?? undefined,
    });
    return json({
      ok: true,
      rows: daftar.map((t) => ({
        id: t.id, dari_gudang_id: t.dari_warehouse_id, status: t.status,
        created_by: t.created_by, created_at: keIso(t.created_at),
        tujuan: t.tujuan.map((d) => ({
          tipe: "gudang", id: d.dest_warehouse_id, status: d.status, status_kirim: d.status_kirim,
          user_penerima_id: d.user_penerima_id, items: d.items.map((i) => ({ kode_barang: i.sku, qty: i.qty })),
        })),
        tujuan_ids: t.tujuan.map((d) => `gudang:${d.dest_warehouse_id}`),
        items: t.tujuan.flatMap((d) => d.items.map((i) => ({ kode_barang: i.sku, qty: i.qty }))),
      })),
    });
  }

  if (scope === "daily") {
    if (user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
    const tanggal = url.searchParams.get("tanggal") ?? tanggalHariIni();
    const doc = await ambilDaily(db, tanggal);
    if (!doc) return json({ ok: true, rows: [] });
    return json({
      ok: true,
      rows: [{
        tanggal: doc.tanggal, status: doc.status,
        items: doc.items.map((i) => ({
          kode_barang: i.sku, nama: i.nama, variasi: i.variasi, qty: i.qty,
          buffer: i.buffer === 1, status: i.status, qty_diminta: i.qty_diminta,
          qty_datang: i.qty_datang, datang_at: null, datang_by: null,
        })),
      }],
    });
  }

  if (scope === "admin") {
    if (!user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
    const daftar = await listAdmins(db);
    return json({
      ok: true,
      rows: daftar.map((a) => ({
        telegram_user_id: String(a.tg_id), name: a.display_name,
        telegram_username: a.username, role: a.role,
      })),
    });
  }

  if (scope === "akses") {
    if (!user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
    const daftar = await listAkses(db);
    return json({
      ok: true,
      rows: daftar.map((a) => ({
        telegram_user_id: String(a.tg_id), status: a.status,
        requested_at: keIso(a.requested_at), telegram_username: a.telegram_username,
        telegram_display_name: a.telegram_display_name, rejected_until: keIso(a.rejected_until),
      })),
    });
  }

  if (scope === "histori") {
    if (user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
    const daftar = await listMovements(db, {
      sku: url.searchParams.get("kode") ?? undefined,
      jenis: url.searchParams.get("type") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      created_by: url.searchParams.get("created_by") ?? undefined,
      dari: url.searchParams.get("dari") ? Math.floor(new Date(url.searchParams.get("dari") as string).getTime() / 1000) : undefined,
      sampai: url.searchParams.get("sampai") ? Math.floor(new Date(url.searchParams.get("sampai") as string).getTime() / 1000) : undefined,
      limit: Number(url.searchParams.get("limit") ?? 50),
    });
    return json({
      ok: true,
      rows: daftar.map((m) => ({
        id: String(m.id), kode_barang: m.sku, nama_terbaca: m.nama_terbaca, variasi: m.variasi,
        qty: m.qty, type: m.jenis, action_type: m.action_type, qty_sistem: m.qty_sistem,
        qty_fisik: m.qty_fisik, selisih: m.selisih, catatan: m.catatan, source: m.source,
        status: m.status, created_at: keIso(m.at),
        created_by: m.created_by, created_by_username: null, created_by_name: null,
        requested_by: null, requested_by_username: null, requested_by_name: null,
        confirmed_by: null, resolved_by: null, penanda: null,
      })),
    });
  }

  if (scope === "ai") {
    if (user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
    // Vars dari binding Worker (wrangler.jsonc) — lihat getEnvAi di lib/d1/db.ts.
    const s = await ambilPengaturanAI(db, getEnvAi());
    return json({ ok: true, settings: { textProvider: s.textProvider, updatedAt: null, updatedBy: null } });
  }

  if (scope === "model-terpakai") {
    // Model yang BOLEH dipakai pemanggil untuk satu tujuan — sumber daftar dropdown
    // untuk SEMUA role (termasuk owner, supaya UI-nya seragam satu jalur baca).
    //
    // KENAPA endpoint terpisah, bukan memakai `?scope=ai` atau /api/pengaturan/ai?aksi=model:
    //   keduanya owner-only. Menu dropdown tetap harus tahu daftar model yang sah untuk
    //   role-nya; kalau ia membaca katalog penuh lalu menyaring di klien, itu hanya
    //   menyembunyikan model, bukan melarangnya — dan setiap role bisa mengintip model
    //   yang tidak diizinkan hanya dengan membuka devtools.
    //
    // Owner pindai seluruh katalog; role lain dipotong oleh himpunan izin (fail closed:
    // tabel izin kosong = daftar kosong, lihat lib/d1/aiIzinModel.ts).
    const jenis = (url.searchParams.get("jenis") ?? "").trim();
    if (!(JENIS_IZIN as readonly string[]).includes(jenis)) {
      return json({ ok: false, error: `Tujuan harus salah satu dari: ${JENIS_IZIN.join(", ")}.` }, 400);
    }
    const katalog = await daftarModel(db, url.searchParams.get("provider") ?? undefined, jenis);
    const izin = await himpunanIzin(db, user.role, jenis as JenisIzin);
    const terpakai =
      izin === null
        ? katalog
        : katalog.filter((m) => izin.has(`${m.provider}\u0000${m.model_id}`));
    // `dibatasi` dipakai UI untuk membedakan "katalog memang kosong" dari "kamu tidak
    // diizinkan memakai apa pun" — dua keadaan itu butuh pesan yang berbeda.
    return json({ ok: true, model: terpakai, dibatasi: izin !== null });
  }

  if (scope === "ringkasan") {
    // TETAP terbuka untuk guest: halaman `/` (Ringkasan) adalah menu guest dan satu-satunya
    // sumber angkanya. Sejak guest ditutup dari scope `stok`/`histori`, beranda TIDAK BOLEH
    // lagi menumpang dua scope enumerasi itu (dulu 200 baris stok + 10 movement mentah demi
    // tiga angka dan satu daftar pendek) — Promise.all-nya pecah pada 403 pertama dan guest
    // cuma melihat kartu error di satu-satunya halaman yang dia punya.
    //
    // Karena scope ini TERBUKA untuk guest, isinya WAJIB agregat + irisan TERBATAS, bukan
    // enumerasi: tanpa hpp, tanpa qty per gudang, tanpa katalog penuh. Yang dikirim hanya
    // kolom yang benar-benar dirender beranda.
    // B7-A: agregat di SQL (1 baris), bukan tarik 2000 baris lalu hitung di JS.
    const agg = await db.prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN b.qty < 0 THEN 1 ELSE 0 END) AS minus,
        SUM(CASE WHEN b.qty >= 0 AND p.stok_min IS NOT NULL AND b.qty < p.stok_min THEN 1 ELSE 0 END) AS menipis
       FROM products p JOIN stock_by_bin b ON b.sku = p.sku
       WHERE p.is_online_product = 1 AND b.warehouse_id = 'ONLINE'`
    ).bind().first<{ total: number; minus: number | null; menipis: number | null }>();

    // Daftar minus: dibatasi LIMIT di SQL (bukan ditarik 200 lalu dipotong di klien).
    // `kurang` = |qty| dan `tanda` dipakai klien untuk memformat — kolom lain sengaja tidak
    // diikutkan supaya scope ini tidak berubah jadi jalur baca stok.
    const minus = await db
      .prepare(
        `SELECT p.sku, p.nama_accurate, b.qty
         FROM products p JOIN stock_by_bin b ON b.sku = p.sku
         WHERE p.is_online_product = 1 AND b.warehouse_id = 'ONLINE' AND b.qty < 0
         ORDER BY b.qty ASC
         LIMIT ?`
      )
      .bind(MAKS_MINUS_RINGKASAN)
      .all<{ sku: string; nama_accurate: string | null; qty: number }>();

    // Menipis: kolom qty + stok_min saja. `stok_min` bukan rahasia biaya — ia reorder point
    // yang memang ditampilkan beranda ("Reorder N").
    const menipis = await db
      .prepare(
        `SELECT p.sku, p.nama_accurate, b.qty, p.stok_min
         FROM products p JOIN stock_by_bin b ON b.sku = p.sku
         WHERE p.is_online_product = 1 AND b.warehouse_id = 'ONLINE'
           AND b.qty >= 0 AND p.stok_min IS NOT NULL AND b.qty < p.stok_min
         ORDER BY (p.stok_min - b.qty) DESC
         LIMIT ?`
      )
      .bind(MAKS_MENIPIS_RINGKASAN)
      .all<{ sku: string; nama_accurate: string | null; qty: number; stok_min: number | null }>();

    // Pergerakan terakhir: projection sempit ke kolom yang dirender beranda. `qty_sistem`,
    // `qty_fisik`, `selisih`, `catatan`, dan `created_by` (id internal) SENGAJA tidak
    // dikirim — scope ini terbuka untuk guest.
    const { results: moves } = await db
      .prepare(
        `SELECT id, sku, nama_terbaca, qty, jenis, status, at
         FROM stock_moves
         ORDER BY at DESC, id DESC
         LIMIT ?`
      )
      .bind(MAKS_GERAK_RINGKASAN)
      .all<{ id: number; sku: string; nama_terbaca: string | null; qty: number | null; jenis: string; status: string; at: number }>();

    return json({
      ok: true,
      ringkasan: { totalProdukOnline: agg?.total ?? 0, itemMenipis: agg?.menipis ?? 0, itemMinus: agg?.minus ?? 0 },
      minus: minus.results.map((r) => ({
        kode_barang: r.sku,
        nama_accurate: r.nama_accurate,
        stok_gudang_online: r.qty,
        kekurangan: Math.abs(r.qty),
      })),
      menipis: menipis.results.map((r) => ({
        kode_barang: r.sku,
        nama_accurate: r.nama_accurate,
        stok_gudang_online: r.qty,
        reorder_point: r.stok_min,
      })),
      movements: moves.map((m) => ({
        id: String(m.id), kode_barang: m.sku, nama_terbaca: m.nama_terbaca, variasi: null,
        qty: m.qty, type: m.jenis, action_type: null, qty_sistem: null, qty_fisik: null,
        selisih: null, catatan: null, source: null, status: m.status, created_at: keIso(m.at),
        created_by: null, created_by_username: null, created_by_name: null,
        requested_by: null, requested_by_username: null, requested_by_name: null,
        confirmed_by: null, resolved_by: null, penanda: null,
      })),
    });
  }

  return json({ ok: false, error: "Scope tidak dikenal." }, 400);
}
