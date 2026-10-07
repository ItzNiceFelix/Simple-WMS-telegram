"use client";

// H7 Admin (PRD 15, FR-READ-07, 20; ui-spec 3.H7).
// Tiga seksi: daftar admin (Table), perubahan peran (timeline), permintaan akses.
// Owner dapat menyetujui/menolak permintaan berstatus pending (A7, PRD v3b §10.1/§10.4 B6).
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, TriangleAlert, UserPlus, Users } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { AksiAkses } from "@/components/dashboard/aksi-akses";
import { AksiRoleAdmin } from "@/components/dashboard/aksi-role-admin";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTanggal, labelRole } from "@/lib/dashboard/format";
import { useData, useRole } from "@/lib/dashboard/sumber-data";
import type { AccessRequestDoc, AdminDoc, GudangDoc, RoleChangeDoc } from "@/lib/dashboard/types";

const LABEL_STATUS_AKSES: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
};

export default function HalamanAdmin() {
  return (
    <ButuhAkses href="/admin">
      <Admin />
    </ButuhAkses>
  );
}

function Admin() {
  const data = useData();
  const role = useRole();
  const bolehUbahRole = role === "owner";
  const [admins, setAdmins] = useState<AdminDoc[] | null>(null);
  const [perubahan, setPerubahan] = useState<RoleChangeDoc[] | null>(null);
  const [akses, setAkses] = useState<AccessRequestDoc[] | null>(null);
  const [gudang, setGudang] = useState<GudangDoc[] | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const muat = useCallback(async () => {
    setError(false);
    setAdmins(null);
    setPerubahan(null);
    setAkses(null);
    setGudang(null);
    try {
      const [a, r, q, sesi, g] = await Promise.all([
        data.listAdmins(),
        data.listRoleChanges(),
        data.listAccessRequests(),
        data.getSession(),
        data.listGudang(),
      ]);
      setAdmins(a);
      setPerubahan(r);
      setAkses(q);
      setUid(sesi.user.id);
      setGudang(g);
    } catch {
      setError(true);
    }
  }, [data]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const timeline = (perubahan ?? [])
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const gudangMap = new Map((gudang ?? []).map((g) => [g.gudang_id, g.nama]));

  const permintaan = (akses ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.requested_at ?? 0).getTime() - new Date(a.requested_at ?? 0).getTime()
    );

  return (
    <>
      <PageHeader
        judul="Admin"
        deskripsi="Daftar admin, riwayat perubahan peran, dan permintaan akses."
      />

      <div className="flex flex-col gap-6" data-testid="h7-admin">
        {error ? (
          <Alert variant="destructive" data-testid="error-admin">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat data admin.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              Periksa koneksi lalu coba lagi.
              <Button variant="outline" size="sm" onClick={() => void muat()}>
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : admins === null || perubahan === null || akses === null || gudang === null ? (
          <Memuat />
        ) : (
          <>
            <Seksi
              id="daftar-admin"
              judul="Daftar Admin"
              deskripsi="Akun yang punya akses ke dashboard."
            >
              {admins.length === 0 ? (
                <Kosong
                  ikon={<Users aria-hidden />}
                  judul="Belum ada admin terdaftar."
                  deskripsi="Admin akan tampil di sini setelah ditambahkan lewat bot."
                  testId="empty-admin"
                />
              ) : (
                <div data-testid="tabel-admin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama</TableHead>
                        <TableHead>Username</TableHead>
                        <TableHead>Peran</TableHead>
                        <TableHead className="hidden md:table-cell">Jabatan</TableHead>
                        <TableHead className="hidden md:table-cell">Gudang</TableHead>
                        <TableHead className="hidden md:table-cell">Ditambahkan</TableHead>
                        {bolehUbahRole ? <TableHead className="text-right">Aksi</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {admins.map((a) => (
                        <TableRow key={a.telegram_user_id} data-testid={`admin-${a.telegram_user_id}`}>
                          <TableCell className="font-medium">
                            <span
                              className="block max-w-32 truncate md:max-w-none"
                              title={a.name ?? undefined}
                            >
                              {a.name ?? "—"}
                            </span>
                            <span className="block text-xs text-muted-foreground tabular-nums">
                              {a.telegram_user_id}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-28 truncate text-muted-foreground md:max-w-none">
                            {a.telegram_username ? `@${a.telegram_username}` : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={a.role === "owner" ? "default" : "secondary"}>
                              {labelRole(a.role)}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground md:table-cell">
                            {a.jabatan ?? "—"}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground md:table-cell">
                            {a.gudang_id ? (gudangMap.get(a.gudang_id) ?? a.gudang_id) : "—"}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground md:table-cell">
                            {formatTanggal(a.added_at)}
                          </TableCell>
                          {bolehUbahRole ? (
                            <TableCell className="text-right">
                              <div className="flex justify-end">
                                <AksiRoleAdmin
                                  admin={a}
                                  uid={uid ?? ""}
                                  onSukses={() => void muat()}
                                />
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Seksi>

            <Seksi
              id="perubahan-peran"
              judul="Perubahan Peran"
              deskripsi="Riwayat perubahan peran, terbaru dulu."
            >
              {timeline.length === 0 ? (
                <Kosong
                  ikon={<ShieldCheck aria-hidden />}
                  judul="Belum ada perubahan peran."
                  deskripsi="Perubahan peran akan tercatat di sini."
                  testId="empty-perubahan"
                />
              ) : (
                <ul className="flex flex-col" data-testid="daftar-perubahan">
                  {timeline.map((r, i) => (
                    <li key={r.id} data-testid={`perubahan-${r.id}`}>
                      {i > 0 ? <Separator /> : null}
                      <div className="flex flex-col gap-1 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{r.target_name ?? r.target_user_id}</span>
                          <Badge variant="outline">{labelRolePeran(r.old_role)}</Badge>
                          <span aria-hidden className="text-muted-foreground">
                            &rarr;
                          </span>
                          <Badge variant="secondary">{labelRolePeran(r.new_role)}</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="tabular-nums">{r.target_user_id}</span>
                          <span>oleh {r.changed_by}</span>
                          <time dateTime={r.created_at}>{formatTanggal(r.created_at)}</time>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Seksi>

            <Seksi
              id="permintaan-akses"
              judul="Permintaan Akses"
              deskripsi="Permintaan akses masuk. Tinjau dari Telegram."
            >
              {permintaan.length === 0 ? (
                <Kosong
                  ikon={<UserPlus aria-hidden />}
                  judul="Belum ada permintaan akses."
                  deskripsi="Permintaan dari calon admin akan tampil di sini."
                  testId="empty-permintaan-akses"
                />
              ) : (
                <ul className="flex flex-col" data-testid="daftar-akses">
                  {permintaan.map((a, i) => (
                    <li key={a.telegram_user_id} data-testid={`akses-${a.telegram_user_id}`}>
                      {i > 0 ? <Separator /> : null}
                      <div className="flex items-start justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p
                            className="truncate font-medium"
                            title={a.telegram_display_name ?? a.telegram_user_id}
                          >
                            {a.telegram_display_name ?? a.telegram_user_id}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {a.telegram_username ? `@${a.telegram_username}` : a.telegram_user_id}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Diminta {formatTanggal(a.requested_at)}
                          </p>
                          {a.rejected_until ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Ditolak sampai {formatTanggal(a.rejected_until)}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <Badge
                            variant={a.status === "rejected" ? "destructive" : "outline"}
                            className="shrink-0"
                            data-testid={`badge-status-akses-${a.telegram_user_id}`}
                          >
                            {LABEL_STATUS_AKSES[a.status] ?? a.status}
                          </Badge>
                          {bolehUbahRole && a.status === "pending" ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              <AksiAkses
                                permintaan={a}
                                jenis="setujui"
                                onSukses={() => void muat()}
                              />
                              <AksiAkses
                                permintaan={a}
                                jenis="tolak"
                                onSukses={() => void muat()}
                              />
                            </div>
                          ) : null}
                        </div>
                      </div>
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

/** `old_role`/`new_role` di dokumen riwayat bertipe string bebas. */
function labelRolePeran(role: string | null): string {
  if (role === "owner" || role === "admin" || role === "guest") return labelRole(role);
  return role ?? "—";
}

function Seksi({
  id,
  judul,
  deskripsi,
  children,
}: {
  id: string;
  judul: string;
  deskripsi: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${id}-judul`} data-testid={id}>
      <div className="min-w-0">
        <h2 id={`${id}-judul`} className="text-base font-semibold">
          {judul}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{deskripsi}</p>
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
    <div className="flex flex-col gap-6" data-testid="loading-admin" aria-busy>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}
