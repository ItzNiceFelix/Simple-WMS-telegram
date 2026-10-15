"use client"

// components/dashboard/editor-ai-setting.tsx — Setting AI EDITOR milik akun ini.
// Bukan pengaturan global: tiap user punya baris sendiri di ai_editor_setting.
//
// KENAPA PANEL INI ADA DI DALAM EDITOR, bukan di halaman Pengaturan AI:
//   Nilainya hanya berguna untuk kanvas, dan di sinilah user menyadari "AI-nya kurang
//   teliti" atau "balasannya terpotong".
//
// MODEL: sejak migrasi 0037 panel ini juga memilih MODEL editor, bukan cuma reasoning +
// plafon token. Sebelumnya editor selalu memakai model teks GLOBAL — model yang owner
// tetapkan untuk BOT CHAT — padahal menyusun skrip canvas-op adalah tugas penalaran +
// tool-call yang berbeda. Daftar yang ditawarkan = model teks yang diizinkan owner untuk
// role ini (endpoint memotongnya pakai himpunanIzin "teks"); pemeriksaan yang MENGIKAT
// tetap di server (lib/ai/provider.ts), jadi UI ini tidak memegang izin apa pun.
import { useCallback, useEffect, useState } from "react"
import { Save } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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

// Radix Select menolak value="" — pakai sentinel untuk "(pakai default)".
const KOSONG = "__default__"

/** Model teks yang boleh dipakai role ini, dari /api/ai/editor/setting (bukan katalog penuh).
 *  `kunci` = nilai yang DISIMPAN di setting (`provider\u0000model_id`) — dibuat server,
 *  dikirim balik apa adanya oleh klien supaya pemisahnya tidak digandakan di UI. */
export type ModelEditor = { id: number; provider: string; model_id: string; label: string; kunci: string }

type SettingEditor = { tg_id: string; model_editor: string; reasoning: string; maks_token: number }

