"use client";

// app/advance/page.tsx — Daftar booking Advance Fulfilment (pasokan ke Gudang Shopee, Fase E4).
// Aksi: cetak picklist advance, kirim/batal per booking atau borongan (stok ONLINE turun saat kirim).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileDown, RotateCcw, Send, XCircle } from "lucide-react";

import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { PageHeader } from "@/components/dashboard/page-header";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Booking = {
  booking_sn: string;
  no_resi: string;
  sku: string;
  variasi: string;
  nama_produk: string;
  opsi_kirim: string;
  qty: number;
  status: string;
  batch_import: number | null;
};

const DAFTAR_STATUS = ["semua", "menunggu", "terkirim", "batal", "timeout"];

export default function HalamanAdvance() {
  return (
    <ButuhAkses href="/advance">
      <DaftarAdvance />
    </ButuhAkses>
  );
}

function DaftarAdvance() {
  const [booking, setBooking] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("menunggu");
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [mengirim, setMengirim] = useState(false);

  const muat = useCallback(async () => {
    setError(null);
    setBooking(null);
    try {
      const q = new URLSearchParams({ aksi: "daftar", limit: "300" });
      if (status !== "semua") q.set("status", status);
      const res = await fetch(`/api/advance?${q}`, { credentials: "include" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; booking?: Booking[] } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      setBooking(data.booking ?? []);
      setTerpilih(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat booking.");
    }
  }, [status]);

  useEffect(() => {
    void muat();
  }, [muat]);

  function toggle(sn: string): void {
    setTerpilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(sn)) baru.delete(sn);
      else baru.add(sn);
      return baru;
    });
  }

  function unduhPicklist(): void {
    const q = new URLSearchParams({ aksi: "picklist-pdf", status: status === "semua" ? "menunggu" : status });
    window.open(`/api/advance?${q}`, "_blank");
  }

  async function aksi(aksiNama: "kirim" | "batal", daftar: string[]): Promise<void> {
    if (daftar.length === 0) return;
    setMengirim(true);
    try {
      const res = await fetch("/api/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(daftar.length === 1 ? { aksi: aksiNama, booking_sn: daftar[0] } : { aksi: `${aksiNama}-massal`, booking_sn: daftar }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; sukses?: number; gagal?: { booking_sn: string; error: string }[]; stok_negatif?: boolean; stok_akhir?: number } | null;
      if (!res.ok || !data?.ok) {
        tampilkanGagalTulis(data?.error ?? `Gagal (${res.status}).`);
        return;
      }
      const jml = data.sukses ?? daftar.length;
      if (data.stok_negatif) {
        toast.warning(`${jml} booking ${aksiNama}, tapi stok ONLINE jadi ${data.stok_akhir}. Cek selisih fisik.`);
      } else if (data.gagal?.length) toast.warning(`${jml} ${aksiNama}, ${data.gagal.length} gagal.`);
      else toast.success(`${jml} booking ${aksiNama}.`);
      await muat();
    } catch {
      toast.error("Jaringan gagal. Coba lagi.");
    } finally {
      setMengirim(false);
    }
  }

  return (
    <>
      <PageHeader
        judul="Advance Fulfilment"
        deskripsi="Booking pasokan ke Gudang Shopee. Kirim = stok ONLINE turun."
        aksi={
          <div className="flex gap-2">
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="picklist-advance" onClick={unduhPicklist}>
              <FileDown data-icon="inline-start" />
              Picklist Advance
            </Button>
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="muat-ulang-advance" onClick={() => void muat()}>
              <RotateCcw data-icon="inline-start" />
              Muat ulang
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2" data-testid="toolbar-advance">
          {DAFTAR_STATUS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              className="h-9"
              data-testid={`filter-advance-${s}`}
              onClick={() => setStatus(s)}
            >
              {s === "semua" ? "Semua" : s}
            </Button>
          ))}
          <span className="text-sm text-muted-foreground md:ml-auto" data-testid="jumlah-dipilih-advance">
            {terpilih.size} dipilih
          </span>
          <Button
            size="sm"
            className="h-9"
            data-testid="kirim-advance-borongan"
            disabled={mengirim || terpilih.size === 0}
            onClick={() => void aksi("kirim", [...terpilih])}
          >
            <Send data-icon="inline-start" />
            Kirim ke Shopee ({terpilih.size})
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-9"
            data-testid="batal-advance-borongan"
            disabled={mengirim || terpilih.size === 0}
            onClick={() => void aksi("batal", [...terpilih])}
          >
            Batalkan
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Gagal memuat</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : booking === null ? (
          <div className="space-y-2" aria-label="Memuat booking">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : booking.length === 0 ? (
          <Empty data-testid="advance-kosong">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Send />
              </EmptyMedia>
              <EmptyTitle>Tidak ada booking</EmptyTitle>
              <EmptyDescription>Belum ada booking advance cocok filter.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Pilih</TableHead>
                  <TableHead>Booking SN</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead>Resi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {booking.map((b) => (
                  <TableRow key={b.booking_sn} data-testid={`advance-${b.booking_sn}`}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        aria-label={`Pilih ${b.booking_sn}`}
                        data-testid={`pilih-advance-${b.booking_sn}`}
                        checked={terpilih.has(b.booking_sn)}
                        onChange={() => toggle(b.booking_sn)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{b.booking_sn}</TableCell>
                    <TableCell>{b.sku}</TableCell>
                    <TableCell>{b.nama_produk}{b.variasi ? ` · ${b.variasi}` : ""}</TableCell>
                    <TableCell className="tabular-nums">{b.no_resi || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === "menunggu" ? "outline" : "secondary"}>{b.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {b.status === "menunggu" ? (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 md:h-7"
                            data-testid={`kirim-advance-${b.booking_sn}`}
                            disabled={mengirim}
                            onClick={() => void aksi("kirim", [b.booking_sn])}
                          >
                            <Send data-icon="inline-start" />
                            Kirim
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-9 md:h-7"
                            data-testid={`batal-advance-${b.booking_sn}`}
                            disabled={mengirim}
                            onClick={() => void aksi("batal", [b.booking_sn])}
                          >
                            <XCircle data-icon="inline-start" />
                            Batal
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
