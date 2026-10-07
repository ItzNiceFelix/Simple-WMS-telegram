"use client"

// components/dashboard/umpan-tulis.ts
// Umpan balik bersama untuk aksi tulis v2 (PRD v1 §11.2, PRD v2 §12).
import { toast } from "sonner"

import { SESI_KEDALUWARSA, bukaUlangTelegram, sesiKedaluwarsa } from "@/lib/dashboard/pesan"

/** Toast 401 + tombol "Buka ulang" (tidak auto-tutup). Form DIPERTAHANKAN oleh pemanggil. */
export function toastSesiKedaluwarsa(): void {
  toast.error(SESI_KEDALUWARSA, {
    duration: Infinity,
    action: { label: "Buka ulang", onClick: () => bukaUlangTelegram() },
  })
}

/**
 * Tampilkan kegagalan tulis. Kembalikan `true` bila penyebabnya sesi kedaluwarsa
 * (pemanggil WAJIB menahan dialog + isian form).
 */
export function tampilkanGagalTulis(error: string | null | undefined): boolean {
  if (sesiKedaluwarsa(error)) {
    toastSesiKedaluwarsa()
    return true
  }
  toast.error(error || "Gagal menyimpan. Coba lagi.")
  return false
}