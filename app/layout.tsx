import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist } from "next/font/google";

import { cn } from "cn";
import { SumberDataProvider } from "@/lib/dashboard/sumber-data";
import { AppShell } from "@/components/dashboard/app-shell";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Admin Toko — Dashboard",
  description: "Dashboard Telegram Mini App untuk operasional toko.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body>
        {/* SDK Telegram: wajib memuat window.Telegram.WebApp.initData (PRD N1/11.1).
            beforeInteractive = tersedia sebelum bundle app jalan, cegah race. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <SumberDataProvider>
          <AppShell>{children}</AppShell>
          <Toaster position="top-center" />
        </SumberDataProvider>
      </body>
    </html>
  );
}
