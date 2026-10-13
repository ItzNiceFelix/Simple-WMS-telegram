// lib/ai/kripto.test.ts — Enkripsi kredensial: round-trip, IV unik, penolakan kunci salah.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ambilKunci, dekripsi, enkripsi, maskKredensial } from "./kripto";

// Kunci uji 32 byte (base64). BUKAN kunci produksi.
const KUNCI = "Y2JjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=";
const KUNCI2 = "MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0dXY=";

describe("enkripsi kredensial (AES-GCM)", () => {
  it("round-trip: dekripsi mengembalikan plaintext asli", async () => {
    const asli = "sk-abc123XYZ-rahasia-panjang";
    const t = await enkripsi(asli, KUNCI);
    assert.equal(t.ciphertext.length > 0, true);
    assert.equal(t.iv.length > 0, true);
    assert.equal(t.tag.length > 0, true);
    assert.equal(await dekripsi(t, KUNCI), asli);
  });

  it("plaintext TIDAK muncul di ciphertext", async () => {
    const asli = "sk-rahasia-jangan-sampai-bocor";
    const t = await enkripsi(asli, KUNCI);
    const gabung = `${t.ciphertext}${t.iv}${t.tag}`;
    assert.equal(gabung.includes("rahasia"), false);
    assert.equal(gabung.includes("sk-"), false);
  });

  it("ujung menyimpan 4 karakter terakhir untuk mask", async () => {
    const t = await enkripsi("sk-abcdef1234", KUNCI);
    assert.equal(t.ujung, "1234");
    assert.equal(maskKredensial(t.ujung), "••••1234");
  });

  it("IV berbeda tiap enkripsi (plaintext sama -> ciphertext beda)", async () => {
    const a = await enkripsi("teks-sama", KUNCI);
    const b = await enkripsi("teks-sama", KUNCI);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ciphertext, b.ciphertext);
    // Keduanya tetap bisa didekripsi
    assert.equal(await dekripsi(a, KUNCI), "teks-sama");
    assert.equal(await dekripsi(b, KUNCI), "teks-sama");
  });

  it("kunci berbeda -> dekripsi gagal (tidak mengembalikan sampah)", async () => {
    const t = await enkripsi("rahasia", KUNCI);
    await assert.rejects(() => dekripsi(t, KUNCI2), /Gagal mendekripsi/);
  });

  it("data diubah -> dekripsi gagal (tag mendeteksi)", async () => {
    const t = await enkripsi("rahasia", KUNCI);
    const rusak = { ...t, ciphertext: t.ciphertext.slice(0, -2) + "AA" };
    await assert.rejects(() => dekripsi(rusak, KUNCI), /Gagal mendekripsi/);
  });

  it("IV tidak sah -> ditolak sebelum dekripsi", async () => {
    const t = await enkripsi("rahasia", KUNCI);
    await assert.rejects(() => dekripsi({ ...t, iv: "AAAA" }, KUNCI), /IV tidak sah/);
  });

  it("kunci kosong -> pesan panduan, bukan crash", async () => {
    // ambilKunci sinkron sampai importKey; validasi kunci melempar SEBELUM await.
    await assert.rejects(async () => ambilKunci(""), /AI_KEY_ENCRYPTION_KEY belum diset/);
  });

  it("kunci salah panjang -> ditolak dengan jelas", async () => {
    await assert.rejects(async () => ambilKunci(btoa("pendek")), /harus 32 byte/);
  });

  it("plaintext kosong ditolak", async () => {
    await assert.rejects(() => enkripsi("   ", KUNCI), /tidak boleh kosong/);
  });

  it("kunci base64 rusak -> pesan jelas", async () => {
    await assert.rejects(async () => ambilKunci("bukan-base64-!!!"), /base64 yang sah/);
  });

  it("teks panjang + unicode tetap utuh", async () => {
    const asli = "kunci-ünïcode-🔑".repeat(50);
    const t = await enkripsi(asli, KUNCI);
    assert.equal(await dekripsi(t, KUNCI), asli);
  });
});
