"use client";

// app/harga-jual/page.tsx — Hitung harga jual per SKU.
// Fee Shopee (admin/program/pajak/proses) AUTO dari fee_rules, bisa diedit (badge auto/manual).
// OPEX + volume + margin = input MANUAL (keputusan bisnis, bukan data historis).
import { useCallback, useEffect, useState } from "react";
import { Calculator, RefreshCw, Search, Tag } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/dashboard/format";

type Preset = { id: number; nama: string; status_toko: string };
type KandidatSku = { sku: string; nama_accurate: string; hpp: number | null };
type FeeBaris = { nama: string; jenis: string; persen: number; flat: number; sumber: "auto" | "manual" };
type Komponen = {
  sku: string;
  nama: string | null;
  hpp: number;
  tier: string;
  grupGo: string | null;
  feePersen: FeeBaris[];
  feeFlat: FeeBaris[];
  peringatan: string[];
};
type Rincian = { nama: string; jenis: string; persen: number; flat: number; rupiah: number; sumber: string };
type Hasil = {
  harga: number; opexPerUnit: number; flatPerUnit: number; feePersenTotal: number;
  marginPersen: number; marginRupiah: number; modalPerUnit: number; rincian: Rincian[];
};

const LABEL_TIER: Record<string, string> = { T10: "T10", T_UNKNOWN: "belum dipetakan" };

export default function HalamanHargaJual() {
  return (
    <ButuhAkses href="/harga-jual">
      <HitungHarga />
    </ButuhAkses>
  );
}

