"use client"

// components/dashboard/editor-panel-properti.tsx — Panel properti objek terpilih (rencana §Editor Fase 2).
// Panel ini TIDAK meng-import fabric (biar bundel kanvas tetap satu titik muat): ia menerima
// data polos + callback, lalu editor-desain.tsx yang menerjemahkannya ke instance fabric.
import { useEffect, useState } from "react"
import type { ChangeEvent, ReactNode } from "react"
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/** Jenis objek yang dikenali panel. "lain" = shape lain (Polygon/Path) → hanya transform. */
export type JenisProperti = "teks" | "gambar" | "bentuk" | "garis" | "lain"

/** Proyeksi polos objek fabric → struktur yang dipakai panel. */
export type NilaiProperti = {
  /** Identitas objek di kanvas; panel memakainya untuk mereset draft input saat seleksi berganti. */
  id: string
  jenis: JenisProperti
  kiri: number
  atas: number
  lebar: number
  tinggi: number
  sudut: number
  teks: string
  fontFamily: string
  fontSize: number
  tebal: boolean
  miring: boolean
  garisBawah: boolean
  warnaIsi: string
  warnaGaris: string
  tebalGaris: number
  perataan: "left" | "center" | "right"
  kunci: boolean
}

export type PerubahanProperti = Partial<
  Pick<
    NilaiProperti,
    | "kiri"
    | "atas"
    | "lebar"
    | "tinggi"
    | "sudut"
    | "teks"
    | "fontFamily"
    | "fontSize"
    | "tebal"
    | "miring"
    | "garisBawah"
    | "warnaIsi"
    | "warnaGaris"
    | "tebalGaris"
    | "perataan"
  >
>

/** Font aman lintas sistem; dikirim sebagai string mentah ke fabric (bukan CSS var). */
const FONT = [
  { id: "Arial", label: "Arial / Helvetica" },
  { id: "Georgia", label: "Georgia / serif" },
  { id: "Courier New", label: "Courier / monospace" },
] as const

const PERATAAN = [
  { id: "left", label: "Kiri" },
  { id: "center", label: "Tengah" },
  { id: "right", label: "Kanan" },
] as const

/** Penanda kolom label supaya form ringkas dan tetap terbaca. */
function Baris({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  )
}

/** Kunci numerik yang bisa diubah lewat input angka (transform objek). */
type KolomAngka = "kiri" | "atas" | "lebar" | "tinggi" | "sudut"

type Props = {
  objek: NilaiProperti | null
  /** Dipanggil tiap kontrol berubah; editor menerapkan ke instance fabric. */
  onUbah: (p: PerubahanProperti) => void
  onHapus: () => void
  /** Naik/turun satu langkah tumpukan; null = sudah di ujung tumpukan. */
  onNaikLapisan: () => void
  onTurunLapisan: () => void
}

