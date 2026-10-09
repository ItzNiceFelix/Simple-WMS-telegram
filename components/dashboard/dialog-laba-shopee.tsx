"use client";

// components/dashboard/dialog-laba-shopee.tsx — Upload export shipping Shopee → hitung estimasi → simpan.
// Alur: pilih file → baca sheet "orders" di klien (xlsx) → POST /api/laba hitung → preview agregat + tolak → simpan.
// Standalone: tak sentuh stok, tak pakai import_batches.
import { useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { formatRupiah } from "@/lib/dashboard/format";

type Tolak = { no_pesanan: string; alasan: string };

type Agregat = {
  jml_order: number;
  jml_baris: number;
  omzet: number;
  hpp: number;
  biaya: number;
  laba: number;
  tolak: Tolak[];
};

function isAgregatOk(v: unknown): v is { ok: true; agregat: Agregat; tanggal?: string } {
  return (
    !!v &&
    typeof v === "object" &&
    "ok" in v &&
    v.ok === true &&
    "agregat" in v &&
    !!v.agregat &&
    typeof v.agregat === "object"
  );
}

export function DialogLabaShopee({
  open,
  onOpenChange,
  onSukses,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSukses?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [agregat, setAgregat] = useState<Agregat | null>(null);
  const [mengirim, setMengirim] = useState(false);

  function tutup(v: boolean) {
    if (mengirim) return;
    if (!v) {
      setFile(null);
      setRows(null);
      setAgregat(null);
    }
    onOpenChange(v);
  }

  async function bacaFile(f: File): Promise<Record<string, unknown>[] | null> {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const nama = wb.SheetNames.includes("orders") ? "orders" : wb.SheetNames[0];
    const ws = nama ? wb.Sheets[nama] : undefined;
    if (!nama || !ws) {
      tampilkanGagalTulis('Sheet "orders" tidak ditemukan di file ini.');
      return null;
    }
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    if (data.length === 0) {
      tampilkanGagalTulis(`Sheet ${nama} kosong.`);
      return null;
    }
    return data;
  }

  async function hitung() {
    if (!file) return;
    setMengirim(true);
    try {
      const data = await bacaFile(file);
      if (!data) return;
      setRows(data);
      const res = await fetch("/api/laba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "hitung", rows: data, file: file.name }),
        credentials: "include",
      });
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok || !isAgregatOk(raw)) {
        tampilkanGagalTulis(
          raw && typeof raw === "object" && "error" in raw && typeof raw.error === "string"
            ? raw.error
            : `Gagal (${res.status}).`
        );
        return;
      }
      setAgregat(raw.agregat);
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.");
    } finally {
      setMengirim(false);
    }
  }

  async function simpan() {
    if (!rows || !agregat) return;
    setMengirim(true);
    try {
      const res = await fetch("/api/laba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "simpan", rows, file: file?.name ?? "" }),
        credentials: "include",
      });
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok || !isAgregatOk(raw)) {
        tampilkanGagalTulis(
          raw && typeof raw === "object" && "error" in raw && typeof raw.error === "string"
            ? raw.error
            : `Gagal (${res.status}).`
        );
        return;
      }
      toast.success(`Perhitungan tersimpan (tanggal ${raw.tanggal ?? "hari ini"}).`);
      tutup(false);
      onSukses?.();
    } catch {
      tampilkanGagalTulis("Jaringan gagal. Coba lagi.");
    } finally {
      setMengirim(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hitung Laba Shopee</DialogTitle>
          <DialogDescription>
            Upload file export shipping Shopee (.xlsx, sheet &quot;orders&quot;) → preview estimasi → Simpan
            Perhitungan (tanggal hari ini WIB).
          </DialogDescription>
        </DialogHeader>
        {!agregat ? (
          <div className="flex flex-col gap-3">
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="file-laba-shopee"
            />
            {file && (
              <p className="text-sm text-muted-foreground">
                {file.name} ({Math.round(file.size / 1024)} KB)
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3" data-testid="preview-laba-shopee">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">Order</dt>
                <dd className="font-semibold tabular-nums">{agregat.jml_order}</dd>
              </div>
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">Baris</dt>
                <dd className="font-semibold tabular-nums">{agregat.jml_baris}</dd>
              </div>
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">Omzet</dt>
                <dd className="font-semibold tabular-nums">{formatRupiah(agregat.omzet)}</dd>
              </div>
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">HPP</dt>
                <dd className="font-semibold tabular-nums">{formatRupiah(agregat.hpp)}</dd>
              </div>
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">Biaya</dt>
                <dd className="font-semibold tabular-nums">{formatRupiah(agregat.biaya)}</dd>
              </div>
              <div className="rounded-lg border border-border p-2">
                <dt className="text-xs text-muted-foreground">Estimasi Laba</dt>
                <dd className="font-semibold tabular-nums">{formatRupiah(agregat.laba)}</dd>
              </div>
            </dl>
            {agregat.tolak.length > 0 && (
              <div data-testid="tolak-laba-shopee">
                <p className="text-sm font-medium">
                  Ditolak hitung: <span className="text-red-600">{agregat.tolak.length} order</span>
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs">
                  {agregat.tolak.slice(0, 50).map((t) => (
                    <li key={t.no_pesanan}>
                      {t.no_pesanan}: {t.alasan}
                    </li>
                  ))}
                  {agregat.tolak.length > 50 && <li>… +{agregat.tolak.length - 50} lagi</li>}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {!agregat ? (
            <Button onClick={() => void hitung()} disabled={!file || mengirim} data-testid="hitung-laba-shopee">
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Menghitung…" : "Hitung"}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setRows(null);
                  setAgregat(null);
                }}
                disabled={mengirim}
              >
                Ganti file
              </Button>
              <Button onClick={() => void simpan()} disabled={mengirim} data-testid="simpan-laba-shopee">
                {mengirim ? <Spinner data-icon="inline-start" /> : null}
                {mengirim ? "Menyimpan…" : "Simpan Perhitungan"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
