"use client"

// components/dashboard/editor-elemen.tsx — Pustaka ELEMEN VEKTOR di panel editor (STEP 3).
//
// MANDIRI seperti EditorPickerAset: komponen ini memanggil API-nya sendiri dan TIDAK
// menyentuh kanvas. Hasilnya diserahkan lewat `onPilihElemen` (bentuk kanonik elemen),
// jadi fabric tidak di-import di sini.
//
// KENAPA `elemen_json` DIURAI DI SINI, bukan dikirim server dalam bentuk siap-pakai:
//   Bentuk kanonik elemen adalah urusan RENDER (klien). Server menyimpannya apa adanya
//   supaya bentuk yang sudah dipakai di desain lama tidak berubah oleh perubahan versi
//   parser. Yang dibutuhkan komponen ini hanya satu elemen per klik, jadi `?id=` dipakai
//   dan daftarnya tetap ringan (tanpa `svg`/`elemen_json`).
import { useCallback, useEffect, useRef, useState } from "react"
import type { ChangeEvent, ReactNode } from "react"
import { ImageOff, Plus, Shapes, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import type { ElemenLayout } from "@/lib/desain/skemaLayout"

/** Batas unggah elemen: cerminan MAKS_ELEMEN_BYTE di lib/d1/elemenDesain.ts (server menolak di atas ini). */
const MAKS_UNGGAH = 64 * 1024
/** Batas nama elemen — cerminan MAKS_NAMA lapisan data. */
const MAKS_NAMA = 120

type ElemenRingkas = { id: number; nama: string; kategori: string; byte: number; at: number }
type ElemenPenuh = ElemenRingkas & { svg: string; elemen_json: string }

const KATEGORI = ["bentuk", "ikon", "panah", "hiasan"] as const

/** 42,0 KB — satu desimal cukup, user membacanya sebagai ukuran, bukan angka pajak. */
function formatByte(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1).replace(".", ",")} KB`
}

/** Bungkus fetch JSON seragam: `credentials: include` (pola repo) + error server diteruskan. */
async function mintaJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { credentials: "include", ...init })
  const d = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !d?.ok) throw new Error(typeof d?.error === "string" ? d.error : `Permintaan gagal (${res.status}).`)
  return d
}

function bacaBerkas(f: File): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result ?? ""))
  reader.onerror = () => reject(new Error(`Gagal membaca ${f.name}.`))
  reader.readAsText(f)
  return promise
}

interface Props {
  presetId: number
  /** Bentuk kanonik elemen siap-sisip; editor yang menentukan posisi & id dokumen. */
  onPilihElemen: (el: ElemenLayout) => void
}

/**
 * Ubah `elemen_json` (teks) → bentuk yang dipakai `objekDariElemen`.
 * Gagal urai = `null`; pemanggil menampilkan pesan, tidak menebak-nebak isi yang rusak.
 */
function bacaElemen(json: string): ElemenLayout | null {
  try {
    const v = JSON.parse(json) as Partial<ElemenLayout>
    if (typeof v !== "object" || v === null) return null
    const w = Number(v.w)
    const h = Number(v.h)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
    return {
      id: "",
      // Kategori pustaka ("ikon"/"panah") bukan jenis render; `JenisElemen` tidak punya
      // anggota "bentuk". Yang tak dikenal jadi "persegi" — elemen tetap bisa digambar.
      jenis: v.jenis === "lingkaran" || v.jenis === "garis" || v.jenis === "teks" ? v.jenis : "persegi",
      x: 0,
      y: 0,
      w,
      h,
      ...(typeof v.warna === "string" ? { warna: v.warna } : {}),
      ...(typeof v.font === "string" ? { font: v.font } : {}),
    }
  } catch {
    return null
  }
}

export function EditorElemen({ presetId, onPilihElemen }: Props): ReactNode {
  const [elemen, setElemen] = useState<ElemenRingkas[]>([])
  const [kategori, setKategori] = useState<string>("")
  const [cari, setCari] = useState("")
  const [memuat, setMemuat] = useState(true)
  const [sibuk, setSibuk] = useState(false)
  const berkasRef = useRef<HTMLInputElement>(null)

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const qs = new URLSearchParams({ presetId: String(presetId) })
      if (kategori) qs.set("kategori", kategori)
      if (cari.trim()) qs.set("q", cari.trim())
      const d = await mintaJson(`/api/desain/elemen?${qs.toString()}`)
      setElemen((d.elemen ?? []) as ElemenRingkas[])
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat pustaka elemen.")
    } finally {
      setMemuat(false)
    }
  }, [presetId, kategori, cari])

  useEffect(() => {
    void muat()
  }, [muat])

  /** Ambil satu elemen penuh, lalu serahkan bentuk kanoniknya ke editor. */
  async function pilih(id: number) {
    setSibuk(true)
    try {
      const d = await mintaJson(`/api/desain/elemen?presetId=${presetId}&id=${id}`)
      const e = d.elemen as ElemenPenuh | null
      if (!e) throw new Error("Elemen tidak ditemukan.")
      const kanonik = bacaElemen(e.elemen_json)
      if (!kanonik) throw new Error("Bentuk elemen rusak dan tidak bisa digambar.")
      onPilihElemen(kanonik)
      toast.success(`Elemen "${e.nama}" disisipkan.`)
    } catch (err) {
      tampilkanGagalTulis(err instanceof Error ? err.message : "Gagal menyisipkan elemen.")
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
      toast.error(`Elemen ${formatByte(f.size)} — batasnya ${formatByte(MAKS_UNGGAH)}.`)
      return
    }
    setSibuk(true)
    try {
      const svg = await bacaBerkas(f)
      await mintaJson("/api/desain/elemen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId,
          aksi: "simpan",
          nama: f.name.replace(/\.[^.]+$/, "").slice(0, MAKS_NAMA),
          kategori: kategori || "bentuk",
          svg,
        }),
      })
      await muat()
      toast.success("Elemen ditambahkan ke pustaka.")
    } catch (err) {
      tampilkanGagalTulis(err instanceof Error ? err.message : "Gagal menyimpan elemen.")
    } finally {
      setSibuk(false)
    }
  }

  async function hapus(id: number, nama: string) {
    if (!window.confirm(`Hapus elemen "${nama}" dari pustaka?`)) return
    setSibuk(true)
    try {
      await mintaJson("/api/desain/elemen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId, aksi: "hapus", id }),
      })
      await muat()
      toast.success("Elemen dihapus dari pustaka.")
    } catch (err) {
      tampilkanGagalTulis(err instanceof Error ? err.message : "Gagal menghapus elemen.")
    } finally {
      setSibuk(false)
    }
  }

  return (
    <Card data-testid="picker-elemen">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shapes className="size-4" />
          Pustaka elemen
          {sibuk ? <Spinner className="ml-auto" /> : null}
        </CardTitle>
        <CardDescription>
          Elemen vektor bisa disisipkan ke kanvas berulang kali tanpa menambah ukuran gambar. AI juga
          boleh memakai elemen di sini lewat perintah &quot;tambah ikon panah&quot; dan sejenisnya.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={kategori === "" ? "default" : "outline"}
            size="sm"
            data-testid="elemen-semua"
            onClick={() => setKategori("")}
          >
            Semua
          </Button>
          {KATEGORI.map((k) => (
            <Button
              key={k}
              variant={kategori === k ? "default" : "outline"}
              size="sm"
              data-testid={`elemen-kategori-${k}`}
              onClick={() => setKategori(k)}
            >
              {k}
            </Button>
          ))}
        </div>

        <div className="flex gap-2">
          <Input
            className="h-11 md:h-8"
            placeholder="Cari elemen…"
            data-testid="cari-elemen"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
          />
          <input
            ref={berkasRef}
            type="file"
            accept=".svg,image/svg+xml"
            className="hidden"
            data-testid="berkas-elemen"
            onChange={(e) => void unggah(e)}
          />
          <Button
            variant="outline"
            className="h-11 md:h-8"
            data-testid="unggah-elemen"
            disabled={sibuk}
            onClick={() => berkasRef.current?.click()}
          >
            <Upload />
            Unggah SVG
          </Button>
        </div>

        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto" data-testid="daftar-elemen">
          {memuat && elemen.length === 0 ? (
            <Spinner />
          ) : elemen.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ImageOff className="size-4" /> Belum ada elemen di pustaka ini.
            </p>
          ) : (
            elemen.map((el) => (
              <div key={el.id} className="flex items-center gap-2 rounded-lg border border-border p-2" data-testid={`elemen-${el.id}`}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Sisipkan ke kanvas"
                  data-testid={`sisip-elemen-${el.id}`}
                  disabled={sibuk}
                  onClick={() => void pilih(el.id)}
                >
                  <Plus />
                </Button>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{el.nama}</span>
                  <span className="text-xs text-muted-foreground">
                    {el.kategori} · {formatByte(el.byte)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Hapus elemen"
                  data-testid={`hapus-elemen-${el.id}`}
                  disabled={sibuk}
                  onClick={() => void hapus(el.id, el.nama)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
