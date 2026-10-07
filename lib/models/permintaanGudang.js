// lib/models/permintaanGudang.js
// Model koleksi `permintaan_gudang` (v5.1): permintaan antar-gudang satu dokumen dengan banyak
// `tujuan[]`. Setiap entri punya status SENDIRI (R2) DAN siklus setujui/kirim SENDIRI
// (`status_kirim`, Q1). Stok asal turun PER TUJUAN saat `kirim` tujuan itu (P7); stok gudang
// tujuan naik saat `terima` tujuan itu, dan kembali ke asal saat `tidak-terima`.
//
// Aturan implementasi:
// - Semua tulis stok lewat lib/models/stokGudang.js (paritas qty_per_gudang <-> stok_gudang_online).
// - Semua aksi pengubah stok memakai db.runTransaction (CAS pada dokumen permintaan + status entri).
// - Error bisnis TIDAK throw; dikembalikan sebagai { ok:false, status, error }.
// - Audit stok (catatPergerakanStok) dilakukan SETELAH commit; gagal audit tidak rollback,
//   hanya menandai `peringatan_audit: true` (BR10).
//
// Referensi: docs/prd-v5.md F5, docs/architecture-v5.md bagian 5.

const { db } = require("../firebase");
const { ambilAdmin } = require("./admins");
const { ambilGudang, ambilGudangAktif } = require("./gudang");
const { catatPergerakanStok } = require("./stockMovements");
const { normalisasiQtyPerGudang, payloadQtyGudang } = require("./stokGudang");

const KOLEKSI = "permintaan_gudang";

/** Batas tujuan & item per dokumen (F5.3, BR16, architecture-v5.md:388-397). */
const MAKS_TUJUAN = 20;
const MAKS_ITEM = 200;
/** Batas panjang catatan_alasan tutup-tujuan (F5.3). */
const MAKS_ALASAN = 200;

/** Status entri tujuan yang dianggap FINAL (tidak bisa diproses lagi) - v5.1 (P6). */
const STATUS_TUJUAN_FINAL = ["diterima", "tidak_terima", "ditolak", "ditutup"];

const PESAN_TUJUAN_BUKAN_MENUNGGU = {
  diterima: "Tujuan ini sudah diterima.",
  tidak_terima: "Tujuan ini sudah tidak diterima.",
  ditolak: "Tujuan ini sudah ditolak.",
  ditutup: "Tujuan ini sudah ditutup.",
};

// ---------------------------------------------------------------------------
// Helper murni (diekspor untuk test)
// ---------------------------------------------------------------------------

/**
 * hitungStatusDokumen(tujuan) -> "menunggu" | "disetujui" | "dikirim" | "selesai" | "ditolak".
 *
 * Status dokumen TURUNAN dari (status_kirim, status) tiap tujuan. Urutan evaluasi:
 * 1. Semua `status_kirim === "menunggu"` -> "menunggu".
 * 2. Ada `status_kirim === "menunggu"` (sisanya sudah maju) -> "disetujui" (sebagian disetujui).
 * 3. Ada `status` tujuan `"ditolak"` DAN semua tujuan `status_kirim === "dikirim"` -> "ditolak" (P1).
 * 4. Semua `status_kirim === "dikirim"` -> "dikirim" (termasuk saat semua tujuan sudah
 *    final - `selesai` menunggu aksi eksplisit pembuat, P6).
 * 5. Sisanya (semua sudah lolos "menunggu", tidak ada yang dikirim) -> "disetujui".
 *
 * `ditolak`/`dibatalkan` level DOKUMEN tetap di-set eksplisit oleh aksinya (bukan turunan).
 */
function hitungStatusDokumen(tujuan) {
  const daftar = Array.isArray(tujuan) ? tujuan : [];
  if (daftar.length === 0) return "menunggu";

  const semuaMenunggu = daftar.every((t) => t && t.status_kirim === "menunggu");
  if (semuaMenunggu) return "menunggu";

  if (daftar.some((t) => !t || t.status_kirim === "menunggu")) return "disetujui";

  // Sejak sini tidak ada lagi status_kirim "menunggu".
  const daftarDikirim = daftar.filter((t) => t.status_kirim === "dikirim");
  const semuaDikirim = daftarDikirim.length === daftar.length;

  if (semuaDikirim) {
    if (daftar.some((t) => t.status === "ditolak")) return "ditolak";
    // P6: `selesai` adalah AKSI EKSPLISIT pembuat (selesaiPermintaan), bukan turunan.
    // Bila semua tujuan sudah final, dokumen tetap `dikirim` sampai pembuat menekan Selesai.
    return "dikirim";
  }

  // Semua `status_kirim` sudah disetujui (tidak ada menunggu, tidak semua dikirim).
  return "disetujui";
}

/** Total qty satu daftar item. */
function totalQtyItem(items) {
  return (Array.isArray(items) ? items : []).reduce((total, item) => total + angkaAman(item && item.qty), 0);
}

/** Total qty item satu entri tujuan; fallback ke items dokumen bila entri tak punya items (dokumen lama). */
function totalQtyTujuan(entri, itemsDokumen = null) {
  const items = entri && Array.isArray(entri.items) && entri.items.length > 0 ? entri.items : itemsDokumen;
  return totalQtyItem(items);
}

