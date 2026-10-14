// lib/d1/aiModel.ts — Katalog model AI: teks | gambar | vision, per provider.
// Sumber awal dari GET /v1/models provider; user bisa tambah manual.
import { gabungModal, tebakModalDariNama, tebakSkemaReasoning } from "../ai/kapabilitas";
import { gagal, sekarang, type Hasil } from "./hasil";

export const JENIS_MODEL = ["teks", "gambar", "vision"] as const;
export type JenisModel = (typeof JENIS_MODEL)[number];

export type ModelAi = {
  id: number;
  provider: string;
  model_id: string;
  label: string;
  jenis: JenisModel;
  aktif: number;
  ditambah_at: number;
  /** CSV lowercase, mis. 'text,image'. '' = tidak diketahui. */
  modal_masuk: string;
  modal_keluar: string;
  /** '' | level_4 | level_3 | effort_openai | bool */
  reasoning_skema: string;
  /** CSV nilai sah untuk model ini, mis. 'low,medium,high'. */
  reasoning_pilihan: string;
  /** 1 = bisa menghasilkan reasoning yang dibaca sistem. */
  reasoning_hilir: number;
  /** provider | heuristik | manual */
  sumber: string;
};

const KOLOM =
  "id, provider, model_id, label, jenis, aktif, ditambah_at, modal_masuk, modal_keluar, reasoning_skema, reasoning_pilihan, reasoning_hilir, sumber";

function sahJenis(v: unknown): v is JenisModel {
  return typeof v === "string" && (JENIS_MODEL as readonly string[]).includes(v);
}

export async function tambahModel(
  db: D1Database,
  data: {
    provider: string;
    model_id: string;
    label?: string;
    jenis?: string;
    modalMasuk?: string[];
    modalKeluar?: string[];
    reasoningSkema?: string;
    reasoningPilihan?: string[];
    reasoningHilir?: boolean;
  }
): Promise<Hasil<{ model: ModelAi }>> {
  const provider = String(data.provider ?? "").trim().toLowerCase();
  const modelId = String(data.model_id ?? "").trim();
  if (!provider) return gagal(400, "Provider wajib diisi.");
  if (!modelId) return gagal(400, "Nama model wajib diisi.");
  const jenis = sahJenis(data.jenis) ? data.jenis : "teks";
  const k = kapabilitasSimpan(provider, modelId, data);

  // INSERT OR IGNORE: impor ulang dari provider tidak boleh menimpa label yang sudah diubah user.
  const r = await db
    .prepare(
      "INSERT OR IGNORE INTO ai_model (provider, model_id, label, jenis, aktif, ditambah_at, modal_masuk, modal_keluar, reasoning_skema, reasoning_pilihan, reasoning_hilir, sumber) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      provider,
      modelId,
      String(data.label ?? "").trim().slice(0, 80),
      jenis,
      sekarang(),
      k.modal_masuk,
      k.modal_keluar,
      k.reasoning_skema,
      k.reasoning_pilihan,
      k.reasoning_hilir,
      k.sumber
    )
    .run();
  const baris = await db
    .prepare(`SELECT ${KOLOM} FROM ai_model WHERE provider = ? AND model_id = ?`)
    .bind(provider, modelId)
    .first<ModelAi>();
  if (!baris) return gagal(500, "Gagal menambah model.");
  void r;
  return { ok: true, model: baris };
}

/**
 * ATURAN GABUNG kapabilitas: data API provider menang (sumber='provider');
 * bila adapter tidak memberi modal/reasoning, pakai heuristik nama (sumber='heuristik').
 */
