"use client";

// Guard sisi klien: menyembunyikan/menolak halaman yang tidak diizinkan role.
// Ini BUKAN pengaman (PRD 8.1) — Rules Firestore + server route yang menegakkan.
import type { ReactNode } from "react";

import { AksesDitolak } from "@/components/dashboard/akses-ditolak";
import { bolehAkses } from "@/components/dashboard/nav-config";
import { useRole } from "@/lib/dashboard/sumber-data";

export function ButuhAkses({ href, children }: { href: string; children: ReactNode }) {
  const role = useRole();
  if (!bolehAkses(role, href)) return <AksesDitolak />;
  return <>{children}</>;
}
