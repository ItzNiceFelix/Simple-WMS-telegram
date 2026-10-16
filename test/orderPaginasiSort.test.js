// test/orderPaginasiSort.test.js
// Paginasi + urut + pemetaan urut→PDF halaman order.
//
// Fungsi murni di sini adalah CERMIN rumus yang dipakai app/order/page.tsx. File itu client
// component TypeScript sehingga tidak bisa di-require test CJS; menyalin rumusnya lebih murah
// daripada menambah bundler (pola sama dengan test/stokPaginasi.test.js).
//
// Yang dikunci:
//  1. `tanggalHariIniWib` — konvensi "hari ini" HARUS WIB, bukan UTC. Salah 7 jam = daftar
//     hari ini kosong di pagi hari WIB padahal order baru diimpor.
//  2. Jendela satu hari server (`dari`/`sampai` dari `tanggalKeEpoch`) harus MENCAKUP seluruh
//     hari kalender untuk tanggal itu — cermin app/api/order/route.ts.
//  3. Pemetaan urut layar → kunci urut picklist: kolom tanpa padanan WAJIB jatuh ke default
//     (JANGAN kirim `urut`), supaya cetak ulang menghasilkan lembar lama persis.
const { test } = require("node:test");
const assert = require("node:assert/strict");

/** Cermin: new Date(Date.now() + 7*3600*1000).toISOString().slice(0,10) */
function tanggalHariIniWib(ms) {
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Cermin `tanggalKeEpoch` app/api/order/route.ts — tengah malam UTC dari string tanggal.
 *  Penjaga bolak-balik (getUTC* !== input) itu WAJIB: tanpa itu `2026-13-01` diam-diam
 *  meluber ke Januari 2027 dan filter hari yang salah ketik justru menampilkan bulan lain. */
function tanggalKeEpoch(t) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return null;
  return Math.floor(dt.getTime() / 1000);
}

/** Cermin blok `tanggal` di `filterDariQuery` — jendela satu hari penuh. */
function jendelaHari(t) {
  const d = tanggalKeEpoch(t);
  return d === null ? null : { dari: d, sampai: d + 86399 };
}

/** Cermin `unduhPicklist`: peta kolomUrut layar → { urut?, arah? } untuk picklist-pdf. */
function urutKePicklist(kolomUrut, arah) {
  if (kolomUrut === "no_pesanan") return { urut: "sku", arah };
  if (kolomUrut === "no_resi") return { urut: "lokasi", arah };
  return {};
}

test("tanggal hari ini memakai pergeseran WIB, bukan UTC", () => {
  // 2026-10-16 22:00 WIB == 15:00 UTC hari yang sama. UTC masih tanggal 16 → tidak terlihat.
  // Kasus penentu: 2026-10-17 03:00 WIB == 2026-10-16 20:00 UTC. Wajib menjawab 17, bukan 16 —
  // inilah jam saat order malam direkap admin, dan jawaban UTC akan menyembunyikannya.
  const pagiWib = Date.UTC(2026, 9, 16, 20, 0, 0);
  assert.equal(tanggalHariIniWib(pagiWib), "2026-10-17", "subuh WIB harus tanggal 17, bukan 16 UTC");
  // 2026-10-16 12:00 WIB == 05:00 UTC — sama di kedua konvensi, kontrol positif.
  assert.equal(tanggalHariIniWib(Date.UTC(2026, 9, 16, 5, 0, 0)), "2026-10-16");
  // 2026-10-16 06:00 WIB == 2026-10-15 23:00 UTC — UTC akan menjawab 15 (kemarin).
  assert.equal(tanggalHariIniWib(Date.UTC(2026, 9, 15, 23, 0, 0)), "2026-10-16");
});

test("jendela tanggal menutup 24 jam penuh", () => {
  const w = jendelaHari("2026-10-16");
  assert.equal(w.sampai - w.dari, 86399, "sampai = dari + 86399");
  assert.equal(w.dari, Date.UTC(2026, 9, 16) / 1000);
});

test("tanggal tidak valid ditolak, bukan jadi NaN", () => {
  assert.equal(tanggalKeEpoch("16-10-2026"), null);
  assert.equal(tanggalKeEpoch("2026-13-01"), null, "bulan 13 bukan tanggal");
  assert.equal(jendelaHari("bukan-tanggal"), null);
});

test("kolom ber-padanan memetakan ke kunci picklist + ikut arah", () => {
  assert.deepEqual(urutKePicklist("no_pesanan", "asc"), { urut: "sku", arah: "asc" });
  assert.deepEqual(urutKePicklist("no_resi", "desc"), { urut: "lokasi", arah: "desc" });
});

test("kolom tanpa padanan TIDAK mengirim urut (server pakai default lama)", () => {
  // Mengirim `urut` saja tanpa arah, atau `arah` sendirian, akan mengubah urutan lembar
  // cetak untuk kolom yang tidak punya padanan di PDF — regresi yang tidak diminta.
  for (const kolom of ["marketplace", "tanggal", "status_fulfill"]) {
    assert.deepEqual(urutKePicklist(kolom, "asc"), {}, `kolom ${kolom} harus jatuh ke default`);
    assert.deepEqual(urutKePicklist(kolom, "desc"), {}, `kolom ${kolom} harus jatuh ke default`);
  }
});
