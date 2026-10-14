"use client"

// components/dashboard/kledo-integrasi.tsx — Kartu integrasi Kledo.
// TARIK SATU ARAH: Kledo → WMS. Token TIDAK PERNAH ditampilkan kembali: hanya mask (••••3f2a).
// Tidak ada tombol yang menulis ke Kledo — memang tidak ada jalurnya.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { PlugZap, RefreshCw, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

export type KledoItem = {
  id: number
  subdomain: string
  label: string
  mask: string
  aktif: number
  dibuat_at: number
  uji_at: number | null
  uji_ok: number | null
  uji_pesan: string | null
}

export type KledoSinkron = {
  id: number
  mulai_at: number
  selesai_at: number | null
  status: string
  pemicu: string
  gudang_baru: number
  gudang_ubah: number
  produk_baru: number
  produk_ubah: number
  hpp_dipertahankan: number
  stok_baris: number
  stok_drift: number
  galat: number
  durasi_ms: number | null
  pesan: string | null
}

export type KledoGalat = { bagian: string; ref: string | null; pesan: string }

interface Props {
  bolehUbah: boolean
  onBerubah?: () => void
}

type Ringkas = {
  ok?: boolean
  error?: string
  kredensial?: KledoItem[]
  kunci_enkripsi_ada?: boolean
  sinkron?: KledoSinkron | null
  galat?: KledoGalat[]
  sedang_jalan?: boolean
}

function kapan(epoch: number | null | undefined): string {
  if (!epoch) return "—"
  const d = new Date(epoch * 1000)
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
}

