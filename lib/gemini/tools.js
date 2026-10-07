// lib/gemini/tools.js
// Function-calling ke Firestore untuk chat biasa.
//
// PERUBAHAN PENTING (rewrite pencarian produk): kurangiStok/tambahStok/cekStok SEKARANG
// menerima `namaProduk` (bukan kodeBarang langsung dari Gemini) — SISTEM yang cari
// kodeBarang-nya sendiri lewat cariProdukPintar (prioritas kolam online dulu), bukan
// mengandalkan Gemini sudah panggil cariProduk lebih dulu di reasoning-nya. Alasan:
// Gemini kadang "lupa" cari dulu atau salah asumsi kode barang, dan itu pernah bikin
// kodeBarang undefined nyelip ke pendingAction (root cause bug tambahStok gagal kemarin).
// Dengan desain baru, resolusi nama→kode SELALU lewat 1 jalur yang sama & terverifikasi,
// gak peduli Gemini reasoning-nya seperti apa.
//
// Tiga kategori tool sekarang:
// 1. Read-only sederhana (cekProdukStokMenipis, listProdukOnlineBesertaStok) → langsung dieksekusi.
// 2. Butuh resolusi nama produk dulu (cariProduk, cekStok, kurangiStok, tambahStok) →
//    lewat cariProdukPintar. Kalau hasilnya "perlu konfirmasi cakupan" (gak ketemu di
//    kolam online), tool ini jadi TERMINAL (lihat TOOL_TERMINAL_LANGSUNG) — chatHandler.js
//    yang urus tombol konfirmasi cakupan, BUKAN balik ke Gemini buat dirangkai jadi teks.
// 3. Perlu konfirmasi admin sebelum efek nyata (kurangiStok/tambahStok, KALAU produk
//    sudah pasti ketemu) → chatHandler.js menahan, simpan pendingAction, tunggu "ya"/"tidak".
//    mulaiOpname juga terminal (delegasi ke handleOpname()), pola lama tidak berubah.
//
// BATCH kurangiStok/tambahStok (misal admin kirim daftar banyak produk dalam 1 pesan,
// "barang datang: A 2pcs, B 50pcs, C 150pcs"): Gemini MEMANG akan memanggil tool
// kurangiStok/tambahStok berkali-kali dalam 1 giliran (sudah diinstruksikan di
// promptSystem.js). chatHandler.js SEKARANG memproses SEMUA panggilan itu sekaligus
// (bukan cuma yang pertama seperti sebelumnya) lewat tanganiToolResolusiProdukBatch(),
// resolve tiap item satu-satu via cariProdukPintar, lalu tampilkan SATU ringkasan
// konfirmasi utk semua item yang "jelas" ketemu (pendingBatchAction, array — field baru,
// TERPISAH dari pendingAction lama yang tetap dipakai utk konfirmasi 1 item hasil alur
// pilih-kandidat/expand-katalog). Item yang "ragu"/gak ketemu di-skip & dilaporkan di
// ringkasan (pola sama seperti konfirmasiPickingList.js), TIDAK memblokir item lain.

const { ambilProdukByKode, listSemuaProduk } = require("../models/produk");
const { ambilStok, cariStokDiBawahReorderPoint, ambilSemuaStokSebagaiMap } = require("../models/stok");
const { cariProdukPintar } = require("../matching/cariProdukPintar");

// ---------- Daftar function declarations (dikirim ke Gemini) ----------

