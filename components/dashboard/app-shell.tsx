"use client";

import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { RoleSwitcher } from "@/components/dashboard/role-switcher";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { BukaDariTelegram } from "@/components/dashboard/buka-dari-telegram";
import { LayarAuthError } from "@/components/dashboard/layar-auth-error";
import { SplashAwal } from "@/components/dashboard/splash-awal";
import { useSumberData } from "@/lib/dashboard/sumber-data";

export function AppShell({ children }: { children: ReactNode }) {
  const { statusAuth, pesanAuth, coba } = useSumberData();

  // Inisialisasi sesi: tahan render konten agar halaman tidak menembak data source
  // yang belum siap (mencegah error palsu saat pembukaan pertama).
  if (statusAuth === "memuat") {
    return <SplashAwal onCoba={coba} />;
  }

  // PRD N1/FR-AUTH-05: tanpa Telegram -> layar khusus, tanpa data.
  if (statusAuth === "tanpa_telegram") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <BukaDariTelegram />
      </div>
    );
  }
  if (statusAuth === "gagal") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <LayarAuthError pesan={pesanAuth ?? "Terjadi kesalahan saat memuat sesi."} onCoba={coba} />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck aria-hidden className="size-5 text-primary md:hidden" />
            <span className="text-sm font-semibold md:hidden">Admin Toko</span>
          </div>
          <div className="hidden text-sm text-muted-foreground md:block">
            Dashboard Telegram Mini App
          </div>
          <div className="flex items-center gap-1 md:hidden">
            <RoleSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pt-4 pb-24 md:px-6 md:pb-8">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
