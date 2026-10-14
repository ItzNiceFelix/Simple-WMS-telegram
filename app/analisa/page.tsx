"use client";

// app/analisa/page.tsx — Analisa Produk (pengganti halaman Kata Kunci yang dihapus).
//
// Prinsip halaman ini: ANGKA SELALU DARI SERVER, tidak pernah dihitung di klien.
// Server memakai lib/analisa/hitung.ts yang sudah diuji, sehingga angka yang terlihat
// di sini bisa diaudit. Halaman hanya menampilkan.
//
// Analisa cepat langsung tampil tanpa tombol dan tanpa AI — angka benar harus selalu
// bisa didapat tanpa menunggu model dan tanpa biaya token.
import { useCallback, useEffect, useState } from "react";
import { ChartNoAxesCombined, Info, Megaphone, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";

// ── Bentuk data dari server (app/api/analisa) ──
type Temuan = {
  kode: string;
  keparahan: "kritis" | "peringatan" | "catatan";
  judul: string;
  penjelasan: string;
  angka: { nilai: number; satuan: "rupiah" | "jumlah" | "persen" | "rasio"; jumlahTerkena: number; dariTotal?: number };
  contohSku: { sku: string; nama: string | null; nilai: number }[];
  dataKurang?: string[];
};

type BarisSku = {
  sku: string;
  nama: string | null;
  unit: number;
  hppSatuan: number;
  hargaJual: number;
  marginSatuan: number;
  marginPersen: number;
  kontribusi: number;
  roasImpas: number | null;
  hppMaster: number | null;
  hppNaik: number;
  stok: number | null;
};

type Ringkasan = {
  periode: string; presetId: number; jmlSku: number; jmlOrder: number;
  omzet: number; hpp: number; biaya: number; pajak: number; laba: number;
  marginPersen: number; marginSatuanRata: number; marginPersenMedian: number;
  kontribusi10Teratas: number; persen10Teratas: number;
};

type Hasil = {
  ok: boolean;
  error?: string;
  ringkasan: Ringkasan;
  temuan: Temuan[];
  baris: BarisSku[];
  kurang: string[];
  jmlSnapshot: number;
  tanggalTersedia: string[];
  ambangMarginTipis: number;
};

type SaranIklan = {
  ok: boolean;
  error?: string;
  aman: BarisSku[];
  jangan: BarisSku[];
  jumlahAman: number;
  jumlahJangan: number;
  adaBiayaIklan: boolean;
  keterbatasan: string;
};

type Preset = { id: number; nama: string };

/** Warna per tingkat keparahan. Dipakai untuk garis tepi kartu temuan. */
const GAYA_KEPARAHAN: Record<Temuan["keparahan"], { tepi: string; label: string; variasi: "destructive" | "secondary" | "outline" }> = {
  kritis: { tepi: "border-l-4 border-l-red-500", label: "Perlu tindakan segera", variasi: "destructive" },
  peringatan: { tepi: "border-l-4 border-l-amber-500", label: "Perlu diperhatikan", variasi: "secondary" },
  catatan: { tepi: "border-l-4 border-l-sky-500", label: "Catatan", variasi: "outline" },
};

/** Format angka temuan sesuai satuannya. */
function angkaTemuan(t: Temuan): string {
  if (t.angka.satuan === "rupiah") return formatRupiah(Math.abs(t.angka.nilai));
  if (t.angka.satuan === "persen") return `${t.angka.nilai}%`;
  if (t.angka.satuan === "rasio") return `${t.angka.nilai}×`;
  return formatAngka(t.angka.nilai);
}

export default function HalamanAnalisa() {
  return (
    <ButuhAkses href="/analisa">
      <Analisa />
    </ButuhAkses>
  );
}

function Analisa() {
  const [preset, setPreset] = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState<number>(0);
  const [tanggal, setTanggal] = useState<string>("");
  const [tanggalAda, setTanggalAda] = useState<string[]>([]);
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const [iklan, setIklan] = useState<SaranIklan | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [memuatIklan, setMemuatIklan] = useState(false);

  // Muat daftar preset + tanggal snapshot yang tersedia.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/analisa?aksi=preset", { credentials: "include" });
        const d = (await res.json().catch(() => null)) as { ok?: boolean; preset?: Preset[]; tanggal?: string[]; error?: string } | null;
        if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat (${res.status}).`);
        const p = d.preset ?? [];
        setPreset(p);
        setTanggalAda(d.tanggal ?? []);
        if (p.length > 0 && p[0].id > 0) {
          setPresetId(p[0].id);
          setTanggal((d.tanggal ?? [])[0] ?? "");
        }
      } catch (e) {
        tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat daftar preset.");
        setMemuat(false);
      }
    })();
  }, []);

  const muatAnalisa = useCallback(async (pid: number, tgl: string) => {
    if (!pid || !tgl) return;
    setMemuat(true);
    setIklan(null);
    try {
      const res = await fetch(`/api/analisa?aksi=cepat&presetId=${pid}&tanggal=${tgl}`, { credentials: "include" });
      const d = (await res.json().catch(() => null)) as Hasil | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat analisa (${res.status}).`);
      setHasil(d);
      setTanggalAda(d.tanggalTersedia ?? []);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat analisa.");
      setHasil(null);
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muatAnalisa(presetId, tanggal);
  }, [presetId, tanggal, muatAnalisa]);

  // Saran iklan dimuat HANYA saat tab dibuka — tidak membebani tampilan awal.
  async function muatIklan() {
    if (iklan || memuatIklan || !presetId || !tanggal) return;
    setMemuatIklan(true);
    try {
      const res = await fetch(`/api/analisa?aksi=saran-iklan&presetId=${presetId}&tanggal=${tanggal}`, { credentials: "include" });
      const d = (await res.json().catch(() => null)) as SaranIklan | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat saran iklan (${res.status}).`);
      setIklan(d);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat saran iklan.");
    } finally {
      setMemuatIklan(false);
    }
  }

  return (
    <>
      <PageHeader
        judul="Analisa Produk"
        deskripsi="Margin, konsentrasi laba, dan saran iklan — dihitung dari data Anda sendiri."
      />

      <div className="flex flex-col gap-4" data-testid="h9-analisa">
        {/* ── Pemilih periode ── */}
        <Card data-testid="kartu-periode">
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="flex min-w-[180px] flex-col gap-1">
              <span className="text-xs text-muted-foreground">Preset toko</span>
              <Select value={String(presetId)} onValueChange={(v) => v !== null && setPresetId(Number(v))}>
                <SelectTrigger className="h-11 w-full md:h-8" data-testid="pilih-preset">
                  <SelectValue>{(v: string | null) => preset.find((p) => String(p.id) === v)?.nama ?? "Pilih preset"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {preset.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.nama}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-[170px] flex-col gap-1">
              <span className="text-xs text-muted-foreground">Tanggal data laba</span>
              <Select value={tanggal} onValueChange={(v) => v !== null && setTanggal(v)}>
                <SelectTrigger className="h-11 w-full md:h-8" data-testid="pilih-tanggal">
                  <SelectValue>{(v: string | null) => v || "Pilih tanggal"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {tanggalAda.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {tanggalAda.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                {tanggalAda.length} periode tersedia — pilih tanggal lain untuk membandingkan.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {memuat ? (
          <Skeleton className="h-64 w-full rounded-xl" data-testid="memuat-analisa" />
        ) : !hasil ? (
          <Empty data-testid="analisa-kosong">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ChartNoAxesCombined /></EmptyMedia>
              <EmptyTitle>Belum ada data untuk dianalisa</EmptyTitle>
              <EmptyDescription>
                Analisa memakai data laba yang sudah diimpor. Buka halaman Laba, unggah file pesanan
                Shopee, lalu kembali ke sini.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Tabs defaultValue="temuan">
            <TabsList>
              <TabsTrigger value="temuan" data-testid="tab-temuan">Temuan</TabsTrigger>
              <TabsTrigger value="produk" data-testid="tab-produk">Semua Produk</TabsTrigger>
              <TabsTrigger value="iklan" onClick={() => void muatIklan()} data-testid="tab-iklan">
                Saran Iklan
              </TabsTrigger>
            </TabsList>

            {/* ══ TAB TEMUAN ══ */}
            <TabsContent value="temuan" className="flex flex-col gap-4">
              {/* Ringkasan angka utama */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="ringkasan">
                <KotakAngka label="Laba" nilai={formatRupiah(hasil.ringkasan.laba)} catatan={`margin ${hasil.ringkasan.marginPersen}%`} />
                <KotakAngka label="Omzet" nilai={formatRupiah(hasil.ringkasan.omzet)} catatan={`${hasil.ringkasan.jmlOrder} pesanan`} />
                <KotakAngka label="Margin rata-rata" nilai={formatRupiah(hasil.ringkasan.marginSatuanRata)} catatan="per unit terjual" />
                <KotakAngka
                  label="10 SKU teratas"
                  nilai={`${hasil.ringkasan.persen10Teratas}%`}
                  catatan={`dari laba · ${hasil.ringkasan.jmlSku} SKU total`}
                />
              </div>

              {/* Data yang tidak ada — disebut, bukan diabaikan */}
              {hasil.kurang.length > 0 ? (
                <Alert data-testid="data-kurang">
                  <Info aria-hidden />
                  <AlertTitle>Analisa ini belum lengkap</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {hasil.kurang.map((k, i) => <li key={i}>{k}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {hasil.temuan.length === 0 ? (
                <Card data-testid="tanpa-temuan">
                  <CardContent className="pt-6 text-sm text-muted-foreground">
                    Tidak ada temuan yang perlu ditindaklanjuti pada periode ini. Semua produk bermargin sehat,
                    laba tidak bergantung pada segelintir SKU, dan HPP belum berubah.
                  </CardContent>
                </Card>
              ) : (
                hasil.temuan.map((t) => (
                  <Card key={t.kode} className={GAYA_KEPARAHAN[t.keparahan].tepi} data-testid={`temuan-${t.kode}`}>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={GAYA_KEPARAHAN[t.keparahan].variasi}>
                          {GAYA_KEPARAHAN[t.keparahan].label}
                        </Badge>
                        <CardTitle className="text-base">{t.judul}</CardTitle>
                      </div>
                      <CardDescription>{t.penjelasan}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 p-3">
                        <span className="font-heading text-xl font-semibold tabular-nums" data-testid={`angka-${t.kode}`}>
                          {angkaTemuan(t)}
                        </span>
                        {t.angka.jumlahTerkena > 0 ? (
                          <span className="text-xs text-muted-foreground">{t.angka.jumlahTerkena} SKU terkena</span>
                        ) : null}
                        {t.angka.dariTotal !== undefined && t.angka.dariTotal > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            dari {t.angka.satuan === "rupiah" ? formatRupiah(t.angka.dariTotal) : t.angka.dariTotal}
                          </span>
                        ) : null}
                      </div>

                      {t.contohSku.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[110px]">SKU</TableHead>
                              <TableHead>Produk</TableHead>
                              <TableHead className="text-right">Nilai</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {t.contohSku.map((s) => (
                              <TableRow key={s.sku}>
                                <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                                <TableCell className="max-w-[280px] truncate">{s.nama ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {t.kode === "margin_tipis" ? `${s.nilai}%` : formatRupiah(s.nilai)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : null}

                      {t.dataKurang && t.dataKurang.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Catatan: {t.dataKurang.join(" ")}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            {/* ══ TAB SEMUA PRODUK ══ */}
            <TabsContent value="produk">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Margin per produk</CardTitle>
                  <CardDescription>
                    Diurut dari kontribusi laba terbesar. ROAS impas = berapa rupiah penjualan yang
                    dibutuhkan untuk setiap Rp 1 iklan agar tidak rugi.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table data-testid="tabel-produk">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">SKU</TableHead>
                          <TableHead>Produk</TableHead>
                          <TableHead className="text-right">Terjual</TableHead>
                          <TableHead className="text-right">HPP</TableHead>
                          <TableHead className="text-right">Harga</TableHead>
                          <TableHead className="text-right">Margin</TableHead>
                          <TableHead className="text-right">%</TableHead>
                          <TableHead className="text-right">Kontribusi</TableHead>
                          <TableHead className="text-right">ROAS impas</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...hasil.baris].sort((a, b) => b.kontribusi - a.kontribusi).map((b) => {
                          const rugi = b.marginSatuan < 0;
                          const tipis = !rugi && b.marginPersen < hasil.ambangMarginTipis;
                          return (
                            <TableRow key={b.sku} className={rugi ? "bg-red-50 dark:bg-red-950/30" : undefined}>
                              <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                              <TableCell className="max-w-[240px] truncate">
                                {b.nama ?? "—"}
                                {b.hppNaik > 0 ? (
                                  <span className="ml-1 text-[10px] text-amber-700">HPP naik {formatRupiah(b.hppNaik)}</span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatAngka(b.unit)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(b.hppSatuan)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(b.hargaJual)}</TableCell>
                              <TableCell className={`text-right tabular-nums ${rugi ? "text-red-700 font-semibold" : ""}`}>
                                {formatRupiah(b.marginSatuan)}
                              </TableCell>
                              <TableCell className={`text-right tabular-nums ${tipis ? "text-amber-700" : ""}`}>
                                {b.marginPersen}%
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(b.kontribusi)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {b.roasImpas === null ? "—" : b.roasImpas}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ══ TAB SARAN IKLAN ══ */}
            <TabsContent value="iklan" className="flex flex-col gap-4">
              {memuatIklan ? (
                <Skeleton className="h-48 w-full rounded-xl" />
              ) : !iklan ? (
                <Card><CardContent className="pt-6 text-sm text-muted-foreground">Memuat saran iklan…</CardContent></Card>
              ) : (
                <>
                  {/* BATAS KERAS: keterbatasan selalu tampil, tidak boleh disembunyikan */}
                  <Alert data-testid="keterbatasan-iklan">
                    <TriangleAlert aria-hidden />
                    <AlertTitle>Baca sebelum memakai angka ini</AlertTitle>
                    <AlertDescription>{iklan.keterbatasan}</AlertDescription>
                  </Alert>

                  {!iklan.adaBiayaIklan ? (
                    <Alert data-testid="iklan-belum-diimpor">
                      <Info aria-hidden />
                      <AlertTitle>Biaya iklan belum diimpor</AlertTitle>
                      <AlertDescription>
                        Angka di bawah hanya titik impas teoretis dari biaya toko Anda. Tanpa data biaya
                        iklan yang nyata, sistem ini belum bisa menilai apakah iklan yang berjalan
                        menguntungkan atau merugi.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Megaphone className="size-4" aria-hidden />
                        Paling aman diiklankan ({iklan.jumlahAman})
                      </CardTitle>
                      <CardDescription>
                        Diurut ROAS impas terendah — makin rendah, makin kecil risiko ruginya.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table data-testid="tabel-iklan-aman">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">SKU</TableHead>
                            <TableHead>Produk</TableHead>
                            <TableHead className="text-right">Harga</TableHead>
                            <TableHead className="text-right">Margin/unit</TableHead>
                            <TableHead className="text-right">ROAS impas</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {iklan.aman.slice(0, 25).map((b) => (
                            <TableRow key={b.sku}>
                              <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                              <TableCell className="max-w-[260px] truncate">{b.nama ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(b.hargaJual)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(b.marginSatuan)}</TableCell>
                              <TableCell className="text-right font-semibold tabular-nums">{b.roasImpas}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {iklan.jangan.length > 0 ? (
                    <Card className="border-l-4 border-l-red-500">
                      <CardHeader>
                        <CardTitle className="text-base">Jangan diiklankan ({iklan.jumlahJangan})</CardTitle>
                        <CardDescription>
                          Produk ini sudah rugi sebelum biaya iklan. Berapa pun setelan iklannya, menambah
                          belanja iklan hanya memperbesar kerugian. Perbaiki harga atau HPP-nya dulu.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Table data-testid="tabel-iklan-jangan">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[100px]">SKU</TableHead>
                              <TableHead>Produk</TableHead>
                              <TableHead className="text-right">Harga</TableHead>
                              <TableHead className="text-right">Margin/unit</TableHead>
                              <TableHead className="text-right">Kontribusi</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {iklan.jangan.slice(0, 25).map((b) => (
                              <TableRow key={b.sku}>
                                <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                                <TableCell className="max-w-[260px] truncate">{b.nama ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatRupiah(b.hargaJual)}</TableCell>
                                <TableCell className="text-right font-semibold text-red-700 tabular-nums">
                                  {formatRupiah(b.marginSatuan)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{formatRupiah(b.kontribusi)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  ) : null}
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}

/** Kotak angka ringkas. Dipisah agar ringkasan mudah dibaca sekilas. */
function KotakAngka({ label, nilai, catatan }: { label: string; nilai: string; catatan: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading text-lg font-semibold tabular-nums">{nilai}</p>
      <p className="text-[11px] text-muted-foreground">{catatan}</p>
    </div>
  );
}
