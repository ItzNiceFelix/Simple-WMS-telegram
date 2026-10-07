"use client"

// H11 Opname Gudang (v5 F7) - owner + admin.
// Form opname: pilih gudang, pilih produk, isi qty fisik (qty_sistem ditampilkan di sebelahnya).
// Selisih 0 semua -> server langsung `disetujui`; ada selisih -> `menunggu_approval` (owner
// menyetujui/menolak dari daftar di bawah).
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { ClipboardCheck, Plus, Trash2, TriangleAlert } from "lucide-react"

import { PageHeader } from "@/components/dashboard/page-header"
import { ButuhAkses } from "@/components/dashboard/butuh-akses"
import { AksiOpname } from "@/components/dashboard/aksi-opname"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatAngka, formatDelta, formatTanggal } from "@/lib/dashboard/format"
import { useData, useRole } from "@/lib/dashboard/sumber-data"
import type { GudangDoc, OpnameGudangDoc, OpnameGudangStatus, StockRow } from "@/lib/dashboard/types"

/** Satu baris input opname. `qtyFisik` = teks mentah supaya field kosong bisa dibedakan dari 0. */
interface BarisInput {
  key: number
  kode: string
  qtyFisik: string
}

const LABEL_STATUS: Record<OpnameGudangStatus, string> = {
  menunggu_approval: "Menunggu persetujuan",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
}

export default function HalamanOpnameGudang() {
  return (
    <ButuhAkses href="/opname-gudang">
      <OpnameGudang />
    </ButuhAkses>
  )
}

