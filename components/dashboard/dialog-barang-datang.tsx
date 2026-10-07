"use client";

// components/dashboard/dialog-barang-datang.tsx
// Aksi v3a 3.6 — Barang Datang per item (PRD v3a 3.6, 3.9, B6).
// Identitas item WAJIB kode_barang + variasi + buffer (T1).
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
import { formatAngka, formatTanggal } from "@/lib/dashboard/format";
import { useData } from "@/lib/dashboard/sumber-data";
import type { DailyRequestDoc, DailyRequestItem } from "@/lib/dashboard/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dokumen: DailyRequestDoc | null;
  /** Dipanggil setelah sukses agar halaman refetch. */
  onSukses?: () => void;
}

export function DialogBarangDatang({ open, onOpenChange, dokumen, onSukses }: Props) {
  const data = useData();
  const items = dokumen?.items ?? [];

  const [nilai, setNilai] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sedangId, setSedangId] = useState<string | null>(null);

  function kunci(item: DailyRequestItem): string {
    return `${item.kode_barang}::${item.variasi}::${item.buffer === true}`;
  }

  function teks(item: DailyRequestItem): string {
    return nilai[kunci(item)] ?? String(item.qty_diminta ?? item.qty);
  }

  function tutup(v: boolean) {
    if (sedangId) return; // terkunci saat submit
    onOpenChange(v);
  }

  async function tandai(item: DailyRequestItem) {
    if (!dokumen) return;
    const mentah = teks(item).trim();
    if (!/^\d+$/.test(mentah) || Number(mentah) > 1_000_000) {
      setError("Jumlah datang harus bilangan bulat >= 0 (maks 1.000.000).");
      return;
    }
    setError(null);
    setSedangId(kunci(item));
    try {
      const res = await data.tandaiPermintaanDatang({
        tanggal: dokumen.tanggal,
        item: {
          kode_barang: item.kode_barang,
          variasi: item.variasi,
          buffer: item.buffer,
          qty_datang: Number(mentah),
        },
      });
      if (res.ok) {
        if (res.selesai_otomatis) {
          toast.success("Semua barang sudah datang — permintaan selesai.");
        } else {
          toast.success("Barang datang dicatat");
        }
        onSukses?.();
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error);
        if (!kedaluwarsa) setError(res.error);
      }
    } catch {
      toast.error("Gagal menyimpan. Coba lagi.");
    } finally {
      setSedangId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="dialog-barang-datang">
        <DialogHeader>
          <DialogTitle>Barang Datang</DialogTitle>
          <DialogDescription>
            Catat jumlah yang benar-benar diterima per item. Isian awal = jumlah diminta.
          </DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="empty-dialog-barang-datang">
            Permintaan ini belum berisi item.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-4">
              {items.map((item) => {
                const k = kunci(item);
                const sudahDatang = item.status === "datang";
                const tidakDiminta = item.qty_diminta === 0 || (item.qty_diminta === null && item.qty === 0);
                const sedang = sedangId === k;
                return (
                  <li key={k} className="flex flex-col gap-1.5" data-testid={k}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate text-sm font-medium">{item.nama}</span>
                      {item.variasi !== "-" ? (
                        <span className="text-xs text-muted-foreground">{item.variasi}</span>
                      ) : null}
                      {item.buffer ? <Badge variant="outline">Buffer</Badge> : null}
                      {tidakDiminta ? <Badge variant="outline">Tidak diminta</Badge> : null}
                      {sudahDatang ? <Badge variant="secondary">Sudah datang</Badge> : null}
                    </div>

                    {sudahDatang ? (
                      <p className="text-sm text-muted-foreground" data-testid={`datang-${k}`}>
                        {formatAngka(item.qty_datang)} pcs · {formatTanggal(item.datang_at)}
                      </p>
                    ) : tidakDiminta ? (
                      <p className="text-sm text-muted-foreground">
                        Tidak perlu ditandai datang — otomatis selesai.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-start gap-2">
                        <Field
                          className="min-w-32 flex-1"
                          data-invalid={error ? true : undefined}
                          data-disabled={sedang || sedangId !== null ? true : undefined}
                        >
                          <Input
                            inputMode="numeric"
                            autoComplete="off"
                            aria-label={`Jumlah datang ${item.nama}`}
                            value={teks(item)}
                            disabled={sedang || sedangId !== null}
                            data-testid={`input-datang-${k}`}
                            onChange={(e) => {
                              setNilai((p) => ({ ...p, [k]: e.target.value }));
                              setError(null);
                            }}
                          />
                          <FieldDescription>Diminta {formatAngka(item.qty_diminta ?? item.qty)} pcs.</FieldDescription>
                        </Field>
                        <Button
                          type="button"
                          size="lg"
                          className="h-11 md:h-8"
                          disabled={sedangId !== null}
                          data-testid={`tandai-datang-${k}`}
                          onClick={() => void tandai(item)}
                        >
                          {sedang ? <Spinner data-icon="inline-start" /> : null}
                          {sedang ? "Menyimpan..." : "Tandai Datang"}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {error ? <FieldError data-testid="error-barang-datang">{error}</FieldError> : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 md:h-9"
                disabled={sedangId !== null}
                onClick={() => tutup(false)}
              >
                Tutup
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
