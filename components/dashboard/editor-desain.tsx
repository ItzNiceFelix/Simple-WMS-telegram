"use client"

// components/dashboard/editor-desain.tsx — Mode "Editor" Studio Gambar (PC-only, rencana §Editor).
// Kanvas kosong berlatar putih + preset ukuran iklan. Interaksi pindah/putar/skala disediakan
// fabric; Fase ini TIDAK membuat objek/teks, undo, atau export.
//
// Fabric di-import dinamis: bundelnya butuh DOM (window/document) dan lewat import statis
// ikut ter-SSR → crash. Instance disimpan di useRef supaya gerakan objek tidak memicu re-render.
// Entry "fabric/es" dipilih: memetakan ke dist/fabric.min.mjs, barrel ESM murni (tanpa shim
// jsdom/node-canvas) → hanya modul yang dipakai yang masuk bundel.
import { useEffect, useRef, useState } from "react"
import type { Canvas as FabricCanvas } from "fabric"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Preset ukuran dokumen kanvas (piksel). Label ramah untuk pengguna non-desainer. */
const PRESET = [
  { id: "1080x1080", label: "1:1 Persegi", lebar: 1080, tinggi: 1080 },
  { id: "1080x1350", label: "4:5 Potret", lebar: 1080, tinggi: 1350 },
  { id: "1200x628", label: "1.91:1 Lanskap", lebar: 1200, tinggi: 628 },
] as const

type PresetId = (typeof PRESET)[number]["id"]

export function EditorDesain() {
  const [presetId, setPresetId] = useState<PresetId>("1080x1080")
  const wadahRef = useRef<HTMLDivElement>(null)
  const kanvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<FabricCanvas | null>(null)
  // Ukuran dokumen aktif dibaca resize-observer; ref agar tidak ikut siklus render.
  const presetRef = useRef<(typeof PRESET)[number]>(PRESET[0])

  useEffect(() => {
    let hidup = true
    let ro: ResizeObserver | null = null

    // Import statis MUSTAHIL: fabric menyentuh window/document saat modul dievaluasi dan
    // akan ikut ter-SSR. Specifier statis di sini; hanya waktu-muat yang dinamis.
    void (async () => {
      const { Canvas } = await import("fabric/es")
      if (!hidup || !kanvasRef.current) return

      const kanvas = new Canvas(kanvasRef.current, {
        backgroundColor: "#ffffff", // banner produk: latar putih, bukan transparan
        preserveObjectStacking: true,
        selection: true, // pilih + pindah + putar + skala (handle bawaan fabric)
      })
      fabricRef.current = kanvas

      /** Skalakan dokumen preset agar muat lebar kontainer; tinggi ikut rasio. */
      const sesuaikan = () => {
        const el = wadahRef.current
        if (!el) return
        const tersedia = el.clientWidth
        if (tersedia <= 0) return
        const { lebar, tinggi } = presetRef.current
        const skala = Math.min(1, tersedia / lebar)
        kanvas.setDimensions({ width: lebar * skala, height: tinggi * skala })
        kanvas.setZoom(skala)
        kanvas.requestRenderAll()
      }

      sesuaikan()
      ro = new ResizeObserver(sesuaikan)
      if (wadahRef.current) ro.observe(wadahRef.current)
    })()

    return () => {
      hidup = false
      ro?.disconnect()
      const kanvas = fabricRef.current
      fabricRef.current = null
      if (kanvas) void kanvas.dispose()
    }
  }, [])

  // Ganti preset → perbarui ukuran dokumen + skala tampil.
  useEffect(() => {
    const p = PRESET.find((x) => x.id === presetId) ?? PRESET[0]
    presetRef.current = p
    const kanvas = fabricRef.current
    const el = wadahRef.current
    if (!kanvas || !el || el.clientWidth <= 0) return
    const skala = Math.min(1, el.clientWidth / p.lebar)
    kanvas.setDimensions({ width: p.lebar * skala, height: p.tinggi * skala })
    kanvas.setZoom(skala)
    kanvas.requestRenderAll()
  }, [presetId])

  return (
    <div className="flex flex-col gap-3" data-testid="editor-desain">
      <div className="flex flex-wrap items-center gap-2" data-testid="toolbar-editor">
        <Select value={presetId} onValueChange={(v) => setPresetId(v as PresetId)}>
          <SelectTrigger
            id="preset-ukuran-editor"
            className="h-11 w-full md:h-8 md:w-[200px]"
            data-testid="preset-ukuran-editor"
          >
            <SelectValue>
              {(v: string | null) => PRESET.find((p) => p.id === v)?.label ?? "Pilih ukuran"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PRESET.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label} · {p.lebar}x{p.tinggi}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* touchAction none + overscroll contain: seret objek tidak men-scroll halaman (WebView). */}
      <div
        ref={wadahRef}
        className="w-full overflow-hidden rounded-md border bg-muted/30"
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
      >
        <canvas ref={kanvasRef} data-testid="kanvas-editor" />
      </div>
    </div>
  )
}
