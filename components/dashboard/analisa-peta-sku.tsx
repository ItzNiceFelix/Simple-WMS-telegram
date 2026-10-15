"use client";

// components/dashboard/analisa-peta-sku.tsx — Tool tanya SKU: DUA KARTU (permintaan user).
//
// Kartu ATAS = pertanyaan (dari AI/sistem), kartu BAWAH = kolom jawaban.
// Bentuk ini dipilih supaya bisa dijawab SEKALIGUS (batch) dan bisa ditinggal: jawaban
// yang sudah valid tersimpan, sisanya menunggu sesi berikutnya. Popup satu-per-satu
// memaksa menyelesaikan semuanya dalam sekali duduk.
//
// Kenapa perlu bertanya sama sekali: file Shopee kadang tidak memuat SKU kita — hanya
// nama produk Shopee. Menebak lewat kemiripan nama berbahaya (79 pasangan SKU kembar
// terbukti di master, mis. 1203 "Alas Setrika" vs 001203 "Pampers Cilukba"). Jadi
// manusia yang memutuskan, sekali per produk.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CircleHelp, FileSpreadsheet, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";

/** Satu pertanyaan dari server. `kandidat_json` sudah di-parse jadi array. */
export type PertanyaanPeta = {
  jenis: "tanpa_sku" | "sku_tak_ada_master";
  acuan: string;
  nama_shopee: string;
  pesanan: number;
  omzet: number;
  kandidat_json: { sku: string; nama: string | null; skor: number }[];
  diputuskanSku: string | null;
};

type RingkasImpor = {
  kodeProdukTotal: number;
  terpetakan: number;
  pesananTotal: number;
  pesananTerpetakan: number;
  omzetTotal: number;
  omzetTerpetakan: number;
};

/** Berapa baris yang ditampilkan sekaligus — kartu harus tetap bisa dibaca. */
const MAKS_TAMPIL = 50;

