"use client";

// components/dashboard/analisa-estimasi-iklan.tsx — Estimasi iklan per SKU.
//
// Prinsip repo: ANGKA SELALU DARI SERVER (lib/analisa/iklanEstimasi, murni + teruji).
// Komponen ini TIDAK menghitung apa pun; ia mengumpulkan modal/target per SKU dari user,
// mengirimnya ke /api/analisa?aksi=estimasi-iklan, lalu menampilkan hasilnya.
//
// Kolom "rata 1/2/3" adalah TIGA SKENARIO, bukan rata-rata biasa:
//   1 = konservatif = hari TERBURUK (omzet terendah dari histori)
//   2 = netral      = hari MEDIAN
//   3 = optimis     = hari TERBAIK (omzet tertinggi)
// Itu keputusan pemilik repo (lihat lib/analisa/iklanEstimasi.ts) supaya SKU yang rapuh
// terlihat: aman di hari buruk tapi rugi di hari ramai. Jangan diubah jadi mean.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Plus, Sparkles, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { formatAngka, formatRupiah } from "@/lib/dashboard/format";
import type { HasilEstimasi, RingkasEstimasi, StatusEstimasi } from "@/lib/analisa/iklanEstimasi";
import type { PaketSkenario } from "@/lib/analisa/skenarioIklan";

/** Baris produk dari /api/baca?scope=produk. */
type ProdukMaster = { sku: string; nama_accurate: string | null };

/** Modal & target per SKU terpilih. Disimpan sebagai string supaya input number terasa wajar. */
type SetelanSku = { modal: string; target: string };

type ResponsEstimasi = {
  ok: boolean;
  error?: string;
  baris?: HasilEstimasi[];
  ringkas?: RingkasEstimasi;
  /** SKU yang punya histori — dikirim server saat `items` kosong. */
  tersedia?: { sku: string; jmlHari: number }[];
};

