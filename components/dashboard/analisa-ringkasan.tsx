"use client";

// components/dashboard/analisa-ringkasan.tsx — Tab Ringkasan: kartu KPI, tren harian,
// sebaran per jam, komposisi biaya, dan klasifikasi produk.
//
// ANGKA TETAP DARI SERVER: seluruh perhitungan ada di `aksi=tren`
// (lib/analisa/tren.ts). Komponen ini hanya memformat & menggambar. Kalau ia menghitung
// ulang persen/delta sendiri, angkanya bisa berbeda dari Temuan/Semua Produk untuk
// periode yang sama — kelas bug yang memang mau dihindari repo ini.
//
// Recharts HANYA boleh di berkas klien seperti ini; mengimpornya di route server membuat
// bundel Worker membengkak tanpa manfaat (grafik tidak pernah dirender di sana).
import { useEffect, useMemo, useState } from "react";
import { ChartNoAxesCombined, Clock, PieChart, TrendingUp } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";
import type {
  BarisProdukTren, Pembanding, RingkasRentang, TitikHarian,
} from "@/lib/analisa/tren";

type BarisJam = { jam: number; omzet: number; laba: number };

/** Satu titik jam untuk SATU tanggal — bentuk `perJamPerTanggal` dari server. */
type TitikJam = BarisJam & { tanggal: string };

/** Satu baris delta hari-ke-hari. `omzet` null = tidak ada hari sebelumnya (entri pertama). */
type DeltaHarianBaris = {
  tanggal: string;
  omzet: Pembanding["omzet"];
  laba: Pembanding["laba"];
  order: Pembanding["order"];
  marginPoin: number | null;
};

/** Cakupan data nyata: berapa hari dalam rentang yang benar-benar punya isi. */
type CakupanTren = {
  hariRentang: number;
  hariSnapshot: string[];
  hariIklan: string[];
  periodePerforma: string[];
  adaStok: boolean;
};

type ResponsTren = {
  ok: boolean;
  error?: string;
  dari?: string;
  sampai?: string;
  seri?: (TitikHarian | null)[];
  ringkas?: RingkasRentang;
  bandingPeriode?: Pembanding;
  bandingBulan?: Pembanding;
  perJam?: BarisJam[];
  perJamPerTanggal?: TitikJam[];
  deltaHarian?: DeltaHarianBaris[];
  tanggalDipakai?: string[];
  komposisiBiaya?: { label: string; nilai: number; persen: number | null }[];
  komposisiJenis?: { label: string; nilai: number; persen: number | null; kunci: string }[];
  cakupan?: CakupanTren;
  produk?: BarisProdukTren[];
  hariBerdata?: number;
};

/** Opsi rentang yang bisa dipilih. Sama dengan yang diterima server (1/3/7/14/30). */
const PILIHAN_RENTANG = [1, 3, 7, 14, 30] as const;

/** Rentang bebas dianggap sah hanya bila dua ujung terisi dan urutannya tidak terbalik. */
function rentangBebasSah(dari: string, sampai: string): boolean {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return iso.test(dari) && iso.test(sampai) && dari <= sampai;
}

