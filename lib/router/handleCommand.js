// lib/router/handleCommand.js
// Menangani pesan yang diawali "/" (command Telegram).
// Command spesifik fitur (misal /opname) akan ditambahkan di batch-batch berikutnya
// (handler-nya didaftarkan lewat DAFTAR_COMMAND di bawah supaya gampang di-extend).
const { kirimPesan, kirimPesanPanjang } = require("../telegram/kirimPesan");
const { resetSession, hapusSemuaPendingState } = require("../models/sessions");
const { ambilAdmin, ambilSemuaAdmin, isSuperAdmin } = require("../models/admins");
const { ambilPergerakanByKode, ambilPergerakanTerakhir } = require("../models/stockMovements");
const { handleSetRole } = require("../handlers/handleSetRole");
const { mulaiSyncStok } = require("../sheets/syncStokDuaArah");
const { mulaiRevokeAdmin } = require("../handlers/handleRevokeAdmin");
const { handleSettings } = require("../handlers/handleSettings");
async function handleStart(ctx) {
  const admin = await ambilAdmin(ctx.telegramUserId);
  const namaSapaan = admin?.name ? `, ${admin.name}` : "";
  await kirimPesan(
    ctx.chatId,
    `Halo${namaSapaan}! 👋\n\n` +
      "Saya bot admin toko. Bisa bantu cek stok, HPP, info produk, sampai catat pemakaian stok dari screenshot picking list.\n\n" +
      "Ketik `/help` buat lihat daftar command, atau langsung tanya aja pakai bahasa biasa."
  );
}
async function handleHelp(ctx) {
  await kirimPesan(
    ctx.chatId,
    "*Daftar command:*\n" +
      "/start — mulai / sapaan awal\n" +
      "/reset — reset percakapan (mulai chat dari awal lagi)\n" +
      "/batal — batalkan draft/konfirmasi yang lagi nyangkut (opname, picking list, sync stok, dll), history TETAP disimpan\n" +
      "/sync_stok — sinkronisasi stok Firestore ↔ Google Sheets (dua arah, direview dulu)\n" +
      "/list_admins — tampilkan daftar semua admin _(hanya Super Admin)_\n" +
      "/revoke_admin — revoke akses admin dari user tertentu _(hanya Super Admin)_\n" +
      "/set_role — ubah role user _(hanya Super Admin)_\n" +
      "/settings — pilih provider AI _(hanya Super Admin)_\n" +
      "/histori_stok [kode] — lihat histori perubahan stok\n" +
      "/help — tampilkan pesan ini\n\n" +
      "Foto: kirim foto picking list biasa, atau foto dengan caption *opname* buat stok opname.\n\n" +
      "Stok opname juga bisa lewat teks: kirim daftar `nama - qty` per baris.\n\n" +
      "_Atau langsung tanya pakai bahasa biasa, nanti diproses AI._"
  );
}
async function handleReset(ctx) {
  await resetSession(ctx.telegramUserId);
  await kirimPesan(ctx.chatId, "Oke, percakapan direset. Mulai dari awal lagi ya 🙂");
}
// Beda dari /reset: ini TIDAK menghapus history percakapan, cuma "melepas" draft/state
// pending yang lagi nyangkut (misal admin ketik sesuatu di luar format yg diharapkan
// terus bot balas itu-itu terus, atau memang berubah pikiran di tengah alur).
async function handleBatal(ctx) {
  await hapusSemuaPendingState(ctx.telegramUserId);
  await kirimPesan(ctx.chatId, "Oke, semua draft/konfirmasi yang lagi nunggu sudah dibatalkan. 🙂");
}
// Batch 8 wiring: /sync_stok — pemicu manual alur F (sync dua arah, bagian 4F).
// mulaiSyncStok yang urus semua: baca Firestore+Sheets, hitung diff, simpan draft,
// kirim ringkasan ke chat. Balasan "ya .../batal" ditangani konfirmasiSyncStok
// (dicek di routePesan.js, bukan lewat DAFTAR_COMMAND ini).
async function handleSyncStok(ctx) {
  await mulaiSyncStok(ctx.telegramUserId, ctx.chatId);
}

// Batch 9: /list_admins — tampilkan daftar semua admin (hanya bisa Super Admin).
async function handleListAdmins(ctx) {
  const isSuperAdm = await isSuperAdmin(ctx.telegramUserId);
  if (!isSuperAdm) {
    await kirimPesan(ctx.chatId, "Perintah ini hanya bisa Super Admin.");
    return;
  }

  const admins = await ambilSemuaAdmin();
  
  if (admins.length === 0) {
    await kirimPesan(ctx.chatId, "Belum ada admin terdaftar.");
    return;
  }

  // Sort by role (owner → admin → guest) terus by name
  const urutAdmins = admins.sort((a, b) => {
    const roleOrder = { owner: 0, admin: 1, guest: 2 };
    const cmpRole = roleOrder[a.role] - roleOrder[b.role];
    if (cmpRole !== 0) return cmpRole;
    return (a.name || "").localeCompare(b.name || "");
  });

  let pesan = `📋 *Daftar Admin* (Total: ${admins.length})\n`;
  pesan += "─────────────────────\n";

  for (const admin of urutAdmins) {
    const icon = admin.role === "owner" ? "👑" : admin.role === "admin" ? "👤" : "👥";
    const tanggalTambah = admin.added_at
      ? new Date(admin.added_at.toDate ? admin.added_at.toDate() : admin.added_at)
          .toLocaleDateString("id-ID")
      : "—";
    pesan += `${icon} *${admin.name || "(tanpa nama)"}* (\`${admin.telegram_user_id}\`)\n`;
    pesan += `   • Role: ${admin.role} | Ditambah: ${tanggalTambah}\n`;
  }

  await kirimPesanPanjang(ctx.chatId, pesan, { parseMode: "Markdown" });
}

