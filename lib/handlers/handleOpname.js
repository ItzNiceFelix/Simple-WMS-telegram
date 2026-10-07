// lib/handlers/handleOpname.js
// Alur E (bagian 4): stok opname. Admin kirim hasil hitung fisik (chat teks ATAU screenshot,
// keduanya diproses ke bentuk sama: daftar {nama_terbaca, qty_fisik}), bot bandingkan dgn
// stock sistem, hitung selisih, lalu:
//   - selisih wajar → boleh langsung apply setelah konfirmasi SEKALI (draft biasa)
//   - selisih besar / item hilang dari daftar opname → di-flag KHUSUS, gak ikut auto-apply
//     meski admin bilang "ya" ke draft biasa — cegah AI "menutupi" barang hilang/salah hitung
//     (bagian 4E poin 4, wajib diperhatikan, ini prinsip keamanan data bukan sekadar UX)
//
// Pola konfirmasi: draft ke koleksi baru `opname_drafts` + sessions.pendingOpname (sama pola
// pendingPickingList/pendingSyncStok — disepakati sebelum Batch 7 mulai).

const { db } = require("../firebase");
const { FieldValue } = require("firebase-admin/firestore");
const { cariProdukByNama } = require("../matching/cariProdukByNama");
const { listSemuaProduk, ambilProdukByKode } = require("../models/produk");
const { ambilStok, timpaStokOpname } = require("../models/stok");
const { catatPergerakanStok } = require("../models/stockMovements");
const { ekstrakPickingList } = require("../gemini/ekstrakPickingList"); // reuse vision extractor
const { kirimPesan, kirimPesanDenganTombol } = require("../telegram/kirimPesan");
const { kunciGuard, guardAktif } = require("../dashboard/draftGuard");

const AMBANG_PERSEN_SELISIH_BESAR = 0.3; // >30%
const AMBANG_NOMINAL_SELISIH_BESAR = 5; // ATAU selisih >=5 unit, mana duluan tercapai (bagian 5)

/**
 * Entry point utama. Sumber bisa "chat" (teks admin ketik daftar hasil hitung) atau
 * "screenshot" (foto hasil hitung fisik, dibaca via Gemini vision — REUSE ekstrakPickingList
 * karena bentuk tabelnya mirip: nama produk + qty, kolom lain diabaikan di sini).
 *
 * @param {object} ctx
 * @param {string|number} ctx.telegramUserId
 * @param {string|number} ctx.chatId
 * @param {"chat"|"screenshot"} ctx.sumber
 * @param {string} [ctx.teksPesan] - wajib kalau sumber "chat", format bebas per baris "nama - qty"
 * @param {string} [ctx.base64Image] - wajib kalau sumber "screenshot"
 * @param {string} [ctx.mimeType]
 */
async function handleOpname({ telegramUserId, chatId, sumber, teksPesan, base64Image, mimeType }) {
  let hasilHitungFisik;

  if (sumber === "screenshot") {
    hasilHitungFisik = await ekstrakDariScreenshot(base64Image, mimeType);
  } else {
    hasilHitungFisik = parseDariTeks(teksPesan);
  }

  if (hasilHitungFisik.length === 0) {
    await kirimPesan(
      chatId,
      "Gak ketemu data hasil hitung fisik yang bisa dibaca. Coba kirim ulang, format per baris: nama produk - qty."
    );
    return;
  }

  const hasilBanding = await bandingkanDenganSistem(hasilHitungFisik);
  const draftId = await simpanDraftOpname(hasilBanding, telegramUserId);
  await simpanPendingOpname(telegramUserId, chatId, draftId);

  const teksRingkasan = susunTeksRingkasan(hasilBanding);
  await kirimPesanDenganTombol(chatId, teksRingkasan, [
    [
      { text: "✅ Ya, apply", callback_data: `op:ya:${telegramUserId}` },
      { text: "❌ Batal", callback_data: `op:batal:${telegramUserId}` },
    ],
  ]);
}

