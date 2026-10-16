"use client";

// Halaman "Produk Total" — daftar LENGKAP katalog (1174 produk) dengan lima kolom saja:
// No. | Nama Produk | SKU | Lokasi Gudang | Quantity Total.
//
// Beda dari /stok (superset berat: kategori/GO/HPP/reorder/status/kanal/aksi): di sini
// cuma angka yang diminta, dan yang mahal — lokasi + total — dihitung SERVER. Klien tidak
// pernah memegang seluruh katalog: urutan + paginasi dikerjakan D1 (scope `produk-total`).
// Kalau 1174 baris ditarik utuh lalu diiris di klien, `LIMIT` di lapisan JOIN akan memotong
// di tengah produk: satu SKU dengan 6 gudang menghabiskan 6 baris jatah, sehingga SKU
// hilang tanpa pesan dan nomor halaman menunjuk halaman kosong. (Cacat itu nyata di /stok
// sebelum paginasinya dipindah ke server — lihat catatan di app/api/baca/route.ts.)
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, PackageSearch, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { FooterPaginasi } from "@/components/dashboard/footer-paginasi";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAngka } from "@/lib/dashboard/format";
import { useData } from "@/lib/dashboard/sumber-data";
import type { ProdukTotalRow, UrutProdukTotal } from "@/lib/dashboard/types";

/** Pilihan ukuran halaman. 200 = cap keras server; di sini sengaja lebih kecil. */
const UKURAN = [25, 50, 100, 200] as const;

/** Kunci urut yang ditawarkan UI. `null` = belum diurutkan (server memakai default "nama"). */
type Arah = "asc" | "desc";

// Header yang bisa diklik. `No.` sengaja TIDAK ada di sini: ia penghitung baris, bukan
// properti produk — mengurutkannya tidak punya arti apa pun bagi pengguna.
interface KolomUrut {
  kunci: UrutProdukTotal;
  label: string;
  /** Angka dirata-kanan supaya digit sejajar; teks rata kiri. */
  rata?: "kanan";
}

const KOLOM_URUT: KolomUrut[] = [
  { kunci: "nama", label: "Nama Produk" },
  { kunci: "sku", label: "SKU" },
  { kunci: "lokasi", label: "Lokasi Gudang" },
  { kunci: "qty", label: "Quantity Total", rata: "kanan" },
];

export default function HalamanProdukTotal() {
  return (
    <ButuhAkses href="/produk-total">
      <DaftarProdukTotal />
    </ButuhAkses>
  );
}

