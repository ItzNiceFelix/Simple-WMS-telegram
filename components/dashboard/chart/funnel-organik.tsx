"use client";

// components/dashboard/chart/funnel-organik.tsx — Chart 5: di mana pembeli hilang.
//
// Batang mendatar bertingkat, satu tahap per baris. Lebar batang memakai SKALA LOG karena
// selisih dilihat → pesanan bisa 100×: dengan skala linear, tahap terakhir menjadi garis
// tak terlihat dan chart kehilangan gunanya. Angka asli selalu ditulis di sebelah batang,
// jadi skala log tidak menyembunyikan besaran sebenarnya.
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { KartuGrafik } from "@/components/dashboard/chart/kartu-grafik";
import { formatAngka, formatPersen } from "@/lib/dashboard/format";
import type { DataFunnel } from "@/lib/analisa/grafik";

export function FunnelOrganik({ data, testId = "grafik-funnel" }: { data: DataFunnel; testId?: string }) {
  const deret = data.tahap.map((t) => ({
    label: t.label,
    // Nilai 0 tidak bisa digambar di skala log; dipakai 1 agar batangnya tetap ada
    // (sangat tipis) sementara label menuliskan angka aslinya.
    gambar: t.nilai === null ? null : Math.max(1, t.nilai),
    asli: t.nilai,
    persen: t.persenDariSebelum,
  }));
  const barisTabel = data.tahap.map((t) => ({
    label: t.label,
    nilai: t.nilai === null ? "—" : formatAngka(t.nilai),
    catatan: t.persenDariSebelum === null ? "tahap sebelumnya belum ada" : `${formatPersen(t.persenDariSebelum, 1)} lanjut`,
  }));

  return (
    <KartuGrafik
      testId={testId}
      judul={data.judul}
      aria={data.aria}
      kurang={data.kurang}
      barisTabel={barisTabel}
      tinggi="h-56"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={deret} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 4 }}>
          {/* Skala log WAJIB disebut: panjang batang bukan perbandingan linear, dan pembaca
              yang mengira sebanding akan menyimpulkan "keranjang hampir sebesar kunjungan".
              Sumbu angkanya sendiri disembunyikan — angka asli sudah tertulis di ujung
              setiap batang, dan dua skala angka sekaligus hanya menambah kebisingan. */}
          <XAxis type="number" scale="log" domain={[1, "auto"]} hide />
          <text x={8} y={10} className="fill-muted-foreground text-[10px]">skala log</text>
          <YAxis
            type="category"
            dataKey="label"
            width={84}
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-xs"
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={(p) => {
              if (!p.active) return null;
              const t = deret.find((x) => x.label === String(p.label ?? ""));
              if (!t) return null;
              return (
                <div
                  className="rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="tabular-nums">{t.asli === null ? "belum ada data" : formatAngka(t.asli)}</div>
                  {t.persen === null ? null : (
                    <div className="tabular-nums text-muted-foreground">
                      {formatPersen(t.persen, 1)} dari tahap sebelumnya
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="gambar" isAnimationActive={false} radius={[0, 2, 2, 0]}>
            {deret.map((t) => (
              <Cell key={t.label} fill="var(--grafik-untung)" fillOpacity={t.asli === null ? 0.25 : 1} />
            ))}
            {/* Angka ASLI, bukan nilai gambar: sumbu log tidak boleh menyembunyikan besaran. */}
            <LabelList
              dataKey="asli"
              position="right"
              className="fill-foreground text-[11px]"
              formatter={(v: unknown) => (v === null || v === undefined ? "—" : formatAngka(Number(v)))}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </KartuGrafik>
  );
}
