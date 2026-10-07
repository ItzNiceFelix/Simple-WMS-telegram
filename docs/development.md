# Panduan Kontribusi

Panduan konvensi & resep menambah fitur. Baca `docs/architecture.md` dulu untuk peta wiring.

## Konvensi kode

- **CommonJS**: `require(...)` / `module.exports`, bukan ESM. `package.json` menetapkan `"type": "commonjs"`.
- **Nama fungsi & variabel Bahasa Indonesia** (`ambilProdukByKode`, `kirimPesan`, `apakahAdaPendingOpname`).
- **Komentar Bahasa Indonesia**, menjelaskan *kenapa* (terutama alasan desain & workaround), bukan sekadar *apa*.
- **Tanpa framework**: Node >=18, `fetch` bawaan, tanpa dotenv (env di-inject Vercel/GitHub Actions). Hindari menambah dependensi kalau stdlib cukup.
- **Liber** di `lib/` tetap murni: jangan membaca `.env` sendiri, jangan validasi env di dalamnya — validasi di boundary (`api/webhook.js`, `scripts/*.js`) lewat `lib/config/env.js`.
- **Cache in-memory**: bila menambah query Firestore yang sering dipanggil, pertimbangkan cache module-level + TTL (contoh: `models/produk.js`, `models/stok.js`) dan panggil `invalidasiCache*` setiap kali data berubah.
- **Error handling**: kegagalan non-fatal (notif, counter) cukup di-`console.error`, jangan sampai membatalkan operasi data utama. Kegagalan yang mengubah state harus dicegah agar tidak ambigu (lihat pola hapus-pending-duluan di `chatHandler.js`).

## Menambah command

1. Tulis fungsi handler `async function handleX(ctx)` di `lib/router/handleCommand.js` (atau file handler terpisah untuk logic berat). `ctx` berisi `{message, chatId, telegramUserId, telegramUsername, telegramDisplayName, argumen}`.
2. Daftarkan di `DAFTAR_COMMAND`:

```js
const DAFTAR_COMMAND = {
  // ...
  nama_command: handleX,
};
```

3. Tambahkan barisnya ke pesan `/help` di `handleHelp()` supaya konsisten dengan daftar nyata.
4. Kalau butuh akses khusus, cek `isSuperAdmin(ctx.telegramUserId)` atau role admin di awal handler dan kirim pesan penolakan.
5. Argumen setelah command tersedia di `ctx.argumen` (array string), hasil `parseCommand()`.

## Menambah AI tool

1. Tambahkan deklarasi ke array `TOOLS` di `lib/gemini/tools.js`:

```js
{
  name: "namaTool",
  description: "Kapan tool ini dipakai...",
  parameters: { type: "object", properties: { /* ... */ }, required: [/* ... */] },
}
```

2. Tentukan kategorinya dengan mendaftarkan ke himpunan yang sesuai:
   - `IMPLEMENTASI` + read-only langsung (tidak butuh resolusi produk) → tambahkan ke `IMPLEMENTASI` object.
   - `TOOL_BUTUH_RESOLUSI_PRODUK` → kalau butuh resolve nama→produk lewat `cariProdukPintar`.
   - `TOOL_PERLU_KONFIRMASI` → kalau perlu pendingAction "ya"/"tidak".
   - `TOOL_TERMINAL_LANGSUNG` → kalau loop harus berhenti dan ditangani handler sendiri.
3. Wire di `lib/gemini/chatHandler.js`: read-only lewat `jalankanToolReadOnly`, tool resolusi lewat `tanganiToolResolusiProduk`, tool terminal lewat `tanganiToolTerminal`. Pastikan bentuk `pendingAction` sesuai (ada helper `bentukPendingAction*`).
4. Perbarui `SYSTEM_PROMPT` di `lib/gemini/promptSystem.js` supaya AI tahu kapan memakainya (terutama membedakan tool yang mirip, mis. `tambahStok` vs `mulaiOpname`).
5. Tambahkan test untuk bentuk data / kontrak (lihat bawah).

