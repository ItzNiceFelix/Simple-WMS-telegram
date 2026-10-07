import { test, expect, type Page } from "@playwright/test";

// Wave 3d — F1 Permintaan Harian interaktif (PRD v3a 3, 7, 14; ui-spec 3.H6).
// Data mock: hari ini (tanggal relatif) status "draft", 3 item:
//   BRG-004 XL qty 10 (buffer false), BRG-003 32 qty 7 (buffer true),
//   BRG-006 - qty 0 (B6: "Tidak diminta").
// BRG-004 stok -5 (saran kurang 5), BRG-003 stok 3, BRG-006 stok 0.

type Role = "owner" | "admin" | "guest";

async function buka(page: Page, role: Role = "owner", extra = "") {
  await page.goto(`/?role=${role}`);
  await page.goto(`/permintaan?role=${role}${extra}`);
  await expect(page.getByRole("heading", { name: "Permintaan Harian", level: 1 })).toBeVisible();
}


/** Id tanggal lokal "YYYY-MM-DD" relatif hari ini (mock: dokumen hari ini + kemarin). */
function tanggalId(offsetHari: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetHari);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const KUNCI_BRG004 = "BRG-004::XL::false";
const KUNCI_BRG003 = "BRG-003::32::true";
const KUNCI_BRG006 = "BRG-006::-::false";

test.describe("H6 Permintaan — draft", () => {
  test("badge status + tombol draft", async ({ page }) => {
    await buka(page);
    await expect(page.getByTestId("status-permintaan")).toHaveText("Draft");
    await expect(page.getByTestId("tombol-ubah-jumlah")).toBeVisible();
    await expect(page.getByTestId("tombol-kirim-form")).toBeVisible();
    await expect(page.getByTestId("tombol-kirim-ulang")).toHaveCount(0);
    await expect(page.getByTestId("tombol-barang-datang")).toHaveCount(0);
    await expect(page.getByTestId("tombol-selesai")).toHaveCount(0);
  });

  test("item qty 0 menampilkan badge Tidak diminta", async ({ page }) => {
    await buka(page);
    await expect(page.getByTestId("item-BRG-006")).toContainText("Tidak diminta");
  });

  test("ubah jumlah: saran kekurangan stok tampil sebagai bantuan, bukan menimpa isian", async ({
    page,
  }) => {
    await buka(page);
    await page.getByTestId("tombol-ubah-jumlah").click();
    const dialog = page.getByTestId("dialog-ubah-jumlah");
    await expect(dialog).toBeVisible();

    // Nilai awal = qty_diminta ?? qty.
    await expect(page.getByTestId(`input-qty-${KUNCI_BRG004}`)).toHaveValue("10");
    // Saran kekurangan (BRG-004 stok -5 -> kurang 5) tampil sebagai helper text.
    await expect(dialog).toContainText("Kurang 5 dari stok gudang online.");

    // Item qty 0 -> badge "Tidak diminta".
    await expect(dialog).toContainText("Tidak diminta");
  });

  test("ubah jumlah sukses -> toast + nilai item berubah", async ({ page }) => {
    await buka(page);
    await page.getByTestId("tombol-ubah-jumlah").click();
    await page.getByTestId(`input-qty-${KUNCI_BRG004}`).fill("15");
    await page.getByTestId("submit-ubah-jumlah").click();

    await expect(page.getByText("Jumlah diperbarui")).toBeVisible();
    await expect(page.getByTestId("dialog-ubah-jumlah")).toBeHidden();
    await expect(page.getByTestId("item-BRG-004")).toContainText("15");
  });

  test("ubah jumlah tidak valid -> error inline, dialog tetap terbuka", async ({ page }) => {
    await buka(page);
    await page.getByTestId("tombol-ubah-jumlah").click();
    await page.getByTestId(`input-qty-${KUNCI_BRG003}`).fill("-1");
    await page.getByTestId("submit-ubah-jumlah").click();

    await expect(page.getByTestId("error-ubah-jumlah")).toContainText(
      "Jumlah harus bilangan bulat >= 0"
    );
    await expect(page.getByTestId("dialog-ubah-jumlah")).toBeVisible();
    await expect(page.getByTestId(`input-qty-${KUNCI_BRG003}`)).toHaveValue("-1");
  });

  test("kirim form sukses -> status draft ke diproses + tombol berganti", async ({ page }) => {
    await buka(page);
    await page.getByTestId("tombol-kirim-form").click();

    await expect(page.getByText("Form terkirim")).toBeVisible();
    await expect(page.getByTestId("status-permintaan")).toHaveText("Diproses");
    await expect(page.getByTestId("tombol-kirim-ulang")).toBeVisible();
    await expect(page.getByTestId("tombol-barang-datang")).toBeVisible();
    await expect(page.getByTestId("tombol-selesai")).toBeVisible();
  });

  test("draft: tombol Barang Datang tidak dirender (guard UI B1)", async ({ page }) => {
    await buka(page);
    // PRD 3.2: di status draft tombol Barang Datang memang tidak dirender.
    await expect(page.getByTestId("tombol-barang-datang")).toHaveCount(0);
    // Guard server (409 "Kirim form dulu sebelum menandai barang datang.") diuji di
    // test/permintaanHarian.test.js + route test (unit), bukan di UI.
  });
});