/** Label + warna status supaya artinya terbaca tanpa membuka alasan. */
const GAYA_STATUS: Record<StatusEstimasi, { label: string; kelas: string }> = {
  aman: { label: "Aman", kelas: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" },
  tipis: { label: "Tipis", kelas: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  rugi: { label: "Rugi", kelas: "bg-red-600/15 text-red-700 dark:text-red-400" },
  belum_cukup_data: { label: "Belum cukup data", kelas: "bg-muted text-muted-foreground" },
};

/** Alasan berhenti dari server → peringatan yang dilihat pemilik. Tidak ada di sini = tidak dirender. */
const PESAN_SELESAI: Record<string, string> = {
  length: "Jawaban TERPOTONG karena plafon token. Naikkan Maks Token, lalu minta saran ulang.",
  content_filter: "Jawaban diblokir penyedia (content filter). Ubah pertanyaan atau ganti model.",
};

/** null → "—". BUKAN 0: nol berarti terukur nol, null berarti belum ada datanya. */
function angka(n: number | null): string {
  return n === null ? "—" : formatAngka(n);
}

/** Rupiah atau "—" bila memang tidak ada data. */
function rupiah(n: number | null): string {
  return n === null ? "—" : formatRupiah(n);
}

/** Label pemilih: nama produk DAN SKU. Nama kosong → SKU saja, jangan tampil "- SKU". */
function labelProduk(p: ProdukMaster): string {
  const nama = (p.nama_accurate ?? "").trim();
  return nama === "" ? p.sku : `${nama} - ${p.sku}`;
}

export function AnalisaEstimasiIklan({
  presetId,
  tanggal,
}: {
  presetId: number;
  /** Tanggal snapshot terakhir; hanya dipakai sebagai jejak untuk permintaan saran AI. */
  tanggal: string;
}) {
  const [produk, setProduk] = useState<ProdukMaster[]>([]);
  const [pilihan, setPilihan] = useState<string | null>(null);
  const [terpilih, setTerpilih] = useState<string[]>([]);
  const [setelan, setSetelan] = useState<Record<string, SetelanSku>>({});
  const [hariKe, setHariKe] = useState("");
  const [hasil, setHasil] = useState<HasilEstimasi[] | null>(null);
  const [ringkas, setRingkas] = useState<RingkasEstimasi | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [saran, setSaran] = useState("");
  /** Teks proses berpikir model — dipisah dari narasi supaya tidak tercampur jawaban. */
  const [pikir, setPikir] = useState("");
  /** Alasan server berhenti ("length" / "content_filter") — kosong berarti jawaban utuh. */
  const [selesaiAlasan, setSelesaiAlasan] = useState("");
  /** Paket angka dari server (fakta + tiga skenario) — tiba SEBELUM narasi mengalir. */
  const [paket, setPaket] = useState<PaketSkenario | null>(null);
  const [memuatSaran, setMemuatSaran] = useState(false);

  // Daftar produk untuk pemilih. Endpoint ini yang dipakai repo (tidak ada /api/produk).
  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const res = await fetch("/api/baca?scope=produk", { credentials: "include" });
        const d = (await res.json().catch(() => null)) as { ok?: boolean; rows?: ProdukMaster[] } | null;
        if (batal) return;
        if (d?.ok) setProduk(d.rows ?? []);
        else tampilkanGagalTulis("Daftar produk gagal dimuat — pemilih produk dikosongkan.");
      } catch {
        if (!batal) tampilkanGagalTulis("Daftar produk gagal dimuat (jaringan).");
      }
    })();
    return () => { batal = true; };
  }, []);

  // Preset berganti = hasil preset lama tidak berlaku lagi. Menampilkannya akan
  // mencampur angka dua preset yang berbeda tanpa satu pun tanda.
  useEffect(() => {
    setHasil(null);
    setRingkas(null);
    setSaran("");
    setPikir("");
    setSelesaiAlasan("");
    setPaket(null);
  }, [presetId]);

  const opsi = useMemo(
    () => produk.map((p) => ({ value: p.sku, label: labelProduk(p) })),
    [produk]
  );

  /** SKU yang sudah dipilih tidak ditawarkan lagi — mencegah baris ganda. */
  const opsiTersisa = useMemo(
    () => opsi.filter((o) => !terpilih.includes(o.value)),
    [opsi, terpilih]
  );

  const namaSku = useCallback(
    (sku: string) => {
      const p = produk.find((x) => x.sku === sku);
      return p ? labelProduk(p) : sku;
    },
    [produk]
  );

  function tambah() {
    if (!pilihan || terpilih.includes(pilihan)) return;
    setTerpilih((l) => [...l, pilihan]);
    setSetelan((s) => ({ ...s, [pilihan]: s[pilihan] ?? { modal: "", target: "" } }));
    setPilihan(null);
  }

  function hapus(sku: string) {
    setTerpilih((l) => l.filter((x) => x !== sku));
    setSetelan((s) => {
      const salinan = { ...s };
      delete salinan[sku];
      return salinan;
    });
  }

  async function hitung(tampilkanGagal = true) {
    if (!presetId || terpilih.length === 0) return;
    setMemuat(true);
    try {
      // Format "sku:modal:target" — server memisahnya; modal/target kosong jadi 0
      // dan server membalas status "belum_cukup_data" alih-alih menebak angka.
      const items = terpilih
        .map((sku) => {
          const s = setelan[sku] ?? { modal: "", target: "" };
          return `${sku}:${s.modal || 0}:${s.target || 0}`;
        })
        .join(",");
      const res = await fetch(
        `/api/analisa?aksi=estimasi-iklan&presetId=${presetId}&items=${encodeURIComponent(items)}`,
        { credentials: "include" }
      );
      const d = (await res.json().catch(() => null)) as ResponsEstimasi | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal menghitung (${res.status}).`);
      setHasil(d.baris ?? []);
      setRingkas(d.ringkas ?? null);
    } catch (e) {
      if (tampilkanGagal) tampilkanGagalTulis(e instanceof Error ? e.message : "Estimasi iklan gagal.");
    } finally {
      setMemuat(false);
    }
  }

  /**
   * Saran langkah iklan (narasi AI). Angka tetap dari tabel di atas; AI hanya menarasikan.
   *
   * Memakai `saran-iklan-stream`, BUKAN `mendalam-stream`. Alasannya dua, dan keduanya
   * nyata di pemakaian:
   *   1. `mendalam-stream` menjawab pertanyaan analisa penjualan umum (prompt `PROMPT_SISTEM`),
   *      sedangkan tombol ini menanyakan rencana bertahap per keadaan iklan (prompt
   *      `PROMPT_SISTEM_SKENARIO`). Memakai yang pertama membuat jawabannya tidak menyambung
   *      dengan yang ditanyakan user.
   *   2. Jalur skenario mengirim paket angka lebih dulu (event `{paket}`), jadi user melihat
   *      angka yang dipakai AI sebelum narasinya tiba.
   *
   * Streaming (bukan JSON utuh) tetap dipakai karena model penalaran bisa berpikir lebih
   * lama daripada batas tunggu mana pun: dengan aliran, potongan pertama tiba dalam hitungan
   * detik dan request tidak dianggap gagal hanya karena totalnya lama.
   *
   * Server membalas `text/event-stream` berisi `{paket}` sekali, lalu `{pikir}` berulang (teks
   * proses berpikir model, terpisah dari jawaban), lalu `{delta}` berulang, lalu
   * `{selesai, provider, model, selesaiAlasan?}` atau `{error}`. Kita baca manual (bukan
   * EventSource) karena endpoint ini POST + butuh sesi.
   */
  async function mintaSaran() {
    setMemuatSaran(true);
    setSaran("");
    setPikir("");
    setSelesaiAlasan("");
    setPaket(null);
    // modalIklan = jumlah modal semua SKU terpilih; targetRoas = rata-rata target yang
    // diisi (0 bila tidak ada). Server memakai keduanya sebagai angka paket skenario.
    const modalIklan = terpilih.reduce((t, sku) => {
      const n = Number(setelan[sku]?.modal ?? "");
      return t + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
    const targetTerisi = terpilih
      .map((sku) => Number(setelan[sku]?.target ?? ""))
      .filter((n) => Number.isFinite(n) && n > 0);
    const targetRoas =
      targetTerisi.length > 0
        ? Math.round((targetTerisi.reduce((a, b) => a + b, 0) / targetTerisi.length) * 100) / 100
        : 0;
    try {
      const res = await fetch("/api/analisa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          aksi: "saran-iklan-stream",
          presetId,
          tanggal,
          hariKe: hariKe === "" ? 0 : Number(hariKe),
          modalIklan,
          targetRoas,
        }),
      });
      // Gagal sebelum stream dimulai masih balas JSON/status non-200 biasa.
      if (!res.ok || !res.body) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? `Saran gagal (${res.status}).`);
      }
      const pembaca = res.body.getReader();
      const dekoder = new TextDecoder();
      let buffer = "";
      let teks = "";
      let pikirTeks = "";
      for (;;) {
        const { done, value } = await pembaca.read();
        if (done) break;
        // `stream: true` supaya potongan multibyte yang terbelah antar-chunk tidak rusak.
        buffer += dekoder.decode(value, { stream: true });
        // Pisah per event SSE (`\n\n`); sisa yang belum lengkap disimpan di buffer.
        const bagian = buffer.split("\n\n");
        buffer = bagian.pop() ?? "";
        for (const b of bagian) {
          const baris = b.split("\n").find((l) => l.startsWith("data: "));
          if (!baris) continue;
          let ev: {
            delta?: string;
            error?: string;
            selesai?: boolean;
            paket?: PaketSkenario;
            pikir?: string;
            selesaiAlasan?: string;
          };
          try {
            ev = JSON.parse(baris.slice(6)) as typeof ev;
          } catch {
            continue; // event cacat dilewati, bukan menggagalkan seluruh aliran
          }
          if (ev.error) throw new Error(ev.error);
          // Paket datang lebih dulu: tampilkan supaya user memeriksa angkanya sendiri.
          if (ev.paket) {
            setPaket(ev.paket);
            continue;
          }
          if (ev.delta) {
            teks += ev.delta;
            // Tampilkan bertahap supaya user melihat model sedang bekerja.
            setSaran(teks);
            continue;
          }
          // Pikiran model: state TERPISAH dari `teks`, tidak boleh masuk narasi jawaban.
          if (ev.pikir) {
            pikirTeks += ev.pikir;
            setPikir(pikirTeks);
            continue;
          }
          if (ev.selesaiAlasan) setSelesaiAlasan(ev.selesaiAlasan);
        }
      }
      if (teks.trim() === "") throw new Error("Model tidak mengembalikan narasi.");
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Saran langkah iklan gagal.");
    } finally {
      setMemuatSaran(false);
    }
  }

  return (
    <Card data-testid="kartu-estimasi-iklan">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4" aria-hidden />
          Estimasi Iklan
        </CardTitle>
        <CardDescription>
          Pilih produk, isi <b>Modal Iklan</b> dan <b>Target ROAS</b> per produk, lalu lihat laba
          pada tiga skenario hari. Angka berasal dari data penjualan harian per SKU.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* ── Pemilih multi-SKU: satu Combobox + tombol Tambah, lalu badge yang bisa dihapus ── */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[260px] flex-1">
            <label className="text-xs text-muted-foreground" htmlFor="pilih-produk-estimasi">
              Produk
            </label>
            <Combobox
              id="pilih-produk-estimasi"
              data-testid="pilih-produk-estimasi"
              value={pilihan}
              onChange={setPilihan}
              items={opsiTersisa}
              placeholder="Cari nama atau SKU…"
              kosongTeks="Produk tidak ditemukan"
            />
          </div>
          <Button
            variant="outline"
            className="h-11 md:h-8"
            onClick={tambah}
            disabled={!pilihan}
            data-testid="tombol-tambah-sku"
          >
            <Plus className="size-4" aria-hidden />
            Tambah
          </Button>
          <div className="w-[140px]">
            <label className="text-xs text-muted-foreground" htmlFor="hari-ke-estimasi">
              Hari ke-N
            </label>
            <Input
              id="hari-ke-estimasi"
              data-testid="hari-ke-estimasi"
              type="number"
              inputMode="numeric"
              min={1}
              value={hariKe}
              onChange={(e) => setHariKe(e.target.value)}
              placeholder="mis. 30"
            />
          </div>
        </div>

        {terpilih.length > 0 ? (
          <div className="flex flex-wrap gap-2" data-testid="daftar-sku-terpilih">
            {terpilih.map((sku) => (
              <Badge key={sku} variant="secondary" className="h-6 gap-1 pr-1">
                {namaSku(sku)}
                <button
                  type="button"
                  aria-label={`Hapus ${sku}`}
                  data-testid={`hapus-sku-${sku}`}
                  className="rounded-full p-0.5 hover:bg-foreground/10"
                  onClick={() => hapus(sku)}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Belum ada produk dipilih. Tambahkan minimal satu untuk menghitung.
          </p>
        )}

        {/* ── Modal & target per SKU terpilih ── */}
        {terpilih.length > 0 ? (
          <div className="overflow-x-auto">
            <Table data-testid="tabel-setelan-sku">
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="w-[160px]">Modal Iklan</TableHead>
                  <TableHead className="w-[140px]">Target ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terpilih.map((sku) => (
                  <TableRow key={sku}>
                    <TableCell className="text-sm">{namaSku(sku)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        aria-label={`Modal iklan ${sku}`}
                        data-testid={`modal-${sku}`}
                        value={setelan[sku]?.modal ?? ""}
                        onChange={(e) =>
                          setSetelan((s) => ({
                            ...s,
                            [sku]: { modal: e.target.value, target: s[sku]?.target ?? "" },
                          }))
                        }
                        placeholder="mis. 50000"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step="0.1"
                        aria-label={`Target ROAS ${sku}`}
                        data-testid={`target-${sku}`}
                        value={setelan[sku]?.target ?? ""}
                        onChange={(e) =>
                          setSetelan((s) => ({
                            ...s,
                            [sku]: { modal: s[sku]?.modal ?? "", target: e.target.value },
                          }))
                        }
                        placeholder="mis. 3"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="h-11 md:h-8"
            onClick={() => void hitung()}
            disabled={memuat || terpilih.length === 0}
            data-testid="tombol-hitung-estimasi"
          >
            {memuat ? <Spinner aria-hidden /> : null}
            Hitung Estimasi
          </Button>
          <Button
            variant="outline"
            className="h-11 md:h-8"
            onClick={() => void mintaSaran()}
            disabled={memuatSaran || !presetId}
            data-testid="tombol-saran-langkah"
          >
            {memuatSaran ? <Spinner aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            Saran Langkah Iklan
          </Button>
        </div>

        {/* ── Ringkasan di ATAS tabel: total modal + profit per skenario ── */}
        {ringkas ? (
          <div className="rounded-xl border border-border bg-muted/40 p-3" data-testid="ringkas-estimasi">
            <p className="text-sm">
              {ringkas.jumlahSku} SKU · total modal <b>{formatRupiah(ringkas.totalModal)}</b> ·
              profit konservatif <b>{formatRupiah(ringkas.totalProfit1)}</b> ·
              netral <b>{formatRupiah(ringkas.totalProfit2)}</b> ·
              optimis <b>{formatRupiah(ringkas.totalProfit3)}</b>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Aman {ringkas.jumlahAman} · tipis {ringkas.jumlahTipis} · rugi {ringkas.jumlahRugi} ·
              belum cukup data {ringkas.jumlahBelumCukupData}
            </p>
          </div>
        ) : null}

        {hasil ? (
          hasil.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada SKU yang dihitung.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="tabel-estimasi-iklan">
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-right">Modal Iklan</TableHead>
                    <TableHead className="text-right">Target ROAS</TableHead>
                    <TableHead className="text-right">ROAS ril</TableHead>
                    <TableHead className="text-right">Breakeven ROAS</TableHead>
                    <TableHead className="text-right">Omzet rata 1</TableHead>
                    <TableHead className="text-right">Omzet rata 2</TableHead>
                    <TableHead className="text-right">Omzet rata 3</TableHead>
                    <TableHead className="text-right">Unit terjual rata 1</TableHead>
                    <TableHead className="text-right">Unit terjual rata 2</TableHead>
                    <TableHead className="text-right">Unit terjual rata 3</TableHead>
                    <TableHead className="text-right">Profit rata 1</TableHead>
                    <TableHead className="text-right">Profit rata 2</TableHead>
                    <TableHead className="text-right">Profit rata 3</TableHead>
                  </TableRow>
                  {/* Subjudul skenario: ketiganya BUKAN rata-rata biasa. */}
                  <TableRow>
                    <TableHead className="text-xs font-normal text-muted-foreground" />
                    <TableHead className="text-xs font-normal text-muted-foreground" colSpan={4} />
                    <TableHead className="text-right text-xs font-normal text-muted-foreground">konservatif</TableHead>
                    <TableHead className="text-right text-xs font-normal text-muted-foreground">netral</TableHead>
                    <TableHead className="text-right text-xs font-normal text-muted-foreground">optimis</TableHead>
                    <TableHead className="text-right text-xs font-normal text-muted-foreground">konservatif</TableHead>
                    <TableHead className="text-right text-xs font-normal text-muted-foreground">netral</TableHead>
                    <TableHead className="text-right text-xs font-normal text-muted-foreground">optimis</TableHead>
                    <TableHead className="text-right text-xs font-normal text-muted-foreground">konservatif</TableHead>
                    <TableHead className="text-right text-xs font-normal text-muted-foreground">netral</TableHead>
                    <TableHead className="text-right text-xs font-normal text-muted-foreground">optimis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hasil.map((b) => (
                    <TableRow key={b.sku}>
                      <TableCell className="min-w-[220px]">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm">{namaSku(b.sku)}</span>
                          <span className="flex flex-wrap items-center gap-1">
                            <Badge
                              className={GAYA_STATUS[b.status].kelas}
                              data-testid={`status-${b.sku}`}
                            >
                              {GAYA_STATUS[b.status].label}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{b.alasan}</span>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(b.modalIklan)}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.targetRoas > 0 ? `${b.targetRoas}×` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.roasRil === null ? "—" : `${b.roasRil}×`}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.roasImpas === null ? "—" : `${b.roasImpas}×`}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(b.omzetRata1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(b.omzetRata2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(b.omzetRata3)}</TableCell>
                      <TableCell className="text-right tabular-nums">{angka(b.unitRata1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{angka(b.unitRata2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{angka(b.unitRata3)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(b.profitRata1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(b.profitRata2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(b.profitRata3)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        ) : null}

        {/* ── Kartu saran AI ── */}
        {memuatSaran || saran !== "" || paket !== null || pikir !== "" || selesaiAlasan !== "" ? (
          <Card data-testid="kartu-saran-langkah">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4" aria-hidden />
                Saran Langkah Iklan
              </CardTitle>
              <CardDescription>
                Dua bagian, dua sumber: <b>angka paket di bawah dihitung sistem</b> dari data
                periode ini (model tidak menghitung), sedangkan <b>narasi</b> adalah tulisan model
                yang hanya menarasikan angka tersebut.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Paket angka tiba lebih dulu (event `{paket}`) supaya bisa diperiksa sendiri
                  sebelum narasinya masuk — sama seperti bahan prompt di jalur analisa. */}
              {paket ? (
                <div className="flex flex-col gap-3" data-testid="paket-skenario">
                  <ul className="list-disc pl-5 text-sm" data-testid="paket-fakta">
                    {paket.fakta.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                  <div className="flex flex-col gap-3">
                    {paket.skenario.map((s) => (
                      <div
                        key={s.id}
                        data-testid={`skenario-${s.id}`}
                        className="rounded-xl border border-border p-3"
                      >
                        <p className="text-sm font-medium">{s.judul}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{s.kapan}</p>
                        <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                          {s.angka.map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                        <ol className="mt-2 list-decimal pl-5 text-sm">
                          {s.langkah.map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Pikiran model: TERTUTUP default dan di ATAS narasi. Tujuannya memeriksa
                  model benar-benar merespons, bukan mengubah isi jawaban. */}
              {pikir !== "" ? (
                <details
                  className="rounded-xl border border-border p-3 text-xs text-muted-foreground"
                  data-testid="pikir-model"
                >
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    Proses berpikir model
                  </summary>
                  <p className="mt-2">
                    Ini pikiran internal model, bukan jawaban — abaikan bila narasinya sudah masuk akal.
                  </p>
                  <p className="mt-2 whitespace-pre-wrap leading-relaxed">{pikir}</p>
                </details>
              ) : null}

              {/* Jawaban berhenti karena plafon token / diblokir penyedia. */}
              {selesaiAlasan !== "" ? (
                <p
                  className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
                  data-testid="peringatan-selesai"
                >
                  {PESAN_SELESAI[selesaiAlasan] ?? `Jawaban berhenti lebih awal (${selesaiAlasan}).`}
                </p>
              ) : null}

              {memuatSaran ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner aria-hidden /> Menyusun saran…
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="teks-saran-langkah">
                  {saran}
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </CardContent>
    </Card>
  );
}
