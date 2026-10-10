"use client";

// H2 Stok (PRD 15, 26; ui-spec 3.H2). Mobile = kartu, Desktop = tabel.
// Stok negatif = fitur: status "minus", filter "Perlu Minta Gudang Cabang",
// kekurangan = nilai absolut (PRD 13.6).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileDown, FileUp, PackagePlus, PackageSearch, Search, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { DialogKoreksiStok } from "@/components/dashboard/dialog-koreksi-stok";
import { DialogStokGudang } from "@/components/dashboard/dialog-stok-gudang";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { DialogTambahProduk } from "@/components/dashboard/dialog-tambah-produk";
import { DialogImportExcel } from "@/components/dashboard/dialog-import-excel";
import { AksiMassalKategori } from "@/components/dashboard/aksi-massal-kategori";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";
import { useData, useRole } from "@/lib/dashboard/sumber-data";
import type { GudangDoc, StockFilter, StockRow } from "@/lib/dashboard/types";

type Filter = "semua" | "menipis" | "minus" | "belum_petakan" | "kat_kosong";
type Sort = "nama" | "stok" | "kekurangan";

interface Target {
  kode: string;
  nama: string | null;
  stok: number | null;
}

interface TargetGudang {
  kode: string;
  nama: string | null;
  qtyPerGudang: Record<string, number>;
}

export default function HalamanStok() {
  return (
    <ButuhAkses href="/stok">
      <DaftarStok />
    </ButuhAkses>
  );
}

