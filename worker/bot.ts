// worker/bot.ts — Webhook + command bot Telegram di Worker (Fase 2).
// Strategi port bertahap: webhook + command D1 dasar SEKARANG (baca/tulis
// stok, gudang, admin, opname, transfer via lib/d1/*); AI chat/vision,
// screenshot picking, dan Sheets sync MENYUSUL (butuh binding AI + R2).
// Pola: api/webhook.js (secret header, selalu 200) + scaFlow telegram.js
// (callBot, chunkMessage, secretMatches constant-time) + routePesan
// (gating akses, dispatch).
import type { Env } from "./api";
import { ambilPengguna } from "./auth";
import { bacaQtyPerGudang, tulisQty, ubahRelatif } from "../lib/d1/stok";
import { ambilProduk, cariProduk } from "../lib/d1/produk";
import { listGudang } from "../lib/d1/gudang";
import { listOpname } from "../lib/d1/opname";
import { listTransfer } from "../lib/d1/transfer";
import { listAkses, mintaAkses } from "../lib/d1/akses";
import { ambilAdmin } from "../lib/d1/admin";
import { kapabilitas } from "../lib/d1/peran";
import type { Konteks } from "../lib/ai/provider";
import { panggilGambar } from "../lib/ai/panggil";
import { parsePerintahGambar } from "../lib/ai/parserGambar";
import { ekstrakPickingList } from "../lib/ai/vision";
import { balasChat } from "../lib/ai/chat";
import { ambilPengaturanAI } from "../lib/d1/pengaturan";
import { jalankanTool } from "../lib/ai/tools";
import { cekBatas } from "../lib/ai/rateLimit";

export type Update = {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; message?: TgMessage; data?: string };
  my_chat_member?: { chat: { id: number; type: string; title?: string }; new_chat_member: { status: string } };
};

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };
type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string; title?: string };
  text?: string;
  caption?: string;
  photo?: FotoTelegram[];
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Perbandingan constant-time untuk secret header (pola scaFlow). */
function secretCocok(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let beda = 0;
  for (let i = 0; i < a.length; i++) beda |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return beda === 0;
}

export async function kirimPesanBot(env: Env, chatId: number | string, teks: string, replyTo?: number): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN belum diset.");
  // Potong per ~3900 char per baris (pola scaFlow chunkMessage)
  const potongan: string[] = [];
  let sisa = teks;
  while (sisa.length > 3900) {
    let potong = sisa.lastIndexOf("\n", 3900);
    if (potong < 0) potong = 3900;
    potongan.push(sisa.slice(0, potong));
    sisa = sisa.slice(potong);
  }
  potongan.push(sisa);
  // B6-A: gabung potongan pendek yang berdekatan (hemat subrequest Telegram).
  const gabung: string[] = [];
  for (const p of potongan) {
    const akhir = gabung[gabung.length - 1];
    if (akhir !== undefined && akhir.length + p.length <= 3900) gabung[gabung.length - 1] = akhir + p;
    else gabung.push(p);
  }
  for (const p of gabung) {
    const body: Record<string, unknown> = { chat_id: chatId, text: p, parse_mode: "HTML", disable_web_page_preview: true };
    if (replyTo) body.reply_to_message_id = replyTo;
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      type TgErrorBody = { description?: string; parameters?: { migrate_to_chat_id?: number } };
      let data: TgErrorBody | null = null;
      try {
        data = JSON.parse(t) as TgErrorBody;
      } catch {
        data = null;
      }
      const desc = typeof data?.description === "string" ? data.description : t;
      const err = new Error(`sendMessage ${res.status}: ${desc.slice(0, 200)}`);
      (err as Error & { telegram?: unknown }).telegram = data;
      throw err;
    }
  }
}

/** Kirim atau perbarui pesan ber-tombol inline; mengembalikan message_id. */
export async function kirimPesanTombol(
  env: Env,
  chatId: number | string,
  teks: string,
  tombol: { teks: string; data: string }[][],
  replyTo?: number
): Promise<number | undefined> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN belum diset.");
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: teks,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: tombol.map((baris) => baris.map((t) => ({ text: t.teks, callback_data: t.data }))) },
  };
  if (replyTo) body.reply_to_message_id = replyTo;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return undefined;
  const data = (await res.json().catch(() => null)) as { result?: { message_id?: number } } | null;
  return data?.result?.message_id;
}

/** Ubah pesan yang sudah dikirim (hindari spam saat proses selesai). Tombol kosong = hapus keyboard. */
export async function editPesan(
  env: Env,
  chatId: number | string,
  messageId: number,
  teks: string,
  tombol?: { teks: string; data: string }[][]
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text: teks, parse_mode: "HTML", disable_web_page_preview: true };
  body.reply_markup = tombol ? { inline_keyboard: tombol.map((baris) => baris.map((t) => ({ text: t.teks, callback_data: t.data }))) } : { inline_keyboard: [] };
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

/** Tandai "sedang mengetik" selama AI berpikir. Kegagalan diabaikan (kosmetik). */
export async function kirimTyping(env: Env, chatId: number | string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  }).catch(() => undefined);
}

async function jawabCallback(env: Env, id: string, teks?: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text: teks ?? "" }),
  }).catch(() => undefined);
}

function namaUser(u?: TgUser): string {
  if (!u) return "?";
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id);
}

