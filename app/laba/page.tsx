"use client";

// app/laba/page.tsx — Rekap laba order (Fase 3a).
// Fetch LANGSUNG /api/order?aksi=rekap (kontrak DataSource beku Wave 3a).
import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChartColumn, FileDown, FileType, RotateCcw } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field, FieldLabel } from "@/components/ui/field";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";
import type { OrderDetail } from "@/lib/d1/order";

type RincianOrder = OrderDetail & { laba: number; margin: number; omzet: number };
type Agregat = {
  order: number;
  omzet: number;
  hpp: number;
  biaya: number;
  pph: number;
  ppn: number;
  laba: number;
  margin: number;
};

/** Unduh rekap sebagai CSV di klien (sumber data = GET rekap). */
function unduhCsv(orders: RincianOrder[]): void {
  const baris = [
    "NoPesanan,Marketplace,Tanggal,Buyer,Status,Omzet,Laba,Margin%",
    ...orders.map((o) =>
      [
        o.no_pesanan,
        o.marketplace,
        new Date(o.tanggal * 1000).toISOString().slice(0, 10),
        `"${o.buyer.replaceAll('"', '""')}"`,
        o.status_fulfill,
        o.omzet,
        o.laba,
        o.margin.toFixed(1),
      ].join(",")
    ),
  ];
  const url = URL.createObjectURL(new Blob([baris.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "rekap-laba.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function HalamanLaba() {
  return (
    <ButuhAkses href="/laba">
      <RekapLaba />
    </ButuhAkses>
  );
}

function RekapLaba() {
  const [orders, setOrders] = useState<RincianOrder[] | null>(null);
  const [agregat, setAgregat] = useState<Agregat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");
  const [mp, setMp] = useState("");
  const [sku, setSku] = useState("");
  const mpTertunda = useDeferredValue(mp.trim().toLowerCase());
  const skuTertunda = useDeferredValue(sku.trim().toUpperCase());

  const muat = useCallback(async () => {
    setError(null);
    setOrders(null);
    try {
      const q = new URLSearchParams({ aksi: "rekap", limit: "500" });
      if (dari) q.set("dari", dari);
      if (sampai) q.set("sampai", sampai);
      if (mpTertunda) q.set("mp", mpTertunda);
      if (skuTertunda) q.set("sku", skuTertunda);
      const res = await fetch(`/api/order?${q}`, { credentials: "include" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        orders?: RincianOrder[];
        agregat?: Agregat;
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      setOrders(data.orders ?? []);
      setAgregat(data.agregat ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat rekap.");
    }
  }, [dari, sampai, mpTertunda, skuTertunda]);

  useEffect(() => {
    void muat();
  }, [muat]);

  return (
    <>
      <PageHeader
        judul="Laba"
        deskripsi="Rekap omzet, biaya, pajak, dan laba pesanan."
        aksi={
          <div className="flex gap-2">
            <Button
              size="lg"
              variant="outline"
              className="h-11 md:h-8"
              data-testid="muat-ulang-laba"
              onClick={() => void muat()}
            >
              <RotateCcw data-icon="inline-start" />
              Muat ulang
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 md:h-8"
              data-testid="export-laba"
              disabled={!orders || orders.length === 0}
              onClick={() => {
                if (orders) {
                  unduhCsv(orders);
                  toast.success("Rekap laba diunduh (CSV).");
                }
              }}
            >
              <FileDown data-icon="inline-start" />
              Export
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 md:h-8"
              data-testid="export-laba-pdf"
              disabled={!orders || orders.length === 0}
              onClick={() => {
                const q = new URLSearchParams({ aksi: "pdf", limit: "500" });
                if (dari) q.set("dari", dari);
                if (sampai) q.set("sampai", sampai);
                if (mpTertunda) q.set("mp", mpTertunda);
                if (skuTertunda) q.set("sku", skuTertunda);
                window.open(`/api/order?${q}`, "_blank");
              }}
            >
              <FileType data-icon="inline-start" />
              Export PDF
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-full sm:max-w-44">
            <FieldLabel htmlFor="filter-dari-laba">Dari</FieldLabel>
            <Input
              id="filter-dari-laba"
              type="date"
              className="h-11 md:h-8"
              data-testid="filter-dari-laba"
              value={dari}
              onChange={(e) => setDari(e.target.value)}
            />
          </Field>
          <Field className="w-full sm:max-w-44">
            <FieldLabel htmlFor="filter-sampai-laba">Sampai</FieldLabel>
            <Input
              id="filter-sampai-laba"
              type="date"
              className="h-11 md:h-8"
              data-testid="filter-sampai-laba"
              value={sampai}
              onChange={(e) => setSampai(e.target.value)}
            />
          </Field>
          <Field className="w-full sm:max-w-44">
            <FieldLabel htmlFor="filter-mp-laba">Marketplace</FieldLabel>
            <Input
              id="filter-mp-laba"
              className="h-11 md:h-8"
              data-testid="filter-mp-laba"
              placeholder="cth. shopee"
              value={mp}
              onChange={(e) => setMp(e.target.value)}
            />
          </Field>
          <Field className="w-full sm:max-w-44">
            <FieldLabel htmlFor="filter-sku-laba">SKU</FieldLabel>
            <Input
              id="filter-sku-laba"
              className="h-11 md:h-8"
              data-testid="filter-sku-laba"
              placeholder="cth. BRG-001"
              value={sku}
              onChange={(e) => setSku(e.target.value.toUpperCase())}
            />
          </Field>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Gagal memuat</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : orders === null || agregat === null ? (
          <div className="space-y-2" aria-label="Memuat rekap">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="kartu-agregat-laba">
              <Kartu label="Omzet" nilai={formatRupiah(agregat.omzet)} />
              <Kartu label="HPP" nilai={formatRupiah(agregat.hpp)} />
              <Kartu label="Biaya MP" nilai={formatRupiah(agregat.biaya)} />
              <Kartu label="Pajak (PPh+PPN)" nilai={formatRupiah(agregat.pph + agregat.ppn)} />
              <Kartu label="Laba" nilai={formatRupiah(agregat.laba)} />
              <Kartu label="Margin" nilai={`${formatAngka(Math.round(agregat.margin * 10) / 10)}%`} />
              <Kartu label="Order" nilai={formatAngka(agregat.order)} />
            </div>

            {orders.length === 0 ? (
              <Empty data-testid="laba-kosong">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ChartColumn />
                  </EmptyMedia>
                  <EmptyTitle>Tidak ada data</EmptyTitle>
                  <EmptyDescription>Belum ada order cocok filter.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No Pesanan</TableHead>
                      <TableHead>MP</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Omzet</TableHead>
                      <TableHead className="text-right">Laba</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((o) => (
                      <TableRow key={`${o.marketplace}/${o.no_pesanan}`}>
                        <TableCell className="font-medium">{o.no_pesanan}</TableCell>
                        <TableCell>{o.marketplace}</TableCell>
                        <TableCell className="tabular-nums">
                          {new Date(o.tanggal * 1000).toISOString().slice(0, 10)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{o.status_fulfill}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(o.omzet)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(o.laba)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatAngka(Math.round(o.margin * 10) / 10)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Kartu({ label, nilai }: { label: string; nilai: string }) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-lg font-semibold tabular-nums">{nilai}</div>
      </CardContent>
    </Card>
  );
}
