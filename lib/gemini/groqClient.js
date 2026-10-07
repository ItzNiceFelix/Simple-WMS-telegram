// lib/gemini/groqClient.js
// Adapter Groq (OpenAI-compatible chat completions) yang "menyamar" sebagai respons
// Gemini SDK — supaya chatHandler.js TIDAK PERLU DIUBAH sama sekali. chatHandler.js
// selalu baca respons lewat bentuk hasil.response.text() / hasil.response.candidates
// (lihat ambilFunctionCalls() di chatHandler.js), jadi selama adapter ini ngebalikin
// bentuk yang sama persis, provider di baliknya bisa ditukar lewat pengaturan Firestore.
//
// KENAPA fetch polos, bukan npm package groq-sdk: Groq expose endpoint OpenAI-compatible
// (https://api.groq.com/openai/v1/chat/completions), jadi gak perlu dependency tambahan —
// satu function fetch() bawaan Node 18+ sudah cukup, lebih gampang dirawat.
//
// Dipakai HANYA utk chat teks (TOOL_TERMINAL_LANGSUNG dkk di tools.js) — vision TETAP
// selalu lewat Gemini langsung (lib/gemini/ekstrakPickingList.js pakai ambilModel() dari
// client.js, gak lewat file ini sama sekali), gak peduli provider teks yang dipilih.

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const BATAS_WAKTU_GROQ_MS = Number(process.env.GROQ_TIMEOUT_MS) > 0 ? Number(process.env.GROQ_TIMEOUT_MS) : 30000;

// Model default: openai/gpt-oss-120b (Production tier di Groq — lihat catatan di
// promptSystem.js/README soal kenapa bukan model Preview). Override lewat env kalau
// mau ganti model TANPA ubah kode (misal turun ke openai/gpt-oss-20b buat tes kecepatan).
const MODEL_TEKS_GROQ = process.env.GROQ_MODEL_TEXT || "openai/gpt-oss-120b";

/**
 * Konversi `contents` gaya Gemini (array {role, parts:[{text}|{functionCall}|{functionResponse}]})
 * jadi `messages` gaya OpenAI/Groq. Pairing functionCall→tool_call_id dilakukan POSISIONAL:
 * di chatHandler.js, 1 entri "model" berisi functionCall SELALU diikuti 1 entri "user" berisi
 * functionResponse dalam URUTAN YANG SAMA (lihat handleChatBiasa) — jadi aman dipasangkan
 * berdasarkan urutan, gak butuh ID asli dari Gemini (yang emang gak generate ID sama sekali).
 */
function konversiContentsKeMessages(systemInstruction, contents) {
  const messages = [{ role: "system", content: systemInstruction }];
  let toolCallCounter = 0;
  let idToolCallPending = null; // array of {id} dari giliran functionCall terakhir, nunggu dipasangkan

  for (const item of contents || []) {
    const parts = item.parts || [];
    const bagianFunctionCall = parts.filter((p) => p.functionCall);
    const bagianFunctionResponse = parts.filter((p) => p.functionResponse);
    const bagianTeks = parts.filter((p) => typeof p.text === "string");

    if (bagianFunctionCall.length > 0) {
      const toolCalls = bagianFunctionCall.map((p) => {
        toolCallCounter += 1;
        return {
          id: `call_${toolCallCounter}`,
          type: "function",
          function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
        };
      });
      // PENTING: teks dlm parts yg sama TIDAK boleh dibuang — kalau model mengucap sesuatu
      // SEBELUM memanggil tool, teks itu bagian konteks giliran ini. Sebelumnya cabang ini
      // `continue` tanpa menyertakan text, jadi kalimat model hilang di request berikutnya.
      const teksAssistant = bagianTeks.map((p) => p.text).join("\n");
      messages.push({ role: "assistant", content: teksAssistant || null, tool_calls: toolCalls });
      idToolCallPending = toolCalls.map((tc) => tc.id);
      continue;
    }

    if (bagianFunctionResponse.length > 0) {
      bagianFunctionResponse.forEach((p, idx) => {
        // Fallback id sintetis kalau somehow gak ada pending (harusnya gak pernah kejadian
        // di alur normal chatHandler.js, tapi jaga-jaga daripada throw).
        const id = idToolCallPending?.[idx] || `call_tanpa_pasangan_${toolCallCounter}_${idx}`;
        messages.push({
          role: "tool",
          tool_call_id: id,
          content: JSON.stringify(p.functionResponse.response ?? {}),
        });
      });
      idToolCallPending = null;
      continue;
    }

    if (bagianTeks.length > 0) {
      messages.push({
        role: item.role === "model" ? "assistant" : "user",
        content: bagianTeks.map((p) => p.text).join("\n"),
      });
    }
  }

  return messages;
}

/**
 * Konversi function declarations gaya Gemini (dari tools.js: {name, description, parameters})
 * ke format tool OpenAI/Groq ({type:"function", function:{name, description, parameters}}).
 * Aman karena tools.js SUDAH pakai JSON Schema polos (bukan enum SDK Gemini spesifik),
 * jadi `parameters` bisa dipakai apa adanya, gak perlu konversi field lagi.
 */
