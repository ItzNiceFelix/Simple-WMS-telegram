"use client";

// components/dashboard/buka-dari-telegram.tsx
// Layar wajib saat initData tidak ada (PRD N1, FR-AUTH-05): akses browser-only = tanpa data.
import { ExternalLink, Send } from "lucide-react";

export function BukaDariTelegram() {
  return (
    <div
      data-testid="buka-dari-telegram"
      className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center gap-4 text-center"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-secondary">
        <Send aria-hidden className="size-7 text-secondary-foreground" />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Buka dari Telegram</h1>
        <p className="text-sm text-muted-foreground">
          Dashboard ini hanya dapat diakses dari dalam Telegram. Buka bot lalu ketuk menu
          Mini App untuk melanjutkan.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Tidak ada data yang ditampilkan tanpa identitas Telegram.
      </p>
      <ExternalLink aria-hidden className="size-4 text-muted-foreground" />
    </div>
  );
}
