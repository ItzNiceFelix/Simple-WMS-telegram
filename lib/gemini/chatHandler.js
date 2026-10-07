// lib/gemini/chatHandler.js
// Orchestrator utk pesan teks biasa dari admin.
//
// Alur lengkap (REWRITE — prioritas kolam produk online, lihat cariProdukPintar.js):
// 1. Cek dulu sessions.pendingKonfirmasiCakupan — kalau ada, pesan ini jawaban tombol
//    "cari di semua produk / batal" dari giliran sebelumnya. Ditangani DULUAN, sebelum
//    pendingAction, krn ini state paling "muda" dalam rangkaian alur resolusi produk.
// 2. Cek sessions.pendingAction — jawaban ya/tidak thd usulan kurangiStok/tambahStok.
// 3. Kalau kosong dua-duanya, kirim ke Gemini+TOOLS.
// 4. Loop tool call:
//    - cekProdukStokMenipis → read-only biasa, balik ke Gemini, lanjut loop.
//    - mulaiOpname → delegasikan ke handleOpname(), STOP loop.
//    - cariProduk/cekStok/kurangiStok/tambahStok → SEMUA lewat resolusiProduk() dulu:
//        - Kalau function call kurangiStok/tambahStok LEBIH DARI 1 dalam giliran yang
//          sama (batch, misal admin kirim daftar banyak produk sekaligus) → jalur BATCH
//          (lihat tanganiToolResolusiProdukBatch di bawah): tiap item di-resolve satu-satu,
//          yang "jelas" ketemu dikumpulkan, yang "ragu"/gak ketemu di-SKIP & dilaporkan di
//          ringkasan (bukan memblokir item lain) — pola sama seperti konfirmasiPickingList.js.
//          Hasil akhirnya 1 ringkasan konfirmasi utk semua item (pendingBatchAction), STOP loop.
//        - Kalau cuma 1 function call kurangiStok/tambahStok/cariProduk/cekStok (jalur lama,
//          TIDAK berubah) → perluKonfirmasiCakupan / status "ragu" → TERMINAL, simpan
//          pendingKonfirmasiCakupan (utk "ragu", tombol pilih kandidat; utk cakupan,
//          tombol cari-semua/batal), STOP loop.
//        - status "jelas" → lanjut sesuai tool: cariProduk/cekStok balik ke Gemini
//          sbg functionResponse; kurangiStok/tambahStok lanjut ke tahanUntukKonfirmasi
//          (pendingAction, TUNGGAL — dipakai kalau memang cuma 1 item di batch itu), STOP loop.
//    - Tidak ada tool call lagi → balasan teks final dari Gemini, kirim ke admin.

const { generateContentDenganFallback } = require("./client");
const { SYSTEM_PROMPT } = require("./promptSystem");
const {
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
} = require("./tools");
const { cariProdukSemuaKatalog } = require("../matching/cariProdukPintar");
const { tandaiSebagaiProdukOnline, ambilProdukByKode, simpanProduk } = require("../models/produk");
const { ambilSessionAktif, tambahPesanKeSession } = require("../models/sessions");
const { kirimPesan, kirimPesanDenganTombol, editPesan, hapusPesan } = require("../telegram/kirimPesan");
const { kurangiStok, tambahStok, buatStokAwal } = require("../models/stok");
const { catatPergerakanStok } = require("../models/stockMovements");
const { handleOpname } = require("../handlers/handleOpname");
const { apakahKenaRateLimit } = require("./rateLimit");

// TODO housekeeping (sudah dicatat di skema, belum dikerjakan): akses
// pendingAction/pendingKonfirmasiCakupan di sini masih langsung pakai `db` dari
// lib/firebase.js, belum lewat lib/models/sessions.js.
const { db } = require("../firebase");
const admin = require("firebase-admin");

const MAKS_LOOP_TOOL_CALL = 5; // jaga-jaga cegah loop tak berujung antar tool call

const JAWABAN_YA = ["ya", "iya", "y", "ok", "oke", "yaudah", "gas", "lanjut"];
const JAWABAN_TIDAK = ["tidak", "gak", "ga", "batal", "cancel", "jangan"];

async function mulaiStatus(chatId, teks) {
  try {
    const hasil = await kirimPesan(chatId, teks);
    return hasil?.ok ? hasil.result?.message_id : null;
  } catch (err) {
    console.error("Gagal mengirim pesan status:", err);
    return null;
  }
}

async function ubahStatus(chatId, messageId, teks) {
  if (!messageId) return;
  try {
    await editPesan(chatId, messageId, teks);
  } catch (err) {
    console.error("Gagal memperbarui pesan status:", err);
  }
}

async function hapusStatus(chatId, messageId) {
  if (!messageId) return;
  try {
    await hapusPesan(chatId, messageId);
  } catch (err) {
    console.error("Gagal menghapus pesan status:", err);
  }
}

async function selesaikanStatus(chatId, messageId, teks) {
  if (!messageId) return false;
  try {
    const hasil = await editPesan(chatId, messageId, teks);
    if (hasil?.ok) return true;
  } catch (err) {
    console.error("Gagal mengubah pesan status menjadi jawaban:", err);
  }
  await hapusStatus(chatId, messageId);
  return false;
}

/**
 * Entry point dipanggil dari routePesan.js utk pesan teks biasa (bukan command,
 * bukan screenshot) dari admin yang sudah lolos gating akses.
 * @param {object} ctx - { telegramUserId, chatId, teksPesan }
 */
