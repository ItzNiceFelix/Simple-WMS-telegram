// e2e/preview-picklist.spec.ts — Pratinjau picklist di /order (mode mock).
//
// Endpoint `aksi=preview-picklist` di-stub DI SINI, bukan di server: kontraknya sudah beku
// (kolom/baris/total_baris/total_unit/ada_bermasalah/judul), jadi UI bisa diuji tanpa
// menunggu endpoint nyata. Yang diuji: kolom dirender DARI `kolom` server (bukan daftar
// tetap di klien), urut header dikirim ke server, Export memakai urut yang sama, booking
// advance yang dicentang ikut dikirim sebagai `booking`, dan peringatan baris belum ber-SKU
// tetap muncul.
import { test, expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const DAFTAR = {
  ok: true,
  orders: [
    {
      marketplace: "shopee",
      no_pesanan: "SHP-1",
      no_resi: "SPXID001",
      tanggal: 1728288000,
      buyer: "Budi",
      status_fulfill: "pending",
      items: [{ sku: "BRG-001", qty: 2, harga_satuan: 100000, hpp_snapshot: 60000, subtotal: 200000 }],
      fees: [],
    },
    {
      marketplace: "shopee",
      no_pesanan: "SHP-2",
      no_resi: "",
      tanggal: 1728288000,
      buyer: "Sari",
      status_fulfill: "pending",
      items: [{ sku: "BRG-002", qty: 1, harga_satuan: 100000, hpp_snapshot: 60000, subtotal: 100000 }],
      fees: [],
    },
  ],
};

const BOOKING = {
  ok: true,
  booking: [
    { booking_sn: "ADV-1", no_resi: "R1", sku: "BRG-001", variasi: "Ungu", nama_produk: "Botol Minum", opsi_kirim: "", qty: 4, status: "menunggu", batch_import: null },
    { booking_sn: "ADV-2", no_resi: "R2", sku: "BRG-003", variasi: "", nama_produk: "Kotak Makan", opsi_kirim: "", qty: 9, status: "menunggu", batch_import: null },
  ],
};

/** Bentuk balasan server per mode. `kolom` sengaja BEDA jumlahnya supaya terlihat UI benar-benar
 *  membaca `kolom` dan tidak menghardcode lima kolom gabung-order untuk semua mode. */
function balasan(mode: string, urut: string, arah: string, adaBermasalah: number) {
  const kolom =
    mode === "gabung-order"
      ? ["No", "Nama Produk", "SKU", "Lokasi Gudang", "Quantity Total"]
      : ["No", "Nama Produk", "SKU", "Quantity Total"];
  return {
    ok: true,
    mode,
    urut,
    arah,
    kolom,
    baris: [
      { no: 2, nama: "Kotak Makan Zebra", sku: "BRG-002", lokasi: mode === "gabung-order" ? "RAK-A1" : "", qty: 7, perluSku: false, skuAsal: "", grup: "SPXID002" },
      { no: 1, nama: "Botol Minum Tupperware", sku: "BRG-001", lokasi: mode === "gabung-order" ? "RAK-B2" : "", qty: 12, perluSku: adaBermasalah > 0, skuAsal: "TUP-1L", grup: "SPXID001" },
    ],
    total_baris: 2,
    total_unit: 19,
    ada_bermasalah: adaBermasalah,
    // Angka sisi order/advance dari server. `total_order` = ENTITAS unik, `total_baris_order`
    // = BARIS cetak (dua nilai SENGAJA beda, seperti di produksi saat satu order berisi
    // beberapa item) — uji ini memastikan UI menampilkan KEDUANYA.
    total_order: 2,
    total_baris_order: 4,
    total_advance: 1,
    total_baris_advance: 1,
    judul: `PICKLIST ${mode.toUpperCase()} — PRATINJAU`,
  };
}

/** Stub daftar + pratinjau + daftar booking advance. `permintaanPreview` dan `permintaanPdf`
 *  sama-sama ditampung supaya test bisa membandingkan PARAMETER KEDUA JALUR satu sama lain —
 *  memeriksa URL secara terpisah tidak membuktikan apa-apa, karena dua jalur yang berbeda
 *  tetap bisa lulus dua pemeriksaan yang berbeda. */
async function pasang(page: Page, opsi: { mode?: string; adaBermasalah?: number; gagal?: string; tanpaOrder?: boolean } = {}) {
  const permintaanPreview: string[] = [];
  const permintaanPdf: string[] = [];
  await page.route("**/api/advance?*", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BOOKING) });
  });
  await page.route("**/api/order?*", async (route: Route) => {
    const url = route.request().url();
    if (url.includes("aksi=picklist-pdf")) {
      permintaanPdf.push(url);
      // window.open membuka tab baru; di sini cukup balas sesuatu yang bukan JSON agar tab
      // tidak menggantung memuat dokumen raksasa.
      await route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4 stub" });
      return;
    }
    if (url.includes("aksi=preview-picklist")) {
      permintaanPreview.push(url);
      if (opsi.gagal) {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: opsi.gagal }) });
        return;
      }
      const p = new URL(url).searchParams;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(balasan(p.get("mode") ?? "gabung-order", p.get("urut") ?? "default", p.get("arah") ?? "asc", opsi.adaBermasalah ?? 0)),
      });
      return;
    }
    if (url.includes("aksi=daftar")) {
      const body = opsi.tanpaOrder ? { ok: true, orders: [] } : DAFTAR;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      return;
    }
    await route.continue();
  });
  return { permintaanPreview, permintaanPdf };
}

