"use client";

// components/dashboard/aksi-massal-kategori.tsx — Set kategori/pre-order/ukuran untuk N SKU (U-M2).
// Owner saja. POST /api/produk/massal.
import { useState } from "react";
import { toast } from "sonner";

import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";

export function AksiMassalKategori({ sku, onSukses }: { sku: string[]; onSukses: () => void }) {
  const [aksi, setAksi] = useState("set-kategori");
  const [nilai, setNilai] = useState("");
  const [mengirim, setMengirim] = useState(false);

  async function jalankan() {
    if (sku.length === 0) return;
    if (aksi === "set-kategori" && !nilai.trim()) {
      toast.error("Isi path kategori Shopee.");
      return;
    }
    if (!window.confirm(`Terapkan ke ${sku.length} SKU?`)) return;
    setMengirim(true);
    try {
      const res = await fetch("/api/produk/massal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi, sku, nilai: aksi === "set-kategori" ? nilai.trim() : nilai || "tidak" }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; count?: number } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      toast.success(`${data.count ?? sku.length} SKU diperbarui.`);
      onSukses();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal aksi massal.");
    } finally {
      setMengirim(false);
    }
  }

  if (sku.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2" data-testid="aksi-massal-kategori">
      <span className="text-sm text-muted-foreground" data-testid="jumlah-massal">{sku.length} dipilih</span>
      <Field className="w-44">
        <FieldLabel htmlFor="aksi-massal">Aksi</FieldLabel>
        <Select value={aksi} onValueChange={(v) => typeof v === "string" && setAksi(v)}>
          <SelectTrigger id="aksi-massal" className="h-11 w-full md:h-8" data-testid="aksi-massal">
            <SelectValue>{aksi}</SelectValue>
          </SelectTrigger>
          <SelectContent>
              <SelectItem value="set-kategori">Set kategori</SelectItem>
              <SelectItem value="set-pre-order">Set pre-order</SelectItem>
              <SelectItem value="set-ukuran">Set ukuran khusus</SelectItem>
              <SelectItem value="set-go">Set GO override</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {aksi === "set-kategori" ? (
        <Field className="min-w-52 flex-1">
          <FieldLabel htmlFor="nilai-massal">Path kategori</FieldLabel>
          <Input
            id="nilai-massal"
            className="h-11 md:h-8"
            data-testid="nilai-massal"
            value={nilai}
            onChange={(e) => setNilai(e.target.value)}
            placeholder="Perlengkapan Rumah > Peralatan Makan"
            disabled={mengirim}
          />
        </Field>
      ) : aksi === "set-go" ? (
        <Field className="w-40">
          <FieldLabel htmlFor="nilai-massal-go">Grup GO</FieldLabel>
          <Select value={nilai || "__kosong__"} onValueChange={(v) => typeof v === "string" && setNilai(v === "__kosong__" ? "" : v)}>
            <SelectTrigger id="nilai-massal-go" className="h-11 w-full md:h-8" data-testid="nilai-massal">
              <SelectValue>{nilai || "ikut kategori"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__kosong__">ikut kategori</SelectItem>
                {["A", "B", "C", "D", "E", "F", "G", "H"].map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : (
        <Field className="w-32">
          <FieldLabel htmlFor="nilai-massal-yn">Nilai</FieldLabel>
          <Select value={nilai || "tidak"} onValueChange={(v) => typeof v === "string" && setNilai(v)}>
            <SelectTrigger id="nilai-massal-yn" className="h-11 w-full md:h-8" data-testid="nilai-massal">
              <SelectValue>{nilai || "tidak"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="tidak">tidak</SelectItem>
                <SelectItem value="ya">ya</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}
      <Button className="h-11 md:h-8" data-testid="jalankan-massal" onClick={() => void jalankan()} disabled={mengirim}>
        {mengirim ? <Spinner data-icon="inline-start" /> : null}
        Terapkan
      </Button>
    </div>
  );
}
