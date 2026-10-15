"use client"

// Dialog Kekurangan Stok (bahan /stok).
// Menampilkan hasil `listKekurangan()` — kekurangan dihitung server dari order yang sudah
// memotong stok vs stok ONLINE sekarang, jadi angkanya selalu ikut keadaan terkini.
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TriangleAlert } from "lucide-react"
import { formatAngka } from "@/lib/dashboard/format"
import type { AlasanKekurangan, BarisKekurangan } from "@/lib/dashboard/types"

/** Satu baris yang dicentang user, siap dikirim ke /permintaan-gudang. */
export interface PilihanKekurangan {
  kode: string
  qty: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  baris: BarisKekurangan[]
  onBuatPermintaan: (pilihan: PilihanKekurangan[]) => void
}

const LABEL_ALASAN: Record<AlasanKekurangan, string> = {
  order: "Kurang untuk order",
  menipis: "Stok menipis",
  keduanya: "Kurang + menipis",
}

export function DialogKekuranganStok({ open, onOpenChange, baris, onBuatPermintaan }: Props) {
  // Default: SEMUA baris tercentang — user biasanya memang mau meminta seluruh kekurangan,
  // dan mencentang satu-satu tiap kali justru menambah kerja tanpa menambah keamanan.
  const [dipilih, setDipilih] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setDipilih(new Set(baris.map((b) => b.sku)))
  }, [open, baris])

  const jumlahDipilih = baris.filter((b) => dipilih.has(b.sku)).length
  const semuaTerpilih = baris.length > 0 && jumlahDipilih === baris.length
  const sebagianTerpilih = jumlahDipilih > 0 && !semuaTerpilih
  const totalKurang = baris.reduce((n, b) => (dipilih.has(b.sku) ? n + b.kurang : n), 0)

  function toggle(sku: string) {
    setDipilih((lama) => {
      const baru = new Set(lama)
      if (baru.has(sku)) baru.delete(sku)
      else baru.add(sku)
      return baru
    })
  }

  function toggleSemua() {
    setDipilih(semuaTerpilih ? new Set() : new Set(baris.map((b) => b.sku)))
  }

  function kirim() {
    const terpilih = baris
      .filter((b) => dipilih.has(b.sku))
      .map((b) => ({ kode: b.sku, qty: b.kurang }))
    onBuatPermintaan(terpilih)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" data-testid="dialog-kekurangan-stok">
        <DialogHeader>
          <DialogTitle>Kekurangan Stok</DialogTitle>
          <DialogDescription>
            Produk online yang stoknya tidak cukup untuk order berjalan atau sudah di bawah stok
            minimum. Centang yang ingin diminta ke gudang lain.
          </DialogDescription>
        </DialogHeader>

        {baris.length === 0 ? (
          <Empty data-testid="kekurangan-kosong">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TriangleAlert />
              </EmptyMedia>
              <EmptyTitle>Tidak ada kekurangan stok</EmptyTitle>
              <EmptyDescription>Semua produk online masih cukup.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      className="size-5 accent-primary align-middle"
                      aria-label="Pilih semua kekurangan"
                      data-testid="pilih-semua-kekurangan"
                      checked={semuaTerpilih}
                      ref={(el) => {
                        if (el) el.indeterminate = sebagianTerpilih
                      }}
                      onChange={toggleSemua}
                    />
                  </TableHead>
                  <TableHead>Nama Produk</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Kebutuhan</TableHead>
                  <TableHead className="text-right">Kurang</TableHead>
                  <TableHead>Alasan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {baris.map((b) => {
                  // stok <= 0 -> tidak bisa dikirim sama sekali (merah); masih ada stok tapi
                  // kurang -> peringatan (amber). Dua tingkat ini yang membedakan "kritis" dari
                  // "perlu restock".
                  const kritis = b.stok <= 0
                  return (
                    <TableRow
                      key={b.sku}
                      data-testid={`kekurangan-baris-${b.sku}`}
                      className={kritis ? "text-destructive" : "text-amber-600 dark:text-amber-500"}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          className="size-5 accent-primary align-middle"
                          aria-label={`Pilih ${b.sku}`}
                          data-testid={`pilih-kekurangan-${b.sku}`}
                          checked={dipilih.has(b.sku)}
                          onChange={() => toggle(b.sku)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{b.nama ?? b.sku}</TableCell>
                      <TableCell className="tabular-nums">{b.sku}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAngka(b.stok)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatAngka(b.butuh)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatAngka(b.kurang)}
                      </TableCell>
                      <TableCell>{LABEL_ALASAN[b.alasan]}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <span className="text-sm text-muted-foreground" data-testid="total-kurang-kekurangan">
            Total kurang: {formatAngka(totalKurang)} unit
          </span>
          <Button
            data-testid="buat-permintaan-dari-kekurangan"
            disabled={jumlahDipilih === 0}
            onClick={kirim}
          >
            Buat Permintaan ({jumlahDipilih})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
