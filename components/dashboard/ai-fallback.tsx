"use client"

// components/dashboard/ai-fallback.tsx — Fallback provider + pengaturan hemat token (Fase A).
// Fallback: urutan provider yang dicoba bila provider utama gagal.
// Model fallback per provider diambil dari katalog ai_model (kartu Katalog Model).
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Save } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { LABEL_PROVIDER, PROVIDER_AI } from "@/components/dashboard/ai-kredensial"
import type { ModelAi } from "@/components/dashboard/ai-model"

type Pengaturan = {
  textProvider: string
  imageProvider: string
  chainTeks: string[]
  chainGambar: string[]
  modelTeks: Record<string, string>
  modelGambar: Record<string, string>
  maksRiwayat: number
  maksLoopTool: number
}

interface Props {
  bolehUbah: boolean
  onBerubah?: () => void
}

/** Urutan fallback: naik/turun memindahkan satu langkah. */
function geser(arr: string[], dari: number, ke: number): string[] {
  if (ke < 0 || ke >= arr.length) return arr
  const baru = [...arr]
  const [x] = baru.splice(dari, 1)
  baru.splice(ke, 0, x)
  return baru
}

export function AiFallback({ bolehUbah, onBerubah }: Props) {
  const [p, setP] = useState<Pengaturan | null>(null)
  const [model, setModel] = useState<ModelAi[]>([])
  const [mengirim, setMengirim] = useState(false)
  const [maksRiwayat, setMaksRiwayat] = useState("10")
  const [maksLoopTool, setMaksLoopTool] = useState("5")

  const muat = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/pengaturan/ai?aksi=ringkas", { credentials: "include" }),
        fetch("/api/pengaturan/ai?aksi=model", { credentials: "include" }),
      ])
      const d1 = (await r1.json().catch(() => null)) as { ok?: boolean; pengaturan?: Pengaturan; error?: string } | null
      if (!r1.ok || !d1?.ok || !d1.pengaturan) throw new Error(d1?.error ?? `Gagal memuat (${r1.status}).`)
      setP(d1.pengaturan)
      setMaksRiwayat(String(d1.pengaturan.maksRiwayat))
      setMaksLoopTool(String(d1.pengaturan.maksLoopTool))
      const d2 = (await r2.json().catch(() => null)) as { ok?: boolean; model?: ModelAi[] } | null
      if (d2?.ok) setModel(d2.model ?? [])
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat pengaturan AI.")
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  async function kirim(patch: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/pengaturan/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ aksi: "pengaturan", ...patch }),
    })
    const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!res.ok || !d?.ok) {
      tampilkanGagalTulis(d?.error ?? `Gagal menyimpan (${res.status}).`)
      return false
    }
    return true
  }

  if (!p) return null

  async function ubahUrutan(arah: "naik" | "turun", i: number) {
    if (!bolehUbah || !p) return
    const baru = geser(p.chainTeks, i, arah === "naik" ? i - 1 : i + 1)
    if (baru === p.chainTeks) return
    setP({ ...p, chainTeks: baru })
    if (await kirim({ chainTeks: baru })) onBerubah?.()
  }

  async function tambahKeChain(provider: string) {
    if (!bolehUbah || !p) return
    if (p.chainTeks.includes(provider)) return
    const baru = [...p.chainTeks, provider]
    setP({ ...p, chainTeks: baru })
    if (await kirim({ chainTeks: baru })) onBerubah?.()
  }

  async function hapusDariChain(provider: string) {
    if (!bolehUbah || !p) return
    const baru = p.chainTeks.filter((x) => x !== provider)
    if (baru.length === 0) {
      toast.error("Minimal satu provider harus ada di rantai.")
      return
    }
    setP({ ...p, chainTeks: baru })
    if (await kirim({ chainTeks: baru })) onBerubah?.()
  }

  async function setModelUtama(provider: string, nilai: string) {
    if (!bolehUbah || !p) return
    const baru = { ...p.modelTeks }
    if (nilai) baru[provider] = nilai
    else delete baru[provider]
    setP({ ...p, modelTeks: baru })
    if (await kirim({ modelTeks: baru })) onBerubah?.()
  }

  async function simpanHemat() {
    if (!bolehUbah) return
    setMengirim(true)
    try {
      if (await kirim({ maksRiwayat: Number(maksRiwayat), maksLoopTool: Number(maksLoopTool) })) {
        toast.success("Pengaturan hemat token disimpan.")
        onBerubah?.()
      }
    } finally {
      setMengirim(false)
    }
  }

  const sisaProvider = PROVIDER_AI.filter((x) => !p.chainTeks.includes(x))

  return (
    <>
      <Card data-testid="kartu-fallback">
        <CardHeader>
          <CardTitle>Fallback Provider</CardTitle>
          <CardDescription>
            Bila provider utama gagal (kunci salah, limit, gangguan), sistem mencoba provider berikutnya dalam urutan
            ini. Model untuk tiap provider diatur di daftar bawah.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="rantai-teks">
            {p.chainTeks.map((prov, i) => {
              const opsi = model.filter((m) => m.provider === prov && m.jenis === "teks" && m.aktif === 1)
              return (
                <li key={prov} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="flex min-w-40 items-center gap-2">
                    <span className="w-5 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                    <span className="font-medium">{LABEL_PROVIDER[prov] ?? prov}</span>
                    {i === 0 ? <Badge>utama</Badge> : null}
                  </div>
                  <div className="flex min-w-56 flex-1 items-center gap-2">
                    <Field className="w-full">
                      <FieldLabel className="sr-only" htmlFor={`model-${prov}`}>
                        Model {prov}
                      </FieldLabel>
                      {opsi.length > 0 ? (
                        <select
                          id={`model-${prov}`}
                          className="h-11 w-full rounded-md border border-input bg-transparent px-2 text-sm md:h-8"
                          value={p.modelTeks[prov] ?? ""}
                          disabled={!bolehUbah}
                          onChange={(e) => void setModelUtama(prov, e.target.value)}
                          data-testid={`model-utama-${prov}`}
                        >
                          <option value="">(model aktif pertama)</option>
                          {opsi.map((m) => (
                            <option key={m.id} value={m.model_id}>
                              {m.model_id}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          className="h-11 md:h-8"
                          value={p.modelTeks[prov] ?? ""}
                          disabled={!bolehUbah}
                          onChange={(e) => setP({ ...p, modelTeks: { ...p.modelTeks, [prov]: e.target.value } })}
                          onBlur={(e) => void setModelUtama(prov, e.target.value)}
                          placeholder="nama model (mis. openai/gpt-oss-120b)"
                          data-testid={`model-utama-${prov}`}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 md:h-7"
                      disabled={!bolehUbah || i === 0}
                      onClick={() => void ubahUrutan("naik", i)}
                      data-testid={`naik-${prov}`}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 md:h-7"
                      disabled={!bolehUbah || i === p.chainTeks.length - 1}
                      onClick={() => void ubahUrutan("turun", i)}
                      data-testid={`turun-${prov}`}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 md:h-7"
                      disabled={!bolehUbah || p.chainTeks.length <= 1}
                      onClick={() => void hapusDariChain(prov)}
                      data-testid={`hapus-rantai-${prov}`}
                    >
                      Hapus
                    </Button>
                  </div>
                </li>
              )
            })}
          </ol>

          {sisaProvider.length > 0 && bolehUbah ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Tambah ke rantai:</span>
              {sisaProvider.map((x) => (
                <Button
                  key={x}
                  variant="outline"
                  size="sm"
                  className="h-9 md:h-7"
                  onClick={() => void tambahKeChain(x)}
                  data-testid={`tambah-rantai-${x}`}
                >
                  + {LABEL_PROVIDER[x] ?? x}
                </Button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="kartu-hemat">
        <CardHeader>
          <CardTitle>Hemat Token</CardTitle>
          <CardDescription>
            Batasi percakapan yang dikirim ke AI. Makin kecil, makin hemat — tapi AI makin cepat lupa konteks.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="maks-riwayat">Riwayat pesan dikirim</FieldLabel>
              <Input
                id="maks-riwayat"
                className="h-11 md:h-8"
                inputMode="numeric"
                value={maksRiwayat}
                disabled={!bolehUbah}
                onChange={(e) => setMaksRiwayat(e.target.value.replace(/\D/g, ""))}
                data-testid="maks-riwayat"
              />
              <FieldDescription>Jumlah pesan terakhir yang dikirim sebagai konteks (0–50).</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="maks-loop">Maks langkah tool</FieldLabel>
              <Input
                id="maks-loop"
                className="h-11 md:h-8"
                inputMode="numeric"
                value={maksLoopTool}
                disabled={!bolehUbah}
                onChange={(e) => setMaksLoopTool(e.target.value.replace(/\D/g, ""))}
                data-testid="maks-loop"
              />
              <FieldDescription>Batas AI memanggil tool berurutan dalam satu jawaban (1–20).</FieldDescription>
            </Field>
          </div>
          {bolehUbah ? (
            <div className="flex justify-end">
              <Button
                size="lg"
                className="h-11 md:h-8"
                onClick={() => void simpanHemat()}
                disabled={mengirim}
                data-testid="simpan-hemat"
              >
                {mengirim ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                Simpan
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  )
}
