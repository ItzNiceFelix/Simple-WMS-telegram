"use client"

// components/dashboard/editor-desain.tsx — Mode "Editor" Studio Gambar (PC-only, rencana §Editor).
// Kanvas preset ukuran iklan + objek yang bisa ditambah, dipilih, diubah propertinya (Fase 2).
//
// Fabric di-import dinamis: bundelnya butuh DOM (window/document) dan lewat import statis
// ikut ter-SSR → crash. Instance disimpan di useRef supaya gerakan objek tidak memicu re-render.
// Entry "fabric/es" dipilih: memetakan ke dist/fabric.min.mjs, barrel ESM murni (tanpa shim
// jsdom/node-canvas) → hanya modul yang dipakai yang masuk bundel.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import type { ChangeEvent, ForwardedRef, JSX, KeyboardEvent as KeyboardEventReact } from "react"
import { Circle, Download, FolderOpen, ImagePlus, Minus, Redo2, Save, Square, Type, Undo2 } from "lucide-react"
import { toast } from "sonner"
import type * as FabricEsModule from "fabric/es"
import type { Canvas as FabricCanvas, FabricObject } from "fabric"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  EditorExportDialog,
  type FormatEkspor,
} from "@/components/dashboard/editor-export-dialog"
import {
  EditorPanelProperti,
  type JenisProperti,
  type NilaiProperti,
  type PerubahanProperti,
} from "@/components/dashboard/editor-panel-properti"
import { EditorPickerAset } from "@/components/dashboard/editor-picker-aset"
import { EditorToolbarAi } from "@/components/dashboard/editor-toolbar-ai"
import { EditorElemen } from "@/components/dashboard/editor-elemen"
import { EditorAiSetting } from "@/components/dashboard/editor-ai-setting"
import { terapkanOperasi, objekTerkunci, type HasilTerap } from "@/components/dashboard/editor-operasi"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { kePiksel, validasiLayout, type ElemenLayout, type LayoutBanner } from "@/lib/desain/skemaLayout"
import type { OperasiKanvas } from "@/lib/desain/skemaOperasi"

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

/**
 * Batas riwayat undo/redo. Snapshot memuat data URL gambar, jadi entri ke-51 ke atas
 * dibuang dari ujung lama; 50 langkah lebih dari cukup untuk menyunting satu banner.
 */
const MAKS_RIWAYAT = 50

/** Handle untuk Fase 5 (simpan/buka) dan Fase 7 (Edit di Editor). */
export type EditorDesainHandle = {
  /** JSON dokumen saat ini (canvas.toObject + PROP_SERIAL agar id/namaLapisan ikut). */
  ambilDokumen: () => string
  /** Muat dokumen dari JSON; dimensi preset tidak diubah. */
  muatDokumen: (json: string) => Promise<void>
  /** Tempel hasil generate AI sebagai latar terkunci di tumpukan paling bawah. */
  tambahLatarGambar: (base64: string, mime: string) => Promise<void>
  /** Bersihkan kanvas (kecuali latar terkunci) lalu render satu layout AI; satu langkah undo. */
  terapkanLayout: (layout: LayoutBanner) => Promise<void>
}