const TOOLS = [
  {
    name: "cariProduk",
    description:
      "Cari produk berdasarkan nama (fuzzy, toleran typo, cocok utk nama Accurate/Shopee/informal). " +
      "Prioritas cari di produk yang sudah online dulu. Pakai ini kalau admin cuma tanya info/cari produk " +
      "TANPA maksud ubah stok (kalau maksudnya ubah stok, langsung pakai kurangiStok/tambahStok/cekStok, " +
      "tool-tool itu sudah cari sendiri di dalamnya, gak perlu cariProduk dulu).",
    parameters: {
      type: "object",
      properties: {
        namaProduk: { type: "string", description: "Nama produk yang dicari (boleh typo/informal)" },
      },
      required: ["namaProduk"],
    },
  },
  {
    name: "cekStok",
    description:
      "Cek jumlah stok gudang online saat ini utk 1 produk berdasarkan NAMA (bukan kode) — " +
      "tool ini cari sendiri produknya, jangan panggil cariProduk dulu sebelum ini.",
    parameters: {
      type: "object",
      properties: {
        namaProduk: { type: "string", description: "Nama produk (boleh typo/informal)" },
      },
      required: ["namaProduk"],
    },
  },
  {
    name: "cekProdukStokMenipis",
    description: "Ambil daftar produk yang stoknya di bawah reorder_point saat ini.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "listProdukOnlineBesertaStok",
    description:
      "Ambil daftar SEMUA produk yang sudah ditandai online (is_online_product true) beserta " +
      "jumlah stok gudang online masing-masing. Pakai ini kalau admin minta lihat 'stok online', " +
      "'daftar produk online', 'stok gudang online semua', atau semacamnya — TANPA menyebut nama " +
      "produk tertentu (kalau nama produk tertentu disebut, pakai cekStok, bukan ini). Tool ini " +
      "TIDAK butuh argumen apa pun dan TIDAK terbatas pada yang stoknya menipis (beda dari " +
      "cekProdukStokMenipis, yang cuma nampilin yang di bawah reorder_point).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "kurangiStok",
    description:
      "Usulkan pengurangan stok gudang online untuk 1 produk berdasarkan NAMA (misal admin bilang " +
      "'kurangi stok X 3 pcs, kepakai buat display'). Tool ini cari sendiri produknya berdasarkan nama — " +
      "JANGAN panggil cariProduk dulu, langsung panggil ini. TIDAK langsung eksekusi — sistem akan minta " +
      "konfirmasi ke admin dulu (baik konfirmasi produk yang dimaksud, maupun konfirmasi ubah stoknya).",
    parameters: {
      type: "object",
      properties: {
        namaProduk: { type: "string", description: "Nama produk (boleh typo/informal, apa adanya dari admin)" },
        qty: { type: "number", description: "Jumlah yang dikurangi, harus > 0" },
        alasan: { type: "string", description: "Alasan singkat, opsional" },
      },
      required: ["namaProduk", "qty"],
    },
  },
  {
    name: "tambahStok",
    description:
      "Usulkan penambahan stok gudang online untuk 1 produk berdasarkan NAMA. Pakai ini kalau admin bilang " +
      "'barang datang', 'restock', 'kiriman masuk', 'barang baru sampai', 'nambahin stok dari " +
      "suplier/gudang sebelah', koreksi manual positif, ATAU cuma sebut nama produk + qty tanpa " +
      "embel-embel apa pun. JANGAN dikira opname walau formatnya mirip 'nama - qty' — opname " +
      "cuma kalau admin EKSPLISIT bilang 'opname'/'stok fisik'/'cocokkan stok' (pakai tool " +
      "mulaiOpname utk itu, bukan ini). Kalau produk lebih dari 1, pakai tambahStokBatch. " +
      "Tool ini cari sendiri produknya berdasarkan nama — JANGAN panggil cariProduk dulu. " +
      "TIDAK langsung eksekusi — sistem akan minta konfirmasi ke admin dulu.",
    parameters: {
      type: "object",
      properties: {
        namaProduk: { type: "string", description: "Nama produk (boleh typo/informal, apa adanya dari admin)" },
        qty: { type: "number", description: "Jumlah yang ditambah, harus > 0" },
        alasan: { type: "string", description: "Alasan singkat, opsional" },
      },
      required: ["namaProduk", "qty"],
    },
  },
  {
    name: "kurangiStokBatch",
    description:
      "Usulkan pengurangan stok untuk BANYAK produk sekaligus. Pakai untuk daftar produk " +
      "yang masing-masing memiliki nama dan qty. Jangan panggil kurangiStok berkali-kali; " +
      "isi semua item ke dalam array items.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              namaProduk: { type: "string" },
              qty: { type: "number" },
              alasan: { type: "string" },
            },
            required: ["namaProduk", "qty"],
          },
          minItems: 2,
        },
      },
      required: ["items"],
    },
  },
  {
    name: "tambahStokBatch",
    description:
      "Usulkan penambahan stok untuk BANYAK produk sekaligus. Pakai untuk barang datang, " +
      "restock, atau daftar produk yang masing-masing memiliki nama dan qty. Jangan panggil " +
      "tambahStok berkali-kali; isi semua item ke dalam array items.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              namaProduk: { type: "string" },
              qty: { type: "number" },
              alasan: { type: "string" },
            },
            required: ["namaProduk", "qty"],
          },
          minItems: 2,
        },
      },
      required: ["items"],
    },
  },
  {
    name: "mulaiOpname",
    description:
      "HANYA panggil ini kalau admin SECARA EKSPLISIT bilang kata 'opname', 'stok fisik', " +
      "'hasil hitung gudang', 'cocokkan stok sistem', atau 'audit stok' — diikuti daftar nama " +
      "produk + qty. Kalau kata-kata itu TIDAK ADA (misal admin cuma bilang 'barang datang' atau " +
      "sebut produk + qty polos), itu BUKAN opname — pakai tambahStok atau tambahStokBatch, jangan tool ini, " +
      "walau daftarnya berisi banyak produk sekaligus. Rapikan tiap baris jadi format " +
      "'nama - qty' sebelum dikirim ke tool ini, satu baris per produk. Jangan mengarang qty — kalau " +
      "admin belum kasih daftar lengkap, tanya dulu, jangan panggil tool ini dengan data kosong/nebak.",
    parameters: {
      type: "object",
      properties: {
        daftarOpnameTeks: {
          type: "string",
          description:
            "Multi-baris, tiap baris format 'nama produk - qty', misal:\n" +
            "Alas Setrika uk.3x45x90 - 12\nLunch box BOBO Montana Pink - 4",
        },
      },
      required: ["daftarOpnameTeks"],
    },
  },
  {
    name: "tambahProdukBaru",
    description:
      "Daftarkan produk BARU ke database (produk yang belum pernah ada sama sekali — sudah " +
      "dicek gak ketemu meski dicari di semua katalog). HANYA panggil ini kalau admin SECARA " +
      "EKSPLISIT minta tambah/daftarkan produk baru (misal 'produk ini belum ada, tolong " +
      "tambahin', 'daftarin barang baru'), ATAU admin mengonfirmasi setelah kamu bilang produk " +
      "gak ketemu dan nanya apa mau didaftarkan sebagai produk baru. JANGAN pernah menebak " +
      "kode_barang sendiri — WAJIB tanya admin dulu kode_barang-nya apa (harus sama dengan kode " +
      "di Accurate, biar gak bentrok pas sync Sheets nanti) kalau admin belum menyebutkannya. " +
      "Produk baru dari chat OTOMATIS ditandai online (khusus produk stok online), dan TIDAK " +
      "langsung eksekusi — sistem akan minta konfirmasi ke admin dulu. Kalau admin mau daftarkan " +
      "LEBIH DARI SATU produk baru sekaligus dalam satu pesan, pakai tool tambahProdukBaruBatch, " +
      "JANGAN panggil tool ini berkali-kali.",
    parameters: {
      type: "object",
      properties: {
        kodeBarang: { type: "string", description: "Kode barang unik (WAJIB sama persis dgn kode di Accurate), harus ditanya ke admin dulu kalau belum disebut" },
        namaProduk: { type: "string", description: "Nama produk (nama_accurate)" },
        hpp: { type: "number", description: "HPP per unit, opsional" },
        stokAwal: { type: "number", description: "Stok gudang online awal, opsional (default 0 kalau tidak disebut)" },
        alasan: { type: "string", description: "Catatan singkat, opsional" },
      },
      required: ["kodeBarang", "namaProduk"],
    },
  },
  {
    name: "tambahProdukBaruBatch",
    description:
      "Daftarkan BANYAK produk baru sekaligus dalam satu pesan (misal admin kirim daftar produk " +
      "baru berbaris-baris). Sama aturannya dengan tambahProdukBaru (harus produk yang beneran " +
      "belum ada, kode_barang WAJIB ditanya ke admin dulu kalau belum disebut, sama persis dgn " +
      "kode di Accurate). Rapikan tiap baris jadi format 'kode - nama - hpp - stok_awal' sebelum " +
      "dikirim ke tool ini (hpp & stok_awal boleh dikosongkan kalau admin gak sebut, tulis '-' " +
      "kalau memang gak ada). Jangan mengarang kode_barang, hpp, atau stok_awal — kalau admin " +
      "belum kasih daftar lengkap dengan kode_barang jelas per baris, tanya dulu.",
    parameters: {
      type: "object",
      properties: {
        daftarProdukBaruTeks: {
          type: "string",
          description:
            "Multi-baris, tiap baris format 'kode - nama - hpp - stok_awal' (hpp/stok_awal opsional, " +
            "tulis '-' kalau gak ada), misal:\n" +
            "BRG001 - Mangkok Tulip Hijau - 15000 - 60\n" +
            "BRG002 - Pisau Set 3 in 1 - - 10",
        },
      },
      required: ["daftarProdukBaruTeks"],
    },
  },
];

