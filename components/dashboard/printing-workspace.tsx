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
import {
  ChevronDown, ChevronUp, Download, FileText, Lock, Printer, Trash2, TriangleAlert,
} from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

/** Preset watermark: teks yang paling sering dipakai toko. Semua masih bisa diedit. */
const PRESET: Record<string, { teks1: string; teks2: string; teks3: string }> = {
  fragile: { teks1: "FRAGILE", teks2: "VIDEO UNBOXING", teks3: "Tanpa video unboxing, komplain tidak diproses" },
  unboxing: { teks1: "VIDEO UNBOXING", teks2: "WAJIB", teks3: "Rekam saat paket dibuka. Tanpa video, klaim tidak dilayani." },
  jangan: { teks1: "JANGAN DIBANTING", teks2: "PECAH BELAH", teks3: "Barang mudah pecah. Simpan di tempat aman." },
  cod: { teks1: "COD", teks2: "BAYAR DI TEMPAT", teks3: "Barang dikirim setelah pembayaran diterima kurir." },
  kosong: { teks1: "TERIMA KASIH", teks2: "SUDAH DICEK", teks3: "Barang sudah diperiksa sebelum dikirim." },
};

/** Label yang terlihat di pemicu Select — nilai mentah ("fragile") tidak boleh tampil. */
const LABEL_PRESET: Record<string, string> = {
  fragile: "Fragile + Video Unboxing",
  unboxing: "Video Unboxing",
  jangan: "Jangan Dibanting",
  cod: "COD",
  kosong: "Terima kasih",
};
const LABEL_POSISI: Record<string, string> = {
  bawah: "Strip bawah",
  atas: "Strip atas",
  tengah: "Cap tengah",
};

