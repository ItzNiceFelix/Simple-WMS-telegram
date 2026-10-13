"use client"

// components/dashboard/pagar-viewport.tsx — Pagar viewport /ai-gambar (rencana §10.1).
// < 1024px: layar ARAHAN (bukan blokir mentah) — user di HP justru butuh tautannya.
import { useEffect, useState } from "react"
import { Monitor, Copy, Check } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AiGambarStudio } from "@/components/dashboard/ai-gambar-studio"

/** Hook media query kecil; null = belum terukur (hindari kedip salah layar). */
function useMediaQuery(query: string): boolean | null {
  const [cocok, setCocok] = useState<boolean | null>(null)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const sinkron = () => setCocok(mq.matches)
    sinkron()
    mq.addEventListener("change", sinkron)
    return () => mq.removeEventListener("change", sinkron)
  }, [query])
  return cocok
}

async function salinTeks(teks: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(teks)
    return true
  } catch {
    // Clipboard API ditolak (izin/konteks tak aman) → jalan lama.
    const ta = document.createElement("textarea")
    ta.value = teks
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  }
}

export function PagarViewport() {
  const lebar = useMediaQuery("(min-width: 1024px)")
  const [tersalin, setTersalin] = useState(false)
  const [tautan, setTautan] = useState("")

  useEffect(() => {
    setTautan(window.location.href)
  }, [])

  // Belum terukur: jangan render salah satu layar (cegah kedip + workspace kosong).
  if (lebar === null) return null
  if (lebar) return <AiGambarStudio />

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md" data-testid="layar-arahan-pc">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor aria-hidden className="size-5 text-muted-foreground" />
            Halaman ini butuh layar PC
          </CardTitle>
          <CardDescription>
            Studio gambar produk butuh area luas untuk pratinjau dan anotasi. Buka di komputer/laptop.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
            {tautan}
          </p>
          <Button
            variant="outline"
            className="h-11 w-full md:h-8"
            onClick={() => {
              void (async () => {
                const ok = await salinTeks(tautan)
                setTersalin(ok)
                if (ok) toast.success("Tautan disalin.")
                else toast.error("Gagal menyalin. Salin manual dari teks di atas.")
              })()
            }}
            data-testid="salin-tautan"
          >
            {tersalin ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {tersalin ? "Tersalin" : "Salin tautan"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
