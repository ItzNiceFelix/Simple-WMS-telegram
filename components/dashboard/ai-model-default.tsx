"use client"

// components/dashboard/ai-model-default.tsx — Model default per provider (teks/vision/gambar).
//
// MASALAH YANG DIPERBAIKI: sebelumnya hanya `modelTeks` yang punya UI (di kartu Fallback).
// `modelGambar` dan `modelVision` tidak punya UI sama sekali — padahal keduanya dibaca
// provider.ts saat memanggil vision dan image gen. Jadi model default gambar tidak bisa
// diatur dari mana pun.
//
// Di sini admin memilih SATU model per (provider, jenis). Kosong = sistem memakai
// model aktif pertama di katalog provider itu.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { LABEL_PROVIDER } from "@/components/dashboard/ai-kredensial"
import type { ModelAi } from "@/components/dashboard/ai-model"

/** Jenis model yang bisa dijadikan default, dengan label manusiawinya. */
const JENIS_DEFAULT: { jenis: string; label: string; keterangan: string }[] = [
  { jenis: "teks", label: "Teks", keterangan: "Dipakai bot untuk menjawab pesan." },
  { jenis: "vision", label: "Vision", keterangan: "Dipakai membaca gambar/screenshot (picking list, anotasi)." },
  { jenis: "gambar", label: "Gambar", keterangan: "Dipakai studio gambar produk." },
]

interface Props {
  bolehUbah: boolean
  onBerubah?: () => void
}