/** Warna per klasifikasi produk. Kelas Tailwind supaya ikut tema gelap. */
const GAYA_KELAS: Record<BarisProdukTren["kelas"], { label: string; kelas: string; warna: string }> = {
  fast: { label: "Fast moving", kelas: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400", warna: "#10b981" },
  slow: { label: "Slow moving", kelas: "bg-amber-500/15 text-amber-700 dark:text-amber-400", warna: "#f59e0b" },
  dead: { label: "Dead stock", kelas: "bg-red-600/15 text-red-700 dark:text-red-400", warna: "#ef4444" },
};

/** Jumlah SKU per klasifikasi. Bukan satu-liner inline: dipakai badge DAN grafik batang. */
function jumlahKelas(produk: BarisProdukTren[], kelas: BarisProdukTren["kelas"]): number {
  return produk.filter((p) => p.kelas === kelas).length;
}

/** Rupiah ringkas untuk sumbu Y: juta/ribu supaya 24 label tidak bertumpuk. */
function rupiahPendek(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${Math.round(v / 100_000) / 10}jt`;
  if (abs >= 1_000) return `${Math.round(v / 100) / 10}rb`;
  return formatAngka(v);
}

/** Ringkasan delta: selisih + persen, atau "belum cukup data" bila pembanding tak ada. */
function BarisDelta({ d, membalik = false }: { d: Pembanding["omzet"] | null; membalik?: boolean }) {
  // null = pembanding tidak punya snapshot / pembanding nol. Menampilkan 0% di sini akan
  // berbohong bahwa penjualan "datar".
  if (!d || d.persen === null) {
    return <span className="text-xs text-muted-foreground">belum cukup data</span>;
  }
  const naik = d.selisih > 0;
  const datar = d.selisih === 0;
  // `membalik` untuk BIAYA: biaya naik itu buruk, jadi warnanya merah walau arahnya naik.
  const buruk = datar ? false : membalik ? naik : !naik;
  const kelas = datar
    ? "text-muted-foreground"
    : buruk
      ? "text-red-700 dark:text-red-400"
      : "text-emerald-700 dark:text-emerald-400";
  const tanda = naik ? "+" : "";
  return (
    <span className={`text-xs ${kelas}`}>
      {tanda}{formatAngka(d.selisih)} ({tanda}{d.persen}%) vs pembanding
    </span>
  );
}

export function AnalisaRingkasan({ presetId, tanggal }: { presetId: number; tanggal: string }) {
  const [rentang, setRentang] = useState<number>(7);
  // Dua ujung rentang bebas. Kosong = tombol rentang yang dipakai, jadi keduanya harus
  // dikosongkan bersama saat tombol ditekan — kalau tidak, input lama menang diam-diam.
  const [dariBebas, setDariBebas] = useState("");
  const [sampaiBebas, setSampaiBebas] = useState("");
  // null = "Gabungan" (profil 24 jam dari seluruh hari yang dipakai).
  const [tanggalJam, setTanggalJam] = useState<string | null>(null);

  const bebasSah = rentangBebasSah(dariBebas, sampaiBebas);
  // Kunci permintaan: hanya berubah saat dua ujung bebas SAH, supaya mengetik satu ujung
  // (belum lengkap) tidak memicu fetch yang hasilnya sama dengan tombol rentang.
  const kunciBebas = bebasSah ? `${dariBebas}|${sampaiBebas}` : "";
  const [data, setData] = useState<ResponsTren | null>(null);
  const [memuat, setMemuat] = useState(false);

  // `data` diganti seluruhnya tiap fetch, jadi identitasnya cukup sebagai dependensi.
  const { adaHarian, dataHarian } = useMemo(() => {
    const seri = data?.seri ?? [];
    return {
      adaHarian: seri.some((t) => t !== null),
      dataHarian: seri.map((t) => ({
        // Tanggal penuh: sumbu X memotongnya jadi dua digit hari lewat `tickFormatter` supaya
        // 30 titik tidak bertumpuk, sementara tooltip tetap menyebut tanggal lengkap.
        // Titik null tetap punya tanggal kosong agar celahnya terbaca.
        tanggal: t?.tanggal ?? "",
        omzet: t ? t.omzet : null,
        laba: t ? t.laba : null,
      })),
    };
  }, [data]);

  // Parameter permintaan dirakit di luar effect supaya identitasnya (bukan tiap ketikan di
  // input) yang jadi pemicu fetch: mengetik ujung pertama belum mengubah `kunciBebas`.
  const permintaan = useMemo(() => {
    if (!presetId || !tanggal) return null;
    const q = new URLSearchParams({ aksi: "tren", presetId: String(presetId) });
    if (kunciBebas) {
      // Rentang bebas: `tanggal` = ujung akhir, `dari` = awal. `rentang` sengaja tidak
      // dikirim karena server menghitung ulang panjang jendela dari selisih tanggal —
      // mengirim keduanya hanya membuka peluang dua parameter saling bertentangan.
      q.set("tanggal", sampaiBebas);
      q.set("dari", dariBebas);
    } else {
      q.set("tanggal", tanggal);
      q.set("rentang", String(rentang));
    }
    return q.toString();
  }, [presetId, tanggal, rentang, kunciBebas, dariBebas, sampaiBebas]);

  useEffect(() => {
    if (!permintaan) return;
    let batal = false;
    setMemuat(true);
    (async () => {
      try {
        const res = await fetch(`/api/analisa?${permintaan}`, { credentials: "include" });
        const d = (await res.json().catch(() => null)) as ResponsTren | null;
        if (batal) return;
        if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat ringkasan (${res.status}).`);
        setData(d);
      } catch (e) {
        if (batal) return;
        setData(null);
        tampilkanGagalTulis(e instanceof Error ? e.message : "Ringkasan gagal dimuat.");
      } finally {
        if (!batal) setMemuat(false);
      }
    })();
    // `batal` mencegah balasan permintaan lama menimpa hasil preset/tanggal yang baru.
    return () => { batal = true; };
  }, [permintaan]);

  if (memuat && !data) return <Skeleton className="h-64 w-full rounded-xl" data-testid="memuat-ringkasan" />;

  if (!data) {
    return (
      <Empty data-testid="ringkasan-kosong">
        <EmptyHeader>
          <EmptyMedia variant="icon"><ChartNoAxesCombined /></EmptyMedia>
          <EmptyTitle>Ringkasan tidak bisa dimuat</EmptyTitle>
          <EmptyDescription>Pilih preset dan tanggal lain, lalu coba lagi.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const ringkas = data.ringkas;
  const banding = data.bandingPeriode;
  const produk = data.produk ?? [];
  const tanggalDipakai = data.tanggalDipakai ?? [];
  const dataKelas = (["fast", "slow", "dead"] as const).map((k) => ({
    kelas: k, nama: GAYA_KELAS[k].label, jumlah: jumlahKelas(produk, k), warna: GAYA_KELAS[k].warna,
  }));

  // Pemilih tanggal profil per jam: maksimal 7 hari TERAKHIR, terbaru dulu — tombolnya harus
  // tetap satu baris, dan hari paling baru yang paling ingin dibandingkan.
  const opsiTanggalJam = [...tanggalDipakai].sort((a, b) => b.localeCompare(a)).slice(0, 7);
  // Pilihan yang tidak ada lagi di daftar (rentang berganti) jatuh kembali ke "Gabungan"
  // alih-alih menampilkan grafik kosong tanpa penjelasan.
  const tanggalJamAktif = tanggalJam !== null && opsiTanggalJam.includes(tanggalJam) ? tanggalJam : null;
  const dataJam: BarisJam[] = tanggalJamAktif === null
    ? (data.perJam ?? [])
    // Server selalu mengirim 24 titik per tanggal; filter tanggal cukup, urutannya sudah jam.
    : (data.perJamPerTanggal ?? [])
      .filter((t) => t.tanggal === tanggalJamAktif)
      .map((t) => ({ jam: t.jam, omzet: t.omzet, laba: t.laba }));

  // Baris tanpa tanggal = hari tanpa snapshot (server mengisi objek kosong). Batangnya tidak
  // akan digambar, jadi dibuang: menyisakannya hanya menambah tick kosong dan kunci ganda.
  const dataDelta = (data.deltaHarian ?? [])
    .filter((d) => d.tanggal !== "")
    .map((d) => ({
      tanggal: d.tanggal,
      selisih: d.omzet?.selisih ?? null,
      persen: d.omzet?.persen ?? null,
    }));

  // Pecahan per jenis lebih informatif; snapshot lama belum menyimpannya sehingga server
  // mengirim `[]` dan kita jatuh ke tiga kelompok kasar — dengan keterangan, bukan diam-diam.
  const jenis = data.komposisiJenis ?? [];
  const pakaiJenis = jenis.length > 0;
  // Kedua bentuk punya tiga field yang dipakai UI; `kunci` hanya milik `komposisiJenis`.
  const komposisi: { label: string; nilai: number; persen: number | null }[] =
    pakaiJenis ? jenis : (data.komposisiBiaya ?? []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Rentang</span>
        {PILIHAN_RENTANG.map((r) => (
          <Button
            key={r}
            type="button"
            size="sm"
            // Tombol hanya tampak aktif bila rentang bebas tidak sedang dipakai — dua kontrol
            // yang sama-sama menyala membuat pembaca menebak mana yang berlaku.
            variant={!bebasSah && rentang === r ? "default" : "outline"}
            onClick={() => {
              setRentang(r);
              // Tombol dan input berbagi satu jendela; menyisakan isi input akan membuat
              // klik tombol tidak berefek apa pun.
              setDariBebas("");
              setSampaiBebas("");
            }}
            data-testid={`rentang-${r}`}
          >
            {r} hari
          </Button>
        ))}
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="Dari tanggal"
            value={dariBebas}
            max={sampaiBebas || undefined}
            onChange={(e) => setDariBebas(e.target.value)}
            className="h-7 w-36 text-xs"
            data-testid="rentang-dari"
          />
          <span className="text-xs text-muted-foreground">s/d</span>
          <Input
            type="date"
            aria-label="Sampai tanggal"
            value={sampaiBebas}
            min={dariBebas || undefined}
            onChange={(e) => setSampaiBebas(e.target.value)}
            className="h-7 w-36 text-xs"
            data-testid="rentang-sampai"
          />
        </div>
        {dariBebas && sampaiBebas && !bebasSah ? (
          <span className="text-xs text-red-700 dark:text-red-400">
            Tanggal mulai harus sebelum tanggal akhir.
          </span>
        ) : null}
        {data.dari && data.sampai ? (
          <span className="text-xs text-muted-foreground">{data.dari} s/d {data.sampai}</span>
        ) : null}
      </div>

      {/* ══ CAKUPAN DATA ══ */}
      {data.cakupan ? (
        <Card data-testid="cakupan-data">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cakupan data</CardTitle>
            <CardDescription>
              Berapa bagian rentang ini yang benar-benar punya data. Angka di bawah dihitung
              dari bagian yang ada saja, bukan dari seluruh rentang.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                Laba {data.cakupan.hariSnapshot.length}/{data.cakupan.hariRentang} hari
              </Badge>
              <Badge variant="outline">
                Iklan {data.cakupan.hariIklan.length}/{data.cakupan.hariRentang} hari
              </Badge>
              <Badge variant="outline">Performa {data.cakupan.periodePerforma.length} periode</Badge>
              <Badge variant="outline">
                Stok {data.cakupan.adaStok ? "tersedia" : "tidak tersedia"}
              </Badge>
            </div>
            {/* ROAS memakai penyebut hari iklan; menyamakannya dengan hari laba membuat
                pembacaan ROAS terlihat lebih baik daripada kenyataannya. Nol hari iklan
                bukan "ROAS 0" — ROAS-nya tidak terhitung sama sekali. */}
            {data.cakupan.hariIklan.length === 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Belum ada data iklan pada rentang ini, jadi ROAS dan keputusan iklan tidak
                dihitung. Impor data iklan di tab Saran Iklan.
              </p>
            ) : data.cakupan.hariIklan.length < data.cakupan.hariSnapshot.length ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                ROAS dihitung dari {data.cakupan.hariIklan.length} hari iklan, bukan{" "}
                {data.cakupan.hariSnapshot.length} hari laba.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {adaHarian ? null : (
        <Empty data-testid="ringkasan-tanpa-harian">
          <EmptyHeader>
            <EmptyMedia variant="icon"><TrendingUp /></EmptyMedia>
            <EmptyTitle>Data harian belum ada</EmptyTitle>
            <EmptyDescription>
              Tidak ada snapshot laba pada rentang ini. Grafik tren butuh minimal satu hari
              berdata — impor file laba di halaman Laba dengan rentang tanggal yang memuat
              periode ini.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {/* ══ KARTU KPI ══ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="ringkasan-kartu">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Omzet</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold tabular-nums">{formatRupiah(ringkas?.omzet ?? 0)}</span>
            <BarisDelta d={banding?.omzet ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Laba</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold tabular-nums">{formatRupiah(ringkas?.laba ?? 0)}</span>
            <BarisDelta d={banding?.laba ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Order</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold tabular-nums">{formatAngka(ringkas?.jmlOrder ?? 0)}</span>
            <BarisDelta d={banding?.order ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Margin</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold tabular-nums">
              {ringkas?.marginPersen === null || ringkas?.marginPersen === undefined
                ? "—"
                : `${ringkas.marginPersen}%`}
            </span>
            {/* Delta margin dibaca dalam POIN persen: 2% → 3% adalah +1 poin, bukan +50%. */}
            {!banding || banding.marginPersen.selisih === null ? (
              <span className="text-xs text-muted-foreground">belum cukup data</span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {banding.marginPersen.selisih > 0 ? "+" : ""}
                {banding.marginPersen.selisih} poin vs pembanding
              </span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Biaya</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold tabular-nums">{formatRupiah(ringkas?.biaya ?? 0)}</span>
            {/* membalik: biaya naik = buruk, jadi warnanya dibalik dari kartu lain. */}
            <BarisDelta d={banding?.biaya ?? null} membalik />
          </CardContent>
        </Card>
      </div>

      {ringkas ? (
        <p className="text-xs text-muted-foreground">
          {ringkas.hari} hari berdata · HPP {formatRupiah(ringkas.hpp)} ·
          {" "}pajak {formatRupiah(ringkas.pajak)} · AOV {ringkas.aov === null ? "—" : formatRupiah(ringkas.aov)}
        </p>
      ) : null}

      {/* Grafik per jam & harian hanya berguna bila ada minimal satu hari berdata. */}
      {adaHarian ? (
        <>
          {/* ══ GRAFIK PER JAM ══ */}
          <Card data-testid="grafik-per-jam">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4" aria-hidden />
                Omzet vs Laba per jam
              </CardTitle>
              <CardDescription>
                {/* Tanpa hari yang memenuhi syarat, daftar kosong tidak memberi tahu apa pun:
                    keadaannya dinyatakan sebagai kalimat utama. */}
                {tanggalDipakai.length === 0 ? (
                  "Belum ada hari yang cukup tua untuk profil per jam."
                ) : (
                  <>
                    Berdasarkan jam pesanan dibuat. Dua hari terakhir dikecualikan (harinya
                    belum selesai), jadi yang dipakai: {tanggalDipakai.join(", ")}.
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {opsiTanggalJam.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant={tanggalJamAktif === null ? "default" : "outline"}
                    onClick={() => setTanggalJam(null)}
                    data-testid="jam-gabungan"
                  >
                    Gabungan
                  </Button>
                  {opsiTanggalJam.map((t) => (
                    <Button
                      key={t}
                      type="button"
                      size="xs"
                      variant={tanggalJamAktif === t ? "default" : "outline"}
                      onClick={() => setTanggalJam(t)}
                      data-testid={`jam-${t}`}
                    >
                      {/* dd/mm: dua digit hari saja ambigu saat rentang 30 hari melewati bulan. */}
                      {t.slice(8, 10)}/{t.slice(5, 7)}
                    </Button>
                  ))}
                </div>
              ) : null}
              {tanggalDipakai.length > 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="jam-aktif">
                  {tanggalJamAktif === null
                    ? `Menampilkan gabungan ${tanggalDipakai.length} hari.`
                    : `Menampilkan ${tanggalJamAktif} saja.`}
                </p>
              ) : null}
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dataJam} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
                    <XAxis dataKey="jam" tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                    <YAxis tickFormatter={rupiahPendek} width={56} tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                    <Tooltip
                      formatter={(v) => formatRupiah(Number(v))}
                      labelFormatter={(j) => `Jam ${String(j).padStart(2, "0")}:00`}
                      contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" }}
                    />
                    <Line type="monotone" dataKey="omzet" name="Omzet" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} connectNulls={false} />
                    <Line type="monotone" dataKey="laba" name="Laba" stroke="var(--color-chart-2)" strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* ══ GRAFIK HARIAN ══ */}
          <Card data-testid="grafik-harian">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4" aria-hidden />
                Tren harian
              </CardTitle>
              <CardDescription>
                Hari tanpa snapshot digambar sebagai celah, bukan nol — nol berarti terukur
                sepi, celah berarti datanya tidak ada.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dataHarian} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
                    <XAxis dataKey="tanggal" tickFormatter={(v: string) => v.slice(8, 10)} tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                    <YAxis tickFormatter={rupiahPendek} width={56} tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                    <Tooltip
                      formatter={(v) => formatRupiah(Number(v))}
                      // Label sumbu dipotong jadi dua digit hari, tetapi nilai label tooltip
                      // tetap tanggal penuh dari `dataKey` — tanpa perlu membaca payload recharts
                      // (yang bertipe `any` dan memaksa cast).
                      labelFormatter={(l) => (l ? String(l) : "tanpa data")}
                      contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" }}
                    />
                    <Line type="monotone" dataKey="omzet" name="Omzet" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} connectNulls={false} />
                    <Line type="monotone" dataKey="laba" name="Laba" stroke="var(--color-chart-2)" strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* ══ GRAFIK DELTA HARIAN ══ */}
          <Card data-testid="grafik-delta-harian">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ChartNoAxesCombined className="size-4" aria-hidden />
                Perubahan omzet hari-ke-hari
              </CardTitle>
              <CardDescription>
                Selisih terhadap hari sebelumnya, bukan terhadap awal rentang. Hari pertama
                tidak punya pembanding sehingga tidak digambar — bukan nol.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dataDelta} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
                    <XAxis dataKey="tanggal" tickFormatter={(v: string) => v.slice(8, 10)} tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                    <YAxis tickFormatter={rupiahPendek} width={56} tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                    <Tooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                      // Isi tooltip dirakit dari baris kita sendiri (dicari lewat tanggal), bukan
                      // dari `payload` recharts yang bertipe `any`: persen dibutuhkan, dan label
                      // sumbu hanya dua digit hari.
                      content={(p) => {
                        if (!p.active) return null;
                        const baris = dataDelta.find((d) => d.tanggal === String(p.label));
                        if (!baris || baris.selisih === null) return null;
                        return (
                          <div
                            className="rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground"
                            style={{ borderColor: "var(--border)" }}
                          >
                            <div className="font-medium">{baris.tanggal}</div>
                            <div className="tabular-nums">
                              {baris.selisih > 0 ? "+" : ""}{formatRupiah(baris.selisih)}
                              {baris.persen === null ? "" : ` (${baris.selisih > 0 ? "+" : ""}${baris.persen}%)`}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="selisih" name="Selisih omzet" radius={[2, 2, 0, 0]}>
                      {dataDelta.map((d) => (
                        <Cell
                          key={d.tanggal}
                          // Hijau = naik, merah = turun. Nilai null tidak digambar recharts,
                          // warnanya tetap diberikan agar indeks Cell sejajar dengan data.
                          fill={(d.selisih ?? 0) >= 0 ? "#10b981" : "#ef4444"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {dataDelta.every((d) => d.selisih === null) ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Belum ada dua hari berurutan yang bisa dibandingkan pada rentang ini.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ══ KOMPOSISI BIAYA ══ */}
      <Card data-testid="komposisi-biaya">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PieChart className="size-4" aria-hidden />
            Komposisi biaya
          </CardTitle>
          <CardDescription>
            {pakaiJenis
              ? "Pecahan biaya per jenis, terbesar dulu."
              : "Hanya tiga kelompok yang benar-benar bisa dipisah dari data yang ada."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {komposisi.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada biaya tercatat pada rentang ini.</p>
          ) : (
            komposisi.map((b) => {
              // Lebar bar memakai persen dari server; null (total 0) = bar kosong, bukan 0% palsu.
              const lebar = b.persen === null ? 0 : Math.max(0, Math.min(100, b.persen));
              return (
                <div key={b.label} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{b.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatRupiah(b.nilai)} · {b.persen === null ? "—" : `${b.persen}%`}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    {/* bg-current + text-foreground: ikut tema gelap tanpa warna hardcoded. */}
                    <div className="h-full rounded-full bg-current text-foreground opacity-70" style={{ width: `${lebar}%` }} />
                  </div>
                </div>
              );
            })
          )}
          {/* Snapshot lama tidak menyimpan pecahan; tiga kelompok di atas bukan pecahan
              sebenarnya, jadi keadaannya disebut alih-alih dibiarkan tampak rinci. */}
          {pakaiJenis ? null : (
            <p className="text-xs text-muted-foreground">
              Rincian per jenis belum tersedia untuk snapshot lama.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ══ RINGKASAN PRODUK ══ */}
      <Card data-testid="ringkasan-produk">
        <CardHeader>
          <CardTitle className="text-base">Ringkasan Produk</CardTitle>
          <CardDescription>
            Laju = qty terjual ÷ {data.hariBerdata ?? 1} hari berdata. Dead = tidak terjual
            padahal stok ada; Fast = laju ≥ rata-rata SKU yang bergerak.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {(["fast", "slow", "dead"] as const).map((k) => (
              <Badge key={k} variant="outline" className={GAYA_KELAS[k].kelas}>
                {GAYA_KELAS[k].label}: {jumlahKelas(produk, k)}
              </Badge>
            ))}
          </div>

          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataKelas} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="nama" width={100} tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                <Tooltip
                  formatter={(v) => `${formatAngka(Number(v))} SKU`}
                  contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" }}
                />
                <Bar dataKey="jumlah" name="Jumlah SKU" radius={[0, 4, 4, 0]}>
                  {dataKelas.map((d) => (
                    <Cell key={d.kelas} fill={d.warna} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {produk.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada order atau stok yang bisa diklasifikasikan.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Terjual</TableHead>
                  <TableHead className="text-right">Laju/hari</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Hari persediaan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produk.slice(0, 20).map((p) => (
                  <TableRow key={p.sku}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell className="max-w-56 truncate">{p.nama ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatAngka(p.qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatAngka(p.lajuHarian)}</TableCell>
                    {/* null = data gudang tidak tersedia; 0 = benar-benar habis. */}
                    <TableCell className="text-right tabular-nums">{p.stok === null ? "—" : formatAngka(p.stok)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.hariPersediaan === null ? "—" : formatAngka(p.hariPersediaan)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
