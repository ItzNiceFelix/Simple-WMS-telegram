"use client";

// H3 Detail Produk (PRD 15, FR-READ-03; ui-spec 3.H3).
// Info produk + saldo stok + timeline pergerakan kode ini (limit 20).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, History, PackageX, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { DialogKoreksiStok } from "@/components/dashboard/dialog-koreksi-stok";
import { DialogEditHpp } from "@/components/dashboard/dialog-edit-hpp";
import { DialogEditReorder } from "@/components/dashboard/dialog-edit-reorder";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAngka, formatDelta, formatRupiah, formatTanggal, statusStok } from "@/lib/dashboard/format";
import { useData, useRole } from "@/lib/dashboard/sumber-data";
import type { MovementDoc, ProdukDoc } from "@/lib/dashboard/types";
import type { ProdukDetail } from "@/lib/dashboard/data";

export default function HalamanDetailProduk() {
  return (
    <ButuhAkses href="/stok">
      <DetailProduk />
    </ButuhAkses>
  );
}

function DetailProduk() {
  const params = useParams<{ kode: string }>();
  const kode = decodeURIComponent(params?.kode ?? "");
  const data = useData();
  const role = useRole();
  const bolehKoreksi = role === "owner" || role === "admin";
  const bolehHpp = role === "owner";

  const [detail, setDetail] = useState<ProdukDetail | null>(null);
  const [hilang, setHilang] = useState(false);
  const [error, setError] = useState(false);
  const [movements, setMovements] = useState<MovementDoc[] | null>(null);
  const [errorMovements, setErrorMovements] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [dialogHpp, setDialogHpp] = useState(false);
  const [dialogReorder, setDialogReorder] = useState(false);

  const muat = useCallback(async () => {
    setError(false);
    setHilang(false);
    setErrorMovements(false);
    setDetail(null);
    setMovements(null);
    try {
      const d = await data.getProduk(kode);
      if (!d) {
        setHilang(true);
        return;
      }
      setDetail(d);
    } catch {
      setError(true);
      return;
    }
    try {
      setMovements(await data.listMovements({ kode_barang: kode, limit: 20 }));
    } catch {
      setErrorMovements(true);
      setMovements([]);
    }
  }, [data, kode]);

  useEffect(() => {
    void muat();
  }, [muat]);

  if (hilang) {
    return (
      <>
        <PageHeader judul="Detail Produk" deskripsi={`Kode: ${kode}`} />
        <Empty className="border border-dashed" data-testid="produk-tidak-ada">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageX aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Produk tidak ditemukan</EmptyTitle>
            <EmptyDescription>
              Kode <span className="font-medium text-foreground">{kode}</span> tidak ada di katalog
              online.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" nativeButton={false} render={<Link href="/stok" />}>
              <ArrowLeft data-icon="inline-start" />
              Kembali ke Stok
            </Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader judul="Detail Produk" deskripsi={`Kode: ${kode}`} />
        <Alert variant="destructive" data-testid="error-produk">
          <TriangleAlert aria-hidden />
          <AlertTitle>Gagal memuat detail produk.</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            Periksa koneksi lalu coba lagi.
            <Button variant="outline" size="sm" onClick={() => void muat()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  }

  if (!detail) return <MemuatDetail kode={kode} />;

  const { produk, stok } = detail;
  const saldo = stok?.stok_gudang_online ?? null;
  const reorder = stok?.reorder_point ?? null;
  const status = statusStok(saldo, reorder);
  const hppBerbeda = produk.hpp_baru != null && produk.hpp_baru !== produk.hpp;

  return (
    <>
      <PageHeader
        judul="Detail Produk"
        deskripsi={`Kode: ${produk.kode_barang}`}
        aksi={
          <Button variant="outline" nativeButton={false} render={<Link href="/stok" />}>
            <ArrowLeft data-icon="inline-start" />
            Kembali
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <KartuInfo
          produk={produk}
          hppBerbeda={hppBerbeda}
          bolehUbahHpp={bolehHpp}
          onEditHpp={() => setDialogHpp(true)}
        />

        <Card data-testid="kartu-stok-produk">
          <CardHeader>
            <CardTitle>Stok gudang online</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="text-2xl font-semibold tabular-nums"
                data-testid="saldo-stok"
              >
                {formatAngka(saldo)}
              </span>
              <StatusBadge status={status} />
              {status === "minus" && saldo != null ? (
                <Badge variant="destructive" data-testid="badge-kurang">
                  Kurang {formatAngka(Math.abs(saldo))}
                </Badge>
              ) : null}
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Reorder point</dt>
                <dd className="tabular-nums">{formatAngka(reorder)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Pergerakan terakhir</dt>
                <dd>{formatTanggal(movements?.[0]?.created_at ?? null)}</dd>
              </div>
            </dl>
            {bolehKoreksi ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  size="lg"
                  className="h-11 w-full md:h-9 md:w-auto"
                  data-testid="buka-dialog-koreksi"
                  onClick={() => setDialog(true)}
                >
                  Koreksi
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 w-full md:h-9 md:w-auto"
                  data-testid="buka-dialog-reorder"
                  onClick={() => setDialogReorder(true)}
                >
                  Edit Reorder
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="timeline-produk">
          <CardHeader>
            <CardTitle>Pergerakan terakhir</CardTitle>
          </CardHeader>
          <CardContent>
            {movements === null ? (
              <div className="flex flex-col gap-3" aria-busy>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : errorMovements ? (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertTitle>Gagal memuat pergerakan.</AlertTitle>
                <AlertDescription>Riwayat pergerakan tidak bisa diambil saat ini.</AlertDescription>
              </Alert>
            ) : movements.length === 0 ? (
              <Empty data-testid="empty-timeline">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <History aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>Belum ada pergerakan untuk produk ini.</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col">
                {movements.map((m, i) => (
                  <li key={m.id}>
                    {i > 0 ? <Separator /> : null}
                    <div className="flex flex-col gap-1 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{m.type}</Badge>
                          <span className="text-xs text-muted-foreground">{m.status}</span>
                          <span className="text-xs text-muted-foreground">{m.source}</span>
                        </div>
                        <span
                          className={
                            m.qty != null && m.qty < 0
                              ? "font-medium tabular-nums text-destructive"
                              : "font-medium tabular-nums"
                          }
                        >
                          {formatDelta(m.qty)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{formatTanggal(m.created_at)}</span>
                        <span>{m.created_by_name ?? m.created_by ?? "—"}</span>
                        {m.catatan ? (
                          <span className="truncate" title={m.catatan}>
                            Catatan: {m.catatan}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <DialogKoreksiStok
        open={dialog}
        onOpenChange={setDialog}
        kode={produk.kode_barang}
        nama={produk.nama_accurate}
        stokSekarang={saldo}
        onSukses={() => void muat()}
      />

      {bolehHpp ? (
        <DialogEditHpp
          open={dialogHpp}
          onOpenChange={setDialogHpp}
          produk={produk}
          onSukses={() => void muat()}
        />
      ) : null}

      {bolehKoreksi ? (
        <DialogEditReorder
          open={dialogReorder}
          onOpenChange={setDialogReorder}
          kode={produk.kode_barang}
          nama={produk.nama_accurate}
          saldo={saldo}
          reorderSekarang={reorder}
          onSukses={() => void muat()}
        />
      ) : null}
    </>
  );
}

function KartuInfo({
  produk,
  hppBerbeda,
  bolehUbahHpp,
  onEditHpp,
}: {
  produk: ProdukDoc;
  hppBerbeda: boolean;
  bolehUbahHpp: boolean;
  onEditHpp: () => void;
}) {
  return (
    <Card data-testid="kartu-info-produk">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{produk.nama_accurate}</CardTitle>
          <p className="text-xs text-muted-foreground">{produk.kode_barang}</p>
        </div>
        {bolehUbahHpp ? (
          <Button
            variant="outline"
            size="lg"
            className="h-11 shrink-0 md:h-8"
            data-testid="buka-dialog-hpp"
            onClick={onEditHpp}
          >
            Edit HPP
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">HPP</dt>
            <dd className="tabular-nums" data-testid="nilai-hpp">{formatRupiah(produk.hpp)}</dd>
          </div>
          {hppBerbeda ? (
            <div>
              <dt className="text-xs text-muted-foreground">HPP baru</dt>
              <dd className="tabular-nums">{formatRupiah(produk.hpp_baru)}</dd>
            </div>
          ) : null}
        </dl>

        <div>
          <p className="text-xs text-muted-foreground">Varian</p>
          {produk.variants && produk.variants.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {produk.variants.map((v, i) => (
                <Badge key={`${v.variasi ?? "v"}-${i}`} variant="outline">
                  {(v.nama_shopee as string) || v.variasi || "Varian"}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Belum ada varian.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MemuatDetail({ kode }: { kode: string }) {
  return (
    <>
      <PageHeader judul="Detail Produk" deskripsi={`Kode: ${kode}`} />
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </>
  );
}