/** Gating akses: owner/admin lanjut; guest/belum → pesan arahan. */
async function gateAdmin(env: Env, tgId: string, chatId: number): Promise<{ role: string } | null> {
  const admin = await ambilAdmin(env.DB, tgId);
  // high_admin sedarajat admin (lib/d1/admin.ts: isAdmin = owner || high_admin || admin).
  // designer/guest sengaja DITOLAK di sini: gate ini berarti "boleh SELURUH perintah bot".
  // designer punya gate sendiri yang jauh lebih sempit (gateDesain), bukan role tambahan di sini —
  // menaruhnya di sini akan otomatis membuka /stok, /menipis, /laba, /gudang, /tambah,
  // /kurangi, /transfer, /opname, dan /cari.
  if (admin && (admin.role === "owner" || admin.role === "high_admin" || admin.role === "admin")) return { role: admin.role };
  if (admin?.role === "designer") return null; // ditangani gateDesain; jangan kirim pesan "belum terdaftar"
  const akses = await env.DB.prepare("SELECT status FROM access_requests WHERE tg_id = ?").bind(Number(tgId)).first<{ status: string }>().catch(() => null);
  if (!akses || akses.status === "rejected" || akses.status === "revoked") {
    await kirimPesanBot(env, chatId, `Halo! Kamu belum terdaftar.\nKirim <code>/daftar</code> untuk meminta akses admin.`);
  } else if (akses.status === "pending") {
    await kirimPesanBot(env, chatId, `Permintaan aksesmu masih menunggu persetujuan owner.`);
  } else {
    await kirimPesanBot(env, chatId, `Akses ditolak. Hubungi owner.`);
  }
  return null;
}

/** Pesan penolakan untuk designer yang mencoba jalur non-gambar: sebut yang BISA dipakai. */
const TOLAK_DESAIN =
  `Perintah itu tidak tersedia untuk akun desain.\nYang bisa kamu pakai: <code>@gambar deskripsi gambar</code> untuk membuat gambar ` +
  `(lampirkan foto = mode edit), dan chat seputar desain.`;

/**
 * Gating jalur desain: HANYA role `designer` yang lolos. Dipakai untuk chat desain
 * (bebas-tool) dan sebagai cadangan `@gambar`. Fail-closed: guest/tak terdaftar
 * ditolak dengan arahan pendaftaran, sama seperti gateAdmin.
 */
async function gateDesain(env: Env, tgId: string, chatId: number): Promise<{ role: string } | null> {
  const admin = await ambilAdmin(env.DB, tgId);
  if (admin?.role === "designer") return { role: admin.role };
  if (admin) return null; // role lain bukan urusan gate ini; pemanggilnya sudah menangani
  const akses = await env.DB.prepare("SELECT status FROM access_requests WHERE tg_id = ?").bind(Number(tgId)).first<{ status: string }>().catch(() => null);
  if (!akses || akses.status === "rejected" || akses.status === "revoked") {
    await kirimPesanBot(env, chatId, `Halo! Kamu belum terdaftar.\nKirim <code>/daftar</code> untuk meminta akses.`);
  } else if (akses.status === "pending") {
    await kirimPesanBot(env, chatId, `Permintaan aksesmu masih menunggu persetujuan owner.`);
  } else {
    await kirimPesanBot(env, chatId, `Akses ditolak. Hubungi owner.`);
  }
  return null;
}

/**
 * Gerbang untuk `@gambar`: satu-satunya jalur yang boleh dijangkau designer.
 * Dipilih lewat `kapabilitas().bolehGambar` supaya pesan penolakan dikirim
 * SEKALI saja (memanggil gateAdmin lalu gateDesain berurutan akan mengirim dua
 * pesan untuk guest yang belum terdaftar).
 */
async function gateGambar(env: Env, tgId: string, chatId: number): Promise<{ role: string } | null> {
  const role = (await ambilAdmin(env.DB, tgId))?.role ?? "";
  if (kapabilitas(role).bolehGambar) {
    const gate = await gateAdmin(env, tgId, chatId);
    return gate ?? gateDesain(env, tgId, chatId);
  }
  // guest / belum terdaftar / role tak dikenal → jalur pendaftaran yang biasa.
  await gateAdmin(env, tgId, chatId);
  return null;
}

function parseCommand(teks: string): { cmd: string; args: string[] } {
  const bersih = teks.trim().split("@")[0];
  const bagian = bersih.slice(1).split(/\s+/);
  return { cmd: (bagian[0] || "").toLowerCase(), args: bagian.slice(1) };
}