type Berkas = {
  nama: string;
  bytes: Uint8Array;
  /** Jumlah halaman; -1 = gagal dibaca. */
  jumlahHalaman: number;
  /** Hasil baca nomor (null = tidak terbaca, label tetap boleh dicetak). */
  nomor: NomorLabel;
  /** Status pencocokan ke sistem: dikenal / tidak dikenal / belum dicek. */
  status: "dikenal" | "asing" | "belum";
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

export function PrintingWorkspace() {
  /** Preset dipilih dari daftar toko; dipakai HANYA untuk mencocokkan & mencatat cetak. */
  const [presetId, setPresetId] = useState<number | null>(null);
  const [toko, setToko] = useState<{ id: number; nama: string }[]>([]);
  const [berkas, setBerkas] = useState<Berkas[]>([]);
  const [sibuk, setSibuk] = useState(false);
  const [progres, setProgres] = useState("");
  const [preset, setPreset] = useState<keyof typeof PRESET>("fragile");
  const [posisi, setPosisi] = useState<PosisiWatermark>("bawah");
  const [teks1, setTeks1] = useState(PRESET.fragile.teks1);
  const [teks2, setTeks2] = useState(PRESET.fragile.teks2);
  const [teks3, setTeks3] = useState(PRESET.fragile.teks3);
  const [tinggiMm, setTinggiMm] = useState(150);
  const [stripMm, setStripMm] = useState(20);
  const [opacity, setOpacity] = useState(1);
  const [rotasi, setRotasi] = useState(35);
  const [crop, setCrop] = useState(0);
  const [geserX, setGeserX] = useState(0);
  const [geserY, setGeserY] = useState(0);
  const [logo, setLogo] = useState<{ png: Uint8Array; rasio: number } | null>(null);
  const [halamanDilewati, setHalamanDilewati] = useState<Record<string, true>>({});
  const [pratinjau, setPratinjau] = useState<string | null>(null);
  const [memuatPratinjau, setMemuatPratinjau] = useState(false);
  const [jumlahHalamanOut, setJumlahHalamanOut] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const opsi: OpsiCetak = useMemo(
    () => ({
      tinggiMm, stripMm, posisi, teks1, teks2, teks3, opacity, rotasi,
      cropBawahMm: crop, geserXMm: geserX, geserYMm: geserY, logo,
    }),
    [tinggiMm, stripMm, posisi, teks1, teks2, teks3, opacity, rotasi, crop, geserX, geserY, logo]
  );

  // Daftar toko: bukan syarat mencetak. Kegagalan memuatnya hanya membuat pencatatan
  // "sudah dicetak" tidak tersedia — halaman tetap bisa dipakai.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/preset", { credentials: "include" });
        const d = (await res.json().catch(() => null)) as { ok?: boolean; preset?: { id: number; nama: string }[] } | null;
        const daftar = d?.preset ?? [];
        setToko(daftar);
        setPresetId(daftar[0]?.id ?? null);
      } catch {
        setToko([]);
      }
    })();
  }, []);

  /** Baca satu berkas: nomor halaman, teks per halaman → nomor pesanan/resi. */
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
    return { nama: f.name, bytes, jumlahHalaman: doc.numPages, nomor: bacaNomorDariHalaman(teksHalaman), status: "belum" };
  }, []);

  /** Cocokkan nomor pesanan ke sistem (hanya bila preset dipilih). */
  const cocokkan = useCallback(async (daftar: Berkas[]) => {
    if (!presetId) return daftar;
    const nomor = daftar.map((b) => b.nomor.noPesanan).filter((n): n is string => !!n);
    if (nomor.length === 0) return daftar;
    try {
      const res = await fetch(`/api/printing?presetId=${presetId}&noPesanan=${encodeURIComponent(nomor.join(","))}`, { credentials: "include" });
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
  }, [presetId]);

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
      const gabung = await cocokkan([...berkas, ...baru]);
      setBerkas(gabung);
    } finally {
      setSibuk(false);
      setProgres("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** Pratinjau: render PDF hasil (hanya halaman pertama) agar user melihat watermark nyata. */
  const bangunPratinjau = useCallback(async () => {
    if (berkas.length === 0 || sibuk) return;
    setMemuatPratinjau(true);
    try {
      const pdfjs = await muatPdfJs();
      // `bangunPdf` butuh ukuran tiap halaman sumber. Ukuran diambil dari pdf.js, dan
      // halaman yang dihapus user dikirim sebagai `null` agar tidak ikut dicetak.
      const sumber = await Promise.all(
        berkas.map(async (b) => {
          const doc = await pdfjs.getDocument({ data: b.bytes.slice(0) }).promise;
          const halaman = await Promise.all(
            Array.from({ length: doc.numPages }, async (_, i) => {
              if (halamanDilewati[`${b.nama}#${i}`]) return null;
              const p = await doc.getPage(i + 1);
              // pdf.js tidak menyediakan `getSize()`; ukuran diambil dari viewport skala 1
              // lalu dipetakan ke bentuk yang dipakai pembangun PDF.
              const v = p.getViewport({ scale: 1 });
              return { getSize: () => ({ width: v.width, height: v.height }) };
            })
          );
          return { bytes: b.bytes, halaman };
        })
      );
      const hasil = await bangunPdf(sumber, opsi, true);
      setJumlahHalamanOut(hasil.halaman);
      const doc = await pdfjs.getDocument({ data: hasil.bytes.slice(0) }).promise;
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d") as CanvasRenderingContext2D, viewport: vp, canvas }).promise;
      setPratinjau(canvas.toDataURL("image/png"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat pratinjau.");
    } finally {
      setMemuatPratinjau(false);
    }
  }, [berkas, opsi, halamanDilewati, sibuk]);

  // Render ulang pratinjau saat pengaturan berubah — ditunda supaya mengetik teks tidak
  // memicu render tiap ketukan.
  useEffect(() => {
    if (berkas.length === 0) return;
    const t = setTimeout(() => void bangunPratinjau(), 400);
    return () => clearTimeout(t);
  }, [bangunPratinjau, berkas.length]);

  async function unduh() {
    setSibuk(true);
    setProgres("Menyusun PDF…");
    try {
      const pdfjs = await muatPdfJs();
      const sumber = await Promise.all(
        berkas.map(async (b) => {
          const doc = await pdfjs.getDocument({ data: b.bytes.slice(0) }).promise;
          const halaman = await Promise.all(
            Array.from({ length: doc.numPages }, async (_, i) => {
              if (halamanDilewati[`${b.nama}#${i}`]) return null;
              const p = await doc.getPage(i + 1);
              // pdf.js tidak menyediakan `getSize()`; ukuran diambil dari viewport skala 1
              // lalu dipetakan ke bentuk yang dipakai pembangun PDF.
              const v = p.getViewport({ scale: 1 });
              return { getSize: () => ({ width: v.width, height: v.height }) };
            })
          );
          return { bytes: b.bytes, halaman };
        })
      );
      const hasil = await bangunPdf(sumber, opsi);
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
    if (berkas.length === 0 || !presetId) return;
    setSibuk(true);
    setProgres("Menyiapkan halaman cetak…");
    try {
      const pdfjs = await muatPdfJs();
      const sumber = await Promise.all(
        berkas.map(async (b) => {
          const doc = await pdfjs.getDocument({ data: b.bytes.slice(0) }).promise;
          const halaman = await Promise.all(
            Array.from({ length: doc.numPages }, async (_, i) => {
              if (halamanDilewati[`${b.nama}#${i}`]) return null;
              const p = await doc.getPage(i + 1);
              // pdf.js tidak menyediakan `getSize()`; ukuran diambil dari viewport skala 1
              // lalu dipetakan ke bentuk yang dipakai pembangun PDF.
              const v = p.getViewport({ scale: 1 });
              return { getSize: () => ({ width: v.width, height: v.height }) };
            })
          );
          return { bytes: b.bytes, halaman };
        })
      );
      const hasil = await bangunPdf(sumber, opsi);
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
        await page.render({ canvasContext: c.getContext("2d") as CanvasRenderingContext2D, viewport: vp, canvas: c }).promise;
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
      gaya.textContent = `@page{size:100mm ${tinggiMm}mm;margin:0}`;
      await catatCetak();
      window.print();
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
    setPreset(k);
    setTeks1(PRESET[k].teks1);
    setTeks2(PRESET[k].teks2);
    setTeks3(PRESET[k].teks3);
  }

  async function pilihLogo(f: File | null) {
    if (!f) { setLogo(null); return; }
    try {
      const bmp = await createImageBitmap(f);
      const skala = Math.min(1, 400 / bmp.width);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * skala));
      c.height = Math.max(1, Math.round(bmp.height * skala));
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("Canvas tidak tersedia.");
      // Latar putih + ambang abu: logo berwarna dicetak di printer termal (hanya 1 bit),
      // sehingga tanpa konversi tepi warnanya jadi raster kacau.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const g = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = g < 160 ? 0 : 255;
        d.data[i + 3] = 255;
      }
      ctx.putImageData(d, 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (!blob) throw new Error("Logo gagal dikonversi.");
      setLogo({ png: new Uint8Array(await blob.arrayBuffer()), rasio: c.width / c.height });
    } catch {
      toast.error("Logo tidak bisa dibaca.");
      setLogo(null);
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
            <label className="flex min-w-[200px] flex-col gap-1 text-xs text-muted-foreground">
              Toko (untuk mencatat “sudah dicetak”)
              <Select value={presetId ? String(presetId) : ""} onValueChange={(v) => { if (v) setPresetId(Number(v)); }}>
                <SelectTrigger className="h-9 w-full" data-testid="printing-preset">
                  <SelectValue>{(v: string | null) => toko.find((t) => String(t.id) === v)?.nama ?? "Pilih toko"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {toko.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.nama}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            {!presetId ? (
              <Alert variant="destructive" className="flex-1" data-testid="printing-tanpa-preset">
                <TriangleAlert aria-hidden />
                <AlertTitle>Tanpa toko</AlertTitle>
                <AlertDescription>
                  Cetak tetap bisa; status “sudah dicetak” tidak dicatat.
                </AlertDescription>
              </Alert>
            ) : null}
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
                  <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" data-testid="daftar-berkas">
                    {berkas.map((b, i) => (
                      <li key={`${b.nama}-${i}`} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
                        <span className="min-w-0 flex-1 truncate" title={b.nama}>
                          {i + 1}. {b.nama}
                          <span className="text-muted-foreground"> · {b.jumlahHalaman} hlm</span>
                          {b.nomor.noPesanan ? <span className="ml-1 font-mono">{b.nomor.noPesanan}</span> : null}
                          {b.nomor.noResi ? <span className="ml-1 text-muted-foreground">{b.nomor.noResi}</span> : null}
                        </span>
                        {b.status === "dikenal" ? <Badge variant="secondary">sistem</Badge> : null}
                        {b.status === "asing" ? <Badge variant="outline">asing</Badge> : null}
                        {!b.nomor.noPesanan ? <Badge variant="outline">tak terbaca</Badge> : null}
                        <Button size="sm" variant="ghost" className="h-7 px-1" disabled={i === 0} onClick={() => setBerkas((s) => { const c = [...s]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; })} aria-label="Naikkan">
                          <ChevronUp className="size-3.5" aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-1" disabled={i === berkas.length - 1} onClick={() => setBerkas((s) => { const c = [...s]; [c[i], c[i + 1]] = [c[i + 1], c[i]]; return c; })} aria-label="Turunkan">
                          <ChevronDown className="size-3.5" aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-1" onClick={() => setBerkas((s) => s.filter((_, j) => j !== i))} aria-label="Hapus">
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setBerkas((s) => [...s].sort((a, b) => a.nama.localeCompare(b.nama, undefined, { numeric: true })))}>Urutkan A-Z</Button>
                    <Button size="sm" variant="outline" onClick={() => { setBerkas([]); setPratinjau(null); setHalamanDilewati({}); }}>Hapus semua</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Watermark ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Watermark</CardTitle>
              <CardDescription>Strip ditempel di tepi label supaya alamat & barcode tetap terbaca.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Preset
                  <Select value={preset} onValueChange={(v) => v && terapkanPreset(v as keyof typeof PRESET)}>
                    <SelectTrigger className="h-9 w-full" data-testid="preset-watermark">
                      <SelectValue>{(v: string | null) => LABEL_PRESET[v ?? ""] ?? "Pilih preset"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="fragile">Fragile + Video Unboxing</SelectItem>
                        <SelectItem value="unboxing">Video Unboxing</SelectItem>
                        <SelectItem value="jangan">Jangan Dibanting</SelectItem>
                        <SelectItem value="cod">COD</SelectItem>
                        <SelectItem value="kosong">Terima kasih</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Posisi
                  <Select value={posisi} onValueChange={(v) => v && setPosisi(v as PosisiWatermark)}>
                    <SelectTrigger className="h-9 w-full" data-testid="posisi-watermark">
                      <SelectValue>{(v: string | null) => LABEL_POSISI[v ?? ""] ?? "Pilih posisi"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="bawah">Strip bawah</SelectItem>
                        <SelectItem value="atas">Strip atas</SelectItem>
                        <SelectItem value="tengah">Cap tengah</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
              </div>
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
                <Input value={teks3} maxLength={70} onChange={(e) => setTeks3(e.target.value)} className="h-9" data-testid="teks3" />
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Tinggi (mm)
                  <Input type="number" min={100} max={300} value={tinggiMm} onChange={(e) => setTinggiMm(Number(e.target.value) || 150)} className="h-9" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Strip (mm)
                  <Input type="number" min={10} max={45} value={stripMm} onChange={(e) => setStripMm(Number(e.target.value) || 20)} className="h-9" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Opacity
                  <Input type="number" min={5} max={100} value={Math.round(opacity * 100)} onChange={(e) => setOpacity((Number(e.target.value) || 100) / 100)} className="h-9" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Rotasi (cap)
                  <Input type="number" min={0} max={90} value={rotasi} onChange={(e) => setRotasi(Number(e.target.value) || 0)} className="h-9" />
                </label>
              </div>
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
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Logo toko (opsional → hitam putih)
                <Input type="file" accept="image/*" onChange={(e) => void pilihLogo(e.target.files?.[0] ?? null)} />
              </label>
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
                <p className="text-sm text-muted-foreground">Pilih berkas untuk melihat pratinjau.</p>
              )}
            </div>
            <div className="flex w-full flex-col gap-2 md:w-64">
              <p className="text-xs text-muted-foreground">
                {jumlahHalamanOut > 0 ? `${jumlahHalamanOut} halaman pada pratinjau.` : "Belum ada pratinjau."}
              </p>
              <Button onClick={() => void cetak()} disabled={sibuk || berkas.length === 0} data-testid="tombol-cetak">
                {sibuk ? <Spinner data-icon="inline-start" /> : <Printer className="size-4" aria-hidden />}
                Cetak
              </Button>
              <Button variant="outline" onClick={() => void unduh()} disabled={sibuk || berkas.length === 0} data-testid="tombol-unduh">
                <Download className="size-4" aria-hidden />
                Unduh PDF
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

      {/* Hanya terlihat saat print; diisi gambar per halaman hasil. */}
      <div id="area-cetak-printing" className="hidden print:block" />
    </>
  );
}