async function ekstrakDariScreenshot(base64Image, mimeType) {
  // ekstrakPickingList balikin {nama_terbaca, variasi, qty, penanda} — utk opname kita cuma
  // pakai nama_terbaca & qty (qty di sini artinya qty_fisik hasil hitung, bukan qty keluar resi)
  const barisMentah = await ekstrakPickingList(base64Image, mimeType);
  return barisMentah.map((b) => ({ nama_terbaca: b.nama_terbaca, qty_fisik: b.qty }));
}

/**
 * Parse teks bebas admin, format per baris: "nama produk - qty" atau "nama produk: qty".
 * Baris yang gak sesuai format dilewati (bukan bikin gagal semua) — biar admin gak harus
 * kaku, tapi kesalahan format juga gak diam-diam ditebak sembarangan.
 */
function parseDariTeks(teksPesan) {
  const barisTeks = String(teksPesan || "").split("\n");
  const hasil = [];

  for (const baris of barisTeks) {
    const cocok = baris.trim().match(/^(.+?)\s*[-:]\s*(\d+)$/);
    if (!cocok) continue;
    const nama = cocok[1].trim();
    const qty = Number(cocok[2]);
    if (!nama || !Number.isFinite(qty)) continue;
    hasil.push({ nama_terbaca: nama, qty_fisik: qty });
  }

  return hasil;
}

/**
 * Bandingkan tiap hasil hitung fisik dengan stock sistem (via fuzzy match produk, reuse
 * cariProdukByNama dari Batch 5), hitung selisih, tentukan wajar/besar.
 * Juga deteksi item yang ADA di stock sistem (is_online_product) tapi HILANG dari daftar
 * opname yang dikirim admin — bagian 4E poin 4, sinyal potensi barang hilang/salah hitung.
 */
async function bandingkanDenganSistem(hasilHitungFisik) {
  const hasil = [];
  const kodeBarangTersentuh = new Set();

  // FIX kuota Firestore: sama seperti handleScreenshotPickingList — sebelumnya tiap item
  // opname manggil cariProdukByNama() tanpa preload, jadi tiap item narik ulang seluruh
  // koleksi `products`. Ambil sekali di sini (lewat cache), pakai ulang utk seluruh batch
  // DAN utk cariItemHilangDariOpname() di bawah (juga dulu narik ulang koleksi produk lagi).
  const semuaProduk = await listSemuaProduk({ hanyaOnline: false });

  for (const item of hasilHitungFisik) {
    const hasilMatch = await cariProdukByNama(item.nama_terbaca, "-", semuaProduk);

    if (hasilMatch.status !== "jelas") {
      hasil.push({
        kategori: "tidak_ketemu",
        nama_terbaca: item.nama_terbaca,
        qty_fisik: item.qty_fisik,
        kandidat: hasilMatch.kandidat,
      });
      continue;
    }

    const produk = hasilMatch.produkTerpilih;
    kodeBarangTersentuh.add(produk.kode_barang);

    const stokSekarang = await ambilStok(produk.kode_barang);
    const qtySistem = stokSekarang ? stokSekarang.stok_gudang_online : 0;
    const selisih = item.qty_fisik - qtySistem;

    hasil.push({
      kategori: tentukanKategoriSelisih(selisih, qtySistem),
      kode_barang: produk.kode_barang,
      nama_accurate: produk.nama_accurate,
      qty_sistem: qtySistem,
      qty_fisik: item.qty_fisik,
      selisih,
    });
  }

  const itemHilang = cariItemHilangDariOpname(kodeBarangTersentuh, semuaProduk);
  for (const produk of itemHilang) {
    hasil.push({ kategori: "hilang_dari_opname", kode_barang: produk.kode_barang, nama_accurate: produk.nama_accurate });
  }

  return hasil;
}

