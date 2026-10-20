"use client";

// components/dashboard/printing-workspace.tsx — Lembar kerja cetak resi + strip peringatan.
//
// MEKANISME SAMA dengan alat referensi pemilik toko:
//   1. PDF resi dibaca pdf.js; tiap halaman dipindai kecil untuk mendeteksi halaman kosong
//      (langsung dilewati, bisa dibalik dengan klik).
//   2. Strip disusun jadi PDF tersendiri (template klasik vektor / kartun SVG) lalu dirender
//      ke canvas sebagai bahan editor posisi.
//   3. Editor posisi: dua kotak (resi hijau, strip biru) bisa digeser & diubah ukurannya,
//      dengan snap ke tepi/tengah. Berlaku untuk semua halaman.
//   4. Cetak: PDF keluaran disusun (strip ditanam `embedPdf`), tiap halaman dirender ke <img>
//      di `#area-cetak-printing` (anak langsung <body>), lalu `window.print()`.
//
// KENAPA DI BROWSER: PDF resi memuat nama, alamat, dan nomor HP pembeli. File TIDAK pernah
// diunggah; hanya nomor pesanan yang dikirim SETELAH dicetak untuk catatan.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as PdfJsModule from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, FileText, Lock, Printer, Trash2 } from "lucide-react";

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
import { TEMPLATE, buatStrip, type TemplateStrip } from "@/lib/printing/strip";
import { bangunPdf, tataLetakAwal, type Kotak } from "@/lib/printing/watermark";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const MM = 72 / 25.4;
/** Piksel per mm di canvas editor (sama dengan alat referensi). */
const PX = 3.4;
/** Margin canvas editor (px CSS). */
const MG = 20;
/** Ambang "halaman kosong": di bawah 0,2% piksel gelap. */
const AMBANG_KOSONG = 0.002;

type PdfJs = typeof PdfJsModule;

/** Muat pdf.js sekali; worker disajikan dari `/pdf.worker.min.mjs` (seversi). */
let pdfjsSiap: Promise<PdfJs> | null = null;
function muatPdfJs(): Promise<PdfJs> {
  if (!pdfjsSiap) {
    pdfjsSiap = import("pdfjs-dist").then((mod) => {
      // KENAPA LOKAL: CDN mematikan Printing saat offline atau CSP memblokir jsdelivr.
      mod.GlobalWorkerOptions.workerSrc = `${BASE_PATH}/pdf.worker.min.mjs?v=${mod.version}`;
      return mod;
    });
  }
  return pdfjsSiap;
}

/** Buka dokumen lalu tutup lagi: buffer + worker resource tidak bocor. */
async function denganDokumen<T>(
  pdfjs: PdfJs,
  bytes: Uint8Array,
  pakai: (doc: PDFDocumentProxy) => Promise<T>
): Promise<T> {
  const tugas = pdfjs.getDocument({ data: bytes.slice(0) });
  const doc = await tugas.promise;
  try {
    return await pakai(doc);
  } finally {
    await tugas.destroy();
  }
}

type Berkas = {
  id: number;
  nama: string;
  bytes: Uint8Array;
  /** Dokumen dibiarkan terbuka selama berkas ada: thumbnail & pemindaian memakainya. */
  doc: PDFDocumentProxy;
  /** Loading task pemilik `doc`; pdf.js v6 membebaskan resource lewat objek ini. */
  tugas: PDFDocumentLoadingTask;
  jumlahHalaman: number;
  /** Indeks halaman (0-based) yang DILEWATI. */
  skip: Set<number>;
  /** Thumbnail per halaman; undefined = belum dipindai. */
  thumbs: (HTMLCanvasElement | undefined)[];
  /** Hasil deteksi tinta: true = terlihat kosong (saran). */
  blank: boolean[];
  scanned: boolean;
  nomor: NomorLabel;
};

type Seret = { kotak: Kotak; mode: "geser" | "ubah"; awal: { x: number; y: number }; kotakAwal: Kotak };