/** angka -> number terbatas; bukan angka -> 0. */
function angkaAman(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Ambil entri tujuan ke-k dari array; indeks di luar array -> null (409 "Tujuan tidak ditemukan."). */
function cariTujuan(tujuan, indeks) {
  const daftar = Array.isArray(tujuan) ? tujuan : [];
  const k = Number(indeks);
  if (!Number.isInteger(k) || k < 0 || k >= daftar.length) return null;
  return { k, entri: daftar[k] };
}

/** Field waktu = Timestamp (Date) - field waktu v5 selalu `created_at`/`updated_at` (BR12). */
function sekarang() {
  return new Date();
}

/** Ambil nilai satu gudang dari dokumen `stock` (boundary baca: normalisasi dulu). */
function qtyGudang(dataStok, gudangId) {
  return normalisasiQtyPerGudang(dataStok)[gudangId] ?? 0;
}

/** Payload tulis stok untuk satu gudang: selalu lewat helper paritas stokGudang.js. */
function payloadStok(dataLama, gudangId, nilaiBaru, oleh) {
  return {
    ...payloadQtyGudang(dataLama, gudangId, nilaiBaru),
    last_updated: sekarang(),
    last_updated_by: oleh ? String(oleh) : null,
  };
}

/** Riwayat status: append-only {status, oleh, at}. */
function tambahRiwayat(riwayat, status, oleh) {
  return [...(Array.isArray(riwayat) ? riwayat : []), { status, oleh: oleh ? String(oleh) : null, at: sekarang() }];
}

/** Semua kode_barang unik dari items[]. */
function kodeBarangUnik(items) {
  const set = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (item && item.kode_barang) set.add(String(item.kode_barang));
  }
  return [...set];
}

/** Items efektif satu entri tujuan; fallback ke items dokumen (kompatibilitas dokumen lama). */
function itemsEfektif(entri, itemsDokumen) {
  if (entri && Array.isArray(entri.items) && entri.items.length > 0) return entri.items;
  return Array.isArray(itemsDokumen) ? itemsDokumen : [];
}

// ---------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------

/** ambilPermintaan(id) -> {permintaan_id, ...data} | null */
async function ambilPermintaan(id) {
  if (id === null || id === undefined) return null;
  const doc = await db.collection(KOLEKSI).doc(String(id)).get();
  if (!doc.exists) return null;
  return { permintaan_id: doc.id, ...doc.data() };
}

/**
 * listPermintaan({status, dari_gudang_id, created_by, tujuan_id, limit}) -> array dokumen.
 * `tujuan_id` (mis. "gudang:G1") difilter lewat array-contains `tujuan_ids`.
 */
async function listPermintaan({ status = null, dari_gudang_id = null, created_by = null, tujuan_id = null, limit = null } = {}) {
  let query = db.collection(KOLEKSI);
  if (status) query = query.where("status", "==", status);
  if (dari_gudang_id) query = query.where("dari_gudang_id", "==", dari_gudang_id);
  if (created_by) query = query.where("created_by", "==", String(created_by));
  if (tujuan_id) query = query.where("tujuan_ids", "array-contains", String(tujuan_id));
  if (typeof limit === "number" && limit > 0) query = query.limit(limit);
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ permintaan_id: doc.id, ...doc.data() }));
}

// ---------------------------------------------------------------------------
// Buat & ubah item
// ---------------------------------------------------------------------------

/**
 * Normalisasi tujuan mentah dari body -> entri snapshot lengkap (F6, v5.1).
 * Hanya menerima `tipe === "gudang"`. `user_penerima_id` opsional (harus admin dari gudang tujuan).
 * `items` opsional per tujuan; bila kosong, entri.items diisi `itemsDokumen`.
 * Mengembalikan { ok:true, tujuan } atau { ok:false, status, error }.
 */
async function _siapkanTujuan(tujuanMentah, dariGudangId, itemsDokumen = []) {
  const daftar = Array.isArray(tujuanMentah) ? tujuanMentah : [];
  if (daftar.length === 0) return { ok: false, status: 400, error: "Pilih minimal satu tujuan." };
  if (daftar.length > MAKS_TUJUAN) return { ok: false, status: 400, error: "Maksimal 20 tujuan." };

  const terlihat = new Set();
  const hasil = [];
  for (const mentah of daftar) {
    const tipe = mentah && mentah.tipe;
    const id = mentah && mentah.id !== undefined && mentah.id !== null ? String(mentah.id) : "";
    if (tipe !== "gudang") {
      // v5.1: tujuan user dihapus; tipe tidak dikenal / "user" -> pesan seragam.
      return { ok: false, status: 400, error: "Tujuan hanya boleh gudang." };
    }
    if (!id) return { ok: false, status: 400, error: "Tujuan hanya boleh gudang." };

    // Dedup `tipe:id` -> satu entri (F6).
    const kunci = `${tipe}:${id}`;
    if (terlihat.has(kunci)) continue;
    terlihat.add(kunci);

    const gudang = await ambilGudangAktif(id);
    if (!gudang) return { ok: false, status: 400, error: "Gudang tujuan tidak dikenal." };
    if (String(id) === String(dariGudangId)) {
      return { ok: false, status: 400, error: "Gudang asal tidak boleh jadi tujuan." };
    }

    // Penerima opsional (Q2); bila diisi HARUS admin dari gudang tujuan (Q3).
    let penerimaId = null;
    let penerimaNama = null;
    const mentahPenerima = mentah && mentah.user_penerima_id;
    if (mentahPenerima !== undefined && mentahPenerima !== null && String(mentahPenerima).trim() !== "") {
      penerimaId = String(mentahPenerima);
      const admin = await ambilAdmin(penerimaId);
      if (!admin || String(admin.gudang_id ?? "") !== String(id)) {
        return { ok: false, status: 400, error: "Penerima harus dari gudang tujuan." };
      }
      penerimaNama = admin.name || penerimaId;
    }

    // Items per tujuan (P7); kosong -> items dokumen (perilaku lama).
    const itemsSiap = mentah && mentah.items !== undefined && mentah.items !== null
      ? _siapkanItems(mentah.items, { pesanKosong: "Tujuan belum berisi item." })
      : { ok: true, items: Array.isArray(itemsDokumen) ? itemsDokumen : [] };
    if (!itemsSiap.ok) return itemsSiap;

    hasil.push({
      tipe: "gudang",
      id: String(id),
      nama: gudang.nama || String(id),
      jabatan: null,
      gudang_id_snapshot: String(id),
      status: "menunggu",
      status_kirim: "menunggu",
      user_penerima_id: penerimaId,
      user_penerima_nama: penerimaNama,
      items: itemsSiap.items,
      notifikasi_terkirim: null,
      diterima_at: null,
      diterima_oleh: null,
      tidak_terima_at: null,
      tidak_terima_oleh: null,
      ditolak_at: null,
      ditolak_oleh: null,
      ditutup_at: null,
      ditutup_oleh: null,
      catatan_alasan: null,
    });
  }

  if (hasil.length === 0) return { ok: false, status: 400, error: "Pilih minimal satu tujuan." };
  return { ok: true, tujuan: hasil };
}