Catatan kontrak: `tools.js` memakai JSON Schema polos, jadi otomatis kompatibel dengan adapter Groq (`groqClient.js`).

## Menambah model Firestore

1. Buat `lib/models/namaKoleksi.js`, ikuti pola yang ada:

```js
const { db } = require("../firebase");
const KOLEKSI = "nama_koleksi";

async function ambilX(id) { /* ... */ }
async function simpanX(id, data) { /* ... */ }
module.exports = { ambilX, simpanX };
```

2. Format waktu pakai `new Date()` (Firestore Timestamp). Untuk field yang bisa `undefined`, normalisasi ke `null` — Firestore menolak `undefined` di dalam object/array nested.
3. Kalau menyentuh `products`/`stock`, panggil `invalidasiCacheProduk()`/`invalidasiCacheStok()` setelah write.
4. Kalau butuh state pending di session, daftarkan nama field-nya di `SEMUA_FIELD_PENDING` (`lib/models/sessions.js`) agar `/batal` ikut membersihkannya.
5. Tambah index di `firestore.indexes.json` bila query butuh composite index, lalu `firebase deploy --only firestore:indexes`.

## Menulis test

Test memakai `node:test` + `node:assert/strict`. Pola file di `test/`:

1. Isi env dummy minimal sebelum `require` modul yang meng-inisialisasi Firebase/Gemini (lihat contoh di `test/routeFotoOpname.test.js`). Private key bisa digenerate atau dummy.
2. Untuk test yang menyentuh Firestore, pakai mock:

```js
const { installMockFirestore } = require("./helpers/mockFirestore");
const { db, collections } = installMockFirestore();

// installMockFirestore() HARUS dipanggil SEBELUM require modul yang menarik lib/firebase.js
const { ambilActionTypeUntukPenanda } = require("../lib/models/keywordNotes");
```

`mockFirestore` mendukung `doc.get/set/update/delete`, `collection.add`, `where(...).limit(...).get()`, dan `runTransaction`. Bersihkan store antar test dengan `collections.get("nama_koleksi")?.clear()`.

3. Export fungsi murni yang perlu diuji dari modulnya (contoh: `adalahFotoOpname` di-export dari `routePesan.js` khusus supaya bisa dites).
4. Jalankan:

```bash
npm test
```

CI menjalankan perintah yang sama. Test dilarang memakai kredensial nyata.

## Menambah cron

1. Buat lib function yang melakukan pekerjaan di `lib/reminder/` atau `lib/sheets/`.
2. Buat entry point CLI di `scripts/jalankan*.js` (pola `scripts/jalankanSyncMasterData.js`):

```js
const { pekerjaan } = require("../lib/...");
const { kirimNotifErrorCron } = require("../lib/telegram/notifikasiError");
const { validasiEnvSesuaiKonteks } = require("../lib/config/env");

async function main() {
  validasiEnvSesuaiKonteks();
  // jalankan pekerjaan
}

main().catch(async (err) => {
  await kirimNotifErrorCron("Nama Job", err);
  process.exitCode = 1;
});
```

3. Tambahkan validator env baru di `lib/config/env.js` bila konteks butuh env berbeda.
4. Buat workflow di `.github/workflows/` dengan `schedule` (UTC) + `workflow_dispatch`, `environment: production`, dan daftar `secrets` yang dibutuhkan. Perhatikan konversi WIB = UTC+7.
5. Serverless Vercel dibatasi (Hobby) — proyek ini memakai GitHub Actions untuk cron, bukan Vercel Cron.

## Checklist sebelum PR

- [ ] `npm test` hijau.
- [ ] `node --check` pada file yang diubah (syntax).
- [ ] Tidak ada kredensial/secret di commit.
- [ ] Pesan `/help` masih cocok dengan `DAFTAR_COMMAND` bila menambah command.
- [ ] Dokumentasi (`README.md`, `docs/`) diperbarui bila perilaku publik berubah.