async function tanganiCommand(env: Env, tgId: string, chatId: number, msgId: number, teks: string, dari?: TgUser): Promise<void> {
  const { cmd, args } = parseCommand(teks);

  if (cmd === "start") {
    // /start jalan SEBELUM gate (registrasi harus tetap bisa), jadi teks bantuan
    // disesuaikan role: designer hanya diberi perintah yang benar-benar bisa dia pakai,
    // supaya bantuan tidak mengiklankan /stok, /tambah, dan kawan-kawan.
    if ((await ambilAdmin(env.DB, tgId))?.role === "designer") {
      await kirimPesanBot(
        env,
        chatId,
        `<b>SuPrapto Online — akun desain</b> 🎨\n\nYang bisa kamu pakai:\n<code>@gambar deskripsi gambar</code> — buat gambar\n<code>@gambar ubah latarnya</code> + foto terlampir — edit gambar\nTulis pertanyaan biasa seputar desain (komposisi, warna, layout, prompt gambar).\n\n/daftar — minta akses\n/batal — bersihkan sesi`,
        msgId
      );
      return;
    }
    await kirimPesanBot(env, chatId, `<b>SuPrapto Online</b> 🤖\n\nPerintah:\n/stok [kode] — cek stok\n/menipis — stok di bawah reorder\n/laba [7h|30h] — ringkasan laba per MP\n/gudang — daftar gudang\n/tambah &lt;kode&gt; &lt;qty&gt; — tambah stok ONLINE\n/kurangi &lt;kode&gt; &lt;qty&gt; — kurangi stok ONLINE\n/transfer — transfer pending\n/opname — opname menunggu approval\n/daftar — minta akses admin\n/batal — batalkan sesi kenalan`, msgId);
    return;
  }
  if (cmd === "daftar") {
    const u = await ambilPengguna(env.DB, tgId).catch(() => null);
    // Nama: pakai display_name yang sudah ada bila bukan placeholder telegramId,
    // selain itu ambil dari profil Telegram (first/last name).
    const dariTelegram = namaUser(dari);
    const nama = u?.display_name && u.display_name !== tgId ? u.display_name : dariTelegram;
    const username = dari?.username ?? null;
    const r = await mintaAkses(env.DB, Number(tgId), username, nama);
    if (!r.ok) {
      await kirimPesanBot(env, chatId, esc(r.status === 409 || r.status === 429 ? r.error : "Gagal meminta akses."), msgId);
      return;
    }
    await kirimPesanBot(env, chatId, `Permintaan akses terkirim. Tunggu persetujuan owner.`, msgId);
    // Notifikasi owner
    const { results } = await env.DB.prepare("SELECT tg_id FROM users WHERE role = 'owner' AND active = 1").bind().all<{ tg_id: number }>().catch(() => ({ results: [] as { tg_id: number }[] }));
    for (const o of results) {
      await kirimPesanBot(env, o.tg_id, `📝 Permintaan akses baru dari <b>${esc(nama)}</b> (<code>${esc(tgId)}</code>).\nSetujui di dashboard admin.`).catch(() => undefined);
    }
    return;
  }
  if (cmd === "batal" || cmd === "reset") {
    await env.DB.prepare("DELETE FROM bot_sessions WHERE tg_id = ?").bind(Number(tgId)).run().catch(() => undefined);
    await kirimPesanBot(env, chatId, `Sesi bot dibersihkan.`, msgId);
    return;
  }

  // `designer` DITOLAK untuk semua perintah non-gambar — sebut apa yang bisa dia pakai.
  // Dicek sebelum gateAdmin supaya designer tidak menerima pesan "belum terdaftar" yang
  // menyesatkan, dan supaya /stok, /tambah, /kurangi, /transfer, /opname, /cari, /menipis,
  // /laba, /gudang tidak pernah dieksekusi untuk role ini.
  // `guest` SENGAJA tidak masuk cabang ini: penolakannya tetap lewat gateAdmin (pesan
  // pendaftaran), jadi perilakunya tak berubah.
  if ((await ambilAdmin(env.DB, tgId))?.role === "designer") {
    await kirimPesanBot(env, chatId, TOLAK_DESAIN, msgId);
    return;
  }

  const gate = await gateAdmin(env, tgId, chatId);
  if (!gate) return;

  if (cmd === "stok") {
    if (args[0]) {
      const sku = args[0].toUpperCase();
      const p = await ambilProduk(env.DB, sku);
      if (!p) {
        await kirimPesanBot(env, chatId, `Produk <code>${esc(sku)}</code> tidak ditemukan.`, msgId);
        return;
      }
      const qty = await bacaQtyPerGudang(env.DB, sku);
      const baris = Object.entries(qty).map(([g, q]) => `${esc(g)}: <b>${q}</b>`).join("\n") || "(kosong)";
      await kirimPesanBot(env, chatId, `<b>${esc(p.nama_accurate)}</b> (<code>${esc(sku)}</code>)\n${baris}`, msgId);
      return;
    }
    const { results } = await env.DB.prepare(
      `SELECT p.sku, p.nama_accurate, b.qty FROM products p JOIN stock_by_bin b ON b.sku = p.sku
       WHERE p.is_online_product = 1 AND b.warehouse_id = 'ONLINE' ORDER BY p.sku LIMIT 50`
    ).bind().all<{ sku: string; nama_accurate: string; qty: number }>();
    if (results.length === 0) {
      await kirimPesanBot(env, chatId, `Belum ada produk online.`, msgId);
      return;
    }
    await kirimPesanBot(env, chatId, `<b>Stok ONLINE</b>\n` + results.map((r) => `<code>${esc(r.sku)}</code> ${esc(r.nama_accurate)}: <b>${r.qty}</b>`).join("\n"), msgId);
    return;
  }

  if (cmd === "menipis") {
    const { results } = await env.DB.prepare(
      `SELECT p.sku, p.nama_accurate, b.qty, p.stok_min FROM products p JOIN stock_by_bin b ON b.sku = p.sku
       WHERE p.stok_min IS NOT NULL AND b.qty < p.stok_min AND b.warehouse_id = 'ONLINE' ORDER BY b.qty ASC LIMIT 30`
    ).bind().all<{ sku: string; nama_accurate: string; qty: number; stok_min: number }>();
    if (results.length === 0) {
      await kirimPesanBot(env, chatId, `Semua stok aman. ✅`, msgId);
      return;
    }
    await kirimPesanBot(env, chatId, `<b>Stok menipis</b>\n` + results.map((r) => `<code>${esc(r.sku)}</code> ${esc(r.nama_accurate)}: <b>${r.qty}</b> (min ${r.stok_min})`).join("\n"), msgId);
    return;
  }
  if (cmd === "laba") {
    // Agregat registry laba_order per preset (7/30 hari, distinct No). Laba hanya dihitung di /laba (A4).
    const arg = (args[0] || "7h").toLowerCase();
    const hari = arg === "30h" ? 30 : 7;
    const { results } = await env.DB.prepare(
      "SELECT s.preset_id, p.nama, COUNT(*) AS order_no, COALESCE(SUM(s.omzet), 0) AS omzet, COALESCE(SUM(s.laba), 0) AS laba " +
      "FROM laba_order s JOIN seller_presets p ON p.id = s.preset_id " +
      "WHERE s.tanggal_snapshot >= date('now', ?) GROUP BY s.preset_id, p.nama ORDER BY laba DESC"
    ).bind(`-${hari} days`).all<{ preset_id: number; nama: string; order_no: number; omzet: number; laba: number }>();
    const hasil = results.length > 0 ? results : (await env.DB.prepare(
      "SELECT s.preset_id, p.nama, SUM(s.jml_order) AS order_no, SUM(s.omzet) AS omzet, SUM(s.laba) AS laba " +
      "FROM laba_snapshot s JOIN seller_presets p ON p.id = s.preset_id " +
      "WHERE s.tanggal >= date('now', ?) GROUP BY s.preset_id, p.nama ORDER BY laba DESC"
    ).bind(`-${hari} days`).all<{ preset_id: number; nama: string; order_no: number; omzet: number; laba: number }>()).results;
    if (hasil.length === 0) {
      await kirimPesanBot(env, chatId, `Belum ada snapshot laba ${hari} hari terakhir. Hitung dulu di /laba.`, msgId);
      return;
    }
    const baris = [`<b>Laba ${hari}h per preset</b>`];
    let totalOmzet = 0;
    let totalLaba = 0;
    for (const r of hasil) {
      baris.push(`${esc(r.nama)}: ${r.order_no} order, omzet <b>${r.omzet}</b>, laba <b>${r.laba}</b>`);
      totalOmzet += r.omzet;
      totalLaba += r.laba;
    }
    baris.push(`Total omzet <b>${totalOmzet}</b>, laba <b>${totalLaba}</b>`);
    await kirimPesanBot(env, chatId, baris.join("\n"), msgId);
    return;
  }

  if (cmd === "gudang") {
    const daftar = await listGudang(env.DB, false);
    await kirimPesanBot(env, chatId, `<b>Daftar gudang</b>\n` + daftar.map((g) => `• ${esc(g.nama)} (<code>${esc(g.id)}</code>)`).join("\n"), msgId);
    return;
  }

  if (cmd === "tambah" || cmd === "kurangi") {
    const sku = (args[0] || "").toUpperCase();
    const qty = Math.floor(Number(args[1]));
    if (!sku || !Number.isInteger(qty) || qty < 1) {
      await kirimPesanBot(env, chatId, `Format: <code>/${cmd} KODE qty</code>`, msgId);
      return;
    }
    const p = await ambilProduk(env.DB, sku);
    if (!p) {
      await kirimPesanBot(env, chatId, `Produk <code>${esc(sku)}</code> tidak ditemukan.`, msgId);
      return;
    }
    const r = await ubahRelatif(env.DB, sku, "ONLINE", cmd === "tambah" ? qty : -qty, tgId, "koreksi_manual", "manual_chat");
    if (!r.ok) {
      await kirimPesanBot(env, chatId, esc(r.error), msgId);
      return;
    }
    await kirimPesanBot(env, chatId, `<code>${esc(sku)}</code> → <b>${r.nilai_baru}</b>`, msgId);
    return;
  }

  if (cmd === "transfer") {
    const daftar = await listTransfer(env.DB, {});
    const aktif = daftar.filter((t) => !["selesai", "dibatalkan", "ditolak"].includes(t.status)).slice(0, 10);
    if (aktif.length === 0) {
      await kirimPesanBot(env, chatId, `Tidak ada transfer aktif.`, msgId);
      return;
    }
    await kirimPesanBot(env, chatId, `<b>Transfer aktif</b>\n` + aktif.map((t) => `<code>${esc(t.id)}</code> ${esc(t.dari_warehouse_id)} → ${t.tujuan.length} tujuan (${esc(t.status)})`).join("\n"), msgId);
    return;
  }

  if (cmd === "opname") {
    const daftar = await listOpname(env.DB, "menunggu_approval");
    if (daftar.length === 0) {
      await kirimPesanBot(env, chatId, `Tidak ada opname menunggu approval.`, msgId);
      return;
    }
    await kirimPesanBot(env, chatId, `<b>Opname menunggu</b>\n` + daftar.slice(0, 10).map((o) => `<code>${esc(o.id)}</code> ${esc(o.warehouse_id)} (${o.items.length} item)`).join("\n"), msgId);
    return;
  }

  if (cmd === "cari") {
    const kunci = args.join(" ");
    if (!kunci) {
      await kirimPesanBot(env, chatId, `Format: <code>/cari nama produk</code>`, msgId);
      return;
    }
    const hasil = await cariProduk(env.DB, kunci, 10);
    if (hasil.length === 0) {
      await kirimPesanBot(env, chatId, `Tidak ketemu untuk "${esc(kunci)}".`, msgId);
      return;
    }
    await kirimPesanBot(env, chatId, hasil.map((h) => `<code>${esc(h.sku)}</code> ${esc(h.nama_accurate)}`).join("\n"), msgId);
    return;
  }

  if (cmd === "akses" && gate.role === "owner") {
    const daftar = await listAkses(env.DB, "pending");
    if (daftar.length === 0) {
      await kirimPesanBot(env, chatId, `Tidak ada permintaan akses pending.`, msgId);
      return;
    }
    await kirimPesanBot(env, chatId, `<b>Permintaan akses</b>\n` + daftar.map((a) => `<code>${a.tg_id}</code> ${esc(a.telegram_display_name ?? "-")}`).join("\n") + `\n\nSetujui via dashboard admin.`, msgId);
    return;
  }

  await kirimPesanBot(env, chatId, `Perintah tidak dikenal. Kirim /start untuk daftar, atau tulis pertanyaan biasa (mis. <code>stok 001163</code>).`, msgId);
}

