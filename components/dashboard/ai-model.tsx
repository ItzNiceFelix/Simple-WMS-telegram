"use client"

// components/dashboard/ai-model.tsx — Katalog model AI (Fase A) + kapabilitas model.
// Dropdown model per provider + tambah manual + ringkasan cakupan kapabilitas.
// Editor reasoning menyesuaikan skema tiap model (level_4/level_3/effort_openai/bool),
// jadi user tidak disodori dropdown generik yang tidak berlaku untuk modelnya.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Toggle } from "@/components/ui/toggle"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { LABEL_PROVIDER, PROVIDER_AI } from "@/components/dashboard/ai-kredensial"

export type ModelAi = {
  id: number
  provider: string
  model_id: string
  label: string
  jenis: "teks" | "gambar" | "vision"
  aktif: number
  /** CSV lowercase, mis. 'text,image'. '' = tidak diketahui. */
  modal_masuk: string
  modal_keluar: string
  /** '' | level_4 | level_3 | effort_openai | bool */
  reasoning_skema: string
  /** CSV nilai sah untuk model ini, mis. 'low,medium,high'. '' = pakai bawaan skema. */
  reasoning_pilihan: string
  /** 1 = reasoning model ini bisa dibaca sistem. */
  reasoning_hilir: number
  /** provider | heuristik | manual */
  sumber: string
}

const JENIS = ["teks", "gambar", "vision"] as const

/** Nilai sah untuk kolom modality — dipakai juga sebagai keterangan input. */
const MODALITAS = "text,image,audio,video,file,pdf"

/** Bawaan pilihan reasoning bila `reasoning_pilihan` model masih kosong. */
const PILIHAN_BAWAAN: Record<string, string[]> = {
  level_4: ["minimal", "low", "medium", "high"],
  effort_openai: ["minimal", "low", "medium", "high"],
  level_3: ["low", "medium", "high"],
}

/** SelectItem UI tidak boleh bernilai string kosong → pakai sentinel, konversi saat simpan. */
const DEFAULT_PROVIDER = "(default provider)"

/** Ringkasan cakupan data kapabilitas katalog. Null = belum/gagal diambil. */
type RingkasKapabilitas = { total: number; bisaGambar: number; punyaReasoning: number }

/** State editor kapabilitas per model (kunci = `provider/model_id`). */
type DrafKapabilitas = {
  modalMasuk: string
  modalKeluar: string
  reasoningSkema: string
  reasoningPilihan: string
  reasoning: string
  hilir: boolean
}

function pecahCsv(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean)
}

type AiModelProps = {
  bolehUbah: boolean
  onBerubah?: () => void
}

