"use client"

// components/dashboard/ai-tool.tsx — Katalog tool AI + peta kata kunci (Fase A).
// Tujuan: admin memperbaiki pemilihan tool TANPA deploy — tambah istilah yang biasa
// dipakai, atau matikan tool yang sudah punya UI sendiri (mis. opname).
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Save, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

export type ToolAi = {
  nama: string
  label: string
  deskripsi: string
  jenis: "baca" | "tulis"
  perlu_konfirmasi: number
  aktif: number
  urutan: number
  kata: string[]
}

interface Props {
  bolehUbah: boolean
  onBerubah?: () => void
}

export function AiTool({ bolehUbah, onBerubah }: Props) {
  const [daftar, setDaftar] = useState<ToolAi[]>([])
  const [memuat, setMemuat] = useState(true)
  const [mengirim, setMengirim] = useState(false)
  /** Kata kunci yang sedang disunting per tool (belum disimpan). */
  const [sunting, setSunting] = useState<Record<string, string>>({})
  const [saatTakCocok, setSaatTakCocok] = useState<"semua_tool" | "tolak">("semua_tool")

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const [resTool, resRingkas] = await Promise.all([
        fetch("/api/pengaturan/ai?aksi=tool", { credentials: "include" }),
        fetch("/api/pengaturan/ai?aksi=ringkas", { credentials: "include" }),
      ])
      const dTool = (await resTool.json().catch(() => null)) as { ok?: boolean; tool?: ToolAi[]; error?: string } | null
      if (!resTool.ok || !dTool?.ok) throw new Error(dTool?.error ?? `Gagal memuat tool (${resTool.status}).`)
      setDaftar(dTool.tool ?? [])
      const dRingkas = (await resRingkas.json().catch(() => null)) as
        | { ok?: boolean; pengaturan?: { saatTakCocok?: string } }
        | null
      if (dRingkas?.ok && dRingkas.pengaturan?.saatTakCocok === "tolak") setSaatTakCocok("tolak")
      else setSaatTakCocok("semua_tool")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat katalog tool.")
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

  async function toggleAktif(t: ToolAi) {
    if (!bolehUbah) return
    if (await kirim({ aksi: "tool-aktif", nama: t.nama, aktif: t.aktif !== 1 })) {
      await muat()
      onBerubah?.()
    }
  }

  async function simpanKata(t: ToolAi) {
    if (!bolehUbah) return
    const mentah = sunting[t.nama]
    if (mentah === undefined) return
    setMengirim(true)
    try {
      const kata = mentah.split(",").map((s) => s.trim()).filter(Boolean)
      if (await kirim({ aksi: "tool-kata", nama: t.nama, kata })) {
        toast.success(`Kata kunci ${t.label} disimpan.`)
        setSunting((l) => {
          const baru = { ...l }
          delete baru[t.nama]
          return baru
        })
        await muat()
      }
    } finally {
      setMengirim(false)
    }
  }

  async function simpanSaatTakCocok(nilai: "semua_tool" | "tolak") {
    if (!bolehUbah) return
    setSaatTakCocok(nilai)
    if (await kirim({ aksi: "pengaturan", saatTakCocok: nilai })) {
      toast.success("Perilaku saat tak cocok disimpan.")
      onBerubah?.()
    }
  }

  async function seed() {
    if (!bolehUbah) return
    setMengirim(true)
    try {
      if (await kirim({ aksi: "tool-seed" })) {
        toast.success("Katalog tool awal dimuat.")
        await muat()
      }
    } finally {
      setMengirim(false)
    }
  }

  return (
    <Card data-testid="kartu-tool">
      <CardHeader>
        <CardTitle>Tools AI</CardTitle>
        <CardDescription>
          Kata kunci di sini menentukan tool mana yang dikirim ke AI untuk tiap pesan — menghemat token dan mencegah AI
          memanggil tool yang salah. Bisa diedit tanpa deploy.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {memuat ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : daftar.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground" data-testid="tool-kosong">
              Katalog tool masih kosong.
            </p>
            {bolehUbah && (
              <Button size="lg" className="h-11 md:h-8" onClick={() => void seed()} disabled={mengirim} data-testid="seed-tool">
                {mengirim ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
                Muat katalog tool awal
              </Button>
            )}
          </div>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {daftar.map((t) => {
                const nilai = sunting[t.nama] ?? t.kata.join(", ")
                const berubah = sunting[t.nama] !== undefined
                return (
                  <li key={t.nama} className="flex flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          {t.label}
                          <Badge variant={t.jenis === "tulis" ? "destructive" : "outline"} data-testid={`jenis-${t.nama}`}>
                            {t.jenis}
                          </Badge>
                          {t.perlu_konfirmasi === 1 ? (
                            <span className="text-[11px] text-amber-700">butuh konfirmasi</span>
                          ) : null}
                          <Badge variant={t.aktif === 1 ? "default" : "secondary"}>
                            {t.aktif === 1 ? "aktif" : "nonaktif"}
                          </Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">{t.deskripsi}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 md:h-7"
                        disabled={!bolehUbah}
                        onClick={() => void toggleAktif(t)}
                        data-testid={`toggle-tool-${t.nama}`}
                      >
                        {t.aktif === 1 ? "Nonaktifkan" : "Aktifkan"}
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="h-11 min-w-64 flex-1 md:h-8"
                        value={nilai}
                        disabled={!bolehUbah}
                        onChange={(e) => setSunting((l) => ({ ...l, [t.nama]: e.target.value }))}
                        placeholder="pisahkan dengan koma, mis. stok, sisa, persediaan"
                        data-testid={`kata-${t.nama}`}
                      />
                      <Button
                        size="sm"
                        className="h-9 md:h-7"
                        disabled={!berubah || mengirim}
                        onClick={() => void simpanKata(t)}
                        data-testid={`simpan-kata-${t.nama}`}
                      >
                        <Save data-icon="inline-start" />
                        Simpan
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">Bila tak ada kata kunci yang cocok</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={saatTakCocok === "semua_tool" ? "default" : "outline"}
                  size="sm"
                  className="h-9 md:h-7"
                  disabled={!bolehUbah}
                  onClick={() => void simpanSaatTakCocok("semua_tool")}
                  data-testid="tak-cocok-semua"
                >
                  Kirim semua tool aktif (aman, lebih boros)
                </Button>
                <Button
                  variant={saatTakCocok === "tolak" ? "default" : "outline"}
                  size="sm"
                  className="h-9 md:h-7"
                  disabled={!bolehUbah}
                  onClick={() => void simpanSaatTakCocok("tolak")}
                  data-testid="tak-cocok-tolak"
                >
                  Balas tidak paham (hemat, bisa salah tolak)
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Pilih &quot;semua tool&quot; bila lebih penting AI selalu bisa menjawab. Pilih &quot;tolak&quot; bila
                lebih penting hemat token.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
