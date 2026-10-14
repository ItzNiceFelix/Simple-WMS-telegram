// Uji klien Kledo: paginasi, retry, timeout, chunk, dan bentuk respons nyata.
// Fixture diambil dari respons produksi (lib/kledo/fixture/kledo.json) — tanpa token.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  kledoGet, ambilSemua, potong, bacaHalaman, ambilStok,
  PER_PAGE_MAKS, CHUNK_PRODUK, type OpsiKledo,
} from "./klien";

const OPSI: OpsiKledo = { subdomain: "contoh", token: "rahasia", retry: 2 };

let asli: typeof globalThis.fetch;
let panggilan: string[] = [];
let skenario: ((url: string, n: number) => Response | Promise<Response>) | null = null;
let nomor = 0;

function jawab(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  asli = globalThis.fetch;
  panggilan = [];
  nomor = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    panggilan.push(u);
    nomor++;
    // Bentuk nyata Kledo: {success, data, message, time}
    if (skenario) return skenario(u, nomor);
    return jawab({ success: true, data: [], message: "ok", time: 0.01 });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = asli;
  skenario = null;
});

describe("kledoGet", () => {
  it("membaca bentuk {success, data} yang nyata", async () => {
    skenario = (u) => {
      assert.ok(u.startsWith("https://contoh.api.kledo.com/api/v1/"), "base URL benar");
      return jawab({ success: true, data: { data: [{ id: 2, name: "Gudang D12", code: "D12" }] }, message: "Gudang berhasil diambil" });
    };
    const h = await kledoGet<{ data: { id: number }[] }>(OPSI, "/finance/warehouses");
    assert.equal(h.ok, true);
    if (h.ok) assert.equal(h.data.data[0].id, 2);
  });

  it("mengirim Authorization Bearer dan TIDAK pernah POST", async () => {
    let metode = "";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      metode = String(init?.method ?? "GET");
      const h = init?.headers as Record<string, string>;
      assert.equal(h.Authorization, "Bearer rahasia");
      return jawab({ success: true, data: {} });
    }) as typeof globalThis.fetch;
    await kledoGet(OPSI, "/finance/warehouses");
    assert.equal(metode, "GET", "klien hanya boleh GET");
  });

  it("success:false dianggap gagal walau HTTP 200", async () => {
    skenario = () => jawab({ success: false, message: "Token tidak valid" });
    const h = await kledoGet(OPSI, "/x");
    assert.equal(h.ok, false);
    if (!h.ok) assert.match(h.error, /Token tidak valid/);
  });

  it("tidak mengulang 401 (salah token tidak akan berubah)", async () => {
    let n = 0;
    skenario = () => { n++; return jawab({ success: false, message: "Unauthorized" }, 401); };
    const h = await kledoGet(OPSI, "/x");
    assert.equal(h.ok, false);
    assert.equal(n, 1, "401 tidak boleh diulang");
  });

  it("mengulang 500 lalu berhasil", async () => {
    skenario = (u, n) => (n === 1 ? jawab({ message: "boom" }, 500) : jawab({ success: true, data: { nilai: 7 } }));
    const h = await kledoGet<{ nilai: number }>(OPSI, "/x");
    assert.equal(h.ok, true);
    if (h.ok) assert.equal(h.data.nilai, 7);
    assert.equal(nomor, 2, "percobaan kedua dipakai");
  });

  it("mengulang 429", async () => {
    skenario = (u, n) => (n === 1 ? jawab({ message: "rate limit" }, 429) : jawab({ success: true, data: {} }));
    const h = await kledoGet(OPSI, "/x");
    assert.equal(h.ok, true);
  });

  it("JSON rusak -> pesan memuat potongan body, bukan crash", async () => {
    globalThis.fetch = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as typeof globalThis.fetch;
    const h = await kledoGet(OPSI, "/x");
    assert.equal(h.ok, false);
    if (!h.ok) assert.match(h.error, /Bukan JSON|bad gateway/);
  });

  it("timeout nyata (server menggantung) tidak menggantung selamanya", async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      // Menghormati signal: menolak saat dibatalkan, seperti fetch sungguhan.
      return new Promise((_res, rej) => {
        const s = init?.signal;
        if (s) s.addEventListener("abort", () => rej(new Error("The operation was aborted")));
      }) as Promise<Response>;
    }) as typeof globalThis.fetch;
    const mulai = Date.now();
    const h = await kledoGet({ ...OPSI, timeoutMs: 150, retry: 1 }, "/x");
    assert.equal(h.ok, false);
    assert.ok(Date.now() - mulai < 2000, "berhenti cepat, tidak menggantung");
    if (!h.ok) assert.match(h.error, /Gagal menghubungi/);
  });
});