// Tool yang BUTUH konfirmasi "ya"/"tidak" via mekanisme sessions.pendingAction
// (ditahan chatHandler, baru dieksekusi setelah admin jawab ya). Dicek SETELAH tool
// berhasil resolve nama→produk (lihat tanganiToolResolusiProduk di chatHandler.js) —
// kalau resolusi gagal/perlu konfirmasi cakupan, itu jalur terminal duluan.
const TOOL_PERLU_KONFIRMASI = new Set(["kurangiStok", "tambahStok"]);

// Tool yang SELALU terminal tanpa syarat (gak peduli hasil resolusi produk).
// tambahProdukBaru & tambahProdukBaruBatch juga terminal — TIDAK lewat resolusiProduk (justru
// karena produknya BELUM ada, gak ada apa pun buat di-resolve), langsung ditangani chatHandler.js sendiri.
const TOOL_TERMINAL_LANGSUNG = new Set(["mulaiOpname", "tambahProdukBaru", "tambahProdukBaruBatch"]);

// Tool yang butuh resolusi nama→produk lewat cariProdukPintar SEBELUM eksekusi lanjutannya
// (baik itu read-only langsung seperti cariProduk/cekStok, maupun yang lanjut ke
// pendingAction seperti kurangiStok/tambahStok). Semua tool di sini WAJIB ditangani lewat
// tanganiToolResolusiProduk di chatHandler.js, BUKAN jalur jalankanToolReadOnly biasa.
const TOOL_BUTUH_RESOLUSI_PRODUK = new Set([
  "cariProduk",
  "cekStok",
  "kurangiStok",
  "tambahStok",
  "kurangiStokBatch",
  "tambahStokBatch",
]);

