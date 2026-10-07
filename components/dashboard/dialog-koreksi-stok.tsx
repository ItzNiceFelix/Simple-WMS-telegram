"use client";

// Dialog Koreksi Stok (PRD 13.1, 21 E3/E6; ui-spec 4).
// Stok negatif BUKAN error — hasil boleh negatif (PRD 13.6).
import { useState } from "react";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatAngka } from "@/lib/dashboard/format";
import { useData } from "@/lib/dashboard/sumber-data";
import type { MutasiMode } from "@/lib/dashboard/types";

const MODE_LABEL: Record<MutasiMode, string> = {
  tambah: "Tambah",
  kurangi: "Kurangi",
  timpa: "Timpa",
};

const PESAN_ERROR: Record<MutasiMode, string> = {
  tambah: "Jumlah harus bilangan bulat >= 1.",
  kurangi: "Jumlah harus bilangan bulat >= 1.",
  timpa: "Jumlah fisik harus bilangan bulat >= 0.",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kode: string;
  nama: string | null;
  stokSekarang: number | null;
  /** Dipanggil setelah mutasi sukses agar halaman refetch. */
  onSukses?: (stokBaru: number) => void;
}

/** Validasi murni per mode (PRD 13.1). */
function validasi(mode: MutasiMode, mentah: string): number | string {
  const teks = mentah.trim();
  if (!/^\d+$/.test(teks)) return PESAN_ERROR[mode];
  const n = Number(teks);
  const min = mode === "timpa" ? 0 : 1;
  if (!Number.isInteger(n) || n < min) return PESAN_ERROR[mode];
  return n;
}

export function DialogKoreksiStok({ open, onOpenChange, kode, nama, stokSekarang, onSukses }: Props) {
  const data = useData();
  const [mode, setMode] = useState<MutasiMode>("tambah");
  const [qtyText, setQtyText] = useState("");
  const [catatan, setCatatan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);

  const dasar = stokSekarang ?? 0;
  const hasil = validasi(mode, qtyText);
  const qtyValid = typeof hasil === "number";
  const preview =
    qtyValid && mode === "timpa"
      ? hasil
      : qtyValid && mode === "tambah"
        ? dasar + hasil
        : qtyValid && mode === "kurangi"
          ? dasar - hasil
          : null;

  function reset() {
    setMode("tambah");
    setQtyText("");
    setCatatan("");
    setError(null);
    setMengirim(false);
  }

  function tutup(v: boolean) {
    if (mengirim) return; // form terkunci saat submit (cegah double-tap)
    if (!v) reset();
    onOpenChange(v);
  }

  async function kirim() {
    const nilai = validasi(mode, qtyText);
    if (typeof nilai === "string") {
      setError(nilai);
      return;
    }
    setError(null);
    setMengirim(true);
    try {
      const res = await data.mutasiStok({
        kode_barang: kode,
        mode,
        qty: nilai,
        catatan: catatan.trim() ? catatan.trim() : undefined,
      });
      if (res.ok) {
        toast.success("Stok diperbarui");
        reset();
        onOpenChange(false);
        onSukses?.(res.stok_baru);
      } else {
        toast.error(res.error);
        setMengirim(false);
      }
    } catch {
      toast.error("Gagal menyimpan. Coba lagi.");
      setMengirim(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-koreksi">
        <DialogHeader>
          <DialogTitle>Koreksi Stok</DialogTitle>
          <DialogDescription>Ubah saldo stok gudang online produk ini.</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm font-medium">{nama ?? "Produk"}</p>
          <p className="text-xs text-muted-foreground">{kode}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Stok saat ini:{" "}
            <span
              data-testid="dialog-stok-sekarang"
              className="font-semibold text-foreground tabular-nums"
            >
              {formatAngka(stokSekarang)}
            </span>
          </p>
        </div>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void kirim();
          }}
        >
          <Field data-disabled={mengirim ? true : undefined}>
            <FieldLabel>Mode</FieldLabel>
            <ToggleGroup
              variant="outline"
              value={[mode]}
              onValueChange={(v) => {
                const next = v[0] as MutasiMode | undefined;
                if (!next) return;
                setMode(next);
                setError(null);
                setQtyText("");
              }}
              disabled={mengirim}
              aria-label="Mode koreksi"
            >
              {(Object.keys(MODE_LABEL) as MutasiMode[]).map((m) => (
                <ToggleGroupItem
                  key={m}
                  value={m}
                  className="h-11 min-w-20 md:h-8"
                  data-testid={`mode-${m}`}
                >
                  {MODE_LABEL[m]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field data-invalid={error ? true : undefined} data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="koreksi-qty">
              {mode === "timpa" ? "Jumlah fisik" : "Jumlah"}
            </FieldLabel>
            <Input
              id="koreksi-qty"
              inputMode="numeric"
              autoComplete="off"
              value={qtyText}
              aria-invalid={error ? true : undefined}
              disabled={mengirim}
              placeholder={mode === "timpa" ? "0" : "1"}
              onChange={(e) => {
                setQtyText(e.target.value);
                setError(null);
              }}
            />
            {error ? (
              <FieldError data-testid="error-qty">{error}</FieldError>
            ) : (
              <FieldDescription>
                {mode === "timpa"
                  ? "Saldo disetel ke nilai fisik (boleh 0)."
                  : "Bilangan bulat minimal 1. Hasil boleh negatif."}
              </FieldDescription>
            )}
          </Field>

          <Field data-disabled={mengirim ? true : undefined}>
            <FieldLabel htmlFor="koreksi-catatan">Catatan (opsional)</FieldLabel>
            <Input
              id="koreksi-catatan"
              value={catatan}
              disabled={mengirim}
              autoComplete="off"
              placeholder="Mis. barang keluar belum tercatat"
              onChange={(e) => setCatatan(e.target.value)}
            />
          </Field>

          {preview != null ? (
            <p className="text-sm text-muted-foreground" data-testid="preview-hasil">
              Stok setelah aksi:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {formatAngka(preview)}
              </span>
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 md:h-9"
              disabled={mengirim}
              onClick={() => tutup(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              size="lg"
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="submit-koreksi"
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