describe("paginasi", () => {
  it("bacaHalaman: selesai saat current_page >= last_page", () => {
    const h = bacaHalaman({ data: [1, 2], current_page: 3, last_page: 3, total: 5 }, 3);
    assert.equal(h.selesai, true);
    assert.equal(h.total, 5);
  });

  it("bacaHalaman: selesai saat next_page_url null", () => {
    assert.equal(bacaHalaman({ data: [1], current_page: 1, last_page: 99, next_page_url: null }, 1).selesai, true);
  });

  it("bacaHalaman: belum selesai bila masih ada halaman berikut", () => {
    assert.equal(bacaHalaman({ data: [1], current_page: 1, last_page: 3, next_page_url: "http://x?page=2" }, 1).selesai, false);
  });

  it("ambilSemua menelusuri semua halaman lalu berhenti", async () => {
    skenario = (u) => {
      const p = Number(new URL(u).searchParams.get("page") ?? "1");
      const semua = [1, 2, 3, 4, 5];
      const last = 3;
      const baris = semua.filter((_, i) => Math.floor(i / 2) + 1 === p);
      return jawab({ success: true, data: { data: baris, current_page: p, last_page: last, total: 5, next_page_url: p < last ? "ada" : null } });
    };
    const h = await ambilSemua<number>(OPSI, "/daftar");
    assert.equal(h.ok, true);
    if (h.ok) assert.deepEqual(h.data, [1, 2, 3, 4, 5]);
    assert.equal(panggilan.length, 3, "tepat 3 halaman, tidak lebih");
  });

  it("pagar halaman mencegah putaran tak berujung", async () => {
    skenario = (u) => {
      const p = Number(new URL(u).searchParams.get("page") ?? "1");
      // Selalu mengaku belum selesai, dan current_page maju selamanya.
      return jawab({ success: true, data: { data: [p], current_page: p, last_page: 999999, next_page_url: "ada" } });
    };
    const h = await ambilSemua<number>(OPSI, "/daftar", 4);
    assert.equal(h.ok, false);
    if (!h.ok) assert.match(h.error, /Melebihi batas 4 halaman/);
  });
});

