"use client"

// components/dashboard/ai-prompt.tsx — Prompt sistem + batas laju (Fase C).
// Prompt sistem menentukan kepribadian & aturan bot. Diedit di sini supaya
// tidak perlu deploy saat mau mengubah gaya jawaban.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { RotateCcw, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

/** Prompt bawaan — HARUS sama dengan `promptSistemBawaan()` di lib/ai/prompt.ts. */
const BAWAAN = [
  "Kamu asisten gudang untuk toko online Indonesia.",
  "Aturan wajib:",
  "1. JANGAN pernah menebak gudang. Bila user tidak menyebut gudang saat bertanya stok, tampilkan SEMUA gudang dengan rincian per gudang.",
  "2. Untuk mengubah stok (tambah/kurangi/pindah), gudang WAJIB disebut user. Bila tidak disebut, TANYA dulu — jangan menebak.",
  "3. Jawab ringkas dan langsung. Pakai angka yang benar dari tool, jangan mengarang.",
  "4. Bila ragu maksud user, tanya satu pertanyaan singkat.",
].join("\n")

interface Props {
  bolehUbah: boolean
  onBerubah?: () => void
}

export function AiPrompt({ bolehUbah, onBerubah }: Props) {
  const [nilai, setNilai] = useState("")
  const [tersimpan, setTersimpan] = useState("")
  const [rateLimit, setRateLimit] = useState("20")
  const [mengirim, setMengirim] = useState(false)
  const [memuat, setMemuat] = useState(true)

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const res = await fetch("/api/pengaturan/ai?aksi=ringkas", { credentials: "include" })
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; pengaturan?: { promptSistem?: string; rateLimitPerMenit?: number }; error?: string }
        | null
      if (!res.ok || !d?.ok || !d.pengaturan) throw new Error(d?.error ?? `Gagal memuat (${res.status}).`)
      const p = d.pengaturan.promptSistem ?? ""
      setNilai(p)
      setTersimpan(p)
      setRateLimit(String(d.pengaturan.rateLimitPerMenit ?? 20))
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat prompt sistem.")
    } finally {
      setMemuat(false)
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  async function simpan(promptSistem: string, batas?: number) {
    if (!bolehUbah) return
    setMengirim(true)
    try {
      const res = await fetch("/api/pengaturan/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi: "pengaturan", promptSistem, ...(batas === undefined ? {} : { rateLimitPerMenit: batas }) }),
      })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !d?.ok) {
        tampilkanGagalTulis(d?.error ?? `Gagal menyimpan (${res.status}).`)
        return
      }
      setTersimpan(promptSistem)
      toast.success("Prompt sistem disimpan.")
      onBerubah?.()
    } finally {
      setMengirim(false)
    }
  }

  const berubah = nilai !== tersimpan

  return (
    <Card data-testid="kartu-prompt">
      <CardHeader>
        <CardTitle>Prompt Sistem</CardTitle>
        <CardDescription>
          Instruksi dasar yang selalu dikirim ke AI sebelum pesan user. Ini yang mengatur gaya jawaban dan aturan
          gudang. Kosongkan untuk kembali ke bawaan.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="prompt-sistem">Instruksi</FieldLabel>
          <textarea
            id="prompt-sistem"
            className="min-h-40 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs leading-relaxed"
            value={nilai}
            disabled={!bolehUbah || memuat}
            onChange={(e) => setNilai(e.target.value)}
            placeholder={BAWAAN}
            data-testid="prompt-sistem"
          />
          <FieldDescription>
            {nilai.length} karakter. Maksimal 8000. Kosong = pakai bawaan.
          </FieldDescription>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rate-limit">Batas pesan per menit</FieldLabel>
            <Input
              id="rate-limit"
              className="h-11 md:h-8"
              inputMode="numeric"
              value={rateLimit}
              disabled={!bolehUbah || memuat}
              onChange={(e) => setRateLimit(e.target.value.replace(/\D/g, ""))}
              onBlur={() => {
                const n = Number(rateLimit)
                if (Number.isFinite(n) && n > 0 && n !== Number(rateLimit)) void simpan(nilai, n)
              }}
              data-testid="rate-limit"
            />
            <FieldDescription>Menjaga biaya API. Per user, per menit.</FieldDescription>
          </Field>
        </div>

        {bolehUbah ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="lg"
              className="h-11 md:h-8"
              disabled={mengirim || nilai === BAWAAN}
              onClick={() => setNilai(BAWAAN)}
              data-testid="prompt-bawaan"
            >
              <RotateCcw data-icon="inline-start" />
              Isi bawaan
            </Button>
            <Button
              size="lg"
              className="h-11 md:h-8"
              disabled={!berubah || mengirim}
              onClick={() => void simpan(nilai, Number(rateLimit))}
              data-testid="simpan-prompt"
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              Simpan
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
