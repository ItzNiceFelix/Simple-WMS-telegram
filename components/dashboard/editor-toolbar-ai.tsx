"use client"

// components/dashboard/editor-toolbar-ai.tsx — Toolbar AI editor kanvas (rencana §Editor Fase 7).
//
// MANDIRI seperti EditorPickerAset: komponen ini hanya memanggil `/api/desain/layout` dan
// menyerahkan hasilnya lewat `onLayoutTerbuat`. Fabric TIDAK di-import di sini — toolbar tidak
// pernah menggambar apa pun, dan menyeretnya ke bundel berarti memuat kanvas dua kali.
//
// Daftar template diambil dari `daftarTemplate()` (lib/desain/skemaLayout), bukan ditulis ulang
// di sini: template adalah wewenang skema, dan salinan di UI cepat basi saat slot berubah.
import { useState } from "react"
import type { JSX } from "react"
import { Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { daftarTemplate, type LayoutBanner } from "@/lib/desain/skemaLayout"

/** Cerminan MAKS_PERMINTAAN di app/api/desain/layout/route.ts — server menolak di atas ini. */
const MAKS_PERMINTAAN = 600
/** Cerminan MAKS_CUPLIKAN route; sisanya hanya membuat toast tak terbaca. */
const MAKS_CUPLIKAN = 300

type Props = {
  presetId: number
  /** Id preset ukuran dokumen yang sedang dipakai (mis. "1080x1080") — dikirim apa adanya ke API. */
  ukuran: string
  onLayoutTerbuat: (layout: LayoutBanner) => void
}

export function EditorToolbarAi({ presetId, ukuran, onLayoutTerbuat }: Props): JSX.Element {
  // Template dimuat sekali: isinya statis (tidak bergantung preset/ukuran).
  const [template, setTemplate] = useState(() => daftarTemplate())
  const [permintaan, setPermintaan] = useState("")
  // Label & slot tiap template; satu state karena keduanya berasal dari daftar yang sama.
  const [dipilih, setDipilih] = useState(() => daftarTemplate()[0]?.nama ?? "")
  const [memuat, setMemuat] = useState(false)

  const labelTerpilih = template.find((t) => t.nama === dipilih)?.label ?? "Pilih template"
  const slotTerpilih = template.find((t) => t.nama === dipilih)?.slot ?? []

  async function buat() {
    const p = permintaan.trim()
    if (!p) {
      tampilkanGagalTulis("Permintaan masih kosong.")
      return
    }
    // CPU Free terbatas dan tiap panggilan memakan kuota provider: satu permintaan sekaligus.
    setMemuat(true)
    try {
      const res = await fetch("/api/desain/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ presetId, ukuran, permintaan: p, template: dipilih }),
      })
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; layout?: LayoutBanner; template?: string; cuplikan?: string; error?: string }
        | null
      if (!res.ok || !d?.ok || !d.layout) {
        // `cuplikan` hanya dikirim server saat model mengembalikan JSON tak valid (502);
        // menampilkannya memisahkan "model melantur" dari "route salah" tanpa buka log Worker.
        tampilkanGagalTulis(d?.error ?? `Gagal membuat layout (${res.status}).`)
        if (d?.cuplikan) tampilkanGagalTulis(`Cuplikan jawaban model: ${d.cuplikan.slice(0, MAKS_CUPLIKAN)}`)
        return
      }
      onLayoutTerbuat(d.layout)
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi server.")
    } finally {
      setMemuat(false)
    }
  }

  return (
    <Card data-testid="toolbar-ai">
      <CardHeader>
        <CardTitle>Buat layout dengan AI</CardTitle>
        <CardDescription>
          Tulis brief singkat; AI mengisi template terpilih dan hasilnya bisa langsung disunting di kanvas.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="ai-permintaan">Permintaan</FieldLabel>
          <textarea
            id="ai-permintaan"
            className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={permintaan}
            maxLength={MAKS_PERMINTAAN}
            onChange={(e) => setPermintaan(e.target.value)}
            placeholder="mis. banner promo diskon 50% untuk piring melamin"
            data-testid="ai-permintaan"
          />
          <FieldDescription>
            {permintaan.length}/{MAKS_PERMINTAAN} karakter.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="ai-template">Template</FieldLabel>
          <Select value={dipilih} onValueChange={(v) => typeof v === "string" && setDipilih(v)}>
            <SelectTrigger id="ai-template" className="w-full" data-testid="ai-template">
              <SelectValue>{(v: string | null) => template.find((t) => t.nama === v)?.label ?? labelTerpilih}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {template.map((t) => (
                <SelectItem key={t.nama} value={t.nama}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {slotTerpilih.length > 0 && (
            <FieldDescription>Slot yang diisi AI: {slotTerpilih.join(", ")}.</FieldDescription>
          )}
        </Field>

        <Button
          variant="outline"
          className="h-11 w-full md:h-8"
          disabled={memuat}
          onClick={() => void buat()}
          data-testid="ai-buat-layout"
        >
          {memuat ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
          {memuat ? "Membuat layout…" : "Buat layout"}
        </Button>
      </CardContent>
    </Card>
  )
}