function OpnameGudang() {
  const data = useData()
  const role = useRole()
  const bolehSetujui = role === "owner"

  const [gudang, setGudang] = useState<GudangDoc[] | null>(null)
  const [produk, setProduk] = useState<StockRow[] | null>(null)
  const [daftar, setDaftar] = useState<OpnameGudangDoc[] | null>(null)
  const [error, setError] = useState(false)

  const [gudangId, setGudangId] = useState<string>("")
  const [baris, setBaris] = useState<BarisInput[]>([{ key: 1, kode: "", qtyFisik: "" }])
  const [errorForm, setErrorForm] = useState<string | null>(null)
  const [mengirim, setMengirim] = useState(false)

  const muat = useCallback(async () => {
    setError(false)
    setGudang(null)
    setProduk(null)
    setDaftar(null)
    try {
      const [g, p, o] = await Promise.all([
        data.listGudang(),
        data.listStock({ is_online: "semua", gudang_id: null }),
        data.listOpnameGudang(),
      ])
      setGudang(g)
      setProduk(p)
      setDaftar(o)
    } catch {
      setError(true)
    }
  }, [data])

  useEffect(() => {
    void muat()
  }, [muat])

  // Gudang pertama otomatis terpilih supaya form langsung bisa dipakai.
  useEffect(() => {
    if (gudang && gudang.length > 0 && gudangId === "") setGudangId(gudang[0].gudang_id)
  }, [gudang, gudangId])

  const namaGudang = useMemo(() => new Map((gudang ?? []).map((g) => [g.gudang_id, g.nama])), [gudang])
  const stokMap = useMemo(() => new Map((produk ?? []).map((p) => [p.kode_barang, p])), [produk])
  const menunggu = (daftar ?? []).filter((o) => o.status === "menunggu_approval")

  /** qty sistem untuk kode + gudang terpilih; null bila produk tanpa key gudang itu. */
  function qtySistem(kode: string): number | null {
    const p = stokMap.get(kode)
    if (!p || !gudangId) return null
    return Object.prototype.hasOwnProperty.call(p.qty_per_gudang, gudangId)
      ? p.qty_per_gudang[gudangId]
      : null
  }

  function tambahBaris() {
    setBaris((b) => [...b, { key: Date.now(), kode: "", qtyFisik: "" }])
  }

  function hapusBaris(key: number) {
    setBaris((b) => (b.length <= 1 ? b : b.filter((x) => x.key !== key)))
  }

  function ubahBaris(key: number, patch: Partial<BarisInput>) {
    setBaris((b) => b.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  }

  async function kirim() {
    if (!gudangId) {
      setErrorForm("Pilih gudang dulu.")
      return
    }
    const terisi = baris.filter((b) => b.kode !== "" || b.qtyFisik.trim() !== "")
    if (terisi.length === 0) {
      setErrorForm("Opname belum berisi item.")
      return
    }
    const items: { kode_barang: string; qty_fisik: number }[] = []
    const lihat = new Set<string>()
    for (const b of terisi) {
      if (b.kode === "") {
        setErrorForm("Pilih produk untuk setiap baris.")
        return
      }
      if (lihat.has(b.kode)) {
        setErrorForm("Item duplikat dalam opname.")
        return
      }
      lihat.add(b.kode)
      const teks = b.qtyFisik.trim()
      if (teks === "" || !/^\d+$/.test(teks)) {
        setErrorForm("Jumlah fisik harus bilangan bulat >= 0.")
        return
      }
      items.push({ kode_barang: b.kode, qty_fisik: Number(teks) })
    }
    setErrorForm(null)
    setMengirim(true)
    try {
      const res = await data.buatOpnameGudang({ gudang_id: gudangId, items })
      if (res.ok) {
        if (res.langsung) {
          toast.success("Opname selesai. Semua selisih 0, stok sudah disesuaikan.")
        } else {
          toast.success("Opname dikirim. Menunggu persetujuan owner.")
        }
        setBaris([{ key: Date.now(), kode: "", qtyFisik: "" }])
        await muat()
      } else {
        setErrorForm(res.error)
      }
    } catch {
      toast.error("Gagal mengirim opname. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  const sedangMemuat = gudang === null || produk === null || daftar === null

  return (
    <>
      <PageHeader
        judul="Opname"
        deskripsi="Hitung stok fisik per gudang. Selisih akan menunggu persetujuan owner."
      />

      <div className="flex flex-col gap-6" data-testid="h11-opname-gudang">
        {error ? (
          <Alert variant="destructive" data-testid="error-opname-gudang">
            <TriangleAlert aria-hidden />
            <AlertTitle>Gagal memuat data opname.</AlertTitle>
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
          <Empty className="border border-dashed" data-testid="empty-gudang-opname">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardCheck aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Belum ada gudang aktif.</EmptyTitle>
              <EmptyDescription>
                Minta owner menambahkan lokasi gudang sebelum melakukan opname.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <section
              className="flex flex-col gap-3"
              aria-labelledby="opname-baru-judul"
              data-testid="seksi-opname-baru"
            >
              <div className="min-w-0">
                <h2 id="opname-baru-judul" className="text-base font-semibold">
                  Opname Baru
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Masukkan jumlah fisik hasil hitung. Qty sistem ditampilkan sebagai pembanding.
                </p>
              </div>

              <Card>
                <CardContent className="flex flex-col gap-4">
                  <Field className="md:max-w-xs">
                    <FieldLabel htmlFor="pilih-gudang-opname">Gudang</FieldLabel>
                    <Select
                      value={gudangId}
                      onValueChange={(v) => {
                        if (typeof v === "string") setGudangId(v)
                      }}
                      disabled={mengirim}
                    >
                      <SelectTrigger
                        id="pilih-gudang-opname"
                        className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                        data-testid="pilih-gudang-opname"
                      >
                        <SelectValue>
                          {(v: string | null) =>
                            v ? (gudang.find((g) => g.gudang_id === v)?.nama ?? v) : "Pilih gudang"
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
                  </Field>

                  <ul className="flex flex-col gap-3" data-testid="daftar-baris-opname">
                    {baris.map((b) => {
                      const qs = b.kode ? qtySistem(b.kode) : null
                      return (
                        <li key={b.key} className="flex flex-col gap-2 md:flex-row md:items-end">
                          <Field className="flex-1">
                            <FieldLabel htmlFor={`produk-${b.key}`}>
                              Produk{baris.length > 1 ? ` ${baris.indexOf(b) + 1}` : ""}
                            </FieldLabel>
                            <Select
                              value={b.kode === "" ? undefined : b.kode}
                              onValueChange={(v) => {
                                if (typeof v === "string") ubahBaris(b.key, { kode: v })
                              }}
                              disabled={mengirim}
                            >
                              <SelectTrigger
                                id={`produk-${b.key}`}
                                className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
                                data-testid={`pilih-produk-opname-${b.key}`}
                              >
                                <SelectValue>
                                  {(v: string | null) =>
                                    v ? (stokMap.get(v)?.nama_accurate ?? v) : "Pilih produk"
                                  }
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {produk.map((p) => (
                                    <SelectItem key={p.kode_barang} value={p.kode_barang}>
                                      {p.nama_accurate ?? p.kode_barang}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </Field>

                          <Field className="md:w-40">
                            <FieldLabel htmlFor={`qty-${b.key}`}>Qty fisik</FieldLabel>
                            <Input
                              id={`qty-${b.key}`}
                              inputMode="numeric"
                              autoComplete="off"
                              value={b.qtyFisik}
                              disabled={mengirim}
                              placeholder="0"
                              className="h-11 md:h-8"
                              data-testid={`qty-fisik-opname-${b.key}`}
                              onChange={(e) => ubahBaris(b.key, { qtyFisik: e.target.value })}
                            />
                          </Field>

                          <div className="flex items-center gap-2 md:pb-1.5">
                            <span
                              className="text-sm text-muted-foreground tabular-nums"
                              data-testid={`qty-sistem-opname-${b.key}`}
                            >
                              Sistem: {b.kode ? formatAngka(qs) : "—"}
                            </span>
                            {b.kode && qs !== null && /^\d+$/.test(b.qtyFisik.trim()) ? (
                              <Badge
                                variant={
                                  Number(b.qtyFisik) - qs === 0 ? "outline" : "secondary"
                                }
                              >
                                {formatDelta(Number(b.qtyFisik) - qs)}
                              </Badge>
                            ) : null}
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon-sm"
                              className="size-11 md:size-8"
                              disabled={mengirim || baris.length <= 1}
                              aria-label="Hapus baris"
                              data-testid={`hapus-baris-opname-${b.key}`}
                              onClick={() => hapusBaris(b.key)}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>

                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="h-11 md:h-8"
                      disabled={mengirim}
                      data-testid="tambah-baris-opname"
                      onClick={tambahBaris}
                    >
                      <Plus data-icon="inline-start" />
                      Tambah Baris
                    </Button>
                  </div>

                  {errorForm ? (
                    <FieldError data-testid="error-form-opname">{errorForm}</FieldError>
                  ) : null}

                  <div>
                    <Button
                      size="lg"
                      className="h-11 md:h-8"
                      disabled={mengirim}
                      data-testid="kirim-opname"
                      onClick={() => void kirim()}
                    >
                      {mengirim ? <Spinner data-icon="inline-start" /> : null}
                      {mengirim ? "Mengirim..." : "Kirim Opname"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section
              className="flex flex-col gap-3"
              aria-labelledby="opname-menunggu-judul"
              data-testid="seksi-opname-menunggu"
            >
              <div className="min-w-0">
                <h2 id="opname-menunggu-judul" className="text-base font-semibold">
                  Menunggu Persetujuan
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {menunggu.length}
                  </span>
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {bolehSetujui
                    ? "Opname dengan selisih perlu disetujui owner sebelum stok berubah."
                    : "Opname dengan selisih menunggu persetujuan owner."}
                </p>
              </div>

              {menunggu.length === 0 ? (
                <Empty className="border border-dashed" data-testid="empty-opname-menunggu">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ClipboardCheck aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>Tidak ada opname menunggu persetujuan.</EmptyTitle>
                    <EmptyDescription>
                      Opname dengan selisih akan tampil di sini untuk disetujui owner.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="flex flex-col gap-3" data-testid="daftar-opname-menunggu">
                  {menunggu.map((o) => (
                    <li key={o.id}>
                      <Card size="sm" data-testid={`kartu-opname-${o.id}`}>
                        <CardHeader>
                          <CardTitle className="flex flex-wrap items-center gap-2">
                            <span>{namaGudang.get(o.gudang_id) ?? o.gudang_id}</span>
                            <Badge variant="secondary">{LABEL_STATUS[o.status]}</Badge>
                          </CardTitle>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {o.items.length} item · Dibuat {formatTanggal(o.created_at)} · Oleh{" "}
                            {o.created_by}
                          </p>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Kode</TableHead>
                                <TableHead className="text-right">Sistem</TableHead>
                                <TableHead className="text-right">Fisik</TableHead>
                                <TableHead className="text-right">Selisih</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {o.items.map((it) => (
                                <TableRow key={it.kode_barang}>
                                  <TableCell className="font-medium">
                                    {it.kode_barang}
                                    {it.belum_terdaftar ? (
                                      <Badge variant="outline" className="ml-2">
                                        Belum terdaftar
                                      </Badge>
                                    ) : null}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatAngka(it.qty_sistem)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatAngka(it.qty_fisik)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatDelta(it.selisih)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>

                          {bolehSetujui ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              <AksiOpname opname={o} jenis="setujui" onSukses={() => void muat()} />
                              <AksiOpname opname={o} jenis="tolak" onSukses={() => void muat()} />
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">Hanya owner yang dapat menyetujui opname.</p>
                          )}
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              className="flex flex-col gap-3"
              aria-labelledby="opname-riwayat-judul"
              data-testid="seksi-opname-riwayat"
            >
              <div className="min-w-0">
                <h2 id="opname-riwayat-judul" className="text-base font-semibold">
                  Riwayat Opname
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Opname yang sudah diproses.
                </p>
              </div>

              {(daftar ?? []).filter((o) => o.status !== "menunggu_approval").length === 0 ? (
                <Empty className="border border-dashed" data-testid="empty-opname-riwayat">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ClipboardCheck aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>Belum ada riwayat opname.</EmptyTitle>
                    <EmptyDescription>
                      Opname yang sudah disetujui atau ditolak akan tampil di sini.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="flex flex-col" data-testid="daftar-opname-riwayat">
                  {(daftar ?? [])
                    .filter((o) => o.status !== "menunggu_approval")
                    .map((o, i) => (
                      <li key={o.id} data-testid={`riwayat-opname-${o.id}`}>
                        {i > 0 ? <Separator /> : null}
                        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {namaGudang.get(o.gudang_id) ?? o.gudang_id}
                            </p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {o.items.length} item · {formatTanggal(o.created_at)}
                            </p>
                          </div>
                          <Badge variant={o.status === "disetujui" ? "secondary" : "outline"}>
                            {LABEL_STATUS[o.status]}
                          </Badge>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  )
}

function Memuat() {
  return (
    <div className="flex flex-col gap-6" data-testid="loading-opname-gudang" aria-busy>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ))}
    </div>
  )
}