test.describe("H6 Permintaan — diproses", () => {
  async function sampaiDiproses(page: Page) {
    await buka(page);
    await page.getByTestId("tombol-kirim-form").click();
    await expect(page.getByTestId("status-permintaan")).toHaveText("Diproses");
  }

  test("kirim ulang idempoten (< 30 detik) -> tidak kirim ulang", async ({ page }) => {
    await sampaiDiproses(page);
    await page.getByTestId("tombol-kirim-ulang").click();
    await expect(page.getByText("Form sudah terkirim sebelumnya")).toBeVisible();
  });

  test("badge desync muncul setelah qty diubah pasca kirim", async ({ page }) => {
    await sampaiDiproses(page);
    await expect(page.getByTestId("badge-desync")).toHaveCount(0);

    await page.getByTestId("tombol-ubah-jumlah").click();
    await page.getByTestId(`input-qty-${KUNCI_BRG004}`).fill("12");
    await page.getByTestId("submit-ubah-jumlah").click();
    await expect(page.getByTestId("dialog-ubah-jumlah")).toBeHidden();

    await expect(page.getByTestId("badge-desync")).toContainText("Berubah sejak form terakhir dikirim");
  });

  test("barang datang per item -> badge datang, dokumen tetap diproses", async ({ page }) => {
    await sampaiDiproses(page);
    await page.getByTestId("tombol-barang-datang").click();
    const dialog = page.getByTestId("dialog-barang-datang");
    await expect(dialog).toBeVisible();

    // Item qty 0 -> tanpa tombol Tandai Datang (B6).
    await expect(page.getByTestId(`tandai-datang-${KUNCI_BRG006}`)).toHaveCount(0);

    await page.getByTestId(`tandai-datang-${KUNCI_BRG004}`).click();
    await expect(page.getByText("Barang datang dicatat")).toBeVisible();
    await expect(page.getByTestId(`datang-${KUNCI_BRG004}`)).toBeVisible();
    await expect(page.getByTestId("status-permintaan")).toHaveText("Diproses");
  });

  test("semua barang datang -> selesai otomatis + badge Selesai", async ({ page }) => {
    await sampaiDiproses(page);
    await page.getByTestId("tombol-barang-datang").click();
    await page.getByTestId(`tandai-datang-${KUNCI_BRG004}`).click();
    await expect(page.getByTestId(`datang-${KUNCI_BRG004}`)).toBeVisible();
    await page.getByTestId(`tandai-datang-${KUNCI_BRG003}`).click();

    await expect(page.getByText("Semua barang sudah datang — permintaan selesai.")).toBeVisible();
    await expect(page.getByTestId("status-permintaan")).toHaveText("Selesai");

    // Dialog ditutup -> tombol aksi hilang, read-only.
    await page.getByRole("button", { name: "Tutup" }).click();
    await expect(page.getByTestId("tombol-ubah-jumlah")).toHaveCount(0);
    await expect(page.getByTestId("tombol-barang-datang")).toHaveCount(0);
    await expect(page.getByTestId("badge-selesai")).toBeVisible();
  });

  test("selesai manual wajib konfirmasi + jelaskan tidak bisa dibatalkan", async ({ page }) => {
    await sampaiDiproses(page);
    await page.getByTestId("tombol-selesai").click();
    const konfirmasi = page.getByTestId("konfirmasi-selesai");
    await expect(konfirmasi).toBeVisible();
    await expect(konfirmasi).toContainText("tidak bisa dibatalkan");
    await expect(konfirmasi).toContainText("belum datang");

    await page.getByTestId("konfirmasi-selesai-ok").click();
    await expect(page.getByText("Belum ada item yang datang.")).toBeVisible();
    await expect(page.getByTestId("status-permintaan")).toHaveText("Diproses");
  });

  test("item yang sudah datang tidak bisa diubah (409 apa adanya)", async ({ page }) => {
    await sampaiDiproses(page);
    await page.getByTestId("tombol-barang-datang").click();
    await page.getByTestId(`tandai-datang-${KUNCI_BRG004}`).click();
    await expect(page.getByTestId(`datang-${KUNCI_BRG004}`)).toBeVisible();
    await page.getByRole("button", { name: "Tutup" }).click();

    // Item datang tidak ikut dikirim; item lain tetap bisa diubah.
    await page.getByTestId("tombol-ubah-jumlah").click();
    await expect(page.getByTestId(`input-qty-${KUNCI_BRG004}`)).toBeDisabled();
    await expect(page.getByTestId("dialog-ubah-jumlah")).toContainText("Sudah datang");
  });
});

