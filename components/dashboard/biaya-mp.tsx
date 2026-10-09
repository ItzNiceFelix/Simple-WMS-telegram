"use client";

// components/dashboard/biaya-mp.tsx — Kelola preset biaya marketplace (Fase 3a).
// Preset dipakai otomatis saat import pesanan tanpa FeeJenis per baris.
// Fetch LANGSUNG /api/order?aksi=preset (kontrak DataSource beku Wave 3a).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
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
import { formatRupiah } from "@/lib/dashboard/format";

type Preset = { marketplace: string; jenis: string; basis: string; nilai: number };

const JENIS_FEE = ["admin", "service", "komisi", "ongkir", "voucher", "affiliate", "iklan", "lain"];

export function BiayaMp({ bolehUbah }: { bolehUbah: boolean }) {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [mp, setMp] = useState("");
  const [jenis, setJenis] = useState("admin");
  const [basis, setBasis] = useState("persen");
  const [nilai, setNilai] = useState("");
  const [mengirim, setMengirim] = useState(false);

  const muat = useCallback(async () => {
    setPresets(null);
    try {
      const res = await fetch("/api/order?aksi=preset", { credentials: "include" });
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

  async function tambah() {
    const teksNilai = nilai.trim().replace(",", ".");
    const nilaiNum = Number(teksNilai);
    if (!mp.trim()) {
      toast.error("Marketplace wajib diisi.");
      return;
    }
    if (teksNilai === "" || !Number.isFinite(nilaiNum) || nilaiNum < 0) {
      toast.error("Nilai harus angka ≥ 0 (desimal boleh, mis. 3.5).");
      return;
    }
    if (basis === "persen" && nilaiNum > 100) {
      toast.error("Persen maksimal 100.");
      return;
    }
    setMengirim(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          aksi: "preset-tambah",
          marketplace: mp.trim(),
          jenis,
          basis,
          nilai: nilaiNum,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      toast.success("Preset biaya disimpan.");
      setMp("");
      setNilai("");
      await muat();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setMengirim(false);
    }
  }

  async function hapus(p: Preset) {
    setMengirim(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi: "preset-hapus", marketplace: p.marketplace, jenis: p.jenis }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      toast.success("Preset dihapus.");
      await muat();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghapus.");
    } finally {
      setMengirim(false);
    }
  }

  return (
    <Card data-testid="kartu-biaya-mp">
      <CardHeader>
        <CardTitle>Biaya Marketplace</CardTitle>
        <CardDescription>
          Preset fee per MP — dipakai otomatis saat import pesanan tanpa FeeJenis per baris.
          {bolehUbah ? "" : " Hanya owner yang dapat mengubah."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {presets === null ? (
          <Skeleton className="h-32 w-full" data-testid="loading-biaya-mp" />
        ) : presets.length === 0 ? (
          <Empty data-testid="biaya-mp-kosong">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Plus />
              </EmptyMedia>
              <EmptyTitle>Belum ada preset</EmptyTitle>
              <EmptyDescription>Tambahkan fee per marketplace di bawah.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border" data-testid="tabel-biaya-mp">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marketplace</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead className="text-right">Nilai</TableHead>
                  {bolehUbah ? <TableHead className="w-20">Aksi</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {presets.map((p) => (
                  <TableRow key={`${p.marketplace}/${p.jenis}`} data-testid={`preset-${p.marketplace}-${p.jenis}`}>
                    <TableCell className="font-medium">{p.marketplace}</TableCell>
                    <TableCell>{p.jenis}</TableCell>
                    <TableCell>{p.basis}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.basis === "persen" ? `${p.nilai}%` : formatRupiah(p.nilai)}
                    </TableCell>
                    {bolehUbah ? (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          disabled={mengirim}
                          onClick={() => void hapus(p)}
                          data-testid={`hapus-preset-${p.marketplace}-${p.jenis}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {bolehUbah ? (
          <div className="flex flex-wrap items-end gap-3" data-testid="form-preset">
            <Field className="w-full sm:max-w-36">
              <FieldLabel htmlFor="preset-mp">Marketplace</FieldLabel>
              <Input
                id="preset-mp"
                className="h-11 md:h-8"
                data-testid="preset-mp"
                placeholder="cth. shopee"
                value={mp}
                onChange={(e) => setMp(e.target.value)}
                disabled={mengirim}
              />
            </Field>
            <Field className="w-full sm:max-w-36">
              <FieldLabel htmlFor="preset-jenis">Jenis</FieldLabel>
              <Select value={jenis} onValueChange={(v) => typeof v === "string" && setJenis(v)} disabled={mengirim}>
                <SelectTrigger id="preset-jenis" className="h-11 w-full md:h-8" data-testid="preset-jenis">
                  <SelectValue>{(v: string | null) => v ?? "admin"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {JENIS_FEE.map((j) => (
                      <SelectItem key={j} value={j}>
                        {j}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field className="w-full sm:max-w-32">
              <FieldLabel htmlFor="preset-basis">Basis</FieldLabel>
              <Select value={basis} onValueChange={(v) => typeof v === "string" && setBasis(v)} disabled={mengirim}>
                <SelectTrigger id="preset-basis" className="h-11 w-full md:h-8" data-testid="preset-basis">
                  <SelectValue>{(v: string | null) => v ?? "persen"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="persen">persen</SelectItem>
                    <SelectItem value="flat">flat</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field className="w-full sm:max-w-32">
              <FieldLabel htmlFor="preset-nilai">Nilai</FieldLabel>
              <Input
                id="preset-nilai"
                className="h-11 md:h-8"
                data-testid="preset-nilai"
                placeholder={basis === "persen" ? "cth. 3.5" : "Rp"}
                inputMode="decimal"
                value={nilai}
                onChange={(e) => setNilai(e.target.value)}
                disabled={mengirim}
              />
            </Field>
            <Button
              size="lg"
              className="h-11 md:h-8"
              disabled={mengirim}
              onClick={() => void tambah()}
              data-testid="simpan-preset"
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {mengirim ? "Menyimpan…" : "Tambah"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
