// components/dashboard/printing-studio.tsx — Lembar kerja cetak resi (rombak total).
//
// ALUR:
//   1. PDF resi dibaca pdf.js. Tiap halaman dipindai 300 px: kotak resi dideteksi
//      (`deteksiKotakTinta`), tabel qty dibaca dari teks (`bacaQtyHalaman`), halaman kosong
//      ditandai. Halaman kosong LANGSUNG dilewati, bisa dibalik dengan klik.
//   2. Strip disusun jadi PDF tersendiri (`buatStrip`) lalu dirender ke canvas sebagai bahan
//      editor posisi (dua kotak: resi hijau, strip biru).
//   3. Urutan cetak diatur `urutkanHalaman`; resi panjang dipecah jadi dua lembar
//      (`rencanaHalaman`).
//   4. Cetak: `bangunPdf` menyusun keluaran, tiap halaman dirender ke <img> di
//      `#area-cetak-printing` (anak langsung <body>), lalu `window.print()`.
//
// KENAPA DI BROWSER: PDF resi memuat nama, alamat, dan nomor HP pembeli. File TIDAK pernah
// diunggah; hanya nomor pesanan yang dikirim SETELAH dicetak untuk catatan.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, FileText, Lock, Printer, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { bacaNomorDariHalaman, type NomorLabel } from "@/lib/printing/ekstraksi";
import { AMBANG_KOSONG, INFO_PENUH, deteksiKotakTinta, fraksiTinta, type InfoResi } from "@/lib/printing/deteksiResi";
import { kePngHitamPutih, denganDokumen, muatPdfJs, renderHalaman, type PdfJs } from "@/lib/printing/klienPdf";
import { bacaQtyHalaman, penandaQty, type BarisQty, type GayaQty, type ModeQty } from "@/lib/printing/penandaQty";
import { TEMPLATE, buatStrip } from "@/lib/printing/strip";
import { rencanaHalaman } from "@/lib/printing/tataLetak";
import { GRUP_TIDAK_TERBACA, grupQty, namaGrup, urutkanHalaman, type Urutan } from "@/lib/printing/urutanCetak";
import { bangunPdf, tataLetakAwal, type Kotak } from "@/lib/printing/watermark";

/** Piksel per mm di canvas editor. */
const PX = 3.4;
/** Margin canvas editor (px CSS). */
const MG = 20;
/** Lebar render pemindaian halaman (px). */
const LEBAR_PINDAI = 300;
/** Lebar thumbnail (px). */
const LEBAR_THUMB = 150;

type Berkas = {
  id: number;
  nama: string;
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
  tugas: PDFDocumentLoadingTask;
  jumlahHalaman: number;
  skip: Set<number>;
  thumbs: (HTMLCanvasElement | null)[];
  blank: boolean[];
  info: InfoResi[];
  dim: { w: number; h: number }[];
  qty: { rows: BarisQty[]; total: number }[];
  nomor: NomorLabel;
  dipindai: boolean;
};

type Seret = { kotak: Kotak; mode: "geser" | "ubah"; awal: { x: number; y: number }; kotakAwal: Kotak };

/** Mode penandaan qty: kunci Select → nilai modul. */
const MODE_QTY: Record<string, ModeQty> = {
  lebih: "lebih",
  multi: "multi",
  semua: "semua",
  mati: "mati",
};

/** Gaya penanda: kunci Select → nilai modul. */
const GAYA_QTY: Record<string, GayaQty> = {
  kotak: "kotak",
  lingkar: "lingkar",
  persegi: "persegi",
  centang: "centang",
};

const URUTAN: Record<string, Urutan> = {
  off: "off",
  sku: "sku",
  nama: "nama",
  qty: "qty",
  qtyNama: "qtyNama",
};

function snap(k: Kotak, lebar: number, tinggi: number): void {
  const pasangan: [keyof Kotak, keyof Kotak, number][] = [["x", "w", lebar], ["y", "h", tinggi]];
  for (const [a, b, L] of pasangan) {
    for (const v of [0, L - k[b], (L - k[b]) / 2]) {
      if (Math.abs(k[a] - v) < 1.5) { k[a] = v; break; }
    }
  }
}

