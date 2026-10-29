"use client";

// components/dashboard/chart/waterfall-laba.tsx — Chart 1: ke mana omzet pergi.
//
// Komponen ini HANYA menggambar keluaran `dataWaterfall` (lib/analisa/grafik.ts). Tidak ada
// penjumlahan di sini: angka yang tampil di tooltip dan di tabel alternatif adalah angka
// yang sama persis dengan yang dipakai tes.
//
// Recharts digambar sebagai batang BERTUMPUK: alas tak terlihat (`dasar`) + panjang yang
// terlihat (`panjang`). Itu satu-satunya cara batang air mulai dari ujung batang sebelumnya
// tanpa menghitung posisi piksel sendiri.
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { KartuGrafik } from "@/components/dashboard/chart/kartu-grafik";
import { formatRupiah, formatRupiahRingkas } from "@/lib/dashboard/format";
import type { BatangAir, DataWaterfall } from "@/lib/analisa/grafik";

/** Peran batang → token CSS. Warna TIDAK pernah dipakai sendirian: legenda di tabel
 *  menyebut "naik/turun/akhir" dengan kata, jadi buta warna tidak kehilangan informasinya. */
const WARNA: Record<BatangAir["jenis"], string> = {
  masuk: "var(--grafik-untung)",
  keluar: "var(--grafik-rugi)",
  total: "var(--grafik-netral)",
  tidak_ada: "var(--grafik-tidak-ada)",
};

export function WaterfallLaba({ data }: { data: DataWaterfall }) {
  const barisTabel = data.batang.map((b) => ({
    label: b.label,
    nilai: b.jenis === "tidak_ada" ? "—" : formatRupiah(b.nilai),
    ...(b.catatan ? { catatan: b.catatan } : {}),
  }));

  return (
    <KartuGrafik
      testId="grafik-waterfall"
      judul={data.judul}
      aria={data.aria}
      kurang={data.kurang}
      barisTabel={barisTabel}
      tinggi="h-72"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.batang} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
          {/* `pendek` (bukan `label`): singkatan sumbu ditentukan fungsi murni, jadi tidak
              ada pemotongan string yang hasilnya berbeda-beda antar render. Label penuh
              tetap dipakai tooltip dan tabel alternatif. */}
          <XAxis
            dataKey="pendek"
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-[10px]"
            interval={0}
            angle={-30}
            textAnchor="end"
            height={58}
          />
          <YAxis
            tickFormatter={formatRupiahRingkas}
            width={64}
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-xs"
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={(p) => {
              if (!p.active) return null;
              const b = data.batang.find((x) => x.pendek === String(p.label ?? ""));
              if (!b) return null;
              return (
                <div
                  className="rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="font-medium">{b.label}</div>
                  <div className="tabular-nums">
                    {b.jenis === "tidak_ada" ? "belum diimpor" : formatRupiah(b.nilai)}
                  </div>
                  {b.catatan ? <div className="text-muted-foreground">{b.catatan}</div> : null}
                </div>
              );
            }}
          />
          {/* Alas: transparan. `stackId` sama supaya batang kedua menumpuk di atasnya. */}
          <Bar dataKey="dasar" stackId="air" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="panjang" stackId="air" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.batang.map((b) => (
              <Cell key={b.kunci} fill={WARNA[b.jenis]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </KartuGrafik>
  );
}