export function KledoIntegrasi({ bolehUbah, onBerubah }: Props) {
  const [daftar, setDaftar] = useState<KledoItem[]>([])
  const [kunciAda, setKunciAda] = useState(true)
  const [sinkron, setSinkron] = useState<KledoSinkron | null>(null)
  const [galat, setGalat] = useState<KledoGalat[]>([])
  const [jalan, setJalan] = useState(false)
  const [memuat, setMemuat] = useState(true)
  const [subdomain, setSubdomain] = useState("")
  const [label, setLabel] = useState("")
  const [token, setToken] = useState("")
  const [sibuk, setSibuk] = useState(false)

  const muat = useCallback(async () => {
    try {
      const res = await fetch("/api/pengaturan/kledo?aksi=ringkas", { credentials: "include" })
      const d = (await res.json().catch(() => null)) as Ringkas | null
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat (${res.status}).`)
      setDaftar(d.kredensial ?? [])
      setKunciAda(d.kunci_enkripsi_ada !== false)
      setSinkron(d.sinkron ?? null)
      setGalat(d.galat ?? [])
      setJalan(d.sedang_jalan === true)
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat setelan Kledo.")
    } finally {
      setMemuat(false)
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  async function kirim(body: Record<string, unknown>): Promise<{ ok: boolean; d?: Record<string, unknown> }> {
    const res = await fetch("/api/pengaturan/kledo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    })
    const d = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !d?.ok) {
      tampilkanGagalTulis(String(d?.error ?? `Gagal (${res.status}).`))
      return { ok: false, d: d ?? undefined }
    }
    return { ok: true, d: d ?? undefined }
  }

  async function simpan() {
    if (!bolehUbah || sibuk) return
    if (!subdomain.trim() || !token.trim()) {
      toast.error("Subdomain dan token wajib diisi.")
      return
    }
    setSibuk(true)
    try {
      const r = await kirim({ aksi: "simpan", subdomain, label, token })
      if (!r.ok) return
      toast.success("Kredensial Kledo tersimpan (terenkripsi).")
      setToken("")
      setLabel("")
      setSubdomain("")
      await muat()
      onBerubah?.()
    } finally {
      setSibuk(false)
    }
  }

  async function uji(k: KledoItem) {
    if (!bolehUbah || sibuk) return
    setSibuk(true)
    try {
      const r = await kirim({ aksi: "uji", id: k.id })
      if (r.ok) toast.success(`Koneksi OK — ${String(r.d?.jumlahGudang ?? 0)} gudang terbaca.`)
      await muat()
    } finally {
      setSibuk(false)
    }
  }

  async function sinkronSekarang() {
    if (!bolehUbah || sibuk) return
    if (jalan) {
      toast.error("Sinkronisasi lain masih berjalan.")
      return
    }
    setSibuk(true)
    toast.info("Sinkronisasi berjalan… jangan tutup halaman.")
    try {
      const r = await kirim({ aksi: "sinkron" })
      if (r.ok) {
        const d = r.d ?? {}
        toast.success(
          `Sinkron selesai: ${d.produkBaru ?? 0} produk baru, ${d.produkUbah ?? 0} berubah, ${d.gudangBaru ?? 0} gudang baru, ${d.stokDrift ?? 0} stok berubah.`
        )
      }
      await muat()
      onBerubah?.()
    } finally {
      setSibuk(false)
    }
  }

  async function toggleAktif(k: KledoItem) {
    if (!bolehUbah || sibuk) return
    setSibuk(true)
    try {
      if ((await kirim({ aksi: "aktif", id: k.id, aktif: k.aktif !== 1 })).ok) await muat()
    } finally {
      setSibuk(false)
    }
  }

  async function hapus(k: KledoItem) {
    if (!bolehUbah || sibuk) return
    if (!window.confirm(`Hapus kredensial Kledo ${k.subdomain} ${k.mask}? Tindakan ini tidak bisa dibatalkan.`)) return
    setSibuk(true)
    try {
      if ((await kirim({ aksi: "hapus", id: k.id })).ok) {
        toast.success("Kredensial dihapus.")
        await muat()
        onBerubah?.()
      }
    } finally {
      setSibuk(false)
    }
  }

  return (
    <Card data-testid="kartu-kledo">
      <CardHeader>
        <CardTitle>Integrasi Kledo</CardTitle>
        <CardDescription>
          Menarik data dari Kledo ke WMS: daftar produk, SKU, HPP, daftar gudang, dan stok per gudang.
          Satu arah — WMS tidak pernah mengubah data di Kledo.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!kunciAda && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" data-testid="peringatan-kunci-kledo">
            <b>Kunci enkripsi belum diset.</b> Jalankan{" "}
            <code className="rounded bg-amber-100 px-1">npx wrangler secret put AI_KEY_ENCRYPTION_KEY</code> lalu muat
            ulang halaman ini. Tanpa kunci, token Kledo tidak bisa disimpan maupun dibaca.
          </div>
        )}

        {/* ── Status sinkronisasi terakhir ── */}
        <div className="rounded-lg border border-border bg-muted/40 p-3" data-testid="status-sinkron">
          <p className="text-xs text-muted-foreground">Sinkronisasi terakhir</p>
          {memuat ? (
            <p className="text-sm">Memuat…</p>
          ) : !sinkron ? (
            <p className="text-sm" data-testid="sinkron-belum-ada">Belum pernah disinkronkan.</p>
          ) : (
            <>
              <p className="font-heading text-sm font-semibold" data-testid="sinkron-status">
                {sinkron.status} · {sinkron.pemicu} · {kapan(sinkron.mulai_at)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums" data-testid="sinkron-angka">
                {sinkron.produk_baru} produk baru · {sinkron.produk_ubah} berubah · {sinkron.gudang_baru} gudang baru ·{" "}
                {sinkron.stok_drift} stok berubah
                {sinkron.hpp_dipertahankan > 0 ? ` · ${sinkron.hpp_dipertahankan} HPP dipertahankan` : ""}
                {sinkron.durasi_ms ? ` · ${(sinkron.durasi_ms / 1000).toFixed(1)}s` : ""}
              </p>
            </>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="h-9 md:h-7"
              disabled={!bolehUbah || sibuk || daftar.length === 0}
              onClick={() => void sinkronSekarang()}
              data-testid="tombol-sinkron"
            >
              {sibuk ? <Spinner data-icon="inline-start" /> : <RefreshCw className="size-3.5" aria-hidden />}
              {sibuk ? "Berjalan…" : "Sinkron sekarang"}
            </Button>
            {jalan ? <Badge variant="secondary">sedang berjalan</Badge> : null}
          </div>
          {sinkron?.pesan ? <p className="mt-2 text-[11px] text-muted-foreground">{sinkron.pesan}</p> : null}
        </div>

        {/* ── Galat sinkronisasi ── */}
        {galat.length > 0 ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" data-testid="galat-kledo">
            <p className="font-medium">{galat.length} catatan dari sinkronisasi terakhir:</p>
            <ul className="mt-1 list-disc pl-4">
              {galat.slice(0, 5).map((g, i) => (
                <li key={i}>
                  <span className="font-mono">{g.bagian}</span>
                  {g.ref ? ` · ${g.ref}` : ""}: {g.pesan}
                </li>
              ))}
            </ul>
            {galat.length > 5 ? <p className="mt-1">…dan {galat.length - 5} lainnya.</p> : null}
          </div>
        ) : null}

        {/* ── Daftar kredensial ── */}
        {memuat ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : daftar.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="kledo-kosong">
            Belum ada kredensial Kledo. Masukkan subdomain dan Personal Access Token di bawah.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="daftar-kledo">
            {daftar.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <PlugZap className="size-4 opacity-60" aria-hidden />
                    {k.subdomain}.kledo.com
                    {k.label ? <span className="text-xs text-muted-foreground">· {k.label}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">{k.mask}</p>
                  {k.uji_at ? (
                    <p className={`mt-0.5 text-[11px] ${k.uji_ok === 1 ? "text-emerald-700" : "text-red-700"}`}>
                      {k.uji_ok === 1 ? `Uji terakhir OK · ${k.uji_pesan ?? ""}` : `Uji gagal: ${k.uji_pesan ?? "tidak diketahui"}`}
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
                    disabled={!bolehUbah || sibuk}
                    onClick={() => void uji(k)}
                    data-testid={`uji-kledo-${k.id}`}
                  >
                    Uji koneksi
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 md:h-7"
                    disabled={!bolehUbah || sibuk}
                    onClick={() => void toggleAktif(k)}
                    data-testid={`toggle-kledo-${k.id}`}
                  >
                    {k.aktif === 1 ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 md:h-7 text-destructive"
                    disabled={!bolehUbah || sibuk}
                    onClick={() => void hapus(k)}
                    data-testid={`hapus-kledo-${k.id}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* ── Form tambah kredensial ── */}
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <Field>
            <FieldLabel htmlFor="kledo-subdomain">Subdomain Kledo</FieldLabel>
            <Input
              id="kledo-subdomain"
              placeholder="cv-hanaa-jaya"
              value={subdomain}
              disabled={!bolehUbah || sibuk}
              onChange={(e) => setSubdomain(e.target.value)}
              data-testid="input-subdomain-kledo"
            />
            <FieldDescription>
              Bagian sebelum <code>.api.kledo.com</code>. Contoh: <code>cv-hanaa-jaya</code>
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="kledo-token">Personal Access Token</FieldLabel>
            <Input
              id="kledo-token"
              type="password"
              placeholder="kledo_pat_..."
              value={token}
              disabled={!bolehUbah || sibuk}
              onChange={(e) => setToken(e.target.value)}
              data-testid="input-token-kledo"
              autoComplete="off"
            />
            <FieldDescription>
              Dibuat di Kledo pada menu Personal Access Token. Disimpan terenkripsi (AES-GCM); nilainya tidak
              pernah dikirim kembali ke browser.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="kledo-label">Label (opsional)</FieldLabel>
            <Input
              id="kledo-label"
              placeholder="Kledo produksi"
              value={label}
              disabled={!bolehUbah || sibuk}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="input-label-kledo"
            />
          </Field>
          <div>
            <Button size="sm" className="h-9 md:h-7" disabled={!bolehUbah || sibuk} onClick={() => void simpan()} data-testid="simpan-kledo">
              {sibuk ? <Spinner data-icon="inline-start" /> : null}
              Simpan kredensial
            </Button>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground" data-testid="catatan-kledo">
          Sinkronisasi berjalan otomatis tiap sore, dan bisa dijalankan manual lewat tombol di atas.
          Gudang virtual <b>ONLINE</b> milik WMS tidak pernah dipetakan ke gudang Kledo.
          HPP D1 yang sudah terisi tidak akan dikosongkan oleh nilai kosong dari Kledo.
        </p>
      </CardContent>
    </Card>
  )
}
