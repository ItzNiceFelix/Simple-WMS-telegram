"use client"

// components/dashboard/ai-gambar-studio.tsx — Studio gambar produk (Fase D, rencana §4).
// Semua state di memori klien. Hasil gambar TIDAK diunggah ke DB — hanya base64
// yang dikembalikan route /api/ai/gambar; simpan = unduh, kirim = Telegram.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Download, Plus, RefreshCw, Send, Sparkles, Trash2, Wand2 } from "lucide-react"

import { KanvasAnotasi } from "@/components/dashboard/kanvas-anotasi"
import { AiGambarSetting, muatSettingGambar, type ModelGambar, type SettingGambar } from "@/components/dashboard/ai-gambar-setting"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import type { AreaGambar } from "@/lib/ai/areaGambar"

const MAKS_REFERENSI = 5

type PresetPrompt = { id: number; nama: string; kategori: string; prompt: string; aktif: number }
type Referensi = { id: number; mime: string; base64: string; nama: string }
type Hasil = { base64: string; mime: string; provider: string; model: string }

let idBerikut = 1

/** Baca berkas gambar sebagai base64 tanpa prefix data URL. */
function bacaGambar(f: File): Promise<Referensi> {
  const { promise, resolve, reject } = Promise.withResolvers<Referensi>()
  const reader = new FileReader()
  reader.onload = () => {
    const hasil = String(reader.result ?? "")
    const koma = hasil.indexOf(",")
    resolve({ id: idBerikut++, mime: f.type || "image/jpeg", base64: koma > 0 ? hasil.slice(koma + 1) : hasil, nama: f.name })
  }
  reader.onerror = () => reject(new Error(`Gagal membaca ${f.name}.`))
  reader.readAsDataURL(f)
  return promise
}

