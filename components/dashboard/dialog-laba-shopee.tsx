"use client";

// components/dashboard/dialog-laba-shopee.tsx — Upload export shipping Shopee → hitung estimasi → simpan.
// Alur: pilih file → baca sheet "orders" di klien (xlsx) → POST /api/laba hitung → preview agregat + tolak → simpan.
// Standalone: tak sentuh stok, tak pakai import_batches.
import { useState } from "react";
import { toast } from "sonner";

// SheetJS 312 KB dimuat saat file benar-benar dibaca, bukan saat halaman laba dibuka.
async function bacaExcel(buf: ArrayBuffer) {
  const XLSX = await import("xlsx");
  return { wb: XLSX.read(buf, { type: "array" }), toJson: XLSX.utils.sheet_to_json };
}

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { formatRupiah } from "@/lib/dashboard/format";

type Tolak = { no_pesanan: string; alasan: string };
type KlasContoh = { no_pesanan: string; status: string; tanggal_lama: string | null };
type Klasifikasi = { baru: number; sama: number; berubah: number; contoh: KlasContoh[] };
type Agregat = {
  jml_order: number;
  jml_baris: number;
  omzet: number;
  hpp: number;
  biaya: number;
  laba: number;
  tolak: Tolak[];
  peringatan?: string[];
  jml_baris_belum_terpetakan?: number;
  sku_belum_terpetakan?: string[];
  estimasi_kasar?: boolean;
};
/** Satu tanggal hasil potongan berkas (server memotong per `Waktu Pesanan Dibuat`). */
type PotonganTanggal = { tanggal: string; jml_order: number; omzet: number; laba: number; parsial: boolean };
type HasilHitung = {
  ok: true; agregat: Agregat; klasifikasi?: Klasifikasi;
  tanggal: PotonganTanggal[]; tanggalPenuh: string[]; tanggalParsial: string[]; tanpaTanggal: number;
};
function isAgregatOk(v: unknown): v is HasilHitung {
  return (
    !!v &&
    typeof v === "object" &&
    "ok" in v &&
    v.ok === true &&
    "agregat" in v &&
    !!v.agregat &&
    typeof v.agregat === "object" &&
    Array.isArray((v as { tanggal?: unknown }).tanggal)
  );
};

