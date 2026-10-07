"use client"

// components/dashboard/aksi-opname.tsx
// F7 keputusan opname (owner only): Setujui / Tolak, satu AlertDialog per keputusan.
// Pola `aksi-akses.tsx`: 401 -> dialog tetap terbuka (isian/konteks dipertahankan);
// 409/404 (baris basi: sudah diproses / tidak ditemukan) -> tutup + refetch.
import { useState } from "react"
import { toast } from "sonner"

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
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { useData } from "@/lib/dashboard/sumber-data"
import type { OpnameGudangDoc } from "@/lib/dashboard/types"

type Jenis = "setujui" | "tolak"

interface Props {
  opname: OpnameGudangDoc
  jenis: Jenis
  onSukses?: () => void
}

/** Baris basi: server bilang sudah diproses / tidak ada -> tutup dialog + refetch. */
function barisBasi(error: string): boolean {
  return error.includes("sudah diproses") || error.includes("tidak ditemukan")
}

export function AksiOpname({ opname, jenis, onSukses }: Props) {
  const data = useData()
  const [open, setOpen] = useState(false)
  const [mengirim, setMengirim] = useState(false)
  const setujui = jenis === "setujui"
  const selisih = opname.items.filter((i) => i.selisih !== 0).length

  async function kirim() {
    setMengirim(true)
    try {
      const res = setujui
        ? await data.setujuiOpnameGudang({ id: opname.id })
        : await data.tolakOpnameGudang({ id: opname.id })
      if (res.ok) {
        toast.success(setujui ? "Opname disetujui. Stok disesuaikan." : "Opname ditolak.")
        setOpen(false)
        onSukses?.()
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error)
        if (!kedaluwarsa && barisBasi(res.error)) {
          setOpen(false)
          onSukses?.()
        }
      }
    } catch {
      toast.error("Gagal memproses opname. Coba lagi.")
    } finally {
      setMengirim(false)
    }
  }

  return (
    <>
      <Button
        variant={setujui ? "default" : "outline"}
        size="sm"
        className="h-11 md:h-8"
        data-testid={`${setujui ? "setujui" : "tolak"}-opname-${opname.id}`}
        onClick={() => setOpen(true)}
      >
        {setujui ? "Setujui" : "Tolak"}
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!mengirim) setOpen(v)
        }}
      >
        <AlertDialogContent
          data-testid={setujui ? "dialog-setujui-opname" : "dialog-tolak-opname"}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {setujui ? "Setujui opname ini?" : "Tolak opname ini?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-1">
              <span className="tabular-nums">
                {opname.items.length} item · {selisih} selisih
              </span>
              <span>
                {setujui
                  ? "Stok gudang akan disesuaikan dengan jumlah fisik. Bila stok berubah sejak opname dibuat, persetujuan ditolak dan opname perlu dibuat ulang."
                  : "Opname ditolak dan stok tidak berubah. Tindakan ini tidak bisa dibatalkan."}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={`batal-${jenis}-opname`}
              onClick={() => setOpen(false)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid={`konfirmasi-${jenis}-opname-ok`}
              onClick={() => void kirim()}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Memproses..." : setujui ? "Ya, setujui" : "Ya, tolak"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}