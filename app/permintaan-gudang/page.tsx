"use client"

// H12 Permintaan Gudang (v5.1) - owner + admin.
// Satu dokumen, siklus PER-TUJUAN: tiap tujuan punya `status_kirim` (setujui/kirim) SENDIRI
// dan `status` penerimaan SENDIRI. Tiga seksi: Buat (dialog), Filter, Daftar.
// Aturan perilaku acuan: lib/models/permintaanGudang.js + docs/plan-v5.1.md bagian 3 & 9.
// Akses: guest ditolak lewat ButuhAkses (paritas app/draft/page.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ArrowRightLeft, Plus, Trash2, TriangleAlert } from "lucide-react"

import { PageHeader } from "@/components/dashboard/page-header"
import { ButuhAkses } from "@/components/dashboard/butuh-akses"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Combobox } from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { formatTanggal } from "@/lib/dashboard/format"
import { useData, useRole } from "@/lib/dashboard/sumber-data"
import type {
  GudangDoc,
  PermintaanGudangDoc,
  PermintaanItem,
  PermintaanStatus,
  StatusKirimTujuan,
  StockRow,
  TujuanEntri,
  TujuanStatus,
} from "@/lib/dashboard/types"

const LABEL_STATUS: Record<PermintaanStatus, string> = {
  menunggu: "Menunggu",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  dibatalkan: "Dibatalkan",
  dikirim: "Dikirim",
  selesai: "Selesai",
}

const LABEL_TUJUAN: Record<TujuanStatus, string> = {
  menunggu: "Menunggu",
  diterima: "Diterima",
  tidak_terima: "Tidak diterima",
  ditolak: "Ditolak",
  ditutup: "Ditutup",
}

const LABEL_KIRIM: Record<StatusKirimTujuan, string> = {
  menunggu: "Menunggu",
  disetujui: "Disetujui",
  dikirim: "Dikirim",
}

/** Status tujuan yang tidak punya aksi lanjutan. */
const TUJUAN_FINAL = new Set<TujuanStatus>(["diterima", "tidak_terima", "ditolak", "ditutup"])

/** Status dokumen yang tidak punya aksi lanjutan. */
const STATUS_FINAL = new Set<PermintaanStatus>(["ditolak", "dibatalkan", "selesai"])

function varianStatus(s: PermintaanStatus): "default" | "secondary" | "outline" | "destructive" {
  if (s === "ditolak") return "destructive"
  if (s === "selesai") return "secondary"
  if (s === "dibatalkan") return "outline"
  return "default"
}

function varianTujuan(s: TujuanStatus): "default" | "secondary" | "outline" | "destructive" {
  if (s === "diterima") return "secondary"
  if (s === "tidak_terima") return "destructive"
  if (s === "ditolak") return "destructive"
  if (s === "ditutup") return "outline"
  return "default"
}

function varianKirim(s: StatusKirimTujuan): "default" | "secondary" | "outline" {
  if (s === "disetujui") return "secondary"
  if (s === "dikirim") return "default"
  return "outline"
}

/** Label gudang tujuan; v5.1 tujuan SELALU tipe gudang. */
function labelGudang(t: TujuanEntri): string {
  return t.nama ?? t.id
}

/** Label penerima: nama + jabatan; kosong -> "Belum ditentukan". */
function labelPenerima(t: TujuanEntri): string {
  if (t.user_penerima_nama) {
    return t.jabatan ? t.user_penerima_nama + " (" + t.jabatan + ")" : t.user_penerima_nama
  }
  return "Belum ditentukan"
}

/** Items efektif entri tujuan; fallback items dokumen (paritas `itemsEfektif`). */
function itemsTujuan(permintaan: PermintaanGudangDoc, t: TujuanEntri): PermintaanItem[] {
  return t.items && t.items.length > 0 ? t.items : permintaan.items
}

function totalQty(items: PermintaanItem[]): number {
  return items.reduce((n, it) => n + (it.qty || 0), 0)
}

interface UserTujuan {
  telegram_user_id: string
  name: string | null
  jabatan: string | null
  gudang_id: string | null
}

export default function HalamanPermintaanGudang() {
  return (
    <ButuhAkses href="/permintaan-gudang">
      <PermintaanGudang />
    </ButuhAkses>
  )
}

