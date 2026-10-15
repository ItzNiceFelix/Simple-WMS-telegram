"use client"

// components/dashboard/editor-toolbar-ai.tsx — Toolbar AI editor kanvas (rencana §Editor Fase 7).
//
// MANDIRI seperti EditorPickerAset: komponen ini hanya memanggil `/api/desain/layout` dan
// menyerahkan hasilnya lewat `onOperasiTerbuat`. Fabric TIDAK di-import di sini — toolbar tidak
// pernah menggambar apa pun, dan menyeretnya ke bundel berarti memuat kanvas dua kali.
//
// SATU TAB, DUA PERINTAH (sejak STEP 2):
//   Server selalu mengembalikan SKRIP OPERASI, bukan lagi satu banner. Perbedaannya
//   terlihat di kotak centang "Bangun ulang tata letak":
//     - TIDAK dicentang (default): permintaan diterjemahkan jadi operasi TAMBAH/UBAH.
//       Pekerjaan user yang tidak disebut permintaan tidak disentuh.
//     - Dicentang: AI boleh mengosongkan kanvas dan menyusun ulang dari nol. Ini
//       destruktif, jadi user harus MENYATAKANNYA — bukan efek samping diam-diam.
//   Apa pun pilihannya, editor menyimpan snapshot undo sebelum menerapkan, sehingga
//   satu Ctrl+Z mengembalikan SELURUH aksi AI.
import { useMemo, useState } from "react"
import type { JSX } from "react"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"

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
import { daftarTemplate } from "@/lib/desain/skemaLayout"
import type { OperasiKanvas } from "@/lib/desain/skemaOperasi"

/** Cerminan MAKS_PERMINTAAN di app/api/desain/layout/route.ts — server menolak di atas ini. */
const MAKS_PERMINTAAN = 600
/** Cerminan MAKS_CUPLIKAN route; sisanya hanya membuat toast tak terbaca. */
const MAKS_CUPLIKAN = 300

type Props = {
  presetId: number
  /** Id preset ukuran dokumen yang sedang dipakai (mis. "1080x1080") — dikirim apa adanya ke API. */
  ukuran: string
  /** Ringkasan elemen kanvas untuk prompt: id/jenis/posisi. Toolbar tidak menyentuh fabric. */
  ringkasKanvas: () => { id: string; jenis: string; teks?: string; x: number; y: number; w: number; h: number }[]
  onOperasiTerbuat: (operasi: OperasiKanvas[]) => void
}

