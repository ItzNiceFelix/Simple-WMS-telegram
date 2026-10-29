"use client";

// components/dashboard/chart/roas-vs-impas.tsx — Chart 7: iklan mana yang rugi.
//
// Dua batang berdampingan per SKU: ROAS aktual dan titik impas SKU itu sendiri. Penanda
// impas PER SKU (dari margin SKU tersebut), bukan satu margin toko — produk bermargin 5%
// dan 40% tidak punya titik impas yang sama, dan memakai rata-rata toko akan menyebut
// produk bermargin tipis "aman" padahal ia rugi.
//
// Warna: hijau = sudah melewati impas, merah = belum, abu = tidak bisa dinilai. Teks status
// selalu ada di tabel alternatif, jadi warna bukan satu-satunya pembawa informasi.
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { KartuGrafik } from "@/components/dashboard/chart/kartu-grafik";
import { formatPersen, formatRupiah } from "@/lib/dashboard/format";
import type { BarisRoas, DataRoas } from "@/lib/analisa/grafik";

const LABEL_STATUS: Record<BarisRoas["status"], string> = {
  aman: "di atas impas",
  rugi: "di bawah impas",
  tidak_dinilai: "tidak dinilai",
};

/** Rasio ditulis "1,28×"; null jadi "—" (tidak dihitung), bukan 0. */
function rasio(n: number | null): string {
  return n === null ? "—" : `${formatPersen(n, 2).replace("%", "")}×`;
}

export function RoasVsImpas({ data }: { data: DataRoas }) {
  const deret = data.baris.map((b) => ({
    sku: b.sku,
    nama: b.nama,
    aktual: b.roasAktual,
    impas: b.roasImpas,
    langsung: b.roasLangsung,
    status: b.status,
  }));
  const barisTabel = data.baris.map((b) => ({
    label: b.nama,
    nilai: `${rasio(b.roasAktual)} vs impas ${rasio(b.roasImpas)}`,
    catatan: `${LABEL_STATUS[b.status]}${b.roasLangsung === null ? "" : ` · langsung ${rasio(b.roasLangsung)}`}`,
  }));

  return (
    <KartuGrafik
      testId="grafik-roas-impas"
      judul={data.judul}
      aria={data.aria}
      kurang={data.kurang}
      barisTabel={barisTabel}
      tinggi="h-80"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={deret} margin={{ top: 8, right: 8, left: 0, bottom: 28 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
          <XAxis
            dataKey="sku"
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-[10px]"
            angle={-35}
            textAnchor="end"
            height={48}
            interval={0}
          />
          <YAxis
            tickFormatter={(v: number) => `${v}×`}
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-xs"
            width={44}
          />
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
                  <div className="tabular-nums">ROAS aktual {rasio(t.aktual)}</div>
                  <div className="tabular-nums">Titik impas {rasio(t.impas)}</div>
                  {t.langsung === null ? null : (
                    <div className="tabular-nums text-muted-foreground">ROAS langsung {rasio(t.langsung)}</div>
                  )}
                  <div className="text-muted-foreground">{LABEL_STATUS[t.status]}</div>
                </div>
              );
            }}
          />
          {/* Batang aktual: warna menyatakan status terhadap impas. */}
          <Bar dataKey="aktual" name="ROAS aktual" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {deret.map((t) => (
              <Cell
                key={t.sku}
                fill={
                  t.status === "aman"
                    ? "var(--grafik-untung)"
                    : t.status === "rugi"
                      ? "var(--grafik-rugi)"
                      : "var(--grafik-tidak-ada)"
                }
              />
            ))}
          </Bar>
          {/* Batang impas: abu netral. Selalu di sebelah aktual supaya selisihnya terbaca
              sebagai jarak, bukan sebagai dua angka yang harus dihitung sendiri. */}
          <Bar dataKey="impas" name="Titik impas" fill="var(--grafik-netral)" fillOpacity={0.45} isAnimationActive={false} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </KartuGrafik>
  );
}
