"use client";

// components/dashboard/analisa-kpi.tsx — baris KPI: angka + pembanding, dengan arah yang
// berbeda untuk metrik biaya.
//
// KENAPA arah warna tidak boleh seragam: biaya iklan NAIK adalah kabar buruk, omzet NAIK
// adalah kabar baik. Satu warna "hijau = naik" untuk keduanya akan membuat kenaikan biaya
// tampak seperti prestasi.
//
// Komponen ini hanya memformat keluaran `dataKpi()` (murni, bertes).
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatAngka, formatPersen, formatRupiahRingkas } from "@/lib/dashboard/format";
import type { HasilKpi, KartuKpi } from "@/lib/analisa/kpi";

function nilaiTeks(k: KartuKpi): string {
  if (k.nilai === null) return "—";
  if (k.satuan === "rupiah") return formatRupiahRingkas(k.nilai);
  if (k.satuan === "persen") return formatPersen(k.nilai, k.desimal ?? 2);
  if (k.satuan === "rasio") return `${formatPersen(k.nilai, 2).replace("%", "")}×`;
  return formatAngka(k.nilai);
}

/** Delta: ikon + tanda + satuan. Warna HANYA pelengkap; teksnya sudah menyatakan arah. */
function Delta({ k }: { k: KartuKpi }) {
  const d = k.delta;
  if (!d) return <span className="text-xs text-muted-foreground">belum ada pembanding</span>;
  if (d.selisih === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" aria-hidden /> sama
      </span>
    );
  }
  const naik = d.selisih > 0;
  const baik = k.arahBaik === "naik" ? naik : !naik;
  const Ikon = naik ? ArrowUpRight : ArrowDownRight;
  const besaran = d.satuan === "poin"
    ? `${formatPersen(Math.abs(d.selisih), 2).replace("%", "")} poin`
    : d.persen === null
      ? formatAngka(Math.abs(d.selisih))
      : `${formatPersen(Math.abs(d.persen), 1)}`;
  return (
    <span
      className={`flex items-center gap-1 text-xs ${baik ? "text-status-aman-fg" : "text-status-minus-fg"}`}
      data-testid={`delta-${k.kunci}`}
    >
      <Ikon className="size-3" aria-hidden />
      {naik ? "+" : "−"}{besaran}
    </span>
  );
}

export function AnalisaKpi({ data }: { data: HasilKpi }) {
  return (
    <div className="flex flex-col gap-2" data-testid="baris-kpi">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {data.kartu.map((k) => (
          <Card key={k.kunci} className="py-0">
            <CardContent className="flex flex-col gap-0.5 p-3">
              <span className="text-xs text-muted-foreground">{k.label}</span>
              <span className="text-lg font-semibold tabular-nums" data-testid={`kpi-${k.kunci}`}>
                {nilaiTeks(k)}
              </span>
              <Delta k={k} />
              {k.catatan ? (
                <span className="text-[10px] leading-tight text-muted-foreground">{k.catatan}</span>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {data.parsial ? (
          // Penanda periode, bukan penanda kartu: yang tidak utuh adalah PERIODENYA, dan
          // menempelkannya di satu kartu membuat kartu lain terbaca seolah utuh.
          <span className="rounded border px-1.5 py-0.5" data-testid="kpi-parsial">
            periode memuat hari parsial — delta tidak boleh dibaca sebagai tren
          </span>
        ) : null}
        {data.catatan.map((c) => <span key={c}>{c}</span>)}
      </div>
    </div>
  );
}
