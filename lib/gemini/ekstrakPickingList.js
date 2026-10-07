// lib/gemini/ekstrakPickingList.js
// Ekstrak data mentah dari screenshot picking list pakai Gemini vision.
// Fokus SATU tanggung jawab: baca gambar → keluarkan array baris mentah.
// Gak ada logic matching produk / interpretasi keyword di sini — itu urusan
// cariProdukByNama.js dan keywordNotes.js, dipanggil dari handler.

const { ambilModel } = require("./client");

// Prompt khusus ekstraksi, terpisah dari SYSTEM_PROMPT chat biasa (promptSystem.js)
// karena tugasnya beda total: bukan percakapan, murni ekstraksi terstruktur.
const PROMPT_EKSTRAKSI = `
Kamu membaca screenshot picking list gudang online sebuah toko.
Formatnya tabel 4 kolom TANPA header eksplisit di gambar:
1. Nama Produk (nama informal/tulisan tangan, bukan nama resmi Accurate/Shopee)
2. Variasi (bisa kosong / ditulis "-")
3. Qty (angka)
4. Penanda (teks bebas, bisa kosong — kode lokasi lama seperti D12/D19/SDA, atau kata kunci baru,
   JANGAN diinterpretasikan artinya, catat apa adanya)

Baca SEMUA baris di gambar, dari atas ke bawah, seakurat mungkin. Kalau ada tulisan tangan yang
ambigu, tulis interpretasi terbaikmu tapi jangan mengarang baris yang tidak ada.

Balas HANYA dengan JSON array, tanpa markdown backtick, tanpa penjelasan tambahan. Format tiap item:
{
  "nama_terbaca": string,       // nama produk apa adanya dari gambar
  "variasi": string,            // "-" kalau kosong/tanpa varian
  "qty": number,
  "penanda": string             // "" kalau kolom ke-4 kosong
}

Kalau gambar sama sekali bukan picking list atau tidak terbaca, balas: []
`.trim();

/**
 * Ekstrak baris-baris picking list dari satu gambar (base64).
 * @param {string} base64Image - data gambar base64, tanpa prefix "data:image/..."
 * @param {string} mimeType - contoh "image/jpeg" atau "image/png"
 * @returns {Promise<Array<{nama_terbaca: string, variasi: string, qty: number, penanda: string}>>}
 */
async function ekstrakPickingList(base64Image, mimeType = "image/jpeg") {
  const model = ambilModel({}); // gak perlu tools/systemInstruction chat biasa, prompt sudah lengkap di atas

  const result = await model.generateContent([
    { text: PROMPT_EKSTRAKSI },
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
  ]);

  const teksMentah = result.response.text().trim();
  const teksBersih = bersihkanJsonFence(teksMentah);

  let hasilParsed;
  try {
    hasilParsed = JSON.parse(teksBersih);
  } catch (err) {
    throw new Error(
      `Gagal parse hasil ekstraksi Gemini sebagai JSON: ${err.message}\nRaw: ${teksMentah.slice(0, 500)}`
    );
  }

  if (!Array.isArray(hasilParsed)) {
    throw new Error("Hasil ekstraksi Gemini bukan array seperti yang diharapkan.");
  }

  return hasilParsed.map(validasiDanNormalisasiBaris).filter(Boolean);
}

/**
 * Jaga-jaga kalau Gemini tetap bungkus jawaban dengan ```json ... ``` walau sudah diminta jangan.
 */
function bersihkanJsonFence(teks) {
  return teks.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
}

/**
 * Validasi tiap baris hasil ekstraksi, drop baris yang gak masuk akal (misal qty bukan angka positif)
 * daripada meneruskan data rusak ke tahap matching.
 */
function validasiDanNormalisasiBaris(baris) {
  if (!baris || typeof baris !== "object") return null;

  const namaTerbaca = String(baris.nama_terbaca || "").trim();
  const variasi = String(baris.variasi || "-").trim() || "-";
  const qty = Number(baris.qty);
  const penanda = String(baris.penanda || "").trim();

  if (!namaTerbaca) return null;
  if (!Number.isFinite(qty) || qty <= 0) return null;

  return { nama_terbaca: namaTerbaca, variasi, qty, penanda };
}

module.exports = { ekstrakPickingList };
