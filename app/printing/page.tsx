"use client";

// app/printing/page.tsx — Lembar kerja cetak resi.
//
// SELURUH proses di browser: PDF resi memuat nama, alamat, dan nomor HP pembeli, dan
// pekerjaan ini bisa selesai tanpa server. Gerbang akses memakai `ButuhAkses` yang sama
// dengan halaman dashboard lain — halaman ini menyentuh data order, jadi tidak boleh publik.
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { PrintingWorkspace } from "@/components/dashboard/printing-workspace";

export default function HalamanPrinting() {
  return (
    <ButuhAkses href="/printing">
      <PrintingWorkspace />
    </ButuhAkses>
  );
}
