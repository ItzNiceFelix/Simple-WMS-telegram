#!/usr/bin/env node
// scripts/peta-indeks.mjs — bangun `docs/map/00-index.md` dari 14 peta area.
//
// KENAPA SKRIP, BUKAN DOKUMEN TULIS-TANGAN:
//   Router gejala di indeks berisi ~245 baris yang disalin dari tabel "Kalau masalahnya …"
//   tiap peta area. Menyalin manual berarti indeks dan peta area cepat berbeda, dan agen
//   yang percaya indeks akan diarahkan ke berkas yang sudah tidak ada. Satu sumber
//   kebenaran = tabel di peta area; indeks hanya proyeksi.
//
// KONTRAK PARSING (jangan diubah tanpa mengubah peta area):
//   - `## Ringkasan area` berisi bullet `- ...` → 2 bullet pertama jadi ringkasan indeks.
//   - Heading `## Kalau masalahnya …` berisi tabel `| gejala | peta | file pertama | catatan |`.
//   - Baris pertama tiap peta = `# NN — Judul`.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const akar = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dirPeta = join(akar, "docs/map");

/** Pisahkan isi markdown per heading `## `. */
function bagian(teks) {
  const keluar = new Map();
  let kini = null;
  let buf = [];
  for (const baris of teks.split("\n")) {
    const m = /^## (.+)$/.exec(baris);
    if (m) {
      if (kini !== null) keluar.set(kini, buf);
      kini = m[1].trim();
      buf = [];
    } else if (kini !== null) buf.push(baris);
  }
  if (kini !== null) keluar.set(kini, buf);
  return keluar;
}

function judul(teks, cadangan) {
  const m = /^# (.+)$/m.exec(teks);
  return m ? m[1].trim() : cadangan;
}

function ringkasan(sec) {
  const baris = sec.get("Ringkasan area") ?? [];
  return baris
    .filter((l) => l.trim().startsWith("- "))
    .map((l) => l.trim().slice(2).trim())
    .slice(0, 2);
}

function barisRouter(sec) {
  const kunci = [...sec.keys()].find((k) => k.startsWith("Kalau masalahnya"));
  if (!kunci) return [];
  const keluar = [];
  for (const baris of sec.get(kunci)) {
    const t = baris.trim();
    if (!t.startsWith("|")) continue;
    const sel = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (sel.length < 2) continue;
    if (/^[-: ]+$/.test(sel[0]) || sel[0].toLowerCase().startsWith("gejala")) continue;
    keluar.push([sel[0], sel[1], sel[2] ?? ""]);
  }
  return keluar;
}

// Area domain lebih dulu; infra/DB/tes terakhir — gejala seperti "stok tidak sinkron"
// harus mendarat di peta domain, bukan di peta D1.
const PRIO = ["03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "01", "02", "14"];

const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: akar, encoding: "utf8" })
  .stdout.trim();
const berkas = readdirSync(dirPeta)
  .filter((f) => /^\d\d-.*\.md$/.test(f) && !f.startsWith("00-"))
  .sort((a, b) => {
    const ra = PRIO.indexOf(a.slice(0, 2));
    const rb = PRIO.indexOf(b.slice(0, 2));
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });

const area = [];
const router = [];
const terlihat = new Set();
for (const f of berkas) {
  const teks = readFileSync(join(dirPeta, f), "utf8");
  const sec = bagian(teks);
  area.push({ base: f, judul: judul(teks, f), ringkas: ringkasan(sec) });
  for (const [gejala, peta, catatan] of barisRouter(sec)) {
    const k = gejala.toLowerCase();
    if (terlihat.has(k)) continue;
    terlihat.add(k);
    router.push([f, gejala, peta, catatan]);
  }
}

const CEPAT = [
  ["resi, watermark, cetak, pdf, label", "08"],
  ["picklist, paket, gabung, ekspor", "03"],
  ["order, impor, shopee, excel, advance, batal, transisi", "03"],
  ["laba, hpp, fee, tarif, pajak, omzet, margin, diskon, harga-jual", "04"],
  ["stok, gudang, opname, transfer, reorder, online, mutasi, produk", "05"],
  ["permintaan", "06"],
  ["ai, gemini, groq, provider, fallback, kredensial, reasoning, stream, tools", "07"],
  ["dashboard, ringkasan, analisa, iklan, ads, performa, tren, roas", "09"],
  ["login, sesi, password, otp, tma, role, akses, admin, gudang-scope", "10"],
  ["bot, telegram, webhook, command, notifikasi", "11"],
  ["kledo, sheets, firebase, firestore, sinkron, reminder", "12"],
  ["ui, komponen, halaman, tema, responsif, tombol, dialog", "13"],
  ["test, e2e, playwright, skrip, seed, mock", "14"],
  ["deploy, wrangler, worker, cron, env, binding, assets", "01"],
  ["tabel, sql, d1, migrasi, skema, index", "02"],
];

