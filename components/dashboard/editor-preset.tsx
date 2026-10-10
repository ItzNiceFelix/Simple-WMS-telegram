"use client";

// components/dashboard/editor-preset.tsx — Detail preset: toggle status, tabel aturan, matriks program (U-R1).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { InputIklan } from "@/components/dashboard/input-iklan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type Aturan = {
  id: number; jenis: string; kode_program: string | null; kategori: string;
  status_toko: string | null; ukuran: string | null; basis: string; unit: string;
  nilai: number; plafon: number | null; plafon_per_qty: number | null;
  valid_from: string; valid_to: string | null; aktif: number;
  syarat_json: string | null; sumber: string | null; verifikasi: string;
};

type Program = {
  kode_program: string; nama: string; aktif: number;
  aktif_sejak: string | null; aktif_sampai: string | null;
};

const VERIFIKASI: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  resmi: { label: "Resmi", variant: "default" },
  resmi_cuplikan: { label: "Cuplikan resmi", variant: "secondary" },
  sekunder: { label: "Sekunder", variant: "outline" },
  belum: { label: "Belum", variant: "destructive" },
};

const JENIS_OPSI = ["admin", "komisi", "program", "proses", "layanan", "pajak_pph", "pajak_ppn", "voucher", "iklan", "ongkir", "lain"];

