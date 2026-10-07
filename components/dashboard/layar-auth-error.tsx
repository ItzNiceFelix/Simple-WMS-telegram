"use client";

// components/dashboard/layar-auth-error.tsx
// Layar error auth (401/403/500 atau waktu habis) untuk mode real.
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LayarAuthError({
  pesan,
  kode,
  onCoba,
}: {
  pesan: string;
  kode?: number;
  onCoba?: () => void;
}) {
  return (
    <div
      data-testid="auth-error"
      role="alert"
      className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center gap-4 text-center"
    >
      <ShieldAlert aria-hidden className="size-10 text-muted-foreground" />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Tidak dapat masuk</h1>
        <p className="text-sm text-muted-foreground">{pesan}</p>
        {kode ? <p className="text-xs text-muted-foreground">Kode: {kode}</p> : null}
      </div>
      <Button variant="outline" onClick={onCoba ?? (() => window.location.reload())}>
        Coba lagi
      </Button>
    </div>
  );
}