export function AiModel({ bolehUbah, onBerubah }: AiModelProps) {
  const [daftar, setDaftar] = useState<ModelAi[]>([])
  const [memuat, setMemuat] = useState(true)
  const [ringkas, setRingkas] = useState<RingkasKapabilitas | null>(null)
  const [provider, setProvider] = useState<string>("groq")
  const [jenis, setJenis] = useState<string>("teks")
  const [modelId, setModelId] = useState("")
  const [label, setLabel] = useState("")
  const [mengirim, setMengirim] = useState(false)
  const [providerTarik, setProviderTarik] = useState<string>("groq")
  const [menarik, setMenarik] = useState(false)
  // Hasil tes koneksi terakhir per model (kunci = `provider/model_id`) — hilang saat reload, tidak perlu persist.
  const [ujiHasil, setUjiHasil] = useState<Record<string, { ok: boolean; latencyMs: number; error?: string }>>({})
  const [menguji, setMenguji] = useState<Record<string, boolean>>({})
  // Draf koreksi kapabilitas per model — hanya terisi setelah user menyentuh kontrolnya.
  const [draf, setDraf] = useState<Record<string, DrafKapabilitas>>({})
  const [menyimpanKap, setMenyimpanKap] = useState<Record<string, boolean>>({})

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const res = await fetch("/api/pengaturan/ai?aksi=model", { credentials: "include" })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; model?: ModelAi[]; error?: string } | null
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat (${res.status}).`)
      setDaftar(d.model ?? [])
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat model.")
    } finally {
      setMemuat(false)
    }
  }, [])

  /** Ringkasan kapabilitas: kegagalan di sini tidak boleh memblokir kartu — cukup barisnya tak tampil. */
  const muatRingkas = useCallback(async () => {
    try {
      const res = await fetch("/api/pengaturan/ai?aksi=ringkas-kapabilitas", { credentials: "include" })
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; ringkas?: RingkasKapabilitas }
        | null
      if (!res.ok || !d?.ok || !d.ringkas) return
      setRingkas(d.ringkas)
    } catch {
      setRingkas(null)
    }
  }, [])

  useEffect(() => {
    void muat()
    void muatRingkas()
  }, [muat, muatRingkas])

  async function kirim(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/pengaturan/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    })
    const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!res.ok || !d?.ok) {
      tampilkanGagalTulis(d?.error ?? `Gagal menyimpan (${res.status}).`)
      return false
    }
    return true
  }

  async function tambah() {
    if (!modelId.trim()) {
      toast.error("Nama model masih kosong.")
      return
    }
    setMengirim(true)
    try {
      if (await kirim({ aksi: "model-tambah", provider, model_id: modelId, label, jenis })) {
        toast.success("Model ditambahkan.")
        setModelId("")
        setLabel("")
        await muat()
        await muatRingkas()
        onBerubah?.()
      }
    } finally {
      setMengirim(false)
    }
  }

  async function toggleAktif(m: ModelAi) {
    if (!bolehUbah) return
    if (await kirim({ aksi: "model-aktif", id: m.id, aktif: m.aktif !== 1 })) {
      await muat()
      onBerubah?.()
    }
  }

  async function hapus(m: ModelAi) {
    if (!bolehUbah) return
    if (!window.confirm(`Hapus model ${m.model_id}?`)) return
    if (await kirim({ aksi: "model-hapus", id: m.id })) {
      toast.success("Model dihapus.")
      await muat()
      await muatRingkas()
      onBerubah?.()
    }
  }

  /** Tarik katalog langsung dari provider lewat server (kredensial tetap di server). */
  async function tarikDariProvider() {
    setMenarik(true)
    try {
      const res = await fetch(`/api/pengaturan/ai?aksi=tarik-model&provider=${encodeURIComponent(providerTarik)}`, {
        credentials: "include",
      })
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; jumlah?: number; ditambah?: number; dilewati?: number }
        | null
      if (!res.ok || !d?.ok) {
        tampilkanGagalTulis(d?.error ?? `Gagal menarik model (${res.status}).`)
        return
      }
      toast.success(`Ditarik ${d.jumlah ?? 0} model dari ${LABEL_PROVIDER[providerTarik] ?? providerTarik} · ${d.ditambah ?? 0} baru, ${d.dilewati ?? 0} sudah ada.`)
      await muat()
      await muatRingkas()
      onBerubah?.()
    } finally {
      setMenarik(false)
    }
  }

  /** Tes koneksi nyata: prompt minimal ke provider, latensi diukur server. */
  async function uji(m: ModelAi) {
    if (!bolehUbah) return
    const kunci = `${m.provider}/${m.model_id}`
    setMenguji((p) => ({ ...p, [kunci]: true }))
    try {
      const res = await fetch("/api/pengaturan/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi: "uji", provider: m.provider, model: m.model_id, jenis: m.jenis }),
      })
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; latencyMs?: number; model?: string }
        | null
      const latencyMs = d?.latencyMs ?? 0
      if (d?.ok) {
        setUjiHasil((p) => ({ ...p, [kunci]: { ok: true, latencyMs } }))
        toast.success(`${m.model_id} OK · ${latencyMs}ms`)
      } else {
        setUjiHasil((p) => ({ ...p, [kunci]: { ok: false, latencyMs, error: d?.error ?? `Gagal (${res.status}).` } }))
      }
    } finally {
      setMenguji((p) => ({ ...p, [kunci]: false }))
    }
  }

  /** Draf dari DB. Sengaja dibaca ulang per render supaya perubahan server (mis. tarik-model) ikut terlihat. */
  function drafModel(m: ModelAi): DrafKapabilitas {
    const kunci = `${m.provider}/${m.model_id}`
    return (
      draf[kunci] ?? {
        modalMasuk: m.modal_masuk,
        modalKeluar: m.modal_keluar,
        reasoningSkema: m.reasoning_skema,
        reasoningPilihan: m.reasoning_pilihan,
        reasoning: pecahCsv(m.reasoning_pilihan)[0] ?? "",
        hilir: m.reasoning_hilir === 1,
      }
    )
  }

  function ubahDraf(m: ModelAi, patch: Partial<DrafKapabilitas>) {
    const kunci = `${m.provider}/${m.model_id}`
    setDraf((p) => ({ ...p, [kunci]: { ...drafModel(m), ...patch } }))
  }

  /** Simpan koreksi kapabilitas. `paksa` dipakai tombol "sahkan": pertahankan semua nilai, hanya sumber → manual. */
  async function simpanKapabilitas(m: ModelAi, paksa: boolean) {
    if (!bolehUbah) return
    const kunci = `${m.provider}/${m.model_id}`
    const d = drafModel(m)
    setMenyimpanKap((p) => ({ ...p, [kunci]: true }))
    try {
      const ok = await kirim({
        aksi: "model-kapabilitas",
        provider: m.provider,
        modelId: m.model_id,
        modalMasuk: pecahCsv(d.modalMasuk),
        modalKeluar: pecahCsv(d.modalKeluar),
        reasoningSkema: d.reasoningSkema,
        reasoningPilihan: pecahCsv(d.reasoningPilihan),
        reasoningHilir: d.hilir,
      })
      if (!ok) return
      toast.success(paksa ? `Kapabilitas ${m.model_id} ditandai sudah benar.` : `Kapabilitas ${m.model_id} disimpan.`)
      setDraf((p) => {
        const next = { ...p }
        delete next[kunci]
        return next
      })
      // Muat ulang supaya badge sumber=manual muncul.
      await muat()
      await muatRingkas()
      onBerubah?.()
    } finally {
      setMenyimpanKap((p) => ({ ...p, [kunci]: false }))
    }
  }

  return (
    <Card data-testid="kartu-model">
      <CardHeader>
        <CardTitle>Katalog Model</CardTitle>
        <CardDescription>
          Daftar model per provider. Bisa ditarik otomatis dari provider (Fase B) atau ditambah manual di sini.
        </CardDescription>
      </CardHeader>
      {bolehUbah && (
        <div className="flex flex-col gap-2 border-b border-border px-6 pb-4 sm:flex-row sm:items-center">
          <Select value={providerTarik} onValueChange={(v) => typeof v === "string" && setProviderTarik(v)}>
            <SelectTrigger className="h-11 w-full md:h-8 sm:w-56" data-testid="provider-tarik">
              <SelectValue>{(v: string | null) => (v ? (LABEL_PROVIDER[v] ?? v) : "Pilih provider")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PROVIDER_AI.map((p) => (
                  <SelectItem key={p} value={p}>
                    {LABEL_PROVIDER[p] ?? p}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="h-11 md:h-8"
            onClick={() => void tarikDariProvider()}
            disabled={menarik}
            data-testid="tarik-model"
          >
            {menarik ? <Spinner data-icon="inline-start" /> : null}
            {menarik ? "Menarik…" : "Muat dari provider"}
          </Button>
        </div>
      )}
      <CardContent className="flex flex-col gap-4">
        {ringkas ? (
          <p className="text-xs text-muted-foreground" data-testid="ringkas-kapabilitas">
            Katalog: {ringkas.total} model · {ringkas.bisaGambar} bisa hasilkan gambar · {ringkas.punyaReasoning} punya
            pengaturan reasoning
          </p>
        ) : null}

        {memuat ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : daftar.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="model-kosong">
            Belum ada model. Tambahkan di bawah — mis. <code className="rounded bg-muted px-1">openai/gpt-oss-120b</code>{" "}
            untuk Groq, atau <code className="rounded bg-muted px-1">gemini-3.8-flash</code> untuk Gemini.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {daftar.map((m) => {
              const d = drafModel(m)
              const kunci = `${m.provider}/${m.model_id}`
              const pilihan =
                pecahCsv(d.reasoningPilihan).length > 0
                  ? pecahCsv(d.reasoningPilihan)
                  : (PILIHAN_BAWAAN[d.reasoningSkema] ?? [])
              const bisaGambar = pecahCsv(m.modal_keluar).includes("image")
              const habisModal = !m.modal_masuk && !m.modal_keluar
              const menyimpan = menyimpanKap[kunci] === true
              return (
                <li key={m.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{LABEL_PROVIDER[m.provider] ?? m.provider}</span>
                    <span className="font-medium tabular-nums">{m.model_id}</span>
                    {m.label ? <span className="text-xs text-muted-foreground">· {m.label}</span> : null}
                    <Badge variant="outline">{m.jenis}</Badge>
                    <Badge variant={m.aktif === 1 ? "default" : "secondary"}>
                      {m.aktif === 1 ? "aktif" : "nonaktif"}
                    </Badge>
                    {habisModal ? (
                      <Badge variant="secondary" data-testid={`modal-${m.model_id}`}>
                        modalitas ?
                      </Badge>
                    ) : (
                      <Badge variant={bisaGambar ? "default" : "outline"} data-testid={`modal-${m.model_id}`}>
                        {m.modal_masuk || "?"} → {m.modal_keluar || "?"}
                      </Badge>
                    )}
                    {m.sumber === "provider" ? (
                      <Badge className="bg-emerald-600 text-white" data-testid={`sumber-${m.model_id}`}>
                        API
                      </Badge>
                    ) : m.sumber === "manual" ? (
                      <Badge className="bg-sky-600 text-white" data-testid={`sumber-${m.model_id}`}>
                        manual
                      </Badge>
                    ) : (
                      <Badge variant="outline" data-testid={`sumber-${m.model_id}`}>
                        terkaan
                      </Badge>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2" data-testid={`hasil-uji-${m.model_id}`}>
                    {ujiHasil[kunci] ? (
                      ujiHasil[kunci].ok ? (
                        <Badge className="bg-emerald-600 text-white">OK {ujiHasil[kunci].latencyMs}ms</Badge>
                      ) : (
                        <span className="text-xs text-destructive">{ujiHasil[kunci].error ?? "Gagal."}</span>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">Belum diuji</span>
                    )}
                  </div>

                  {bolehUbah ? (
                    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor={`modal-masuk-${m.id}`}>Modalitas masuk</FieldLabel>
                          <Input
                            id={`modal-masuk-${m.id}`}
                            className="h-11 md:h-8"
                            value={d.modalMasuk}
                            onChange={(e) => ubahDraf(m, { modalMasuk: e.target.value })}
                            placeholder="mis. text,image"
                            data-testid={`modal-masuk-${m.model_id}`}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={`modal-keluar-${m.id}`}>Modalitas keluar</FieldLabel>
                          <Input
                            id={`modal-keluar-${m.id}`}
                            className="h-11 md:h-8"
                            value={d.modalKeluar}
                            onChange={(e) => ubahDraf(m, { modalKeluar: e.target.value })}
                            placeholder="mis. text,image"
                            data-testid={`modal-keluar-${m.model_id}`}
                          />
                        </Field>
                      </div>
                      <FieldDescription>CSV dari: {MODALITAS}</FieldDescription>

                      {m.reasoning_skema === "" ? null : m.reasoning_skema === "bool" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex gap-1" data-testid={`reasoning-${m.model_id}`}>
                            <Toggle
                              variant="outline"
                              size="sm"
                              pressed={d.reasoning === "on"}
                              onPressedChange={(p) => ubahDraf(m, { reasoning: p ? "on" : "" })}
                            >
                              Aktif
                            </Toggle>
                            <Toggle
                              variant="outline"
                              size="sm"
                              pressed={d.reasoning !== "on"}
                              onPressedChange={(p) => p && ubahDraf(m, { reasoning: "off" })}
                            >
                              Nonaktif
                            </Toggle>
                          </div>
                          <span className="text-xs text-muted-foreground">Reasoning hanya hidup/mati untuk model ini.</span>
                        </div>
                      ) : (
                        <Field>
                          <FieldLabel htmlFor={`reasoning-${m.id}`}>Tingkat reasoning</FieldLabel>
                          <Select
                            value={d.reasoning || DEFAULT_PROVIDER}
                            onValueChange={(v) =>
                              typeof v === "string" && ubahDraf(m, { reasoning: v === DEFAULT_PROVIDER ? "" : v })
                            }
                          >
                            <SelectTrigger
                              id={`reasoning-${m.id}`}
                              className="h-11 w-full md:h-8"
                              data-testid={`reasoning-${m.model_id}`}
                            >
                              <SelectValue>{(v: string | null) => (v && v !== DEFAULT_PROVIDER ? v : DEFAULT_PROVIDER)}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value={DEFAULT_PROVIDER}>{DEFAULT_PROVIDER}</SelectItem>
                                {pilihan.map((p) => (
                                  <SelectItem key={p} value={p}>
                                    {p}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <FieldDescription>
                            Pilihan mengikuti skema {m.reasoning_skema} · bandingkan dengan baku proporsional provider.
                          </FieldDescription>
                        </Field>
                      )}

                      {m.reasoning_skema === "" ? null : (
                        <Toggle
                          variant="outline"
                          size="sm"
                          pressed={d.hilir}
                          onPressedChange={(p) => ubahDraf(m, { hilir: p })}
                          data-testid={`hilir-${m.model_id}`}
                        >
                          {d.hilir ? "Reasoning diteruskan ke sistem" : "Teruskan reasoning ke sistem"}
                        </Toggle>
                      )}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 md:h-7"
                      disabled={!bolehUbah || menguji[kunci] === true}
                      onClick={() => void uji(m)}
                      data-testid={`uji-${m.model_id}`}
                    >
                      {menguji[kunci] ? <Spinner data-icon="inline-start" /> : null}
                      {menguji[kunci] ? "Menguji…" : "Tes koneksi"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 md:h-7"
                      disabled={!bolehUbah}
                      onClick={() => void toggleAktif(m)}
                      data-testid={`toggle-model-${m.id}`}
                    >
                      {m.aktif === 1 ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                    {bolehUbah ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 md:h-7"
                        disabled={menyimpan}
                        onClick={() => void simpanKapabilitas(m, false)}
                        data-testid={`simpan-kapabilitas-${m.model_id}`}
                      >
                        {menyimpan ? <Spinner data-icon="inline-start" /> : null}
                        {menyimpan ? "Menyimpan…" : "Simpan kapabilitas"}
                      </Button>
                    ) : null}
                    {bolehUbah && m.sumber === "heuristik" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 md:h-7"
                        disabled={menyimpan}
                        onClick={() => void simpanKapabilitas(m, true)}
                        data-testid={`sahkan-${m.model_id}`}
                      >
                        Tandai sudah benar
                      </Button>
                    ) : null}
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-11 md:h-7"
                      disabled={!bolehUbah}
                      onClick={() => void hapus(m)}
                      data-testid={`hapus-model-${m.id}`}
                    >
                      <Trash2 data-icon="inline-start" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {bolehUbah && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Tambah model manual</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="model-provider">Provider</FieldLabel>
                <Select value={provider} onValueChange={(v) => typeof v === "string" && setProvider(v)}>
                  <SelectTrigger id="model-provider" className="h-11 w-full md:h-8" data-testid="model-provider">
                    <SelectValue>{(v: string | null) => (v ? (LABEL_PROVIDER[v] ?? v) : "Pilih provider")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {PROVIDER_AI.map((p) => (
                        <SelectItem key={p} value={p}>
                          {LABEL_PROVIDER[p] ?? p}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="model-jenis">Jenis</FieldLabel>
                <Select value={jenis} onValueChange={(v) => typeof v === "string" && setJenis(v)}>
                  <SelectTrigger id="model-jenis" className="h-11 w-full md:h-8" data-testid="model-jenis">
                    <SelectValue>{(v: string | null) => v ?? "teks"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {JENIS.map((j) => (
                        <SelectItem key={j} value={j}>
                          {j}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="model-id">Nama model</FieldLabel>
              <Input
                id="model-id"
                className="h-11 md:h-8"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="mis. openai/gpt-oss-120b"
                data-testid="model-id"
              />
              <FieldDescription>Harus sama persis dengan yang diterima provider.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="model-label">Label (opsional)</FieldLabel>
              <Input
                id="model-label"
                className="h-11 md:h-8"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="mis. Cepat & murah"
                data-testid="model-label"
              />
            </Field>
            <div className="flex justify-end">
              <Button
                size="lg"
                className="h-11 md:h-8"
                onClick={() => void tambah()}
                disabled={mengirim || !modelId.trim()}
                data-testid="simpan-model"
              >
                {mengirim ? <Spinner data-icon="inline-start" /> : null}
                {mengirim ? "Menyimpan…" : "Tambah model"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