/**
 * Normalisasi items[] mentah: validasi range + gabung duplikat `kode_barang` (sum qty,
 * variasi = nilai terakhir) - edge case F5.
 */
function _siapkanItems(itemsMentah, { pesanKosong = "Permintaan belum berisi item." } = {}) {
  const daftar = Array.isArray(itemsMentah) ? itemsMentah : [];
  if (daftar.length === 0) return { ok: false, status: 400, error: pesanKosong };
  if (daftar.length > MAKS_ITEM) return { ok: false, status: 400, error: "Maksimal 200 item." };

  const peta = new Map();
  for (const mentah of daftar) {
    const kode = mentah && mentah.kode_barang ? String(mentah.kode_barang) : "";
    const qty = mentah ? mentah.qty : null;
    if (!kode || !Number.isInteger(qty) || qty < 1) {
      return { ok: false, status: 400, error: "Jumlah item harus bilangan bulat >= 1." };
    }
    const ada = peta.get(kode);
    if (ada) {
      ada.qty += qty;
      if (mentah.variasi !== undefined) ada.variasi = mentah.variasi ?? null;
    } else {
      peta.set(kode, {
        kode_barang: kode,
        nama: mentah.nama ?? null,
        variasi: mentah.variasi ?? null,
        qty,
      });
    }
  }
  const hasil = [...peta.values()];
  if (hasil.length > MAKS_ITEM) return { ok: false, status: 400, error: "Maksimal 200 item." };
  return { ok: true, items: hasil };
}

/**
 * buatPermintaan({dari_gudang_id, tujuan, items, oleh}) -> {ok:true, permintaan} | {ok:false,...}
 * `items` dokumen tetap daftar referensi (kompatibilitas + tampilan). Tiap `tujuan[k].items`
 * diisi dari input tujuan (fallback ke `items` dokumen bila kosong). Bukan transaksi.
 */
async function buatPermintaan({ dari_gudang_id, tujuan, items, oleh }) {
  const dariId = dari_gudang_id !== undefined && dari_gudang_id !== null ? String(dari_gudang_id) : "";
  const gudangAsal = await ambilGudangAktif(dariId);
  if (!gudangAsal) return { ok: false, status: 400, error: "Gudang asal tidak dikenal." };

  const itemsSiap = _siapkanItems(items);
  if (!itemsSiap.ok) return itemsSiap;

  const tujuanSiap = await _siapkanTujuan(tujuan, dariId, itemsSiap.items);
  if (!tujuanSiap.ok) return tujuanSiap;

  // Setiap kode_barang WAJIB ada di `stock` (A2) - jangan buat dokumen baru.
  // Gabungkan kode dari items dokumen + semua items tujuan.
  const kodeList = kodeBarangUnik([...itemsSiap.items, ...tujuanSiap.tujuan.flatMap((t) => t.items)]);
  const stokSnaps = await Promise.all(kodeList.map((kode) => db.collection("stock").doc(kode).get()));
  if (stokSnaps.some((doc) => !doc.exists)) {
    return { ok: false, status: 404, error: "Stok produk tidak ditemukan." };
  }

  const now = sekarang();
  const payload = {
    dari_gudang_id: dariId,
    tujuan: tujuanSiap.tujuan,
    tujuan_ids: tujuanSiap.tujuan.map((t) => `${t.tipe}:${t.id}`),
    items: itemsSiap.items,
    status: "menunggu",
    created_at: now,
    created_by: oleh ? String(oleh) : null,
    catatan: null,
    riwayat_status: [{ status: "menunggu", oleh: oleh ? String(oleh) : null, at: now }],
  };
  const ref = await db.collection(KOLEKSI).add(payload);
  return { ok: true, permintaan: { permintaan_id: ref.id, ...payload } };
}

/**
 * ubahItemPermintaan(id, items, oleh) -> {ok:true, permintaan} | {ok:false,...}
 * HANYA dari status `menunggu` (tabel F5.2). Stok tidak disentuh.
 */
/**
 * catatNotifikasi(id, tujuanIndex, terkirim) - Q7: simpan status kirim notifikasi.
 * tujuanIndex null = notifikasi level dokumen (mis. selesai ke semua penerima).
 * Best-effort: TIDAK throw. Kegagalan hanya di-log.
 */
