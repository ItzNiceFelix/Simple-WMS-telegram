"use client"

// components/dashboard/ai-model.tsx — Katalog model AI (Fase A).
// Dropdown model per provider + tambah manual. Tombol "Tarik dari provider" dan
// "Tes koneksi" menyusul di Fase B (butuh adapter + kredensial aktif).
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
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { LABEL_PROVIDER, PROVIDER_AI } from "@/components/dashboard/ai-kredensial"

export type ModelAi = {
  id: number
  provider: string
  model_id: string
  label: string
  jenis: "teks" | "gambar" | "vision"
  aktif: number
}

const JENIS = ["teks", "gambar", "vision"] as const

interface Props {
  bolehUbah: boolean
  onBerubah?: () => void
}

export function AiModel({ bolehUbah, onBerubah }: Props) {
  const [daftar, setDaftar] = useState<ModelAi[]>([])
  const [memuat, setMemuat] = useState(true)
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

  useEffect(() => {
    void muat()
  }, [muat])

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
        {memuat ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : daftar.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="model-kosong">
            Belum ada model. Tambahkan di bawah — mis. <code className="rounded bg-muted px-1">openai/gpt-oss-120b</code>{" "}
            untuk Groq, atau <code className="rounded bg-muted px-1">gemini-3.8-flash</code> untuk Gemini.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm" data-testid="tabel-model">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Provider</th>
                  <th className="px-3 py-2 text-left font-medium">Model</th>
                  <th className="px-3 py-2 text-left font-medium">Jenis</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Hasil uji</th>
                  <th className="px-3 py-2 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {daftar.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-3 py-2">{LABEL_PROVIDER[m.provider] ?? m.provider}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium tabular-nums">{m.model_id}</span>
                      {m.label ? <span className="ml-2 text-xs text-muted-foreground">· {m.label}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{m.jenis}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={m.aktif === 1 ? "default" : "secondary"}>{m.aktif === 1 ? "aktif" : "nonaktif"}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1" data-testid={`hasil-uji-${m.model_id}`}>
                        {ujiHasil[`${m.provider}/${m.model_id}`] ? (
                          ujiHasil[`${m.provider}/${m.model_id}`].ok ? (
                            <Badge className="bg-emerald-600 text-white">OK {ujiHasil[`${m.provider}/${m.model_id}`].latencyMs}ms</Badge>
                          ) : (
                            <span className="text-xs text-destructive">
                              {ujiHasil[`${m.provider}/${m.model_id}`].error ?? "Gagal."}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 md:h-7"
                          disabled={!bolehUbah || menguji[`${m.provider}/${m.model_id}`] === true}
                          onClick={() => void uji(m)}
                          data-testid={`uji-${m.model_id}`}
                        >
                          {menguji[`${m.provider}/${m.model_id}`] ? <Spinner data-icon="inline-start" /> : null}
                          {menguji[`${m.provider}/${m.model_id}`] ? "Menguji…" : "Tes koneksi"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 md:h-7"
                          disabled={!bolehUbah}
                          onClick={() => void toggleAktif(m)}
                          data-testid={`toggle-model-${m.id}`}
                        >
                          {m.aktif === 1 ? "Nonaktifkan" : "Aktifkan"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-9 md:h-7"
                          disabled={!bolehUbah}
                          onClick={() => void hapus(m)}
                          data-testid={`hapus-model-${m.id}`}
                        >
                          <Trash2 data-icon="inline-start" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
