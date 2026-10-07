/**
 * lib/dashboard/validasiOpnameGudangV5.js
 * Validator payload /api/opname-gudang (F7). CJS murni, tanpa I/O.
 * Kontrak: { ok:true, status, ...nilai } ATAU { ok:false, status, error }.
 */
const AKSI_OPNAME_GUDANG_VALID = ["buat", "setujui", "tolak"];
const MAKS_ITEM = 200;

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

/** Validasi daftar item opname: array 1..200, kode unik, qty_fisik integer >= 0. */
function validasiItemsOpname(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, error: "Opname belum berisi item." };
  }
  if (items.length > MAKS_ITEM) {
    return { ok: false, status: 400, error: "Maksimal 200 item." };
  }
  const lihat = new Set();
  const hasil = [];
  for (const it of items) {
    if (!isObjek(it) || typeof it.kode_barang !== "string" || !it.kode_barang.trim()) {
      return { ok: false, status: 400, error: "Item tidak valid." };
    }
    const kode = it.kode_barang.trim();
    if (lihat.has(kode)) return { ok: false, status: 400, error: "Item duplikat dalam opname." };
    lihat.add(kode);
    if (typeof it.qty_fisik !== "number" || !Number.isInteger(it.qty_fisik) || it.qty_fisik < 0) {
      return { ok: false, status: 400, error: "Jumlah fisik harus bilangan bulat >= 0." };
    }
    hasil.push({ kode_barang: kode, qty_fisik: it.qty_fisik });
  }
  return { ok: true, items: hasil };
}

/** Validasi lengkap aksi `buat` opname (F7). */
function validasiBuatOpname(b) {
  if (!idAman(b.gudang_id)) return { ok: false, status: 400, error: "Gudang tidak dikenal." };
  const it = validasiItemsOpname(b.items);
  if (!it.ok) return it;
  return { ok: true, status: 200, aksi: "buat", gudangId: b.gudang_id.trim(), items: it.items };
}

/** Dispatcher aksi /api/opname-gudang (F7). */
function validasiAksiOpnameGudang(body) {
  const b = isObjek(body) ? body : {};
  const aksi = b.aksi;
  if (typeof aksi !== "string" || !AKSI_OPNAME_GUDANG_VALID.includes(aksi)) {
    return { ok: false, status: 400, error: "Aksi tidak dikenal." };
  }

  if (aksi === "buat") return validasiBuatOpname(b);

  // setujui / tolak
  if (typeof b.id !== "string" || !b.id.trim()) {
    return { ok: false, status: 400, error: "Opname tidak ditemukan." };
  }
  return { ok: true, status: 200, aksi, id: b.id.trim() };
}

module.exports = {
  AKSI_OPNAME_GUDANG_VALID,
  MAKS_ITEM,
  isObjek,
  idAman,
  validasiItemsOpname,
  validasiBuatOpname,
  validasiAksiOpnameGudang,
};
