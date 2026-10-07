// lib/models/dailyRequests.js
// CRUD untuk koleksi `daily_requests` — rekap kebutuhan minta stok ke gudang sebelah per hari.
// Doc ID pakai format tanggal "YYYY-MM-DD" (lihat skema di dokumen).
//
// v3a (PRD §4-§5): state machine draft -> diproses -> selesai, snapshot qty_diminta (B2),
// audit durable `perubahan[]` (B5), auto-selesai item qty 0 (B6), pesan Telegram plain.

const { db } = require("../firebase");
const { ambilSemuaAdminByRole } = require("./admins");
const { kirimPesanPlain } = require("../telegram/kirimPesan");
// Helper tanggal CJS terpisah: `lib/dashboard/format.ts` tidak bisa di-require dari runtime
// Node CommonJS (route TS mengimpornya via createRequire, tapi model .js biasa tidak).
const { formatTanggalSingkatDariId } = require("../dashboard/formatTanggalCjs");

const KOLEKSI = "daily_requests";

const STATUS_DOKUMEN_VALID = ["draft", "diproses", "selesai"];
const MAKS_PERUBAHAN = 50;

// ---------------------------------------------------------------------------
// W1.1 — Helper normalisasi & gabung (murni, tanpa I/O; diekspor untuk test).
// ---------------------------------------------------------------------------

// Item lama (bot) hanya punya { kode_barang, nama, variasi, qty, buffer }.
// Bentuk kanonik: field baru diberi nilai efektif supaya jalur baca & tulis seragam.
function normalisasiItemLama(item) {
  const it = item && typeof item === "object" ? item : {};
  return {
    ...it,
    status: it.status === "datang" ? "datang" : "diminta",
    qty_diminta: it.qty_diminta ?? it.qty ?? 0,
    qty_datang: it.qty_datang ?? null,
    datang_at: it.datang_at ?? null,
    datang_by: it.datang_by ?? null,
  };
}

function normalisasiStatusDokumen(status) {
  return STATUS_DOKUMEN_VALID.includes(status) ? status : "draft";
}

// T1: gabung HANYA bila kode_barang + variasi + buffer sama persis. buffer beda = item
// terpisah (MINTA_SISA vs MINTA tidak boleh bercampur). qty & qty_diminta dijumlahkan.
// Item campuran (sebagian sudah datang) TIDAK digabung (kunci diperluas status efektif).
function gabungItemDuplikat(items) {
  const peta = new Map();
  for (const mentah of Array.isArray(items) ? items : []) {
    const item = normalisasiItemLama(mentah);
    const kunci = `${item.kode_barang}::${item.variasi}::${item.buffer === true}::${item.status}`;
    const ada = peta.get(kunci);
    if (!ada) {
      peta.set(kunci, { ...item });
      continue;
    }
    ada.qty = (ada.qty ?? 0) + (item.qty ?? 0);
    ada.qty_diminta = (ada.qty_diminta ?? 0) + (item.qty_diminta ?? 0);
    // qty_datang hanya relevan bila semua sumber datang (kunci memuat status).
    if (ada.status === "datang") {
      ada.qty_datang = (ada.qty_datang ?? 0) + (item.qty_datang ?? 0);
    }
  }
  return [...peta.values()];
}

// Item efektif "tidak diminta" -> otomatis selesai (B6/S4.4).
function itemEfektifSelesai(item) {
  return item.status === "datang" || (item.qty_diminta ?? item.qty) === 0;
}

