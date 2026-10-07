// lib/dashboard/validasiTulisV3a.js
// v5: mendelegasikan aksi set-gudang-user / set-jabatan ke validasiGudangV5 (Z1).
// Validasi payload tulis dashboard v3a (PRD §5.1 route /api/permintaan, §6.5 route /api/admin).
// CommonJS murni, TANPA I/O & tanpa dependensi -> dipakai route TS via createRequire supaya
// logika validasi single-sourced dan mudah di-unit-test dari test CJS. Pola validasiTulisV2.js.
//
// Kontrak: { ok:true, status, ...nilai } ATAU { ok:false, status, error }.
// Pesan error persis seperti yang dikirim route ke UI.

const AKSI_PERMINTAAN_VALID = ["sesuaikan", "buat-form", "datang", "selesai"];
const MAKS_QTY = 1_000_000;
const FORMAT_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;

const INTERPRETASI_VALID = ["STOK", "MINTA", "MINTA_SISA"];

const { validasiSetGudangUser, validasiSetJabatan } = require("./validasiGudangV5");

function isObjek(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Validasi field qty: integer >= 0, maks 1.000.000 (PRD §3.7). Pesan beda per konteks.
function validasiQtyDiminta(qty) {
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0 || qty > MAKS_QTY) {
    return { ok: false, error: "Jumlah harus bilangan bulat >= 0 (maks 1.000.000)." };
  }
  return { ok: true, qty };
}

function validasiQtyDatang(qty) {
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0 || qty > MAKS_QTY) {
    return { ok: false, error: "Jumlah datang harus bilangan bulat >= 0 (maks 1.000.000)." };
  }
  return { ok: true, qty };
}

// Format "YYYY-MM-DD" valid & bukan tanggal masa depan (PRD §5.1). `hariIni` disuplai route
// (fungsi tetap murni, mudah dites).
function validasiTanggal(tanggal, hariIni) {
  if (typeof tanggal !== "string" || !FORMAT_TANGGAL.test(tanggal)) {
    return { ok: false, error: "Tanggal tidak valid." };
  }
  const [y, m, d] = tanggal.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Tolak tanggal yang tidak ada di kalender (mis. 2026-02-31 -> bergeser bulan).
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, error: "Tanggal tidak valid." };
  }
  if (hariIni && tanggal > hariIni) {
    return { ok: false, error: "Tanggal tidak valid." };
  }
  return { ok: true, tanggal };
}

// Kebijakan tanggal per aksi (PRD §5.1 tabel): `sesuaikan` HANYA hari ini; aksi lain boleh lampau.
function bolehSesuaikanTanggal(tanggal, hariIni) {
  if (tanggal === hariIni) return { ok: true };
  return { ok: false, error: "Hanya permintaan hari ini yang bisa diubah." };
}

// POST /api/permintaan. `hariIni` (opsional) untuk uji kebijakan tanggal.
function validasiAksiPermintaan(body, hariIni) {
  const b = isObjek(body) ? body : {};

  const aksi = b.aksi;
  if (typeof aksi !== "string" || !AKSI_PERMINTAAN_VALID.includes(aksi)) {
    return { ok: false, status: 400, error: "Aksi tidak dikenal." };
  }

  const tgl = validasiTanggal(b.tanggal, hariIni);
  if (!tgl.ok) return { ok: false, status: 400, error: tgl.error };
  const tanggal = tgl.tanggal;

  if (aksi === "sesuaikan") {
    if (hariIni) {
      const izin = bolehSesuaikanTanggal(tanggal, hariIni);
      if (!izin.ok) return { ok: false, status: 400, error: izin.error };
    }
    if (!Array.isArray(b.qty) || b.qty.length === 0) {
      return { ok: false, status: 400, error: "Daftar jumlah wajib diisi." };
    }
    const qty = [];
    for (const baris of b.qty) {
      if (!isObjek(baris) || typeof baris.kode_barang !== "string" || !baris.kode_barang.trim()) {
        return { ok: false, status: 400, error: "Item tidak valid." };
      }
      const q = validasiQtyDiminta(baris.qty);
      if (!q.ok) return { ok: false, status: 400, error: q.error };
      qty.push({
        kode_barang: baris.kode_barang.trim(),
        variasi: typeof baris.variasi === "string" && baris.variasi ? baris.variasi : "-",
        // `buffer` ikut jadi bagian identitas item (T1/S3.7); absen -> false.
        buffer: baris.buffer === true,
        qty: q.qty,
      });
    }
    return { ok: true, status: 200, aksi, tanggal, qty };
  }

  if (aksi === "datang") {
    if (!isObjek(b.item) || typeof b.item.kode_barang !== "string" || !b.item.kode_barang.trim()) {
      return { ok: false, status: 400, error: "Item tidak valid." };
    }
    const q = validasiQtyDatang(b.item.qty_datang);
    if (!q.ok) return { ok: false, status: 400, error: q.error };
    return {
      ok: true,
      status: 200,
      aksi,
      tanggal,
      item: {
        kode_barang: b.item.kode_barang.trim(),
        variasi: typeof b.item.variasi === "string" && b.item.variasi ? b.item.variasi : "-",
        buffer: b.item.buffer === true, // bagian identitas item (T1/S3.7)
      },
      qtyDatang: q.qty,
    };
  }

  // buat-form / selesai
  return { ok: true, status: 200, aksi, tanggal };
}

