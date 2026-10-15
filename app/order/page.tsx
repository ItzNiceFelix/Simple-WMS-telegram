"use client";

// app/order/page.tsx — Daftar Order Keluar + transisi fulfill (Fase 3a).
// Fetch LANGSUNG /api/order (kontrak DataSource beku Wave 3a).
import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileDown, FileUp, PackageSearch, RotateCcw } from "lucide-react";

import { DialogImportExcel } from "@/components/dashboard/dialog-import-excel";
import { DialogImportOrder } from "@/components/dashboard/dialog-import-order";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRupiah } from "@/lib/dashboard/format";
import type { OrderDetail } from "@/lib/d1/order";

type RincianOrder = OrderDetail;
type Target = { mp: string; no: string; ke: string };

// Cermin PETA_TRANSISI lib/d1/order.ts — tombol tampil sesuai status kini.
// Nilai DB `pack` tetap "pack" (kompatibilitas data); hanya label UI jadi "Disiapkan".
const LABEL_STATUS: Record<string, string> = { pack: "Disiapkan" };

const TRANSISI: Record<string, { ke: string; label: string }[]> = {
  pending: [
    { ke: "pack", label: "Disiapkan" },
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

// Mode cetak picklist (F18/T7). per_paket = 1 lembar per no_resi (default resi gabungan).
const MODE_PICKLIST = [
  { mode: "per_paket", label: "Per Paket" },
  { mode: "pisah", label: "Pisah" },
  { mode: "gabung", label: "Gabung" },
  { mode: "gabung-order", label: "Gabung order + advance (satu lembar)" },
] as const;

type ModePicklist = (typeof MODE_PICKLIST)[number]["mode"];

export default function HalamanOrder() {
  return (
    <ButuhAkses href="/order">
      <TabsOrder />
    </ButuhAkses>
  );
}

/** Tab Order | Advance (Fase E3). Daftar order lama tetap utuh; advance = tautan halaman advance. */
function TabsOrder() {
  const [tab, setTab] = useState("order");
  return (
    <Tabs value={tab} onValueChange={(v) => typeof v === "string" && setTab(v)} className="gap-4">
      <TabsList data-testid="tab-order">
        <TabsTrigger value="order" data-testid="tab-order-order">Order</TabsTrigger>
        <TabsTrigger value="advance" data-testid="tab-order-advance">Advance</TabsTrigger>
      </TabsList>
      <TabsContent value="order">
        <DaftarOrder />
      </TabsContent>
      <TabsContent value="advance">
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">
            Booking Advance Fulfilment dikelola di halaman terpisah: cetak picklist, kirim ke Shopee, atau batalkan.
          </p>
          <Button className="h-11 md:h-9" data-testid="buka-halaman-advance" onClick={() => window.open("/advance", "_self")}>
            Buka halaman Advance
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function DaftarOrder() {
  const [orders, setOrders] = useState<RincianOrder[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importOrderOpen, setImportOrderOpen] = useState(false);
  const [modePicklist, setModePicklist] = useState<ModePicklist>("per_paket");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("semua");
  const [mp, setMp] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [hapusTarget, setHapusTarget] = useState<Target[] | null>(null);
  const [rincian, setRincian] = useState<RincianOrder | null>(null);
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

  async function hapusOrder(targets: Target[]): Promise<void> {
    if (targets.length === 0) return;
    setMengirim(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          aksi: "hapus",
          targets: targets.map((t) => ({ marketplace: t.mp, no_pesanan: t.no })),
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; dihapus?: number } | null;
      if (!res.ok || !data?.ok) {
        tampilkanGagalTulis(data?.error ?? `Gagal (${res.status}).`);
        return;
      }
      const n = data.dihapus ?? targets.length;
      toast.success(`${n} order dihapus.`);
      setHapusTarget(null);
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
    const dipilih = orders.filter((o) => terpilih.has(kunciOrder(o)));
    const targets = dipilih.map((o) => ({ marketplace: o.marketplace, no_pesanan: o.no_pesanan }));
    // Ingatkan SEBELUM mencetak bila ada order yang itemnya belum lengkap. Picklist yang
    // tercetak tanpa barang bermasalah membuat checker memverifikasi lembar yang tidak
    // lengkap tanpa tahu — lebih baik dicegah di sini daripada diketahui setelah kirim.
    const bermasalah = dipilih.filter((o) => o.items.some((it) => it.perlu_sku === true));
    const kosong = dipilih.filter((o) => o.items.length === 0);
    if (bermasalah.length > 0 || kosong.length > 0) {
      const bagian: string[] = [];
      if (bermasalah.length > 0) bagian.push(`${bermasalah.length} order punya baris belum ber-SKU`);
      if (kosong.length > 0) bagian.push(`${kosong.length} order belum punya item sama sekali`);
      const lanjut = window.confirm(
        `${bagian.join(" dan ")}.\n\nBaris tersebut tetap tercetak di bagian "PERLU SKU", tapi pastikan checker memeriksanya.\n\nLanjut cetak?`
      );
      if (!lanjut) return;
    }
    const q = new URLSearchParams({ aksi: "picklist-pdf", targets: JSON.stringify(targets), mode: modePicklist });
    // Mode gabung-order juga menyisir rak untuk booking advance aktif.
    if (modePicklist === "gabung-order") q.set("status", "menunggu");
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
          <div className="flex flex-wrap gap-2">
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="template-pesanan" onClick={() => window.open("/template-import-produk.xlsx", "_blank")}>
              <FileDown data-icon="inline-start" />
              Template
            </Button>
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="impor-pesanan" onClick={() => setImportOpen(true)}>
              <FileUp data-icon="inline-start" />
              Impor Pesanan
            </Button>
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="impor-order-shopee" onClick={() => setImportOrderOpen(true)}>
              <FileUp data-icon="inline-start" />
              Impor Shopee
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
                      {s === "semua" ? "Semua" : LABEL_STATUS[s] ?? s}
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
              { ke: "pack", label: "Disiapkan" },
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
              variant="destructive"
              className="h-9"
              data-testid="hapus-order-borongan"
              disabled={mengirim || terpilih.size === 0}
              onClick={() =>
                setHapusTarget(
                  (orders ?? []).filter((o) => terpilih.has(kunciOrder(o))).map((o) => ({ mp: o.marketplace, no: o.no_pesanan, ke: "" })),
                )
              }
            >
              Hapus
            </Button>
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
            <Select value={modePicklist} onValueChange={(v) => typeof v === "string" && setModePicklist(v as ModePicklist)}>
              <SelectTrigger className="h-9 w-32" data-testid="mode-picklist-order">
                <SelectValue>{(v: string | null) => MODE_PICKLIST.find((m) => m.mode === v)?.label ?? "Per Paket"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MODE_PICKLIST.map((m) => (
                    <SelectItem key={m.mode} value={m.mode}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        {modePicklist === "gabung-order" ? (
          <p className="text-xs text-muted-foreground" data-testid="bantuan-gabung-order">
            Mode ini menggabungkan order terpilih dengan booking advance berstatus “menunggu” ke satu lembar PDF, digabung per SKU + lokasi
            gudang — picker mengambil barang sekali saja untuk keduanya.
          </p>
        ) : null}

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
                  <TableHead>No Resi</TableHead>
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
                      {o.no_resi ? o.no_resi : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {new Date(o.tanggal * 1000).toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{LABEL_STATUS[o.status_fulfill] ?? o.status_fulfill}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{o.items.reduce((a, i) => a + i.qty, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(o.items.reduce((a, i) => a + i.subtotal, 0))}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {o.items.length > 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-9 md:h-7"
                            data-testid={`rincian-${o.no_pesanan}`}
                            onClick={() => setRincian(o)}
                          >
                            {o.items.length} item
                          </Button>
                        )}
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
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-9 md:h-7"
                          data-testid={`hapus-${o.no_pesanan}`}
                          disabled={mengirim}
                          onClick={() => setHapusTarget([{ mp: o.marketplace, no: o.no_pesanan, ke: "" }])}
                        >
                          Hapus
                        </Button>
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
                ? "Batal hanya mengubah status di sini — stok TIDAK dikembalikan WMS, karena potong stok dilakukan di Kledo. Batalkan juga di Kledo bila stok perlu masuk kembali. Lanjut?"
                : "Status order berubah. Stok tidak dipotong di sini — potong stok dilakukan admin Kledo. Lanjut?"}
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
      <AlertDialog
        open={hapusTarget !== null}
        onOpenChange={(v) => {
          if (!mengirim && !v) setHapusTarget(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-hapus-order">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hapusTarget && hapusTarget.length === 1 ? `Hapus order ${hapusTarget[0].no}?` : `Hapus ${hapusTarget?.length ?? 0} order?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Order hilang dari daftar ini dan dari picklist. Bila salah hapus, order harus diimpor ULANG dari file marketplace.
              Stok di WMS tidak berubah — koreksi stok tetap dilakukan di Kledo. Lanjut hapus?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="batal-hapus-order"
              onClick={() => setHapusTarget(null)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="konfirmasi-hapus-order"
              onClick={() => void hapusOrder(hapusTarget ?? [])}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Menghapus…" : "Ya, hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DialogImportExcel open={importOpen} onOpenChange={setImportOpen} tipe="pesanan" onSukses={() => void muat()} />
      <DialogImportOrder open={importOrderOpen} onOpenChange={setImportOrderOpen} onSukses={() => void muat()} />

      <Dialog open={Boolean(rincian)} onOpenChange={(v) => !v && setRincian(null)}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-2xl" data-testid="dialog-rincian-order">
          <DialogHeader>
            <DialogTitle>Rincian {rincian?.no_pesanan}</DialogTitle>
            <DialogDescription>
              {rincian?.items.length === 1
                ? "1 jenis barang pada pesanan ini."
                : `${rincian?.items.length} jenis barang; baris dengan SKU & variasi sama sudah digabung.`}
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Nama Shopee</TableHead>
                <TableHead>Variasi</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rincian?.items ?? []).map((it, i) => (
                <TableRow key={`${it.sku}-${it.variasi}-${i}`}>
                  <TableCell className="font-medium tabular-nums">{it.sku}</TableCell>
                  <TableCell className="max-w-56 truncate" title={it.nama_shopee}>{it.nama_shopee}</TableCell>
                  <TableCell>{it.variasi || "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{it.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(it.subtotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </>
  );
}
