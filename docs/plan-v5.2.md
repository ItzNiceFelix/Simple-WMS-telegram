# Rencana Implementasi v5.2 - Mutasi Stok Antar-Gudang

Status: rencana eksekusi. Tanggal: 2026-09-17.
Sumber: permintaan user (mutasi item antar gudang).
Dokumen ini RENCANA. Tidak ada kode yang diubah.

---

## 1. Ringkasan

Fitur: pindahkan stok satu item dari gudang A ke gudang B dalam SATU operasi atomik,
tercatat, dan tidak bisa membuat stok negatif.

Beda dengan `set-qty` (set nilai absolut per gudang, dua operasi manual):

| Aspek | set-qty (ada) | mutasi (BARU) |
|---|---|---|
| Operasi | ubah satu gudang | pindah antar dua gudang |
| Atomik | ya (satu gudang) | ya (dua gudang, satu transaksi) |
| Total kekal | tidak dijamin | DIJAMIN (kurang di A = tambah di B) |
| Stok negatif | boleh (koreksi) | DITOLAK |
| Audit | tiap set-qty | dua entri (keluar + masuk) |

### Alur

```
POST /api/stok/gudang
  { aksi: "mutasi-gudang", kode_barang, dari_gudang_id, ke_gudang_id, qty }

  guard: tolakOrigin -> sesi -> rate limit -> role -> validasi -> scope -> model
     |
     v
  mutasiStokGudang() runTransaction:
     baca stock sekali (trx.get)
     map = normalisasiQtyPerGudang(data)
     map[dari] >= qty?  TIDAK -> { ok:false, status:409, "Stok gudang asal tidak cukup." }
     map[dari] -= qty
     map[ke]   += qty
     trx.set(stock, payloadQtyGudang x2)   // SATU set, map utuh
     (paritas stok_gudang_online ikut bila dari/ke = ONLINE)
     |
     v
  audit: 2 entri stock_movements (keluar dari `dari`, masuk ke `ke`)
     |
     v
  { ok:true, qty_per_gudang }
```

---

## 2. Keputusan desain

### D1 - Bentuk aksi: route EXISTING `/api/stok/gudang`

Aksi `mutasi-gudang` ditambah di route yang sama dengan `set-qty`.

TEMUAN (harus diperbaiki lebih dulu): route `/api/stok/gudang` SEKARANG tidak membaca
`aksi` - langsung panggil `validasiSetQtyGudang` (`app/api/stok/gudang/route.ts`).
Padahal `real.ts:705` sudah mengirim `{ aksi: "set-qty", ... }`. Jadi route perlu
diubah jadi DISPATCHER `aksi` (pola `/api/permintaan-gudang`).

Alternatif ditolak: route baru. Alasannya duplikasi guard/sesi/rate/role + tambah file
tanpa manfaat.

### D2 - Model `mutasiStokGudang` di `lib/models/stok.js`

```js
async function mutasiStokGudang(kodeBarang, dariGudangId, keGudangId, qty, oleh)
  -> { ok:true, qty_per_gudang } | { ok:false, status, error }
```

- `runTransaction`: `trx.get` SEKALI, validasi stok cukup DI DALAM transaksi (anti race),
  satu `trx.set` dengan map utuh.
- `payloadQtyGudang` dipakai dua kali (turunkan `dari`, naikkan `ke`) lalu satu set.
- Stok asal kurang -> `{ ok:false, status:409, error:"Stok gudang asal tidak cukup." }`.
- `dari === ke` -> 400. Gudang tidak aktif -> 400.

Alternatif ditolak: dua `setQtyGudang` terpisah - TIDAK atomik, bisa setengah jalan.

### D3 - Audit: DUA entri `stock_movements`

| Entri | qty | gudang_id | action_type |
|---|---|---|---|
| keluar | `-qty` (bertanda) | `dari` | `mutasi_gudang` |
| masuk | `+qty` (bertanda) | `ke` | `mutasi_gudang` |

