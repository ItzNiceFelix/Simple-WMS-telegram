"use client";

// app/order/page.tsx — Daftar Order Keluar + transisi fulfill (Fase 3a).
// Fetch LANGSUNG /api/order (kontrak DataSource beku Wave 3a).
import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronsUpDown, Eye, FileDown, FileUp, PackageSearch, RotateCcw } from "lucide-react";

import { DialogImportExcel } from "@/components/dashboard/dialog-import-excel";
import { DialogImportOrder } from "@/components/dashboard/dialog-import-order";
import { FooterPaginasi } from "@/components/dashboard/footer-paginasi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRupiah, formatTanggalJamWibBagian } from "@/lib/dashboard/format";
import type { OrderDetail } from "@/lib/d1/order";

type RincianOrder = OrderDetail;
type Target = { mp: string; no: string; ke: string };

// Cermin PETA_TRANSISI lib/d1/order.ts — tombol tampil sesuai status kini.
// Nilai DB `pack` tetap "pack" (kompatibilitas data); hanya label UI jadi "Disiapkan".
const LABEL_STATUS: Record<string, string> = { pack: "Disiapkan" };

const TRANSISI: Record<string, { ke: string; label: string }[]> = {
  pending: [
    { ke: "pack", label: "Disiapkan" },
    { ke: "batal", label: "Batal" },
  ],
  pack: [
    { ke: "kirim", label: "Kirim" },
    { ke: "batal", label: "Batal" },
  ],
  kirim: [
    { ke: "selesai", label: "Selesai" },
    { ke: "batal", label: "Batal" },
  ],
  selesai: [],
  batal: [],
};

const DAFTAR_STATUS = ["semua", "pending", "pack", "kirim", "selesai", "batal"];

// Mode cetak picklist (F18/T7). per_paket = 1 lembar per no_resi (default resi gabungan).
const MODE_PICKLIST = [
  { mode: "per_paket", label: "Per Paket" },
  { mode: "pisah", label: "Pisah" },
  { mode: "gabung", label: "Gabung" },
  { mode: "gabung-order", label: "Gabung order + advance (satu lembar)" },
] as const;

type ModePicklist = (typeof MODE_PICKLIST)[number]["mode"];

// Label tag ekspor pendek (kolom paling kanan). Beda dari label dropdown: "gabung-order" di
// dropdown menyebut "advance" supaya jelas apa yang ikut tercetak; badge cukup "Order + Advance".
const LABEL_EKSPOR: Record<string, string> = {
  per_paket: "Per Paket",
  pisah: "Pisah",
  gabung: "Gabung",
  "gabung-order": "Order + Advance",
};
const URUTAN_EKSPOR = ["per_paket", "pisah", "gabung", "gabung-order"];

// Kolom yang boleh diurutkan SERVER (cermin KOLOM_URUT_ORDER lib/d1/order.ts). Kolom Item/
// Total/Pengiriman TIDAK ada di sini: tiga kolom itu agregat SUM / gabungan string yang
// dihitung dari order_items, jadi mengurutkannya butuh kolom turunan di SQL — bukan urutan
// yang bisa dijamin konsisten dengan paginasi. Kolom tsb sengaja TIDAK diberi tombol sama
// sekali supaya tidak ada kontrol mati yang bisa diklik user tapi tidak mengubah apa pun.
type KolomUrut = "marketplace" | "no_pesanan" | "no_resi" | "tanggal" | "status_fulfill";
type ArahUrut = "asc" | "desc";

// Kunci urut picklist yang dikenal SERVER (cermin KUNCI_URUT_PICKLIST lib/d1/picklist.ts).
// Daftar ini SENGAJA ditulis ulang di klien, bukan diimpor: modul lib/d1/* menarik driver D1
// dan hanya boleh jalan di server. Yang dijaga di sini cuma bentuk tipenya — nilai asli tetap
// milik server, dan permintaan dengan kunci di luar daftar ini ditolak server.
type KunciUrutPicklist = "default" | "sku" | "nama" | "lokasi";

// Kunci urut yang boleh diminta PRATINJAU, urut sesuai tampilan header. `default` = urutan
// lama sebelum fitur sort ada, dan itu juga nilai aman saat server belum mengabari apa pun.
const KUNCI_URUT_PREVIEW = ["default", "sku", "nama", "lokasi"] as const;

// Peta label header pratinjau → kunci urut server. Header dirender dari `kolom` milik server,
// jadi tombol urut dicari lewat LABEL-nya; kolom yang tidak ada di peta ini (mis. No, resi)
// tidak diberi tombol sama sekali — tombol mati yang diklik tapi tidak mengubah urutan lebih
// buruk daripada tidak ada tombol, aturan yang sama dengan tabel utama.
const URUT_PER_KOLOM_PREVIEW: Record<string, KunciUrutPicklist> = {
  SKU: "sku",
  "Nama Produk": "nama",
  "Lokasi Gudang": "lokasi",
};

// Booking advance yang bisa dicentang saat mode gabung-order. Bentuknya cermin
// Booking di app/advance/page.tsx — hanya medan yang dipakai layar ini.
type BookingTersedia = {
  booking_sn: string;
  sku: string;
  variasi: string;
  nama_produk: string;
  qty: number;
};

// Baris pratinjau dari server. `lokasi`/`grup` hanya terisi di sebagian mode, karena itu
// opsional — menyatakannya wajib akan berbohong untuk mode `pisah`.
type BarisPreviewPicklist = {
  no: number;
  nama: string;
  sku: string;
  lokasi?: string;
  qty: number;
  perluSku?: boolean;
  skuAsal?: string;
  grup?: string;
};

type DataPreviewPicklist = {
  mode: string;
  urut: string;
  arah: string;
  kolom: string[];
  baris: BarisPreviewPicklist[];
  total_baris: number;
  total_unit: number;
  ada_bermasalah: number;
  judul: string;
  // Angka sisi order & advance dari server. Dipakai lebih dulu daripada hitungan klien:
  // klien hanya tahu yang DICENTANG, bukan yang benar-benar ikut (server memverifikasi tiap
  // booking_sn masih `menunggu` dan membuang yang tidak), jadi angka server yang benar.
  total_order?: number;
  total_advance?: number;
  // Urutan yang DIMINTA saat data ini dimuat. Ditulis klien saat respons dipasang, bukan
  // dikirim server: server hanya mengabari urut/arah EFEKTIF-nya, dan yang dibutuhkan Export
  // adalah pasangan "isi tabel ini dimuat untuk sort apa" — supaya lembar selalu mengikuti
  // tabel yang sedang dilihat, bukan sort yang baru saja diklik tapi belum termuat.
  muatUntuk?: { urut: KunciUrutPicklist; arah: ArahUrut };
};

/**
 * Terjemahkan urutan layar → urutan picklist server. Fungsi TUNGGAL yang dipakai pratinjau
 * DAN ekspor.
 *
 * Kenapa harus satu fungsi: pratinjau yang memakai `nama` sementara PDF memakai `default`
 * (atau sebaliknya) berarti user melihat satu urutan di layar dan picker menerima urutan
 * lain di rak — persis regresi yang fitur sort ini ada untuk mencegahnya. Selama keduanya
 * membaca fungsi ini, keduanya tidak bisa berbeda.
 *
 * Pemetaan: no_pesanan → sku (padanan terdekat yang benar-benar ada di lembar picklist),
 * no_resi → lokasi, lainnya → `default` = urutan LAMA sebelum fitur sort ada. Arah hanya
 * ikut bila kuncinya ikut; mengirim `arah` sendirian berarti minta `desc` atas urutan
 * default lama.
 */
function urutPicklistDari(kolomUrut: KolomUrut, arah: ArahUrut): { urut: KunciUrutPicklist; arah: ArahUrut } {
  if (kolomUrut === "no_pesanan") return { urut: "sku", arah };
  if (kolomUrut === "no_resi") return { urut: "lokasi", arah };
  return { urut: "default", arah: "asc" };
}

// Ukuran halaman. 200 = angka yang SUDAH dipakai halaman ini sebelum paginasi (`limit=200`)
// sekaligus plafon server (MAKS_UKURAN_HALAMAN). Dipilih 200 supaya tidak ada regresi
// perilaku: pada hari sibuk satu hari penuh masih sering < 200 order, jadi user yang dulu
// melihat semua order hari ini tetap melihat semuanya di halaman 1 tanpa klik tambahan.
const UKURAN_HALAMAN = 200;

