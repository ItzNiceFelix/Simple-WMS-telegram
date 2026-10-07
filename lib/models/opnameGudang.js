// lib/models/opnameGudang.js
// Model untuk koleksi `opname_gudang` (v5, F7): stok opname per gudang dengan approval owner.
//
// Alur (prd-v5.md F7):
// - `buatOpname`: server hitung `qty_sistem = qty_per_gudang[gudang_id] ?? null` dan
//   `selisih = qty_fisik - qty_sistem`. Semua selisih 0 -> langsung `disetujui`.
//   Ada selisih != 0 -> `menunggu_approval` (qty TIDAK berubah).
// - `setujuiOpname` (owner): CAS T9 - bandingkan `qty_sistem` tersimpan vs nilai sistem saat ini
//   di dalam transaksi. Beda -> 409 tanpa menulis apa pun.
// - `tolakOpname` (owner): status `ditolak`, qty TIDAK berubah.
//
// Paritas per gudang (BR3) memakai helper lib/models/stokGudang.js supaya key "ONLINE" tetap
// tercermin ke `stok_gudang_online`. JANGAN duplikasi logika paritas di sini.

const { db } = require("../firebase");
const { normalisasiQtyPerGudang, payloadQtyGudang } = require("./stokGudang");
const { isSuperAdmin } = require("./admins");
const { ambilGudang } = require("./gudang");
const { ambilProdukByKode } = require("./produk");
const { invalidasiCacheStok } = require("./stok");
const { catatPergerakanStok } = require("./stockMovements");
const { KOLEKSI: GUARD_KOLEKSI, kunciGuard, guardAktif, tulisGuard } = require("../dashboard/guardV5");

const KOLEKSI = "opname_gudang";
const KOLEKSI_STOCK = "stock";

/** Sentinel error internal transaksi; dipetakan ke respons bisnis oleh caller. */
class KesalahanBisnis extends Error {
  constructor(status, pesan) {
    super(pesan);
    this.status = status;
    this.pesan = pesan;
  }
}

/** Cek item duplikat `kode_barang` dalam satu opname. */
function adaDuplikat(items) {
  const terlihat = new Set();
  for (const item of items) {
    if (terlihat.has(item.kode_barang)) return true;
    terlihat.add(item.kode_barang);
  }
  return false;
}

/**
 * Validasi bentuk `items`. Mengembalikan `{ok:true, items:[{kode_barang, qty_fisik}]}`
 * atau `{ok:false, status, error}`. Error bisnis, bukan throw.
 */
function validasiItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, error: "Opname belum berisi item." };
  }
  const bersih = [];
  for (const item of items) {
    const kode_barang = item && typeof item.kode_barang === "string" ? item.kode_barang.trim() : "";
    if (!kode_barang) return { ok: false, status: 400, error: "Kode barang wajib diisi." };
    if (typeof item.qty_fisik !== "number" || !Number.isInteger(item.qty_fisik) || item.qty_fisik < 0) {
      return { ok: false, status: 400, error: "Jumlah fisik harus bilangan bulat >= 0." };
    }
    bersih.push({ kode_barang, qty_fisik: item.qty_fisik });
  }
  if (adaDuplikat(bersih)) {
    return { ok: false, status: 400, error: "Item duplikat dalam opname." };
  }
  return { ok: true, items: bersih };
}

/** Ambil satu dokumen opname beserta id-nya, atau null. */
async function ambilOpname(id) {
  if (id === null || id === undefined) return null;
  const doc = await db.collection(KOLEKSI).doc(String(id)).get();
  if (!doc.exists) return null;
  return { opname_id: doc.id, ...doc.data() };
}

/**
 * listOpname({status, gudang_id, limit}) -> array dokumen.
 * Filter dilakukan di query bila memungkinkan; urutan `created_at` desc.
 */
async function listOpname({ status, gudang_id, limit } = {}) {
  const snapshot = await db.collection(KOLEKSI).get();
  let daftar = snapshot.docs.map((doc) => ({ opname_id: doc.id, ...doc.data() }));
  if (status) daftar = daftar.filter((o) => o.status === status);
  if (gudang_id) daftar = daftar.filter((o) => o.gudang_id === String(gudang_id));
  daftar.sort((a, b) => waktuMs(b.created_at) - waktuMs(a.created_at));
  const maks = Number.isInteger(limit) && limit > 0 ? limit : 50;
  return daftar.slice(0, maks);
}

