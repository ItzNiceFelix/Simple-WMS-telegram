"use client";

// components/dashboard/printing-workspace.tsx — Lembar kerja cetak resi ber-watermark.
//
// KENAPA DI BROWSER: PDF resi memuat nama, alamat, dan nomor HP pembeli. Semua pemrosesan
// terjadi di klien; file TIDAK PERNAH diunggah. Yang dikirim ke server hanya daftar nomor
// pesanan SETELAH user menekan Cetak, untuk mencatat "resi ini sudah keluar dari printer".
//
// KENAPA PDF.JS DIMUAT DINAMIS: paketnya besar (~1 MB). Halaman lain tidak boleh menanggung
// biaya unduh itu hanya karena menu Printing ada di sidebar.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as PdfJsModule from "pdfjs-dist";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Download, FileText, Lock, Printer, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { bacaNomorDariHalaman, type NomorLabel } from "@/lib/printing/ekstraksi";
import { bangunPdf, type OpsiCetak, type PosisiWatermark } from "@/lib/printing/watermark";

/**
 * Ikon preset. URL-nya dibangun saat modul dimuat (bukan saat render), jadi `BASE_PATH`
 * harus dideklarasikan LEBIH DULU — deklarasi `const` tidak di-hoist.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Preset watermark. Gambarnya ada di `public/wm/*.svg` (Tabler Icons, MIT) dan digambar
 * mandiri di klien — bukan unggahan, bukan aset pihak ketiga saat runtime.
 */
const PRESET: Record<
  string,
  { label: string; gambar: string; posisi: PosisiWatermark; ikonMm: number; jarakMm: number; rotasi: number; opacity: number }
> = {
  fragile: { label: "Fragile — gelas pecah", gambar: `${BASE_PATH}/wm/fragile.svg`, posisi: "bawah", ikonMm: 14, jarakMm: 34, rotasi: 20, opacity: 0.5 },
  unboxing: { label: "Video Unboxing", gambar: `${BASE_PATH}/wm/video-unboxing.svg`, posisi: "bawah", ikonMm: 13, jarakMm: 42, rotasi: 20, opacity: 0.45 },
  jangan: { label: "Jangan Dibanting", gambar: `${BASE_PATH}/wm/jangan-dibanting.svg`, posisi: "bawah", ikonMm: 14, jarakMm: 34, rotasi: 20, opacity: 0.5 },
  hati: { label: "Hati-hati", gambar: `${BASE_PATH}/wm/hati-hati.svg`, posisi: "bawah", ikonMm: 14, jarakMm: 36, rotasi: 20, opacity: 0.5 },
  cod: { label: "COD — bayar di tempat", gambar: `${BASE_PATH}/wm/cod.svg`, posisi: "tengah", ikonMm: 24, jarakMm: 40, rotasi: 25, opacity: 0.4 },
  terima: { label: "Terima kasih", gambar: `${BASE_PATH}/wm/terima-kasih.svg`, posisi: "bawah", ikonMm: 12, jarakMm: 44, rotasi: 20, opacity: 0.35 },
  buka: { label: "Dilarang buka sebelum dibayar", gambar: `${BASE_PATH}/wm/dilarang-buka.svg`, posisi: "tengah", ikonMm: 22, jarakMm: 40, rotasi: 25, opacity: 0.4 },
  tanpa: { label: "Tanpa ikon (teks saja)", gambar: "", posisi: "bawah", ikonMm: 14, jarakMm: 34, rotasi: 20, opacity: 0.5 },
};
const LABEL_PRESET: Record<string, string> = Object.fromEntries(
  Object.entries(PRESET).map(([k, v]) => [k, v.label])
);
const LABEL_POSISI: Record<string, string> = {
  bawah: "Motif bawah",
  atas: "Motif atas",
  tengah: "Cap tengah",
};

type Berkas = {
  nama: string;
  /** Kunci stabil: nama berkas bisa sama saat user memilih PDF berbeda. */
  kunci: string;
  bytes: Uint8Array;
  /** Jumlah halaman; -1 = gagal dibaca. */
  jumlahHalaman: number;
  /** Hasil baca nomor (null = tidak terbaca, label tetap boleh dicetak). */
  nomor: NomorLabel;
  /** Status pencocokan ke sistem: dikenal / tidak dikenal / belum dicek. */
  status: "dikenal" | "asing" | "belum";
  /** Halaman yang dilewati user + halaman yang TERLIHAT kosong (saran). */
  kendali: Kendali;
  /** Indeks berkas yang sedang dibuka di panel halaman; -1 = tertutup. */
  buka: boolean;
};

type PdfJs = typeof PdfJsModule;

