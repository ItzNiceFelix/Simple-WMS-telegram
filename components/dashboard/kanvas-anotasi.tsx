"use client"

// components/dashboard/kanvas-anotasi.tsx — Komentar di titik/area gambar (rencana §4).
// Klik = titik, tahan-seret = lingkaran. Koordinat SELALU ternormalisasi 0–1
// supaya tak bergantung ukuran tampil (resize aman). Overlay SVG ber-skor devicePixelRatio.
import { useCallback, useEffect, useRef, useState } from "react"
import { Circle, MapPin, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AreaGambar } from "@/lib/ai/areaGambar"

interface Props {
  gambarBase64: string
  mime: string
  area: AreaGambar[]
  onTambahArea: (a: AreaGambar) => void
  onHapusArea: (index: number) => void
  /** Dipanggil tiap komentar area berubah (indeks, teks baru). */
  onUbahKomentar?: (index: number, komentar: string) => void
}

type Seret = { mulai: { x: number; y: number }; kini: { x: number; y: number } } | null

export function KanvasAnotasi({ gambarBase64, mime, area, onTambahArea, onHapusArea, onUbahKomentar }: Props) {
  const kotakRef = useRef<HTMLDivElement>(null)
  const [ukuran, setUkuran] = useState({ lebar: 0, tinggi: 0 })
  const [seret, setSeret] = useState<Seret>(null)
  const [dpr, setDpr] = useState(1)

  const ukur = useCallback(() => {
    const el = kotakRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setUkuran({ lebar: r.width, tinggi: r.height })
    setDpr(window.devicePixelRatio || 1)
  }, [])

  useEffect(() => {
    ukur()
    const ro = new ResizeObserver(ukur)
    if (kotakRef.current) ro.observe(kotakRef.current)
    window.addEventListener("resize", ukur)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", ukur)
    }
  }, [ukur])

  /** Titik ternormalisasi dari event pointer (0–1). */
  const keNormal = (e: React.PointerEvent): { x: number; y: number } | null => {
    const el = kotakRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    const jepit = (n: number) => Math.min(1, Math.max(0, n))
    return { x: jepit(x), y: jepit(y) }
  }

  function turun(e: React.PointerEvent) {
    const p = keNormal(e)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setSeret({ mulai: p, kini: p })
  }

  function gerak(e: React.PointerEvent) {
    if (!seret) return
    const p = keNormal(e)
    if (!p) return
    setSeret({ ...seret, kini: p })
  }

  function naik(e: React.PointerEvent) {
    if (!seret) return
    const p = keNormal(e) ?? seret.kini
    const dx = p.x - seret.mulai.x
    const dy = p.y - seret.mulai.y
    const jarak = Math.sqrt(dx * dx + dy * dy)
    // Ambang 2%: klik biasa jangan jadi lingkaran mungil tak sengaja.
    if (jarak < 0.02) {
      onTambahArea({ jenis: "titik", pusat: seret.mulai, komentar: "" })
    } else {
      const pusat = { x: (seret.mulai.x + p.x) / 2, y: (seret.mulai.y + p.y) / 2 }
      onTambahArea({ jenis: "lingkaran", pusat, radius: jarak / 2, komentar: "" })
    }
    setSeret(null)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const lebar = ukuran.lebar
  const tinggi = ukuran.tinggi

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={kotakRef}
        className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-lg border border-border bg-muted select-none"
        onPointerDown={turun}
        onPointerMove={gerak}
        onPointerUp={naik}
        onPointerCancel={() => setSeret(null)}
        data-testid="kanvas-anotasi"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- gambar base64 di memori, bukan aset Next */}
        <img
          src={`data:${mime};base64,${gambarBase64}`}
          alt="Pratinjau gambar yang bisa dianotasi"
          className="block w-full"
          draggable={false}
        />
        {lebar > 0 && tinggi > 0 && (
          <svg
            className="pointer-events-none absolute inset-0 size-full"
            viewBox={`0 0 ${lebar * dpr} ${tinggi * dpr}`}
            width={lebar}
            height={tinggi}
            aria-hidden
          >
            {area.map((a, i) => {
              const cx = a.pusat.x * lebar * dpr
              const cy = a.pusat.y * tinggi * dpr
              const r = a.jenis === "lingkaran" ? (a.radius ?? 0) * Math.max(lebar, tinggi) * dpr : 10 * dpr
              return (
                <g key={i}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="rgba(59,130,246,0.18)"
                    stroke="#2563eb"
                    strokeWidth={2 * dpr}
                    strokeDasharray={a.jenis === "lingkaran" ? undefined : `${4 * dpr} ${3 * dpr}`}
                  />
                  <circle cx={cx} cy={cy} r={11 * dpr} fill="#2563eb" />
                  <text
                    x={cx}
                    y={cy + 4.5 * dpr}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={12 * dpr}
                    fontWeight={700}
                  >
                    {i + 1}
                  </text>
                </g>
              )
            })}
            {seret && (
              <circle
                cx={((seret.mulai.x + seret.kini.x) / 2) * lebar * dpr}
                cy={((seret.mulai.y + seret.kini.y) / 2) * tinggi * dpr}
                r={
                  (Math.sqrt((seret.kini.x - seret.mulai.x) ** 2 + (seret.kini.y - seret.mulai.y) ** 2) / 2) *
                  Math.max(lebar, tinggi) *
                  dpr
                }
                fill="rgba(37,99,235,0.12)"
                stroke="#2563eb"
                strokeWidth={2 * dpr}
              />
            )}
          </svg>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Klik untuk menandai titik · tahan dan seret untuk melingkari area. Tulis komentar per area di bawah.
      </p>

      {area.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="anotasi-kosong">
          Belum ada area ditandai.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="daftar-anotasi">
          {area.map((a, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                {i + 1}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {a.jenis === "lingkaran" ? <Circle aria-hidden className="size-3.5" /> : <MapPin aria-hidden className="size-3.5" />}
                {a.jenis === "lingkaran" ? "area" : "titik"}
              </span>
              <Input
                className="h-11 min-w-0 flex-1 md:h-8"
                value={a.komentar}
                placeholder="mis. bayangan terlalu keras"
                onChange={(e) => onUbahKomentar?.(i, e.target.value)}
                data-testid={`komentar-area-${i}`}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 md:size-8"
                aria-label={`Hapus area ${i + 1}`}
                onClick={() => onHapusArea(i)}
                data-testid={`hapus-area-${i}`}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