/** Entry webhook: validasi secret → selalu 200 → proses via waitUntil. */
export async function tanganiWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return new Response(JSON.stringify({ ok: false }), { status: 405 });
  const rahasia = env.TELEGRAM_WEBHOOK_SECRET as string | undefined;
  if (rahasia) {
    const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!secretCocok(header, rahasia)) return new Response(JSON.stringify({ ok: false }), { status: 401 });
  }
  let update: Update;
  try {
    update = (await request.json()) as Update;
  } catch {
    return new Response(JSON.stringify({ ok: true }));
  }
  ctx.waitUntil(prosesUpdate(env, update).catch((e) => console.error("[bot]", e instanceof Error ? e.message : e)));
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
}

/** Migrasi grup → supergroup (pelajaran scaFlow FIX_NOTES v13). */
async function tanganiMigrasiGrup(env: Env, msg: TgMessage): Promise<boolean> {
  const body = msg as TgMessage & { migrate_to_chat_id?: number; migrate_from_chat_id?: number };
  const baru = body.migrate_to_chat_id ?? (body.migrate_from_chat_id ? msg.chat.id : null);
  const lama = body.migrate_to_chat_id ? msg.chat.id : (body.migrate_from_chat_id ?? null);
  if (!baru || !lama) return false;
  await env.DB.prepare(
    "UPDATE groups SET chat_id = ?, chat_type = 'supergroup', last_error = NULL WHERE chat_id = ?"
  ).bind(baru, lama).run().catch(() => undefined);
  // Pindahkan antrean belum terkirim ke chat baru
  await env.DB.prepare("UPDATE notify_queue SET target_group = ? WHERE target_group = ? AND sent_at IS NULL").bind(baru, lama).run().catch(() => undefined);
  // Hapus baris duplikat untuk chat baru bila ada
  await env.DB.prepare("DELETE FROM groups WHERE chat_id = ? AND id NOT IN (SELECT MIN(id) FROM groups WHERE chat_id = ?)").bind(baru, baru).run().catch(() => undefined);
  return true;
}

