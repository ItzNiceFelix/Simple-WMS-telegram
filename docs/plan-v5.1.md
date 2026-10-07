# Rencana Implementasi v5.1 - Revisi Desain Alur Permintaan + Perbaikan UI

Status: rencana eksekusi. Tanggal: 2026-09-17.
Sumber: `docs/prd-v5.md` (F5/F6), `docs/plan-v5.md`, keputusan user Q1-Q10.
Dokumen ini RENCANA. Tidak ada kode sumber yang diubah.

---

## 1. Ringkasan

Revisi ini mengubah DUA hal besar:
1. **Desain alur permintaan antar-gudang** (siapa target, siapa setujui/kirim, siapa terima).
2. **Perbaikan UI** (bug dropdown menampilkan uuid, dropdown searchable, info admin).

### Alur LAMA vs BARU

| Aspek | LAMA (terimplementasi) | BARU (v5.1) |
|---|---|---|
| Target | Gudang ATAU user, dicampur satu daftar | **GUDANG saja** |
| Penerima | tidak ada konsep | **User penerima per gudang** (opsional, dari gudang itu) |
| Setujui | admin/owner mana pun (Q2a) | **penerima tujuan itu** (fallback owner) |
| Kirim | admin/owner mana pun | **penerima tujuan itu** (fallback owner) |
| Status `disetujui`/`dikirim` | level DOKUMEN | **level TUJUAN** |
| Stok asal turun | SEKALI saat kirim (semua tujuan) | **per tujuan**, saat tujuan itu dikirim |
| Terima | penerima, admin/owner mana pun | **penerima tujuan itu** |
| Selesai | TURUNAN otomatis | **aksi eksplisit oleh PEMBUAT** (fallback owner) |
| tidak-terima | admin/owner mana pun | tetap, oleh **penerima** |
| tutup-tujuan | owner | tetap owner |
| Notifikasi bot | tidak ada | **buat -> penerima, kirim -> pembuat, selesai -> penerima** |

---

## 2. File terdampak

| Lapisan | File |
|---|---|
| Model | `lib/models/permintaanGudang.js` |
| Validasi | `lib/dashboard/validasiPermintaanGudangV5.js` |
| Route | `app/api/permintaan-gudang/route.ts` |
| Tipe | `lib/dashboard/types.ts` |
| DataSource | `lib/dashboard/data/index.ts`, `real.ts`, `mock.ts`, `sumber-data.tsx`, `mock-data.ts` |
| UI | `app/permintaan-gudang/page.tsx`, `app/admin/page.tsx` |
| UI baru | `components/ui/combobox.tsx` |
| Bug UI | `app/opname-gudang/page.tsx:257`, `components/dashboard/dialog-user-gudang-jabatan.tsx:195`, `components/dashboard/dialog-tambah-admin.tsx:194` |
| Bot | `lib/telegram/kirimPesan.js` (pakai), modul baru `lib/notifikasi/permintaanGudang.js` |
| Test | `test/permintaanGudang.test.js`, `test/permintaanRouteV5.test.js` (BARU), `test/combobox.test.js` (BARU), `test/selectValueGuard.test.js` (BARU) |
| E2e | `e2e/permintaan-antar-gudang.spec.ts`, `e2e/permintaan-gudang.spec.ts` |
| Dokumen | `docs/prd-v5.md` (revisi F5/F6) |

---

## 3. Perubahan skema & model

### 3.1 TujuanEntri - field baru

```ts
user_penerima_id: string | null      // telegram_user_id penerima; null = owner fallback
user_penerima_nama: string | null    // snapshot nama untuk tampilan
status_kirim: "menunggu" | "disetujui" | "dikirim"   // NEW: status per tujuan
notifikasi_terkirim: boolean | null  // Q7: null = belum dicoba, false = gagal
```

Catatan: `status` yang lama (tujuan: menunggu/diterima/tidak_terima/ditutup) TETAP untuk
siklus penerimaan. `status_kirim` baru khusus siklus setujui/kirim per tujuan.

### 3.2 Status dokumen jadi TURUNAN

| Kondisi semua tujuan | status dokumen |
|---|---|
| ada yang `status_kirim: menunggu` | `menunggu` |
| ada yang `disetujui`, belum semua `dikirim` | `disetujui` |
| semua `dikirim`, ada yang `status: menunggu` | `dikirim` |
| semua `status` final (diterima/tidak_terima/ditutup) | `selesai` |
| ada yang `ditolak` (dokumen) | `ditolak` |

### 3.3 Otorisasi per aksi