async function catatNotifikasi(id, tujuanIndex, terkirim) {
  try {
    const ref = db.collection(KOLEKSI).doc(String(id));
    const doc = await ref.get();
    if (!doc.exists) return;
    const data = doc.data() || {};
    const tujuan = Array.isArray(data.tujuan) ? data.tujuan.slice() : [];
    const nilai = terkirim === true;
    if (Number.isInteger(tujuanIndex) && tujuanIndex >= 0 && tujuanIndex < tujuan.length) {
      tujuan[tujuanIndex] = { ...tujuan[tujuanIndex], notifikasi_terkirim: nilai };
    } else {
      // Level dokumen: tandai semua tujuan sekaligus.
      for (let i = 0; i < tujuan.length; i += 1) {
        tujuan[i] = { ...tujuan[i], notifikasi_terkirim: nilai };
      }
    }
    await ref.set({ tujuan }, { merge: true });
  } catch (e) {
    console.error("[notif_catat_failed]", JSON.stringify({ id: String(id), pesan: String(e) }));
  }
}

async function ubahItemPermintaan(id, items, oleh) {
  const itemsSiap = _siapkanItems(items);
  if (!itemsSiap.ok) return itemsSiap;

  const ref = db.collection(KOLEKSI).doc(String(id));
  return db.runTransaction(async (trx) => {
    const doc = await trx.get(ref);
    if (!doc.exists) return { ok: false, status: 404, error: "Permintaan tidak ditemukan." };
    const data = doc.data();
    const terminal = _pesanStatusTerminal(data.status);
    if (terminal) return { ok: false, status: 409, error: terminal };
    if (data.status !== "menunggu") return { ok: false, status: 409, error: "Permintaan sudah diproses." };

    // Kode barang boleh berubah -> pastikan stok ada (A2) sebelum menulis.
    const kodeList = kodeBarangUnik(itemsSiap.items);
    const stokSnaps = await Promise.all(kodeList.map((kode) => trx.get(db.collection("stock").doc(kode))));
    if (stokSnaps.some((s) => !s.exists)) {
      return { ok: false, status: 404, error: "Stok produk tidak ditemukan." };
    }

    // items dokumen berubah -> sinkronkan items tujuan yang belum punya items sendiri
    // (dokumen baru selalu punya; dokumen lama bisa kosong). Tujuan yang sudah punya items
    // dibiarkan (qty per tujuan mungkin sengaja beda, P7).
    const tujuanBaru = (Array.isArray(data.tujuan) ? data.tujuan : []).map((t) => {
      if (Array.isArray(t.items) && t.items.length > 0) return t;
      return { ...t, items: itemsSiap.items };
    });

    const riwayat = tambahRiwayat(data.riwayat_status, "ubah_item", oleh);
    trx.set(ref, { items: itemsSiap.items, tujuan: tujuanBaru, riwayat_status: riwayat }, { merge: true });
    return {
      ok: true,
      permintaan: { permintaan_id: doc.id, ...data, items: itemsSiap.items, tujuan: tujuanBaru, riwayat_status: riwayat },
    };
  });
}

// ---------------------------------------------------------------------------
// Otorisasi tujuan (penerima / owner fallback)
// ---------------------------------------------------------------------------

/** true bila `oleh` cocok dengan penerima tujuan; `penerima` null = owner fallback. */
async function _apakahPenerimaAtauOwner(oleh, entri) {
  const id = oleh !== null && oleh !== undefined ? String(oleh) : "";
  if (entri && entri.user_penerima_id) return id === String(entri.user_penerima_id);
  // Penerima null -> hanya owner (Q2 fallback).
  const admin = await ambilAdmin(id);
  return !!(admin && admin.role === "owner");
}

/** Gate aksi setujui/tolak/kirim tujuan: penerima tujuan atau owner. */
async function _assertPenerimaAtauOwner(oleh, entri) {
  const bolehPenerima = entri && entri.user_penerima_id && String(oleh ?? "") === String(entri.user_penerima_id);
  if (bolehPenerima) return;
  const admin = await ambilAdmin(oleh);
  if (admin && admin.role === "owner") return;
  throw new KesalahanBisnis(403, "Hanya penerima tujuan ini yang dapat menyetujui.");
}

/** Gate Q4: pembuat permintaan ATAU owner. */
async function _assertPembuatAtauOwner(oleh, data) {
  const id = oleh !== null && oleh !== undefined ? String(oleh) : "";
  if (id && data.created_by && id === String(data.created_by)) return;
  const admin = await ambilAdmin(id);
  if (admin && admin.role === "owner") return;
  throw new KesalahanBisnis(403, "Hanya pembuat permintaan yang dapat mengonfirmasi.");
}

// ---------------------------------------------------------------------------
// Setujui / tolak / batal (tanpa perubahan stok)
// ---------------------------------------------------------------------------

/** Pesan 409 untuk status dokumen TERMINAL (tabel F5.2). null bila status masih bisa diproses. */
function _pesanStatusTerminal(status) {
  if (status === "ditolak") return "Permintaan sudah ditolak.";
  if (status === "dibatalkan") return "Permintaan sudah dibatalkan.";
  if (status === "selesai") return "Permintaan sudah selesai.";
  return null;
}

/**
 * setujuiTujuan(id, tujuanIndex, oleh): `status_kirim` tujuan `menunggu` -> `disetujui` (Q1).
 * Gate: penerima tujuan itu; bila penerima null -> owner.
 */
async function setujuiTujuan(id, tujuanIndex, oleh) {
  return _ubahStatusKirimTujuan(id, tujuanIndex, oleh, "disetujui");
}

/**
 * tolakTujuanPermintaan(id, tujuanIndex, oleh): penerima menolak tujuan (P1).
 * `status_kirim` tetap `menunggu`, `status` entri -> `ditolak`.
 */