function konversiToolsKeOpenAi(tools) {
  return (tools || []).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Konversi respons Groq (bentuk OpenAI chat.completions) balik ke bentuk yang dibaca
 * chatHandler.js dari respons Gemini SDK: { response: { text(), candidates } }.
 */
function konversiResponGroqKeGeminiShape(data) {
  const message = data?.choices?.[0]?.message || {};
  const parts = [];

  if (message.content) {
    parts.push({ text: message.content });
  }

  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}");
      } catch (err) {
        // Model open-weight kadang ngebalikin JSON args yang gak valid — daripada
        // seluruh respons gagal parse & bikin bot down, args dikosongkan aja, biar
        // tool eksekutor yang urus (biasanya bakal ke-skip krn kode_barang kosong dsb).
        console.error(`Gagal parse tool_call arguments dari Groq utk "${tc.function?.name}":`, err.message);
        args = {};
      }
      parts.push({ functionCall: { name: tc.function?.name, args } });
    }
  }

  const teksGabungan = parts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");

  return {
    response: {
      text: () => teksGabungan,
      candidates: [{ content: { role: "model", parts } }],
    },
  };
}

// Sama pola dgn apakahErrorBolehFallback() di client.js — dicek terpisah krn bentuk
// error Groq (fetch manual) beda dari bentuk error SDK Gemini.
function apakahErrorGroqBolehFallback(err) {
  const status = err?.status;
  if (status === 429 || status === 503) return true;
  if (err?.isNetworkError) return true;
  const pesan = String(err?.message || "").toLowerCase();
  return (
    pesan.includes("429") ||
    pesan.includes("503") ||
    pesan.includes("rate limit") ||
    pesan.includes("service unavailable") ||
    pesan.includes("overloaded") ||
    pesan.includes("failed to fetch") ||
    pesan.includes("network") ||
    pesan.includes("bukan json")
  );
}

/**
 * Panggil Groq chat completions, balikin dalam bentuk gaya-Gemini.
 * @param {object} opsi
 * @param {object[]} [opsi.tools] - function declarations (format tools.js, JSON Schema polos)
 * @param {string} [opsi.systemInstruction]
 * @param {object[]} opsi.contents - gaya Gemini
 */
async function panggilGroq({ tools, systemInstruction, contents }) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY belum di-set di environment variable");
  }

  const messages = konversiContentsKeMessages(systemInstruction, contents);
  const body = {
    model: MODEL_TEKS_GROQ,
    messages,
    tools: tools && tools.length ? konversiToolsKeOpenAi(tools) : undefined,
  };
  // parallel_tool_calls HANYA valid kalau "tools" ada — Groq balas 400
  // ("parallel_tool_calls" requires "tools" to be set) kalau dikirim tanpa tools.
  // Batch stok direpresentasikan sebagai beberapa tool call dalam satu respons;
  // OpenAI-compatible API tidak seharusnya mengandalkan default provider untuk ini.
  if (body.tools) body.parallel_tool_calls = true;

  let res;
  // Retry 1x utk error jaringan / 5xx (bukan 4xx — 4xx biasanya masalah request, bukan transient).
  // KENAPA di sini, bukan di client.js: panggilGroq() yg punya kendali langsung atas fetch + timeout.
  // PENTING: di Vercel free plan, extra invocations nambah Function execution time — retry cuma
  // utk kasus yg paling sering silent-fail (timeout / 503 transient Groq).
  const MAKS_RETRY = 1;
  let attempt = 0;
  let lastError = null;
  while (attempt <= MAKS_RETRY) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BATAS_WAKTU_GROQ_MS);
    try {
      res = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // 5xx = transient server-side, layak retry. 4xx = client's problem, jangan retry.
      if (!res.ok && res.status >= 500 && res.status < 600 && attempt < MAKS_RETRY) {
        await res.text().catch(() => ""); // drain body
        lastError = new Error(`Groq API error ${res.status}`);
        lastError.status = res.status;
        attempt += 1;
        continue;
      }
      lastError = null;
      break;
    } catch (err) {
      // Error jaringan (DNS/timeout/abort) — bungkus, pertimbangkan retry utk transient.
      const errJaringan = new Error(`Gagal menghubungi Groq: ${err.message}`);
      errJaringan.isNetworkError = true;
      lastError = errJaringan;
      if (attempt < MAKS_RETRY) {
        attempt += 1;
        continue;
      }
      throw errJaringan;
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError) throw lastError;

  if (!res.ok) {
    const teksError = await res.text().catch(() => "");
    const err = new Error(`Groq API error ${res.status}: ${teksError}`);
    err.status = res.status;
    throw err;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    // Body bukan JSON (mis. halaman error HTML dari Cloudflare/proxy) — status ok tapi isi
    // rusak. Bungkus jadi error yang dikenali apakahErrorGroqBolehFallback (isNetworkError),
    // biar bot jatuh ke Gemini, bukan mati dgn SyntaxError mentah.
    const errBody = new Error(`Respons Groq bukan JSON (mungkin gangguan jaringan/proxy): ${err.message}`);
    errBody.isNetworkError = true;
    throw errBody;
  }
  return konversiResponGroqKeGeminiShape(data);
}

module.exports = {
  panggilGroq,
  apakahErrorGroqBolehFallback,
  MODEL_TEKS_GROQ,
};