/** Timestamp/Date/string -> millis; tak terbaca -> 0 (urutan stabil). */
function waktuMs(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

/**
 * buatOpname({gudang_id, items, oleh}) -> {ok, opname, status, langsung?} | {ok:false,...}
 *
 * `qty_sistem`, `selisih`, dan `belum_terdaftar` DIHITUNG SERVER, bukan diterima dari client.
 * Item tanpa dokumen `stock` -> 404. `gudang_id` tidak ada -> 400.
 */
async function buatOpname({ gudang_id, items, oleh }) {
  if (!gudang_id || typeof gudang_id !== "string") {
    return { ok: false, status: 400, error: "Gudang tidak dikenal." };
  }
  const gudangId = gudang_id.trim();
  const gudang = await ambilGudang(gudangId);
  if (!gudang) return { ok: false, status: 400, error: "Gudang tidak dikenal." };

  const valid = validasiItems(items);
  if (!valid.ok) return valid;

  // Validasi keberadaan dokumen stok SEBELUM transaksi (404 cepat, tanpa tulis apa pun).
  const itemBersih = valid.items;
  const stokAwal = new Map();
  for (const item of itemBersih) {
    const stok = await db.collection(KOLEKSI_STOCK).doc(item.kode_barang).get();
    if (!stok.exists) {
      return { ok: false, status: 404, error: "Stok produk tidak ditemukan." };
    }
    stokAwal.set(item.kode_barang, stok.data() || {});
  }

  // Hitung item hasil (server-side). `belum_terdaftar` = key gudang absen di map.
  const itemHitung = itemBersih.map((item) => {
    const map = normalisasiQtyPerGudang(stokAwal.get(item.kode_barang));
    const terdaftar = Object.prototype.hasOwnProperty.call(map, gudangId);
    const qty_sistem = terdaftar ? map[gudangId] : null;
    const selisih = qty_sistem === null ? 0 : item.qty_fisik - qty_sistem;
    return {
      kode_barang: item.kode_barang,
      qty_sistem,
      qty_fisik: item.qty_fisik,
      selisih,
      belum_terdaftar: !terdaftar,
    };
  });

  const adaSelisih = itemHitung.some((i) => i.selisih !== 0);
  const statusAwal = adaSelisih ? "menunggu_approval" : "disetujui";
  const opnameRef = db.collection(KOLEKSI).doc();
  const waktu = new Date();

  // Transaksi: baca ulang stok lalu tulis opname (+ qty bila langsung disetujui) secara atomic.
  // Memakai runTransaction + CAS gaya F7: qty ditulis hanya lewat payloadQtyGudang (paritas BR3).
  try {
    await db.runTransaction(async (trx) => {
      for (const item of itemHitung) {
        // Hanya jalur "langsung disetujui" yang menulis qty; item `belum_terdaftar` dilewati.
        if (statusAwal !== "disetujui" || item.belum_terdaftar) continue;
        const ref = db.collection(KOLEKSI_STOCK).doc(item.kode_barang);
        const doc = await trx.get(ref);
        if (!doc.exists) throw new KesalahanBisnis(404, "Stok produk tidak ditemukan.");
        const map = normalisasiQtyPerGudang(doc.data());
        // CAS: pastikan qty_sistem masih sama dengan yang dihitung di luar transaksi.
        const kini = Object.prototype.hasOwnProperty.call(map, gudangId) ? map[gudangId] : null;
        if (kini !== item.qty_sistem) {
          throw new KesalahanBisnis(409, "Stok berubah sejak opname dibuat. Buat ulang.");
        }
        trx.set(
          ref,
          {
            ...payloadQtyGudang(doc.data(), gudangId, item.qty_fisik),
            last_updated: new Date(),
            last_updated_by: oleh ? String(oleh) : null,
          },
          { merge: true }
        );
      }

      const payload = {
        gudang_id: gudangId,
        items: itemHitung,
        status: statusAwal,
        created_at: waktu,
        created_by: oleh ? String(oleh) : null,
        catatan: null,
        riwayat_status: [
          { status: statusAwal, oleh: oleh ? String(oleh) : null, at: waktu },
        ],
      };
      if (statusAwal === "disetujui") {
        payload.disetujui_oleh = null;
        payload.disetujui_at = waktu;
      }
      trx.set(opnameRef, payload);
    });
  } catch (e) {
    if (e instanceof KesalahanBisnis) {
      return { ok: false, status: e.status, error: e.pesan };
    }
    throw e;
  }

  invalidasiCacheStok();

  // Audit hanya untuk opname yang langsung disetujui (yang butuh approval dicatat saat setujui).
  if (statusAwal === "disetujui") {
    await _catatMovements(itemHitung, gudangId, oleh);
  }

  const opname = await ambilOpname(opnameRef.id);
  return { ok: true, opname, status: statusAwal, langsung: statusAwal === "disetujui" };
}

/**
 * setujuiOpname(id, oleh) -> {ok, opname} | {ok:false, status, error}
 * OWNER ONLY. CAS T9: semua `qty_sistem` tersimpan harus sama dengan nilai sistem saat ini.
 */
async function setujuiOpname(id, oleh) {
  if (!id) return { ok: false, status: 404, error: "Opname tidak ditemukan." };
  if (!(await isSuperAdmin(oleh))) {
    return { ok: false, status: 403, error: "Hanya owner yang dapat menyetujui opname." };
  }

  // Guard best-effort: kegagalan guard JANGAN memblokir aksi sah (pengaman utama = CAS).
  // Pembanding menyertakan opname_id -> opname lain oleh owner sama TIDAK dianggap duplikat.
  if (await _guardAktifBestEffort("setujui", oleh, id)) {
    return { ok: false, status: 409, error: "Sedang diproses." };
  }

  const opnameRef = db.collection(KOLEKSI).doc(String(id));
  const waktu = new Date();

  try {
    await db.runTransaction(async (trx) => {
      const doc = await trx.get(opnameRef);
      if (!doc.exists) throw new KesalahanBisnis(404, "Opname tidak ditemukan.");
      const data = doc.data() || {};
      if (data.status !== "menunggu_approval") {
        throw new KesalahanBisnis(409, "Opname sudah diproses.");
      }
      const gudangId = data.gudang_id;
      const items = Array.isArray(data.items) ? data.items : [];

      // Langkah 1 (CAS T9): bandingkan qty_sistem tersimpan vs nilai sistem saat ini.
      for (const item of items) {
        if (item.belum_terdaftar) continue;
        const ref = db.collection(KOLEKSI_STOCK).doc(item.kode_barang);
        const stokDoc = await trx.get(ref);
        const map = stokDoc.exists ? normalisasiQtyPerGudang(stokDoc.data()) : {};
        const kini = Object.prototype.hasOwnProperty.call(map, gudangId) ? map[gudangId] : null;
        if (kini !== item.qty_sistem) {
          throw new KesalahanBisnis(409, "Stok berubah sejak opname dibuat. Buat ulang.");
        }
      }

      // Langkah 2: semua cocok -> tulis qty fisik + status dalam transaksi yang sama.
      for (const item of items) {
        if (item.belum_terdaftar) continue;
        const ref = db.collection(KOLEKSI_STOCK).doc(item.kode_barang);
        const stokDoc = await trx.get(ref);
        if (!stokDoc.exists) throw new KesalahanBisnis(404, "Stok produk tidak ditemukan.");
        trx.set(
          ref,
          {
            ...payloadQtyGudang(stokDoc.data(), gudangId, item.qty_fisik),
            last_updated: new Date(),
            last_updated_by: oleh ? String(oleh) : null,
          },
          { merge: true }
        );
      }

      const riwayat = Array.isArray(data.riwayat_status) ? data.riwayat_status : [];
      trx.set(
        opnameRef,
        {
          status: "disetujui",
          disetujui_oleh: oleh ? String(oleh) : null,
          disetujui_at: waktu,
          riwayat_status: [...riwayat, { status: "disetujui", oleh: oleh ? String(oleh) : null, at: waktu }],
        },
        { merge: true }
      );
    });
  } catch (e) {
    if (e instanceof KesalahanBisnis) {
      return { ok: false, status: e.status, error: e.pesan };
    }
    throw e;
  }

  invalidasiCacheStok();
  await _tulisGuardBestEffort("setujui", oleh, id);

  const opname = await ambilOpname(id);
  await _catatMovements(
    Array.isArray(opname?.items) ? opname.items : [],
    opname?.gudang_id,
    oleh
  );
  return { ok: true, opname };
}

/**
 * tolakOpname(id, oleh) -> {ok, opname} | {ok:false,...}
 * OWNER ONLY. Status -> `ditolak`; `qty_per_gudang` TIDAK berubah.
 */
async function tolakOpname(id, oleh) {
  if (!id) return { ok: false, status: 404, error: "Opname tidak ditemukan." };
  if (!(await isSuperAdmin(oleh))) {
    return { ok: false, status: 403, error: "Hanya owner yang dapat menyetujui opname." };
  }

  if (await _guardAktifBestEffort("tolak", oleh, id)) {
    return { ok: false, status: 409, error: "Sedang diproses." };
  }

  const opnameRef = db.collection(KOLEKSI).doc(String(id));
  const waktu = new Date();

  try {
    await db.runTransaction(async (trx) => {
      const doc = await trx.get(opnameRef);
      if (!doc.exists) throw new KesalahanBisnis(404, "Opname tidak ditemukan.");
      const data = doc.data() || {};
      if (data.status !== "menunggu_approval") {
        throw new KesalahanBisnis(409, "Opname sudah diproses.");
      }
      const riwayat = Array.isArray(data.riwayat_status) ? data.riwayat_status : [];
      trx.set(
        opnameRef,
        {
          status: "ditolak",
          ditolak_oleh: oleh ? String(oleh) : null,
          ditolak_at: waktu,
          riwayat_status: [...riwayat, { status: "ditolak", oleh: oleh ? String(oleh) : null, at: waktu }],
        },
        { merge: true }
      );
    });
  } catch (e) {
    if (e instanceof KesalahanBisnis) {
      return { ok: false, status: e.status, error: e.pesan };
    }
    throw e;
  }

  await _tulisGuardBestEffort("tolak", oleh, id);
  return { ok: true, opname: await ambilOpname(id) };
}

// ---------------------------------------------------------------- helper internal

/** Tulis satu `stock_movements` per item opname yang disetujui. Gagal audit tidak melempar. */
async function _catatMovements(items, gudangId, oleh) {
  for (const item of items) {
    try {
      const produk = await ambilProdukByKode(item.kode_barang);
      await catatPergerakanStok({
        kode_barang: item.kode_barang,
        nama_terbaca: produk?.nama_accurate || item.kode_barang,
        variasi: "-",
        qty: item.selisih,
        type: "opname",
        qty_sistem: item.qty_sistem,
        qty_fisik: item.qty_fisik,
        selisih: item.selisih,
        action_type: "opname_gudang",
        source: "dashboard",
        status: "processed",
        gudang_id: gudangId,
        created_by: oleh ? String(oleh) : null,
        confirmed_by: oleh ? String(oleh) : null,
      });
    } catch (e) {
      console.error("[opname_movement_failed]", JSON.stringify({ kode: item.kode_barang, pesan: String(e) }));
    }
  }
}

/**
 * Guard best-effort: error I/O -> anggap tidak aktif (jangan blokir aksi sah).
 * Dokumen guard per owner (`opname_gudang_guard/{uid}`), pembanding `{aksi, opname_id}`
 * (bagian 6.4 PRD) sehingga dua opname berbeda tidak saling memblokir.
 */
async function _guardAktifBestEffort(aksi, uid, opnameId) {
  try {
    const kunci = kunciGuard(aksi, uid);
    return await guardAktif(db, GUARD_KOLEKSI.opname, kunci, { aksi, opname_id: String(opnameId) });
  } catch (e) {
    console.error("[opname_guard_read_failed]", JSON.stringify({ aksi, pesan: String(e) }));
    return false;
  }
}

async function _tulisGuardBestEffort(aksi, uid, opnameId) {
  try {
    const kunci = kunciGuard(aksi, uid);
    await tulisGuard(db, GUARD_KOLEKSI.opname, kunci, { opname_id: String(opnameId), aksi });
  } catch (e) {
    console.error("[opname_guard_write_failed]", JSON.stringify({ aksi, pesan: String(e) }));
  }
}

module.exports = {
  ambilOpname,
  listOpname,
  buatOpname,
  setujuiOpname,
  tolakOpname,
};
