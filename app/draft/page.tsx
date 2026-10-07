"use client";

// H5 Draft Pending interaktif (PRD v3b §10.3 F3 / §10.4 B6; ui-spec 3.H5).
// Tiga seksi: opname & sync (per draft) + picking list (per BATCH).
// Owner/admin dapat mengonfirmasi atau membatalkan langsung dari sini; Telegram tetap jalur cadangan.
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, RefreshCw, Send, TriangleAlert } from "lucide-react";
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
import { formatTanggal } from "@/lib/dashboard/format";
import { useData, useRole } from "@/lib/dashboard/sumber-data";
import type {
  KonfirmasiDraftRequest,
  OpnameDraftDoc,
  PickingBatchDoc,
  SyncStokDraftDoc,
} from "@/lib/dashboard/types";

/** Tujuan tombol "Tinjau di Telegram" (PRD N8/BR8). */
const TAUTAN_BOT = "https://t.me/";

/**
 * Nilai `kondisi` yang dikenal validator (lib/dashboard/validasiTulisV3a.js). Seed mock memakai
 * `"selisih"` yang TIDAK dikenal server; kirim apa adanya = 400 "Kondisi tidak dikenal.".
 * ponytail: kondisi tak dikenal -> OMIT (server memperlakukan "semua"). Ganti dengan daftar
 * kondisi server yang sebenarnya begitu seed/bot menyelaraskan nilainya.
 */
