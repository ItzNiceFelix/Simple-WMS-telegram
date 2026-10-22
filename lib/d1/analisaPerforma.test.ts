// Uji `performaPerSku` — pembaca `performa_produk`.
//
// KONTRAK SEKARANG (berbeda dari versi lama, dan sengaja):
//   * `periode` DIPAKAI bila bentuknya sah. Versi lama mengabaikannya (`void periode`) sehingga
//     memilih periode lama tetap menampilkan angka impor terbaru — delta antar periode jadi
//     selalu nol dan pembaca mengira tidak ada perubahan.
//   * Tanpa periode sah, dipakai periode TERBARU saja (bukan gabungan semua periode).
//   * Preset yang seluruh barisnya `legacy`/kosong tetap terbaca lewat jalur cadangan —
//     regresi "264 baris tersimpan tapi terbaca nol" tidak boleh kembali.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { performaPerSku } from "./analisa";

type Row = Record<string, unknown>;

/**
 * Mock D1 yang meniru tiga query yang mungkin dijalankan `performaPerSku`:
 * daftar periode, baris satu periode, dan baris tanpa filter (cadangan legacy).
 */
function dbPalsu(rows: Row[], opts: { gagal?: boolean } = {}) {
  const dipanggil: string[] = [];
  const db = {
    prepare(sql: string) {
      dipanggil.push(sql);
      const st = {
        _bind: [] as unknown[],
        bind(...args: unknown[]) {
          st._bind = args;
          return st;
        },
        async all() {
          if (opts.gagal) throw new Error("no such table: performa_produk");
          if (/GROUP BY periode/.test(sql)) {
            // `daftarPeriodePerforma`: satu baris per periode, urut tanggal akhir menurun.
            const unik = new Map<string, number>();
            for (const r of rows) {
              const p = String(r.periode ?? "");
              if (p === "" || p === "legacy") continue;
              unik.set(p, Math.max(unik.get(p) ?? 0, Number(r.at ?? 0)));
            }
            const hasil = [...unik.entries()]
              .map(([periode, at]) => ({ periode, at }))
              .sort((a, b) => String(b.periode).slice(-10).localeCompare(String(a.periode).slice(-10)) || b.at - a.at);
            return { results: hasil };
          }
          if (/periode\s*=\s*\?/.test(sql)) {
            const periode = String(st._bind[1] ?? "");
            return { results: rows.filter((r) => r.periode === periode) };
          }
          return { results: [...rows].sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0)) };
        },
      };
      return st;
    },
  } as unknown as D1Database;
  return { db, dipanggil };
}

function baris(sku: string, periode: string, nilai: Partial<Row> = {}): Row {
  return {
    sku, periode, dilihat: 100, klik: 5, kunjungan: 60, keranjang: 4, pesanan: 2,
    omzet: 200000, melihat_tanpa_beli: 58, at: 1000, ...nilai,
  };
}

describe("performaPerSku", () => {
  it("periode yang diminta DIPAKAI, bukan periode terbaru", async () => {
    const { db } = dbPalsu([
      baris("A", "2026-10-01_2026-10-07", { at: 1000, kunjungan: 10 }),
      baris("A", "2026-10-08_2026-10-14", { at: 9000, kunjungan: 999 }),
    ]);
    const peta = await performaPerSku(db, 2, "2026-10-01_2026-10-07");
    assert.equal(peta.get("A")?.kunjungan, 10, "angka periode lama tidak boleh tertukar dengan yang baru");
  });

  it("tanpa periode sah: dipakai periode TERBARU, bukan gabungan", async () => {
    const { db } = dbPalsu([
      baris("A", "2026-10-01_2026-10-07", { at: 1000, kunjungan: 10 }),
      baris("A", "2026-10-08_2026-10-14", { at: 9000, kunjungan: 999 }),
    ]);
    const peta = await performaPerSku(db, 2, "");
    assert.equal(peta.size, 1, "satu SKU tidak boleh dihitung dua kali");
    assert.equal(peta.get("A")?.kunjungan, 999, "periode terbaru yang dipakai");
  });

  it("preset yang hanya punya baris legacy tetap terbaca (regresi 264 baris -> nol)", async () => {
    const { db } = dbPalsu([baris("A", ""), baris("B", "legacy")]);
    const peta = await performaPerSku(db, 2, "");
    assert.equal(peta.size, 2, "jalur cadangan harus membaca baris tanpa periode");
    assert.equal(peta.get("A")?.kunjungan, 60);
  });

  it("memetakan seluruh kolom termasuk tanpaBeli dan omzet", async () => {
    const { db } = dbPalsu([baris("A", "2026-10-01_2026-10-07")]);
    const p = (await performaPerSku(db, 2, "2026-10-01_2026-10-07")).get("A");
    assert.deepEqual(p, {
      dilihat: 100, klik: 5, kunjungan: 60, keranjang: 4, pesanan: 2, omzet: 200000, tanpaBeli: 58,
    });
  });

  it("tabel gagal/kosong -> Map kosong, TIDAK melempar", async () => {
    assert.equal((await performaPerSku(dbPalsu([], { gagal: true }).db, 2, "x")).size, 0);
    assert.equal((await performaPerSku(dbPalsu([]).db, 2, "x")).size, 0);
  });

  it("SKU kosong dan baris rusak dilewati, bukan meracuni tabel", async () => {
    const { db } = dbPalsu([
      baris("", "2026-10-01_2026-10-07"),
      baris("A", "2026-10-01_2026-10-07", { omzet: Number.NaN }),
      baris("B", "2026-10-01_2026-10-07", { kunjungan: 7, pesanan: 0 }),
    ]);
    const peta = await performaPerSku(db, 2, "2026-10-01_2026-10-07");
    assert.equal(peta.has(""), false, "SKU kosong dibuang");
    assert.equal(peta.has("A"), false, "baris NaN dibuang");
    assert.equal(peta.get("B")?.kunjungan, 7);
  });
});