Alasan: konsisten kontrak delta bertanda (lihat `test/mutasiStok.test.js`); filter per
gudang menghasilkan audit benar di tiap sisi; satu entri menyembunyikan sisi masuk.

Audit ditulis SETELAH commit, gagal audit tidak rollback (BR10) -> `peringatan_audit`.

### D4 - `MovementType`: pakai `"koreksi_manual"` (TIDAK tambah nilai baru)

`MovementType` (`types.ts:7-12`) dipakai filter histori. Menambah nilai baru = perubahan
kontrak + cabang UI baru. `action_type` sudah string bebas dan `"mutasi_gudang"` sudah
dipakai di alur kirim permintaan (architecture-v5.md:439).

### D5 - Validator `validasiMutasiGudang` di `lib/dashboard/validasiGudangV5.js`

Wajib: `kode_barang` non-kosong, `dari_gudang_id` + `ke_gudang_id` id-aman,
`dari !== ke` (pesan: `"Gudang asal dan tujuan tidak boleh sama."`),
`qty` integer >= 1.

Plus `validasiAksiStokGudang(body)` sebagai dispatcher: `set-qty` | `mutasi-gudang`.

### D6 - DataSource

```ts
mutasiStokGudang(req: MutasiStokGudangRequest): Promise<MutasiStokGudangResponse>
```
- `real.ts`: `kirimTulis("/api/stok/gudang", { aksi: "mutasi-gudang", ...req })`
- `mock.ts`: paritas penuh (role, scope gudang, stok cukup, map + paritas ONLINE)
- `sumber-data.tsx`: stub

### D7 - UI: perluas `dialog-stok-gudang.tsx`

Mode toggle (ToggleGroup): **"Set qty"** | **"Mutasi"**.
Alasan: reuse pemuatan gudang + kartu item; tidak duplikasi dialog.

Mode Mutasi: pilih gudang asal (default gudang user), gudang tujuan, qty.
Info stok sekarang di gudang asal. Validasi client: qty <= stok asal.

testid: `mode-stok-gudang`, `pilih-gudang-asal`, `pilih-gudang-tujuan`,
`input-qty-mutasi`, `submit-mutasi-gudang`.

### D8 - Otorisasi: ikut pola `set-qty`

Admin hanya boleh bila `dari_gudang_id === admins.gudang_id` (memindah DARI gudangnya).
Owner bebas. Alasan: admin cabang bertanggung jawab atas stok gudangnya; menarik DARI
gudang lain bukan wewenangnya.

### D9 - Stok negatif: DITOLAK

Server tolak `map[dari] < qty` -> 409. Tidak ada bypass (beda dengan `set-qty` yang boleh
negatif karena itu koreksi manual).

### D10 - Idempotensi: guard best-effort

`guardV5.js` koleksi `stokGudang`, kunci `mutasi:${uid}`, pembanding
`{kode, dari, ke, qty}`, TTL 10 detik. Pengaman utama tetap transaksi (cek stok cukup).
Guard gagal jangan blokir operasi sah.

---

## 3. Perubahan file

| File | Perubahan |
|---|---|
| `lib/models/stok.js` | + `mutasiStokGudang` |
| `lib/dashboard/validasiGudangV5.js` | + `validasiMutasiGudang`, + `validasiAksiStokGudang` |
| `app/api/stok/gudang/route.ts` | jadi DISPATCHER aksi (set-qty / mutasi-gudang) |
| `lib/dashboard/types.ts` | + `MutasiStokGudangRequest/Response` |
| `lib/dashboard/data/index.ts` | + method |
| `lib/dashboard/data/real.ts` | + implementasi |
| `lib/dashboard/data/mock.ts` | + paritas |
| `lib/dashboard/sumber-data.tsx` | + stub |
| `components/dashboard/dialog-stok-gudang.tsx` | + mode Mutasi |
| `test/stokGudangMutasi.test.js` | BARU |
| `test/validasiMutasi.test.js` | BARU |
| `test/permintaanRouteV5.test.js` | + test mutasi (atau file baru) |

---

## 4. Rencana task per wave

### Wave 1 - Model + Validasi (4 task)

