"use client";

// H4 Histori (PRD 15, 20, 35.4; ui-spec 3.H4).
// Timeline stock_movements kronologis (terbaru dulu), delta apa adanya.
// Bounded query: hanya SATU equality (kode / jenis / status / pelaku) + rentang tanggal
// yang dikirim (PRD 35.4). Pagination di klien karena listMovements mock mengembalikan
// array penuh; ambil limit besar lalu iris per halaman.
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  History,
  RotateCcw,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";

import { cn } from "cn";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatAngka, formatDelta, formatTanggal, labelStatusMovement } from "@/lib/dashboard/format";
import { useData } from "@/lib/dashboard/sumber-data";
import type { MovementFilter } from "@/lib/dashboard/data";
import type {
  MovementDoc,
  MovementSource,
  MovementStatus,
  MovementType,
} from "@/lib/dashboard/types";

/** Ukuran per halaman (ui-spec 3.H4). */
const UKURAN_HALAMAN = 20;
/** Batas pengambilan; pagination dilakukan di klien. */
const BATAS_AMBIL = 200;

const MODE_FILTER = [
  { id: "kode", label: "Kode barang" },
  { id: "jenis", label: "Jenis" },
  { id: "status", label: "Status" },
  { id: "pelaku", label: "Dibuat oleh" },
] as const;
type ModeFilter = (typeof MODE_FILTER)[number]["id"];

const LABEL_JENIS: Record<MovementType, string> = {
  keluar_resi: "Keluar resi",
  opname: "Opname",
  restock: "Stok masuk",
  koreksi_manual: "Koreksi manual",
  sync_confirmed: "Sinkron dikonfirmasi",
  jual_mp: "Jual marketplace",
  retur_mp: "Retur marketplace",
};

const LABEL_SUMBER: Record<MovementSource, string> = {
  screenshot: "Tangkapan layar",
  manual_chat: "Chat manual",
  manual_chat_batch: "Chat manual massal",
  manual_chat_batch_produk_baru: "Chat manual massal (produk baru)",
  manual_chat_produk_baru: "Chat manual (produk baru)",
  sync: "Sinkron",
  web_dashboard: "Dashboard web",
};

const DAFTAR_JENIS = Object.keys(LABEL_JENIS) as MovementType[];
const DAFTAR_STATUS: MovementStatus[] = [
  "processed",
  "pending_request",
  "pending_confirmation",
];

/** "YYYY-MM-DD" (waktu lokal) -> ISO awal/akhir hari. */
function awalHari(tanggal: string): string {
  return new Date(`${tanggal}T00:00:00.000`).toISOString();
}
function akhirHari(tanggal: string): string {
  return new Date(`${tanggal}T23:59:59.999`).toISOString();
}

export default function HalamanHistori() {
  return (
    <ButuhAkses href="/histori">
      <Histori />
    </ButuhAkses>
  );
}

