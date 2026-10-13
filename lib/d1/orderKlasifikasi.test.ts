import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aksiOrder, klasifikasikanImport, type OrderBaru } from "./orderKlasifikasi";

type Row = Record<string, unknown>;

function buatDb(orders: Row[], advance: Row[] = []) {
  return {
    prepare(sql: string) {
      const st = {
        _args: [] as unknown[],
        bind(...a: unknown[]) { st._args = a; return st; },
        async all() {
          if (sql.includes("FROM orders")) {
            return { results: orders.filter((o) => st._args.includes(o["no_pesanan"])) };
          }
          if (sql.includes("FROM advance_bookings")) {
            return { results: advance.filter((a) => st._args.includes(a["booking_sn"])) };
          }
          return { results: [] };
        },
      };
      return st;
    },
  } as unknown as D1Database;
}

const o = (no_pesanan: string, statusFile: OrderBaru["statusFile"], extra: Partial<OrderBaru> = {}): OrderBaru => ({
  no_pesanan, no_resi: "", statusFile, jasaKirim: "SPX Hemat", tipeLayanan: "Hemat Kargo", cod: false, preorder: false, ...extra,
});

describe("klasifikasikanImport (aturan T3)", () => {
  it("tidak ada di orders → baru", async () => {
    const r = await klasifikasikanImport(buatDb([]), [o("A", "perlu_dikirim")], []);
    assert.deepEqual(r.baru.map((x) => x.no_pesanan), ["A"]);
    assert.equal(r.update.length, 0);
  });

  it("WMS pending + file perlu_dikirim → update", async () => {
    const r = await klasifikasikanImport(buatDb([{ no_pesanan: "A", status_fulfill: "pending", no_resi: "" }]), [o("A", "perlu_dikirim")], []);
    assert.deepEqual(r.update.map((x) => x.no_pesanan), ["A"]);
  });

  it("WMS pack + file sedang/telah dikirim → update", async () => {
    const r = await klasifikasikanImport(buatDb([{ no_pesanan: "A", status_fulfill: "pack", no_resi: "" }]), [o("A", "sedang_dikirim")], []);
    assert.deepEqual(r.update.map((x) => x.no_pesanan), ["A"]);
  });

  it("status sama → skip", async () => {
    const r = await klasifikasikanImport(buatDb([{ no_pesanan: "A", status_fulfill: "pending", no_resi: "" }]), [o("A", "perlu_dikirim")], []);
    const db2 = buatDb([{ no_pesanan: "B", status_fulfill: "kirim", no_resi: "" }]);
    const r2 = await klasifikasikanImport(db2, [o("B", "sedang_dikirim")], []);
    assert.equal(r.update.length, 1);
    assert.equal(r2.skip.length, 1);
  });

  it("WMS kirim tapi file perlu_dikirim → mundur (F10)", async () => {
    const r = await klasifikasikanImport(buatDb([{ no_pesanan: "A", status_fulfill: "kirim", no_resi: "R1" }]), [o("A", "perlu_dikirim", { no_resi: "R1" })], []);
    assert.equal(r.mundur.length, 1);
    assert.equal(r.mundur[0].no_pesanan, "A");
    assert.equal(r.mundur[0].wms, "kirim");
    assert.equal(r.update.length, 0);
  });

  it("WMS selesai tapi file perlu_dikirim → mundur", async () => {
    const r = await klasifikasikanImport(buatDb([{ no_pesanan: "A", status_fulfill: "selesai", no_resi: "R1" }]), [o("A", "perlu_dikirim")], []);
    assert.equal(r.mundur.length, 1);
  });

  it("No. Pesanan ganda dalam file → gandaDalamFile", async () => {
    const r = await klasifikasikanImport(buatDb([]), [o("A", "perlu_dikirim"), o("A", "perlu_dikirim")], []);
    assert.deepEqual(r.gandaDalamFile, [{ no_pesanan: "A", jumlah: 2 }]);
  });
});

describe("klasifikasikanImport (aturan T3b / F18)", () => {
  it("resi dipakai 2 order kriteria cocok → resiMultiOrder, tanpa peringatan", async () => {
    const r = await klasifikasikanImport(buatDb([]), [
      o("A", "perlu_dikirim", { no_resi: "R1" }),
      o("B", "perlu_dikirim", { no_resi: "R1" }),
    ], []);
    assert.deepEqual(r.resiMultiOrder, [{ no_resi: "R1", no_pesanan: ["A", "B"], jumlah_order: 2 }]);
    assert.equal(r.kriteriaGabungan.length, 0);
  });

  it("resi multi-order beda jasa kirim / tipe layanan → kriteriaGabungan", async () => {
    const r = await klasifikasikanImport(buatDb([]), [
      o("A", "perlu_dikirim", { no_resi: "R1", jasaKirim: "SPX Hemat" }),
      o("B", "perlu_dikirim", { no_resi: "R1", jasaKirim: "JNE Reguler" }),
    ], []);
    assert.equal(r.kriteriaGabungan.length, 1);
    assert.match(r.kriteriaGabungan[0].alasan.join(","), /jasa kirim beda/);
  });

  it("resi multi-order dengan COD atau pre-order → kriteriaGabungan", async () => {
    const r = await klasifikasikanImport(buatDb([]), [
      o("A", "perlu_dikirim", { no_resi: "R1", cod: true }),
      o("B", "perlu_dikirim", { no_resi: "R1", preorder: true }),
    ], []);
    assert.equal(r.kriteriaGabungan.length, 1);
    assert.match(r.kriteriaGabungan[0].alasan.join(","), /ada COD/);
    assert.match(r.kriteriaGabungan[0].alasan.join(","), /ada pre-order/);
  });

  it("resi tunggal → tidak masuk resiMultiOrder", async () => {
    const r = await klasifikasikanImport(buatDb([]), [o("A", "perlu_dikirim", { no_resi: "R1" })], []);
    assert.equal(r.resiMultiOrder.length, 0);
  });

  it("Booking SN sudah ada → advanceSkip (idempoten)", async () => {
    const r = await klasifikasikanImport(buatDb([], [{ booking_sn: "SN1" }]), [], [{ booking_sn: "SN1" }, { booking_sn: "SN2" }]);
    assert.deepEqual(r.advanceBaru.map((a) => a.booking_sn), ["SN2"]);
    assert.deepEqual(r.advanceSkip, ["SN1"]);
  });
});

