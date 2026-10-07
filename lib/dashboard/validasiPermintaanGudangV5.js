/**
 * lib/dashboard/validasiPermintaanGudangV5.js
 * Validator payload /api/permintaan-gudang (F5, F6, v5.1). CJS murni, tanpa I/O.
 * Kontrak: { ok:true, status, ...nilai } ATAU { ok:false, status, error }.
 */
const AKSI_PERMINTAAN_GUDANG_VALID = [
  "buat",
  "ubah-item",
  "setujui",
  "setujui-tujuan",
  "tolak-tujuan",
  "tolak",
  "batal",
  "kirim",
  "terima",
  "tidak-terima",
  "tutup-tujuan",
  "selesai",
];

const MAKS_TUJUAN = 20;
const MAKS_ITEM = 200;
const MAKS_CATATAN = 200;
const ID_TELEGRAM = /^\d+$/;

function isObjek(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** true bila aman dipakai sebagai Firestore doc id. */
function idAman(v) {
  return (
    typeof v === "string" &&
    v.trim() !== "" &&
    !v.includes("/") &&
    v !== "." &&
    v !== ".." &&
    !/[\u0000-\u001f\u007f]/.test(v)
  );
}

/** Validasi satu entri tujuan (v5.1: hanya gudang; penerima & items opsional). */
function validasiTujuanSatu(entri) {
  if (!isObjek(entri)) return { ok: false, status: 400, error: "Tipe tujuan tidak dikenal." };
  if (entri.tipe !== "gudang") {
    return { ok: false, status: 400, error: "Tujuan hanya boleh gudang." };
  }
  if (!idAman(entri.id)) return { ok: false, status: 400, error: "Gudang tujuan tidak valid." };

  const hasil = { tipe: "gudang", id: entri.id.trim() };

  // user_penerima_id opsional; bila ada harus string digit (telegram id).
  if (entri.user_penerima_id !== undefined && entri.user_penerima_id !== null) {
    if (typeof entri.user_penerima_id !== "string" || !ID_TELEGRAM.test(entri.user_penerima_id)) {
      return { ok: false, status: 400, error: "Penerima harus dari gudang tujuan." };
    }
    hasil.user_penerima_id = entri.user_penerima_id;
  } else {
    hasil.user_penerima_id = null;
  }

  // items opsional; bila ada harus array valid.
  if (entri.items !== undefined && entri.items !== null) {
    const it = validasiItems(entri.items);
    if (!it.ok) return it;
    hasil.items = it.items;
  }

  return { ok: true, entri: hasil };
}

/** Validasi daftar tujuan: array 1..20, dedup (tipe+id). */
function validasiTujuan(tujuan) {
  if (!Array.isArray(tujuan) || tujuan.length === 0) {
    return { ok: false, status: 400, error: "Pilih minimal satu tujuan." };
  }
  if (tujuan.length > MAKS_TUJUAN) {
    return { ok: false, status: 400, error: "Maksimal 20 tujuan." };
  }
  const hasil = [];
  const terlihat = new Set();
  for (const entri of tujuan) {
    const t = validasiTujuanSatu(entri);
    if (!t.ok) return t;
    const kunci = t.entri.tipe + ":" + t.entri.id;
    if (terlihat.has(kunci)) continue;
    terlihat.add(kunci);
    hasil.push(t.entri);
  }
  return { ok: true, tujuan: hasil };
}

/** Validasi daftar item: array 1..200, kode unik (qty digabung/sum). */
function validasiItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, error: "Permintaan belum berisi item." };
  }
  if (items.length > MAKS_ITEM) {
    return { ok: false, status: 400, error: "Maksimal 200 item." };
  }
  const peta = new Map();
  for (const it of items) {
    if (!isObjek(it) || typeof it.kode_barang !== "string" || !it.kode_barang.trim()) {
      return { ok: false, status: 400, error: "Item tidak valid." };
    }
    if (typeof it.qty !== "number" || !Number.isInteger(it.qty) || it.qty < 1) {
      return { ok: false, status: 400, error: "Jumlah item harus bilangan bulat >= 1." };
    }
    const kode = it.kode_barang.trim();
    const lama = peta.get(kode);
    peta.set(kode, lama === undefined ? it.qty : lama + it.qty);
  }
  const hasil = [];
  for (const [kode_barang, qty] of peta) hasil.push({ kode_barang, qty });
  return { ok: true, items: hasil };
}