export function EditorToolbarAi({ presetId, ukuran, ringkasKanvas, onOperasiTerbuat }: Props): JSX.Element {
  // Template dimuat sekali: isinya statis (tidak bergantung preset/ukuran).
  const template = useState(() => daftarTemplate())[0]
  const [permintaan, setPermintaan] = useState("")
  const [memuat, setMemuat] = useState(false)
  // Default TIDAK destruktif: user yang tidak menyentuh apa pun tetap aman.
  const [bangunUlang, setBangunUlang] = useState(false)
  const [dipilih, setDipilih] = useState(() => daftarTemplate()[0]?.nama ?? "")
  const labelTerpilih = template.find((t) => t.nama === dipilih)?.label ?? "Pilih template"
  const slotTerpilih = useMemo(() => template.find((t) => t.nama === dipilih)?.slot ?? [], [template, dipilih])

  async function kirim() {
    const p = permintaan.trim()
    if (!p) {
      tampilkanGagalTulis("Permintaan masih kosong.")
      return
    }
    // CPU Free terbatas dan tiap panggilan memakan kuota provider: satu permintaan sekaligus.
    setMemuat(true)
    try {
      // Elemen kanvas ikut dikirim: AI harus bisa merujuk id yang SUDAH ada, bukan
      // menebak. Latar terkunci disertakan juga supaya prompt bisa melarang menyentuhnya.
      const elemen = ringkasKanvas()
      const res = await fetch("/api/desain/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          presetId,
          ukuran,
          permintaan: p,
          elemen,
          // Mode bangun ulang dikirim sebagai bagian INSTRUKSI, bukan flag yang bisa
          // ditafsirkan berbeda oleh server: bentuknya sama dengan permintaan user.
          mode: bangunUlang ? "bangun-ulang" : "incremental",
          template: bangunUlang ? dipilih : undefined,
        }),
      })
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; operasi?: OperasiKanvas[]; dibuang?: number; destruktif?: boolean; cuplikan?: string; error?: string }
        | null
      if (!res.ok || !d?.ok || !Array.isArray(d.operasi)) {
        // `cuplikan` hanya dikirim server saat model mengembalikan jawaban tak valid (502);
        // menampilkannya memisahkan "model melantur" dari "route salah" tanpa buka log Worker.
        tampilkanGagalTulis(d?.error ?? `Gagal membuat operasi (${res.status}).`)
        if (d?.cuplikan) tampilkanGagalTulis(`Cuplikan jawaban model: ${d.cuplikan.slice(0, MAKS_CUPLIKAN)}`)
        return
      }
      if (d.destruktif) {
        // Destruktif dikatakan SEBELUM diterapkan. Editor sudah menyimpan snapshot undo,
        // tapi user berhak tahu bahwa kanvasnya akan dikosongkan — bukan menemukannya
        // sudah kosong lalu bertanya-tanya apa yang terjadi.
        toast.warning("AI akan membangun ulang kanvas. Tekan Ctrl+Z untuk mengembalikannya.", { duration: 10000 })
      }
      onOperasiTerbuat(d.operasi)
      if (d.dibuang && d.dibuang > 0) {
        toast.warning(`${d.dibuang} operasi dibuang karena bentuknya tidak sah.`)
      }
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi server.")
    } finally {
      setMemuat(false)
    }
  }

  return (
    <Card data-testid="toolbar-ai">
      <CardHeader>
        <CardTitle>Sunting dengan AI</CardTitle>
        <CardDescription>
          Tulis perintah singkat, mis. &quot;pindahkan harga ke atas&quot; atau &quot;tambah ikon panah di
          kanan bawah&quot;. AI mengubah kanvas lewat operasi, dan hasilnya bisa dibatalkan dengan Ctrl+Z.
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
            placeholder="mis. besar kan judulnya, lalu tambah panah ke arah harga"
            data-testid="ai-permintaan"
          />
          <FieldDescription>
            {permintaan.length}/{MAKS_PERMINTAAN} karakter.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="ai-bangun-ulang">Tata letak</FieldLabel>
          <Select
            value={bangunUlang ? "bangun-ulang" : "incremental"}
            onValueChange={(v) => typeof v === "string" && setBangunUlang(v === "bangun-ulang")}
          >
            <SelectTrigger id="ai-bangun-ulang" className="w-full" data-testid="ai-mode">
              <SelectValue>
                {(v: string | null) => (v === "bangun-ulang" ? "Bangun ulang dari template" : "Ubah kanvas yang ada")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="incremental">Ubah kanvas yang ada</SelectItem>
              <SelectItem value="bangun-ulang">Bangun ulang dari template</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>
            {bangunUlang
              ? "Kanvas akan dikosongkan kecuali latar terkunci, lalu disusun ulang AI. Bisa dibatalkan dengan Ctrl+Z."
              : "Objek yang tidak disebut permintaan tidak diubah."}
          </FieldDescription>
        </Field>

        {bangunUlang && (
          <Field>
            <FieldLabel htmlFor="ai-template">Template dasar</FieldLabel>
            <Select value={dipilih} onValueChange={(v) => typeof v === "string" && setDipilih(v)}>
              <SelectTrigger id="ai-template" className="w-full" data-testid="ai-template">
                <SelectValue>
                  {(v: string | null) => (v ? (template.find((t) => t.nama === v)?.label ?? v) : labelTerpilih)}
                </SelectValue>
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
        )}

        <Button
          variant="outline"
          className="h-11 w-full md:h-8"
          disabled={memuat}
          onClick={() => void kirim()}
          data-testid="ai-buat-layout"
        >
          {memuat ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
          {memuat ? "Memproses…" : bangunUlang ? "Bangun ulang" : "Sunting kanvas"}
        </Button>
      </CardContent>
    </Card>
  )
}