| Aksi | Siapa | Cek | Fallback |
|---|---|---|---|
| `buat` | admin/owner | `dari_gudang_id` = gudangnya (admin) | owner bebas |
| `setujui` | penerima tujuan itu | `oleh == tujuan[k].user_penerima_id` | owner |
| `kirim` | idem | idem | owner |
| `terima` | penerima tujuan itu | idem | owner |
| `tidak-terima` | penerima tujuan itu | idem | owner |
| `selesai` (BARU) | PEMBUAT | `oleh == created_by` | owner |
| `tutup-tujuan` | owner | role owner | - |
| `batal` | pembuat atau admin/owner | (tetap) | - |
| `tolak` | admin/owner | (tetap) | - |

### 3.4 Alur stok per tujuan

```
kirim(tujuan k)  -> qty_per_gudang[dari_gudang_id] TURUN sebesar qty tujuan k
terima(tujuan k) -> qty_per_gudang[gudang_tujuan_k] NAIK sebesar qty tujuan k
tidak-terima(k)  -> qty_per_gudang[dari_gudang_id] NAIK kembali
selesai(dokumen) -> TIDAK mengubah stok, hanya menandai dokumen tuntas
```

**Konsekuensi:** stok asal bisa turun bertahap (3 tujuan = 3 kali turun). Ini beda dari v5
(turun sekali). Wajib dicek: stok asal cukup untuk tiap kirim (bukan total sekaligus).

---

## 4. Notifikasi bot

| Kapan | Ke siapa | Isi |
|---|---|---|
| `buat` | semua penerima tujuan | "Permintaan baru dari <gudang asal>: <n> item. Buka dashboard untuk menyetujui." |
| `kirim` | pembuat | "<gudang tujuan> mengirim <n> item. Konfirmasi bila barang tiba." |
| `selesai` | penerima | "Permintaan <id> selesai. Terima kasih." |

**Fail-safe (Q7):**
- Bungkus dalam try/catch; gagal kirim TIDAK menggagalkan transaksi (pola BR10).
- Chat tidak aktif (belum /start bot) -> tulis `notifikasi_terkirim: false` di dokumen.
- UI menampilkan badge kecil "Notifikasi gagal terkirim" di kartu bila false.

---

## 5. Perbaikan UI

### 5.1 Bug `<SelectValue />` polos (menampilkan uuid)

**Penyebab terverifikasi** (baca kode library): `@base-ui/react/select/value/SelectValue.js`
tanpa children render-fn + tanpa prop `items` -> `resolveSelectedLabel` -> `serializeValue(value)`
= nilai mentah (gudang_id).

**8 lokasi** (3 dari user, 5 ditemukan tambahan):

| # | File:baris | Tampilkan |
|---|---|---|
| 1 | `app/opname-gudang/page.tsx:257` | gudang |
| 2 | `components/dashboard/dialog-user-gudang-jabatan.tsx:195` | gudang |
| 3 | `components/dashboard/dialog-tambah-admin.tsx:194` | role |
| 4 | `app/histori/page.tsx:336` | perlu dicek |
| 5 | `app/histori/page.tsx:364` | perlu dicek |
| 6 | `app/pengaturan/page.tsx:166` | perlu dicek |
| 7 | `components/dashboard/aksi-role-admin.tsx:111` | role |
| 8 | `components/dashboard/role-switcher.tsx:33` | role |

**Fix:** ganti `<SelectValue />` dengan `<SelectValue>{(v) => labelUntuk(v)}</SelectValue>`.
**Pencegahan (Q10):** `test/selectValueGuard.test.js` - source-grep yang GAGAL bila ada
`<SelectValue />` polos di file yang menampilkan label.

### 5.2 Combobox searchable

Komponen baru `components/ui/combobox.tsx` pakai `@base-ui/react/combobox` (sudah terpasang).

```ts
interface ComboboxProps<T> {
  value: string | null
  onChange: (v: string | null) => void
  items: T[]
  getValue: (t: T) => string
  getLabel: (t: T) => string
  placeholder?: string
  searchPlaceholder?: string
  kosongTeks?: string
  disabled?: boolean
  id?: string
  'data-testid'?: string
}
```

Dipakai di: dropdown **produk** (1107 item) dan **user**. Gudang tetap Select (3 item).
Perilaku: filter case-insensitive, keyboard nav (panah + enter), aksesibel (aria-expanded,
role listbox), tutup saat pilih.

### 5.3 Kolom admin di `/admin`

Tambah 2 kolom: **Jabatan** dan **Gudang** (nama gudang, bukan id). Read-only.
JANGAN ubah `components/dashboard/kelola-admin.tsx` (yang di /pengaturan).

---

## 6. Rencana task per wave

**Target 23 task, 5 wave.** Tiap task punya bukti selesai + target test.

### Wave 1 - Model + Validasi (6 task)

