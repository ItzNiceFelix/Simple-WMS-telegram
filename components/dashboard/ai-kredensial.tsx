"use client"

// components/dashboard/ai-kredensial.tsx — Kartu kredensial provider AI (Fase A).
// API key TIDAK PERNAH ditampilkan kembali: hanya mask (••••3f2a).
// Kunci enkripsi ada di Worker secret; halaman ini hanya mengirim kredensial baru.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { KeyRound, Trash2 } from "lucide-react"

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

export type KredensialItem = {
  id: number
  provider: string
  label: string
  mask: string
  aktif: number
  dibuat_at: number
  uji_at: number | null
  uji_hasil: { ok: boolean; latencyMs?: number; model?: string; error?: string; at?: number } | null
}

export const PROVIDER_AI = ["gemini", "groq", "kenari", "openai", "openrouter"] as const
export type ProviderAi = (typeof PROVIDER_AI)[number]

export const LABEL_PROVIDER: Record<string, string> = {
  gemini: "Gemini",
  groq: "Groq",
  kenari: "Kenari",
  openai: "OpenAI",
  openrouter: "OpenRouter",
}

interface Props {
  /** Hanya owner yang boleh menulis. */
  bolehUbah: boolean
  /** Dipanggil setelah perubahan supaya kartu lain ikut menyegarkan. */
  onBerubah?: () => void
}

type Ringkas = { ok?: boolean; kredensial?: KredensialItem[]; kunci_enkripsi_ada?: boolean; error?: string }

export function AiKredensial({ bolehUbah, onBerubah }: Props) {
  const [daftar, setDaftar] = useState<KredensialItem[]>([])
  const [kunciAda, setKunciAda] = useState(true)
  const [memuat, setMemuat] = useState(true)
  const [provider, setProvider] = useState<string>("groq")
  const [label, setLabel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [mengirim, setMengirim] = useState(false)

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const res = await fetch("/api/pengaturan/ai?aksi=ringkas", { credentials: "include" })
      const d = (await res.json().catch(() => null)) as Ringkas | null
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat (${res.status}).`)
      setDaftar(d.kredensial ?? [])
      setKunciAda(d.kunci_enkripsi_ada !== false)
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat kredensial.")
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

  async function simpan() {
    if (!bolehUbah) return
    if (!apiKey.trim()) {
      toast.error("API key masih kosong.")
      return
    }
    setMengirim(true)
    try {
      const ok = await kirim({ aksi: "kredensial-simpan", provider, label, apiKey })
      if (!ok) return
      toast.success(`Kredensial ${LABEL_PROVIDER[provider] ?? provider} tersimpan (terenkripsi).`)
      setApiKey("")
      setLabel("")
      await muat()
      onBerubah?.()
    } finally {
      setMengirim(false)
    }
  }

  async function toggleAktif(k: KredensialItem) {
    if (!bolehUbah) return
    if (await kirim({ aksi: "kredensial-aktif", id: k.id, aktif: k.aktif !== 1 })) {
      await muat()
      onBerubah?.()
    }
  }

  async function hapus(k: KredensialItem) {
    if (!bolehUbah) return
    if (!window.confirm(`Hapus kredensial ${LABEL_PROVIDER[k.provider] ?? k.provider} ${k.mask}? Tindakan ini tidak bisa dibatalkan.`)) return
    if (await kirim({ aksi: "kredensial-hapus", id: k.id })) {
      toast.success("Kredensial dihapus.")
      await muat()
      onBerubah?.()
    }
  }

  return (
    <Card data-testid="kartu-kredensial">
      <CardHeader>
        <CardTitle>Kredensial Provider</CardTitle>
        <CardDescription>
          API key disimpan terenkripsi (AES-GCM) di database. Key ditampilkan sebagai mask — nilainya tidak pernah
          dikirim kembali ke browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!kunciAda && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" data-testid="peringatan-kunci">
            <b>Kunci enkripsi belum diset.</b> Jalankan{" "}
            <code className="rounded bg-amber-100 px-1">npx wrangler secret put AI_KEY_ENCRYPTION_KEY</code> lalu muat
            ulang halaman ini. Tanpa kunci, kredensial tidak bisa disimpan maupun dibaca.
          </div>
        )}

        {memuat ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : daftar.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="kredensial-kosong">
            Belum ada kredensial. Tambahkan API key provider di bawah.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="daftar-kredensial">
            {daftar.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <KeyRound className="size-4 opacity-60" aria-hidden />
                    {LABEL_PROVIDER[k.provider] ?? k.provider}
                    {k.label ? <span className="text-xs text-muted-foreground">· {k.label}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">{k.mask}</p>
                  {k.uji_hasil ? (
                    <p className={`mt-0.5 text-[11px] ${k.uji_hasil.ok ? "text-emerald-700" : "text-red-700"}`}>
                      {k.uji_hasil.ok
                        ? `Uji terakhir OK${k.uji_hasil.model ? ` · ${k.uji_hasil.model}` : ""}${k.uji_hasil.latencyMs != null ? ` · ${k.uji_hasil.latencyMs} ms` : ""}`
                        : `Uji gagal: ${k.uji_hasil.error ?? "tidak diketahui"}`}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Belum pernah diuji.</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={k.aktif === 1 ? "default" : "secondary"}>{k.aktif === 1 ? "aktif" : "nonaktif"}</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 md:h-7"
                    disabled={!bolehUbah}
                    onClick={() => void toggleAktif(k)}
                    data-testid={`toggle-kredensial-${k.id}`}
                  >
                    {k.aktif === 1 ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-9 md:h-7"
                    disabled={!bolehUbah}
                    onClick={() => void hapus(k)}
                    data-testid={`hapus-kredensial-${k.id}`}
                  >
                    <Trash2 data-icon="inline-start" />
                    Hapus
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {bolehUbah && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Tambah kredensial</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="kred-provider">Provider</FieldLabel>
                <Select value={provider} onValueChange={(v) => typeof v === "string" && setProvider(v)}>
                  <SelectTrigger id="kred-provider" className="h-11 w-full md:h-8" data-testid="kredensial-provider">
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
                <FieldLabel htmlFor="kred-label">Label (opsional)</FieldLabel>
                <Input
                  id="kred-label"
                  className="h-11 md:h-8"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="mis. Groq utama"
                  data-testid="kredensial-label"
                />
                <FieldDescription>Untuk membedakan bila satu provider punya beberapa kunci.</FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="kred-key">API key</FieldLabel>
              <Input
                id="kred-key"
                type="password"
                autoComplete="off"
                className="h-11 md:h-8"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="tempel API key di sini"
                data-testid="kredensial-apikey"
              />
              <FieldDescription>
                Dikirim sekali, langsung dienkripsi. Tidak bisa dilihat lagi setelah disimpan.
              </FieldDescription>
            </Field>
            <div className="flex justify-end">
              <Button
                size="lg"
                className="h-11 md:h-8"
                onClick={() => void simpan()}
                disabled={mengirim || !apiKey.trim() || !kunciAda}
                data-testid="simpan-kredensial"
              >
                {mengirim ? <Spinner data-icon="inline-start" /> : null}
                {mengirim ? "Menyimpan…" : "Simpan kredensial"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
