"use client";

// components/dashboard/analisa-keputusan.tsx — Panel "Keputusan hari ini".
//
// KENAPA panel ini ada di ATAS tab: pertanyaan pemilik toko saat membuka halaman ini adalah
// "lalu saya harus apa?", dan jawabannya dulu tersebar di enam tab. Panel ini menjawabnya
// dalam satu tempat, maksimal lima baris, masing-masing dengan angka rupiah.
//
// Komponen ini TIDAK menyimpulkan apa pun: daftar aksi datang dari `susunAksi()` (murni,
// bertes). Di sini hanya format dan tombol pindah tab.
import { ArrowRight, Megaphone, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah } from "@/lib/dashboard/format";
import type { Aksi, TujuanTab } from "@/lib/analisa/aksi";

/** Awalan dampak sesuai jenisnya — "hemat", "rugi", dan "modal" tidak boleh tampil sama. */
const AWALAN: Record<Aksi["dampakBerupa"], string> = {
  hemat: "berpotensi hemat",
  rugi: "kerugian berjalan",
  modal: "modal tertahan",
};

export function AnalisaKeputusan({
  aksi,
  alasanKosong,
  biayaIklanTakTerpetakan,
  iklanTakTerpetakan,
  onBukaTab,
}: {
  aksi: Aksi[];
  /** Kalimat alasan saat daftar kosong. Wajib: daftar kosong tanpa alasan terbaca "rusak". */
  alasanKosong: string | null;
  biayaIklanTakTerpetakan: number | null;
  iklanTakTerpetakan: { nama: string; biaya: number }[];
  onBukaTab: (t: TujuanTab) => void;
}) {
  return (
    <Card data-testid="panel-keputusan">
      <CardHeader>
        <CardTitle className="text-base">Keputusan hari ini</CardTitle>
        <CardDescription>
          {aksi.length === 0
            ? "Tidak ada yang perlu dikerjakan sekarang."
            : `${aksi.length} tindakan, diurut dari dampak rupiah terbesar. Angka diambil dari periode yang dipilih di atas.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {aksi.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="keputusan-kosong">
            {alasanKosong ?? "Tidak ada aksi mendesak pada periode ini."}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {aksi.map((a) => (
              <li
                key={a.kode}
                className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
                data-testid={`aksi-${a.kode}`}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-sm">
                    <span className="font-semibold">{a.kata}</span>{" "}
                    <span className="font-medium">{a.objek}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{a.alasan}</p>
                  <p className="text-[11px] text-muted-foreground">{a.bukti}</p>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                  {/* Dampak selalu berlabel kata, bukan warna saja: "kerugian berjalan
                      Rp 16.000" tidak bisa disalahartikan sebagai penghematan. */}
                  <span className="text-sm font-medium tabular-nums">
                    {a.dampak === null
                      ? "dampak belum bisa dihitung"
                      : `${AWALAN[a.dampakBerupa]} ${formatRupiah(a.dampak)}`}
                  </span>
                  {a.dampak === null && a.dampakAlasan ? (
                    <span className="max-w-56 text-[11px] text-muted-foreground">{a.dampakAlasan}</span>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onBukaTab(a.tujuanTab)}
                  >
                    Lihat detail <ArrowRight className="ml-1 size-3.5" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* Biaya iklan grup/GMV Max: benar-benar dibelanjakan, tetapi tidak bisa dilekatkan
            ke SKU mana pun. Ditampilkan terpisah supaya selisih antara total iklan dan
            jumlah per produk tidak menjadi misteri. */}
        {biayaIklanTakTerpetakan !== null && biayaIklanTakTerpetakan > 0 ? (
          <div
            className="flex flex-col gap-1 rounded-lg border border-dashed p-3 text-xs"
            data-testid="iklan-tak-terpetakan"
          >
            <p className="flex items-center gap-1.5 font-medium">
              <TriangleAlert className="size-3.5" aria-hidden />
              {formatRupiah(biayaIklanTakTerpetakan)} biaya iklan belum terpetakan ke SKU
            </p>
            <p className="text-muted-foreground">
              Biaya ini ikut mengurangi laba, tetapi tidak bisa dibebankan ke produk tertentu.
              Iklan yang dimaksud:
            </p>
            <ul className="flex flex-col gap-0.5 text-muted-foreground">
              {iklanTakTerpetakan.slice(0, 8).map((i) => (
                <li key={i.nama} className="flex items-start gap-1.5">
                  <Megaphone className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">
                    {i.nama} — <span className="tabular-nums">{formatRupiah(i.biaya)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {iklanTakTerpetakan.length > 8 ? (
              <p className="text-muted-foreground">… dan {iklanTakTerpetakan.length - 8} iklan lain.</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Badge kecil untuk satu label tag SKU — dipakai tabel produk dan peta peluang. */
export function BadgeTag({ tag, label }: { tag: string; label: string }) {
  // Warna hanya pendamping; teksnya selalu ada, jadi buta warna tidak kehilangan informasi.
  const gaya: Record<string, string> = {
    bintang: "border-transparent bg-status-aman/20 text-status-aman-fg",
    merugi: "border-transparent bg-status-minus/20 text-status-minus-fg",
    margin_tipis: "border-transparent bg-status-menipis/20 text-status-menipis-fg",
    stok_kritis: "border-transparent bg-status-minus/20 text-status-minus-fg",
    hpp_naik: "border-transparent bg-status-menipis/20 text-status-menipis-fg",
  };
  return (
    <Badge variant="outline" className={gaya[tag] ?? ""} data-testid={`tag-${tag}`}>
      {label}
    </Badge>
  );
}
