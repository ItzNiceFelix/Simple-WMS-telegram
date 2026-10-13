"use client"

// components/dashboard/profil-form.tsx — Profil user: telegramId (salin), ubah
// username (pratinjau ketersediaan debounce 400ms), set/ganti password.
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, Copy, Loader2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis"

type Profil = { tg_id: string; username: string | null; nama: string; role: string }

type StatusCek = "diam" | "memeriksa" | "tersedia" | "dipakai"

export function ProfilForm() {
  const [profil, setProfil] = useState<Profil | null>(null)
  const [memuat, setMemuat] = useState(true)
  const [username, setUsername] = useState("")
  const [statusCek, setStatusCek] = useState<StatusCek>("diam")
  const [pesanCek, setPesanCek] = useState<string | null>(null)
  const [simpanUsername, setSimpanUsername] = useState(false)
  const [password, setPassword] = useState("")
  const [konfirmasi, setKonfirmasi] = useState("")
  const [simpanPassword, setSimpanPassword] = useState(false)
  // Token urut: hanya respons cek terakhir yang boleh mengubah status.
  const urutCek = useRef(0)

  const muat = useCallback(async () => {
    setMemuat(true)
    try {
      const res = await fetch("/api/profil", { credentials: "include" })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; profil?: Profil; error?: string } | null
      if (!res.ok || !d?.ok || !d.profil) throw new Error(d?.error ?? `Gagal memuat (${res.status}).`)
      setProfil(d.profil)
      setUsername(d.profil.username ?? "")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat profil.")
    } finally {
      setMemuat(false)
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  // Pratinjau ketersediaan: debounce 400ms, dibatalkan bila isian berubah.
  useEffect(() => {
    const bersih = username.trim().toLowerCase()
    if (!profil || bersih === "" || bersih === (profil.username ?? "")) {
      setStatusCek("diam")
      setPesanCek(null)
      return
    }
    setStatusCek("memeriksa")
    setPesanCek(null)
    const token = ++urutCek.current
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/profil/username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: bersih, cek: true }),
          credentials: "include",
        })
        const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (token !== urutCek.current) return
        if (res.ok && d?.ok) {
          setStatusCek("tersedia")
        } else {
          setStatusCek("dipakai")
          setPesanCek(d?.error ?? "Username tidak bisa dipakai.")
        }
      } catch {
        if (token !== urutCek.current) return
        setStatusCek("diam")
        setPesanCek("Gagal memeriksa. Coba lagi.")
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [username, profil])

  async function kirimUsername(e: React.FormEvent) {
    e.preventDefault()
    setSimpanUsername(true)
    try {
      const res = await fetch("/api/profil/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
        credentials: "include",
      })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; username?: string; error?: string } | null
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal (${res.status}).`)
      setProfil((p) => (p ? { ...p, username: d.username ?? username } : p))
      setUsername(d.username ?? username)
      setStatusCek("diam")
      toast.success("Username tersimpan.")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyimpan username.")
    } finally {
      setSimpanUsername(false)
    }
  }

  async function kirimPassword(e: React.FormEvent) {
    e.preventDefault()
    setSimpanPassword(true)
    try {
      const res = await fetch("/api/profil/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, konfirmasi }),
        credentials: "include",
      })
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal (${res.status}).`)
      setPassword("")
      setKonfirmasi("")
      toast.success("Password tersimpan.")
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyimpan password.")
    } finally {
      setSimpanPassword(false)
    }
  }

  async function salinTgId() {
    if (!profil) return
    try {
      await navigator.clipboard.writeText(profil.tg_id)
      toast.success("telegramId disalin.")
    } catch {
      toast.error("Gagal menyalin.")
    }
  }

  if (memuat) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }
  if (!profil) {
    return <p className="text-sm text-muted-foreground">Profil tidak ditemukan.</p>
  }

  const berubah = username.trim().toLowerCase() !== (profil.username ?? "")

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Akun</CardTitle>
          <CardDescription>{profil.nama} · {profil.role}</CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel>telegramId</FieldLabel>
            <div className="flex items-center gap-2">
              <Input readOnly value={profil.tg_id} className="h-11 md:h-8" />
              <Button
                type="button"
                variant="outline"
                onClick={salinTgId}
                className="h-11 md:h-8"
              >
                <Copy /> Salin
              </Button>
            </div>
            <FieldDescription>Dipakai untuk pemulihan password via bot Telegram.</FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Username</CardTitle>
          <CardDescription>3–20 karakter: huruf kecil, angka, dan garis bawah (_).</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={kirimUsername} className="space-y-3">
            <Field>
              <FieldLabel htmlFor="profil-username">Username</FieldLabel>
              <Input
                id="profil-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="cth. bagus"
                autoComplete="username"
                className="h-11 md:h-8"
              />
              {statusCek === "memeriksa" && (
                <FieldDescription className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" /> Memeriksa ketersediaan…
                </FieldDescription>
              )}
              {statusCek === "tersedia" && (
                <FieldDescription className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-500">
                  <Check className="size-3.5" /> Username tersedia.
                </FieldDescription>
              )}
              {statusCek === "dipakai" && (
                <FieldDescription className="flex items-center gap-1.5 text-destructive">
                  <X className="size-3.5" /> {pesanCek}
                </FieldDescription>
              )}
            </Field>
            <Button
              type="submit"
              disabled={simpanUsername || !berubah || statusCek === "dipakai"}
              className="h-11 md:h-8"
            >
              {simpanUsername ? "Menyimpan…" : "Simpan username"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Minimal 6 karakter.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={kirimPassword} className="space-y-3">
            <Field>
              <FieldLabel htmlFor="profil-password">Password baru</FieldLabel>
              <Input
                id="profil-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                className="h-11 md:h-8"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profil-konfirmasi">Konfirmasi password</FieldLabel>
              <Input
                id="profil-konfirmasi"
                type="password"
                autoComplete="new-password"
                value={konfirmasi}
                onChange={(e) => setKonfirmasi(e.target.value)}
                minLength={6}
                required
                className="h-11 md:h-8"
              />
            </Field>
            <Button
              type="submit"
              disabled={simpanPassword || password.length < 6 || password !== konfirmasi}
              className="h-11 md:h-8"
            >
              {simpanPassword ? "Menyimpan…" : "Simpan password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
