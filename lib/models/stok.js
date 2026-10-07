// lib/models/stok.js
// CRUD untuk koleksi `stock` — stok fisik gudang online, live & terpisah dari master produk.
const { db } = require("../firebase");
const {
  GUDANG_ONLINE,
  normalisasiQtyPerGudang,
  bacaParitasOnline: _bacaParitasOnline,
  payloadQtyGudang,
} = require("./stokGudang");
const KOLEKSI = "stock";

// Re-export agar konsumen (permintaanGudang.js, test) punya SATU sumber kebenaran paritas.
const bacaParitasOnline = _bacaParitasOnline;

// Cache pendek utk cariStokDiBawahReorderPoint() — Firestore gak bisa query
// "field A < field B" langsung (stok_gudang_online < reorder_point), jadi mau gak mau
// full scan koleksi lalu filter di memory. Ini dipanggil oleh Gemini tool "cekReorderPoint"
// (bisa dipicu tiap chat) DAN tiap kali stok berubah (_ubahStokRelatif → cekDanNotifikasiReorderPoint),
// jadi tanpa cache ini gampang jadi sumber baca berulang juga. TTL pendek karena stok
// memang sering berubah dan reorder check harus cukup fresh.
const CACHE_TTL_MS = 60 * 1000; // 1 menit
let _cacheStok = { semua: null, timestamp: 0 };

function invalidasiCacheStok() {
  _cacheStok = { semua: null, timestamp: 0 };
}