export function DialogLabaShopee({
  open,
  onOpenChange,
  onSukses,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSukses?: () => void;
  preset: { id: number; nama: string; status_toko: string };
}) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [agregat, setAgregat] = useState<Agregat | null>(null);
  const [klas, setKlas] = useState<Klasifikasi | null>(null);
  const [timpa, setTimpa] = useState(false);
  const [mengirim, setMengirim] = useState(false);
  /** Hasil potongan per tanggal dari server — tanggal TIDAK diketik user lagi. */
  const [potongan, setPotongan] = useState<PotonganTanggal[]>([]);
  const [tanpaTanggal, setTanpaTanggal] = useState(0);

  function tutup(v: boolean) {
    if (mengirim) return;
    if (!v) {
      setFile(null);
      setRows(null);
      setAgregat(null);
      setKlas(null);
      setTimpa(false);
      setPotongan([]);
      setTanpaTanggal(0);
    }
    onOpenChange(v);
  }

  async function bacaFile(f: File): Promise<Record<string, unknown>[] | null> {
    const buf = await f.arrayBuffer();
    const { wb, toJson } = await bacaExcel(buf);
    const nama = wb.SheetNames.includes("orders") ? "orders" : wb.SheetNames[0];
    const ws = nama ? wb.Sheets[nama] : undefined;
    if (!nama || !ws) {
      tampilkanGagalTulis('Sheet "orders" tidak ditemukan di file ini.');
      return null;
    }
    const data = toJson<Record<string, unknown>>(ws, { defval: "" });
    if (data.length === 0) {
      tampilkanGagalTulis(`Sheet ${nama} kosong.`);
      return null;
    }
    return data;
  }

  async function hitung() {
    if (!file) return;
    setMengirim(true);
    try {
      const data = await bacaFile(file);
      if (!data) return;
      setRows(data);
      const res = await fetch("/api/laba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "hitung", presetId: preset.id, rows: data, file: file.name }),
        credentials: "include",
      });
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok || !isAgregatOk(raw)) {
        tampilkanGagalTulis(
          raw && typeof raw === "object" && "error" in raw && typeof raw.error === "string"
            ? raw.error
            : `Gagal (${res.status}).`
        );
        return;
      }
      setAgregat(raw.agregat);
      setKlas(raw.klasifikasi ?? null);
      setPotongan(raw.tanggal);
      setTanpaTanggal(raw.tanpaTanggal);
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.");
    } finally {
      setMengirim(false);
    }
  }

  async function simpan() {
    if (!rows || !agregat) return;
    const sdh = klas ? klas.sama + klas.berubah : 0;
    const daftar = potongan.map((p) => p.tanggal).join(", ");
    // Konfirmasi WAJIB menyebut tanggal yang akan ditimpa: berkas 7 hari menjadi 7 snapshot,
    // dan mode timpa menghapus order lama pada HANYA tanggal yang tercakup berkas ini.
    const pesan = timpa
      ? `Simpan ${potongan.length} tanggal (${daftar}) ke preset "${preset.nama}" + TIMPA ${sdh} order lama pada tanggal itu?`
      : `Simpan ${potongan.length} tanggal (${daftar}) ke preset "${preset.nama}"? (${klas?.baru ?? agregat.jml_order} baru, ${sdh} sudah tersimpan dilewati)`;
    if (!window.confirm(pesan)) return;
    setMengirim(true);
    try {
      const res = await fetch("/api/laba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "simpan", presetId: preset.id, rows, file: file?.name ?? "", mode: timpa ? "timpa_semua" : "tambah_baru" }),
        credentials: "include",
      });
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok || !isAgregatOk(raw)) {
        tampilkanGagalTulis(
          raw && typeof raw === "object" && "error" in raw && typeof raw.error === "string"
            ? raw.error
            : `Gagal (${res.status}).`
        );
        return;
      }
      // Jumlah tanggal, bukan satu tanggal: satu berkas bisa menjadi banyak snapshot.
      toast.success(`Perhitungan tersimpan untuk ${raw.tanggal.length} tanggal.`);
      // Riwayat impor dicatat di sini, bukan di route: route /api/laba melayani hitung DAN
      // simpan, dan hanya "simpan" yang layak muncul di halaman Sinkronisasi.
      //
      // `baris` = ORDER yang benar-benar tersimpan, bukan jumlah tanggal. Dulu `raw.tanggal.length`
      // dipakai, sehingga berkas 7 hari berisi 1.500 order dilaporkan sebagai "7 baris" — angka
      // yang tidak bisa dicocokkan dengan apa pun di layar lain.
      // `gagal` = baris tanpa tanggal yang dibuang saat potong; dulu hardcode 0 sehingga
      // pembuangan itu tidak pernah terlihat.
      // Di-`await` sebelum `onSukses()`: kalau tidak, pemuatan ulang riwayat di halaman
      // Sinkronisasi berbalapan dengan POST ini dan impor barusan bisa tidak muncul.
      try {
        const resLog = await fetch("/api/sinkronisasi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            presetId: preset.id,
            jenis: "laba",
            file: file?.name ?? "",
            baris: raw.agregat?.jml_order ?? 0,
            gagal: raw.tanpaTanggal,
            ringkas:
              `${raw.tanggalPenuh.length} penuh, ${raw.tanggalParsial.length} sebagian` +
              `${raw.tanpaTanggal > 0 ? `, ${raw.tanpaTanggal} baris tanpa tanggal` : ""}`,
          }),
        });
        if (!resLog.ok) {
          tampilkanGagalTulis(`Riwayat impor gagal dicatat (HTTP ${resLog.status}). Perhitungan tetap tersimpan.`);
        }
      } catch {
        tampilkanGagalTulis("Riwayat impor gagal dicatat (jaringan). Perhitungan tetap tersimpan.");
      }
      tutup(false);
      onSukses?.();
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.");
    } finally {
      setMengirim(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hitung Laba — {preset.nama}</DialogTitle>
          <DialogDescription>
            Upload file export Order.all Shopee (.xlsx, sheet &quot;orders&quot;) untuk preset &quot;{preset.nama}&quot; → sistem memotong berkas per tanggal pesanan (WIB) → periksa daftar tanggalnya → Simpan Perhitungan. Tanggal tidak diketik manual: itulah yang membuat snapshot lama tumpang-tindih. Patokan = dasar resmi (Harga Awal − diskon/voucher penjual).
          </DialogDescription>
        </DialogHeader>
        {!agregat ? (
          <div className="flex flex-col gap-3">
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="file-laba-shopee"
            />
            {file && (
              <p className="text-sm text-muted-foreground">
                {file.name} ({Math.round(file.size / 1024)} KB)
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3" data-testid="preview-laba-shopee">
            {/* Daftar tanggal hasil potongan: inilah snapshot yang akan ditulis. Hari bertanda
                "parsial" tetap disimpan (angkanya benar untuk order yang ada) tetapi tidak
                dipakai grafik tren/delta — harinya tidak utuh di berkas ini. */}
            <div className="rounded-lg border border-border p-2 text-sm" data-testid="potongan-tanggal-laba">
              <p className="text-xs text-muted-foreground">
                Akan ditulis {potongan.length} snapshot harian
                {tanpaTanggal > 0 ? ` · ${tanpaTanggal} baris tanpa tanggal dilewati` : ""}
              </p>
              <div className="mt-1 max-h-40 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left font-normal">Tanggal</th><th className="text-right font-normal">Order</th><th className="text-right font-normal">Omzet</th><th className="text-right font-normal">Laba</th><th className="text-right font-normal">Cakupan</th></tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {potongan.map((p) => (
                      <tr key={p.tanggal}>
                        <td>{p.tanggal}</td>
                        <td className="text-right">{p.jml_order}</td>
                        <td className="text-right">{formatRupiah(p.omzet)}</td>
                        <td className="text-right">{formatRupiah(p.laba)}</td>
                        <td className="text-right">{p.parsial ? "sebagian" : "penuh"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">Order</dt>
                <dd className="font-semibold tabular-nums">{agregat.jml_order}</dd>
              </div>
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">Baris</dt>
                <dd className="font-semibold tabular-nums">{agregat.jml_baris}</dd>
              </div>
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">Omzet</dt>
                <dd className="font-semibold tabular-nums">{formatRupiah(agregat.omzet)}</dd>
              </div>
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">HPP</dt>
                <dd className="font-semibold tabular-nums">{formatRupiah(agregat.hpp)}</dd>
              </div>
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">Biaya</dt>
                <dd className="font-semibold tabular-nums">{formatRupiah(agregat.biaya)}</dd>
              </div>
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">Estimasi Laba</dt>
                <dd className="font-semibold tabular-nums">{formatRupiah(agregat.laba)}</dd>
              </div>
            </dl>
            {klas ? (
              <div className="rounded-lg border border-border p-3 text-sm" data-testid="klas-laba-shopee">
                <p className="font-medium">Cek dobel No. Pesanan</p>
                <p className="text-muted-foreground">
                  {klas.baru} baru · {klas.sama} sudah sama · {klas.berubah} berubah
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Default simpan hanya No baru (tambah_baru). Centang timpa untuk tulis ulang No lama.
                </p>
                {klas.contoh.length > 0 ? (
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-lg bg-muted p-2 text-xs">
                    {klas.contoh.slice(0, 20).map((k) => (
                      <li key={k.no_pesanan}>
                        {k.no_pesanan}: {k.status}
                        {k.tanggal_lama ? ` (tersimpan ${k.tanggal_lama})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {agregat.estimasi_kasar ? (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="estimasi-kasar-laba">
                <p className="font-medium">Estimasi kasar</p>
                <p className="text-muted-foreground">
                  Ada aturan admin belum terverifikasi yang terpakai — laba bisa berbeda dari tarif resmi Shopee.
                </p>
              </div>
            ) : null}
            {(agregat.jml_baris_belum_terpetakan ?? 0) > 0 ? (
              <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm" data-testid="belum-terpetakan-laba">
                <p className="font-medium">
                  Simpan diblokir: {agregat.jml_baris_belum_terpetakan} baris SKU belum punya kategori tarif
                </p>
                <p className="text-muted-foreground">
                  Contoh: {(agregat.sku_belum_terpetakan ?? []).slice(0, 10).join(", ")}. Lengkapi kategori produk di master stok.
                </p>
              </div>
            ) : null}
            {(agregat.peringatan?.length ?? 0) > 0 ? (
              <div className="rounded-lg border border-border p-3" data-testid="peringatan-laba-shopee">
                <p className="text-sm font-medium">Peringatan akurasi ({agregat.peringatan?.length})</p>
                <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-muted p-2 text-xs">
                  {agregat.peringatan?.slice(0, 50).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agregat.tolak.length > 0 && (
              <div data-testid="tolak-laba-shopee">
                <p className="text-sm font-medium">
                  Ditolak hitung: <span className="text-red-600">{agregat.tolak.length} order</span>
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs">
                  {agregat.tolak.slice(0, 50).map((t) => (
                    <li key={t.no_pesanan}>
                      {t.no_pesanan}: {t.alasan}
                    </li>
                  ))}
                  {agregat.tolak.length > 50 && <li>… +{agregat.tolak.length - 50} lagi</li>}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {!agregat ? (
            <Button onClick={() => void hitung()} disabled={!file || mengirim} data-testid="hitung-laba-shopee">
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Menghitung…" : "Hitung"}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setRows(null);
                  setAgregat(null);
                  setKlas(null);
                  setTimpa(false);
                }}
                disabled={mengirim}
              >
                Ganti file
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={timpa}
                  onChange={(e) => setTimpa(e.target.checked)}
                  disabled={mengirim}
                  data-testid="timpa-laba-shopee"
                />
                Timpa order lama
              </label>
              <Button onClick={() => void simpan()} disabled={mengirim || potongan.length === 0} data-testid="simpan-laba-shopee">
                {mengirim ? <Spinner data-icon="inline-start" /> : null}
                {mengirim ? "Menyimpan…" : "Simpan Perhitungan"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
