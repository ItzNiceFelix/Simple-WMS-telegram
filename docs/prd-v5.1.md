# PRD v5.1 - Patch Desain Alur Permintaan Antar-Gudang

Status: patch dari `docs/prd-v5.md`. Tanggal: 2026-09-17.
Dokumen ini DELTA - hanya yang BERUBAH dari v5. Untuk konteks penuh, baca `docs/prd-v5.md`.
Keputusan user: Q1-Q10 + P1-P8 (lihat `docs/plan-v5.1.md`).

---

## 1. Ringkasan perubahan

v5.1 mengubah cara kerja permintaan antar-gudang: dari "dokumen dengan campuran tujuan gudang/user,
persetujuan oleh siapa pun" menjadi "per-tujuan, penerima bertanggung jawab, selesai eksplisit".

| Aspek | v5 | v5.1 |
|---|---|---|
| Target tujuan | Gudang ATAU user (dicampur) | **GUDANG saja** |
| Penerima | tidak ada | **user per gudang** (opsional, dari gudang itu) |
| Qty | satu daftar untuk semua tujuan | **per tujuan** (boleh beda) |
| setujui/kirim | admin/owner mana pun (Q2a) | **penerima tujuan itu** |
| Level status | dokumen | **per tujuan** (`status_kirim`) |
| Stok asal turun | sekali (semua tujuan) | **per tujuan** |
| terima/tidak-terima | admin/owner mana pun | **pembuat request** |
| selesai | otomatis (turunan) | **aksi eksplisit pembuat** |
| tolak-tujuan | tidak ada | **ADA** (P1) |
| Notifikasi bot | tidak ada | **6 titik** (P5) |

---

## 2. Requirement yang berubah

### F5 (revisi v5.1) - Permintaan antar-gudang per-tujuan

**F5.1 Status per tujuan:**
- `status_kirim`: `menunggu` -> `disetujui` -> `dikirim` (siklus persetujuan/pengiriman)
- `status`: `menunggu` -> `diterima` | `tidak_terima` | `ditolak` | `ditutup` (siklus penerimaan)

**F5.2 Aksi per tujuan:**

| Aksi | Gate | Efek |
|---|---|---|
| `setujui-tujuan` | penerima tujuan / owner | `status_kirim` -> `disetujui` |
| `tolak-tujuan` | penerima tujuan / owner | `status` -> `ditolak` |
| `kirim` | penerima tujuan / owner | `status_kirim` -> `dikirim`; stok asal turun sebesar qty TUJUAN itu |
| `terima` | pembuat / owner | `status` -> `diterima`; stok gudang tujuan naik |
| `tidak-terima` | pembuat / owner | `status` -> `tidak_terima`; stok kembali ke asal |
| `tutup-tujuan` | owner | `status` -> `ditutup`; stok tidak berubah |
| `selesai` (dokumen) | pembuat / owner | `status` dokumen -> `selesai`; syarat SEMUA tujuan final |

**F5.3 Aturan penting:**
- Stok asal turun **per tujuan** (bukan sekali). Kirim ke 3 gudang = 3 kali turun.
- Cek stok cukup dilakukan saat kirim tujuan itu (bukan total sekaligus).
- `selesai` BUKAN turunan: dokumen tetap `dikirim` walau semua tujuan sudah final sampai
  pembuat menekan Selesai.

### F6 (revisi v5.1) - Target & penerima

- "Kirim ke" hanya menampilkan **GUDANG**.
- Tiap gudang tujuan boleh punya **qty berbeda** (items sendiri).
- Tiap gudang tujuan boleh punya **user penerima**:
  - WAJIB berasal dari gudang itu (`admins.gudang_id == gudang_tujuan`).
  - Opsional: bila kosong, **owner** jadi fallback untuk setujui/kirim.

### F11 (BARU) - Notifikasi bot

