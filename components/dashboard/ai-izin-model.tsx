"use client"

// components/dashboard/ai-izin-model.tsx — Editor IZIN MODEL per role + tujuan (cost control).
//
// Kebijakan yang dijalankan layar ini:
//   `owner` melihat & memakai SEMUA model, selamanya, tanpa konfigurasi.
//   Role lain HANYA boleh memakai model yang dicentang owner UNTUK ROLE ITU.
//   Ini blokir keras — tidak ada alur persetujuan, tidak ada naik-ke-atas.
//
// KENAPA PER (role, tujuan), bukan satu daftar global:
//   "model mana yang boleh dipakai `admin` untuk GAMBAR" pertanyaannya beda dari
//   "...untuk TEKS". Gambar jauh lebih mahal per panggilan, jadi owner biasanya ingin
//   membuka teks lebar tapi menutup gambar rapat. Satu daftar global menghapus pilihan itu.
//
// KENAPA layar ini menegaskan akibat "belum dicentang":
//   Penegakan di server FAIL CLOSED — role tanpa satu model pun tidak dapat apa-apa,
//   bukan "boleh semua". Owner harus bisa melihat akibat itu di sini, sebelum user
//   melapor "kok tidak bisa dipakai".
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"
import { LABEL_PROVIDER } from "@/components/dashboard/ai-kredensial"

/** Role yang bisa dibatasi. `owner` SENGAJA tidak ada: ia tak pernah dibatasi. */
const ROLE = ["high_admin", "admin", "designer", "guest"] as const
type RoleDibatasi = (typeof ROLE)[number]

/** Tujuan = sama dengan `ai_model.jenis` supaya join izin↔katalog selalu cocok. */
const TUJUAN = ["teks", "vision", "gambar"] as const
type Tujuan = (typeof TUJUAN)[number]

const LABEL_ROLE: Record<RoleDibatasi, string> = {
  high_admin: "High Admin",
  admin: "Admin",
  designer: "Designer",
  guest: "Guest",
}

const LABEL_TUJUAN: Record<Tujuan, string> = {
  teks: "Teks",
  vision: "Vision",
  gambar: "Gambar",
}

type IzinBaris = { role: string; provider: string; model_id: string; jenis: string; allowed: number }
type ModelBaris = { id: number; provider: string; model_id: string; label: string; jenis: string; aktif: number }
type Ringkas = { total: number; perRole: Record<string, number> }

/** Kunci peta izin: satu role+tujuan+model = satu keputusan. */
function kunci(role: string, jenis: string, provider: string, modelId: string): string {
  return `${role}\u0000${jenis}\u0000${provider}\u0000${modelId}`
}

interface Props {
  bolehUbah: boolean
  onBerubah?: () => void
}

