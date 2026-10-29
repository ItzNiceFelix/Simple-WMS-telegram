"use client";

// components/dashboard/chart/pareto-laba.tsx — Chart 4: seberapa bergantung laba pada
// segelintir SKU.
//
// Satu-satunya chart yang boleh memakai dua sumbu: batang = rupiah kontribusi, garis =
// persen kumulatif. Keduanya mengukur hal yang berbeda, jadi satu sumbu akan menyamakan
// dua skala yang tidak sebanding.
//
// Angka dan judul datang dari `dataPareto` (fungsi murni, bertes). Komponen ini tidak
// menjumlahkan apa pun.
import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { KartuGrafik } from "@/components/dashboard/chart/kartu-grafik";
import { formatPersen, formatRupiah, formatRupiahRingkas } from "@/lib/dashboard/format";
import type { DataPareto } from "@/lib/analisa/grafik";

export function ParetoLaba({ data }: { data: DataPareto }) {
  const barisTabel = data.titik.map((t) => ({
    label: t.nama,
    nilai: formatRupiah(t.kontribusi),
    catatan: `kumulatif ${formatPersen(t.kumulatif, 1)}`,
  }));

  return (
    <KartuGrafik
      testId="grafik-pareto"
      judul={data.judul}
      aria={data.aria}
      kurang={data.kurang}
      barisTabel={barisTabel}
      tinggi="h-72"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.titik} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
          <XAxis dataKey="sku" tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground text-[10px]" />
          {/* Batang mulai dari nol: sumbu yang dipotong membuat selisih kecil tampak besar. */}
          <YAxis
            yAxisId="rp"
            tickFormatter={formatRupiahRingkas}
            width={64}
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-xs"
          />
          <YAxis
            yAxisId="persen"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            width={40}
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-xs"
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={(p) => {
              if (!p.active) return null;
              const t = data.titik.find((x) => x.sku === String(p.label ?? ""));
              if (!t) return null;
              return (
                <div
                  className="rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="font-medium">{t.nama}</div>
                  <div className="tabular-nums">{formatRupiah(t.kontribusi)} laba</div>
                  <div className="tabular-nums text-muted-foreground">
                    kumulatif {formatPersen(t.kumulatif, 1)}
                  </div>
                </div>
              );
            }}
          />
          {/* Garis ambang konsentrasi: pembaca langsung melihat "lewat garis ini = terlalu
              bergantung". Label teks ada di judul, bukan hanya di warna garis. */}
          <ReferenceLine
            yAxisId="persen"
            y={data.ambang}
            stroke="var(--grafik-rugi)"
            strokeDasharray="4 3"
            label={{ value: `ambang ${data.ambang}%`, position: "insideTopRight", fontSize: 10, fill: "var(--grafik-rugi)" }}
          />
          <Bar yAxisId="rp" dataKey="kontribusi" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.titik.map((t) => (
              <Cell key={t.sku} fill="var(--grafik-untung)" />
            ))}
          </Bar>
          <Line
            yAxisId="persen"
            type="monotone"
            dataKey="kumulatif"
            stroke="var(--grafik-netral)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </KartuGrafik>
  );
}