/** Mode awal = per_paket; untuk menguji advance / kolom Lokasi user harus pindah mode dulu. */
async function pilihModeGabungOrder(page: Page) {
  await page.getByTestId("mode-picklist-order").click();
  await page.getByRole("option", { name: /Gabung order \+ advance/ }).click();
}

async function bukaPreview(page: Page, opsi: { mode?: "gabung-order" } = {}) {
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  if (opsi.mode === "gabung-order") await pilihModeGabungOrder(page);
  await page.getByTestId("pilih-semua-order").click();
  await page.getByTestId("preview-picklist-order").click();
  await expect(page.getByTestId("dialog-preview-picklist")).toBeVisible();
}

test("tombol pratinjau mati sampai ada order terpilih", async ({ page }) => {
  await pasang(page);
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await expect(page.getByTestId("preview-picklist-order")).toBeDisabled();
  await page.getByTestId("pilih-SHP-1").check();
  await expect(page.getByTestId("preview-picklist-order")).toBeEnabled();
});

test("pratinjau merender kolom DARI server + ringkasan baris/unit", async ({ page }) => {
  await pasang(page, { mode: "gabung-order" });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await pilihModeGabungOrder(page);
  await page.getByTestId("pilih-semua-order").click();
  await page.getByTestId("preview-picklist-order").click();
  await expect(page.getByTestId("judul-preview-picklist")).toHaveText("PICKLIST GABUNG-ORDER — PRATINJAU");
  await expect(page.getByTestId("tabel-preview-picklist").locator("th")).toHaveText([
    "No", "Nama Produk", "SKU", "Lokasi Gudang", "Quantity Total",
  ]);
  // Satuan "baris SKU" menyebut baris TABEL (agregat per SKU) supaya tidak tertukar dengan
  // jumlah baris cetak di sisi kiri ("4 baris" + "1 baris").
  await expect(page.getByTestId("isi-preview-picklist")).toContainText("2 baris SKU · 19 unit");
  await expect(page.getByTestId("isi-preview-picklist")).toContainText("2 order · 4 baris + 1 advance · 1 baris");
});

test("mode pisah tidak menampilkan kolom Lokasi Gudang", async ({ page }) => {
  await pasang(page, { mode: "pisah" });
  await bukaPreview(page);
  // Bukti kolom dirender dari `kolom` server: mode ini memang tidak punya Lokasi Gudang.
  await expect(page.getByTestId("tabel-preview-picklist").locator("th")).toHaveText([
    "No", "Nama Produk", "SKU", "Quantity Total",
  ]);
  await expect(page.getByRole("columnheader", { name: "Lokasi Gudang" })).toHaveCount(0);
});