async function tolakTujuanPermintaan(id, tujuanIndex, oleh) {
  return _ubahStatusKirimTujuan(id, tujuanIndex, oleh, "ditolak");
}

/** Inti setujui/tolak tujuan (CAS entri + recompute dokumen). */
async function _ubahStatusKirimTujuan(id, tujuanIndex, oleh, aksi) {
  const ref = db.collection(KOLEKSI).doc(String(id));

  let hasil;
  try {
    hasil = await db.runTransaction(async (trx) => {
      const doc = await trx.get(ref);
      if (!doc.exists) throw new KesalahanBisnis(404, "Permintaan tidak ditemukan.");
      const data = doc.data();
      const terminal = _pesanStatusTerminal(data.status);
      if (terminal) throw new KesalahanBisnis(409, terminal);

      const cari = cariTujuan(data.tujuan, tujuanIndex);
      if (!cari) throw new KesalahanBisnis(409, "Tujuan tidak ditemukan.");
      if (cari.entri.status_kirim !== "menunggu") {
        throw new KesalahanBisnis(409, aksi === "disetujui" ? "Tujuan ini sudah diproses." : "Tujuan ini sudah diproses.");
      }

      await _assertPenerimaAtauOwner(oleh, cari.entri);

      const now = sekarang();
      const tujuanBaru = data.tujuan.map((t, i) => {
        if (i !== cari.k) return t;
        if (aksi === "disetujui") {
          return { ...t, status_kirim: "disetujui", disetujui_at: now, disetujui_oleh: oleh ? String(oleh) : null };
        }
        return { ...t, status: "ditolak", ditolak_at: now, ditolak_oleh: oleh ? String(oleh) : null };
      });

      const statusBaru = hitungStatusDokumen(tujuanBaru);
      const riwayat = tambahRiwayat(data.riwayat_status, aksi === "disetujui" ? "disetujui" : "ditolak_tujuan", oleh);
      const payload = { tujuan: tujuanBaru, status: statusBaru, riwayat_status: riwayat };
      trx.set(ref, payload, { merge: true });
      return { permintaan: { permintaan_id: doc.id, ...data, ...payload } };
    });
  } catch (e) {
    if (e instanceof KesalahanBisnis) return { ok: false, status: e.status, error: e.pesan };
    return { ok: false, status: 500, error: "Gagal memproses tujuan." };
  }

  const segar = await ambilPermintaan(id);
  return {
    ok: true,
    permintaan: segar || hasil.permintaan,
    status: (segar || hasil.permintaan).status,
    tujuan: (segar || hasil.permintaan).tujuan,
  };
}

/**
 * tolakPermintaan(id, oleh): `menunggu` -> `ditolak` (level DOKUMEN). Hanya boleh bila SEMUA
 * tujuan masih `status_kirim === "menunggu"` (belum ada yang disetujui/dikirim). Stok tidak berubah.
 */
async function tolakPermintaan(id, oleh) {
  // T3: gate otorisasi (admin/owner). Sebelumnya tanpa gate.
  const adminPenolak = await ambilAdmin(oleh);
  if (!adminPenolak || (adminPenolak.role !== "owner" && adminPenolak.role !== "admin")) {
    return { ok: false, status: 403, error: "Akses ditolak. Hubungi owner." };
  }
  const ref = db.collection(KOLEKSI).doc(String(id));
  return db.runTransaction(async (trx) => {
    const doc = await trx.get(ref);
    if (!doc.exists) return { ok: false, status: 404, error: "Permintaan tidak ditemukan." };
    const data = doc.data();
    const terminal = _pesanStatusTerminal(data.status);
    if (terminal) return { ok: false, status: 409, error: terminal };
    if (data.status !== "menunggu") return { ok: false, status: 409, error: "Permintaan sudah diproses." };

    const tujuan = Array.isArray(data.tujuan) ? data.tujuan : [];
    if (tujuan.some((t) => !t || t.status_kirim !== "menunggu")) {
      return { ok: false, status: 409, error: "Permintaan sudah diproses." };
    }

    const now = sekarang();
    const payload = {
      status: "ditolak",
      ditolak_oleh: oleh ? String(oleh) : null,
      ditolak_at: now,
      riwayat_status: tambahRiwayat(data.riwayat_status, "ditolak", oleh),
    };
    trx.set(ref, payload, { merge: true });
    return { ok: true, permintaan: { permintaan_id: doc.id, ...data, ...payload } };
  });
}

/**
 * batalPermintaan(id, oleh): dari `menunggu` ATAU `disetujui` (R1) -> `dibatalkan`.
 * Stok tidak berubah (belum turun). Otorisasi (pembuat atau admin/owner) ditegakkan di route.
 */
async function batalPermintaan(id, oleh) {
  const ref = db.collection(KOLEKSI).doc(String(id));
  return db.runTransaction(async (trx) => {
    const doc = await trx.get(ref);
    if (!doc.exists) return { ok: false, status: 404, error: "Permintaan tidak ditemukan." };
    const data = doc.data();
    const terminal = _pesanStatusTerminal(data.status);
    if (terminal) return { ok: false, status: 409, error: terminal };
    // Tabel F5.2: `dikirim` + batal -> "Permintaan sudah diproses." (bukan 403).
    if (data.status !== "menunggu" && data.status !== "disetujui") {
      return { ok: false, status: 409, error: "Permintaan sudah diproses." };
    }

    const now = sekarang();
    const payload = {
      status: "dibatalkan",
      dibatalkan_oleh: oleh ? String(oleh) : null,
      dibatalkan_at: now,
      riwayat_status: tambahRiwayat(data.riwayat_status, "dibatalkan", oleh),
    };
    trx.set(ref, payload, { merge: true });
    return { ok: true, permintaan: { permintaan_id: doc.id, ...data, ...payload } };
  });
}