export function AiModelDefault({ bolehUbah, onBerubah }: Props) {
  const [model, setModel] = useState<ModelAi[]>([])
  const [peta, setPeta] = useState<Record<string, Record<string, string>>>({})
  const [draf, setDraf] = useState<Record<string, Record<string, string>>>({})
  const [mengirim, setMengirim] = useState<string | null>(null)
  const [memuat, setMemuat] = useState(true)

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/pengaturan/ai?aksi=ringkas", { credentials: "include" }),
        fetch("/api/pengaturan/ai?aksi=model", { credentials: "include" }),
      ])
      const d1 = (await r1.json().catch(() => null)) as
        | { ok?: boolean; pengaturan?: { modelTeks?: Record<string, string>; modelVision?: Record<string, string>; modelGambar?: Record<string, string> } }
        | null
      if (!r1.ok || !d1?.ok || !d1.pengaturan) throw new Error(`Gagal memuat pengaturan (${r1.status}).`)
      const p = {
        teks: d1.pengaturan.modelTeks ?? {},
        vision: d1.pengaturan.modelVision ?? {},
        gambar: d1.pengaturan.modelGambar ?? {},
      }
      setPeta(p)
      setDraf(p)
      const d2 = (await r2.json().catch(() => null)) as { ok?: boolean; model?: ModelAi[] } | null
      if (d2?.ok) setModel(d2.model ?? [])
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat model default.")
    } finally {
      setMemuat(false)
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  /** Simpan satu (provider, jenis). Selalu kirim ketiga peta supaya tidak menimpa yang lain. */
  async function simpan(jenis: string, provider: string, nilai: string) {
    if (!bolehUbah) return
    const kunci = `${jenis}-${provider}`
    setMengirim(kunci)
    try {
      const baru = { ...draf, [jenis]: { ...draf[jenis] } }
      if (nilai) baru[jenis][provider] = nilai
      else delete baru[jenis][provider]
      const res = await fetch("/api/pengaturan/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          aksi: "pengaturan",
          modelTeks: baru.teks,
          modelVision: baru.vision,
          modelGambar: baru.gambar,
        }),
      })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !d?.ok) {
        tampilkanGagalTulis(d?.error ?? `Gagal menyimpan (${res.status}).`)
        return
      }
      setPeta(baru)
      toast.success(nilai ? `Model ${jenis} ${LABEL_PROVIDER[provider] ?? provider} disimpan.` : "Kembali ke model aktif pertama.")
      onBerubah?.()
    } finally {
      setMengirim(null)
    }
  }

  /**
   * Provider yang bisa dipakai untuk jenis itu.
   * Dilonggarkan: SEMUA provider ber-model aktif dianggap punya model untuk jenis itu,
   * karena daftar pilihan sekarang lintas jenis (lihat `kandidat`).
   */
  function providerUntuk(jenis: string): string[] {
    const unik = new Set(model.filter((m) => m.aktif === 1).map((m) => m.provider))
    return [...unik].sort()
  }

  /**
   * Model kandidat untuk (provider, jenis) — hanya yang aktif.
   *
   * TIDAK menyaring `jenis`. Katalog kenari menaruh model seperti `muse-spark-1-3`
   * di `jenis='vision'` padahal model itu bisa dipakai untuk teks; menyaring `jenis`
   * membuat model yang sah tidak bisa dipilih sama sekali — itulah keluhan pemilik repo.
   * Model yang `jenis`-nya COCOK ditampilkan lebih dulu, sisanya menyusul dengan
   * penanda jenis di label supaya user tahu asalnya tapi tetap bisa memilih.
   */
  function kandidat(provider: string, jenis: string): ModelAi[] {
    return model
      .filter((m) => m.provider === provider && m.aktif === 1)
      .sort((a, b) => (a.jenis === jenis ? 0 : 1) - (b.jenis === jenis ? 0 : 1) || a.id - b.id)
  }

  return (
    <Card data-testid="kartu-model-default">
      <CardHeader>
        <CardTitle>Model Default</CardTitle>
        <CardDescription>
          Model yang dipakai sistem per provider. Kosong berarti memakai model aktif pertama di katalog provider itu.
          Untuk urutan cadangan saat provider gagal, lihat kartu Fallback Provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {memuat ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : (
          JENIS_DEFAULT.map(({ jenis, label, keterangan }) => {
            const daftarProvider = providerUntuk(jenis)
            const punyaUI = peta[jenis] ?? {}
            return (
              <div key={jenis} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{keterangan}</p>
                </div>
                {daftarProvider.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid={`default-${jenis}-kosong`}>
                    Belum ada model {label.toLowerCase()} di katalog. Tarik dulu di kartu Katalog Model.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {daftarProvider.map((prov) => {
                      const opsi = kandidat(prov, jenis)
                      const nilai = (draf[jenis] ?? {})[prov] ?? ""
                      const berubah = nilai !== (punyaUI[prov] ?? "")
                      const kunci = `${jenis}-${prov}`
                      // Combobox memakai `null` untuk kosong = "model aktif pertama".
                      const items = opsi.map((m) => ({
                        value: m.model_id,
                        label: m.jenis === jenis ? m.model_id : `${m.model_id} · ${m.jenis}`,
                      }))
                      return (
                        <li key={prov} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <span className="w-32 shrink-0 text-sm">{LABEL_PROVIDER[prov] ?? prov}</span>
                          <Combobox
                            items={items}
                            value={nilai || null}
                            onChange={(v) => {
                              const baru = v ?? ""
                              setDraf((d) => ({ ...d, [jenis]: { ...d[jenis], [prov]: baru } }))
                            }}
                            placeholder="(model aktif pertama)"
                            kosongTeks="Model tidak ditemukan"
                            disabled={!bolehUbah}
                            data-testid={`default-${jenis}-${prov}`}
                          />
                          {nilai ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 shrink-0 md:h-7"
                              disabled={!bolehUbah}
                              onClick={() => setDraf((d) => ({ ...d, [jenis]: { ...d[jenis], [prov]: "" } }))}
                              data-testid={`kosongkan-default-${jenis}-${prov}`}
                            >
                              Kosongkan
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            className="h-9 shrink-0 md:h-7"
                            disabled={!bolehUbah || !berubah || mengirim === kunci}
                            onClick={() => void simpan(jenis, prov, nilai)}
                            data-testid={`simpan-default-${jenis}-${prov}`}
                          >
                            {mengirim === kunci ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                            Simpan
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