async function ambilStok(kodeBarang) {
  const doc = await db.collection(KOLEKSI).doc(kodeBarang).get();
  if (!doc.exists) return null;
  const data = doc.data();
  // Boundary baca: pastikan qty_per_gudang selalu ada (fallback dokumen lama) supaya
  // konsumen tidak perlu tahu soal migrasi (docs/learnings.md:5-7).
  return { kode_barang: doc.id, ...data, qty_per_gudang: normalisasiQtyPerGudang(data) };
}
async function buatStokAwal(kodeBarang, stokAwal, { userId, reorderPoint = null } = {}) {
  const payload = {
    stok_gudang_online: stokAwal,
    qty_per_gudang: { [GUDANG_ONLINE]: stokAwal },
    reorder_point: reorderPoint,
    last_updated: new Date(),
    last_updated_by: userId || null,
    last_synced_at: null,
    last_synced_value: null,
  };
  await db.collection(KOLEKSI).doc(kodeBarang).set(payload, { merge: true });
  invalidasiCacheStok();
  try {
    const { cekDanNotifikasiReorderPoint } = require("../reminder/cekReorderPoint");
    await cekDanNotifikasiReorderPoint(kodeBarang);
  } catch (error) {
    console.error(`Gagal cek reorder point utk ${kodeBarang}:`, error);
  }
  return ambilStok(kodeBarang);
}
// Kurangi stok (misal karena keluar_resi). qty harus positif, dikurangi dari nilai sekarang.
async function kurangiStok(kodeBarang, qty, userId) {
  return _ubahStokRelatif(kodeBarang, -Math.abs(qty), userId);
}
// Tambah stok (misal restock dari gudang sebelah, atau koreksi manual positif).
async function tambahStok(kodeBarang, qty, userId) {
  return _ubahStokRelatif(kodeBarang, Math.abs(qty), userId);
}
async function _ubahStokRelatif(kodeBarang, deltaQty, userId) {
  const ref = db.collection(KOLEKSI).doc(kodeBarang);
  const stokBaru = await db.runTransaction(async (trx) => {
    const doc = await trx.get(ref);
    const dataLama = doc.exists ? doc.data() : {};
    // Basis = paritas online (key "ONLINE" di map, fallback stok_gudang_online).
    const stokSekarang = doc.exists ? _bacaParitasOnline(dataLama) : 0;
    const nilaiBaru = stokSekarang + deltaQty;
    trx.set(
      ref,
      {
        ...payloadQtyGudang(dataLama, GUDANG_ONLINE, nilaiBaru),
        last_updated: new Date(),
        last_updated_by: userId || null,
      },
      { merge: true }
    );
    return nilaiBaru;
  });
  invalidasiCacheStok();

  // Batch 8 wiring: cek reorder point tiap kali stok berubah (bagian 4D, reaktif).
  // require() ditaruh di sini (bukan top-level) sengaja — cekReorderPoint.js kemungkinan
  // butuh ambilStok() dari file ini juga, taruh di top-level berisiko circular require.
  // Dibungkus try/catch: gagal kirim notif reorder JANGAN sampai bikin update stok gagal.
  // Untuk "silent error" yang lama (notif reorder hilang diam-diam), coba 1x tambahan
  // retry internal di dalam cekReorderPoint sebelum dianggap gagal — diskusikan lebih
  // lanjut kalau butuh kedalaman retry di atas itu.
  try {
    const { cekDanNotifikasiReorderPoint } = require("../reminder/cekReorderPoint");
    await cekDanNotifikasiReorderPoint(kodeBarang);
  } catch (error) {
    console.error(`Gagal cek reorder point utk ${kodeBarang}:`, error);
  }

  return stokBaru;
}
async function timpaStokOpname(kodeBarang, qtyFisikBaru, userId, gudangId = GUDANG_ONLINE) {
  const ref = db.collection(KOLEKSI).doc(kodeBarang);
  const doc = await ref.get();
  const dataLama = doc.exists ? doc.data() : {};
  await ref.set(
    {
      ...payloadQtyGudang(dataLama, gudangId, qtyFisikBaru),
      last_updated: new Date(),
      last_updated_by: userId || null,
    },
    { merge: true }
  );
  invalidasiCacheStok();
  try {
    const { cekDanNotifikasiReorderPoint } = require("../reminder/cekReorderPoint");
    await cekDanNotifikasiReorderPoint(kodeBarang);
  } catch (error) {
    console.error(`Gagal cek reorder point utk ${kodeBarang}:`, error);
  }
  return ambilStok(kodeBarang);
}
// Dipanggil setelah proses sync Sheets<->Firestore disepakati (alur F di dokumen).
// Perubahan nilai ke Firestore di sini = perubahan data stok → Wajib invalidasi cache
// supaya pemanggil berikutnya (reminder/cariStokDiBawahReorderPoint) tidak baca data basi.
async function tandaiTersinkron(kodeBarang, nilaiYangDisepakati) {
  await db.collection(KOLEKSI).doc(kodeBarang).set(
    {
      last_synced_at: new Date(),
      last_synced_value: nilaiYangDisepakati,
    },
    { merge: true }
  );
  invalidasiCacheStok();
  return ambilStok(kodeBarang);
}
// Ambil SEMUA dokumen koleksi `stock` lewat cache singkat di atas — dipakai baik oleh
// cariStokDiBawahReorderPoint() maupun listProdukOnlineBesertaStok() (Gemini tool) supaya
// dua-duanya numpang 1 full-scan/cache yang sama, bukan query terpisah-pisah.
async function _ambilSemuaStokDenganCache() {
  if (_cacheStok.semua !== null && Date.now() - _cacheStok.timestamp < CACHE_TTL_MS) {
    return _cacheStok.semua;
  }
  const snapshot = await db.collection(KOLEKSI).get();
  const semua = snapshot.docs.map((doc) => ({ kode_barang: doc.id, ...doc.data() }));
  _cacheStok = { semua, timestamp: Date.now() };
  return semua;
}

// Cek item-item yang stoknya di bawah reorder_point (dipakai reminder reaktif, bagian 4D).
async function cariStokDiBawahReorderPoint() {
  const semua = await _ambilSemuaStokDenganCache();
  return semua.filter(
    (data) =>
      data.reorder_point != null &&
      data.stok_gudang_online != null &&
      data.stok_gudang_online < data.reorder_point
  );
}

// Ambil semua stok sbg Map<kode_barang, data> — dipakai listProdukOnlineBesertaStok()
// (Gemini tool) buat join di memory dgn daftar produk online, tanpa query per-produk.
async function ambilSemuaStokSebagaiMap() {
  const semua = await _ambilSemuaStokDenganCache();
  return new Map(semua.map((s) => [s.kode_barang, s]));
}

/**
 * setQtyGudang(kodeBarang, gudangId, qty, oleh) -> { qty_per_gudang } | null
 * Set nilai ABSOLUT satu gudang. Dokumen tidak ada -> null (route balas 404, jangan buat baru).
 * Bila gudangId === "ONLINE": tulis juga stok_gudang_online DALAM TRANSAKSI SAMA (BR3).
 */
