"use client";

// components/dashboard/form-master-produk.tsx — Edit kategori/tier/pre-order/ukuran per SKU (U-M1).
// Owner saja. Fetch PATCH /api/produk/:sku.
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { ProdukDoc } from "@/lib/dashboard/types";

type OpsiKategori = { kategori_path: string; tier: string };
type OpsiTier = { tier: string };

export function FormMasterProduk({ sku, awal, onSukses }: {
  sku: string;
  awal: ProdukDoc;
  onSukses: () => void;
}) {
  const [kategori, setKategori] = useState(awal.kategori ?? "");
  const [tier, setTier] = useState(awal.tier_override ?? "");
  const [preOrder, setPreOrder] = useState(awal.pre_order ? "ya" : "tidak");
  const [ukuran, setUkuran] = useState(awal.ukuran_khusus ? "ya" : "tidak");
  const [go, setGo] = useState(awal.go_override ?? "");
  const [daftarKat, setDaftarKat] = useState<OpsiKategori[] | null>(null);
  const [daftarTier, setDaftarTier] = useState<OpsiTier[] | null>(null);
  const [mengirim, setMengirim] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/produk/kategori", { credentials: "include" });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean; kategori?: OpsiKategori[];
        } | null;
        if (res.ok && data?.ok) setDaftarKat(data.kategori ?? []);
      } catch {
        // abaikan: input manual tetap bisa
      }
    })();
  }, []);

  async function simpan() {
    setMengirim(true);
    try {
      const res = await fetch(`/api/produk/${encodeURIComponent(sku)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kategori: kategori.trim() || null,
          tier_override: tier.trim() || null,
          pre_order: preOrder,
          ukuran_khusus: ukuran,
          go_override: go.trim().toUpperCase() || null,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      toast.success("Master produk disimpan.");
      onSukses();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setMengirim(false);
    }
  }

  return (
    <Card data-testid="form-master-produk">
      <CardHeader>
        <CardTitle className="text-base">Master Shopee</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {awal.kategori ? (
            <Badge variant="outline" title={awal.kategori}>{awal.kategori}</Badge>
          ) : (
            <Badge variant="destructive">Kategori kosong</Badge>
          )}
          {awal.tier_override ? <Badge variant="secondary">Override {awal.tier_override}</Badge> : null}
          {awal.pre_order ? <Badge variant="outline">Pre-order</Badge> : null}
          {awal.ukuran_khusus ? <Badge variant="outline">Ukuran khusus</Badge> : null}
          {awal.go_override ? <Badge variant="secondary">GO {awal.go_override}</Badge> : null}
        </div>
        <Field>
          <FieldLabel htmlFor="master-kategori">Kategori (path Shopee)</FieldLabel>
          <Input
            id="master-kategori"
            list="daftar-kategori-shopee"
            className="h-11 md:h-8"
            data-testid="master-kategori"
            value={kategori}
            onChange={(e) => setKategori(e.target.value)}
            placeholder="cth. Perlengkapan Rumah > Peralatan Makan"
            disabled={mengirim}
          />
          <datalist id="daftar-kategori-shopee">
            {(daftarKat ?? []).map((k) => (
              <option key={k.kategori_path} value={k.kategori_path} />
            ))}
          </datalist>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Field className="min-w-36 flex-1">
            <FieldLabel htmlFor="master-tier">Tier override (opsional)</FieldLabel>
            <Select value={tier || "__kosong__"} onValueChange={(v) => typeof v === "string" && setTier(v === "__kosong__" ? "" : v)}>
              <SelectTrigger id="master-tier" className="h-11 w-full md:h-8" data-testid="master-tier">
                <SelectValue>{tier || "—"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="__kosong__">—</SelectItem>
                  {(daftarTier ?? []).map((t) => (
                    <SelectItem key={t.tier} value={t.tier}>{t.tier}</SelectItem>
                  ))}
                  {daftarTier === null ? ["T10", "T9_5", "T9", "T8_25", "T6_75", "T6_5", "T5_25", "T4_25", "T2_5"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  )) : null}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-36">
            <FieldLabel htmlFor="master-preorder">Pre-order</FieldLabel>
            <Select value={preOrder} onValueChange={(v) => typeof v === "string" && setPreOrder(v)}>
              <SelectTrigger id="master-preorder" className="h-11 w-full md:h-8" data-testid="master-preorder">
                <SelectValue>{preOrder}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="tidak">tidak</SelectItem>
                  <SelectItem value="ya">ya</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-36">
            <FieldLabel htmlFor="master-ukuran">Ukuran khusus</FieldLabel>
            <Select value={ukuran} onValueChange={(v) => typeof v === "string" && setUkuran(v)}>
              <SelectTrigger id="master-ukuran" className="h-11 w-full md:h-8" data-testid="master-ukuran">
                <SelectValue>{ukuran}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="tidak">tidak</SelectItem>
                  <SelectItem value="ya">ya</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-36">
            <FieldLabel htmlFor="master-go">GO override</FieldLabel>
            <Select value={go || "__kosong__"} onValueChange={(v) => typeof v === "string" && setGo(v === "__kosong__" ? "" : v)}>
              <SelectTrigger id="master-go" className="h-11 w-full md:h-8" data-testid="master-go">
                <SelectValue>{go || "—"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="__kosong__">—</SelectItem>
                  {["A", "B", "C", "D", "E", "F", "G", "H"].map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Button className="h-11 md:h-8" data-testid="simpan-master-produk" onClick={() => void simpan()} disabled={mengirim}>
          {mengirim ? <Spinner data-icon="inline-start" /> : null}
          Simpan master
        </Button>
      </CardContent>
    </Card>
  );
}
