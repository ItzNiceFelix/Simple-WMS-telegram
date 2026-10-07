// lib/sheets/syncStokDuaArah.js
// Alur F (bagian 4): sync DUA ARAH stok gudang online, manual trigger (/sync_stok),
// SELALU direview admin sebelum apply — beda total dari syncMasterData.js yang searah & otomatis.
//
// Pola konfirmasi: draft diff disimpan per-kelompok ke koleksi `sync_stok_drafts` (BUKAN
// pendingPickingList/pendingAction), sessions cuma nyimpen daftar draftId + chatId. Kenapa
// per-kelompok bukan satu draft besar: 3 kondisi (sheets_ketinggalan/sheets_manual/konflik)
// tetap dipisah biar admin bisa acc sebagian dulu (bagian 4F poin 5) dan biar keliatan mana
// yang sempat diedit manual di Sheets — TAPI arah resolusinya sama semua: Firestore menang,
// ditulis ke Sheets. Firestore = sumber kebenaran (tiap transaksi barang masuk/keluar lapor
// ke bot dulu), Sheets cuma jendela tampilan, jadi sync ini pada dasarnya satu-arah
// Firestore → Sheets, cuma tetap direview admin dulu sebelum apply (beda dari
// syncMasterData.js yang searah & otomatis tanpa review).

const { db } = require("../firebase");
const { FieldValue } = require("firebase-admin/firestore");
const { bacaRange, tulisRange, ambilHeader, tambahKolomHeader, tambahBarisBaru, angkaKeHurufKolom } = require("./client");
const { listSemuaProduk, ambilProdukByKode } = require("../models/produk");
const { ambilStok, tandaiTersinkron, bacaParitasOnline } = require("../models/stok");
const { catatPergerakanStok } = require("../models/stockMovements");
const { kirimPesan, kirimPesanDenganTombol } = require("../telegram/kirimPesan");
const { kunciGuard, guardAktif } = require("../dashboard/draftGuard");

const NAMA_SHEET_STOK = "DATABASE_ACCURATE"; // stok online numpang di sheet yang sama, kolom baru
const NAMA_KOLOM_STOK_ONLINE = "Stok Online";

const KONDISI = {
  SHEETS_KETINGGALAN: "sheets_ketinggalan", // hanya Firestore berubah → aman auto push
  SHEETS_MANUAL: "sheets_manual",           // hanya Sheets berubah → perlu diklarifikasi
  KONFLIK: "konflik",                       // dua-duanya berubah, beda nilai → wajib pilih
  PRODUK_BARU: "produk_baru",               // ada di Firestore tapi belum ada barisnya di Sheets sama sekali —
                                             // beda dari 3 kondisi lain: ini INSERT baris baru, bukan UPDATE
};

/**
 * Entry point dipanggil dari command /sync_stok. Baca kondisi Firestore & Sheets SAAT INI JUGA
 * (bukan asumsi dari sync sebelumnya — bagian 4F poin 2), hitung diff, simpan draft per kelompok,
 * kirim ringkasan ke chat.
 * @param {string|number} telegramUserId
 * @param {string|number} chatId
 */