/**
 * Selisih wajar vs besar: kombinasi persentase ATAU nominal absolut, mana tercapai duluan
 * (keputusan bagian 5) — item qty kecil gak salah kena flag cuma gara-gara persentase gede.
 */
function tentukanKategoriSelisih(selisih, qtySistem) {
  const selisihAbsolut = Math.abs(selisih);
  if (selisihAbsolut === 0) return "cocok";

  const basisPersen = qtySistem === 0 ? selisihAbsolut : selisihAbsolut / qtySistem;
  const selisihBesar = basisPersen > AMBANG_PERSEN_SELISIH_BESAR || selisihAbsolut >= AMBANG_NOMINAL_SELISIH_BESAR;

  return selisihBesar ? "selisih_besar" : "selisih_wajar";
}

/**
 * Cari produk online yang ada di stock sistem tapi gak disebut sama sekali di daftar opname
 * admin kali ini — kandidat "hilang dari hitungan", perlu klarifikasi (bukan diasumsikan 0).
 */
// Sekarang sinkron & terima daftar produk yang sudah di-fetch (bukan fetch sendiri lagi) —
// dipanggil dari bandingkanDenganSistem() dengan semuaProduk yang sudah diambil sekali di atas.
function cariItemHilangDariOpname(kodeBarangTersentuh, semuaProduk) {
  const produkOnline = semuaProduk.filter((p) => p.is_online_product === true);
  return produkOnline.filter((p) => !kodeBarangTersentuh.has(p.kode_barang));
}

async function simpanDraftOpname(hasilBanding, telegramUserId) {
  const ref = await db.collection("opname_drafts").add({
    items: hasilBanding,
    status: "pending_confirmation",
    // PRD v3b §7.2: penanda kepemilikan draft supaya dashboard bisa otorisasi tanpa baca
    // `sessions` (client dilarang). Additive; draft lama tanpa field ini -> fail-closed.
    owner_user_id: String(telegramUserId),
    created_at: new Date(),
  });
  return ref.id;
}

async function simpanPendingOpname(telegramUserId, chatId, draftId) {
  await db
    .collection("sessions")
    .doc(String(telegramUserId))
    .set({ pendingOpname: { chatId, draftId, dibuatPada: new Date() } }, { merge: true });
}

/**
 * Cek apakah admin ini punya draft opname pending. Dipanggil sebelum pesan diteruskan ke
 * Gemini, sama pola dgn apakahAdaPendingPickingList/apakahAdaPendingSyncStok.
 */
async function apakahAdaPendingOpname(telegramUserId) {
  const doc = await db.collection("sessions").doc(String(telegramUserId)).get();
  return Boolean(doc.data()?.pendingOpname);
}

/**
 * Proses jawaban admin thd draft opname. HANYA item kategori "cocok" & "selisih_wajar" yang
 * diapply saat "ya" — "selisih_besar" & "hilang_dari_opname" TETAP di-flag & TETAP butuh
 * klarifikasi terpisah (bagian 4E poin 4), TIDAK ikut ke-apply otomatis meski admin bilang ya
 * ke draft secara umum. Ini prinsip keamanan data, bukan cuma default yang bisa dilewati.
 *
 * Kontrak v3b §6.1/§6.6: `opsi` boleh OBJEK `{ confirmedBy, kirimNotifikasi, cekGuard }`
 * atau STRING `confirmedBy` (bentuk lama). Semua cabang mengembalikan `{ ok, alasan?, ... }`.
 * Guard `if (kirimNotifikasi)` HANYA membungkus pengiriman pesan — mutasi Firestore tanpa syarat.
 *
 * @param {string|number} telegramUserId
 * @param {string} teksJawaban
 * @param {{confirmedBy?: string|number, kirimNotifikasi?: boolean, cekGuard?: boolean}|string|number} [opsi]
 */