// Format tanggal lokal jadi "YYYY-MM-DD". Dipisah biar konsisten dipakai di banyak tempat.
function formatTanggal(tanggal = new Date()) {
  const y = tanggal.getFullYear();
  const m = String(tanggal.getMonth() + 1).padStart(2, "0");
  const d = String(tanggal.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Jalur baca bot/server: normalisasi lazy (B3) supaya item lama tetap punya field baru.
async function ambilDailyRequest(tanggal) {
  const idTanggal = typeof tanggal === "string" ? tanggal : formatTanggal(tanggal);
  const doc = await db.collection(KOLEKSI).doc(idTanggal).get();
  if (!doc.exists) return null;
  return normalisasiDokumen({ tanggal: doc.id, ...doc.data() });
}

// Bentuk kanonik dokumen: status efektif + items ternormalisasi. `items` rusak -> [].
function normalisasiDokumen(data) {
  const d = data && typeof data === "object" ? data : {};
  return {
    ...d,
    status: normalisasiStatusDokumen(d.status),
    items: (Array.isArray(d.items) ? d.items : []).map(normalisasiItemLama),
    perubahan: Array.isArray(d.perubahan) ? d.perubahan : [],
  };
}

// Ambil daily_requests hari ini, bikin baru kalau belum ada (status awal "draft").
async function ambilOrBuatDailyRequestHariIni() {
  const idTanggal = formatTanggal();
  const existing = await ambilDailyRequest(idTanggal);
  if (existing) return existing;

  const payload = { items: [], status: "draft", created_at: new Date() };
  await db.collection(KOLEKSI).doc(idTanggal).set(payload);
  return { tanggal: idTanggal, ...payload };
}

// Tambah 1 item kebutuhan (misal dari konfirmasi picking list dengan action_type perlu_request/perlu_request_buffer).
async function tambahItemKeDailyRequest(tanggal, item) {
  const idTanggal = typeof tanggal === "string" ? tanggal : formatTanggal(tanggal);
  const ref = db.collection(KOLEKSI).doc(idTanggal);

  await db.runTransaction(async (trx) => {
    const doc = await trx.get(ref);
    const dataSekarang = doc.exists
      ? doc.data()
      : { items: [], status: "draft", created_at: new Date() };

    const itemsBaru = [
      ...(dataSekarang.items || []),
      {
        kode_barang: item.kode_barang ?? item.kodeBarang,
        nama: item.nama,
        variasi: item.variasi || "-",
        qty: item.qty,
        buffer: item.buffer === true, // true kalau asalnya perlu_request_buffer (MINTA_SISA)
      },
    ];

    trx.set(ref, { ...dataSekarang, items: itemsBaru }, { merge: true });
  });

  return ambilDailyRequest(idTanggal);
}

// `tambahan` opsional (mis. selesai_at/by) digabung dalam SATU update atomik.
async function updateStatusDailyRequest(tanggal, statusBaru, tambahan = {}) {
  const idTanggal = typeof tanggal === "string" ? tanggal : formatTanggal(tanggal);
  await db.collection(KOLEKSI).doc(idTanggal).update({ status: statusBaru, ...tambahan });
  return ambilDailyRequest(idTanggal);
}

// ---------------------------------------------------------------------------
// W1.2 — Mutasi. SEMUA pakai db.runTransaction (pola tambahItemKeDailyRequest).
// ---------------------------------------------------------------------------

function refTanggal(tanggal) {
  const idTanggal = typeof tanggal === "string" ? tanggal : formatTanggal(tanggal);
  return { idTanggal, ref: db.collection(KOLEKSI).doc(idTanggal) };
}

// Aksi 1 — Ubah Jumlah. Tolak item berstatus `datang` (data penerimaan tidak boleh hilang).
// Audit durable: entri `perubahan[]` (max 50 terakhir) + updated_at/by (B5).
async function sesuaikanQtyItem(tanggal, daftar, oleh) {
  const { idTanggal, ref } = refTanggal(tanggal);

  return db.runTransaction(async (trx) => {
    const snap = await trx.get(ref);
    if (!snap.exists) throw new Error("Permintaan tidak ditemukan.");
    const data = snap.data() || {};
    const items = (Array.isArray(data.items) ? data.items : []).map(normalisasiItemLama);
    if (items.length === 0) throw new Error("Permintaan belum berisi item.");

    const perubahan = (Array.isArray(data.perubahan) ? data.perubahan : []).slice();
    const sekarang = new Date();
    const asli = (Array.isArray(data.items) ? data.items : []).map((it) =>
      it && typeof it === "object" ? it : {}
    );
    const itemsBaru = items.map((item) => ({ ...item }));
    // §4.3: `sesuaikan` TIDAK mengubah/menambah `qty_diminta`. Catat item mana yang memang
    // sudah punya field itu; yang belum (draft / item baru dari bot) tetap TANPA field.
    const punyaQtyDiminta = asli.map((it) => Object.prototype.hasOwnProperty.call(it, "qty_diminta"));
    const daftarArr = Array.isArray(daftar) ? daftar : [];

    for (const minta of daftarArr) {
      const kode = minta?.kode_barang;
      const variasi = minta?.variasi ?? "-";
      const buffer = minta?.buffer === true;
      const idx = itemsBaru.findIndex(
        (it) =>
          it.kode_barang === kode &&
          (it.variasi ?? "-") === variasi &&
          (it.buffer === true) === buffer
      );
      if (idx === -1) throw new Error("Item tidak ditemukan di permintaan.");
      if (itemsBaru[idx].status === "datang") throw new Error("Item yang sudah datang tidak bisa diubah.");

      const qtyLama = itemsBaru[idx].qty ?? 0;
      const qtyBaru = minta.qty;
      itemsBaru[idx].qty = qtyBaru;
      perubahan.push({
        key_item: `${itemsBaru[idx].kode_barang}::${itemsBaru[idx].variasi ?? "-"}::${itemsBaru[idx].buffer === true}`,
        qty_lama: qtyLama,
        qty_baru: qtyBaru,
        oleh,
        at: sekarang.toISOString(),
      });
    }

    // Buang `qty_diminta` pada item yang aslinya tidak punya (draft / item bot baru) supaya
    // `sesuaikan` tidak diam-diam membuat/menimpa snapshot (B2: snapshot HANYA di buat-form).
    const itemsTulis = itemsBaru.map((item, i) => {
      if (punyaQtyDiminta[i]) return item;
      const { qty_diminta, ...sisa } = item;
      void qty_diminta;
      return sisa;
    });

    trx.set(
      ref,
      {
        ...data,
        items: itemsTulis,
        perubahan: perubahan.slice(-MAKS_PERUBAHAN), // B5: simpan 50 entri terakhir saja
        updated_at: sekarang,
        updated_by: oleh,
      },
      { merge: false }
    );
  }).then(() => ambilDailyRequest(idTanggal));
}

// Aksi 2 — Kirim Form / Kirim Ulang. SNAPSHOT B2: qty_diminta = qty untuk SETIAP item
// yang belum datang (termasuk item bot yang cuma punya `qty`). Item datang tidak disentuh.
async function buatForm(tanggal, oleh) {
  const { idTanggal, ref } = refTanggal(tanggal);

  return db.runTransaction(async (trx) => {
    const snap = await trx.get(ref);
    if (!snap.exists) throw new Error("Permintaan tidak ditemukan.");
    const data = snap.data() || {};
    // E18: `items` rusak (truthy tapi bukan array) -> perlakukan sebagai kosong, jangan crash 500.
    const asli = (Array.isArray(data.items) ? data.items : []).map(normalisasiItemLama);
    if (asli.length === 0) throw new Error("Permintaan belum berisi item.");
    // B6/PRD §5.1: semua item sudah datang ATAU qty_diminta 0 -> tidak ada yang dikirim.
    if (asli.every(itemEfektifSelesai)) throw new Error("Semua item sudah datang.");

    const sekarang = new Date();
    // T1/R4: gabung duplikat identik (kode+variasi+buffer) sebelum snapshot & kirim,
    // supaya pesan Telegram tidak memuat baris ganda.
    const itemsFinal = gabungItemDuplikat(asli).map((item) => {
      if (item.status === "datang") return item; // jangan timpa catatan penerimaan
      return { ...item, qty_diminta: item.qty ?? 0 };
    });

    trx.set(
      ref,
      {
        ...data,
        items: itemsFinal,
        status: "diproses",
        form_dibuat_at: sekarang,
        form_dibuat_by: oleh,
        updated_at: sekarang,
        updated_by: oleh,
      },
      { merge: false }
    );

    return { idTanggal, itemsFinal };
  }).then(async (hasil) => ({ doc: await ambilDailyRequest(hasil.idTanggal), itemsFinal: hasil.itemsFinal }));
}

// Aksi 3 — Barang Datang. Auto-selesai (B6) dievaluasi DI DALAM transaksi (anti race).
async function tandaiItemDatang(tanggal, item, qtyDatang, oleh) {
  const { idTanggal, ref } = refTanggal(tanggal);

  return db.runTransaction(async (trx) => {
    const snap = await trx.get(ref);
    if (!snap.exists) throw new Error("Permintaan tidak ditemukan.");
    const data = snap.data() || {};
    const items = (Array.isArray(data.items) ? data.items : []).map(normalisasiItemLama);
    if (items.length === 0) throw new Error("Item tidak ditemukan di permintaan.");

    // Identitas item = kode + variasi + buffer (T1); buffer beda = baris berbeda.
    const idx = items.findIndex(
      (it) =>
        it.kode_barang === item?.kode_barang &&
        (it.variasi ?? "-") === (item?.variasi ?? "-") &&
        (it.buffer === true) === (item?.buffer === true)
    );
    if (idx === -1) throw new Error("Item tidak ditemukan di permintaan.");
    if (items[idx].status === "datang") throw new Error("Item ini sudah ditandai datang.");

    const sekarang = new Date();
    const itemsBaru = items.map((it, i) =>
      i === idx
        ? {
            ...it,
            status: "datang",
            qty_datang: qtyDatang,
            datang_at: sekarang,
            datang_by: oleh,
          }
        : it
    );

    // B6: semua item datang ATAU qty_diminta 0 (fallback qty) -> dokumen selesai.
    const selesaiOtomatis = itemsBaru.every(itemEfektifSelesai);
    const payload = {
      ...data,
      items: itemsBaru,
      status: selesaiOtomatis ? "selesai" : normalisasiStatusDokumen(data.status),
      updated_at: sekarang,
      updated_by: oleh,
    };
    if (selesaiOtomatis) {
      payload.selesai_at = sekarang;
      payload.selesai_by = oleh;
    }

    trx.set(ref, payload, { merge: false });
    return { idTanggal, selesaiOtomatis };
  }).then(async (hasil) => ({
    doc: await ambilDailyRequest(hasil.idTanggal),
    selesaiOtomatis: hasil.selesaiOtomatis,
  }));
}

// Aksi 4 — Selesai manual (WAJIB; jalur keluar item qty 0 / barang tak akan datang).
// Guard: minimal satu item `datang` ATAU semua item qty 0. Pakai ulang updateStatusDailyRequest.
async function selesaikanRequest(tanggal, oleh) {
  const doc0 = await ambilDailyRequest(tanggal);
  if (!doc0) throw new Error("Permintaan tidak ditemukan.");
  const items = Array.isArray(doc0.items) ? doc0.items : [];
  const adaDatang = items.some((it) => it.status === "datang");
  const semuaTidakDiminta = items.length > 0 && items.every((it) => (it.qty_diminta ?? it.qty) === 0);
  if (!adaDatang && !semuaTidakDiminta) throw new Error("Belum ada item yang datang.");

  // updateStatusDailyRequest dipakai ulang (dead code lama -> hidup lagi, PRD §5.2) dan
  // menulis status + field audit dalam SATU update atomik (tidak ada jendela status tanpa audit).
  const { idTanggal } = refTanggal(tanggal);
  const sekarang = new Date();
  return updateStatusDailyRequest(idTanggal, "selesai", {
    selesai_at: sekarang,
    selesai_by: oleh,
    updated_at: sekarang,
    updated_by: oleh,
  });
}

// ---------------------------------------------------------------------------
// W1.3 — Pesan & kirim.
// ---------------------------------------------------------------------------

// Helper MURNI (diekspor untuk test). Format PERSIS contoh literal PRD §3.5:
// separator U+00B7 MIDDLE DOT, tanggal TZ-safe, urut nama case-insensitive.
function formatPesanPermintaan(doc) {
  const d = doc && typeof doc === "object" ? doc : {};
  const idTanggal = d.tanggal;
  const items = (Array.isArray(d.items) ? d.items : []).map(normalisasiItemLama);

  // Urutan mengikuti contoh literal §3.5 (Kemeja/BRG-001 lalu Celana/BRG-003) = `kode_barang`
  // asc, lalu variasi, lalu nama. Catatan: §3.5 juga menulis "urut alfabetis nama", yang
  // bertentangan dengan literal itu ("Celana" < "Kemeja"); DoD mengikat ke contoh literal,
  // jadi urutan kode dipilih (deterministik & cocok literal). Lihat laporan keputusan.
  const urut = items.slice().sort((a, b) => {
    const ka = String(a.kode_barang || "");
    const kb = String(b.kode_barang || "");
    if (ka !== kb) return ka < kb ? -1 : 1;
    const va = String(a.variasi || "");
    const vb = String(b.variasi || "");
    if (va !== vb) return va < vb ? -1 : 1;
    const na = String(a.nama || "").toLowerCase();
    const nb = String(b.nama || "").toLowerCase();
    return na < nb ? -1 : na > nb ? 1 : 0;
  });

  const baris = [];
  let total = 0;
  urut.forEach((item, i) => {
    const qty = item.qty_diminta ?? item.qty ?? 0; // B2: angka yang DIKIRIM, bukan qty terkini
    total += qty;
    baris.push(`${i + 1}. ${item.nama ?? ""}`);
    const adaVariasi = item.variasi && item.variasi !== "-";
    baris.push(
      `   ${item.kode_barang}${adaVariasi ? ` \u00b7 ${item.variasi}` : ""} \u00b7 ${formatAngka(qty)} pcs`
    );
  });

  const header = ["Permintaan Stok ke Gudang Cabang", formatTanggalSingkatDariId(idTanggal)];
  const footer = `Total: ${formatAngka(urut.length)} item \u00b7 ${formatAngka(total)} pcs`;
  // Baris kosong setelah tanggal & sebelum Total (PERSIS contoh §3.5).
  return [...header, "", ...baris, "", footer].join("\n");
}

function formatAngka(n) {
  return new Intl.NumberFormat("id-ID").format(n ?? 0);
}

// Kirim form ke SEMUA owner+admin. Dedupe by telegram_user_id, plain (tanpa parse_mode),
// JANGAN throw -> { terkirim, gagal }. Kirim ke `telegram_user_id` (BUKAN admin.id).
async function kirimFormPermintaan(doc) {
  const teks = formatPesanPermintaan(doc);
  const daftar = [
    ...(await ambilSemuaAdminByRole("owner")),
    ...(await ambilSemuaAdminByRole("admin")),
  ];

  const unik = new Map();
  for (const admin of daftar) {
    const tujuan = admin?.telegram_user_id;
    if (!tujuan) continue; // E13: id kosong -> dilewati
    if (!unik.has(String(tujuan))) unik.set(String(tujuan), tujuan);
  }

  let terkirim = 0;
  let gagal = 0;
  for (const tujuan of unik.values()) {
    try {
      await kirimPesanPlain(tujuan, teks);
      terkirim += 1;
    } catch (e) {
      gagal += 1;
      console.error("[permintaan_kirim_gagal]", JSON.stringify({ tujuan: String(tujuan), pesan: String(e) }));
    }
  }
  return { terkirim, gagal };
}

module.exports = {
  formatTanggal,
  ambilDailyRequest,
  ambilOrBuatDailyRequestHariIni,
  tambahItemKeDailyRequest,
  updateStatusDailyRequest,
  // v3a
  normalisasiItemLama,
  normalisasiStatusDokumen,
  gabungItemDuplikat,
  sesuaikanQtyItem,
  buatForm,
  tandaiItemDatang,
  selesaikanRequest,
  formatPesanPermintaan,
  kirimFormPermintaan,
};
