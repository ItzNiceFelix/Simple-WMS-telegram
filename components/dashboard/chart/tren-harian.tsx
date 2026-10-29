"use client";

// components/dashboard/chart/tren-harian.tsx — Chart 2: tren harian satu metrik.
//
// SATU chart = SATU pesan. Karena itu metriknya dipilih (omzet / laba / margin / pesanan),
// bukan digambar bersamaan: dua garis dengan satuan berbeda (rupiah dan persen) pada satu
// sumbu membuat pembaca membandingkan angka yang tidak sebanding.
//
// Angka, judul, dan tanda hari-parsial datang dari `dataTren` (lib/analisa/grafik.ts, murni
// dan bertes). Komponen ini tidak menghitung apa pun.
import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAngka, formatPersen, formatRupiah, formatRupiahRingkas } from "@/lib/dashboard/format";
import { dataTren, type MetrikTren } from "@/lib/analisa/grafik";
import type { TitikHarian } from "@/lib/analisa/tren";

const METRIK: { kunci: MetrikTren; label: string }[] = [
  { kunci: "omzet", label: "Omzet" },
  { kunci: "laba", label: "Laba" },
  { kunci: "margin", label: "Margin" },
  { kunci: "order", label: "Pesanan" },
];

/** Sumbu Y menyesuaikan satuan metrik — rupiah ringkas, persen, atau jumlah. */
function tickUntuk(metrik: MetrikTren) {
  return (v: number): string => {
    if (metrik === "omzet" || metrik === "laba") return formatRupiahRingkas(v);
    if (metrik === "margin") return `${v}%`;
    return formatAngka(v);
  };
}