export function EditorAiSetting() {
  const [setting, setSetting] = useState<SettingEditor | null>(null)
  const [model, setModel] = useState<ModelEditor[]>([])
  const [dibatasi, setDibatasi] = useState(false)
  const [pilihanReasoning, setPilihanReasoning] = useState<string[]>([])
  const [memuat, setMemuat] = useState(true)
  const [menyimpan, setMenyimpan] = useState(false)

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const res = await fetch("/api/ai/editor/setting", { credentials: "include" })
      const d = (await res.json().catch(() => null)) as
        | {
            ok?: boolean
            setting?: SettingEditor
            boleh?: ModelEditor[]
            dibatasi?: boolean
            reasoning_pilihan?: string[]
            error?: string
          }
        | null
      if (!res.ok || !d?.ok || !d.setting) throw new Error(d?.error ?? `Gagal memuat setting editor (${res.status}).`)
      setSetting(d.setting)
      setModel(d.boleh ?? [])
      setDibatasi(d.dibatasi === true)
      setPilihanReasoning(d.reasoning_pilihan ?? [])
    } catch (e) {
      // Panel setting yang gagal tidak boleh menghentikan editor: AI tetap bisa dipakai
      // dengan default model. Kegagalannya dilaporkan, bukan disembunyikan.
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat setting AI editor.")
    } finally {
      setMemuat(false)
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  async function simpan() {
    if (!setting) return
    setMenyimpan(true)
    try {
      const res = await fetch("/api/ai/editor/setting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          model_editor: setting.model_editor,
          reasoning: setting.reasoning,
          maks_token: setting.maks_token,
        }),
      })
      const d = (await res.json().catch(() => null)) as
        | {
            ok?: boolean
            setting?: SettingEditor
            boleh?: ModelEditor[]
            dibatasi?: boolean
            reasoning_pilihan?: string[]
            error?: string
          }
        | null
      if (!res.ok || !d?.ok || !d.setting) {
        tampilkanGagalTulis(d?.error ?? `Gagal menyimpan setting editor (${res.status}).`)
        return
      }
      setSetting(d.setting)
      setModel(d.boleh ?? [])
      setDibatasi(d.dibatasi === true)
      setPilihanReasoning(d.reasoning_pilihan ?? [])
      toast.success("Pengaturan AI editor disimpan.")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi server.")
    } finally {
      setMenyimpan(false)
    }
  }

  return (
    <Card data-testid="editor-setting-ai">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Pengaturan AI editor
          <Badge variant="secondary">per akun</Badge>
        </CardTitle>
        <CardDescription>
          Setting ini MILIK AKUN INI sendiri: model, reasoning, dan plafon token. Pilihan modelnya
          terbatas pada yang diizinkan owner untuk role Anda.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {memuat || !setting ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : (
          <>
            {/* Model pilihan AKUN INI. Hanya model yang diizinkan owner untuk role ini
                (jenis teks) yang ditawarkan — daftarnya datang sudah terpotong dari server,
                dan yang MENGIKAT tetap pemeriksaan di lib/ai/provider.ts saat model dipanggil. */}
            {model.length === 0 ? (
              // Dropdown kosong tanpa penjelasan terlihat seperti aplikasi rusak, padahal ini
              // keputusan konfigurasi owner. Dikatakan apa adanya + ke siapa harus minta.
              <p className="text-sm text-amber-700 dark:text-amber-500" data-testid="editor-model-tanpa-izin">
                {dibatasi
                  ? "Belum ada model teks yang diizinkan owner untuk role Anda, jadi model editor tidak bisa dipilih. Hubungi owner untuk mengaktifkannya di Pengaturan AI → Izin Model per Role."
                  : "Belum ada model teks aktif di katalog, jadi model editor tidak bisa dipilih."}
              </p>
            ) : (
              <Field>
                <FieldLabel htmlFor="pilih-model-editor">Model AI editor</FieldLabel>
                <Select
                  value={setting.model_editor || KOSONG}
                  onValueChange={(v) =>
                    typeof v === "string" && setSetting((s) => (s ? { ...s, model_editor: v === KOSONG ? "" : v } : s))
                  }
                >
                  <SelectTrigger id="pilih-model-editor" className="h-11 w-full md:h-8" data-testid="pilih-model-editor">
                    <SelectValue>
                      {(v: string | null) =>
                        v && v !== KOSONG
                          ? model.find((m) => m.kunci === v)?.label || model.find((m) => m.kunci === v)?.model_id || v
                          : "(pakai default global)"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={KOSONG}>(pakai default global)</SelectItem>
                      {model.map((m) => (
                        <SelectItem key={m.kunci} value={m.kunci}>
                          {m.label || m.model_id} · {m.provider}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Model yang dipakai AI editor untuk menyusun operasi kanvas. Kosong = ikut model teks global.
                  Pilihannya terbatas pada model yang diizinkan owner untuk role Anda.
                </FieldDescription>
              </Field>
            )}

            {pilihanReasoning.length > 0 && (
              <Field>
                <FieldLabel htmlFor="pilih-reasoning-editor">Reasoning model</FieldLabel>
                <Select
                  value={setting.reasoning || KOSONG}
                  onValueChange={(v) =>
                    typeof v === "string" && setSetting((s) => (s ? { ...s, reasoning: v === KOSONG ? "" : v } : s))
                  }
                >
                  <SelectTrigger id="pilih-reasoning-editor" className="h-11 w-full md:h-8" data-testid="pilih-reasoning-editor">
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
                <FieldDescription>
                  Tingkat berpikir model saat menyusun operasi kanvas. Tinggi = lebih teliti, lebih lambat.
                </FieldDescription>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="input-maks-token-editor">Plafon token</FieldLabel>
              <Input
                id="input-maks-token-editor"
                type="number"
                min={512}
                max={32000}
                step={512}
                className="h-11 md:h-8"
                data-testid="input-maks-token-editor"
                value={String(setting.maks_token)}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setSetting((s) => (s ? { ...s, maks_token: Number.isFinite(n) ? Math.trunc(n) : s.maks_token } : s))
                }}
              />
              <FieldDescription>
                Batas panjang jawaban AI. Terlalu kecil membuat jawabannya terpotong (JSON tidak bisa dipakai);
                512–32000.
              </FieldDescription>
            </Field>

            <Button
              className="h-11 md:h-8"
              disabled={menyimpan}
              onClick={() => void simpan()}
              data-testid="simpan-setting-editor"
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
