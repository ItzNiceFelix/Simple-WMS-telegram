"use client";

// components/dashboard/input-iklan.tsx — Biaya iklan harian manual per preset (U-M4 K-2).
// Form tanggal + rupiah + ringkasan bulanan (total iklan vs omzet snapshot).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatRupiah } from "@/lib/dashboard/format";

type Harian = { tanggal: string; biaya_iklan_bersih: number };
type Ringkas = {
  ok: boolean; bulan: string; harian: Harian[]; totalIklan: number; omzet: number; rasio: number | null;
};

function bulanIniWib(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(new Date());
}

function tanggalHariIniWib(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function InputIklan({ presetId, bolehUbah }: { presetId: number; bolehUbah: boolean }) {
  const [bulan, setBulan] = useState(bulanIniWib);
  const [data, setData] = useState<Ringkas | null>(null);
  const [tanggal, setTanggal] = useState(tanggalHariIniWib);
  const [biaya, setBiaya] = useState("");
  const [mengirim, setMengirim] = useState(false);

  const muat = useCallback(async () => {
    setData(null);
    try {
      const res = await fetch(`/api/ads?presetId=${presetId}&bulan=${bulan}`, { credentials: "include" });
      const d = (await res.json().catch(() => null)) as (Ringkas & { error?: string }) | null;
      if (!res.ok || !d?.ok) throw new Error("Gagal memuat iklan.");
      setData(d);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat iklan.");
    }
  }, [presetId, bulan]);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function simpan() {
    const n = Number(biaya.trim().replace(/\./g, "").replace(",", "."));
    if (biaya.trim() === "" || !Number.isFinite(n) || n < 0) {
      toast.error("Biaya harus angka ≥ 0.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
      toast.error("Tanggal harus YYYY-MM-DD.");
      return;
    }
    setMengirim(true);
    try {
      const res = await fetch("/api/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ presetId, tanggal, biaya: Math.round(n) }),
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal (${res.status}).`);
      toast.success("Biaya iklan disimpan.");
      setBiaya("");
      await muat();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setMengirim(false);
    }
  }

  async function hapus(tgl: string) {
    if (!window.confirm(`Hapus biaya iklan ${tgl}?`)) return;
    setMengirim(true);
    try {
      const res = await fetch(`/api/ads?presetId=${presetId}&tanggal=${tgl}`, {
        method: "DELETE",
        credentials: "include",
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal (${res.status}).`);
      toast.success("Dihapus.");
      await muat();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghapus.");
    } finally {
      setMengirim(false);
    }
  }

  return (
    <Card data-testid={`iklan-preset-${presetId}`}>
      <CardHeader>
        <CardTitle className="text-base">Biaya iklan harian</CardTitle>
        <CardDescription>
          Input manual (K-2). Dibutuhkan program bersyarat iklan (min 3% dari penjualan).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data === null ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-3 gap-2 text-sm" data-testid="ringkas-iklan-bulanan">
            <div className="rounded-lg border border-border p-2">
              <p className="text-xs text-muted-foreground">Iklan {data.bulan}</p>
              <p className="font-semibold tabular-nums">{formatRupiah(data.totalIklan)}</p>
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="text-xs text-muted-foreground">Omzet {data.bulan}</p>
              <p className="font-semibold tabular-nums">{formatRupiah(data.omzet)}</p>
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="text-xs text-muted-foreground">Rasio</p>
              <p className="font-semibold tabular-nums">{data.rasio === null ? "—" : `${data.rasio}%`}</p>
            </div>
          </div>
        )}
        {bolehUbah ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-40">
              <FieldLabel htmlFor={`iklan-tanggal-${presetId}`}>Tanggal</FieldLabel>
              <Input
                id={`iklan-tanggal-${presetId}`}
                type="date"
                className="h-11 md:h-8"
                data-testid="tanggal-iklan"
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
                disabled={mengirim}
              />
            </Field>
            <Field className="min-w-40 flex-1">
              <FieldLabel htmlFor={`iklan-biaya-${presetId}`}>Biaya bersih (Rp)</FieldLabel>
              <Input
                id={`iklan-biaya-${presetId}`}
                inputMode="numeric"
                className="h-11 md:h-8"
                data-testid="biaya-iklan"
                value={biaya}
                onChange={(e) => setBiaya(e.target.value)}
                placeholder="cth. 50000"
                disabled={mengirim}
              />
            </Field>
            <Button className="h-11 md:h-8" data-testid="simpan-iklan" onClick={() => void simpan()} disabled={mengirim}>
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              Simpan
            </Button>
          </div>
        ) : null}
        {(data?.harian.length ?? 0) > 0 ? (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {data!.harian.map((h) => (
              <li key={h.tanggal} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                <span className="tabular-nums">{h.tanggal} · {formatRupiah(h.biaya_iklan_bersih)}</span>
                {bolehUbah ? (
                  <Button size="sm" variant="ghost" className="h-7" disabled={mengirim} onClick={() => void hapus(h.tanggal)}>
                    Hapus
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <Input
            type="month"
            className="h-8 w-44"
            aria-label="Bulan ringkasan"
            value={bulan}
            onChange={(e) => setBulan(e.target.value || bulanIniWib())}
          />
        </div>
      </CardContent>
    </Card>
  );
}
