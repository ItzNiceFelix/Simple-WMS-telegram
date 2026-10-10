"use client";

// components/dashboard/preset-toko.tsx — Kelola preset toko + aturan + program (U1/U-R1).
// Gantikan biaya-mp.tsx. Fetch LANGSUNG /api/preset. Owner tulis, admin baca.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Plus, RotateCcw, Trash2 } from "lucide-react";

import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { EditorPreset } from "@/components/dashboard/editor-preset";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type Preset = {
  id: number; nama: string; marketplace: string; status_toko: string; jml_aturan?: number;
};

const STATUS_OPSI = [
  { nilai: "non_star", label: "Non Star" },
  { nilai: "star", label: "Star" },
  { nilai: "star_plus", label: "Star+" },
];

export function PresetToko({ bolehUbah }: { bolehUbah: boolean }) {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [nama, setNama] = useState("");
  const [status, setStatus] = useState("non_star");
  const [terbuka, setTerbuka] = useState<number | null>(null);
  const [mengirim, setMengirim] = useState(false);

  const muat = useCallback(async () => {
    setPresets(null);
    try {
      const res = await fetch("/api/preset", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        presets?: Preset[];
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      setPresets(data.presets ?? []);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat preset.");
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function kirim(body: Record<string, unknown>, sukses: string) {
    setMengirim(true);
    try {
      const res = await fetch("/api/preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; lunak?: boolean } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      toast.success(sukses + (data.lunak ? " (soft delete: ada snapshot)." : ""));
      await muat();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setMengirim(false);
    }
  }

  async function tambah() {
    if (!nama.trim()) {
      toast.error("Nama preset wajib diisi.");
      return;
    }
    await kirim({ aksi: "tambah", nama: nama.trim(), status_toko: status }, "Preset dibuat + seed default.");
    setNama("");
  }

  return (
    <Card data-testid="kartu-preset-toko">
      <CardHeader>
        <CardTitle>Preset Toko</CardTitle>
        <CardDescription>
          Akun seller + status toko + aturan biaya sendiri. Upload /laba selalu per preset.
          {bolehUbah ? "" : " Hanya owner yang dapat mengubah."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {bolehUbah ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field className="min-w-40 flex-1">
              <FieldLabel htmlFor="nama-preset">Nama preset</FieldLabel>
              <Input
                id="nama-preset"
                className="h-11 md:h-8"
                data-testid="nama-preset"
                placeholder="cth. Shopee Utama"
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                disabled={mengirim}
              />
            </Field>
            <Field className="w-40">
              <FieldLabel htmlFor="status-preset">Status toko</FieldLabel>
              <Select value={status} onValueChange={(v) => typeof v === "string" && setStatus(v)}>
                <SelectTrigger id="status-preset" className="h-11 w-full md:h-8" data-testid="status-preset">
                  <SelectValue>{STATUS_OPSI.find((s) => s.nilai === status)?.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {STATUS_OPSI.map((s) => (
                      <SelectItem key={s.nilai} value={s.nilai}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Button className="h-11 md:h-8" data-testid="tambah-preset" onClick={() => void tambah()} disabled={mengirim}>
              {mengirim ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              Tambah
            </Button>
          </div>
        ) : null}

        {presets === null ? (
          <div className="space-y-2" aria-label="Memuat preset">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : presets.length === 0 ? (
          <Empty data-testid="preset-kosong">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Plus />
              </EmptyMedia>
              <EmptyTitle>Belum ada preset</EmptyTitle>
              <EmptyDescription>Tambah preset pertama di atas (dibuat dengan seed riset Shopee).</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aturan</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {presets.map((p) => (
                  <TableRow key={p.id} data-testid={`preset-${p.id}`}>
                    <TableCell className="font-medium">{p.nama}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{STATUS_OPSI.find((s) => s.nilai === p.status_toko)?.label ?? p.status_toko}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.jml_aturan ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 md:h-7"
                          data-testid={`buka-preset-${p.id}`}
                          onClick={() => setTerbuka(terbuka === p.id ? null : p.id)}
                        >
                          {terbuka === p.id ? "Tutup" : "Kelola"}
                        </Button>
                        {bolehUbah ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 md:h-7"
                              data-testid={`duplikat-preset-${p.id}`}
                              disabled={mengirim}
                              onClick={() => void kirim({ aksi: "duplikat", id: p.id }, "Preset diduplikasi.")}
                            >
                              <Copy data-icon="inline-start" />
                              Duplikat
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 md:h-7"
                              data-testid={`reset-seed-${p.id}`}
                              disabled={mengirim}
                              onClick={() => {
                                if (!window.confirm("Reset aturan seed ke riset awal? Aturan manual tak tersentuh.")) return;
                                void (async () => {
                                  setMengirim(true);
                                  try {
                                    const res = await fetch(`/api/preset/${p.id}/aturan`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      credentials: "include",
                                      body: JSON.stringify({ aksi: "reset-seed" }),
                                    });
                                    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; diubah?: number } | null;
                                    if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
                                    toast.success(`Seed direset (${data.diubah ?? 0} aturan).`);
                                    await muat();
                                  } catch (e) {
                                    tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal reset.");
                                  } finally {
                                    setMengirim(false);
                                  }
                                })();
                              }}
                            >
                              <RotateCcw data-icon="inline-start" />
                              Reset seed
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-9 md:h-7"
                              data-testid={`hapus-preset-${p.id}`}
                              disabled={mengirim}
                              onClick={() => {
                                if (!window.confirm(`Hapus preset "${p.nama}"?`)) return;
                                void kirim({ aksi: "hapus", id: p.id }, "Preset dihapus.");
                              }}
                            >
                              <Trash2 data-icon="inline-start" />
                              Hapus
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {terbuka !== null ? (
          <EditorPreset presetId={terbuka} bolehUbah={bolehUbah} onBerubah={() => void muat()} />
        ) : null}
      </CardContent>
    </Card>
  );
}