function kapabilitasSimpan(
  provider: string,
  modelId: string,
  data: { modalMasuk?: string[]; modalKeluar?: string[]; reasoningSkema?: string; reasoningPilihan?: string[]; reasoningHilir?: boolean }
): Pick<ModelAi, "modal_masuk" | "modal_keluar" | "reasoning_skema" | "reasoning_pilihan" | "reasoning_hilir" | "sumber"> {
  const dariProviderModal = (data.modalMasuk?.length ?? 0) > 0 || (data.modalKeluar?.length ?? 0) > 0;
  const modal = gabungModal({ masuk: data.modalMasuk, keluar: data.modalKeluar }, tebakModalDariNama(provider, modelId));

  // Skema reasoning dari API dipakai apa adanya (termasuk 'bool' — provider memang
  // hanya bilang bisa/tidak). Heuristik hanya dipakai bila provider DIAM soal reasoning.
  const skemaProvider = String(data.reasoningSkema ?? "").trim();
  const adaSkemaProvider = skemaProvider !== "";
  const tebakan = tebakSkemaReasoning(provider, modelId);
  const reasoning_skema = adaSkemaProvider ? skemaProvider : tebakan.skema;
  const reasoning_pilihan = adaSkemaProvider
    ? (data.reasoningPilihan ?? []).join(",")
    : tebakan.pilihan.join(",");

  return {
    modal_masuk: modal.masuk.join(","),
    modal_keluar: modal.keluar.join(","),
    reasoning_skema,
    reasoning_pilihan,
    reasoning_hilir: data.reasoningHilir || reasoning_skema !== "" ? 1 : 0,
    // Sumber 'provider' bila provider memberi modal ATAU skema reasoning. Sebelumnya
    // hanya melihat modal, sehingga model Kenari (yang memberi reasoning tanpa modal)
    // salah ditandai 'heuristik' padahal datanya otentik.
    sumber: dariProviderModal || adaSkemaProvider ? "provider" : "heuristik",
  };
}

/** Tambah banyak sekaligus (hasil tarik dari provider). Abaikan yang sudah ada. */
export async function tambahModelBanyak(
  db: D1Database,
  provider: string,
  daftar: {
    model_id: string;
    label?: string;
    jenis?: string;
    modalMasuk?: string[];
    modalKeluar?: string[];
    reasoningSkema?: string;
    reasoningPilihan?: string[];
    reasoningHilir?: boolean;
  }[]
): Promise<{ ditambah: number; dilewati: number }> {
  const p = String(provider ?? "").trim().toLowerCase();
  if (!p || daftar.length === 0) return { ditambah: 0, dilewati: 0 };
  const stmts = daftar.map((m) => {
    const modelId = String(m.model_id).trim();
    const k = kapabilitasSimpan(p, modelId, m);
    return db
      .prepare(
        "INSERT OR IGNORE INTO ai_model (provider, model_id, label, jenis, aktif, ditambah_at, modal_masuk, modal_keluar, reasoning_skema, reasoning_pilihan, reasoning_hilir, sumber) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        p,
        modelId,
        String(m.label ?? "").slice(0, 80),
        sahJenis(m.jenis) ? m.jenis : "teks",
        sekarang(),
        k.modal_masuk,
        k.modal_keluar,
        k.reasoning_skema,
        k.reasoning_pilihan,
        k.reasoning_hilir,
        k.sumber
      );
  });
  let ditambah = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const hasil = await db.batch(stmts.slice(i, i + 50));
    for (const h of hasil) ditambah += h.meta.changes ?? 0;
  }
  return { ditambah, dilewati: stmts.length - ditambah };
}

/** Koreksi kapabilitas manual dari UI. Selalu menandai sumber='manual' agar tidak ditimpa impor. */
export async function perbaruiKapabilitasModel(
  db: D1Database,
  provider: string,
  modelId: string,
  patch: {
    modalMasuk?: string[];
    modalKeluar?: string[];
    reasoningSkema?: string;
    reasoningPilihan?: string[];
    reasoningHilir?: boolean;
  }
): Promise<Hasil<{ ok: true }>> {
  const p = String(provider ?? "").trim().toLowerCase();
  const id = String(modelId ?? "").trim();
  if (!p || !id) return gagal(400, "Provider dan model wajib diisi.");
  const kini = await db
    .prepare(`SELECT ${KOLOM} FROM ai_model WHERE provider = ? AND model_id = ?`)
    .bind(p, id)
    .first<ModelAi>();
  if (!kini) return gagal(404, "Model tidak ditemukan.");

  const skema = patch.reasoningSkema === undefined ? kini.reasoning_skema : String(patch.reasoningSkema).trim();
  const r = await db
    .prepare(
      "UPDATE ai_model SET modal_masuk = ?, modal_keluar = ?, reasoning_skema = ?, reasoning_pilihan = ?, reasoning_hilir = ?, sumber = 'manual' WHERE provider = ? AND model_id = ?"
    )
    .bind(
      patch.modalMasuk === undefined ? kini.modal_masuk : patch.modalMasuk.join(","),
      patch.modalKeluar === undefined ? kini.modal_keluar : patch.modalKeluar.join(","),
      skema,
      patch.reasoningPilihan === undefined ? kini.reasoning_pilihan : patch.reasoningPilihan.join(","),
      patch.reasoningHilir === undefined ? kini.reasoning_hilir : patch.reasoningHilir ? 1 : 0,
      p,
      id
    )
    .run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Model tidak ditemukan.");
  return { ok: true };
}

