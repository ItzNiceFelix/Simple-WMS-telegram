"use client";

// components/dashboard/analisa-detail-produk.tsx — Tab Detail Produk.
//
// ANGKA TETAP DARI SERVER: funnel, organik vs iklan, bucket, ranking, dan delta semuanya
// dihitung di `aksi=detail-produk`. Komponen ini hanya memilih periode, memformat, dan
// mengurutkan array yang sudah diterima — mengurutkan di klien (bukan lewat query) supaya
// klik header tidak memicu fetch ulang dan pembaca tidak kehilangan posisi scroll.
//
// Recharts hanya boleh di berkas klien seperti ini (route server tidak pernah merendernya).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Filter, Users } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";

type Delta = { selisih: number; persen: number | null } | null;

type BarisRanking = {
  sku: string;
  nama: string | null;
  kunjungan: number | null;
  keranjang: number | null;
  pesanan: number | null;
  cr: number | null;
  omzet: number | null;
  terjual: number;
  stok: number | null;
  hariPersediaan: number | null;
  deltaKunjungan: Delta;
  status: "fast" | "slow" | "dead" | "normal";
  /**
   * Seri kunjungan harian SKU ini untuk sparkline. Belum dikirim `aksi=detail-produk`, jadi
   * opsional: kolomnya tampil "—" sampai server mengirimnya. Menebaknya di klien berarti
   * menggambar tren dari data yang tidak ada.
   */
  trenSku?: number[] | null;
};

type ResponsDetail = {
  ok: boolean;
  error?: string;
  /** Jumlah SKU terjual yang TIDAK masuk snapshot laba (ditolak hitung laba) → tidak diranking. */
  skuDikecualikan?: number;
  periode: string[];
  dipakai?: string;
  pembanding?: string | null;
  ringkas?: {
    dilihat: number | null; kunjungan: number | null; keranjang: number | null;
    pesanan: number | null; cr: number | null; omzet: number | null;
  };
  delta?: {
    dilihat: Delta; kunjungan: Delta; keranjang: Delta; pesanan: Delta; cr: Delta; omzet: Delta;
  };
  funnel?: { tahap: string; nilai: number | null; dropPersen: number | null }[];
  organikVsIklan?: {
    organik: { kunjungan: number | null; pesanan: number | null; cr: number | null; omzet: number | null };
    iklan: { kunjungan: number | null; pesanan: number | null; cr: number | null; omzet: number | null };
    keterbatasan: string;
  };
  bucketStok?: { label: string; jumlah: number }[];
  bucketCr?: { label: string; jumlah: number }[];
  ranking?: BarisRanking[];
  topMover?: { naik: BarisRanking[]; turun: BarisRanking[] };
};

/** Riwayat iklan harian satu SKU (dialog). */
type IklanHarian = {
  ok: boolean;
  error?: string;
  sku?: string;
  baris?: { tanggal: string; biaya: number; klik: number; dilihat: number; omzetIklan: number }[];
};