// --- v3b (Fase A) validator per aksi ---
// Batas field dipakai validator A5 (PRD v3b §5.3).
const MAKS_KODE_BARANG = 60;
const MAKS_NAMA_PRODUK = 120;
const MAKS_STOK_AWAL = 1_000_000;
const ID_TELEGRAM = /^\d+$/;

// Validasi `target_user_id` untuk approve-akses/tolak-akses (PRD §5.2).
// Route memetakan {notFound:true} -> 404 "Permintaan akses tidak ditemukan."
function validasiTargetAkses(targetUserId) {
  if (typeof targetUserId !== "string" || !ID_TELEGRAM.test(targetUserId)) {
    return { ok: false, status: 400, error: "User ID Telegram tidak valid." };
  }
  return { ok: true, targetUserId };
}

// Validasi `tambah-produk` (PRD §5.3). `hpp`/`stok_awal` opsional.
function validasiTambahProduk(b) {
  const kodeBarang = typeof b.kode_barang === "string" ? b.kode_barang.trim() : "";
  if (!kodeBarang) return { ok: false, status: 400, error: "Kode barang wajib diisi." };
  if (kodeBarang.length > MAKS_KODE_BARANG) {
    return { ok: false, status: 400, error: `Kode barang maksimal ${MAKS_KODE_BARANG} karakter.` };
  }
  // Kode dipakai sbg Firestore doc id: tolak path separator & karakter kontrol supaya tidak
  // membuat subkoleksi (`a/b`) / id `.`/`..` (Firestore menolak) -> struktur data kotor.
  if (kodeBarang.includes("/") || /[\u0000-\u001f\u007f]/.test(kodeBarang) || kodeBarang === "." || kodeBarang === "..") {
    return { ok: false, status: 400, error: "Kode barang tidak valid." };
  }

  const namaProduk = typeof b.nama_produk === "string" ? b.nama_produk.trim() : "";
  if (!namaProduk) return { ok: false, status: 400, error: "Nama produk wajib diisi." };
  if (namaProduk.length > MAKS_NAMA_PRODUK) {
    return { ok: false, status: 400, error: `Nama produk maksimal ${MAKS_NAMA_PRODUK} karakter.` };
  }

  // hpp: absen (undefined/null) -> null (bukan error). PRD §5.3 paritas chatHandler `hpp ?? null`.
  let hpp = null;
  if (b.hpp !== undefined && b.hpp !== null) {
    if (typeof b.hpp !== "number" || !Number.isInteger(b.hpp) || b.hpp < 0) {
      return { ok: false, status: 400, error: "HPP harus bilangan bulat >= 0." };
    }
    hpp = b.hpp;
  }

  // stok_awal: absen -> 0 (paritas bot `stokAwal || 0`).
  let stokAwal = 0;
  if (b.stok_awal !== undefined && b.stok_awal !== null) {
    if (typeof b.stok_awal !== "number" || !Number.isInteger(b.stok_awal) || b.stok_awal < 0) {
      return { ok: false, status: 400, error: "Stok awal harus bilangan bulat >= 0." };
    }
    if (b.stok_awal > MAKS_STOK_AWAL) {
      return { ok: false, status: 400, error: "Stok awal maksimal 1.000.000." };
    }
    stokAwal = b.stok_awal;
  }

  return { ok: true, status: 200, aksi: "tambah-produk", kodeBarang, namaProduk, hpp, stokAwal };
}

// --- v3b (Fase B) validator `konfirmasi-draft` (PRD §5.4) ---
const JENIS_DRAFT_VALID = ["opname", "picking", "sync"];
const AKSI_DRAFT_VALID = ["apply", "batal"];
// Salinan nilai `KONDISI` (lib/sheets/syncStokDuaArah.js:26-32) — sengaja diduplikasi agar
// validator tetap CJS murni tanpa I/O (tidak menarik handler bot ke bundel route).
const KONDISI_VALID = ["sheets_ketinggalan", "sheets_manual", "konflik", "produk_baru", "semua"];