test("klik header mengirim urut/arah baru ke SERVER", async ({ page }) => {
  const { permintaanPreview } = await pasang(page, { mode: "gabung-order" });
  await bukaPreview(page, { mode: "gabung-order" });
  const awal = permintaanPreview.length;
  await page.getByTestId("urut-preview-lokasi").click();
  await expect.poll(() => permintaanPreview.length).toBeGreaterThan(awal);
  expect(permintaanPreview.at(-1)).toContain("urut=lokasi");
  expect(permintaanPreview.at(-1)).toContain("arah=asc");
  // Klik kedua pada kolom yang sama membalik arah, bukan memilih kolom lain.
  await page.getByTestId("urut-preview-lokasi").click();
  await expect.poll(() => permintaanPreview.at(-1)).toContain("arah=desc");
});

test("Export PDF memakai urut/mode yang TAMPIL di pratinjau, tab baru, inline=1", async ({ page }) => {
  await pasang(page, { mode: "gabung-order" });
  await bukaPreview(page, { mode: "gabung-order" });
  await page.getByTestId("urut-preview-sku").click();
  await expect(page.getByTestId("urut-preview-sku-asc")).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.getByTestId("export-pdf-preview-picklist").click();
  const url = (await popup).url();
  expect(url).toContain("aksi=picklist-pdf");
  expect(url).toContain("mode=gabung-order");
  expect(url).toContain("urut=sku");
  expect(url).toContain("arah=asc");
  expect(url).toContain("inline=1");
  expect(url).toContain("SHP-1");
});

test("peringatan baris belum ber-SKU tampil sebagai teks, bukan tooltip", async ({ page }) => {
  await pasang(page, { mode: "gabung-order", adaBermasalah: 1 });
  await bukaPreview(page);
  await expect(page.getByTestId("peringatan-perlu-sku-preview-picklist")).toBeVisible();
  await expect(page.getByTestId("peringatan-perlu-sku-preview-picklist")).toContainText("belum ber-SKU");
  await expect(page.getByTestId("peringatan-perlu-sku-preview-picklist")).toContainText("PERLU SKU");
  await expect(page.getByTestId("badge-perlu-sku-preview")).toBeVisible();
});

test("gagal memuat menampilkan pesan server", async ({ page }) => {
  await pasang(page, { gagal: "Targets tidak valid." });
  await bukaPreview(page);
  await expect(page.getByTestId("error-preview-picklist")).toContainText("Targets tidak valid.");
});

// ---- Advance eksplisit (mode gabung-order) ----

test("panel advance menampilkan kandidat dari /api/advance setelah pindah ke gabung-order", async ({ page }) => {
  await pasang(page, { mode: "gabung-order" });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await expect(page.getByTestId("panel-advance-gabung-order")).toHaveCount(0);
  await pilihModeGabungOrder(page);
  await expect(page.getByTestId("tabel-booking-gabung-order")).toBeVisible();
  await expect(page.getByTestId("pilih-booking-ADV-1")).toBeVisible();
  await expect(page.getByTestId("jumlah-booking-terpilih")).toHaveText("0 dari 2 advance dipilih");
});

test("hanya booking_sn yang dicentang yang dikirim sebagai `booking`", async ({ page }) => {
  const { permintaanPreview } = await pasang(page, { mode: "gabung-order" });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await pilihModeGabungOrder(page);
  await page.getByTestId("pilih-semua-order").click();
  await page.getByTestId("pilih-booking-ADV-2").check();
  await page.getByTestId("preview-picklist-order").click();
  await expect(page.getByTestId("dialog-preview-picklist")).toBeVisible();
  await expect.poll(() => permintaanPreview.length).toBeGreaterThan(0);
  const booking = new URL(permintaanPreview.at(-1)!).searchParams.get("booking");
  expect(booking).toBe('["ADV-2"]');
  await expect(page.getByTestId("isi-preview-picklist")).toContainText("2 order · 4 baris + 1 advance · 1 baris");
});

test("tanpa order tapi ada advance terpilih: pratinjau tetap bisa dibuka", async ({ page }) => {
  const { permintaanPreview } = await pasang(page, { mode: "gabung-order", tanpaOrder: true });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await pilihModeGabungOrder(page);
  // Daftar kosong → tombol tidak bisa hidup karena order; advance yang menghidupkannya.
  await expect(page.getByTestId("preview-picklist-order")).toBeDisabled();
  await page.getByTestId("pilih-booking-ADV-1").check();
  await expect(page.getByTestId("preview-picklist-order")).toBeEnabled();
  await page.getByTestId("preview-picklist-order").click();
  await expect(page.getByTestId("dialog-preview-picklist")).toBeVisible();
  await expect.poll(() => permintaanPreview.length).toBeGreaterThan(0);
  const last = new URL(permintaanPreview.at(-1)!);
  expect(last.searchParams.get("targets")).toBe("[]");
  expect(last.searchParams.get("booking")).toBe('["ADV-1"]');
});