async function konfirmasiOpname(telegramUserId, teksJawaban, opsi = {}) {
  const { confirmedBy, kirimNotifikasi = true, cekGuard = false } =
    typeof opsi === "string" || typeof opsi === "number" ? { confirmedBy: opsi } : opsi;
  const pelaku = confirmedBy ?? telegramUserId;

  const sessionRef = db.collection("sessions").doc(String(telegramUserId));
  const sessionDoc = await sessionRef.get();
  const pending = sessionDoc.data()?.pendingOpname;
  // B3: return eksplisit (dulu `return;` senyap -> route dashboard lapor sukses palsu).
  if (!pending) return { ok: false, alasan: "tidak_ada_pending" };

  const { chatId, draftId } = pending;

  // B2: baca guard SEBELUM mutasi apa pun; jalur Telegram tidak mengirim cekGuard -> false.
  if (cekGuard) {
    try {
      if (await guardAktif(db, kunciGuard("opname", draftId))) {
        return { ok: false, alasan: "guard_aktif" };
      }
    } catch (e) {
      console.error("[draft_guard_failed]", JSON.stringify({ jenis: "opname", pesan: String(e) }));
    }
  }

  const jawaban = teksJawaban.trim().toLowerCase();

  if (jawaban === "batal" || jawaban === "tidak" || jawaban === "gak jadi") {
    await db.collection("opname_drafts").doc(draftId).update({ status: "dibatalkan" });
    await hapusPendingOpname(sessionRef);
    if (kirimNotifikasi) await kirimPesan(chatId, "Oke, opname dibatalkan. Gak ada stok yang diubah.");
    return { ok: true, dibatalkan: true };
  }

  if (jawaban !== "ya" && jawaban !== "iya" && jawaban !== "ok") {
    if (kirimNotifikasi) {
      await kirimPesan(
        chatId,
        'Masih nunggu konfirmasi draft opname. Balas *ya* buat apply item yang wajar (item selisih besar/hilang tetap perlu klarifikasi terpisah), atau *batal*.',
        { parseMode: "Markdown" }
      );
    }
    return { ok: false, alasan: "jawaban_tak_dikenal" };
  }

  const draftDoc = await db.collection("opname_drafts").doc(draftId).get();
  const items = draftDoc.data()?.items || [];

  const bisaApply = items.filter((i) => i.kategori === "cocok" || i.kategori === "selisih_wajar");
  const perluKlarifikasi = items.filter((i) => i.kategori === "selisih_besar" || i.kategori === "hilang_dari_opname");
  const tidakKetemu = items.filter((i) => i.kategori === "tidak_ketemu");

  for (const item of bisaApply) {
    if (item.selisih === 0) continue; // "cocok" gak perlu apply apa-apa
    await timpaStokOpname(item.kode_barang, item.qty_fisik, pelaku);
    await catatPergerakanStok({
      kode_barang: item.kode_barang,
      nama_terbaca: item.nama_accurate,
      variasi: "-",
      // qty = DELTA bertanda utk opname (selisih = qty_fisik - qty_sistem, sudah dihitung di bandingkanDenganSistem).
      qty: item.selisih,
      type: "opname",
      qty_sistem: item.qty_sistem,
      qty_fisik: item.qty_fisik,
      selisih: item.selisih,
      action_type: "kurangi_stok", // field wajib skema, gak sepenuhnya relevan utk opname — netral
      source: sesuaikanSumberDraft(),
      status: "processed",
      created_by: pelaku,
      requested_by: telegramUserId,
      confirmed_by: pelaku,
    });
  }

  await db.collection("opname_drafts").doc(draftId).update({ status: "processed" });
  await hapusPendingOpname(sessionRef);

  if (kirimNotifikasi) {
    const teksHasil = susunTeksHasilKonfirmasi(bisaApply.length, perluKlarifikasi, tidakKetemu.length);
    await kirimPesan(chatId, teksHasil, { parseMode: "Markdown" });
  }

  return {
    ok: true,
    diproses: bisaApply.length,
    perlu_klarifikasi: perluKlarifikasi.length,
    tidak_ketemu: tidakKetemu.length,
  };
}

