"use client";

// app/order/page.tsx — Daftar Order Keluar + transisi fulfill (Fase 3a).
// Fetch LANGSUNG /api/order (kontrak DataSource beku Wave 3a).
import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileDown, FileUp, PackageSearch, RotateCcw } from "lucide-react";

import { DialogImportExcel } from "@/components/dashboard/dialog-import-excel";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { formatRupiah } from "@/lib/dashboard/format";
import type { OrderDetail } from "@/lib/d1/order";

type RincianOrder = OrderDetail;
type Target = { mp: string; no: string; ke: string };

// Cermin PETA_TRANSISI lib/d1/order.ts — tombol tampil sesuai status kini.
const TRANSISI: Record<string, { ke: string; label: string }[]> = {
  pending: [
    { ke: "pack", label: "Pack" },
    { ke: "batal", label: "Batal" },
  ],
  pack: [
    { ke: "kirim", label: "Kirim" },
    { ke: "batal", label: "Batal" },
  ],
  kirim: [
    { ke: "selesai", label: "Selesai" },
    { ke: "batal", label: "Batal" },
  ],
  selesai: [],
  batal: [],
};

const DAFTAR_STATUS = ["semua", "pending", "pack", "kirim", "selesai", "batal"];

export default function HalamanOrder() {
  return (
    <ButuhAkses href="/order">
      <DaftarOrder />
    </ButuhAkses>
  );
}

