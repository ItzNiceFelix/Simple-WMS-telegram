"use client";

// H1 Ringkasan (PRD 15, FR-READ-01, 13.6, 20, 21; ui-spec 3.H1).
// Kartu draft & permintaan hanya dirender bila nilainya bukan null: mock/real
// mengembalikan null untuk guest karena Rules melarang guest membaca koleksi itu
// (PRD 15 catatan E2). Tidak ada cabang role di UI — nullability yang menentukan.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, History, PackageSearch, PackageX, TriangleAlert } from "lucide-react";

import { cn } from "cn";
import { PageHeader } from "@/components/dashboard/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAngka, formatDelta, formatTanggal } from "@/lib/dashboard/format";
import { useData } from "@/lib/dashboard/sumber-data";
import type { MovementDoc, RingkasanData, StockRow } from "@/lib/dashboard/types";

export default function HalamanRingkasan() {
  const data = useData();
  const [ringkasan, setRingkasan] = useState<RingkasanData | null>(null);
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [movements, setMovements] = useState<MovementDoc[] | null>(null);
  const [error, setError] = useState(false);

  const muat = useCallback(async () => {
    setError(false);
    setRingkasan(null);
    setStock(null);
    setMovements(null);
    try {
      const [r, s, m] = await Promise.all([
        data.getRingkasan(),
        data.listStock(),
        data.listMovements({ limit: 10 }),
      ]);
      setRingkasan(r);
      setStock(s);
      setMovements(m);
    } catch {
      setError(true);
    }
  }, [data]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const minus = useMemo(
    () =>
      (stock ?? [])
        .filter((r) => (r.stok_gudang_online ?? 0) < 0)
        .sort((a, b) => b.kekurangan - a.kekurangan),
    [stock]
  );
  const menipis = useMemo(
    () => (stock ?? []).filter((r) => r.status === "menipis").slice(0, 10),
    [stock]
  );

  return (
    <>
      <PageHeader
        judul="Ringkasan"
        deskripsi="Kondisi stok dan aktivitas terakhir toko."
      />

      <div className="flex flex-col gap-6" data-testid="h1-ringkasan">
        {error ? (
          <Alert variant="destructive" data-testid="error-ringkasan">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat ringkasan. Coba lagi.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              Ringkasan tidak bisa diambil saat ini.
              <Button variant="outline" size="sm" onClick={() => void muat()}>
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : !ringkasan || !stock || !movements ? (
          <Memuat />
        ) : (
          <>
            <BlokKartu ringkasan={ringkasan} />

            <Blok
              id="blok-minta-gudang"
              judul="Perlu Minta Gudang Cabang"
              deskripsi="Produk dengan stok online di bawah nol, urut kekurangan terbesar."
              aksi={
                minus.length > 0 ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-11 md:h-7"
                    nativeButton={false}
                    render={<Link href="/stok" />}
                  >
                    Lihat semua
                    <ChevronRight data-icon="inline-end" />
                  </Button>
                ) : null
              }
            >
              {minus.length === 0 ? (
                <Empty className="border border-dashed" data-testid="empty-minta-gudang">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PackageX aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>Tidak ada produk minus.</EmptyTitle>
                    <EmptyDescription>
                      Semua produk online masih punya saldo cukup.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="flex flex-col">
                  {minus.slice(0, 5).map((r, i) => (
                    <li key={r.kode_barang} data-testid={`baris-minus-${r.kode_barang}`}>
                      {i > 0 ? <Separator /> : null}
                      <div className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <Link
                            href={`/produk/${encodeURIComponent(r.kode_barang)}`}
                            className="block truncate font-medium hover:underline"
                            title={r.nama_accurate ?? r.kode_barang}
                          >
                            {r.nama_accurate ?? r.kode_barang}
                          </Link>
                          <p className="text-xs text-muted-foreground">{r.kode_barang}</p>
                        </div>
                        <Badge variant="destructive" className="tabular-nums">
                          Kurang {formatAngka(r.kekurangan)}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Blok>

            <Blok
              id="blok-menipis"
              judul="Stok Menipis"
              deskripsi="Produk dengan saldo di bawah reorder point."
            >
              {menipis.length === 0 ? (
                <Empty className="border border-dashed" data-testid="empty-menipis">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PackageSearch aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>Tidak ada produk menipis.</EmptyTitle>
                    <EmptyDescription>
                      Semua produk online berada di atas reorder point.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="flex flex-col">
                  {menipis.map((r, i) => (
                    <li key={r.kode_barang} data-testid={`baris-menipis-${r.kode_barang}`}>
                      {i > 0 ? <Separator /> : null}
                      <div className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <Link
                            href={`/produk/${encodeURIComponent(r.kode_barang)}`}
                            className="block truncate font-medium hover:underline"
                            title={r.nama_accurate ?? r.kode_barang}
                          >
                            {r.nama_accurate ?? r.kode_barang}
                          </Link>
                          <p className="text-xs text-muted-foreground">{r.kode_barang}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-medium tabular-nums">
                            {formatAngka(r.stok_gudang_online)}
                          </p>
                          {r.reorder_point != null ? (
                            <p className="text-xs text-muted-foreground">
                              Reorder {formatAngka(r.reorder_point)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Blok>

            <Blok
              id="blok-pergerakan"
              judul="Pergerakan Terakhir"
              deskripsi="10 pergerakan stok terbaru."
            >
              {movements.length === 0 ? (
                <Empty className="border border-dashed" data-testid="empty-pergerakan">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <History aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>Belum ada pergerakan.</EmptyTitle>
                    <EmptyDescription>
                      Pergerakan stok akan tampil di sini setelah ada perubahan.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="flex flex-col">
                  {movements.map((m, i) => {
                    const negatif = m.qty != null && m.qty < 0;
                    return (
                      <li key={m.id} data-testid={`baris-pergerakan-${m.id}`}>
                        {i > 0 ? <Separator /> : null}
                        <div className="flex items-start justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <Link
                              href={`/produk/${encodeURIComponent(m.kode_barang)}`}
                              className="block truncate font-medium hover:underline"
                              title={m.nama_terbaca ?? m.kode_barang}
                            >
                              {m.nama_terbaca ?? m.kode_barang}
                            </Link>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              <span>{formatTanggal(m.created_at)}</span>
                              <span>{m.created_by_name ?? m.created_by ?? "—"}</span>
                            </div>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 font-medium tabular-nums",
                              negatif && "text-destructive"
                            )}
                            data-testid={`delta-${m.id}`}
                          >
                            {formatDelta(m.qty)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Blok>
          </>
        )}
      </div>
    </>
  );
}

// Mock menyimpan qty sebagai magnitudo (bukan signed seperti kontrak tipe),
// tetapi H1 tampilkan apa adanya — sama seperti H4 (app/histori/page.tsx) yang
// memakai formatDelta(m.qty) langsung. Menormalkan tanda di sini akan membuat
// H1 dan H4 tidak konsisten untuk baris yang sama. Perbaikan tipe = di mock.
function BlokKartu({ ringkasan }: { ringkasan: RingkasanData }) {
  if (ringkasan.totalProdukOnline === 0) {
    return (
      <section className="flex flex-col gap-3" aria-labelledby="statistik-judul">
        <h2 id="statistik-judul" className="sr-only">
          Statistik stok
        </h2>
        <Empty className="border border-dashed" data-testid="empty-kartu">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageSearch aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Belum ada data stok.</EmptyTitle>
            <EmptyDescription>
              Produk online akan muncul di ringkasan setelah katalog terisi.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="statistik-judul">
      <h2 id="statistik-judul" className="sr-only">
        Statistik stok
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        <KartuStat
          testId="kartu-total-produk"
          label="Total Produk Online"
          nilai={ringkasan.totalProdukOnline}
          keterangan="Produk aktif online"
        />
        <KartuStat
          testId="kartu-menipis"
          label="Menipis"
          nilai={ringkasan.itemMenipis}
          keterangan="Di bawah reorder point"
        />
        <KartuStat
          testId="kartu-minus"
          label="Stok Minus"
          nilai={ringkasan.itemMinus}
          keterangan="Perlu minta gudang cabang"
          href="/stok"
        />
        {ringkasan.draftPending !== null ? (
          <KartuStat
            testId="kartu-draft"
            label="Draft Pending"
            nilai={ringkasan.draftPending}
            keterangan="Menunggu konfirmasi"
            href="/draft"
          />
        ) : null}
        {ringkasan.permintaanHariIni !== null ? (
          <KartuStat
            testId="kartu-permintaan"
            label="Permintaan Hari Ini"
            nilai={ringkasan.permintaanHariIni}
            keterangan="Item diminta"
            href="/permintaan"
          />
        ) : null}
      </div>
    </section>
  );
}

function KartuStat({
  testId,
  label,
  nilai,
  keterangan,
  href,
}: {
  testId: string;
  label: string;
  nilai: number;
  keterangan: string;
  href?: string;
}) {
  // Aksen merah khusus kartu Stok Minus (token status minus, bukan warna hardcode).
  const aksen = testId === "kartu-minus";

  const isi = (
    <Card
      size="sm"
      className={cn(
        "h-full",
        aksen && "border-s-4 border-s-status-minus ring-status-minus/60 dark:ring-status-minus/70"
      )}
    >
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {aksen ? <TriangleAlert aria-hidden className="text-status-minus-fg" /> : null}
          <span>{label}</span>
        </div>
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums",
            aksen && "text-status-minus-fg"
          )}
        >
          {formatAngka(nilai)}
        </span>
        <span className="text-xs text-muted-foreground">{keterangan}</span>
      </CardContent>
    </Card>
  );

  if (!href) {
    return (
      <div data-testid={testId} className="h-full">
        {isi}
      </div>
    );
  }

  return (
    <Link
      href={href}
      data-testid={testId}
      className="block h-full rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {isi}
    </Link>
  );
}

function Blok({
  id,
  judul,
  deskripsi,
  aksi,
  children,
}: {
  id: string;
  judul: string;
  deskripsi: string;
  aksi?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${id}-judul`} data-testid={id}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`${id}-judul`} className="text-base font-semibold">
            {judul}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{deskripsi}</p>
        </div>
        {aksi}
      </div>
      <Card>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

function Memuat() {
  return (
    <div className="flex flex-col gap-6" data-testid="loading-ringkasan" aria-busy>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}
