"use client";

// app/sinkronisasi/page.tsx — Satu tempat untuk semua impor berkas marketplace.
//
// KENAPA HALAMAN TERPISAH, BUKAN TOMBOL DI TIGA HALAMAN:
//   Impor Order, Laba, Performa, dan Iklan sebelumnya tersebar di /order, /laba, dan /analisa.
//   Akibatnya tidak ada satu pun layar yang menjawab "berkas mana yang sudah masuk minggu ini".
//   Di sini keempatnya berdiri bersama, dengan riwayat impor terakhir per jenis.
//
// KENAPA DIALOG LAMA DIPAKAI ULANG, BUKAN DITULIS BARU:
//   Dialog itu sudah memuat alur lengkap (preview, klasifikasi, potongan, SKU manual, blokir
//   simpan). Menyalinnya berarti dua implementasi yang akan menyimpang.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChartNoAxesCombined, FileSpreadsheet, Megaphone, Package } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButuhAkses } from "@/components/dashboard/butuh-akses";
import { DialogImportOrder } from "@/components/dashboard/dialog-import-order";
import { DialogLabaShopee } from "@/components/dashboard/dialog-laba-shopee";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { formatTanggalJamWib } from "@/lib/dashboard/format";

type Jenis = "order" | "laba" | "performa" | "iklan";
type Log = { id: number; jenis: Jenis; file: string; baris: number; gagal: number; ringkas: string; at: number; oleh: string | null };
type Toko = { id: number; nama: string; status_toko: string };

export default function HalamanSinkronisasi() {
  return (
    <ButuhAkses href="/sinkronisasi">
      <Sinkronisasi />
    </ButuhAkses>
  );
}

