"use client";

// app/analisa/page.tsx — Analisa Produk (pengganti halaman Kata Kunci yang dihapus).
//
// Prinsip halaman ini: ANGKA SELALU DARI SERVER, tidak pernah dihitung di klien.
// Server memakai lib/analisa/hitung.ts yang sudah diuji, sehingga angka yang terlihat
// di sini bisa diaudit. Halaman hanya menampilkan.
//
// Analisa cepat langsung tampil tanpa tombol dan tanpa AI — angka benar harus selalu
// bisa didapat tanpa menunggu model dan tanpa biaya token.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChartNoAxesCombined, ChevronRight, Info, Lightbulb, Megaphone, SlidersHorizontal, Sparkles, TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { AnalisaPetaSku } from "@/components/dashboard/analisa-peta-sku";
import { AnalisaEstimasiIklan } from "@/components/dashboard/analisa-estimasi-iklan";
import { AnalisaRingkasan } from "@/components/dashboard/analisa-ringkasan";
import { AnalisaDetailProduk } from "@/components/dashboard/analisa-detail-produk";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalisaSettingAi } from "@/components/dashboard/analisa-setting-ai";
import { WaterfallLaba } from "@/components/dashboard/chart/waterfall-laba";
import { AnalisaKeputusan, BadgeTag } from "@/components/dashboard/analisa-keputusan";
import { AnalisaKpi } from "@/components/dashboard/analisa-kpi";
import { ParetoLaba } from "@/components/dashboard/chart/pareto-laba";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";
import { organikCr } from "@/lib/analisa/hitung";
import { dataFunnel, dataPareto, dataPeluang, dataPenggerak, dataRoas, dataStokKontribusi, dataWaterfall } from "@/lib/analisa/grafik";
import { PenggerakDelta } from "@/components/dashboard/chart/penggerak-delta";
import { FunnelOrganik } from "@/components/dashboard/chart/funnel-organik";
import { PetaPeluang } from "@/components/dashboard/chart/peta-peluang";
import { RoasVsImpas } from "@/components/dashboard/chart/roas-vs-impas";
import { StokKontribusi } from "@/components/dashboard/chart/stok-kontribusi";
import { LABEL_TAG } from "@/lib/analisa/tag";
import {
  NYATA_TAMPIL, ringkasGagal, saranGagal, type RingkasanGagal,
} from "@/lib/analisa/ringkas-gagal";
import type { BarisSku, KeputusanIklan, RingkasanAnalisa, Temuan } from "@/lib/analisa/tipe";
import type { Aksi, TujuanTab } from "@/lib/analisa/aksi";
import type { AngkaKpi, HasilKpi } from "@/lib/analisa/kpi";

// ── Bentuk data dari server (app/api/analisa) ──
// Temuan/BarisSku/Ringkasan WAJIB diimpor, bukan dideklarasikan ulang di sini: tipe lokal
// yang mirip akan lepas sinkron saat kolom server bertambah, dan kolom baru itu hilang
// tanpa satu pun error. Sudah pernah terjadi (dilihat/klik/ctr/cr/roasAktual).
type Hasil = {
  ok: boolean;
  error?: string;
  ringkasan: RingkasanAnalisa;
  temuan: Temuan[];
  baris: BarisSku[];
  kurang: string[];
  jmlSnapshot: number;
  tanggalTersedia: string[];
  ambangMarginTipis: number;
  /** Total biaya iklan per SKU. null = belum diimpor (BUKAN nol). */
  biayaIklan: number | null;
  /** Omzet yang diatribusikan ke iklan. null = data iklan tidak ada. */
  omzetIklan: number | null;
  /** Biaya iklan grup/GMV Max: tidak bisa dilekatkan ke SKU, tetapi tetap uang keluar. */
  biayaIklanTakTerpetakan: number | null;
  iklanTakTerpetakan: { nama: string; biaya: number }[];
  /** Snapshot terdekat sebelum tanggal ini, untuk delta. null = belum ada pembanding. */
  pembanding: {
    tanggal: string;
    /** Rincian SKU pembanding — dasar grafik penggerak delta. */
    baris: { sku: string; nama: string | null; unit: number; hppSatuan: number; hargaJual: number; marginSatuan: number; marginPersen: number; kontribusi: number }[];
    angka: AngkaKpi;
  } | null;
  /** Rentang laporan iklan yang terakhir diimpor. null = belum ada impor berperiode. */
  periodeIklan: { dari: string; sampai: string } | null;
  /** Peringatan bila periode iklan ≠ jendela produk. null = sebanding. */
  peringatanPeriodeIklan: string | null;
  /** true = periode memuat hari yang cakupannya tidak utuh. null = belum dinilai. */
  parsial: boolean | null;
  aksi: Aksi[];
  alasanTanpaAksi: string | null;
  kpi: HasilKpi;
};

type SaranIklan = {
  ok: boolean;
  error?: string;
  aman: BarisSku[];
  jangan: BarisSku[];
  jumlahAman: number;
  jumlahJangan: number;
  adaBiayaIklan: boolean;
  keterbatasan: string;
};

type Preset = { id: number; nama: string };

// ── Rantai model dari GET /api/analisa?aksi=model-analisa ──
// Dipakai untuk memberi tahu user model APA yang akan berjalan SEBELUM tombol ditekan.
// Repo ini tidak menyimpan harga model, jadi halaman ini TIDAK menebak "mahal/murah":
// satu-satunya hal yang bisa dipastikan adalah model mana yang benar-benar akan dipakai.
type ModelRantai = { provider: string; modelDipilih: string | null; siap: boolean };

/** Warna per tingkat keparahan. Dipakai untuk garis tepi kartu temuan. */
const GAYA_KEPARAHAN: Record<Temuan["keparahan"], { tepi: string; label: string; variasi: "destructive" | "secondary" | "outline" }> = {
  kritis: { tepi: "border-l-4 border-l-red-500", label: "Perlu tindakan segera", variasi: "destructive" },
  peringatan: { tepi: "border-l-4 border-l-amber-500", label: "Perlu diperhatikan", variasi: "secondary" },
  catatan: { tepi: "border-l-4 border-l-sky-500", label: "Catatan", variasi: "outline" },
};

/** Format angka temuan sesuai satuannya. */
function angkaTemuan(t: Temuan): string {
  if (t.angka.satuan === "rupiah") return formatRupiah(Math.abs(t.angka.nilai));
  if (t.angka.satuan === "persen") return `${t.angka.nilai}%`;
  if (t.angka.satuan === "rasio") return `${t.angka.nilai}×`;
  return formatAngka(t.angka.nilai);
}

/**
 * Metrik iklan null → "—", BUKAN 0.
 * Bedanya penting: 0 = terukur nol (mis. 0 klik dari 5.000 tayangan), null = belum ada
 * datanya sama sekali. Menampilkan 0 untuk null membuat pembaca menyimpulkan hal yang
 * tidak pernah terukur.
 */
function metrik(nilai: number | null, satuan: "" | "%" | "×" = ""): string {
  if (nilai === null) return "—";
  return satuan === "×" ? `${nilai}×` : `${nilai}${satuan}`;
}

/** Label ringkas tiap keputusan iklan. Dipakai kolom tabel dan pengelompokan tab iklan. */
const LABEL_KEPUTUSAN: Record<KeputusanIklan, string> = {
  naikkan: "Naikkan",
  hentikan: "Hentikan",
  tahan: "Tahan",
  belum_cukup_data: "Belum cukup data",
};