const potong = (x, n) => {
  const s = x.replace(/\|/g, "/").replace(/\n/g, " ");
  return s.length <= n ? s : s.slice(0, n - 3) + "...";
};

const out = [];
out.push("# 00 — Index peta kode (mulai di sini)");
out.push("");
out.push(
  `Repo: \`Simple-WMS-telegram\` @ \`${commit}\`. Dibuat ${new Date().toISOString().slice(0, 10)} dari isi kode ` +
    "(bukan dari README lama). Dibangun ulang: `node scripts/peta-indeks.mjs`.",
);
out.push("");
out.push("## Cara pakai (hemat token)");
out.push('1. Cari gejala di tabel besar di bawah: `grep -in "<kata kunci>" docs/map/00-index.md` (atau Ctrl-F).');
out.push("2. Buka **satu** file peta area yang ditunjuk, baca tabel “Kalau masalahnya … buka …” + “Peta file” di sana.");
out.push("3. Baru buka file kode target (pakai rentang baris). Jangan menyapu seluruh `lib/`, `components/`, atau `docs/`.");
out.push("4. Kalau mengubah/menambah route, modul, halaman, atau tabel: perbarui peta area, lalu jalankan `node scripts/peta-indeks.mjs`.");
out.push("");
out.push("## Kata kunci cepat (1 kata -> peta)");
out.push("");
out.push("| kata kunci | peta |");
out.push("|---|---|");
for (const [kata, nomor] of CEPAT) {
  const tgt = area.find((a) => a.base.startsWith(nomor + "-"))?.base ?? "";
  out.push(`| ${kata} | [\`${tgt}\`](${tgt}) |`);
}
out.push("");
out.push("## Daftar area");
out.push("");
out.push("| peta | isi |");
out.push("|---|---|");
for (const a of area) {
  out.push(`| [\`${a.base}\`](${a.base}) | ${a.judul} — ${potong(a.ringkas.join(" "), 260)} |`);
}
out.push("");
out.push("## Router gejala → area → file pertama");
out.push("");
out.push("| gejala / kata kunci | peta | file pertama | catatan |");
out.push("|---|---|---|---|");
for (const [base, gejala, peta, catatan] of router) {
  out.push(`| ${potong(gejala, 120)} | \`${base}\` | ${potong(peta, 160)} | ${potong(catatan, 120)} |`);
}
out.push("");
out.push("## Dokumen lama / menyesatkan (jangan jadi acuan)");
out.push("- `README.md` (arsitektur Vercel+Firestore; sudah diberi banner), `docs/architecture.md`, `docs/architecture-v5*.md` (snapshot historis),");
out.push("  `docs/arsip-v4/**`, `docs/_archive/**`, `docs/dashboard-*.md` (era Vercel), `docs/test-report*.md` (laporan historis), `docs/audit-e2e.md` (usulan, belum tentu diterapkan).");
out.push("- `api/webhook.js`, `lib/router/*`, `lib/handlers/*`, `lib/gemini/*`, `lib/models/*`, `vercel.json`, `firebase.json` = jalur lama; masih dipanggil hanya di beberapa tempat (lihat peta 11/12).");
out.push("");
out.push("## Status verifikasi");
out.push("- Setiap path dan simbol di peta area diperiksa terhadap isi repo oleh `node scripts/peta-verifikasi.mjs`; yang tidak terbukti ditulis di bagian “Belum diverifikasi” masing-masing peta.");
out.push("- Peta ini statis. Kalau kode berubah dan peta tidak, peta yang salah: percayai kode, lalu perbarui peta.");
out.push("");

writeFileSync(join(dirPeta, "00-index.md"), out.join("\n"));
console.log(`areas=${area.length} router_rows=${router.length}`);