function DaftarProdukTotal() {
  const data = useData();

  const [rows, setRows] = useState<ProdukTotalRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [ukuranHalaman, setUkuranHalaman] = useState<number>(50);
  const [halaman, setHalaman] = useState(1);
  // null = pakai default server (nama ASC). Dibedakan dari "nama ASC" supaya panah di
  // header hanya menyala saat pengguna benar-benar memilih, bukan sejak halaman dibuka.
  const [urut, setUrut] = useState<UrutProdukTotal | null>(null);
  const [arah, setArah] = useState<Arah>("asc");
  const [pesanError, setPesanError] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setPesanError(null);
    setRows(null);
    try {
      const hasil = await data.listProdukTotal({
        halaman,
        ukuran: ukuranHalaman,
        urut: urut ?? undefined,
        arah,
      });
      setRows(hasil.rows);
      setTotal(hasil.total);
    } catch (e) {
      setPesanError(e instanceof Error ? e.message : "Gagal memuat daftar produk.");
    }
  }, [data, halaman, ukuranHalaman, urut, arah]);

  useEffect(() => {
    void muat();
  }, [muat]);

  // Ubah kriteria -> kembali ke halaman 1. Tanpa ini, mengganti ukuran halaman saat berada
  // di halaman 6 bisa mendarat di halaman yang tidak ada lagi.
  useEffect(() => {
    setHalaman(1);
  }, [ukuranHalaman, urut, arah]);

  /**
   * Klik kolom: kolom yang sama membalik arah, kolom lain mulai dari ASC (A–Z).
   * Arah dan kunci dikirim ke server, jadi urutannya berlaku untuk SELURUH 1174 produk
   * — bukan hanya yang tampak di halaman ini.
   */
  function klikUrut(kunci: UrutProdukTotal) {
    if (urut === kunci) setArah((a) => (a === "asc" ? "desc" : "asc"));
    else {
      setUrut(kunci);
      setArah("asc");
    }
  }

  const jumlahHalaman = Math.max(1, Math.ceil(total / ukuranHalaman));
  // Server sudah menjepit, tapi state bisa tertinggal satu langkah saat total menyusut.
  const halamanAman = Math.min(halaman, jumlahHalaman);
  const mulai = (halamanAman - 1) * ukuranHalaman;

  return (
    <>
      <PageHeader
        judul="Produk Total"
        deskripsi="Seluruh produk, lokasi gudang, dan quantity total."
        aksi={
          <Select value={String(ukuranHalaman)} onValueChange={(v) => typeof v === "string" && setUkuranHalaman(Number(v))}>
            <SelectTrigger className="h-11 w-40 md:h-8" data-testid="ukuran-halaman">
              <SelectValue>{`${ukuranHalaman} / halaman`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {UKURAN.map((u) => (
                  <SelectItem key={u} value={String(u)}>{`${u} / halaman`}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />

      <div className="flex flex-col gap-4">
        {pesanError ? (
          <Alert variant="destructive" data-testid="error-produk-total">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat daftar produk.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              Periksa koneksi lalu coba lagi.
              <Button variant="outline" size="sm" onClick={() => void muat()}>
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : rows === null ? (
          <Memuat />
        ) : rows.length === 0 ? (
          <Empty className="border border-dashed" data-testid="empty-produk-total">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageSearch aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Belum ada produk.</EmptyTitle>
              <EmptyDescription>Katalog masih kosong.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {/* Mobile: kartu. Tabel 5 kolom tidak terbaca di layar sempit. */}
            <ul className="flex flex-col gap-3 md:hidden" data-testid="daftar-produk-total-kartu">
              {rows.map((r, i) => (
                <li key={r.kode_barang}>
                  <div className="rounded-xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 font-medium" title={r.nama_accurate ?? undefined}>
                        <span className="mr-2 tabular-nums text-muted-foreground">{mulai + i + 1}.</span>
                        {r.nama_accurate ?? "—"}
                      </p>
                      <span className="shrink-0 tabular-nums font-semibold">
                        {formatAngka(r.quantity_total)}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <Sel label="SKU"><span className="font-mono">{r.kode_barang}</span></Sel>
                      <Sel label="Lokasi Gudang">
                        <span>{r.lokasi_gudang || "—"}</span>
                        {r.gudang_lain ? (
                          <span className="ml-1 text-xs text-muted-foreground">{r.gudang_lain}</span>
                        ) : null}
                      </Sel>
                    </dl>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: tabel */}
            <div className="hidden md:block" data-testid="tabel-produk-total">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">No.</TableHead>
                    {KOLOM_URUT.map((k) => (
                      <KepalaUrut key={k.kunci} kolom={k} aktif={urut} arah={arah} onKlik={klikUrut} />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={r.kode_barang} data-testid={`baris-${r.kode_barang}`}>
                      {/* Nomor baris GLOBAL: offset + index + 1. Bukan 1..N per halaman —
                          daftar "total" yang mengulang nomor dari 1 di tiap halaman tidak
                          bisa dipakai untuk menyebut posisi sebuah produk. */}
                      <TableCell className="tabular-nums text-muted-foreground">{mulai + i + 1}</TableCell>
                      <TableCell className="max-w-96 truncate" title={r.nama_accurate ?? undefined}>
                        {r.nama_accurate ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono">{r.kode_barang}</TableCell>
                      <TableCell>
                        {r.lokasi_gudang || "—"}
                        {r.gudang_lain ? (
                          <span className="ml-1 text-xs text-muted-foreground" title={r.gudang_lain}>
                            {r.gudang_lain}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatAngka(r.quantity_total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <FooterPaginasi
              halaman={halamanAman}
              jumlahHalaman={jumlahHalaman}
              barisTampil={rows.length}
              mulai={mulai}
              total={total}
              onHalaman={setHalaman}
            />
          </>
        )}
      </div>
    </>
  );
}

/** Satu header yang bisa diklik. Panah menandai kolom + arah yang sedang aktif. */
function KepalaUrut({
  kolom,
  aktif,
  arah,
  onKlik,
}: {
  kolom: KolomUrut;
  aktif: UrutProdukTotal | null;
  arah: Arah;
  onKlik: (kunci: UrutProdukTotal) => void;
}) {
  return (
    <TableHead className={kolom.rata === "kanan" ? "text-right" : undefined} aria-sort={statusUrut(kolom.kunci, aktif, arah)}>
      <TombolUrut
        label={kolom.label}
        kunci={kolom.kunci}
        aktif={aktif}
        arah={arah}
        onKlik={onKlik}
        rata={kolom.rata}
      />
    </TableHead>
  );
}

/**
 * `aria-sort` hanya sah pada `columnheader` (role yang dibawa `TableHead`), bukan pada
 * tombol di dalamnya. Karena itu statusnya dihitung di sini dan dipasang oleh pemanggil.
 */
function statusUrut(
  kunci: UrutProdukTotal,
  aktif: UrutProdukTotal | null,
  arah: Arah
): "ascending" | "descending" | "none" {
  if (aktif !== kunci) return "none";
  return arah === "asc" ? "ascending" : "descending";
}

function TombolUrut({
  label,
  kunci,
  aktif,
  arah,
  onKlik,
  rata,
}: {
  label: string;
  kunci: UrutProdukTotal;
  aktif: UrutProdukTotal | null;
  arah: Arah;
  onKlik: (kunci: UrutProdukTotal) => void;
  rata?: "kanan";
}) {
  const ini = aktif === kunci;
  return (
    <button
      type="button"
      onClick={() => onKlik(kunci)}
      data-testid={`urut-${kunci}`}
      className={`inline-flex items-center gap-1 hover:underline ${rata === "kanan" ? "justify-end" : ""}`}
      title={ini ? "Klik untuk membalik arah" : "Klik untuk mengurutkan"}
    >
      {label}
      {ini ? (
        arah === "asc" ? <ArrowUp className="size-4" aria-hidden /> : <ArrowDown className="size-4" aria-hidden />
      ) : (
        <ArrowUpDown className="size-4 opacity-40" aria-hidden />
      )}
    </button>
  );
}

function Sel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Kerangka baris: tinggi kolom tetap supaya tabel tidak melompat saat data masuk. */
function Memuat() {
  return (
    <div className="flex flex-col gap-2" data-testid="memuat-produk-total">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