| ID | File | Kerja | Test | Kompleksitas |
|---|---|---|---|---|
| W1-T1 | `lib/models/stok.js` | `mutasiStokGudang` (transaksi, cek cukup, satu set) | 12 | SEDANG |
| W1-T2 | `lib/dashboard/validasiGudangV5.js` | `validasiMutasiGudang` | 6 | KECIL |
| W1-T3 | idem | `validasiAksiStokGudang` (dispatcher) | 4 | KECIL |
| W1-T4 | `test/stokGudangMutasi.test.js` (BARU) | test model + mutation-test | - | SEDANG |

### Wave 2 - Route + DataSource (4 task)

| ID | File | Kerja | Test | Kompleksitas |
|---|---|---|---|---|
| W2-T1 | `app/api/stok/gudang/route.ts` | dispatcher aksi + scope + guard | 6 | SEDANG |
| W2-T2 | `lib/dashboard/types.ts` | tipe request/response | tsc | KECIL |
| W2-T3 | `index.ts` + `real.ts` + `sumber-data.tsx` | method | tsc | KECIL |
| W2-T4 | `mock.ts` | paritas penuh | 8 | SEDANG |

### Wave 3 - UI + gate (3 task)

| ID | File | Kerja | Kompleksitas |
|---|---|---|---|
| W3-T1 | `dialog-stok-gudang.tsx` | mode Mutasi | SEDANG |
| W3-T2 | `e2e/stok-mutasi.spec.ts` (BARU) | e2e 6 test | SEDANG |
| W3-T3 | - | gate penuh + verifikasi | KECIL |

---

## 5. Strategi test

Prinsip repo: **unit murni = gate utama** (cepat), e2e minimal.

| File | Target | Isi |
|---|---|---|
| `test/stokGudangMutasi.test.js` | 12-16 | pindah normal, stok kurang, dari=ke, gudang nonaktif, isolasi key lain, paritas ONLINE, total kekal, atomik (gagal = tidak ada perubahan) |
| `test/validasiMutasi.test.js` | 6-8 | validasi input |
| `test/permintaanRouteV5.test.js` | +4 | route: dispatcher, scope admin, guard |
| `e2e/stok-mutasi.spec.ts` | 6 | buka dialog, ganti mode, submit, error stok kurang |

---

## 6. Gate + risiko

### Gate
1. `npm test` - 0 fail
2. `npx tsc --noEmit` - exit 0
3. `npm run e2e:fast` - 0 fail
4. `npm run e2e:full` - 0 fail (sebelum rilis)

### Risiko

| # | Risiko | Mitigasi |
|---|---|---|
| R1 | Route dispatcher mengubah perilaku `set-qty` yang sudah jalan | Test regresi `set-qty` tetap hijau + e2e existing |
| R2 | Mutasi gagal setengah jalan | SATU transaksi, satu `set` - tidak mungkin setengah |
| R3 | Stok negatif | Cek di dalam transaksi sebelum tulis |
| R4 | Audit gagal | Best-effort (BR10), tidak rollback stok |
| R5 | Race dua mutasi bersamaan | Transaksi Firestore serialisasi; yang kedua baca nilai terbaru |

---

## 7. Keputusan Final (P1-P3 + Gap 2) - TERKUNCI

| # | Pertanyaan | Keputusan |
|---|---|---|
| P1 | Gudang nonaktif | **TOLAK** - mutasi dari/ke gudang nonaktif -> 400 |
| P2 | Notifikasi mutasi | **TIDAK** - cukup audit `stock_movements` |
| P3 | Riwayat mutasi | **`/histori` existing** - tidak ada UI tambahan |
| G2 | Audit `set-qty` | **DIPERBAIKI** - `set-qty` juga tulis `stock_movements` (`action_type: set_qty_gudang`) |

Dampak G2 ke task: W2-T1 (route dispatcher) menambah penulisan audit untuk `set-qty`,
bukan hanya mutasi. Test regresi diperlukan supaya perilaku `set-qty` yang sudah jalan
tidak berubah selain bertambahnya audit.