// ---------- Implementasi tool read-only sederhana (tanpa resolusi produk) ----------

const IMPLEMENTASI = {
  async cekProdukStokMenipis() {
    const daftar = await cariStokDiBawahReorderPoint();
    return { jumlah: daftar.length, daftar };
  },

  async listProdukOnlineBesertaStok() {
    const produkOnline = await listSemuaProduk({ hanyaOnline: true });
    const petaStok = await ambilSemuaStokSebagaiMap();

    const daftar = produkOnline.map((produk) => {
      const stok = petaStok.get(produk.kode_barang);
      return {
        kode_barang: produk.kode_barang,
        nama_accurate: produk.nama_accurate,
        stok_gudang_online: stok ? stok.stok_gudang_online : null,
      };
    });

    return { jumlah: daftar.length, daftar };
  },
};

/**
 * Jalankan satu tool READ-ONLY SEDERHANA (bukan yang butuh resolusi produk, bukan yang
 * perlu konfirmasi, bukan terminal). Caller (chatHandler) wajib sudah menyaring 3
 * kategori lain itu SEBELUM sampai sini.
 * @param {string} namaFungsi
 * @param {object} args
 */
async function jalankanToolReadOnly(namaFungsi, args) {
  if (
    TOOL_PERLU_KONFIRMASI.has(namaFungsi) ||
    TOOL_TERMINAL_LANGSUNG.has(namaFungsi) ||
    TOOL_BUTUH_RESOLUSI_PRODUK.has(namaFungsi)
  ) {
    throw new Error(`jalankanToolReadOnly dipanggil utk tool yg butuh jalur khusus: ${namaFungsi}`);
  }
  const fn = IMPLEMENTASI[namaFungsi];
  if (!fn) throw new Error(`Tool tidak dikenal: ${namaFungsi}`);
  return fn(args);
}

/**
 * Jalankan resolusi nama→produk pakai cariProdukPintar, dipakai chatHandler.js utk
 * SEMUA tool di TOOL_BUTUH_RESOLUSI_PRODUK, sebelum tool itu lanjut ke logic
 * spesifiknya masing-masing (cariProduk berhenti di sini, cekStok lanjut ambil stok,
 * kurangiStok/tambahStok lanjut ke pendingAction).
 * @param {string} namaProduk
 */