const KONDISI_DIKENAL = new Set([
  "sheets_ketinggalan",
  "sheets_manual",
  "konflik",
  "produk_baru",
  "semua",
]);

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
  const role = useRole();
  const [opname, setOpname] = useState<OpnameDraftDoc[] | null>(null);
  const [sync, setSync] = useState<SyncStokDraftDoc[] | null>(null);
  const [picking, setPicking] = useState<PickingBatchDoc[] | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const muat = useCallback(async () => {
    setError(false);
    setOpname(null);
    setSync(null);
    setPicking(null);
    try {
      const [o, s, p, sesi] = await Promise.all([
        data.listOpnameDrafts(),
        data.listSyncDrafts(),
        data.listPickingDrafts(),
        data.getSession(),
      ]);
      setOpname(o);
      setSync(s);
      setPicking(p);
      setUid(sesi.user.id);
    } catch {
      setError(true);
    }
  }, [data]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const bolehAksi = role === "owner" || role === "admin";
  // B-1: "Konfirmasi Semua" mengirim `kondisi:"semua"` yang menyapu SEMUA kelompok milik pemilik
  // draft acuan. Untuk admin, acuan WAJIB draft miliknya sendiri (server menolak 403 kalau bukan),
  // dan draft orphan TIDAK boleh jadi acuan (fail-closed §7.2).
  const syncBolehAksi = (sync ?? []).filter((d) => gerbangAksi(role, uid, d.owner_user_id) === "aksi");

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
        ) : opname === null || sync === null || picking === null ? (
          <Memuat />
        ) : (
          <>
            <Seksi
              id="draft-opname"
              judul="Opname"
              deskripsi="Hasil opname yang menunggu konfirmasi."
              jumlah={opname.length}
            >
              {opname.length === 0 ? (
                <Kosong
                  ikon={<ClipboardList aria-hidden />}
                  judul="Tidak ada draft opname menunggu konfirmasi."
                  deskripsi="Draft opname akan tampil di sini setelah bot mengirim hasilnya."
                  testId="empty-opname"
                />
              ) : (
                <ul className="flex flex-col gap-3" data-testid="daftar-opname">
                  {opname.map((d) => (
                    <li key={d.id}>
                      <DraftOpname draft={d} uid={uid} onSukses={muat} />
                    </li>
                  ))}
                </ul>
              )}
            </Seksi>

            <Seksi
              id="draft-sync"
              judul="Sync Stok"
              deskripsi="Selisih sinkronisasi Google Sheets yang menunggu konfirmasi."
              jumlah={sync.length}
              aksi={
                bolehAksi && syncBolehAksi.length >= 2 ? (
                  <KonfirmasiSemuaSync draftId={syncBolehAksi[0].id} onSukses={muat} />
                ) : null
              }
            >
              {sync.length === 0 ? (
                <Kosong
                  ikon={<RefreshCw aria-hidden />}
                  judul="Tidak ada draft sync menunggu konfirmasi."
                  deskripsi="Draft sync akan tampil di sini setelah bot menemukan selisih."
                  testId="empty-sync"
                />
              ) : (
                <ul className="flex flex-col gap-3" data-testid="daftar-sync">
                  {sync.map((d) => (
                    <li key={d.id}>
                      <DraftSync draft={d} uid={uid} onSukses={muat} />
                    </li>
                  ))}
                </ul>
              )}
            </Seksi>

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

/** Tombol/badge milik satu kartu: konfirmasi (primary), batalkan (outline), semua h-11 md:h-8. */
interface KeputusanAksi {
  gerbang: Gerbang;
  onSukses: () => void;
  uid: string | null;
}


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

// ---------------- Kartu opname ----------------

function DraftOpname({
  draft,
  uid,
  onSukses,
}: {
  draft: OpnameDraftDoc;
  uid: string | null;
  onSukses: () => void;
}) {
  const gerbang = gerbangAksi(useRole(), uid, draft.owner_user_id);
  const selisihBesar = draft.items.filter(
    (i) => i.kategori === "selisih_besar" || i.kategori === "tidak_ketemu"
  ).length;
  const selisih = draft.items.filter((i) => {
    if (i.qty_sistem == null || i.qty_fisik == null) return true;
    return i.qty_sistem !== i.qty_fisik;
  }).length;

  return (
    <Card size="sm" data-testid={`kartu-opname-${draft.id}`}>
      <CardHeader>
        <CardTitle className="tabular-nums">
          {draft.items.length} item
          {selisih > 0 ? ` · ${selisih} selisih besar` : ""}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Dibuat {formatTanggal(draft.created_at)}
        </p>
        <BadgePemilik id={draft.id} gerbang={gerbang} owner={draft.owner_user_id} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1.5">
          {draft.items.map((it, i) => (
            <li key={`${it.kode_barang ?? i}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate font-medium">{it.nama ?? it.kode_barang ?? "—"}</span>
              {it.kode_barang ? (
                <span className="text-xs text-muted-foreground">{it.kode_barang}</span>
              ) : null}
              {it.kategori ? <Badge variant="outline">{it.kategori}</Badge> : null}
            </li>
          ))}
        </ul>
      </CardContent>
      {gerbang === "aksi" ? (
        <CardFooter className="flex-wrap justify-end gap-2">
          <AksiDraft
            jenis="opname"
            id={draft.id}
            onSukses={onSukses}
            ringkasan={
              <>
                <span>Konfirmasi opname?</span>
                <span>
                  {draft.items.length} item akan diproses
                  {selisihBesar > 0
                    ? `; ${selisihBesar} item selisih besar/hilang tetap perlu klarifikasi.`
                    : "."}
                </span>
              </>
            }
          />
          <TombolTelegram />
        </CardFooter>
      ) : null}
    </Card>
  );
}

// ---------------- Kartu sync ----------------

function DraftSync({
  draft,
  uid,
  onSukses,
}: {
  draft: SyncStokDraftDoc;
  uid: string | null;
  onSukses: () => void;
}) {
  const gerbang = gerbangAksi(useRole(), uid, draft.owner_user_id);

  return (
    <Card size="sm" data-testid={`kartu-sync-${draft.id}`}>
      <CardHeader>
        <CardTitle className="tabular-nums">
          {draft.items.length} item · {draft.kondisi}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Dibuat {formatTanggal(draft.created_at)}
          {draft.index_kolom != null ? ` · Kolom ${draft.index_kolom}` : ""}
        </p>
        <BadgePemilik id={draft.id} gerbang={gerbang} owner={draft.owner_user_id} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1.5">
          {draft.items.map((it, i) => (
            <li key={`${it.kode_barang ?? i}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate font-medium">{it.nama ?? it.kode_barang ?? "—"}</span>
              {it.kode_barang ? (
                <span className="text-xs text-muted-foreground">{it.kode_barang}</span>
              ) : null}
              {it.nilai_firestore != null || it.nilai_sheets != null ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Firestore {it.nilai_firestore ?? "—"} · Sheets {it.nilai_sheets ?? "—"}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
      {gerbang === "aksi" ? (
        <CardFooter className="flex-wrap justify-end gap-2">
          <AksiDraft
            jenis="sync"
            id={draft.id}
            kondisi={draft.kondisi}
            onSukses={onSukses}
            ringkasan={
              <>
                <span>Konfirmasi sync {draft.kondisi}?</span>
                <span>{draft.items.length} item pada kelompok ini akan disamakan.</span>
              </>
            }
          />
          <TombolTelegram />
        </CardFooter>
      ) : null}
    </Card>
  );
}

// ---------------- Konfirmasi Semua (sync) ----------------

function KonfirmasiSemuaSync({
  draftId,
  onSukses,
}: {
  /** Id draft sync pertama yang ada; server memperlakukan `kondisi:"semua"` lintas kelompok. */
  draftId: string;
  onSukses: () => void;
}) {
  const data = useData();
  const [open, setOpen] = useState(false);
  const [mengirim, setMengirim] = useState(false);

  async function kirim() {
    setMengirim(true);
    try {
      const res = await data.konfirmasiDraft({
        jenis: "sync",
        draft_id: draftId,
        aksi_draft: "apply",
        kondisi: "semua",
      });
      if (res.ok) {
        if (res.sisa != null && res.sisa > 0) {
          toast.success("Sebagian diproses. Masih ada kelompok lain yang menunggu.");
        } else {
          toast.success("Draft diproses.");
        }
        setOpen(false);
        onSukses();
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error);
        if (!kedaluwarsa) {
          setOpen(false);
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
        variant="secondary"
        size="sm"
        className="h-11 md:h-8"
        data-testid="konfirmasi-sync-semua"
        onClick={() => setOpen(true)}
      >
        Konfirmasi Semua
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!mengirim) setOpen(v);
        }}
      >
        <AlertDialogContent data-testid="dialog-konfirmasi-sync">
          <AlertDialogHeader>
            <AlertDialogTitle>Konfirmasi semua sync?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua kelompok draft sync pending akan disamakan dengan Sheets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="batal-konfirmasi-sync"
              onClick={() => setOpen(false)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="konfirmasi-sync-semua-ok"
              onClick={() => void kirim()}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Memproses..." : "Ya, konfirmasi semua"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
            jenis="picking"
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

// ---------------- Dialog konfirmasi/batal generik ----------------

function AksiDraft({
  jenis,
  id,
  kondisi,
  ringkasan,
  onSukses,
}: {
  jenis: "opname" | "sync" | "picking";
  id: string;
  kondisi?: string;
  ringkasan: React.ReactNode;
  onSukses: () => void;
}) {
  const data = useData();
  const [dialog, setDialog] = useState<"apply" | "batal" | null>(null);
  const [mengirim, setMengirim] = useState(false);

  const khususPicking = jenis === "picking";

  async function kirim(aksi: "apply" | "batal") {
    setMengirim(true);
    try {
      const req: KonfirmasiDraftRequest = khususPicking
        ? { jenis, batch_id: id, aksi_draft: aksi }
        : jenis === "sync"
          ? KONDISI_DIKENAL.has(kondisi ?? "")
            ? { jenis, draft_id: id, aksi_draft: aksi, kondisi }
            : { jenis, draft_id: id, aksi_draft: aksi }
          : { jenis, draft_id: id, aksi_draft: aksi };
      const res = await data.konfirmasiDraft(req);
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
        data-testid={`konfirmasi-${jenis === "picking" ? "picking-batch" : jenis}-${id}`}
        onClick={() => setDialog("apply")}
      >
        Konfirmasi
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-11 md:h-8"
        data-testid={`batalkan-${jenis === "picking" ? "picking-batch" : jenis}-${id}`}
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
          data-testid={
            dialog === "batal"
              ? `dialog-batalkan-${jenis}`
              : jenis === "picking"
                ? "dialog-konfirmasi-picking"
                : `dialog-konfirmasi-${jenis}`
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === "batal"
                ? `Batalkan ${jenis}?`
                : `Konfirmasi ${jenis === "picking" ? "picking" : jenis}?`}
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
              data-testid={
                dialog === "batal"
                  ? `batal-batalkan-${jenis}`
                  : khususPicking
                    ? "batal-konfirmasi-picking"
                    : jenis === "sync"
                      ? "batal-konfirmasi-sync"
                      : `batal-konfirmasi-${jenis}`
              }
              onClick={() => setDialog(null)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={
                dialog === "batal"
                  ? `batalkan-${jenis}-ok-${id}`
                  : khususPicking
                    ? `konfirmasi-picking-ok-${id}`
                    : `konfirmasi-${jenis}-ok-${id}`
              }
              onClick={() => void kirim(dialog ?? "apply")}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim
                ? "Memproses..."
                : dialog === "batal"
                  ? "Ya, batalkan"
                  : "Ya, konfirmasi"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TombolTelegram() {
  return (
    <Button
      variant="outline"
      size="lg"
      className="h-11 md:h-8"
      nativeButton={false}
      render={
        <a
          href={TAUTAN_BOT}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="tinjau-telegram"
        />
      }
    >
      <Send data-icon="inline-start" />
      Tinjau di Telegram
    </Button>
  );
}

function Seksi({
  id,
  judul,
  deskripsi,
  jumlah,
  aksi,
  children,
}: {
  id: string;
  judul: string;
  deskripsi: string;
  jumlah: number;
  aksi?: React.ReactNode;
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
        {aksi}
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