| Kapan | Ke siapa |
|---|---|
| `buat` | semua penerima tujuan |
| `setujui-tujuan` | pembuat |
| `kirim` | pembuat |
| `terima` | pembuat |
| `tidak-terima` | pembuat |
| `selesai` | semua penerima |
| `batal` / `tolak` (dokumen) | penerima (bila ada) |

Fail-safe: gagal kirim TIDAK menggagalkan transaksi (BR10). Dicatat di
`tujuan[k].notifikasi_terkirim` (null = belum dicoba, false = gagal) + peringatan di UI.

---

## 3. Skema yang berubah

```
TujuanEntri = {
  tipe: "gudang",                    // v5.1: HANYA gudang
  id: string,
  nama: string | null,
  jabatan: null,                     // v5.1: tidak dipakai (tujuan bukan user)
  gudang_id_snapshot: string,
  status: TujuanStatus,              // menunggu | diterima | tidak_terima | ditolak | ditutup
  status_kirim: StatusKirimTujuan,   // BARU: menunggu | disetujui | dikirim
  user_penerima_id: string | null,   // BARU (Q2/Q3)
  user_penerima_nama: string | null, // BARU
  items: PermintaanItem[],           // BARU (P7): qty per tujuan
  notifikasi_terkirim?: boolean | null, // BARU (Q7)
  disetujui_at/oleh, dikirim_at/oleh, ditolak_at/oleh,
  diterima_at/oleh, tidak_terima_at/oleh, ditutup_at/oleh, catatan_alasan
}
```

`PermintaanTujuanInput` (input buat):
```
{ tipe: "gudang", id: string, user_penerima_id?: string | null, items?: PermintaanItem[] }
```

---

## 4. Cakupan yang TIDAK berubah dari v5

- Master gudang (F1), opname ber-approval (F7), toggle is-online (F8), filter stok (F9).
- RBAC 3 dimensi (level + jabatan + lokasi_gudang).
- Batas 50 gudang (BR15), `items <= 200`, `tujuan <= 20`.
- `stok_gudang_online` = key "ONLINE" di `qty_per_gudang` (Q4a).
- Cross-gudang READ diizinkan (R5); scope gudang hanya untuk filter default + tulis.

---

## 5. Non-goals v5.1

- Tidak ada approval berlapis (satu langkah setujui per tujuan).
- Tidak ada gudang transit / in-transit.
- Tidak ada webhook (polling/manual saja).
- Tidak ada multi-penerima per tujuan (satu penerima, atau kosong = owner fallback).

---

## 6. Acceptance Criteria global v5.1

1. Target permintaan HANYA gudang; `tipe: "user"` ditolak.
2. Tiap tujuan punya qty sendiri; kirim turunkan stok asal sebesar qty tujuan itu saja.
3. Penerima harus dari gudang tujuan; kosong = owner fallback.
4. `setujui-tujuan` / `kirim` hanya oleh penerima tujuan itu atau owner.
5. `terima` / `tidak-terima` / `selesai` hanya oleh pembuat atau owner.
6. `selesai` hanya berhasil bila SEMUA tujuan final; dokumen TIDAK auto-selesai.
7. `tolak-tujuan` menandai tujuan `ditolak` tanpa mengubah stok.
8. Notifikasi bot 6 titik; gagal kirim dicatat + peringatan UI, tidak menggagalkan transaksi.
9. Dropdown produk + user searchable (combobox).
10. TIdak ada `<SelectValue />` polos yang menampilkan nilai mentah (dikunci test).
11. Tabel admin menampilkan gudang + jabatan.
12. Gate: `npm test` 0 fail, `tsc` exit 0, e2e 0 fail.

---

## 7. Rujukan

- `docs/prd-v5.md` - PRD v5 lengkap (konteks).
- `docs/plan-v5.1.md` - rencana implementasi + keputusan Q1-Q10/P1-P8.
- `docs/plan-v5.md` - rencana v5.