async function mulaiSyncStok(telegramUserId, chatId) {
  const indexKolom = await pastikanKolomStokAda(chatId);
  if (indexKolom === null) return; // nunggu konfirmasi admin dulu (kolom belum ada), stop di sini

  const barisSheet = await bacaRange(`${NAMA_SHEET_STOK}!A2:${angkaKeHurufKolom(indexKolom)}`);
  const semuaProduk = await listSemuaProduk({ hanyaOnline: true });
  // hanyaOnline: true — stok gudang online cuma relevan utk produk yang memang dipakai online

  const kelompok = {
    [KONDISI.SHEETS_KETINGGALAN]: [],
    [KONDISI.SHEETS_MANUAL]: [],
    [KONDISI.KONFLIK]: [],
    [KONDISI.PRODUK_BARU]: [],
  };

  for (const produk of semuaProduk) {
    const stokFirestore = await ambilStok(produk.kode_barang);
    if (!stokFirestore) continue; // belum ada data stok sama sekali, gak ada yg disync

    const baris = cariBarisSheetByKode(barisSheet, produk.kode_barang);

    if (!baris) {
      // Produk ini ada di Firestore tapi belum ada barisnya sama sekali di Sheets (mis. baru
      // didaftarkan lewat chat) — JANGAN dianggap "sheets 0" (itu bikin salah kira konflik/
      // ketinggalan padahal barisnya emang belum ada). Kelompokkan terpisah biar bot bikin
      // baris baru, bukan nulis ke baris yang gak ada.
      kelompok[KONDISI.PRODUK_BARU].push({
        kondisi: KONDISI.PRODUK_BARU,
        kode_barang: produk.kode_barang,
        nama_accurate: produk.nama_accurate,
        hpp: produk.hpp ?? null,
        nilai_firestore: bacaParitasOnline(stokFirestore),
        index_kolom: indexKolom,
      });
      continue;
    }

    const nilaiSheetSekarang = Number(baris[indexKolom]) || 0;
    const item = bandingkanNilai(produk, stokFirestore, nilaiSheetSekarang, indexKolom);
    if (item) kelompok[item.kondisi].push(item);
  }

  const draftIds = await simpanDraftPerKelompok(kelompok, indexKolom, telegramUserId);
  await simpanPendingSyncStok(telegramUserId, chatId, draftIds);

  const teksRingkasan = susunTeksRingkasanDiff(kelompok);

  if (draftIds.length === 0) {
    // Gak ada yang perlu disync — susunTeksRingkasanDiff sudah balikin pesan "semua sinkron",
    // gak perlu tombol apa-apa.
    await kirimPesan(chatId, teksRingkasan, { parseMode: "Markdown" });
    return;
  }

  const tombol = [];
  if (kelompok[KONDISI.SHEETS_KETINGGALAN].length > 0) {
    tombol.push([{ text: "🟢 Ya, sheets ketinggalan", callback_data: `ss:${KONDISI.SHEETS_KETINGGALAN}:${telegramUserId}` }]);
  }
  if (kelompok[KONDISI.SHEETS_MANUAL].length > 0) {
    tombol.push([{ text: "🟡 Ya, sheets manual", callback_data: `ss:${KONDISI.SHEETS_MANUAL}:${telegramUserId}` }]);
  }
  if (kelompok[KONDISI.KONFLIK].length > 0) {
    tombol.push([{ text: "🔴 Ya, konflik", callback_data: `ss:${KONDISI.KONFLIK}:${telegramUserId}` }]);
  }
  if (kelompok[KONDISI.PRODUK_BARU].length > 0) {
    tombol.push([{ text: "🆕 Ya, produk baru", callback_data: `ss:${KONDISI.PRODUK_BARU}:${telegramUserId}` }]);
  }
  tombol.push([
    { text: "✅ Ya, semua", callback_data: `ss:semua:${telegramUserId}` },
    { text: "❌ Batal", callback_data: `ss:batal:${telegramUserId}` },
  ]);

  await kirimPesanDenganTombol(chatId, teksRingkasan, tombol);
}

/**
 * Cek apakah kolom "Stok Online" sudah ada di header Sheets. Kalau belum, TANYA dulu ke admin
 * (bagian 4F poin 3) — jangan diam-diam nambah kolom. Return null berarti "tunggu konfirmasi",
 * caller harus stop.
 * @returns {Promise<number|null>} index kolom (0-based) kalau sudah siap dipakai, null kalau nunggu
 */
async function pastikanKolomStokAda(chatId) {
  const header = await ambilHeader(NAMA_SHEET_STOK);
  const indexAda = header.findIndex((h) => normalisasiHeader(h) === normalisasiHeader(NAMA_KOLOM_STOK_ONLINE));
  if (indexAda !== -1) return indexAda;

  await tandaiSedangMintaKonfirmasiKolom(chatId);
  
  // FIX: Ubah parseMode ke HTML dan pakai tag <b> agar underscore di DATABASE_ACCURATE aman
  await kirimPesanDenganTombol(
    chatId,
    `Kolom "<b>${NAMA_KOLOM_STOK_ONLINE}</b>" belum ada di sheet <b>${NAMA_SHEET_STOK}</b>. Boleh saya tambahkan kolom baru di Sheets?`,
    [
      [
        { text: "✅ Ya, tambahkan", callback_data: `kolom:ya:${chatId}` },
        { text: "❌ Batal", callback_data: `kolom:tidak:${chatId}` },
      ],
    ],
    { parseMode: "HTML" }
  );
  return null;
}

function normalisasiHeader(teks) {
  return String(teks || "").trim().toLowerCase();
}

