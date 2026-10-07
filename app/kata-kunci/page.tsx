"use client";

// H9 Kata Kunci — kamus penanda picking list (PRD v3a 6.2/6.3, 7.1).
// Owner: Select + tombol Konfirmasi per baris. Admin: read-only (tabel + filter saja).
import { useCallback, useEffect, useState } from "react";
import { Tags, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatAngka, formatTanggal } from "@/lib/dashboard/format";
import { useData, useRole } from "@/lib/dashboard/sumber-data";
import type { InterpretasiKeyword, KeywordNoteDoc } from "@/lib/dashboard/types";

type Filter = "semua" | "belum";

/** Label + konsekuensi operasional (PRD v3a 6.2, rujuk petakanInterpretasiKeActionType). */
const PILIHAN: { nilai: InterpretasiKeyword; label: string; bantuan: string }[] = [
  { nilai: "STOK", label: "Potong Stok Gudang Online", bantuan: "action_type: kurangi_stok" },
  { nilai: "MINTA", label: "Masukkan ke Permintaan Gudang Cabang", bantuan: "action_type: perlu_request" },
  { nilai: "MINTA_SISA", label: "Permintaan Sisa (Buffer)", bantuan: "action_type: perlu_request_buffer" },
];

const LABEL: Record<InterpretasiKeyword, string> = {
  STOK: "Potong Stok Gudang Online",
  MINTA: "Masukkan ke Permintaan Gudang Cabang",
  MINTA_SISA: "Permintaan Sisa (Buffer)",
};

export default function HalamanKataKunci() {
  return (
    <ButuhAkses href="/kata-kunci">
      <KataKunci />
    </ButuhAkses>
  );
}