/** Batas ukuran foto Telegram yang diterima (Bot API maks unduhan 20MB; kita batasi 10MB). */
const MAKS_FOTO_BYTE = 10 * 1024 * 1024;

type FotoTelegram = { file_id: string; file_size?: number };

/** File terbesar dari daftar ukuran photo Telegram (item terakhir = resolusi tertinggi). */
function fotoTerbesar(foto: FotoTelegram[]): FotoTelegram | undefined {
  return foto.length ? foto[foto.length - 1] : undefined;
}

/** Ambil metadata file Telegram (dipakai untuk ukuran + file_path unduhan). */
async function getFileTelegram(env: Env, fileId: string): Promise<{ file_path?: string; file_size?: number } | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: { file_path?: string; file_size?: number } } | null;
  return data?.ok ? (data.result ?? null) : null;
}

/** Unduh isi file Telegram sebagai base64. Melempar bila token/file tidak tersedia. */
async function unduhFotoTelegram(env: Env, filePath: string): Promise<string> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN belum diset.");
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!res.ok) throw new Error(`Unduh file Telegram gagal (HTTP ${res.status}).`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let biner = "";
  for (const b of buf) biner += String.fromCharCode(b);
  return btoa(biner);
}

/** Kirim gambar (base64) ke chat sebagai FOTO, bukan link. */
async function kirimFotoBot(env: Env, chatId: number | string, base64: string, mime: string, caption?: string, replyTo?: number): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN belum diset.");
  const biner = atob(base64);
  const bytes = new Uint8Array(biner.length);
  for (let i = 0; i < biner.length; i++) bytes[i] = biner.charCodeAt(i);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([bytes], { type: mime }), "gambar.png");
  if (caption) form.append("caption", caption.slice(0, 1024));
  if (replyTo) form.append("reply_to_message_id", String(replyTo));
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`sendPhoto ${res.status}: ${t.slice(0, 200)}`);
  }
}