// Batch 9: /revoke_admin <user_id> — mulai alur revoke admin (hanya bisa Super Admin).
async function handleRevokeAdmin(ctx) {
  const isSuperAdm = await isSuperAdmin(ctx.telegramUserId);
  if (!isSuperAdm) {
    await kirimPesan(ctx.chatId, "Perintah ini hanya bisa Super Admin.");
    return;
  }

  if (!ctx.argumen || ctx.argumen.length === 0) {
    await kirimPesan(
      ctx.chatId,
      "Format: `/revoke_admin <user_id>`\n\nContoh: `/revoke_admin 123456789`",
      { parseMode: "Markdown" }
    );
    return;
  }

  const targetUserIdStr = ctx.argumen[0];
  await mulaiRevokeAdmin(ctx.telegramUserId, ctx.chatId, targetUserIdStr);
}

async function handleHistoriStok(ctx) {
  const admin = await ambilAdmin(ctx.telegramUserId);
  if (!admin || !["owner", "admin"].includes(admin.role)) {
    await kirimPesan(ctx.chatId, "Perintah ini hanya bisa admin atau Super Admin.");
    return;
  }

  const kodeBarang = ctx.argumen?.[0];
  const movements = kodeBarang
    ? await ambilPergerakanByKode(kodeBarang, 20)
    : await ambilPergerakanTerakhir(20);
  if (!movements.length) {
    await kirimPesan(ctx.chatId, "Belum ada histori perubahan stok.");
    return;
  }

  const baris = [`*Histori Stok${kodeBarang ? `: ${kodeBarang}` : ""}*`];
  for (const movement of movements) {
    const waktu = formatWaktu(movement.created_at);
    const actor = movement.requested_by_name || movement.requested_by_username || movement.requested_by || movement.created_by_name || movement.created_by || "tidak diketahui";
    const confirmer = movement.confirmed_by && String(movement.confirmed_by) !== String(movement.requested_by || movement.created_by)
      ? `; konfirmasi: ${movement.confirmed_by}`
      : "";
    // qty sudah DELTA BERTANDA (kontrak baru) — tampilkan tandanya apa adanya,
    // jangan di-prefix lagi (dulu `-${qty}` bikin tampil "--3").
    const delta = `${movement.qty >= 0 ? "+" : ""}${movement.qty}`;
    baris.push(`\n• ${waktu} — ${movement.nama_terbaca || movement.kode_barang}`);
    baris.push(`  ${delta} | instruksi: ${actor}${confirmer} | ${movement.type || "perubahan"}`);
  }
  await kirimPesanPanjang(ctx.chatId, baris.join("\n"), { parseMode: "Markdown" });
}

function formatWaktu(waktu) {
  const tanggal = waktu?.toDate ? waktu.toDate() : new Date(waktu);
  return Number.isNaN(tanggal.getTime()) ? "waktu tidak diketahui" : tanggal.toLocaleString("id-ID");
}

// Map nama command (tanpa "/", tanpa argumen) ke handler-nya.
const DAFTAR_COMMAND = {
  start: handleStart,
  help: handleHelp,
  reset: handleReset,
  batal: handleBatal,
  sync_stok: handleSyncStok,
  list_admins: handleListAdmins,
  revoke_admin: handleRevokeAdmin,
  set_role: handleSetRole,
  settings: handleSettings,
  histori_stok: handleHistoriStok,
};
// Pecah command dari teks pesan, buang "@namabot" kalau ada (format command di grup:
// "/start@nama_bot"), dan pisahkan argumen setelah command (belum dipakai di batch ini,
// disiapkan untuk command yang butuh argumen nanti).
function parseCommand(teks) {
  const [commandMentah, ...argumen] = teks.trim().split(/\s+/);
  const namaCommand = commandMentah.slice(1).split("@")[0].toLowerCase();
  return { namaCommand, argumen };
}
// ctx: { telegramUserId, chatId, message }
async function handleCommand(ctx) {
  const { namaCommand, argumen } = parseCommand(ctx.message.text);
  ctx.argumen = argumen;
  const handler = DAFTAR_COMMAND[namaCommand];
  if (!handler) {
    await kirimPesan(
      ctx.chatId,
      `Command \`/${namaCommand}\` belum dikenal. Ketik /help buat lihat daftar command yang tersedia.`
    );
    return;
  }
  await handler(ctx);
}
module.exports = { handleCommand, DAFTAR_COMMAND };