async function handleChatBiasa(ctx) {
  const { telegramUserId, chatId, teksPesan } = ctx;

  // Soft guard kuota AI (in-memory, per warm instance — lihat lib/gemini/rateLimit.js).
  if (apakahKenaRateLimit(telegramUserId)) {
    await kirimPesan(chatId, "Kebanyakan permintaan dalam waktu singkat, coba lagi sebentar ya 🙏");
    return;
  }

  const session = await ambilSessionAktif(telegramUserId);

  // 1. Ada pendingKonfirmasiCakupan (jawaban tombol "cari di semua/pilih kandidat/batal")?
  if (session.pendingKonfirmasiCakupan) {
    await prosesJawabanPendingKonfirmasiCakupan({
      telegramUserId,
      chatId,
      teksPesan,
      pending: session.pendingKonfirmasiCakupan,
    });
    return;
  }

  // 2. Ada pendingBatchAction (usulan kurangiStok/tambahStok BANYAK produk sekaligus)
  //    nunggu jawaban? Dicek SEBELUM pendingAction tunggal — dua-duanya gak akan pernah
  //    hidup bersamaan di 1 session (lihat tanganiToolResolusiProdukBatch), tapi urutan
  //    ini dijaga biar konsisten sama urutan "state paling muda duluan" di komentar atas.
  if (session.pendingBatchAction) {
    await prosesJawabanPendingBatchAction({
      telegramUserId,
      chatId,
      teksPesan,
      pendingBatchAction: session.pendingBatchAction,
    });
    return;
  }

  // 3. Ada pendingAction (usulan kurangiStok/tambahStok utk 1 produk) nunggu jawaban?
  if (session.pendingAction) {
    await prosesJawabanPendingAction({ telegramUserId, chatId, teksPesan, pendingAction: session.pendingAction });
    return;
  }

  // 4. Chat biasa ke Gemini
  await tambahPesanKeSession(telegramUserId, "user", teksPesan);
  const sessionTerbaru = await ambilSessionAktif(telegramUserId);

  // Kelola contents manual (bukan model.startChat()) karena SDK @google/generative-ai
  // otomatis kasih role "function" utk functionResponse, yang DITOLAK endpoint Gemini
  // saat ini (cuma terima USER/MODEL). Jadi functionResponse dikirim dgn role "user" eksplisit.
  const contents = [
    ...bentukHistoryUntukGemini(sessionTerbaru.history),
    { role: "user", parts: [{ text: teksPesan }] },
  ];

  const statusMessageId = await mulaiStatus(chatId, "Sedang memproses permintaan...");
  await ubahStatus(chatId, statusMessageId, "Sedang menunggu respons AI...");

  let hasil;
  try {
    hasil = await generateContentDenganFallback({ tools: TOOLS, systemInstruction: SYSTEM_PROMPT, contents });
  } catch (err) {
    console.error("Gemini generateContent error:", err);
    const teksError = "Maaf, lagi ada gangguan ke AI-nya. Coba lagi sebentar ya.";
    if (!(await selesaikanStatus(chatId, statusMessageId, teksError))) {
      await kirimPesan(chatId, teksError);
    }
    return;
  }

  let loopKe = 0;
  while (loopKe < MAKS_LOOP_TOOL_CALL) {
    loopKe += 1;
    const panggilanFungsi = ambilFunctionCalls(hasil);

    if (!panggilanFungsi.length) {
      // Tidak ada tool call lagi → ini balasan teks final
      const teksBalasan = hasil.response.text();
      contents.push({ role: "model", parts: [{ text: teksBalasan }] });
      await tambahPesanKeSession(telegramUserId, "model", teksBalasan);
      if (!(await selesaikanStatus(chatId, statusMessageId, teksBalasan))) {
        await kirimPesan(chatId, teksBalasan);
      }
      return;
    }

    const kandidat = hasil.response.candidates || [];
    const partsModelIni = kandidat[0]?.content?.parts || [];
    // Defensive: parts dari Gemini seharusnya array non-empty kalau ada functionCall,
    // tapi kalau somehow kosong/undefined, isi fallback kosong [] — bukan push data
    // malformed yang bisa bikin round-trip berikutnya ditolak API.
    const partsAman = Array.isArray(partsModelIni) ? partsModelIni : [];
    contents.push({ role: "model", parts: partsAman });

    // Pisahkan tool call jadi kelompok, urutan prioritas: resolusi-produk dulu
    // (paling sering & paling perlu jalur khusus), lalu terminal, lalu konfirmasi.
    //
    // BATCH: kalau ADA LEBIH DARI 1 function call kurangiStok/tambahStok dalam giliran
    // yang sama (admin kirim daftar banyak produk sekaligus), SEMUA-nya diproses lewat
    // jalur batch — bukan cuma yang pertama seperti sebelumnya. cariProduk/cekStok TIDAK
    // ikut batch (murni info, jarang dipanggil berkali-kali sekaligus, dan hasil akhirnya
    // beda bentuk dari konfirmasi ubah stok) — kalau nyelip di giliran yang sama, tetap
    // ditangani lewat jalur tunggal seperti biasa.
    const fcListResolusiProduk = panggilanFungsi.filter((fc) => TOOL_BUTUH_RESOLUSI_PRODUK.has(fc.name));
    const fcBatchArray = fcListResolusiProduk.find(
      (fc) => fc.name === "kurangiStokBatch" || fc.name === "tambahStokBatch"
    );
    if (fcBatchArray) {
      const daftarFcBatch = Array.isArray(fcBatchArray.args?.items)
        ? fcBatchArray.args.items.map((item) => ({
            name: fcBatchArray.name === "kurangiStokBatch" ? "kurangiStok" : "tambahStok",
            args: item,
          }))
        : [];
      if (daftarFcBatch.length === 0) {
        const teksBatchKosong = "Daftar produknya belum terbaca. Kirim nama produk dan qty untuk tiap item ya.";
        await hapusStatus(chatId, statusMessageId);
        await kirimPesan(chatId, teksBatchKosong);
        await tambahPesanKeSession(telegramUserId, "model", teksBatchKosong);
        return;
      }
      await hapusStatus(chatId, statusMessageId);
      await tanganiToolResolusiProdukBatch({ telegramUserId, chatId, daftarFc: daftarFcBatch });
      return;
    }
    const fcBatchable = fcListResolusiProduk.filter((fc) => fc.name === "kurangiStok" || fc.name === "tambahStok");

    if (fcBatchable.length > 1) {
      await hapusStatus(chatId, statusMessageId);
      await tanganiToolResolusiProdukBatch({ telegramUserId, chatId, daftarFc: fcBatchable });
      return;
    }

    if (fcListResolusiProduk.length >= 1) {
      // Cuma 1 tool call resolusi-produk di giliran ini (baik itu cariProduk/cekStok,
      // atau kurangiStok/tambahStok sendirian) → jalur lama, tidak berubah.
      await hapusStatus(chatId, statusMessageId);
      await tanganiToolResolusiProduk({ telegramUserId, chatId, fc: fcListResolusiProduk[0] });
      return;
    }

    const fcTerminal = panggilanFungsi.find((fc) => TOOL_TERMINAL_LANGSUNG.has(fc.name));
    if (fcTerminal) {
      await hapusStatus(chatId, statusMessageId);
      await tanganiToolTerminal({ telegramUserId, chatId, fc: fcTerminal });
      return;
    }

    // Sisa tool call di batch ini read-only sederhana → eksekusi semua, kirim balik
    // ke Gemini dengan role "user" (BUKAN "function" — lihat catatan di atas).
    const responFungsi = [];
    for (const fc of panggilanFungsi) {
      try {
        const hasilFn = await jalankanToolReadOnly(fc.name, fc.args || {});
        responFungsi.push({ name: fc.name, response: hasilFn });
      } catch (err) {
        console.error(`Error jalankan tool ${fc.name}:`, err);
        responFungsi.push({ name: fc.name, response: { error: String(err.message || err) } });
      }
    }

    contents.push({
      role: "user",
      parts: responFungsi.map((r) => ({ functionResponse: { name: r.name, response: r.response } })),
    });

    try {
      await ubahStatus(chatId, statusMessageId, "Sedang mengecek data...");
      hasil = await generateContentDenganFallback({ tools: TOOLS, systemInstruction: SYSTEM_PROMPT, contents });
    } catch (err) {
      console.error("Gemini generateContent (function response) error:", err);
      const teksError = "Maaf, lagi ada gangguan ke AI-nya. Coba lagi sebentar ya.";
      if (!(await selesaikanStatus(chatId, statusMessageId, teksError))) {
        await kirimPesan(chatId, teksError);
      }
      return;
    }
  }

  // Kalau sampai sini, loop tool call kebanyakan — jaga-jaga
  const teksLoopPanjang = "Maaf, prosesnya kepanjangan (banyak tool call berantai). Coba pertanyaan lebih spesifik ya.";
  if (!(await selesaikanStatus(chatId, statusMessageId, teksLoopPanjang))) {
    await kirimPesan(chatId, teksLoopPanjang);
  }
}

// ---------- Helper: tool yang butuh resolusi nama→produk ----------

/**
 * Titik masuk utk cariProduk/cekStok/kurangiStok/tambahStok. SELALU resolve produk
 * dulu lewat cariProdukPintar (prioritas kolam online), baru lanjut sesuai hasil.
 * Ini SELALU terminal di titik pertama (STOP loop Gemini) — baik yang berhasil "jelas"
 * maupun yang perlu konfirmasi lanjutan — karena setelah ini giliran berikutnya
 * ditangani sbg jawaban pending, bukan balik ke Gemini dalam loop yang sama. Ini
 * konsisten dgn pola mulaiOpname (tool terminal lain) dan menyederhanakan alur.
 */