/** Jalur `@gambar`: text-to-image, atau edit bila ada lampiran foto sebagai referensi. */
async function jalurGambar(env: Env, msg: TgMessage, prompt: string, tgId: string, chatId: number, foto: FotoTelegram[]): Promise<void> {
  // Satu-satunya jalur yang terbuka untuk designer. Peran lain tetap lewat gateAdmin.
  const gate = await gateGambar(env, tgId, chatId);
  if (!gate) return;
  if (!prompt) {
    await kirimPesanBot(env, chatId, `Format: <code>@gambar deskripsi gambar</code>\nBoleh dengan lampiran foto sebagai referensi (mode edit).`, msg.message_id);
    return;
  }
  await kirimTyping(env, chatId);
  // `role` diteruskan: izin model gambar per role (ROLE_GAMBAR/include designer) ditegakkan
  // di dalam provider, jadi bot Telegram tidak bisa menembus allowlist dashboard.
  const ctx: Konteks = { db: env.DB, kunci: env.AI_KEY_ENCRYPTION_KEY ?? "", role: gate.role };

  let referensi: { mime: string; base64: string }[] | undefined;
  if (foto.length) {
    const fileTerpilih = fotoTerbesar(foto);
    const info = fileTerpilih ? await getFileTelegram(env, fileTerpilih.file_id) : null;
    const ukuran = info?.file_size ?? fileTerpilih?.file_size ?? 0;
    if (ukuran > MAKS_FOTO_BYTE) {
      await kirimPesanBot(env, chatId, `Foto terlalu besar (${Math.round(ukuran / 1024 / 1024)} MB). Batas 10 MB.`, msg.message_id);
      return;
    }
    if (!info?.file_path) {
      await kirimPesanBot(env, chatId, `Gagal mengambil file foto dari Telegram. Coba kirim ulang.`, msg.message_id);
      return;
    }
    try {
      const unduh = await unduhFotoTelegram(env, info.file_path);
      referensi = [{ mime: "image/jpeg", base64: unduh }];
    } catch (e) {
      await kirimPesanBot(env, chatId, `Gagal mengunduh foto: ${esc(e instanceof Error ? e.message : String(e))}`, msg.message_id);
      return;
    }
  }

  const r = await panggilGambar(ctx, { prompt, referensi });
  if (!r.ok) {
    await kirimPesanBot(env, chatId, `Gagal membuat gambar (HTTP ${r.status}). Provider/model yang dicoba: ${esc(r.error)}`, msg.message_id);
    return;
  }
  await kirimFotoBot(env, chatId, r.base64, r.mime, `Dibuat oleh ${r.provider}/${r.model}`, msg.message_id);
}

/** Jalur foto tanpa perintah: ekstraksi picking list (vision) lalu ringkas sebagai tabel. */
async function jalurVision(env: Env, msg: TgMessage, tgId: string, chatId: number, foto: FotoTelegram[]): Promise<void> {
  // designer TIDAK boleh menyentuh vision: jalur ini membaca isi picking list
  // (nama produk + qty) dan hasilnya ditampilkan — kebocoran data inventory.
  // Diarahkan ke `@gambar` (dengan lampiran foto) untuk keperluan edit gambar.
  if ((await ambilAdmin(env.DB, tgId))?.role === "designer") {
    await kirimPesanBot(
      env,
      chatId,
      `Foto tanpa perintah hanya untuk admin.\nKalau mau mengedit gambar, kirim dengan perintah: <code>@gambar ubah sesuai keinginan</code> + foto terlampir.`,
      msg.message_id
    );
    return;
  }
  const gate = await gateAdmin(env, tgId, chatId);
  if (!gate) return;
  await kirimTyping(env, chatId);
  const fileTerpilih = fotoTerbesar(foto);
  const info = fileTerpilih ? await getFileTelegram(env, fileTerpilih.file_id) : null;
  const ukuran = info?.file_size ?? fileTerpilih?.file_size ?? 0;
  if (ukuran > MAKS_FOTO_BYTE) {
    await kirimPesanBot(env, chatId, `Foto terlalu besar (${Math.round(ukuran / 1024 / 1024)} MB). Batas 10 MB.`, msg.message_id);
    return;
  }
  if (!info?.file_path) {
    await kirimPesanBot(env, chatId, `Gagal mengambil file foto dari Telegram. Coba kirim ulang.`, msg.message_id);
    return;
  }
  let base64Foto: string;
  try {
    base64Foto = await unduhFotoTelegram(env, info.file_path);
  } catch (e) {
    await kirimPesanBot(env, chatId, `Gagal mengunduh foto: ${esc(e instanceof Error ? e.message : String(e))}`, msg.message_id);
    return;
  }
  // `role` diteruskan supaya izin model vision per role tetap ditegakkan di provider.
  const ctx: Konteks = { db: env.DB, kunci: env.AI_KEY_ENCRYPTION_KEY ?? "", role: gate.role };
  const r = await ekstrakPickingList(ctx, { mime: "image/jpeg", base64: base64Foto });
  if (!r.ok) {
    await kirimPesanBot(env, chatId, `Gagal membaca picking list: ${esc(r.error)}`, msg.message_id);
    return;
  }
  if (r.baris.length === 0) {
    await kirimPesanBot(env, chatId, `Tidak ada baris picking list yang terbaca di foto ini.`, msg.message_id);
    return;
  }
  const lebarSku = Math.max(3, ...r.baris.map((b) => b.sku.length));
  const barisTeks = r.baris.map((b) => `${b.sku.padEnd(lebarSku)}  x${b.qty}`);
  const total = r.baris.reduce((s, b) => s + b.qty, 0);
  const catatan = r.catatan ? `\n\n<i>${esc(r.catatan)}</i>` : "";
  await kirimPesanBot(env, chatId, `<b>Hasil baca picking list</b>\n<pre>${esc(barisTeks.join("\n"))}</pre>\nTotal: <b>${total}</b> pcs / ${r.baris.length} baris${catatan}`, msg.message_id);
}

/** Riwayat disimpan di kolom yang sudah ada (bot_sessions.history_json), format [{role, teks}]. */
type EntriRiwayat = { role: "user" | "assistant"; teks: string };