async function resolusiProduk(namaProduk) {
  return cariProdukPintar(namaProduk);
}

/**
 * Ambil data stok utk 1 produk yang SUDAH pasti ketemu (dipanggil chatHandler.js
 * setelah resolusiProduk() sukses, khusus tool cekStok).
 * @param {string} kodeBarang
 */
async function ambilStokProduk(kodeBarang) {
  const stok = await ambilStok(kodeBarang);
  if (!stok) return { ditemukan: false, kodeBarang };
  return { ditemukan: true, kodeBarang, ...stok };
}

/**
 * Bentuk objek pendingAction siap simpan ke sessions.pendingAction, SETELAH produk
 * sudah pasti ketemu (kodeBarang di sini SELALU valid, hasil resolusiProduk()).
 * @param {"kurangiStok"|"tambahStok"} namaFungsi
 * @param {object} args - { kodeBarang, namaProduk, qty, alasan? }
 */
function bentukPendingAction(namaFungsi, args) {
  return {
    jenis: namaFungsi, // "kurangiStok" | "tambahStok"
    kodeBarang: args.kodeBarang,
    namaProduk: args.namaProduk,
    qty: args.qty,
    alasan: args.alasan || null,
    tagOnlineSetelahnya: args.tagOnlineSetelahnya || false,
    dibuatPada: new Date(),
  };
}

/**
 * Bentuk 1 ITEM di dalam array pendingBatchAction.items (dipakai chatHandler.js saat
 * memproses batch kurangiStok/tambahStok — beberapa produk sekaligus dalam 1 pesan).
 * Beda dari bentukPendingAction() (objek pending TUNGGAL, dipakai jalur pilih-kandidat/
 * expand-katalog) — ini cuma "baris" di dalam array, tanpa field jenis/dibuatPada sendiri
 * (jenis & waktu dibuat disimpan sekali di level pendingBatchAction, bukan per item).
 * @param {object} args - { kodeBarang, namaProduk, qty, alasan? }
 */
function bentukPendingBatchItem(args) {
  return {
    kodeBarang: args.kodeBarang,
    namaProduk: args.namaProduk,
    qty: args.qty,
    alasan: args.alasan || null,
  };
}

/**
 * Bentuk objek pendingAction utk tambahProdukBaru — beda bentuk dari
 * bentukPendingAction() (yang khusus kurangiStok/tambahStok atas produk yang SUDAH ada),
 * karena di sini produknya BELUM ada, jadi butuh field tambahan (hpp, stokAwal) yang
 * gak relevan buat kurangiStok/tambahStok.
 * @param {object} args - { kodeBarang, namaProduk, hpp, stokAwal, alasan? }
 */
function bentukPendingActionProdukBaru(args) {
  return {
    jenis: "tambahProdukBaru",
    kodeBarang: args.kodeBarang,
    namaProduk: args.namaProduk,
    hpp: args.hpp ?? null,
    stokAwal: args.stokAwal || 0,
    alasan: args.alasan || null,
    dibuatPada: new Date(),
  };
}

/**
 * Bentuk 1 ITEM produk baru di dalam array pendingBatchAction.items (jenis: "tambahProdukBaru").
 * Beda dari bentukPendingBatchItem() (qty saja) — produk baru butuh hpp & stokAwal, gak ada
 * "produk existing" yang dikurangi/ditambah stoknya, jadi field-nya beda bentuk.
 * @param {object} args - { kodeBarang, namaProduk, hpp, stokAwal, alasan? }
 */
function bentukPendingBatchItemProdukBaru(args) {
  return {
    jenis: "tambahProdukBaru",
    kodeBarang: args.kodeBarang,
    namaProduk: args.namaProduk,
    hpp: args.hpp ?? null,
    stokAwal: args.stokAwal || 0,
    alasan: args.alasan || null,
  };
}

module.exports = {
  TOOLS,
  TOOL_PERLU_KONFIRMASI,
  TOOL_TERMINAL_LANGSUNG,
  TOOL_BUTUH_RESOLUSI_PRODUK,
  jalankanToolReadOnly,
  resolusiProduk,
  ambilStokProduk,
  bentukPendingAction,
  bentukPendingBatchItem,
  bentukPendingBatchItemProdukBaru,
  bentukPendingActionProdukBaru,
};