// ---------------------------------------------------------------------------
// Kirim (PER TUJUAN; stok asal turun sebesar qty tujuan itu)
// ---------------------------------------------------------------------------

/** Penanda error bisnis di dalam transaksi (dipetakan ke hasil). */
class KesalahanBisnis extends Error {
  constructor(status, pesan) {
    super(pesan);
    this.status = status;
    this.pesan = pesan;
  }
}

/**
 * kirimPermintaan(id, tujuanIndex, oleh) -> {ok:true, permintaan, ...} | {ok:false, status, error}
 * Per TUJUAN (Q1): `status_kirim` tujuan `disetujui` -> `dikirim`; stok asal turun sebesar total
 * qty `tujuan[k].items` (P7). Gate: penerima tujuan itu / owner fallback.
 */
async function kirimPermintaan(id, tujuanIndex, oleh) {
  const ref = db.collection(KOLEKSI).doc(String(id));

  let hasil;
  try {
    hasil = await db.runTransaction(async (trx) => {
      const doc = await trx.get(ref);
      if (!doc.exists) throw new KesalahanBisnis(404, "Permintaan tidak ditemukan.");
      const data = doc.data();
      const terminal = _pesanStatusTerminal(data.status);
      if (terminal) throw new KesalahanBisnis(409, terminal);

      const cari = cariTujuan(data.tujuan, tujuanIndex);
      if (!cari) throw new KesalahanBisnis(409, "Tujuan tidak ditemukan.");
      if (cari.entri.status_kirim === "menunggu") throw new KesalahanBisnis(409, "Permintaan belum disetujui.");
      if (cari.entri.status_kirim === "dikirim") throw new KesalahanBisnis(409, "Permintaan sudah dikirim.");
      if (cari.entri.status_kirim !== "disetujui") throw new KesalahanBisnis(409, "Permintaan belum disetujui.");

      await _assertPenerimaAtauOwner(oleh, cari.entri);

      const dariId = String(data.dari_gudang_id);
      const itemsTujuan = itemsEfektif(cari.entri, data.items);
      const totalQty = totalQtyItem(itemsTujuan);

      // Baca stok per item; cek tiap kode punya cukup qty di gudang asal (BR1, P7).
      const baris = [];
      for (const item of itemsTujuan) {
        const sRef = db.collection("stock").doc(String(item.kode_barang));
        const sDoc = await trx.get(sRef);
        if (!sDoc.exists) throw new KesalahanBisnis(404, "Stok produk tidak ditemukan.");
        const dataLama = sDoc.data();
        const qtyItem = angkaAman(item && item.qty);
        if (qtyGudang(dataLama, dariId) < qtyItem) {
          throw new KesalahanBisnis(409, "Stok gudang asal tidak cukup.");
        }
        baris.push({ sRef, dataLama, qtyBaru: qtyGudang(dataLama, dariId) - qtyItem });
      }

      // Tulis stok asal turun (paritas "ONLINE" ditangani payloadQtyGudang).
      for (const { sRef, dataLama, qtyBaru } of baris) {
        trx.set(sRef, payloadStok(dataLama, dariId, qtyBaru, oleh), { merge: true });
      }

      const now = sekarang();
      const tujuanBaru = data.tujuan.map((t, i) => {
        if (i !== cari.k) return t;
        return { ...t, status_kirim: "dikirim", dikirim_at: now, dikirim_oleh: oleh ? String(oleh) : null };
      });
      const statusBaru = hitungStatusDokumen(tujuanBaru);
      const payload = {
        status: statusBaru,
        tujuan: tujuanBaru,
        riwayat_status: tambahRiwayat(data.riwayat_status, "dikirim", oleh),
      };
      trx.set(ref, payload, { merge: true });
      return {
        permintaan: { permintaan_id: doc.id, ...data, ...payload },
        arah: "keluar",
        totalQty,
        dariId,
        itemsTujuan,
      };
    });
  } catch (e) {
    if (e instanceof KesalahanBisnis) return { ok: false, status: e.status, error: e.pesan };
    return { ok: false, status: 500, error: "Gagal mengirim permintaan." };
  }

  // Audit stok SETELAH commit (BR10: gagal audit tidak rollback).
  const peringatan = await _catatAuditItem({
    items: hasil.itemsTujuan,
    oleh,
    type: "koreksi_manual",
    action_type: "mutasi_gudang",
    gudang_id: hasil.dariId,
  });

  const { arah, totalQty, dariId, itemsTujuan, ...sisa } = hasil;
  const segar = await ambilPermintaan(id);
  return { ok: true, permintaan: segar || sisa.permintaan, peringatan_audit: peringatan };
}

// ---------------------------------------------------------------------------
// Terima / tidak-terima / tutup-tujuan (per entri tujuan)
// ---------------------------------------------------------------------------

/** Pesan 409 status ENTRI tujuan yang bukan `menunggu` (tabel F5.2, V1/V3). */
function _pesanTujuanBukanMenunggu(statusEntri) {
  return PESAN_TUJUAN_BUKAN_MENUNGGU[statusEntri] || "Tujuan ini sudah diproses.";
}

/**
 * terimaPermintaan(id, tujuanIndex, oleh) -> stok gudang tujuan naik (T10, V11).
 * Gate Q4: pembuat permintaan ATAU owner. Hanya bila entri `status_kirim === "dikirim"` DAN
 * `status === "menunggu"`. Qty per tujuan (P7).
 */