| ID | File | Kerja | Test target | Kompleksitas |
|---|---|---|---|---|
| W1-T1 | `lib/dashboard/types.ts` | TujuanEntri +user_penerima_id/nama, status_kirim, notifikasi_terkirim | tsc | KECIL |
| W1-T2 | `lib/models/permintaanGudang.js` | `_siapkanTujuan`: target gudang saja + penerima validasi (harus dari gudang itu) | 6 | SEDANG |
| W1-T3 | idem | otorisasi baru setujui/kirim/terima/tidak-terima per-tujuan | 10 | BESAR |
| W1-T4 | idem | aksi `selesai` (pembuat + owner fallback) | 5 | SEDANG |
| W1-T5 | idem | `hitungStatusDokumen` jadi turunan status_kirim per tujuan | 6 | SEDANG |
| W1-T6 | `lib/dashboard/validasiPermintaanGudangV5.js` | validasi penerima + aksi `selesai` | 6 | KECIL |

Target test Wave 1: ~33 test di `test/permintaanGudang.test.js` (perluas yang ada).

### Wave 2 - Route + Notifikasi (4 task)

| ID | File | Kerja | Test target | Kompleksitas |
|---|---|---|---|---|
| W2-T1 | `app/api/permintaan-gudang/route.ts` | aksi `selesai` + otorisasi per-tujuan | 4 | SEDANG |
| W2-T2 | `lib/notifikasi/permintaanGudang.js` (BARU) | helper kirim notif 3 titik, fail-safe | 5 | SEDANG |
| W2-T3 | `app/api/permintaan-gudang/route.ts` | panggil notifikasi setelah commit | 2 | KECIL |
| W2-T4 | `test/permintaanRouteV5.test.js` (BARU) | test route sebenarnya (POST) | 8 | SEDANG |

Catatan: `test/permintaanRoute.test.js` yang ada SALAH NAMA - isinya menguji `dailyRequests`,
bukan F5. Beri komentar koreksi di file itu + buat test baru yang benar.

### Wave 3 - DataSource (4 task)

| ID | File | Kerja | Test target | Kompleksitas |
|---|---|---|---|---|
| W3-T1 | `lib/dashboard/data/index.ts` | kontrak: aksi `selesai`, field baru | tsc | KECIL |
| W3-T2 | `real.ts` | `selesaiPermintaanGudang` via kirimTulis | tsc | KECIL |
| W3-T3 | `mock.ts` | paritas penuh aturan baru (per-tujuan, penerima, selesai) | 8 | BESAR |
| W3-T4 | `mock-data.ts` + `sumber-data.tsx` | seed dengan penerima + stub | tsc | KECIL |

### Wave 4 - UI (7 task)

| ID | File | Kerja | Test target | Kompleksitas |
|---|---|---|---|---|
| W4-T1 | `components/ui/combobox.tsx` (BARU) | komponen combobox searchable | 6 | SEDANG |
| W4-T2 | `app/permintaan-gudang/page.tsx` | dialog buat: target gudang + pilih penerima | e2e | BESAR |
| W4-T3 | idem | kartu: tampil penerima + status_kirim per tujuan | e2e | SEDANG |
| W4-T4 | idem | aksi kontekstual baru (selesai, gate peran) | e2e | SEDANG |
| W4-T5 | 3 file bug SelectValue | fix `<SelectValue />` -> render-fn | 2 | KECIL |
| W4-T6 | `app/admin/page.tsx` | kolom Gudang + Jabatan | e2e | KECIL |
| W4-T7 | `e2e/permintaan-antar-gudang.spec.ts` | e2e alur baru | 8 e2e | SEDANG |

### Wave 5 - Dokumentasi + verifikasi (2 task)

| ID | File | Kerja | Kompleksitas |
|---|---|---|---|
| W5-T1 | `docs/prd-v5.md` | revisi F5/F6 (alur baru) | SEDANG |
| W5-T2 | - | gate penuh + verifikasi | KECIL |

---

## 7. Strategi test

Prinsip repo: **unit test murni = gate utama** (cepat, akurat), e2e minimal.

| Jenis | Target | Waktu |
|---|---|---|
| Unit baru | ~50 test | ~2 detik |
| Unit total | ~500 | ~7 detik |
| E2e baru | ~8 test | ~15 detik |

Test khusus:
- `test/selectValueGuard.test.js` (BARU, 2 test): source-grep menolak `<SelectValue />` polos.
- `test/permintaanRouteV5.test.js` (BARU, 8 test): panggil `POST()` route asli.
- `test/combobox.test.js` (BARU, 6 test): logika filter/label combobox (murni).

---

## 8. Gate + risiko

### Gate
1. `npm test` - 0 fail (~7 detik)
2. `npx tsc --noEmit` - exit 0
3. `npm run e2e:fast` - 0 fail (~5 menit)
4. `npm run e2e:full` - 0 fail (sebelum rilis)