async function setQtyGudang(kodeBarang, gudangId, qty, oleh) {
  const ref = db.collection(KOLEKSI).doc(kodeBarang);
  const hasil = await db.runTransaction(async (trx) => {
    const doc = await trx.get(ref);
    if (!doc.exists) return null;
    const mapBaru = payloadQtyGudang(doc.data(), gudangId, qty);
    trx.set(
      ref,
      { ...mapBaru, last_updated: new Date(), last_updated_by: oleh || null },
      { merge: true }
    );
    return mapBaru.qty_per_gudang;
  });
  if (hasil) invalidasiCacheStok();
  return hasil;
}

/**
 * mutasiStokGudang(kodeBarang, dariGudangId, keGudangId, qty, oleh) -> { ok:true, qty_per_gudang } | { ok:false, status, error }
 * Pindah qty antar dua gudang dalam SATU transaksi (total kekal, anti race).
 * Validasi stok cukup DI DALAM transaksi; satu `trx.set` dengan map utuh.
 * Paritas `stok_gudang_online` diselaraskan bila dari/ke = ONLINE.
 */
async function mutasiStokGudang(kodeBarang, dariGudangId, keGudangId, qty, oleh) {
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) {
    return { ok: false, status: 400, error: "Jumlah harus bilangan bulat >= 1." };
  }
  if (dariGudangId === keGudangId) {
    return { ok: false, status: 400, error: "Gudang asal dan tujuan tidak boleh sama." };
  }
  const ref = db.collection(KOLEKSI).doc(kodeBarang);
  const hasil = await db.runTransaction(async (trx) => {
    const doc = await trx.get(ref);
    if (!doc.exists) {
      return { ok: false, status: 404, error: "Stok produk tidak ditemukan." };
    }
    const dataLama = doc.data();
    const map = normalisasiQtyPerGudang(dataLama);
    if ((map[dariGudangId] ?? 0) < qty) {
      return { ok: false, status: 409, error: "Stok gudang asal tidak cukup." };
    }
    map[dariGudangId] = (map[dariGudangId] ?? 0) - qty;
    map[keGudangId] = (map[keGudangId] ?? 0) + qty;
    const payload = { qty_per_gudang: map };
    // Paritas BR3: bila salah satu gudang ONLINE, selaraskan stok_gudang_online.
    if (dariGudangId === GUDANG_ONLINE || keGudangId === GUDANG_ONLINE) {
      payload.stok_gudang_online = map[GUDANG_ONLINE] ?? 0;
    }
    trx.set(
      ref,
      { ...payload, last_updated: new Date(), last_updated_by: oleh || null },
      { merge: true }
    );
    return { ok: true, qty_per_gudang: map };
  });
  if (hasil && hasil.ok) invalidasiCacheStok();
  return hasil;
}

// Set reorder point (F2). PENTING: cek keberadaan dokumen dulu — JANGAN pakai
// set merge buta, karena itu MEMBUAT dokumen stok baru utk produk yg belum punya
// (langgar spec E13). Dokumen tidak ada -> return null (route akan balas 404).
async function setReorderPoint(kodeBarang, nilai, oleh) {
  const ada = await ambilStok(kodeBarang);
  if (!ada) return null;

  await db.collection(KOLEKSI).doc(kodeBarang).set(
    {
      reorder_point: nilai,
      last_updated: new Date(),
      last_updated_by: oleh || null,
    },
    { merge: true }
  );
  invalidasiCacheStok();

  // Notif gagal kirim JANGAN sampai bikin update reorder point gagal.
  let notifikasi = false;
  try {
    const { cekDanNotifikasiReorderPoint } = require("../reminder/cekReorderPoint");
    notifikasi = await cekDanNotifikasiReorderPoint(kodeBarang);
  } catch (error) {
    console.error("[reorder_notif_failed]", error);
  }

  return { stok: await ambilStok(kodeBarang), notifikasi };
}

module.exports = {
  ambilStok,
  buatStokAwal,
  kurangiStok,
  tambahStok,
  timpaStokOpname,
  setQtyGudang,
  mutasiStokGudang,
  setReorderPoint,
  tandaiTersinkron,
  cariStokDiBawahReorderPoint,
  ambilSemuaStokSebagaiMap,
  invalidasiCacheStok,
  // Paritas per gudang (v5) - re-export dari stokGudang.js (satu sumber kebenaran).
  GUDANG_ONLINE,
  normalisasiQtyPerGudang,
  bacaParitasOnline,
  payloadQtyGudang,
};