async function terimaPermintaan(id, tujuanIndex, oleh) {
  return _ubahTujuan(id, tujuanIndex, oleh, "terima");
}

/** tidakTerimaPermintaan(id, tujuanIndex, oleh) -> stok kembali ke gudang ASAL (R2). Gate Q4. */
async function tidakTerimaPermintaan(id, tujuanIndex, oleh) {
  return _ubahTujuan(id, tujuanIndex, oleh, "tidak_terima");
}

/** tutupTujuanPermintaan(id, tujuanIndex, catatan, oleh) -> OWNER only, stok TIDAK berubah (V4b). */
async function tutupTujuanPermintaan(id, tujuanIndex, catatan, oleh) {
  const alasan = typeof catatan === "string" ? catatan.trim() : "";
  if (!alasan) return { ok: false, status: 400, error: "Alasan wajib diisi." };
  if (alasan.length > MAKS_ALASAN) {
    return { ok: false, status: 400, error: "Alasan maksimal 200 karakter." };
  }

  const admin = await ambilAdmin(oleh);
  if (!admin || admin.role !== "owner") {
    return { ok: false, status: 403, error: "Hanya owner yang dapat menutup tujuan." };
  }

  return _ubahTujuan(id, tujuanIndex, oleh, "tutup", alasan);
}

/**
 * Inti terima/tidak_terima/tutup-tujuan. Satu runTransaction dengan CAS pada status dokumen +
 * status entri tujuan (architecture-v5.md:399-404, 442-497). Stok per tujuan (P7).
 */
async function _ubahTujuan(id, tujuanIndex, oleh, aksi, alasan = null) {
  const ref = db.collection(KOLEKSI).doc(String(id));
  const terima = aksi === "terima";
  const ditutup = aksi === "tutup";

  let hasil;
  try {
    hasil = await db.runTransaction(async (trx) => {
      const doc = await trx.get(ref);
      if (!doc.exists) throw new KesalahanBisnis(404, "Permintaan tidak ditemukan.");
      const data = doc.data();

      // Precedence (PRD F5.2 baris 221): legalitas terima/tidak-terima/tutup-tujuan SELALU
      // ditentukan status ENTRI tujuan[k]. Jadi status entri diperiksa LEBIH DULU daripada
      // status dokumen, supaya pesan 409 tepat.
      const cari = cariTujuan(data.tujuan, tujuanIndex);
      if (!cari) throw new KesalahanBisnis(409, "Tujuan tidak ditemukan.");

      // Gate Q4 khusus terima/tidak-terima (tutup-tujuan sudah dicek owner di caller).
      if (!ditutup) await _assertPembuatAtauOwner(oleh, data);

      if (cari.entri.status !== "menunggu") {
        throw new KesalahanBisnis(409, _pesanTujuanBukanMenunggu(cari.entri.status));
      }
      // Hanya boleh bila barang sudah dikirim ke tujuan ini.
      if (cari.entri.status_kirim !== "dikirim") {
        throw new KesalahanBisnis(409, "Permintaan belum dikirim.");
      }

      const itemsTujuan = itemsEfektif(cari.entri, data.items);
      const totalQty = totalQtyItem(itemsTujuan);
      const dariId = String(data.dari_gudang_id);
      const snapshot = cari.entri.gudang_id_snapshot;

      // Tentukan gudang yang stoknya berubah (v5.1 semua tujuan gudang).
      let gudangStok = null; // null = stok tidak berubah (tutup-tujuan)
      if (terima) {
        if (snapshot == null) {
          gudangStok = null;
        } else {
          const gudang = await ambilGudangAktif(snapshot);
          if (!gudang) throw new KesalahanBisnis(409, "Gudang tujuan nonaktif.");
          gudangStok = String(snapshot);
        }
      } else if (!ditutup) {
        // tidak-terima: stok kembali ke gudang ASAL (gudang tujuan nonaktif tidak menghalangi).
        gudangStok = dariId;
      }

      // Tulis stok (kecuali tutup-tujuan).
      if (gudangStok) {
        const kodeList = kodeBarangUnik(itemsTujuan);
        for (const kode of kodeList) {
          const sRef = db.collection("stock").doc(kode);
          const sDoc = await trx.get(sRef);
          const dataLama = sDoc.exists ? sDoc.data() : {};
          // terima: gudang tujuan naik; tidak-terima: gudang asal naik (kembali). Dua-duanya +qty item.
          const qtyItem = itemsTujuan
            .filter((it) => String(it.kode_barang) === kode)
            .reduce((tot, it) => tot + angkaAman(it.qty), 0);
          const nilaiBaru = qtyGudang(dataLama, gudangStok) + qtyItem;
          trx.set(sRef, payloadStok(dataLama, gudangStok, nilaiBaru, oleh), { merge: true });
        }
      }

      // Update entri tujuan.
      const now = sekarang();
      const tujuanBaru = data.tujuan.map((t, i) => {
        if (i !== cari.k) return t;
        if (terima) {
          return { ...t, status: "diterima", diterima_at: now, diterima_oleh: oleh ? String(oleh) : null };
        }
        if (ditutup) {
          return { ...t, status: "ditutup", ditutup_at: now, ditutup_oleh: oleh ? String(oleh) : null, catatan_alasan: alasan };
        }
        return { ...t, status: "tidak_terima", tidak_terima_at: now, tidak_terima_oleh: oleh ? String(oleh) : null };
      });

      // Recompute status dokumen. `selesai` TIDAK lagi otomatis di sini (P6): dipakai aksi
      // `selesaiPermintaan`. Namun `selesai_at` tetap diisi saat transisi pertama.
      const statusBaru = hitungStatusDokumen(tujuanBaru);
      const statusRiwayat = ditutup ? "ditutup" : statusBaru;
      const payload = {
        tujuan: tujuanBaru,
        status: statusBaru,
        riwayat_status: tambahRiwayat(data.riwayat_status, statusRiwayat, oleh),
      };
      trx.set(ref, payload, { merge: true });

      return {
        permintaan: { permintaan_id: doc.id, ...data, ...payload },
        gudangStok,
        totalQty,
        dariId,
        statusRiwayat,
        itemsTujuan,
      };
    });
  } catch (e) {
    if (e instanceof KesalahanBisnis) return { ok: false, status: e.status, error: e.pesan };
    return { ok: false, status: 500, error: "Gagal memproses tujuan." };
  }

  // Audit stok SETELAH commit (BR10).
  let peringatan = false;
  if (ditutup) {
    peringatan = await _catatAuditItem({
      items: hasil.itemsTujuan,
      oleh,
      type: "koreksi_manual",
      action_type: "tutup_tujuan",
      gudang_id: hasil.dariId,
      catatan: alasan,
    });
  } else if (hasil.gudangStok) {
    peringatan = await _catatAuditItem({
      items: hasil.itemsTujuan,
      oleh,
      type: "koreksi_manual",
      action_type: terima ? "mutasi_gudang" : "pengembalian_gudang",
      gudang_id: hasil.gudangStok,
    });
  }

  const segar = await ambilPermintaan(id);
  const respons = {
    ok: true,
    permintaan: segar || hasil.permintaan,
    status: hasil.permintaan.status,
    tujuan: (segar || hasil.permintaan).tujuan,
    peringatan_audit: peringatan,
  };
  if (ditutup) respons.qty_hilang = hasil.totalQty;
  return respons;
}