/**
 * Tanggal hari ini WIB (UTC+7) sebagai YYYY-MM-DD.
 *
 * Konvensi yang SAMA dengan server, dan itu bukan pilihan bebas:
 * `orders.tanggal` di-anchor ke tengah malam UTC dari STRING tanggal di berkas impor
 * (`tanggalKeEpoch` = `Date.UTC(y, m-1, d)`), dan `filterDariQuery` membangun jendela
 * satu hari dari helper yang sama. Artinya tanggal order adalah tanggal KALENDER apa adanya.
 * Yang menentukan kalender siapa adalah pengguna WMS: order marketplace masuk malam WIB
 * (mis. 22:00 WIB = 15:00 UTC di hari yang sama), dan admin mencatatnya dengan tanggal WIB.
 * Karena itu default "hari ini" HARUS tanggal WIB — memakai `toISOString()` UTC akan
 * menggeser default 7 jam dan pada pagi hari WIB menampilkan tanggal kemarin, membuat
 * daftar "hari ini" kosong padahal order baru saja diimpor.
 * (Satu sumber dengan `tanggalWib` lib/ai/provider.ts dan `tanggalHariIni` lib/d1/permintaan.ts.)
 */
function tanggalHariIniWib(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function HalamanOrder() {
  return (
    <ButuhAkses href="/order">
      <TabsOrder />
    </ButuhAkses>
  );
}

/** Tab Order | Advance (Fase E3). Daftar order lama tetap utuh; advance = tautan halaman advance. */
function TabsOrder() {
  const [tab, setTab] = useState("order");
  return (
    <Tabs value={tab} onValueChange={(v) => typeof v === "string" && setTab(v)} className="gap-4">
      <TabsList data-testid="tab-order">
        <TabsTrigger value="order" data-testid="tab-order-order">Order</TabsTrigger>
        <TabsTrigger value="advance" data-testid="tab-order-advance">Advance</TabsTrigger>
      </TabsList>
      <TabsContent value="order">
        <DaftarOrder />
      </TabsContent>
      <TabsContent value="advance">
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">
            Booking Advance Fulfilment dikelola di halaman terpisah: cetak picklist, kirim ke Shopee, atau batalkan.
          </p>
          <Button className="h-11 md:h-9" data-testid="buka-halaman-advance" onClick={() => window.open("/advance", "_self")}>
            Buka halaman Advance
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function DaftarOrder() {
  const [orders, setOrders] = useState<RincianOrder[] | null>(null);
  // Mode picklist yang sudah pernah dicetak per order, kunci `${mp}|${no}` (lihat kunciOrder).
  // Datang satu paket dengan daftar order supaya tag tidak perlu kueri kedua dari browser.
  const [ekspor, setEkspor] = useState<Record<string, string[]>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importOrderOpen, setImportOrderOpen] = useState(false);
  const [modePicklist, setModePicklist] = useState<ModePicklist>("per_paket");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("semua");
  const [mp, setMp] = useState("");
  // Filter satu hari, default HARI INI (WIB). Tanggal dikirim apa adanya sebagai string
  // `tanggal=` ke server; jendela harinya dihitung server dengan helper yang sama seperti
  // jalur impor, jadi klien tidak boleh menebak batas epoch sendiri.
  const [tanggal, setTanggal] = useState(tanggalHariIniWib);
  const [halaman, setHalaman] = useState(1);
  const [kolomUrut, setKolomUrut] = useState<KolomUrut>("tanggal");
  const [arah, setArah] = useState<ArahUrut>("desc");
  // Metadata paginasi dari server: `total` = COUNT(*) himpunan yang difilter (bukan panjang
  // array halaman), `jumlah_halaman` = max(1, ceil(total/ukuran)).
  const [total, setTotal] = useState(0);
  const [jumlahHalaman, setJumlahHalaman] = useState(1);
  const [memuatHalaman, setMemuatHalaman] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [hapusTarget, setHapusTarget] = useState<Target[] | null>(null);
  const [rincian, setRincian] = useState<RincianOrder | null>(null);
  const [mengirim, setMengirim] = useState(false);
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  // Pratinjau picklist (modal di halaman INI, bukan rute terpisah — permintaan owner).
  // `preview` menyimpan hasil server apa adanya, termasuk `kolom`/`judul`: jumlah kolom
  // BEDA per mode (pisah tanpa Lokasi Gudang, gabung punya kolom resi), jadi header tabel
  // dirender dari array itu dan bukan dari daftar tetap di klien. Daftar tetap akan salah
  // di salah satu mode dan salahnya baru terlihat setelah lembar tercetak.
  const [preview, setPreview] = useState<DataPreviewPicklist | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Awalnya null = belum ada permintaan; ini pembeda "memuat" dari "sudah selesai".
  const [previewMemuat, setPreviewMemuat] = useState(false);
  // Urutan pratinjau dipisah dari urutan tabel utama: user boleh mengurutkan tabel tanpa
  // ingin mengubah lembar yang sedang dilihat (dan sebaliknya). Pola klik sama dengan tabel
  // utama — kolom sama membalik arah, kolom lain mulai dari asc.
  const [previewUrut, setPreviewUrut] = useState<KunciUrutPicklist>("default");
  const [previewArah, setPreviewArah] = useState<ArahUrut>("asc");
  const [previewBuka, setPreviewBuka] = useState(false);
  // ---- Advance yang ikut dicetak (mode gabung-order) ----
  //
  // Kenapa ini ada: jalur server lama menarik booking advance dengan kueri GLOBAL
  // (`listBooking(status, limit:500)`) tanpa melihat order mana yang dicentang. Akibatnya
  // picker menerima lembar berisi advance milik orang lain — mode "gabung" jadi tidak bisa
  // dipakai karena isinya tidak bisa dikendalikan. Di sini pilihan itu dibuat EKSPLISIT:
  // user mencentang booking_sn, dan yang dicentang DIKIRIM ke server sebagai `booking`.
  const [bookingTersedia, setBookingTersedia] = useState<BookingTersedia[] | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingTerpilih, setBookingTerpilih] = useState<Set<string>>(new Set());
  const mpTertunda = useDeferredValue(mp.trim().toLowerCase());

  const kunciOrder = (o: RincianOrder) => `${o.marketplace}|${o.no_pesanan}`;

  function togglePilih(o: RincianOrder): void {
    const k = kunciOrder(o);
    setTerpilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(k)) baru.delete(k);
      else baru.add(k);
      return baru;
    });
  }

  function pilihSemua(): void {
    if (!orders) return;
    setTerpilih(new Set(orders.map(kunciOrder)));
  }

  async function aksiMassal(ke: string): Promise<void> {
    if (!orders || terpilih.size === 0) return;
    const targets = orders
      .filter((o) => terpilih.has(kunciOrder(o)))
      .map((o) => ({ marketplace: o.marketplace, no_pesanan: o.no_pesanan, ke }));
    setMengirim(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi: "transisi-batch", targets }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; count?: number } | null;
      if (!res.ok || !data?.ok) {
        tampilkanGagalTulis(data?.error ?? `Gagal (${res.status}).`);
        return;
      }
      toast.success(`${data.count ?? targets.length} order → ${ke}.`);
      setTerpilih(new Set());
      await muat();
    } catch {
      toast.error("Jaringan gagal. Coba lagi.");
    } finally {
      setMengirim(false);
    }
  }

  async function hapusOrder(targets: Target[]): Promise<void> {
    if (targets.length === 0) return;
    setMengirim(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          aksi: "hapus",
          targets: targets.map((t) => ({ marketplace: t.mp, no_pesanan: t.no })),
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; dihapus?: number } | null;
      if (!res.ok || !data?.ok) {
        tampilkanGagalTulis(data?.error ?? `Gagal (${res.status}).`);
        return;
      }
      const n = data.dihapus ?? targets.length;
      toast.success(`${n} order dihapus.`);
      setHapusTarget(null);
      setTerpilih(new Set());
      await muat();
    } catch {
      toast.error("Jaringan gagal. Coba lagi.");
    } finally {
      setMengirim(false);
    }
  }

  /** Order terpilih sebagai pasangan {marketplace, no_pesanan} untuk endpoint picklist. */
  function targetsTerpilih(): { marketplace: string; no_pesanan: string }[] {
    return (orders ?? [])
      .filter((o) => terpilih.has(kunciOrder(o)))
      .map((o) => ({ marketplace: o.marketplace, no_pesanan: o.no_pesanan }));
  }

  /**
   * Gerbang keselamatan SEBELUM mencetak: order yang itemnya belum lengkap.
   *
   * Kenapa `window.confirm` dan bukan `toast`: pertanyaannya butuh jawaban ya/tidak, dan
   * jawaban itu menentukan apakah lembar tercetak — toast tidak bisa menahan alur cetak.
   * `window.open` di bawah juga wajib dipanggil SINKRON di dalam event handler klik, kalau
   * tidak popup blocker memblokir tab pratinjau; makanya konfirmasi harus native & sinkron
   * (promise/await akan melepas user-gesture dan tab baru ikut diblokir).
   *
   * Dipakai SEMUA jalur cetak — tombol toolbar maupun "Export PDF" di dalam pratinjau —
   * supaya user yang selalu lewat pratinjau tidak kehilangan peringatan ini.
   */
  function konfirmasiPerluSku(dipilih: RincianOrder[]): boolean {
    const bermasalah = dipilih.filter((o) => o.items.some((it) => it.perlu_sku === true));
    const kosong = dipilih.filter((o) => o.items.length === 0);
    if (bermasalah.length === 0 && kosong.length === 0) return true;
    const bagian: string[] = [];
    if (bermasalah.length > 0) bagian.push(`${bermasalah.length} order punya baris belum ber-SKU`);
    if (kosong.length > 0) bagian.push(`${kosong.length} order belum punya item sama sekali`);
    return window.confirm(
      `${bagian.join(" dan ")}.\n\nBaris tersebut tetap tercetak di bagian "PERLU SKU", tapi pastikan checker memeriksanya.\n\nLanjut cetak?`
    );
  }

  function unduhPicklist(): void {
    if (!adaYangDipilih()) return;
    const dipilih = (orders ?? []).filter((o) => terpilih.has(kunciOrder(o)));
    // Ingatkan SEBELUM mencetak bila ada order yang itemnya belum lengkap. Picklist yang
    // tercetak tanpa barang bermasalah membuat checker memverifikasi lembar yang tidak
    // lengkap tanpa tahu — lebih baik dicegah di sini daripada diketahui setelah kirim.
    if (!konfirmasiPerluSku(dipilih)) return;
    const q = new URLSearchParams({ aksi: "picklist-pdf", mode: modePicklist });
    // Pilihan (targets + booking) dirakit di SATU tempat bersama pratinjau — lihat paramPilihan().
    // Urutan layar ikut ke kertas. PDF disusun ULANG di server dari `order_items`, jadi tanpa
    // parameter ini "urutkan per nama produk" hanya mengubah layar — picker tetap menyisir rak
    // urut lokasi. Allowlist server `default|sku|nama|lokasi`, dan HANYA kolom itu yang punya
    // padanan di baris picklist (marketplace/resi/tanggal/status bukan atribut barang).
    // Pemetaannya ada di urutPicklistDari() supaya pratinjau memakai aturan yang sama persis.
    const { urut, arah: arahPick } = urutPicklistDari(kolomUrut, arah);
    // `default` = urutan LAMA persis seperti sebelum fitur sort ada. Parameternya sengaja
    // TIDAK dikirim sama sekali (bukan `urut=default`) supaya tautan cetak lama tetap utuh.
    if (urut !== "default") {
      q.set("urut", urut);
      q.set("arah", arahPick);
    }
    // Pilihan (order + advance tercentang) dari fungsi yang SAMA dengan pratinjau; sisanya
    // (urutan) khusus jalur ini karena toolbar memakai urutan tabel utama.
    paramPilihan(q);
    // `inline=1` = PDF tampil di viewer tab baru (pratinjau cetak), bukan langsung terunduh.
    // Dari viewer user memilih print/simpan sendiri.
    q.set("inline", "1");
    window.open(`/api/order?${q}`, "_blank");
    // `window.open` tidak memberi tahu kapan server selesai menyusun PDF (apalagi kapan
    // pencatatan ekspor ikut tersimpan), jadi tag tidak bisa di-await seperti fetch biasa.
    // Jeda pendek lalu muat ulang daftar: tag "sudah dicetak" muncul tanpa refresh manual,
    // dan bila user menutup tab sebelum jeda habis, muat ulang itu tetap tidak merusak apa pun.
    window.setTimeout(() => void muat(), 1500);
  }

  /**
   * Ambil booking advance berstatus `menunggu` sebagai CALON pilihan. Endpoint yang sama
   * dengan halaman /advance (`aksi=daftar`), jadi tidak ada kontrak baru untuk daftar ini —
   * yang baru hanya `booking` di jalur preview/PDF.
   */
  const muatBooking = useCallback(async () => {
    setBookingError(null);
    setBookingTersedia(null);
    try {
      const q = new URLSearchParams({ aksi: "daftar", status: "menunggu", limit: "300" });
      const res = await fetch(`/api/advance?${q}`, { credentials: "include" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; booking?: BookingTersedia[] } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      const daftar = data.booking ?? [];
      setBookingTersedia(daftar);
      // Buang centang untuk booking yang sudah tidak `menunggu` lagi (mis. dikirim di tab
      // lain): kalau tidak, `booking` yang dikirim berisi sn yang tidak ada di layar dan
      // user mencetak barang yang tidak dia lihat di daftar.
      const snTampil = new Set(daftar.map((b) => b.booking_sn));
      setBookingTerpilih((lama) => new Set([...lama].filter((sn) => snTampil.has(sn))));
    } catch (e) {
      setBookingTersedia([]);
      setBookingError(e instanceof Error ? e.message : "Gagal memuat booking advance.");
    }
  }, []);

  // Dimuat begitu mode gabung-order dipilih — bukan saat modal dibuka: user harus bisa
  // mencentang advance LEBIH DULU, dan tanpa centang itu tombol pratinjau tetap mati.
  useEffect(() => {
    if (modePicklist !== "gabung-order") return;
    void muatBooking();
  }, [modePicklist, muatBooking]);

  function toggleBooking(sn: string): void {
    setBookingTerpilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(sn)) baru.delete(sn);
      else baru.add(sn);
      return baru;
    });
  }

  /** Ada yang bisa dicetak? Mode lain tetap butuh order; gabung-order boleh HANYA advance —
   *  itu justru kasus di mana user butuh mode ini (tidak ada order untuk dicetak, tapi
   *  barangnya harus disiapkan). Dipakai tombol pratinjau, tombol PDF, dan jalur ekspor,
   *  jadi aturannya hanya boleh hidup di satu tempat. */
  function adaYangDipilih(): boolean {
    if (terpilih.size > 0) return true;
    return modePicklist === "gabung-order" && bookingTerpilih.size > 0;
  }

  /** Klik header pratinjau: kolom sama → balik arah; kolom lain → kolom itu, mulai asc.
   *  Urutan TIDAK dihitung di klien: baris pratinjau sudah agregat per SKU (+advance) yang
   *  tidak ada padanannya di layar, dan yang tercetak nanti juga urutan server. Jadi klik
   *  hanya mengganti parameter, lalu server yang mengurutkan. */
  function urutPreview(kunci: KunciUrutPicklist): void {
    if (kunci === previewUrut) setPreviewArah((a) => (a === "asc" ? "desc" : "asc"));
    else {
      setPreviewUrut(kunci);
      setPreviewArah("asc");
    }
  }

  /**
   * Urutan yang HARUS dipakai lembar cetak: urutan yang benar-benar DIMUAT di `preview`.
   *
   * Kenapa bukan `previewUrut`/`previewArah` langsung: klik header mengubah state itu
   * SEKETIKA, sementara isi tabel baru berubah setelah permintaan selesai. Selama jeda itu
   * layar masih memperlihatkan urutan lama. Membaca state (bukan yang termuat) membuat Export
   * yang ditekan cepat mengirim urutan BARU sementara user masih melihat urutan LAMA —
   * persis "layar beda dengan kertas" yang fitur ini ada untuk mencegah.
   *
   * `preview.muatUntuk` ditulis HANYA saat respons sukses dipasang, jadi ia selalu
   * menggambarkan tabel yang sedang tampil; ia tidak pernah menunjuk sort yang belum dimuat.
   */
  function urutTampil(): { urut: KunciUrutPicklist; arah: ArahUrut } {
    return preview?.muatUntuk ?? { urut: previewUrut, arah: previewArah };
  }

  /** Buka pratinjau: urutan awal mengikuti urutan tabel utama supaya yang tampil di modal
   *  sama dengan yang akan tercetak bila user langsung menekan Export tanpa menyentuh header.
   *  Sesudah itu modal punya urutannya sendiri. */
  function bukaPreview(): void {
    // Gerbang yang SAMA dengan tombolnya (adaYangDipilih): mode gabung-order boleh dibuka
    // dengan hanya advance tercentang. Menulis ulang `terpilih.size === 0` di sini akan
    // membuat tombol yang aktif tapi tidak bereaksi — persis bug yang gerbang bersama ini
    // ada untuk mencegahnya.
    if (!adaYangDipilih()) return;
    const awal = urutPicklistDari(kolomUrut, arah);
    setPreviewUrut(awal.urut);
    setPreviewArah(awal.arah);
    setPreview(null);
    setPreviewError(null);
    setPreviewBuka(true);
  }

  /**
   * Parameter yang menggambarkan PILIHAN user saat ini — targets (order) dan booking (advance
   * tercentang) — SATU-SATUNYA tempat keduanya dirakit.
   *
   * Kenapa harus satu fungsi, dan bukan sekadar "ditulis dua kali dengan hati-hati": tiga
   * jalur memakai parameter ini (pratinjau, Export di modal, tombol PDF di toolbar) dan
   * salah satu dari mereka pernah tertinggal satu param. Akibatnya bukan tampilan yang aneh,
   * tapi user menyetujui pratinjau yang bukan yang dia cetak — persis regresi yang fitur ini
   * ada untuk mencegah. Selama ketiganya memanggil fungsi ini, himpunannya tidak bisa berbeda;
   * `urut`/`arah` diatur TERPISAH oleh pemanggil karena pratinjau punya urutannya sendiri.
   */
  function paramPilihan(q: URLSearchParams): void {
    q.set("targets", JSON.stringify(targetsTerpilih()));
    // Advance hanya ikut di mode gabung-order: hanya mode itu yang mencampur advance, dan
    // mode lain tidak boleh menerima barang tambahan diam-diam. Daftar kosong tetap DIKIRIM
    // (`[]`), bukan dihilangkan: `[]` = "tidak ada advance yang dipilih" sedangkan param yang
    // tidak ada = "semua yang `menunggu`" — server membedakan keduanya, dan menghilangkannya
    // berarti mencetak advance yang tidak pernah dipilih user.
    if (modePicklist === "gabung-order") {
      q.set("status", "menunggu");
      q.set(
        "booking",
        JSON.stringify((bookingTersedia ?? []).filter((b) => bookingTerpilih.has(b.booking_sn)).map((b) => b.booking_sn)),
      );
    }
  }

  const muatPreview = useCallback(async () => {
    if (!previewBuka || !adaYangDipilih()) return;
    setPreviewMemuat(true);
    setPreviewError(null);
    try {
      const q = new URLSearchParams({ aksi: "preview-picklist", mode: modePicklist, urut: previewUrut, arah: previewArah });
      // Pilihan dirakit di satu tempat bersama jalur PDF — lihat paramPilihan().
      paramPilihan(q);
      const res = await fetch(`/api/order?${q}`, { credentials: "include" });
      const data = (await res.json().catch(() => null)) as (DataPreviewPicklist & { ok?: boolean; error?: string }) | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      // Kunci yang BENAR-BENAR dipakai server (hasil allowlist server) disimpan bersama
      // datanya: itu yang dikirim ke jalur PDF, jadi layar dan kertas tidak bisa berbeda
      // walau server menormalkan permintaan kita. Disimpan DI OBJEK `preview`, bukan di state
      // terpisah: dua state yang di-update berurutan membuat ada satu render di mana keduanya
      // belum sinkron, dan Export bisa membaca pasangan yang salah (lihat urutTampil()).
      setPreview({
        ...data,
        muatUntuk: {
          urut: (KUNCI_URUT_PREVIEW as readonly string[]).includes(data.urut) ? (data.urut as KunciUrutPicklist) : "default",
          arah: data.arah === "desc" ? "desc" : "asc",
        },
      });
    } catch (e) {
      setPreview(null);
      setPreviewError(e instanceof Error ? e.message : "Gagal memuat pratinjau.");
    } finally {
      setPreviewMemuat(false);
    }
    // `orders`/`kunciOrder` sengaja tidak jadi dependensi: targets dihitung dari pilihan saat
    // permintaan dibuat, dan menyertakan `orders` membuat setiap muat ulang daftar memicu
    // permintaan pratinjau baru yang tidak diminta user. `bookingTersedia`/`bookingTerpilih`
    // justru HARUS ikut: mencentang advance berarti isi lembar berubah, dan pratinjau lama
    // yang dibiarkan tampil akan berbohong soal apa yang akan tercetak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewBuka, previewUrut, previewArah, modePicklist, terpilih, orders, bookingTersedia, bookingTerpilih]);

  useEffect(() => {
    void muatPreview();
  }, [muatPreview]);

  /** Export dari pratinjau: pakai urutan yang sedang TAMPIL, bukan urutan tabel utama —
   *  kalau tidak, user mengurutkan pratinjau per SKU lalu mendapat lembar urut lokasi. */
  function eksporDariPreview(): void {
    if (!adaYangDipilih()) return;
    const dipilih = (orders ?? []).filter((o) => terpilih.has(kunciOrder(o)));
    // Gerbang yang SAMA dengan tombol toolbar: user yang selalu lewat pratinjau tidak boleh
    // kehilangan peringatan baris belum ber-SKU. Peringatan modal (di bawah) hanya penanda;
    // yang menghentikan cetak tetap konfirmasi ini.
    if (!konfirmasiPerluSku(dipilih)) return;
    // Urutan yang TAMPIL di modal — dibaca dari data yang sedang terpasang, bukan dari state
    // sort yang mungkin baru diklik dan belum termuat (lihat urutTampil()).
    const tampil = urutTampil();
    const q = new URLSearchParams({ aksi: "picklist-pdf", mode: modePicklist, urut: tampil.urut, arah: tampil.arah });
    // Pilihan (targets + booking) dari fungsi yang SAMA dengan pratinjau. Menulis ulang
    // daftar booking di sini adalah cara paling mudah membuat lembar berbeda dari layar.
    paramPilihan(q);
    // `inline=1` = server mengirim `Content-Disposition: inline`, jadi PDF TAMPIL di viewer
    // PDF bawaan browser pada tab baru — bukan terunduh langsung. `window.open(..., "_blank")`
    // harus dipanggil SINKRON di dalam handler klik, kalau tidak popup blocker menahannya.
    // Dari viewer itu user menekan tombol Print milik browser, yang membuka dialog pratinjau
    // cetak; itulah "print preview" yang diminta owner.
    q.set("inline", "1");
    window.open(`/api/order?${q}`, "_blank");
    // Sama seperti jalur toolbar: tag "sudah dicetak" muncul tanpa refresh manual.
    window.setTimeout(() => void muat(), 1500);
  }

  const muat = useCallback(async () => {
    setError(null);
    setOrders(null);
    setMemuatHalaman(true);
    try {
      const q = new URLSearchParams({
        aksi: "daftar",
        halaman: String(halaman),
        ukuran: String(UKURAN_HALAMAN),
        urut: kolomUrut,
        arah,
      });
      // `tanggal` mengirim SATU hari penuh; server mengubahnya jadi jendela
      // (dari = awal hari, sampai = +86399) lewat helper yang sama dengan impor.
      // Kosong = tanpa batas tanggal (semua tanggal), untuk melihat riwayat lama.
      if (tanggal) q.set("tanggal", tanggal);
      if (status !== "semua") q.set("status", status);
      if (mpTertunda) q.set("mp", mpTertunda);
      const res = await fetch(`/api/order?${q}`, { credentials: "include" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        orders?: RincianOrder[];
        ekspor?: Record<string, string[]>;
        total?: number;
        jumlah_halaman?: number;
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Gagal (${res.status}).`);
      const jml = data.jumlah_halaman ?? 1;
      // Halaman terakhir bisa menyusut (mis. baris halaman ini baru saja dihapus/ditransisi
      // lewat aksi massal) sehingga `halaman` kini menunjuk halaman yang tidak ada. Server
      // mengembalikan daftar kosong + jumlah_halaman yang lebih kecil; jepit di sini supaya
      // user tidak terjebak di halaman kosong tanpa tahu harus kembali. `total` tetap 0 di
      // render ini, jadi tidak ada permintaan kedua kecuali memang perlu.
      if (halaman > jml) {
        setHalaman(jml);
        return;
      }
      setOrders(data.orders ?? []);
      setEkspor(data.ekspor ?? {});
      setTotal(data.total ?? 0);
      setJumlahHalaman(jml);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat order.");
    } finally {
      setMemuatHalaman(false);
    }
  }, [status, mpTertunda, tanggal, halaman, kolomUrut, arah]);

  useEffect(() => {
    void muat();
  }, [muat]);

  /** Klik header: kolom sama → balik arah; kolom lain → kolom itu, mulai asc.
   *  Selalu kembali ke halaman 1: server mengurutkan SELURUH himpunan lalu memotong
   *  per halaman, jadi nomor halaman lama menunjuk potongan yang sama sekali lain. */
  function urutkan(kolom: KolomUrut): void {
    setHalaman(1);
    if (kolom === kolomUrut) setArah((a) => (a === "asc" ? "desc" : "asc"));
    else {
      setKolomUrut(kolom);
      setArah("asc");
    }
  }

  /** Ganti tanggal → halaman 1, kalau tidak user mendarat di halaman kosong (hari baru
   *  biasanya hanya punya 1 halaman). */
  function gantiTanggal(nilai: string): void {
    setTanggal(nilai);
    setHalaman(1);
  }

  async function kirim() {
    if (!target) return;
    setMengirim(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          aksi: "transisi",
          marketplace: target.mp,
          no_pesanan: target.no,
          ke: target.ke,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        tampilkanGagalTulis(data?.error ?? `Gagal (${res.status}).`);
        return;
      }
      toast.success(`Order ${target.no} → ${target.ke}.`);
      setTarget(null);
      await muat();
    } catch {
      toast.error("Jaringan gagal. Coba lagi.");
    } finally {
      setMengirim(false);
    }
  }

  return (
    <>
      <PageHeader
        judul="Order Keluar"
        deskripsi="Pesanan marketplace + transisi fulfill."
        aksi={
          <div className="flex flex-wrap gap-2">
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="template-pesanan" onClick={() => window.open("/template-import-produk.xlsx", "_blank")}>
              <FileDown data-icon="inline-start" />
              Template
            </Button>
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="impor-pesanan" onClick={() => setImportOpen(true)}>
              <FileUp data-icon="inline-start" />
              Impor Pesanan
            </Button>
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="impor-order-shopee" onClick={() => setImportOrderOpen(true)}>
              <FileUp data-icon="inline-start" />
              Impor Shopee
            </Button>
            <Button size="lg" variant="outline" className="h-11 md:h-8" data-testid="muat-ulang-order" onClick={() => void muat()}>
              <RotateCcw data-icon="inline-start" />
              Muat ulang
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-full sm:max-w-52">
            <FieldLabel htmlFor="filter-status-order">Status</FieldLabel>
            <Select
              value={status}
              onValueChange={(v) => {
                if (typeof v !== "string") return;
                // Filter berubah = himpunan berubah = halaman lama bisa melewati ujung
                // daftar baru. Sama seperti tanggal dan urutan, kembali ke halaman 1.
                setStatus(v);
                setHalaman(1);
              }}
            >
              <SelectTrigger id="filter-status-order" className="h-11 w-full md:h-8" data-testid="filter-status-order">
                <SelectValue>{(v: string | null) => v ?? "Semua"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DAFTAR_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "semua" ? "Semua" : LABEL_STATUS[s] ?? s}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-full sm:max-w-52">
            <FieldLabel htmlFor="filter-mp-order">Marketplace</FieldLabel>
            <Input
              id="filter-mp-order"
              className="h-11 md:h-8"
              data-testid="filter-mp-order"
              placeholder="cth. shopee"
              value={mp}
              onChange={(e) => {
                setMp(e.target.value);
                // Sama seperti filter lain: himpunan berubah, halaman lama tidak lagi bermakna.
                setHalaman(1);
              }}
            />
          </Field>
          <Field className="w-full sm:max-w-44">
            {/* Label menyebut WIB karena `tanggal` = tanggal KALENDER berkas impor; default
                hari ini dihitung dengan pergeseran WIB (lihat tanggalHariIniWib). Menghapus
                isinya = tanpa batas tanggal, berguna untuk melihat order lama.

                PENTING: filter ini tetap SATU HARI PENUH (`tanggal=YYYY-MM-DD` → server
                membangun dari = tengah malam, sampai = +86399). Kolom tabel kini menampilkan
                jam, tapi JANGAN "menyamakan filter dengan kolom" menjadi rentang berjam —
                server hanya menerima tanggal dan rentang berjam akan memotong order yang
                jamnya di luar rentang itu, yaitu menghilangkan order yang dulu tampil. */}
            <FieldLabel htmlFor="filter-tanggal-order">Tanggal (WIB)</FieldLabel>
            <Input
              id="filter-tanggal-order"
              type="date"
              className="h-11 md:h-8"
              data-testid="filter-tanggal-order"
              value={tanggal}
              onChange={(e) => gantiTanggal(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2" data-testid="toolbar-bulk-order">
          <Button size="sm" variant="outline" className="h-9" data-testid="pilih-semua-order" onClick={pilihSemua} disabled={!orders || orders.length === 0}>
            Pilih semua
          </Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setTerpilih(new Set())} disabled={terpilih.size === 0}>
            Kosongkan
          </Button>
          <span className="text-sm text-muted-foreground" data-testid="jumlah-terpilih-order">
            {terpilih.size} dipilih
          </span>
          <div className="flex flex-wrap gap-2 md:ml-auto">
            {[
              { ke: "pack", label: "Disiapkan" },
              { ke: "kirim", label: "Kirim" },
              { ke: "selesai", label: "Selesai" },
              { ke: "batal", label: "Batal" },
            ].map((a) => (
              <Button
                key={a.ke}
                size="sm"
                variant={a.ke === "batal" ? "destructive" : "outline"}
                className="h-9"
                data-testid={`bulk-${a.ke}-order`}
                disabled={mengirim || terpilih.size === 0}
                onClick={() => void aksiMassal(a.ke)}
              >
                {a.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="destructive"
              className="h-9"
              data-testid="hapus-order-borongan"
              disabled={mengirim || terpilih.size === 0}
              onClick={() =>
                setHapusTarget(
                  (orders ?? []).filter((o) => terpilih.has(kunciOrder(o))).map((o) => ({ mp: o.marketplace, no: o.no_pesanan, ke: "" })),
                )
              }
            >
              Hapus
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              data-testid="preview-picklist-order"
              // Syarat yang SAMA dengan tombol PDF di sebelahnya (adaYangDipilih): mode lain
              // tetap butuh order, gabung-order boleh HANYA advance — kalau tidak, kasus
              // "tidak ada order yang perlu dicetak tapi ada barang advance yang harus
              // disiapkan" tidak bisa dijangkau sama sekali, padahal itu justru alasan mode
              // ini dipakai.
              disabled={!adaYangDipilih()}
              onClick={bukaPreview}
            >
              <Eye data-icon="inline-start" />
              Preview Picklist
            </Button>
            <Button
              size="sm"
              className="h-9"
              data-testid="download-picklist-order"
              disabled={!adaYangDipilih()}
              onClick={unduhPicklist}
            >
              <FileDown data-icon="inline-start" />
              Picklist PDF
            </Button>
            <Select value={modePicklist} onValueChange={(v) => typeof v === "string" && setModePicklist(v as ModePicklist)}>
              <SelectTrigger className="h-9 w-32" data-testid="mode-picklist-order">
                <SelectValue>{(v: string | null) => MODE_PICKLIST.find((m) => m.mode === v)?.label ?? "Per Paket"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MODE_PICKLIST.map((m) => (
                    <SelectItem key={m.mode} value={m.mode}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        {modePicklist === "gabung-order" ? (
          // Panel pilihan advance: menggantikan bantuan satu baris yang lama. Bantuan itu
          // menjelaskan mode, tapi tidak memberi user cara MENGENDALIKAN isinya — dan itulah
          // keluhan pemilik ("harus checklist pesanan satu satu"): jalur lama menarik SEMUA
          // booking `menunggu` di database tanpa melihat pilihan, sehingga lembar berisi
          // advance milik siapa pun. Sekarang yang tidak dicentang tidak ikut.
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="panel-advance-gabung-order">
            <p className="text-xs text-muted-foreground">
              Mode ini menggabungkan order terpilih dengan booking advance DI BAWAH ke satu lembar PDF, digabung per SKU + lokasi gudang —
              picker mengambil barang sekali saja untuk keduanya. Hanya booking yang dicentang yang ikut tercetak.
            </p>
            {bookingError ? (
              <Alert variant="destructive" data-testid="error-booking-gabung-order">
                <AlertTitle>Gagal memuat booking advance</AlertTitle>
                <AlertDescription>{bookingError}</AlertDescription>
              </Alert>
            ) : bookingTersedia === null ? (
              <div className="space-y-2" aria-label="Memuat booking advance">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : bookingTersedia.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="booking-gabung-order-kosong">
                Tidak ada booking advance berstatus “menunggu”. Lembar akan berisi order saja.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground" data-testid="jumlah-booking-terpilih">
                    {bookingTerpilih.size} dari {bookingTersedia.length} advance dipilih
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 md:h-7"
                    data-testid="pilih-semua-booking-gabung-order"
                    onClick={() =>
                      setBookingTerpilih(
                        bookingTerpilih.size === bookingTersedia.length ? new Set() : new Set(bookingTersedia.map((b) => b.booking_sn)),
                      )
                    }
                  >
                    {bookingTerpilih.size === bookingTersedia.length ? "Kosongkan advance" : "Pilih semua advance"}
                  </Button>
                </div>
                {/* Daftar centang, bukan ringkasan angka: SKU + nama + qty adalah yang dibutuhkan
                    user untuk memutuskan booking mana yang layak ikut ke rak, dan itu juga bukti
                    bahwa yang tercetak = yang dia pilih sendiri. */}
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                  <Table data-testid="tabel-booking-gabung-order">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">Ikut</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Nama Produk</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bookingTersedia.map((b) => (
                        <TableRow key={b.booking_sn}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="size-5 accent-primary"
                              aria-label={`Ikutkan advance ${b.sku}`}
                              data-testid={`pilih-booking-${b.booking_sn}`}
                              checked={bookingTerpilih.has(b.booking_sn)}
                              onChange={() => toggleBooking(b.booking_sn)}
                            />
                          </TableCell>
                          <TableCell className="font-medium tabular-nums">{b.sku}</TableCell>
                          <TableCell className="max-w-56 truncate" title={b.nama_produk}>
                            {b.nama_produk}
                            {b.variasi ? <span className="text-muted-foreground"> · {b.variasi}</span> : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{b.qty}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Gagal memuat</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : orders === null ? (
          <div className="space-y-2" aria-label="Memuat order">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <Empty data-testid="order-kosong">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageSearch />
              </EmptyMedia>
              <EmptyTitle>Tidak ada order</EmptyTitle>
              <EmptyDescription>Belum ada pesanan cocok filter.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Pilih</TableHead>
                  <TableHead>
                    <TombolUrut kolom="no_pesanan" label="No Pesanan" aktif={kolomUrut} arah={arah} onUrut={urutkan} />
                  </TableHead>
                  <TableHead>
                    <TombolUrut kolom="marketplace" label="MP" aktif={kolomUrut} arah={arah} onUrut={urutkan} />
                  </TableHead>
                  <TableHead>
                    <TombolUrut kolom="no_resi" label="No Resi" aktif={kolomUrut} arah={arah} onUrut={urutkan} />
                  </TableHead>
                  <TableHead>
                    <TombolUrut kolom="tanggal" label="Tanggal & Waktu" aktif={kolomUrut} arah={arah} onUrut={urutkan} />
                  </TableHead>
                  <TableHead>
                    <TombolUrut kolom="status_fulfill" label="Status" aktif={kolomUrut} arah={arah} onUrut={urutkan} />
                  </TableHead>
                  {/* Item / Total / Pengiriman: TANPA tombol urut. Nilainya agregat SUM dari
                      order_items dan gabungan string jasa kirim — jendela urut server adalah
                      kolom header orders, jadi kolom ini tidak bisa diurutkan konsisten dengan
                      paginasi. Tombol yang diklik tapi tidak mengubah urutan lebih buruk
                      daripada tidak ada tombol. */}
                  <TableHead className="text-right">Item</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Pengiriman</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Tag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={`${o.marketplace}/${o.no_pesanan}`} data-testid={`order-${o.no_pesanan}`}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        aria-label={`Pilih ${o.no_pesanan}`}
                        data-testid={`pilih-${o.no_pesanan}`}
                        checked={terpilih.has(kunciOrder(o))}
                        onChange={() => togglePilih(o)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{o.no_pesanan}</TableCell>
                    <TableCell>{o.marketplace}</TableCell>
                    <TableCell className="tabular-nums">
                      {o.no_resi ? o.no_resi : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    {/* Tanggal + JAM (WIB). Jam-nya sudah lama tersimpan: jalur impor Shopee
                        mem-parse kolom "Waktu Pesanan Dibuat" jadi epoch PENUH
                        (lib/d1/orderImportShopee.ts), bukan tengah malam — yang lama cuma
                        dipotong `slice(0,10)` di sini sehingga jamnya tak pernah terlihat.
                        Semua format WIB ditentukan di helper bersama, jadi tampilan ini tidak
                        bergantung zona browser dan tidak bisa menyimpang dari format di PDF. */}
                    <TableCell>
                      <SelTanggalWaktu stamp={o.tanggal} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{LABEL_STATUS[o.status_fulfill] ?? o.status_fulfill}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{o.items.reduce((a, i) => a + i.qty, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(o.items.reduce((a, i) => a + i.subtotal, 0))}</TableCell>
                    <TableCell data-testid={`pengiriman-${o.no_pesanan}`}>
                      {/* Jasa kirim + tipe layanan digabung " · "; yang kosong dilewati supaya
                          tidak muncul pemisah menggantung saat file impor hanya menyebut salah satu. */}
                      {[o.jasa_kirim, o.tipe_layanan].filter((s) => s && s.trim()).join(" · ") || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {o.items.length > 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-9 md:h-7"
                            data-testid={`rincian-${o.no_pesanan}`}
                            onClick={() => setRincian(o)}
                          >
                            {o.items.length} item
                          </Button>
                        )}
                        {(TRANSISI[o.status_fulfill] ?? []).map((t) => (
                          <Button
                            key={t.ke}
                            size="sm"
                            variant={t.ke === "batal" ? "destructive" : "outline"}
                            className="h-9 md:h-7"
                            data-testid={`transisi-${t.ke}-${o.no_pesanan}`}
                            onClick={() =>
                              setTarget({ mp: o.marketplace, no: o.no_pesanan, ke: t.ke })
                            }
                          >
                            {t.label}
                          </Button>
                        ))}
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-9 md:h-7"
                          data-testid={`hapus-${o.no_pesanan}`}
                          disabled={mengirim}
                          onClick={() => setHapusTarget([{ mp: o.marketplace, no: o.no_pesanan, ke: "" }])}
                        >
                          Hapus
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell data-testid={`tag-ekspor-${o.no_pesanan}`}>
                      {/* Satu badge per mode yang sudah pernah dicetak; urutan tetap sama seperti
                          URUTAN_EKSPOR supaya posisi badge tidak berpindah-pindah antar baris/turn. */}
                      {(() => {
                        const sudah = ekspor[kunciOrder(o)] ?? [];
                        const urut = URUTAN_EKSPOR.filter((m) => sudah.includes(m));
                        if (urut.length === 0) return <span className="text-muted-foreground">—</span>;
                        return (
                          <div className="flex flex-wrap gap-1.5">
                            {urut.map((m) => (
                              <Badge
                                key={m}
                                variant="secondary"
                                data-testid={`tag-${m}-${o.no_pesanan}`}
                                title={`Picklist mode ${LABEL_EKSPOR[m]} sudah pernah dicetak`}
                              >
                                {LABEL_EKSPOR[m]}
                              </Badge>
                            ))}
                          </div>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Footer paginasi: komponen BERSAMA components/dashboard/footer-paginasi.tsx (sama
            dengan /stok dan /histori), presentasi saja — pemanggil yang mengambil datanya.
            Ia memakai `total` dari COUNT(*) server, bukan panjang array halaman. */}
        {orders !== null && orders.length > 0 ? (
          <FooterPaginasi
            halaman={halaman}
            jumlahHalaman={jumlahHalaman}
            barisTampil={orders.length}
            mulai={(halaman - 1) * UKURAN_HALAMAN}
            total={total}
            onHalaman={setHalaman}
            sibuk={memuatHalaman}
          />
        ) : null}
      </div>

      <AlertDialog
        open={target !== null}
        onOpenChange={(v) => {
          if (!mengirim && !v) setTarget(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-transisi-order">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target ? `Ubah ${target.no} → ${target.ke}?` : "Ubah status?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target?.ke === "batal"
                ? "Batal hanya mengubah status di sini — stok TIDAK dikembalikan WMS, karena potong stok dilakukan di Kledo. Batalkan juga di Kledo bila stok perlu masuk kembali. Lanjut?"
                : "Status order berubah. Stok tidak dipotong di sini — potong stok dilakukan admin Kledo. Lanjut?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="batal-transisi-order"
              onClick={() => setTarget(null)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="konfirmasi-transisi-order"
              onClick={() => void kirim()}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Memproses…" : "Ya, lanjut"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={hapusTarget !== null}
        onOpenChange={(v) => {
          if (!mengirim && !v) setHapusTarget(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-hapus-order">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hapusTarget && hapusTarget.length === 1 ? `Hapus order ${hapusTarget[0].no}?` : `Hapus ${hapusTarget?.length ?? 0} order?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Order hilang dari daftar ini dan dari picklist. Bila salah hapus, order harus diimpor ULANG dari file marketplace.
              Stok di WMS tidak berubah — koreksi stok tetap dilakukan di Kledo. Lanjut hapus?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="batal-hapus-order"
              onClick={() => setHapusTarget(null)}
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              disabled={mengirim}
              data-testid="konfirmasi-hapus-order"
              onClick={() => void hapusOrder(hapusTarget ?? [])}
            >
              {mengirim ? <Spinner data-icon="inline-start" /> : null}
              {mengirim ? "Menghapus…" : "Ya, hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DialogImportExcel open={importOpen} onOpenChange={setImportOpen} tipe="pesanan" onSukses={() => void muat()} />
      <DialogImportOrder open={importOrderOpen} onOpenChange={setImportOrderOpen} onSukses={() => void muat()} />

      {/* Pratinjau picklist. Tinggi dibatasi 80dvh dan isinya bisa di-scroll (`dvh` = tinggi
          pandangan yang menyusut saat keyboard Telegram naik; `vh` biasa membuat tombol Export
          terdorong keluar layar). Kolom banyak → tabel punya overflow-x sendiri supaya di HP
          baris tidak dipaksa mengecil sampai tak terbaca. */}
      <Dialog open={previewBuka} onOpenChange={(v) => setPreviewBuka(v)}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-3xl" data-testid="dialog-preview-picklist">
          <DialogHeader>
            <DialogTitle data-testid="judul-preview-picklist">{preview?.judul ?? "Preview Picklist"}</DialogTitle>
            <DialogDescription>
              Yang akan tercetak bila Anda menekan Export PDF sekarang. Jumlah baris dan urutannya adalah hasil
              penggabungan per SKU di server — bukan sekadar daftar order di belakang.
            </DialogDescription>
          </DialogHeader>

          {previewError ? (
            <Alert variant="destructive" data-testid="error-preview-picklist">
              <AlertTitle>Gagal memuat pratinjau</AlertTitle>
              <AlertDescription>{previewError}</AlertDescription>
            </Alert>
          ) : null}

          {previewMemuat ? (
            <div className="space-y-2" aria-label="Memuat pratinjau picklist" data-testid="memuat-preview-picklist">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : null}

          {!previewMemuat && preview ? (
            <>
              {/* Ringkasan teks, bukan cuma angka di dalam tabel: baris & unit adalah dua angka
                  yang dipakai picker untuk memutuskan lembar ini masuk akal, dan keduanya harus
                  terbaca di HP tanpa menggulir tabel ke bawah. */}
              {/* Apa yang IKUT, disebut eksplisit. Keluhan pemilik berakar pada mode yang
                  diam-diam memasukkan barang yang tidak dia pilih; satu baris ini membuat
                  perilaku itu mustahil disalahpahami tanpa membuka daftar di belakang.
                  Angka sisi order/advance diambil dari SERVER, bukan dari centang klien:
                  server memverifikasi tiap booking_sn masih `menunggu` dan membuang yang
                  tidak, jadi centang klien bisa lebih banyak daripada yang benar-benar ikut. */}
              <p className="text-sm text-muted-foreground" data-testid="isi-preview-picklist">
                {(preview.total_order ?? terpilih.size)} order
                {modePicklist === "gabung-order" ? ` + ${preview.total_advance ?? bookingTerpilih.size} advance` : ""} ·{" "}
                {preview.total_baris} baris · {preview.total_unit} unit
              </p>
              {preview.ada_bermasalah > 0 ? (
                <Alert data-testid="peringatan-perlu-sku-preview-picklist">
                  <AlertTitle>{preview.ada_bermasalah} baris belum ber-SKU</AlertTitle>
                  {/* Alasan lengkap ditulis di badan alert, bukan tooltip: di HP tidak ada hover,
                      dan checker harus tahu apa yang harus dia lakukan tanpa menebak. */}
                  <AlertDescription>
                    Baris itu barangnya belum punya master SKU, jadi tetap tercetak di bagian “PERLU SKU” dengan nama asli
                    dari berkas impor. Cocokkan manual ke master produk sebelum barang diambil; naming di lembar ini
                    belum pasti benar.
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table data-testid="tabel-preview-picklist">
                  <TableHeader>
                    <TableRow>
                      {/* Header dirender dari `kolom` milik server: jumlah dan nama kolom
                          memang berbeda per mode (pisah tanpa Lokasi Gudang, gabung menyisipkan
                          kolom resi). Header tetap di klien akan bohong di salah satu mode. */}
                      {preview.kolom.map((k) => {
                        const kunci = URUT_PER_KOLOM_PREVIEW[k];
                        const kanan = k === "Quantity Total" || k === "Qty";
                        return (
                          <TableHead key={k} className={kanan ? "text-right" : undefined}>
                            {kunci ? (
                              <TampilkanTombolUrutPreview
                                kunci={kunci}
                                label={k}
                                aktif={previewUrut}
                                arah={previewArah}
                                onUrut={urutPreview}
                              />
                            ) : (
                              k
                            )}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.baris.map((b, i) => (
                      <TableRow key={`${b.sku}-${b.grup ?? b.lokasi ?? ""}-${i}`}>
                        {preview.kolom.map((k) => (
                          <TableCell
                            key={k}
                            className={
                              k === "Quantity Total" || k === "Qty" ? "text-right font-medium tabular-nums" : undefined
                            }
                          >
                            {isiKolomPreview(k, b)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {preview.baris.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="preview-picklist-kosong">
                  Tidak ada baris untuk dicetak dari pilihan ini.
                </p>
              ) : null}
            </>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              className="h-11 md:h-9"
              data-testid="tutup-preview-picklist"
              onClick={() => setPreviewBuka(false)}
            >
              Tutup
            </Button>
            <Button
              className="h-11 md:h-9"
              data-testid="export-pdf-preview-picklist"
              disabled={previewMemuat || !preview || preview.baris.length === 0}
              onClick={eksporDariPreview}
            >
              <FileDown data-icon="inline-start" />
              Export PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rincian)} onOpenChange={(v) => !v && setRincian(null)}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-2xl" data-testid="dialog-rincian-order">
          <DialogHeader>
            <DialogTitle>Rincian {rincian?.no_pesanan}</DialogTitle>
            <DialogDescription>
              {rincian?.items.length === 1
                ? "1 jenis barang pada pesanan ini."
                : `${rincian?.items.length} jenis barang; baris dengan SKU & variasi sama sudah digabung.`}
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Nama Shopee</TableHead>
                <TableHead>Variasi</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rincian?.items ?? []).map((it, i) => (
                <TableRow key={`${it.sku}-${it.variasi}-${i}`}>
                  <TableCell className="font-medium tabular-nums">{it.sku}</TableCell>
                  <TableCell className="max-w-56 truncate" title={it.nama_shopee}>{it.nama_shopee}</TableCell>
                  <TableCell>{it.variasi || "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{it.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(it.subtotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Tombol urut header PRATINJAU. Sama perilakunya dengan TombolUrut, tapi kuncinya
 * `KunciUrutPicklist` (allowlist picklist: default|sku|nama|lokasi) dan BUKAN kolom tabel
 * order — karena mengurutkan pratinjau = meminta SERVER mengurutkan ulang lewat `urut`/`arah`,
 * bukan menyortir array di klien.
 *
 * Kenapa tidak menumpangkan TombolUrut: tipenya berbeda (`KolomUrut` vs `KunciUrutPicklist`)
 * dan `default` tidak punya kolom di layar, jadi memaksakan satu komponen berarti menambah
 * cabang tipe di dalamnya — lebih murah satu komponen kecil daripada satu komponen bercabang.
 */
function TampilkanTombolUrutPreview({
  kunci,
  label,
  aktif,
  arah,
  onUrut,
}: {
  kunci: KunciUrutPicklist;
  label: string;
  aktif: KunciUrutPicklist;
  arah: ArahUrut;
  onUrut: (k: KunciUrutPicklist) => void;
}) {
  const ini = kunci === aktif;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="-ml-2 h-8 gap-1 px-2 font-medium"
      data-testid={`urut-preview-${kunci}`}
      aria-label={`Urutkan ${label}${ini ? (arah === "asc" ? " menaik" : " menurun") : ""}`}
      onClick={() => onUrut(kunci)}
    >
      {label}
      {ini ? (
        arah === "asc" ? (
          <ArrowUp data-icon="inline-end" data-testid={`urut-preview-${kunci}-asc`} />
        ) : (
          <ArrowDown data-icon="inline-end" data-testid={`urut-preview-${kunci}-desc`} />
        )
      ) : (
        <ChevronsUpDown className="opacity-40" data-icon="inline-end" />
      )}
    </Button>
  );
}

/**
 * Isi satu sel pratinjau: kolom dicocokkan lewat NAMA HEADER kiriman server.
 *
 * Kenapa lewat nama, bukan indeks: jumlah & susunan kolom berbeda per mode, jadi `<td>` ke-n
 * bukan kolom yang sama di mode lain. Mencocokkan nama membuat mode baru (kolom baru) hanya
 * menambah cabang di sini, bukan memindahkan isi ke sel yang salah tanpa error ketik.
 * Nama tak dikenal → string kosong, bukan `undefined` yang bikin React melempar.
 */
function isiKolomPreview(kolom: string, b: BarisPreviewPicklist) {
  switch (kolom) {
    case "No":
      return <span className="tabular-nums">{b.no}</span>;
    case "Nama Produk":
      return b.nama;
    case "SKU":
      return (
        // `perluSku` = baris ini tidak punya master SKU. Ditandai di kolom SKU (bukan kolom
        // terpisah) karena di situlah checker melihat masalahnya; warnanya menumpang Badge
        // agar tetap terbaca di mode gelap/terang tanpa warna hardcode.
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium tabular-nums">{b.sku}</span>
          {b.perluSku ? (
            <Badge variant="destructive" data-testid="badge-perlu-sku-preview">
              PERLU SKU
            </Badge>
          ) : null}
        </span>
      );
    case "Lokasi Gudang":
      return b.lokasi ? b.lokasi : <span className="text-muted-foreground">—</span>;
    case "Quantity Total":
    case "Qty":
      return b.qty;
    case "Resi":
    case "Paket":
    case "Grup":
      // Kolom grup (resi/paket) dipakai mode `gabung`/`per_paket`: baris tanpa resi tetap
      // dibedakan server lewat label "NO-RESI: ..." supaya dua paket tanpa resi tidak tampak
      // satu paket di pratinjau padahal PDF mencetaknya sebagai lembar terpisah.
      return b.grup ? b.grup : <span className="text-muted-foreground">—</span>;
    default:
      // Kolom tak dikenal dari server. ASUMSI: nama kolom yang dikirim server adalah LABEL
      // yang boleh dilihat user. Kalau suatu saat server mengirim header berkunci internal
      // (mis. `skuAsal`), jalur ini akan MENCETAK nilai internal itu ke layar — bukan pesan
      // kosong yang aman. Karena itu nilainya sengaja TIDAK dipakai; lebih baik kolom baru
      // tampil kosong dan ketahuan belum dipetakan daripada menampilkan data internal
      // seolah-olah isi produk. Tambahkan `case` bernama di atas untuk kolom baru.
      return <span className="text-muted-foreground">—</span>;
  }
}

/**
 * Tanggal + JAM (WIB) untuk kolom daftar order.
 *
 * Dua BARIS, bukan satu string panjang: "15 Okt 2025, 20.04 WIB" selebar ~170px dan di HP
 * (360px) kolom itu jadi yang terlebar di tabel sehingga ikut memaksa seluruh baris menggulir
 * jauh. Dengan tanggal di atas dan jam di bawah, kolomnya menyempit dan jamnya justru lebih
 * mudah dipindai mata.
 *
 * Jam ditulis sebagai elemen TERPISAH, bukan hasil potong string, supaya tanggal dan jam
 * tidak bisa salah pisah; format tiap bagian tetap dari helper bersama (satu-satunya tempat
 * zona WIB ditentukan).
 */
function SelTanggalWaktu({ stamp }: { stamp: number }) {
  const tgl = formatTanggalJamWibBagian(stamp, "tanggal");
  const jam = formatTanggalJamWibBagian(stamp, "jam");
  if (tgl === null || jam === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col leading-tight">
      <span className="whitespace-nowrap tabular-nums">{tgl}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{jam} WIB</span>
    </div>
  );
}

/**
 * Tombol urut di header tabel.
 *
 * Kenapa tombol, bukan ikon pasif yang bisa diklik: area klik header `<th>` sulit dijangkau
 * di mobile, sedangkan Button membawa fokus keyboard + `aria-sort` dari induknya. Ikon
 * ChevronsUpDown tampil saat kolom TIDAK aktif supaya user tahu kolom ini bisa diurutkan,
 * ArrowUp/ArrowDown saat aktif supaya arahnya terbaca tanpa menebak.
 *
 * Satu tombol SEDERHANA menggantikan tombol asc + desc terpisah: itu satu kontrol per kolom,
 * dan arahnya dibalik oleh klik berikutnya (pola yang sama dengan sortir tabel biasa).
 */
function TombolUrut({
  kolom,
  label,
  aktif,
  arah,
  onUrut,
}: {
  kolom: KolomUrut;
  label: string;
  aktif: KolomUrut;
  arah: ArahUrut;
  onUrut: (k: KolomUrut) => void;
}) {
  const ini = kolom === aktif;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="-ml-2 h-8 gap-1 px-2 font-medium"
      data-testid={`urut-${kolom}`}
      // aria-sort harus di elemen kolom; Button di dalam <th> bukan pemilik peran kolom,
      // jadi nilainya ditulis sebagai data-* untuk pengujian dan aria-label untuk pembaca
      // layar — menggantungkan aria-sort di sini akan berbohong soal perannya.
      aria-label={`Urutkan ${label}${ini ? (arah === "asc" ? " menaik" : " menurun") : ""}`}
      onClick={() => onUrut(kolom)}
    >
      {label}
      {ini ? (
        arah === "asc" ? (
          <ArrowUp data-icon="inline-end" data-testid={`urut-${kolom}-asc`} />
        ) : (
          <ArrowDown data-icon="inline-end" data-testid={`urut-${kolom}-desc`} />
        )
      ) : (
        <ChevronsUpDown className="opacity-40" data-icon="inline-end" />
      )}
    </Button>
  );
}
