"use client";

// components/dashboard/chart/kartu-grafik.tsx — Bingkai SATU chart: judul-kesimpulan,
// catatan data kurang, dan alternatif tabel untuk pembaca layar.
//
// KENAPA bingkai bersama: setiap chart wajib punya aria-label berisi kesimpulan dan
// alternatif tabel (bagian 6 prinsip aksesibilitas). Kalau tiap chart merakit sendiri,
// satu di antaranya pasti lupa — dan chart tanpa alternatif teks tidak bisa dibaca sama
// sekali oleh pengguna screen reader.
//
// Komponen ini TIDAK menghitung apa pun. Judul, aria, dan baris tabel datang dari
// `lib/analisa/grafik.ts` (fungsi murni, bertes).
import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Satu baris alternatif tabel: label apa adanya + nilai yang sudah diformat. */
export type BarisTabelGrafik = { label: string; nilai: string; catatan?: string };

export function KartuGrafik({
  judul,
  aria,
  kurang,
  barisTabel,
  tinggi = "h-64",
  testId,
  children,
}: {
  /** Kesimpulan, bukan label sumbu. Disusun fungsi murni. */
  judul: string;
  /** Kalimat yang sama untuk pembaca layar — wajib, bukan opsional. */
  aria: string;
  /** Data yang tidak ada; ditampilkan supaya tidak diabaikan diam-diam. */
  kurang?: string[];
  /** Alternatif tabel. Kosong = chart tidak punya data yang bisa ditabelkan. */
  barisTabel: BarisTabelGrafik[];
  tinggi?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-base leading-snug">{judul}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className={`${tinggi} w-full`} role="img" aria-label={aria}>
          {children}
        </div>

        {(kurang ?? []).length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {kurang?.map((k) => (
              <li key={k} className="flex items-start gap-1.5">
                <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>{k}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {barisTabel.length > 0 ? (
          // `<details>` bawaan browser, bukan state React: bisa dibuka tanpa JavaScript,
          // dan tidak menambah satu pun useState ke halaman yang sudah besar.
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:underline">
              Lihat sebagai tabel
            </summary>
            <div className="mt-2 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bagian</TableHead>
                    <TableHead className="text-right">Nilai</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {barisTabel.map((b) => (
                    <TableRow key={b.label}>
                      <TableCell>
                        {b.label}
                        {b.catatan ? (
                          <span className="ml-1 text-xs text-muted-foreground">({b.catatan})</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.nilai}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <CardDescription className="mt-1 text-xs">
              Angka sama dengan grafik di atas; grafik hanya menggambarnya.
            </CardDescription>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