test("Export dari pratinjau membawa booking yang sama dengan yang tampil", async ({ page }) => {
  await pasang(page, { mode: "gabung-order" });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await pilihModeGabungOrder(page);
  await page.getByTestId("pilih-semua-order").click();
  await page.getByTestId("pilih-semua-booking-gabung-order").click();
  await page.getByTestId("preview-picklist-order").click();
  await expect(page.getByTestId("dialog-preview-picklist")).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.getByTestId("export-pdf-preview-picklist").click();
  const url = new URL((await popup).url());
  expect(url.searchParams.get("booking")).toBe('["ADV-1","ADV-2"]');
  expect(url.searchParams.get("inline")).toBe("1");
});

test("pratinjau dan Export membawa booking/targets yang SAMA PERSIS", async ({ page }) => {
  const { permintaanPreview, permintaanPdf } = await pasang(page, { mode: "gabung-order" });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await pilihModeGabungOrder(page);
  await page.getByTestId("pilih-semua-order").click();
  // Tick SUBSET: 2 dari 2 kandidat di stub, tapi subset yang benar-benar penting adalah
  // subset dari yang tersedia — di sini ADV-1 saja, supaya "semua menunggu" (perilaku server
  // saat `booking` tidak dikirim) menghasilkan himpunan yang BERBEDA dan test gagal.
  await page.getByTestId("pilih-booking-ADV-1").check();
  await page.getByTestId("preview-picklist-order").click();
  await expect(page.getByTestId("dialog-preview-picklist")).toBeVisible();
  await expect(page.getByTestId("pilih-booking-ADV-2")).not.toBeChecked();
  // Export: window.open memunculkan tab. URL tab itulah request PDF-nya — dan `page.route`
  // milik halaman INDUK tidak menangkap request tab baru, jadi membaca `permintaanPdf` akan
  // selalu kosong di sini. URL popup adalah sumber yang benar.
  const popup = page.waitForEvent("popup");
  await page.getByTestId("export-pdf-preview-picklist").click();
  const halamanPdf = await popup;
  await halamanPdf.waitForLoadState("domcontentloaded").catch(() => {});
  const urlPdf = halamanPdf.url();
  await halamanPdf.close();
  // Prasyarat: kedua permintaan benar-benar terjadi. Tanpa ini, dua array kosong akan
  // "cocok" dan test lulus tanpa membuktikan apa pun.
  expect(permintaanPreview.length).toBeGreaterThan(0);
  expect(urlPdf).toContain("aksi=picklist-pdf");
  const pv = new URL(permintaanPreview.at(-1)!);
  const pdf = new URL(urlPdf);
  const booking = (u: URL) => new Set<string>(JSON.parse(u.searchParams.get("booking") ?? '["<TIDAK DIKIRIM>"]'));
  const targets = (u: URL) => u.searchParams.get("targets");

  // 1) Kedua jalur mengirim himpunan itu-itu saja.
  expect([...pv.searchParams.keys()].includes("booking")).toBe(true);
  expect([...pdf.searchParams.keys()].includes("booking")).toBe(true);
  // 2) Himpunannya identik — dibandingkan SATU SAMA LAIN, bukan terhadap nilai yang
  //    ditulis ulang di test (dengan itu, dua jalur yang sama-sama salah tetap lolos).
  expect([...booking(pdf)].sort()).toEqual([...booking(pv)].sort());
  // 3) Dan isinya memang yang dicentang, bukan "semua menunggu" milik server lama.
  expect([...booking(pv)]).toEqual(["ADV-1"]);
  // 4) `targets` juga tidak boleh melenceng antar jalur.
  expect(targets(pdf)).toBe(targets(pv));
  expect(JSON.parse(targets(pv)!)).toHaveLength(2);
});

