"use client";

// components/dashboard/export-laba-gambar.tsx — Export JPG laporan laba via canvas (client-side).
// Ringkas: kartu total utama. Lengkap: kartu + rincian SKU + nama produk.
import { useState } from "react";
import { toast } from "sonner";

import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Button } from "@/components/ui/button";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";

export type SnapshotGambar = {
  presetNama: string;
  tanggal: string;
  jml_order: number;
  jml_baris: number;
  omzet: number;
  hpp: number;
  biaya: number;
  pajak: number;
  laba: number;
  rincian: { sku: string; nama: string | null; unit: number; kontribusi: number; marginPersen: number }[];
};

const LEBAR = 1080;
const PAD = 48;
const JUDUL_FS = 44;
const KARTU_FS = 30;
const ISI_FS = 26;

function kartu(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  label: string, nilai: string, aksen: boolean,
): void {
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#64748b";
  ctx.font = `${ISI_FS}px system-ui, sans-serif`;
  ctx.fillText(label, x + 24, y + 40);
  ctx.fillStyle = aksen ? "#059669" : "#0f172a";
  ctx.font = `700 ${KARTU_FS}px system-ui, sans-serif`;
  ctx.fillText(nilai, x + 24, y + 84);
}

function gambarDasar(s: SnapshotGambar, judul: string): { kanvas: HTMLCanvasElement; y: number } {
  const kanvas = document.createElement("canvas");
  kanvas.width = LEBAR;
  kanvas.height = 640;
  const ctx = kanvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tak didukung.");
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, LEBAR, 640);
  let y = PAD + JUDUL_FS;
  ctx.fillStyle = "#0f172a";
  ctx.font = `700 ${JUDUL_FS}px system-ui, sans-serif`;
  ctx.fillText(judul, PAD, y);
  y += 16;
  ctx.fillStyle = "#64748b";
  ctx.font = `${ISI_FS}px system-ui, sans-serif`;
  ctx.fillText(`${s.presetNama} · ${s.tanggal} · ${s.jml_order} order · ${s.jml_baris} baris`, PAD, y);
  y += 32;
  const margin = s.omzet > 0 ? `${formatAngka(Math.round((s.laba / s.omzet) * 1000) / 10)}%` : "—";
  const kartuData: [string, string, boolean][] = [
    ["Omzet", formatRupiah(s.omzet), false],
    ["HPP", formatRupiah(s.hpp), false],
    ["Biaya", formatRupiah(s.biaya), false],
    ["Estimasi PPh", formatRupiah(s.pajak), false],
    ["Estimasi Laba", formatRupiah(s.laba), true],
    ["Margin", margin, true],
  ];
  const w = (LEBAR - PAD * 2 - 2 * 16) / 3;
  kartuData.forEach(([label, nilai, aksen], i) => {
    const cx = PAD + (i % 3) * (w + 16);
    const cy = y + Math.floor(i / 3) * 140;
    kartu(ctx, cx, cy, w, 116, label, nilai, aksen);
  });
  y += 2 * 140 + 24;
  return { kanvas, y };
}

function tambahRincian(kanvas: HTMLCanvasElement, y0: number, s: SnapshotGambar): number {
  const ctx = kanvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tak didukung.");
  let y = y0;
  const butuh = 60 + s.rincian.length * 64 + 40;
  const tmp = document.createElement("canvas");
  tmp.width = LEBAR;
  tmp.height = kanvas.height + butuh;
  const tctx = tmp.getContext("2d");
  if (!tctx) throw new Error("Canvas tak didukung.");
  tctx.drawImage(kanvas, 0, 0);
  tctx.fillStyle = "#f8fafc";
  tctx.fillRect(0, kanvas.height, LEBAR, butuh);
  kanvas.height = tmp.height;
  const c2 = kanvas.getContext("2d");
  if (!c2) throw new Error("Canvas tak didukung.");
  c2.drawImage(tmp, 0, 0);
  y = y0;
  c2.fillStyle = "#0f172a";
  c2.font = `700 32px system-ui, sans-serif`;
  c2.fillText("Rincian SKU Terjual", PAD, y);
  y += 44;
  s.rincian.forEach((r, i) => {
    c2.fillStyle = i % 2 === 0 ? "#ffffff" : "#f1f5f9";
    c2.fillRect(PAD, y - 30, LEBAR - PAD * 2, 60);
    c2.fillStyle = "#0f172a";
    c2.font = `700 ${ISI_FS}px system-ui, sans-serif`;
    const nama = r.nama ? ` — ${r.nama.length > 42 ? r.nama.slice(0, 42) + "…" : r.nama}` : "";
    c2.fillText(`${r.sku}${nama}`, PAD + 16, y);
    c2.fillStyle = "#059669";
    c2.font = `700 ${ISI_FS}px system-ui, sans-serif`;
    const kanan = `${formatAngka(r.unit)} unit · ${formatRupiah(r.kontribusi)} (${formatAngka(Math.round(r.marginPersen * 10) / 10)}%)`;
    c2.fillText(kanan, LEBAR - PAD - 16 - c2.measureText(kanan).width, y);
    y += 64;
  });
  return y;
}

async function unduh(kanvas: HTMLCanvasElement, namaFile: string): Promise<void> {
  const blob = await new Promise<Blob | null>((res) => kanvas.toBlob(res, "image/jpeg", 0.92));
  if (!blob) throw new Error("Gagal membuat gambar.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = namaFile;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function ExportLabaGambar({ snapshot, presetId, presetNama }: { snapshot: SnapshotGambar | null; presetId: number; presetNama: string }) {
  const [mengirim, setMengirim] = useState<string | null>(null);
  if (!snapshot) return null;
  const s: SnapshotGambar = { ...snapshot, presetNama };

  async function ekspor(mode: "ringkas" | "lengkap") {
    setMengirim(mode);
    try {
      const { kanvas, y } = gambarDasar(s, mode === "ringkas" ? "Estimasi Laba (Ringkas)" : "Estimasi Laba (Lengkap)");
      if (mode === "lengkap") tambahRincian(kanvas, y, s);
      await unduh(kanvas, `laba-${s.tanggal}-${mode}.jpg`);
      toast.success(`Gambar ${mode} diunduh.`);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal export gambar.");
    } finally {
      setMengirim(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="export-laba">
      <Button
        size="lg"
        variant="outline"
        className="h-11 md:h-8"
        data-testid="export-laba-pdf"
        onClick={() => {
          window.open(`/api/laba?aksi=pdf&presetId=${presetId}&tanggal=${s.tanggal}`, "_blank");
        }}
      >
        Export PDF
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="h-11 md:h-8"
        data-testid="export-laba-jpg-ringkas"
        disabled={mengirim !== null}
        onClick={() => void ekspor("ringkas")}
      >
        {mengirim === "ringkas" ? "Membuat…" : "JPG Ringkas"}
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="h-11 md:h-8"
        data-testid="export-laba-jpg-lengkap"
        disabled={mengirim !== null}
        onClick={() => void ekspor("lengkap")}
      >
        {mengirim === "lengkap" ? "Membuat…" : "JPG Lengkap"}
      </Button>
    </div>
  );
}