export function PrintingStudio() {
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
  const [deteksi, setDeteksi] = useState(true);
  const [modePecah, setModePecah] = useState<"auto" | "kecil">("auto");
  const [ambangPecah, setAmbangPecah] = useState(0.85);

  const [modeQty, setModeQty] = useState<ModeQty>("lebih");
  const [gayaQty, setGayaQty] = useState<GayaQty>("kotak");

  const [urutan, setUrutan] = useState<Urutan>("off");
  const [hanyaKosong, setHanyaKosong] = useState(false);
  const [hanyaQty, setHanyaQty] = useState(false);

  const [S, setS] = useState<Kotak>({ x: 0, y: 130, w: 100, h: 20 });
  const [R, setR] = useState<Kotak>({ x: 0, y: 0, w: 100, h: 130 });
  const [manual, setManual] = useState(false);
  const seret = useRef<Seret | null>(null);

  const [resiCv, setResiCv] = useState<HTMLCanvasElement | null>(null);
  const [resiKey, setResiKey] = useState("");
  const [srcW, setSrcW] = useState(298);
  const [srcH, setSrcH] = useState(420);
  const [stripCv, setStripCv] = useState<HTMLCanvasElement | null>(null);
  const [pesan, setPesan] = useState("Pilih PDF resi untuk melihat pratinjau.");
  const [memuatStrip, setMemuatStrip] = useState(false);

  const kanvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useRef(0);
  const scan = useRef({ sedang: false });

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

  const totalHalaman = useMemo(() => berkas.reduce((a, b) => a + b.jumlahHalaman, 0), [berkas]);
  const jumlahDilewati = useMemo(() => berkas.reduce((a, b) => a + b.skip.size, 0), [berkas]);
  const totalKosong = useMemo(() => berkas.reduce((a, b) => a + b.blank.filter(Boolean).length, 0), [berkas]);

  /** Daftar halaman yang akan dicetak, sudah diurutkan. */
  const daftarCetak = useMemo(() => {
    const semua = berkas.flatMap((b) =>
      Array.from({ length: b.jumlahHalaman }, (_, i) => ({
        n: b.id * 10000 + i,
        b,
        i,
        qty: b.qty[i] ?? { rows: [], total: 0 },
      }))
    );
    return urutkanHalaman(semua, urutan);
  }, [berkas, urutan]);

  const rencanaUntuk = useCallback(
    (info: InfoResi | undefined, dim: { w: number; h: number } | undefined) =>
      rencanaHalaman(deteksi ? info ?? null : null, dim?.w ?? 283.46, dim?.h ?? 425.2, {
        tinggiMm,
        cropMm: crop,
        resi: R,
        mode: modePecah,
        ambangPecah,
      }),
    [deteksi, tinggiMm, crop, R, modePecah, ambangPecah]
  );

  /** Jumlah lembar cetak (resi panjang menambah lembar). */
  const ringkasanCetak = useMemo(() => {
    let dicetak = 0;
    let pecah = 0;
    let tanpaQty = 0;
    let qtyLebih = 0;
    for (const b of berkas) {
      for (let i = 0; i < b.jumlahHalaman; i++) {
        if (b.skip.has(i)) continue;
        dicetak += 1;
        const r = rencanaUntuk(b.info[i], b.dim[i]);
        if (r.pecah) pecah += 1;
        const q = b.qty[i];
        if (!q || q.rows.length === 0) tanpaQty += 1;
        else if (q.rows.some((x) => x.v > 1)) qtyLebih += 1;
      }
    }
    return { dicetak, pecah, tanpaQty, qtyLebih, lembar: dicetak + pecah };
  }, [berkas, rencanaUntuk]);

  const rasioResi = useCallback(
    () => srcW / Math.max(1, srcH - Math.min(crop * (72 / 25.4), srcH - 40)),
    [srcW, srcH, crop]
  );

  const aturUlang = useCallback(() => {
    const t = tataLetakAwal(tinggiMm, tpl.tinggiMm, rasioResi());
    setS(t.strip);
    setR(t.resi);
    setManual(false);
  }, [tinggiMm, tpl.tinggiMm, rasioResi]);

  useEffect(() => {
    if (!manual) aturUlang();
  }, [manual, aturUlang]);

  // Tutup semua dokumen pdf.js saat halaman ditinggalkan.
  const berkasRef = useRef<Berkas[]>([]);
  berkasRef.current = berkas;
  useEffect(() => {
    return () => {
      for (const b of berkasRef.current) void b.tugas.destroy();
    };
  }, []);

  const renderStrip = useCallback(async () => {
    setMemuatStrip(true);
    try {
      const pdfjs = await muatPdfJs();
      const bytes = await buatStrip(tpl, { lebarMm: S.w, tinggiMm: S.h }, { t1: teks1 || " ", t2: teks2 || " ", t3: teks3 }, logo);
      const c = await denganDokumen(pdfjs, bytes, async (doc) => {
        const { canvas } = await renderHalaman(pdfjs, doc, 0, Math.round(S.w * 8));
        return canvas;
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
    const d = daftarCetak.find((x) => !x.b.skip.has(x.i));
    return d ?? null;
  }, [daftarCetak]);

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
        const pdfjs = await muatPdfJs();
        const { canvas, width, height } = await renderHalaman(pdfjs, t.b.doc, t.i, 700);
        if (batal) return;
        setResiCv(canvas);
        setResiKey(key);
        setSrcW(width);
        setSrcH(height);
        setPesan("Pratinjau menampilkan halaman pertama yang akan dicetak.");
      } catch (e) {
        if (!batal) setPesan(`Gagal membaca halaman: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => { batal = true; };
  }, [halamanPertama, resiKey]);

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
      const t = halamanPertama();
      const pl = rencanaUntuk(t?.b.info[t.i], t?.b.dim[t.i] ? { w: t.b.dim[t.i].w, h: t.b.dim[t.i].h } : undefined);
      const q = pl.parts[0];
      const W = resiCv.width;
      const Hc = resiCv.height;
      ctx.drawImage(
        resiCv,
        (q.x0 / srcW) * W,
        (q.y0 / srcH) * Hc,
        ((q.x1 - q.x0) / srcW) * W,
        ((q.y1 - q.y0) / srcH) * Hc,
        q.dx * P,
        q.dy * P,
        q.dw * P,
        q.dh * P
      );
      const tanda = penandaQty(t?.b.qty[t.i]?.rows, srcW, srcH, pl, modeQty, gayaQty);
      for (const m of tanda) {
        if (m.pg !== 0) continue;
        if (gayaQty === "kotak") {
          const teks = m.teks;
          if (!teks) continue;
          ctx.font = `bold ${teks.ts * P}px Arial,Helvetica,sans-serif`;
          const tw = ctx.measureText(teks.txt).width / P;
          const w = tw + 0.55 * teks.ts;
          const h = 1.15 * teks.ts;
          const x = m.cx - w / 2;
          const y = m.cy - h / 2;
          ctx.fillStyle = teks.isi ? "#000" : "#fff";
          ctx.fillRect(x * P, y * P, w * P, h * P);
          ctx.strokeStyle = "#000";
          ctx.lineWidth = Math.max(1, 0.25 * P);
          ctx.setLineDash([]);
          ctx.strokeRect(x * P, y * P, w * P, h * P);
          ctx.fillStyle = teks.isi ? "#fff" : "#000";
          ctx.fillText(teks.txt, (m.cx - tw / 2) * P, (m.cy + 0.36 * teks.ts) * P);
          continue;
        }
        // Bentuk: lingkaran / persegi / centang di sekitar angka asli.
        ctx.save();
        ctx.strokeStyle = "#000";
        ctx.setLineDash([]);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(1, Math.max(0.25, 0.13 * m.fs) * (m.tipis ? 0.55 : 1) * P);
        ctx.beginPath();
        if (gayaQty === "lingkar") {
          const ry = 0.78 * m.fs;
          const rx = Math.max(ry, m.nw / 2 + 0.5 * m.fs);
          ctx.ellipse(m.cx * P, m.cy * P, rx * P, ry * P, 0, 0, Math.PI * 2);
        } else if (gayaQty === "persegi") {
          const bh = 1.45 * m.fs;
          const bw = Math.max(bh, m.nw + 0.8 * m.fs);
          ctx.rect((m.cx - bw / 2) * P, (m.cy - bh / 2) * P, bw * P, bh * P);
        } else {
          const s = 0.95 * m.fs;
          const x0 = m.cx - m.nw / 2 - 0.5 * m.fs - s;
          ctx.moveTo(x0 * P, m.cy * P);
          ctx.lineTo((x0 + 0.4 * s) * P, (m.cy + 0.45 * m.fs) * P);
          ctx.lineTo((x0 + s) * P, (m.cy - 0.5 * m.fs) * P);
        }
        ctx.stroke();
        ctx.restore();
      }
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
  }, [tinggiMm, resiCv, stripCv, R, S, srcW, srcH, rencanaUntuk, halamanPertama, modeQty, gayaQty]);

  useEffect(() => { gambar(); }, [gambar]);

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
            info: [],
            dim: [],
            qty: [],
            nomor: bacaNomorDariHalaman(teksHalaman),
            dipindai: false,
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

  /** Pindai halaman: thumbnail + kotak resi + tabel qty + deteksi kosong. */
  useEffect(() => {
    if (scan.current.sedang) return;
    const target = berkas.find((b) => !b.dipindai);
    if (!target) return;
    scan.current.sedang = true;
    void (async () => {
      try {
        const pdfjs = await muatPdfJs();
        target.dipindai = true;
        const thumbs = [...target.thumbs];
        const blank = [...target.blank];
        const info = [...target.info];
        const dim = [...target.dim];
        const qty = [...target.qty];
        const skip = new Set(target.skip);
        for (let i = 0; i < target.jumlahHalaman; i++) {
          const { canvas, width, height } = await renderHalaman(pdfjs, target.doc, i, LEBAR_PINDAI);
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          const piksel = ctx?.getImageData(0, 0, canvas.width, canvas.height);
          const hasil = piksel
            ? deteksiKotakTinta(piksel.data, canvas.width, canvas.height)
            : { info: INFO_PENUH };

          const t = document.createElement("canvas");
          t.width = LEBAR_THUMB;
          t.height = Math.max(1, Math.round(canvas.height * LEBAR_THUMB / canvas.width));
          const tctx = t.getContext("2d", { willReadFrequently: true });
          tctx?.drawImage(canvas, 0, 0, t.width, t.height);
          // Tinta diukur pada 150 px — lebar yang dipakai saat ambang dikalibrasi. Pada 300 px
          // teks tipis terbaca kosong (regresi: halaman "Penerima: Budi" ikut dilewati).
          const tinta = tctx ? fraksiTinta(tctx.getImageData(0, 0, t.width, t.height).data, t.width, t.height) : 1;
          const kosong = tinta < AMBANG_KOSONG;

          const page = await target.doc.getPage(i + 1);
          const isi = await page.getTextContent();
          const items = isi.items.flatMap((it) =>
            "str" in it ? [{ str: it.str, transform: it.transform, width: it.width }] : []
          );

          thumbs[i] = t;
          blank[i] = kosong;
          info[i] = hasil.info;
          dim[i] = { w: width, h: height };
          qty[i] = bacaQtyHalaman(items, page.rotate);
          if (kosong) skip.add(i);

          // Perbarui bertahap supaya halaman 50 tidak membekukan tab.
          if ((i + 1) % 4 === 0 || i + 1 === target.jumlahHalaman) {
            setBerkas((s) => s.map((b) => (b.id === target.id
              ? { ...b, thumbs: [...thumbs], blank: [...blank], info: [...info], dim: [...dim], qty: [...qty], skip: new Set(skip), dipindai: true }
              : b)));
            const { promise, resolve } = Promise.withResolvers<void>();
            setTimeout(resolve);
            await promise;
          }
        }
        // Halaman pertama bisa berubah (kosong → dilewati): paksa pratinjau dimuat ulang.
        setResiKey("");
      } catch (e) {
        toast.error(`Gagal memindai ${target.nama}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        scan.current.sedang = false;
      }
    })();
  }, [berkas]);

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

  /** Susun keluaran cetak (dipakai tombol cetak dan pratinjau). */
  const susun = useCallback(
    async (batasHalaman?: number) => {
      const stripBytes = await buatStrip(tpl, { lebarMm: S.w, tinggiMm: S.h }, { t1: teks1 || " ", t2: teks2 || " ", t3: teks3 }, logo);
      // Urutan cetak mengikuti `daftarCetak` GLOBAL, termasuk saat sort mencampur berkas.
      // Karena itu setiap halaman dikirim sebagai sumber tersendiri dengan semua halaman lain
      // `null` — mengelompokkan per berkas akan mengembalikan urutan masukan.
      const urut = daftarCetak.filter((x) => !x.b.skip.has(x.i));
      const sumber = urut.map((x) => ({
        bytes: x.b.bytes,
        halaman: Array.from({ length: x.b.jumlahHalaman }, (_, i) => (i === x.i
          ? { info: deteksi ? x.b.info[i] ?? null : null, qty: x.b.qty[i]?.rows }
          : null)),
      }));
      const hasil = await bangunPdf(sumber, {
        tinggiMm,
        stripBytes,
        strip: S,
        resi: R,
        cropBawahMm: crop,
        modePecah,
        ambangPecah,
        penanda: { mode: modeQty, gaya: gayaQty },
        batasHalaman,
      });
      // Nama berkas per lembar: dipakai UI untuk melabeli gambar cetak (`data-berkas`).
      return { ...hasil, nama: urut.map((x) => x.b.nama) };
    },
    [tpl, S, teks1, teks2, teks3, logo, daftarCetak, deteksi, tinggiMm, R, crop, modePecah, ambangPecah, modeQty, gayaQty]
  );

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
      const pdfjs: PdfJs = await muatPdfJs();
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
      const nama = hasil.nama;
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
          // Jejak urutan: lembar ke-i berasal dari halaman `halaman` berkas `nama[sumber]`.
          const asal = hasil.lembar[i - 1];
          if (asal) {
            img.dataset.berkas = nama[asal.sumber] ?? "";
            img.dataset.halaman = String(asal.halaman + 1);
            img.dataset.lembar = String(asal.pg + 1);
          }
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
      window.setTimeout(bersihkan, 60_000);

      window.print();
      toast.success(`${hasil.halaman} lembar dikirim ke dialog cetak.`);
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
    const tata = tataLetakAwal(tinggiMm, t.tinggiMm, rasioResi());
    setS(tata.strip);
    setR(tata.resi);
    setManual(false);
  }

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
              <CardDescription>Bisa banyak PDF sekaligus. Urutan cetak mengikuti pilihan di bagian 3.</CardDescription>
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
                      <SelectValue>{(v: string | null) => `100 x ${v ?? 150} mm`}</SelectValue>
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

              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={deteksi} onChange={(e) => setDeteksi(e.target.checked)} className="mt-0.5 accent-primary" data-testid="deteksi-posisi" />
                <span>
                  Deteksi posisi resi otomatis
                  <span className="block text-muted-foreground">Setiap halaman dicari batas resinya sendiri, lalu disamakan posisi & lebarnya. Resi tidak akan tertutup strip.</span>
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Resi panjang / multi item
                  <Select value={modePecah} onValueChange={(v) => { if (v === "auto" || v === "kecil") setModePecah(v); }}>
                    <SelectTrigger className="h-9 w-full" data-testid="mode-pecah">
                      <SelectValue>{(v: string | null) => (v === "kecil" ? "Kecilkan jadi 1 lembar" : "Pecah ke lembar 2 (otomatis)")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="auto">Pecah ke lembar 2 (otomatis)</SelectItem>
                        <SelectItem value="kecil">Kecilkan jadi 1 lembar</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Pecah jika mengecil di bawah
                  <Select value={String(ambangPecah)} onValueChange={(v) => { if (typeof v === "string" && v) setAmbangPecah(Number(v)); }}>
                    <SelectTrigger className="h-9 w-full" data-testid="ambang-pecah">
                      <SelectValue>{(v: string | null) => `${Math.round(Number(v ?? 0.85) * 100)}%`}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="0.95">95%</SelectItem>
                        <SelectItem value="0.9">90%</SelectItem>
                        <SelectItem value="0.85">85%</SelectItem>
                        <SelectItem value="0.8">80%</SelectItem>
                        <SelectItem value="0.7">70%</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Tandai quantity untuk packer
                  <Select
                    value={Object.keys(MODE_QTY).find((k) => MODE_QTY[k] === modeQty) ?? "lebih"}
                    onValueChange={(v) => { if (typeof v === "string" && MODE_QTY[v]) setModeQty(MODE_QTY[v]); }}
                  >
                    <SelectTrigger className="h-9 w-full" data-testid="mode-qty">
                      <SelectValue>{(v: string | null) => ({
                        lebih: "Hanya qty lebih dari 1",
                        multi: "Qty > 1 + semua baris multi-item",
                        semua: "Semua baris qty (termasuk 1)",
                        mati: "Mati",
                      }[v ?? "lebih"] ?? "Hanya qty lebih dari 1")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="lebih">Hanya qty lebih dari 1</SelectItem>
                        <SelectItem value="multi">Qty &gt; 1 + semua baris multi-item</SelectItem>
                        <SelectItem value="semua">Semua baris qty (termasuk 1)</SelectItem>
                        <SelectItem value="mati">Mati</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Gaya penanda quantity
                  <Select
                    value={Object.keys(GAYA_QTY).find((k) => GAYA_QTY[k] === gayaQty) ?? "kotak"}
                    onValueChange={(v) => { if (typeof v === "string" && GAYA_QTY[v]) setGayaQty(GAYA_QTY[v]); }}
                  >
                    <SelectTrigger className="h-9 w-full" data-testid="gaya-qty">
                      <SelectValue>{(v: string | null) => ({
                        kotak: "Kotak hitam ×N (menimpa angka)",
                        lingkar: "Lingkaran pada N",
                        persegi: "Kotak pada N",
                        centang: "Centang (✓) sebelum N",
                      }[v ?? "kotak"] ?? "Kotak hitam ×N")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="kotak">Kotak hitam ×N (menimpa angka)</SelectItem>
                        <SelectItem value="lingkar">Lingkaran pada N</SelectItem>
                        <SelectItem value="persegi">Kotak pada N</SelectItem>
                        <SelectItem value="centang">Centang (✓) sebelum N</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
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

        {/* ── Halaman & cetak ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Halaman & cetak</CardTitle>
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
              <Button size="sm" variant="outline" onClick={() => setHanyaQty((v) => !v)} data-testid="hanya-qty">
                {hanyaQty ? "Tampilkan semua" : "Hanya tampilkan qty > 1"}
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

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Urutan cetak (sort bertahap)
              <Select
                value={Object.keys(URUTAN).find((k) => URUTAN[k] === urutan) ?? "off"}
                onValueChange={(v) => { if (typeof v === "string" && URUTAN[v]) setUrutan(URUTAN[v]); }}
              >
                <SelectTrigger className="h-9 w-full md:w-96" data-testid="urutan-cetak">
                  <SelectValue>{(v: string | null) => ({
                    off: "Sesuai urutan file & halaman (tanpa sort)",
                    sku: "1. SKU → Nama Produk → Variasi",
                    nama: "2. Nama Produk → Variasi",
                    qty: "3. Qty 1 dulu → 2 → … → multi item (SKU → nama → variasi)",
                    qtyNama: "4. Qty 1 dulu → 2 → … → multi item (nama → variasi)",
                  }[v ?? "off"] ?? "Sesuai urutan file & halaman")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="off">Sesuai urutan file & halaman (tanpa sort)</SelectItem>
                    <SelectItem value="sku">1. SKU → Nama Produk → Variasi</SelectItem>
                    <SelectItem value="nama">2. Nama Produk → Variasi</SelectItem>
                    <SelectItem value="qty">3. Qty 1 dulu → 2 → … → multi item (SKU → nama → variasi)</SelectItem>
                    <SelectItem value="qtyNama">4. Qty 1 dulu → 2 → … → multi item (nama → variasi)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>

            {berkas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada berkas.</p>
            ) : (
              <div className="flex flex-col gap-3" data-testid="daftar-halaman">
                {(() => {
                  let grupTerakhir: number | null = null;
                  const jumlahGrup = new Map<number, number>();
                  for (const x of daftarCetak) {
                    if (x.b.skip.has(x.i)) continue;
                    const g = grupQty(x.qty);
                    jumlahGrup.set(g, (jumlahGrup.get(g) ?? 0) + 1);
                  }
                  const elemen: React.ReactNode[] = [];
                  daftarCetak.forEach((x, urutKe) => {
                    const { b, i } = x;
                    const isBlank = !!b.blank[i];
                    const dilewati = b.skip.has(i);
                    const qtyLebih = !!b.qty[i]?.rows.some((r) => r.v > 1);
                    if (hanyaKosong && !isBlank) return;
                    if (hanyaQty && !qtyLebih) return;
                    const g = grupQty(x.qty);
                    if ((urutan === "qty" || urutan === "qtyNama") && !dilewati && g !== grupTerakhir) {
                      grupTerakhir = g;
                      elemen.push(
                        <p key={`g-${g}-${urutKe}`} className="col-span-full mt-2 border-t border-border pt-1.5 text-[11px] font-semibold text-muted-foreground first:mt-0 first:border-t-0">
                          {namaGrup(g)} ({jumlahGrup.get(g) ?? 0} cetak)
                        </p>
                      );
                    }
                    const pl = rencanaUntuk(b.info[i], b.dim[i]);
                    elemen.push(
                      <button
                        key={`${b.id}-${i}`}
                        type="button"
                        onClick={() => balikHalaman(b, i)}
                        data-testid={`halaman-${i + 1}`}
                        className={`flex flex-col gap-1 rounded border-2 bg-white p-1 text-left ${dilewati ? "border-destructive/60" : isBlank ? "border-amber-500" : qtyLebih ? "border-blue-500" : "border-border"}`}
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
                          {urutan !== "off" ? `#${urutKe + 1} · F${berkas.indexOf(b) + 1} · ` : ""}Hlm {i + 1}
                          {isBlank ? " · kosong" : ""}
                          {dilewati ? " · lewati" : ""}
                          {b.qty[i]?.total ? ` · qty ${b.qty[i].total}` : ""}
                          {!dilewati && pl.pecah ? " · 2 lembar" : ""}
                        </span>
                        {b.qty[i]?.rows.length ? (
                          <span className="block truncate text-[10px] text-muted-foreground" title={b.qty[i].rows.map((r) => [r.sku, r.name, r.vari, `x${r.v}`].filter(Boolean).join(" | ")).join("\n")}>
                            {b.qty[i].rows.map((r) => [r.sku, r.vari].filter(Boolean).join(" ") + (r.v > 1 ? ` x${r.v}` : "")).filter(Boolean).join(" + ") || "-"}
                          </span>
                        ) : null}
                      </button>
                    );
                  });
                  return (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                      {elemen}
                    </div>
                  );
                })()}
              </div>
            )}

            <p className="text-xs text-muted-foreground" data-testid="jumlah-cetak">
              {berkas.length === 0
                ? "Belum ada berkas."
                : `Total ${totalHalaman} halaman: ${ringkasanCetak.dicetak} dicetak, ${jumlahDilewati} dilewati (${totalKosong} terdeteksi kosong).` +
                  (ringkasanCetak.pecah ? ` ${ringkasanCetak.pecah} resi panjang dipecah jadi 2 lembar, total ${ringkasanCetak.lembar} lembar cetak.` : "") +
                  (ringkasanCetak.qtyLebih ? ` ${ringkasanCetak.qtyLebih} resi dengan qty lebih dari 1 (ditandai).` : "") +
                  (ringkasanCetak.tanpaQty ? ` ${ringkasanCetak.tanpaQty} halaman tabel Qty-nya tidak terbaca, tidak ditandai.` : "")}
            </p>

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <Button onClick={() => void cetak()} disabled={sibuk || ringkasanCetak.dicetak === 0} data-testid="tombol-cetak">
                {sibuk ? <Spinner data-icon="inline-start" /> : <Printer className="size-4" aria-hidden />}
                {ringkasanCetak.dicetak > 0
                  ? (ringkasanCetak.pecah ? `Cetak ${ringkasanCetak.lembar} lembar` : `Cetak ${ringkasanCetak.dicetak} resi`)
                  : "Cetak"}
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