function KataKunci() {
  const data = useData();
  const role = useRole();
  const bolehUbah = role === "owner";

  const [notes, setNotes] = useState<KeywordNoteDoc[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("semua");
  const [pilihan, setPilihan] = useState<Record<string, InterpretasiKeyword>>({});
  const [mengirim, setMengirim] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setError(false);
    setNotes(null);
    try {
      const n = await data.listKeywordNotes();
      setNotes(n);
      setPilihan({});
    } catch {
      setError(true);
    }
  }, [data]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const hasil = (notes ?? []).filter((n) => filter === "semua" || n.confidence !== "confirmed");

  function nilaiPilihan(note: KeywordNoteDoc): InterpretasiKeyword | "" {
    return pilihan[note.id] ?? note.interpreted_as ?? "";
  }

  async function konfirmasi(note: KeywordNoteDoc) {
    const dipilih = nilaiPilihan(note);
    if (!dipilih) {
      toast.error("Pilih interpretasi dulu.");
      return;
    }
    setMengirim(note.id);
    try {
      const res = await data.konfirmasiKeywordNote({ id: note.id, interpreted_as: dipilih });
      if (res.ok) {
        toast.success("Interpretasi penanda diperbarui");
        await muat();
      } else {
        // 400/404: Select kembali ke nilai lama. 401: pilihan DIPERTAHANKAN.
        const kedaluwarsa = tampilkanGagalTulis(res.error);
        if (!kedaluwarsa) {
          setPilihan((p) => {
            const next = { ...p };
            delete next[note.id];
            return next;
          });
        }
      }
    } catch {
      toast.error("Gagal menyimpan. Coba lagi.");
      setPilihan((p) => {
        const next = { ...p };
        delete next[note.id];
        return next;
      });
    } finally {
      setMengirim(null);
    }
  }

  return (
    <>
      <PageHeader
        judul="Kata Kunci"
        deskripsi="Kamus penanda picking list dan interpretasinya."
      />

      <div className="flex flex-col gap-4" data-testid="h9-kata-kunci">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            Penanda mentah dari picking list dipetakan ke aksi stok. Konfirmasi interpretasi agar bot
            tidak menebak lagi.
          </p>
          <ToggleGroup
            variant="outline"
            value={[filter]}
            onValueChange={(v) => v[0] && setFilter(v[0] as Filter)}
            aria-label="Filter penanda"
            data-testid="filter-kata-kunci"
          >
            <ToggleGroupItem value="semua" className="h-11 md:h-8">
              Semua
            </ToggleGroupItem>
            <ToggleGroupItem value="belum" className="h-11 md:h-8">
              Belum Dikonfirmasi
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {error ? (
          <Alert variant="destructive" data-testid="error-kata-kunci">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat daftar penanda.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              Periksa koneksi lalu coba lagi.
              <Button variant="outline" size="sm" onClick={() => void muat()}>
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : notes === null ? (
          <Memuat />
        ) : hasil.length === 0 ? (
          <Empty className="border border-dashed" data-testid="empty-kata-kunci">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Tags aria-hidden />
              </EmptyMedia>
              <EmptyTitle>
                {filter === "belum"
                  ? "Semua penanda sudah dikonfirmasi."
                  : "Belum ada penanda tercatat."}
              </EmptyTitle>
              <EmptyDescription>
                {filter === "belum"
                  ? "Tidak ada penanda yang menunggu konfirmasi."
                  : "Penanda akan tampil di sini setelah bot menemukannya di picking list."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div data-testid="tabel-kata-kunci">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Penanda</TableHead>
                  <TableHead>Interpretasi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Dipakai</TableHead>
                  <TableHead className="hidden md:table-cell">Terakhir dipakai</TableHead>
                  {bolehUbah ? <TableHead className="text-right">Aksi</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {hasil.map((note) => {
                  const terkonfirmasi = note.confidence === "confirmed";
                  const dipilih = nilaiPilihan(note);
                  const sedang = mengirim === note.id;
                  return (
                    <TableRow key={note.id} data-testid={`baris-kata-kunci-${note.id}`}>
                      <TableCell className="font-medium">
                        <span className="block max-w-40 truncate md:max-w-none" title={note.raw_text}>
                          {note.raw_text}
                        </span>
                      </TableCell>
                      <TableCell>
                        {bolehUbah ? (
                          <Select
                            value={dipilih === "" ? undefined : dipilih}
                            onValueChange={(v) =>
                              v && setPilihan((p) => ({ ...p, [note.id]: v as InterpretasiKeyword }))
                            }
                            disabled={sedang}
                          >
                            <SelectTrigger
                              className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                              aria-label={`Interpretasi ${note.raw_text}`}
                              data-testid={`pilih-interpretasi-${note.id}`}
                            >
                              {/* Base UI render nilai MENTAH ("MINTA_SISA") bila tanpa children;
                                  render label operasional supaya admin melihat konsekuensinya. */}
                              <SelectValue>
                                {(v: InterpretasiKeyword | null) =>
                                  v ? LABEL[v] : "Pilih interpretasi"
                                }
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {PILIHAN.map((p) => (
                                  <SelectItem key={p.nilai} value={p.nilai}>
                                    {p.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm text-foreground">
                            {note.interpreted_as ? LABEL[note.interpreted_as] : "Belum ditentukan"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={terkonfirmasi ? "secondary" : "outline"}
                          data-testid={`badge-confidence-${note.id}`}
                        >
                          {terkonfirmasi ? "Terkonfirmasi" : "Belum dikonfirmasi"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {formatAngka(note.usage_count)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {formatTanggal(note.last_used)}
                      </TableCell>
                      {bolehUbah ? (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            className="h-11 md:h-8"
                            disabled={sedang || dipilih === ""}
                            data-testid={`konfirmasi-${note.id}`}
                            onClick={() => void konfirmasi(note)}
                          >
                            {sedang ? <Spinner data-icon="inline-start" /> : null}
                            {sedang ? "Menyimpan..." : "Konfirmasi"}
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Konsekuensi interpretasi</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
            {PILIHAN.map((p) => (
              <li key={p.nilai}>
                <span className="text-foreground">{p.label}</span> — {p.bantuan}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function Memuat() {
  return (
    <div className="flex flex-col gap-2" data-testid="loading-kata-kunci" aria-busy>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}
