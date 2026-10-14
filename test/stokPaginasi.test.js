// test/stokPaginasi.test.js
// Paginasi halaman stok. Sebelumnya 1174 baris dirender penuh (tabel + kartu sekaligus,
// dibedakan hanya CSS) ≈ 84.000 elemen DOM — itulah sebab halaman terasa lag di WebView.
//
// Fungsi murni di sini adalah CERMIN matematika yang dipakai app/stok/page.tsx. File itu
// client component TypeScript sehingga tidak bisa di-require test CJS; menyalin rumusnya
// lebih murah daripada menambah bundler. Bila rumus produksi berubah, test ini WAJIB ikut.
//
// Yang dikunci: potongan halaman tidak boleh kehilangan baris, tidak boleh tumpang tindih,
// dan penjepitan halaman harus mencegah "daftar kosong palsu" saat data menyusut.
const { test } = require("node:test");
const assert = require("node:assert/strict");

/** Cermin: Math.max(1, Math.ceil(hasil.length / ukuranHalaman)) */
function jumlahHalaman(total, ukuran) {
  return Math.max(1, Math.ceil(total / ukuran));
}

/** Cermin: Math.min(halaman, jumlahHalaman) */
function halamanAman(halaman, total, ukuran) {
  return Math.min(halaman, jumlahHalaman(total, ukuran));
}

/** Cermin: hasil.slice((halamanAman-1)*ukuran, halamanAman*ukuran) */
function halamanIni(hasil, halaman, ukuran) {
  const aman = halamanAman(halaman, hasil.length, ukuran);
  return hasil.slice((aman - 1) * ukuran, aman * ukuran);
}

const TOTAL_PRODUK = 1174;
const semua = Array.from({ length: TOTAL_PRODUK }, (_, i) => `SKU-${String(i + 1).padStart(4, "0")}`);

test("1174 baris dipotong 50 -> hanya 50 dirender (bukan 1174)", () => {
  assert.equal(halamanIni(semua, 1, 50).length, 50);
  assert.equal(jumlahHalaman(TOTAL_PRODUK, 50), 24);
});

test("semua ukuran halaman yang ditawarkan berfungsi", () => {
  for (const ukuran of [10, 20, 50, 100]) {
    assert.equal(halamanIni(semua, 1, ukuran).length, ukuran, `ukuran ${ukuran}`);
  }
  assert.equal(jumlahHalaman(TOTAL_PRODUK, 10), 118);
  assert.equal(jumlahHalaman(TOTAL_PRODUK, 20), 59);
  assert.equal(jumlahHalaman(TOTAL_PRODUK, 50), 24);
  assert.equal(jumlahHalaman(TOTAL_PRODUK, 100), 12);
});

test("potongan tidak tumpang tindih dan tidak ada yang hilang", () => {
  for (const ukuran of [10, 20, 50, 100]) {
    const semuaHalaman = [];
    for (let h = 1; h <= jumlahHalaman(TOTAL_PRODUK, ukuran); h++) {
      semuaHalaman.push(...halamanIni(semua, h, ukuran));
    }
    assert.equal(semuaHalaman.length, TOTAL_PRODUK, `total baris untuk ukuran ${ukuran}`);
    assert.equal(new Set(semuaHalaman).size, TOTAL_PRODUK, `tidak ada duplikat untuk ukuran ${ukuran}`);
    assert.deepEqual(semuaHalaman, semua, `urutan tetap untuk ukuran ${ukuran}`);
  }
});

test("halaman terakhir berisi sisa, bukan penuh", () => {
  const akhir = halamanIni(semua, 24, 50);
  assert.equal(akhir.length, 24, "1174 = 23*50 + 24");
  assert.equal(akhir[akhir.length - 1], "SKU-1174");
});

test("halaman melewati akhir dijepit -> TIDAK ada daftar kosong palsu", () => {
  // Kasus nyata: user di halaman 24, lalu memfilter sampai hasilnya tinggal 3 baris.
  const hasilKecil = semua.slice(0, 3);
  const out = halamanIni(hasilKecil, 24, 50);
  assert.equal(out.length, 3, "harus dijepit ke halaman terakhir, bukan kosong");
  assert.equal(jumlahHalaman(0, 50), 1, "hasil kosong tetap 1 halaman (empty state yang benar)");
  assert.deepEqual(halamanIni([], 1, 50), []);
});

test("data menyusut: halaman tetap menampilkan sesuatu", () => {
  // 1174 -> 60 baris: halaman 24 tidak valid lagi, harus jatuh ke halaman 2 (60/50).
  const menyusut = semua.slice(0, 60);
  assert.equal(halamanAman(24, menyusut.length, 50), 2);
  assert.equal(halamanIni(menyusut, 24, 50).length, 10);
});

test("indeks rentang yang ditampilkan benar (mis. 51-100 dari 1174)", () => {
  const h = 2;
  const ukuran = 50;
  const potong = halamanIni(semua, h, ukuran);
  const dari = (h - 1) * ukuran + 1;
  const sampai = (h - 1) * ukuran + potong.length;
  assert.equal(dari, 51);
  assert.equal(sampai, 100);
});
