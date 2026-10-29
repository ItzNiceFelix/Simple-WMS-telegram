"use client";

// components/dashboard/chart/stok-kontribusi.tsx — Chart 8: penyumbang laba yang paling
// cepat kehabisan stok.
//
// Batang mendatar "hari stok tersisa", diurut kontribusi laba terbesar. Pertanyaannya
// "produk mana yang paling menguntungkan tapi paling cepat habis", jadi urutannya
// kontribusi, bukan hari tersisa — SKU yang habis besok tapi labanya Rp 2.000 bukan
// prioritas restok.
//
// Angka hari, bukan jumlah stok: stok 50 unit berarti "aman" untuk produk 2/hari dan
// "habis besok" untuk 40/hari.
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KartuGrafik } from "@/components/dashboard/chart/kartu-grafik";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";
import type { DataStok, TitikStok } from "@/lib/analisa/grafik";

/** Warna per tingkat urgensi. Teks status tetap ada di tooltip dan tabel. */
function warna(t: TitikStok, ambang: number): string {
  if (t.hariTersisa === null) return "var(--grafik-tidak-ada)";
  if (t.hariTersisa <= ambang) return "var(--grafik-rugi)";
  if (t.hariTersisa <= ambang * 2) return "var(--grafik-netral)";
  return "var(--grafik-untung)";
}

export function StokKontribusi({ data }: { data: DataStok }) {
  // Batas 15 titik: lebih dari itu sumbu kategori tidak terbaca di 390px, dan SKU dengan
  // kontribusi terkecil tidak mengubah keputusan restok.
  const deret = data.titik.slice(0, 15);
  // Panjang gambar minimal: SKU dengan 0,1 hari tersisa adalah yang PALING mendesak, tetapi
  // batangnya nyaris nol piksel sehingga justru tidak terlihat. Nilai gambar diberi lantai
  // kecil; angka aslinya tetap ditulis di tooltip dan tabel.
  const gambar = deret.map((t) => ({
    ...t,
    panjang: t.hariTersisa === null ? 0 : Math.max(t.hariTersisa, 0.6),
  }));
  const barisTabel = deret.map((t) => ({
    label: t.nama,
    nilai: t.hariTersisa === null ? "—" : `${formatAngka(t.hariTersisa)} hari`,
    catatan: `stok ${formatAngka(t.stok)} · terjual ${formatAngka(t.unit)} · laba ${formatRupiah(t.kontribusi)}`,
  }));

  if (data.titik.length === 0) {
    return (
      <Card data-testid="grafik-stok">
        <CardHeader>
          <CardTitle className="text-base leading-snug">{data.judul}</CardTitle>
          <CardDescription>
            {data.kurang.length > 0 ? data.kurang.join(" · ") : "Tidak ada SKU yang bisa diproyeksikan."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <KartuGrafik
      testId="grafik-stok"
      judul={data.judul}
      aria={data.aria}
      kurang={data.kurang}
      barisTabel={barisTabel}
      tinggi="h-80"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={gambar} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
          <XAxis
            type="number"
            tickFormatter={(v: number) => `${v}h`}
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
          {/* Garis ambang kritis: pembaca langsung melihat batang mana yang sudah lewat.
              TANPA label teks di garis: recharts menggambarnya di luar area plot dan
              terpotong tepi kartu di 390px. Ambangnya sudah tertulis di judul. */}
          <ReferenceLine x={data.ambangKritis} stroke="var(--grafik-rugi)" strokeDasharray="4 3" />
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
                    {t.hariTersisa === null ? "tidak bisa diproyeksikan" : `${formatAngka(t.hariTersisa)} hari tersisa`}
                  </div>
                  <div className="tabular-nums text-muted-foreground">
                    stok {formatAngka(t.stok)} · terjual {formatAngka(t.unit)}
                  </div>
                  <div className="tabular-nums text-muted-foreground">
                    laba {formatRupiah(t.kontribusi)}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="panjang" isAnimationActive={false} radius={[0, 2, 2, 0]}>
            {deret.map((t) => (
              <Cell key={t.sku} fill={warna(t, data.ambangKritis)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </KartuGrafik>
  );
}
