"use client";

// Dialog Stok per Gudang (PRD v5 F2, v5.2 D6; ui-spec v5).
// Dua mode:
//   - "set-qty": tandai berapa qty kode_barang ini di satu gudang (qty_per_gudang).
//   - "mutasi" : pindah qty antar dua gudang (v5.2 D6).
// Hanya gudang aktif yang bisa dipilih (route menolak nonaktif). Error server
// (mis. 403 gudang di luar scope admin) ditampilkan apa adanya; dialog ditahan.
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { tampilkanGagalTulis } from "@/components/dashboard/umpan-tulis";
import { formatAngka } from "@/lib/dashboard/format";
import { useData } from "@/lib/dashboard/sumber-data";
import type { GudangDoc } from "@/lib/dashboard/types";

type Mode = "set-qty" | "mutasi";

const MODE_LABEL: Record<Mode, string> = {
  "set-qty": "Set qty",
  mutasi: "Mutasi",
};

const PESAN_QTY_SET = "Jumlah harus bilangan bulat >= 0.";
const PESAN_QTY_MUTASI = "Jumlah harus bilangan bulat >= 1.";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kode: string;
  nama: string | null;
  qtyPerGudang: Record<string, number>;
  /** Dipanggil setelah simpan sukses agar halaman refetch (pola Koreksi Stok). */
  onSukses?: (qtyPerGudang: Record<string, number>) => void;
}

/** Validasi murni mode set-qty: kosong / bukan angka / negatif / bukan integer -> pesan error. */
function validasiSetQty(mentah: string): number | string {
  const teks = mentah.trim();
  if (!/^\d+$/.test(teks)) return PESAN_QTY_SET;
  const n = Number(teks);
  if (!Number.isInteger(n) || n < 0) return PESAN_QTY_SET;
  return n;
}

/** Validasi murni mode mutasi: qty integer >= 1. */
function validasiMutasiQty(mentah: string): number | string {
  const teks = mentah.trim();
  if (!/^\d+$/.test(teks)) return PESAN_QTY_MUTASI;
  const n = Number(teks);
  if (!Number.isInteger(n) || n < 1) return PESAN_QTY_MUTASI;
  return n;
}

/** Gudang default: ONLINE bila ada, kalau tidak yang pertama (urut dari listGudang). */
function pilihDefault(daftar: GudangDoc[]): string {
  if (daftar.some((g) => g.gudang_id === "ONLINE")) return "ONLINE";
  return daftar[0]?.gudang_id ?? "";
}

/** Gudang tujuan default: kandidat aktif pertama yang bukan gudang asal. */
function pilihDefaultTujuan(daftar: GudangDoc[], asal: string): string {
  return daftar.find((g) => g.gudang_id !== asal)?.gudang_id ?? "";
}

