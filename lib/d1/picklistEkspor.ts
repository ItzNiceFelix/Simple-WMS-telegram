// lib/d1/picklistEkspor.ts — Catat picklist yang benar-benar dicetak, per pesanan PER MODE.
//
// KENAPA dipisah dari stokOnline.ts: potong stok itu aksi bisnis yang bisa gagal (stok kurang)
// dan hanya terjadi sekali per order; pencatatan ekspor tidak pernah mengubah apa pun selain
// menambah jejak, dan justru HARUS terjadi berkali-kali (cetak ulang itu normal). Menumpang
// fungsi potong akan mengikat nasib pencatatan pada syarat "belum dipotong" — cetak ulang
// justru yang paling perlu tercatat.
//
// Mode = cara mencetak, bukan jenis pesanan. Karena itu kuncinya (marketplace, no_pesanan, mode):
// satu pesanan bisa punya sampai 4 baris, dan itulah yang dibaca halaman order.
import { sekarang } from "./hasil";

/** Mode cetak yang sah — harus sama dengan CHECK di migrations/0032_picklist_ekspor.sql. */
export const MODE_EKSPOR = ["per_paket", "pisah", "gabung", "gabung-order"] as const;
export type ModeEkspor = (typeof MODE_EKSPOR)[number];

/** Batas parameter/batch D1; sama dengan pola di stokOnline.ts. */
const UKURAN_BATCH = 50;

/**
 * Catat bahwa picklist untuk `targets` sudah dicetak dengan `mode`.
 *
 * UPSERT: cetak ulang menaikkan `jumlah_cetak` dan memperbarui `at`/`oleh`, TIDAK menambah
 * baris — halaman order hanya butuh "mode apa saja yang sudah", bukan riwayat tiap klik.
 *
 * Dipanggil HANYA setelah PDF benar-benar terbentuk. Mode tak dikenal ditolak keras: menulis
 * mode sembarangan akan membuat tag yang tidak bisa dipetakan balik ke pilihan di UI.
 */
export async function catatEksporPicklist(
  db: D1Database,
  targets: { mp: string; no: string }[],
  mode: string,
  oleh: string | null
): Promise<void> {
  if (!(MODE_EKSPOR as readonly string[]).includes(mode))
    throw new Error(`Mode picklist tidak sah: ${mode}`);
  // Buang duplikat: dua target identik dalam satu cetakan tetap satu baris (kalau tidak,
  // jumlah_cetak naik dua kali untuk satu lembar yang sama).
  const unik = [...new Map(targets.filter((t) => t.mp && t.no).map((t) => [`${t.mp}|${t.no}`, t])).values()];
  if (unik.length === 0) return;

  const at = sekarang();
  const statements = unik.map((t) =>
    db
      .prepare(
        `INSERT INTO picklist_ekspor (marketplace, no_pesanan, mode, at, oleh, jumlah_cetak)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(marketplace, no_pesanan, mode)
         DO UPDATE SET at = excluded.at, oleh = excluded.oleh, jumlah_cetak = picklist_ekspor.jumlah_cetak + 1`
      )
      .bind(t.mp, t.no, mode, at, oleh)
  );
  // Batch D1 dibatasi; pecah supaya picklist ratusan baris tidak gagal di tengah jalan.
  for (let i = 0; i < statements.length; i += UKURAN_BATCH)
    await db.batch(statements.slice(i, i + UKURAN_BATCH));
}

/**
 * Mode yang sudah pernah dicetak per pesanan, berkunci `mp|no`.
 *
 * Satu kueri per 50 pasangan (bukan satu per pesanan) supaya halaman order tetap satu
 * gelombang kueri walau menampilkan ratusan baris.
 */
export async function petaEkspor(
  db: D1Database,
  targets: { mp: string; no: string }[]
): Promise<Map<string, string[]>> {
  const unik = [...new Map(targets.filter((t) => t.mp && t.no).map((t) => [`${t.mp}|${t.no}`, t])).values()];
  const peta = new Map<string, string[]>();
  for (let i = 0; i < unik.length; i += UKURAN_BATCH) {
    const potong = unik.slice(i, i + UKURAN_BATCH);
    const pasangan = potong.map(() => "(marketplace = ? AND no_pesanan = ?)").join(" OR ");
    const { results } = await db
      .prepare(`SELECT marketplace, no_pesanan, mode FROM picklist_ekspor WHERE ${pasangan}`)
      .bind(...potong.flatMap((t) => [t.mp, t.no]))
      .all<{ marketplace: string; no_pesanan: string; mode: string }>();
    for (const r of results) {
      const k = `${r.marketplace}|${r.no_pesanan}`;
      const daftar = peta.get(k);
      if (daftar) daftar.push(r.mode);
      else peta.set(k, [r.mode]);
    }
  }
  return peta;
}
