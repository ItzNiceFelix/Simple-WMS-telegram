"use client"

// components/dashboard/editor-desain.tsx — Mode "Editor" Studio Gambar (PC-only, rencana §Editor).
// Kanvas preset ukuran iklan + objek yang bisa ditambah, dipilih, diubah propertinya (Fase 2).
//
// Fabric di-import dinamis: bundelnya butuh DOM (window/document) dan lewat import statis
// ikut ter-SSR → crash. Instance disimpan di useRef supaya gerakan objek tidak memicu re-render.
// Entry "fabric/es" dipilih: memetakan ke dist/fabric.min.mjs, barrel ESM murni (tanpa shim
// jsdom/node-canvas) → hanya modul yang dipakai yang masuk bundel.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { Circle, ImagePlus, Minus, Square, Type } from "lucide-react"
import type * as FabricEsModule from "fabric/es"
import type { Canvas as FabricCanvas, FabricObject } from "fabric"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  EditorPanelProperti,
  type JenisProperti,
  type NilaiProperti,
  type PerubahanProperti,
} from "@/components/dashboard/editor-panel-properti"

/** Preset ukuran dokumen kanvas (piksel). Label ramah untuk pengguna non-desainer. */
const PRESET = [
  { id: "1080x1080", label: "1:1 Persegi", lebar: 1080, tinggi: 1080 },
  { id: "1080x1350", label: "4:5 Potret", lebar: 1080, tinggi: 1350 },
  { id: "1200x628", label: "1.91:1 Lanskap", lebar: 1200, tinggi: 628 },
] as const

type PresetId = (typeof PRESET)[number]["id"]

/** Batas unggah gambar: data URL 4 MB sudah membuat dokumen JSON membengkak + rawan OOM. */
const MAKS_GAMBAR = 4 * 1024 * 1024

/** Kunci yang ikut diserialisasi; tanpa ini `id`/`namaLapisan` hilang saat muat ulang. */
const PROP_SERIAL = ["id", "namaLapisan", "selectable", "evented"]

/** Handle untuk Fase 5 (simpan/buka) dan Fase 7 (Edit di Editor). */
export type EditorDesainHandle = {
  /** JSON dokumen saat ini (canvas.toObject + PROP_SERIAL agar id/namaLapisan ikut). */
  ambilDokumen: () => string
  /** Muat dokumen dari JSON; dimensi preset tidak diubah. */
  muatDokumen: (json: string) => Promise<void>
  /** Tempel hasil generate AI sebagai latar terkunci di tumpukan paling bawah. */
  tambahLatarGambar: (base64: string, mime: string) => Promise<void>
}

/**
 * Objek fabric → nilai polos untuk panel (panel tidak boleh tahu fabric).
 * Jenis dideteksi dengan `instanceof` kelas modul, BUKAN string `o.type`: nilai type
 * ikut terminifikasi di bundel dan tidak stabil antar versi.
 */
