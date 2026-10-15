// app/api/ai/editor/setting/route.ts — Setting AI EDITOR per user (migrasi 0036 + 0037).
// GET  → setting user + katalog model TEKS yang boleh dipakai role ini.
// POST → simpan setting; reasoning + model divalidasi, model diperiksa terhadap izin role.
//
// GATE: user login mana pun KECUALI guest — sama dengan /api/ai/analisa/setting.
// Alasan: ini preferensi PRIBADI (model mana, seberapa keras berpikir, seberapa panjang
// balasannya). Izin model TETAP milik owner: daftar yang ditawarkan di sini sudah dipotong
// `himpunanIzin(role, "teks")`, dan pemeriksaan yang MENGIKAT ada di lib/ai/provider.ts
// saat model benar-benar dipanggil — jadi body permintaan yang dibuat tangan tidak bisa
// meloloskan model terlarang, sekalipun UI dilewati.
import { getDb, getEnvAi } from "@/lib/d1/db";
import { ambilSettingEditor, simpanSettingEditor, type EditorSetting } from "@/lib/d1/aiEditorSetting";
import { daftarModel, type ModelAi } from "@/lib/d1/aiModel";
import { himpunanIzin, kunciIzin } from "@/lib/d1/aiIzinModel";
import { ambilPengaturanAI } from "@/lib/d1/pengaturan";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/** Daftar reasoning sah untuk (provider, model_id). SELECT * + akses defensif kolom 0022. */
async function pilihanReasoning(db: D1Database, provider: string, modelId: string): Promise<string[]> {
  if (!provider || !modelId) return [];
  const baris = await db
    .prepare("SELECT * FROM ai_model WHERE provider = ? AND model_id = ? LIMIT 1")
    .bind(provider, modelId)
    .first<Record<string, unknown>>();
  const csv = teks(baris?.reasoning_pilihan);
  const dariCsv = csv ? csv.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (dariCsv.length > 0) return dariCsv;
  // Skema 'bool' tidak menyimpan daftar nilai di DB (cuma hidup/mati) — turunkan di sini.
  const skema = teks(baris?.reasoning_skema);
  if (skema === "bool") return ["on", "off"];
  if (skema === "level_4" || skema === "effort_openai") return ["minimal", "low", "medium", "high"];
  if (skema === "level_3") return ["low", "medium", "high"];
  return [];
}

/**
 * Model TEKS yang boleh dipakai role ini — sumber dropdown di panel editor.
 *
 * Editor menghasilkan skrip canvas-op, yaitu tugas teks/reasoning, jadi ia memakai
 * allowlist `teks` per role (`ai_model_izin`) — TANPA jenis baru di tabel itu (CHECK-nya
 * hanya 'teks'|'vision'|'gambar'; jenis baru menuntut rebuild tabel untuk konsep yang
 * memang bukan jenis model baru).
 *
 * Hanya model AKTIF: menawarkan model yang dimatikan di katalog sama dengan menawarkan
 * kegagalan yang sudah diketahui. `dibatasi` dipakai UI untuk membedakan "katalog kosong"
 * dari "role ini belum diizinkan apa pun" — dua keadaan itu butuh pesan berbeda.
 *
 * Setiap baris membawa `kunci` (= bentuk yang DISIMPAN di `ai_editor_setting.model_editor`).
 * Kuncinya dibuat di server supaya pemisah provider↔model hanya hidup di satu berkas
 * (lib/d1/aiIzinModel.ts) dan klien cukup mengirim balik apa yang ia terima.
 */
async function modelTeksBoleh(
  db: D1Database,
  role: string
): Promise<{ model: (ModelAi & { kunci: string })[]; dibatasi: boolean }> {
  const izin = await himpunanIzin(db, role, "teks");
  const katalog = (await daftarModel(db, undefined, "teks")).filter((m) => m.aktif === 1);
  const boleh = izin === null ? katalog : katalog.filter((m) => izin.has(kunciIzin(m.provider, m.model_id)));
  return { model: boleh.map((m) => ({ ...m, kunci: kunciIzin(m.provider, m.model_id) })), dibatasi: izin !== null };
}

