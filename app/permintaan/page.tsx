"use client";

// H6 Permintaan Harian (PRD 15, FR-READ-06, 20; ui-spec 3.H6; PRD v3a 3).
// Seksi "Hari Ini" dicari by ID dokumen YYYY-MM-DD (tanpa composite index).
// v3a: state machine draft -> diproses -> selesai + 4 aksi (ubah jumlah, kirim form,
// kirim ulang, barang datang) + selesai manual.
import { useCallback, useEffect, useState } from "react";
import { Ban, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { DialogUbahJumlah } from "@/components/dashboard/dialog-ubah-jumlah";
import { DialogBarangDatang } from "@/components/dashboard/dialog-barang-datang";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatAngka, formatTanggal, idTanggalHariIni } from "@/lib/dashboard/format";
import { useData } from "@/lib/dashboard/sumber-data";
import type { DailyRequestDoc, DailyRequestItem } from "@/lib/dashboard/types";

const LABEL_STATUS: Record<string, string> = {
  draft: "Draft",
  diproses: "Diproses",
  selesai: "Selesai",
};

export default function HalamanPermintaan() {
  return (
    <ButuhAkses href="/permintaan">
      <Permintaan />
    </ButuhAkses>
  );
}

function Permintaan() {
  const data = useData();
  const [semua, setSemua] = useState<DailyRequestDoc[] | null>(null);
  const [stokMap, setStokMap] = useState<Map<string, number | null>>(new Map());
  const [error, setError] = useState(false);
  const [dialogUbah, setDialogUbah] = useState(false);
  const [dialogDatang, setDialogDatang] = useState(false);
  const [konfirmasiSelesai, setKonfirmasiSelesai] = useState(false);
  const [mengirim, setMengirim] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setError(false);
    setSemua(null);
    try {
      const [dokumen, stok] = await Promise.all([data.listDailyRequests(), data.listStock()]);
      setSemua(dokumen);
      setStokMap(new Map(stok.map((s) => [s.kode_barang, s.stok_gudang_online])));
    } catch {
      setError(true);
    }
  }, [data]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const hariIni = idTanggalHariIni();
  const dokumenHariIni = (semua ?? []).find((d) => d.tanggal === hariIni) ?? null;
  const status = dokumenHariIni?.status ?? "draft";
  const adaItem = (dokumenHariIni?.items.length ?? 0) > 0;
  const adaDesync =
    status === "diproses" &&
    (dokumenHariIni?.items ?? []).some((it) => it.qty !== (it.qty_diminta ?? it.qty));
  // Riwayat: dokumen lain, urut terbaru dulu (tanggal ID YYYY-MM-DD tersortir leksikografis).
  const riwayat = (semua ?? [])
    .filter((d) => d.tanggal !== hariIni)
    .slice()
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal));

  /** Kirim Form / Kirim Ulang. */
  async function kirimForm() {
    if (!dokumenHariIni) return;
    setMengirim("kirim");
    try {
      const res = await data.kirimFormPermintaan({ tanggal: dokumenHariIni.tanggal });
      if (res.ok) {
        toast.success(res.dikirim_ulang ? "Form terkirim" : "Form sudah terkirim sebelumnya");
        if (res.peringatan_kirim) {
          toast.warning(
            `Form tersimpan, tapi sebagian pesan gagal terkirim. Terkirim ke ${res.kirim_terkirim ?? 0} admin, ${res.kirim_gagal ?? 0} gagal.`
          );
        }
        await muat();
      } else {
        tampilkanGagalTulis(res.error);
      }
    } catch {
      toast.error("Gagal menyimpan. Coba lagi.");
    } finally {
      setMengirim(null);
    }
  }

  /** Selesai manual: item yang tidak akan datang. TIDAK bisa dibatalkan. */
  async function selesaikan() {
    if (!dokumenHariIni) return;
    setMengirim("selesai");
    try {
      const res = await data.selesaikanPermintaan({ tanggal: dokumenHariIni.tanggal });
      if (res.ok) {
        toast.success("Permintaan selesai");
        setKonfirmasiSelesai(false);
        await muat();
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error);
        if (!kedaluwarsa) setKonfirmasiSelesai(false);
      }
    } catch {
      toast.error("Gagal menyimpan. Coba lagi.");
    } finally {
      setMengirim(null);
    }
  }

  return (
    <>
      <PageHeader
        judul="Permintaan Harian"
        deskripsi="Kebutuhan minta stok ke gudang cabang."
      />

      <div className="flex flex-col gap-6" data-testid="h6-permintaan">
        {error ? (
          <Alert variant="destructive" data-testid="error-permintaan">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat permintaan harian.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              Periksa koneksi lalu coba lagi.
              <Button variant="outline" size="sm" onClick={() => void muat()}>
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : semua === null ? (
          <Memuat />
        ) : (
          <>
            <section className="flex flex-col gap-3" aria-labelledby="permintaan-hari-ini" data-testid="seksi-hari-ini">
              <div className="min-w-0">
                <h2 id="permintaan-hari-ini" className="text-base font-semibold">
                  Hari Ini
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {status === "selesai"
                    ? "Permintaan hari ini sudah selesai."
                    : "Daftar item yang perlu diminta hari ini."}
                </p>
              </div>

              {!dokumenHariIni ? (
                <Empty className="border border-dashed" data-testid="empty-hari-ini">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Send aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>Belum ada permintaan hari ini.</EmptyTitle>
                    <EmptyDescription>
                      Permintaan akan tampil di sini setelah bot menyusun daftarnya.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Card data-testid={`permintaan-${dokumenHariIni.tanggal}`}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      <span>{dokumenHariIni.tanggal}</span>
                      <Badge variant="outline" data-testid="status-permintaan">
                        {LABEL_STATUS[status] ?? status}
                      </Badge>
                      {adaDesync ? (
                        <Badge
                          variant="secondary"
                          title="Qty sekarang berbeda dari yang dikirim ke gudang"
                          data-testid="badge-desync"
                        >
                          Berubah sejak form terakhir dikirim
                        </Badge>
                      ) : null}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {dokumenHariIni.items.length} item · Dibuat{" "}
                      {formatTanggal(dokumenHariIni.created_at)}
                      {dokumenHariIni.form_dibuat_at
                        ? ` · Form dikirim ${formatTanggal(dokumenHariIni.form_dibuat_at)}`
                        : ""}
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {!adaItem ? (
                      <p className="text-sm text-muted-foreground" data-testid="empty-item-hari-ini">
                        Permintaan ini belum berisi item.
                      </p>
                    ) : (
                      <ul className="flex flex-col">
                        {(dokumenHariIni.items ?? []).map((it, i) => (
                          <li key={`${it.kode_barang}-${it.variasi}-${it.buffer === true}-${i}`}>
                            {i > 0 ? <Separator /> : null}
                            <BarisItem item={it} />
                          </li>
                        ))}
                      </ul>
                    )}

                    {status === "selesai" ? (
                      <p className="text-sm text-muted-foreground" data-testid="badge-selesai">
                        Permintaan selesai
                        {dokumenHariIni.selesai_at ? ` ${formatTanggal(dokumenHariIni.selesai_at)}` : ""} ·
                        data tidak bisa diubah.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <Button
                          variant="outline"
                          size="lg"
                          className="h-11 md:h-8"
                          disabled={!adaItem || mengirim !== null}
                          data-testid="tombol-ubah-jumlah"
                          onClick={() => setDialogUbah(true)}
                        >
                          Ubah Jumlah
                        </Button>

                        {status === "draft" ? (
                          <Button
                            size="lg"
                            className="h-11 md:h-8"
                            disabled={!adaItem || mengirim !== null}
                            data-testid="tombol-kirim-form"
                            onClick={() => void kirimForm()}
                          >
                            {mengirim === "kirim" ? <Spinner data-icon="inline-start" /> : null}
                            {mengirim === "kirim" ? "Mengirim..." : "Kirim Form"}
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="lg"
                              className="h-11 md:h-8"
                              disabled={!adaItem || mengirim !== null}
                              data-testid="tombol-kirim-ulang"
                              onClick={() => void kirimForm()}
                            >
                              {mengirim === "kirim" ? <Spinner data-icon="inline-start" /> : null}
                              {mengirim === "kirim" ? "Mengirim..." : "Kirim Ulang"}
                            </Button>
                            <Button
                              size="lg"
                              className="h-11 md:h-8"
                              disabled={!adaItem || mengirim !== null}
                              data-testid="tombol-barang-datang"
                              onClick={() => setDialogDatang(true)}
                            >
                              Barang Datang
                            </Button>
                            <Button
                              variant="outline"
                              size="lg"
                              className="h-11 md:h-8"
                              disabled={mengirim !== null}
                              data-testid="tombol-selesai"
                              onClick={() => setKonfirmasiSelesai(true)}
                            >
                              <Ban data-icon="inline-start" />
                              Selesai
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </section>

            <section className="flex flex-col gap-3" aria-labelledby="permintaan-riwayat" data-testid="seksi-riwayat">
              <div className="min-w-0">
                <h2 id="permintaan-riwayat" className="text-base font-semibold">
                  Riwayat
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Permintaan hari sebelumnya.
                </p>
              </div>

              {riwayat.length === 0 ? (
                <Empty className="border border-dashed" data-testid="empty-riwayat">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Send aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>Belum ada riwayat permintaan.</EmptyTitle>
                    <EmptyDescription>
                      Permintaan hari sebelumnya akan tampil di sini.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="flex flex-col gap-3" data-testid="daftar-riwayat">
                  {riwayat.map((d) => (
                    <li key={d.tanggal}>
                      <Card size="sm" data-testid={`riwayat-${d.tanggal}`}>
                        <CardHeader>
                          <CardTitle className="flex flex-wrap items-center gap-2">
                            <span className="tabular-nums">{d.tanggal}</span>
                            <Badge variant="outline">{LABEL_STATUS[d.status] ?? d.status}</Badge>
                          </CardTitle>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {d.items.length} item · Dibuat {formatTanggal(d.created_at)}
                          </p>
                        </CardHeader>
                        <CardContent>
                          <ul className="flex flex-col gap-1.5">
                            {d.items.map((it, i) => (
                              <li
                                key={`${it.kode_barang}-${it.variasi}-${i}`}
                                className="flex flex-wrap items-baseline gap-x-2"
                              >
                                <span className="truncate font-medium">{it.nama}</span>
                                <span className="text-xs text-muted-foreground">
                                  {it.variasi !== "-" ? it.variasi : "Tanpa variasi"}
                                </span>
                                <span className="text-xs tabular-nums">
                                  {formatAngka(it.qty)}
                                </span>
                                {it.buffer ? <Badge variant="outline">Buffer</Badge> : null}
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <DialogUbahJumlah
        open={dialogUbah}
        onOpenChange={setDialogUbah}
        dokumen={dokumenHariIni}
        stokMap={stokMap}
        onSukses={() => void muat()}
      />
      <DialogBarangDatang
        open={dialogDatang}
        onOpenChange={setDialogDatang}
        dokumen={dokumenHariIni}
        onSukses={() => void muat()}
      />

      <AlertDialog open={konfirmasiSelesai} onOpenChange={setKonfirmasiSelesai}>
        <AlertDialogContent data-testid="konfirmasi-selesai">
          <AlertDialogHeader>
            <AlertDialogTitle>Selesaikan permintaan hari ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Permintaan akan ditandai <span className="font-medium">selesai</span> dan item yang belum
              datang tidak akan bisa ditandai lagi. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9" disabled={mengirim !== null}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim !== null}
              data-testid="konfirmasi-selesai-ok"
              onClick={() => void selesaikan()}
            >
              {mengirim === "selesai" ? <Spinner data-icon="inline-start" /> : null}
              {mengirim === "selesai" ? "Menyimpan..." : "Ya, selesaikan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function BarisItem({ item }: { item: DailyRequestItem }) {
  const sudahDatang = item.status === "datang";
  const tidakDiminta = item.qty_diminta === 0 || (item.qty_diminta === null && item.qty === 0);
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3"
      data-testid={`item-${item.kode_barang}`}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{item.nama}</span>
        <span className="text-xs text-muted-foreground">
          {item.kode_barang}
          {item.variasi !== "-" ? ` · ${item.variasi}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {item.buffer ? <Badge variant="outline">Buffer</Badge> : null}
        {tidakDiminta ? <Badge variant="outline">Tidak diminta</Badge> : null}
        {sudahDatang ? (
          <Badge variant="secondary" data-testid={`datang-${item.kode_barang}`}>
            Datang {formatAngka(item.qty_datang)}/{formatAngka(item.qty_diminta ?? item.qty)}
          </Badge>
        ) : null}
        <span className="font-medium tabular-nums">{formatAngka(item.qty)}</span>
      </div>
    </div>
  );
}

function Memuat() {
  return (
    <div className="flex flex-col gap-6" data-testid="loading-permintaan" aria-busy>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}