async function tanganiToolResolusiProduk({ telegramUserId, chatId, fc }) {
  const { namaProduk, qty, alasan } = fc.args || {};

  if (!namaProduk || !namaProduk.trim()) {
    const teksKosong = "Nama produknya apa ya? Boleh sebutin lagi 🙂";
    await kirimPesan(chatId, teksKosong);
    await tambahPesanKeSession(telegramUserId, "model", teksKosong);
    return;
  }

  // Aksi lanjutan yang mau dilakukan SETELAH produk ketemu — dibawa terus lewat
  // seluruh rangkaian state (termasuk kalau nanti perlu expand ke full katalog).
  const rencanaLanjutan = { tool: fc.name, namaProduk, qty: qty || null, alasan: alasan || null };

  const hasilResolusi = await resolusiProduk(namaProduk);
  await tindakLanjutiHasilResolusi({ telegramUserId, chatId, hasilResolusi, rencanaLanjutan });
}

/**
 * Dipakai baik dari tanganiToolResolusiProduk() (resolusi pertama, kolam online) maupun
 * dari prosesJawabanPendingKonfirmasiCakupan() (setelah expand ke full katalog) — logic
 * "apa yang dilakukan dgn hasil resolusi" SAMA di kedua kasus, cuma sumber datanya beda.
 * @param {object} params
 * @param {object} params.hasilResolusi - dari cariProdukPintar() atau cariProdukSemuaKatalog()
 * @param {object} params.rencanaLanjutan - { tool, namaProduk, qty, alasan }
 * @param {boolean} [params.sudahExpand] - true kalau hasilResolusi ini dari full katalog
 */
async function tindakLanjutiHasilResolusi({ telegramUserId, chatId, hasilResolusi, rencanaLanjutan, sudahExpand = false }) {
  // Kasus 1: gak ketemu sama sekali di kolam online → tawarkan expand ke full katalog.
  if (hasilResolusi.perluKonfirmasiCakupan) {
    await simpanPendingKonfirmasiCakupan(telegramUserId, {
      tahap: "tanya_cakupan",
      rencanaLanjutan,
      kataKunci: hasilResolusi.kataKunci,
    });
    const teksCakupan = `Gak ketemu *${rencanaLanjutan.namaProduk}* di daftar produk online. Mau dicari di semua produk (termasuk yang belum online)?`;
    await kirimPesanDenganTombol(chatId, teksCakupan, [
      [
        { text: "🔍 Cari di semua produk", callback_data: `cp:cari:${telegramUserId}` },
        { text: "❌ Batal", callback_data: `cp:batal:${telegramUserId}` },
      ],
    ]);
    await tambahPesanKeSession(telegramUserId, "model", teksCakupan);
    return;
  }

  // Kasus 2: ragu (beberapa kandidat mirip) → tampilkan pilihan, admin balas nomor/nama.
  if (hasilResolusi.status === "ragu") {
    await simpanPendingKonfirmasiCakupan(telegramUserId, {
      tahap: "pilih_kandidat",
      rencanaLanjutan,
      kandidat: hasilResolusi.kandidat.map((k) => ({
        kode_barang: k.produk.kode_barang,
        nama_accurate: k.produk.nama_accurate,
      })),
      sudahExpand,
    });
    const daftarTeks = hasilResolusi.kandidat
      .map((k, i) => `${i + 1}. ${k.produk.nama_accurate} (${k.produk.kode_barang})`)
      .join("\n");
    const teksRagu = `Ada beberapa produk mirip *${rencanaLanjutan.namaProduk}*, maksudnya yang mana ya?\n\n${daftarTeks}\n\nBalas nomornya, atau *batal*.`;
    await kirimPesan(chatId, teksRagu, { parseMode: "Markdown" });
    await tambahPesanKeSession(telegramUserId, "model", teksRagu);
    return;
  }

  // Kasus 3: gak ketemu bahkan setelah expand full katalog → mentok, gak bisa lanjut
  // otomatis (nambah produk baru dari nol butuh data lengkap: HPP dll, di luar scope chat).
  if (hasilResolusi.status === "tidak_ketemu") {
    await hapusPendingKonfirmasiCakupanDariSession(telegramUserId);
    const teksTidakKetemu =
      `Gak ketemu *${rencanaLanjutan.namaProduk}* sama sekali di database produk. Kalau ini memang ` +
      `produk baru, bisa langsung didaftarkan lewat chat juga — bilang aja "tambah produk baru ` +
      `${rencanaLanjutan.namaProduk}, kode barangnya ...".`;
    await kirimPesan(chatId, teksTidakKetemu, { parseMode: "Markdown" });
    await tambahPesanKeSession(telegramUserId, "model", teksTidakKetemu);
    return;
  }

  // Kasus 4: "jelas" — produk pasti ketemu, lanjut sesuai tool asalnya.
  await lanjutkanSetelahProdukKetemu({ telegramUserId, chatId, produk: hasilResolusi.produkTerpilih, rencanaLanjutan, sudahExpand });
}

/**
 * Produk sudah pasti ketemu (status "jelas") — lanjut sesuai tool yang tadinya diminta.
 * Kalau hasil dari expand full katalog DAN produk itu belum online, tambahkan tombol
 * ekstra "tandai online juga" di pesan konfirmasi (khusus jalur kurangiStok/tambahStok,
 * krn cariProduk/cekStok murni info, gak perlu nawarin tag).
 */
async function lanjutkanSetelahProdukKetemu({ telegramUserId, chatId, produk, rencanaLanjutan, sudahExpand }) {
  await hapusPendingKonfirmasiCakupanDariSession(telegramUserId);

  const { tool, qty, alasan } = rencanaLanjutan;
  const perluTawarkanTagOnline = sudahExpand && !produk.is_online_product;

  if (tool === "cariProduk") {
    const teks =
      `*${produk.nama_accurate}* (${produk.kode_barang})\n` +
      `HPP: ${produk.hpp ?? "-"}\n` +
      (produk.is_online_product ? "Status: sudah online ✅" : "Status: belum online");
    await kirimPesan(chatId, teks, { parseMode: "Markdown" });
    await tambahPesanKeSession(telegramUserId, "model", teks);
    return;
  }

  if (tool === "cekStok") {
    const hasilStok = await ambilStokProduk(produk.kode_barang);
    const teks = hasilStok.ditemukan
      ? `*${produk.nama_accurate}*: stok gudang online ${hasilStok.stok_gudang_online}`
      : `*${produk.nama_accurate}* belum punya catatan stok gudang online.`;
    await kirimPesan(chatId, teks, { parseMode: "Markdown" });
    await tambahPesanKeSession(telegramUserId, "model", teks);
    return;
  }

  if (tool === "kurangiStok" || tool === "tambahStok") {
    if (!qty || qty <= 0) {
      const teksQtyKosong = "Qty-nya berapa ya? Boleh sebutin lagi 🙂";
      await kirimPesan(chatId, teksQtyKosong);
      await tambahPesanKeSession(telegramUserId, "model", teksQtyKosong);
      return;
    }
    await tahanUntukKonfirmasi({
      telegramUserId,
      chatId,
      jenis: tool,
      kodeBarang: produk.kode_barang,
      namaProduk: produk.nama_accurate,
      qty,
      alasan,
      tawarkanTagOnline: perluTawarkanTagOnline,
    });
    return;
  }

  console.error(`Tool resolusi produk belum ditangani lanjutannya: ${tool}`);
  const teksFallback1 = "Maaf, ada fitur belum siap. Coba cara lain dulu ya.";
  await kirimPesan(chatId, teksFallback1);
  await tambahPesanKeSession(telegramUserId, "model", teksFallback1);
}

