"use client";

// components/dashboard/splash-awal.tsx
// Layar saat inisialisasi sesi (mode real). Minimal: judul + animasi + tombol coba lagi.
import { Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SplashAwal({
  pesan,
  onCoba,
}: {
  pesan?: string;
  onCoba?: () => void;
}) {
  return (
    <div
      data-testid="splash-awal"
      className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background p-6 text-foreground"
      role="status"
      aria-live="polite"
    >
      <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary">
        <ShieldCheck aria-hidden className="size-7 text-secondary-foreground" />
      </div>
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold">Admin Toko</h1>
        <p className="text-sm text-muted-foreground">
          {pesan ?? "Menyiapkan dashboard…"}
        </p>
      </div>
      <Loader2 aria-hidden className="size-5 animate-spin text-muted-foreground" />
      <span className="sr-only">Memuat</span>
      {onCoba ? (
        <Button variant="outline" onClick={onCoba}>
          Coba lagi
        </Button>
      ) : null}
    </div>
  );
}