export function AnalisaPetaSku({ presetId }: { presetId: number }) {
  const [pertanyaan, setPertanyaan] = useState<PertanyaanPeta[]>([]);
  const [jawaban, setJawaban] = useState<Record<string, string>>({});
  const [memuat, setMemuat] = useState(true);
  const [sibuk, setSibuk] = useState(false);
  const [ringkas, setRingkas] = useState<RingkasImpor | null>(null);
  const berkasRef = useRef<HTMLInputElement>(null);

  const muat = useCallback(async () => {
    setMemuat(true);
    try {
      const res = await fetch("/api/analisa/peta", { credentials: "include" });
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean; pertanyaan?: PertanyaanPeta[]; error?: string;
      } | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat (${res.status}).`);
      setPertanyaan(d.pertanyaan ?? []);
      setJawaban({});
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat daftar pertanyaan.");
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  /** Kunci unik satu pertanyaan: jenis + acuan (kode produk). */
  const kunci = (p: PertanyaanPeta) => `${p.jenis}|${p.acuan}`;

  async function unggah(berkas: File) {
    if (sibuk) return;
    setSibuk(true);
    try {
      // Kirim sebagai base64: route memakai JSON, sama seperti importer lain di repo ini.
      const base64 = await new Promise<string>((selesai, gagal) => {
        const r = new FileReader();
        r.onload = () => selesai(String(r.result ?? ""));
        r.onerror = () => gagal(new Error("Gagal membaca berkas."));
        r.readAsDataURL(berkas);
      });
      const res = await fetch("/api/analisa/peta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi: "impor-performa", file: base64, presetId }),
      });
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean; ringkas?: RingkasImpor; jumlahPertanyaan?: number; error?: string;
      } | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal mengimpor (${res.status}).`);
      setRingkas(d.ringkas ?? null);
      const r = d.ringkas;
      if (r) {
        const persen = r.pesananTotal > 0 ? Math.round((r.pesananTerpetakan / r.pesananTotal) * 1000) / 10 : 0;
        toast.success(
          `Performa diimpor: ${r.terpetakan}/${r.kodeProdukTotal} produk terpetakan ` +
            `(${persen}% pesanan). ${d.jumlahPertanyaan ?? 0} perlu keputusan.`
        );
      }
      await muat();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal mengimpor berkas.");
    } finally {
      setSibuk(false);
      if (berkasRef.current) berkasRef.current.value = "";
    }
  }

  /**
   * Kirim jawaban ke server. `sku: ""` SAH dan disengaja: artinya "sudah diputuskan —
   * bukan produk kita" dan menyembunyikan pertanyaan itu selamanya (diputuskan_at terisi).
   * Ini beda dari "belum dijawab" (diputuskan_at IS NULL) yang tetap ditanyakan.
   */
  async function kirimJawaban(daftar: { jenis: PertanyaanPeta["jenis"]; acuan: string; sku: string }[]) {
    if (sibuk) return;
    if (daftar.length === 0) {
      toast.error("Tidak ada baris yang bisa dikirim.");
      return;
    }
    setSibuk(true);
    try {
      const res = await fetch("/api/analisa/peta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi: "jawab", jawaban: daftar }),
      });
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean; tersimpan?: number; diabaikan?: number; ditolak?: { sku: string; alasan: string }[]; error?: string;
      } | null;
      if (!res.ok || !d?.ok) {
        const rinci = d?.ditolak?.length ? ` ${d.ditolak.map((x) => `${x.sku}: ${x.alasan}`).join(" ")}` : "";
        throw new Error((d?.error ?? `Gagal menyimpan (${res.status}).`) + rinci);
      }
      const tolak = d.ditolak?.length ?? 0;
      toast.success(`${d.tersimpan ?? 0} jawaban tersimpan.${tolak > 0 ? ` ${tolak} ditolak (periksa SKU-nya).` : ""}`);
      await muat();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyimpan jawaban.");
    } finally {
      setSibuk(false);
    }
  }

  /** Simpan hanya baris YANG TERISI (perilaku lama — jangan ubah jadi menolak bila kosong). */
  async function simpan() {
    const daftar = pertanyaan
      .map((p) => ({ jenis: p.jenis, acuan: p.acuan, sku: (jawaban[kunci(p)] ?? "").trim() }))
      .filter((j) => j.sku !== "");
    if (daftar.length === 0) {
      toast.error("Belum ada SKU yang diisi. Tekan \"Abaikan yang belum diisi\" untuk menandai semuanya sudah diputuskan.");
      return;
    }
    await kirimJawaban(daftar);
  }

  /** Satu pertanyaan ditandai "sudah diputuskan — bukan produk kita" (sku: ""). */
  async function abaikan(p: PertanyaanPeta) {
    await kirimJawaban([{ jenis: p.jenis, acuan: p.acuan, sku: "" }]);
  }

  /** Tandai SEMUA baris yang input-nya kosong sebagai sudah diputuskan sekaligus. */
  async function abaikanSemuaKosong() {
    const daftar = pertanyaan
      .filter((p) => (jawaban[kunci(p)] ?? "").trim() === "")
      .map((p) => ({ jenis: p.jenis, acuan: p.acuan, sku: "" }));
    await kirimJawaban(daftar);
  }

  const tampil = pertanyaan.slice(0, MAKS_TAMPIL);
  const terisi = pertanyaan.filter((p) => (jawaban[kunci(p)] ?? "").trim() !== "").length;
  // Baris yang input-nya kosong = calon "sudah diputuskan — bukan produk kita".
  const kosong = pertanyaan.length - terisi;
  const berpesanan = pertanyaan.filter((p) => p.pesanan > 0).length;

  return (
    <div className="flex flex-col gap-4" data-testid="peta-sku">
      {/* ── Impor berkas performa ── */}
      <Card data-testid="kartu-impor-performa">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="size-4" aria-hidden />
            Peta produk Shopee → SKU
          </CardTitle>
          <CardDescription>
            Unggah <b>Performa Produk</b> (ekspor Shopee) sekali. Sistem membaca SKU dari kolom
            variasi, lalu hanya menanyakan produk yang benar-benar tidak ketemu. Jawaban disimpan
            permanen — unggahan berikutnya tidak menanyakan hal yang sama lagi.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <input
            ref={berkasRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            data-testid="berkas-performa"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void unggah(f);
            }}
          />
          <Button
            className="h-11 md:h-8"
            disabled={sibuk}
            onClick={() => berkasRef.current?.click()}
            data-testid="tombol-pilih-performa"
          >
            {sibuk ? <Spinner data-icon="inline-start" /> : <FileSpreadsheet className="size-4" aria-hidden />}
            {sibuk ? "Memproses…" : "Pilih berkas Performa"}
          </Button>
          {ringkas ? (
            <p className="text-xs text-muted-foreground" data-testid="ringkas-impor">
              {ringkas.terpetakan}/{ringkas.kodeProdukTotal} produk terpetakan ·{" "}
              {Math.round((ringkas.pesananTerpetakan / Math.max(ringkas.pesananTotal, 1)) * 1000) / 10}% pesanan ·{" "}
              {formatRupiah(ringkas.omzetTerpetakan)} dari {formatRupiah(ringkas.omzetTotal)} omzet
            </p>
          ) : null}
        </CardContent>
      </Card>

      {memuat ? (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">Memuat…</CardContent></Card>
      ) : pertanyaan.length === 0 ? (
        <Card data-testid="tanpa-pertanyaan">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Tidak ada pertanyaan yang menunggu jawaban. Semua produk Shopee sudah punya SKU.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ══ KARTU ATAS: PERTANYAAN ══ */}
          <Card data-testid="kartu-pertanyaan">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CircleHelp className="size-4 opacity-70" aria-hidden />
                <CardTitle className="text-base">Perlu keputusan ({pertanyaan.length})</CardTitle>
                {berpesanan > 0 ? <Badge variant="destructive">{berpesanan} berpesanan</Badge> : null}
              </div>
              <CardDescription>
                Produk Shopee yang belum punya SKU kita. Yang <b>berpesanan</b> ditampilkan lebih dulu —
                salah memetakan produk itu paling merugikan. Produk tanpa penjualan bisa dijawab kemudian.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[46px]">#</TableHead>
                      <TableHead>Produk Shopee</TableHead>
                      <TableHead className="text-right">Terjual</TableHead>
                      <TableHead className="text-right">Omzet</TableHead>
                      <TableHead className="w-[130px]">Sebab</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tampil.map((p, i) => (
                      <TableRow key={kunci(p)} data-testid={`pertanyaan-${p.acuan}`}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="max-w-[320px]">
                          <span className="line-clamp-2">{p.nama_shopee}</span>
                          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{p.acuan}</span>
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${p.pesanan > 0 ? "font-semibold" : "text-muted-foreground"}`}>
                          {formatAngka(p.pesanan)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(p.omzet)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {p.jenis === "tanpa_sku" ? "tanpa SKU" : "SKU tak dikenal"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {pertanyaan.length > MAKS_TAMPIL ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Menampilkan {MAKS_TAMPIL} dari {pertanyaan.length}. Jawab yang teratas dulu; sisanya muncul
                  setelah tersimpan.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* ══ KARTU BAWAH: JAWABAN ══ */}
          <Card data-testid="kartu-jawaban">
            <CardHeader>
              <CardTitle className="text-base">Jawaban</CardTitle>
              <CardDescription>
                Ketik SKU untuk tiap produk, atau tekan <b>Abaikan</b> untuk menandai produk yang memang tidak
                ada di sistem (&quot;bukan produk kita&quot;). Hanya baris yang terisi yang dikirim oleh
                <b> Simpan</b> — sisanya tetap menunggu dan bisa dijawab nanti, atau diabaikan sekaligus
                dengan <b>Abaikan yang belum diisi</b>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[46px]">#</TableHead>
                      <TableHead>Produk Shopee</TableHead>
                      <TableHead className="w-[220px]">SKU</TableHead>
                      <TableHead>Kandidat terdekat</TableHead>
                      <TableHead className="w-[110px]">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tampil.map((p, i) => {
                      const nilai = jawaban[kunci(p)] ?? "";
                      return (
                        <TableRow key={kunci(p)}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="max-w-[240px] truncate">{p.nama_shopee}</TableCell>
                          <TableCell>
                            <Input
                              value={nilai}
                              placeholder="mis. 001770"
                              disabled={sibuk}
                              onChange={(e) => setJawaban((s) => ({ ...s, [kunci(p)]: e.target.value }))}
                              data-testid={`jawab-${p.acuan}`}
                              autoComplete="off"
                            />
                          </TableCell>
                          <TableCell>
                            {p.kandidat_json.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {p.kandidat_json.map((k) => (
                                  <button
                                    key={k.sku}
                                    type="button"
                                    disabled={sibuk}
                                    className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-muted"
                                    onClick={() => setJawaban((s) => ({ ...s, [kunci(p)]: k.sku }))}
                                    title={k.nama ?? k.sku}
                                  >
                                    {k.sku}
                                  </button>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-11 text-xs md:h-8"
                              disabled={sibuk}
                              onClick={() => void abaikan(p)}
                              data-testid={`abaikan-${p.acuan}`}
                              title="Tandai sudah diputuskan — tidak akan ditanya lagi"
                            >
                              Abaikan
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  className="h-11 md:h-8"
                  disabled={sibuk || terisi === 0}
                  onClick={() => void simpan()}
                  data-testid="simpan-jawaban"
                >
                  {sibuk ? <Spinner data-icon="inline-start" /> : <Save className="size-4" aria-hidden />}
                  {sibuk ? "Menyimpan…" : `Simpan ${terisi} jawaban`}
                </Button>
                <Button
                  variant="outline"
                  className="h-11 md:h-8"
                  disabled={sibuk || kosong === 0}
                  onClick={() => void abaikanSemuaKosong()}
                  data-testid="abaikan-semua-kosong"
                  title="Tandai semua baris yang kosong sudah diputuskan — tidak akan ditanya lagi"
                >
                  Abaikan yang belum diisi ({kosong})
                </Button>
                <span className="text-xs text-muted-foreground">
                  {terisi} dari {tampil.length} baris terisi
                </span>
              </div>

              <p className="text-[11px] text-muted-foreground">
                <b>Simpan</b> hanya mengirim baris YANG TERISI. Baris yang dikosongkan akan tetap ditanyakan
                lain kali sampai kamu menekan <b>Abaikan</b> — menekan itu berarti &quot;sudah diputuskan,
                bukan produk kita&quot; dan menghilangkannya dari daftar selamanya.
              </p>

              <p className="text-[11px] text-muted-foreground">
                SKU yang tidak ada di master produk akan ditolak saat disimpan — lebih baik ditolak daripada
                terlanjur menunjuk produk yang salah. Baris yang belum dijawab tidak ikut dihitung di analisa.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