/** Gambar apa pun → PNG hitam-putih. Printer termal hanya 1 bit; gradasi tercetak kacau. */
async function kePngHitamPutih(f: File): Promise<{ png: Uint8Array; rasio: number }> {
  const url = URL.createObjectURL(f);
  try {
    // KENAPA <img>: Chromium tidak mendekode SVG lewat createImageBitmap.
    const { promise: siap, resolve: selesai, reject: gagal } = Promise.withResolvers<HTMLImageElement>();
    const img = new Image();
    img.onload = () => selesai(img);
    img.onerror = () => gagal(new Error("Gambar tidak bisa didekode."));
    img.src = url;
    const bmp = await siap;
    const lebarAsli = bmp.naturalWidth || bmp.width || 300;
    const tinggiAsli = bmp.naturalHeight || bmp.height || 300;
    const skala = Math.min(1, 400 / Math.max(lebarAsli, tinggiAsli));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(lebarAsli * skala));
    c.height = Math.max(1, Math.round(tinggiAsli * skala));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak tersedia.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const g = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
      const hitam = g < 160 ? 0 : 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = hitam;
      d.data[i + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);
    const { promise: jadi, resolve: selesaiBlob } = Promise.withResolvers<Blob | null>();
    c.toBlob(selesaiBlob, "image/png");
    const blob = await jadi;
    if (!blob) throw new Error("Gambar gagal dikonversi.");
    return { png: new Uint8Array(await blob.arrayBuffer()), rasio: c.width / c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Snap posisi ke tepi/tengah halaman (toleransi 1,5 mm). */
function snap(k: Kotak, lebar: number, tinggi: number): void {
  for (const [a, b, L] of [["x", "w", lebar], ["y", "h", tinggi]] as const) {
    for (const v of [0, L - k[b], (L - k[b]) / 2]) {
      if (Math.abs(k[a] - v) < 1.5) { k[a] = v; break; }
    }
  }
}

export function PrintingWorkspace() {
  /** Toko dipakai HANYA untuk mencocokkan nomor & mencatat cetak, bukan syarat mencetak. */
  const [toko, setToko] = useState<{ id: number; nama: string }[] | null>(null);
  const [presetId, setPresetId] = useState<number | null>(null);

  const [berkas, setBerkas] = useState<Berkas[]>([]);
  const [sibuk, setSibuk] = useState(false);
  const [progres, setProgres] = useState("");

  const [tplIndex, setTplIndex] = useState(0);
  const tpl = TEMPLATE[tplIndex] ?? TEMPLATE[0];
  const [teks1, setTeks1] = useState("FRAGILE");
  const [teks2, setTeks2] = useState("VIDEO UNBOXING");
  const [teks3, setTeks3] = useState("Tanpa video unboxing, komplain tidak diproses");
  const [logo, setLogo] = useState<{ png: Uint8Array; rasio: number } | null>(null);
  const [tinggiMm, setTinggiMm] = useState(150);
  const [crop, setCrop] = useState(0);

  /** Kotak strip (S) & resi (R) dalam mm dari kiri-atas. */
  const [S, setS] = useState<Kotak>({ x: 0, y: 130, w: 100, h: 20 });
  const [R, setR] = useState<Kotak>({ x: 0, y: 0, w: 100, h: 130 });
  /** User sudah menggeser/mengubah ukuran manual: perubahan lain tidak mereset posisi. */
  const [manual, setManual] = useState(false);
  const seret = useRef<Seret | null>(null);

  /** Canvas bahan: halaman resi pertama yang dicetak + render strip. */
  const [resiCv, setResiCv] = useState<HTMLCanvasElement | null>(null);
  const [resiKey, setResiKey] = useState("");
  const [srcW, setSrcW] = useState(298);
  const [srcH, setSrcH] = useState(420);
  const [stripCv, setStripCv] = useState<HTMLCanvasElement | null>(null);
  const [pesan, setPesan] = useState("Pilih PDF resi untuk melihat pratinjau.");
  const [jumlahCetak, setJumlahCetak] = useState(0);
  const [hanyaKosong, setHanyaKosong] = useState(false);
  const [memuatStrip, setMemuatStrip] = useState(false);

  const kanvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useRef(0);
  const scan = useRef({ sedang: false });

  const jumlahDilewati = useMemo(
    () => berkas.reduce((a, b) => a + b.skip.size, 0),
    [berkas]
  );
  const totalHalaman = useMemo(() => berkas.reduce((a, b) => a + b.jumlahHalaman, 0), [berkas]);
  const totalKosong = useMemo(
    () => berkas.reduce((a, b) => a + b.blank.filter(Boolean).length, 0),
    [berkas]
  );

  /** Rasio resi setelah potong bawah. */
  const rasioResi = useCallback(
    () => srcW / Math.max(1, srcH - Math.min(crop * MM, srcH - 40)),
    [srcW, srcH, crop]
  );

  /** Posisi awal: strip menempel di tepi bawah, resi memenuhi sisa ruang. */
  const aturUlang = useCallback(() => {
    const t = tataLetakAwal(tinggiMm, tpl.tinggiMm, rasioResi());
    setS(t.strip);
    setR(t.resi);
    setManual(false);
  }, [tinggiMm, tpl.tinggiMm, rasioResi]);

  // Posisi mengikuti template/ukuran/crop selama user belum menggeser manual.
  useEffect(() => {
    if (!manual) aturUlang();
  }, [manual, aturUlang]);

  // Daftar toko: bukan syarat mencetak.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/preset", { credentials: "include" });
        const d = (await res.json().catch(() => null)) as { ok?: boolean; presets?: { id: number; nama: string }[] } | null;
        const daftar = d?.ok ? d.presets ?? [] : [];
        setToko(daftar);
        setPresetId(daftar[0]?.id ?? null);
      } catch {
        setToko([]);
      }
    })();
  }, []);

  // Tutup semua dokumen pdf.js saat halaman ditinggalkan.
  const berkasRef = useRef<Berkas[]>([]);
  berkasRef.current = berkas;
  useEffect(() => {
    return () => {
      for (const b of berkasRef.current) void b.tugas.destroy();
    };
  }, []);

  /** Susun PDF strip, render halaman pertamanya ke canvas (bahan editor). */
  const renderStrip = useCallback(async () => {
    setMemuatStrip(true);
    try {
      const pdfjs = await muatPdfJs();
      const bytes = await buatStrip(
        tpl,
        { lebarMm: S.w, tinggiMm: S.h },
        { t1: teks1 || " ", t2: teks2 || " ", t3: teks3 },
        logo
      );
      const c = await denganDokumen(pdfjs, bytes, async (doc) => {
        const page = await doc.getPage(1);
        const vp = page.getViewport({ scale: 8 / MM });
        const kanvas = document.createElement("canvas");
        kanvas.width = Math.max(1, Math.round(vp.width));
        kanvas.height = Math.max(1, Math.round(vp.height));
        const ctx = kanvas.getContext("2d");
        if (!ctx) throw new Error("Canvas tidak tersedia.");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, kanvas.width, kanvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, canvas: kanvas }).promise;
        return kanvas;
      });
      setStripCv(c);
    } catch (e) {
      setPesan(`Gagal membuat strip: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMemuatStrip(false);
    }
  }, [tpl, S.w, S.h, teks1, teks2, teks3, logo]);

  // Render strip ditunda: mengetik teks tidak boleh memicu render tiap ketukan.
  useEffect(() => {
    const t = setTimeout(() => void renderStrip(), 200);
    return () => clearTimeout(t);
  }, [renderStrip]);

  /** Halaman pertama yang akan dicetak (untuk pratinjau). */
  const halamanPertama = useCallback(() => {
    for (const b of berkas) {
      for (let i = 0; i < b.jumlahHalaman; i++) {
        if (!b.skip.has(i)) return { b, i };
      }
    }
    return null;
  }, [berkas]);

  /** Render halaman pertama ke canvas (dipotong sesuai crop). */
  useEffect(() => {
    const t = halamanPertama();
    if (!t) {
      setResiCv(null);
      setResiKey("");
      setPesan("Pilih PDF resi untuk melihat pratinjau.");
      return;
    }
    const key = `${t.b.id}:${t.i}`;
    if (key === resiKey) return;
    let batal = false;
    void (async () => {
      try {
        const page = await t.b.doc.getPage(t.i + 1);
        const dasar = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 700 / dasar.width });
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(vp.width));
        c.height = Math.max(1, Math.round(vp.height));
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("Canvas tidak tersedia.");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
        if (batal) return;
        setResiCv(c);
        setResiKey(key);
        setSrcW(dasar.width);
        setSrcH(dasar.height);
        setPesan("Pratinjau menampilkan halaman pertama yang akan dicetak.");
      } catch (e) {
        if (!batal) setPesan(`Gagal membaca halaman: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => { batal = true; };
  }, [halamanPertama, resiKey]);

  /** Gambar ulang kanvas editor: resi, strip, kotak bantu, dan pegangan ubah ukuran. */
  const gambar = useCallback(() => {
    const cv = kanvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const P = PX * dpr;
    const M = MG * dpr;
    const cw = Math.round(100 * P + 2 * M);
    const chh = Math.round(tinggiMm * P + 2 * M);
    if (cv.width !== cw || cv.height !== chh) {
      cv.width = cw;
      cv.height = chh;
      cv.style.width = `${cw / dpr}px`;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, chh);
    ctx.save();
    ctx.translate(M, M);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 100 * P, tinggiMm * P);
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 100 * P, tinggiMm * P);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 100 * P, tinggiMm * P);
    ctx.clip();
    if (resiCv) {
      const k = 1 - Math.min(crop * MM, srcH - 40) / srcH;
      ctx.drawImage(resiCv, 0, 0, resiCv.width, resiCv.height * k, R.x * P, R.y * P, R.w * P, R.h * P);
    } else {
      ctx.fillStyle = "#eee";
      ctx.fillRect(R.x * P, R.y * P, R.w * P, R.h * P);
    }
    if (stripCv) ctx.drawImage(stripCv, S.x * P, S.y * P, S.w * P, S.h * P);
    ctx.restore();

    for (const [k, warna] of [[R, "#1a9a45"], [S, "#1e6fe0"]] as const) {
      ctx.strokeStyle = warna;
      ctx.fillStyle = warna;
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.strokeRect(k.x * P, k.y * P, k.w * P, k.h * P);
      ctx.setLineDash([]);
      const hs = 8 * dpr;
      ctx.fillRect((k.x + k.w) * P - hs, (k.y + k.h) * P - hs, hs, hs);
    }
    ctx.restore();
  }, [tinggiMm, resiCv, stripCv, R, S, crop, srcH]);

  useEffect(() => { gambar(); }, [gambar]);

  /** Koordinat pointer → mm (di dalam area halaman). */
  const keMm = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = kanvasRef.current;
    if (!cv) return { x: 0, y: 0 };
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    const k = (cv.width / dpr) / r.width;
    return {
      x: ((e.clientX - r.left) * k - MG) / PX,
      y: ((e.clientY - r.top) * k - MG) / PX,
    };
  }, []);

  const pilih = useCallback((p: { x: number; y: number }) => {
    for (const k of [S, R]) {
      if (Math.hypot(p.x - (k.x + k.w), p.y - (k.y + k.h)) < 4) return { kotak: k, mode: "ubah" as const };
    }
    for (const k of [S, R]) {
      if (p.x >= k.x && p.x <= k.x + k.w && p.y >= k.y && p.y <= k.y + k.h) return { kotak: k, mode: "geser" as const };
    }
    return null;
  }, [S, R]);

  function turun(e: React.PointerEvent<HTMLCanvasElement>) {
    const h = pilih(keMm(e));
    if (!h) return;
    seret.current = { kotak: h.kotak, mode: h.mode, awal: keMm(e), kotakAwal: { ...h.kotak } };
    setManual(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function geser(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = keMm(e);
    const d = seret.current;
    if (!d) {
      const h = pilih(p);
      e.currentTarget.style.cursor = h ? (h.mode === "ubah" ? "nwse-resize" : "move") : "default";
      return;
    }
    const dx = p.x - d.awal.x;
    const dy = p.y - d.awal.y;
    const ubah = (k: Kotak) => (d.kotak === S ? setS(k) : setR(k));
    if (d.mode === "geser") {
      const k = { ...d.kotakAwal, x: d.kotakAwal.x + dx, y: d.kotakAwal.y + dy };
      snap(k, 100, tinggiMm);
      ubah(k);
      return;
    }
    const k = { ...d.kotakAwal };
    k.w = Math.max(10, d.kotakAwal.w + dx);
    k.h = d.kotak === R || tpl.svg
      ? k.w * d.kotakAwal.h / Math.max(1, d.kotakAwal.w)
      : Math.max(10, d.kotakAwal.h + dy);
    ubah(k);
  }

  function lepas() {
    seret.current = null;
  }

  /** Muat berkas: buka dokumen, baca teks (nomor pesanan), lalu pindai halaman. */
  async function tambahBerkas(files: FileList | null) {
    if (!files || files.length === 0) return;
    setSibuk(true);
    const pdfjs = await muatPdfJs();
    const baru: Berkas[] = [];
    try {
      for (const [i, f] of [...files].entries()) {
        setProgres(`Membaca ${i + 1}/${files.length}: ${f.name}`);
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const tugas = pdfjs.getDocument({ data: bytes.slice(0) });
          const doc = await tugas.promise;
          const teksHalaman: string[] = [];
          for (let h = 1; h <= doc.numPages; h++) {
            const page = await doc.getPage(h);
            const isi = await page.getTextContent();
            teksHalaman.push(isi.items.map((it) => ("str" in it ? it.str : "")).join(" "));
          }
          baru.push({
            id: ++uid.current,
            nama: f.name,
            bytes,
            doc,
            tugas,
            jumlahHalaman: doc.numPages,
            skip: new Set(),
            thumbs: [],
            blank: [],
            scanned: false,
            nomor: bacaNomorDariHalaman(teksHalaman),
          });
        } catch {
          toast.error(`${f.name} tidak bisa dibaca sebagai PDF.`);
        }
      }
      setBerkas((s) => [...s, ...baru]);
    } finally {
      setSibuk(false);
      setProgres("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** Pindai halaman: thumbnail + deteksi kosong (otomatis dilewati, bisa dibalik). */
  useEffect(() => {
    if (scan.current.sedang) return;
    const target = berkas.find((b) => !b.scanned);
    if (!target) return;
    scan.current.sedang = true;
    void (async () => {
      try {
        target.scanned = true;
        const thumbs = [...target.thumbs];
        const blank = [...target.blank];
        const skip = new Set(target.skip);
        for (let i = 1; i <= target.jumlahHalaman; i++) {
          const page = await target.doc.getPage(i);
          const dasar = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: 150 / dasar.width });
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(vp.width));
          c.height = Math.max(1, Math.round(vp.height));
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (!ctx) continue;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let tinta = 0;
          for (let p = 0; p < d.length; p += 4) {
            if (d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11 < 200) tinta += 1;
          }
          const kosong = tinta / (c.width * c.height) < AMBANG_KOSONG;
          thumbs[i - 1] = c;
          blank[i - 1] = kosong;
          if (kosong) skip.add(i - 1);
          // Perbarui bertahap supaya halaman 50 tidak membekukan tab.
          if (i % 4 === 0 || i === target.jumlahHalaman) {
            setBerkas((s) => s.map((b) => (b.id === target.id ? { ...b, thumbs: [...thumbs], blank: [...blank], skip: new Set(skip), scanned: true } : b)));
            // Beri kesempatan UI menggambar ulang sebelum lanjut halaman berikutnya.
            const { promise, resolve } = Promise.withResolvers<void>();
            setTimeout(resolve);
            await promise;
          }
        }
      } catch (e) {
        toast.error(`Gagal memindai ${target.nama}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        scan.current.sedang = false;
      }
    })();
  }, [berkas]);

  /** Hapus berkas: dokumen pdf.js ikut ditutup. */
  function hapusBerkas(id: number) {
    setBerkas((s) => {
      const buang = s.find((b) => b.id === id);
      if (buang) void buang.tugas.destroy();
      return s.filter((b) => b.id !== id);
    });
  }

  function pindahBerkas(i: number, d: number) {
    setBerkas((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const c = [...s];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  }

  function balikHalaman(b: Berkas, i: number) {
    setBerkas((s) => s.map((x) => {
      if (x.id !== b.id) return x;
      const skip = new Set(x.skip);
      if (skip.has(i)) skip.delete(i);
      else skip.add(i);
      return { ...x, skip };
    }));
  }

  // Jumlah yang akan dicetak mengikuti halaman yang tidak dilewati.
  useEffect(() => {
    setJumlahCetak(Math.max(0, totalHalaman - jumlahDilewati));
  }, [totalHalaman, jumlahDilewati]);

  /** Sumber untuk `bangunPdf`: halaman yang dilewati dikirim `null`. */
  const sumberBerkas = useCallback(() => {
    const isi = { getSize: () => ({ width: 0, height: 0 }) };
    return berkas.map((b) => ({
      bytes: b.bytes,
      halaman: Array.from({ length: b.jumlahHalaman }, (_, i) => (b.skip.has(i) ? null : isi)),
    }));
  }, [berkas]);

  /** Susun PDF keluaran lengkap (strip ditanam sekali). */
  const susun = useCallback(async () => {
    const stripBytes = await buatStrip(
      tpl,
      { lebarMm: S.w, tinggiMm: S.h },
      { t1: teks1 || " ", t2: teks2 || " ", t3: teks3 },
      logo
    );
    return bangunPdf(sumberBerkas(), { tinggiMm, stripBytes, strip: S, resi: R, cropBawahMm: crop });
  }, [tpl, S, teks1, teks2, teks3, logo, sumberBerkas, tinggiMm, R, crop]);

  /** Catat "sudah dicetak" untuk nomor yang DIKENAL sistem. */
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

  async function cetak() {
    if (berkas.length === 0) return;
    setSibuk(true);
    setProgres("Menyiapkan cetak…");
    try {
      const hasil = await susun();
      if (hasil.halaman === 0) {
        toast.error("Semua halaman dilewati. Pakai minimal satu halaman.");
        return;
      }
      const pdfjs = await muatPdfJs();
      // KENAPA DI <body>: aturan cetak menyembunyikan semua anak <body> lain. Area cetak yang
      // bersarang di AppShell ikut tersembunyi, dan dialog cetak keluar satu halaman kosong.
      let wadah = document.getElementById("area-cetak-printing");
      if (!wadah) {
        wadah = document.createElement("div");
        wadah.id = "area-cetak-printing";
        wadah.setAttribute("aria-hidden", "true");
        document.body.appendChild(wadah);
      }
      wadah.innerHTML = "";
      await denganDokumen(pdfjs, hasil.bytes, async (doc) => {
        for (let i = 1; i <= doc.numPages; i++) {
          setProgres(`Menyiapkan halaman ${i}/${doc.numPages}…`);
          const page = await doc.getPage(i);
          // 800 px untuk lebar 100 mm ≈ 203 dpi — ambang minimum pembaca barcode termal.
          const vp = page.getViewport({ scale: 800 / (page.view[2] - page.view[0]) });
          const c = document.createElement("canvas");
          c.width = Math.round(vp.width);
          c.height = Math.round(vp.height);
          const ctx = c.getContext("2d");
          if (!ctx) throw new Error("Canvas tidak tersedia.");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
          const img = new Image();
          img.src = c.toDataURL("image/png");
          await img.decode();
          wadah.appendChild(img);
        }
      });
      let gaya = document.getElementById("gaya-cetak-printing");
      if (!gaya) {
        gaya = document.createElement("style");
        gaya.id = "gaya-cetak-printing";
        document.head.appendChild(gaya);
      }
      gaya.textContent =
        `@page{size:100mm ${tinggiMm}mm;margin:0}` +
        `@media print{html,body{margin:0!important;padding:0!important;background:#fff!important}` +
        `body>*:not(#area-cetak-printing){display:none!important}` +
        `#area-cetak-printing{display:block!important;visibility:visible!important;position:static!important;` +
        `width:100mm!important;height:auto!important;overflow:visible!important;margin:0!important;padding:0!important}` +
        `#area-cetak-printing img{display:block;width:100mm!important;height:auto!important;` +
        `page-break-after:always;break-after:page;margin:0!important;border:0!important}` +
        `#area-cetak-printing img:last-child{page-break-after:auto;break-after:auto}}`;

      // Dialog print membaca DOM setelah frame berikutnya; tanpa jeda ini Chromium kadang
      // mencetak halaman kosong pada label besar.
      const { promise: frame, resolve: lanjut } = Promise.withResolvers<void>();
      requestAnimationFrame(() => setTimeout(lanjut, 100));
      await frame;

      let bersih = false;
      const bersihkan = () => {
        if (bersih) return;
        bersih = true;
        document.getElementById("gaya-cetak-printing")?.remove();
        wadah.innerHTML = "";
        // Catat SETELAH dialog ditutup: user yang membatalkan tidak dicatat "sudah dicetak".
        void catatCetak();
      };
      window.addEventListener("afterprint", bersihkan, { once: true });
      // Jaring pengaman: sebagian WebView tidak pernah memicu afterprint.
      window.setTimeout(bersihkan, 60_000);

      window.print();
      toast.success(`${hasil.halaman} halaman dikirim ke dialog cetak.`);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal menyiapkan cetak.");
    } finally {
      setSibuk(false);
      setProgres("");
    }
  }

  async function pilihLogo(f: File | null) {
    if (!f) { setLogo(null); return; }
    try {
      setLogo(await kePngHitamPutih(f));
    } catch {
      setLogo(null);
      toast.error("Logo tidak bisa dibaca. Pakai PNG, JPG, WebP, atau SVG.");
    }
  }

  function pilihTemplate(i: number) {
    setTplIndex(i);
    const t = TEMPLATE[i];
    if (!t) return;
    // Posisi mengikuti template baru; ukuran manual sebelumnya dilepas.
    const tata = tataLetakAwal(tinggiMm, t.tinggiMm, rasioResi());
    setS(tata.strip);
    setR(tata.resi);
    setManual(false);
  }

  const kosongTerlihat = useMemo(
    () => berkas.reduce((a, b) => a + b.blank.filter((_, i) => !b.skip.has(i) && b.blank[i]).length, 0),
    [berkas]
  );

  return (
    <>
      <PageHeader
        judul="Printing"
        deskripsi="Tambah strip peringatan dan cetak resi dari marketplace apa pun. File tidak diunggah ke server."
      />

      <div className="flex flex-col gap-4" data-testid="printing">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <label className="flex min-w-[220px] flex-col gap-1 text-xs text-muted-foreground">
              Toko (untuk mencocokkan order & mencatat cetak)
              <Select
                value={presetId ? String(presetId) : ""}
                onValueChange={(v) => { if (typeof v === "string" && v) setPresetId(Number(v)); }}
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
              Nomor pesanan dibaca otomatis dari PDF. Tanpa toko: tetap bisa cetak, status
              “sudah dicetak” tidak dicatat.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── Berkas & template ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Berkas resi & template strip</CardTitle>
              <CardDescription>
                Bisa banyak PDF sekaligus. Urutan cetak mengikuti daftar.
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
                    <EmptyDescription>Pilih PDF resi untuk mulai.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary" data-testid="printing-ringkas">{berkas.length} berkas · {totalHalaman} halaman</Badge>
                    {jumlahDilewati > 0 ? <Badge variant="outline">{jumlahDilewati} dilewati</Badge> : null}
                    {totalKosong > 0 ? <Badge variant="outline">{totalKosong} terlihat kosong</Badge> : null}
                  </div>
                  <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" data-testid="daftar-berkas">
                    {berkas.map((b, i) => (
                      <li key={b.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
                        <span className="min-w-0 flex-1 truncate" title={b.nama}>
                          {i + 1}. {b.nama}
                          <span className="text-muted-foreground"> · {b.jumlahHalaman} hlm</span>
                          {b.nomor.noPesanan ? <span className="ml-1 font-mono">{b.nomor.noPesanan}</span> : null}
                        </span>
                        <Button size="sm" variant="ghost" className="h-7 px-1" disabled={i === 0} onClick={() => pindahBerkas(i, -1)} aria-label="Naikkan">
                          <ChevronUp className="size-3.5" aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-1" disabled={i === berkas.length - 1} onClick={() => pindahBerkas(i, 1)} aria-label="Turunkan">
                          <ChevronDown className="size-3.5" aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-1" onClick={() => hapusBerkas(b.id)} aria-label="Hapus">
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setBerkas((s) => [...s].sort((a, b) => a.nama.localeCompare(b.nama, undefined, { numeric: true })))}>Urutkan A-Z</Button>
                    <Button size="sm" variant="outline" onClick={() => { for (const b of berkas) void b.tugas.destroy(); setBerkas([]); }}>Hapus semua</Button>
                  </div>
                </>
              )}

              <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                2. Template strip
                <div className="flex flex-col gap-1.5" data-testid="daftar-template">
                  {TEMPLATE.map((t, i) => (
                    <button
                      key={t.nama}
                      type="button"
                      onClick={() => pilihTemplate(i)}
                      aria-pressed={tplIndex === i}
                      data-testid={`template-${i}`}
                      className={`w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${tplIndex === i ? "border-primary bg-primary/10 font-semibold ring-1 ring-ring/40" : "border-border hover:bg-muted"}`}
                    >
                      {t.nama}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Ukuran output
                  <Select value={String(tinggiMm)} onValueChange={(v) => { if (typeof v === "string" && v) setTinggiMm(Number(v)); }}>
                    <SelectTrigger className="h-9 w-full" data-testid="ukuran-output">
                      <SelectValue>{(v: string | null) => `${100} x ${v ?? 150} mm`}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="150">100 x 150 mm</SelectItem>
                        <SelectItem value="120">100 x 120 mm</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Potong bawah resi: {crop} mm
                  <input
                    type="range"
                    min={0}
                    max={80}
                    value={crop}
                    onChange={(e) => setCrop(Number(e.target.value))}
                    data-testid="crop-bawah"
                    className="h-9 w-full accent-primary"
                  />
                </label>
              </div>

              {tpl.svg ? (
                <p className="text-[11px] text-muted-foreground">
                  Template kartun memakai gambar bawaan; teks & logo tidak dipakai.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Teks kotak kiri
                    <Input value={teks1} maxLength={24} onChange={(e) => setTeks1(e.target.value)} className="h-9" data-testid="teks1" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Teks kotak kanan
                    <Input value={teks2} maxLength={28} onChange={(e) => setTeks2(e.target.value)} className="h-9" data-testid="teks2" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Teks kecil di bawah
                    <Input value={teks3} maxLength={70} onChange={(e) => setTeks3(e.target.value)} className="h-9" data-testid="teks-bawah" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Logo toko (opsional, jadi hitam putih)
                    <Input type="file" accept="image/*" onChange={(e) => void pilihLogo(e.target.files?.[0] ?? null)} className="h-9" data-testid="unggah-logo" />
                  </label>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Editor posisi ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Posisi & pratinjau</CardTitle>
              <CardDescription>
                Hijau = resi, biru = strip. Seret untuk geser, tarik kotak kecil di pojok
                kanan-bawah untuk ubah ukuran. Berlaku otomatis ke semua halaman.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              <canvas
                ref={kanvasRef}
                data-testid="kanvas-posisi"
                onPointerDown={turun}
                onPointerMove={geser}
                onPointerUp={lepas}
                onPointerCancel={lepas}
                className="max-w-full touch-none rounded border border-border bg-white"
              />
              {memuatStrip ? <Spinner data-testid="memuat-strip" /> : null}
              <Button size="sm" variant="outline" onClick={aturUlang} data-testid="reset-posisi">
                Atur ulang posisi otomatis
              </Button>
              <p className="text-center text-xs text-muted-foreground" data-testid="pesan-pratinjau">{pesan}</p>
            </CardContent>
          </Card>
        </div>

        {/* ── Halaman kosong & cetak ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Cek halaman kosong</CardTitle>
            <CardDescription>
              Halaman kosong terdeteksi otomatis (border kuning) dan langsung dilewati (merah).
              Klik halaman mana pun untuk ganti lewati / cetak.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setHanyaKosong((v) => !v)} data-testid="hanya-kosong">
                {hanyaKosong ? "Tampilkan semua" : "Hanya tampilkan kosong"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBerkas((s) => s.map((b) => {
                  const skip = new Set(b.skip);
                  b.blank.forEach((v, i) => { if (v) skip.add(i); });
                  return { ...b, skip };
                }))}
                data-testid="lewati-kosong"
              >
                Lewati semua kosong
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBerkas((s) => s.map((b) => ({ ...b, skip: new Set() })))}
                data-testid="cetak-semua"
              >
                Cetak semua
              </Button>
            </div>

            {berkas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada berkas.</p>
            ) : (
              <div className="flex flex-col gap-3" data-testid="daftar-halaman">
                {berkas.map((b) => (
                  <div key={b.id} className="flex flex-col gap-1">
                    <p className="text-xs font-semibold">
                      {b.nama} ({b.jumlahHalaman} hlm)
                      {b.thumbs.length < b.jumlahHalaman ? ` — memindai ${b.thumbs.filter(Boolean).length}/${b.jumlahHalaman}…` : ""}
                    </p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                      {Array.from({ length: b.jumlahHalaman }, (_, i) => {
                        const isBlank = !!b.blank[i];
                        if (hanyaKosong && !isBlank) return null;
                        const dilewati = b.skip.has(i);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => balikHalaman(b, i)}
                            data-testid={`halaman-${i + 1}`}
                            className={`flex flex-col gap-1 rounded border-2 bg-white p-1 text-left ${dilewati ? "border-destructive/60" : isBlank ? "border-amber-500" : "border-border"}`}
                          >
                            {b.thumbs[i] ? (
                              // eslint-disable-next-line @next/next/no-img-element -- hasil render canvas
                              <img
                                src={b.thumbs[i]?.toDataURL("image/jpeg", 0.6)}
                                alt={`Halaman ${i + 1}`}
                                className={`w-full ${dilewati ? "opacity-30" : ""}`}
                              />
                            ) : (
                              <span className="flex h-32 items-center justify-center text-[10px] text-muted-foreground">memindai…</span>
                            )}
                            <span className="text-[10px] leading-tight">
                              Hlm {i + 1}
                              {isBlank ? " · kosong" : ""}
                              {dilewati ? " · lewati" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground" data-testid="jumlah-cetak">
              {berkas.length === 0
                ? "Belum ada berkas."
                : `Total ${totalHalaman} halaman: ${jumlahCetak} dicetak, ${jumlahDilewati} dilewati (${totalKosong} terdeteksi kosong).`}
            </p>
            {kosongTerlihat > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="saran-kosong">
                {kosongTerlihat} halaman terlihat kosong tapi masih akan dicetak — klik untuk melewati.
              </p>
            ) : null}

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <Button onClick={() => void cetak()} disabled={sibuk || jumlahCetak === 0} data-testid="tombol-cetak">
                {sibuk ? <Spinner data-icon="inline-start" /> : <Printer className="size-4" aria-hidden />}
                {jumlahCetak > 0 ? `Cetak ${jumlahCetak} resi` : "Cetak"}
              </Button>
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                File diproses di browser dan tidak pernah diunggah. Print: kertas sesuai output,
                skala 100%, tanpa margin.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