export function EditorPreset({ presetId, bolehUbah, onBerubah }: {
  presetId: number; bolehUbah: boolean; onBerubah: () => void;
}) {
  const [aturan, setAturan] = useState<Aturan[] | null>(null);
  const [program, setProgram] = useState<Program[] | null>(null);
  const [filterJenis, setFilterJenis] = useState("semua");
  const [filterVerif, setFilterVerif] = useState("semua");
  const [mengirim, setMengirim] = useState(false);
  // Form tambah aturan
  const [jenis, setJenis] = useState("admin");
  const [kategori, setKategori] = useState("*");
  const [basis, setBasis] = useState("persen");
  const [nilai, setNilai] = useState("");
  const [mulai, setMulai] = useState("2026-01-01");

  const muat = useCallback(async () => {
    setAturan(null);
    try {
      const res = await fetch(`/api/preset/${presetId}/aturan`, { credentials: "include" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean; error?: string; aturan?: Aturan[]; program?: Program[];
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      setAturan(data.aturan ?? []);
      setProgram(data.program ?? []);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat aturan.");
    }
  }, [presetId]);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function tambah() {
    const n = Number(nilai.trim().replace(",", "."));
    if (nilai.trim() === "" || !Number.isFinite(n) || n < 0) {
      toast.error("Nilai harus angka ≥ 0.");
      return;
    }
    setMengirim(true);
    try {
      const res = await fetch(`/api/preset/${presetId}/aturan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ jenis, kategori: kategori.trim() || "*", basis, nilai: n, valid_from: mulai || "2026-01-01" }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      toast.success("Aturan ditambah.");
      setNilai("");
      await muat();
      onBerubah();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menambah.");
    } finally {
      setMengirim(false);
    }
  }

  async function hapus(id: number) {
    setMengirim(true);
    try {
      const res = await fetch(`/api/preset/${presetId}/aturan?rule_id=${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; lunak?: boolean } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      toast.success(data.lunak ? "Aturan dinonaktifkan (ada snapshot)." : "Aturan dihapus.");
      await muat();
      onBerubah();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghapus.");
    } finally {
      setMengirim(false);
    }
  }

  async function toggleProgram(kode: string, aktif: boolean) {
    setMengirim(true);
    try {
      const res = await fetch(`/api/preset/${presetId}/program`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi: "toggle", kode_program: kode }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      toast.success(`Program ${aktif ? "dinonaktifkan" : "diaktifkan"}.`);
      await muat();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal toggle.");
    } finally {
      setMengirim(false);
    }
  }

  async function tandaiTerverifikasi(id: number) {
    const sumber = window.prompt("Sumber resmi (URL) untuk verifikasi:");
    if (!sumber) return;
    setMengirim(true);
    try {
      const res = await fetch(`/api/preset/${presetId}/aturan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rule_id: id, verifikasi: "resmi", sumber }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      toast.success("Ditandai terverifikasi.");
      await muat();
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal verifikasi.");
    } finally {
      setMengirim(false);
    }
  }

  const tampil = (aturan ?? []).filter((r) =>
    (filterJenis === "semua" || r.jenis === filterJenis) &&
    (filterVerif === "semua" || r.verifikasi === filterVerif)
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-3" data-testid={`editor-preset-${presetId}`}>
      <h3 className="text-sm font-semibold">Program</h3>
      {program === null ? (
        <Skeleton className="h-10 w-full" />
      ) : program.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada program di katalog.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {program.map((p) => (
            <div key={p.kode_program} className="flex items-center gap-3 rounded-lg border border-border p-2">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={p.aktif === 1}
                disabled={!bolehUbah || mengirim}
                onChange={() => void toggleProgram(p.kode_program, p.aktif === 1)}
                data-testid={`toggle-program-${p.kode_program}`}
                aria-label={p.nama}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.nama}</p>
                <p className="text-xs text-muted-foreground">{p.kode_program}</p>
              </div>
              <Badge variant={p.aktif === 1 ? "default" : "outline"}>
                {p.aktif === 1 ? "Aktif" : "Nonaktif"}
              </Badge>
            </div>
          ))}
        </div>
      )}

      <h3 className="text-sm font-semibold">Aturan biaya</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor={`filter-jenis-${presetId}`}>Jenis</label>
          <Select value={filterJenis} onValueChange={(v) => typeof v === "string" && setFilterJenis(v)}>
            <SelectTrigger id={`filter-jenis-${presetId}`} className="h-8 w-36" data-testid="filter-jenis-aturan">
              <SelectValue>{filterJenis}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {["semua", ...JENIS_OPSI].map((j) => (
                  <SelectItem key={j} value={j}>{j}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor={`filter-verif-${presetId}`}>Verifikasi</label>
          <Select value={filterVerif} onValueChange={(v) => typeof v === "string" && setFilterVerif(v)}>
            <SelectTrigger id={`filter-verif-${presetId}`} className="h-8 w-40" data-testid="filter-verifikasi-aturan">
              <SelectValue>{filterVerif}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {["semua", "resmi", "resmi_cuplikan", "sekunder", "belum"].map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {aturan === null ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Jenis</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Basis</TableHead>
                <TableHead className="text-right">Nilai</TableHead>
                <TableHead>Berlaku</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tampil.map((r) => {
                const v = VERIFIKASI[r.verifikasi] ?? VERIFIKASI.belum;
                return (
                  <TableRow key={r.id} data-testid={`aturan-${r.id}`}>
                    <TableCell className="font-medium">
                      {r.jenis}
                      {r.syarat_json ? (
                        <span title={r.syarat_json}>
                          {" "}
                          <Badge variant="outline">syarat</Badge>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-48 truncate" title={r.kategori}>{r.kategori}</TableCell>
                    <TableCell>{r.basis}/{r.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.basis === "persen" ? `${r.nilai}%` : r.nilai}
                      {r.plafon_per_qty ? ` (maks ${r.plafon_per_qty}/qty)` : ""}
                    </TableCell>
                    <TableCell className="tabular-nums">{r.valid_from}{r.valid_to ? `–${r.valid_to}` : ""}</TableCell>
                    <TableCell>
                      <Badge variant={v.variant} data-testid={`verif-${r.id}`}>{v.label}</Badge>
                      {r.aktif === 0 ? <Badge variant="outline">nonaktif</Badge> : null}
                    </TableCell>
                    <TableCell>
                      {bolehUbah ? (
                        <div className="flex gap-1.5">
                          {r.verifikasi !== "resmi" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              disabled={mengirim}
                              onClick={() => void tandaiTerverifikasi(r.id)}
                            >
                              Verifikasi
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            disabled={mengirim}
                            onClick={() => void hapus(r.id)}
                            data-testid={`hapus-aturan-${r.id}`}
                          >
                            <Trash2 data-icon="inline-start" />
                            Hapus
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {bolehUbah ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor={`tambah-jenis-${presetId}`}>Jenis</label>
            <Select value={jenis} onValueChange={(v) => typeof v === "string" && setJenis(v)}>
              <SelectTrigger id={`tambah-jenis-${presetId}`} className="h-8 w-36">
                <SelectValue>{jenis}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {JENIS_OPSI.map((j) => (
                    <SelectItem key={j} value={j}>{j}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor={`tambah-kategori-${presetId}`}>Kategori</label>
            <Input
              id={`tambah-kategori-${presetId}`}
              className="h-8 w-40"
              value={kategori}
              onChange={(e) => setKategori(e.target.value)}
              placeholder="* / tier / grup"
              disabled={mengirim}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor={`tambah-basis-${presetId}`}>Basis</label>
            <Select value={basis} onValueChange={(v) => typeof v === "string" && setBasis(v)}>
              <SelectTrigger id={`tambah-basis-${presetId}`} className="h-8 w-28">
                <SelectValue>{basis}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="persen">persen</SelectItem>
                  <SelectItem value="flat">flat</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor={`tambah-nilai-${presetId}`}>Nilai</label>
            <Input
              id={`tambah-nilai-${presetId}`}
              className="h-8 w-28"
              value={nilai}
              onChange={(e) => setNilai(e.target.value)}
              placeholder="cth. 10"
              disabled={mengirim}
              data-testid="nilai-aturan"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor={`tambah-mulai-${presetId}`}>Berlaku mulai</label>
            <Input
              id={`tambah-mulai-${presetId}`}
              type="date"
              className="h-8"
              value={mulai}
              onChange={(e) => setMulai(e.target.value)}
              disabled={mengirim}
            />
          </div>
          <Button className="h-8" data-testid="tambah-aturan" onClick={() => void tambah()} disabled={mengirim}>
            {mengirim ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            Tambah
          </Button>
        </div>
      ) : null}
      <InputIklan presetId={presetId} bolehUbah={bolehUbah} />
    </div>
  );
}