function PermintaanGudang() {
  const data = useData()
  const role = useRole()

  const [gudang, setGudang] = useState<GudangDoc[] | null>(null)
  const [produk, setProduk] = useState<StockRow[] | null>(null)
  const [users, setUsers] = useState<UserTujuan[] | null>(null)
  const [daftar, setDaftar] = useState<PermintaanGudangDoc[] | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [filterStatus, setFilterStatus] = useState<"semua" | PermintaanStatus>("semua")
  const [bukaBuat, setBukaBuat] = useState(false)

  const muat = useCallback(async () => {
    setError(false)
    setGudang(null)
    setProduk(null)
    setUsers(null)
    setDaftar(null)
    try {
      const [g, p, u, d, sesi] = await Promise.all([
        data.listGudang(),
        data.listStock({ is_online: "semua" }),
        data.listUserTujuan(),
        data.listPermintaanGudang(),
        data.getSession(),
      ])
      setGudang(g)
      setProduk(p)
      setUsers(u)
      setDaftar(d)
      setUid(sesi.user.id)
    } catch {
      setError(true)
    }
  }, [data])

  useEffect(() => {
    void muat()
  }, [muat])

  const namaGudang = useMemo(
    () => new Map((gudang ?? []).map((g) => [g.gudang_id, g.nama])),
    [gudang]
  )

  const tampil = useMemo(
    () => (daftar ?? []).filter((r) => filterStatus === "semua" || r.status === filterStatus),
    [daftar, filterStatus]
  )

  const sedangMemuat =
    gudang === null || produk === null || users === null || daftar === null || uid === null

  return (
    <>
      <PageHeader
        judul="Permintaan Gudang"
        deskripsi="Permintaan barang antar gudang. Setiap tujuan punya status setujui/kirim dan status penerimaannya sendiri."
        aksi={
          <Button
            size="lg"
            className="h-11 md:h-8"
            data-testid="buka-buat-permintaan"
            // Gudang kosong -> dialog tidak bisa mengisi gudang asal (server akan menolak).
            disabled={sedangMemuat || (gudang ?? []).length === 0}
            title={
              !sedangMemuat && (gudang ?? []).length === 0
                ? "Tambahkan lokasi gudang dulu."
                : undefined
            }
            onClick={() => setBukaBuat(true)}
          >
            <Plus data-icon="inline-start" />
            Buat Permintaan
          </Button>
        }
      />
      <div className="flex flex-col gap-6" data-testid="h12-permintaan-gudang">
        {error ? (
          <Alert variant="destructive" data-testid="error-permintaan-gudang">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat permintaan gudang.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              Periksa koneksi lalu coba lagi.
              <Button variant="outline" size="sm" onClick={() => void muat()}>
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : sedangMemuat ? (
          <Memuat />
        ) : gudang.length === 0 ? (
          <Empty className="border border-dashed" data-testid="empty-gudang">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ArrowRightLeft aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Belum ada gudang aktif.</EmptyTitle>
              <EmptyDescription>
                Minta owner menambahkan lokasi gudang sebelum membuat permintaan antar gudang.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <section
              className="flex flex-col gap-3"
              aria-labelledby="permintaan-filter-judul"
              data-testid="seksi-filter-permintaan"
            >
              <div className="min-w-0">
                <h2 id="permintaan-filter-judul" className="text-base font-semibold">
                  Filter
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Tampilkan permintaan berdasarkan status dokumen.
                </p>
              </div>
              <Field className="md:max-w-xs">
                <FieldLabel htmlFor="filter-status-permintaan">Status permintaan</FieldLabel>
                <Select
                  value={filterStatus}
                  onValueChange={(v) => {
                    if (typeof v === "string") setFilterStatus(v as "semua" | PermintaanStatus)
                  }}
                >
                  <SelectTrigger
                    id="filter-status-permintaan"
                    className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                    data-testid="filter-status-permintaan"
                  >
                    <SelectValue>
                      {(v: string | null) =>
                        !v || v === "semua" ? "Semua status" : LABEL_STATUS[v as PermintaanStatus]
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="semua">Semua status</SelectItem>
                      <SelectItem value="menunggu">Menunggu</SelectItem>
                      <SelectItem value="disetujui">Disetujui</SelectItem>
                      <SelectItem value="dikirim">Dikirim</SelectItem>
                      <SelectItem value="selesai">Selesai</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </section>

            <section
              className="flex flex-col gap-3"
              aria-labelledby="permintaan-daftar-judul"
              data-testid="seksi-daftar-permintaan"
            >
              <div className="min-w-0">
                <h2 id="permintaan-daftar-judul" className="text-base font-semibold">
                  Daftar Permintaan
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {tampil.length}
                  </span>
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Aksi menyesuaikan status dokumen dan status tiap tujuan.
                </p>
              </div>

              {tampil.length === 0 ? (
                <Empty className="border border-dashed" data-testid="empty-permintaan">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ArrowRightLeft aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>
                      {filterStatus === "semua"
                        ? "Belum ada permintaan gudang."
                        : "Tidak ada permintaan berstatus " +
                          LABEL_STATUS[filterStatus].toLowerCase() +
                          "."}
                    </EmptyTitle>
                    <EmptyDescription>
                      {filterStatus === "semua"
                        ? "Buat permintaan baru untuk memindahkan barang antar gudang."
                        : "Ubah filter status untuk melihat permintaan lain."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="flex flex-col gap-3" data-testid="daftar-permintaan">
                  {tampil.map((r) => (
                    <li key={r.id}>
                      <KartuPermintaan
                        permintaan={r}
                        namaGudang={namaGudang}
                        role={role}
                        uid={uid ?? ""}
                        produk={produk ?? []}
                        onSukses={() => void muat()}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <DialogBuatPermintaan
        open={bukaBuat}
        onOpenChange={setBukaBuat}
        gudang={gudang ?? []}
        produk={produk ?? []}
        users={users ?? []}
        role={role}
        onSukses={() => void muat()}
      />
    </>
  )
}

// ---------------- Kartu ----------------

function KartuPermintaan({
  permintaan,
  namaGudang,
  role,
  uid,
  produk,
  onSukses,
}: {
  permintaan: PermintaanGudangDoc
  namaGudang: Map<string, string>
  role: string
  uid: string
  produk: StockRow[]
  onSukses: () => void
}) {
  const id = permintaan.id
  const final = STATUS_FINAL.has(permintaan.status)
  // P6: semua tujuan final -> dokumen bisa ditutup (Selesai) oleh pembuat/owner.
  const semuaTujuanFinal =
    permintaan.tujuan.length > 0 && permintaan.tujuan.every((t) => TUJUAN_FINAL.has(t.status))
  const bolehSelesai = role === "owner" || (uid !== "" && uid === permintaan.created_by)

  return (
    <Card size="sm" data-testid={`kartu-permintaan-${id}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>
            Dari {namaGudang.get(permintaan.dari_gudang_id) ?? permintaan.dari_gudang_id}
          </span>
          <Badge variant={varianStatus(permintaan.status)} data-testid={`status-permintaan-${id}`}>
            {LABEL_STATUS[permintaan.status]}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground tabular-nums">
          {permintaan.tujuan.length} tujuan · {permintaan.items.length} item · Dibuat{" "}
          {formatTanggal(permintaan.created_at)} · Oleh {permintaan.created_by}
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">Item dokumen</h3>
          <ul className="flex flex-col gap-1.5">
            {permintaan.items.map((it) => (
              <li key={it.kode_barang} className="flex flex-wrap items-baseline gap-x-2">
                <span className="truncate font-medium">{it.kode_barang}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {it.qty}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Tujuan</h3>
          <ul className="flex flex-col gap-3" data-testid={`tujuan-permintaan-${id}`}>
            {permintaan.tujuan.map((t, i) => (
              <BarisTujuan
                key={t.tipe + "-" + t.id + "-" + i}
                permintaan={permintaan}
                tujuan={t}
                index={i}
                role={role}
                uid={uid}
                onSukses={onSukses}
              />
            ))}
          </ul>
        </div>
      </CardContent>

      {!final ? (
        <CardFooter className="flex-wrap items-end justify-end gap-2">
          <AksiBatalDokumen
            id={id}
            boleh={role !== "guest" && (permintaan.status === "menunggu" || permintaan.status === "disetujui")}
            onSukses={onSukses}
          />
          {permintaan.status === "menunggu" ? (
            <DialogUbahItem permintaan={permintaan} produk={produk} onSukses={onSukses} />
          ) : null}
          <AksiSelesaiDokumen
            id={id}
            tampil={permintaan.status === "dikirim"}
            aktif={semuaTujuanFinal && bolehSelesai}
            alasan={
              permintaan.status !== "dikirim"
                ? null
                : !semuaTujuanFinal
                  ? "Masih ada tujuan yang belum final. Selesaikan setelah semua tujuan diterima, tidak diterima, ditolak, atau ditutup."
                  : !bolehSelesai
                    ? "Hanya pembuat permintaan atau owner yang dapat menyelesaikan."
                    : null
            }
            onSukses={onSukses}
          />
        </CardFooter>
      ) : null}
    </Card>
  )
}

// ---------------- Baris tujuan ----------------

function BarisTujuan({
  permintaan,
  tujuan,
  index,
  role,
  uid,
  onSukses,
}: {
  permintaan: PermintaanGudangDoc
  tujuan: TujuanEntri
  index: number
  role: string
  uid: string
  onSukses: () => void
}) {
  const id = permintaan.id
  const items = itemsTujuan(permintaan, tujuan)
  const final = TUJUAN_FINAL.has(tujuan.status)
  // Gate penerima/owner untuk setujui/tolak/kirim (paritas `_assertPenerimaAtauOwner`).
  const penerimaSaya = tujuan.user_penerima_id ? uid === tujuan.user_penerima_id : role === "owner"
  // Gate pembuat/owner untuk terima/tidak-terima (paritas `_assertPembuatAtauOwner`).
  const pembuatSaya = role === "owner" || (uid !== "" && uid === permintaan.created_by)
  // Aksi setujui/kirim hanya relevan sebelum entri final.
  const perluSetujui = tujuan.status_kirim === "menunggu" && !final
  const perluKirim = tujuan.status_kirim === "disetujui" && !final
  const perluTerima = tujuan.status_kirim === "dikirim" && tujuan.status === "menunggu"

  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      data-testid={`tujuan-${id}-${index}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate font-medium">{labelGudang(tujuan)}</span>
        <Badge
          variant={varianKirim(tujuan.status_kirim)}
          data-testid={`status-kirim-${id}-${index}`}
        >
          {LABEL_KIRIM[tujuan.status_kirim]}
        </Badge>
        <Badge variant={varianTujuan(tujuan.status)}>{LABEL_TUJUAN[tujuan.status]}</Badge>
        {tujuan.notifikasi_terkirim === false ? (
          <Badge variant="destructive" data-testid={`notif-gagal-${id}-${index}`}>
            Notifikasi gagal terkirim
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p data-testid={`penerima-${id}-${index}`}>
          Penerima: <span className="text-foreground">{labelPenerima(tujuan)}</span>
        </p>
        <ul className="flex flex-col gap-0.5" data-testid={`qty-tujuan-${id}-${index}`}>
          {items.map((it) => (
            <li key={it.kode_barang} className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate">{it.kode_barang}</span>
              <span className="ml-auto tabular-nums">{it.qty}</span>
            </li>
          ))}
        </ul>
        <p className="tabular-nums">Total qty tujuan: {totalQty(items)}</p>
        {tujuan.status === "ditutup" && tujuan.catatan_alasan ? (
          <p>Alasan ditutup: {tujuan.catatan_alasan}</p>
        ) : null}
      </div>

      {perluSetujui || perluKirim || perluTerima ? (
        <div className="flex flex-wrap gap-2">
          {perluSetujui ? (
            <>
              <AksiTujuanSederhana
                id={id}
                index={index}
                jenis="setujui"
                onSukses={onSukses}
                gate={penerimaSaya}
                alasanDisabled="Hanya penerima tujuan ini atau owner yang dapat menyetujui."
              />
              <AksiTujuanSederhana
                id={id}
                index={index}
                jenis="tolak"
                onSukses={onSukses}
                gate={penerimaSaya}
                alasanDisabled="Hanya penerima tujuan ini atau owner yang dapat menolak."
              />
            </>
          ) : null}

          {perluKirim ? (
            <AksiTujuanSederhana
              id={id}
              index={index}
              jenis="kirim"
              onSukses={onSukses}
              gate={penerimaSaya}
              alasanDisabled="Hanya penerima tujuan ini atau owner yang dapat mengirim."
            />
          ) : null}

          {perluTerima ? (
            <>
              <AksiTujuanSederhana
                id={id}
                index={index}
                jenis="terima"
                onSukses={onSukses}
                gate={pembuatSaya}
                alasanDisabled="Hanya pembuat permintaan atau owner yang dapat mengonfirmasi."
              />
              <AksiTujuanSederhana
                id={id}
                index={index}
                jenis="tidak-terima"
                onSukses={onSukses}
                gate={pembuatSaya}
                alasanDisabled="Hanya pembuat permintaan atau owner yang dapat mengonfirmasi."
              />
            </>
          ) : null}

          {role === "owner" && tujuan.status === "menunggu" && !final ? (
            <DialogTutupTujuan id={id} index={index} onSukses={onSukses} />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

// ---------------- Aksi per tujuan (setujui/tolak/kirim/terima/tidak-terima) ----------------

type JenisAksiTujuan = "setujui" | "tolak" | "kirim" | "terima" | "tidak-terima"

const AKSI_TUJUAN: Record<
  JenisAksiTujuan,
  { label: string; varian: "default" | "outline"; judul: string; deskripsi: string; sukses: string }
> = {
  setujui: {
    label: "Setujui",
    varian: "default",
    judul: "Setujui tujuan ini?",
    deskripsi: "Tujuan ini siap dikirim ke gudang tujuan.",
    sukses: "Tujuan disetujui.",
  },
  tolak: {
    label: "Tolak",
    varian: "outline",
    judul: "Tolak tujuan ini?",
    deskripsi: "Tujuan ini ditandai ditolak dan tidak diproses lebih lanjut.",
    sukses: "Tujuan ditolak.",
  },
  kirim: {
    label: "Kirim",
    varian: "default",
    judul: "Kirim tujuan ini?",
    deskripsi: "Stok gudang asal berkurang sebesar qty tujuan ini saja.",
    sukses: "Tujuan dikirim. Stok gudang asal berkurang.",
  },
  terima: {
    label: "Terima",
    varian: "default",
    judul: "Terima tujuan ini?",
    deskripsi: "Stok gudang tujuan bertambah sesuai qty tujuan ini.",
    sukses: "Tujuan diterima. Stok gudang tujuan bertambah.",
  },
  "tidak-terima": {
    label: "Tidak Terima",
    varian: "outline",
    judul: "Tidak terima tujuan ini?",
    deskripsi: "Stok dikembalikan ke gudang asal dan tujuan ditandai tidak diterima.",
    sukses: "Tujuan tidak diterima. Stok kembali ke gudang asal.",
  },
}

function AksiTujuanSederhana({
  id,
  index,
  jenis,
  onSukses,
  gate,
  alasanDisabled,
}: {
  id: string
  index: number
  jenis: JenisAksiTujuan
  onSukses: () => void
  gate: boolean
  alasanDisabled: string
}) {
  const data = useData()
  const [open, setOpen] = useState(false)
  const [mengirim, setMengirim] = useState(false)
  const konf = AKSI_TUJUAN[jenis]

  async function kirim() {
    setMengirim(true)
    try {
      const res =
        jenis === "setujui"
          ? await data.setujuiTujuanGudang({ id, tujuan_index: index })
          : jenis === "tolak"
            ? await data.tolakTujuanPermintaanGudang({ id, tujuan_index: index })
            : jenis === "kirim"
              ? await data.kirimPermintaanGudang({ id, tujuan_index: index })
              : jenis === "terima"
                ? await data.terimaPermintaanGudang({ id, tujuan_index: index })
                : await data.tidakTerimaPermintaanGudang({ id, tujuan_index: index })
      if (res.ok) {
        toast.success(konf.sukses)
        setOpen(false)
        onSukses()
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa) {
          setOpen(false)
          onSukses()
        }
      }
    } catch {
      toast.error("Gagal memproses tujuan. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  const testId =
    jenis === "setujui"
      ? `aksi-setujui-tujuan-${id}-${index}`
      : jenis === "kirim"
        ? `aksi-kirim-tujuan-${id}-${index}`
        : jenis === "terima"
          ? `aksi-terima-${id}-${index}`
          : `aksi-${jenis}-tujuan-${id}-${index}`

  return (
    <>
      <Button
        variant={konf.varian}
        size="sm"
        className="h-11 md:h-8"
        data-testid={testId}
        disabled={!gate}
        title={!gate ? alasanDisabled : undefined}
        onClick={() => {
          if (!gate) return
          setOpen(true)
        }}
      >
        {konf.label}
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!mengirim) setOpen(v)
        }}
      >
        <AlertDialogContent data-testid={`dialog-aksi-${jenis}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>{konf.judul}</AlertDialogTitle>
            <AlertDialogDescription>{konf.deskripsi}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={`batal-${jenis}-${id}-${index}`}
              onClick={() => setOpen(false)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={`konfirmasi-${jenis}-${id}-${index}`}
              onClick={() => void kirim()}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Memproses..." : "Ya, " + konf.label.toLowerCase()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---------------- Aksi dokumen (batal + selesai) ----------------

function AksiBatalDokumen({
  id,
  boleh,
  onSukses,
}: {
  id: string
  boleh: boolean
  onSukses: () => void
}) {
  const data = useData()
  const [open, setOpen] = useState(false)
  const [mengirim, setMengirim] = useState(false)

  async function kirim() {
    setMengirim(true)
    try {
      const res = await data.batalPermintaanGudang({ id })
      if (res.ok) {
        toast.success("Permintaan dibatalkan.")
        setOpen(false)
        onSukses()
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa) {
          setOpen(false)
          onSukses()
        }
      }
    } catch {
      toast.error("Gagal membatalkan permintaan. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-11 md:h-8"
        data-testid={`aksi-batal-${id}`}
        disabled={!boleh}
        onClick={() => {
          if (!boleh) return
          setOpen(true)
        }}
      >
        Batal
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!mengirim) setOpen(v)
        }}
      >
        <AlertDialogContent data-testid="dialog-aksi-batal">
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan permintaan ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Permintaan dibatalkan dan tidak diproses lebih lanjut.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={`batal-aksi-batal-${id}`}
              onClick={() => setOpen(false)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={`konfirmasi-aksi-batal-${id}`}
              onClick={() => void kirim()}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Memproses..." : "Ya, batalkan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AksiSelesaiDokumen({
  id,
  tampil,
  aktif,
  alasan,
  onSukses,
}: {
  id: string
  tampil: boolean
  aktif: boolean
  alasan: string | null
  onSukses: () => void
}) {
  const data = useData()
  const [open, setOpen] = useState(false)
  const [mengirim, setMengirim] = useState(false)

  if (!tampil) return null

  async function kirim() {
    setMengirim(true)
    try {
      const res = await data.selesaiPermintaanGudang({ id })
      if (res.ok) {
        toast.success("Permintaan diselesaikan.")
        setOpen(false)
        onSukses()
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa) {
          setOpen(false)
          onSukses()
        }
      }
    } catch {
      toast.error("Gagal menyelesaikan permintaan. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        className="h-11 md:h-8"
        data-testid={`aksi-selesai-${id}`}
        disabled={!aktif}
        title={!aktif && alasan ? alasan : undefined}
        onClick={() => {
          if (!aktif) return
          setOpen(true)
        }}
      >
        Selesai
      </Button>
      {!aktif && alasan ? (
        <p className="max-w-xs text-right text-xs text-muted-foreground" data-testid={`alasan-selesai-${id}`}>
          {alasan}
        </p>
      ) : null}

      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!mengirim) setOpen(v)
        }}
      >
        <AlertDialogContent data-testid="dialog-aksi-selesai">
          <AlertDialogHeader>
            <AlertDialogTitle>Selesaikan permintaan ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Dokumen ditandai selesai. Stok tidak berubah oleh aksi ini.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={`batal-aksi-selesai-${id}`}
              onClick={() => setOpen(false)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={`konfirmasi-aksi-selesai-${id}`}
              onClick={() => void kirim()}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Memproses..." : "Ya, selesai"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------- Tutup tujuan (owner, wajib catatan 1-200) ----------------

const MAKS_CATATAN = 200

function DialogTutupTujuan({
  id,
  index,
  onSukses,
}: {
  id: string
  index: number
  onSukses: () => void
}) {
  const data = useData()
  const [open, setOpen] = useState(false)
  const [catatan, setCatatan] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const sinkron = useRef(false)

  useEffect(() => {
    if (open && !sinkron.current) {
      setCatatan("")
      setError(null)
      setMengirim(false)
    }
    sinkron.current = open
  }, [open])

  function tutup(v: boolean) {
    if (mengirim) return
    if (!v) setError(null)
    setOpen(v)
  }

  async function kirim() {
    const teks = catatan.trim()
    if (teks.length < 1) {
      setError("Alasan wajib diisi (1 sampai 200 karakter).")
      return
    }
    if (teks.length > MAKS_CATATAN) {
      setError("Alasan maksimal 200 karakter.")
      return
    }
    setError(null)
    setMengirim(true)
    try {
      const res = await data.tutupTujuanPermintaanGudang({
        id,
        tujuan_index: index,
        catatan: teks,
      })
      if (res.ok) {
        toast.success("Tujuan ditutup dengan catatan alasan.")
        setOpen(false)
        onSukses()
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa) setError(res.error)
      }
    } catch {
      toast.error("Gagal menutup tujuan. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-11 md:h-8"
        data-testid={`aksi-tutup-${id}-${index}`}
        onClick={() => setOpen(true)}
      >
        Tutup Tujuan
      </Button>

      <Dialog open={open} onOpenChange={tutup}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-catatan">
          <DialogHeader>
            <DialogTitle>Tutup tujuan ini?</DialogTitle>
            <DialogDescription>
              Tujuan nyangkut ditutup tanpa mengubah stok. Alasan wajib diisi dan tercatat pada
              tujuan.
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void kirim()
            }}
          >
            <Field
              data-invalid={error ? true : undefined}
              data-disabled={mengirim ? true : undefined}
            >
              <FieldLabel htmlFor={`catatan-tutup-${id}-${index}`}>Alasan</FieldLabel>
              <Input
                id={`catatan-tutup-${id}-${index}`}
                autoComplete="off"
                maxLength={MAKS_CATATAN}
                value={catatan}
                aria-invalid={error ? true : undefined}
                disabled={mengirim}
                placeholder="mis. gudang tujuan kosong"
                data-testid={`input-catatan-${id}-${index}`}
                onChange={(e) => {
                  setCatatan(e.target.value)
                  setError(null)
                }}
              />
              {error ? (
                <FieldError data-testid="error-catatan">{error}</FieldError>
              ) : (
                <FieldDescription>1 sampai 200 karakter.</FieldDescription>
              )}
            </Field>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 md:h-9"
                disabled={mengirim}
                data-testid={`batal-tutup-${id}-${index}`}
                onClick={() => tutup(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="lg"
                className="h-11 md:h-9"
                disabled={mengirim || catatan.trim() === ""}
                data-testid={`simpan-tutup-${id}-${index}`}
              >
                {mengirim ? <Spinner data-icon="inline-start" /> : null}
                {mengirim ? "Menyimpan..." : "Tutup Tujuan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------- Ubah item (hanya status menunggu) ----------------

interface BarisItem {
  key: number
  kode: string
  qty: string
}

function DialogUbahItem({
  permintaan,
  produk,
  onSukses,
}: {
  permintaan: PermintaanGudangDoc
  produk: StockRow[]
  onSukses: () => void
}) {
  const data = useData()
  const [open, setOpen] = useState(false)
  const [baris, setBaris] = useState<BarisItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const sinkron = useRef(false)

  const opsiProduk = useMemo(
    () =>
      produk.map((p) => ({
        value: p.kode_barang,
        label: p.nama_accurate ?? p.kode_barang,
      })),
    [produk]
  )

  useEffect(() => {
    if (open && !sinkron.current) {
      setBaris(
        permintaan.items.map((it, i) => ({ key: i + 1, kode: it.kode_barang, qty: String(it.qty) }))
      )
      setError(null)
      setMengirim(false)
    }
    sinkron.current = open
  }, [open, permintaan])

  function tutup(v: boolean) {
    if (mengirim) return
    if (!v) setError(null)
    setOpen(v)
  }

  function tambah() {
    setBaris((b) => [...b, { key: Date.now(), kode: "", qty: "" }])
  }

  function hapus(key: number) {
    setBaris((b) => (b.length <= 1 ? b : b.filter((x) => x.key !== key)))
  }

  function ubah(key: number, patch: Partial<BarisItem>) {
    setBaris((b) => b.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  }

  async function kirim() {
    const items: PermintaanItem[] = []
    const lihat = new Set<string>()
    for (const b of baris) {
      if (b.kode === "") {
        setError("Pilih produk untuk setiap baris.")
        return
      }
      if (lihat.has(b.kode)) {
        setError("Item duplikat dalam permintaan.")
        return
      }
      lihat.add(b.kode)
      const teks = b.qty.trim()
      if (!/^\d+$/.test(teks) || Number(teks) <= 0) {
        setError("Qty harus bilangan bulat lebih dari 0.")
        return
      }
      items.push({ kode_barang: b.kode, qty: Number(teks) })
    }
    if (items.length === 0) {
      setError("Permintaan harus punya minimal satu item.")
      return
    }
    setError(null)
    setMengirim(true)
    try {
      const res = await data.ubahItemPermintaan({ id: permintaan.id, items })
      if (res.ok) {
        toast.success("Item permintaan diperbarui.")
        setOpen(false)
        onSukses()
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa) setError(res.error)
      }
    } catch {
      toast.error("Gagal mengubah item. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-11 md:h-8"
        data-testid={`aksi-ubah-item-${permintaan.id}`}
        onClick={() => setOpen(true)}
      >
        Ubah Item
      </Button>

      <Dialog open={open} onOpenChange={tutup}>
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
          data-testid="dialog-ubah-item"
        >
          <DialogHeader>
            <DialogTitle>Ubah Item</DialogTitle>
            <DialogDescription>
              Ubah daftar barang dan jumlah. Hanya permintaan berstatus menunggu yang bisa diubah.
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void kirim()
            }}
          >
            <ul className="flex flex-col gap-3" data-testid="daftar-baris-ubah-item">
              {baris.map((b) => (
                <li key={b.key} className="flex flex-col gap-2 md:flex-row md:items-end">
                  <Field className="flex-1">
                    <FieldLabel htmlFor={`ubah-produk-${b.key}`}>
                      Produk{baris.length > 1 ? " " + (baris.indexOf(b) + 1) : ""}
                    </FieldLabel>
                    <Combobox
                      id={`ubah-produk-${b.key}`}
                      value={b.kode === "" ? null : b.kode}
                      onChange={(v) => ubah(b.key, { kode: v ?? "" })}
                      items={opsiProduk}
                      placeholder="Cari produk..."
                      kosongTeks="Produk tidak ditemukan"
                      disabled={mengirim}
                      data-testid={`pilih-produk-ubah-${b.key}`}
                    />
                  </Field>

                  <Field className="md:w-32">
                    <FieldLabel htmlFor={`ubah-qty-${b.key}`}>Qty</FieldLabel>
                    <Input
                      id={`ubah-qty-${b.key}`}
                      inputMode="numeric"
                      autoComplete="off"
                      value={b.qty}
                      disabled={mengirim}
                      placeholder="0"
                      className="h-11 md:h-8"
                      data-testid={`qty-ubah-${b.key}`}
                      onChange={(e) => ubah(b.key, { qty: e.target.value })}
                    />
                  </Field>

                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-sm"
                    className="size-11 md:size-8"
                    disabled={mengirim || baris.length <= 1}
                    aria-label="Hapus baris"
                    data-testid={`hapus-baris-ubah-${b.key}`}
                    onClick={() => hapus(b.key)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>

            <div>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 md:h-8"
                disabled={mengirim}
                data-testid="tambah-baris-ubah-item"
                onClick={tambah}
              >
                <Plus data-icon="inline-start" />
                Tambah Baris
              </Button>
            </div>

            {error ? <FieldError data-testid="error-ubah-item">{error}</FieldError> : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 md:h-9"
                disabled={mengirim}
                data-testid="batal-ubah-item"
                onClick={() => tutup(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="lg"
                className="h-11 md:h-9"
                disabled={mengirim}
                data-testid="simpan-ubah-item"
              >
                {mengirim ? <Spinner data-icon="inline-start" /> : null}
                {mengirim ? "Menyimpan..." : "Simpan Item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------- Dialog buat permintaan (v5.1) ----------------

interface BarisTujuanForm {
  key: number
  gudangId: string
  penerimaId: string | null
  qty: Record<string, string>
}

function DialogBuatPermintaan({
  open,
  onOpenChange,
  gudang,
  produk,
  users,
  role,
  onSukses,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  gudang: GudangDoc[]
  produk: StockRow[]
  users: UserTujuan[]
  role: string
  onSukses: () => void
}) {
  const data = useData()
  const [dari, setDari] = useState("")
  const [baris, setBaris] = useState<BarisItem[]>([{ key: 1, kode: "", qty: "" }])
  const [tujuan, setTujuan] = useState<BarisTujuanForm[]>([])
  const [error, setError] = useState<string | null>(null)
  const [mengirim, setMengirim] = useState(false)
  const sinkron = useRef(false)

  const opsiProduk = useMemo(
    () =>
      produk.map((p) => ({
        value: p.kode_barang,
        label: p.nama_accurate ?? p.kode_barang,
      })),
    [produk]
  )

  const gudangTujuanTersedia = useMemo(
    () => gudang.filter((g) => g.gudang_id !== dari),
    [gudang, dari]
  )

  const barisTerisi = baris.filter((b) => b.kode !== "")

  // Reset form SEKALI saat dialog dibuka.
  useEffect(() => {
    if (open && !sinkron.current) {
      setBaris([{ key: 1, kode: "", qty: "" }])
      setTujuan([])
      setError(null)
      setMengirim(false)
    }
    sinkron.current = open
  }, [open])

  // Isi gudang asal default. DIPISAH dari reset karena gudang bisa termuat SETELAH
  // dialog dibuka; tanpa efek ini `dari` tetap kosong dan server menolak.
  useEffect(() => {
    if (!open) return
    setDari((kini) => {
      if (kini && gudang.some((g) => g.gudang_id === kini)) return kini
      return gudang.length > 0 ? gudang[0].gudang_id : ""
    })
  }, [open, gudang])

  function tutup(v: boolean) {
    if (mengirim) return
    if (!v) setError(null)
    onOpenChange(v)
  }

  function pilihGudangTujuan(gudangId: string) {
    setTujuan((t) => {
      const ada = t.some((x) => x.gudangId === gudangId)
      if (ada) return t.filter((x) => x.gudangId !== gudangId)
      return [
        ...t,
        {
          key: Date.now() + Math.floor(Math.random() * 1000),
          gudangId,
          penerimaId: null,
          qty: {},
        },
      ]
    })
  }

  function ubahTujuan(key: number, patch: Partial<BarisTujuanForm>) {
    setTujuan((t) => t.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  }

  function tambah() {
    setBaris((b) => [...b, { key: Date.now(), kode: "", qty: "" }])
  }

  function hapus(key: number) {
    setBaris((b) => (b.length <= 1 ? b : b.filter((x) => x.key !== key)))
  }

  function ubah(key: number, patch: Partial<BarisItem>) {
    setBaris((b) => b.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  }

  /** Validasi + rakit tujuan[].items dari qty PER GUDANG. Lempar Error -> ditangkap jadi pesan form. */
  function rakitTujuan(items: PermintaanItem[]) {
    return tujuan.map((t) => {
      const itemsTujuan: PermintaanItem[] = []
      for (const b of baris) {
        if (b.kode === "") continue
        const teks = (t.qty[b.kode] ?? "").trim()
        if (teks === "") {
          const asal = items.find((it) => it.kode_barang === b.kode)
          if (asal) itemsTujuan.push({ ...asal })
          continue
        }
        if (!/^\d+$/.test(teks) || Number(teks) <= 0) {
          throw new Error("Qty per gudang harus bilangan bulat lebih dari 0.")
        }
        itemsTujuan.push({ kode_barang: b.kode, qty: Number(teks) })
      }
      if (itemsTujuan.length === 0) {
        throw new Error("Tujuan belum berisi item.")
      }
      return {
        tipe: "gudang" as const,
        id: t.gudangId,
        user_penerima_id: t.penerimaId,
        items: itemsTujuan,
      }
    })
  }

  async function kirim() {
    if (!dari) {
      setError("Pilih gudang asal dulu.")
      return
    }
    const items: PermintaanItem[] = []
    const lihat = new Set<string>()
    for (const b of baris) {
      if (b.kode === "" && b.qty.trim() === "") continue
      if (b.kode === "") {
        setError("Pilih produk untuk setiap baris yang diisi.")
        return
      }
      if (lihat.has(b.kode)) {
        setError("Item duplikat dalam permintaan.")
        return
      }
      lihat.add(b.kode)
      const teks = b.qty.trim()
      if (!/^\d+$/.test(teks) || Number(teks) <= 0) {
        setError("Qty harus bilangan bulat lebih dari 0.")
        return
      }
      items.push({ kode_barang: b.kode, qty: Number(teks) })
    }
    if (items.length === 0) {
      setError("Permintaan harus punya minimal satu item.")
      return
    }
    if (tujuan.length === 0) {
      setError("Pilih minimal satu gudang tujuan pada bagian Kirim ke.")
      return
    }

    let tujuanKirim: {
      tipe: "gudang"
      id: string
      user_penerima_id: string | null
      items: PermintaanItem[]
    }[]
    try {
      tujuanKirim = rakitTujuan(items)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tujuan tidak valid.")
      return
    }

    setError(null)
    setMengirim(true)
    try {
      const res = await data.buatPermintaanGudang({
        dari_gudang_id: dari,
        tujuan: tujuanKirim,
        items,
      })
      if (res.ok) {
        toast.success("Permintaan dibuat. Menunggu persetujuan.")
        onOpenChange(false)
        onSukses()
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa) setError(res.error)
      }
    } catch {
      toast.error("Gagal membuat permintaan. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
        data-testid="dialog-permintaan"
      >
        <DialogHeader>
          <DialogTitle>Buat Permintaan</DialogTitle>
          <DialogDescription>
            Minta barang dari satu gudang asal. Pilih gudang tujuan, penerima (opsional), dan qty
            per gudang. Qty antar gudang boleh berbeda.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void kirim()
          }}
        >
          <Field>
            <FieldLabel htmlFor="buat-gudang-asal">Gudang asal</FieldLabel>
            <Select
              value={dari === "" ? undefined : dari}
              onValueChange={(v) => {
                if (typeof v === "string") {
                  setDari(v)
                  // Tujuan harus selain gudang asal -> reset bila gudang asal berubah.
                  setTujuan([])
                }
              }}
              disabled={mengirim}
            >
              <SelectTrigger
                id="buat-gudang-asal"
                className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                data-testid="pilih-gudang-asal"
              >
                <SelectValue>
                  {(v: string | null) =>
                    v ? (gudang.find((g) => g.gudang_id === v)?.nama ?? v) : "Pilih gudang asal"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {gudang.map((g) => (
                    <SelectItem key={g.gudang_id} value={g.gudang_id}>
                      {g.nama}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {role === "admin" ? (
              <FieldDescription>Admin hanya dapat meminta dari gudang sendiri.</FieldDescription>
            ) : null}
          </Field>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">Item</h3>
            <ul className="flex flex-col gap-3" data-testid="daftar-baris-buat">
              {baris.map((b) => (
                <li key={b.key} className="flex flex-col gap-2 md:flex-row md:items-end">
                  <Field className="flex-1">
                    <FieldLabel htmlFor={`buat-produk-${b.key}`}>
                      Produk{baris.length > 1 ? " " + (baris.indexOf(b) + 1) : ""}
                    </FieldLabel>
                    <Combobox
                      id={`buat-produk-${b.key}`}
                      value={b.kode === "" ? null : b.kode}
                      onChange={(v) => ubah(b.key, { kode: v ?? "" })}
                      items={opsiProduk}
                      placeholder="Cari produk..."
                      kosongTeks="Produk tidak ditemukan"
                      disabled={mengirim}
                      data-testid={`pilih-produk-buat-${b.key}`}
                    />
                  </Field>

                  <Field className="md:w-32">
                    <FieldLabel htmlFor={`buat-qty-${b.key}`}>Qty</FieldLabel>
                    <Input
                      id={`buat-qty-${b.key}`}
                      inputMode="numeric"
                      autoComplete="off"
                      value={b.qty}
                      disabled={mengirim}
                      placeholder="0"
                      className="h-11 md:h-8"
                      data-testid={`qty-buat-${b.key}`}
                      onChange={(e) => ubah(b.key, { qty: e.target.value })}
                    />
                  </Field>

                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-sm"
                    className="size-11 md:size-8"
                    disabled={mengirim || baris.length <= 1}
                    aria-label="Hapus baris"
                    data-testid={`hapus-baris-buat-${b.key}`}
                    onClick={() => hapus(b.key)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            <div>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 md:h-8"
                disabled={mengirim}
                data-testid="tambah-baris-buat"
                onClick={tambah}
              >
                <Plus data-icon="inline-start" />
                Tambah Baris
              </Button>
            </div>
          </div>

          <fieldset className="flex flex-col gap-2" data-testid="pilih-tujuan">
            <legend className="mb-1.5 text-sm font-medium">Kirim ke</legend>
            <p className="text-xs text-muted-foreground">Pilih satu atau lebih gudang tujuan.</p>
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
              {gudangTujuanTersedia.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada gudang tujuan selain gudang asal.
                </p>
              ) : (
                gudangTujuanTersedia.map((g) => {
                  const dipilih = tujuan.some((t) => t.gudangId === g.gudang_id)
                  return (
                    <label
                      key={g.gudang_id}
                      htmlFor={`tujuan-gudang-${g.gudang_id}`}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted/50 md:min-h-8"
                    >
                      <input
                        id={`tujuan-gudang-${g.gudang_id}`}
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={dipilih}
                        disabled={mengirim}
                        data-testid={`tujuan-gudang-${g.gudang_id}`}
                        onChange={() => pilihGudangTujuan(g.gudang_id)}
                      />
                      <span className="min-w-0 flex-1 truncate">{g.nama}</span>
                    </label>
                  )
                })
              )}
            </div>
          </fieldset>

          {tujuan.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Detail per gudang tujuan</h3>
              <ul className="flex flex-col gap-3" data-testid="daftar-tujuan-buat">
                {tujuan.map((t) => {
                  const g = gudang.find((x) => x.gudang_id === t.gudangId)
                  const opsiPenerima = users
                    .filter((u) => u.gudang_id === t.gudangId)
                    .map((u) => ({
                      value: u.telegram_user_id,
                      label: u.jabatan
                        ? (u.name ?? u.telegram_user_id) + " (" + u.jabatan + ")"
                        : (u.name ?? u.telegram_user_id),
                    }))
                  return (
                    <li
                      key={t.key}
                      className="flex flex-col gap-3 rounded-lg border border-border p-3"
                      data-testid={`blok-tujuan-${t.gudangId}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{g?.nama ?? t.gudangId}</span>
                        <Badge variant="outline" className="text-[0.7rem]">
                          Gudang
                        </Badge>
                      </div>

                      <Field>
                        <FieldLabel htmlFor={`penerima-tujuan-${t.key}`}>
                          User penerima (opsional)
                        </FieldLabel>
                        <Combobox
                          id={`penerima-tujuan-${t.key}`}
                          value={t.penerimaId}
                          onChange={(v) => ubahTujuan(t.key, { penerimaId: v })}
                          items={opsiPenerima}
                          placeholder="Cari user di gudang ini..."
                          kosongTeks="Tidak ada user di gudang ini"
                          disabled={mengirim}
                          data-testid={`penerima-tujuan-${t.key}`}
                        />
                        <FieldDescription>
                          Kosong berarti owner gudang tujuan yang menyetujui.
                        </FieldDescription>
                      </Field>

                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Qty per item untuk gudang ini
                        </p>
                        {barisTerisi.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Isi item dulu pada bagian Item.
                          </p>
                        ) : (
                          <ul className="flex flex-col gap-2">
                            {barisTerisi.map((b) => (
                              <li
                                key={b.key}
                                className="flex flex-col gap-1.5 md:flex-row md:items-end"
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-sm">
                                    {opsiProduk.find((p) => p.value === b.kode)?.label ?? b.kode}
                                  </span>
                                  <span className="text-xs text-muted-foreground">{b.kode}</span>
                                </div>
                                <Field className="md:w-32">
                                  <FieldLabel htmlFor={`qty-tujuan-${t.key}-${b.key}`}>
                                    Qty
                                  </FieldLabel>
                                  <Input
                                    id={`qty-tujuan-${t.key}-${b.key}`}
                                    inputMode="numeric"
                                    autoComplete="off"
                                    value={t.qty[b.kode] ?? ""}
                                    disabled={mengirim}
                                    placeholder={b.qty.trim() === "" ? "0" : b.qty}
                                    className="h-11 md:h-8"
                                    data-testid={`qty-tujuan-${t.gudangId}-${b.kode}`}
                                    onChange={(e) =>
                                      ubahTujuan(t.key, {
                                        qty: { ...t.qty, [b.kode]: e.target.value },
                                      })
                                    }
                                  />
                                </Field>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {error ? <FieldError data-testid="error-buat-permintaan">{error}</FieldError> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="batal-buat-permintaan"
              onClick={() => tutup(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              size="lg"
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="simpan-permintaan"
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Mengirim..." : "Buat Permintaan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Memuat() {
  return (
    <div className="flex flex-col gap-6" data-testid="loading-permintaan-gudang" aria-busy>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ))}
    </div>
  )
}