function Sinkronisasi() {
  const [toko, setToko] = useState<Toko[]>([]);
  const [presetId, setPresetId] = useState<number | null>(null);
  const [log, setLog] = useState<Record<string, Log[]> | null>(null);
  /**
   * Pesan kegagalan muat (toko ATAU riwayat). Tanpa state ini, `log` tetap null dan kartu
   * menampilkan skeleton selamanya — layar yang "sedang memuat" padahal requestnya sudah
   * mati, tanpa satu pun petunjuk bagi user.
   */
  const [galat, setGalat] = useState<string | null>(null);
  /** Pemicu ulang pemuatan daftar toko lewat tombol "Coba lagi". */
  const [cobaLagi, setCobaLagi] = useState(0);
  const [bukaOrder, setBukaOrder] = useState(false);
  const [bukaLaba, setBukaLaba] = useState(false);
  const [sibukPerforma, setSibukPerforma] = useState(false);
  const [sibukIklan, setSibukIklan] = useState(false);

  useEffect(() => {
    void (async () => {
      setGalat(null);
      try {
        const res = await fetch("/api/preset", { credentials: "include" });
        // `presets`, bukan `preset`: salah kunci membuat daftar kosong TANPA error, sehingga
        // pemicu tampak mati dan riwayat tidak pernah dimuat (skeleton berputar terus).
        const d = (await res.json().catch(() => null)) as { ok?: boolean; presets?: Toko[]; error?: string } | null;
        if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat toko (${res.status}).`);
        const daftar = d.presets ?? [];
        setToko(daftar);
        setPresetId(daftar[0]?.id ?? null);
        // Tanpa toko, tidak ada yang bisa dimuat: selesaikan loading agar kartu tidak
        // menampilkan skeleton selamanya.
        if (daftar.length === 0) setLog({});
      } catch (e) {
        // `log` TETAP diisi objek kosong: skeleton hanya boleh muncul selama request hidup.
        // Pesan + tombol "Coba lagi" menggantikannya supaya user tahu harus berbuat apa.
        setLog({});
        setGalat(e instanceof Error ? e.message : "Gagal memuat daftar toko.");
      }
    })();
  }, [cobaLagi]);

  const muatLog = useCallback(async (id: number) => {
    setGalat(null);
    try {
      const res = await fetch(`/api/sinkronisasi?presetId=${id}`, { credentials: "include" });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; perJenis?: Record<string, Log[]>; error?: string } | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Gagal memuat riwayat (${res.status}).`);
      setLog(d.perJenis ?? {});
    } catch (e) {
      // Riwayat gagal dimuat BUKAN "belum pernah impor": tanpa pesan galat, kartu akan
      // berbohong menyatakan toko ini belum punya berkas. Kosongkan log + tampilkan galat.
      setLog({});
      setGalat(e instanceof Error ? e.message : "Gagal memuat riwayat impor.");
    }
  }, []);

  useEffect(() => {
    if (presetId) void muatLog(presetId);
  }, [presetId, muatLog]);

  /**
   * "Coba lagi" mengulang SUMBER yang gagal: daftar toko bila belum ada toko sama sekali,
   * selain itu riwayat toko aktif. Memuat ulang daftar toko padahal toko sudah ada akan
   * mengembalikan pilihan ke toko pertama dan mengejutkan user.
   */
  function ulangiMuat() {
    if (toko.length === 0) {
      setCobaLagi((n) => n + 1);
      return;
    }
    if (presetId) void muatLog(presetId);
  }

  /** Catat satu impor selesai. Gagal mencatat tidak membatalkan impor yang sudah terjadi. */
  async function catat(jenis: Jenis, file: string, baris: number, gagal: number, ringkas: string) {
    if (!presetId) return;
    try {
      const res = await fetch("/api/sinkronisasi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ presetId, jenis, file, baris, gagal, ringkas }),
      });
      // Status HTTP WAJIB diperiksa: `fetch` tidak melempar untuk 4xx/5xx, jadi dulu log yang
      // ditolak server (mis. sesi kedaluwarsa) hilang tanpa sepatah kata — dan halaman
      // Sinkronisasi lalu menampilkan riwayat yang tidak memuat impor barusan.
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? `Riwayat impor gagal dicatat (${res.status}).`);
      }
      await muatLog(presetId);
    } catch (e) {
      tampilkanGagalTulis(
        `${e instanceof Error ? e.message : "Riwayat impor gagal dicatat."} Impor tetap tersimpan; catat ulang dengan mengimpor berkasnya lagi bila perlu.`
      );
    }
  }

  async function unggahPerforma(f: File) {
    if (!presetId) return;
    setSibukPerforma(true);
    try {
      // Endpoint lama menerima base64 di dalam JSON (lib/d1/shopeePetaImpor membacanya
      // sebagai ArrayBuffer). Diteruskan apa adanya supaya aturan impor tidak berubah.
      const buf = new Uint8Array(await f.arrayBuffer());
      let biner = "";
      for (let i = 0; i < buf.length; i++) biner += String.fromCharCode(buf[i]);
      const file = btoa(biner);
      const res = await fetch("/api/analisa/peta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi: "impor-performa", file, presetId }),
      });
      const d = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            ringkas?: { kodeProdukTotal?: number; terpetakan?: number; pesananTotal?: number; pesananTerpetakan?: number };
            jumlahBaris?: number;
            jumlahPertanyaan?: number;
            periode?: string;
            error?: string;
          }
        | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Impor performa gagal (${res.status}).`);
      // Angka ada di `ringkas`; `terpetakan` di akar JSON tidak ada dan dulu tercetak
      // "undefined/undefined" padahal impor sukses.
      const r = d.ringkas ?? {};
      const jumlah = d.jumlahBaris ?? 0;
      toast.success(
        `Performa diimpor: ${r.terpetakan ?? 0}/${r.kodeProdukTotal ?? 0} produk terpetakan` +
          ` (${jumlah} baris${d.jumlahPertanyaan ? `, ${d.jumlahPertanyaan} perlu keputusan` : ""}, periode ${d.periode ?? "-"}).`
      );
      // `gagal` = pertanyaan yang belum bisa dipetakan mesin (butuh keputusan manusia).
      // Dulu di-hardcode 0, sehingga produk tak terpetakan tampak "tidak ada masalah".
      await catat(
        "performa",
        f.name,
        jumlah,
        d.jumlahPertanyaan ?? 0,
        `periode ${d.periode ?? "-"} · ${r.kodeProdukTotal ?? 0} kode produk · ${d.jumlahPertanyaan ?? 0} perlu keputusan`
      );
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Impor performa gagal.");
    } finally {
      setSibukPerforma(false);
    }
  }

  async function unggahIklan(f: File) {
    if (!presetId) return;
    setSibukIklan(true);
    try {
      const teks = await f.text();
      const res = await fetch("/api/analisa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aksi: "impor-iklan", presetId, teks }),
      });
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; tersimpan?: number; barisDibaca?: number; dilewatiTanpaPeta?: number; error?: string }
        | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error ?? `Impor iklan gagal (${res.status}).`);
      // `tersimpan` = jumlah SKU unik; `barisDibaca` = jumlah baris berkas. Yang dilaporkan
      // ke user adalah baris berkas — "12 baris" untuk CSV 300 baris terlihat seperti data hilang.
      const barisBerkas = d.barisDibaca ?? d.tersimpan ?? 0;
      toast.success(`${barisBerkas} baris iklan tersimpan (${d.tersimpan ?? 0} SKU).`);
      await catat("iklan", f.name, barisBerkas, d.dilewatiTanpaPeta ?? 0, `${d.tersimpan ?? 0} SKU · ${d.dilewatiTanpaPeta ?? 0} baris tanpa peta SKU`);
    } catch (e) {
      tampilkanGagalTulis(e instanceof Error ? e.message : "Impor iklan gagal.");
    } finally {
      setSibukIklan(false);
    }
  }

  const presetAktif = toko.find((t) => t.id === presetId) ?? null;
  const KARTU: { jenis: Jenis; judul: string; ket: string; ikon: typeof Package }[] = [
    { jenis: "order", judul: "Order", ket: "Order.all untuk status/resi/retur + Order.toship untuk booking advance.", ikon: Package },
    { jenis: "laba", judul: "Laba", ket: "Order.all sheet orders. Satu berkas dipotong per tanggal penjualan.", ikon: FileSpreadsheet },
    { jenis: "performa", judul: "Performa Produk", ket: "parentskudetail*.xlsx: kunjungan, keranjang, pesanan organik.", ikon: ChartNoAxesCombined },
    { jenis: "iklan", judul: "Laporan Iklan", ket: "CSV iklan Shopee: biaya, klik, tayangan, omzet iklan per SKU.", ikon: Megaphone },
  ];

  return (
    <>
      <PageHeader
        judul="Sinkronisasi"
        deskripsi="Semua impor berkas marketplace dalam satu tempat, dengan riwayat impor terakhir."
      />

      <div className="flex flex-col gap-4" data-testid="sinkronisasi">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <label className="flex min-w-[220px] flex-col gap-1 text-xs text-muted-foreground">
              Toko (preset)
              <Select value={presetId ? String(presetId) : ""} onValueChange={(v) => { if (v) setPresetId(Number(v)); }}>
                <SelectTrigger className="h-9 w-full" data-testid="sinkron-preset">
                  <SelectValue>{(v: string | null) => toko.find((t) => String(t.id) === v)?.nama ?? "Pilih toko"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {toko.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.nama}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            <p className="text-xs text-muted-foreground">
              Impor SELALU masuk ke toko yang dipilih di sini. Fee, pajak, dan laba dihitung per toko.
            </p>
          </CardContent>
        </Card>

        {galat ? (
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm"
            role="alert"
            data-testid="galat-sinkronisasi"
          >
            <span className="text-red-700 dark:text-red-400">{galat}</span>
            <Button variant="outline" size="sm" onClick={ulangiMuat} data-testid="coba-lagi-sinkronisasi">
              Coba lagi
            </Button>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2" data-testid="kartu-sinkron">
          {KARTU.map(({ jenis, judul, ket, ikon: Ikon }) => {
            const terakhir = log?.[jenis]?.[0];
            return (
              <Card key={jenis} data-testid={`kartu-${jenis}`}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Ikon className="size-4" aria-hidden />
                    {judul}
                  </CardTitle>
                  <CardDescription>{ket}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {log === null ? (
                    <Skeleton className="h-10 w-full" />
                  ) : terakhir ? (
                    <div className="rounded-lg border border-border bg-muted/40 p-2 text-xs" data-testid={`terakhir-${jenis}`}>
                      <p className="font-medium">{terakhir.file || "(tanpa nama berkas)"}</p>
                      <p className="text-muted-foreground">
                        {formatTanggalJamWib(terakhir.at)} · {terakhir.baris} baris
                        {terakhir.gagal > 0 ? ` · ${terakhir.gagal} gagal` : ""}
                        {terakhir.ringkas ? ` · ${terakhir.ringkas}` : ""}
                        {/* `oleh` = id Telegram pencatat, satu-satunya identitas yang disimpan
                            server. Ditampilkan supaya "siapa yang mengimpor" bisa ditanyakan
                            balik tanpa membuka D1. */}
                        {terakhir.oleh ? ` · oleh ${terakhir.oleh}` : ""}
                      </p>
                    </div>
                  ) : (
                    <Empty data-testid={`kosong-${jenis}`}>
                      <EmptyHeader>
                        <EmptyTitle>Belum pernah diimpor</EmptyTitle>
                        <EmptyDescription>Toko ini belum punya berkas {judul.toLowerCase()}.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}

                  {jenis === "order" ? (
                    <Button variant="outline" onClick={() => setBukaOrder(true)} disabled={!presetId} data-testid="impor-order">
                      Impor Order
                    </Button>
                  ) : null}
                  {jenis === "laba" ? (
                    <Button variant="outline" onClick={() => setBukaLaba(true)} disabled={!presetId} data-testid="impor-laba">
                      Impor Laba
                    </Button>
                  ) : null}
                  {jenis === "performa" ? (
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {sibukPerforma ? (
                        <span className="flex items-center gap-1"><Spinner data-icon="inline-start" /> Memproses…</span>
                      ) : (
                        <Input
                          type="file"
                          accept=".xlsx,.xls"
                          disabled={!presetId || sibukPerforma}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) void unggahPerforma(f); e.target.value = ""; }}
                          data-testid="impor-performa"
                        />
                      )}
                    </label>
                  ) : null}
                  {jenis === "iklan" ? (
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {sibukIklan ? (
                        <span className="flex items-center gap-1"><Spinner data-icon="inline-start" /> Memproses…</span>
                      ) : (
                        <Input
                          type="file"
                          accept=".csv"
                          disabled={!presetId || sibukIklan}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) void unggahIklan(f); e.target.value = ""; }}
                          data-testid="impor-iklan"
                        />
                      )}
                    </label>
                  ) : null}

                  {log?.[jenis] && log[jenis].length > 1 ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">{log[jenis].length} impor terakhir ditampilkan</summary>
                      <ul className="mt-1 flex flex-col gap-1">
                        {log[jenis].slice(1).map((l) => (
                          <li key={l.id} className="flex justify-between gap-2 text-muted-foreground">
                            <span className="truncate">{l.file || "-"}</span>
                            <span className="whitespace-nowrap">{formatTanggalJamWib(l.at)} · {l.baris}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {presetAktif ? (
          <>
            <DialogImportOrder
              open={bukaOrder}
              onOpenChange={setBukaOrder}
              preset={presetAktif}
              onSukses={() => void muatLog(presetId ?? 0)}
            />
            <DialogLabaShopee
              open={bukaLaba}
              onOpenChange={setBukaLaba}
              preset={presetAktif}
              onSukses={() => void muatLog(presetId ?? 0)}
            />
          </>
        ) : null}

        <p className="text-[11px] text-muted-foreground">
          Impor yang gagal sebelum tersimpan tidak tercatat di sini.
        </p>
      </div>
    </>
  );
}