export function AiGambarStudio() {
  const [preset, setPreset] = useState<PresetPrompt[]>([])
  const [model, setModel] = useState<ModelGambar[]>([])
  const [setting, setSetting] = useState<SettingGambar | null>(null)
  const [prompt, setPrompt] = useState("")
  const [referensi, setReferensi] = useState<Referensi[]>([])
  const [hasil, setHasil] = useState<Hasil | null>(null)
  const [area, setArea] = useState<AreaGambar[]>([])
  const [mengirim, setMengirim] = useState(false)
  const [mengirimTg, setMengirimTg] = useState(false)
  const [memuat, setMemuat] = useState(true)
  const berkasRef = useRef<HTMLInputElement>(null)

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const r1 = await fetch("/api/pengaturan/ai?aksi=preset", { credentials: "include" })
      const d1 = (await r1.json().catch(() => null)) as { ok?: boolean; preset?: PresetPrompt[]; error?: string } | null
      if (!r1.ok || !d1?.ok) throw new Error(d1?.error ?? `Gagal memuat preset (${r1.status}).`)
      setPreset((d1.preset ?? []).filter((p) => p.aktif === 1))
      const d = await muatSettingGambar()
      setSetting(d.setting)
      setModel(d.model)
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat pengaturan gambar.")
    } finally {
      setMemuat(false)
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  async function tambahBerkas(files: FileList | null) {
    if (!files || files.length === 0) return
    const sisa = MAKS_REFERENSI - referensi.length
    if (sisa <= 0) {
      toast.error(`Maksimal ${MAKS_REFERENSI} gambar referensi.`)
      return
    }
    const dipakai = Array.from(files).slice(0, sisa)
    if (files.length > sisa) toast.error(`Hanya ${sisa} gambar ditambahkan (batas ${MAKS_REFERENSI}).`)
    try {
      const baru = await Promise.all(dipakai.map(bacaGambar))
      setReferensi((r) => [...r, ...baru])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membaca gambar.")
    }
  }

  /** Kirim permintaan generate/revisi. `anotasi` kosong = generate biasa. */
  async function kirim(anotasi: AreaGambar[]) {
    const p = prompt.trim()
    if (!p) {
      toast.error("Prompt masih kosong.")
      return
    }
    setMengirim(true)
    try {
      const res = await fetch("/api/ai/gambar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          prompt: p,
          referensi: referensi.length > 0 ? referensi.map((r) => r.base64) : undefined,
          mimeReferensi: referensi[0]?.mime ?? "image/jpeg",
          provider: setting?.provider || undefined,
          modelGambar: setting?.model_id || undefined,
          reasoning: setting?.reasoning || undefined,
          aspek_rasio: setting?.aspek_rasio || undefined,
          jumlah: setting?.jumlah ?? undefined,
          anotasi: anotasi.length > 0 ? anotasi : undefined,
        }),
      })
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; base64?: string; mime?: string; provider?: string; model?: string; error?: string }
        | null
      if (!res.ok || !d?.ok || !d.base64) {
        tampilkanGagalTulis(d?.error ?? `Gagal membuat gambar (${res.status}).`)
        return
      }
      setHasil({ base64: d.base64, mime: d.mime ?? "image/png", provider: d.provider ?? "-", model: d.model ?? "-" })
      setArea([])
      toast.success(`Gambar dibuat oleh ${d.provider ?? "-"}.`)
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi server.")
    } finally {
      setMengirim(false)
    }
  }

  async function kirimTelegram() {
    if (!hasil) return
    setMengirimTg(true)
    try {
      const res = await fetch("/api/ai/gambar/kirim-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ base64: hasil.base64, mime: hasil.mime, caption: prompt.trim().slice(0, 1024) }),
      })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !d?.ok) {
        tampilkanGagalTulis(d?.error ?? `Gagal mengirim (${res.status}).`)
        return
      }
      toast.success("Gambar dikirim ke Telegram.")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi Telegram.")
    } finally {
      setMengirimTg(false)
    }
  }

  function simpanLokal() {
    if (!hasil) return
    const biner = atob(hasil.base64)
    const byte = new Uint8Array(biner.length)
    for (let i = 0; i < biner.length; i += 1) byte[i] = biner.charCodeAt(i)
    const url = URL.createObjectURL(new Blob([byte], { type: hasil.mime }))
    const a = document.createElement("a")
    a.href = url
    a.download = `gambar-produk-${Date.now()}.${hasil.mime.includes("jpeg") ? "jpg" : "png"}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const adaAnotasiBerKomentar = useMemo(
    () => hasil !== null && area.some((a) => a.komentar.trim().length > 0),
    [hasil, area]
  )

  return (
    <>
      <PageHeader
        judul="Studio Gambar Produk"
        deskripsi="Buat atau revisi foto produk untuk listing marketplace."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Preset prompt</CardTitle>
            <CardDescription>
              Klik preset untuk mengisi kolom prompt. Teks TIDAK langsung terkirim — sunting dulu bila perlu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {memuat ? (
              <p className="text-sm text-muted-foreground">Memuat…</p>
            ) : preset.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada preset aktif.</p>
            ) : (
              <div className="flex flex-wrap gap-2" data-testid="baris-preset">
                {preset.map((p) => (
                  <Button
                    key={p.id}
                    variant="outline"
                    className="h-11 md:h-8"
                    onClick={() => setPrompt(p.prompt)}
                    title={p.prompt}
                    data-testid={`preset-${p.id}`}
                  >
                    <Sparkles data-icon="inline-start" />
                    {p.nama}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            {hasil ? (
              <>
                <KanvasAnotasi
                  gambarBase64={hasil.base64}
                  mime={hasil.mime}
                  area={area}
                  onTambahArea={(a) => setArea((l) => [...l, a])}
                  onHapusArea={(i) => setArea((l) => l.filter((_, idx) => idx !== i))}
                  onUbahKomentar={(i, teks) =>
                    setArea((l) => l.map((a, idx) => (idx === i ? { ...a, komentar: teks } : a)))
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-11 md:h-8"
                    disabled={mengirim || !adaAnotasiBerKomentar}
                    onClick={() => void kirim(area)}
                    data-testid="terapkan-revisi"
                  >
                    <Wand2 data-icon="inline-start" />
                    Terapkan revisi
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Hasil: {hasil.provider} · {hasil.model}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                Pratinjau hasil akan muncul di sini.
              </div>
            )}
          </div>

          <div className="flex h-fit flex-col gap-4">
            <AiGambarSetting
              awal={setting ? { setting, model } : null}
              onBerubah={setSetting}
            />
            <Card className="h-fit">
            <CardHeader>
              <CardTitle>Referensi (maks {MAKS_REFERENSI})</CardTitle>
              <CardDescription>
                Foto produk asli sebagai acuan agar bentuk dan warna tetap setia.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <input
                ref={berkasRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void tambahBerkas(e.target.files)
                  e.target.value = ""
                }}
                data-testid="berkas-referensi"
              />
              <Button
                variant="outline"
                className="h-11 w-full md:h-8"
                disabled={referensi.length >= MAKS_REFERENSI}
                onClick={() => berkasRef.current?.click()}
                data-testid="tambah-referensi"
              >
                <Plus data-icon="inline-start" />
                Tambah gambar
              </Button>

              {referensi.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="referensi-kosong">
                  Belum ada referensi.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {referensi.map((r, i) => (
                    <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- base64 di memori, bukan aset Next */}
                      <img
                        src={`data:${r.mime};base64,${r.base64}`}
                        alt={r.nama}
                        className="size-14 shrink-0 rounded object-cover"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.nama}</span>
                      <Badge variant="secondary">{i + 1}</Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 md:size-8"
                        aria-label={`Hapus referensi ${r.nama}`}
                        onClick={() => setReferensi((l) => l.filter((x) => x.id !== r.id))}
                        data-testid={`hapus-referensi-${i}`}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          </div>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="prompt-gambar">Prompt</FieldLabel>
              <textarea
                id="prompt-gambar"
                className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="mis. foto produk dengan latar putih bersih, pencahayaan studio lembut"
                data-testid="prompt-gambar"
              />
              <FieldDescription>Klik preset di atas untuk mengisi kolom ini.</FieldDescription>
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button className="h-11 md:h-8" disabled={mengirim} onClick={() => void kirim([])} data-testid="kirim-gambar">
                {mengirim ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                {mengirim ? "Memproses…" : "Kirim"}
              </Button>
              <Button
                variant="outline"
                className="h-11 md:h-8"
                disabled={!hasil || mengirimTg}
                onClick={() => void kirimTelegram()}
                data-testid="kirim-telegram"
              >
                {mengirimTg ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                Kirim ke Telegram
              </Button>
              <Button
                variant="outline"
                className="h-11 md:h-8"
                disabled={!hasil}
                onClick={simpanLokal}
                data-testid="simpan-lokal"
              >
                <Download data-icon="inline-start" />
                Simpan lokal
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
