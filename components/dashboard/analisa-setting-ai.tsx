"use client"

// components/dashboard/analisa-setting-ai.tsx — Dialog setting Analisa Mendalam MILIK USER INI.
//
// Kenapa per user, bukan global: reasoning yang cocok beda-beda per orang, dan biaya token
// ditanggung pemilik akun masing-masing. Baris DB: ai_analisa_setting (satu per tg_id).
//
// ENDPOINT /api/ai/analisa/setting TERBUKA UNTUK USER BIASA — permintaan pemilik repo:
// semua user boleh mengatur reasoning-nya sendiri. Gate-nya sesi saja, TANPA is_admin.
// Model teks tetap dari pengaturan GLOBAL, jadi user tidak bisa membelokkan biaya ke model
// yang tidak disiapkan admin.
import { useCallback, useEffect, useState } from "react"
import { Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { KEDALAMAN_SAH, MAKS_TOKEN_MIN, MAKS_TOKEN_MAKS } from "@/lib/analisa/tipe"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

// Batas plafon token — nilai yang sama dengan lib/d1/aiAnalisaSetting.ts. Disalin, bukan
// diimpor: file itu menarik tipe D1Database (Cloudflare-only) ke bundel klien.

/** Label manusia tiap kedalaman. Angka di sini menyebut jumlah temuan yang diminta ke model. */
const LABEL_KEDALAMAN: Record<string, string> = {
  ringkas: "Ringkas — 3 temuan",
  sedang: "Sedang — 5 temuan",
  panjang: "Panjang — tanpa batas",
}

// SelectValue menolak value kosong — sentinel untuk "Default model".
const DEFAULT_MODEL = "__default__"

type SettingAnalisa = {
  tg_id: string
  reasoning: string
  maks_token: number
  kedalaman: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AnalisaSettingAi({ open, onOpenChange }: Props) {
  const [setting, setSetting] = useState<SettingAnalisa | null>(null)
  const [pilihanReasoning, setPilihanReasoning] = useState<string[]>([])
  const [maksTokenTeks, setMaksTokenTeks] = useState("")
  const [memuat, setMemuat] = useState(false)
  const [menyimpan, setMenyimpan] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  const muat = useCallback(async () => {
    setMemuat(true)
    setGalat(null)
    try {
      const res = await fetch("/api/ai/analisa/setting", { credentials: "include" })
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean; setting?: SettingAnalisa; reasoning_pilihan?: string[]; error?: string
      } | null
      if (!res.ok || !d?.ok || !d.setting) throw new Error(d?.error ?? `Gagal memuat (${res.status}).`)
      setSetting(d.setting)
      setPilihanReasoning(d.reasoning_pilihan ?? [])
      setMaksTokenTeks(String(d.setting.maks_token))
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memuat setting.")
    } finally {
      setMemuat(false)
    }
  }, [])

  // Muat saat dibuka. Tanpa syarat ini, tiap render ulang halaman memanggil endpoint.
  useEffect(() => {
    if (open) void muat()
  }, [open, muat])

  /** Ubah satu kolom draf. `maks_token` disimpan sebagai teks agar isian kosong tetap terbaca. */
  function ubah<K extends keyof SettingAnalisa>(kunci: K, nilai: SettingAnalisa[K]) {
    setSetting((s) => (s ? { ...s, [kunci]: nilai } : s))
  }

  async function simpan() {
    if (!setting) return
    const maksToken = Number(maksTokenTeks.trim())
    if (!Number.isInteger(maksToken) || maksToken < MAKS_TOKEN_MIN || maksToken > MAKS_TOKEN_MAKS) {
      setGalat(`Plafon token harus bilangan bulat ${MAKS_TOKEN_MIN}–${MAKS_TOKEN_MAKS}.`)
      return
    }
    setMenyimpan(true)
    setGalat(null)
    try {
      const res = await fetch("/api/ai/analisa/setting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reasoning: setting.reasoning, maks_token: maksToken, kedalaman: setting.kedalaman }),
      })
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean; setting?: SettingAnalisa; reasoning_pilihan?: string[]; error?: string
      } | null
      if (!res.ok || !d?.ok || !d.setting) {
        tampilkanGagalTulis(d?.error ?? `Gagal menyimpan (${res.status}).`)
        return
      }
      setSetting(d.setting)
      setPilihanReasoning(d.reasoning_pilihan ?? [])
      setMaksTokenTeks(String(d.setting.maks_token))
      // Notif sukses: tidak ada perubahan visual yang menandai tersimpan.
      toast.success("Pengaturan analisa disimpan.")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menghubungi server.")
    } finally {
      setMenyimpan(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="setting-ai-analisa">
        <DialogHeader>
          <DialogTitle>Pengaturan AI</DialogTitle>
          <DialogDescription>
            Berlaku untuk akun ini sendiri, bukan untuk semua user. Model teks tetap mengikuti
            pengaturan global.
          </DialogDescription>
        </DialogHeader>

        {memuat || !setting ? (
          <p className="py-4 text-sm text-muted-foreground">{memuat ? "Memuat…" : galat ?? "Setting tidak tersedia."}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="set-reasoning">Reasoning</FieldLabel>
              <Select
                value={setting.reasoning || DEFAULT_MODEL}
                onValueChange={(v) => typeof v === "string" && ubah("reasoning", v === DEFAULT_MODEL ? "" : v)}
              >
                <SelectTrigger id="set-reasoning" className="h-11 w-full md:h-8" data-testid="set-reasoning">
                  <SelectValue>
                    {(v: string | null) => (v && v !== DEFAULT_MODEL ? v : "Default model")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={DEFAULT_MODEL}>Default model</SelectItem>
                    {pilihanReasoning.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {pilihanReasoning.length > 0
                  ? "Seberapa lama model berpikir sebelum menjawab. Reasoning tinggi = lebih teliti, lebih mahal."
                  : "Model teks yang dipakai sekarang tidak punya pilihan reasoning — hanya Default model yang berlaku."}
              </FieldDescription>
              {/* Biaya reasoning dinyatakan sebagai WAKTU/token, bukan rupiah: repo ini tidak
                  menyimpan harga model, dan menebak "mahal" akan menyesatkan. Yang benar dan
                  bisa dipastikan: reasoning membuat model berpikir lebih lama = lebih banyak token. */}
              <p className="text-xs text-muted-foreground" data-testid="catatan-biaya-reasoning">
                Reasoning membuat model berpikir lebih lama, sehingga token yang dipakai lebih
                banyak — dan itu berarti lebih mahal. Level rendah (<b>low</b>) lebih hemat dan
                biasanya sudah cukup.
              </p>

              {/* Peringatan nyata dari keluhan "high effort, lama banget": model `:free`
                  mengantre di sisi penyedia, dan reasoning tinggi memperpanjang antrean itu.
                  Pilihan TIDAK dicabut — hanya konsekuensinya yang dinyatakan di depan.
                  Ambangnya disebut (60 detik/percobaan, 100 detik seluruh rantai) supaya user
                  bisa memperkirakan sendiri, bukan sekadar diberi tahu "bisa lambat". */}
              <p className="text-xs text-muted-foreground">
                Peringatan: pada model gratis (nama berakhiran <code>:free</code>), pilihan{" "}
                <b>high</b>, <b>xhigh</b>, atau <b>max</b> membuat analisa menunggu lama karena
                model antre di sisi penyedia. Bila terlalu lama, permintaan bisa gagal sebelum
                dijawab. Untuk pemakaian sehari-hari, <b>sedang</b> atau <b>low</b> jauh lebih cepat.
              </p>
              <p className="text-xs text-muted-foreground" data-testid="peringatan-reasoning-tinggi">
                Peringatan tegas: dengan plafon token besar, model penalaran bisa memakai{" "}
                <b>seluruh 60 detik</b> batas satu percobaan lalu tetap gagal. Karena anggaran
                seluruh rantai hanya <b>100 detik</b>, model penyedia cadangan ikut dilewati — Anda
                menunggu sampai rantai habis, lalu tetap tidak mendapat narasi. Bila itu terjadi,
                turunkan <b>reasoning lebih dulu</b> (bukan mencabut pilihan lain), baru naikkan lagi
                ketika sudah berhasil. Pilihan Anda tidak dibatasi di sini.
              </p>
            </Field>

            <Field>
              <FieldLabel htmlFor="set-kedalaman">Kedalaman</FieldLabel>
              <Select
                value={setting.kedalaman}
                onValueChange={(v) => typeof v === "string" && ubah("kedalaman", v)}
              >
                <SelectTrigger id="set-kedalaman" className="h-11 w-full md:h-8" data-testid="set-kedalaman">
                  <SelectValue>{(v: string | null) => (v ? LABEL_KEDALAMAN[v] ?? v : "Sedang — 5 temuan")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {KEDALAMAN_SAH.map((k) => (
                      <SelectItem key={k} value={k}>{LABEL_KEDALAMAN[k]}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>Menentukan berapa banyak temuan yang dibahas dalam narasi AI.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="set-maks-token">Plafon token</FieldLabel>
              <Input
                id="set-maks-token"
                type="number"
                inputMode="numeric"
                min={MAKS_TOKEN_MIN}
                max={MAKS_TOKEN_MAKS}
                value={maksTokenTeks}
                onChange={(e) => setMaksTokenTeks(e.target.value)}
                data-testid="set-maks-token"
              />
              <FieldDescription>
                Ini PLAFON pelindung, BUKAN target. Analisa tetap bisa lebih pendek dari angka ini —
                angkanya hanya membatasi seberapa panjang jawaban boleh jadi sebelum dipotong.
                ({MAKS_TOKEN_MIN}–{MAKS_TOKEN_MAKS})
              </FieldDescription>
              {/* Plafon besar = jawaban lebih panjang = waktu tunggu lebih lama. Sama seperti
                  reasoning tinggi: pilihan dibiarkan, konsekuensinya dinyatakan. */}
              <p className="text-xs text-muted-foreground">
                Peringatan: plafon besar membuat model menulis lebih panjang, sehingga analisa
                menunggu lebih lama dan berisiko kena batas waktu. Pakai plafon rendah dulu bila
                analisa terasa lambat.
              </p>
            </Field>

            {galat ? (
              <p className="text-sm text-destructive" role="alert">{galat}</p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            className="h-11 md:h-8"
            disabled={menyimpan || memuat || !setting}
            onClick={() => void simpan()}
            data-testid="simpan-setting-ai"
          >
            {menyimpan ? <Spinner data-icon="inline-start" /> : <Save className="size-4" aria-hidden />}
            {menyimpan ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