async function bacaRiwayat(env: Env, tgId: string): Promise<EntriRiwayat[]> {
  const row = await env.DB.prepare("SELECT history_json FROM bot_sessions WHERE tg_id = ?")
    .bind(Number(tgId))
    .first<{ history_json: string }>()
    .catch(() => null);
  if (!row?.history_json) return [];
  try {
    const v = JSON.parse(row.history_json) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is EntriRiwayat => !!x && typeof x === "object" && ((x as EntriRiwayat).role === "user" || (x as EntriRiwayat).role === "assistant") && typeof (x as EntriRiwayat).teks === "string")
      .map((x) => ({ role: x.role, teks: String(x.teks).slice(0, 2000) }));
  } catch {
    return [];
  }
}

/** Simpan riwayat + aksi tertunda sekaligus (kolom sudah ada sejak 0006). */
async function simpanSesi(
  env: Env,
  tgId: string,
  riwayat: EntriRiwayat[],
  tertunda?: { aksi: string; arg: Record<string, unknown>; ringkas: string } | null
): Promise<void> {
  const potong = riwayat.slice(-20);
  await env.DB.prepare(
    "INSERT INTO bot_sessions (tg_id, history_json, last_updated, pending_action_json) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(tg_id) DO UPDATE SET history_json = excluded.history_json, last_updated = excluded.last_updated, pending_action_json = excluded.pending_action_json"
  )
    .bind(Number(tgId), JSON.stringify(potong), Math.floor(Date.now() / 1000), tertunda ? JSON.stringify(tertunda) : null)
    .run()
    .catch(() => undefined);
}

async function bacaTertunda(env: Env, tgId: string): Promise<{ aksi: string; arg: Record<string, unknown>; ringkas: string } | null> {
  const row = await env.DB.prepare("SELECT pending_action_json FROM bot_sessions WHERE tg_id = ?")
    .bind(Number(tgId))
    .first<{ pending_action_json: string | null }>()
    .catch(() => null);
  if (!row?.pending_action_json) return null;
  try {
    const v = JSON.parse(row.pending_action_json) as { aksi?: string; arg?: Record<string, unknown>; ringkas?: string };
    if (typeof v.aksi !== "string" || !v.arg) return null;
    return { aksi: v.aksi, arg: v.arg, ringkas: String(v.ringkas ?? "") };
  } catch {
    return null;
  }
}

/** HTML aman: hanya izinkan <b>/<code>/<i>/<pre> dari output AI, escape sisanya. */
function amanHtml(teks: string): string {
  return esc(teks)
    .replace(/&lt;(\/?)(b|code|i|pre)&gt;/gi, "<$1$2>")
    .replace(/\n/g, "\n");
}

/** Jalur teks biasa → orchestrator AI, dengan typing + riwayat + tombol konfirmasi. */
async function jalurAiTeks(env: Env, tgId: string, chatId: number, msgId: number, teks: string, tanpaTool: boolean, role = ""): Promise<void> {
  const batas = await cekBatas(env.DB, tgId, 20);
  if (!batas.ok) {
    await kirimPesanBot(env, chatId, esc(batas.error), msgId);
    return;
  }
  await kirimTyping(env, chatId);
  const settings = await ambilPengaturanAI(env.DB, { AI_KEY_ENCRYPTION_KEY: env.AI_KEY_ENCRYPTION_KEY, KENARI_BASE_URL: env.KENARI_BASE_URL });
  const riwayatLama = await bacaRiwayat(env, tgId);
  const balasan = await balasChat(env.DB, {
    pesan: teks,
    riwayat: riwayatLama.map((r) => ({ role: r.role, teks: r.teks })),
    user: { tg_id: tgId },
    settings,
    kunci: env.AI_KEY_ENCRYPTION_KEY ?? "",
    // Role diteruskan: izin model per role (lib/d1/aiIzinModel.ts) ditegakkan sama
    // seperti dashboard, dan `tanpaTool` menegakkan chat bebas-tool untuk designer
    // (bukan sekadar imbauan di prompt — tool tidak dikirim ke provider sama sekali).
    role: role || undefined,
    tanpaTool,
    env,
  });
  const baru: EntriRiwayat[] = [...riwayatLama, { role: "user", teks }, { role: "assistant", teks: "" }];
  if (!balasan.ok) {
    baru[baru.length - 1] = { role: "assistant", teks: `(galat) ${balasan.error}` };
    await simpanSesi(env, tgId, baru, null);
    await kirimPesanBot(env, chatId, `Gagal memproses: ${esc(balasan.error)}`, msgId);
    return;
  }
  baru[baru.length - 1] = { role: "assistant", teks: balasan.balasan };
  if (balasan.perluKonfirmasi) {
    await simpanSesi(env, tgId, baru, balasan.perluKonfirmasi);
    await kirimPesanTombol(
      env,
      chatId,
      `${amanHtml(balasan.balasan)}\n\nTerapkan perubahan ini?`,
      [
        [
          { teks: "Ya, terapkan", data: "ai:ya" },
          { teks: "Tidak", data: "ai:tidak" },
        ],
      ],
      msgId
    );
    return;
  }
  await simpanSesi(env, tgId, baru, null);
  await kirimPesanBot(env, chatId, amanHtml(balasan.balasan), msgId);
}

