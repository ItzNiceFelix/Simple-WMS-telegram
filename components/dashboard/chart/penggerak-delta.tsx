"use client";

// components/dashboard/chart/penggerak-delta.tsx — Chart 3: siapa yang menggerakkan laba.
//
// Batang dua arah (naik ke kanan, turun ke kiri) karena pertanyaannya "siapa menaikkan dan
// siapa menurunkan", bukan "berapa nilai masing-masing". Satu sumbu nol di tengah membuat
// arahnya langsung terbaca tanpa legenda.
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { KartuGrafik } from "@/components/dashboard/chart/kartu-grafik";
import { formatRupiah, formatRupiahRingkas } from "@/lib/dashboard/format";
import type { DataPenggerak, Penggerak } from "@/lib/analisa/grafik";

export function PenggerakDelta({ data }: { data: DataPenggerak }) {
  // Satu deret: naik lalu turun, terbesar di ujung. Recharts menggambar urutan array apa
  // adanya, jadi penggabungan ini yang menentukan tampilan, bukan komponennya.
  const deret: Penggerak[] = [...data.naik, ...data.turun];
  const barisTabel = deret.map((p) => ({
    label: p.nama,
    nilai: `${p.selisih > 0 ? "+" : ""}${formatRupiah(p.selisih)}`,
    catatan: `sekarang ${formatRupiah(p.sekarang)}`,
  }));

  return (
    <KartuGrafik
      testId="grafik-penggerak"
      judul={data.judul}
      aria={data.aria}
      kurang={data.kurang}
      barisTabel={barisTabel}
      tinggi="h-80"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={deret} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
          {/* Tiga tick saja: di 390px lima label rupiah saling menimpa ("Rp -90 rb Rp 0").
              Arah batang tetap terbaca tanpa label lengkap; angka pastinya ada di tooltip
              dan tabel. */}
          <XAxis
            type="number"
            tickFormatter={formatRupiahRingkas}
            tickCount={3}
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-[10px]"
          />
          <YAxis
            type="category"
            dataKey="sku"
            width={64}
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-[10px]"
          />
          {/* Garis nol: batas antara "menambah laba" dan "mengurangi laba". */}
          <ReferenceLine x={0} stroke="var(--border)" />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={(p) => {
              if (!p.active) return null;
              const t = deret.find((x) => x.sku === String(p.label ?? ""));
              if (!t) return null;
              return (
                <div
                  className="rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="font-medium">{t.nama}</div>
                  <div className="tabular-nums">
                    {t.selisih > 0 ? "+" : ""}{formatRupiah(t.selisih)}
                  </div>
                  <div className="tabular-nums text-muted-foreground">
                    {formatRupiah(t.sebelum)} → {formatRupiah(t.sekarang)}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="selisih" isAnimationActive={false} radius={[0, 2, 2, 0]}>
            {deret.map((p) => (
              <Cell
                key={p.sku}
                fill={p.selisih >= 0 ? "var(--grafik-untung)" : "var(--grafik-rugi)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </KartuGrafik>
  );
}
