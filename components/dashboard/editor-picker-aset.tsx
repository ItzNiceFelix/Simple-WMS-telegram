"use client"

// components/dashboard/editor-picker-aset.tsx — Panel kiri Studio Gambar mode Editor (Fase 6).
//
// MANDIRI: komponen ini memanggil API-nya sendiri dan TIDAK menyentuh kanvas. Kanvas hanya
// menerima hasilnya lewat `onPilihAset` (base64 + mime). Karena itu fabric TIDAK di-import
// di sini — menambah import fabric berarti bundel panel ikut menyeret kanvas (ratusan KB)
// padahal panel tidak pernah menggambar apa pun.
//
// Semua daftar (folder & latar) DIMUAT ULANG dari server setelah setiap mutasi. Optimistic
// update dilarang di sini: folder bersarang + SET NULL pada hapus membuat siswa mustahil
// menebak hasil akhir tanpa jawaban server.
import { useCallback, useEffect, useRef, useState } from "react"
import type { ChangeEvent, ReactNode } from "react"
import { toast } from "sonner"
import { FolderPlus, HardDrive, ImageOff, Pencil, Search, Trash2, Upload } from "lucide-react"

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
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

/** Batas unggah manual: sama dengan MAKS_LATAR di lib/d1/desain.ts (server menolak > 4 MB). */
const MAKS_UNGGAH = 4 * 1024 * 1024
/** Batas nama folder — cerminan MAKS_NAMA di lapisan data, supaya error tidak datang dari server. */
const MAKS_NAMA = 120

/** Folder terpilih: `null` = "Semua", `-1` = "tanpa folder" (server pakai folder_id IS NULL), angka = id. */
type PilihFolder = number | null

type FolderDesain = { id: number; nama: string; parent_id: number | null; at: number; oleh: string | null }
type LatarRingkas = { id: number; nama: string; mime: string; byte: number; folder_id: number | null; folder_manual: number; at: number }

interface Props {
  presetId: number
  /** Serahkan base64 (tanpa prefix data URL) + mime ke kanvas. */
  onPilihAset: (base64: string, mime: string) => void
}

