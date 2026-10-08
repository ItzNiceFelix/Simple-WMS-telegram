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
  photo?: { file_id: string }[];
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
  for (const p of potongan) {
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
  if (admin && (admin.role === "owner" || admin.role === "admin")) return { role: admin.role };
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

function parseCommand(teks: string): { cmd: string; args: string[] } {
  const bersih = teks.trim().split("@")[0];
  const bagian = bersih.slice(1).split(/\s+/);
  return { cmd: (bagian[0] || "").toLowerCase(), args: bagian.slice(1) };
}

async function tanganiCommand(env: Env, tgId: string, chatId: number, msgId: number, teks: string): Promise<void> {
  const { cmd, args } = parseCommand(teks);

  if (cmd === "start") {
    await kirimPesanBot(env, chatId, `<b>Simple-WMS</b> 🤖\n\nPerintah:\n/stok [kode] — cek stok\n/menipis — stok di bawah reorder\n/gudang — daftar gudang\n/tambah &lt;kode&gt; &lt;qty&gt; — tambah stok ONLINE\n/kurangi &lt;kode&gt; &lt;qty&gt; — kurangi stok ONLINE\n/transfer — transfer pending\n/opname — opname menunggu approval\n/daftar — minta akses admin\n/batal — batalkan sesi kenalan`, msgId);
    return;
  }
  if (cmd === "daftar") {
    const u = await ambilPengguna(env.DB, tgId).catch(() => null);
    const r = await mintaAkses(env.DB, Number(tgId), null, u?.display_name ?? tgId);
    if (!r.ok) {
      await kirimPesanBot(env, chatId, esc(r.status === 409 || r.status === 429 ? r.error : "Gagal meminta akses."), msgId);
      return;
    }
    await kirimPesanBot(env, chatId, `Permintaan akses terkirim. Tunggu persetujuan owner.`, msgId);
    // Notifikasi owner
    const { results } = await env.DB.prepare("SELECT tg_id FROM users WHERE role = 'owner' AND active = 1").bind().all<{ tg_id: number }>().catch(() => ({ results: [] as { tg_id: number }[] }));
    for (const o of results) {
      await kirimPesanBot(env, o.tg_id, `📝 Permintaan akses baru dari <code>${esc(tgId)}</code>.\nSetujui di dashboard admin.`).catch(() => undefined);
    }
    return;
  }
  if (cmd === "batal" || cmd === "reset") {
    await env.DB.prepare("DELETE FROM bot_sessions WHERE tg_id = ?").bind(Number(tgId)).run().catch(() => undefined);
    await kirimPesanBot(env, chatId, `Sesi bot dibersihkan.`, msgId);
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

  await kirimPesanBot(env, chatId, `Perintah tidak dikenal. Kirim /start untuk daftar. AI chat menyusul di Fase 2.`, msgId);
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
  const teks = (msg.text ?? msg.caption ?? "").trim();
  if (!teks) {
    // Foto tanpa caption → info (vision menyusul Fase 2 lanjutan)
    if (msg.photo?.length) {
      const gate = await gateAdmin(env, tgId, chatId);
      if (!gate) return;
      await kirimPesanBot(env, chatId, `Foto diterima. Ekstraksi picking list (vision) menyusul — sementara catat via /tambah /kurangi atau dashboard.`, msg.message_id);
    }
    return;
  }
  if (teks.startsWith("/")) {
    await tanganiCommand(env, tgId, chatId, msg.message_id, teks);
    return;
  }
  // Teks biasa: gating akses, balas info (AI chat menyusul)
  const gate = await gateAdmin(env, tgId, chatId);
  if (!gate) return;
  if (/^(halo|hai|pagi|siang|sore|malam|makasih|terima kasih|ok|oke)\b/i.test(teks)) {
    await kirimPesanBot(env, chatId, `Halo ${esc(namaUser(msg.from))}! Kirim /start untuk daftar perintah.`, msg.message_id);
    return;
  }
  await kirimPesanBot(env, chatId, `AI chat menyusul di Fase 2. Sementara: /stok, /tambah, /kurangi, /cari, /transfer, /opname.`, msg.message_id);
}