export function AiIzinModel({ bolehUbah, onBerubah }: Props) {
  const [role, setRole] = useState<RoleDibatasi>("admin")
  const [tujuan, setTujuan] = useState<Tujuan>("gambar")
  const [model, setModel] = useState<ModelBaris[]>([])
  const [izin, setIzin] = useState<Set<string>>(new Set())
  const [ringkas, setRingkas] = useState<Ringkas | null>(null)
  const [memuat, setMemuat] = useState(true)
  const [sibuk, setSibuk] = useState<string | null>(null)

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      // Katalog dibaca lewat jalur owner (route ini owner-only) supaya owner melihat
      // SEMUA model; hanya role non-owner yang dipotong oleh izin.
      const [rKatalog, rIzin] = await Promise.all([
        fetch("/api/pengaturan/ai?aksi=model", { credentials: "include" }),
        fetch("/api/pengaturan/ai?aksi=izin", { credentials: "include" }),
      ])
      const dKatalog = (await rKatalog.json().catch(() => null)) as { ok?: boolean; model?: ModelBaris[]; error?: string } | null
      const dIzin = (await rIzin.json().catch(() => null)) as
        | { ok?: boolean; izin?: IzinBaris[]; ringkas?: Ringkas; error?: string }
        | null
      if (!rKatalog.ok || !dKatalog?.ok) throw new Error(dKatalog?.error ?? `Gagal memuat katalog (${rKatalog.status}).`)
      if (!rIzin.ok || !dIzin?.ok) throw new Error(dIzin?.error ?? `Gagal memuat izin (${rIzin.status}).`)
      setModel(dKatalog.model ?? [])
      // Hanya baris `allowed = 1` yang dianggap tercentang; baris allowed=0 (sisa dari
      // pencabutan lewat UPDATE) sengaja TIDAK dicentang.
      setIzin(new Set((dIzin.izin ?? []).filter((i) => i.allowed === 1).map((i) => kunci(i.role, i.jenis, i.provider, i.model_id))))
      setRingkas(dIzin.ringkas ?? null)
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat izin model.")
    } finally {
      setMemuat(false)
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  async function ubah(m: ModelBaris, aktif: boolean) {
    const k = kunci(role, tujuan, m.provider, m.model_id)
    setSibuk(k)
    // Optimistic update: centang harus terasa langsung, dan kegagalan server
    // dikembalikan lewat muat() supaya UI tidak pernah menyimpan kebohongan.
    setIzin((lama) => {
      const baru = new Set(lama)
      if (aktif) baru.add(k)
      else baru.delete(k)
      return baru
    })
    try {
      const res = await fetch("/api/pengaturan/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          aktif
            ? { aksi: "izin-simpan", role, provider: m.provider, model_id: m.model_id, jenis: tujuan, allowed: 1 }
            : { aksi: "izin-hapus", role, provider: m.provider, model_id: m.model_id, jenis: tujuan }
        ),
      })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; ringkas?: Ringkas } | null
      if (!res.ok || !d?.ok) {
        tampilkanGagalTulis(d?.error ?? `Gagal menyimpan izin (${res.status}).`)
        await muat()
        return
      }
      if (d.ringkas) setRingkas(d.ringkas)
      toast.success(aktif ? `Model diizinkan untuk ${LABEL_ROLE[role]}.` : `Izin dicabut untuk ${LABEL_ROLE[role]}.`)
      onBerubah?.()
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi server.")
      await muat()
    } finally {
      setSibuk(null)
    }
  }

  // Model yang ditampilkan = katalog dengan jenis yang sedang dipilih. Hanya model AKTIF:
  // mengizinkan model yang tidak aktif tidak ada gunanya (tak pernah masuk kandidat).
  const tampil = model.filter((m) => m.jenis === tujuan && m.aktif === 1)
  const jumlahDiizinkan = tampil.filter((m) => izin.has(kunci(role, tujuan, m.provider, m.model_id))).length

  return (
    <Card data-testid="kartu-izin-model">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Izin Model per Role
          <Badge variant="secondary">cost control</Badge>
        </CardTitle>
        <CardDescription>
          Centang model yang boleh dipakai tiap role. <b>Owner selalu bisa memakai semua model</b> dan
          tidak muncul di sini. Role lain HANYA dapat model yang dicentang — bukan daftar saran.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Dua sumbu terpisah: role dulu, baru tujuan. Menggabungkannya jadi satu daftar
              panjang membuat owner kehilangan konteks "ini untuk siapa". */}
          <div className="flex flex-wrap gap-1" data-testid="pilih-role-izin">
            {ROLE.map((r) => (
              <Button
                key={r}
                variant={role === r ? "default" : "outline"}
                size="sm"
                className="h-11 md:h-8"
                onClick={() => setRole(r)}
                data-testid={`izin-role-${r}`}
              >
                {LABEL_ROLE[r]}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" data-testid="pilih-tujuan-izin">
            {TUJUAN.map((j) => (
              <Button
                key={j}
                variant={tujuan === j ? "default" : "outline"}
                size="sm"
                className="h-11 md:h-8"
                onClick={() => setTujuan(j)}
                data-testid={`izin-tujuan-${j}`}
              >
                {LABEL_TUJUAN[j]}
              </Button>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted-foreground" data-testid="ringkas-izin-role">
          <b>{LABEL_ROLE[role]}</b> boleh memakai <b>{jumlahDiizinkan}</b> dari {tampil.length} model{" "}
          {LABEL_TUJUAN[tujuan].toLowerCase()} yang aktif.
        </p>

        {jumlahDiizinkan === 0 && (
          // Diperingatkan KERAS karena server fail closed: role ini tidak dapat model sama
          // sekali, bukan "jatuh ke default". Owner perlu tahu ini sebelum user melapor.
          <p className="text-sm text-amber-700 dark:text-amber-500" data-testid="peringatan-izin-kosong">
            Belum ada model {LABEL_TUJUAN[tujuan].toLowerCase()} yang dicentang untuk {LABEL_ROLE[role]}. Role ini
            <b> tidak bisa memakai AI sama sekali</b> (sistem menolak, bukan memakai model default). Centang minimal satu.
          </p>
        )}

        {memuat ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : tampil.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="izin-katalog-kosong">
            Tidak ada model {LABEL_TUJUAN[tujuan].toLowerCase()} yang aktif di katalog. Tambahkan dulu di Katalog Model.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border" data-testid="daftar-izin-model">
            {tampil.map((m) => {
              const k = kunci(role, tujuan, m.provider, m.model_id)
              const dicentang = izin.has(k)
              return (
                <li key={k} className="flex items-center gap-3 px-3 py-2">
                  {/* Checkbox mentah, bukan komponen: repo ini tidak punya primitif Checkbox
                      (lihat dialog-import-order.tsx), dan menambah satu hanya untuk layar ini
                      berarti gaya centang berbeda dari halaman lain. */}
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={dicentang}
                    disabled={!bolehUbah || sibuk === k}
                    onChange={(e) => void ubah(m, e.target.checked)}
                    data-testid={`izin-${m.provider}-${m.model_id}`}
                    aria-label={`Izinkan ${m.model_id} untuk ${LABEL_ROLE[role]}`}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm" title={m.model_id}>
                      {m.label || m.model_id}
                    </span>
                    {m.label && m.label !== m.model_id && (
                      <span className="truncate text-xs text-muted-foreground">{m.model_id}</span>
                    )}
                  </div>
                  <Badge variant="outline">{LABEL_PROVIDER[m.provider] ?? m.provider}</Badge>
                  {sibuk === k && <Spinner />}
                </li>
              )
            })}
          </ul>
        )}

        {ringkas && (
          <p className="text-xs text-muted-foreground" data-testid="ringkas-izin-total">
            Total izin aktif: {ringkas.total}
            {ROLE.map((r) => ` · ${LABEL_ROLE[r]} ${ringkas.perRole[r] ?? 0}`).join("")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