/** `—` untuk null: null = tidak terukur, dan 0 bukan pengganti yang jujur untuk itu. */
function angka(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : formatAngka(v);
}
function rupiah(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : formatRupiah(v);
}
function persen(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v}%`;
}

/** Delta satu metrik; null → "belum cukup data" (bukan 0%). */
function BarisDelta({ d, poin = false }: { d: Delta; poin?: boolean }) {
  if (!d || d.persen === null) return <span className="text-xs text-muted-foreground">belum cukup data</span>;
  const naik = d.selisih > 0;
  const kelas = d.selisih === 0
    ? "text-muted-foreground"
    : naik ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400";
  const tanda = naik ? "+" : "";
  return (
    <span className={`text-xs ${kelas}`}>
      {tanda}{poin ? `${d.selisih} poin` : formatAngka(d.selisih)} ({tanda}{d.persen}%) vs pembanding
    </span>
  );
}

/**
 * Sparkline kunjungan satu SKU. Sumbu, tooltip, dan titik sengaja dibuang: di dalam sel tabel
 * label sumbu tidak terbaca dan tooltip merebut klik baris. `connectNulls={false}` supaya hari
 * tanpa data tetap terlihat sebagai celah, bukan ditarik lurus seolah terukur.
 */
function Sparkline({ nilai }: { nilai: number[] | null | undefined }) {
  if (!nilai || nilai.length < 2) return <span className="text-muted-foreground">—</span>;
  const titik = nilai.map((v, i) => ({ i, v }));
  return (
    <div className="h-8 w-24" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={titik} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line type="monotone" dataKey="v" stroke="var(--chart-1, #3b82f6)" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Warna & label status klasifikasi SKU; warnanya selaras dengan artinya. */
const GAYA_STATUS: Record<BarisRanking["status"], { label: string; variasi: "default" | "secondary" | "destructive" | "outline" }> = {
  fast: { label: "Fast", variasi: "default" },
  normal: { label: "Normal", variasi: "secondary" },
  slow: { label: "Slow", variasi: "outline" },
  dead: { label: "Dead", variasi: "destructive" },
};

// `trenSku` sengaja di luar `Kolom`: mengurutkan tabel berdasarkan larik angka tidak punya
// arti, jadi kolom Tren tampil sebagai header biasa (tanpa tombol urut).
type Kolom = Exclude<keyof BarisRanking, "nama" | "trenSku"> | "nama";
const KOLOM: { kunci: Kolom; label: string; angka?: boolean }[] = [
  { kunci: "sku", label: "SKU" },
  { kunci: "nama", label: "Produk" },
  { kunci: "kunjungan", label: "Kunjungan", angka: true },
  { kunci: "keranjang", label: "Keranjang", angka: true },
  { kunci: "pesanan", label: "Pesanan", angka: true },
  { kunci: "cr", label: "CR", angka: true },
  { kunci: "omzet", label: "Omzet", angka: true },
  { kunci: "terjual", label: "Terjual", angka: true },
  { kunci: "stok", label: "Stok", angka: true },
  { kunci: "hariPersediaan", label: "Hari persediaan", angka: true },
  { kunci: "status", label: "Status" },
];

const GAYA_TOOLTIP = {
  background: "var(--popover)", color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
} as const;

/**
 * Periode impor yang paling dekat dengan tanggal snapshot: periode yang RENTANGNYA memuat
 * tanggal itu, atau periode terbaru yang tidak lebih baru dari tanggal tersebut. Tanpa ini
 * prop `tanggal` diabaikan dan tab ini selalu membuka periode terbaru — pembaca mengira angka
 * periode yang dipilih di atas adalah angka tanggal itu.
 */
function pilihPeriode(daftar: string[], tanggal: string): string {
  if (daftar.length === 0) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return daftar[0];
  const memuat = daftar.find((p) => {
    const [dari, sampai = dari] = p.split("_");
    return tanggal >= dari && tanggal <= sampai;
  });
  if (memuat) return memuat;
  const lebihLama = daftar.filter((p) => p.split("_").at(-1)! <= tanggal);
  return lebihLama[0] ?? daftar[0];
}

export function AnalisaDetailProduk({ presetId, tanggal }: { presetId: number; tanggal: string }) {
  const [periode, setPeriode] = useState<string[]>([]);
  const [dipilih, setDipilih] = useState<string>("");
  const [data, setData] = useState<ResponsDetail | null>(null);
  const [memuatDaftar, setMemuatDaftar] = useState(true);
  const [memuat, setMemuat] = useState(false);
  const [urut, setUrut] = useState<{ kunci: Kolom; naik: boolean }>({ kunci: "kunjungan", naik: false });
  const [bukaSku, setBukaSku] = useState<BarisRanking | null>(null);
  const [iklan, setIklan] = useState<IklanHarian | null>(null);

  // Daftar periode dimuat lebih dulu; pemilihan pertama dilakukan di sini karena server
  // mengembalikannya terbaru dulu — periode terbaru itulah yang biasanya dibuka user.
  useEffect(() => {
    let batal = false;
    setMemuatDaftar(true);
    void (async () => {
      try {
        const res = await fetch(`/api/analisa?aksi=detail-produk&presetId=${presetId}`, { credentials: "include" });
        const d = (await res.json().catch(() => null)) as ResponsDetail | null;
        if (batal) return;
        if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat periode (${res.status}).`);
        const daftar = d.periode ?? [];
        setPeriode(daftar);
        // Pilihan mengikuti `tanggal` (snapshot yang sedang dilihat di halaman), bukan selalu
        // periode terbaru: dua bagian halaman yang membicarakan periode berbeda membingungkan.
        setDipilih((lama) => (daftar.includes(lama) ? lama : pilihPeriode(daftar, tanggal)));
      } catch (e) {
        if (batal) return;
        tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat periode.");
        setPeriode([]);
      } finally {
        if (!batal) setMemuatDaftar(false);
      }
    })();
    return () => { batal = true; };
  }, [presetId, tanggal]);

  // Tanggal snapshot berubah → periode yang ditampilkan menyesuaikan, kecuali user sudah
  // memilih periode lain secara sadar dan periode itu masih memuat tanggal baru.
  useEffect(() => {
    if (periode.length === 0) return;
    setDipilih((lama) => {
      const cocok = lama !== "" && (() => {
        const [dari, sampai = dari] = lama.split("_");
        return tanggal >= dari && tanggal <= sampai;
      })();
      return cocok ? lama : pilihPeriode(periode, tanggal);
    });
  }, [tanggal, periode]);

  // Pembanding = periode berikutnya di daftar (lebih lama). Dihitung di klien karena
  // daftarnya sudah lengkap; server tetap memvalidasi dan mengabaikannya bila tidak ada.
  const pembanding = useMemo(() => {
    const i = periode.indexOf(dipilih);
    return i >= 0 ? (periode[i + 1] ?? null) : null;
  }, [periode, dipilih]);

  // Nomor permintaan terakhir: respons periode lama yang datang belakangan tidak boleh menimpa
  // hasil periode yang sekarang dipilih. Pengganti flag `batal` karena fetch ini kini juga bisa
  // dipicu ulang tombol "Coba lagi", di luar siklus effect.
  const nomorPermintaan = useRef(0);
  const [galat, setGalat] = useState<string | null>(null);

  const muat = useCallback(async () => {
    if (!dipilih) return;
    const nomor = ++nomorPermintaan.current;
    setMemuat(true);
    setGalat(null);
    try {
      const q = new URLSearchParams({ aksi: "detail-produk", presetId: String(presetId), periode: dipilih });
      if (pembanding) q.set("pembanding", pembanding);
      const res = await fetch(`/api/analisa?${q}`, { credentials: "include" });
      const d = (await res.json().catch(() => null)) as ResponsDetail | null;
      if (nomor !== nomorPermintaan.current) return;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat detail produk (${res.status}).`);
      setData(d);
    } catch (e) {
      if (nomor !== nomorPermintaan.current) return;
      // Pesan disimpan di state, bukan hanya di-toast: kartu penuh "—" tanpa sebab terbaca
      // sebagai "tidak ada data", padahal permintaannya gagal dan bisa diulang.
      const pesan = e instanceof Error ? e.message : "Gagal memuat detail produk.";
      setGalat(pesan);
      setData(null);
      tampilkanGagalTulis(pesan);
    } finally {
      if (nomor === nomorPermintaan.current) setMemuat(false);
    }
  }, [presetId, dipilih, pembanding]);

  // Cleanup menaikkan nomor = membatalkan respons yang masih jalan saat periode berganti/unmount.
  useEffect(() => {
    void muat();
    return () => { nomorPermintaan.current += 1; };
  }, [muat]);

  // Riwayat iklan diambil saat baris diklik — tidak ikut membebani muat awal, dan hanya
  // satu SKU yang dibuka pada satu waktu.
  async function bukaDetail(r: BarisRanking) {
    // Penanda SKU yang sedang dimuat: respons SKU lama yang datang belakangan tidak boleh
    // menimpa dialog SKU baru (atau dialog yang sudah ditutup).
    const untukSku = r.sku;
    setBukaSku(r);
    setIklan(null);
    try {
      const q = new URLSearchParams({
        aksi: "detail-sku-iklan", presetId: String(presetId), sku: r.sku, periode: dipilih,
      });
      const res = await fetch(`/api/analisa?${q}`, { credentials: "include" });
      const d = (await res.json().catch(() => null)) as IklanHarian | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat iklan (${res.status}).`);
      setBukaSku((kini) => {
        if (kini?.sku === untukSku) setIklan(d);
        return kini;
      });
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat iklan harian.");
      setBukaSku((kini) => {
        if (kini?.sku === untukSku) setIklan({ ok: true, baris: [] });
        return kini;
      });
    }
  }

  const ranking = data?.ranking ?? [];
  const urutan = useMemo(() => {
    const arah = urut.naik ? 1 : -1;
    return [...ranking].sort((a, b) => {
      const x = a[urut.kunci];
      const y = b[urut.kunci];
      // null selalu di bawah: "tidak diketahui" tidak setara dengan 0.
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * arah;
      return String(x).localeCompare(String(y)) * arah;
    });
  }, [ranking, urut]);

  const dataFunnel = (data?.funnel ?? []).map((f) => ({ ...f, tampil: f.nilai ?? 0 }));

  if (memuatDaftar) {
    return <Skeleton className="h-48 w-full" data-testid="detail-produk" />;
  }

  if (periode.length === 0) {
    return (
      <Empty data-testid="detail-produk">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Filter /></EmptyMedia>
          <EmptyTitle>Belum ada periode Performa Produk</EmptyTitle>
          <EmptyDescription>
            Impor file Performa Produk di tab Peta SKU (tombol impor performa), lalu kembali ke sini.
            Data lama yang tanpa periode (legacy) sengaja tidak dipakai karena tidak punya rentang tanggal.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const ringkas = data?.ringkas;
  const delta = data?.delta;

  return (
    <div className="flex flex-col gap-4" data-testid="detail-produk">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Periode</span>
        <Select value={dipilih} onValueChange={(v) => v !== null && setDipilih(v)}>
          <SelectTrigger className="h-11 w-full md:h-8 md:w-72" data-testid="pilih-periode">
            <SelectValue>{(v: string | null) => v ?? "Pilih periode"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {periode.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Badge variant="outline" data-testid="label-pembanding">
          {pembanding ? `pembanding: ${pembanding}` : "belum ada pembanding"}
        </Badge>
        {/* Ditulis lengkap, bukan hanya badge: pembaca harus bisa memastikan periode mana yang
            sedang dijumlahkan tanpa menebak dari daftar dropdown. */}
        <span className="w-full text-xs text-muted-foreground" data-testid="label-periode-dipakai">
          Periode: {data?.dipakai ?? (dipilih || "—")} · Pembanding: {pembanding ?? "tidak ada"}
        </span>
        {pembanding === null ? (
          <span className="w-full text-xs text-muted-foreground" data-testid="catatan-tanpa-pembanding">
            Delta tidak bisa dihitung tanpa periode pembanding.
          </span>
        ) : null}
        {/* Disebut, bukan disembunyikan: qty dibatasi ke SKU yang lolos snapshot laba, jadi
            SKU terjual yang ditolak tidak muncul di ranking dan pembaca berhak tahu. */}
        {(data?.skuDikecualikan ?? 0) > 0 ? (
          <span className="text-xs text-amber-700 dark:text-amber-400" data-testid="sku-dikecualikan">
            {data?.skuDikecualikan} SKU terjual tidak masuk snapshot laba — tidak diranking
          </span>
        ) : null}
        {memuat ? <span className="text-xs text-muted-foreground">memuat…</span> : null}
      </div>

      {/* Kegagalan disebut, bukan dibiarkan jadi kartu penuh "—": "—" berarti tidak terukur,
          sedangkan gagal muat berarti datanya belum diketahui dan bisa diulang. */}
      {galat ? (
        <Alert variant="destructive" data-testid="galat-detail-produk">
          <AlertTitle>Gagal memuat detail produk</AlertTitle>
          <AlertDescription>{galat}</AlertDescription>
          <AlertAction>
            <Button type="button" size="sm" variant="outline" onClick={() => void muat()} disabled={memuat}>
              Coba lagi
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {/* ══ 5 KARTU RINGKAS + DELTA ══ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="detail-kartu">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Dilihat</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold tabular-nums">{angka(ringkas?.dilihat)}</span>
            <BarisDelta d={delta?.dilihat ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Kunjungan</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold tabular-nums">{angka(ringkas?.kunjungan)}</span>
            <BarisDelta d={delta?.kunjungan ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Keranjang</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold tabular-nums">{angka(ringkas?.keranjang)}</span>
            <BarisDelta d={delta?.keranjang ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Pesanan</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold tabular-nums">{angka(ringkas?.pesanan)}</span>
            <BarisDelta d={delta?.pesanan ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>CR · Omzet</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold tabular-nums">{persen(ringkas?.cr)}</span>
            <span className="text-xs text-muted-foreground">{rupiah(ringkas?.omzet)}</span>
            {/* Delta CR dibaca dalam POIN persen: 2% → 3% adalah +1 poin, bukan +50%. */}
            <BarisDelta d={delta?.cr ?? null} poin />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ══ FUNNEL ══ */}
        <Card data-testid="detail-funnel">
          <CardHeader>
            <CardTitle>Funnel</CardTitle>
            <CardDescription>Tahap dari tayangan sampai pesanan; label = penurunan dari tahap sebelumnya.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dataFunnel} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="tahap" tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                  <YAxis hide allowDecimals={false} />
                  <Tooltip
                    contentStyle={GAYA_TOOLTIP}
                    formatter={(v) => formatAngka(Number(v))}
                    labelFormatter={(_l, p) => {
                      const drop = (p?.[0]?.payload as { dropPersen: number | null } | undefined)?.dropPersen;
                      return drop === null || drop === undefined ? "" : `turun ${drop}% dari tahap sebelumnya`;
                    }}
                  />
                  <Bar dataKey="tampil" name="Jumlah" fill="var(--chart-1, #3b82f6)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {dataFunnel.map((f) => (
                <div key={f.tahap} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{f.tahap}</span>
                  <span className="tabular-nums">
                    {angka(f.nilai)}
                    {f.dropPersen === null ? null : <span className="ml-2 text-red-600 dark:text-red-400">−{f.dropPersen}%</span>}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ══ ORGANIK VS IKLAN ══ */}
        <Card data-testid="detail-organik-iklan">
          <CardHeader>
            <CardTitle>Organik vs iklan</CardTitle>
            <CardDescription>Kunjungan berbayar = klik iklan; sisanya organik.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sumber</TableHead>
                  <TableHead className="text-right">Kunjungan</TableHead>
                  <TableHead className="text-right">CR</TableHead>
                  <TableHead className="text-right">Omzet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["organik", "iklan"] as const).map((s) => {
                  const b = data?.organikVsIklan?.[s];
                  return (
                    <TableRow key={s}>
                      <TableCell>{s === "organik" ? "Organik" : "Iklan"}</TableCell>
                      <TableCell className="text-right tabular-nums">{angka(b?.kunjungan)}</TableCell>
                      <TableCell className="text-right tabular-nums">{persen(b?.cr)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(b?.omzet)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">{data?.organikVsIklan?.keterbatasan}</p>
          </CardContent>
        </Card>
      </div>

      {/* ══ BUCKET ══ */}
      <div className="grid gap-4 md:grid-cols-2" data-testid="detail-bucket">
        <Card>
          <CardHeader>
            <CardTitle>Sebaran hari persediaan</CardTitle>
            <CardDescription>SKU tanpa data stok atau laju jual tidak dihitung di sini.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.bucketStok ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                  <YAxis hide allowDecimals={false} />
                  <Tooltip contentStyle={GAYA_TOOLTIP} formatter={(v) => `${formatAngka(Number(v))} SKU`} />
                  <Bar dataKey="jumlah" name="SKU" fill="var(--chart-1, #3b82f6)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sebaran CR</CardTitle>
            <CardDescription>SKU tanpa baris performa (CR tidak diketahui) tidak dihitung.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.bucketCr ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                  <YAxis hide allowDecimals={false} />
                  <Tooltip contentStyle={GAYA_TOOLTIP} formatter={(v) => `${formatAngka(Number(v))} SKU`} />
                  <Bar dataKey="jumlah" name="SKU" fill="var(--chart-2, #8b5cf6)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ══ TOP MOVER ══ */}
      {(data?.topMover?.naik.length ?? 0) + (data?.topMover?.turun.length ?? 0) > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pergerakan kunjungan</CardTitle>
            <CardDescription>Dibandingkan periode pembanding; hanya SKU yang punya pembanding &gt; 0.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {(["naik", "turun"] as const).map((arah) => (
              <div key={arah} className="flex flex-col gap-1">
                <span className="text-sm font-medium">{arah === "naik" ? "Naik" : "Turun"}</span>
                {(data?.topMover?.[arah] ?? []).map((r) => (
                  <div key={r.sku} className="flex items-center justify-between text-xs">
                    <span className="font-mono">{r.sku}</span>
                    <span className={arah === "naik" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
                      {r.deltaKunjungan?.persen ?? "—"}%
                    </span>
                  </div>
                ))}
                {(data?.topMover?.[arah] ?? []).length === 0 ? (
                  <span className="text-xs text-muted-foreground">tidak ada</span>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* ══ RANKING ══ */}
      <Card data-testid="detail-ranking">
        <CardHeader>
          <CardTitle>Ranking SKU</CardTitle>
          <CardDescription>Klik header untuk mengurutkan; klik baris untuk detail iklan harian.</CardDescription>
        </CardHeader>
        <CardContent>
          {urutan.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada SKU dengan data pada periode ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {KOLOM.map((k) => (
                      <TableHead key={k.kunci} className={k.angka ? "text-right" : undefined}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-2 h-7 px-2"
                          onClick={() => setUrut((u) => ({ kunci: k.kunci, naik: u.kunci === k.kunci ? !u.naik : false }))}
                        >
                          {k.label}
                          {urut.kunci !== k.kunci ? (
                            <ChevronsUpDown className="ml-1 size-3 opacity-50" />
                          ) : urut.naik ? (
                            <ArrowUp className="ml-1 size-3" />
                          ) : (
                            <ArrowDown className="ml-1 size-3" />
                          )}
                        </Button>
                      </TableHead>
                    ))}
                    {/* Header Tren tanpa tombol urut: mengurutkan larik sparkline tidak punya
                        arti, dan kolomnya belum berisi data (server belum mengirim trenSku). */}
                    <TableHead className="text-right">Tren</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {urutan.map((r) => (
                    <TableRow
                      key={r.sku}
                      className="cursor-pointer"
                      onClick={() => void bukaDetail(r)}
                      data-testid={`detail-sku-${r.sku}`}
                    >
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell className="max-w-56 truncate">{r.nama ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{angka(r.kunjungan)}</TableCell>
                      <TableCell className="text-right tabular-nums">{angka(r.keranjang)}</TableCell>
                      <TableCell className="text-right tabular-nums">{angka(r.pesanan)}</TableCell>
                      <TableCell className="text-right tabular-nums">{persen(r.cr)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(r.omzet)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAngka(r.terjual)}</TableCell>
                      <TableCell className="text-right tabular-nums">{angka(r.stok)}</TableCell>
                      <TableCell className="text-right tabular-nums">{angka(r.hariPersediaan)}</TableCell>
                      <TableCell>
                        <Badge variant={GAYA_STATUS[r.status].variasi}>{GAYA_STATUS[r.status].label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Sparkline nilai={r.trenSku ?? null} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══ DIALOG DETAIL SKU ══ */}
      <Dialog open={bukaSku !== null} onOpenChange={(o) => { if (!o) setBukaSku(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-4" />
              <span className="font-mono text-sm">{bukaSku?.sku}</span>
              {bukaSku ? <span className="truncate text-sm font-normal text-muted-foreground">{bukaSku.nama ?? ""}</span> : null}
            </DialogTitle>
            <DialogDescription>{periode === null ? "" : dipilih}</DialogDescription>
          </DialogHeader>

          {bukaSku && bukaSku.kunjungan === null ? (
            <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="detail-sku-tanpa-performa">
              SKU ini tidak ada di ekspor Performa Produk untuk periode ini — kolom performa tampil
              &ldquo;—&rdquo;, bukan 0. Angka terjual/stok tetap berasal dari order dan gudang.
            </p>
          ) : null}

          {/* Funnel mini: 4 tahap SKU ini, diambil dari baris ranking (angka server). */}
          <div className="grid grid-cols-4 gap-2" data-testid="detail-sku-funnel">
            {[
              { label: "Kunjungan", v: bukaSku?.kunjungan },
              { label: "Keranjang", v: bukaSku?.keranjang },
              { label: "Pesanan", v: bukaSku?.pesanan },
              { label: "CR", v: bukaSku?.cr },
            ].map((t) => (
              <div key={t.label} className="rounded-md border p-2">
                <div className="text-xs text-muted-foreground">{t.label}</div>
                <div className="text-sm font-semibold tabular-nums">
                  {t.label === "CR" ? persen(t.v) : angka(t.v)}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">Biaya iklan harian</div>
            {iklan === null ? (
              <Skeleton className="h-40 w-full" />
            ) : (iklan.baris ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada data iklan untuk SKU ini pada periode tersebut.</p>
            ) : (
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={iklan.baris} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="tanggal" tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                    <YAxis tickLine={false} axisLine={false} width={56} stroke="currentColor" className="text-muted-foreground text-xs" />
                    <Tooltip contentStyle={GAYA_TOOLTIP} formatter={(v) => formatRupiah(Number(v))} />
                    <Line type="monotone" dataKey="biaya" name="Biaya" stroke="var(--chart-1, #3b82f6)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <Button variant="outline" onClick={() => setBukaSku(null)}>Tutup</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