describe("potong dan chunk", () => {
  it("potong membagi rata dan menangani sisa", () => {
    assert.deepEqual(potong([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it("potong array kosong -> tidak ada bagian", () => {
    assert.deepEqual(potong([], 50), []);
  });

  it("ukuran potong tidak sah ditolak", () => {
    assert.throws(() => potong([1], 0), /ukuran harus >= 1/);
  });

  it("ambilStok memotong product_ids dan menggabungkan hasil", async () => {
    const ids = Array.from({ length: CHUNK_PRODUK * 2 + 5 }, (_, i) => i + 1);
    const terlihat: number[] = [];
    skenario = (u) => {
      const pid = new URL(u).searchParams.get("product_ids") ?? "";
      const arr = pid ? pid.split(",") : [];
      terlihat.push(arr.length);
      assert.ok(arr.length <= CHUNK_PRODUK, "tidak melebihi batas potong");
      return jawab({ success: true, data: arr.map((id) => ({ id, qty: 1, stocks: {} })) });
    };
    const h = await ambilStok(OPSI, ids);
    assert.equal(h.ok, true);
    if (h.ok) assert.equal(h.data.length, ids.length);
    assert.deepEqual(terlihat, [CHUNK_PRODUK, CHUNK_PRODUK, 5], "3 potongan berukuran benar");
  });

  it("PER_PAGE_MAKS = 100 (plafon keras yang terukur)", () => {
    assert.equal(PER_PAGE_MAKS, 100);
  });
});

describe("ujiKoneksi", () => {
  it("membaca bentuk PAGINASI data.data[], bukan data[] langsung", async () => {
    // Bentuk nyata dari produksi: /finance/warehouses mengembalikan data:{data:[...]}.
    skenario = () => jawab({
      success: true,
      data: { data: [{ id: 4, name: "Dukuh Kupang", code: "DK-KPG" }, { id: 2, name: "Gudang D12", code: "D12" }], current_page: 1, last_page: 1 },
      message: "Gudang berhasil diambil",
    });
    const mod = await import("./klien");
    const h = await mod.ujiKoneksi(OPSI);
    assert.equal(h.ok, true);
    if (h.ok) assert.equal(h.data.jumlahGudang, 2, "menghitung 2 gudang, bukan 0");
  });

  it("meneruskan kegagalan token", async () => {
    skenario = () => jawab({ success: false, message: "Unauthorized" }, 401);
    const mod = await import("./klien");
    const h = await mod.ujiKoneksi(OPSI);
    assert.equal(h.ok, false);
    if (!h.ok) assert.match(h.error, /Unauthorized/);
  });
});

describe("ambilHargaBeliTerakhir (bentuk OBJEK, bukan array)", () => {
  it("membaca objek berkunci id dengan field last_buy_price", async () => {
    const { ambilHargaBeliTerakhir } = await import("./klien");
    globalThis.fetch = (async () => {
      // Bentuk PERSIS dari produksi Kledo.
      return new Response(
        JSON.stringify({ success: true, data: { "231": { last_buy_price: 4200, last_buy_price_contact: 0 }, "5": { last_buy_price: 0 } } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof globalThis.fetch;
    const peta = await ambilHargaBeliTerakhir(OPSI, [231, 5]);
    assert.equal(peta.get(231), 4200, "nilai last_buy_price terbaca");
    assert.equal(peta.has(5), false, "0 tidak dipakai sebagai fallback");
  });

  it("tetap menerima bentuk array (jaga-jaga)", async () => {
    const { ambilHargaBeliTerakhir } = await import("./klien");
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true, data: [{ id: 9, last_buy_price: 700 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;
    const peta = await ambilHargaBeliTerakhir(OPSI, [9]);
    assert.equal(peta.get(9), 700);
  });
});

describe("fixture produksi", () => {
  // Fixture menyimpan respons PENUH Kledo: {success, data, message, time}.
  it("bentuk gudang nyata terbaca", async () => {
    const mod: unknown = await import("./fixture/kledo.json", { with: { type: "json" } });
    assert.ok(mod && typeof mod === "object" && "default" in mod, "impor JSON memberi default");
    const fixture: unknown = mod.default;
    assert.ok(fixture && typeof fixture === "object" && "warehouses" in fixture, "fixture punya warehouses");

    const { warehouses, produk, stok } = fixture;
    assert.ok(warehouses && typeof warehouses === "object" && "data" in warehouses, "warehouses.data");

    // /finance/warehouses juga BERBENTUK PAGINASI: data.data[], bukan data[] langsung.
    const halamanGudang: unknown = warehouses.data;
    assert.ok(halamanGudang && typeof halamanGudang === "object" && "data" in halamanGudang, "warehouses.data.data");
    const daftarGudang: unknown = halamanGudang.data;
    assert.ok(Array.isArray(daftarGudang), "warehouses.data.data adalah array");
    assert.equal(daftarGudang.length, 3, "3 gudang: D12, D19, Dukuh Kupang");
    const d12: unknown = daftarGudang.find((g) => g && typeof g === "object" && "code" in g && g.code === "D12");
    assert.ok(d12, "gudang D12 ada di fixture");

    assert.ok(produk && typeof produk === "object" && "data" in produk, "produk.data");
    const halaman: unknown = produk.data;
    assert.ok(halaman && typeof halaman === "object" && "data" in halaman, "produk.data.data (berpaginasi)");
    const barisProduk: unknown = halaman.data;
    assert.ok(Array.isArray(barisProduk) && barisProduk.length > 0, "ada produk");
    const p0: unknown = barisProduk[0];
    assert.ok(p0 && typeof p0 === "object" && "avg_base_price" in p0, "HPP = avg_base_price, bukan 'hpp'");

    assert.ok(stok && typeof stok === "object" && "data" in stok, "stok.data");
    const barisStok: unknown = stok.data;
    assert.ok(Array.isArray(barisStok) && barisStok.length > 0, "ada baris stok");
    const s0: unknown = barisStok[0];
    assert.ok(s0 && typeof s0 === "object" && "stocks" in s0, "baris punya stocks");
    assert.equal(typeof s0.stocks, "object", "stocks berkunci warehouse_id, bukan array");
    assert.ok(!Array.isArray(s0.stocks), "stocks BUKAN array");
  });
});