/**
 * Provider + model teks yang SEDANG dipakai, dari pengaturan GLOBAL.
 * Urutannya harus sama dengan yang dipakai lib/ai/provider.ts (`modelTeks[provider]`,
 * lalu model teks aktif pertama) supaya daftar reasoning yang ditampilkan cocok
 * dengan model yang benar-benar dipanggil.
 */
async function modelTeksGlobal(db: D1Database): Promise<{ provider: string; model_id: string }> {
  const set = await ambilPengaturanAI(db, getEnvAi());
  const provider = set.textProvider || set.chainTeks[0] || "";
  if (!provider) return { provider: "", model_id: "" };
  const dipilih = teks(set.modelTeks[provider]);
  if (dipilih) return { provider, model_id: dipilih };
  const aktif = await db
    .prepare("SELECT model_id FROM ai_model WHERE provider = ? AND jenis = 'teks' AND aktif = 1 ORDER BY id LIMIT 1")
    .bind(provider)
    .first<{ model_id: string }>();
  return { provider, model_id: teks(aktif?.model_id) };
}

/** Model + daftar yang boleh dipakai role ini — dipakai GET dan POST supaya bentuk balasannya sama. */
async function balasanSetting(db: D1Database, role: string, setting: EditorSetting) {
  const global = await modelTeksGlobal(db);
  const boleh = await modelTeksBoleh(db, role);
  return json({
    ok: true,
    setting,
    model: global,
    boleh: boleh.model,
    dibatasi: boleh.dibatasi,
    reasoning_pilihan: await pilihanReasoning(db, global.provider, global.model_id),
  });
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (sesi.user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
  const db = getDb();
  return balasanSetting(db, sesi.user.role, await ambilSettingEditor(db, sesi.user.tg_id));
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (sesi.user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const db = getDb();
  const model = await modelTeksGlobal(db);
  const pilihan = await pilihanReasoning(db, model.provider, model.model_id);
  const reasoning = teks(body.reasoning);

  if (reasoning) {
    if (pilihan.length === 0) {
      return json({ ok: false, error: "Model teks ini tidak punya pengaturan reasoning." }, 400);
    }
    if (!pilihan.includes(reasoning)) {
      return json({ ok: false, error: `Nilai reasoning tidak sah untuk model ini. Pilihan: ${pilihan.join(", ")}.` }, 400);
    }
  }

  // Model pilihan user: '' = ikut model teks global (boleh kapan saja). Selain itu harus
  // SALAH SATU dari yang diizinkan owner untuk role ini — diperiksa di sini juga supaya
  // user mendapat pesan jelas, sedangkan penegakan yang mengikat tetap di provider.ts
  // (izin yang dicabut SETELAH baris ini tersimpan tetap berlaku saat model dipanggil).
  const modelEditor = teks(body.model_editor);
  if (modelEditor) {
    const boleh = await modelTeksBoleh(db, sesi.user.role);
    if (boleh.model.length === 0) {
      return json(
        { ok: false, error: "Belum ada model teks yang diizinkan owner untuk role Anda, jadi model editor belum bisa dipilih." },
        403
      );
    }
    if (!boleh.model.some((m) => m.kunci === modelEditor)) {
      return json({ ok: false, error: "Model itu tidak diizinkan owner untuk role Anda." }, 403);
    }
  }

  const h = await simpanSettingEditor(db, sesi.user.tg_id, {
    model_editor: modelEditor,
    reasoning,
    maks_token: body.maks_token,
  });
  if (!h.ok) return json({ ok: false, error: h.error }, h.status);
  return balasanSetting(db, sesi.user.role, h.setting);
}
