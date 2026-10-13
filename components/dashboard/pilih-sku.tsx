"use client"

// components/dashboard/pilih-sku.tsx — Pemilih SKU: search + daftar + nama produk D1.
// Dipakai dialog import order supaya pemetaan SKU tidak perlu scroll dropdown panjang.
// Menampilkan SKU + nama_accurate (nama master stok), BUKAN nama Shopee.
import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "cn"

export type OpsiSku = { sku: string; nama: string; skor?: number }

interface Props {
  /** Semua kandidat (kandidat tebakan + seluruh master). */
  opsi: OpsiSku[]
  /** SKU terpilih ("" = belum). */
  nilai: string
  onPilih: (sku: string) => void
  placeholder?: string
  testId?: string
}

/** Skor cocok sederhana: awalan > kata di tengah > substring. */
function skorCocok(q: string, o: OpsiSku): number {
  const kueri = q.toLowerCase()
  const sku = o.sku.toLowerCase()
  const nama = o.nama.toLowerCase()
  if (sku === kueri) return 1000
  if (sku.startsWith(kueri)) return 900 - sku.length
  if (nama.startsWith(kueri)) return 800
  if (sku.includes(kueri)) return 700
  if (nama.includes(kueri)) return 600
  // cocok per kata (mis. "piring rotan" vs "Piring Plastik Rotan Bunga")
  const kata = kueri.split(/\s+/).filter(Boolean)
  if (kata.length > 1 && kata.every((k) => nama.includes(k))) return 500
  return -1
}

export function PilihSku({ opsi, nilai, onPilih, placeholder = "Cari SKU atau nama produk…", testId }: Props) {
  const [buka, setBuka] = useState(false)
  const [cari, setCari] = useState("")
  const kotakRef = useRef<HTMLDivElement>(null)

  // Tutup saat klik di luar / Esc.
  useEffect(() => {
    function luar(e: MouseEvent) {
      if (kotakRef.current && !kotakRef.current.contains(e.target as Node)) setBuka(false)
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setBuka(false)
    }
    document.addEventListener("mousedown", luar)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", luar)
      document.removeEventListener("keydown", esc)
    }
  }, [])

  const terpilih = opsi.find((o) => o.sku === nilai)

  const hasil = useMemo(() => {
    const q = cari.trim()
    if (!q) {
      // Tanpa kueri: kandidat tebakan dulu (punya skor), lalu master.
      const berskor = opsi.filter((o) => o.skor !== undefined).sort((a, b) => (b.skor ?? 0) - (a.skor ?? 0))
      const sisa = opsi.filter((o) => o.skor === undefined)
      return [...berskor, ...sisa].slice(0, 60)
    }
    return opsi
      .map((o) => ({ o, s: skorCocok(q, o) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.o.sku.localeCompare(b.o.sku))
      .slice(0, 60)
      .map((x) => x.o)
  }, [cari, opsi])

  return (
    <div className="relative" ref={kotakRef}>
      <button
        type="button"
        className={cn(
          "flex h-9 w-full min-w-56 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2 text-left text-sm",
          "hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
        onClick={() => setBuka((b) => !b)}
        data-testid={testId}
      >
        {terpilih ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium tabular-nums">{terpilih.sku}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{terpilih.nama || "—"}</span>
          </span>
        ) : (
          <span className="truncate text-muted-foreground">{placeholder}</span>
        )}
        <Search className="size-4 shrink-0 opacity-60" aria-hidden />
      </button>

      {buka && (
        <div className="absolute z-50 mt-1 w-[min(30rem,90vw)] rounded-md border border-border bg-popover p-2 shadow-md">
          <Input
            autoFocus
            className="h-9"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari SKU atau nama produk…"
            data-testid={testId ? `${testId}-cari` : undefined}
          />
          <ul className="mt-2 max-h-72 overflow-y-auto" role="listbox">
            {hasil.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">Tak ada SKU yang cocok.</li>
            )}
            {hasil.map((o) => (
              <li key={o.sku}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.sku === nilai}
                  className={cn(
                    "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm",
                    o.sku === nilai ? "bg-accent" : "hover:bg-accent/60"
                  )}
                  onClick={() => {
                    onPilih(o.sku)
                    setBuka(false)
                    setCari("")
                  }}
                  data-testid={testId ? `${testId}-opsi-${o.sku}` : undefined}
                >
                  <Check className={cn("mt-0.5 size-4 shrink-0", o.sku === nilai ? "opacity-100" : "opacity-0")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium tabular-nums">
                      {o.sku}
                      {o.skor !== undefined && o.skor >= 0 && o.skor < 1 && (
                        <span className="ml-1 text-[11px] text-muted-foreground">{Math.round(o.skor * 100)}%</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{o.nama || "—"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
