"use client";

// Footer paginasi BERSAMA — presentasi saja.
//
// Kenapa dipisah: /stok memaginasi di SERVER (baris yang diterima sudah satu halaman,
// `total` dari COUNT(*) D1) sedangkan /histori memaginasi di KLIEN (menarik seluruh hasil
// lalu mengirisnya). Dua halaman itu menyalin blok footer yang sama — dua tempat untuk
// salah. Komponen ini hanya MERENDER info + kedua tombol dan memanggil balik `onHalaman`;
// TIDAK ADA pengirisan data di sini, karena "apa itu halaman ini" memang milik pemanggil.
//
// `data-testid` disamakan dengan yang sudah ada (`halaman-sebelumnya` /
// `halaman-berikutnya`) supaya pengujian navigasi halaman tidak perlu diubah saat halaman
// lain menyusul memakainya. CATATAN: footer /stok saat ini memakai label "Halaman N dari M"
// di `data-testid="halaman-stok"`, bukan "Menampilkan a–b dari total" seperti di sini —
// jadi menukar /stok ke komponen ini nanti menuntut keputusan label, bukan sekadar import.
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface FooterPaginasi {
  /** Halaman aktif, 1-based. Nilai di luar rentang ditampilkan apa adanya (pemanggil sudah menjepitnya). */
  halaman: number;
  /** Jumlah halaman, minimal 1 (daftar kosong pun "1 dari 1"). */
  jumlahHalaman: number;
  /** Jumlah baris yang benar-benar dirender di halaman ini (bukan ukuran halaman). */
  barisTampil: number;
  /** Index baris pertama halaman ini (0-based), untuk label "Menampilkan a–b". */
  mulai: number;
  /** Total baris se-SERVER (hasil COUNT), bukan panjang array halaman. */
  total: number;
  /** Dipanggil dengan nomor halaman baru. Pemanggil yang mengambil datanya. */
  onHalaman: (halaman: number) => void;
  /** Mengunci kedua tombol (mis. request halaman sedang jalan). */
  sibuk?: boolean;
}

export function FooterPaginasi({
  halaman,
  jumlahHalaman,
  barisTampil,
  mulai,
  total,
  onHalaman,
  sibuk = false,
}: FooterPaginasi) {
  const sebelumnya = sibuk || halaman <= 1;
  const berikutnya = sibuk || halaman >= jumlahHalaman;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground tabular-nums" data-testid="info-halaman">
        {`Menampilkan ${mulai + 1}\u2013${mulai + barisTampil} dari ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="lg"
          className="h-11 md:h-8"
          disabled={sebelumnya}
          onClick={() => onHalaman(halaman - 1)}
          data-testid="halaman-sebelumnya"
        >
          <ChevronLeft data-icon="inline-start" />
          Sebelumnya
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-11 md:h-8"
          disabled={berikutnya}
          onClick={() => onHalaman(halaman + 1)}
          data-testid="halaman-berikutnya"
        >
          Berikutnya
          <ChevronRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}