/** Hitungan ringkas kapabilitas katalog — dipakai dashboard untuk menampilkan cakupan data. */
export async function ringkasKapabilitas(
  db: D1Database,
  provider?: string
): Promise<{ total: number; bisaGambar: number; punyaReasoning: number }> {
  const p = String(provider ?? "").trim().toLowerCase();
  // substr dipakai, bukan LIKE '%image%', agar CSV 'image' tidak cocok dengan mis. 'image_edit' nanti.
  const sql =
    "SELECT COUNT(*) AS total, SUM(CASE WHEN modal_keluar LIKE '%image%' THEN 1 ELSE 0 END) AS bisaGambar, SUM(CASE WHEN reasoning_skema != '' THEN 1 ELSE 0 END) AS punyaReasoning FROM ai_model";
  const r = await db.prepare(p ? `${sql} WHERE provider = ?` : sql).bind(...(p ? [p] : [])).first<{ total?: number; bisaGambar?: number; punyaReasoning?: number }>();
  return { total: r?.total ?? 0, bisaGambar: r?.bisaGambar ?? 0, punyaReasoning: r?.punyaReasoning ?? 0 };
}

export async function daftarModel(db: D1Database, provider?: string, jenis?: string): Promise<ModelAi[]> {
  const syarat: string[] = [];
  const args: unknown[] = [];
  if (provider) { syarat.push("provider = ?"); args.push(provider.trim().toLowerCase()); }
  if (sahJenis(jenis)) { syarat.push("jenis = ?"); args.push(jenis); }
  const sql = `SELECT ${KOLOM} FROM ai_model${syarat.length ? ` WHERE ${syarat.join(" AND ")}` : ""} ORDER BY provider, jenis, model_id`;
  const { results } = await db.prepare(sql).bind(...args).all<ModelAi>();
  return results ?? [];
}

export async function setAktifModel(db: D1Database, id: number, aktif: boolean): Promise<Hasil<{ model: ModelAi }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const r = await db.prepare("UPDATE ai_model SET aktif = ? WHERE id = ?").bind(aktif ? 1 : 0, id).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Model tidak ditemukan.");
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_model WHERE id = ?`).bind(id).first<ModelAi>();
  if (!baris) return gagal(404, "Model tidak ditemukan.");
  return { ok: true, model: baris };
}

export async function ubahLabelModel(db: D1Database, id: number, label: string): Promise<Hasil<{ model: ModelAi }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const bersih = String(label ?? "").trim().slice(0, 80);
  const r = await db.prepare("UPDATE ai_model SET label = ? WHERE id = ?").bind(bersih, id).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Model tidak ditemukan.");
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_model WHERE id = ?`).bind(id).first<ModelAi>();
  if (!baris) return gagal(404, "Model tidak ditemukan.");
  return { ok: true, model: baris };
}

export async function hapusModel(db: D1Database, id: number): Promise<Hasil<{ dihapus: true }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const r = await db.prepare("DELETE FROM ai_model WHERE id = ?").bind(id).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Model tidak ditemukan.");
  return { ok: true, dihapus: true };
}

/** Model aktif untuk provider+jenis — dipakai adapter saat memilih model. */
export async function modelAktif(db: D1Database, provider: string, jenis: JenisModel): Promise<string | null> {
  const r = await db
    .prepare("SELECT model_id FROM ai_model WHERE provider = ? AND jenis = ? AND aktif = 1 ORDER BY id LIMIT 1")
    .bind(String(provider ?? "").trim().toLowerCase(), jenis)
    .first<{ model_id: string }>();
  return r?.model_id ?? null;
}