// ---------------------------------------------------------------------------
// Selesai (Q4 + P6)
// ---------------------------------------------------------------------------

/**
 * selesaiPermintaan(id, oleh): Gate pembuat ATAU owner. P6: SEMUA tujuan harus sudah final
 * (diterima/tidak_terima/ditolak/ditutup). TIDAK mengubah stok.
 */
async function selesaiPermintaan(id, oleh) {
  const ref = db.collection(KOLEKSI).doc(String(id));

  let hasil;
  try {
    hasil = await db.runTransaction(async (trx) => {
      const doc = await trx.get(ref);
      if (!doc.exists) throw new KesalahanBisnis(404, "Permintaan tidak ditemukan.");
      const data = doc.data();
      const terminal = _pesanStatusTerminal(data.status);
      if (terminal) throw new KesalahanBisnis(409, terminal);
      if (data.status === "selesai") throw new KesalahanBisnis(409, "Permintaan sudah selesai.");

      await _assertPembuatAtauOwner(oleh, data);

      const tujuan = Array.isArray(data.tujuan) ? data.tujuan : [];
      if (tujuan.length === 0 || !tujuan.every((t) => t && STATUS_TUJUAN_FINAL.includes(t.status))) {
        throw new KesalahanBisnis(409, "Masih ada tujuan yang belum selesai.");
      }

      const now = sekarang();
      const payload = {
        status: "selesai",
        selesai_at: data.selesai_at || now,
        selesai_oleh: oleh ? String(oleh) : null,
        riwayat_status: tambahRiwayat(data.riwayat_status, "selesai", oleh),
      };
      trx.set(ref, payload, { merge: true });
      return { permintaan: { permintaan_id: doc.id, ...data, ...payload } };
    });
  } catch (e) {
    if (e instanceof KesalahanBisnis) return { ok: false, status: e.status, error: e.pesan };
    return { ok: false, status: 500, error: "Gagal menyelesaikan permintaan." };
  }

  const segar = await ambilPermintaan(id);
  return {
    ok: true,
    permintaan: segar || hasil.permintaan,
    status: (segar || hasil.permintaan).status,
    tujuan: (segar || hasil.permintaan).tujuan,
  };
}

// ---------------------------------------------------------------------------
// Audit stok (setelah commit, tidak rollback - BR10)
// ---------------------------------------------------------------------------

/**
 * catatPergerakanStok per item. Gagal -> log + return true (peringatan_audit), tidak throw.
 * `source`/`status` diisi default sesuai signature stockMovements.js.
 */
async function _catatAuditItem({ items, oleh, type, action_type, gudang_id, catatan = null }) {
  let gagal = false;
  for (const item of Array.isArray(items) ? items : []) {
    try {
      await catatPergerakanStok({
        kode_barang: item.kode_barang,
        nama_terbaca: item.nama ?? item.kode_barang,
        variasi: item.variasi ?? null,
        qty: angkaAman(item && item.qty),
        type,
        action_type,
        catatan,
        // v5: gudang asal movement (param baru di stockMovements.js).
        gudang_id,
        source: "manual_chat",
        created_by: oleh ? String(oleh) : null,
      });
    } catch (e) {
      gagal = true;
      console.error(
        "[audit_write_failed]",
        JSON.stringify({ kode_barang: item && item.kode_barang, action_type, pesan: String(e) })
      );
    }
  }
  return gagal;
}

module.exports = {
  KOLEKSI,
  MAKS_TUJUAN,
  MAKS_ITEM,
  hitungStatusDokumen,
  ambilPermintaan,
  listPermintaan,
  buatPermintaan,
  ubahItemPermintaan,
  setujuiTujuan,
  tolakTujuanPermintaan,
  tolakPermintaan,
  batalPermintaan,
  kirimPermintaan,
  terimaPermintaan,
  tidakTerimaPermintaan,
  tutupTujuanPermintaan,
  selesaiPermintaan,
  catatNotifikasi,
};
