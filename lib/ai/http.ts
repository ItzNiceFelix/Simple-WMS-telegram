// lib/ai/http.ts — Helper fetch bersama untuk semua adapter provider AI (Fase B).
// Tanggung jawab: timeout (AbortController), retry terbatas untuk 5xx/429/error
// jaringan, pengukuran latensi, dan pesan error yang SELALU memuat status +
// potongan body asli provider (maks 300 char) — bukan pesan generik.
// Dependensi: hanya API runtime (fetch, AbortController). Tidak menyentuh D1.

export type HasilHttp<T> =
  | { ok: true; data: T; latencyMs: number }
  | { ok: false; status: number; error: string; latencyMs: number };

/** Satu bagian percakapan yang netral-provider; adapter menerjemahkan ke formatnya. */
export type BagianChat = {
  role: "system" | "user" | "assistant" | "tool";
  teks: string;
  gambar?: { mime: string; base64: string }[];
  /** Untuk role "tool": id pemanggilan yang dijawab. */
  toolCallId?: string;
  /** Untuk role "tool": nama fungsi yang dijawab. */
  namaTool?: string;
};

/**
 * Metadata satu model dari GET /models provider. Field kapabilitas OPSIONAL:
 * hanya OpenRouter (dan sebagian Gemini) yang mengisinya — sisanya undefined
 * dan diisi heuristik di lib/ai/kapabilitas.ts.
 */
export type HasilModel = {
  id: string;
  label?: string;
  modalMasuk?: string[];
  modalKeluar?: string[];
  reasoningSkema?: string;
  reasoningPilihan?: string[];
  reasoningHilir?: boolean;
  contextLength?: number;
};

/** Kredensial provider yang sudah di-dekripsi; baseUrl kosong = pakai bawaan provider. */
export type KredensialProvider = { apiKey: string; baseUrl?: string; timeoutMs?: number };

export type PermintaanChat = {
  model: string;
  pesan: BagianChat[];
  tool?: unknown[];
  maksToken?: number;
  suhu?: number;
  jsonMode?: boolean;
  /** Nilai reasoning dari setting ('low','high',...). Kosong = provider pakai default. */
  reasoning?: string;
  /** True bila sistem boleh membaca reasoning yang dihasilkan model. */
  reasoningHilir?: boolean;
};

export type JawabanChat = {
  teks: string;
  toolCall?: { id: string; nama: string; argumen: string }[];
  tokenMasuk?: number;
  tokenKeluar?: number;
  raw?: unknown;
};

export type OpsiHttp = { timeoutMs?: number; retry?: number };

/** Status yang layak diulang: 429 (rate limit) dan 5xx (gangguan sementara provider). */
function bolehUlang(status: number): boolean {
  return status === 429 || status >= 500;
}

/** body mentah dipotong agar pesan error tetap terbaca tapi tak membanjiri UI/DB. */
function pesanError(status: number, body: string): string {
  return `Provider menolak (HTTP ${status}): ${body.slice(0, 300)}`;
}

const jeda = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

/**
 * Panggil endpoint JSON dengan timeout + retry maksimal 2 kali.
 * Retry hanya untuk 429/5xx/error jaringan; 4xx lain langsung dikembalikan
 * supaya pemanggil (orkestrator) bisa pindah model/provider tanpa menunggu.
 */
export async function panggilJson<T>(url: string, init: RequestInit, opts: OpsiHttp = {}): Promise<HasilHttp<T>> {
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 30000;
  const maksUlang = opts.retry ?? 2;
  const mulai = Date.now();
  let terakhir = "Tanpa respons dari provider.";

  for (let percobaan = 0; percobaan <= maksUlang; percobaan++) {
    if (percobaan > 0) await jeda(percobaan === 1 ? 400 : 1200);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      const body = await res.text().catch(() => "");
      if (!res.ok) {
        terakhir = pesanCloudflare(res.status, body) ?? pesanError(res.status, body || "(body kosong)");
        if (bolehUlang(res.status) && percobaan < maksUlang) continue;
        return { ok: false, status: res.status, error: terakhir, latencyMs: Date.now() - mulai };
      }
      let data: T;
      try {
        data = (body ? JSON.parse(body) : {}) as T;
      } catch {
        // Provider mengembalikan 200 tapi bukan JSON — sertakan potongan body asli.
        return {
          ok: false,
          status: 502,
          error: `Respons provider bukan JSON: ${body.slice(0, 300)}`,
          latencyMs: Date.now() - mulai,
        };
      }
      return { ok: true, data, latencyMs: Date.now() - mulai };
    } catch (e) {
      // AbortError/TypeError jaringan — layak diulang, pesannya tetap asli.
      const sebab = e instanceof Error ? e.message : String(e);
      terakhir = ac.signal.aborted ? `Timeout provider setelah ${timeoutMs}ms.` : `Gagal menghubungi provider: ${sebab}`;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 0, error: terakhir, latencyMs: Date.now() - mulai };
}

/**
 * Terjemahkan error Cloudflare yang tidak informatif menjadi pesan yang bisa ditindak.
 * Kode 1016/1019/1003/1033 muncul saat host provider tidak bisa di-resolve/dihubungi —
 * gejalanya "HTTP 530: error code: 1016" yang membingungkan tanpa penjelasan.
 */
function pesanCloudflare(status: number, body: string): string | null {
  const kode = /error code:\s*(\d{4})/.exec(body)?.[1];
  if (!kode) return null;
  const arti: Record<string, string> = {
    "1016": "DNS gagal: nama host provider tidak ditemukan",
    "1019": "provider tidak punya record DNS yang sah",
    "1003": "IP tujuan tidak diizinkan (Direct IP Access Not Allowed)",
    "1033": "konfigurasi DNS provider bermasalah (Argo Tunnel error)",
    "1014": "CORS atau skema URL provider salah",
  };
  const sebab = arti[kode] ?? "host provider tidak bisa dihubungi";
  return `HTTP ${status} dari Cloudflare (kode ${kode}): ${sebab}. Periksa alamat dasar (base URL) provider di pengaturan — kemungkinan hostnya salah atau sudah tidak aktif. Potongan asli: ${body.slice(0, 200)}`;
}

/** Ambil potongan teks error dari respons provider apa pun bentuknya (string/objek). */
export function pesanServer(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const d = v as { error?: unknown; message?: unknown; detail?: unknown };
    if (typeof d.error === "string") return d.error;
    if (d.error && typeof d.error === "object" && typeof (d.error as { message?: unknown }).message === "string") {
      return String((d.error as { message?: unknown }).message);
    }
    if (typeof d.message === "string") return d.message;
    if (typeof d.detail === "string") return d.detail;
  }
  try {
    return JSON.stringify(v).slice(0, 300);
  } catch {
    return String(v);
  }
}
