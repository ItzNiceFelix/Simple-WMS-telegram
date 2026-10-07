"use client"

// components/dashboard/kelola-admin.tsx
// F4 Seksi Kelola Admin (owner only): daftar + tambah + hapus. PRD v2 §5.5/§5.6.
import { useCallback, useEffect, useState } from "react"
import { Settings2, TriangleAlert, Trash2, UserPlus, Users } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DialogTambahAdmin } from "@/components/dashboard/dialog-tambah-admin"
import { KonfirmasiHapusAdmin } from "@/components/dashboard/konfirmasi-hapus-admin"
import { labelRole } from "@/lib/dashboard/format"
import { useData } from "@/lib/dashboard/sumber-data"
import { DialogUserGudangJabatan } from "@/components/dashboard/dialog-user-gudang-jabatan"
import type { AdminDoc, GudangDoc } from "@/lib/dashboard/types"

export function KelolaAdmin() {
  const data = useData()
  const [admins, setAdmins] = useState<AdminDoc[] | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [tambahOpen, setTambahOpen] = useState(false)
  const [hapusTarget, setHapusTarget] = useState<AdminDoc | null>(null)
  const [aturTarget, setAturTarget] = useState<AdminDoc | null>(null)
  const [gudangMap, setGudangMap] = useState<Map<string, string>>(new Map())
  const [peran, setPeran] = useState<string | null>(null)

  const muat = useCallback(async () => {
    setError(false)
    setAdmins(null)
    try {
      const [a, sesi, g] = await Promise.all([data.listAdmins(), data.getSession(), data.listGudang()])
      setAdmins(a)
      setUid(sesi.user.id)
      setPeran(sesi.role)
      setGudangMap(new Map(g.map((x: GudangDoc) => [x.gudang_id, x.nama])))
    } catch {
      setError(true)
    }
  }, [data])

  useEffect(() => {
    void muat()
  }, [muat])

  return (
    <section className="flex flex-col gap-3" aria-labelledby="kelola-admin-judul" data-testid="kelola-admin">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="kelola-admin-judul" className="text-base font-semibold">
            Kelola Admin
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Tambah atau cabut akses admin dashboard.
          </p>
        </div>
        <Button
          size="lg"
          className="h-11 md:h-8"
          disabled={admins === null}
          data-testid="buka-tambah-admin"
          onClick={() => setTambahOpen(true)}
        >
          <UserPlus data-icon="inline-start" />
          Tambah Admin
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" data-testid="error-kelola-admin">
          <TriangleAlert aria-hidden />
          <AlertTitle>Gagal memuat daftar admin.</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            Periksa koneksi lalu coba lagi.
            <Button variant="outline" size="sm" onClick={() => void muat()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      ) : admins === null ? (
        <div className="flex flex-col gap-2" aria-busy data-testid="loading-kelola-admin">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : admins.length === 0 ? (
        <Empty className="border border-dashed" data-testid="empty-kelola-admin">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Belum ada admin terdaftar.</EmptyTitle>
            <EmptyDescription>Tambahkan admin untuk memberi akses dashboard.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => setTambahOpen(true)}>
              Tambah Admin
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div data-testid="tabel-kelola-admin">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="hidden md:table-cell">Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Jabatan</TableHead>
                <TableHead className="hidden md:table-cell">Gudang</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((a) => {
                const sendiri = uid !== null && a.telegram_user_id === uid
                return (
                  <TableRow key={a.telegram_user_id} data-testid={`kelola-admin-${a.telegram_user_id}`}>
                    <TableCell className="font-medium">
                      <span className="block max-w-32 truncate md:max-w-none" title={a.name ?? undefined}>
                        {a.name ?? "—"}
                      </span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {a.telegram_user_id}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-28 truncate text-muted-foreground md:table-cell md:max-w-none">
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
                    <TableCell className="text-right">
                      {peran === "owner" ? (
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="mr-1 size-11 md:size-8"
                          aria-label={`Atur gudang dan jabatan ${a.name ?? a.telegram_user_id}`}
                          data-testid={`atur-user-${a.telegram_user_id}`}
                          onClick={() => setAturTarget(a)}
                        >
                          <Settings2 aria-hidden />
                        </Button>
                      ) : null}
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        className="size-11 md:size-8"
                        disabled={sendiri}
                        title={sendiri ? "Tidak boleh menghapus akun sendiri" : undefined}
                        aria-label={`Hapus ${a.name ?? a.telegram_user_id}`}
                        data-testid={`hapus-admin-${a.telegram_user_id}`}
                        onClick={() => setHapusTarget(a)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <DialogTambahAdmin open={tambahOpen} onOpenChange={setTambahOpen} onSukses={() => void muat()} />
      <DialogUserGudangJabatan
        open={aturTarget !== null}
        onOpenChange={(v) => {
          if (!v) setAturTarget(null)
        }}
        admin={aturTarget ?? ({} as AdminDoc)}
        onSukses={() => {
          setAturTarget(null)
          void muat()
        }}
      />
      <KonfirmasiHapusAdmin
        open={hapusTarget !== null}
        onOpenChange={(v) => {
          if (!v) setHapusTarget(null)
        }}
        admin={hapusTarget}
        onSukses={() => void muat()}
      />
    </section>
  )
}