// lib/notifikasi/permintaanGudang.js
// Notifikasi bot untuk alur permintaan antar-gudang (F5/F6, v5.1) - 6 titik (P5).
//
// Best-effort & fail-safe (Q7/BR10): fungsi ini TIDAK PERNAH throw. Gagal kirim cukup
// di-log dan dikembalikan { terkirim: false }, jangan sampai menggagalkan transaksi
// yang sudah commit. Pola mengikuti lib/telegram/notifikasiError.js.

const { ambilAdmin } = require("../models/admins");
const { kirimPesan } = require("../telegram/kirimPesan");

/** Ringkas daftar item -> total qty. */
function totalQty(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (total, item) => total + (Number.isFinite(item && item.qty) ? item.qty : 0),
    0
  );
}

/** Ambil nama gudang asal dari dokumen permintaan (fallback ke id). */
function namaAsal(permintaan) {
  const p = permintaan || {};
  return p.dari_gudang_nama || p.dari_gudang_id || "gudang";
}

/** Ambil nama gudang tujuan dari entri tujuan (fallback ke id). */
function namaTujuan(tujuan) {
  const t = tujuan || {};
  return t.nama || t.gudang_id_snapshot || t.id || "gudang tujuan";
}

/** Teks notifikasi `buat` (ke penerima). */
function susunTeksBuat({ permintaan, tujuan }) {
  const p = permintaan || {};
  const t = tujuan || {};
  const items = Array.isArray(t.items) && t.items.length > 0 ? t.items : p.items;
  const n = totalQty(items);
  return [
    `Permintaan baru dari ${namaAsal(p)}`,
    `${n} item`,
    "Buka dashboard untuk menyetujui.",
  ].join("\n");
}

/** Teks notifikasi status per-tujuan (ke pembuat): setujui/kirim/terima/tidak-terima. */
function susunTeksStatus({ permintaan, tujuan, aksi }) {
  const p = permintaan || {};
  const t = tujuan || {};
  const items = Array.isArray(t.items) && t.items.length > 0 ? t.items : p.items;
  const n = totalQty(items);
  const asal = namaAsal(p);
  const gudangTujuan = namaTujuan(t);

  if (aksi === "kirim") return `${gudangTujuan} mengirim ${n} item. Konfirmasi bila barang tiba.`;
  if (aksi === "terima") return `${gudangTujuan} menerima ${n} item.`;
  if (aksi === "tidak-terima") return `${gudangTujuan} tidak menerima ${n} item.`;
  if (aksi === "tolak-tujuan" || aksi === "tolak") return `${gudangTujuan} menolak permintaan ${asal}.`;
  if (aksi === "setujui") return `${gudangTujuan} menyetujui permintaan ${asal}. Lanjutkan pengiriman.`;
  if (aksi === "tutup-tujuan") return `Tujuan ${gudangTujuan} ditutup oleh owner.`;
  // Fallback AMAN: jangan pernah mengaku "menyetujui" untuk aksi tak dikenal.
  return `Status permintaan ${asal}: ${aksi}.`;
}

/** Teks notifikasi `selesai` (ke penerima). */
function susunTeksSelesai({ permintaan }) {
  const p = permintaan || {};
  return `Permintaan ${p.permintaan_id || ""} selesai. Terima kasih.`.replace(/\s+/g, " ").trim();
}

/**
 * Tentukan chat id penerima satu entri tujuan.
 * Q2: `user_penerima_id` null -> fallback ke owner.
 * Mengembalikan array chat id (bisa >1 saat fallback owner banyak).
 */
async function chatPenerima(tujuan) {
  const t = tujuan || {};
  if (t.user_penerima_id) return [String(t.user_penerima_id)];

  // Fallback Q2: owner semua (via model admins).
  const { ambilSemuaAdminByRole } = require("../models/admins");
  const owners = await ambilSemuaAdminByRole("owner");
  const hasil = [];
  for (const owner of owners) {
    const chatId = owner && owner.telegram_user_id;
    if (chatId) hasil.push(String(chatId));
  }
  return hasil;
}

/** Chat id pembuat permintaan (created_by/oleh). null bila kosong. */
function chatPembuat(permintaan) {
  const p = permintaan || {};
  const id = p.created_by || p.oleh;
  return id ? String(id) : null;
}

/**
 * kirimNotifikasiPermintaan({aksi, permintaan, tujuan}) -> { terkirim }
 * TIDAK PERNAH throw. Kirim ke SEMUA penerima tujuan (bila ada beberapa).
 *
 * aksi: "buat" | "setujui" | "kirim" | "terima" | "tidak-terima" | "selesai" |
 *       "batal" | "tolak" (level dokumen -> penerima semua tujuan).
 */
async function kirimNotifikasiPermintaan({ aksi, permintaan, tujuan } = {}) {
  try {
    const p = permintaan || {};
    const tujuanList = Array.isArray(p.tujuan) ? p.tujuan : [];

    // Teks & daftar tujuan sasaran per aksi.
    let teks;
    let sasaranTujuan = [];

    // Aksi yang tidak perlu notifikasi: keluar lebih awal.
    if (aksi === "ubah-item") return { terkirim: false };

    if (aksi === "buat") {
      sasaranTujuan = tujuanList;
      teks = susunTeksBuat({ permintaan: p, tujuan: tujuan || tujuanList[0] });
    } else if (aksi === "selesai") {
      sasaranTujuan = tujuanList;
      teks = susunTeksSelesai({ permintaan: p });
    } else if (aksi === "batal" || aksi === "tolak") {
      sasaranTujuan = tujuanList;
      teks = `Permintaan ${p.permintaan_id || ""} ${aksi === "batal" ? "dibatalkan" : "ditolak"}.`.trim();
    } else {
      // setujui/kirim/terima/tidak-terima: ke pembuat, satu tujuan spesifik.
      const sasaran = tujuan || tujuanList[0];
      const chatId = chatPembuat(p);
      if (!chatId) {
        console.error("[notif_permintaan_gudang] pembuat tidak diketahui:", JSON.stringify({ aksi, id: p.permintaan_id }));
        return { terkirim: false };
      }
      teks = susunTeksStatus({ permintaan: p, tujuan: sasaran, aksi });
      await kirimPesan(chatId, teks, { parseMode: "Markdown" });
      return { terkirim: true };
    }

    // Aksi broadcast (buat/selesai/batal/tolak) -> semua penerima tiap tujuan, dedupe.
    const unik = new Map();
    for (const entri of sasaranTujuan) {
      try {
        const daftar = await chatPenerima(entri);
        for (const chatId of daftar) {
          if (chatId && !unik.has(chatId)) unik.set(chatId, chatId);
        }
      } catch (e) {
        console.error("[notif_permintaan_gudang] gagal cari penerima:", JSON.stringify({ aksi, pesan: String(e) }));
      }
    }

    if (unik.size === 0) {
      console.error("[notif_permintaan_gudang] tidak ada penerima:", JSON.stringify({ aksi, id: p.permintaan_id }));
      return { terkirim: false };
    }

    for (const chatId of unik.values()) {
      await kirimPesan(chatId, teks, { parseMode: "Markdown" });
    }
    return { terkirim: true };
  } catch (err) {
    console.error("[notif_permintaan_gudang] gagal kirim:", err);
    return { terkirim: false };
  }
}

module.exports = {
  susunTeksBuat,
  susunTeksStatus,
  susunTeksSelesai,
  kirimNotifikasiPermintaan,
};