export function EditorPanelProperti({ objek, onUbah, onHapus, onNaikLapisan, onTurunLapisan }: Props) {
  // Input angka butuh teks bebas sementara (user mengetik "-" atau kosong dulu).
  // Reset HANYA saat objek terpilih berganti id — bukan tiap re-render (objek baru dari
  // event object:modified), kalau tidak ketikan user terhapus di tengah jalan.
  const idObjek = objek?.id ?? null
  const [draft, setDraft] = useState<Record<string, string>>({})
  useEffect(() => setDraft({}), [idObjek])

  if (!objek) {
    return (
      <aside
        className="text-muted-foreground flex h-full min-h-40 items-center justify-center rounded-md border border-dashed p-4 text-center text-sm"
        data-testid="panel-properti-kosong"
      >
        Pilih objek untuk mengubah propertinya
      </aside>
    )
  }

  const angka = (kunci: KolomAngka, nilai: number) => ({
    value: draft[kunci] ?? String(Math.round(nilai * 100) / 100),
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setDraft((d) => ({ ...d, [kunci]: e.target.value }))
      const n = Number(e.target.value)
      // Nilai kosong/NaN jangan dikirim: fabric akan menjatuhkan objek ke NaN dan hilang.
      if (e.target.value.trim() !== "" && Number.isFinite(n)) onUbah({ [kunci]: n })
    },
    onBlur: () => setDraft((d) => {
      const next = { ...d }
      delete next[kunci]
      return next
    }),
  })

  return (
    <aside className="flex w-full flex-col gap-4 rounded-md border p-3" data-testid="panel-properti">
      <div className="flex items-center gap-1.5" data-testid="aksi-lapisan">
        <Button
          variant="outline"
          size="sm"
          onClick={onNaikLapisan}
          disabled={objek.kunci}
          data-testid="naik-lapisan"
        >
          <ArrowUp />
          Naik
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onTurunLapisan}
          disabled={objek.kunci}
          data-testid="turun-lapisan"
        >
          <ArrowDown />
          Turun
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="ml-auto"
          onClick={onHapus}
          data-testid="prop-hapus"
        >
          <Trash2 />
          Hapus
        </Button>
      </div>

      {objek.jenis === "teks" && (
        <>
          <Baris label="Isi teks">
            <textarea
              className="border-input min-h-20 w-full rounded-lg border bg-transparent p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={objek.teks}
              onChange={(e) => onUbah({ teks: e.target.value })}
              data-testid="prop-isi-teks"
            />
          </Baris>

          <Baris label="Font">
            <ToggleGroup
              variant="outline"
              value={[objek.fontFamily]}
              onValueChange={(v) => {
                // Group memakai array; klik ulang item aktif → array kosong, jangan apa-apa.
                if (v[0]) onUbah({ fontFamily: v[0] })
              }}
              aria-label="Font teks"
              data-testid="prop-font"
            >
              {FONT.map((f) => (
                <ToggleGroupItem
                  key={f.id}
                  value={f.id}
                  style={{ fontFamily: f.id }}
                  data-testid={`prop-font-${f.id}`}
                >
                  {f.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Baris>

          <Baris label="Ukuran font">
            <Input
              type="number"
              min={1}
              className="w-24"
              value={Math.round(objek.fontSize)}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n > 0) onUbah({ fontSize: n })
              }}
              data-testid="prop-ukuran-font"
            />
          </Baris>

          <Baris label="Gaya">
            <ToggleGroup
              variant="outline"
              value={[
                ...(objek.tebal ? ["tebal"] : []),
                ...(objek.miring ? ["miring"] : []),
                ...(objek.garisBawah ? ["garis-bawah"] : []),
              ]}
              onValueChange={(v) =>
                onUbah({
                  tebal: v.includes("tebal"),
                  miring: v.includes("miring"),
                  garisBawah: v.includes("garis-bawah"),
                })
              }
              aria-label="Gaya teks"
            >
              <ToggleGroupItem value="tebal" className="font-bold" data-testid="prop-tebal">
                B
              </ToggleGroupItem>
              <ToggleGroupItem value="miring" className="italic" data-testid="prop-miring">
                I
              </ToggleGroupItem>
              <ToggleGroupItem value="garis-bawah" className="underline" data-testid="prop-garis-bawah">
                U
              </ToggleGroupItem>
            </ToggleGroup>
          </Baris>

          <Baris label="Perataan">
            <ToggleGroup
              variant="outline"
              value={[objek.perataan]}
              onValueChange={(v) => {
                if (v[0]) onUbah({ perataan: v[0] as "left" | "center" | "right" })
              }}
              aria-label="Perataan teks"
            >
              {PERATAAN.map((p) => (
                <ToggleGroupItem key={p.id} value={p.id} data-testid={`prop-perataan-${p.id}`}>
                  {p.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Baris>
        </>
      )}

      {/* Warna isi hanya untuk teks/bentuk; garis & gambar tak punya isi bermakna. */}
      {(objek.jenis === "teks" || objek.jenis === "bentuk") && (
        <Baris label="Warna isi">
          <input
            type="color"
            className="h-8 w-16 cursor-pointer rounded border bg-transparent"
            value={objek.warnaIsi}
            onChange={(e) => onUbah({ warnaIsi: e.target.value })}
            data-testid="prop-warna"
          />
        </Baris>
      )}

      {(objek.jenis === "bentuk" || objek.jenis === "garis") && (
        <>
          <Baris label="Warna garis">
            <input
              type="color"
              className="h-8 w-16 cursor-pointer rounded border bg-transparent"
              value={objek.warnaGaris}
              onChange={(e) => onUbah({ warnaGaris: e.target.value })}
              data-testid="prop-warna-garis"
            />
          </Baris>
          <Baris label="Tebal garis">
            <Input
              type="number"
              min={0}
              className="w-24"
              value={Math.round(objek.tebalGaris)}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n >= 0) onUbah({ tebalGaris: n })
              }}
              data-testid="prop-tebal-garis"
            />
          </Baris>
        </>
      )}

      <div className="grid grid-cols-2 gap-3" data-testid="prop-transform">
        <Baris label="X">
          <Input type="number" inputMode="decimal" data-testid="prop-x" {...angka("kiri", objek.kiri)} />
        </Baris>
        <Baris label="Y">
          <Input type="number" inputMode="decimal" data-testid="prop-y" {...angka("atas", objek.atas)} />
        </Baris>
        <Baris label="Lebar">
          <Input type="number" inputMode="decimal" data-testid="prop-lebar" {...angka("lebar", objek.lebar)} />
        </Baris>
        <Baris label="Tinggi">
          <Input type="number" inputMode="decimal" data-testid="prop-tinggi" {...angka("tinggi", objek.tinggi)} />
        </Baris>
        <Baris label="Rotasi (°)">
          <Input type="number" inputMode="decimal" data-testid="prop-rotasi" {...angka("sudut", objek.sudut)} />
        </Baris>
      </div>
    </aside>
  )
}