/** 420 KB / 12,4 MB. Satu desimal cukup: user membaca ini sebagai kuota, bukan angka pajak. */
function formatByte(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 KB"
  const kb = n / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1).replace(".", ",")} MB`
}

/** Baca berkas gambar → { base64, mime }. Error dibiarkan naik ke pemanggil untuk di-toast. */
function bacaBerkas(f: File): Promise<{ base64: string; mime: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ base64: string; mime: string }>()
  const reader = new FileReader()
  reader.onload = () => {
    const hasil = String(reader.result ?? "")
    const koma = hasil.indexOf(",")
    resolve({ base64: koma > 0 ? hasil.slice(koma + 1) : hasil, mime: f.type || "image/png" })
  }
  reader.onerror = () => reject(new Error(`Gagal membaca ${f.name}.`))
  reader.readAsDataURL(f)
  return promise
}

/** Bungkus fetch JSON seragam: `credentials: include` (pola repo) + error server diteruskan. */
async function mintaJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { credentials: "include", ...init })
  const d = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !d?.ok) throw new Error(typeof d?.error === "string" ? d.error : `Permintaan gagal (${res.status}).`)
  return d
}

/**
 * Thumbnail yang menunggu barisnya terlihat sebelum menarik base64 dari server.
 * `onLoad` dipanggil sekali; cache di induk membuat gulir bolak-balik tidak refetch.
 */
function ThumbLatar({ src, alt, onLoad }: { src: string | undefined; alt: string; onLoad: () => void }) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    if (src) return
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onLoad(), { rootMargin: "120px" })
    obs.observe(el)
    return () => obs.disconnect()
  }, [src, onLoad])
  return (
    <img
      ref={ref} src={src} alt={alt}
      className="size-14 rounded bg-muted object-cover"
    />
  )
}

export function EditorPickerAset({ presetId, onPilihAset }: Props) {
  const [folder, setFolder] = useState<FolderDesain[]>([])
  const [latar, setLatar] = useState<LatarRingkas[]>([])
  const [totalByte, setTotalByte] = useState(0)
  const [terpilih, setTerpilih] = useState<PilihFolder>(null) // null = "Semua"
  const [cari, setCari] = useState("")
  const [memuat, setMemuat] = useState(true)
  const [sibuk, setSibuk] = useState(false)

  // Dialog: satu state untuk tiga niat (buat/ubah-nama/hapus) — tiga boolean terpisah
  // membuat kombinasi mustahil (dua dialog terbuka) harus dijaga manual.
  const [dialog, setDialog] = useState<
    | { jenis: "buat"; parentId: number | null; nama: string }
    | { jenis: "ubah-nama"; id: number; nama: string }
    | { jenis: "hapus-folder"; id: number; nama: string }
    | { jenis: "hapus-latar"; id: number; nama: string }
    | null
  >(null)
  const [pindahUntuk, setPindahUntuk] = useState<number | null>(null)
  const [thumb, setThumb] = useState<Record<number, string>>({})
  const berkasRef = useRef<HTMLInputElement>(null)

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const qsLatar = new URLSearchParams({ presetId: String(presetId) })
      if (terpilih === -1) qsLatar.set("folderId", "root")
      else if (typeof terpilih === "number") qsLatar.set("folderId", String(terpilih))
      if (cari.trim()) qsLatar.set("q", cari.trim())
      const [dFolder, dLatar] = await Promise.all([
        mintaJson(`/api/desain/folder?presetId=${presetId}`),
        mintaJson(`/api/desain/latar?${qsLatar.toString()}`),
      ])
      setFolder((dFolder.folder ?? []) as FolderDesain[])
      setLatar((dLatar.latar ?? []) as LatarRingkas[])
      setTotalByte(Number(dLatar.total_byte ?? 0))
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat aset.")
    } finally {
      setMemuat(false)
    }
  }, [presetId, terpilih, cari])

  useEffect(() => {
    void muat()
  }, [muat])

  /** POST ke endpoint mutasi, lalu muat ulang dari server. Tidak ada update optimistis. */
  async function kirim(url: string, body: Record<string, unknown>): Promise<boolean> {
    setSibuk(true)
    try {
      await mintaJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      await muat()
      return true
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyimpan.")
      return false
    } finally {
      setSibuk(false)
    }
  }

  async function unggah(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    // Reset value: berkas yang sama dipilih dua kali tidak memicu onChange kalau input masih berisi.
    e.target.value = ""
    if (!f) return
    if (f.size > MAKS_UNGGAH) {
      toast.error(`Gambar ${formatByte(f.size)} — batasnya 4 MB.`)
      return
    }
    try {
      const { base64, mime } = await bacaBerkas(f)
      const ok = await kirim("/api/desain/latar", {
        presetId,
        aksi: "simpan",
        nama: f.name.replace(/\.[^.]+$/, "").slice(0, MAKS_NAMA),
        mime,
        base64,
        // folder_manual=1 menandai aset ini datang dari unggahan user, bukan hasil AI.
        folder_manual: true,
        folderId: typeof terpilih === "number" && terpilih >= 0 ? terpilih : null,
      })
      if (ok) toast.success("Latar diunggah.")
    } catch (err) {
      tampilkanGagalTulis(err instanceof Error ? err.message : "Gagal membaca gambar.")
    }
  }

  /** Ambil base64 satu latar lewat `?id=` (daftar sengaja tidak membawa base64). */
  async function pilihLatar(id: number) {
    setSibuk(true)
    try {
      const d = await mintaJson(`/api/desain/latar?presetId=${presetId}&id=${id}`)
      const l = d.latar as { base64?: string; mime?: string } | null
      if (!l?.base64) throw new Error("Latar tidak punya data gambar.")
      onPilihAset(l.base64, l.mime || "image/png")
      toast.success("Latar dipakai di kanvas.")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal mengambil latar.")
    } finally {
      setSibuk(false)
    }
  }

  /**
   * Thumbnail dimuat saat baris benar-benar terlihat. Daftar latar sengaja TIDAK membawa
   * base64 (bisa megabita × ratusan baris), tapi user tetap butuh melihat asetnya —
   * IntersectionObserver menarik satu per satu hanya untuk baris di layar.
   */
  async function muatThumb(id: number) {
    if (thumb[id]) return
    try {
      const d = await mintaJson(`/api/desain/latar?presetId=${presetId}&id=${id}`)
      const l = d.latar as { base64?: string; mime?: string } | null
      if (!l?.base64) return
      setThumb((t) => (t[id] ? t : { ...t, [id]: `data:${l.mime || "image/png"};base64,${l.base64}` }))
    } catch {
      // Thumbnail gagal tidak boleh mengganggu: baris tetap bisa diklik/hapus.
    }
  }

  /** Baris pohon folder (rekursif). "Semua"/"Tanpa folder" ditangani pemanggil. */
  function pohon(parent: number | null, dalam: number): ReactNode {
    return folder.filter((f) => (f.parent_id ?? null) === parent).map((f) => (
      <div key={f.id}>
        <div
          className={`flex items-center gap-1 rounded-md px-1 ${terpilih === f.id ? "bg-accent text-accent-foreground" : ""}`}
          style={{ paddingLeft: `${dalam * 12 + 4}px` }}
        >
          <button
            type="button"
            className="min-h-11 flex-1 truncate py-1 text-left text-sm md:min-h-0"
            data-testid={`folder-${f.id}`}
            onClick={() => setTerpilih(f.id)}
          >
            {f.nama}
          </button>
          <Button
            variant="ghost" size="icon-sm" title="Folder baru di dalam ini"
            onClick={() => setDialog({ jenis: "buat", parentId: f.id, nama: "" })}
          >
            <FolderPlus />
          </Button>
          <Button
            variant="ghost" size="icon-sm" title="Ubah nama"
            onClick={() => setDialog({ jenis: "ubah-nama", id: f.id, nama: f.nama })}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost" size="icon-sm" title="Hapus folder"
            onClick={() => setDialog({ jenis: "hapus-folder", id: f.id, nama: f.nama })}
          >
            <Trash2 />
          </Button>
        </div>
        {pohon(f.id, dalam + 1)}
      </div>
    ))
  }

  const namaDialog =
    dialog?.jenis === "buat" ? "Folder baru"
    : dialog?.jenis === "ubah-nama" ? "Ubah nama folder"
    : dialog?.jenis === "hapus-folder" ? "Hapus folder"
    : "Hapus latar"

  // Dialog nama folder dipakai dua niat; disempitkan sekali di sini supaya JSX tidak
  // memaksa TypeScript menebak jenis di dalam handler.
  const dialogNama = dialog?.jenis === "buat" || dialog?.jenis === "ubah-nama" ? dialog : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="picker-aset">
      {/* ── Kuota: alasan user minta panel ini. Selalu tampil, ikut semua filter. ── */}
      <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm" data-testid="total-aset">
        <HardDrive className="size-4 text-muted-foreground" />
        <span>Total aset: {formatByte(totalByte)}</span>
        {sibuk ? <Spinner className="ml-auto" /> : null}
      </div>

      {/* ── Pohon folder ── */}
      <div className="flex flex-col gap-1" data-testid="pohon-folder">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Folder</span>
          <Button
            variant="outline" size="sm" data-testid="folder-baru"
            onClick={() => setDialog({ jenis: "buat", parentId: null, nama: "" })}
          >
            <FolderPlus /> Folder baru
          </Button>
        </div>
        <button
          type="button"
          className={`min-h-11 rounded-md px-1 py-1 text-left text-sm md:min-h-0 ${terpilih === null ? "bg-accent text-accent-foreground" : ""}`}
          data-testid="folder-semua"
          onClick={() => setTerpilih(null)}
        >
          Semua
        </button>
        <button
          type="button"
          className={`min-h-11 rounded-md px-1 py-1 text-left text-sm md:min-h-0 ${terpilih === -1 ? "bg-accent text-accent-foreground" : ""}`}
          data-testid="folder-tanpa"
          onClick={() => setTerpilih(-1)}
        >
          Tanpa folder
        </button>
        <div className="flex max-h-48 flex-col overflow-y-auto">{pohon(null, 0)}</div>
      </div>

      {/* ── Pencarian + unggah ── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-8 md:h-8" data-testid="cari-latar" placeholder="Cari latar…"
            value={cari} onChange={(e) => setCari(e.target.value)}
          />
        </div>
        <input
          ref={berkasRef} type="file" accept="image/*" className="hidden" data-testid="berkas-latar"
          onChange={(e) => void unggah(e)}
        />
        <Button variant="outline" className="h-11 md:h-8" data-testid="unggah-latar" disabled={sibuk} onClick={() => berkasRef.current?.click()}>
          <Upload /> Unggah
        </Button>
      </div>

      {/* ── Daftar latar ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {memuat && latar.length === 0 ? <Spinner /> : latar.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageOff className="size-4" /> Belum ada latar di sini.
          </p>
        ) : latar.map((l) => (
          <div key={l.id} className="flex gap-2 rounded-lg border border-border p-2" data-testid={`latar-${l.id}`}>
            <button type="button" className="shrink-0" onClick={() => void pilihLatar(l.id)} title="Pakai latar ini">
              <ThumbLatar src={thumb[l.id]} alt={l.nama} onLoad={() => void muatThumb(l.id)} />
            </button>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{l.nama}</span>
              <span className="text-xs text-muted-foreground">
                {formatByte(l.byte)}{l.folder_manual ? " · manual" : ""}
              </span>
            </div>
            <div className="flex shrink-0 items-start gap-1">
              <Button
                variant="ghost" size="icon-sm" title="Pindah folder"
                data-testid={`pindah-latar-${l.id}`}
                onClick={() => setPindahUntuk(l.id)}
              >
                <FolderPlus />
              </Button>
              <Button
                variant="ghost" size="icon-sm" title="Hapus latar"
                data-testid={`hapus-latar-${l.id}`}
                onClick={() => setDialog({ jenis: "hapus-latar", id: l.id, nama: l.nama })}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Dialog folder: buat / ubah nama ── */}
      <AlertDialog open={dialogNama !== null} onOpenChange={(v) => { if (!v && !sibuk) setDialog(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{namaDialog}</AlertDialogTitle>
            <AlertDialogDescription>Nama folder maksimal {MAKS_NAMA} karakter.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus maxLength={MAKS_NAMA} value={dialogNama?.nama ?? ""}
            data-testid="input-nama-folder"
            onChange={(e) => {
              const v = e.target.value
              setDialog((d) => (d && (d.jenis === "buat" || d.jenis === "ubah-nama") ? { ...d, nama: v } : d))
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk || !dialogNama?.nama.trim()}
              onClick={() => {
                if (!dialogNama) return
                const body =
                  dialogNama.jenis === "buat"
                    ? { aksi: "simpan", nama: dialogNama.nama.trim(), parentId: dialogNama.parentId }
                    : { aksi: "ubah-nama", id: dialogNama.id, nama: dialogNama.nama.trim() }
                void kirim("/api/desain/folder", { presetId, ...body }).then((ok) => { if (ok) setDialog(null) })
              }}
            >
              Simpan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Dialog hapus folder ── */}
      <AlertDialog open={dialog?.jenis === "hapus-folder"} onOpenChange={(v) => { if (!v && !sibuk) setDialog(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus folder</AlertDialogTitle>
            <AlertDialogDescription>
              Folder {dialog?.jenis === "hapus-folder" ? `"${dialog.nama}"` : ""} beserta subfolder di dalamnya akan dihapus.
              Aset dan desain di dalamnya TIDAK ikut terhapus — keduanya hanya kehilangan folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={() => {
                if (dialog?.jenis !== "hapus-folder") return
                void kirim("/api/desain/folder", { presetId, aksi: "hapus", id: dialog.id }).then((ok) => { if (ok) setDialog(null) })
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Dialog hapus latar ── */}
      <AlertDialog open={dialog?.jenis === "hapus-latar"} onOpenChange={(v) => { if (!v && !sibuk) setDialog(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus latar</AlertDialogTitle>
            {/* Perilaku nyata ON DELETE SET NULL: desain tetap ada, latarnya jadi kosong. */}
            <AlertDialogDescription>
              Latar {dialog?.jenis === "hapus-latar" ? `"${dialog.nama}"` : ""} akan dihapus permanen.
              Desain yang memakai latar ini TIDAK ikut terhapus — desainnya tetap ada, hanya latarnya menjadi kosong.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={() => {
                if (dialog?.jenis !== "hapus-latar") return
                void kirim("/api/desain/latar", { presetId, aksi: "hapus", id: dialog.id }).then((ok) => { if (ok) setDialog(null) })
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Dialog pindah folder (latar) ── */}
      <AlertDialog open={pindahUntuk !== null} onOpenChange={(v) => { if (!v && !sibuk) setPindahUntuk(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pindah ke folder</AlertDialogTitle>
            <AlertDialogDescription>Pilih tujuan latar ini.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            <Button variant="outline" className="justify-start" data-testid="tujuan-tanpa"
              onClick={() => { const id = pindahUntuk; void kirim("/api/desain/latar", { presetId, aksi: "pindah", id, folderId: null }).then((ok) => { if (ok) setPindahUntuk(null) }) }}>
              Tanpa folder
            </Button>
            {folder.map((f) => (
              <Button key={f.id} variant="outline" className="justify-start" data-testid={`tujuan-${f.id}`}
                onClick={() => { const id = pindahUntuk; void kirim("/api/desain/latar", { presetId, aksi: "pindah", id, folderId: f.id }).then((ok) => { if (ok) setPindahUntuk(null) }) }}>
                {f.nama}
              </Button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>Batal</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