### Risiko

| # | Risiko | Mitigasi |
|---|---|---|
| R1 | Perubahan otorisasi bisa memblokir alur yang tadinya jalan | Test otorisasi per aksi + fallback owner |
| R2 | Stok asal turun bertahap -> bisa kurang di kirim ke-2 | Cek stok tiap kirim, pesan jelas bila kurang |
| R3 | ~~Data v5 lama tidak punya field baru~~ | **TIDAK BERLAKU** (P2): `permintaan_gudang` = 0 dokumen, `opname_gudang` = 0 dokumen. Tidak ada data lama. |
| R4 | Notifikasi gagal bikin transaksi gagal | Fail-safe try/catch (BR10) |
| R5 | Bug SelectValue terulang | Test source-grep (Q10) |
| R6 | P7 (qty beda per tujuan) mengubah skema -> mock/real bisa tidak paritas | Test paritas khusus qty beda antar tujuan |

---

## 9. Keputusan Final (P1-P8) - TERKUNCI

| # | Pertanyaan | Keputusan | Dampak ke rencana |
|---|---|---|---|
| P1 | `tolak-tujuan` terpisah? | **YA, tambah** | Aksi baru + gate penerima + test |
| P2 | Backfill dokumen lama? | **TIDAK perlu.** Diverifikasi: `permintaan_gudang` = 0 dokumen, `opname_gudang` = 0 dokumen (hanya `gudang` = 3, itu master). | Hapus risiko R3 (backfill) |
| P3 | Combobox user tampilkan apa? | **Nama + Jabatan** | `getLabel` = "Nama (Jabatan)" |
| P4 | 5 SelectValue tambahan? | **YA, semua** | Total 8 lokasi diperbaiki |
| P5 | Notifikasi batal/tolak/tidak-terima? | **YA** | Notifikasi jadi 6 titik, bukan 3 |
| P6 | Syarat `selesai`? | **YA**, semua tujuan harus final | Validasi `selesai` cek seluruh tujuan |
| P7 | Qty per tujuan? | **BISA BEDA** | Skema berubah: qty pindah ke level TUJUAN |
| P8 | PRD baru atau in-place? | **FILE BARU** `docs/prd-v5.1.md` | PRD v5 tetap utuh sebagai riwayat |

### Dampak P7 (qty beda per tujuan) - WAJIB dibaca

Ini perubahan skema yang paling besar. Sekarang:

```
PermintaanGudangDoc = {
  items: [{ kode_barang, qty }]          // SATU daftar item untuk semua tujuan
  tujuan: [{ tipe, id, gudang_id_snapshot, status, ... }]
}
```

Menjadi:

```
PermintaanGudangDoc = {
  items: [{ kode_barang, qty }]          // TETAP: daftar item yang diminta (referensi)
  tujuan: [{
    tipe, id, gudang_id_snapshot, status, status_kirim,
    user_penerima_id, user_penerima_nama,
    items: [{ kode_barang, qty }]        // BARU: qty PER TUJUAN (boleh beda)
  }]
}
```

Konsekuensi konkret:
1. Dialog buat: setelah pilih gudang tujuan, user atur qty PER gudang (bukan sekali untuk semua).
2. `kirim(tujuan k)` turunkan stok asal sebesar qty tujuan k (bukan total semua).
3. `terima(tujuan k)` naikkan stok gudang tujuan sebesar qty tujuan k.
4. Validasi baru: qty tujuan tidak boleh melebihi... tidak ada batas, tapi tiap tujuan independen.
5. `items` di level dokumen jadi referensi produk yang diminta; `tujuan[k].items` yang mengikat.
6. Test paritas mock/real harus menguji qty BEDA antar tujuan.

### Notifikasi jadi 6 titik (P5)

| Kapan | Ke siapa |
|---|---|
| buat | semua penerima tujuan |
| setujui (per tujuan) | pembuat |
| kirim (per tujuan) | pembuat |
| terima (per tujuan) | pembuat |
| tidak-terima (per tujuan) | pembuat |
| selesai | semua penerima |

(`batal` dan `tolak` dokumen: notifikasi ke penerima bila sudah ada.)

### Otorisasi tambahan (P1)

| Aksi | Siapa | Cek | Fallback |
|---|---|---|---|
| `tolak-tujuan` (BARU) | penerima tujuan itu | `oleh == tujuan[k].user_penerima_id` | owner |

Status tujuan baru: `ditolak` (selain menunggu/diterima/tidak_terima/ditutup).

### PRD baru (P8)

Tulis `docs/prd-v5.1.md` sebagai patch. `docs/prd-v5.md` TIDAK diubah (riwayat).
`docs/prd-v5.1.md` cukup memuat DELTA: apa yang berubah dari v5, tidak mengulang seluruh PRD.