/** Props editor. `presetId` = preset TOKO (bukan ukuran kanvas) untuk picker aset. */
export type EditorDesainProps = {
  presetId: number
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

/**
 * Bentuk dokumen yang disimpan server. `dokumen_json` diserialkan `Canvas.toObject()`
 * sehingga properti canvas IKUT tertulis (versi + dimensi). Dipakai saat memuat desain
 * untuk mengetahui ukuran dokumen yang tersimpan tanpa menyentuh instance kanvas.
 */
type DokumenKanvas = { version?: string; width?: number; height?: number }

/** Metadata desain dari `GET /api/desain` (daftar ringan, tanpa `dokumen_json`). */
type DesainRingkas = { id: number; nama: string; ukuran: string; updated_at: number }

/**
 * Satu elemen layout → satu objek fabric. `undefined` = elemen dilewati (jenis `gambar`
 * belum punya sumber; membuat objek kosong hanya jadi sampah di kanvas).
 *
 * Berada di tingkat modul, bukan di dalam handler: dipakai DUA jalur (relayout AI dan
 * penyisipan elemen pustaka). Dua salinan fungsi ini berarti hasil `bangun_ulang` dan
 * hasil `sisipkan_elemen` bisa berbeda bentuk untuk elemen yang sama.
 */
function objekDariElemen(el: ElemenLayout, ukuran: string, fabric: typeof FabricEsModule): FabricObject | undefined {
  const k = kePiksel(el, ukuran)
  // Origin kiri-atas: `kePiksel` mengembalikan kotak (left/top/lebar/tinggi), bukan titik tengah.
  const dasar = { left: k.left, top: k.top, originX: "left" as const, originY: "top" as const }
  const isi = el.warna ?? "#000000"
  const garis = el.warnaGaris ?? "#000000"
  const lebarGaris = el.tebalGaris ?? 0
  const sudut = el.rotasi ?? 0
  const opasitas = el.opasitas

  // Elemen dengan TINGGI tetap (teks, persegi, lingkaran): penyesuaian ukuran dikirim
  // sebagai scaleX/scaleY, karena options constructor tidak menerima keduanya — lihat cabang garis.
  const pas = { left: k.left, top: k.top, angle: sudut, opacity: opasitas }

  switch (el.jenis) {
    case "teks": {
      // IText (bukan Text) supaya hasil AI tetap bisa diklik lalu diketik langsung di kanvas.
      const t = new fabric.IText(el.teks ?? "", {
        ...pas,
        originX: "left",
        originY: "top",
        fontSize: el.ukuran ?? 48,
        fontFamily: el.font ?? "Arial",
        fill: isi,
        fontWeight: el.tebal ? "bold" : "normal",
        fontStyle: el.miring ? "italic" : "normal",
        underline: el.garisBawah === true,
        textAlign: el.perataan === "tengah" ? "center" : el.perataan === "kanan" ? "right" : "left",
      })
      // Dimensi SEDIA ada: originX "left" berlaku untuk kotak teks, jadi left/top tetap
      // sama setelah diskalakan. Tinggi teks dari AI lebih longgar dari hasil render →
      // hanya LEBAR yang diskalakan.
      const lebarAsli = t.width || 1
      t.set({ scaleX: k.width / lebarAsli, scaleY: k.height / (t.height || 1), width: k.width })
      return t
    }
    case "persegi": {
      const r = new fabric.Rect({ ...dasar, fill: isi, stroke: garis, strokeWidth: lebarGaris, width: k.width, height: k.height, angle: sudut, opacity: opasitas })
      const rad = el.radiusSudut ?? 0
      if (rad > 0) r.set({ rx: rad, ry: rad, width: Math.max(1, k.width - rad * 2), height: Math.max(1, k.height - rad * 2) })
      return r
    }
    case "lingkaran": {
      const e = new fabric.Ellipse({ ...dasar, fill: isi, stroke: garis, strokeWidth: lebarGaris, rx: k.width / 2, ry: k.height / 2, angle: sudut, opacity: opasitas })
      // Origin pusat: left/top harus digeser ke tengah kotak supaya hasilnya sama dengan origin kiri-atas.
      e.set({ originX: "center", originY: "center", left: k.left + k.width / 2, top: k.top + k.height / 2 })
      return e
    }
    case "garis": {
      // Garis digambar pada skala 1 di koordinat LOKAL pusat, lalu diskalakan: dengan begitu
      // anggota baru (atan2) tidak perlu dihitung dan sudut dari layout tetap dipakai apa adanya.
      const l = new fabric.Line([-k.width / 2, 0, k.width / 2, 0], {
        ...pas,
        originX: "center",
        originY: "center",
        left: k.left + k.width / 2,
        top: k.top + k.height / 2,
        stroke: isi,
        strokeWidth: Math.max(1, lebarGaris),
      })
      // Tanpa skala balik, tebal garis ikut mengecil/membesar bersama skala di bawah.
      const tebalSkala = Math.max(0.2, Math.max(k.height, 1) / (Math.max(1, lebarGaris) * 4))
      l.set({ scaleX: tebalSkala, scaleY: tebalSkala })
      return l
    }
    default:
      return undefined // "gambar": server belum mengirim sumber gambarnya
  }
}

export const EditorDesain = forwardRef<EditorDesainHandle, EditorDesainProps>(function EditorDesain(
  { presetId },
  // Ref dari induk; di dalam komponen hanya dibaca lewat useImperativeHandle.
  ref: ForwardedRef<EditorDesainHandle>
): JSX.Element {
  const [ukuranId, setUkuranId] = useState<PresetId>("1080x1080")
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
  /**
   * True selama skrip operasi AI dijalankan. Gerbang untuk pencatatan riwayat otomatis:
   * `object:added`/`object:removed` tetap dipancarkan fabric untuk SETIAP objek yang
   * dibuat AI, dan tanpa gerbang ini satu permintaan AI menghasilkan 12 langkah undo
   * alih-alih satu. Snapshot sebelum AI diambil manual (lihat `catatSnapshotSebelumAi`).
   */
  const aiSedangTerapRef = useRef(false)

  // --- Riwayat undo/redo (Fase 3) ---
  // Kanvas TIDAK menyimpan riwayat; yang disimpan adalah snapshot JSON dokumen. Semua di ref
  // supaya menyimpan snapshot tidak memicu render (yang penting: jangan render per pointermove).
  const riwayatRef = useRef<string[]>([""])
  const riwayatIdxRef = useRef(0)
  // Versi disimpan di state karena tombol undo/redo harus tahu kapan disable-nya berubah.
  const [versiRiwayat, setVersiRiwayat] = useState(0)

  // --- Ekspor (Fase 6) ---
  const [dialogEkspor, setDialogEkspor] = useState(false)

  // --- Simpan/buka desain (Fase 5) ---
  // Satu state untuk tiga dialog: tiga boolean terpisah bisa menghasilkan kombinasi mustahil.
  const [dialogDesain, setDialogDesain] = useState<
    | { jenis: "simpan"; nama: string }
    | { jenis: "buka"; daftar: DesainRingkas[]; memuat: boolean }
    | null
  >(null)
  // Id desain yang sedang dibuka; ada = simpan berikutnya UPDATE, bukan baris baru.
  const [desainId, setDesainId] = useState<number | null>(null)
  const [menyimpan, setMenyimpan] = useState(false)

  /**
   * Catat keadaan dokumen SEKARANG sebagai satu langkah undo. Dipanggil dari event fabric yang
   * hanya terpicu setelah aksi user selesai (`object:modified` tidak dipancarkan saat pointermove),
   * jadi satu geseran = satu entri. Snapshot disimpan ke ref agar tidak memicu render.
   */
  const catatRiwayat = useCallback(() => {
    const kanvas = fabricRef.current
    if (!kanvas) return
    const json = JSON.stringify(kanvas.toObject(PROP_SERIAL))
    const list = riwayatRef.current
    if (list[riwayatIdxRef.current] === json) return // tidak ada perubahan nyata
    let idx = riwayatIdxRef.current + 1
    if (idx === list.length) list.push(json)
    else list.splice(idx, list.length, json) // edit baru setelah undo → buang cabang lama
    if (list.length > MAKS_RIWAYAT) {
      list.splice(0, list.length - MAKS_RIWAYAT)
      idx = list.length - 1
    }
    riwayatIdxRef.current = idx
    setVersiRiwayat((v) => v + 1)
  }, [])

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
        if (!aiSedangTerapRef.current) catatRiwayat()
      })
      // Ketikan langsung di kanvas (IText) juga harus menyegarkan panel.
      // Event ini hanya dipancarkan IText, jadi target bertipe objek teks.
      kanvas.on("text:changed", (e) => lapor(e.target))
      // Objek dihapus lewat keyboard (Delete) → panel ikut kosong.
      kanvas.on("object:removed", () => {
        if (kanvas.getActiveObjects().length === 0) lapor(undefined)
        setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
        // Dihapus oleh skrip AI: riwayat sudah punya snapshot sebelum AI, jangan ditambah.
        if (!aiSedangTerapRef.current) catatRiwayat()
      })
      // Objek baru (tombol toolbar maupun muat dokumen) = satu langkah undo.
      kanvas.on("object:added", () => {
        if (!aiSedangTerapRef.current) catatRiwayat()
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
  }, [sesuaikan, catatRiwayat])

  // Ganti preset → perbarui ukuran dokumen + skala tampil.
  useEffect(() => {
    const p = PRESET.find((x) => x.id === ukuranId) ?? PRESET[0]
    presetRef.current = p
    const kanvas = fabricRef.current
    const el = wadahRef.current
    if (!kanvas || !el || el.clientWidth <= 0) return
    const skala = Math.min(1, el.clientWidth / p.lebar)
    kanvas.setDimensions({ width: p.lebar * skala, height: p.tinggi * skala })
    kanvas.setZoom(skala)
    kanvas.requestRenderAll()
    // Riwayat mengikuti dokumen: ukuran berbeda = dokumen berbeda → mulai dari kosong.
    riwayatRef.current = [JSON.stringify(kanvas.toObject(PROP_SERIAL))]
    riwayatIdxRef.current = 0
    setVersiRiwayat((v) => v + 1)
  }, [ukuranId])

  /**
   * Terapkan snapshot riwayat ke kanvas. Lebar/tinggi canvas TIDAK
   * ikut ditimpa (`loadFromJSON` memuat properti yang terserialisasi termasuk width/height):
   * kalau ikut, zoom tampil jadi tidak sinkron dengan dimensi elemen canvas.
   */
  const terapkanRiwayat = useCallback(async (idx: number) => {
    const kanvas = fabricRef.current
    const fabric = modulRef.current
    if (!kanvas || !fabric) return
    const json = riwayatRef.current[idx]
    if (json == null) return
    const { width, height } = kanvas
    await kanvas.loadFromJSON(json, (_serial, objek) => {
      // Sama seperti muatDokumen: objek latar tetap terkunci setelah kembali dari riwayat.
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
    kanvas.setDimensions({ width, height })
    kanvas.setZoom(Math.min(1, (wadahRef.current?.clientWidth ?? width) / presetRef.current.lebar))
    kanvas.discardActiveObject()
    kanvas.requestRenderAll()
    setTerpilih(null)
    setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
    riwayatIdxRef.current = idx
    setVersiRiwayat((v) => v + 1)
  }, [])

  const bisaUndo = riwayatIdxRef.current > 0
  const bisaRedo = riwayatIdxRef.current < riwayatRef.current.length - 1

  const undo = useCallback(() => {
    if (riwayatIdxRef.current <= 0) return
    void terapkanRiwayat(riwayatIdxRef.current - 1)
  }, [terapkanRiwayat])

  const redo = useCallback(() => {
    if (riwayatIdxRef.current >= riwayatRef.current.length - 1) return
    void terapkanRiwayat(riwayatIdxRef.current + 1)
  }, [terapkanRiwayat])

  // Pintasan papan ketik dipasang di elemen kanvas (bukan window) supaya mengetik di kolom lain
  // tidak ikut ter-undo. Saat IText sedang disunting, fabric punya undo teks internal sendiri →
  // jangan rebut pintasannya.
  const tombolPintasan = useCallback(
    (e: KeyboardEventReact<HTMLDivElement>) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return
      // Sempatkan lewat variabel lokal: `kanvas?.getActiveObject()` menghasilkan union dengan
      // undefined dan menyulitkan penyempitan tipe dari hasil instanceof.
      const sasaran = fabricRef.current?.getActiveObject()
      const teks = modulRef.current?.IText
      if (teks && sasaran instanceof teks && sasaran.isEditing) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    },
    [undo, redo]
  )

  /**
   * Blob hasil ekspor pada ukuran PRESET, bukan ukuran tampilan.
   * `toBlob` fabric menggambar ulang ke elemen canvas sementara berukuran
   * `dokumen * multiplier`; zoom tampil (mis. 0.6) dikali balik lewat multiplier.
   */
  const buatBlobEkspor = useCallback(
    async (format: FormatEkspor, kualitas: number, transparan: boolean): Promise<Blob | null> => {
      const kanvas = fabricRef.current
      if (!kanvas) return null
      const { lebar, tinggi } = presetRef.current
      const zoom = kanvas.getZoom() || 1
      const asli = kanvas.backgroundColor
      // Latar transparan hanya untuk PNG: JPEG tidak punya kanal alfa. Properti ini dibaca
      // saat render, jadi menyetelnya kosong tidak menyentuh elemen DOM kanvas editor.
      if (transparan) kanvas.backgroundColor = ""
      try {
        return await kanvas.toBlob({
          format,
          quality: kualitas,
          multiplier: Math.max(lebar / kanvas.getWidth(), tinggi / kanvas.getHeight(), 1 / zoom),
        })
      } finally {
        if (transparan) kanvas.backgroundColor = asli
        kanvas.requestRenderAll()
      }
    },
    []
  )

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
    catatRiwayat()
  }, [catatRiwayat])

  const turunLapisan = useCallback(() => {
    const kanvas = fabricRef.current
    const o = kanvas?.getActiveObject()
    if (!kanvas || !o) return
    if (!kanvas.sendObjectBackwards(o)) return // sudah paling bawah
    kanvas.requestRenderAll()
    setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
    catatRiwayat()
  }, [catatRiwayat])

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
    // Dokumen yang dimuat jadi titik awal riwayat; langkah sebelumnya tidak lagi relevan.
    riwayatRef.current = [JSON.stringify(kanvas.toObject(PROP_SERIAL))]
    riwayatIdxRef.current = 0
    setVersiRiwayat((v) => v + 1)
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
    catatRiwayat()
  }, [catatRiwayat])

  /** Picker aset → kanvas. Sama jalurnya dengan latar hasil AI: gambar terkunci di dasar. */
  const pilihAsetLatar = useCallback(
    (base64: string, mime: string) => {
      void tambahLatarGambar(base64, mime)
    },
    [tambahLatarGambar]
  )

  /**
   * Simpan keadaan dokumen SEKARANG sebagai SATU langkah undo, SEBELUM aksi AI menyentuh
   * kanvas. Ini titik yang membuat hasil AI bisa dibatalkan.
   *
   * KENAPA harus dipanggil SEBELUM, bukan sesudah seperti `catatRiwayat`:
   *   `catatRiwayat` mencatat keadaan SESUDAH perubahan — itu benar untuk aksi user satu
   *   per satu (tiap geseran sudah punya keadaan sebelumnya dari langkah sebelumnya).
   *   Untuk AI tidak: satu permintaan AI bisa menambah 12 objek, dan `object:added`
   *   memanggil `catatRiwayat` untuk tiap objek itu. Yang dibutuhkan user adalah SATU
   *   langkah undo yang mengembalikan kanvas ke keadaan SEBELUM AI menyentuhnya.
   *   Karena itu snapshot-di-depan ditulis ke riwayat lebih dulu (menggeser posisi riwayat
   *   ke keadaan itu), lalu `terapkanOperasiAi` mematikan pencatatan otomatis selama
   *   bekerja sehingga hasil akhirnya menempel di atas snapshot itu.
   *
   * Mekanismenya TIDAK baru: `riwayatRef`/`riwayatIdxRef` yang sama dengan Ctrl+Z.
   * Tidak ada riwayat kedua.
   */
  const catatSnapshotSebelumAi = useCallback(() => {
    const kanvas = fabricRef.current
    if (!kanvas) return
    const json = JSON.stringify(kanvas.toObject(PROP_SERIAL))
    const list = riwayatRef.current
    if (list[riwayatIdxRef.current] === json) return
    let idx = riwayatIdxRef.current + 1
    if (idx === list.length) list.push(json)
    else list.splice(idx, list.length, json)
    if (list.length > MAKS_RIWAYAT) {
      list.splice(0, list.length - MAKS_RIWAYAT)
      idx = list.length - 1
    }
    riwayatIdxRef.current = idx
    setVersiRiwayat((v) => v + 1)
  }, [])

  /**
   * Sisipkan elemen pustaka ke kanvas (STEP 3). Penyisipan dari MANUSIA (picker) maupun
   * dari AI lewat op `sisipkan_elemen` masuk ke sini — bentuk objeknya harus sama, jadi
   * memakai pabrik `objekDariElemen` yang sama dengan relayout.
   *
   * `undoSnapshot` dipakai oleh jalur AI: snapshot sudah diambil di `terapkanOperasiAi`
   * sebelum skrip berjalan, jadi di sini pencatatan riwayat otomatis dimatikan supaya
   * tidak menambah langkah undo kedua.
   */
  const sisipkanElemen = useCallback(
    (el: ElemenLayout, posisi: { x?: number; y?: number }, dalamSkripAi: boolean) => {
      const kanvas = fabricRef.current
      const fabric = modulRef.current
      if (!kanvas || !fabric) return
      const { lebar, tinggi } = presetRef.current
      const w = el.w ?? 200
      const h = el.h ?? 200
      const kotak: ElemenLayout = {
        ...el,
        // Pusatkan bila koordinat tidak disebut: elemen yang muncul di luar kanvas
        // terlihat persis seperti "tidak tersisip".
        x: posisi.x ?? (lebar - w) / 2,
        y: posisi.y ?? (tinggi - h) / 2,
        w,
        h,
        // Bentuk dari pustaka digambar sebagai Path; jenis "persegi"/"lingkaran" dari
        // `elemen_json` tetap dihormati kalau memang itu yang disimpan.
        jenis: el.jenis ?? "bentuk",
      }
      const o = objekDariElemen(kotak, ukuranId, fabric)
      if (!o) {
        tampilkanGagalTulis("Elemen ini belum bisa digambar di kanvas.")
        return
      }
      if (dalamSkripAi) aiSedangTerapRef.current = true
      try {
        urutRef.current += 1
        o.set({ id: `elemen-${urutRef.current}-${Date.now()}`, namaLapisan: `Elemen ${urutRef.current}` })
        kanvas.add(o)
        kanvas.setActiveObject(o)
        kanvas.requestRenderAll()
        setTerpilih(bacaProperti(o, fabric))
        setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
      } finally {
        // Riwayat otomatis dicatat lewat `object:added` saat jalur manusia; untuk jalur AI
        // gerbangnya ditutup lagi supaya tidak ada entri undo kedua.
        if (dalamSkripAi) aiSedangTerapRef.current = false
      }
    },
    [ukuranId]
  )

  /**
   * Terapkan skrip operasi AI ke kanvas. SEMUA jalur AI lewat sini — termasuk
   * `bangun_ulang` yang destruktif — supaya:
   *   1. selalu didahului snapshot undo (lihat `catatSnapshotSebelumAi`), dan
   *   2. latar terkunci tidak pernah ikut terhapus.
   * `bangun_ulang` sengaja ditangani di sini (bukan di editor-operasi.ts) karena ia
   * memakai primitif `tambahObjek`/`objekDariElemen` + `validasiLayout` yang hidup di
   * komponen ini.
   *
   * `elemenPustaka` memetakan id baris `ai_elemen` → bentuk kanoniknya. Op
   * `sisipkan_elemen` DISELESAIKAN DI SINI (bukan di editor-operasi.ts) karena butuh
   * pabrik objek yang sama dengan relayout; op yang id-nya tidak ada di peta DILEWATI
   * dengan catatan, bukan menggagalkan skrip.
   */
  const terapkanOperasiAi = useCallback(
    async (operasiMentah: OperasiKanvas[], elemenPustaka: Map<number, ElemenLayout>): Promise<HasilTerap> => {
      const kanvas = fabricRef.current
      const fabric = modulRef.current
      if (!kanvas || !fabric) return { dijalankan: 0, dilewati: operasiMentah.length, alasanDilewati: ["kanvas belum siap"] }
      // Snapshot HARUS diambil sebelum satu pun op dijalankan.
      catatSnapshotSebelumAi()
      // Matikan pencatatan otomatis selama AI bekerja: satu permintaan AI = satu langkah
      // undo. `object:added`/`object:removed` tetap dipancarkan fabric, jadi tanpa gerbang
      // ini riwayat terisi satu entri per OBJEK, bukan per AKSI.
      aiSedangTerapRef.current = true
      try {
        const rebuild = operasiMentah.filter((o) => o.op === "bangun_ulang")
        const lain = operasiMentah.filter((o) => o.op !== "bangun_ulang")

        for (const op of rebuild) {
          const bersih = validasiLayout(op.layout)
          if (!bersih.ok) {
            tampilkanGagalTulis(`Layout dari server ditolak: ${bersih.error}`)
            continue
          }
          const layout = bersih.layout
          // Latar terkunci dipertahankan; selain itu kanvas dikosongkan. Ini keputusan
          // pemilik produk (relayout destruktif diizinkan) dan aman karena snapshot undo
          // sudah diambil di atas.
          const dipertahankan = kanvas.getObjects().filter((o) => String(o.get("namaLapisan") ?? "") === "Latar")
          const sisa = kanvas.getObjects().filter((o) => !dipertahankan.includes(o))
          if (sisa.length > 0) kanvas.remove(...sisa)
          if (dipertahankan.length === 0) kanvas.clear() // tanpa latar: bersihkan juga backgroundColor
          if (layout.latarBelakang) kanvas.backgroundColor = layout.latarBelakang

          // Urutan array = z-order (index 0 paling bawah); kanvas.add selalu menaruh objek
          // baru di ATAS, jadi menambahkan berurutan sudah menghasilkan tumpukan yang sama.
          let urut = 0
          for (const el of layout.elemen) {
            const o = objekDariElemen(el, ukuranId, fabric)
            if (!o) continue
            urut += 1
            o.set({
              id: el.id || `ai-${urut}-${Date.now()}`,
              namaLapisan: `AI ${NAMA_TIPE[o instanceof fabric.IText ? "teks" : el.jenis === "garis" ? "garis" : "bentuk"]} ${urut}`,
            })
            kanvas.add(o)
          }
        }

        // Op operasional (termasuk sisipkan_elemen) dijalankan lewat penerap terpisah.
        const dilewati: string[] = []
        let dijalankan = 0
        for (const op of lain) {
          if (op.op !== "sisipkan_elemen") continue
          const el = op.elemen_id !== undefined ? elemenPustaka.get(op.elemen_id) : undefined
          if (!el) {
            dilewati.push(`sisipkan_elemen: elemen ${op.elemen_id ?? "-"} tidak ada di pustaka`)
            continue
          }
          sisipkanElemen({ ...el, ...(op.w !== undefined ? { w: op.w } : {}), ...(op.h !== undefined ? { h: op.h } : {}) }, { x: op.x, y: op.y }, true)
          dijalankan += 1
        }
        const sisaOp = lain.filter((o) => o.op !== "sisipkan_elemen")
        const hasil = terapkanOperasi(kanvas, fabric, sisaOp, () => `ai-${++urutRef.current}-${Date.now()}`)
        kanvas.discardActiveObject()
        kanvas.requestRenderAll()
        setTerpilih(null)
        setDokumenJson(JSON.stringify(kanvas.toObject(PROP_SERIAL)))
        return {
          dijalankan: hasil.dijalankan + dijalankan,
          dilewati: hasil.dilewati + dilewati.length,
          alasanDilewati: [...dilewati, ...hasil.alasanDilewati],
        }
      } finally {
        aiSedangTerapRef.current = false
      }
    },
    [catatSnapshotSebelumAi, sisipkanElemen, ukuranId]
  )

  /**
   * Fase 7: layout AI → objek fabric. Dipertahankan sebagai jalur TERPISAH untuk tombol
   * "Buat layout" (dan handle imperatif), karena maknanya masih "satu banner menggantikan
   * isi kanvas". Sejak STEP 2, jalur ini hanya pembungkus tipis di atas `terapkanOperasiAi`
   * dengan satu op `bangun_ulang` — supaya snapshot undo, latar terkunci, dan pembuatan
   * objek tidak punya dua implementasi yang bisa berbeda perilaku.
   */
  const terapkanLayout = useCallback(
    async (layoutMentah: LayoutBanner) => {
      // Layout datang dari jaringan; lewati validator yang sama dengan server. Kalau ditolak,
      // kanvas dibiarkan apa adanya — lebih baik daripada membersihkan lalu tidak menggambar apa pun.
      const bersih = validasiLayout(layoutMentah)
      if (!bersih.ok) {
        tampilkanGagalTulis(`Layout dari server ditolak: ${bersih.error}`)
        return
      }
      await terapkanOperasiAi([{ op: "bangun_ulang", layout: bersih.layout }], new Map())
    },
    [terapkanOperasiAi]
  )

  /**
   * Ringkasan elemen kanvas untuk prompt AI. Toolbar TIDAK menyentuh fabric, jadi
   * pembacaan kanvas terjadi di sini — dan hanya kolom yang dibutuhkan prompt.
   * Dimensi memakai skala objek (width × scaleX), bukan `width` mentah: nilai mentah
   * adalah ukuran sebelum diskalakan, dan AI merencanakan tata letak dalam ukuran TAMPIL.
   */
  const ringkasKanvas = useCallback(() => {
    const kanvas = fabricRef.current
    if (!kanvas) return []
    return kanvas.getObjects().map((o) => {
      // `getBoundingRect` mengembalikan kotak di koordinat DOKUMEN (bukan layar), jadi
      // zoom tampil tidak ikut terbawa ke prompt.
      const b = o.getBoundingRect()
      const t = o as { text?: unknown }
      const baris = {
        id: String(o.get("id") ?? ""),
        jenis: objekTerkunci(o) ? "latar" : (o.type ?? "lain"),
        x: Math.round(b.left),
        y: Math.round(b.top),
        w: Math.round(b.width),
        h: Math.round(b.height),
      } as { id: string; jenis: string; teks?: string; x: number; y: number; w: number; h: number }
      // Teks ikut dikirim: tanpa isinya, AI tidak bisa membedakan "judul" dari "harga",
      // dan permintaan seperti "besarkan harga" jadi tebakan.
      if (typeof t.text === "string" && t.text) baris.teks = t.text
      return baris
    })
  }, [])

  /**
   * Jalur AI dari toolbar. Dua hal yang terjadi di sini:
   *   1. `elemen_id` diselesaikan jadi bentuk kanonik lewat API pustaka (klien yang tahu
   *      presetnya; server AI tidak mengirim markup, lihat lib/desain/aiEditor.ts).
   *   2. Skrip dijalankan lewat `terapkanOperasiAi`, yang MENGAMBIL SNAPSHOT UNDO lebih
   *      dulu — itulah yang membuat seluruh aksi AI bisa dibatalkan dengan satu Ctrl+Z.
   */
  const jalankanOperasiAi = useCallback(
    async (operasi: OperasiKanvas[]) => {
      const idElemen = operasi.filter((o) => o.op === "sisipkan_elemen" && o.elemen_id !== undefined).map((o) => o.elemen_id!)
      const peta = new Map<number, ElemenLayout>()
      // Diambil satu per satu (bukan sekali batch): endpoint pustaka mengembalikan bentuk
      // kanonik lewat `?id=`, dan jumlah op sisip dalam satu permintaan selalu kecil.
      for (const id of new Set(idElemen)) {
        try {
          const res = await fetch(`/api/desain/elemen?presetId=${presetId}&id=${id}`, { credentials: "include" })
          const d = (await res.json().catch(() => null)) as { ok?: boolean; elemen?: { elemen_json?: string } } | null
          if (!res.ok || !d?.ok || !d.elemen?.elemen_json) continue
          const kanonik = JSON.parse(d.elemen.elemen_json) as ElemenLayout
          peta.set(id, kanonik)
        } catch {
          // Elemen yang gagal diambil dilewati; op-nya dilaporkan sebagai dilewati.
        }
      }
      const hasil = await terapkanOperasiAi(operasi, peta)
      if (hasil.dilewati > 0) {
        toast.warning(`${hasil.dijalankan} operasi dijalankan, ${hasil.dilewati} dilewati.`)
      } else {
        toast.success(`${hasil.dijalankan} operasi diterapkan. Ctrl+Z untuk membatalkan.`)
      }
    },
    [presetId, terapkanOperasiAi]
  )


  /** JSON dokumen saat ini; dipakai simpan desain dan handle imperatif. */
  const ambilDokumen = useCallback(() => {
    const kanvas = fabricRef.current
    return kanvas ? JSON.stringify(kanvas.toObject(PROP_SERIAL)) : dokumenJson
  }, [dokumenJson])

  /**
   * Buka daftar desain dari server, lalu tampilkan dialog. `memuat` dipakai dialog untuk
   * menampilkan spinner selama daftar belum tiba.
   */
  const bukaDaftarDesain = useCallback(async () => {
    setDialogDesain({ jenis: "buka", daftar: [], memuat: true })
    try {
      const res = await fetch(`/api/desain?presetId=${presetId}`, { credentials: "include" })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; desain?: DesainRingkas[]; error?: string } | null
      if (!res.ok || !d?.ok) {
        setDialogDesain(null)
        tampilkanGagalTulis(d?.error ?? `Gagal memuat daftar desain (${res.status}).`)
        return
      }
      setDialogDesain({ jenis: "buka", daftar: d.desain ?? [], memuat: false })
    } catch (e) {
      setDialogDesain(null)
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi server.")
    }
  }, [presetId])

  /**
   * Simpan dokumen sekarang. `desainId` ada → UPDATE baris yang sama; tanpa itu server
   * membuat desain baru dan id-nya disimpan supaya klik "Simpan" berikutnya tidak menduplikasi.
   * Ukuran dokumen TIDAK diubah di sini: dokumen dan preset ukuran harus tetap sepasang.
   */
  const simpanDesain = useCallback(async (nama: string) => {
    setMenyimpan(true)
    try {
      const res = await fetch("/api/desain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          aksi: "simpan",
          presetId,
          id: desainId ?? undefined,
          nama,
          ukuran: ukuranId,
          dokumen_json: ambilDokumen(),
        }),
      })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; id?: number; error?: string } | null
      if (!res.ok || !d?.ok || typeof d.id !== "number") {
        tampilkanGagalTulis(d?.error ?? `Gagal menyimpan desain (${res.status}).`)
        return
      }
      setDesainId(d.id)
      setDialogDesain(null)
      toast.success(`Desain "${nama}" tersimpan.`)
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi server.")
    } finally {
      setMenyimpan(false)
    }
  }, [presetId, ukuranId, desainId, ambilDokumen])

  /**
   * Muat satu desain: ukuran dokumen diambil dari `dokumen_json` (bukan dari kolom `ukuran`),
   * supaya kanvas dan isi dokumen dijamin sepasang. Setelah itu `desainId` diset → simpan berikutnya UPDATE.
   */
  const muatDesain = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/desain?presetId=${presetId}&id=${id}`, { credentials: "include" })
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; desain?: { nama?: string; ukuran?: string; dokumen_json?: string }; error?: string }
        | null
      if (!res.ok || !d?.ok || !d.desain?.dokumen_json) {
        tampilkanGagalTulis(d?.error ?? `Gagal membuka desain (${res.status}).`)
        return
      }
      const mentah = d.desain.dokumen_json
      const dok = JSON.parse(mentah) as DokumenKanvas
      // `muatDokumen` tidak mengubah dimensi, jadi dokumen WAJIB dimuat ke preset yang ukurannya
      // sama dengan saat disimpan — kalau tidak, posisi elemen meleset dari kanvas.
      const cocok = Object.values(PRESET).find((p) => p.lebar === dok.width && p.tinggi === dok.height)
      if (cocok && cocok.id !== ukuranId) setUkuranId(cocok.id)
      // Fabric di-import dinamis; kanvas baru siap setelah import + render pertama.
      // Menunggu di sini supaya "buka desain" yang diklik cepat tidak diam-diam tidak jalan.
      for (let i = 0; i < 20 && !fabricRef.current; i += 1) {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, 50)
        await promise
      }
      await muatDokumen(mentah)
      setDesainId(id)
      setDialogDesain(null)
      toast.success(`Desain "${d.desain.nama ?? ""}" dibuka.`)
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal membuka desain.")
    }
  }, [presetId, ukuranId, muatDokumen])

  const bukaDialogSimpan = useCallback(() => {
    // Nama default: tanggal lokal (bukan ISO UTC) karena admin membacanya sebagai "hari ini".
    setDialogDesain({ jenis: "simpan", nama: `Desain ${new Date().toLocaleDateString("id-ID")}` })
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
      terapkanLayout,
    }),
    [dokumenJson, muatDokumen, tambahLatarGambar, terapkanLayout]
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

        {/* Undo/redo mengikuti riwayat dokumen (bukan riwayat node kanvas). */}
        <Button
          variant="outline"
          size="sm"
          onClick={undo}
          disabled={!bisaUndo}
          title="Undo (Ctrl+Z)"
          data-testid="undo-editor"
        >
          <Undo2 />
          Undo
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={redo}
          disabled={!bisaRedo}
          title="Redo (Ctrl+Shift+Z)"
          data-testid="redo-editor"
        >
          <Redo2 />
          Redo
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
          <Button variant="outline" size="sm" onClick={() => setDialogEkspor(true)} data-testid="ekspor-editor">
            <Download />
            Ekspor
          </Button>
          <Button variant="outline" size="sm" onClick={bukaDialogSimpan} data-testid="simpan-desain">
            <Save />
            Simpan
          </Button>
          <Button variant="outline" size="sm" onClick={() => void bukaDaftarDesain()} data-testid="buka-desain">
            <FolderOpen />
            Buka
          </Button>
          <span className="text-muted-foreground text-xs" data-testid="info-dokumen">
            {dokumenJson ? "Dokumen siap disimpan" : "Dokumen kosong"}
          </span>
          <Select value={ukuranId} onValueChange={(v) => setUkuranId(v as PresetId)}>
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
          onKeyDown={tombolPintasan}
          tabIndex={0}
          className="min-w-[320px] flex-1 overflow-hidden rounded-md border bg-muted/30 outline-none"
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

      {/* Picker aset: latar + folder. Di bawah kanvas supaya kanvas tetap dapat lebar penuh. */}
      <EditorPickerAset presetId={presetId} onPilihAset={pilihAsetLatar} />

      {/* Pustaka elemen vektor: disisipkan manual maupun oleh AI (op sisipkan_elemen). */}
      <EditorElemen
        presetId={presetId}
        onPilihElemen={(el) => sisipkanElemen(el, {}, false)}
      />

      {/* Toolbar AI: skrip operasi dari server diterapkan lewat `terapkanOperasiAi`, yang
          menyimpan snapshot undo lebih dulu — satu Ctrl+Z membatalkan seluruh aksi AI. */}
      <EditorToolbarAi
        presetId={presetId}
        ukuran={ukuranId}
        ringkasKanvas={ringkasKanvas}
        onOperasiTerbuat={(ops) => void jalankanOperasiAi(ops)}
      />

      {/* Pengaturan AI editor per akun: model, reasoning, plafon token. Tanpa ini editor
          memakai model teks global dan tidak punya pagar panjang jawaban (defect yang
          diperbaiki); pilihan model sendiri menyusul di migrasi 0037. */}
      <EditorAiSetting />

      {/* Dialog simpan: nama diminta di sini (bukan window.prompt) supaya bisa menyertakan
          informasi ukuran dan status "desain lama akan ditimpa". */}
      <Dialog open={dialogDesain?.jenis === "simpan"} onOpenChange={(v) => !v && setDialogDesain(null)}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-simpan-desain">
          <DialogHeader>
            <DialogTitle>Simpan desain</DialogTitle>
            <DialogDescription>
              {desainId
                ? `Menyimpan ulang desain #${desainId} (${ukuranId}).`
                : `Desain baru akan dibuat (${ukuranId}).`}
            </DialogDescription>
          </DialogHeader>
          {dialogDesain?.jenis === "simpan" && (
            <div className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="nama-desain">Nama desain</FieldLabel>
                <Input
                  id="nama-desain"
                  value={dialogDesain.nama}
                  onChange={(e) => setDialogDesain({ jenis: "simpan", nama: e.target.value })}
                  data-testid="nama-desain"
                />
              </Field>
              <DialogFooter>
                <Button
                  className="h-11 md:h-8"
                  disabled={menyimpan}
                  onClick={() => void simpanDesain(dialogDesain.nama.trim() || `Desain ${new Date().toLocaleDateString("id-ID")}`)}
                  data-testid="konfirmasi-simpan-desain"
                >
                  {menyimpan ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                  Simpan
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog buka: daftar desain preset ini (nama + ukuran + waktu). */}
      <Dialog open={dialogDesain?.jenis === "buka"} onOpenChange={(v) => !v && setDialogDesain(null)}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-buka-desain">
          <DialogHeader>
            <DialogTitle>Buka desain</DialogTitle>
            <DialogDescription>Desain yang dibuka menggantikan isi kanvas, termasuk riwayat undo.</DialogDescription>
          </DialogHeader>
          {dialogDesain?.jenis === "buka" && (
            <div className="flex flex-col gap-2" data-testid="daftar-desain">
              {dialogDesain.memuat ? (
                <p className="text-sm text-muted-foreground">Memuat…</p>
              ) : dialogDesain.daftar.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="desain-kosong">
                  Belum ada desain tersimpan.
                </p>
              ) : (
                dialogDesain.daftar.map((d) => (
                  <Button
                    key={d.id}
                    variant="outline"
                    className="h-auto w-full justify-start py-2 text-left"
                    onClick={() => void muatDesain(d.id)}
                    data-testid={`buka-desain-${d.id}`}
                  >
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="truncate font-medium">{d.nama}</span>
                      <span className="text-xs text-muted-foreground">
                        {d.ukuran} · {new Date(d.updated_at * 1000).toLocaleString("id-ID")}
                      </span>
                    </span>
                  </Button>
                ))
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <EditorExportDialog
        open={dialogEkspor}
        onOpenChange={setDialogEkspor}
        buatBlob={buatBlobEkspor}
        lebar={presetRef.current.lebar}
        tinggi={presetRef.current.tinggi}
      />
    </div>
  )
})