// Security: sel ditulis dgn valueInputOption USER_ENTERED (Sheets mengeksekusi nilai berawalan
// = + - @). Netralkan dgn prefix apostrof supaya diperlakukan sebagai teks literal. Dipakai utk
// sel STRING yang berasal dari data produk (kode_barang/nama_accurate), bukan utk angka.
function amanUntukSheets(nilai) {
  const s = String(nilai ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/**
 * Bandingkan satu produk: kondisi stok Firestore vs Sheets vs last_synced_value.
 * @returns {{kondisi, produk, stokFirestore, nilaiSheetSekarang, indexKolom} | null} null kalau gak ada beda
 */
function bandingkanNilai(produk, stokFirestore, nilaiSheetSekarang, indexKolom) {
  // Basis kanonik = paritas online (key "ONLINE" di qty_per_gudang, fallback stok_gudang_online
  // utk dokumen lama). Baca field mentah `stok_gudang_online` bisa basi/absen setelah migrasi v5.
  const nilaiFirestore = bacaParitasOnline(stokFirestore);
  // FIX: produk yang belum PERNAH disync (field last_synced_value gak pernah ke-set di
  // dokumen stock-nya, misal stoknya lahir dari kurangiStok/tambahStok biasa bukan
  // buatStokAwal) bikin field ini `undefined`. Firestore MENOLAK nilai `undefined` yang
  // nyelip di dalam array/object nested (beda dari top-level field) — kalau dibiarkan,
  // simpanDraftPerKelompok() bakal gagal nulis draft ke `sync_stok_drafts` (root cause
  // error "Cannot use undefined as a Firestore value"). Normalisasi ke `null` di sini,
  // di titik paling awal item ini dibentuk, biar SEMUA pemakai lanjutannya (ringkasan
  // teks, draft Firestore, dst.) konsisten terima `null`, bukan `undefined`.
  const lastSynced = stokFirestore.last_synced_value ?? null;
  const firestoreBerubah = nilaiFirestore !== lastSynced;
  const sheetBerubah = nilaiSheetSekarang !== lastSynced;

  if (!firestoreBerubah && !sheetBerubah) return null; // gak ada perubahan sama sekali, skip

  let kondisi;
  if (firestoreBerubah && !sheetBerubah) {
    kondisi = KONDISI.SHEETS_KETINGGALAN;
  } else if (!firestoreBerubah && sheetBerubah) {
    kondisi = KONDISI.SHEETS_MANUAL;
  } else if (nilaiFirestore === nilaiSheetSekarang) {
    // dua-duanya "berubah" dari last_synced tapi kebetulan sudah sama sekarang — anggap
    // sudah sinkron, gak perlu dijadikan draft konflik yang bikin admin bingung tanpa alasan
    return null;
  } else {
    kondisi = KONDISI.KONFLIK;
  }

  return {
    kondisi,
    kode_barang: produk.kode_barang,
    nama_accurate: produk.nama_accurate,
    nilai_firestore: nilaiFirestore,
    nilai_sheet: nilaiSheetSekarang,
    last_synced_value: lastSynced,
    index_kolom: indexKolom,
  };
}

function cariBarisSheetByKode(barisSheet, kodeBarang) {
  return barisSheet.find((baris) => String(baris[1] || "").trim() === kodeBarang) || null;
}

/**
 * Simpan tiap kelompok kondisi sebagai satu dokumen draft di `sync_stok_drafts`.
 * Kelompok kosong gak disimpan (gak ada yang perlu direview).
 * @returns {Promise<string[]>} draftIds yang berhasil dibuat
 */
async function simpanDraftPerKelompok(kelompok, indexKolom, telegramUserId) {
  const draftIds = [];

  for (const [kondisi, items] of Object.entries(kelompok)) {
    if (items.length === 0) continue;

    const ref = await db.collection("sync_stok_drafts").add({
      kondisi,
      items,
      index_kolom: indexKolom,
      status: "pending_confirmation",
      // PRD v3b §7.2: penanda kepemilikan (additive). Draft lama tanpa field -> fail-closed.
      owner_user_id: String(telegramUserId),
      created_at: new Date(),
    });
    draftIds.push(ref.id);
  }

  return draftIds;
}

async function simpanPendingSyncStok(telegramUserId, chatId, draftIds) {
  await db
    .collection("sessions")
    .doc(String(telegramUserId))
    .set({ pendingSyncStok: { chatId, draftIds, dibuatPada: new Date() } }, { merge: true });
}

async function cekSedangMintaKonfirmasiKolom(chatId) {
  const doc = await db.collection("sync_stok_state").doc(String(chatId)).get();
  return Boolean(doc.data()?.mintaKonfirmasiKolom);
}

async function tandaiSedangMintaKonfirmasiKolom(chatId) {
  await db.collection("sync_stok_state").doc(String(chatId)).set({ mintaKonfirmasiKolom: true }, { merge: true });
}

async function hapusStatusMintaKonfirmasiKolom(chatId) {
  await db.collection("sync_stok_state").doc(String(chatId)).delete();
}

/**
 * Admin bilang "ya" utk konfirmasi tambah kolom kosong di Sheets. Dipanggil dari
 * router/chatHandler saat ada state mintaKonfirmasiKolom aktif, SEBELUM mulaiSyncStok diulang.
 */
async function konfirmasiTambahKolom(chatId) {
  await tambahKolomHeader(NAMA_SHEET_STOK, NAMA_KOLOM_STOK_ONLINE);
  await hapusStatusMintaKonfirmasiKolom(chatId);
  await kirimPesan(chatId, `Kolom "${NAMA_KOLOM_STOK_ONLINE}" sudah ditambahkan. Coba jalankan /sync_stok lagi ya.`);
}

/**
 * Admin batal nambah kolom (dari tombol ❌ atau jawaban teks "batal"/"tidak").
 */
async function batalkanTambahKolom(chatId) {
  await hapusStatusMintaKonfirmasiKolom(chatId);
  await kirimPesan(chatId, "Oke, gak jadi nambah kolom. Jalankan /sync_stok lagi kalau berubah pikiran.");
}

function susunTeksRingkasanDiff(kelompok) {
  const baris = ["*Ringkasan Sync Stok*\n"];

  if (kelompok[KONDISI.SHEETS_KETINGGALAN].length > 0) {
    baris.push(`🟢 *Sheets ketinggalan* (${kelompok[KONDISI.SHEETS_KETINGGALAN].length}) — aman auto-push:`);
    for (const i of kelompok[KONDISI.SHEETS_KETINGGALAN]) {
      baris.push(`- ${i.nama_accurate}: Firestore ${i.nilai_firestore} → Sheets akan diupdate jadi sama`);
    }
    baris.push("");
  }

  if (kelompok[KONDISI.SHEETS_MANUAL].length > 0) {
    baris.push(`🟡 *Sheets diedit manual* (${kelompok[KONDISI.SHEETS_MANUAL].length}) — perlu klarifikasi:`);
    for (const i of kelompok[KONDISI.SHEETS_MANUAL]) {
      baris.push(`- ${i.nama_accurate}: Sheets ${i.nilai_sheet} vs Firestore ${i.nilai_firestore} (terakhir sepakat: ${i.last_synced_value})`);
    }
    baris.push("");
  }

  if (kelompok[KONDISI.KONFLIK].length > 0) {
    baris.push(`🔴 *Konflik* (${kelompok[KONDISI.KONFLIK].length}) — wajib pilih manual:`);
    for (const i of kelompok[KONDISI.KONFLIK]) {
      baris.push(`- ${i.nama_accurate}: Sheets ${i.nilai_sheet} vs Firestore ${i.nilai_firestore}`);
    }
    baris.push("");
  }

  if (kelompok[KONDISI.PRODUK_BARU].length > 0) {
    baris.push(`🆕 *Produk baru* (${kelompok[KONDISI.PRODUK_BARU].length}) — belum ada barisnya di Sheets:`);
    for (const i of kelompok[KONDISI.PRODUK_BARU]) {
      baris.push(`- ${i.nama_accurate} (${i.kode_barang}): stok ${i.nilai_firestore} → akan dibuatkan baris baru`);
    }
    baris.push("");
  }

  const totalItem =
    kelompok[KONDISI.SHEETS_KETINGGALAN].length +
    kelompok[KONDISI.SHEETS_MANUAL].length +
    kelompok[KONDISI.KONFLIK].length +
    kelompok[KONDISI.PRODUK_BARU].length;

  if (totalItem === 0) {
    return "Semua stok sudah sinkron, gak ada yang perlu disync. 👍";
  }

  baris.push(
    'Balas *ya sheets_ketinggalan* / *ya sheets_manual* / *ya konflik* / *ya produk_baru* buat acc per kelompok (nilai Firestore yang akan ditulis ke Sheets — Firestore selalu jadi acuan), atau *batal* buat gak jadi semua.'
  );
  return baris.join("\n");
}

/**
 * Cek apakah admin ini punya draft sync stok yang lagi ditunggu. Dipanggil sebelum
 * pesan diteruskan ke Gemini, sama pola dengan apakahAdaPendingPickingList (Batch 5).
 * @returns {Promise<boolean>}
 */
async function apakahAdaPendingSyncStok(telegramUserId) {
  const doc = await db.collection("sessions").doc(String(telegramUserId)).get();
  return Boolean(doc.data()?.pendingSyncStok);
}

/**
 * Proses jawaban admin thd draft sync stok. Format jawaban per-kelompok (bagian 4F poin 5):
 *   "ya sheets_ketinggalan" / "ya sheets_manual" / "ya konflik" → acc kelompok itu
 *   "ya semua"  → acc semua kelompok yang masih pending sekaligus
 *   "batal"     → buang semua draft, gak ada yang diapply
 * Firestore SELALU jadi acuan (lihat applyDraft) — jadi buat semua kelompok (termasuk
 * sheets_manual & konflik), nilai Firestore yang ditulis ke Sheets, BUKAN sebaliknya.
 * Kalau ternyata angka Sheets yang benar (misal salah input transaksi ke bot), koreksi
 * dulu di Firestore lewat bot (kurangi/tambah stok), baru /sync_stok ulang.
 *
 * Kontrak v3b §6.1/§6.6: `opsi` boleh OBJEK `{ confirmedBy, kirimNotifikasi, cekGuard }` atau
 * STRING `confirmedBy` (bentuk lama). Semua cabang mengembalikan `{ ok, alasan?, ... }`.
 * `kirimNotifikasi:false` HANYA mematikan pesan; mutasi draft/sesi tetap tanpa syarat.
 *
 * @param {string|number} telegramUserId
 * @param {string} teksJawaban
 * @param {{confirmedBy?: string|number, kirimNotifikasi?: boolean, cekGuard?: boolean}|string|number} [opsi]
 */
async function konfirmasiSyncStok(telegramUserId, teksJawaban, opsi = {}) {
  const { confirmedBy, kirimNotifikasi = true, cekGuard = false } =
    typeof opsi === "string" || typeof opsi === "number" ? { confirmedBy: opsi } : opsi;
  const pelaku = confirmedBy ?? telegramUserId;

  const sessionRef = db.collection("sessions").doc(String(telegramUserId));
  const sessionDoc = await sessionRef.get();
  const pending = sessionDoc.data()?.pendingSyncStok;
  // B3: return eksplisit (dulu `return;` senyap).
  if (!pending) return { ok: false, alasan: "tidak_ada_pending" };

  const { chatId, draftIds } = pending;

  const jawaban = teksJawaban.trim().toLowerCase();

  // B2: guard dicek SEBELUM mutasi apa pun. Bentuk jawaban batal SUDAH pasti valid, jadi
  // guard diperiksa hanya untuk jalur yang akan benar-benar apply (cegah dobel-dashboard).
  const kondisiDipilih = tentukanKondisiDariJawaban(jawaban);
  const jawabanBatal = jawaban === "batal" || jawaban === "tidak" || jawaban === "gak jadi";

  if (cekGuard && (kondisiDipilih || jawabanBatal)) {
    // Kunci guard dashboard = `sync:{draftId}`. Bila dipanggil per-draft spesifik, kunci itu
    // yang dicek; bila "semua"/"batal", cek semua kunci draft dalam sesi.
    const kunciTarget =
      kondisiDipilih && kondisiDipilih !== "semua"
        ? await kunciDraftUntukKondisi(draftIds, kondisiDipilih)
        : draftIds.map((id) => kunciGuard("sync", id));
    try {
      for (const kunci of kunciTarget) {
        if (await guardAktif(db, kunci)) return { ok: false, alasan: "guard_aktif" };
      }
    } catch (e) {
      console.error("[draft_guard_failed]", JSON.stringify({ jenis: "sync", pesan: String(e) }));
    }
  }

  if (jawabanBatal) {
    await hapusSemuaDraft(draftIds);
    await hapusPendingSyncStok(sessionRef);
    if (kirimNotifikasi) await kirimPesan(chatId, "Oke, sync stok dibatalkan. Gak ada yang diubah.");
    return { ok: true, dibatalkan: true };
  }

  if (!kondisiDipilih) {
    if (kirimNotifikasi) {
      await kirimPesan(
        chatId,
        'Format belum kebaca. Balas *ya sheets_ketinggalan* / *ya sheets_manual* / *ya konflik* / *ya semua*, atau *batal*.',
        { parseMode: "Markdown" }
      );
    }
    return { ok: false, alasan: "format_tak_dikenal" };
  }

  const drafts = await ambilDraftByIds(draftIds);
  const draftDiproses = kondisiDipilih === "semua" ? drafts : drafts.filter((d) => d.kondisi === kondisiDipilih);

  if (draftDiproses.length === 0) {
    if (kirimNotifikasi) await kirimPesan(chatId, "Gak ada draft dengan kelompok itu yang lagi pending.");
    return { ok: false, alasan: "kondisi_kosong" };
  }

  let jumlahItemDiproses = 0;
  for (const draft of draftDiproses) {
    jumlahItemDiproses += await applyDraft(draft, telegramUserId, pelaku);
  }

  const draftIdsSelesai = draftDiproses.map((d) => d.id);
  const draftIdsSisa = draftIds.filter((id) => !draftIdsSelesai.includes(id));

  if (draftIdsSisa.length === 0) {
    await hapusPendingSyncStok(sessionRef);
  } else {
    await sessionRef.set({ pendingSyncStok: { ...pending, draftIds: draftIdsSisa } }, { merge: true });
  }

  if (kirimNotifikasi) {
    await kirimPesan(
      chatId,
      `✅ ${jumlahItemDiproses} item disinkronkan.${draftIdsSisa.length > 0 ? " Masih ada kelompok lain yang nunggu konfirmasi." : ""}`
    );
  }

  return { ok: true, diproses: jumlahItemDiproses, sisa: draftIdsSisa.length };
}

// Kunci guard `sync:{draftId}` milik kelompok kondisi tertentu (dipakai cekGuard).
async function kunciDraftUntukKondisi(draftIds, kondisi) {
  const hasil = [];
  for (const id of draftIds) {
    const doc = await db.collection("sync_stok_drafts").doc(id).get();
    if (doc.exists && doc.data()?.kondisi === kondisi) hasil.push(kunciGuard("sync", id));
  }
  return hasil;
}

function tentukanKondisiDariJawaban(jawaban) {
  if (jawaban === "ya semua") return "semua";
  if (jawaban === `ya ${KONDISI.SHEETS_KETINGGALAN}`) return KONDISI.SHEETS_KETINGGALAN;
  if (jawaban === `ya ${KONDISI.SHEETS_MANUAL}`) return KONDISI.SHEETS_MANUAL;
  if (jawaban === `ya ${KONDISI.KONFLIK}`) return KONDISI.KONFLIK;
  if (jawaban === `ya ${KONDISI.PRODUK_BARU}`) return KONDISI.PRODUK_BARU;
  return null;
}

async function ambilDraftByIds(draftIds) {
  const hasil = [];
  for (const id of draftIds) {
    const doc = await db.collection("sync_stok_drafts").doc(id).get();
    if (doc.exists) hasil.push({ id: doc.id, ...doc.data() });
  }
  return hasil;
}

/**
 * Apply satu draft (satu kelompok kondisi): update Sheets biar sama dengan Firestore,
 * refresh last_synced_at/last_synced_value, catat stock_movements type "sync_confirmed"
 * (bagian 4F poin 6 — jejak audit kapan & gimana tiap perbedaan diselesaikan).
 *
 * Firestore SELALU dianggap benar (tiap transaksi barang masuk/keluar lapor ke bot dulu,
 * Sheets cuma jendela tampilan) — jadi arah resolusi buat SEMUA kondisi (sheets_ketinggalan,
 * sheets_manual, konflik) adalah sama: nilai Firestore yang menang, ditulis ke Sheets.
 * Kelompok sheets_manual/konflik tetap dipisah di ringkasan bukan buat nentuin siapa yang
 * benar, tapi buat kasih tau admin ada perubahan manual di Sheets yang bakal ditimpa balik.
 */
async function applyDraft(draft, telegramUserId, confirmedBy = telegramUserId) {
  if (draft.kondisi === KONDISI.PRODUK_BARU) {
    // applyDraftProdukBaru sudah menandai draft `processed` + menulis pushed_items di akhir.
    return applyDraftProdukBaru(draft, telegramUserId, confirmedBy);
  }

  const nilaiSheetBaru = [];
  // T4 (B3): idempotensi. Dua lapis yang saling melengkapi:
  //  - `pushed_items[]` = optimisasi skip (jangan ulang kerja yang sudah beres).
  //  - `id_movement` deterministik = JAMINAN anti-dobel (retry menimpa movement, bukan menambah).
  // Window crash antara movement & marker gak lagi fatal: retry menulis movement ke id yang sama.
  const sudahDipush = new Set(draft.pushed_items || []);
  const kodeBaruDipush = [];

  for (const item of draft.items) {
    if (sudahDipush.has(item.kode_barang)) continue; // sudah diproses di attempt sebelumnya

    const nilaiFinal = item.nilai_firestore;
    const resolvedBy = "firestore";

    const produk = await ambilProdukByKode(item.kode_barang);
    if (produk) {
      await tandaiTersinkron(item.kode_barang, nilaiFinal);
    }

    // qty = DELTA bertanda (nilai baru - stok sebelum sync). tandaiTersinkron tidak mengubah
    // stok gudang online, jadi stok sebelum = paritas online saat ini. Pakai bacaParitasOnline
    // (bukan field mentah) supaya konsisten dgn basis kanonik & dokumen lama.
    const stokSebelum = bacaParitasOnline((await ambilStok(item.kode_barang)) || {});

    await catatPergerakanStok({
      kode_barang: item.kode_barang,
      nama_terbaca: item.nama_accurate,
      variasi: "-",
      qty: nilaiFinal - stokSebelum,
      type: "sync_confirmed",
      resolved_by: resolvedBy,
      action_type: "kurangi_stok", // gak relevan sebenarnya utk sync, tapi field wajib di skema — pakai netral
      source: "sync",
      status: "processed",
      created_by: confirmedBy,
      requested_by: telegramUserId,
      confirmed_by: confirmedBy,
      id_movement: `sync_${draft.id}_${item.kode_barang}`,
    });

    nilaiSheetBaru.push({ kode_barang: item.kode_barang, nilai: nilaiFinal, indexKolom: item.index_kolom });
    kodeBaruDipush.push(item.kode_barang);
  }

  await pushNilaiKeSheet(nilaiSheetBaru);
  // Satu update: catat item yang baru dipush (utk idempotensi retry) + tandai draft selesai.
  await db
    .collection("sync_stok_drafts")
    .doc(draft.id)
    .update({
      status: "processed",
      ...(kodeBaruDipush.length > 0 ? { pushed_items: FieldValue.arrayUnion(...kodeBaruDipush) } : {}),
    });
  return kodeBaruDipush.length; // jumlah item yang BENAR-BENAR diproses (retry skip yang sudah dipush)
}

/**
 * Kondisi PRODUK_BARU: produk ada di Firestore tapi barisnya belum ada di Sheets sama
 * sekali (biasanya baru didaftarkan lewat chat) — jadi bukan UPDATE baris, tapi INSERT baris
 * baru di akhir sheet. Kolom yang diisi cuma yang kita punya datanya (kode, nama, hpp, stok);
 * kolom lain (No, HPP Baru, is_online, dst) sengaja dikosongkan biar admin isi manual kalau
 * perlu — jangan nebak-nebak nilai yang gak ada sumbernya.
 */
async function applyDraftProdukBaru(draft, telegramUserId, confirmedBy = telegramUserId) {
  // R2: idempoten via `pushed_items[]` sama seperti applyDraft — retry "ya produk_baru"
  // tidak bikin baris ganda untuk kode yang sudah dipush di attempt sebelumnya.
  const sudahDipush = new Set(draft.pushed_items || []);
  const kodeBaruDipush = [];
  let nomorTerakhir = ""; // fallback nomor kalau bacaRange gagal (best-effort, jangan gagalkan insert)

  for (const item of draft.items) {
    if (sudahDipush.has(item.kode_barang)) continue; // sudah diproses di attempt sebelumnya

    // B4/R3: isi kolom A (No). Baca ulang `A2:A` TEPAT sebelum tiap append supaya nomor
    // dihitung dari kondisi terkini (memperkecil — bukan hilangkan — jendela race).
    // ponytail: baca-lalu-append tetap TIDAK atomik -> dua append paralel bisa dapat No sama;
    // No cuma kosmetik, terima. 1 read ekstra per item, tapi produk_baru biasanya sedikit.
    // Upgrade kalau race jadi masalah: kosongkan No (biar admin) atau pakai formula `=ROW()-1`.
    // Gagal baca JANGAN menggagalkan insert: pakai nomor hasil hitung sebelumnya (best-effort).
    let nomor = nomorTerakhir;
    try {
      const kolomA = await bacaRange(`${NAMA_SHEET_STOK}!A2:A`);
      nomor = kolomA.filter((baris) => String(baris[0] ?? "").trim() !== "").length + 1;
      nomorTerakhir = nomor;
    } catch (e) {
      // MINOR (security): jangan log pesan error mentah (bisa memuat spreadsheet id/range).
      console.error("[sync_stok_produk_baru] bacaRange A2:A gagal, fallback nomor");
    }

    const panjangBaris = Math.max(item.index_kolom + 1, 4); // minimal sampai kolom D (HPP)
    const row = new Array(panjangBaris).fill("");
    row[0] = nomor; // kolom A: No (urut)
    row[1] = amanUntukSheets(item.kode_barang); // kolom B: Kode Barang
    row[2] = amanUntukSheets(item.nama_accurate); // kolom C: Nama Accurate
    if (item.hpp !== null && item.hpp !== undefined) row[3] = item.hpp; // kolom D: HPP/unit
    row[item.index_kolom] = item.nilai_firestore; // kolom Stok Online (index dinamis)

    // Residual window (didokumentasikan, TIDAK ditutup): crash setelah tambahBarisBaru tapi
    // sebelum marker `pushed_items` ditulis -> retry bisa tetap bikin baris ganda, karena
    // insert baris Sheets tak punya key natural (tak bisa dedup by key). Yang DIJAMIN: movement
    // pakai id_movement deterministik, jadi `stock_movements` tetap tak dobel.
    await tambahBarisBaru(NAMA_SHEET_STOK, row);

    const produk = await ambilProdukByKode(item.kode_barang);
    if (produk) {
      await tandaiTersinkron(item.kode_barang, item.nilai_firestore);
    }

    // qty = DELTA bertanda. Produk baru biasanya belum punya dokumen stok sebelumnya → 0.
    const stokSebelum = bacaParitasOnline((await ambilStok(item.kode_barang)) || {});

    await catatPergerakanStok({
      kode_barang: item.kode_barang,
      nama_terbaca: item.nama_accurate,
      variasi: "-",
      qty: item.nilai_firestore - stokSebelum,
      type: "sync_confirmed",
      resolved_by: "firestore",
      action_type: "kurangi_stok", // field wajib di skema, gak relevan utk sync — pakai netral
      source: "sync",
      catatan: "baris baru dibuat di Sheets (produk belum pernah punya baris)",
      status: "processed",
      created_by: confirmedBy,
      requested_by: telegramUserId,
      confirmed_by: confirmedBy,
      id_movement: `sync_${draft.id}_${item.kode_barang}`,
    });

    kodeBaruDipush.push(item.kode_barang);
  }

  // Satu update di akhir: tandai draft selesai + catat item yang sukses (utk idempotensi retry).
  await db
    .collection("sync_stok_drafts")
    .doc(draft.id)
    .update({
      status: "processed",
      ...(kodeBaruDipush.length > 0 ? { pushed_items: FieldValue.arrayUnion(...kodeBaruDipush) } : {}),
    });

  return kodeBaruDipush.length; // jumlah yang BENAR-BENAR diproses (retry skip yang sudah dipush)
}

/**
 * Tulis nilai stok final ke Sheets satu-satu per baris (bukan batch update range) karena
 * baris tiap produk gak selalu berurutan/berdekatan di sheet — lebih aman per-cell.
 */
async function pushNilaiKeSheet(items) {
  const barisSheet = await bacaRange(`${NAMA_SHEET_STOK}!A2:B`); // cukup kolom kode_barang utk cari row index
  for (const item of items) {
    const rowIndex = barisSheet.findIndex((b) => String(b[1] || "").trim() === item.kode_barang);
    if (rowIndex === -1) continue; // produk gak ketemu di sheet, skip (jangan gagal total)
    const nomorBarisSheet = rowIndex + 2; // +2: offset header (baris 1) + 0-based → 1-based
    const hurufKolom = angkaKeHurufKolom(item.indexKolom);
    await tulisRange(`${NAMA_SHEET_STOK}!${hurufKolom}${nomorBarisSheet}`, [[item.nilai]]);
  }
}

async function hapusSemuaDraft(draftIds) {
  for (const id of draftIds) {
    await db.collection("sync_stok_drafts").doc(id).update({ status: "dibatalkan" });
  }
}

async function hapusPendingSyncStok(sessionRef) {
  await sessionRef.update({ pendingSyncStok: FieldValue.delete() });
}

/**
 * Cek apakah chat ini lagi ditunggu jawaban "boleh tambah kolom Stok Online?" (bagian
 * 4F poin 3). Dipakai routePesan.js SEBELUM cek pendingSyncStok/pesan biasa — beda dari
 * pendingSyncStok krn state ini keyed per chatId (`sync_stok_state`), bukan per
 * telegramUserId, dan dibuat SEBELUM draft sync ada (mulaiSyncStok berhenti duluan di
 * pastikanKolomStokAda kalau kolom belum ada).
 * @param {string|number} chatId
 * @returns {Promise<boolean>}
 */
async function apakahMintaKonfirmasiKolom(chatId) {
  return cekSedangMintaKonfirmasiKolom(chatId);
}

module.exports = {
  mulaiSyncStok,
  konfirmasiTambahKolom,
  batalkanTambahKolom,
  konfirmasiSyncStok,
  apakahAdaPendingSyncStok,
  apakahMintaKonfirmasiKolom,
  KONDISI,
};