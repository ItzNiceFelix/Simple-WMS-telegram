"use client";

// components/dashboard/chart/peta-peluang.tsx — Chart 6: mana yang boros trafik, mana yang
// layak didorong.
//
// Sebaran titik: x = kunjungan organik (skala log), y = CR organik %, ukuran = omzet.
// Dua garis rata-rata membagi peta jadi empat kuadran yang bisa dibaca tanpa legenda.
//
// Ukuran titik memakai akar omzet, bukan omzet: selisih omzet antar SKU bisa ratusan kali,
// dan titik terbesar akan menutupi seluruh peta. Akar menjaga urutan tetap benar tanpa
// menghilangkan titik kecil.
import {
  CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";

import { KartuGrafik } from "@/components/dashboard/chart/kartu-grafik";
import { formatAngka, formatPersen, formatRupiah } from "@/lib/dashboard/format";
import type { DataPeluang, TitikPeluang } from "@/lib/analisa/grafik";

export function PetaPeluang({ data }: { data: DataPeluang }) {
  // Sumbu X memakai LOG10, bukan `scale="log"` bawaan recharts: pada `scale="log"`
  // recharts tetap menghitung tick sendiri dan mengabaikan `ticks`, sehingga labelnya
  // bertumpuk ("120 180 240 …") dan tidak terbaca. Dengan log10, tick jatuh tepat di
  // pangkat sepuluh dan formatnya bisa dikendalikan.
  const deret = data.titik.map((t) => ({
    ...t,
    xLog: Math.log10(Math.max(1, t.x)),
    r: Math.sqrt(Math.max(0, t.ukuran)),
  }));
  const xMaks = Math.max(1, ...deret.map((d) => d.xLog));
  const tickLog = Array.from({ length: Math.ceil(xMaks) + 1 }, (_, i) => i)
    .filter((i) => i <= xMaks)
    // Tick 0..n pangkat sepuluh; nilai 0 (x=1) tidak ditampilkan karena produk dengan satu
    // kunjungan bukan informasi yang berguna di sumbu.
    .filter((i) => i > 0);
  const barisTabel = deret.map((t) => ({
    label: t.nama,
    nilai: `${formatPersen(t.y, 2)} CR`,
    catatan: `${formatAngka(t.x)} kunjungan · ${formatRupiah(t.ukuran)}`,
  }));

  return (
    <KartuGrafik
      testId="grafik-peluang"
      judul={data.judul}
      aria={data.aria}
      kurang={data.kurang}
      barisTabel={barisTabel}
      tinggi="h-80"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
          <XAxis
            type="number"
            dataKey="xLog"
            domain={[0, Math.ceil(xMaks)]}
            ticks={tickLog}
            name="Kunjungan"
            // Tick dalam pangkat sepuluh: 10, 100, 1rb, 10rb.
            tickFormatter={(v: number) => {
              const asli = 10 ** v;
              return asli >= 1000 ? `${asli / 1000}rb` : formatAngka(asli);
            }}
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-xs"
            // Label sumbu: tanpa ini pembaca tidak tahu skalanya log.
            label={{ value: "Kunjungan organik (log)", position: "insideBottom", offset: -14, fontSize: 10, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="CR"
            tickFormatter={(v: number) => `${v}%`}
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
            className="text-muted-foreground text-xs"
            width={48}
          />
          <ZAxis type="number" dataKey="r" range={[40, 400]} />
          {/* Garis rata-rata: pembagi kuadran. Nilai null tidak digambar — garis di 0 akan
              menyiratkan "rata-rata nol" yang tidak benar. */}
          {data.kunjunganRata !== null ? (
            <ReferenceLine x={data.kunjunganRata} stroke="var(--grafik-netral)" strokeDasharray="4 3" />
          ) : null}
          {data.crRata !== null ? (
            <ReferenceLine y={data.crRata} stroke="var(--grafik-netral)" strokeDasharray="4 3" />
          ) : null}
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={(p) => {
              if (!p.active || !p.payload || p.payload.length === 0) return null;
              const t = (p.payload[0] as { payload?: TitikPeluang }).payload;
              if (!t) return null;
              return (
                <div
                  className="rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="font-medium">{t.nama}</div>
                  <div className="tabular-nums">{formatAngka(t.x)} kunjungan · {formatPersen(t.y, 2)} CR</div>
                  <div className="tabular-nums text-muted-foreground">{formatRupiah(t.ukuran)} omzet</div>
                  {t.tag.length > 0 ? <div className="text-muted-foreground">{t.tag.join(" · ")}</div> : null}
                </div>
              );
            }}
          />
          <Scatter data={deret} isAnimationActive={false} fill="var(--grafik-untung)" fillOpacity={0.55} />
        </ScatterChart>
      </ResponsiveContainer>
    </KartuGrafik>
  );
}
