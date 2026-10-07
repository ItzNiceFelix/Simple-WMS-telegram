"use client";

// components/dashboard/dialog-ubah-jumlah.tsx
// Aksi v3a 3.3 — Ubah Jumlah semua item sekaligus (PRD v3a 3.3, 3.9).
// Identitas item WAJIB kode_barang + variasi + buffer (T1): tanpa `buffer`, item
// MINTA vs MINTA_SISA tidak akan ketemu oleh server.
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { kekuranganStok } from "@/lib/dashboard/format";
import { useData } from "@/lib/dashboard/sumber-data";
import type { DailyRequestDoc, DailyRequestItem } from "@/lib/dashboard/types";

/** Key stabil React + data-testid: `${kode_barang}::${variasi}::${buffer}` (PRD 3.7). */
export function kunciItem(item: DailyRequestItem): string {
  return `${item.kode_barang}::${item.variasi}::${item.buffer === true}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dokumen: DailyRequestDoc | null;
  /** Stok gudang online per kode_barang; `null` = dokumen stok belum ada. */
  stokMap: Map<string, number | null>;
  /** Dipanggil setelah sukses agar halaman refetch. */
  onSukses?: () => void;
}

export function DialogUbahJumlah({ open, onOpenChange, dokumen, stokMap, onSukses }: Props) {
  const data = useData();
  const items = dokumen?.items ?? [];

  const [nilai, setNilai] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);

  /** Isian kosong = qty saat ini (dokumen tetap utuh tanpa ketik). */
  function teksItem(item: DailyRequestItem): string {
    return nilai[kunciItem(item)] ?? String(item.qty_diminta ?? item.qty);
  }

  function tutup(v: boolean) {
    if (mengirim) return; // form terkunci saat submit
    onOpenChange(v);
  }

  async function kirim() {
    if (!dokumen) return;
    const qty: { kode_barang: string; variasi: string; buffer: boolean; qty: number }[] = [];
    for (const item of items) {
      if (item.status === "datang") continue; // server akan menolak 409
      const mentah = teksItem(item).trim();
      if (!/^\d+$/.test(mentah)) {
        setError("Jumlah harus bilangan bulat >= 0 (maks 1.000.000).");
        return;
      }
      const n = Number(mentah);
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
        setError("Jumlah harus bilangan bulat >= 0 (maks 1.000.000).");
        return;
      }
      qty.push({ kode_barang: item.kode_barang, variasi: item.variasi, buffer: item.buffer, qty: n });
    }
    setError(null);
    setMengirim(true);
    try {
      const res = await data.sesuaikanQtyPermintaan({ tanggal: dokumen.tanggal, qty });
      if (res.ok) {
        toast.success("Jumlah diperbarui");
        setMengirim(false);
        onOpenChange(false);
        onSukses?.();
      } else {
        // 401: form TIDAK direset, dialog tetap terbuka (umpan-tulis menahan).
        const kedaluwarsa = tampilkanGagalTulis(res.error);
        if (!kedaluwarsa) setError(res.error);
        setMengirim(false);
      }
    } catch {
      toast.error("Gagal menyimpan. Coba lagi.");
      setMengirim(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="dialog-ubah-jumlah">
        <DialogHeader>
          <DialogTitle>Ubah Jumlah</DialogTitle>
          <DialogDescription>
            Sesuaikan jumlah minta untuk <span className="font-medium">{items.length} item</span>.
            Isian awal = jumlah terakhir. Saran = kekurangan stok gudang online.
          </DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="empty-dialog-ubah-jumlah">
            Permintaan ini belum berisi item.
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void kirim();
            }}
          >
            <ul className="flex flex-col gap-4">
              {items.map((item) => {
                const kunci = kunciItem(item);
                const stok = item.kode_barang == null ? null : (stokMap.get(item.kode_barang) ?? null);
                const kurang = kekuranganStok(stok);
                const sudahDatang = item.status === "datang";
                const tidakDiminta = item.qty_diminta === 0;
                return (
                  <li key={kunci} className="flex flex-col gap-1.5" data-testid={kunci}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate text-sm font-medium">{item.nama}</span>
                      {item.variasi !== "-" ? (
                        <span className="text-xs text-muted-foreground">{item.variasi}</span>
                      ) : null}
                      {item.buffer ? <Badge variant="outline">Buffer</Badge> : null}
                      {sudahDatang ? <Badge variant="secondary">Sudah datang</Badge> : null}
                      {tidakDiminta ? <Badge variant="outline">Tidak diminta</Badge> : null}
                    </div>
                    <Field
                      data-invalid={error ? true : undefined}
                      data-disabled={mengirim || sudahDatang ? true : undefined}
                    >
                      <Input
                        inputMode="numeric"
                        autoComplete="off"
                        aria-label={`Jumlah ${item.nama}`}
                        value={teksItem(item)}
                        disabled={mengirim || sudahDatang}
                        data-testid={`input-qty-${kunci}`}
                        onChange={(e) => {
                          setNilai((p) => ({ ...p, [kunci]: e.target.value }));
                          setError(null);
                        }}
                      />
                      <FieldDescription>
                        {kurang > 0
                          ? `Kurang ${kurang} dari stok gudang online.`
                          : "Stok gudang online tidak minus."}
                      </FieldDescription>
                    </Field>
                  </li>
                );
              })}
            </ul>

            {error ? <FieldError data-testid="error-ubah-jumlah">{error}</FieldError> : null}

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
                data-testid="submit-ubah-jumlah"
              >
                {mengirim ? <Spinner data-icon="inline-start" /> : null}
                {mengirim ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
