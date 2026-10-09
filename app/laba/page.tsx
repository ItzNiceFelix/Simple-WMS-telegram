"use client";

// app/laba/page.tsx — Estimasi laba Shopee standalone (tak terhubung tab Order, tak sentuh stok).
// Alur: upload export shipping Shopee → hitung → Simpan Perhitungan (tanggal WIB) → load per tanggal.
// Fetch LANGSUNG /api/laba.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Calculator, ChartColumn, RotateCcw } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { DialogLabaShopee } from "@/components/dashboard/dialog-laba-shopee";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";

type Tolak = { no_pesanan: string; alasan: string };

type Snapshot = {
  tanggal: string;
  marketplace: string;
  jml_order: number;
  jml_baris: number;
  omzet: number;
  hpp: number;
  biaya: number;
  laba: number;
  tolak: Tolak[];
  file: string;
};

type RingkasTanggal = { tanggal: string; jml_order: number; laba: number };

function tanggalHariIniWib(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function HalamanLaba() {
  return (
    <ButuhAkses href="/laba">
      <LabaShopee />
    </ButuhAkses>
  );
}

function LabaShopee() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tanggal, setTanggal] = useState(tanggalHariIniWib);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [daftar, setDaftar] = useState<RingkasTanggal[] | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatDaftar = useCallback(async () => {
    try {
      const res = await fetch("/api/laba?aksi=list&limit=30", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        daftar?: RingkasTanggal[];
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      setDaftar(data.daftar ?? []);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat daftar.");
    }
  }, []);

  const muatSnapshot = useCallback(async (tgl: string) => {
    setMemuat(true);
    setError(null);
    try {
      const res = await fetch(`/api/laba?aksi=muat&tanggal=${encodeURIComponent(tgl)}`, {
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        snapshot?: Snapshot | null;
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      setSnapshot(data.snapshot ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat snapshot.");
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muatDaftar();
  }, [muatDaftar]);

  useEffect(() => {
    if (tanggal) void muatSnapshot(tanggal);
  }, [tanggal, muatSnapshot]);

  const sesudahSukses = useCallback(() => {
    void muatDaftar();
    if (tanggal) void muatSnapshot(tanggal);
  }, [muatDaftar, muatSnapshot, tanggal]);

  const margin = snapshot && snapshot.omzet > 0 ? (snapshot.laba / snapshot.omzet) * 100 : 0;

  return (
    <>
      <PageHeader
        judul="Laba"
        deskripsi="Estimasi laba Shopee per tanggal — standalone, tak pengaruhi stok."
        aksi={
          <div className="flex gap-2">
            <Button
              size="lg"
              variant="outline"
              className="h-11 md:h-8"
              data-testid="hitung-laba"
              onClick={() => setDialogOpen(true)}
            >
              <Calculator data-icon="inline-start" />
              Hitung Laba
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 md:h-8"
              data-testid="muat-ulang-laba"
              onClick={() => {
                void muatDaftar();
                if (tanggal) void muatSnapshot(tanggal);
              }}
            >
              <RotateCcw data-icon="inline-start" />
              Muat ulang
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-full sm:max-w-44">
            <FieldLabel htmlFor="filter-tanggal-laba">Tanggal (WIB)</FieldLabel>
            <Input
              id="filter-tanggal-laba"
              type="date"
              className="h-11 md:h-8"
              data-testid="filter-tanggal-laba"
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </Field>
          {daftar && daftar.length > 0 ? (
            <Field className="w-full sm:max-w-64">
              <FieldLabel htmlFor="daftar-tanggal-laba">Riwayat tersimpan</FieldLabel>
              <div id="daftar-tanggal-laba" className="flex flex-wrap gap-1.5" data-testid="daftar-tanggal-laba">
                {daftar.slice(0, 7).map((d) => (
                  <Button
                    key={d.tanggal}
                    size="sm"
                    variant={d.tanggal === tanggal ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() => setTanggal(d.tanggal)}
                    data-testid={`tanggal-${d.tanggal}`}
                  >
                    {d.tanggal.slice(5)}
                  </Button>
                ))}
              </div>
            </Field>
          ) : null}
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Gagal memuat</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : memuat ? (
          <div className="flex flex-col gap-2" aria-label="Memuat laba">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !snapshot ? (
          <Empty data-testid="laba-kosong">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartColumn />
              </EmptyMedia>
              <EmptyTitle>Belum ada perhitungan</EmptyTitle>
            <EmptyDescription>
              Tanggal {tanggal} belum dihitung. Tekan{" "}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => setDialogOpen(true)}
              >
                Hitung Laba
              </button>{" "}
              lalu Simpan Perhitungan.
            </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="kartu-agregat-laba">
              <Kartu label="Order" nilai={formatAngka(snapshot.jml_order)} />
              <Kartu label="Omzet" nilai={formatRupiah(snapshot.omzet)} />
              <Kartu label="HPP" nilai={formatRupiah(snapshot.hpp)} />
              <Kartu label="Biaya" nilai={formatRupiah(snapshot.biaya)} />
              <Kartu label="Estimasi Laba" nilai={formatRupiah(snapshot.laba)} />
              <Kartu label="Margin" nilai={`${formatAngka(Math.round(margin * 10) / 10)}%`} />
            </div>
            <p className="text-xs text-muted-foreground" data-testid="meta-laba">
              {snapshot.jml_baris} baris · {snapshot.marketplace} · {snapshot.file || "tanpa nama file"}
              {snapshot.tolak.length > 0 ? (
                <>
                  {" · "}
                  <span className="font-medium text-red-600">
                    {snapshot.tolak.length} order ditolak hitung
                  </span>
                </>
              ) : null}
            </p>
            {snapshot.tolak.length > 0 ? (
              <div data-testid="tolak-laba">
                <p className="mb-1 text-sm font-medium">Ditolak hitung (SKU kosong / tak cocok master)</p>
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-3 text-xs">
                  {snapshot.tolak.map((t) => (
                    <li key={t.no_pesanan}>
                      <span className="font-medium">{t.no_pesanan}</span>: {t.alasan}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
      <DialogLabaShopee open={dialogOpen} onOpenChange={setDialogOpen} onSukses={sesudahSukses} />
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