function sesuaikanSumberDraft() {
  // TODO housekeeping: source asli ("screenshot"/"manual_chat") dari input opname gak
  // dibawa sampai ke draft/movement saat ini — draft cuma nyimpen items hasil banding,
  // bukan metadata sumber. Sementara pakai "manual_chat" sbg default aman. Bisa dirapikan
  // pas refactor batch nanti kalau perlu bedakan asal data di audit trail.
  return "manual_chat";
}

async function hapusPendingOpname(sessionRef) {
  await sessionRef.update({ pendingOpname: FieldValue.delete() });
}

function susunTeksRingkasan(hasilBanding) {
  const cocok = hasilBanding.filter((i) => i.kategori === "cocok");
  const selisihWajar = hasilBanding.filter((i) => i.kategori === "selisih_wajar");
  const selisihBesar = hasilBanding.filter((i) => i.kategori === "selisih_besar");
  const hilang = hasilBanding.filter((i) => i.kategori === "hilang_dari_opname");
  const tidakKetemu = hasilBanding.filter((i) => i.kategori === "tidak_ketemu");

  const baris = [`*Ringkasan Stok Opname* (${hasilBanding.length} item dicek)\n`];

  if (cocok.length > 0) baris.push(`✅ Cocok (${cocok.length}) — gak ada perubahan.`);

  if (selisihWajar.length > 0) {
    baris.push(`\n🟡 *Selisih wajar* (${selisihWajar.length}) — bakal langsung diapply kalau "ya":`);
    for (const i of selisihWajar) {
      baris.push(`- ${i.nama_accurate}: sistem ${i.qty_sistem} → fisik ${i.qty_fisik} (selisih ${i.selisih > 0 ? "+" : ""}${i.selisih})`);
    }
  }

  if (selisihBesar.length > 0) {
    baris.push(`\n🔴 *Selisih besar* (${selisihBesar.length}) — TIDAK auto-apply, perlu klarifikasi terpisah:`);
    for (const i of selisihBesar) {
      baris.push(`- ${i.nama_accurate}: sistem ${i.qty_sistem} → fisik ${i.qty_fisik} (selisih ${i.selisih > 0 ? "+" : ""}${i.selisih})`);
    }
  }

  if (hilang.length > 0) {
    baris.push(`\n⚠️ *Hilang dari daftar opname* (${hilang.length}) — TIDAK auto-apply, cek manual dulu:`);
    for (const i of hilang) baris.push(`- ${i.nama_accurate}`);
  }

  if (tidakKetemu.length > 0) {
    baris.push(`\n❌ *Nama gak ketemu produknya* (${tidakKetemu.length}):`);
    for (const i of tidakKetemu) baris.push(`- "${i.nama_terbaca}" (fisik: ${i.qty_fisik})`);
  }

  baris.push('\nBalas *ya* buat apply item cocok & selisih wajar, atau *batal*.');
  return baris.join("\n");
}

function susunTeksHasilKonfirmasi(jumlahDiapply, perluKlarifikasi, jumlahTidakKetemu) {
  const baris = [`✅ ${jumlahDiapply} item stok diperbarui dari hasil opname.`];
  if (perluKlarifikasi.length > 0) {
    baris.push(`⚠️ ${perluKlarifikasi.length} item masih perlu klarifikasi manual (selisih besar/hilang dari daftar) — belum diubah stoknya.`);
  }
  if (jumlahTidakKetemu > 0) {
    baris.push(`❌ ${jumlahTidakKetemu} item nama gak ketemu produknya, dilewati.`);
  }
  return baris.join("\n");
}

module.exports = { handleOpname, apakahAdaPendingOpname, konfirmasiOpname };