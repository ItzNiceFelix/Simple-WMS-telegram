"use client";

// H8 Pengaturan (PRD 15, FR-WRITE-09, 20; ui-spec 3.H8).
// Ubah provider AI HANYA owner (PRD 11.4/BR7). Admin melihat nilai tanpa kontrol ubah.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { KelolaAdmin } from "@/components/dashboard/kelola-admin";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BiayaMp } from "@/components/dashboard/biaya-mp";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
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
import { formatTanggal } from "@/lib/dashboard/format";
import { useData, useRole } from "@/lib/dashboard/sumber-data";
import type { AiSettingsDoc } from "@/lib/dashboard/types";
import { PROVIDER_AI, LABEL_PROVIDER, adalahProviderAi } from "@/lib/dashboard/providerAi";
import type { ProviderAi } from "@/lib/dashboard/providerAi";

export default function HalamanPengaturan() {
  return (
    <ButuhAkses href="/pengaturan">
      <Pengaturan />
    </ButuhAkses>
  );
}

function Pengaturan() {
  const data = useData();
  const role = useRole();
  const bolehUbah = role === "owner";
  const adalahStaff = role === "owner" || role === "admin";

  const [pengaturan, setPengaturan] = useState<AiSettingsDoc | null>(null);
  const [superAdmin, setSuperAdmin] = useState<boolean | null>(null);
  const [pilihan, setPilihan] = useState<ProviderAi>("gemini");
  const [error, setError] = useState(false);
  const [mengirim, setMengirim] = useState(false);

  const muat = useCallback(async () => {
    setError(false);
    setPengaturan(null);
    try {
      const p = await data.getAiSettings();
      setPengaturan(p);
      setPilihan(p.textProvider);
    } catch {
      setError(true);
    }
  }, [data]);

  // F5: status super admin DIRI SENDIRI (Q3). Tidak ada route baca baru.
  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const s = await data.getSession();
        if (!batal) setSuperAdmin(s.superAdmin);
      } catch {
        if (!batal) setSuperAdmin(null);
      }
    })();
    return () => {
      batal = true;
    };
  }, [data]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const berubah = pengaturan !== null && pilihan !== pengaturan.textProvider;

  async function simpan() {
    if (!bolehUbah || mengirim) return;
    setMengirim(true);
    try {
      const res = await data.ubahProviderAi(pilihan);
      if (res.ok) {
        toast.success("Pengaturan disimpan");
        await muat();
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Gagal menyimpan pengaturan.");
    } finally {
      setMengirim(false);
    }
  }

  return (
    <>
      <PageHeader judul="Pengaturan" deskripsi="Konfigurasi provider AI." />

      <div className="flex flex-col gap-4" data-testid="h8-pengaturan">
        {error ? (
          <Alert variant="destructive" data-testid="error-pengaturan">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat pengaturan.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              Periksa koneksi lalu coba lagi.
              <Button variant="outline" size="sm" onClick={() => void muat()}>
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : pengaturan === null ? (
          <Skeleton className="h-48 w-full rounded-xl" data-testid="loading-pengaturan" />
        ) : (
          <Card data-testid="kartu-provider">
            <CardHeader>
              <CardTitle>Provider AI Aktif</CardTitle>
              <CardDescription>
                Provider teks yang dipakai bot untuk membalas perintah.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Provider saat ini</p>
                <p
                  className="font-heading text-lg font-semibold"
                  data-testid="provider-aktif"
                >
                  {LABEL_PROVIDER[pengaturan.textProvider]}
                </p>
                {pengaturan.updatedAt ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Diperbarui {formatTanggal(pengaturan.updatedAt)}
                    {pengaturan.updatedBy ? ` oleh ${pengaturan.updatedBy}` : ""}
                  </p>
                ) : null}
              </div>

              <Field data-disabled={!bolehUbah || mengirim ? true : undefined}>
                <FieldLabel htmlFor="provider-ai">Provider</FieldLabel>
                <Select
                  value={pilihan}
                  onValueChange={(v) => {
                    if (v !== null && adalahProviderAi(v)) setPilihan(v);
                  }}
                  disabled={!bolehUbah || mengirim}
                >
                  <SelectTrigger
                    id="provider-ai"
                    className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                    data-testid="pilih-provider"
                  >
                    <SelectValue>
                      {(v: string | null) => (v ? (LABEL_PROVIDER[v as keyof typeof LABEL_PROVIDER] ?? v) : "Pilih provider")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {PROVIDER_AI.map((p) => (
                        <SelectItem key={p} value={p}>
                          {LABEL_PROVIDER[p]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {bolehUbah
                    ? "Kunci API tiap provider diset lewat variabel lingkungan."
                    : "Hanya owner yang dapat mengubah pengaturan."}
                </FieldDescription>
              </Field>

              <div>
                <Button
                  size="lg"
                  className="h-11 md:h-8"
                  disabled={!bolehUbah || mengirim || !berubah}
                  onClick={() => void simpan()}
                  data-testid="simpan-provider"
                >
                  {mengirim ? <Spinner data-icon="inline-start" /> : null}
                  {mengirim ? "Menyimpan…" : "Simpan"}
                </Button>
              </div>

              {!bolehUbah ? (
                <Alert data-testid="catatan-owner">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>Hanya owner yang dapat mengubah pengaturan.</AlertTitle>
                  <AlertDescription>
                    Hubungi owner bila provider perlu diganti.
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        )}

        {adalahStaff ? (
          <Card data-testid="kartu-super-admin">
            <CardHeader>
              <CardTitle>Status Super Admin</CardTitle>
              <CardDescription>Status untuk akun Anda saat ini.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Super admin</p>
                <p className="font-heading text-lg font-semibold" data-testid="status-super-admin">
                  {superAdmin === null ? "—" : superAdmin ? "Ya" : "Tidak"}
                </p>
              </div>
              <p className="text-xs text-muted-foreground" data-testid="catatan-super-admin">
                Status super admin berasal dari variabel lingkungan (SUPER_ADMIN_ID) dan role
                owner. Tidak dapat diubah dari dashboard. Untuk mengubah daftar berwenang, ubah
                role admin (Owner/Admin/Guest).
              </p>
            </CardContent>
          </Card>
        ) : null}

        {adalahStaff ? <BiayaMp bolehUbah={bolehUbah} /> : null}
        {bolehUbah ? <KelolaAdmin /> : null}
      </div>
    </>
  );
}