function DaftarOrder() {
  const [orders, setOrders] = useState<RincianOrder[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("semua");
  const [mp, setMp] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [mengirim, setMengirim] = useState(false);
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const mpTertunda = useDeferredValue(mp.trim().toLowerCase());

  const kunciOrder = (o: RincianOrder) => `${o.marketplace}|${o.no_pesanan}`;

  function togglePilih(o: RincianOrder): void {
    const k = kunciOrder(o);
    setTerpilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(k)) baru.delete(k);
      else baru.add(k);
      return baru;
    });
  }

  function pilihSemua(): void {
    if (!orders) return;
    setTerpilih(new Set(orders.map(kunciOrder)));
  }

  async function aksiMassal(ke: string): Promise<void> {
    if (!orders || terpilih.size === 0) return;
    const targets = orders
      .filter((o) => terpilih.has(kunciOrder(o)))
      .map((o) => ({ marketplace: o.marketplace, no_pesanan: o.no_pesanan, ke }));
    setMengirim(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi: "transisi-batch", targets }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; count?: number } | null;
      if (!res.ok || !data?.ok) {
        tampilkanGagalTulis(data?.error ?? `Gagal (${res.status}).`);
        return;
      }
      toast.success(`${data.count ?? targets.length} order → ${ke}.`);
      setTerpilih(new Set());
      await muat();
    } catch {
      toast.error("Jaringan gagal. Coba lagi.");
    } finally {
      setMengirim(false);
    }
  }

  function unduhPicklist(): void {
    if (!orders || terpilih.size === 0) return;
    const targets = orders
      .filter((o) => terpilih.has(kunciOrder(o)))
      .map((o) => ({ marketplace: o.marketplace, no_pesanan: o.no_pesanan }));
    const q = new URLSearchParams({ aksi: "picklist-pdf", targets: JSON.stringify(targets) });
    window.open(`/api/order?${q}`, "_blank");
  }

  const muat = useCallback(async () => {
    setError(null);
    setOrders(null);
    try {
      const q = new URLSearchParams({ aksi: "daftar", limit: "200" });
      if (status !== "semua") q.set("status", status);
      if (mpTertunda) q.set("mp", mpTertunda);
      const res = await fetch(`/api/order?${q}`, { credentials: "include" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        orders?: RincianOrder[];
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      setOrders(data.orders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat order.");
    }
  }, [status, mpTertunda]);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function kirim() {
    if (!target) return;
    setMengirim(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          aksi: "transisi",
          marketplace: target.mp,
          no_pesanan: target.no,
          ke: target.ke,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        tampilkanGagalTulis(data?.error ?? `Gagal (${res.status}).`);
        return;
      }
      toast.success(`Order ${target.no} → ${target.ke}.`);
      setTarget(null);
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
        judul="Order Keluar"
        deskripsi="Pesanan marketplace + transisi fulfill."
        aksi={
          <div className="flex gap-2">
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="template-pesanan" onClick={() => window.open("/template-import-produk.xlsx", "_blank")}>
              <FileDown data-icon="inline-start" />
              Template
            </Button>
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="impor-pesanan" onClick={() => setImportOpen(true)}>
              <FileUp data-icon="inline-start" />
              Impor Pesanan
            </Button>
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="muat-ulang-order" onClick={() => void muat()}>
              <RotateCcw data-icon="inline-start" />
              Muat ulang
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-full sm:max-w-52">
            <FieldLabel htmlFor="filter-status-order">Status</FieldLabel>
            <Select value={status} onValueChange={(v) => typeof v === "string" && setStatus(v)}>
              <SelectTrigger id="filter-status-order" className="h-11 w-full md:h-8" data-testid="filter-status-order">
                <SelectValue>{(v: string | null) => v ?? "Semua"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DAFTAR_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "semua" ? "Semua" : s}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-full sm:max-w-52">
            <FieldLabel htmlFor="filter-mp-order">Marketplace</FieldLabel>
            <Input
              id="filter-mp-order"
              className="h-11 md:h-8"
              data-testid="filter-mp-order"
              placeholder="cth. shopee"
              value={mp}
              onChange={(e) => setMp(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2" data-testid="toolbar-bulk-order">
          <Button size="sm" variant="outline" className="h-9" data-testid="pilih-semua-order" onClick={pilihSemua} disabled={!orders || orders.length === 0}>
            Pilih semua
          </Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setTerpilih(new Set())} disabled={terpilih.size === 0}>
            Kosongkan
          </Button>
          <span className="text-sm text-muted-foreground" data-testid="jumlah-terpilih-order">
            {terpilih.size} dipilih
          </span>
          <div className="flex flex-wrap gap-2 md:ml-auto">
            {[
              { ke: "pack", label: "Pack" },
              { ke: "kirim", label: "Kirim" },
              { ke: "selesai", label: "Selesai" },
              { ke: "batal", label: "Batal" },
            ].map((a) => (
              <Button
                key={a.ke}
                size="sm"
                variant={a.ke === "batal" ? "destructive" : "outline"}
                className="h-9"
                data-testid={`bulk-${a.ke}-order`}
                disabled={mengirim || terpilih.size === 0}
                onClick={() => void aksiMassal(a.ke)}
              >
                {a.label}
              </Button>
            ))}
            <Button
              size="sm"
              className="h-9"
              data-testid="download-picklist-order"
              disabled={terpilih.size === 0}
              onClick={unduhPicklist}
            >
              <FileDown data-icon="inline-start" />
              Picklist PDF
            </Button>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Gagal memuat</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : orders === null ? (
          <div className="space-y-2" aria-label="Memuat order">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <Empty data-testid="order-kosong">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageSearch />
              </EmptyMedia>
              <EmptyTitle>Tidak ada order</EmptyTitle>
              <EmptyDescription>Belum ada pesanan cocok filter.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Pilih</TableHead>
                  <TableHead>No Pesanan</TableHead>
                  <TableHead>MP</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Item</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={`${o.marketplace}/${o.no_pesanan}`} data-testid={`order-${o.no_pesanan}`}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        aria-label={`Pilih ${o.no_pesanan}`}
                        data-testid={`pilih-${o.no_pesanan}`}
                        checked={terpilih.has(kunciOrder(o))}
                        onChange={() => togglePilih(o)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{o.no_pesanan}</TableCell>
                    <TableCell>{o.marketplace}</TableCell>
                    <TableCell className="tabular-nums">
                      {new Date(o.tanggal * 1000).toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{o.status_fulfill}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{o.items.reduce((a, i) => a + i.qty, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(o.items.reduce((a, i) => a + i.subtotal, 0))}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {(TRANSISI[o.status_fulfill] ?? []).map((t) => (
                          <Button
                            key={t.ke}
                            size="sm"
                            variant={t.ke === "batal" ? "destructive" : "outline"}
                            className="h-9 md:h-7"
                            data-testid={`transisi-${t.ke}-${o.no_pesanan}`}
                            onClick={() =>
                              setTarget({ mp: o.marketplace, no: o.no_pesanan, ke: t.ke })
                            }
                          >
                            {t.label}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AlertDialog
        open={target !== null}
        onOpenChange={(v) => {
          if (!mengirim && !v) setTarget(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-transisi-order">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target ? `Ubah ${target.no} → ${target.ke}?` : "Ubah status?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target?.ke === "batal"
                ? "Batal kembalikan stok ONLINE bila sudah pack/kirim. Lanjut?"
                : "Status order berubah. Lanjut?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="batal-transisi-order"
              onClick={() => setTarget(null)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="konfirmasi-transisi-order"
              onClick={() => void kirim()}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Memproses…" : "Ya, lanjut"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DialogImportExcel open={importOpen} onOpenChange={setImportOpen} tipe="pesanan" onSukses={() => void muat()} />
    </>
  );
}