function bacaProperti(o: FabricObject, fabric: typeof FabricEsModule): NilaiProperti {
  const jenis: JenisProperti =
    o instanceof fabric.IText || o instanceof fabric.Textbox ? "teks" :
    o instanceof fabric.FabricImage ? "gambar" :
    o instanceof fabric.Line ? "garis" :
    o instanceof fabric.Group || o instanceof fabric.ActiveSelection ? "lain" :
    o instanceof fabric.Rect ||
    o instanceof fabric.Ellipse ||
    o instanceof fabric.Circle ||
    o instanceof fabric.Triangle ||
    o instanceof fabric.Polygon ||
    o instanceof fabric.Path ? "bentuk" :
    "lain"
  // "#aabbcc" → "#aabbcc"; "rgb(1,2,3)" → "#010203" (input[type=color] hanya terima hex).
  const keHex = (v: unknown, fallback: string) => {
    const s = typeof v === "string" ? v.trim() : ""
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s
    const m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
    if (!m) return fallback
    return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`
  }
  // Skala non-1 dari handle resize harus ikut jadi ukuran tampil, jika tidak nilai di panel ≠ kanvas.
  const w = o.width * (o.scaleX ?? 1)
  const h = o.height * (o.scaleY ?? 1)
  // Properti khas teks hanya ada di kelas teks; sempitkan lewat instanceof (bukan cast).
  const t = o instanceof fabric.IText || o instanceof fabric.Textbox ? o : null
  return {
    // id dipakai panel untuk tahu kapan seleksi benar-benar berganti (bukan sekadar re-render).
    id: String(o.get("id") ?? ""),
    jenis,
    kiri: o.left ?? 0,
    atas: o.top ?? 0,
    lebar: w,
    tinggi: h,
    sudut: o.angle ?? 0,
    teks: t ? t.text : "",
    fontFamily: String(t?.fontFamily ?? "Arial"),
    fontSize: Number(t?.fontSize ?? 32),
    tebal: t?.fontWeight === "bold",
    miring: t?.fontStyle === "italic",
    garisBawah: t?.underline === true,
    warnaIsi: keHex(t ? t.fill : o.fill, "#000000"),
    warnaGaris: keHex(o.stroke, "#000000"),
    tebalGaris: Number(o.strokeWidth ?? 1),
    // textAlign fabric mencakup justify*; panel hanya menawarkan tiga yang umum.
    perataan: t?.textAlign === "center" || t?.textAlign === "right" ? t.textAlign : "left",
    kunci: o.lockMovementX === true && o.lockMovementY === true,
  }
}

/** Nama lapisan kecil untuk pesan ke pengguna. */
const NAMA_TIPE: Record<JenisProperti, string> = {
  teks: "Teks",
  gambar: "Gambar",
  bentuk: "Bentuk",
  garis: "Garis",
  lain: "Objek",
}

export const EditorDesain = forwardRef<EditorDesainHandle>(function EditorDesain(_props, ref) {
  const [presetId, setPresetId] = useState<PresetId>("1080x1080")
  const [terpilih, setTerpilih] = useState<NilaiProperti | null>(null)
  const [dokumenJson, setDokumenJson] = useState("")
  const wadahRef = useRef<HTMLDivElement>(null)
  const kanvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<FabricCanvas | null>(null)
  const berkasRef = useRef<HTMLInputElement>(null)
  // Modul fabric ditahan agar handler di luar useEffect tetap bisa bikin objek baru.
  const modulRef = useRef<typeof FabricEsModule | null>(null)
  // Penghitung objek: id = jenis + urutan + timestamp → unik & bisa dilacak saat serialisasi.
  const urutRef = useRef(0)
  // Ukuran dokumen aktif dibaca resize-observer; ref agar tidak ikut siklus render.
  const presetRef = useRef<(typeof PRESET)[number]>(PRESET[0])

  /** Skalakan dokumen preset agar muat lebar kontainer; tinggi ikut rasio. */
  const sesuaikan = useCallback(() => {
    const el = wadahRef.current
    const kanvas = fabricRef.current
    if (!el || !kanvas) return
    const tersedia = el.clientWidth
    if (tersedia <= 0) return
    const { lebar, tinggi } = presetRef.current
    const skala = Math.min(1, tersedia / lebar)
    kanvas.setDimensions({ width: lebar * skala, height: tinggi * skala })
    kanvas.setZoom(skala)
    kanvas.requestRenderAll()
  }, [])

  /** Semua perubahan dari panel/luar drag lewat sini supaya Fase 3 (undo) punya satu titik dengar. */
  const tandaiBerubah = useCallback((o: FabricObject | null) => {
    const kanvas = fabricRef.current
    if (!kanvas) return
    kanvas.requestRenderAll()
    // `object:modified` fabric wajib bertarget; penghapusan tidak punya objek →
    // cukup pancarkan `object:removed` yang sudah dipancarkan kanvas.remove().
    if (o) kanvas.fire("object:modified", { target: o })
    setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
  }, [])

  useEffect(() => {
    let hidup = true
    let ro: ResizeObserver | null = null

    // Import statis MUSTAHIL: fabric menyentuh window/document saat modul dievaluasi dan
    // akan ikut ter-SSR. Specifier statis di sini; hanya waktu-muat yang dinamis.
    void (async () => {
      const fabric = await import("fabric/es")
      const { Canvas } = fabric
      if (!hidup || !kanvasRef.current) return
      modulRef.current = fabric

      const kanvas = new Canvas(kanvasRef.current, {
        backgroundColor: "#ffffff", // banner produk: latar putih, bukan transparan
        preserveObjectStacking: true,
        selection: true, // pilih + pindah + putar + skala (handle bawaan fabric)
      })
      fabricRef.current = kanvas

      const lapor = (target?: FabricObject) => {
        setTerpilih(target ? bacaProperti(target, fabric) : null)
      }
      // Drag selesai: fabric sudah fire object:modified sendiri; di sini cukup segarkan panel + JSON.
      kanvas.on("selection:created", (e) => lapor(e.selected[0]))
      kanvas.on("selection:updated", (e) => lapor(e.selected[0]))
      kanvas.on("selection:cleared", () => lapor(undefined))
      kanvas.on("object:modified", (e) => {
        lapor(e.target)
        setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
      })
      // Ketikan langsung di kanvas (IText) juga harus menyegarkan panel.
      // Event ini hanya dipancarkan IText, jadi target bertipe objek teks.
      kanvas.on("text:changed", (e) => lapor(e.target))
      // Objek dihapus lewat keyboard (Delete) → panel ikut kosong.
      kanvas.on("object:removed", () => {
        if (kanvas.getActiveObjects().length === 0) lapor(undefined)
        setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
      })

      sesuaikan()
      ro = new ResizeObserver(sesuaikan)
      if (wadahRef.current) ro.observe(wadahRef.current)
    })()

    return () => {
      hidup = false
      ro?.disconnect()
      const kanvas = fabricRef.current
      fabricRef.current = null
      modulRef.current = null
      if (kanvas) void kanvas.dispose()
    }
  }, [sesuaikan])

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

  /** Tambah objek baru di TENGAH dokumen (bukan tengah tampilan) + langsung dipilih. */
  const tambahObjek = useCallback((o: FabricObject, jenis: JenisProperti) => {
    const kanvas = fabricRef.current
    const fabric = modulRef.current
    if (!kanvas || !fabric) return
    urutRef.current += 1
    // `id`/`namaLapisan` bukan properti bawaan fabric: ikut terserialisasi lewat PROP_SERIAL di toObject.
    o.set({ id: `${jenis}-${urutRef.current}-${Date.now()}`, namaLapisan: `${NAMA_TIPE[jenis]} ${urutRef.current}` })
    kanvas.add(o)
    kanvas.centerObject(o)
    kanvas.setActiveObject(o)
    kanvas.requestRenderAll()
    setTerpilih(bacaProperti(o, fabric))
    setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
  }, [])

  const tambahTeks = () => {
    const fabric = modulRef.current
    const kanvas = fabricRef.current
    if (!fabric || !kanvas) return
    const skala = kanvas.getZoom() || 1
    const ukuran = Math.round(presetRef.current.lebar * 0.06)
    tambahObjek(
      new fabric.IText("Teks baru", {
        // Ukuran dokumen / skala: supaya 6% lebar kanvas tampil 6% juga di layar.
        fontSize: ukuran / skala,
        fontFamily: "Arial",
        fill: "#111111",
        originX: "center",
        originY: "center",
      }),
      "teks"
    )
  }

  const tambahPersegi = () => {
    const fabric = modulRef.current
    if (!fabric) return
    tambahObjek(
      new fabric.Rect({ width: 400, height: 400, fill: "#3b82f6", originX: "center", originY: "center" }),
      "bentuk"
    )
  }

  const tambahLingkaran = () => {
    const fabric = modulRef.current
    if (!fabric) return
    tambahObjek(
      new fabric.Ellipse({ rx: 200, ry: 200, fill: "#22c55e", originX: "center", originY: "center" }),
      "bentuk"
    )
  }

  const tambahGaris = () => {
    const fabric = modulRef.current
    if (!fabric) return
    tambahObjek(
      new fabric.Line([-300, 0, 300, 0], {
        stroke: "#111111",
        strokeWidth: 4,
        originX: "center",
        originY: "center",
      }),
      "garis"
    )
  }

  /** Baca berkas unggahan → data URL (fabric tidak bisa memuat File langsung). */
  const pilihGambar = (e: ChangeEvent<HTMLInputElement>) => {
    const berkas = e.target.files?.[0]
    // Reset value agar memilih berkas yang sama dua kali tetap memicu onChange.
    e.target.value = ""
    if (!berkas) return
    if (berkas.size > MAKS_GAMBAR) {
      window.alert("Ukuran gambar melebihi 4 MB. Kompres dulu lalu unggah ulang.")
      return
    }
    const baca = new FileReader()
    baca.onload = () => {
      const dataUrl = typeof baca.result === "string" ? baca.result : ""
      if (dataUrl) void pasangGambar(dataUrl)
    }
    baca.readAsDataURL(berkas)
  }

  /** Data URL → FabricImage, dijadikan latar berisi (contain) agar tak terpotong. */
  const pasangGambar = useCallback(async (dataUrl: string) => {
    const fabric = modulRef.current
    const kanvas = fabricRef.current
    if (!fabric || !kanvas) return
    const img = await fabric.FabricImage.fromURL(dataUrl)
    const bidang = kanvas.getWidth() / (kanvas.getZoom() || 1)
    const tinggi = kanvas.getHeight() / (kanvas.getZoom() || 1)
    const rasio = Math.min(bidang / (img.width || 1), tinggi / (img.height || 1), 1)
    img.scale(rasio)
    img.set({
      left: bidang / 2,
      top: tinggi / 2,
      originX: "center",
      originY: "center",
      // ponytail: skala fix di objek; cukup untuk ekspor 1:1. Upgrade: hapus scaleX/scaleY
      // sebelum toObject bila nanti butuh skala dokumen yang berbeda dari piksel gambar.
    })
    tambahObjek(img, "gambar")
  }, [tambahObjek])

  /** Panel → instance fabric. Jenis menentukan properti mana yang sah (mis. garis tanpa isi). */
  const ubahProperti = useCallback((p: PerubahanProperti) => {
    const kanvas = fabricRef.current
    const fabric = modulRef.current
    const o = kanvas?.getActiveObject()
    if (!kanvas || !fabric || !o) return
    const jenis = bacaProperti(o, fabric).jenis
    // Tipe patch longgar: `Object.assign` menyatukan patch ke instance tanpa cast.
    const patch: Record<string, unknown> = {}

    if (p.teks != null) patch.text = p.teks
    if (p.fontFamily != null) patch.fontFamily = p.fontFamily
    if (p.fontSize != null) patch.fontSize = p.fontSize
    if (p.tebal != null) patch.fontWeight = p.tebal ? "bold" : "normal"
    if (p.miring != null) patch.fontStyle = p.miring ? "italic" : "normal"
    if (p.garisBawah != null) patch.underline = p.garisBawah
    if (p.perataan != null) patch.textAlign = p.perataan
    if (p.warnaIsi != null) patch.fill = p.warnaIsi
    if (p.warnaGaris != null && jenis !== "teks") patch.stroke = p.warnaGaris
    if (p.tebalGaris != null && jenis !== "teks") patch.strokeWidth = p.tebalGaris

    // Posisi memakai left/top; lebar/tinggi diubah sebagai scale supaya bentuk tepi-tetap
    // (garis, gambar) tidak kehilangan stroke/rasio aslinya.
    if (p.kiri != null) patch.left = p.kiri
    if (p.atas != null) patch.top = p.atas
    if (p.sudut != null) patch.angle = p.sudut
    if (p.lebar != null && o.width > 0) patch.scaleX = p.lebar / o.width
    if (p.tinggi != null && o.height > 0) patch.scaleY = p.tinggi / o.height

    Object.assign(o, patch)
    o.setCoords()
    tandaiBerubah(o)
  }, [tandaiBerubah])

  const hapusTerpilih = useCallback(() => {
    const kanvas = fabricRef.current
    const o = kanvas?.getActiveObject()
    if (!kanvas || !o) return
    kanvas.remove(o)
    kanvas.discardActiveObject()
    setTerpilih(null)
    tandaiBerubah(null)
  }, [tandaiBerubah])

  const naikLapisan = useCallback(() => {
    const kanvas = fabricRef.current
    const o = kanvas?.getActiveObject()
    if (!kanvas || !o) return
    if (!kanvas.bringObjectForward(o)) return // sudah paling atas
    kanvas.requestRenderAll()
    setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
  }, [])

  const turunLapisan = useCallback(() => {
    const kanvas = fabricRef.current
    const o = kanvas?.getActiveObject()
    if (!kanvas || !o) return
    if (!kanvas.sendObjectBackwards(o)) return // sudah paling bawah
    kanvas.requestRenderAll()
    setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
  }, [])

  /**
   * Muat dokumen; reviver menempel ulang id/nama + mengunci objek latar.
   * `PROP_SERIAL` yang dibaca sudah bertipe di FabricObject (namaLapisan ada di tipe fabric),
   * jadi reviver tidak perlu record mentah.
   */
  const muatDokumen = useCallback(async (json: string) => {
    const kanvas = fabricRef.current
    const fabric = modulRef.current
    if (!kanvas || !fabric) return
    await kanvas.loadFromJSON(json, (_serial, objek) => {
      // Reviver juga melihat filter/shadow (union tipe fabric) → saring dulu sebelum menyetel properti.
      if (!(objek instanceof fabric.FabricObject)) return
      if (objek.selectable === false) {
        objek.set({
          selectable: false,
          evented: false,
          lockMovementX: true,
          lockMovementY: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
        })
      }
    })
    kanvas.discardActiveObject()
    kanvas.requestRenderAll()
    setTerpilih(null)
    setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
  }, [])

  /** Fase 7: hasil generate jadi latar terkunci di dasar tumpukan. */
  const tambahLatarGambar = useCallback(async (base64: string, mime: string) => {
    const fabric = modulRef.current
    const kanvas = fabricRef.current
    if (!fabric || !kanvas) return
    const dataUrl = base64.startsWith("data:") ? base64 : `data:${mime};base64,${base64}`
    const img = await fabric.FabricImage.fromURL(dataUrl)
    const zoom = kanvas.getZoom() || 1
    const bidang = kanvas.getWidth() / zoom
    const tinggi = kanvas.getHeight() / zoom
    img.scale(Math.max(bidang / (img.width || 1), tinggi / (img.height || 1))) // cover
    img.set({
      left: bidang / 2,
      top: tinggi / 2,
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      namaLapisan: "Latar",
      id: `latar-${Date.now()}`,
    })
    kanvas.add(img)
    kanvas.sendObjectToBack(img)
    kanvas.requestRenderAll()
    setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      ambilDokumen: () => {
        const kanvas = fabricRef.current
        return kanvas ? JSON.stringify(kanvas.toObject(PROP_SERIAL)) : dokumenJson
      },
      muatDokumen,
      tambahLatarGambar,
    }),
    [dokumenJson, muatDokumen, tambahLatarGambar]
  )

  return (
    <div className="flex flex-col gap-3" data-testid="editor-desain">
      <div className="flex flex-wrap items-center gap-2" data-testid="toolbar-editor">
        <Button variant="outline" size="sm" onClick={tambahTeks} data-testid="tambah-teks">
          <Type />
          Teks
        </Button>
        <Button variant="outline" size="sm" onClick={tambahPersegi} data-testid="tambah-persegi">
          <Square />
          Persegi
        </Button>
        <Button variant="outline" size="sm" onClick={tambahLingkaran} data-testid="tambah-lingkaran">
          <Circle />
          Lingkaran
        </Button>
        <Button variant="outline" size="sm" onClick={tambahGaris} data-testid="tambah-garis">
          <Minus />
          Garis
        </Button>
        <Button variant="outline" size="sm" onClick={() => berkasRef.current?.click()} data-testid="tambah-gambar">
          <ImagePlus />
          Gambar
        </Button>
        {/* Input berkas disembunyikan; tombol di atas yang memicunya. */}
        <input
          ref={berkasRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={pilihGambar}
          aria-hidden="true"
          tabIndex={-1}
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground text-xs" data-testid="info-dokumen">
            {dokumenJson ? "Dokumen siap disimpan" : "Dokumen kosong"}
          </span>
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
      </div>

      {/* Panel kanan + kanvas kiri. flex-wrap: layar sempit tetap satu kolom. */}
      <div className="flex flex-wrap items-start gap-3">
        {/* touchAction none + overscroll contain: seret objek tidak men-scroll halaman (WebView). */}
        <div
          ref={wadahRef}
          className="min-w-[320px] flex-1 overflow-hidden rounded-md border bg-muted/30"
          style={{ touchAction: "none", overscrollBehavior: "contain" }}
        >
          <canvas ref={kanvasRef} data-testid="kanvas-editor" />
        </div>

        <div className="w-full md:w-[280px]">
          <EditorPanelProperti
            objek={terpilih}
            onUbah={ubahProperti}
            onHapus={hapusTerpilih}
            onNaikLapisan={naikLapisan}
            onTurunLapisan={turunLapisan}
          />
        </div>
      </div>
    </div>
  )
})
