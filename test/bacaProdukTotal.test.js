// test/bacaProdukTotal.test.js
// Regresi untuk scope `produk-total` di `app/api/baca/route.ts` — halaman /produk-total.
//
// Dua aturan yang dikunci di sini, keduanya SENYAP bila salah (tidak ada error, hanya
// angka/baris yang keliru):
//
//   1. ALLOWLIST urutan. Kunci dari query string hanya MEMILIH ekspresi di peta tetap;
//      nilainya tidak pernah masuk ke SQL. Kunci asing jatuh ke default, bukan 500 dan
//      bukan urutan acak. Juga: `arah` dijepit ke DESC/ASC saja.
//   2. TIEBREAKER. Tanpa kolom unik di ekor ORDER BY, dua produk dengan nama sama bisa
//      bertukar posisi antar query; paginasi berbasis OFFSET lalu menampilkan satu baris
//      DUA KALI sambil menjatuhkan baris lain.
//
// Salinan murni dari baris keputusan di route (route TypeScript ber-impor D1 sehingga tidak
// bisa di-require harness CJS; lihat pola yang sama di test/bacaStokOnlineFilter.test.js).
// Bila keputusan produksi berubah, test ini WAJIB ikut.
const { test } = require("node:test");
const assert = require("node:assert/strict");

/** Cermin peta ALLOWLIST di app/api/baca/route.ts — TANPA arah. */
const URUT = {
  nama: "p.nama_accurate COLLATE NOCASE",
  sku: "p.sku COLLATE NOCASE",
  lokasi:
    "CASE WHEN lokasi_utama IS NULL OR lokasi_utama = '' THEN 1 ELSE 0 END ASC, lokasi_utama COLLATE NOCASE",
  qty: "total_qty",
};

/** Cermin: const kunci = ... ? kunciMinta : "nama"; */
function pilihKunci(kunciMinta) {
  const k = (kunciMinta ?? "nama").trim();
  return Object.prototype.hasOwnProperty.call(URUT, k) ? k : "nama";
}

/** Cermin: const arah = ... === "desc" ? "DESC" : "ASC"; */
function pilihArah(arahMinta) {
  return (arahMinta ?? "asc").trim().toLowerCase() === "desc" ? "DESC" : "ASC";
}

/** Cermin pemasangan arah: satu arah per kolom urutan, penanda kosong dibiarkan ASC. */
function pasangArah(ekspresi, arah) {
  return ekspresi
    .split(", ")
    .map((bagian) => (/ THEN \d+ ELSE \d+ END ASC$/.test(bagian) ? bagian : `${bagian} ${arah}`))
    .join(", ");
}

/** Cermin ORDER_BY + ORDER_TIEBREAK yang disusun route. */
function orderBy(kunciMinta, arahMinta) {
  return `${pasangArah(URUT[pilihKunci(kunciMinta)], pilihArah(arahMinta))}, p.sku ASC`;
}

test("kunci tak dikenal -> default nama ASC, bukan 500", () => {
  for (const k of ["hpp", "nama_accurate; DROP TABLE products", "", "  ", "TOTAL", null, undefined]) {
    assert.equal(pilihKunci(k), "nama", `kunci ${JSON.stringify(k)} harus jatuh ke default`);
  }
});

test("keempat kunci sah lolos apa adanya", () => {
  for (const k of ["nama", "sku", "lokasi", "qty"]) {
    assert.equal(pilihKunci(k), k);
  }
});

test("arah hanya DESC/ASC — ngawur jadi ASC", () => {
  assert.equal(pilihArah("desc"), "DESC");
  assert.equal(pilihArah("DESC"), "DESC");
  assert.equal(pilihArah("asc"), "ASC");
  for (const a of ["lol", "", "1", "asc; DROP TABLE products"]) {
    assert.equal(pilihArah(a), "ASC", `arah ${JSON.stringify(a)} harus jadi ASC`);
  }
});

test("tiebreaker sku SELALU ada, di ekor dan menaik", () => {
  for (const k of ["nama", "sku", "lokasi", "qty", "asing"]) {
    for (const a of ["asc", "desc"]) {
      assert.ok(
        orderBy(k, a).endsWith(", p.sku ASC"),
        `ORDER BY untuk ${k}/${a} harus diakhiri tiebreaker "p.sku ASC"`
      );
    }
  }
});

test("lokasi: baris tanpa stok positif ditaruh di bawah, bukan di urutan awal alfabet", () => {
  // Kosong ("") bukan gudang: kalau dibiarkan ASC biasa, SKU tanpa stok positif menumpuk
  // di halaman pertama seolah-olah lokasinya paling awal menurut abjad.
  const ekspresi = URUT.lokasi;
  assert.ok(ekspresi.includes("THEN 1 ELSE 0 END ASC"), "penanda kosong harus menaik (0 = terisi lebih dulu)");
  assert.ok(ekspresi.includes("lokasi_utama"), "mengurutkan pada kolom yang benar-benar dipilih");
});

test("qty diurutkan sebagai ANGKA, bukan teks produk apa pun", () => {
  // "100" harus setelah "20"; karena itu kunci qty memakai kolom agregat total_qty,
  // bukan ekspresi yang menghasilkan string.
  assert.equal(URUT.qty, "total_qty");
  assert.ok(!URUT.qty.includes("nama"), "qty tidak boleh menyelinap ikut nama");
});

test("arah dipasang TEPAT SEKALI — tidak pernah 'ASC ASC'", () => {
  // Regresi: peta dulu menyimpan "total_qty ASC" sementara route menyambung arah lagi,
  // jadi `?urut=qty&arah=asc` mengirim "total_qty ASC ASC" ke SQLite → 500 buta.
  for (const k of ["nama", "sku", "lokasi", "qty"]) {
    for (const a of ["asc", "desc"]) {
      const z = orderBy(k, a);
      assert.ok(!/\bASC ASC\b|\bDESC DESC\b|\bASC DESC\b|\bDESC ASC\b/.test(z), `kembar arah di ${k}/${a}: ${z}`);
      // Jumlah kata arah harus sama dengan jumlah kolom urutannya (1, kecuali lokasi = 2
      // kolom, dan satu di antaranya penanda kosong yang tetap ASC).
      const arahKata = z.match(/\b(ASC|DESC)\b/g) ?? [];
      const diharap = k === "lokasi" ? 3 : 2; // kolom urutan + tiebreaker p.sku
      assert.equal(arahKata.length, diharap, `jumlah arah salah untuk ${k}/${a}: ${z}`);
    }
  }
});

test("lokasi DESC: kolom urutan berbalik, penanda kosong TETAP menaik", () => {
  const z = orderBy("lokasi", "desc");
  assert.ok(
    z.startsWith("CASE WHEN lokasi_utama IS NULL OR lokasi_utama = '' THEN 1 ELSE 0 END ASC,"),
    `penanda kosong harus menaik apa pun arahnya: ${z}`
  );
  assert.ok(z.includes("lokasi_utama COLLATE NOCASE DESC"), `kolom urutan harus berbalik: ${z}`);
});

test("query klien tidak pernah masuk ke SQL", () => {
  // Bukti struktural: hasil hanya boleh berasal dari nilai peta, bukan dari input.
  const jahat = "nama'; DROP TABLE products; --";
  assert.equal(pilihKunci(jahat), "nama");
  assert.ok(!orderBy(jahat, "asc").includes("DROP"), "tanpa pernah menyambung input ke ORDER BY");
});