export function TrenHarian({ seri, testId = "grafik-harian" }: { seri: (TitikHarian | null)[]; testId?: string }) {
  const [metrik, setMetrik] = useState<MetrikTren>("omzet");
  const [bentuk, setBentuk] = useState<"garis" | "batang">("garis");
  const d = dataTren(seri, metrik);
  const parsial = d.titik.filter((t) => t.parsial).map((t) => t.tanggal);

  const nilaiTeks = (v: number): string =>
    metrik === "omzet" || metrik === "laba"
      ? formatRupiah(v)
      : metrik === "margin"
        ? formatPersen(v, 1)
        : formatAngka(v);

  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-base leading-snug">{d.judul}</CardTitle>
        <CardDescription>
          {metrik === "margin" ? "Persen laba dari omzet, per hari." : `Angka per hari; hari bertanda parsial tidak dipakai menghitung perubahan.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Kontrol di baris sendiri, bukan di dalam CardDescription: di 390px empat tombol
            metrik + dua tombol bentuk tidak muat satu baris, dan menyisipkannya ke deskripsi
            membuat tombol terakhir terpotong tepi kartu. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {METRIK.map((m) => (
            <Button
              key={m.kunci}
              type="button"
              size="sm"
              variant={metrik === m.kunci ? "default" : "outline"}
              onClick={() => setMetrik(m.kunci)}
              data-testid={`metrik-${m.kunci}`}
            >
              {m.label}
            </Button>
          ))}
          <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
          {(["garis", "batang"] as const).map((b) => (
            <Button
              key={b}
              type="button"
              size="sm"
              variant={bentuk === b ? "default" : "outline"}
              onClick={() => setBentuk(b)}
              data-testid={`bentuk-${b}`}
            >
              {b === "garis" ? "Garis" : "Batang"}
            </Button>
          ))}
        </div>

        <div className="h-64 w-full" role="img" aria-label={d.aria}>
          <ResponsiveContainer width="100%" height="100%">
            {bentuk === "garis" ? (
              <LineChart data={d.titik} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
                <XAxis
                  dataKey="hari" tickLine={false} axisLine={false}
                  stroke="currentColor" className="text-muted-foreground text-xs"
                />
                <YAxis
                  tickFormatter={tickUntuk(metrik)} width={64} tickLine={false} axisLine={false}
                  stroke="currentColor" className="text-muted-foreground text-xs"
                />
                {/* Hari parsial ditandai GARIS TEGAK PUTUS-PUTUS, bukan warna berbeda: warna
                    sudah dipakai untuk metrik, dan tanda bentuk tetap terbaca saat buta warna. */}
                {parsial.map((t) => (
                  <ReferenceLine key={t} x={t.slice(8, 10)} stroke="var(--grafik-netral)" strokeDasharray="2 4" />
                ))}
                <Tooltip
                  cursor={{ stroke: "var(--border)" }}
                  content={(p) => {
                    if (!p.active) return null;
                    const t = d.titik.find((x) => x.hari === String(p.label ?? ""));
                    if (!t) return null;
                    return (
                      <div
                        className="rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <div className="font-medium">{t.tanggal || "tanpa data"}</div>
                        <div className="tabular-nums">{t.nilai === null ? "belum ada data" : nilaiTeks(t.nilai)}</div>
                        {t.parsial ? <div className="text-muted-foreground">hari parsial</div> : null}
                      </div>
                    );
                  }}
                />
                {/* Garis utama TIDAK menyambung hari parsial; hari itu punya serinya sendiri
                    (putus-putus + titik berlubang) supaya terlihat "diukur, tapi tidak utuh". */}
                <Line
                  type="monotone" dataKey="nilaiPenuh" name={metrik}
                  stroke="var(--grafik-untung)" strokeWidth={2} dot={false}
                  connectNulls={false} isAnimationActive={false}
                />
                <Line
                  type="monotone" dataKey="nilaiParsial" name={`${metrik} (parsial)`}
                  stroke="var(--grafik-netral)" strokeWidth={2} strokeDasharray="4 3"
                  connectNulls={false} isAnimationActive={false}
                  dot={{ r: 4, fill: "var(--card)", stroke: "var(--grafik-netral)", strokeWidth: 2 }}
                />
              </LineChart>
            ) : (
              <BarChart data={d.titik} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.4} />
                <XAxis
                  dataKey="hari" tickLine={false} axisLine={false}
                  stroke="currentColor" className="text-muted-foreground text-xs"
                />
                <YAxis
                  tickFormatter={tickUntuk(metrik)} width={64} tickLine={false} axisLine={false}
                  stroke="currentColor" className="text-muted-foreground text-xs"
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={(p) => {
                    if (!p.active) return null;
                    const t = d.titik.find((x) => x.hari === String(p.label ?? ""));
                    if (!t) return null;
                    return (
                      <div
                        className="rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <div className="font-medium">{t.tanggal || "tanpa data"}</div>
                        <div className="tabular-nums">{t.nilai === null ? "belum ada data" : nilaiTeks(t.nilai)}</div>
                        {t.parsial ? <div className="text-muted-foreground">hari parsial</div> : null}
                      </div>
                    );
                  }}
                />
                {/* Warna batang mengikuti TANDA nilai: laba negatif harus terlihat merah,
                    bukan hijau hanya karena metriknya "laba". */}
                <Bar dataKey="nilai" name={metrik} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {d.titik.map((t) => (
                    <Cell
                      key={t.tanggal || t.hari}
                      // Hari parsial: batang berlubang (opacity rendah) + garis tepi, bukan
                      // warna lain — warna sudah dipakai menyatakan untung/rugi.
                      fill={(t.nilai ?? 0) >= 0 ? "var(--grafik-untung)" : "var(--grafik-rugi)"}
                      fillOpacity={t.parsial ? 0.35 : 1}
                      stroke={t.parsial ? "var(--grafik-netral)" : undefined}
                      strokeDasharray={t.parsial ? "3 2" : undefined}
                    />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>

        {d.deltaTerakhir ? (
          <p className="text-xs text-muted-foreground" data-testid="delta-tren">
            Dibanding hari penuh sebelumnya:{" "}
            <span className="font-medium text-foreground">
              {d.deltaTerakhir.selisih > 0 ? "+" : ""}
              {nilaiTeks(d.deltaTerakhir.selisih)}
              {d.deltaTerakhir.persen === null ? "" : ` (${d.deltaTerakhir.persen > 0 ? "+" : ""}${formatPersen(d.deltaTerakhir.persen, 1)})`}
            </span>
          </p>
        ) : null}

        {d.kurang.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {d.kurang.map((k) => <li key={k}>· {k}</li>)}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
