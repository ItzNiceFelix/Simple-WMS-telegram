"use client"

// components/dashboard/ai-gambar-setting.tsx — Panel setting gambar MILIK AKUN INI.
// Bukan pengaturan global: tiap user punya baris sendiri di ai_gambar_setting.
// Satu-satunya sumber model gambar untuk studio — studio tidak lagi punya state model.
import { useCallback, useEffect, useState } from "react"
import { Save } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

const RASIO = ["1:1", "4:3", "3:4", "16:9", "9:16"]
const JUMLAH = [1, 2, 3, 4]
// Radix Select menolak value="" — pakai sentinel untuk "(pakai default)" dan "global".
const KOSONG = "__default__"
const GLOBAL = "__global__"

export type ModelGambar = { id: number; provider: string; model_id: string; label: string; jenis: string; aktif: number }
export type SettingGambar = {
  tg_id: string
  provider: string
  model_id: string
  reasoning: string
  aspek_rasio: string
  jumlah: number
}

/** Ambil model gambar + setting milik user. Dipakai studio supaya tidak query dua kali. */
export async function muatSettingGambar(): Promise<{ setting: SettingGambar; model: ModelGambar[] }> {
  const [rModel, rSetting] = await Promise.all([
    fetch("/api/pengaturan/ai?aksi=model&jenis=gambar", { credentials: "include" }),
    fetch("/api/ai/gambar/setting", { credentials: "include" }),
  ])
  const dModel = (await rModel.json().catch(() => null)) as { ok?: boolean; model?: ModelGambar[] } | null
  const dSetting = (await rSetting.json().catch(() => null)) as { ok?: boolean; setting?: SettingGambar; error?: string } | null
  if (!rSetting.ok || !dSetting?.ok || !dSetting.setting) {
    throw new Error(dSetting?.error ?? `Gagal memuat setting gambar (${rSetting.status}).`)
  }
  return { setting: dSetting.setting, model: (dModel?.model ?? []).filter((m) => m.aktif === 1) }
}

/** Ambil daftar reasoning sah untuk model terpilih (kosong = model tanpa reasoning). */
async function muatPilihanReasoning(provider: string, modelId: string): Promise<string[]> {
  if (!provider || !modelId) return []
  const q = new URLSearchParams({ provider, model_id: modelId })
  const res = await fetch(`/api/ai/gambar/setting?${q}`, { credentials: "include" })
  const d = (await res.json().catch(() => null)) as { ok?: boolean; reasoning_pilihan?: string[] } | null
  return d?.ok ? d.reasoning_pilihan ?? [] : []
}

type Props = {
  /** Setting + katalog dari luar (studio memuat sekali) — kosong = komponen memuat sendiri. */
  awal?: { setting: SettingGambar; model: ModelGambar[] } | null
  /** Dipanggil tiap setting tersimpan supaya studio memakai nilai terbaru saat kirim. */
  onBerubah?: (s: SettingGambar) => void
}