/** Warna label keputusan; selaras dengan artinya (hijau = aman, merah = rugi). */
const KELAS_KEPUTUSAN: Record<KeputusanIklan, string> = {
  naikkan: "text-emerald-700 dark:text-emerald-400",
  hentikan: "text-red-700 dark:text-red-400",
  tahan: "text-amber-700 dark:text-amber-400",
  belum_cukup_data: "text-muted-foreground",
};

/** Urutan tampil kelompok keputusan: yang butuh tindakan lebih dulu. */
const URUTAN_KEPUTUSAN: KeputusanIklan[] = ["hentikan", "naikkan", "tahan", "belum_cukup_data"];

export default function HalamanAnalisa() {
  return (
    <ButuhAkses href="/analisa">
      <Analisa />
    </ButuhAkses>
  );
}

function Analisa() {
  const [preset, setPreset] = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState<number>(0);
  const [tanggal, setTanggal] = useState<string>("");
  const [tanggalAda, setTanggalAda] = useState<string[]>([]);
  const [tanggalPerPreset, setTanggalPerPreset] = useState<Record<string, string[]>>({});
  const [hasil, setHasil] = useState<Hasil | null>(null);
  // Tab dikendalikan state supaya panel Keputusan bisa memindahkan pembaca ke tab yang
  // memuat buktinya. Tanpa ini tombol "Lihat detail" tidak melakukan apa pun.
  const [tab, setTab] = useState("ringkasan");
  /** Sub-tab di dalam tab Produk. "Lihat detail" dari panel bisa mendarat tepat di sini. */
  const [subTab, setSubTab] = useState("temuan");
  const [iklan, setIklan] = useState<SaranIklan | null>(null);
  const [mendalam, setMendalam] = useState<{ narasi: string; model: string; reasoning: string; bahan?: string } | null>(null);
  /** Kegagalan memuat saran iklan. Tanpa state ini kartu tertahan di "Memuat saran iklan…"
   *  selamanya saat `/api/preset` atau endpoint saran gagal. */
  const [galatIklan, setGalatIklan] = useState<string | null>(null);
  /** Kegagalan analisa mendalam + rincian percobaan; disimpan sebagai state karena daftarnya
   *  panjang dan tidak terbaca di dalam toast. Toast hanya menunjukkan sebab utamanya. */
  const [mendalamGagal, setMendalamGagal] = useState<{ pesan: string; ringkas: RingkasanGagal } | null>(null);
  const [memuatMendalam, setMemuatMendalam] = useState(false);
  const [memuat, setMemuat] = useState(true);
  const [memuatIklan, setMemuatIklan] = useState(false);
  const [bukaSetting, setBukaSetting] = useState(false);
  /** Rantai model yang AKAN dipakai analisa mendalam. `null` = belum termuat. */
  const [modelRantai, setModelRantai] = useState<ModelRantai[] | null>(null);
  const [siapTotal, setSiapTotal] = useState(true);
  const [memuatModel, setMemuatModel] = useState(true);
  /** Model yang benar-benar akan dipakai. Menjadi SATU sumber untuk kartu DAN tombol,
   *  supaya peringatan dan keadaan tombol tidak pernah saling bertentangan. */
  const modelTerpakai = (modelRantai ?? []).filter((m) => m.siap && m.modelDipilih);
  const belumSiap = modelRantai !== null && (!siapTotal || modelTerpakai.length === 0);

  // Muat daftar preset + tanggal snapshot yang tersedia.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/analisa?aksi=preset", { credentials: "include" });
        const d = (await res.json().catch(() => null)) as {
          ok?: boolean; preset?: Preset[]; tanggal?: string[]; presetAwal?: number;
          tanggalPerPreset?: Record<string, string[]>; error?: string;
        } | null;
        if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat (${res.status}).`);
        setPreset(d.preset ?? []);
        setTanggalPerPreset(d.tanggalPerPreset ?? {});
        // Preset awal dipilih SERVER: yang benar-benar punya data. Kalau halaman memilih
        // preset pertama sendiri, dan preset itu kosong, user melihat halaman kosong
        // padahal data ada di preset lain.
        const idAwal = d.presetAwal ?? 0;
        setPresetId(idAwal);
        setTanggal((d.tanggalPerPreset?.[String(idAwal)] ?? d.tanggal ?? [])[0] ?? "");
      } catch (e) {
        tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat daftar preset.");
        setMemuat(false);
      }
    })();
  }, []);

  // Ganti preset: tanggal ikut berganti ke yang tersedia di preset itu, karena
  // snapshot per preset berbeda-beda.
  useEffect(() => {
    if (!presetId) return;
    const ada = tanggalPerPreset[String(presetId)];
    if (!ada) return;
    if (!ada.includes(tanggal)) setTanggal(ada[0] ?? "");
  }, [presetId, tanggalPerPreset, tanggal]);

  // Muat rantai model yang akan dipakai. Diulang saat dialog Pengaturan AI ditutup: admin
  // atau user bisa mengubah pilihan model global di sana, dan tanpa muat ulang halaman akan
  // terus menyebut model lama — justru informasi yang menyesatkan sebelum menekan tombol.
  useEffect(() => {
    if (bukaSetting) return; // jangan ambil saat dialog terbuka; ambil setelah ditutup
    let batal = false;
    void (async () => {
      setMemuatModel(true);
      try {
        const res = await fetch("/api/analisa?aksi=model-analisa", { credentials: "include" });
        const d = (await res.json().catch(() => null)) as {
          ok?: boolean; chain?: ModelRantai[]; siapTotal?: boolean; error?: string;
        } | null;
        if (batal) return;
        if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat daftar model (${res.status}).`);
        setModelRantai(d.chain ?? []);
        setSiapTotal(d.siapTotal === true);
      } catch (e) {
        if (batal) return;
        // Gagal memuat BUKAN alasan mengunci tombol: ketidakmampuan membaca daftar model
        // tidak sama dengan "tidak ada model". Tombol dibiarkan aktif; hanya peringatannya
        // yang hilang, bukan aksesnya.
        setModelRantai(null);
        tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat daftar model.");
      } finally {
        if (!batal) setMemuatModel(false);
      }
    })();
    return () => { batal = true; };
  }, [bukaSetting]);

  const muatAnalisa = useCallback(async (pid: number, tgl: string) => {
    if (!pid || !tgl) {
      // KENAPA memuat dimatikan di sini: `memuat` mulai `true`, sedangkan preset yang belum
      // punya snapshot menghasilkan `tgl === ""`. Dulu fungsi ini `return` tanpa mematikan
      // `memuat`, sehingga halaman menampilkan skeleton SELAMANYA dan empty state "Belum ada
      // data" tak pernah tercapai — persis pada preset baru yang datanya memang belum ada.
      setMemuat(false);
      setHasil(null);
      setIklan(null);
      setMendalam(null);
      return;
    }
    setMemuat(true);
    setIklan(null);
    setGalatIklan(null);
    // Narasi lama dibuang: narasi itu milik periode sebelumnya. Menampilkannya bersama
    // tabel periode baru akan membuat pembaca mengira keduanya berbicara hal yang sama.
    setMendalam(null);
    try {
      const res = await fetch(`/api/analisa?aksi=cepat&presetId=${pid}&tanggal=${tgl}`, { credentials: "include" });
      const d = (await res.json().catch(() => null)) as Hasil | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat analisa (${res.status}).`);
      setHasil(d);
      // Hanya perbarui daftar tanggal bila server memang mengirimnya; menimpanya dengan
      // daftar kosong membuat pemilih tanggal hilang tanpa sebab yang terlihat.
      if ((d.tanggalTersedia ?? []).length > 0) {
        setTanggalAda(d.tanggalTersedia);
        setTanggalPerPreset((s) => ({ ...s, [String(pid)]: d.tanggalTersedia }));
      }
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Gagal memuat analisa.");
      setHasil(null);
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muatAnalisa(presetId, tanggal);
  }, [presetId, tanggal, muatAnalisa]);

  // Data waterfall disusun fungsi MURNI, bukan di dalam komponen: komponen hanya menggambar.
  // `hasil` null (memuat/kosong) sengaja tidak digambar — chart kosong tanpa angka lebih
  // membingungkan daripada tidak ada chart sama sekali.
  const waterfall = useMemo(
    () => (hasil ? dataWaterfall(hasil.ringkasan, hasil.biayaIklan ?? null, hasil.biayaIklanTakTerpetakan ?? null) : null),
    [hasil]
  );
  const pareto = useMemo(() => (hasil ? dataPareto(hasil.baris) : null), [hasil]);
  const penggerak = useMemo(
    () => (hasil
      ? dataPenggerak(hasil.baris, hasil.pembanding?.baris.map((r) => ({
          // Bentuk `BarisSku` penuh tidak diperlukan grafik ini; field lain diisi null
          // supaya tipenya jujur (tidak ada angka karangan).
          ...r,
          roasImpas: null, hppMaster: null, hppNaik: 0, stok: null,
          dilihat: null, klik: null, ctr: null, cr: null, biayaIklan: null, roasAktual: null,
          organikDilihat: null, organikKunjungan: null, organikKeranjang: null,
          organikPesanan: null, organikOmzet: null,
        })) ?? null)
      : null),
    [hasil]
  );
  const funnel = useMemo(() => (hasil ? dataFunnel(hasil.baris) : null), [hasil]);
  const peluang = useMemo(
    () => (hasil ? dataPeluang(hasil.baris, new Map(hasil.baris.map((b) => [b.sku, b.tag ?? []]))) : null),
    [hasil]
  );
  const roas = useMemo(() => (hasil ? dataRoas(hasil.baris) : null), [hasil]);
  const stok = useMemo(() => (hasil ? dataStokKontribusi(hasil.baris) : null), [hasil]);

  // Saran iklan dimuat saat tab Iklan DIBUKA. Dulu hanya lewat `onClick` tombol tab,
  // sehingga tab yang dipindahkan secara program (dari panel Keputusan) tampil kosong.
  // Saran iklan dimuat HANYA saat tab dibuka — tidak membebani tampilan awal.
  // `ulang` memaksa muat ulang: tanpa itu tombol "Coba lagi" tidak melakukan apa pun
  // karena `iklan`/`memuatIklan` sudah dianggap selesai.
  const muatIklan = useCallback(async (ulang = false) => {
    if (memuatIklan || !presetId || !tanggal) return;
    if (iklan && !ulang) return;
    setMemuatIklan(true);
    setGalatIklan(null);
    try {
      const res = await fetch(`/api/analisa?aksi=saran-iklan&presetId=${presetId}&tanggal=${tanggal}`, { credentials: "include" });
      const d = (await res.json().catch(() => null)) as SaranIklan | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat saran iklan (${res.status}).`);
      setIklan(d);
    } catch (e) {
      const pesan = e instanceof Error ? e.message : "Gagal memuat saran iklan.";
      // Pesan disimpan, BUKAN hanya di-toast: toast hilang setelah beberapa detik dan
      // kartu kembali tampak "memuat" tanpa sebab.
      setGalatIklan(pesan);
      tampilkanGagalTulis(pesan);
    } finally {
      setMemuatIklan(false);
    }
  }, [memuatIklan, presetId, tanggal, iklan]);

  useEffect(() => {
    if (tab !== "iklan") return;
    void muatIklan();
  }, [tab, muatIklan]);

  /**
   * Analisa mendalam (AI). Sengaja di balik TOMBOL: angka benar sudah tersedia tanpa AI,
   * dan tiap panggilan berbiaya token. Tombol membuat biaya itu keputusan sadar user.
   */
  async function jalankanMendalam() {
    if (memuatMendalam || !presetId || !tanggal) return;
    setMemuatMendalam(true);
    setMendalamGagal(null);
    try {
      const res = await fetch("/api/analisa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        // Hanya periode yang dikirim. Konteks tren dihitung server dari DB: angka kiriman
        // browser tidak boleh masuk prompt sebagai "sudah dihitung sistem".
        body: JSON.stringify({ aksi: "mendalam", presetId, tanggal }),
      });
      const d = (await res.json().catch(() => null)) as {
        ok?: boolean; narasi?: string; model?: string; reasoning?: string; bahan?: string; error?: string;
        upaya?: { provider: string; model: string; error: string }[];
      } | null;
      if (!res.ok || !d?.ok || !d.narasi) {
        // Rincian percobaan TIDAK ditempel ke pesan: rantai 23 model menghasilkan puluhan baris
        // yang isinya sama, dan penyebab sebenarnya tenggelam di dalamnya. Yang naik ke toast
        // hanya sebab utamanya; rincian lengkap dirender sebagai kartu di bawah tombol.
        const ringkas = ringkasGagal(d?.upaya ?? []);
        const rincian = (d?.upaya ?? []).length;
        const utama = ringkas.tanpaKredensial.length
          ? `Tidak ada API key aktif untuk provider: ${ringkas.tanpaKredensial.join(", ")}.`
          : d?.error ?? `Analisa mendalam gagal (${res.status}).`;
        const pesan = `${utama}${rincian > 0 ? ` (${rincian} percobaan) — rincian di bawah tombol Analisa Mendalam.` : ""}`;
        setMendalamGagal({ pesan: utama, ringkas });
        tampilkanGagalTulis(pesan);
        return;
      }
      setMendalam({ narasi: d.narasi, model: d.model ?? "—", reasoning: d.reasoning ?? "—", bahan: d.bahan });
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Analisa mendalam gagal.");
    } finally {
      setMemuatMendalam(false);
    }
  }

  return (
    <>
      <PageHeader
        judul="Analisa Produk"
        deskripsi="Margin, konsentrasi laba, dan saran iklan — dihitung dari data Anda sendiri."
      />

      <div className="flex flex-col gap-4" data-testid="h9-analisa">
        {/* ── Pemilih periode ── */}
        <Card data-testid="kartu-periode">
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="flex min-w-[180px] flex-col gap-1">
              <span className="text-xs text-muted-foreground">Preset toko</span>
              <Select value={String(presetId)} onValueChange={(v) => v !== null && setPresetId(Number(v))}>
                <SelectTrigger className="h-11 w-full md:h-8" data-testid="pilih-preset">
                  <SelectValue>{(v: string | null) => preset.find((p) => String(p.id) === v)?.nama ?? "Pilih preset"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {preset.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.nama}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-[170px] flex-col gap-1">
              <span className="text-xs text-muted-foreground">Tanggal data laba</span>
              <Select value={tanggal} onValueChange={(v) => v !== null && setTanggal(v)}>
                <SelectTrigger className="h-11 w-full md:h-8" data-testid="pilih-tanggal">
                  <SelectValue>{(v: string | null) => v || "Pilih tanggal"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {tanggalAda.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {tanggalAda.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                {tanggalAda.length} periode tersedia — pilih tanggal lain untuk membandingkan.
              </p>
            ) : null}
            <Button
              variant="outline"
              className="h-11 md:h-8"
              onClick={() => setBukaSetting(true)}
              data-testid="buka-setting-ai"
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Pengaturan AI
            </Button>
          </CardContent>
        </Card>

        {/* Setting reasoning/kedalaman/plafon token MILIK USER INI (per akun, bukan global).
            Endpoint-nya terbuka untuk user biasa — semua user boleh atur reasoning-nya sendiri. */}
        <AnalisaSettingAi open={bukaSetting} onOpenChange={setBukaSetting} />

        {memuat ? (
          <Skeleton className="h-64 w-full rounded-xl" data-testid="memuat-analisa" />
        ) : !hasil ? (
          <Empty data-testid="analisa-kosong">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ChartNoAxesCombined /></EmptyMedia>
              <EmptyTitle>Belum ada data untuk dianalisa</EmptyTitle>
              <EmptyDescription>
                {/* Nama preset disebut karena penyebab paling sering bukan "impor gagal",
                    melainkan preset yang dipilih memang belum pernah diimpor. Tanpa nama,
                    user mengira seluruh sistem kosong padahal preset lain punya data. */}
                Preset <span className="font-medium">{preset.find((p) => p.id === presetId)?.nama ?? "ini"}</span>{" "}
                belum punya snapshot laba. Buka halaman Laba, unggah file pesanan Shopee untuk
                preset itu, lalu kembali ke sini.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            {/* Panel keputusan DI ATAS tab: jawaban "apa yang harus kulakukan" tidak boleh
                menunggu pembaca memilih tab dulu. */}
            <AnalisaKeputusan
              aksi={hasil.aksi ?? []}
              alasanKosong={hasil.alasanTanpaAksi}
              biayaIklanTakTerpetakan={hasil.biayaIklanTakTerpetakan}
              iklanTakTerpetakan={hasil.iklanTakTerpetakan ?? []}
              onBukaTab={(t: TujuanTab) => {
                // "temuan" bukan tab tersendiri lagi: ia sub-tab pertama di dalam Produk.
                if (t === "temuan") {
                  setTab("produk");
                  setSubTab("temuan");
                  return;
                }
                // Aksi tingkat SKU mendarat di daftar semua produk — di situlah barisnya.
                if (t === "produk") {
                  setTab("produk");
                  setSubTab("semua");
                  return;
                }
                setTab(t);
              }}
            />

            {/* LIMA tab, bukan enam: Detail Produk, Semua Produk, dan Temuan menjawab
                pertanyaan yang sama ("produk mana dan kenapa") dan dulu memaksa pembaca
                menebak di tab mana jawabannya berada. Ketiganya kini satu tab dengan
                sub-tab. Panel Keputusan sengaja TETAP di atas tab — ia jawaban untuk
                "apa yang harus kulakukan", bukan salah satu isi tab. */}
            <TabsList>
              <TabsTrigger value="ringkasan" data-testid="tab-ringkasan">Ringkasan</TabsTrigger>
              <TabsTrigger value="produk" data-testid="tab-produk">Produk</TabsTrigger>
              <TabsTrigger value="iklan" data-testid="tab-iklan">Iklan</TabsTrigger>
              <TabsTrigger value="stok" data-testid="tab-stok">Stok</TabsTrigger>
              <TabsTrigger value="peta" data-testid="tab-peta">Peta SKU</TabsTrigger>
            </TabsList>

            {/* ══ TAB RINGKASAN (default) ══ */}
            {/* Grafik & klasifikasi produk. Semua angka dari aksi=tren; komponen hanya menggambar. */}
            <TabsContent value="ringkasan" className="flex flex-col gap-4">
              {/* Kesimpulan dulu, baru bukti: satu grafik menjawab "ke mana omzet pergi"
                  sebelum pembaca melihat tabel dan tren harian. */}
              {hasil.kpi ? <AnalisaKpi data={hasil.kpi} /> : null}
              {waterfall ? <WaterfallLaba data={waterfall} /> : null}
              {pareto ? <ParetoLaba data={pareto} /> : null}
              {penggerak ? <PenggerakDelta data={penggerak} /> : null}
              {funnel ? <FunnelOrganik data={funnel} /> : null}
              <AnalisaRingkasan presetId={presetId} tanggal={tanggal} />
            </TabsContent>

            {/* ══ TAB PRODUK (Temuan / Semua Produk / Detail) ══ */}
            <TabsContent value="produk" className="flex flex-col gap-4">
              {/* Sub-tab, bukan satu halaman gulir panjang: tabel 200 baris di atas grafik
                  analitik membuat keduanya sulit ditemukan. Urutan sub-tab mengikuti cara
                  membaca: kesimpulan (Temuan) → daftar (Semua Produk) → pendalaman (Detail). */}
              <Tabs value={subTab} onValueChange={setSubTab}>
                <TabsList>
                  <TabsTrigger value="temuan" data-testid="subtab-temuan">Temuan</TabsTrigger>
                  <TabsTrigger value="semua" data-testid="subtab-semua">Semua Produk</TabsTrigger>
                  <TabsTrigger value="detail" data-testid="subtab-detail">Detail Produk</TabsTrigger>
                </TabsList>

                <TabsContent value="detail" className="flex flex-col gap-4">
                  {/* Peta peluang di level toko: pertanyaannya "produk mana yang boros trafik",
                      dan jawabannya butuh SEMUA SKU sekaligus untuk dibandingkan. */}
                  {peluang ? <PetaPeluang data={peluang} /> : null}
                  <AnalisaDetailProduk presetId={presetId} tanggal={tanggal} />
                </TabsContent>

            {/* ══ TAB TEMUAN ══ */}
            <TabsContent value="temuan" className="flex flex-col gap-4">
              {/* Ringkasan angka utama */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="ringkasan">
                <KotakAngka label="Laba" nilai={formatRupiah(hasil.ringkasan.laba)} catatan={`margin ${hasil.ringkasan.marginPersen}%`} />
                <KotakAngka label="Omzet" nilai={formatRupiah(hasil.ringkasan.omzet)} catatan={`${hasil.ringkasan.jmlOrder} pesanan`} />
                <KotakAngka label="Margin rata-rata" nilai={formatRupiah(hasil.ringkasan.marginSatuanRata)} catatan="per unit terjual" />
                <KotakAngka
                  label="10 SKU teratas"
                  nilai={`${hasil.ringkasan.persen10Teratas}%`}
                  catatan={`dari laba · ${hasil.ringkasan.jmlSku} SKU total`}
                />
              </div>

              {/* Data yang tidak ada — disebut, bukan diabaikan */}
              {hasil.kurang.length > 0 ? (
                <Alert data-testid="data-kurang">
                  <Info aria-hidden />
                  <AlertTitle>Analisa ini belum lengkap</AlertTitle>
                  <AlertDescription>
                    {/* Periode + preset disebut di sini karena kekurangan data SELALU milik periode
                        tertentu. Tanpa menyebutnya, pesan terbaca seolah impor gagal, padahal
                        penyebab paling sering adalah periode yang dipilih memang belum punya data. */}
                    <p className="mb-2" data-testid="konteks-kurang">
                      Diperiksa untuk preset{" "}
                      <span className="font-medium">
                        {preset.find((p) => p.id === hasil.ringkasan.presetId)?.nama ?? `#${hasil.ringkasan.presetId}`}
                      </span>{" "}
                      pada periode <span className="font-medium">{hasil.ringkasan.periode || tanggal || "-"}</span> —
                      data iklan & performa dihitung untuk rentang 7 hari yang berakhir di tanggal itu.
                    </p>
                    <ul className="list-disc pl-4">
                      {hasil.kurang.map((k, i) => <li key={i}>{k}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {/* ── Analisa Mendalam (AI) — di balik tombol ── */}
              <Card data-testid="kartu-mendalam">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="size-4" aria-hidden />
                    Analisa Mendalam
                  </CardTitle>
                  <CardDescription>
                    Menyusun temuan di atas menjadi bahasa awam plus prioritas tindakan. Angka tetap
                    dari perhitungan di halaman ini — AI hanya menafsirkan, tidak menghitung ulang.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <KartuModel
                    rantai={modelRantai}
                    terpakai={modelTerpakai}
                    belumSiap={belumSiap}
                    memuat={memuatModel}
                    onBukaSetting={() => setBukaSetting(true)}
                  />

                  <div>
                    <Button
                      className="h-11 md:h-8"
                      disabled={memuatMendalam || belumSiap}
                      onClick={() => void jalankanMendalam()}
                      title={belumSiap ? "Belum ada model default yang dipilih — atur di Pengaturan AI." : undefined}
                      data-testid="tombol-mendalam"
                    >
                      {memuatMendalam ? <Spinner data-icon="inline-start" /> : <Sparkles className="size-4" aria-hidden />}
                      {memuatMendalam ? "Menyusun…" : "Analisa Mendalam"}
                    </Button>
                    {/* Alasan tombol mati ditulis sebagai teks, bukan hanya title=: tooltip tidak
                        terbaca di layar sentuh dan tidak terbaca pembaca layar pada tombol mati. */}
                    {belumSiap ? (
                      <p className="mt-1 text-xs text-destructive" data-testid="alasan-tombol-mati">
                        Tombol dinonaktifkan: belum ada model default yang dipilih (Pengaturan AI).
                      </p>
                    ) : null}
                  </div>

                  {mendalam ? (
                    <div className="rounded-lg border border-border bg-muted/40 p-3" data-testid="narasi-mendalam">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{mendalam.narasi}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {mendalam.model} · reasoning {mendalam.reasoning} · angka dari perhitungan di halaman ini
                      </p>
                      {/* Bahan yang benar-benar dikirim ke model. Ditampilkan supaya angka yang
                          dibaca AI bisa diperiksa, bukan hanya dipercaya. */}
                      {mendalam.bahan ? (
                        <details className="mt-2" data-testid="bahan-ai">
                          <summary className="cursor-pointer text-[11px] text-muted-foreground">
                            Lihat bahan yang dikirim ke AI
                          </summary>
                          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-[11px]">
                            {mendalam.bahan}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ) : null}

                  {mendalamGagal ? <KartuGagalMendalam pesan={mendalamGagal.pesan} ringkas={mendalamGagal.ringkas} /> : null}
                </CardContent>
              </Card>

              {hasil.temuan.length === 0 ? (
                <Card data-testid="tanpa-temuan">
                  <CardContent className="pt-6 text-sm text-muted-foreground">
                    Tidak ada temuan yang perlu ditindaklanjuti pada periode ini. Semua produk bermargin sehat,
                    laba tidak bergantung pada segelintir SKU, dan HPP belum berubah.
                  </CardContent>
                </Card>
              ) : (
                hasil.temuan.map((t) => (
                  <Card key={t.kode} className={GAYA_KEPARAHAN[t.keparahan].tepi} data-testid={`temuan-${t.kode}`}>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={GAYA_KEPARAHAN[t.keparahan].variasi}>
                          {GAYA_KEPARAHAN[t.keparahan].label}
                        </Badge>
                        <CardTitle className="text-base">{t.judul}</CardTitle>
                      </div>
                      <CardDescription>{t.penjelasan}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 p-3">
                        <span className="font-heading text-xl font-semibold tabular-nums" data-testid={`angka-${t.kode}`}>
                          {angkaTemuan(t)}
                        </span>
                        {t.angka.jumlahTerkena > 0 ? (
                          <span className="text-xs text-muted-foreground">{t.angka.jumlahTerkena} SKU terkena</span>
                        ) : null}
                        {t.angka.dariTotal !== undefined && t.angka.dariTotal > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            dari {t.angka.satuan === "rupiah" ? formatRupiah(t.angka.dariTotal) : t.angka.dariTotal}
                          </span>
                        ) : null}
                      </div>

                      {t.contohSku.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[110px]">SKU</TableHead>
                              <TableHead>Produk</TableHead>
                              <TableHead className="text-right">Nilai</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {t.contohSku.map((s) => (
                              <TableRow key={s.sku}>
                                <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                                <TableCell className="max-w-[280px] truncate">{s.nama ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {t.kode === "margin_tipis" ? `${s.nilai}%` : formatRupiah(s.nilai)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : null}

                      {t.dataKurang && t.dataKurang.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Catatan: {t.dataKurang.join(" ")}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            {/* ══ TAB SEMUA PRODUK ══ */}
                <TabsContent value="semua" className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Margin per produk</CardTitle>
                  <CardDescription>
                    Diurut dari kontribusi laba terbesar. ROAS impas = berapa rupiah penjualan yang
                    dibutuhkan untuk setiap Rp 1 iklan agar tidak rugi.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table data-testid="tabel-produk">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">SKU</TableHead>
                          <TableHead>Produk</TableHead>
                          <TableHead className="text-right">Terjual</TableHead>
                          <TableHead className="text-right">HPP</TableHead>
                          <TableHead className="text-right">Harga</TableHead>
                          <TableHead className="text-right">Margin</TableHead>
                          <TableHead className="text-right">%</TableHead>
                          <TableHead className="text-right">Kontribusi</TableHead>
                          <TableHead className="text-right">ROAS impas</TableHead>
                          <TableHead className="text-right">Dilihat</TableHead>
                          <TableHead className="text-right">Klik</TableHead>
                          <TableHead className="text-right">CTR</TableHead>
                          <TableHead className="text-right">CR</TableHead>
                          <TableHead className="text-right">ROAS aktual</TableHead>
                    <TableHead className="text-right">ROAS langsung</TableHead>
                          {/* Dua ROAS: luas (semua penjualan yang tersentuh iklan) dan
                              langsung (hanya yang dibeli dari iklan itu). Selisih keduanya
                              menunjukkan berapa penjualan yang "ikut" tanpa berasal dari iklan. */}
                          <TableHead className="text-right" title="Hanya pembelian yang berasal dari iklan itu sendiri">
                            ROAS<br />langsung
                          </TableHead>
                          {/* Kolom ORGANIK (tanpa iklan) — dari Performa Produk. Sengaja
                              dipisah dari Dilihat/Klik iklan di kiri: dua angka ini menjawab
                              pertanyaan berbeda dan mencampurnya menyesatkan pembaca. */}
                          <TableHead className="text-right">Kunjungan<br />organik</TableHead>
                          <TableHead className="text-right">Pesanan<br />organik</TableHead>
                          <TableHead className="text-right">CR<br />organik</TableHead>
                          <TableHead>Keputusan iklan</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...hasil.baris].sort((a, b) => b.kontribusi - a.kontribusi).map((b) => {
                          const rugi = b.marginSatuan < 0;
                          const tipis = !rugi && b.marginPersen < hasil.ambangMarginTipis;
                          return (
                            <TableRow key={b.sku} className={rugi ? "bg-red-50 dark:bg-red-950/30" : undefined}>
                              <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                              <TableCell className="max-w-[240px]">
                                <span className="block truncate">{b.nama ?? "—"}</span>
                                {/* Tag datang dari server (`tagProduk`), bukan dihitung di
                                    sini: dua tempat yang menyimpulkan sendiri akan berbeda. */}
                                {b.tag && b.tag.length > 0 ? (
                                  <span className="mt-0.5 flex flex-wrap gap-1">
                                    {b.tag.map((t) => (
                                      <BadgeTag key={t} tag={t} label={LABEL_TAG[t]} />
                                    ))}
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatAngka(b.unit)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(b.hppSatuan)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(b.hargaJual)}</TableCell>
                              <TableCell className={`text-right tabular-nums ${rugi ? "text-red-700 font-semibold" : ""}`}>
                                {formatRupiah(b.marginSatuan)}
                              </TableCell>
                              <TableCell className={`text-right tabular-nums ${tipis ? "text-amber-700" : ""}`}>
                                {b.marginPersen}%
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(b.kontribusi)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {b.roasImpas === null ? "—" : b.roasImpas}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{metrik(b.dilihat)}</TableCell>
                              <TableCell className="text-right tabular-nums">{metrik(b.klik)}</TableCell>
                              <TableCell className="text-right tabular-nums">{metrik(b.ctr, "%")}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {metrik(b.cr, "%")}
                                {/* Tanda sumber: CR dari unit snapshot memakai populasi order yang
                                    berbeda dari klik iklan, jadi angkanya cenderung terlalu tinggi.
                                    Ditandai, bukan disembunyikan — CR null tetap "—". */}
                                {b.crSumber === "snapshot" ? (
                                  <span className="ml-0.5 text-amber-700 dark:text-amber-400" title="CR memakai unit snapshot (ekspor iklan tidak memuat pesanan) — cenderung dilebih-lebihkan.">
                                    *
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{metrik(b.roasAktual, "×")}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {metrik(b.roasLangsung ?? null, "×")}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{metrik(b.organikKunjungan)}</TableCell>
                              <TableCell className="text-right tabular-nums">{metrik(b.organikPesanan)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {organikCr(b) === null ? "—" : `${organikCr(b)}%`}
                              </TableCell>
                              {/* Alasan lengkap (berisi angka) ada di title — tabel jadi ringkas
                                  tapi pemeriksaan tetap mungkin tanpa pindah halaman. */}
                              {/* Putusan datang dari server (ambang CTR toko), bukan dihitung
                                  di sini: menghitung ulang dengan ambang bawaan akan membuat
                                  kolom ini berbeda dari panel Keputusan untuk SKU yang sama. */}
                              <TableCell className={`whitespace-nowrap font-medium ${b.keputusanIklan ? KELAS_KEPUTUSAN[b.keputusanIklan.keputusan] : ""}`}>
                                <span title={b.keputusanIklan?.alasan}>
                                  {b.keputusanIklan ? LABEL_KEPUTUSAN[b.keputusanIklan.keputusan] : "—"}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {hasil.baris.some((b) => b.crSumber === "snapshot") ? (
                    <p className="mt-2 text-xs text-muted-foreground" data-testid="catatan-cr-snapshot">
                      * CR bertanda bintang dihitung dari unit snapshot, bukan pesanan iklan: ekspor
                      iklan SKU itu tidak memuat jumlah pesanan, sehingga CR-nya cenderung
                      dilebih-lebihkan. Perlakukan sebagai perkiraan.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* ══ TAB STOK ══ */}
            <TabsContent value="stok" className="flex flex-col gap-4">
              {/* Stok dipisah dari Produk: pertanyaannya beda ("apa yang harus direstok"
                  vs "produk mana yang menguntungkan"), dan datanya datang dari sumber lain
                  (gudang/Kledo, bukan penjualan). */}
              {stok ? <StokKontribusi data={stok} /> : null}
              {stok && stok.titik.length === 0 ? null : (
                <p className="text-xs text-muted-foreground">
                  Hari tersisa dihitung dari stok fisik (gudang non-ONLINE) dibagi unit terjual
                  pada periode ini. Stok marketplace (gudang ONLINE) bergerak lewat input manual
                  admin dan sinkronisasi Kledo, jadi tidak dipakai di sini.
                </p>
              )}
            </TabsContent>

            {/* ══ TAB SARAN IKLAN ══ */}
            <TabsContent value="iklan" className="flex flex-col gap-4">
              {/* Grafik dulu, tabel saran setelahnya: "iklan mana yang rugi" dijawab
                  sebelum daftar panjang. */}
              {roas ? <RoasVsImpas data={roas} /> : null}
              {hasil.peringatanPeriodeIklan ? (
                <Alert data-testid="peringatan-periode-iklan">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>Periode iklan berbeda dari periode produk</AlertTitle>
                  <AlertDescription>{hasil.peringatanPeriodeIklan}</AlertDescription>
                </Alert>
              ) : null}
              {/* Impor iklan DIPINDAH ke /sinkronisasi: satu tempat untuk semua impor.
                  Kartu ini tinggal memberi jalan, bukan menjadi jalur kedua yang bisa
                  menyimpang aturannya. */}
              <Card data-testid="kartu-impor-iklan">
                <CardHeader>
                  <CardTitle className="text-base">Data iklan</CardTitle>
                  <CardDescription>
                    Unggah <b>Laporan Iklan</b> Shopee (CSV) di halaman Sinkronisasi. Tanpa data ini,
                    halaman hanya bisa menghitung titik impas teoretis.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" className="h-11 md:h-8" render={<Link href="/sinkronisasi" />} data-testid="tombol-pilih-iklan">
                    <Megaphone className="size-4" aria-hidden />
                    Buka Sinkronisasi
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Baris iklan dipetakan lewat tab <b>Peta SKU</b>; yang belum dipetakan akan dilewati.
                  </span>
                </CardContent>
              </Card>

              {memuatIklan ? (
                <Skeleton className="h-48 w-full rounded-xl" />
              ) : galatIklan ? (
                <Alert variant="destructive" data-testid="galat-saran-iklan">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>Saran iklan gagal dimuat</AlertTitle>
                  <AlertDescription className="flex flex-col items-start gap-2">
                    <span>{galatIklan}</span>
                    <Button variant="outline" className="h-11 md:h-8" onClick={() => void muatIklan(true)} data-testid="ulang-saran-iklan">
                      Coba lagi
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : !iklan ? (
                // Tidak ada data dan tidak ada error: beri tombol, jangan teks "memuat"
                // yang tidak pernah berubah (tab bisa dibuka sebelum periode siap).
                <Card>
                  <CardContent className="flex flex-col items-start gap-2 pt-6 text-sm text-muted-foreground">
                    <span>Saran iklan belum dimuat untuk periode ini.</span>
                    <Button variant="outline" className="h-11 md:h-8" onClick={() => void muatIklan(true)} data-testid="muat-saran-iklan">
                      Muat saran iklan
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* BATAS KERAS: keterbatasan selalu tampil, tidak boleh disembunyikan */}
                  <Alert data-testid="keterbatasan-iklan">
                    <TriangleAlert aria-hidden />
                    <AlertTitle>Baca sebelum memakai angka ini</AlertTitle>
                    <AlertDescription>{iklan.keterbatasan}</AlertDescription>
                  </Alert>

                  {!iklan.adaBiayaIklan ? (
                    <Alert data-testid="iklan-belum-diimpor">
                      <Info aria-hidden />
                      <AlertTitle>Biaya iklan belum diimpor</AlertTitle>
                      <AlertDescription>
                        Angka di bawah hanya titik impas teoretis dari biaya toko Anda. Tanpa data biaya
                        iklan yang nyata, sistem ini belum bisa menilai apakah iklan yang berjalan
                        menguntungkan atau merugi.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {/* Peringatan berbasis riset: angka iklan marketplace gampang disalahartikan. */}
                  <Alert data-testid="peringatan-metrik-menyesatkan">
                    <TriangleAlert aria-hidden />
                    <AlertTitle>Cara membaca angka iklan ini</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-4">
                        <li>CTR tinggi tanpa pesanan = masalah di halaman produk, bukan iklannya.</li>
                        <li>ROAS tinggi dari sedikit pesanan bisa berarti anggaran terlalu kecil.</li>
                        <li>
                          Angka iklan Shopee menghitung pembelian sampai 7 hari setelah klik, jadi
                          pembelian yang sudah direncanakan pun terhitung.
                        </li>
                        <li>Ambang di sini PRAKTIK UMUM, bukan aturan resmi Shopee.</li>
                      </ul>
                    </AlertDescription>
                  </Alert>

                  <KelompokKeputusan baris={hasil.baris} />

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Megaphone className="size-4" aria-hidden />
                        Paling aman diiklankan ({iklan.jumlahAman})
                      </CardTitle>
                      <CardDescription>
                        Diurut ROAS impas terendah — makin rendah, makin kecil risiko ruginya.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table data-testid="tabel-iklan-aman">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">SKU</TableHead>
                            <TableHead>Produk</TableHead>
                            <TableHead className="text-right">Harga</TableHead>
                            <TableHead className="text-right">Margin/unit</TableHead>
                            <TableHead className="text-right">ROAS impas</TableHead>
                            {/* Traffic ORGANIK: dari impor Performa Produk. Tanpa kolom ini
                                halaman terlihat "tidak membaca traffic" padahal angkanya ada
                                di tabel Semua Produk — dua tab harus menjawab pertanyaan sama. */}
                            <TableHead className="text-right">Kunjungan<br />organik</TableHead>
                            <TableHead className="text-right">Pesanan<br />organik</TableHead>
                            <TableHead className="text-right">CR<br />organik</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {iklan.aman.slice(0, 25).map((b) => (
                            <TableRow key={b.sku}>
                              <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                              <TableCell className="max-w-[260px] truncate">{b.nama ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(b.hargaJual)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(b.marginSatuan)}</TableCell>
                              <TableCell className="text-right font-semibold tabular-nums">{b.roasImpas}</TableCell>
                              <TableCell className="text-right tabular-nums">{metrik(b.organikKunjungan)}</TableCell>
                              <TableCell className="text-right tabular-nums">{metrik(b.organikPesanan)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {organikCr(b) === null ? "—" : `${organikCr(b)}%`}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {iklan.jangan.length > 0 ? (
                    <Card className="border-l-4 border-l-red-500">
                      <CardHeader>
                        <CardTitle className="text-base">Jangan diiklankan ({iklan.jumlahJangan})</CardTitle>
                        <CardDescription>
                          Produk ini sudah rugi sebelum biaya iklan. Berapa pun setelan iklannya, menambah
                          belanja iklan hanya memperbesar kerugian. Perbaiki harga atau HPP-nya dulu.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Table data-testid="tabel-iklan-jangan">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[100px]">SKU</TableHead>
                              <TableHead>Produk</TableHead>
                              <TableHead className="text-right">Harga</TableHead>
                              <TableHead className="text-right">Margin/unit</TableHead>
                              <TableHead className="text-right">Kontribusi</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {iklan.jangan.slice(0, 25).map((b) => (
                              <TableRow key={b.sku}>
                                <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                                <TableCell className="max-w-[260px] truncate">{b.nama ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatRupiah(b.hargaJual)}</TableCell>
                                <TableCell className="text-right font-semibold text-red-700 tabular-nums">
                                  {formatRupiah(b.marginSatuan)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{formatRupiah(b.kontribusi)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  ) : null}

                  {/* Estimasi per SKU: modal & target diatur user, hasil dari lib murni server */}
                  <AnalisaEstimasiIklan presetId={presetId} tanggal={tanggal} />
                </>
              )}
            </TabsContent>

            {/* ══ TAB PETA SKU (tool tanya SKU: dua kartu) ══ */}
            <TabsContent value="peta" className="flex flex-col gap-4">
              <AnalisaPetaSku presetId={presetId} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}

/** Kotak angka ringkas. Dipisah agar ringkasan mudah dibaca sekilas. */
function KotakAngka({ label, nilai, catatan }: { label: string; nilai: string; catatan: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading text-lg font-semibold tabular-nums">{nilai}</p>
      <p className="text-[11px] text-muted-foreground">{catatan}</p>
    </div>
  );
}

/**
 * Tabel Keputusan: kelompokkan SETIAP SKU per keputusan `keputusanIklan`.
 *
 * Kenapa mengelompok, bukan satu tabel panjang: pertanyaan pemilik toko bukan "SKU X
 * apa keputusannya" melainkan "mana yang harus saya hentikan hari ini". Kelompok
 * memaksa jawabannya terbaca sekali lihat.
 *
 * Sumbernya `baris` (semua SKU), BUKAN `iklan.aman`/`iklan.jangan` — dua daftar itu
 * disaring dari margin saja dan tidak memuat keputusan iklan.
 */
function KelompokKeputusan({ baris }: { baris: BarisSku[] }) {
  const kelompok = URUTAN_KEPUTUSAN.map((k) => ({
    keputusan: k,
    sku: baris.filter((b) => b.keputusanIklan?.keputusan === k),
  })).filter((g) => g.sku.length > 0);

  if (kelompok.length === 0) {
    return (
      <Card data-testid="tabel-keputusan-iklan">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Tidak ada SKU untuk dinilai pada periode ini.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="tabel-keputusan-iklan">
      <CardHeader>
        <CardTitle className="text-base">Keputusan per SKU</CardTitle>
        <CardDescription>
          Setiap SKU dikelompokkan menurut aturan <code>keputusanIklan</code>. Arahkan kursor ke
          keputusan untuk melihat alasan lengkap beserta angkanya.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {kelompok.map((g) => (
          <div key={g.keputusan} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className={`font-medium ${KELAS_KEPUTUSAN[g.keputusan]}`} data-testid={`keputusan-${g.keputusan}`}>
                {LABEL_KEPUTUSAN[g.keputusan]}
              </span>
              <Badge variant="secondary">{g.sku.length} SKU</Badge>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">SKU</TableHead>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-right">Dilihat</TableHead>
                    <TableHead className="text-right">Klik</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">ROAS aktual</TableHead>
                    <TableHead className="text-right">ROAS langsung</TableHead>
                    <TableHead className="text-right">ROAS impas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.sku.slice(0, 25).map((b) => (
                    <TableRow key={b.sku}>
                      <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                      <TableCell className="max-w-[240px] truncate">{b.nama ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{metrik(b.dilihat)}</TableCell>
                      <TableCell className="text-right tabular-nums">{metrik(b.klik)}</TableCell>
                      <TableCell className="text-right tabular-nums">{metrik(b.ctr, "%")}</TableCell>
                      <TableCell className="text-right tabular-nums">{metrik(b.roasAktual, "×")}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {metrik(b.roasLangsung ?? null, "×")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.roasImpas === null ? "—" : b.roasImpas}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Daftar model yang AKAN dipakai analisa mendalam, ditampilkan DI ATAS tombol.
 *
 * Kenapa ini ada: analisa mendalam mengeluarkan biaya token, dan repo ini tidak menyimpan
 * harga model — jadi halaman tidak bisa (dan tidak boleh) menebak "murah/mahal". Yang BISA
 * dipastikan cuma satu: model mana yang benar-benar akan berjalan. Itu yang ditampilkan,
 * sebelum user menekan tombol.
 */
function KartuModel({ rantai, terpakai, belumSiap, memuat, onBukaSetting }: {
  rantai: ModelRantai[] | null;
  terpakai: ModelRantai[];
  belumSiap: boolean;
  memuat: boolean;
  onBukaSetting: () => void;
}) {
  if (memuat) {
    return <Skeleton className="h-12 w-full rounded-lg" data-testid="model-analisa-memuat" />;
  }
  // Gagal memuat: tidak ada yang bisa dikatakan. Diam lebih baik daripada mengarang model.
  if (!rantai) return null;

  const dilewati = rantai.filter((m) => !m.siap || !m.modelDipilih);
  const adaFree = terpakai.some((m) => (m.modelDipilih ?? "").endsWith(":free"));

  return (
    <div className="flex flex-col gap-2" data-testid="model-analisa">
      {belumSiap ? (
        <Alert variant="destructive" data-testid="model-belum-siap">
          <TriangleAlert aria-hidden />
          <AlertTitle>Analisa mendalam belum bisa dijalankan</AlertTitle>
          <AlertDescription>
            Belum ada model default yang dipilih, jadi tidak ada model yang akan dipakai. Buka{" "}
            <button type="button" className="font-medium underline underline-offset-2" onClick={onBukaSetting} data-testid="tautan-setting-model">
              Pengaturan AI
            </button>{" "}
            lalu pilih model default terlebih dahulu.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 p-3" data-testid="model-terpakai">
          <p className="text-xs font-medium text-muted-foreground">
            {terpakai.length === 1 ? "Akan memakai:" : "Akan memakai (urutan cadangan):"}
          </p>
          <ol className="mt-1 flex flex-col gap-0.5">
            {terpakai.map((m, i) => (
              <li key={`${m.provider}-${i}`} className="text-sm">
                {terpakai.length > 1 ? <span className="mr-1 text-muted-foreground">{i + 1}.</span> : null}
                <span className="font-medium">{m.provider}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="font-mono text-xs">{m.modelDipilih}</span>
              </li>
            ))}
          </ol>
          {terpakai.length > 1 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Yang pertama dipakai lebih dulu; berikutnya dicoba bila yang di depan gagal.
            </p>
          ) : null}
        </div>
      )}

      {adaFree ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400" data-testid="peringatan-free">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Model <code>:free</code> mengantre di sisi penyedia, sering timeout.
        </p>
      ) : null}

      {dilewati.length > 0 ? (
        <p className="text-[11px] text-muted-foreground" data-testid="model-dilewati">
          Dilewati: {dilewati.map((m) => m.provider).join(", ")} — belum punya model default atau kredensial.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Rincian kegagalan analisa mendalam.
 *
 * Kenapa tidak sekadar menempel daftar ke pesan error: satu provider bisa punya puluhan model
 * aktif, dan saat anggaran waktu habis SETIAP model sisa menulis baris "dilewati" yang isinya
 * sama. Daftar seperti itu menenggelamkan dua hal yang benar-benar penting — provider tanpa
 * kredensial dan model pertama yang timeout. Di sini: yang informatif tampil di depan, sisanya
 * dikelompokkan per provider, dan daftar mentahnya dibuka atas permintaan user.
 */
function KartuGagalMendalam({ pesan, ringkas }: { pesan: string; ringkas: RingkasanGagal }) {
  const [buka, setBuka] = useState(false);
  const saran = saranGagal(ringkas);
  const nyataTampil = ringkas.nyata.slice(0, NYATA_TAMPIL);
  const sisaNyata = ringkas.nyata.length - nyataTampil.length;
  const total = ringkas.nyata.length + ringkas.jumlahDilewati + ringkas.tanpaKredensial.length;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-l-4 border-border border-l-red-500 bg-muted/40 p-3"
      data-testid="gagal-mendalam"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
        <div>
          <p className="text-sm font-medium">Analisa mendalam tidak dapat dijalankan</p>
          <p className="text-sm text-muted-foreground">{pesan}</p>
        </div>
      </div>

      {ringkas.nyata.length > 0 ? (
        <div data-testid="percobaan-nyata">
          <p className="text-xs font-medium text-muted-foreground">
            Yang benar-benar dicoba{ringkas.nyata.length > nyataTampil.length ? ` (${nyataTampil.length} pertama)` : ""}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {nyataTampil.map((n, i) => (
              <li key={`${n.provider}-${n.model}-${i}`} className="text-xs">
                <span className="font-mono">{n.provider}/{n.model}</span> — {n.error}
              </li>
            ))}
          </ul>
          {sisaNyata > 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              +{sisaNyata} percobaan lain dengan pola sama — buka daftar lengkap di bawah.
            </p>
          ) : null}
        </div>
      ) : null}

      {ringkas.dilewati.length > 0 ? (
        <div data-testid="percobaan-dilewati">
          <p className="text-xs font-medium text-muted-foreground">Dilewati (tidak pernah dicoba)</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {ringkas.dilewati.map((g) => (
              <li key={g.provider} className="text-xs">
                <span className="font-mono">{g.provider}</span>: {g.jumlah} model dilewati ({g.alasan})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {saran.length > 0 ? (
        <div className="rounded-md border border-border bg-background p-2" data-testid="saran-gagal">
          <p className="flex items-center gap-1 text-xs font-medium">
            <Lightbulb className="size-3.5" aria-hidden />
            Yang bisa dilakukan
          </p>
          <ul className="mt-1 list-disc pl-4">
            {saran.map((s, i) => <li key={i} className="text-xs text-muted-foreground">{s}</li>)}
          </ul>
        </div>
      ) : null}

      {total > 0 ? (
        <Collapsible open={buka} onOpenChange={setBuka}>
          <CollapsibleTrigger
            className="flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            data-testid="toggle-daftar-penuh"
          >
            <ChevronRight className={`size-3.5 transition-transform ${buka ? "rotate-90" : ""}`} aria-hidden />
            {buka ? "Sembunyikan daftar lengkap" : `Lihat daftar lengkap (${total} baris)`}
          </CollapsibleTrigger>
          <CollapsibleContent keepMounted className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border bg-background p-2">
            <ul className="flex flex-col gap-0.5">
              {ringkas.tanpaKredensial.map((p) => (
                <li key={`kred-${p}`} className="text-[11px]">
                  <span className="font-mono">{p}</span>: tidak ada kredensial aktif
                </li>
              ))}
              {ringkas.nyata.map((n, i) => (
                <li key={`nyata-${n.provider}-${n.model}-${i}`} className="text-[11px]">
                  <span className="font-mono">{n.provider}/{n.model}</span>: {n.error}
                </li>
              ))}
              {ringkas.dilewati.map((g) => (
                <li key={`dilewati-${g.provider}`} className="text-[11px]">
                  <span className="font-mono">{g.provider}</span>: {g.jumlah} model dilewati ({g.alasan})
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
