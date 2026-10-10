"use client";

// app/laba/page.tsx — Laba per preset toko (U2/U3/U4).
// Satu preset = satu kartu upload (tag nama+status). Riwayat filter per preset. Tanggal WIB.
import { useCallback, useEffect, useState } from "react";
import { Calculator, ChartColumn, RotateCcw } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { DialogLabaShopee } from "@/components/dashboard/dialog-laba-shopee";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";

type Tolak = { no_pesanan: string; alasan: string };

type Rincian = {
  sku: string;
  unit: number;
  hppSatuan: number;
  hargaJual: number;
  marginSatuan: number;
  marginPersen: number;
  kontribusi: number;
};

type Snapshot = {
  tanggal: string;
  jml_order: number;
  jml_baris: number;
  omzet: number;
  hpp: number;
  biaya: number;
  laba: number;
  tolak: Tolak[];
  rincian: Rincian[];
  peringatan: string[];
  file: string;
};

type RingkasTanggal = { tanggal: string; jml_order: number; laba: number };

type Preset = { id: number; nama: string; status_toko: string; jml_aturan?: number };

function tanggalHariIniWib(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const LABEL_STATUS: Record<string, string> = { non_star: "Non Star", star: "Star", star_plus: "Star+" };

export default function HalamanLaba() {
  return (
    <ButuhAkses href="/laba">
      <LabaPreset />
    </ButuhAkses>
  );
}

function LabaPreset() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [presetId, setPresetId] = useState<number | null>(null);
  const [dialogPreset, setDialogPreset] = useState<Preset | null>(null);
  const [tanggal, setTanggal] = useState(tanggalHariIniWib);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [daftar, setDaftar] = useState<RingkasTanggal[] | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatPreset = useCallback(async () => {
    try {
      const res = await fetch("/api/preset", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        presets?: Preset[];
      } | null;
      if (!res.ok || !data?.ok) throw new Error("Gagal memuat preset.");
      setPresets(data.presets ?? []);
      if (data.presets && data.presets.length > 0) {
        setPresetId((lama) => lama ?? data.presets![0].id);
      }
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat preset.");
    }
  }, []);

  const muatDaftar = useCallback(async (pid: number) => {
    try {
      const res = await fetch(`/api/laba?aksi=list&presetId=${pid}&limit=30`, { credentials: "include" });
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

  const muatSnapshot = useCallback(async (pid: number, tgl: string) => {
    setMemuat(true);
    setError(null);
    try {
      const res = await fetch(`/api/laba?aksi=muat&presetId=${pid}&tanggal=${encodeURIComponent(tgl)}`, {
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
    void muatPreset();
  }, [muatPreset]);

  useEffect(() => {
    if (presetId) {
      void muatDaftar(presetId);
      if (tanggal) void muatSnapshot(presetId, tanggal);
    }
  }, [presetId, tanggal, muatDaftar, muatSnapshot]);

  const sesudahSukses = useCallback(() => {
    if (presetId) {
      void muatDaftar(presetId);
      if (tanggal) void muatSnapshot(presetId, tanggal);
    }
  }, [muatDaftar, muatSnapshot, presetId, tanggal]);

  const presetAktif = presets?.find((p) => p.id === presetId) ?? null;
  const margin = snapshot && snapshot.omzet > 0 ? (snapshot.laba / snapshot.omzet) * 100 : 0;

  return (
    <>
      <PageHeader
        judul="Laba"
        deskripsi="Estimasi laba Shopee per preset toko — standalone, tak pengaruhi stok."
        aksi={
          <div className="flex gap-2">
            <Button
              size="lg"
              variant="outline"
              className="h-11 md:h-8"
              data-testid="muat-ulang-laba"
              onClick={() => {
                if (presetId) {
                  void muatDaftar(presetId);
                  if (tanggal) void muatSnapshot(presetId, tanggal);
                }
              }}
            >
              <RotateCcw data-icon="inline-start" />
              Muat ulang
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        {presets === null ? (
          <div className="space-y-2" aria-label="Memuat preset">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : presets.length === 0 ? (
          <Empty data-testid="laba-tanpa-preset">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartColumn />
              </EmptyMedia>
              <EmptyTitle>Belum ada preset toko</EmptyTitle>
              <EmptyDescription>
                Buat preset toko dulu di <a className="font-medium underline" href="/pengaturan">Pengaturan</a> sebelum menghitung laba.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {presets.map((p) => (
                <Card key={p.id} data-testid={`kartu-preset-${p.id}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span data-testid={`tag-preset-${p.id}`}>{p.nama}</span>
                    </CardTitle>
                    <CardDescription>
                      {LABEL_STATUS[p.status_toko] ?? p.status_toko} · {p.jml_aturan ?? 0} aturan
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex gap-2">
                    <Button
                      size="lg"
                      variant={p.id === presetId ? "default" : "outline"}
                      className="h-11 md:h-8"
                      data-testid={`pilih-file-${p.id}`}
                      onClick={() => setDialogPreset(p)}
                    >
                      <Calculator data-icon="inline-start" />
                      Pilih file
                    </Button>
                    <Button
                      size="lg"
                      variant="ghost"
                      className="h-11 md:h-8"
                      data-testid={`lihat-preset-${p.id}`}
                      onClick={() => setPresetId(p.id)}
                    >
                      Lihat
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-full sm:max-w-52">
                <FieldLabel htmlFor="filter-preset-laba">Preset</FieldLabel>
                <Select
                  value={presetId ? String(presetId) : ""}
                  onValueChange={(v) => typeof v === "string" && v && setPresetId(Number(v))}
                >
                  <SelectTrigger id="filter-preset-laba" className="h-11 w-full md:h-8" data-testid="filter-preset-laba">
                    <SelectValue>{presetAktif?.nama ?? "Pilih preset"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {presets.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.nama} ({LABEL_STATUS[p.status_toko] ?? p.status_toko})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
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
                    Preset {presetAktif?.nama ?? ""} tanggal {tanggal} belum dihitung. Tekan{" "}
                    <button
                      type="button"
                      className="font-medium underline"
                      onClick={() => presetAktif && setDialogPreset(presetAktif)}
                    >
                      Pilih file
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
                  {presetAktif?.nama ?? ""} · {snapshot.jml_baris} baris · {snapshot.file || "tanpa nama file"}
                  {snapshot.tolak.length > 0 ? (
                    <>
                      {" · "}
                      <span className="font-medium text-red-600">
                        {snapshot.tolak.length} order ditolak hitung
                      </span>
                    </>
                  ) : null}
                </p>
                {snapshot.peringatan.length > 0 ? (
                  <Alert data-testid="peringatan-laba">
                    <AlertTitle>Peringatan hitung</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc space-y-1 pl-4">
                        {snapshot.peringatan.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                ) : null}
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
                {(snapshot.rincian?.length ?? 0) > 0 ? (
                  <div data-testid="rincian-sku-laba">
                    <h2 className="mb-1 text-sm font-semibold">Rincian SKU Terjual</h2>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Urut kontribusi margin terbesar. Harga jual = info (tak masuk hitung); patokan = dasar resmi (Harga Awal − diskon/voucher penjual).
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead>
                          <tr className="bg-muted text-left text-xs text-muted-foreground">
                            <th className="px-3 py-2 font-medium">SKU Master</th>
                            <th className="px-3 py-2 text-right font-medium">Unit Terjual</th>
                            <th className="px-3 py-2 text-right font-medium">HPP / Unit</th>
                            <th className="px-3 py-2 text-right font-medium">Harga Jual / Unit</th>
                            <th className="px-3 py-2 text-right font-medium">Est. Margin / Unit</th>
                            <th className="px-3 py-2 text-right font-medium">Total Kontribusi Margin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {snapshot.rincian.map((r) => (
                            <tr key={r.sku} className="border-t border-border tabular-nums" data-testid={`rincian-${r.sku}`}>
                              <td className="px-3 py-2 font-medium">{r.sku}</td>
                              <td className="px-3 py-2 text-right">{formatAngka(r.unit)}</td>
                              <td className="px-3 py-2 text-right">{formatRupiah(r.hppSatuan)}</td>
                              <td className="px-3 py-2 text-right">{r.hargaJual > 0 ? formatRupiah(r.hargaJual) : "—"}</td>
                              <td className="px-3 py-2 text-right">
                                {formatRupiah(r.marginSatuan)} ({formatAngka(Math.round(r.marginPersen * 10) / 10)}%)
                              </td>
                              <td className="px-3 py-2 text-right font-semibold">{formatRupiah(r.kontribusi)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
      {dialogPreset ? (
        <DialogLabaShopee
          open={dialogPreset !== null}
          onOpenChange={(v) => {
            if (!v) setDialogPreset(null);
          }}
          preset={dialogPreset}
          onSukses={() => {
            setPresetId(dialogPreset.id);
            sesudahSukses();
          }}
        />
      ) : null}
    </>
  );
}

function Kartu({ label, nilai }: { label: string; nilai: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{nilai}</p>
      </CardContent>
    </Card>
  );
}