function HitungHarga() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [presetId, setPresetId] = useState<number | null>(null);
  const [cari, setCari] = useState("");
  const [kandidat, setKandidat] = useState<KandidatSku[]>([]);
  const [komponen, setKomponen] = useState<Komponen | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const [peringatan, setPeringatan] = useState<string[]>([]);
  const [hitung, setHitung] = useState(false);

  // Input manual
  const [opex, setOpex] = useState("");
  const [volume, setVolume] = useState("");
  const [iklan, setIklan] = useState("2.47");
  const [margin, setMargin] = useState("15");
  const [pembulatan, setPembulatan] = useState("500");

  // Fee yang bisa diedit (awal dari auto)
  const [feePersen, setFeePersen] = useState<FeeBaris[]>([]);
  const [feeFlat, setFeeFlat] = useState<FeeBaris[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/preset", { credentials: "include" });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; presets?: Preset[] } | null;
      if (d?.ok && d.presets?.length) {
        setPresets(d.presets);
        setPresetId(d.presets[0].id);
      } else setPresets([]);
    })();
  }, []);

  const cariSku = useCallback(async (q: string, pid: number) => {
    if (q.trim().length < 2) { setKandidat([]); return; }
    const res = await fetch(`/api/harga-jual?aksi=cari-sku&presetId=${pid}&q=${encodeURIComponent(q)}`, { credentials: "include" });
    const d = (await res.json().catch(() => null)) as { ok?: boolean; daftar?: KandidatSku[] } | null;
    setKandidat(d?.daftar ?? []);
  }, []);

  useEffect(() => {
    if (!presetId || cari.length < 2) return;
    const t = setTimeout(() => void cariSku(cari, presetId), 300);
    return () => clearTimeout(t);
  }, [cari, presetId, cariSku]);

  async function pilihSku(sku: string) {
    if (!presetId) return;
    setMemuat(true);
    setHasil(null);
    setKandidat([]);
    setCari(sku);
    try {
      const res = await fetch(`/api/harga-jual?aksi=komponen&presetId=${presetId}&sku=${encodeURIComponent(sku)}`, { credentials: "include" });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; komponen?: Komponen } | null;
      if (!res.ok || !d?.ok || !d.komponen) throw new Error(d?.error ?? `Gagal (${res.status}).`);
      setKomponen(d.komponen);
      setFeePersen(d.komponen.feePersen.map((f) => ({ ...f })));
      setFeeFlat(d.komponen.feeFlat.map((f) => ({ ...f })));
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat komponen.");
    } finally {
      setMemuat(false);
    }
  }

  async function jalankanHitung() {
    if (!presetId || !komponen) return;
    setHitung(true);
    try {
      const res = await fetch("/api/harga-jual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          aksi: "hitung",
          presetId,
          sku: komponen.sku,
          hpp: komponen.hpp,
          feePersen,
          feeFlat,
          qtyPerOrder: 1,
          opexBulanan: Number(opex.replace(/\D/g, "")) || 0,
          volumeBulanan: Number(volume.replace(/\D/g, "")) || 0,
          iklanPersen: Number(iklan.replace(",", ".")) || 0,
          marginTarget: Number(margin.replace(",", ".")) || 0,
          pembulatan: Number(pembulatan.replace(/\D/g, "")) || 0,
        }),
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; hasil?: Hasil; peringatan?: string[] } | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal (${res.status}).`);
      setHasil(d.hasil ?? null);
      setPeringatan(d.peringatan ?? []);
    } catch (e) {
      setHasil(null);
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghitung.");
    } finally {
      setHitung(false);
    }
  }

  const badges: string[] = [...(komponen?.peringatan ?? []), ...peringatan];

  return (
    <>
      <PageHeader
        judul="Hitung Harga Jual"
        deskripsi="Fee Shopee otomatis dari aturan preset (bisa diedit). OPEX & margin diisi manual."
      />

      <div className="flex flex-col gap-4">
        {/* Preset */}
        <Field className="w-full sm:max-w-64">
          <FieldLabel htmlFor="preset-hj">Preset toko</FieldLabel>
          <Select
            value={presetId ? String(presetId) : ""}
            onValueChange={(v) => typeof v === "string" && v && setPresetId(Number(v))}
          >
            <SelectTrigger id="preset-hj" className="h-11 w-full md:h-8" data-testid="preset-harga-jual">
              <SelectValue>{presets?.find((p) => p.id === presetId)?.nama ?? "Pilih preset"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(presets ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.nama} ({p.status_toko})
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        {/* Pilih SKU */}
        <div className="relative">
          <Field>
            <FieldLabel htmlFor="cari-sku">Cari SKU / nama produk</FieldLabel>
            <div className="flex items-center gap-2">
              <Search className="size-4 text-muted-foreground" />
              <Input
                id="cari-sku"
                className="h-11 md:h-8"
                placeholder="mis. pisau, 100331"
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                data-testid="cari-sku-harga-jual"
              />
            </div>
          </Field>
          {kandidat.length > 0 ? (
            <div className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-border" data-testid="kandidat-sku">
              {kandidat.map((k) => (
                <button
                  key={k.sku}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => void pilihSku(k.sku)}
                >
                  <span>
                    <span className="font-medium">{k.sku}</span> · {k.nama_accurate}
                  </span>
                  <span className="text-xs text-muted-foreground">HPP {k.hpp != null ? formatRupiah(k.hpp) : "—"}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {memuat ? <Skeleton className="h-24 w-full" /> : null}

        {komponen ? (
          <>
            {/* Produk terpilih */}
            <Card data-testid="kartu-produk-harga-jual">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Tag className="size-4" />
                  {komponen.sku} · {komponen.nama ?? "—"}
                </CardTitle>
                <CardDescription>
                  HPP {formatRupiah(komponen.hpp)} · tier {LABEL_TIER[komponen.tier] ?? komponen.tier}
                  {komponen.grupGo ? ` · grup GO ${komponen.grupGo}` : ""}
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Fee Shopee — auto, bisa diedit */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Biaya Shopee</CardTitle>
                <CardDescription>Terisi otomatis dari aturan preset. Ubah bila perlu — badge berubah jadi “manual”.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {feePersen.map((f, i) => (
                  <div key={`${f.jenis}-${i}`} className="flex items-center gap-3">
                    <span className="flex-1 text-sm">{f.nama}</span>
                    <Badge variant={f.sumber === "auto" ? "secondary" : "default"} data-testid={`badge-${f.jenis}-${i}`}>
                      {f.sumber === "auto" ? "auto" : "manual"}
                    </Badge>
                    <Input
                      className="h-11 w-24 md:h-8"
                      value={String(f.persen)}
                      onChange={(e) => {
                        const v = Number(e.target.value.replace(",", ".")) || 0;
                        setFeePersen((lama) => lama.map((x, j) => (j === i ? { ...x, persen: v, sumber: "manual" } : x)));
                      }}
                      data-testid={`fee-persen-${f.jenis}-${i}`}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                ))}
                {feeFlat.map((f, i) => (
                  <div key={`flat-${f.jenis}-${i}`} className="flex items-center gap-3">
                    <span className="flex-1 text-sm">{f.nama}</span>
                    <Badge variant={f.sumber === "auto" ? "secondary" : "default"}>
                      {f.sumber === "auto" ? "auto" : "manual"}
                    </Badge>
                    <Input
                      className="h-11 w-24 md:h-8"
                      value={String(f.flat)}
                      onChange={(e) => {
                        const v = Number(e.target.value.replace(/\D/g, "")) || 0;
                        setFeeFlat((lama) => lama.map((x, j) => (j === i ? { ...x, flat: v, sumber: "manual" } : x)));
                      }}
                      data-testid={`fee-flat-${f.jenis}-${i}`}
                    />
                    <span className="text-sm text-muted-foreground">/order</span>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Total fee persen: {feePersen.reduce((a, x) => a + x.persen, 0).toFixed(2)}%
                </p>
              </CardContent>
            </Card>

            {/* OPEX manual */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Operasional (manual)</CardTitle>
                <CardDescription>OPEX dibagi volume → jadi biaya tetap per unit.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="opex">OPEX bulanan (Rp) — opsional</FieldLabel>
                  <Input id="opex" className="h-11 md:h-8" inputMode="numeric" placeholder="0 (boleh dikosongkan)"
                    value={opex} onChange={(e) => setOpex(e.target.value)} data-testid="opex-bulanan" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="vol">Volume terjual / bulan (unit) — opsional</FieldLabel>
                  <Input id="vol" className="h-11 md:h-8" inputMode="numeric" placeholder="0 (boleh dikosongkan)"
                    value={volume} onChange={(e) => setVolume(e.target.value)} data-testid="volume-bulanan" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="iklan">Iklan (% dari harga jual)</FieldLabel>
                  <Input id="iklan" className="h-11 md:h-8" inputMode="decimal"
                    value={iklan} onChange={(e) => setIklan(e.target.value)} data-testid="iklan-persen" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="margin">Target margin (%)</FieldLabel>
                  <Input id="margin" className="h-11 md:h-8" inputMode="decimal"
                    value={margin} onChange={(e) => setMargin(e.target.value)} data-testid="margin-target" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="bulat">Pembulatan (Rp)</FieldLabel>
                  <Select value={pembulatan} onValueChange={(v) => typeof v === "string" && setPembulatan(v)}>
                    <SelectTrigger id="bulat" className="h-11 md:h-8" data-testid="pembulatan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="0">Tanpa pembulatan</SelectItem>
                        <SelectItem value="100">ke 100</SelectItem>
                        <SelectItem value="500">ke 500</SelectItem>
                        <SelectItem value="1000">ke 1.000</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                {opex && volume && Number(volume.replace(/\D/g, "")) > 0 ? (
                  <p className="self-end text-xs text-muted-foreground" data-testid="opex-per-unit">
                    OPEX/unit: {formatRupiah(Number(opex.replace(/\D/g, "")) / Number(volume.replace(/\D/g, "")))}
                  </p>
                ) : (
                  <p className="self-end text-xs text-muted-foreground" data-testid="opex-per-unit">
                    OPEX/unit: Rp0 (tidak dibebankan)
                  </p>
                )}
              </CardContent>
            </Card>

            <Button
              size="lg"
              className="h-11 md:h-8"
              onClick={() => void jalankanHitung()}
              disabled={hitung}
              data-testid="hitung-harga-jual"
            >
              {hitung ? <RefreshCw className="animate-spin" data-icon="inline-start" /> : <Calculator data-icon="inline-start" />}
              {hitung ? "Menghitung…" : "Hitung Harga Jual"}
            </Button>

            {badges.length > 0 ? (
              <Alert data-testid="peringatan-harga-jual">
                <AlertTitle>Perhatikan</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4">
                    {badges.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {hasil ? (
              <>
                <Card data-testid="hasil-harga-jual">
                  <CardHeader>
                    <CardTitle className="text-3xl tabular-nums">{formatRupiah(hasil.harga)}</CardTitle>
                    <CardDescription>
                      Margin {hasil.marginPersen}% ({formatRupiah(hasil.marginRupiah)}/unit) · modal {formatRupiah(hasil.modalPerUnit)}
                    </CardDescription>
                  </CardHeader>
                </Card>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Komponen</TableHead>
                        <TableHead className="text-right">Persen</TableHead>
                        <TableHead className="text-right">Rupiah</TableHead>
                        <TableHead>Sumber</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hasil.rincian.map((r, i) => (
                        <TableRow key={`${r.jenis}-${i}`} className="tabular-nums" data-testid={`rincian-${r.jenis}-${i}`}>
                          <TableCell className="font-medium">{r.nama}</TableCell>
                          <TableCell className="text-right">{r.persen > 0 ? `${r.persen.toFixed(2)}%` : "—"}</TableCell>
                          <TableCell className="text-right">{formatRupiah(r.rupiah)}</TableCell>
                          <TableCell>
                            <Badge variant={r.sumber === "auto" ? "secondary" : "outline"}>{r.sumber}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : null}
          </>
        ) : !memuat && presets?.length === 0 ? (
          <Alert>
            <AlertTitle>Belum ada preset</AlertTitle>
            <AlertDescription>Buat preset toko di Pengaturan dulu.</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </>
  );
}