function Histori() {
  const data = useData();

  const [movements, setMovements] = useState<MovementDoc[] | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [error, setError] = useState(false);

  const [mode, setMode] = useState<ModeFilter>("kode");
  const [kode, setKode] = useState("");
  const [jenis, setJenis] = useState("");
  const [status, setStatus] = useState("");
  const [pelaku, setPelaku] = useState("");
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");
  const [halaman, setHalaman] = useState(1);

  // Nilai teks ditunda supaya tidak memicu permintaan tiap ketukan tombol.
  const kodeTertunda = useDeferredValue(kode);
  const pelakuTertunda = useDeferredValue(pelaku);

  // Prefill dari query param (mis. tautan dari H3: /histori?kode=BRG-001).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("kode");
    if (q) {
      setMode("kode");
      setKode(q);
    }
  }, []);

  const muat = useCallback(async () => {
    const filter: MovementFilter = { limit: BATAS_AMBIL };
    // SATU equality saja (PRD 35.4) — cabang else-if menjaga jaminan itu.
    if (mode === "kode" && kodeTertunda.trim()) filter.kode_barang = kodeTertunda.trim();
    else if (mode === "jenis" && jenis) filter.type = jenis;
    else if (mode === "status" && status) filter.status = status;
    else if (mode === "pelaku" && pelakuTertunda.trim())
      filter.created_by = pelakuTertunda.trim();
    if (dari) filter.dari = awalHari(dari);
    if (sampai) filter.sampai = akhirHari(sampai);

    setError(false);
    setMemuat(true);
    try {
      setMovements(await data.listMovements(filter));
    } catch {
      setError(true);
      setMovements([]);
    } finally {
      setMemuat(false);
    }
  }, [data, mode, kodeTertunda, jenis, status, pelakuTertunda, dari, sampai]);

  useEffect(() => {
    setHalaman(1);
    void muat();
  }, [muat]);

  const hasil = useMemo(() => {
    if (!movements) return [];
    return movements
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [movements]);

  const total = hasil.length;
  const jumlahHalaman = Math.max(1, Math.ceil(total / UKURAN_HALAMAN));
  const halamanAman = Math.min(halaman, jumlahHalaman);
  const mulai = (halamanAman - 1) * UKURAN_HALAMAN;
  const tampil = hasil.slice(mulai, mulai + UKURAN_HALAMAN);

  const adaFilter =
    (mode === "kode" && kode.trim() !== "") ||
    (mode === "jenis" && jenis !== "") ||
    (mode === "status" && status !== "") ||
    (mode === "pelaku" && pelaku.trim() !== "") ||
    dari !== "" ||
    sampai !== "";

  function hapusFilter() {
    setKode("");
    setJenis("");
    setStatus("");
    setPelaku("");
    setDari("");
    setSampai("");
  }

  // Panel filter tertutup default di mobile (ui-spec 3.H4): timeline harus di atas lipatan.
  // Desktop selalu terbuka. Panel tetap di DOM (keepMounted) agar test & state filter utuh.
  const [filterTerbuka, setFilterTerbuka] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sinkron = () => setFilterTerbuka(mq.matches);
    sinkron();
    mq.addEventListener("change", sinkron);
    return () => mq.removeEventListener("change", sinkron);
  }, []);

  const ringkasanFilter = [
    mode === "kode" && kode.trim() ? `Kode: ${kode.trim()}` : null,
    mode === "jenis" && jenis ? `Jenis: ${LABEL_JENIS[jenis as MovementType] ?? jenis}` : null,
    mode === "status" && status
      ? `Status: ${labelStatusMovement(status as MovementStatus)}`
      : null,
    mode === "pelaku" && pelaku.trim() ? `Pelaku: ${pelaku.trim()}` : null,
    dari ? `Dari: ${dari}` : null,
    sampai ? `Sampai: ${sampai}` : null,
  ].filter((t): t is string => t !== null);

  return (
    <>
      <PageHeader judul="Histori" deskripsi="Jejak pergerakan stok." />

      <div className="flex flex-col gap-4">
        <Collapsible
          open={filterTerbuka}
          onOpenChange={setFilterTerbuka}
          className="flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-3 md:hidden">
            <Button
              variant="outline"
              size="lg"
              className="h-11 w-full justify-between"
              aria-expanded={filterTerbuka}
              onClick={() => setFilterTerbuka((v) => !v)}
              data-testid="toggle-filter-histori"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal data-icon="inline-start" />
                {filterTerbuka ? "Sembunyikan filter" : "Tampilkan filter"}
              </span>
              <ChevronRight
                data-icon="inline-end"
                className={cn("transition-transform", filterTerbuka && "rotate-90")}
              />
            </Button>
          </div>

          {!filterTerbuka && ringkasanFilter.length > 0 ? (
            <div
              className="flex flex-wrap gap-2 md:hidden"
              data-testid="ringkasan-filter-histori"
            >
              {ringkasanFilter.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}

          <CollapsibleContent keepMounted>
            <FieldSet className="rounded-xl border p-4" data-testid="panel-filter-histori">
          <FieldLegend variant="label">Filter</FieldLegend>

          <Field>
            <FieldTitle>Jenis filter</FieldTitle>
            <ToggleGroup
              variant="outline"
              value={[mode]}
              onValueChange={(v) => {
                const next = v[0] as ModeFilter | undefined;
                if (next) setMode(next);
              }}
              aria-label="Jenis filter"
              className="flex-wrap"
              data-testid="mode-filter"
            >
              {MODE_FILTER.map((m) => (
                <ToggleGroupItem
                  key={m.id}
                  value={m.id}
                  className="h-11 md:h-8"
                  data-testid={`mode-${m.id}`}
                >
                  {m.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              Satu filter kesetaraan per permintaan; rentang tanggal boleh digabung.
            </FieldDescription>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mode === "kode" ? (
              <Field>
                <FieldLabel htmlFor="filter-kode">Kode barang</FieldLabel>
                <Input
                  id="filter-kode"
                  value={kode}
                  onChange={(e) => setKode(e.target.value)}
                  placeholder="Mis. BRG-001"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-11 md:h-8"
                  data-testid="filter-kode"
                />
              </Field>
            ) : null}

            {mode === "jenis" ? (
              <Field>
                <FieldLabel htmlFor="filter-jenis">Jenis pergerakan</FieldLabel>
                <Select
                  value={jenis === "" ? "semua" : jenis}
                  onValueChange={(v) => setJenis(!v || v === "semua" ? "" : v)}
                >
                  <SelectTrigger
                    id="filter-jenis"
                    className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                    data-testid="filter-jenis"
                  >
                    <SelectValue>
                      {(v: string | null) =>
                        !v || v === "semua" ? "Semua jenis" : LABEL_JENIS[v as MovementType] ?? v
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="semua">Semua jenis</SelectItem>
                      {DAFTAR_JENIS.map((j) => (
                        <SelectItem key={j} value={j}>
                          {LABEL_JENIS[j]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}

            {mode === "status" ? (
              <Field>
                <FieldLabel htmlFor="filter-status">Status</FieldLabel>
                <Select
                  value={status === "" ? "semua" : status}
                  onValueChange={(v) => setStatus(!v || v === "semua" ? "" : v)}
                >
                  <SelectTrigger
                    id="filter-status"
                    className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                    data-testid="filter-status"
                  >
                    <SelectValue>
                      {(v: string | null) =>
                        !v || v === "semua" ? "Semua status" : labelStatusMovement(v as MovementStatus)
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="semua">Semua status</SelectItem>
                      {DAFTAR_STATUS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {labelStatusMovement(s)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}

            {mode === "pelaku" ? (
              <Field>
                <FieldLabel htmlFor="filter-pelaku">Dibuat oleh</FieldLabel>
                <Input
                  id="filter-pelaku"
                  value={pelaku}
                  onChange={(e) => setPelaku(e.target.value)}
                  placeholder="Mis. 900001"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-11 md:h-8"
                  data-testid="filter-pelaku"
                />
                <FieldDescription>ID Telegram pelaku.</FieldDescription>
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor="filter-dari">Dari tanggal</FieldLabel>
              <Input
                id="filter-dari"
                type="date"
                value={dari}
                max={sampai || undefined}
                onChange={(e) => setDari(e.target.value)}
                className="h-11 md:h-8"
                data-testid="filter-dari"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="filter-sampai">Sampai tanggal</FieldLabel>
              <Input
                id="filter-sampai"
                type="date"
                value={sampai}
                min={dari || undefined}
                onChange={(e) => setSampai(e.target.value)}
                className="h-11 md:h-8"
                data-testid="filter-sampai"
              />
            </Field>
          </div>

          <div>
            <Button
              variant="outline"
              size="lg"
              className="h-11 md:h-8"
              disabled={!adaFilter}
              onClick={hapusFilter}
              data-testid="hapus-filter"
            >
              <RotateCcw data-icon="inline-start" />
              Hapus filter
            </Button>
          </div>
        </FieldSet>
          </CollapsibleContent>
        </Collapsible>

        {error ? (
          <Alert variant="destructive" data-testid="error-histori">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat histori pergerakan.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              Periksa koneksi lalu coba lagi.
              <Button variant="outline" size="sm" onClick={() => void muat()}>
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : movements === null ? (
          <Memuat />
        ) : total === 0 ? (
          <Empty className="border border-dashed" data-testid="empty-histori">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Belum ada pergerakan pada filter ini.</EmptyTitle>
              <EmptyDescription>
                Ubah filter atau rentang tanggal untuk melihat pergerakan lain.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <section
              aria-label="Timeline pergerakan"
              aria-busy={memuat}
              className={cn("flex flex-col", memuat && "opacity-60 transition-opacity")}
              data-testid="timeline-histori"
            >
              <ul className="flex flex-col">
                {tampil.map((m, i) => (
                  <li key={m.id} data-testid={`movement-${m.id}`}>
                    {i > 0 ? <Separator /> : null}
                    <BarisPergerakan m={m} />
                  </li>
                ))}
              </ul>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground tabular-nums" data-testid="info-halaman">
                Menampilkan {mulai + 1}–{mulai + tampil.length} dari {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 md:h-8"
                  disabled={halamanAman <= 1}
                  onClick={() => setHalaman(halamanAman - 1)}
                  data-testid="halaman-sebelumnya"
                >
                  <ChevronLeft data-icon="inline-start" />
                  Sebelumnya
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 md:h-8"
                  disabled={halamanAman >= jumlahHalaman}
                  onClick={() => setHalaman(halamanAman + 1)}
                  data-testid="halaman-berikutnya"
                >
                  Berikutnya
                  <ChevronRight data-icon="inline-end" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function BarisPergerakan({ m }: { m: MovementDoc }) {
  const negatif = m.qty != null && m.qty < 0;
  return (
    <article className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {m.kode_barang ? (
              <Link
                href={`/produk/${encodeURIComponent(m.kode_barang)}`}
                className="max-w-full truncate font-medium hover:underline"
                title={m.nama_terbaca ?? m.kode_barang}
              >
                {m.nama_terbaca ?? m.kode_barang}
              </Link>
            ) : (
              <span className="max-w-full truncate font-medium" title={m.nama_terbaca ?? undefined}>
                {m.nama_terbaca ?? "—"}
              </span>
            )}
            {m.kode_barang ? (
              <span className="text-xs text-muted-foreground">{m.kode_barang}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{LABEL_JENIS[m.type] ?? m.type}</Badge>
            <Badge variant="outline">{labelStatusMovement(m.status)}</Badge>
            <span className="text-xs text-muted-foreground">
              {LABEL_SUMBER[m.source] ?? m.source}
            </span>
          </div>
        </div>

        <span
          className={cn(
            "text-base font-semibold tabular-nums",
            negatif && "text-destructive"
          )}
          data-testid={`delta-${m.id}`}
        >
          {formatDelta(m.qty)}
        </span>
      </div>

      {m.type === "opname" ? (
        <dl
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
          data-testid={`opname-${m.id}`}
        >
          <div className="flex items-center gap-1">
            <dt>Sistem</dt>
            <dd className="tabular-nums">{formatAngka(m.qty_sistem)}</dd>
          </div>
          <div className="flex items-center gap-1">
            <dt>Fisik</dt>
            <dd className="tabular-nums">{formatAngka(m.qty_fisik)}</dd>
          </div>
          <div className="flex items-center gap-1">
            <dt>Selisih</dt>
            <dd
              className={cn(
                "tabular-nums",
                m.selisih != null && m.selisih < 0 && "text-destructive"
              )}
              data-testid={`selisih-${m.id}`}
            >
              {formatDelta(m.selisih)}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <time dateTime={m.created_at}>{formatTanggal(m.created_at)}</time>
        <span className="truncate">oleh {m.created_by_name ?? m.created_by ?? "—"}</span>
        {m.catatan ? <span className="truncate">Catatan: {m.catatan}</span> : null}
      </div>
    </article>
  );
}

function Memuat() {
  return (
    <div className="flex flex-col gap-3" data-testid="loading-histori" aria-busy>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}