describe("aksiOrder (tabel keputusan lengkap)", () => {
  it("WMS kosong + file aktif → baru", () => {
    assert.equal(aksiOrder(false, "", "perlu_dikirim"), "baru");
    assert.equal(aksiOrder(false, "", "sedang_dikirim"), "baru");
  });

  it("WMS kosong + file batal/belum bayar → abaikan (tak masuk picklist)", () => {
    assert.equal(aksiOrder(false, "", "batal"), "abaikan");
    assert.equal(aksiOrder(false, "", "belum_bayar"), "abaikan");
    assert.equal(aksiOrder(false, "", "pembatalan_diajukan"), "abaikan");
    assert.equal(aksiOrder(false, "", ""), "abaikan");
  });

  it("WMS batal → abaikan apa pun file-nya (order batal final)", () => {
    assert.equal(aksiOrder(true, "batal", "perlu_dikirim"), "abaikan");
    assert.equal(aksiOrder(true, "batal", "selesai"), "abaikan");
  });

  it("WMS pending + perlu_dikirim → update (masuk picklist)", () => {
    assert.equal(aksiOrder(true, "pending", "perlu_dikirim"), "update");
  });

  it("WMS pending + sedang/telah dikirim → update", () => {
    assert.equal(aksiOrder(true, "pending", "sedang_dikirim"), "update");
    assert.equal(aksiOrder(true, "pending", "telah_dikirim"), "update");
  });

  it("WMS pack + perlu_dikirim → update (stok sudah dipotong; alur hilir memutuskan picklist)", () => {
    assert.equal(aksiOrder(true, "pack", "perlu_dikirim"), "update");
  });

  it("WMS pack + sedang dikirim → update (tahap belum setara)", () => {
    assert.equal(aksiOrder(true, "pack", "sedang_dikirim"), "update");
  });

  it("WMS kirim + sedang/telah dikirim → skip (setara)", () => {
    assert.equal(aksiOrder(true, "kirim", "sedang_dikirim"), "skip");
    assert.equal(aksiOrder(true, "kirim", "telah_dikirim"), "skip");
  });

  it("WMS kirim/selesai + perlu_dikirim → mundur (F10)", () => {
    assert.equal(aksiOrder(true, "kirim", "perlu_dikirim"), "mundur");
    assert.equal(aksiOrder(true, "selesai", "perlu_dikirim"), "mundur");
  });

  it("WMS selesai + file selesai → skip (final)", () => {
    assert.equal(aksiOrder(true, "selesai", "selesai"), "skip");
    assert.equal(aksiOrder(true, "selesai", "sedang_dikirim"), "skip");
  });
});

describe("klasifikasikanImport (integrasi keputusan)", () => {
  it("order batal di file tidak masuk baru/update/skip", async () => {
    const r = await klasifikasikanImport(buatDb([]), [o("X", "batal"), o("Y", "belum_bayar")], []);
    assert.equal(r.baru.length, 0);
    assert.equal(r.update.length, 0);
    assert.equal(r.skip.length, 0);
  });

  it("order WMS batal tidak dihidupkan oleh file aktif", async () => {
    const r = await klasifikasikanImport(buatDb([{ no_pesanan: "A", status_fulfill: "batal", no_resi: "" }]), [o("A", "perlu_dikirim")], []);
    assert.equal(r.update.length, 0);
    assert.equal(r.baru.length, 0);
  });

  it("WMS pack + file perlu_dikirim → update, bukan skip", async () => {
    const r = await klasifikasikanImport(buatDb([{ no_pesanan: "A", status_fulfill: "pack", no_resi: "" }]), [o("A", "perlu_dikirim")], []);
    assert.deepEqual(r.update.map((x) => x.no_pesanan), ["A"]);
    assert.equal(r.skip.length, 0);
  });

  it("WMS selesai + file sedang_dikirim → skip (status final tidak turun)", async () => {
    const r = await klasifikasikanImport(buatDb([{ no_pesanan: "A", status_fulfill: "selesai", no_resi: "" }]), [o("A", "sedang_dikirim")], []);
    assert.deepEqual(r.skip.map((x) => x.no_pesanan), ["A"]);
    assert.equal(r.update.length, 0);
  });
});