// ---------- Helper: BATCH kurangiStok/tambahStok (banyak produk dalam 1 pesan) ----------

/**
 * Titik masuk utk batch kurangiStok/tambahStok (>1 function call sejenis dalam giliran
 * yang sama). Resolve TIAP item satu-satu lewat cariProdukPintar (kolam online dulu,
 * sama seperti jalur tunggal) — tapi TIDAK menawarkan expand-ke-full-katalog atau
 * pilih-kandidat per item di sini (itu butuh interaksi bergilir per produk, gak cocok
 * dibungkus 1 konfirmasi batch). Item yang gak "jelas" (ragu / gak ketemu di kolam
 * online) di-SKIP, dilaporkan di ringkasan — admin bisa proses manual satu-satu lewat
 * chat biasa setelahnya (situ baru masuk jalur tunggal yang lengkap dgn expand/kandidat).
 */
async function tanganiToolResolusiProdukBatch({ telegramUserId, chatId, daftarFc }) {
  const jelasItems = []; // { jenis, kodeBarang, namaProduk, qty, alasan }
  const dilewati = []; // { namaProduk, sebab }

  for (const fc of daftarFc) {
    const { namaProduk, qty, alasan } = fc.args || {};

    if (!namaProduk || !namaProduk.trim()) {
      dilewati.push({ namaProduk: "(nama kosong)", sebab: "nama produk tidak jelas" });
      continue;
    }
    if (!qty || qty <= 0) {
      dilewati.push({ namaProduk, sebab: "qty tidak jelas" });
      continue;
    }

    let hasilResolusi;
    try {
      hasilResolusi = await resolusiProduk(namaProduk);
    } catch (err) {
      console.error(`Batch: gagal resolusi produk "${namaProduk}":`, err);
      dilewati.push({ namaProduk, sebab: "gangguan saat cari produk" });
      continue;
    }

    if (hasilResolusi.status !== "jelas" || hasilResolusi.perluKonfirmasiCakupan) {
      const sebab = hasilResolusi.perluKonfirmasiCakupan
        ? "gak ketemu di daftar produk online"
        : hasilResolusi.status === "ragu"
        ? "ada beberapa produk mirip, perlu dipilih manual"
        : "gak ketemu di database produk";
      dilewati.push({ namaProduk, sebab });
      continue;
    }

    const produk = hasilResolusi.produkTerpilih;
    const item = bentukPendingBatchItem({
      kodeBarang: produk.kode_barang,
      namaProduk: produk.nama_accurate,
      qty,
      alasan,
    });
    item.jenis = fc.name; // "kurangiStok" | "tambahStok" — dipakai bedain saat konfirmasi & eksekusi
    jelasItems.push(item);
  }

  if (jelasItems.length === 0) {
    const teksGagalSemua =
      `Gak ada satu produk pun dari daftar tadi yang berhasil dicocokkan otomatis:\n\n` +
      dilewati.map((d) => `- *${d.namaProduk}* — ${d.sebab}`).join("\n") +
      `\n\nCoba proses satu-satu lewat chat biasa, atau perjelas namanya ya.`;
    await kirimPesan(chatId, teksGagalSemua, { parseMode: "Markdown" });
    await tambahPesanKeSession(telegramUserId, "model", teksGagalSemua);
    return;
  }

  await tahanUntukKonfirmasiBatch({ telegramUserId, chatId, items: jelasItems, dilewati });
}

/**
 * Simpan pendingBatchAction & tampilkan 1 ringkasan konfirmasi utk semua item yang
 * "jelas" ketemu. Item bisa campuran jenis (ada yang tambahStok, ada yang kurangiStok)
 * kalau memang begitu maksud admin — ditampilkan terpisah per jenis biar gak rancu.
 */
async function tahanUntukKonfirmasiBatch({ telegramUserId, chatId, items, dilewati }) {
  const pendingBatchAction = { items, dibuatPada: new Date() };
  await simpanPendingBatchActionKeSession(telegramUserId, pendingBatchAction);

  const itemTambah = items.filter((it) => it.jenis === "tambahStok");
  const itemKurangi = items.filter((it) => it.jenis === "kurangiStok");
  const itemProdukBaru = items.filter((it) => it.jenis === "tambahProdukBaru");

  const baris = ["Konfirmasi ya, ada beberapa perubahan stok:"];
  if (itemTambah.length) {
    baris.push("\n➕ *Tambah stok:*");
    itemTambah.forEach((it) => baris.push(`- ${it.namaProduk} (${it.kodeBarang}) +${it.qty}`));
  }
  if (itemKurangi.length) {
    baris.push("\n➖ *Kurangi stok:*");
    itemKurangi.forEach((it) => baris.push(`- ${it.namaProduk} (${it.kodeBarang}) -${it.qty}`));
  }
  if (itemProdukBaru.length) {
    baris.push("\n🆕 *Produk baru:*");
    itemProdukBaru.forEach((it) =>
      baris.push(`- ${it.namaProduk} (${it.kodeBarang}) — HPP: ${it.hpp ?? "-"}, stok awal: ${it.stokAwal}`)
    );
  }
  if (dilewati.length) {
    baris.push("\n❓ *Dilewati (perlu dicek manual):*");
    dilewati.forEach((d) => baris.push(`- ${d.namaProduk} — ${d.sebab}`));
  }
  baris.push('\nBisa tekan tombol di bawah, atau balas "ya"/"tidak".');
  const teks = baris.join("\n");

  await kirimPesanDenganTombol(chatId, teks, [
    [
      { text: "✅ Ya, proses semua", callback_data: `pb:ya:${telegramUserId}` },
      { text: "❌ Batal", callback_data: `pb:tidak:${telegramUserId}` },
    ],
  ]);

  // Sama seperti tahanUntukKonfirmasi() (jalur tunggal) — catat turn "model" ini di
  // history, biar giliran chat berikutnya gak dianggap Gemini "belum jawab" lalu
  // re-issue tool call yang sama.
  await tambahPesanKeSession(telegramUserId, "model", teks);
}