export function AiGambarSetting({ awal, onBerubah }: Props) {
  const [model, setModel] = useState<ModelGambar[]>(awal?.model ?? [])
  const [setting, setSetting] = useState<SettingGambar | null>(awal?.setting ?? null)
  const [pilihanReasoning, setPilihanReasoning] = useState<string[]>([])
  const [memuat, setMemuat] = useState(!awal)
  const [menyimpan, setMenyimpan] = useState(false)

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const d = await muatSettingGambar()
      setSetting(d.setting)
      setModel(d.model)
      setPilihanReasoning(await muatPilihanReasoning(d.setting.provider, d.setting.model_id))
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat setting gambar.")
    } finally {
      setMemuat(false)
    }
  }, [])

  useEffect(() => {
    if (!awal) void muat()
  }, [awal, muat])

  // Model tersimpan dari luar (studio sudah memuatnya) — tetap perlu daftar reasoning sah.
  useEffect(() => {
    if (awal?.setting.provider && awal.setting.model_id) {
      void muatPilihanReasoning(awal.setting.provider, awal.setting.model_id).then(setPilihanReasoning)
    }
  }, [awal])

  /** Muat pilihan reasoning baru tiap model berubah; reset reasoning yang tak lagi sah. */
  async function gantiModel(modelId: string) {
    const m = model.find((x) => x.model_id === modelId)
    const provider = m?.provider ?? setting?.provider ?? ""
    const baru = await muatPilihanReasoning(provider, modelId)
    setPilihanReasoning(baru)
    setSetting((s) => (s ? { ...s, provider, model_id: modelId, reasoning: baru.includes(s.reasoning) ? s.reasoning : "" } : s))
  }

  async function simpan() {
    if (!setting) return
    setMenyimpan(true)
    try {
      const res = await fetch("/api/ai/gambar/setting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider: setting.provider,
          model_id: setting.model_id,
          reasoning: setting.reasoning,
          aspek_rasio: setting.aspek_rasio,
          jumlah: setting.jumlah,
        }),
      })
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; setting?: SettingGambar; reasoning_pilihan?: string[]; error?: string }
        | null
      if (!res.ok || !d?.ok || !d.setting) {
        tampilkanGagalTulis(d?.error ?? `Gagal menyimpan setting gambar (${res.status}).`)
        return
      }
      setSetting(d.setting)
      setPilihanReasoning(d.reasoning_pilihan ?? [])
      onBerubah?.(d.setting)
      // Notif sukses: tanpa ini user tidak tahu simpan berhasil (tidak ada perubahan
      // visual yang jelas), dan mengira tombolnya rusak.
      toast.success("Pengaturan studio gambar disimpan.")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi server.")
    } finally {
      setMenyimpan(false)
    }
  }

  return (
    <Card data-testid="gambar-setting">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Pengaturan akun ini
          <Badge variant="secondary">per akun</Badge>
        </CardTitle>
        <CardDescription>
          Setting ini MILIK AKUN INI sendiri (per user), bukan global. User lain punya pilihannya sendiri.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {memuat || !setting ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="pilih-model-gambar">Model gambar</FieldLabel>
              <Select
                value={setting.model_id || GLOBAL}
                onValueChange={(v) => typeof v === "string" && void gantiModel(v === GLOBAL ? "" : v)}
              >
                <SelectTrigger id="pilih-model-gambar" className="h-11 w-full md:h-8" data-testid="pilih-model-gambar">
                  <SelectValue>
                    {(v: string | null) =>
                      v && v !== GLOBAL ? model.find((m) => m.model_id === v)?.label || v : "Model utama pengaturan global"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={GLOBAL}>Model utama pengaturan global</SelectItem>
                    {model.map((m) => (
                      <SelectItem key={m.id} value={m.model_id}>
                        {m.label || m.model_id} · {m.provider}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>Pilih model gambar yang dipakai studio untuk akun ini.</FieldDescription>
            </Field>

            {pilihanReasoning.length > 0 && (
              <Field>
                <FieldLabel htmlFor="pilih-reasoning-gambar">Reasoning model</FieldLabel>
                <Select
                  value={setting.reasoning || KOSONG}
                  onValueChange={(v) =>
                    typeof v === "string" && setSetting((s) => (s ? { ...s, reasoning: v === KOSONG ? "" : v } : s))
                  }
                >
                  <SelectTrigger id="pilih-reasoning-gambar" className="h-11 w-full md:h-8" data-testid="pilih-reasoning-gambar">
                    <SelectValue>
                      {(v: string | null) => (v && v !== KOSONG ? v : "(pakai default)")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={KOSONG}>(pakai default)</SelectItem>
                      {pilihanReasoning.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Tingkat berpikir model gambar. Kosong = pakai default provider.</FieldDescription>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="pilih-rasio">Aspek rasio</FieldLabel>
              <Select
                value={setting.aspek_rasio}
                onValueChange={(v) => typeof v === "string" && setSetting((s) => (s ? { ...s, aspek_rasio: v } : s))}
              >
                <SelectTrigger id="pilih-rasio" className="h-11 w-full md:h-8" data-testid="pilih-rasio">
                  {/* Nilainya "1:1" dst — sudah teks yang benar, bukan id mentah. */}
                  <SelectValue /> {/* selectvalue-ok */}
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {RASIO.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="pilih-jumlah">Jumlah gambar</FieldLabel>
              <Select
                value={String(setting.jumlah)}
                onValueChange={(v) => typeof v === "string" && setSetting((s) => (s ? { ...s, jumlah: Number(v) } : s))}
              >
                <SelectTrigger id="pilih-jumlah" className="h-11 w-full md:h-8" data-testid="pilih-jumlah">
                  <SelectValue>
                    {(v: string | null) => (v ? `${v} gambar` : "Pilih jumlah")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {JUMLAH.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Button
              className="h-11 md:h-8"
              disabled={menyimpan}
              onClick={() => void simpan()}
              data-testid="simpan-setting-gambar"
            >
              {menyimpan ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              {menyimpan ? "Menyimpan…" : "Simpan setting"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
