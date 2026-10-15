"use client";

// H5 Draft Pending interaktif (PRD v3b §10.3 F3 / §10.4 B6; ui-spec 3.H5).
// Satu seksi: picking list (per BATCH). Opname & sync TIDAK lagi di sini — real.ts selalu
// mengembalikan `[]` untuk keduanya (hanya ada di jalur Telegram), jadi request-nya dibuang.
// Owner/admin dapat mengonfirmasi atau membatalkan langsung dari sini; Telegram tetap jalur cadangan.
import { useCallback, useEffect, useState } from "react";
import { Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { useData, useRole } from "@/lib/dashboard/sumber-data";
import type { PickingBatchDoc } from "@/lib/dashboard/types";

export default function HalamanDraft() {
  return (
    <ButuhAkses href="/draft">
      <Draft />
    </ButuhAkses>
  );
}

/** Hak aksi per draft/batch: owner semua, admin hanya miliknya, lainnya tidak. */
type Gerbang = "aksi" | "bukan_pembuat" | "tanpa_pemilik";

function gerbangAksi(
  role: string,
  uid: string | null,
  owner: string | null | undefined
): Gerbang {
  if (role !== "owner" && role !== "admin") return "bukan_pembuat";
  if (owner == null || String(owner).trim() === "") return "tanpa_pemilik";
  if (role === "admin" && String(uid) !== String(owner)) return "bukan_pembuat";
  return "aksi";
}

function Draft() {
  const data = useData();
  const [picking, setPicking] = useState<PickingBatchDoc[] | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const muat = useCallback(async () => {
    setError(false);
    setPicking(null);
    try {
      // Opname & sync diambil dari draft inline yang sudah tidak ada di DataSource: real.ts
      // selalu mengembalikan `[]` untuk keduanya (draft opname/sync hanya hidup di jalur
      // Telegram + `konfirmasiDraft`). Request yang selalu kosong = rate limit terbuang,
      // jadi seksi itu dihapus, bukan sekadar disembunyikan.
      const [p, sesi] = await Promise.all([data.listPickingDrafts(), data.getSession()]);
      setPicking(p);
      setUid(sesi.user.id);
    } catch {
      setError(true);
    }
  }, [data]);

  useEffect(() => {
    void muat();
  }, [muat]);

  return (
    <>
      <PageHeader
        judul="Draft Pending"
        deskripsi="Draft yang menunggu konfirmasi. Owner dan admin dapat mengonfirmasi atau membatalkan dari sini; Telegram tetap bisa dipakai."
      />

      <div className="flex flex-col gap-6" data-testid="h5-draft">
        {error ? (
          <Alert variant="destructive" data-testid="error-draft">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat draft pending.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              Periksa koneksi lalu coba lagi.
              <Button variant="outline" size="sm" onClick={() => void muat()}>
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : picking === null ? (
          <Memuat />
        ) : (
          <>
            <Seksi
              id="draft-picking"
              judul="Picking List"
              deskripsi="Batch picking list yang menunggu konfirmasi."
              jumlah={picking.length}
            >
              {picking.length === 0 ? (
                <Kosong
                  ikon={<Send aria-hidden />}
                  judul="Belum ada picking list."
                  deskripsi="Batch picking akan tampil di sini setelah bot membaca daftar dari chat."
                  testId="empty-picking"
                />
              ) : (
                <ul className="flex flex-col gap-3" data-testid="daftar-picking">
                  {picking.map((b) => (
                    <li key={b.batch_id}>
                      <DraftPicking batch={b} uid={uid} onSukses={muat} />
                    </li>
                  ))}
                </ul>
              )}
            </Seksi>
          </>
        )}
      </div>
    </>
  );
}

// ---------------- Keputusan aksi per kartu ----------------

function BadgePemilik({
  id,
  gerbang,
  owner,
}: {
  id: string;
  gerbang: Gerbang;
  owner: string | null | undefined;
}) {
  if (gerbang === "tanpa_pemilik") {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge
          variant="secondary"
          className="text-base md:text-xs"
          data-testid={`badge-pemilik-tak-diketahui-${id}`}
        >
          Pemilik tidak diketahui
        </Badge>
        <span className="text-xs text-muted-foreground">Proses lewat Telegram</span>
      </span>
    );
  }
  if (gerbang === "bukan_pembuat") {
    return <span className="text-xs text-muted-foreground">Hanya pembuat draft atau owner</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge
        variant="outline"
        className="text-base md:text-xs"
        data-testid={`badge-pemilik-diketahui-${id}`}
      >
        Pemilik {String(owner)}
      </Badge>
    </span>
  );
}

// ---------------- Kartu picking batch ----------------

function DraftPicking({
  batch,
  uid,
  onSukses,
}: {
  batch: PickingBatchDoc;
  uid: string | null;
  onSukses: () => void;
}) {
  const gerbang = gerbangAksi(useRole(), uid, batch.owner_user_id);
  const id = batch.batch_id;

  return (
    <Card size="sm" data-testid={`kartu-picking-${id}`}>
      <CardHeader>
        <CardTitle className="tabular-nums">
          {batch.movements.length} movement
        </CardTitle>
        <p
          className="text-sm text-muted-foreground tabular-nums"
          data-testid={`ringkasan-picking-batch-${id}`}
        >
          {batch.siap} item siap diproses, {batch.dilewati} dilewati (produk tak ketemu/ragu)
        </p>
        {batch.sebagian ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge
              variant="secondary"
              className="text-base md:text-xs"
              data-testid={`badge-picking-sebagian-${id}`}
            >
              Diproses sebagian
            </Badge>
            <span className="text-xs text-muted-foreground">Selesaikan lewat Telegram</span>
          </span>
        ) : (
          <BadgePemilik id={id} gerbang={gerbang} owner={batch.owner_user_id} />
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1.5">
          {batch.movements.map((m) => (
            <li key={m.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate font-medium">{m.nama_terbaca ?? "—"}</span>
              {m.kode_barang ? (
                <span className="text-xs text-muted-foreground">{m.kode_barang}</span>
              ) : (
                <Badge variant="outline">Tanpa kode</Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {m.qty ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-2">
        {batch.sebagian ? (
          <span className="text-xs text-muted-foreground">Selesaikan lewat Telegram</span>
        ) : gerbang === "aksi" ? (
          <AksiDraft
            id={id}
            onSukses={onSukses}
            ringkasan={
              <>
                <span>Konfirmasi picking?</span>
                <span>
                  Batch {batch.siap} item siap diproses, {batch.dilewati} dilewati (produk tak
                  ketemu/ragu).
                </span>
              </>
            }
          />
        ) : null}
      </CardFooter>
    </Card>
  );
}

// ---------------- Dialog konfirmasi/batal picking ----------------

function AksiDraft({
  id,
  ringkasan,
  onSukses,
}: {
  id: string;
  ringkasan: React.ReactNode;
  onSukses: () => void;
}) {
  const data = useData();
  const [dialog, setDialog] = useState<"apply" | "batal" | null>(null);
  const [mengirim, setMengirim] = useState(false);

  async function kirim(aksi: "apply" | "batal") {
    setMengirim(true);
    try {
      const res = await data.konfirmasiDraft({ jenis: "picking", batch_id: id, aksi_draft: aksi });
      if (res.ok) {
        if (aksi === "batal") {
          toast.success("Draft dibatalkan.");
        } else if (res.sisa != null && res.sisa > 0) {
          toast.success("Sebagian diproses. Masih ada kelompok lain yang menunggu.");
        } else {
          toast.success("Draft diproses.");
        }
        setDialog(null);
        onSukses();
      } else {
        // 401: dialog TETAP TERBUKA, state apa pun tidak direset (PRD v3b §10.4).
        const kedaluwarsa = tampilkanGagalTulis(res.error);
        if (!kedaluwarsa) {
          // 409/403/404/500: tutup dialog + refetch agar kartu basi hilang.
          setDialog(null);
          onSukses();
        }
      }
    } catch {
      toast.error("Gagal memproses draft. Coba lagi.");
    } finally {
      setMengirim(false);
    }
  }

  return (
    <>
      <Button
        variant="default"
        size="sm"
        className="h-11 md:h-8"
        data-testid={`konfirmasi-picking-batch-${id}`}
        onClick={() => setDialog("apply")}
      >
        Konfirmasi
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-11 md:h-8"
        data-testid={`batalkan-picking-batch-${id}`}
        onClick={() => setDialog("batal")}
      >
        Batalkan
      </Button>

      <AlertDialog
        open={dialog !== null}
        onOpenChange={(v) => {
          if (!mengirim && !v) setDialog(null);
        }}
      >
        <AlertDialogContent
          data-testid={dialog === "batal" ? "dialog-batalkan-picking" : "dialog-konfirmasi-picking"}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === "batal" ? "Batalkan picking?" : "Konfirmasi picking?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-1">
              {dialog === "batal" ? (
                <span>Draft akan dibatalkan dan tidak disamakan. Tidak bisa diurungkan.</span>
              ) : (
                ringkasan
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={dialog === "batal" ? "batal-batalkan-picking" : "batal-konfirmasi-picking"}
              onClick={() => setDialog(null)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={
                dialog === "batal"
                  ? `batalkan-picking-ok-${id}`
                  : `konfirmasi-picking-ok-${id}`
              }
              onClick={() => void kirim(dialog ?? "apply")}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Memproses..." : dialog === "batal" ? "Ya, batalkan" : "Ya, konfirmasi"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Seksi({
  id,
  judul,
  deskripsi,
  jumlah,
  children,
}: {
  id: string;
  judul: string;
  deskripsi: string;
  jumlah: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${id}-judul`} data-testid={id}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-judul`} className="text-base font-semibold">
            {judul}
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {jumlah}
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{deskripsi}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Kosong({
  ikon,
  judul,
  deskripsi,
  testId,
}: {
  ikon: React.ReactNode;
  judul: string;
  deskripsi: string;
  testId: string;
}) {
  return (
    <Empty className="border border-dashed" data-testid={testId}>
      <EmptyHeader>
        <EmptyMedia variant="icon">{ikon}</EmptyMedia>
        <EmptyTitle>{judul}</EmptyTitle>
        <EmptyDescription>{deskripsi}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function Memuat() {
  return (
    <div className="flex flex-col gap-6" data-testid="loading-draft" aria-busy>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}