async function prosesJawabanPendingBatchAction({ telegramUserId, chatId, teksPesan, pendingBatchAction, confirmedBy = telegramUserId }) {
  const jawaban = (teksPesan || "").trim().toLowerCase();

  if (JAWABAN_YA.includes(jawaban)) {
    // Sama alasan seperti prosesJawabanPendingAction(): hapus pending DULUAN sebelum
    // eksekusi, cegah race condition kalau webhook Telegram retry callback yang sama.
    await hapusPendingBatchActionDariSession(telegramUserId);

    const berhasil = [];
    const gagal = [];

    for (const item of pendingBatchAction.items) {
      if (!item.kodeBarang) {
        gagal.push({ ...item, sebab: "kode produk tidak valid" });
        continue;
      }
      try {
        if (item.jenis === "kurangiStok") {
          await kurangiStok(item.kodeBarang, item.qty, confirmedBy);

          await catatPergerakanStok({
            kode_barang: item.kodeBarang,
            nama_terbaca: item.namaProduk,
            variasi: "-",
            // qty = delta bertanda: kurangi_stok selalu negatif.
            qty: -Math.abs(item.qty),
            type: "koreksi_manual",
            penanda: null,
            action_type: "kurangi_stok",
            catatan: item.alasan || null,
            source: "manual_chat_batch",
            status: "processed",
            created_by: confirmedBy,
            requested_by: telegramUserId,
            confirmed_by: confirmedBy,
          });
        } else if (item.jenis === "tambahStok") {
          await tambahStok(item.kodeBarang, item.qty, confirmedBy);

          await catatPergerakanStok({
            kode_barang: item.kodeBarang,
            nama_terbaca: item.namaProduk,
            variasi: "-",
            // qty = delta bertanda: tambah_stok selalu positif.
            qty: Math.abs(item.qty),
            type: "koreksi_manual",
            penanda: null,
            action_type: "tambah_stok",
            catatan: item.alasan || null,
            source: "manual_chat_batch",
            status: "processed",
            created_by: confirmedBy,
            requested_by: telegramUserId,
            confirmed_by: confirmedBy,
          });
        } else if (item.jenis === "tambahProdukBaru") {
          // Jaga-jaga race condition: bisa aja produk ini didaftarkan lewat jalur lain
          // (chat tunggal, atau admin lain) di antara waktu draft dibuat & di-acc sekarang.
          const produkExisting = await ambilProdukByKode(item.kodeBarang);
          if (produkExisting) {
            throw new Error(`kode "${item.kodeBarang}" sudah dipakai produk lain`);
          }

          await simpanProduk(item.kodeBarang, {
            nama_accurate: item.namaProduk,
            hpp: item.hpp,
            is_online_product: true, // selalu true — sama seperti jalur tunggal tanganiTambahProdukBaru
          });
          await buatStokAwal(item.kodeBarang, item.stokAwal || 0, { userId: confirmedBy });

          await catatPergerakanStok({
            kode_barang: item.kodeBarang,
            nama_terbaca: item.namaProduk,
            variasi: "-",
            // qty = delta bertanda: tambah_stok selalu positif.
            qty: Math.abs(item.stokAwal || 0),
            type: "koreksi_manual",
            penanda: null,
            action_type: "tambah_stok",
            catatan: item.alasan || "produk baru didaftarkan lewat chat (batch)",
            source: "manual_chat_batch_produk_baru",
            status: "processed",
            created_by: confirmedBy,
            requested_by: telegramUserId,
            confirmed_by: confirmedBy,
          });
        } else {
          throw new Error(`Jenis item batch tidak dikenal: ${item.jenis}`);
        }

        berhasil.push(item);
      } catch (err) {
        // Catatan sama seperti jalur tunggal: kalau error kejadian SETELAH stok berubah
        // (misal catatPergerakanStok gagal), stok item ITU SUDAH BERUBAH duluan — item
        // lain di batch tetap lanjut diproses satu-satu (gak saling menggagalkan).
        console.error(`Batch: gagal eksekusi item ${item.kodeBarang}:`, err);
        gagal.push({ ...item, sebab: "gangguan saat proses/simpan riwayat" });
      }
    }

    const teksHasil = susunTeksHasilBatch(berhasil, gagal);
    await kirimPesan(chatId, teksHasil, { parseMode: "Markdown" });
    return;
  }

  if (JAWABAN_TIDAK.includes(jawaban)) {
    await hapusPendingBatchActionDariSession(telegramUserId);
    await kirimPesan(chatId, "Oke, semua dibatalkan.");
    return;
  }

  await kirimPesan(chatId, 'Masih nunggu konfirmasi soal daftar tadi ya — balas "ya" atau "tidak" dulu.');
}

function susunTeksHasilBatch(berhasil, gagal) {
  const baris = ["✅ Selesai diproses."];
  const tambah = berhasil.filter((it) => it.jenis === "tambahStok");
  const kurangi = berhasil.filter((it) => it.jenis === "kurangiStok");
  const produkBaru = berhasil.filter((it) => it.jenis === "tambahProdukBaru");
  if (tambah.length) baris.push(`- ${tambah.length} produk ditambah stoknya.`);
  if (kurangi.length) baris.push(`- ${kurangi.length} produk dikurangi stoknya.`);
  if (produkBaru.length) baris.push(`- ${produkBaru.length} produk baru didaftarkan & ditandai online.`);
  if (gagal.length) {
    baris.push(`- ${gagal.length} item gagal diproses:`);
    gagal.forEach((g) => baris.push(`  - ${g.namaProduk} — ${g.sebab}`));
  }
  return baris.join("\n");
}

// ---------- Helper: tool terminal (mulaiOpname) ----------

async function tanganiToolTerminal({ telegramUserId, chatId, fc }) {
  if (fc.name === "mulaiOpname") {
    const { daftarOpnameTeks } = fc.args || {};
    if (!daftarOpnameTeks || !daftarOpnameTeks.trim()) {
      const teksKosongOpname = "Boleh kirim daftar hasil hitung fisiknya? Format 'nama produk - qty' per baris ya.";
      await kirimPesan(chatId, teksKosongOpname);
      await tambahPesanKeSession(telegramUserId, "model", teksKosongOpname);
      return;
    }
    // handleOpname() punya alur & pesan sendiri (termasuk kemungkinan konfirmasi lanjutan) —
    // catatan history turn "model"-nya jadi tanggung jawab handleOpname() sendiri, bukan di sini.
    await handleOpname({
      telegramUserId,
      chatId,
      sumber: "chat",
      teksPesan: daftarOpnameTeks,
    });
    return;
  }
  if (fc.name === "tambahProdukBaru") {
    await tanganiTambahProdukBaru({ telegramUserId, chatId, args: fc.args || {} });
    return;
  }
  if (fc.name === "tambahProdukBaruBatch") {
    await tanganiTambahProdukBaruBatch({ telegramUserId, chatId, args: fc.args || {} });
    return;
  }
  console.error(`Tool terminal belum ditangani: ${fc.name}`);
  const teksFallback2 = "Maaf, ada fitur belum siap. Coba cara lain dulu ya.";
  await kirimPesan(chatId, teksFallback2);
  await tambahPesanKeSession(telegramUserId, "model", teksFallback2);
}

/**
 * Tangani tool tambahProdukBaru — validasi input, cek kode_barang belum dipakai
 * (jaga-jaga bentrok sama produk existing atau nyerempet produk hasil sync Sheets),
 * lalu tahan sbg pendingAction (jenis "tambahProdukBaru") nunggu konfirmasi. Eksekusi
 * beneran (tulis ke Firestore) baru terjadi di prosesJawabanPendingAction() setelah admin
 * bilang "ya" — pola sama persis dgn kurangiStok/tambahStok, biar konsisten satu jalur
 * konfirmasi utk semua aksi yang mengubah data.
 */
