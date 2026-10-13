// lib/ai/kripto.ts — Enkripsi kredensial provider (AES-GCM, WebCrypto).
//
// API key disimpan di D1 sebagai ciphertext; plaintext membacanya butuh
// AI_KEY_ENCRYPTION_KEY (Worker secret) yang TIDAK ada di DB. Jadi bila D1 bocor,
// key tetap aman. Kunci dibuat sekali:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//   npx wrangler secret put AI_KEY_ENCRYPTION_KEY

const PANJANG_KUNCI = 32; // AES-256
const PANJANG_IV = 12; // direkomendasikan GCM
const PANJANG_TAG = 16;

export type Terenkripsi = {
  ciphertext: string;
  iv: string;
  tag: string;
  /** 4 karakter terakhir plaintext — untuk mask di UI (mis. "••••3f2a"). */
  ujung: string;
};

function keB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function dariB64(s: string): Uint8Array {
  const biner = atob(s);
  const bytes = new Uint8Array(biner.length);
  for (let i = 0; i < biner.length; i++) bytes[i] = biner.charCodeAt(i);
  return bytes;
}

/** Ambil kunci dari secret. Melempar bila tidak ada atau panjangnya salah. */
export function ambilKunci(b64 = ""): Promise<CryptoKey> {
  const mentah = (b64 || "").trim();
  if (!mentah) {
    throw new Error(
      "AI_KEY_ENCRYPTION_KEY belum diset. Buat dengan: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" lalu `npx wrangler secret put AI_KEY_ENCRYPTION_KEY`."
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = dariB64(mentah);
  } catch {
    throw new Error("AI_KEY_ENCRYPTION_KEY bukan base64 yang sah.");
  }
  if (bytes.length !== PANJANG_KUNCI) {
    throw new Error(`AI_KEY_ENCRYPTION_KEY harus ${PANJANG_KUNCI} byte (${PANJANG_KUNCI * 8} bit); punya ${bytes.length} byte.`);
  }
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Enkripsi plaintext. IV acak setiap panggilan — IV sama tidak boleh dipakai ulang. */
export async function enkripsi(plaintext: string, kunciB64: string): Promise<Terenkripsi> {
  const teks = String(plaintext ?? "").trim();
  if (!teks) throw new Error("Teks yang dienkripsi tidak boleh kosong.");
  const kunci = await ambilKunci(kunciB64);
  const iv = crypto.getRandomValues(new Uint8Array(PANJANG_IV));
  // WebCrypto mengembalikan ciphertext||tag; pisahkan agar kolomnya eksplisit.
  const gabung = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kunci, new TextEncoder().encode(teks)));
  const ciphertext = gabung.slice(0, gabung.length - PANJANG_TAG);
  const tag = gabung.slice(gabung.length - PANJANG_TAG);
  return {
    ciphertext: keB64(ciphertext),
    iv: keB64(iv),
    tag: keB64(tag),
    ujung: teks.slice(-4),
  };
}

/** Dekripsi. Gagal (tag tidak cocok / kunci salah) → melempar, tidak mengembalikan sampah. */
export async function dekripsi(data: { ciphertext: string; iv: string; tag: string }, kunciB64: string): Promise<string> {
  const kunci = await ambilKunci(kunciB64);
  const ciphertext = dariB64(data.ciphertext);
  const tag = dariB64(data.tag);
  const gabung = new Uint8Array(ciphertext.length + tag.length);
  gabung.set(ciphertext, 0);
  gabung.set(tag, ciphertext.length);
  const iv = dariB64(data.iv);
  if (iv.length !== PANJANG_IV) throw new Error("IV tidak sah.");
  try {
    const hasil = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, kunci, gabung);
    return new TextDecoder().decode(hasil);
  } catch {
    // Jangan bocorkan detail ke pemanggil; bisa jadi kunci beda atau data rusak.
    throw new Error("Gagal mendekripsi kredensial (kunci berbeda atau data rusak).");
  }
}

/** Mask untuk UI: tidak pernah mengembalikan plaintext. */
export function maskKredensial(ujung: string): string {
  const u = (ujung || "").slice(-4);
  return u ? `••••${u}` : "••••";
}