/** Muat pdf.js sekali per halaman; worker disajikan dari CDN versi yang sama dengan paket. */
let pdfjsSiap: Promise<PdfJs> | null = null;
function muatPdfJs(): Promise<PdfJs> {
  if (!pdfjsSiap) {
    pdfjsSiap = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${mod.version}/build/pdf.worker.min.mjs`;
      return mod;
    });
  }
  return pdfjsSiap;
}

/** Ukuran halaman sumber lewat pdf.js, dalam bentuk yang dipakai pembangun PDF. */
async function ukuranHalaman(pdfjs: PdfJs, bytes: Uint8Array): Promise<({ getSize: () => { width: number; height: number } } | null)[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  return Promise.all(
    Array.from({ length: doc.numPages }, async (_, i) => {
      const page = await doc.getPage(i + 1);
      const v = page.getViewport({ scale: 1 });
      return { getSize: () => ({ width: v.width, height: v.height }) };
    })
  );
}

/** Skala pemeriksa kepadatan tinta. 0.35 ≈ 26 dpi — cukup untuk melihat ada/tidak ada isi. */
const SKALA_PERIKSA = 0.35;
/** Di bawah 0,3% piksel gelap = halaman dianggap kosong. */
const AMBANG_HALAMAN_KOSONG = 0.003;

/**
 * Kendali halaman per berkas: yang dilewati user + yang TERLIHAT kosong.
 *
 * KENAPA ADA DUA: deteksi otomatis bisa salah. Halaman dengan satu baris kecil tetap
 * berisi data pelanggan, dan menghapusnya otomatis berarti resi kurang item. Jadi deteksi
 * hanya MENANDAI (`terlihatKosong`); keputusan hapus selalu milik user lewat centang.
 */
type Kendali = {
  /** Indeks halaman (0-based) yang dilewati. `{}` = semua dicetak. */
  dilewati: Record<number, true>;
  /** Indeks halaman yang densitas tintanya di bawah ambang — saran, bukan tindakan. */
  terlihatKosong: number[];
};

/**
 * Hitung kepadatan tinta per halaman dengan merender kecil lalu menghitung piksel gelap.
 *
 * KENAPA RENDER, BUKAN TEKS: halaman berisi barcode besar tanpa teks tetap harus dicetak;
 * halaman yang hanya punya garis pembatas punya teks kosong. Yang menentukan adalah gambar.
 */
async function periksaHalaman(pdfjs: PdfJs, bytes: Uint8Array): Promise<number[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const hasil: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: SKALA_PERIKSA });
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(vp.width));
    c.height = Math.max(1, Math.round(vp.height));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) { hasil.push(1); continue; }
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let gelap = 0;
    for (let p = 0; p < d.length; p += 4) {
      // Luma < 200: abu tua & hitam dihitung; abu muda latar tidak.
      if (d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11 < 200) gelap += 1;
    }
    // Dibagi jumlah piksel yang BENAR-BENAR dibaca, bukan lebar×tinggi: canvas yang dipotong
    // GPU mengembalikan piksel lebih sedikit, dan pembagi lebar×tinggi membuat halaman
    // berisi tebal pun terbaca hampir nol.
    // CANVAS, REKAM, LALU BACA: getImageData tepat setelah render kadang mengembalikan
    // buffer kosong di Chromium (GPU belum selesai) — halaman penuh terbaca "kosong".
    // Menyalin ke canvas kedua memaksa sinkronisasi baca.
    let gelapFinal = gelap;
    let totalFinal = d.length / 4;
    if (gelapFinal === 0) {
      const c2 = document.createElement("canvas");
      c2.width = c.width;
      c2.height = c.height;
      const ctx2 = c2.getContext("2d", { willReadFrequently: true });
      if (ctx2) {
        ctx2.drawImage(c, 0, 0);
        const d2 = ctx2.getImageData(0, 0, c2.width, c2.height).data;
        gelapFinal = 0;
        for (let p = 0; p < d2.length; p += 4) {
          if (d2[p] * 0.3 + d2[p + 1] * 0.59 + d2[p + 2] * 0.11 < 200) gelapFinal += 1;
        }
        totalFinal = d2.length / 4;
      }
    }
    hasil.push(gelapFinal / Math.max(1, totalFinal));
  }
  return hasil;
}

/** Ambil jumlah halaman + render kecil satu halaman untuk thumbnail & pemeriksaan. */
async function renderHalaman(pdfjs: PdfJs, bytes: Uint8Array, indeks0: number, skala: number): Promise<string | null> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  if (indeks0 >= doc.numPages) return null;
  const page = await doc.getPage(indeks0 + 1);
  const vp = page.getViewport({ scale: skala });
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(vp.width));
  c.height = Math.max(1, Math.round(vp.height));
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
  return c.toDataURL("image/jpeg", 0.6);
}


/**
 * Gambar apa pun (SVG, PNG, JPG, WebP logo) → PNG hitam-putih.
 *
 * Kenapa hitam-putih: printer termal label resi hanya punya 1 bit, jadi ikon berwarna atau
 * bergradasi akan tercetak sebagai raster kacau. Transparansi dipertahankan (alfa < 128
 * dibuang) supaya ikon latar tembus tetap bersih.
 */
async function kePngHitamPutih(f: File | Blob, maksPx = 480): Promise<{ png: Uint8Array; rasio: number }> {
  const url = URL.createObjectURL(f);
  try {
    // KENAPA <img> DAN BUKAN createImageBitmap: Chromium TIDAK mendukung createImageBitmap
    // untuk berkas SVG → semua ikon preset gagal dimuat. <img> mendekode SVG (dan PNG/JPG/
    // WebP) dengan andal, jadi jalur itu yang dipakai untuk semua format.
    const bmp = await new Promise<HTMLImageElement>((selesai, gagal) => {
      const img = new Image();
      img.onload = () => selesai(img);
      img.onerror = () => gagal(new Error("Gambar tidak bisa didekode."));
      img.src = url;
    });
    // SVG tanpa atribut width/height bisa terbaca 0 — pakai 300 sebagai ukuran acuan.
    const lebarAsli = bmp.naturalWidth || bmp.width || 300;
    const tinggiAsli = bmp.naturalHeight || bmp.height || 300;
    const skala = Math.min(1, maksPx / Math.max(lebarAsli, tinggiAsli));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(lebarAsli * skala));
    c.height = Math.max(1, Math.round(tinggiAsli * skala));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak tersedia.");
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const a = d.data[i + 3];
      const g = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
      const hitam = g < 160 && a > 128;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = hitam ? 0 : 255;
      d.data[i + 3] = hitam ? 255 : 0;
    }
    ctx.putImageData(d, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) throw new Error("Gambar gagal dikonversi.");
    return { png: new Uint8Array(await blob.arrayBuffer()), rasio: c.width / c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Panel halaman satu berkas: thumbnail per halaman, status tinta, dan centang cetak.
 *
 * KENAPA THUMBNAIL: user harus BISA MELIHAT halaman sebelum memutuskan melewatinya. Angka
 * "0,1% tinta" tidak cukup untuk memastikan tidak ada satu baris item yang tertinggal.
 */
function PanelHalaman({
  berkas,
  onToggle,
  onAbaikan,
}: {
  berkas: Berkas;
  onToggle: (indeks: number) => void;
  onAbaikan: (indeks: number) => void;
}) {
  const [thumb, setThumb] = useState<Record<number, string | null>>({});

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const pdfjs = await muatPdfJs();
        for (let i = 0; i < berkas.jumlahHalaman; i++) {
          if (batal) return;
          const url = await renderHalaman(pdfjs, berkas.bytes, i, 0.5);
          if (batal) return;
          setThumb((l) => ({ ...l, [i]: url }));
        }
      } catch {
        // Thumbnail gagal ≠ halaman hilang; centang tetap berfungsi tanpa gambar.
      }
    })();
    return () => { batal = true; };
  }, [berkas.kunci, berkas.jumlahHalaman, berkas.bytes]);

  const semuaDilewati = Object.keys(berkas.kendali.dilewati).length === berkas.jumlahHalaman;

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-muted/30 px-2 py-2" data-testid={`panel-halaman-${berkas.nama}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          Centang = halaman TIDAK dicetak. Halaman bertanda “kosong” hanya saran; periksa
          thumbnail sebelum menghapus.
        </span>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => {
            if (semuaDilewati) {
              for (let i = 0; i < berkas.jumlahHalaman; i++) if (berkas.kendali.dilewati[i]) onToggle(i);
            } else {
              for (let i = 0; i < berkas.jumlahHalaman; i++) if (!berkas.kendali.dilewati[i]) onToggle(i);
            }
          }}
          data-testid="centang-semua-halaman"
        >
          {semuaDilewati ? "Pakai semua halaman" : "Lewatkan semua halaman"}
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: berkas.jumlahHalaman }, (_, i) => {
          const dilewati = !!berkas.kendali.dilewati[i];
          const kosong = berkas.kendali.terlihatKosong.includes(i);
          const gambar = thumb[i];
          return (
            <div
              key={i}
              className={`flex flex-col gap-1 rounded-md border p-1 ${dilewati ? "border-dashed border-destructive/50 bg-background/60" : "border-border bg-background"}`}
              data-testid={`halaman-${i + 1}`}
            >
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={!dilewati}
                  onChange={() => onToggle(i)}
                  data-testid={`cetak-halaman-${i + 1}`}
                  className="size-3.5 accent-primary"
                />
                Halaman {i + 1}
              </label>
              <div className="relative flex aspect-[2/3] items-center justify-center overflow-hidden rounded border border-border/60 bg-white">
                {gambar ? (
                  // eslint-disable-next-line @next/next/no-img-element -- hasil render canvas
                  <img src={gambar} alt={`Halaman ${i + 1}`} className={`size-full object-contain ${dilewati ? "opacity-40" : ""}`} />
                ) : (
                  <Spinner />
                )}
                {dilewati ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-destructive/10 text-[10px] font-semibold text-destructive">
                    TIDAK DICETAK
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {kosong ? (
                  <button
                    type="button"
                    onClick={() => onAbaikan(i)}
                    title="Tanda ini hanya saran. Klik untuk menyembunyikan tanda."
                    className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                    data-testid={`saran-kosong-${i + 1}`}
                  >
                    terlihat kosong
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PrintingWorkspace() {
  /** Toko dipakai HANYA untuk mencocokkan nomor & mencatat cetak, bukan syarat mencetak. */
  const [toko, setToko] = useState<{ id: number; nama: string }[] | null>(null);
  const [presetId, setPresetId] = useState<number | null>(null);
  /** Nama toko untuk watermark. Diisi nama toko terpilih; boleh diedit user, jadi state. */
  const [namaToko, setNamaToko] = useState("");
  const [berkas, setBerkas] = useState<Berkas[]>([]);
  const [sibuk, setSibuk] = useState(false);
  const [progres, setProgres] = useState("");
  const [preset, setPreset] = useState<keyof typeof PRESET>("fragile");
  const [posisi, setPosisi] = useState<PosisiWatermark>(PRESET.fragile.posisi);
  const [tinggiMm, setTinggiMm] = useState(150);
  const [ikonMm, setIkonMm] = useState(PRESET.fragile.ikonMm);
  const [jarakMm, setJarakMm] = useState(PRESET.fragile.jarakMm);
  const [opacity, setOpacity] = useState(PRESET.fragile.opacity);
  const [rotasi, setRotasi] = useState(PRESET.fragile.rotasi);
  const [crop, setCrop] = useState(0);
  const [geserX, setGeserX] = useState(0);
  const [geserY, setGeserY] = useState(0);
  const [ikon, setIkon] = useState<{ png: Uint8Array; rasio: number; nama: string } | null>(null);
  const [memuatIkon, setMemuatIkon] = useState(false);
  const [pratinjau, setPratinjau] = useState<string | null>(null);
  /** Jumlah halaman yang benar-benar akan tercetak (setelah halaman dilewati). */
  const [jumlahCetak, setJumlahCetak] = useState(0);
  const [memuatPratinjau, setMemuatPratinjau] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputIkonRef = useRef<HTMLInputElement>(null);

  const presetAktif = PRESET[preset];

  const opsi: OpsiCetak = useMemo(
    () => ({
      tinggiMm, posisi, namaToko, opacity, rotasi, ikonMm, jarakMm,
      cropBawahMm: crop, geserXMm: geserX, geserYMm: geserY, ikon,
    }),
    [tinggiMm, posisi, namaToko, opacity, rotasi, ikonMm, jarakMm, crop, geserX, geserY, ikon]
  );

  // Daftar toko: bukan syarat mencetak. Kegagalan memuatnya hanya membuat pencatatan
  // "sudah dicetak" tidak tersedia — halaman tetap bisa dipakai.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/preset", { credentials: "include" });
        // Kuncinya `presets` (bentuk asli /api/preset). Salah baca = daftar kosong tanpa
        // error — itulah yang dulu membuat pemicu hanya menampilkan "Pilih toko".
        const d = (await res.json().catch(() => null)) as { ok?: boolean; presets?: { id: number; nama: string }[] } | null;
        const daftar = d?.ok ? d.presets ?? [] : [];
        setToko(daftar);
        setPresetId(daftar[0]?.id ?? null);
        if (daftar[0]) setNamaToko(daftar[0].nama);
      } catch {
        setToko([]);
      }
    })();
  }, []);

  /** Ikon preset: ambil SVG dari /wm, konversi ke PNG hitam-putih, cache per nama preset. */
  const cacheIkon = useRef(new Map<string, { png: Uint8Array; rasio: number }>());
  useEffect(() => {
    const gambar = presetAktif.gambar;
    if (!gambar) { setIkon(null); return; }
    const tersimpan = cacheIkon.current.get(gambar);
    if (tersimpan) { setIkon({ ...tersimpan, nama: gambar }); return; }
    let batal = false;
    void (async () => {
      try {
        const blob = await (await fetch(gambar)).blob();
        const hasil = await kePngHitamPutih(blob);
        cacheIkon.current.set(gambar, hasil);
        if (!batal) setIkon({ ...hasil, nama: gambar });
      } catch {
        if (!batal) { setIkon(null); toast.error("Ikon watermark gagal dimuat."); }
      }
    })();
    return () => { batal = true; };
  }, [presetAktif.gambar]);

  /** Baca satu berkas: teks per halaman → nomor, plus kepadatan tinta per halaman. */
  const bacaBerkas = useCallback(async (f: File): Promise<Berkas> => {
    const pdfjs = await muatPdfJs();
    const bytes = new Uint8Array(await f.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
    const teksHalaman: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const isi = await page.getTextContent();
      teksHalaman.push(isi.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    const kepadatan = await periksaHalaman(pdfjs, bytes);
    return {
      nama: f.name,
      kunci: `${f.name}#${bytes.length}#${Date.now()}#${Math.random().toString(36).slice(2, 7)}`,
      bytes,
      jumlahHalaman: doc.numPages,
      nomor: bacaNomorDariHalaman(teksHalaman),
      status: "belum",
      // Deteksi TIDAK menghapus apa pun: hanya menandai. User memutuskan lewat centang.
      kendali: { dilewati: {}, terlihatKosong: kepadatan.flatMap((d, i) => (d < AMBANG_HALAMAN_KOSONG ? [i] : [])) },
      buka: false,
    };
  }, []);

  /** Ubah kendali halaman satu berkas (immutable — React butuh referensi baru). */
  function ubahKendali(kunci: string, ubah: (k: Kendali) => Kendali) {
    setBerkas((s) => s.map((b) => (b.kunci === kunci ? { ...b, kendali: ubah(b.kendali) } : b)));
  }

  /** Lewatkan / pakai kembali satu halaman. */
  function toggleHalaman(kunci: string, indeks: number) {
    ubahKendali(kunci, (k) => {
      const d = { ...k.dilewati };
      if (d[indeks]) delete d[indeks];
      else d[indeks] = true;
      return { ...k, dilewati: d };
    });
  }

  /** Lepaskan TANDA "terlihat kosong" tanpa mengubah keputusan cetak. */
  function abaikanSaran(kunci: string, indeks: number) {
    ubahKendali(kunci, (k) => ({ ...k, terlihatKosong: k.terlihatKosong.filter((i) => i !== indeks) }));
  }

  /** Cocokkan nomor pesanan ke sistem (hanya bila toko dipilih). */
  const cocokkan = useCallback(async (daftar: Berkas[], tokoId: number | null) => {
    if (!tokoId) return daftar;
    const nomor = daftar.map((b) => b.nomor.noPesanan).filter((n): n is string => !!n);
    if (nomor.length === 0) return daftar;
    try {
      const res = await fetch(`/api/printing?presetId=${tokoId}&noPesanan=${encodeURIComponent(nomor.join(","))}`, { credentials: "include" });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; status?: Record<string, unknown> } | null;
      const dikenal = new Set(Object.keys(d?.status ?? {}));
      return daftar.map((b) => ({
        ...b,
        status: b.nomor.noPesanan && dikenal.has(b.nomor.noPesanan) ? ("dikenal" as const) : b.nomor.noPesanan ? ("asing" as const) : ("belum" as const),
      }));
    } catch {
      // Gagal mencocokkan bukan alasan menolak mencetak: status hanya info tambahan.
      return daftar;
    }
  }, []);

  async function tambahBerkas(files: FileList | null) {
    if (!files || files.length === 0) return;
    setSibuk(true);
    const baru: Berkas[] = [];
    try {
      for (const [i, f] of [...files].entries()) {
        setProgres(`Membaca ${i + 1}/${files.length}: ${f.name}`);
        try {
          baru.push(await bacaBerkas(f));
        } catch {
          toast.error(`${f.name} tidak bisa dibaca sebagai PDF.`);
        }
      }
      setBerkas(await cocokkan([...berkas, ...baru], presetId));
    } finally {
      setSibuk(false);
      setProgres("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** Ganti toko: cocokkan ulang semua berkas yang sudah masuk (tidak perlu unggah ulang). */
  async function gantiToko(id: number) {
    setPresetId(id);
    const nama = toko?.find((t) => t.id === id)?.nama;
    if (nama) setNamaToko(nama);
    if (berkas.length > 0) setBerkas(await cocokkan(berkas, id));
  }

  /** Susun sumber PDF: halaman yang dilewati user dikirim `null` agar tidak dicetak. */
  const sumberBerkas = useCallback(async (pdfjs: PdfJs) => {
    return Promise.all(
      berkas.map(async (b) => {
        const halaman = await ukuranHalaman(pdfjs, b.bytes);
        return { bytes: b.bytes, halaman: halaman.map((h, i) => (b.kendali.dilewati[i] ? null : h)) };
      })
    );
  }, [berkas]);

  /** Susun PDF keluaran dari semua berkas. */
  const susun = useCallback(async () => {
    const pdfjs = await muatPdfJs();
    return { pdfjs, hasil: await bangunPdf(await sumberBerkas(pdfjs), opsi) };
  }, [sumberBerkas, opsi]);

  /** Pratinjau: render PDF hasil (hanya halaman pertama) agar user melihat watermark nyata. */
  const bangunPratinjau = useCallback(async () => {
    if (berkas.length === 0 || sibuk) return;
    setMemuatPratinjau(true);
    try {
      const pdfjs = await muatPdfJs();
      const hasil = await bangunPdf(await sumberBerkas(pdfjs), opsi, true);
      // Semua halaman dilewati → tidak ada halaman untuk ditampilkan; beri tahu, bukan
      // biarkan pratinjau lama menempel seolah masih berlaku.
      if (hasil.halaman === 0) {
        setPratinjau(null);
        setJumlahCetak(0);
        return;
      }
      setJumlahCetak(hasil.halaman);
      const doc = await pdfjs.getDocument({ data: hasil.bytes.slice(0) }).promise;
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) throw new Error("Canvas tidak tersedia.");
      // Latar putih: halaman resi bisa transparan, dan di layar gelap gambar transparan
      // terlihat hitam sehingga pratinjau menyesatkan.
      canvasContext.fillStyle = "#fff";
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext, viewport: vp, canvas }).promise;
      setPratinjau(canvas.toDataURL("image/png"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat pratinjau.");
    } finally {
      setMemuatPratinjau(false);
    }
  }, [berkas.length, sumberBerkas, opsi, sibuk]);

  // Render ulang pratinjau saat pengaturan/halaman berubah — ditunda supaya mengetik tidak
  // memicu render tiap ketukan.
  useEffect(() => {
    if (berkas.length === 0) return;
    const t = setTimeout(() => void bangunPratinjau(), 350);
    return () => clearTimeout(t);
  }, [bangunPratinjau, berkas.length]);

  async function unduh() {
    setSibuk(true);
    setProgres("Menyusun PDF…");
    try {
      const { hasil } = await susun();
      const blob = new Blob([hasil.bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resi-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      await catatCetak();
      toast.success(`${hasil.halaman} halaman siap.`);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyusun PDF.");
    } finally {
      setSibuk(false);
      setProgres("");
    }
  }

  async function cetak() {
    // Tidak ada halaman yang tersisa setelah dilewati: jangan buka dialog cetak kosong.
    if (berkas.length === 0) return;
    setSibuk(true);
    setProgres("Menyiapkan halaman cetak…");
    try {
      const { pdfjs, hasil } = await susun();
      if (hasil.halaman === 0) {
        toast.error("Semua halaman dilewati. Centang minimal satu halaman.");
        return;
      }
      const doc = await pdfjs.getDocument({ data: hasil.bytes.slice(0) }).promise;
      // Render tiap halaman ke <img> supaya hasil print identik dengan pratinjau (font
      // tertanam, ukuran mm). Barcode sudah raster di tahap ini — cukup untuk label termal.
      const wadah = document.getElementById("area-cetak-printing");
      if (!wadah) throw new Error("Area cetak tidak ditemukan.");
      wadah.innerHTML = "";
      for (let i = 1; i <= doc.numPages; i++) {
        setProgres(`Menyiapkan halaman ${i}/${doc.numPages}…`);
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 3 });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        const canvasContext = c.getContext("2d");
        if (!canvasContext) throw new Error("Canvas tidak tersedia.");
        canvasContext.fillStyle = "#fff";
        canvasContext.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext, viewport: vp, canvas: c }).promise;
        const img = new Image();
        img.src = c.toDataURL("image/png");
        await img.decode();
        wadah.appendChild(img);
      }
      let gaya = document.getElementById("gaya-cetak-printing");
      if (!gaya) {
        gaya = document.createElement("style");
        gaya.id = "gaya-cetak-printing";
        document.head.appendChild(gaya);
      }
      // KENAPA SELURUH HALAMAN DISEMBUNYIKAN: `hidden print:block` pada area cetak saja
      // TIDAK cukup — seluruh dashboard (sidebar, kartu, tombol) tetap dicetak, sehingga PDF
      // hasil "Cetak" berisi 19 halaman campur UI + resi. Aturan di bawah menyembunyikan
      // SEMUA elemen body lalu menampilkan hanya area cetak.
      gaya.textContent =
        `@page{size:100mm ${tinggiMm}mm;margin:0}` +
        `@media print{html,body{margin:0!important;padding:0!important;background:#fff!important}` +
        `body>*{display:none!important}` +
        // Lebar/tinggi kontainer WAJIB direset: elemen ini berukuran 0×0 di layar, dan
        // `width:100mm` pada <img> tidak akan tampak bila induknya selebar 0.
        `#area-cetak-printing{display:block!important;visibility:visible!important;position:static!important;` +
        `width:100mm!important;height:auto!important;overflow:visible!important}` +
        `#area-cetak-printing img{display:block;width:100mm!important;height:${tinggiMm}mm!important;` +
        `page-break-after:always;break-after:page;margin:0!important;border:0!important}` +
        `#area-cetak-printing img:last-child{page-break-after:auto;break-after:auto}}`;
      await catatCetak();
      window.print();
      toast.success(`${hasil.halaman} halaman dikirim ke dialog cetak.`);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyiapkan cetak.");
    } finally {
      setSibuk(false);
      setProgres("");
    }
  }

  /** Catat "sudah dicetak" untuk nomor yang DIKENAL sistem. Gagal catat tidak menggagalkan cetak. */
  async function catatCetak() {
    if (!presetId) return;
    const nomor = berkas.map((b) => b.nomor.noPesanan).filter((n): n is string => !!n);
    if (nomor.length === 0) return;
    const noResi: Record<string, string> = {};
    for (const b of berkas) if (b.nomor.noPesanan && b.nomor.noResi) noResi[b.nomor.noPesanan] = b.nomor.noResi;
    try {
      await fetch("/api/printing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ presetId, noPesanan: nomor, noResi, file: berkas.map((b) => b.nama).join(", ").slice(0, 200) }),
      });
    } catch {
      // sengaja diam: pencatatan adalah efek samping, bukan syarat mencetak.
    }
  }

  function terapkanPreset(k: keyof typeof PRESET) {
    const p = PRESET[k];
    setPreset(k);
    setPosisi(p.posisi);
    setIkonMm(p.ikonMm);
    setJarakMm(p.jarakMm);
    setRotasi(p.rotasi);
    setOpacity(p.opacity);
    if (inputIkonRef.current) inputIkonRef.current.value = "";
  }

  async function pilihIkon(f: File | null) {
    if (!f) return;
    setMemuatIkon(true);
    try {
      const hasil = await kePngHitamPutih(f);
      setIkon({ ...hasil, nama: f.name });
      toast.success(`${f.name} dipakai sebagai watermark.`);
    } catch {
      toast.error("Gambar tidak bisa dibaca. Pakai PNG, JPG, WebP, atau SVG.");
    } finally {
      setMemuatIkon(false);
    }
  }

  const ringkas = useMemo(() => {
    const total = berkas.reduce((a, b) => a + Math.max(0, b.jumlahHalaman), 0);
    const dikenal = berkas.filter((b) => b.status === "dikenal").length;
    const asing = berkas.filter((b) => b.status === "asing").length;
    const buta = berkas.filter((b) => !b.nomor.noPesanan).length;
    return { total, dikenal, asing, buta };
  }, [berkas]);

  return (
    <>
      <PageHeader
        judul="Printing"
        deskripsi="Tambah watermark dan cetak resi dari marketplace apa pun. File tidak diunggah ke server."
      />

      <div className="flex flex-col gap-4" data-testid="printing">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <label className="flex min-w-[220px] flex-col gap-1 text-xs text-muted-foreground">
              Toko (untuk mencocokkan order & mencatat cetak)
              <Select
                value={presetId ? String(presetId) : ""}
                onValueChange={(v) => { if (typeof v === "string" && v) void gantiToko(Number(v)); }}
              >
                <SelectTrigger className="h-9 w-full" data-testid="printing-preset">
                  <SelectValue>
                    {(v: string | null) =>
                      toko === null ? "Memuat toko…" : v ? toko.find((t) => String(t.id) === v)?.nama ?? v : "Pilih toko"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(toko ?? []).map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.nama}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            <p className="max-w-md flex-1 text-xs text-muted-foreground">
              Nomor pesanan dicocokkan ke order toko ini otomatis setelah PDF dibaca. Ganti toko
              → pencocokan diulang tanpa perlu mengunggah ulang. Tanpa toko: tetap bisa cetak,
              status “sudah dicetak” tidak dicatat.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── Berkas & deteksi ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Berkas resi</CardTitle>
              <CardDescription>
                Bisa banyak PDF sekaligus (Shopee, TikTok, Tokopedia, apa pun). Urutan cetak
                mengikuti daftar.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                multiple
                disabled={sibuk}
                onChange={(e) => void tambahBerkas(e.target.files)}
                data-testid="berkas-resi"
              />
              {progres ? <p className="text-xs text-muted-foreground">{progres}</p> : null}

              {berkas.length === 0 ? (
                <Empty data-testid="printing-kosong">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><FileText /></EmptyMedia>
                    <EmptyTitle>Belum ada berkas</EmptyTitle>
                    <EmptyDescription>
                      Pilih PDF resi. Nomor pesanan dibaca otomatis untuk mencocokkan dengan
                      order di sistem.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary" data-testid="printing-ringkas">{berkas.length} berkas · {ringkas.total} halaman</Badge>
                    {ringkas.dikenal > 0 ? <Badge data-testid="printing-dikenal">{ringkas.dikenal} dikenal</Badge> : null}
                    {ringkas.asing > 0 ? <Badge variant="outline">{ringkas.asing} di luar sistem</Badge> : null}
                    {ringkas.buta > 0 ? <Badge variant="outline">{ringkas.buta} nomor tak terbaca</Badge> : null}
                  </div>
                  <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" data-testid="daftar-berkas">
                    {berkas.map((b, i) => (
                      <li key={b.kunci} className="rounded-md border border-border text-xs">
                        <div className="flex items-center gap-2 px-2 py-1.5">
                          <span className="min-w-0 flex-1 truncate" title={b.nama}>
                            {i + 1}. {b.nama}
                            <span className="text-muted-foreground"> · {b.jumlahHalaman} hlm</span>
                            {b.nomor.noPesanan ? <span className="ml-1 font-mono">{b.nomor.noPesanan}</span> : null}
                            {b.nomor.noResi ? <span className="ml-1 text-muted-foreground">{b.nomor.noResi}</span> : null}
                          </span>
                          {b.status === "dikenal" ? <Badge variant="secondary">sistem</Badge> : null}
                          {b.status === "asing" ? <Badge variant="outline">asing</Badge> : null}
                          {!b.nomor.noPesanan ? <Badge variant="outline">tak terbaca</Badge> : null}
                          {Object.keys(b.kendali.dilewati).length > 0 ? (
                            <Badge variant="outline" data-testid={`dilewati-${i}`}>
                              {b.jumlahHalaman - Object.keys(b.kendali.dilewati).length}/{b.jumlahHalaman} dicetak
                            </Badge>
                          ) : null}
                          <Button
                            size="sm"
                            variant={b.buka ? "secondary" : "ghost"}
                            className="h-7 px-1.5"
                            onClick={() => setBerkas((s) => s.map((x) => (x.kunci === b.kunci ? { ...x, buka: !x.buka } : { ...x, buka: false })))}
                            aria-expanded={b.buka}
                            data-testid={`buka-halaman-${i}`}
                          >
                            <FileText className="mr-1 size-3.5" aria-hidden />
                            Halaman
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-1" disabled={i === 0} onClick={() => setBerkas((s) => { const c = [...s]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; })} aria-label="Naikkan">
                            <ChevronUp className="size-3.5" aria-hidden />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-1" disabled={i === berkas.length - 1} onClick={() => setBerkas((s) => { const c = [...s]; [c[i], c[i + 1]] = [c[i + 1], c[i]]; return c; })} aria-label="Turunkan">
                            <ChevronDown className="size-3.5" aria-hidden />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-1" onClick={() => setBerkas((s) => s.filter((x) => x.kunci !== b.kunci))} aria-label="Hapus">
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        </div>
                        {b.buka ? (
                          <PanelHalaman
                            berkas={b}
                            onToggle={(indeks) => toggleHalaman(b.kunci, indeks)}
                            onAbaikan={(indeks) => abaikanSaran(b.kunci, indeks)}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setBerkas((s) => [...s].sort((a, b) => a.nama.localeCompare(b.nama, undefined, { numeric: true })))}>Urutkan A-Z</Button>
                    <Button size="sm" variant="outline" onClick={() => { setBerkas([]); setPratinjau(null); }}>Hapus semua</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Watermark ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Watermark</CardTitle>
              <CardDescription>
                Ikon + nama toko digambar transparan di atas resi, jadi alamat & barcode tetap terbaca.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                Gambar preset
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {Object.entries(PRESET).map(([k, p]) => {
                    const aktif = preset === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => terapkanPreset(k)}
                        aria-pressed={aktif}
                        title={p.label}
                        data-testid={`preset-${k}`}
                        className={`flex aspect-square items-center justify-center rounded-md border p-2 transition-colors ${aktif ? "border-primary bg-primary/10 ring-2 ring-ring/40" : "border-border hover:bg-muted"}`}
                      >
                        {p.gambar ? (
                          // eslint-disable-next-line @next/next/no-img-element -- SVG statis di /public
                          <img src={p.gambar} alt={p.label} className="size-full object-contain" />
                        ) : (
                          <span className="text-[10px] leading-tight">Teks saja</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <span className="mt-1">{presetAktif.label}. Ikon dari Tabler Icons (MIT).</span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Gambar watermark sendiri
                  <Input
                    ref={inputIkonRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    disabled={memuatIkon}
                    onChange={(e) => void pilihIkon(e.target.files?.[0] ?? null)}
                    data-testid="unggah-watermark"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Posisi
                  <Select value={posisi} onValueChange={(v) => { if (typeof v === "string" && v) setPosisi(v as PosisiWatermark); }}>
                    <SelectTrigger className="h-9 w-full" data-testid="posisi-watermark">
                      <SelectValue>{(v: string | null) => LABEL_POSISI[v ?? ""] ?? "Pilih posisi"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="bawah">Motif bawah</SelectItem>
                        <SelectItem value="atas">Motif atas</SelectItem>
                        <SelectItem value="tengah">Cap tengah</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              {ikon ? (
                <p className="text-[11px] text-muted-foreground">
                  Ikon aktif: {ikon.nama} {memuatIkon ? "(memuat…)" : ""}
                </p>
              ) : null}

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Nama toko di watermark (kosong = tanpa teks)
                <Input value={namaToko} maxLength={28} onChange={(e) => setNamaToko(e.target.value)} className="h-9" data-testid="nama-toko-wm" />
              </label>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Tinggi (mm)
                  <Input type="number" min={100} max={300} value={tinggiMm} onChange={(e) => setTinggiMm(Number(e.target.value) || 150)} className="h-9" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Ukuran ikon (mm)
                  <Input type="number" min={5} max={40} value={ikonMm} onChange={(e) => setIkonMm(Number(e.target.value) || 14)} className="h-9" data-testid="ukuran-ikon" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Jarak motif (mm)
                  <Input type="number" min={10} max={90} value={jarakMm} onChange={(e) => setJarakMm(Number(e.target.value) || 34)} className="h-9" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Miring (°)
                  <Input type="number" min={-90} max={90} value={rotasi} onChange={(e) => setRotasi(Number(e.target.value) || 0)} className="h-9" />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Kepekatan ({Math.round(opacity * 100)}%)
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(opacity * 100)}
                  onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                  data-testid="opacity"
                  className="h-9 w-full accent-primary"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Crop bawah (mm)
                  <Input type="number" min={0} max={80} value={crop} onChange={(e) => setCrop(Number(e.target.value) || 0)} className="h-9" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Geser X (mm)
                  <Input type="number" min={-20} max={20} value={geserX} onChange={(e) => setGeserX(Number(e.target.value) || 0)} className="h-9" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Geser Y (mm)
                  <Input type="number" min={-20} max={20} value={geserY} onChange={(e) => setGeserY(Number(e.target.value) || 0)} className="h-9" />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Logo toko dipakai sebagai “Gambar watermark sendiri” — otomatis jadi hitam-putih
                agar tajam di printer termal.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ── Pratinjau & cetak ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Pratinjau & cetak</CardTitle>
            <CardDescription>
              Pratinjau menampilkan hasil akhir halaman pertama. Cetak memakai skala 100% tanpa margin.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 md:flex-row md:items-start">
            <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-border bg-muted/30 p-3">
              {memuatPratinjau ? (
                <Spinner data-testid="memuat-pratinjau" />
              ) : pratinjau ? (
                // eslint-disable-next-line @next/next/no-img-element -- hasil canvas, bukan aset Next
                <img src={pratinjau} alt="Pratinjau resi" className="max-h-[520px] w-auto rounded shadow-sm" data-testid="pratinjau-resi" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {berkas.length > 0 && jumlahCetak === 0
                    ? "Semua halaman dilewati — tidak ada yang bisa dicetak. Centang minimal satu halaman."
                    : "Pilih berkas untuk melihat pratinjau."}
                </p>
              )}
            </div>
            <div className="flex w-full flex-col gap-2 md:w-64">
              <p className="text-xs text-muted-foreground" data-testid="jumlah-cetak">
                {berkas.length === 0
                  ? "Belum ada berkas."
                  : `${jumlahCetak} halaman akan dicetak.`}
              </p>
              <Button onClick={() => void cetak()} disabled={sibuk || jumlahCetak === 0} data-testid="tombol-cetak">
                {sibuk ? <Spinner data-icon="inline-start" /> : <Printer className="size-4" aria-hidden />}
                Cetak
              </Button>
              <Button variant="outline" onClick={() => void unduh()} disabled={sibuk || jumlahCetak === 0} data-testid="tombol-unduh">
                <Download className="size-4" aria-hidden />
                Unduh PDF (Windows print)
              </Button>
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                File diproses di browser dan tidak pernah diunggah. Hanya nomor pesanan yang
                dicatat setelah cetak.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/*
        Zona cetak di luar alur dokumen (position:fixed, ukuran nol) supaya tidak ikut
        menggeser layout layar. Visibilitasnya diatur murni oleh stylesheet cetak di atas —
        `hidden` dari Tailwind adalah `display:none` yang membuat isinya TIDAK tercetak.
      */}
      <div id="area-cetak-printing" aria-hidden style={{ position: "fixed", left: 0, top: 0, width: 0, height: 0, overflow: "hidden" }} />
    </>
  );
}