/** Validasi lengkap aksi `buat` (F5/F6, v5.1). */
function validasiBuatPermintaan(b) {
  if (!idAman(b.dari_gudang_id)) {
    return { ok: false, status: 400, error: "Gudang asal tidak dikenal." };
  }
  const dariGudangId = b.dari_gudang_id.trim();

  const t = validasiTujuan(b.tujuan);
  if (!t.ok) return t;

  for (const entri of t.tujuan) {
    if (entri.id === dariGudangId) {
      return { ok: false, status: 400, error: "Gudang asal tidak boleh jadi tujuan." };
    }
  }

  const it = validasiItems(b.items);
  if (!it.ok) return it;

  return { ok: true, status: 200, aksi: "buat", dariGudangId, tujuan: t.tujuan, items: it.items };
}

/** Cek `id` dokumen permintaan. */
function ambilId(b) {
  if (typeof b.id !== "string" || !b.id.trim()) {
    return { ok: false, status: 400, error: "Permintaan tidak ditemukan." };
  }
  return { ok: true, id: b.id.trim() };
}

/** Cek `tujuan_index`: integer >= 0. */
function ambilTujuanIndex(b) {
  if (typeof b.tujuan_index !== "number" || !Number.isInteger(b.tujuan_index) || b.tujuan_index < 0) {
    return { ok: false, status: 400, error: "Tujuan tidak ditemukan." };
  }
  return { ok: true, tujuanIndex: b.tujuan_index };
}

/** Dispatcher aksi /api/permintaan-gudang (F5, F6, v5.1). */
function validasiAksiPermintaanGudang(body) {
  const b = isObjek(body) ? body : {};
  const aksi = b.aksi;
  if (typeof aksi !== "string" || !AKSI_PERMINTAAN_GUDANG_VALID.includes(aksi)) {
    return { ok: false, status: 400, error: "Aksi tidak dikenal." };
  }

  if (aksi === "buat") return validasiBuatPermintaan(b);

  if (aksi === "ubah-item") {
    const id = ambilId(b);
    if (!id.ok) return id;
    const it = validasiItems(b.items);
    if (!it.ok) return it;
    return { ok: true, status: 200, aksi, id: id.id, items: it.items };
  }

  // Level dokumen: tolak (hanya menunggu), batal, selesai.
  if (aksi === "tolak" || aksi === "batal" || aksi === "selesai") {
    const id = ambilId(b);
    if (!id.ok) return id;
    return { ok: true, status: 200, aksi, id: id.id };
  }

  // Per-tujuan: setujui-tujuan / tolak-tujuan / kirim / terima / tidak-terima / tutup-tujuan.
  const id = ambilId(b);
  if (!id.ok) return id;
  const idx = ambilTujuanIndex(b);
  if (!idx.ok) return idx;
  if (aksi === "tutup-tujuan") {
    const catatan = typeof b.catatan === "string" ? b.catatan.trim() : "";
    if (!catatan || catatan.length > MAKS_CATATAN) {
      return { ok: false, status: 400, error: "Alasan wajib diisi." };
    }
    return { ok: true, status: 200, aksi, id: id.id, tujuanIndex: idx.tujuanIndex, catatan };
  }
  return { ok: true, status: 200, aksi, id: id.id, tujuanIndex: idx.tujuanIndex };
}

module.exports = {
  AKSI_PERMINTAAN_GUDANG_VALID,
  MAKS_TUJUAN,
  MAKS_ITEM,
  isObjek,
  idAman,
  validasiTujuan,
  validasiItems,
  validasiBuatPermintaan,
  validasiAksiPermintaanGudang,
};