export function DialogStokGudang({
  open,
  onOpenChange,
  kode,
  nama,
  qtyPerGudang,
  onSukses,
}: Props) {
  const data = useData();
  const [mode, setMode] = useState<Mode>("set-qty");
  const [gudang, setGudang] = useState<GudangDoc[] | null>(null);
  const [gagalMuat, setGagalMuat] = useState(false);
  const [gudangId, setGudangId] = useState("");
  const [qtyText, setQtyText] = useState("");
  const [asalId, setAsalId] = useState("");
  const [tujuanId, setTujuanId] = useState("");
  const [qtyMutasiText, setQtyMutasiText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorMutasi, setErrorMutasi] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);

  // Muat daftar gudang tiap dialog dibuka; hanya yang aktif boleh dipilih.
  useEffect(() => {
    if (!open) return;
    let batal = false;
    setMode("set-qty");
    setGudang(null);
    setGagalMuat(false);
    setGudangId("");
    setQtyText("");
    setAsalId("");
    setTujuanId("");
    setQtyMutasiText("");
    setError(null);
    setErrorMutasi(null);
    setMengirim(false);
    void (async () => {
      try {
        const semua = await data.listGudang();
        if (batal) return;
        const aktif = semua.filter((g) => g.aktif);
        setGudang(aktif);
        if (aktif.length > 0) {
          const asal = pilihDefault(aktif);
          setGudangId(asal);
          setAsalId(asal);
          setTujuanId(pilihDefaultTujuan(aktif, asal));
        }
      } catch {
        if (!batal) setGagalMuat(true);
      }
    })();
    return () => {
      batal = true;
    };
  }, [open, data]);

  const hasil = validasiSetQty(qtyText);
  const qtySah = typeof hasil === "number";
  const siap = gudang !== null && gudang.length > 0 && gudangId !== "";

  const sekarang = gudangId !== "" ? (qtyPerGudang[gudangId] ?? 0) : 0;

  const hasilMutasi = validasiMutasiQty(qtyMutasiText);
  const qtyMutasiSah = typeof hasilMutasi === "number";
  const siapMutasi =
    gudang !== null &&
    gudang.length >= 2 &&
    asalId !== "" &&
    tujuanId !== "" &&
    asalId !== tujuanId;

  const stokAsal = asalId !== "" ? (qtyPerGudang[asalId] ?? 0) : 0;

  function namaGudang(id: string): string {
    return gudang?.find((g) => g.gudang_id === id)?.nama ?? id;
  }

  function tutup(v: boolean) {
    if (mengirim) return; // form terkunci saat submit (cegah double-tap)
    onOpenChange(v);
  }

  async function kirimSetQty() {
    if (!siap) return;
    const nilai = validasiSetQty(qtyText);
    if (typeof nilai === "string") {
      setError(nilai);
      return;
    }
    setError(null);
    setMengirim(true);
    try {
      const res = await data.setQtyGudang({
        kode_barang: kode,
        gudang_id: gudangId,
        qty: nilai,
      });
      if (res.ok) {
        toast.success("Stok gudang diperbarui");
        onOpenChange(false);
        onSukses?.(res.qty_per_gudang);
      } else {
        const kedaluwarsa = tampilkanGagalTulis(res.error);
        if (!kedaluwarsa) setError(res.error);
        setMengirim(false);
      }
    } catch {
      toast.error("Gagal menyimpan. Coba lagi.");
      setMengirim(false);
    }
  }

  async function kirimMutasi() {
    const nilai = validasiMutasiQty(qtyMutasiText);
    if (typeof nilai === "string") {
      setErrorMutasi(nilai);
      return;
    }
    if (!siapMutasi) {
      if (asalId !== "" && asalId === tujuanId) {
        setErrorMutasi("Gudang asal dan tujuan tidak boleh sama.");
      }
      return;
    }
    if (nilai > stokAsal) {
      setErrorMutasi("Stok gudang asal tidak cukup.");
      return;
    }
    setErrorMutasi(null);
    setMengirim(true);
    try {
      const res = await data.mutasiStokGudang({
        kode_barang: kode,
        dari_gudang_id: asalId,
        ke_gudang_id: tujuanId,
        qty: nilai,
      });
      if (res.ok) {
        toast.success("Stok dipindah.");
        onOpenChange(false);
        onSukses?.(res.qty_per_gudang);
      } else {
        // Pesan server apa adanya (termasuk "Stok gudang asal tidak cukup.").
        const kedaluwarsa = tampilkanGagalTulis(res.error);
        if (!kedaluwarsa) setErrorMutasi(res.error);
        setMengirim(false);
      }
    } catch {
      toast.error("Gagal menyimpan. Coba lagi.");
      setMengirim(false);
    }
  }

  const memuatGudang = gudang === null;

  function renderPilihanGudang(
    id: string,
    nilai: string,
    onPilih: (v: string) => void,
    testid: string,
    idField: string,
    opsi: GudangDoc[]
  ) {
    return (
      <Select
        value={nilai}
        onValueChange={(v) => {
          if (typeof v === "string" && v !== "") {
            onPilih(v);
            setError(null);
            setErrorMutasi(null);
          }
        }}
        disabled={mengirim}
      >
        <SelectTrigger
          id={idField}
          className="h-11 w-full data-[size=default]:h-11 md:h-8 md:data-[size=default]:h-8"
          data-testid={testid}
        >
          <SelectValue>
            {(v: string | null) => (v ? namaGudang(v) : "Pilih gudang")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {opsi.map((g) => (
              <SelectItem key={g.gudang_id} value={g.gudang_id}>
                {g.nama}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-stok-gudang">
        <DialogHeader>
          <DialogTitle>Stok per Gudang</DialogTitle>
          <DialogDescription>
            Atur jumlah produk ini di satu gudang, atau pindahkan antar gudang.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm font-medium">{nama ?? "Produk"}</p>
          <p className="text-xs text-muted-foreground">{kode}</p>
        </div>

        <Field data-disabled={mengirim ? true : undefined}>
          <FieldLabel>Mode</FieldLabel>
          <ToggleGroup
            variant="outline"
            value={[mode]}
            onValueChange={(v) => {
              const next = v[0] as Mode | undefined;
              if (!next) return;
              setMode(next);
              setError(null);
              setErrorMutasi(null);
            }}
            disabled={mengirim}
            aria-label="Mode stok gudang"
            data-testid="mode-stok-gudang"
          >
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <ToggleGroupItem
                key={m}
                value={m}
                className="h-11 min-w-20 md:h-8"
                data-testid={`mode-${m}`}
              >
                {MODE_LABEL[m]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        {memuatGudang && gagalMuat ? (
          <p className="text-sm text-destructive" data-testid="error-muat-gudang">
            Gagal memuat daftar gudang. Tutup lalu buka lagi.
          </p>
        ) : memuatGudang ? (
          <div className="flex flex-col gap-4" aria-busy>
            <Skeleton className="h-11 w-full rounded-lg md:h-8" />
            <Skeleton className="h-11 w-full rounded-lg md:h-8" />
          </div>
        ) : gudang.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="kosong-gudang">
            Belum ada gudang aktif. Tambahkan di halaman Gudang.
          </p>
        ) : mode === "set-qty" ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void kirimSetQty();
            }}
          >
            <Field data-disabled={mengirim ? true : undefined}>
              <FieldLabel htmlFor="stok-gudang-pilih">Gudang</FieldLabel>
              {renderPilihanGudang(
                "stok-gudang-pilih",
                gudangId,
                setGudangId,
                "pilih-gudang-stok",
                "stok-gudang-pilih",
                gudang
              )}
              {siap ? (
                <FieldDescription>
                  Sekarang:{" "}
                  <span
                    data-testid="qty-sekarang"
                    className="font-semibold text-foreground tabular-nums"
                  >
                    {formatAngka(sekarang)}
                  </span>
                </FieldDescription>
              ) : null}
            </Field>

            <Field
              data-invalid={error ? true : undefined}
              data-disabled={mengirim ? true : undefined}
            >
              <FieldLabel htmlFor="stok-gudang-qty">Jumlah</FieldLabel>
              <Input
                id="stok-gudang-qty"
                inputMode="numeric"
                autoComplete="off"
                value={qtyText}
                aria-invalid={error ? true : undefined}
                disabled={mengirim || !siap}
                placeholder="0"
                data-testid="input-qty-gudang"
                onChange={(e) => {
                  setQtyText(e.target.value);
                  setError(null);
                }}
              />
              {error ? (
                <FieldError data-testid="error-qty-gudang">{error}</FieldError>
              ) : (
                <FieldDescription>Bilangan bulat minimal 0.</FieldDescription>
              )}
            </Field>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 md:h-9"
                disabled={mengirim}
                onClick={() => tutup(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="lg"
                className="h-11 md:h-9"
                disabled={mengirim || !siap || !qtySah}
                data-testid="submit-stok-gudang"
              >
                {mengirim ? <Spinner data-icon="inline-start" /> : null}
                {mengirim ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void kirimMutasi();
            }}
          >
            <Field data-disabled={mengirim ? true : undefined}>
              <FieldLabel htmlFor="mutasi-gudang-asal">Gudang asal</FieldLabel>
              {renderPilihanGudang(
                "mutasi-gudang-asal",
                asalId,
                (v) => {
                  setAsalId(v);
                  if (v === tujuanId) setTujuanId(pilihDefaultTujuan(gudang, v));
                },
                "pilih-gudang-asal",
                "mutasi-gudang-asal",
                gudang
              )}
              <FieldDescription>
                Stok di gudang asal sekarang:{" "}
                <span
                  data-testid="info-stok-asal"
                  className="font-semibold text-foreground tabular-nums"
                >
                  {formatAngka(stokAsal)}
                </span>
              </FieldDescription>
            </Field>

            <Field data-disabled={mengirim ? true : undefined}>
              <FieldLabel htmlFor="mutasi-gudang-tujuan">Gudang tujuan</FieldLabel>
              {renderPilihanGudang(
                "mutasi-gudang-tujuan",
                tujuanId,
                setTujuanId,
                "pilih-gudang-tujuan",
                "mutasi-gudang-tujuan",
                gudang.filter((g) => g.gudang_id !== asalId)
              )}
              {gudang.length < 2 ? (
                <FieldDescription>
                  Butuh minimal dua gudang aktif untuk memindah stok.
                </FieldDescription>
              ) : null}
            </Field>

            <Field
              data-invalid={errorMutasi ? true : undefined}
              data-disabled={mengirim ? true : undefined}
            >
              <FieldLabel htmlFor="mutasi-gudang-qty">Jumlah</FieldLabel>
              <Input
                id="mutasi-gudang-qty"
                inputMode="numeric"
                autoComplete="off"
                value={qtyMutasiText}
                aria-invalid={errorMutasi ? true : undefined}
                disabled={mengirim}
                placeholder="1"
                data-testid="input-qty-mutasi"
                onChange={(e) => {
                  setQtyMutasiText(e.target.value);
                  setErrorMutasi(null);
                }}
              />
              {errorMutasi ? (
                <FieldError data-testid="error-qty-mutasi">{errorMutasi}</FieldError>
              ) : (
                <FieldDescription>
                  Bilangan bulat minimal 1, tidak melebihi stok gudang asal.
                </FieldDescription>
              )}
            </Field>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 md:h-9"
                disabled={mengirim}
                onClick={() => tutup(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="lg"
                className="h-11 md:h-9"
                disabled={mengirim || !siapMutasi || !qtyMutasiSah}
                data-testid="submit-mutasi-gudang"
              >
                {mengirim ? <Spinner data-icon="inline-start" /> : null}
                {mengirim ? "Memindah..." : "Pindahkan"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