async function tanganiTambahProdukBaru({ telegramUserId, chatId, args }) {
  const { kodeBarang, namaProduk, hpp, stokAwal, alasan } = args;

  if (!kodeBarang || !kodeBarang.trim() || !namaProduk || !namaProduk.trim()) {
    const teks = "Kode barang & nama produknya apa ya? Kode barang harus sama dengan yang di Accurate, biar gak bentrok pas sync Sheets nanti 🙂";
    await kirimPesan(chatId, teks);
    await tambahPesanKeSession(telegramUserId, "model", teks);
    return;
  }

  const kodeBarangBersih = kodeBarang.trim();

  // Jaga-jaga: kalau kode_barang ternyata sudah dipakai produk lain (mungkin Gemini/admin
  // salah kira ini produk baru padahal sudah ada), JANGAN timpa diam-diam — arahkan pakai
  // tambahStok/kurangiStok biasa lewat nama produk (jalur yang sudah ada, lebih aman).
  const produkExisting = await ambilProdukByKode(kodeBarangBersih);
  if (produkExisting) {
    const teks =
      `Kode barang *${kodeBarangBersih}* sudah dipakai produk *${produkExisting.nama_accurate}*. ` +
      `Kalau maksudnya nambah stok produk ini, bilang aja langsung ("tambah stok ${produkExisting.nama_accurate} ...") — ` +
      `gak perlu lewat tambah produk baru.`;
    await kirimPesan(chatId, teks, { parseMode: "Markdown" });
    await tambahPesanKeSession(telegramUserId, "model", teks);
    return;
  }

  const pendingAction = bentukPendingActionProdukBaru({
    kodeBarang: kodeBarangBersih,
    namaProduk: namaProduk.trim(),
    hpp: hpp ?? null,
    stokAwal: stokAwal || 0,
    alasan,
  });
  await simpanPendingActionKeSession(telegramUserId, pendingAction);

  const teks =
    `Konfirmasi ya, daftarkan produk BARU:\n\n` +
    `*${pendingAction.namaProduk}* (${pendingAction.kodeBarang})\n` +
    `HPP: ${pendingAction.hpp ?? "-"}\n` +
    `Stok awal gudang online: ${pendingAction.stokAwal}\n` +
    `Status: langsung ditandai online ✅` +
    (pendingAction.alasan ? `\nCatatan: ${pendingAction.alasan}` : "") +
    `\n\nBisa tekan tombol di bawah, atau balas "ya"/"tidak".`;

  await kirimPesanDenganTombol(chatId, teks, [
    [
      { text: "✅ Ya, daftarkan", callback_data: `pa:ya:${telegramUserId}` },
      { text: "❌ Batal", callback_data: `pa:tidak:${telegramUserId}` },
    ],
  ]);
  await tambahPesanKeSession(telegramUserId, "model", teks);
}

/**
 * Versi BATCH dari tanganiTambahProdukBaru — banyak produk baru sekaligus dalam 1 pesan.
 * Reuse mekanisme pendingBatchAction yang sama dgn batch kurangiStok/tambahStok (tombol
 * pb:ya/pb:tidak), tinggal item-nya dikasih jenis "tambahProdukBaru" — biar gak perlu bikin
 * session slot & pola konfirmasi baru lagi (bagian 4F: satu pintu konfirmasi per jenis aksi).
 * Beda dari batch kurangiStok/tambahStok: gak ada resolusi nama→produk (produknya BELUM
 * ada), jadi parsing & validasi kode_barang dilakukan di sini, bukan lewat cariProdukPintar.
 */
async function tanganiTambahProdukBaruBatch({ telegramUserId, chatId, args }) {
  const { daftarProdukBaruTeks } = args;

  if (!daftarProdukBaruTeks || !daftarProdukBaruTeks.trim()) {
    const teks = "Boleh kirim daftar produk barunya? Format per baris: 'kode - nama - hpp - stok_awal' (hpp/stok_awal boleh dikosongkan).";
    await kirimPesan(chatId, teks);
    await tambahPesanKeSession(telegramUserId, "model", teks);
    return;
  }

  const baris = parseDaftarProdukBaruTeks(daftarProdukBaruTeks);

  if (baris.length === 0) {
    const teks = "Gak ketemu baris yang bisa dibaca. Format per baris: 'kode - nama - hpp - stok_awal', minimal kode & nama.";
    await kirimPesan(chatId, teks);
    await tambahPesanKeSession(telegramUserId, "model", teks);
    return;
  }

  const jelasItems = [];
  const dilewati = [];
  const kodeTerpakaiDiBatchIni = new Set();

  for (const b of baris) {
    if (kodeTerpakaiDiBatchIni.has(b.kodeBarang)) {
      dilewati.push({ namaProduk: b.namaProduk, kodeBarang: b.kodeBarang, sebab: "kode dobel di daftar ini" });
      continue;
    }

    const produkExisting = await ambilProdukByKode(b.kodeBarang);
    if (produkExisting) {
      dilewati.push({
        namaProduk: b.namaProduk,
        kodeBarang: b.kodeBarang,
        sebab: `kode sudah dipakai produk "${produkExisting.nama_accurate}"`,
      });
      continue;
    }

    kodeTerpakaiDiBatchIni.add(b.kodeBarang);
    jelasItems.push(
      bentukPendingBatchItemProdukBaru({
        kodeBarang: b.kodeBarang,
        namaProduk: b.namaProduk,
        hpp: b.hpp,
        stokAwal: b.stokAwal,
      })
    );
  }

  if (jelasItems.length === 0) {
    const teksGagalSemua =
      `Gak ada satu produk pun dari daftar tadi yang bisa didaftarkan:\n\n` +
      dilewati.map((d) => `- *${d.namaProduk}* (${d.kodeBarang}) — ${d.sebab}`).join("\n");
    await kirimPesan(chatId, teksGagalSemua, { parseMode: "Markdown" });
    await tambahPesanKeSession(telegramUserId, "model", teksGagalSemua);
    return;
  }

  await tahanUntukKonfirmasiBatch({ telegramUserId, chatId, items: jelasItems, dilewati });
}

/**
 * Parse teks multi-baris format "kode - nama - hpp - stok_awal" (hpp & stok_awal opsional,
 * bisa dikosongkan atau ditulis "-"). Split khusus pada " - " (strip DIAPIT spasi), bukan "-"
 * polos, biar nama produk yang kebetulan mengandung tanda hubung tanpa spasi (mis. "3-in-1")
 * gak ikut kepotong jadi kolom terpisah. Baris yang gak punya minimal kode+nama dilewati diam-diam
 * (bukan error total) — sama pola dengan parseDariTeks() di handleOpname.js.
 */
function parseDaftarProdukBaruTeks(teksPesan) {
  const barisTeks = String(teksPesan || "").split("\n");
  const hasil = [];

  for (const baris of barisTeks) {
    const bagian = baris.trim().split(/\s-\s/).map((s) => s.trim());
    if (bagian.length < 2) continue;

    const kodeBarang = bagian[0];
    const namaProduk = bagian[1];
    if (!kodeBarang || !namaProduk) continue;

    const hppRaw = bagian[2];
    const hpp = hppRaw && hppRaw !== "-" && Number.isFinite(Number(hppRaw)) ? Number(hppRaw) : null;

    const stokRaw = bagian[3];
    const stokAwal = stokRaw && stokRaw !== "-" && Number.isFinite(Number(stokRaw)) ? Number(stokRaw) : 0;

    hasil.push({ kodeBarang, namaProduk, hpp, stokAwal });
  }

  return hasil;
}

// ---------- Helper: tahan kurangiStok/tambahStok utk konfirmasi ----------

/**
 * @param {boolean} [tawarkanTagOnline] - true kalau produk hasil expand full katalog
 *   dan belum ditandai online — tombol ekstra ditambahkan biar admin bisa sekalian tag.
 */
async function tahanUntukKonfirmasi({ telegramUserId, chatId, jenis, kodeBarang, namaProduk, qty, alasan, tawarkanTagOnline = false }) {
  const pendingAction = bentukPendingAction(jenis, { kodeBarang, namaProduk, qty, alasan, tagOnlineSetelahnya: tawarkanTagOnline });
  await simpanPendingActionKeSession(telegramUserId, pendingAction);

  const kataKerja = jenis === "kurangiStok" ? "kurangi" : "tambah";
  const catatanTag = tawarkanTagOnline
    ? "\n\n_(Produk ini belum ditandai online — bakal ditandai online juga sekalian kalau kamu konfirmasi ya.)_"
    : "";
  const teks =
    `Konfirmasi ya: ${kataKerja} stok *${namaProduk}* (${kodeBarang}) sebanyak ${qty}` +
    (alasan ? ` — alasan: ${alasan}` : "") +
    `.${catatanTag}\n\nBisa tekan tombol di bawah, atau balas "ya"/"tidak".`;

  await kirimPesanDenganTombol(chatId, teks, [
    [
      { text: "✅ Ya, proses", callback_data: `pa:ya:${telegramUserId}` },
      { text: "❌ Batal", callback_data: `pa:tidak:${telegramUserId}` },
    ],
  ]);

  // PENTING: catat juga sbg turn "model" di history — tanpa ini, turn user yang minta
  // aksi ini jadi "gantung" (gak ada balasan model yg nutup) di sliding window history.
  // Efeknya: Gemini nganggep request itu belum terjawab dan bisa re-issue tool call yang
  // SAMA di giliran chat berikutnya, walau user udah jawab ya/tidak & pendingAction sudah
  // dihapus dari Firestore (root cause bug "minta konfirmasi sama terus").
  await tambahPesanKeSession(telegramUserId, "model", teks);
}