test.describe("H6 Permintaan — 401 mid-write", () => {
  test("401 ubah jumlah: toast sesi kedaluwarsa, dialog tidak tutup, isian dipertahankan", async ({
    page,
  }) => {
    await buka(page, "owner", "&mock-401=1");
    await page.getByTestId("tombol-ubah-jumlah").click();
    await page.getByTestId(`input-qty-${KUNCI_BRG004}`).fill("9");
    await page.getByTestId("submit-ubah-jumlah").click();

    await expect(page.getByText("Sesi kedaluwarsa. Buka ulang dari Telegram.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buka ulang" })).toBeVisible();
    await expect(page.getByTestId("dialog-ubah-jumlah")).toBeVisible();
    await expect(page.getByTestId(`input-qty-${KUNCI_BRG004}`)).toHaveValue("9");
  });
});

test.describe("H6 Permintaan — riwayat & izin", () => {
  test("riwayat hari sebelumnya dipertahankan (read-only, tanpa tombol)", async ({ page }) => {
    await buka(page);
    const riwayat = page.getByTestId(`riwayat-${tanggalId(-1)}`);
    await expect(riwayat).toBeVisible();
    await expect(riwayat).toContainText("1 item");
    await expect(riwayat.getByRole("button")).toHaveCount(0);
  });

  test("guest ditolak (nav + ButuhAkses)", async ({ page }) => {
    await page.goto("/?role=guest");
    await page.goto("/permintaan?role=guest");
    await expect(page.getByTestId("akses-ditolak")).toBeVisible();
  });

  test("admin boleh beraksi (matriks izin: owner+admin)", async ({ page }) => {
    await buka(page, "admin");
    await expect(page.getByTestId("tombol-ubah-jumlah")).toBeVisible();
    await expect(page.getByTestId("tombol-kirim-form")).toBeVisible();
  });
});