test("Export terkunci selama pratinjau urutan baru masih dimuat", async ({ page }) => {
  // Balapan yang ditutup: klik header mengubah state sort seketika, tapi isi tabel baru
  // berubah setelah respons server tiba. Kalau Export bisa ditekan di jendela itu, lembar
  // bisa memakai sort yang BELUM pernah tampil di layar. Penjaganya adalah `previewMemuat`
  // pada tombol; uji ini menjaga penjaga itu tetap ada — bukan sekadar percaya.
  const { permintaanPreview } = await pasang(page, { mode: "gabung-order" });
  await bukaPreview(page, { mode: "gabung-order" });
  const tombol = page.getByTestId("export-pdf-preview-picklist");
  await expect(tombol).toBeEnabled();
  expect(new URL(permintaanPreview.at(-1)!).searchParams.get("urut")).toBe("default");

  // Gerbang eksplisit: permintaan urutan baru berangkat, responsnya ditahan sampai kita izinkan.
  const gerbang = Promise.withResolvers<void>();
  const berangkat: string[] = [];
  await page.route("**/api/order?*", async (route) => {
    if (!route.request().url().includes("aksi=preview-picklist")) return route.continue();
    berangkat.push(new URL(route.request().url()).searchParams.get("urut") ?? "default");
    await gerbang.promise;
    const p = new URL(route.request().url()).searchParams;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(balasan(p.get("mode") ?? "gabung-order", p.get("urut") ?? "default", p.get("arah") ?? "asc", 0)),
    });
  });

  await page.getByTestId("urut-preview-sku").click();
  await expect.poll(() => berangkat.at(-1)).toBe("sku");
  // Inti uji: selama respons belum tiba, Export TIDAK boleh bisa ditekan.
  await expect(tombol).toBeDisabled();

  // Setelah respons tiba, tombol hidup lagi — dan sekarang ia boleh memakai `sku`, karena
  // itulah yang akhirnya tampil di tabel.
  gerbang.resolve();
  await expect(tombol).toBeEnabled();
  const popup = page.waitForEvent("popup");
  await tombol.click();
  const halamanPdf = await popup;
  const pdf = new URL(halamanPdf.url());
  await halamanPdf.close();
  expect(pdf.searchParams.get("urut")).toBe("sku");
});

test("mode lain tidak mengirim booking advance", async ({ page }) => {
  const { permintaanPreview } = await pasang(page, { mode: "pisah" });
  await bukaPreview(page);
  await expect.poll(() => permintaanPreview.length).toBeGreaterThan(0);
  expect(permintaanPreview.at(-1)).not.toContain("booking=");
});

// ---- Kolom Tanggal & Waktu (WIB) ----

test("kolom Tanggal & Waktu menampilkan jam WIB, bukan UTC", async ({ page }) => {
  // 1760533440 = 2025-10-15T13:04:00Z = 15 Okt 2025, 20.04 WIB. Implementasi berbasis
  // `toISOString()` akan menampilkan 13.04 — uji ini menangkap itu, dan juga tanggalnya.
  await page.route("**/api/advance?*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, booking: [] }) })
  );
  await page.route("**/api/order?*", async (route) => {
    if (route.request().url().includes("aksi=daftar")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          orders: [
            { marketplace: "shopee", no_pesanan: "SHP-WIB", no_resi: "R1", tanggal: 1760533440, buyer: "B",
              status_fulfill: "pending", items: [{ sku: "BRG-001", qty: 1, harga_satuan: 1000, hpp_snapshot: 500, subtotal: 1000 }], fees: [] },
            { marketplace: "shopee", no_pesanan: "SHP-KOSONG", no_resi: "R2", tanggal: 0, buyer: "C",
              status_fulfill: "pending", items: [], fees: [] },
          ],
          total: 2, jumlah_halaman: 1,
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/?role=owner");
  await page.goto("/order?role=owner");
  await expect(page.getByRole("columnheader", { name: "Tanggal & Waktu" })).toBeVisible();
  const baris = page.getByTestId("order-SHP-WIB");
  await expect(baris).toContainText("20.04");
  await expect(baris).toContainText("15 Okt 2025");
  await expect(baris).not.toContainText("13.04");
  // Baris lama tanpa jam: tanda pisah, bukan "00.00" yang tampak seperti data sungguhan.
  await expect(page.getByTestId("order-SHP-KOSONG")).toContainText("—");
});
