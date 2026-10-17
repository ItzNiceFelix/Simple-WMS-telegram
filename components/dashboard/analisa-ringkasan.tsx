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
  tanggalDipakai?: string[];
  komposisiBiaya?: { label: string; nilai: number; persen: number | null }[];
  produk?: BarisProdukTren[];
  hariBerdata?: number;
};

/** Opsi rentang yang bisa dipilih. Sama dengan yang diterima server (7/14/30). */
const PILIHAN_RENTANG = [7, 14, 30] as const;

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
  const [data, setData] = useState<ResponsTren | null>(null);
  const [memuat, setMemuat] = useState(false);

  // `data` diganti seluruhnya tiap fetch, jadi identitasnya cukup sebagai dependensi.
  const { adaHarian, dataHarian } = useMemo(() => {
    const seri = data?.seri ?? [];
    return {
      adaHarian: seri.some((t) => t !== null),
      dataHarian: seri.map((t) => ({
        // Tanggal penuh untuk tooltip; label sumbu X cukup dua digit hari supaya 30 titik
        // tidak bertumpuk. Titik null tetap punya label tanggal agar celahnya terbaca.
        tanggal: t?.tanggal ?? "",
        label: t ? t.tanggal.slice(8, 10) : "",
        omzet: t ? t.omzet : null,
        laba: t ? t.laba : null,
      })),
    };
  }, [data]);

  useEffect(() => {
    if (!presetId || !tanggal) return;
    let batal = false;
    setMemuat(true);
    (async () => {
      try {
        const q = new URLSearchParams({
          aksi: "tren", presetId: String(presetId), tanggal, rentang: String(rentang),
        });
        const res = await fetch(`/api/analisa?${q.toString()}`, { credentials: "include" });
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
  }, [presetId, tanggal, rentang]);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Rentang</span>
        {PILIHAN_RENTANG.map((r) => (
          <Button
            key={r}
            type="button"
            size="sm"
            variant={rentang === r ? "default" : "outline"}
            onClick={() => setRentang(r)}
            data-testid={`rentang-${r}`}
          >
            {r} hari
          </Button>
        ))}
        {data.dari && data.sampai ? (
          <span className="text-xs text-muted-foreground">{data.dari} s/d {data.sampai}</span>
        ) : null}
      </div>

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
                Berdasarkan jam pesanan dibuat. Hanya hari yang snapshot-nya sudah lewat satu
                hari yang dipakai: {tanggalDipakai.length > 0
                  ? tanggalDipakai.join(", ")
                  : "belum ada hari yang memenuhi syarat"}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.perJam ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                    <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                    <YAxis tickFormatter={rupiahPendek} width={56} tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-xs" />
                    <Tooltip
                      formatter={(v) => formatRupiah(Number(v))}
                      // Tanggal penuh ada di payload, bukan di label sumbu (label = dua digit hari).
                      labelFormatter={(_l, isi) => {
                        // Payload recharts bertipe readonly; cast lewat unknown supaya hanya
                        // bentuk yang kita baca yang dinyatakan, bukan memaksa tipe library.
                        const t = (isi as unknown as { payload?: { tanggal?: string } }[] | undefined)?.[0]?.payload?.tanggal;
                        // Kosong = titik null (hari tanpa snapshot): dikatakan apa adanya.
                        return t ? t.slice(0, 10) : "tanpa data";
                      }}
                      contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" }}
                    />
                    <Line type="monotone" dataKey="omzet" name="Omzet" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} connectNulls={false} />
                    <Line type="monotone" dataKey="laba" name="Laba" stroke="var(--color-chart-2)" strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
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
          <CardDescription>Hanya tiga kelompok yang benar-benar bisa dipisah dari data yang ada.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(data.komposisiBiaya ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada biaya tercatat pada rentang ini.</p>
          ) : (
            (data.komposisiBiaya ?? []).map((b) => {
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
