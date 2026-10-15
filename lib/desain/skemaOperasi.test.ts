// lib/desain/skemaOperasi.test.ts — Uji kosakata operasi kanvas (STEP 2).
// Yang diuji adalah janji ke pemanggil: validator TIDAK PERNAH melempar, op tak dikenal
// dibuang (bukan menggagalkan seluruh skrip), dan `bangun_ulang` tanpa layout yang sah
// TIDAK diteruskan — op itu mengosongkan kanvas, jadi menerimanya tanpa isi berarti
// menghapus pekerjaan user tanpa imbalan.
//
// SEKALIGUS mengunci PEMBATAS GEMINI: skema tool harus FLAT. Kalau suatu saat ada yang
// menambahkan `oneOf`/`anyOf`/`union` ke skema parameter, uji ini gagal — Gemini tidak
// mendukungnya dan kegagalannya tidak muncul sebagai error yang jelas di runtime.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAKS_OPERASI, OP_DIKENAL, destruktif, validasiOperasi,
} from "./skemaOperasi";
import { SKEMA_TOOL_EDITOR } from "./aiEditor";

/** Cari `oneOf`/`anyOf`/`union` di KEDALAMAN berapa pun — pembatasnya bukan hanya di akar. */
function cariUnion(v: unknown, jalur = "$"): string | null {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i += 1) {
      const d = cariUnion(v[i], `${jalur}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  for (const [k, isi] of Object.entries(v)) {
    if (k === "oneOf" || k === "anyOf") return `${jalur}.${k}`;
    const d = cariUnion(isi, `${jalur}.${k}`);
    if (d) return d;
  }
  return null;
}

describe("validasiOperasi", () => {
  it("menerima array op apa adanya", () => {
    const h = validasiOperasi([{ op: "pindah", id: "t1", x: 10 }]);
    assert.equal(h.ok, true);
    if (!h.ok) return;
    assert.equal(h.operasi.length, 1);
    assert.equal(h.operasi[0].op, "pindah");
    assert.equal(h.operasi[0].x, 10);
    assert.equal(h.dibuang, 0);
  });

  it("menerima bentuk { operasi: [...] } (model kadang membungkus daftarnya)", () => {
    const h = validasiOperasi({ operasi: [{ op: "latar", latarBelakang: "#ffffff" }] });
    assert.equal(h.ok, true);
    if (!h.ok) return;
    assert.equal(h.operasi.length, 1);
  });

  it("membuang op tak dikenal, bukan menggagalkan skrip", () => {
    const h = validasiOperasi([{ op: "pindah", id: "a" }, { op: "terbang" }, { op: "hapus", id: "b" }]);
    assert.equal(h.ok, true);
    if (!h.ok) return;
    assert.equal(h.operasi.length, 2);
    assert.equal(h.dibuang, 1);
  });

  it("menolak bangun_ulang TANPA layout yang sah", () => {
    for (const layout of [undefined, null, "x", 5]) {
      const h = validasiOperasi([{ op: "bangun_ulang", layout }]);
      assert.equal(h.ok, false, `layout ${String(layout)} seharusnya ditolak`);
    }
  });

  it("menolak warna di luar palet pada ubah_gaya (tidak menimpa jadi default)", () => {
    const h = validasiOperasi([{ op: "ubah_gaya", id: "t1", warna: "#123456" }]);
    assert.equal(h.ok, true);
    if (!h.ok) return;
    assert.equal(h.operasi[0].warna, undefined);
  });

  it("menerima warna palet", () => {
    const h = validasiOperasi([{ op: "ubah_gaya", id: "t1", warna: "#dc2626" }]);
    assert.equal(h.ok, true);
    if (!h.ok) return;
    assert.equal(h.operasi[0].warna, "#dc2626");
  });

  it("memotong jumlah op di MAKS_OPERASI, tidak menggagalkan", () => {
    const banyak = Array.from({ length: MAKS_OPERASI + 5 }, () => ({ op: "pindah", id: "a" }));
    const h = validasiOperasi(banyak);
    assert.equal(h.ok, true);
    if (!h.ok) return;
    assert.equal(h.operasi.length, MAKS_OPERASI);
  });

  it("tidak melempar untuk masukan sampah apa pun", () => {
    const sampah: unknown[] = [null, undefined, 0, "", "teks", [], {}, true, { operasi: null }];
    for (const s of sampah) {
      const h = validasiOperasi(s);
      assert.equal(typeof h.ok, "boolean");
      if (!h.ok) assert.equal(typeof h.error, "string");
    }
  });

  it("menandai skrip yang destruktif", () => {
    assert.equal(destruktif([{ op: "pindah", id: "a" }]), false);
    assert.equal(destruktif([{ op: "pindah", id: "a" }, { op: "bangun_ulang", layout: {} }]), true);
  });
});

describe("skema tool (pembatas Gemini)", () => {
  it("TIDAK memuat oneOf/anyOf di kedalaman mana pun", () => {
    assert.equal(cariUnion(SKEMA_TOOL_EDITOR), null);
  });

  it("diskriminan `op` adalah string tunggal, dan parameter adalah satu objek", () => {
    const params = SKEMA_TOOL_EDITOR.function.parameters;
    assert.equal(params.type, "object");
    const item = params.properties.operasi.items;
    assert.equal(item.type, "object");
    assert.equal(item.properties.op.type, "string");
    // Semua op harus disebut di deskripsi supaya model tahu daftar tertutupnya.
    for (const op of OP_DIKENAL) assert.ok(params.properties.operasi.items.properties.op.description.includes(op));
  });
});