async function prosesJawabanPendingAction({ telegramUserId, chatId, teksPesan, pendingAction, confirmedBy = telegramUserId }) {
  const jawaban = (teksPesan || "").trim().toLowerCase();

  if (JAWABAN_YA.includes(jawaban)) {
    // FIX race condition: hapus pendingAction dari session DULUAN, SEBELUM eksekusi apa pun.
    // Kenapa: kalau Telegram sempat kirim ulang callback yang sama (webhook lambat respon →
    // retry), invocation kedua bisa nyerempet baca pendingAction yang sama persis sebelum
    // invocation pertama sempat menghapusnya di akhir proses (pola lama) — dua-duanya jalan
    // dgn data yang sama/berubah di tengah jalan, salah satu bisa berakhir baca state yang
    // sudah tidak konsisten. Dengan dihapus DULUAN di sini, invocation kedua yang nyerempet
    // akan baca pendingAction KOSONG dan berhenti aman (masuk cabang "tidak ada pending" di
    // pemanggil), bukan ikut-ikutan mengeksekusi ulang.
    await hapusPendingActionDariSession(telegramUserId);

    // Guard defensif: harusnya kodeBarang selalu terisi (SELALU hasil resolusi produk via
    // cariProdukPintar sebelum pendingAction dibuat), tapi kalau gara-gara race/bug lain
    // sampai lolos ke sini dengan kodeBarang kosong, mending gagal jelas & jujur ke admin
    // drpd nge-crash di tengah proses (yg bikin state Firestore ambigu: stok sudah berubah
    // tapi audit log stock_movements gagal tersimpan, spt insiden sebelumnya).
    if (!pendingAction.kodeBarang) {
      console.error("prosesJawabanPendingAction: pendingAction.kodeBarang kosong, dibatalkan.", pendingAction);
      await kirimPesan(chatId, "Waduh, data produknya kayaknya udah gak valid (mungkin ada proses lain nyerempet). Coba ulang dari awal ya.");
      return;
    }

    try {
      // Cabang tambahProdukBaru: beda total dari kurangiStok/tambahStok (produk BELUM ada
      // sama sekali), jadi ditangani terpisah di sini — tetap 1 pintu eksekusi yang sama
      // (prosesJawabanPendingAction) biar konfirmasi ya/tidak & race-condition guard di atas
      // tetap berlaku sama utk semua jenis pendingAction, gak perlu duplikasi.
      if (pendingAction.jenis === "tambahProdukBaru") {
        await simpanProduk(pendingAction.kodeBarang, {
          nama_accurate: pendingAction.namaProduk,
          hpp: pendingAction.hpp,
          is_online_product: true, // selalu true — produk yang didaftarkan lewat chat khusus stok online
        });
        await buatStokAwal(pendingAction.kodeBarang, pendingAction.stokAwal || 0, { userId: confirmedBy });

        await catatPergerakanStok({
          kode_barang: pendingAction.kodeBarang,
          nama_terbaca: pendingAction.namaProduk,
          variasi: "-",
          // qty = delta bertanda: tambah_stok selalu positif.
          qty: Math.abs(pendingAction.stokAwal || 0),
          type: "koreksi_manual",
          penanda: null,
          action_type: "tambah_stok",
          catatan: pendingAction.alasan || "produk baru didaftarkan lewat chat",
          source: "manual_chat_produk_baru",
          status: "processed",
          created_by: confirmedBy,
          requested_by: telegramUserId,
          confirmed_by: confirmedBy,
        });

        await kirimPesan(
          chatId,
          `Sip, produk *${pendingAction.namaProduk}* (${pendingAction.kodeBarang}) sudah didaftarkan & ditandai online, stok awal ${pendingAction.stokAwal || 0}. ✅`,
          { parseMode: "Markdown" }
        );
        return;
      }

      let hasilAksi;
      if (pendingAction.jenis === "kurangiStok") {
        hasilAksi = await kurangiStok(pendingAction.kodeBarang, pendingAction.qty, confirmedBy);
      } else if (pendingAction.jenis === "tambahStok") {
        hasilAksi = await tambahStok(pendingAction.kodeBarang, pendingAction.qty, confirmedBy);
      } else {
        throw new Error(`Jenis pendingAction tidak dikenal: ${pendingAction.jenis}`);
      }

      if (pendingAction.tagOnlineSetelahnya) {
        await tandaiSebagaiProdukOnline(pendingAction.kodeBarang);
      }

      await catatPergerakanStok({
        kode_barang: pendingAction.kodeBarang,
        nama_terbaca: pendingAction.namaProduk,
        variasi: "-",
        // qty = delta bertanda: kurangi negatif, tambah positif.
        qty: pendingAction.jenis === "kurangiStok" ? -Math.abs(pendingAction.qty) : Math.abs(pendingAction.qty),
        type: "koreksi_manual",
        penanda: null,
        action_type: pendingAction.jenis === "kurangiStok" ? "kurangi_stok" : "tambah_stok",
        catatan: pendingAction.alasan || null,
        source: "manual_chat",
        status: "processed",
        created_by: confirmedBy,
        requested_by: telegramUserId,
        confirmed_by: confirmedBy,
      });

      await kirimPesan(
        chatId,
        `Sip, stok *${pendingAction.namaProduk}* sudah di${pendingAction.jenis === "kurangiStok" ? "kurangi" : "tambah"} ${pendingAction.qty}. ✅`,
        { parseMode: "Markdown" }
      );
    } catch (err) {
      // CATATAN: kalau error kejadian SETELAH kurangiStok/tambahStok sukses (misal
      // catatPergerakanStok yang gagal), stok DI FIRESTORE SUDAH BERUBAH duluan — try/catch
      // ini gak bisa "rollback" itu. Pesan ke admin sengaja dibedain biar gak bikin panik
      // padahal stoknya sendiri kemungkinan besar sudah benar berubah.
      console.error("Error eksekusi pendingAction:", err);
      await kirimPesan(
        chatId,
        "Stoknya kemungkinan SUDAH berubah, tapi ada gangguan pas nyimpen catatan riwayatnya. Coba cek /help atau tanya stok terbaru buat pastiin ya, mohon maaf 🙏"
      );
    }
    return;
  }

  if (JAWABAN_TIDAK.includes(jawaban)) {
    await hapusPendingActionDariSession(telegramUserId);
    await kirimPesan(chatId, "Oke, dibatalkan.");
    return;
  }

  await kirimPesan(chatId, `Masih nunggu konfirmasi soal *${pendingAction.namaProduk}* ya — balas "ya" atau "tidak" dulu.`, {
    parseMode: "Markdown",
  });
}

// ---------- Helper: jawaban pendingKonfirmasiCakupan (tombol cari-semua/kandidat/batal) ----------

