import Link from "next/link";
import { ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";

export function AksesDitolak({
  deskripsi = "Peran akun ini tidak punya akses ke halaman ini. Hubungi owner bila perlu.",
}: {
  deskripsi?: string;
}) {
  return (
    <div
      role="alert"
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center"
      data-testid="akses-ditolak"
    >
      <ShieldX aria-hidden className="size-10 text-muted-foreground" />
      <div>
        <h2 className="text-lg font-semibold">Akses ditolak</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{deskripsi}</p>
      </div>
      <Button variant="outline" render={<Link href="/" />}>
        Kembali ke Ringkasan
      </Button>
    </div>
  );
}
