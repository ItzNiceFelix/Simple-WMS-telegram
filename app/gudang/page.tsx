"use client"

// H10 Master Gudang (v5 F1) - owner only.
// Tabel gudang (nama, status, jumlah referensi) + tambah/edit/nonaktif/aktifkan.
// READ lewat DataSource (bukan route server); tulis lewat DataSource -> route v5.
import { useCallback, useEffect, useState } from "react"
import { TriangleAlert, Warehouse } from "lucide-react"

import { PageHeader } from "@/components/dashboard/page-header"
import { ButuhAkses } from "@/components/dashboard/butuh-akses"
import { AksiGudang } from "@/components/dashboard/aksi-gudang"
import { DialogGudang } from "@/components/dashboard/dialog-gudang"
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
import { formatAngka, formatTanggal } from "@/lib/dashboard/format"
import { useData } from "@/lib/dashboard/sumber-data"
import type { GudangDoc } from "@/lib/dashboard/types"

export default function HalamanGudang() {
  return (
    <ButuhAkses href="/gudang">
      <MasterGudang />
    </ButuhAkses>
  )
}

function MasterGudang() {
  const data = useData()
  const [rows, setRows] = useState<GudangDoc[] | null>(null)
  const [error, setError] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<GudangDoc | null>(null)

  const muat = useCallback(async () => {
    setError(false)
    setRows(null)
    try {
      // `semua:true` supaya gudang nonaktif tetap terlihat dan bisa diaktifkan lagi.
      setRows(await data.listGudang({ semua: true }))
    } catch {
      setError(true)
    }
  }, [data])

  useEffect(() => {
    void muat()
  }, [muat])

  function bukaTambah() {
    setEditTarget(null)
    setDialogOpen(true)
  }

  function bukaEdit(g: GudangDoc) {
    setEditTarget(g)
    setDialogOpen(true)
  }

  return (
    <>
      <PageHeader
        judul="Gudang"
        deskripsi="Lokasi penyimpanan stok. Gudang tidak dihapus, hanya dinonaktifkan."
        aksi={
          <Button
            size="lg"
            className="h-11 md:h-8"
            disabled={rows === null}
            data-testid="buka-tambah-gudang"
            onClick={bukaTambah}
          >
            <Warehouse data-icon="inline-start" />
            Tambah Lokasi Gudang
          </Button>
        }
      />

      <div className="flex flex-col gap-4" data-testid="h10-gudang">
        {error ? (
          <Alert variant="destructive" data-testid="error-gudang-halaman">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat daftar gudang.</AlertTitle>
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
          <Empty className="border border-dashed" data-testid="empty-gudang">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Warehouse aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Belum ada gudang.</EmptyTitle>
              <EmptyDescription>
                Tambahkan lokasi gudang pertama untuk memisahkan stok per tempat.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={bukaTambah}>
                Tambah Lokasi Gudang
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            {/* Mobile: kartu */}
            <ul className="flex flex-col gap-3 md:hidden" data-testid="daftar-gudang-kartu">
              {rows.map((g) => (
                <li key={g.gudang_id}>
                  <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={g.nama}>
                          {g.nama}
                        </p>
                        <p className="text-xs text-muted-foreground">{g.gudang_id}</p>
                      </div>
                      <Badge
                        variant={g.aktif ? "secondary" : "outline"}
                        data-testid={`status-gudang-${g.gudang_id}`}
                      >
                        {g.aktif ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Referensi</dt>
                        <dd className="tabular-nums">
                          {g.peringatan_referensi != null ? formatAngka(g.peringatan_referensi) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Dibuat</dt>
                        <dd className="truncate">{formatTanggal(g.created_at)}</dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="lg"
                        className="h-11 flex-1"
                        data-testid={`edit-gudang-${g.gudang_id}`}
                        onClick={() => bukaEdit(g)}
                      >
                        Edit
                      </Button>
                      <AksiGudang gudang={g} onSukses={() => void muat()} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: tabel */}
            <div className="hidden md:block" data-testid="tabel-gudang">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead className="hidden md:table-cell">ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Referensi</TableHead>
                    <TableHead className="hidden md:table-cell">Dibuat</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((g) => (
                    <TableRow key={g.gudang_id} data-testid={`baris-gudang-${g.gudang_id}`}>
                      <TableCell className="font-medium">
                        <span className="block max-w-56 truncate" title={g.nama}>
                          {g.nama}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {g.gudang_id}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={g.aktif ? "secondary" : "outline"}
                          data-testid={`status-gudang-${g.gudang_id}`}
                        >
                          {g.aktif ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.peringatan_referensi != null ? formatAngka(g.peringatan_referensi) : "—"}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {formatTanggal(g.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-11 md:h-8"
                            data-testid={`edit-gudang-${g.gudang_id}`}
                            onClick={() => bukaEdit(g)}
                          >
                            Edit
                          </Button>
                          <AksiGudang gudang={g} onSukses={() => void muat()} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      <DialogGudang
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        gudang={editTarget}
        onSukses={() => void muat()}
      />
    </>
  )
}

function Memuat() {
  return (
    <div className="flex flex-col gap-3" data-testid="loading-gudang" aria-busy>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  )
}