async function prosesJawabanPendingKonfirmasiCakupan({ telegramUserId, chatId, teksPesan, pending }) {
  const jawaban = (teksPesan || "").trim().toLowerCase();

  if (JAWABAN_TIDAK.includes(jawaban)) {
    await hapusPendingKonfirmasiCakupanDariSession(telegramUserId);
    await kirimPesan(chatId, "Oke, dibatalkan.");
    return;
  }

  if (pending.tahap === "tanya_cakupan") {
    // Jawaban teks di tahap ini cuma "batal" yang valid (sudah dicek di atas) — pilihan
    // "cari di semua" HARUS lewat tombol (biar jelas, ini aksi yg berpotensi mahal read-nya).
    await kirimPesan(chatId, 'Tekan tombol "🔍 Cari di semua produk" di pesan sebelumnya, atau balas *batal*.', {
      parseMode: "Markdown",
    });
    return;
  }

  if (pending.tahap === "pilih_kandidat") {
    const nomor = Number(jawaban);
    const kandidatTerpilih =
      Number.isInteger(nomor) && nomor >= 1 && nomor <= pending.kandidat.length ? pending.kandidat[nomor - 1] : null;

    if (!kandidatTerpilih) {
      await kirimPesan(chatId, "Balas nomor kandidat yang dimaksud ya, atau *batal*.", { parseMode: "Markdown" });
      return;
    }

    // Kandidat dipilih manual — anggap "jelas", susun ulang bentuk hasilResolusi minimal
    // yg dibutuhkan tindakLanjutiHasilResolusi(). Perlu ambilProdukByKode buat data lengkap
    // (is_online_product, hpp, dll) krn kandidat yg disimpan cuma ringkasan nama+kode.
    const { ambilProdukByKode } = require("../models/produk");
    const produkLengkap = await ambilProdukByKode(kandidatTerpilih.kode_barang);
    if (!produkLengkap) {
      await hapusPendingKonfirmasiCakupanDariSession(telegramUserId);
      await kirimPesan(chatId, "Waduh, produk itu kayaknya sudah gak ada di database. Coba ulang dari awal ya.");
      return;
    }

    await tindakLanjutiHasilResolusi({
      telegramUserId,
      chatId,
      hasilResolusi: { perluKonfirmasiCakupan: false, status: "jelas", produkTerpilih: produkLengkap, kandidat: [] },
      rencanaLanjutan: pending.rencanaLanjutan,
      sudahExpand: pending.sudahExpand || false,
    });
    return;
  }

  console.error(`Tahap pendingKonfirmasiCakupan gak dikenal: ${pending.tahap}`);
  await hapusPendingKonfirmasiCakupanDariSession(telegramUserId);
}

/**
 * Dipanggil dari callback tombol "🔍 Cari di semua produk" (routePesan.js →
 * handleKonfirmasiCallback.js). Expand pencarian ke full katalog, lalu tindak lanjuti
 * sesuai hasil (bisa jadi langsung "jelas", "ragu", atau ternyata tetap "tidak_ketemu").
 */
async function prosesKonfirmasiCariSemua(telegramUserId, chatId) {
  const session = await ambilSessionAktif(telegramUserId);
  const pending = session.pendingKonfirmasiCakupan;
  if (!pending || pending.tahap !== "tanya_cakupan") return false;

  const hasilExpand = await cariProdukSemuaKatalog(pending.kataKunci);
  await tindakLanjutiHasilResolusi({
    telegramUserId,
    chatId,
    hasilResolusi: hasilExpand,
    rencanaLanjutan: pending.rencanaLanjutan,
    sudahExpand: true,
  });
  return true;
}

/**
 * Dipanggil dari callback tombol "❌ Batal" pada konfirmasi cakupan.
 */
async function prosesKonfirmasiCakupanViaTombol(telegramUserId, chatId, aksi) {
  const session = await ambilSessionAktif(telegramUserId);
  if (!session.pendingKonfirmasiCakupan) return false;

  if (aksi === "cari") {
    return prosesKonfirmasiCariSemua(telegramUserId, chatId);
  }
  await hapusPendingKonfirmasiCakupanDariSession(telegramUserId);
  await kirimPesan(chatId, "Oke, dibatalkan.");
  return true;
}

// ---------- Helper: akses pendingAction / pendingKonfirmasiCakupan di sessions ----------

async function simpanPendingActionKeSession(telegramUserId, pendingAction) {
  await db.collection("sessions").doc(String(telegramUserId)).set(
    { pendingAction, last_updated: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function hapusPendingActionDariSession(telegramUserId) {
  await db.collection("sessions").doc(String(telegramUserId)).set(
    { pendingAction: admin.firestore.FieldValue.delete(), last_updated: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function simpanPendingBatchActionKeSession(telegramUserId, pendingBatchAction) {
  await db.collection("sessions").doc(String(telegramUserId)).set(
    { pendingBatchAction, last_updated: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function hapusPendingBatchActionDariSession(telegramUserId) {
  await db.collection("sessions").doc(String(telegramUserId)).set(
    { pendingBatchAction: admin.firestore.FieldValue.delete(), last_updated: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function simpanPendingKonfirmasiCakupan(telegramUserId, pending) {
  await db.collection("sessions").doc(String(telegramUserId)).set(
    { pendingKonfirmasiCakupan: pending, last_updated: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function hapusPendingKonfirmasiCakupanDariSession(telegramUserId) {
  await db.collection("sessions").doc(String(telegramUserId)).set(
    { pendingKonfirmasiCakupan: admin.firestore.FieldValue.delete(), last_updated: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// Dipanggil dari callback tombol (routePesan.js → handleKonfirmasiCallback.js), BUKAN dari
// alur teks biasa — fetch dulu pendingAction dari session pakai telegramUserId yang
// disimpan di callback_data ("pa:ya:<id>"/"pa:tidak:<id>"), baru reuse logic yang sama
// persis dengan jawaban teks (prosesJawabanPendingAction), biar gak ada 2 versi logic beda.
async function prosesPendingActionViaTombol(telegramUserId, chatId, jawabanTeks, confirmedBy = telegramUserId) {
  const session = await ambilSessionAktif(telegramUserId);
  if (!session.pendingAction) return false; // sudah diproses/kadaluarsa, caller yg kasih tau user
  await prosesJawabanPendingAction({ telegramUserId, chatId, teksPesan: jawabanTeks, pendingAction: session.pendingAction, confirmedBy });
  return true;
}

// Dipanggil dari callback tombol batch (routePesan.js → handleKonfirmasiCallback.js,
// prefix "pb"), pola reuse yang sama persis dgn prosesPendingActionViaTombol (tunggal).
async function prosesPendingBatchActionViaTombol(telegramUserId, chatId, jawabanTeks, confirmedBy = telegramUserId) {
  const session = await ambilSessionAktif(telegramUserId);
  if (!session.pendingBatchAction) return false; // sudah diproses/kadaluarsa
  await prosesJawabanPendingBatchAction({
    telegramUserId,
    chatId,
    teksPesan: jawabanTeks,
    pendingBatchAction: session.pendingBatchAction,
    confirmedBy,
  });
  return true;
}

// ---------- Helper lain ----------

function bentukHistoryUntukGemini(history) {
  return (history || []).map((h) => ({
    role: h.role === "model" ? "model" : "user",
    parts: [{ text: h.content }],
  }));
}

function ambilFunctionCalls(hasilGemini) {
  const kandidat = hasilGemini.response.candidates || [];
  const parts = kandidat[0]?.content?.parts || [];
  return parts.filter((p) => p.functionCall).map((p) => p.functionCall);
}

module.exports = {
  handleChatBiasa,
  prosesPendingActionViaTombol,
  prosesPendingBatchActionViaTombol,
  prosesKonfirmasiCakupanViaTombol,
};