// Validasi body `konfirmasi-draft` (PRD §5.4 tabel). `owner_user_id` SENGAJA tidak dibaca
// dari body (N1/§7.3) — nilai diambil dari draft server-side.
function validasiKonfirmasiDraft(b) {
  const jenis = b.jenis;
  if (typeof jenis !== "string" || !JENIS_DRAFT_VALID.includes(jenis)) {
    return { ok: false, status: 400, error: "Jenis draft tidak dikenal." };
  }

  const aksiDraft = b.aksi_draft;
  if (typeof aksiDraft !== "string" || !AKSI_DRAFT_VALID.includes(aksiDraft)) {
    return { ok: false, status: 400, error: "Aksi draft tidak dikenal." };
  }

  // `kondisi` hanya untuk sync; non-sync + kondisi non-null -> 400.
  let kondisi = null;
  if (b.kondisi !== undefined && b.kondisi !== null) {
    if (jenis !== "sync") {
      return { ok: false, status: 400, error: "Kondisi hanya untuk draft sync." };
    }
    if (typeof b.kondisi !== "string" || !KONDISI_VALID.includes(b.kondisi)) {
      return { ok: false, status: 400, error: "Kondisi tidak dikenal." };
    }
    kondisi = b.kondisi;
  }
  if (jenis === "sync" && kondisi === null) kondisi = "semua";

  if (jenis === "picking") {
    const batchId = typeof b.batch_id === "string" ? b.batch_id.trim() : "";
    if (!batchId) return { ok: false, status: 400, error: "Batch picking tidak ditemukan." };
    return { ok: true, status: 200, aksi: "konfirmasi-draft", jenis, batchId, aksiDraft, kondisi: null };
  }

  const draftId = typeof b.draft_id === "string" ? b.draft_id.trim() : "";
  if (!draftId) return { ok: false, status: 400, error: "Draft tidak ditemukan." };
  return { ok: true, status: 200, aksi: "konfirmasi-draft", jenis, draftId, aksiDraft, kondisi };
}

// POST /api/admin — dispatcher aksi (PRD v3a §6.5 + v3b §4.2). Aksi di luar daftar -> 400.
// v3a `kata-kunci`; v3b Fase A `approve-akses`/`tolak-akses`/`tambah-produk`; Fase B
// `konfirmasi-draft`.
function validasiAksiAdmin(body) {
  const b = isObjek(body) ? body : {};

  if (typeof b.aksi !== "string" || !b.aksi) {
    return { ok: false, status: 400, error: "Aksi tidak dikenal." };
  }

  if (b.aksi === "approve-akses" || b.aksi === "tolak-akses") {
    const t = validasiTargetAkses(b.target_user_id);
    if (!t.ok) return t;
    return { ok: true, status: 200, aksi: b.aksi, targetUserId: t.targetUserId };
  }

  if (b.aksi === "tambah-produk") {
    return validasiTambahProduk(b);
  }

  if (b.aksi === "konfirmasi-draft") {
    return validasiKonfirmasiDraft(b);
  }

  // v5 (Z1): aksi baru pada route existing /api/admin.
  // PENTING: jabatan TIDAK pernah dibaca sebagai pengganti role (F4/T12) - hanya label.
  if (b.aksi === "set-gudang-user") {
    return validasiSetGudangUser(b);
  }
  if (b.aksi === "set-jabatan") {
    return validasiSetJabatan(b);
  }

  if (b.aksi !== "kata-kunci") {
    return { ok: false, status: 400, error: "Aksi tidak dikenal." };
  }

  const id = typeof b.id === "string" ? b.id.trim() : "";
  if (!id) return { ok: false, status: 400, error: "Id penanda wajib diisi." };

  if (typeof b.interpreted_as !== "string" || !INTERPRETASI_VALID.includes(b.interpreted_as)) {
    return { ok: false, status: 400, error: "Interpretasi tidak dikenal." };
  }

  return { ok: true, status: 200, aksi: "kata-kunci", id, interpretedAs: b.interpreted_as };
}

module.exports = {
  AKSI_PERMINTAAN_VALID,
  INTERPRETASI_VALID,
  JENIS_DRAFT_VALID,
  AKSI_DRAFT_VALID,
  KONDISI_VALID,
  MAKS_QTY,
  validasiAksiPermintaan,
  validasiAksiAdmin,
  validasiTargetAkses,
  validasiTambahProduk,
  validasiKonfirmasiDraft,
  validasiSetGudangUser,
  validasiSetJabatan,
  validasiTanggal,
  bolehSesuaikanTanggal,
};