/** Tombol konfirmasi AI: `ai:ya` menjalankan aksi tertunda, `ai:tidak` membatalkan. */
async function tanganiCallbackAi(
  env: Env,
  callbackId: string,
  tgId: string,
  chatId: number | undefined,
  messageId: number | undefined,
  data: string
): Promise<void> {
  if (chatId === undefined || messageId === undefined) {
    await jawabCallback(env, callbackId, "Pesan tidak ditemukan.");
    return;
  }
  const tertunda = await bacaTertunda(env, tgId);
  if (data === "ai:tidak") {
    await simpanSesi(env, tgId, await bacaRiwayat(env, tgId), null);
    await jawabCallback(env, callbackId, "Dibatalkan.");
    await editPesan(env, chatId, messageId, "Dibatalkan. Tidak ada perubahan stok.");
    return;
  }
  if (!tertunda) {
    await jawabCallback(env, callbackId, "Tidak ada aksi tertunda.");
    await editPesan(env, chatId, messageId, "Aksi sudah tidak berlaku. Ulangi perintahmu.");
    return;
  }
  // KONTROL AKSES (bukan sekadar tombol): `ai:ya` mengeksekusi aksi TULIS lewat
  // `jalankanTool`. Tanpa cek ini, siapa pun yang bisa mengirim callback `ai:ya`
  // mengeksekusi aksi tertunda miliknya sendiri tanpa pernah melewati gateAdmin —
  // dan karena designer chat-nya bebas-tool, dia juga tidak boleh sampai ke sini.
  // Aturan: role yang tidak boleh memakai perintah bot (kapabilitas().bolehPerintah)
  // tidak boleh mengeksekusi aksi AI apa pun.
  const peranCb = (await ambilAdmin(env.DB, tgId))?.role ?? "";
  if (!kapabilitas(peranCb).bolehPerintah) {
    // Aksi tertunda dibersihkan supaya tidak bisa dicoba lagi (mis. setelah role diubah).
    await simpanSesi(env, tgId, await bacaRiwayat(env, tgId), null);
    await jawabCallback(env, callbackId, "Tidak diizinkan.");
    await editPesan(env, chatId, messageId, "Aksi ini tidak diizinkan untuk role kamu.");
    return;
  }
  const r = await jalankanTool(env.DB, tertunda.aksi, tertunda.arg, { tg_id: tgId });
  await simpanSesi(env, tgId, await bacaRiwayat(env, tgId), null);
  await jawabCallback(env, callbackId, r.ok ? "Diterapkan." : "Gagal.");
  await editPesan(env, chatId, messageId, amanHtml(r.ok ? `Diterapkan.\n${r.ringkas}` : `Gagal: ${r.error}`));
}

async function prosesUpdate(env: Env, update: Update): Promise<void> {
  // Lifecycle grup: join/left via my_chat_member
  if (update.my_chat_member) {
    const m = update.my_chat_member;
    const status = m.new_chat_member.status;
    if (status === "left" || status === "kicked") {
      await env.DB.prepare("UPDATE groups SET status = 'left' WHERE chat_id = ?").bind(m.chat.id).run().catch(() => undefined);
    } else {
      await env.DB.prepare(
        "INSERT INTO groups (chat_id, title, chat_type, status) VALUES (?, ?, ?, 'detected') ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title"
      ).bind(m.chat.id, m.chat.title ?? "", m.chat.type).run().catch(() => undefined);
    }
    return;
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data ?? "";
    // Prefix `ai:` dipakai tombol konfirmasi aksi AI (ya/tidak).
    if (data.startsWith("ai:") && cb.from) {
      await tanganiCallbackAi(env, cb.id, String(cb.from.id), cb.message?.chat.id, cb.message?.message_id, data);
      return;
    }
    await jawabCallback(env, cb.id, "Diproses di dashboard (bot penuh Fase 2).");
    return;
  }
  const msg = update.message;
  if (!msg) return;
  // Migrasi grup → supergroup datang sebagai message biasa (pola scaFlow FIX_NOTES v13).
  if (await tanganiMigrasiGrup(env, msg)) return;
  if (!msg.from) return;
  const tgId = String(msg.from.id);
  const chatId = msg.chat.id;
  // §6.1: cek foto DI ATAS cek teks — foto bercaption tidak boleh bocor ke jalur teks.
  if (msg.photo?.length) {
    const perintahFoto = parsePerintahGambar(msg.caption ?? "");
    if (perintahFoto.adaPerintah) await jalurGambar(env, msg, perintahFoto.prompt, tgId, chatId, msg.photo);
    else await jalurVision(env, msg, tgId, chatId, msg.photo);
    return;
  }
  const teks = (msg.text ?? msg.caption ?? "").trim();
  if (!teks) return;
  if (teks.startsWith("/")) {
    await tanganiCommand(env, tgId, chatId, msg.message_id, teks, msg.from);
    return;
  }
  const perintah = parsePerintahGambar(teks);
  if (perintah.adaPerintah) {
    await jalurGambar(env, msg, perintah.prompt, tgId, chatId, []);
    return;
  }
  // Teks biasa → AI. Riwayat disimpan di bot_sessions.history_json.
  // designer: chat DESAIN tanpa tool apa pun (kapabilitas().chatTanpaTool),
  // jadi balasChat tidak pernah dibiarkan memilih tool di jalur ini.
  const peran = (await ambilAdmin(env.DB, tgId))?.role ?? "";
  const gate = await gateAdmin(env, tgId, chatId);
  if (gate) {
    await jalurAiTeks(env, tgId, chatId, msg.message_id, teks, kapabilitas(gate.role).chatTanpaTool, gate.role);
    return;
  }
  if (peran === "designer" && (await gateDesain(env, tgId, chatId))) {
    await jalurAiTeks(env, tgId, chatId, msg.message_id, teks, true, "designer");
  }
}