function DaftarStok() {
  const data = useData();
  const role = useRole();
  const bolehKoreksi = role === "owner" || role === "admin";
  const bolehUbahOnline = role === "owner" || role === "admin";

  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [gudang, setGudang] = useState<GudangDoc[]>([]);
  const [gudangId, setGudangId] = useState<string>("SEMUA");
  const [hanyaOnline, setHanyaOnline] = useState(true);
  const [pesanError, setPesanError] = useState<string | null>(null);
  const [cari, setCari] = useState("");
  const [filter, setFilter] = useState<Filter>("semua");
  const [sort, setSort] = useState<Sort>("nama");
  const [target, setTarget] = useState<Target | null>(null);
  const [targetGudang, setTargetGudang] = useState<TargetGudang | null>(null);
  const [tambahOpen, setTambahOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [onlineSedang, setOnlineSedang] = useState<string | null>(null);
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  // Daftar gudang untuk kontrol filter (F9). Gagal memuat -> filter tetap "Semua gudang".
  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const g = await data.listGudang();
        if (!batal) setGudang(g);
      } catch {
        // abaikan: filter gudang opsional, halaman tetap berguna tanpa daftar gudang.
      }
    })();
    return () => {
      batal = true;
    };
  }, [data]);

  const muat = useCallback(async () => {
    setPesanError(null);
    setRows(null);
    try {
      const f: StockFilter = {
        gudang_id: gudangId === "SEMUA" ? null : gudangId,
        is_online: hanyaOnline ? true : "semua",
      };
      setRows(await data.listStock(f));
    } catch (e) {
      setPesanError(e instanceof Error ? e.message : "Gagal memuat daftar stok.");
    }
  }, [data, gudangId, hanyaOnline]);

  useEffect(() => {
    void muat();
  }, [muat]);

  /** F8: toggle is_online per baris, lalu refetch supaya baris (mungkin) hilang dari filter online. */
  async function toggleOnline(r: StockRow) {
    setOnlineSedang(r.kode_barang);
    try {
      const res = await data.toggleOnlineProduk({
        kode_barang: r.kode_barang,
        is_online: !r.is_online_product,
      });
      if (res.ok) {
        toast.success(
          r.is_online_product
            ? `${r.nama_accurate ?? r.kode_barang} ditandai non-online.`
            : `${r.nama_accurate ?? r.kode_barang} ditandai online.`
        );
        await muat();
      } else {
        tampilkanGagalTulis(res.error);
      }
    } catch {
      toast.error("Gagal mengubah status online. Coba lagi.");
    } finally {
      setOnlineSedang(null);
    }
  }

  const hasil = useMemo(() => {
    if (!rows) return [];
    const q = cari.trim().toLowerCase();
    let out = rows.filter(
      (r) =>
        q === "" ||
        r.kode_barang.toLowerCase().includes(q) ||
        (r.nama_accurate ?? "").toLowerCase().includes(q)
    );
    if (filter === "menipis") out = out.filter((r) => r.status === "menipis");
    if (filter === "minus") out = out.filter((r) => r.status === "minus");
    if (filter === "belum_petakan") out = out.filter((r) => r.kategori && !r.terpetakan);
    if (filter === "kat_kosong") out = out.filter((r) => !r.kategori);

    const sorted = out.slice();
    if (filter === "minus") {
      // Daftar kekurangan: urut kekurangan terbesar (PRD 13.6).
      sorted.sort((a, b) => b.kekurangan - a.kekurangan);
    } else if (sort === "stok") {
      sorted.sort((a, b) => (a.stok_gudang_online ?? 0) - (b.stok_gudang_online ?? 0));
    } else if (sort === "kekurangan") {
      sorted.sort((a, b) => b.kekurangan - a.kekurangan);
    } else {
      sorted.sort((a, b) => (a.nama_accurate ?? a.kode_barang).localeCompare(b.nama_accurate ?? b.kode_barang, "id"));
    }
    return sorted;
  }, [rows, cari, filter, sort]);

  const teksKosong = filter === "minus" ? "Tidak ada produk minus." : "Tidak ada produk cocok.";

  function togglePilih(kode: string) {
    setTerpilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(kode)) baru.delete(kode);
      else baru.add(kode);
      return baru;
    });
  }

  return (
    <>
      <PageHeader
        judul="Stok"
        deskripsi="Daftar stok produk online."
        aksi={
          bolehKoreksi ? (
            <div className="flex gap-2">
              <Button
                size="lg"
                variant="outline"
                className="h-11 md:h-8"
                data-testid="buka-import-excel"
                onClick={() => setImportOpen(true)}
              >
                <FileUp data-icon="inline-start" />
                Import
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-11 md:h-8"
                data-testid="unduh-export-excel"
                onClick={() => {
                  const g = gudangId === "SEMUA" ? "ONLINE" : gudangId;
                  window.open(`/api/excel?format=export&tipe=produk&gudang_id=${encodeURIComponent(g)}`, "_blank");
                }}
              >
                <FileDown data-icon="inline-start" />
                Export
              </Button>
              <Button
                size="lg"
                className="h-11 md:h-8"
                data-testid="buka-tambah-produk"
                onClick={() => setTambahOpen(true)}
              >
                <PackagePlus data-icon="inline-start" />
                Tambah Produk
              </Button>
            </div>
          ) : null
        }
      />

      <div className="flex flex-col gap-4">
        {/* F9: filter gudang + toggle online (default ON, paritas perilaku lama). */}
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-full sm:max-w-xs">
            <FieldLabel htmlFor="filter-gudang-stok">Gudang</FieldLabel>
            <Select
              value={gudangId}
              onValueChange={(v) => {
                if (typeof v === "string") setGudangId(v)
              }}
            >
              <SelectTrigger
                id="filter-gudang-stok"
                className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                data-testid="filter-gudang-stok"
              >
                <SelectValue>
                  {(v: string | null) =>
                    v && v !== "SEMUA"
                      ? (gudang.find((g) => g.gudang_id === v)?.nama ?? v)
                      : "Semua gudang"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="SEMUA">Semua gudang</SelectItem>
                  {gudang.map((g) => (
                    <SelectItem key={g.gudang_id} value={g.gudang_id}>
                      {g.nama}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <ToggleGroup
            variant="outline"
            value={hanyaOnline ? ["on"] : []}
            onValueChange={(v) => setHanyaOnline(v.includes("on"))}
            aria-label="Filter produk online"
            data-testid="filter-online-stok"
          >
            <ToggleGroupItem value="on" className="h-11 md:h-8" data-testid="toggle-hanya-online">
              Hanya produk online
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari kode atau nama produk"
              aria-label="Cari produk"
              data-testid="cari-stok"
              className="h-11 pl-8 md:h-8"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <ToggleGroup
              variant="outline"
              value={[filter]}
              onValueChange={(v) => v[0] && setFilter(v[0] as Filter)}
              aria-label="Filter status stok"
              className="flex-wrap"
              data-testid="filter-stok"
            >
              <ToggleGroupItem value="semua" className="h-11 md:h-8">
                Semua
              </ToggleGroupItem>
              <ToggleGroupItem value="menipis" className="h-11 md:h-8">
                Menipis
              </ToggleGroupItem>
              <ToggleGroupItem value="minus" className="h-11 md:h-8" data-testid="filter-minus">
                Perlu Minta Gudang Cabang
              </ToggleGroupItem>
              <ToggleGroupItem value="belum_petakan" className="h-11 md:h-8" data-testid="filter-belum-petakan">
                Belum terpetakan
              </ToggleGroupItem>
              <ToggleGroupItem value="kat_kosong" className="h-11 md:h-8" data-testid="filter-kat-kosong">
                Kategori kosong
              </ToggleGroupItem>
            </ToggleGroup>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground" id="label-sort-stok">
                Urutkan:
              </span>
              <ToggleGroup
                variant="outline"
                value={[sort]}
                onValueChange={(v) => v[0] && setSort(v[0] as Sort)}
                aria-labelledby="label-sort-stok"
                className="flex-wrap"
                data-testid="sort-stok"
              >
                <ToggleGroupItem value="nama" className="h-11 md:h-8">
                  Nama
                </ToggleGroupItem>
                <ToggleGroupItem value="stok" className="h-11 md:h-8">
                  Stok
                </ToggleGroupItem>
                <ToggleGroupItem value="kekurangan" className="h-11 md:h-8">
                  Kekurangan
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>

        {rows !== null && rows.some((r) => !r.kategori || !r.terpetakan) ? (
          <Alert data-testid="ringkasan-kategori-stok">
            <AlertTitle>Kategori Shopee belum lengkap</AlertTitle>
            <AlertDescription>
              {rows.filter((r) => !r.kategori).length} produk kategori kosong ·{" "}
              {rows.filter((r) => r.kategori && !r.terpetakan).length} belum terpetakan.{" "}
              <button type="button" className="font-medium underline" onClick={() => setFilter("belum_petakan")}>
                Lihat daftar
              </button>
            </AlertDescription>
          </Alert>
        ) : null}

        {role === "owner" ? (
          <AksiMassalKategori sku={[...terpilih]} onSukses={() => { setTerpilih(new Set()); void muat(); }} />
        ) : null}

        {pesanError ? (
          <Alert variant="destructive" data-testid="error-stok">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat daftar stok.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              {pesanError}
              <Button variant="outline" size="sm" onClick={() => void muat()}>
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : rows === null ? (
          <Memuat />
        ) : hasil.length === 0 ? (
          <Empty className="border border-dashed" data-testid="empty-stok">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageSearch aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{teksKosong}</EmptyTitle>
              <EmptyDescription>
                {filter === "minus"
                  ? "Semua produk online masih punya saldo cukup."
                  : "Ubah kata kunci atau filter untuk melihat produk lain."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {/* Mobile: kartu */}
            <ul className="flex flex-col gap-3 md:hidden" data-testid="daftar-stok-kartu">
              {hasil.map((r) => (
                <li key={r.kode_barang}>
                  <Card size="sm">
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/produk/${encodeURIComponent(r.kode_barang)}`}
                            className="block truncate font-medium hover:underline"
                            title={r.nama_accurate ?? undefined}
                          >
                            {r.nama_accurate ?? r.kode_barang}
                          </Link>
                          <p className="text-xs text-muted-foreground">{r.kode_barang}</p>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      <dl className="grid grid-cols-3 gap-2 text-sm">
                        <Sel label={gudangId === "SEMUA" ? "Stok" : "Stok gudang"}>
                          <span className="tabular-nums">{formatAngka(r.stok_gudang_online)}</span>
                          {r.status === "minus" ? (
                            <span className="block text-xs text-destructive">
                              Kurang {formatAngka(r.kekurangan)}
                            </span>
                          ) : null}
                        </Sel>
                        {gudangId !== "SEMUA" ? (
                          <Sel label="Stok online">
                            <span className="tabular-nums">
                              {formatAngka(r.qty_per_gudang.ONLINE)}
                            </span>
                          </Sel>
                        ) : null}
                        <Sel label="Reorder">
                          <span className="tabular-nums">{formatAngka(r.reorder_point)}</span>
                        </Sel>
                        <Sel label="HPP">
                          <span className="tabular-nums">{formatRupiah(r.hpp)}</span>
                        </Sel>
                      </dl>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={r.is_online_product ? "secondary" : "outline"}>
                          {r.is_online_product ? "Online" : "Non-online"}
                        </Badge>
                        {bolehUbahOnline ? (
                          <Button
                            variant="outline"
                            size="lg"
                            className="h-11"
                            disabled={onlineSedang === r.kode_barang}
                            data-testid={`toggle-online-${r.kode_barang}`}
                            onClick={() => void toggleOnline(r)}
                          >
                            {onlineSedang === r.kode_barang ? (
                              <Spinner data-icon="inline-start" />
                            ) : null}
                            {r.is_online_product ? "Jadikan non-online" : "Jadikan online"}
                          </Button>
                        ) : null}
                      </div>
                      {bolehKoreksi ? (
                        <Button
                          variant="outline"
                          size="lg"
                          className="h-11 w-full"
                          data-testid={`koreksi-${r.kode_barang}`}
                          onClick={() =>
                            setTarget({
                              kode: r.kode_barang,
                              nama: r.nama_accurate,
                              stok: r.stok_gudang_online,
                            })
                          }
                        >
                          Koreksi
                        </Button>
                      ) : null}
                      {bolehKoreksi ? (
                        <Button
                          variant="outline"
                          size="lg"
                          className="h-11 w-full"
                          data-testid={`stok-gudang-${r.kode_barang}`}
                          onClick={() =>
                            setTargetGudang({
                              kode: r.kode_barang,
                              nama: r.nama_accurate,
                              qtyPerGudang: r.qty_per_gudang,
                            })
                          }
                        >
                          Gudang
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>

            {/* Desktop: tabel */}
            <div className="hidden md:block" data-testid="tabel-stok">
              <Table>
                <TableHeader>
                  <TableRow>
                    {role === "owner" ? <TableHead className="w-10">Pilih</TableHead> : null}
                    <TableHead>Kode</TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead className="text-right">HPP</TableHead>
                    <TableHead className="text-right">Stok</TableHead>
                    {gudangId !== "SEMUA" ? (
                      <TableHead className="text-right">Stok online</TableHead>
                    ) : null}
                    <TableHead className="text-right">Reorder</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Kanal</TableHead>
                    {bolehKoreksi ? <TableHead className="text-right">Aksi</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hasil.map((r) => (
                    <TableRow key={r.kode_barang} data-testid={`baris-${r.kode_barang}`}>
                      {role === "owner" ? (
                        <TableCell>
                          <input
                            type="checkbox"
                            className="size-5 accent-primary"
                            aria-label={`Pilih ${r.kode_barang}`}
                            data-testid={`pilih-${r.kode_barang}`}
                            checked={terpilih.has(r.kode_barang)}
                            onChange={() => togglePilih(r.kode_barang)}
                          />
                        </TableCell>
                      ) : null}
                      <TableCell className="font-medium">{r.kode_barang}</TableCell>
                      <TableCell className="max-w-64 truncate">
                          <Link
                            href={`/produk/${encodeURIComponent(r.kode_barang)}`}
                            className="hover:underline"
                            title={r.nama_accurate ?? undefined}
                          >
                          {r.nama_accurate ?? "â€”"}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-48 truncate" title={r.kategori ?? undefined}>
                        {r.kategori ? (
                          <span className={r.terpetakan ? "" : "text-yellow-700"}>
                            {r.kategori.length > 40 ? `${r.kategori.slice(0, 40)}…` : r.kategori}
                          </span>
                        ) : (
                          <Badge variant="destructive" data-testid={`kat-kosong-${r.kode_barang}`}>Kosong</Badge>
                        )}
                        {r.kategori && !r.terpetakan ? (
                          <Badge variant="outline" className="ml-1" data-testid={`kat-belum-${r.kode_barang}`}>Belum terpetakan</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRupiah(r.hpp)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatAngka(r.stok_gudang_online)}
                        {r.status === "minus" ? (
                          <span className="block text-xs text-destructive">
                            Kurang {formatAngka(r.kekurangan)}
                          </span>
                        ) : null}
                      </TableCell>
                      {gudangId !== "SEMUA" ? (
                        <TableCell className="text-right tabular-nums">
                          {formatAngka(r.qty_per_gudang.ONLINE)}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right tabular-nums">
                        {formatAngka(r.reorder_point)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell>
                        {bolehUbahOnline ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-11 md:h-8"
                            disabled={onlineSedang === r.kode_barang}
                            aria-pressed={r.is_online_product}
                            data-testid={`toggle-online-${r.kode_barang}`}
                            onClick={() => void toggleOnline(r)}
                          >
                            {onlineSedang === r.kode_barang ? (
                              <Spinner data-icon="inline-start" />
                            ) : null}
                            {r.is_online_product ? "Online" : "Non-online"}
                          </Button>
                        ) : (
                          <Badge variant={r.is_online_product ? "secondary" : "outline"}>
                            {r.is_online_product ? "Online" : "Non-online"}
                          </Badge>
                        )}
                      </TableCell>
                      {bolehKoreksi ? (
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`koreksi-${r.kode_barang}`}
                            onClick={() =>
                              setTarget({
                                kode: r.kode_barang,
                                nama: r.nama_accurate,
                                stok: r.stok_gudang_online,
                              })
                            }
                          >
                            Koreksi
                          </Button>
                        </TableCell>
                      ) : null}
                      {bolehKoreksi ? (
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`stok-gudang-${r.kode_barang}`}
                            onClick={() =>
                              setTargetGudang({
                                kode: r.kode_barang,
                                nama: r.nama_accurate,
                                qtyPerGudang: r.qty_per_gudang,
                              })
                            }
                          >
                            Gudang
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      <DialogTambahProduk
        open={tambahOpen}
        onOpenChange={setTambahOpen}
        onSukses={() => void muat()}
      />

      <DialogImportExcel
        open={importOpen}
        onOpenChange={setImportOpen}
        gudangId={gudangId === "SEMUA" ? "ONLINE" : gudangId}
        onSukses={() => void muat()}
      />

      <DialogKoreksiStok
        open={target !== null}
        onOpenChange={(v) => {
          if (!v) setTarget(null);
        }}
        kode={target?.kode ?? ""}
        nama={target?.nama ?? null}
        stokSekarang={target?.stok ?? 0}
        onSukses={() => void muat()}
      />
      <DialogStokGudang
        open={targetGudang !== null}
        onOpenChange={(v) => {
          if (!v) setTargetGudang(null);
        }}
        kode={targetGudang?.kode ?? ""}
        nama={targetGudang?.nama ?? null}
        qtyPerGudang={targetGudang?.qtyPerGudang ?? {}}
        onSukses={() => void muat()}
      />
    </>
  );
}

function Sel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

function Memuat() {
  return (
    <div className="flex flex-col gap-3" data-testid="loading-stok" aria-busy>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}


