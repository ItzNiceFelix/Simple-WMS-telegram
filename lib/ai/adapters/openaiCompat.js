// lib/ai/adapters/openaiCompat.js
// Generic OpenAI-compatible chat completions adapter.

function konversiContentsKeMessages(systemInstruction, contents) {
  const messages = [{ role: "system", content: systemInstruction }];
  let toolCallCounter = 0;
  let idToolCallPending = null;

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
      const teksAssistant = bagianTeks.map((p) => p.text).join("\n");
      messages.push({ role: "assistant", content: teksAssistant || null, tool_calls: toolCalls });
      idToolCallPending = toolCalls.map((tc) => tc.id);
      continue;
    }

    if (bagianFunctionResponse.length > 0) {
      bagianFunctionResponse.forEach((p, idx) => {
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

function konversiToolsKeOpenAi(tools) {
  return (tools || []).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function konversiResponKeGeminiShape(data, label) {
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
        console.error(`Gagal parse tool_call arguments dari provider "${label}": ${err.message}`);
        args = {};
      }
      parts.push({ functionCall: { name: tc.function?.name, args } });
    }
  }

  const teksGabungan = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("\n");

  return {
    response: {
      text: () => teksGabungan,
      candidates: [{ content: { role: "model", parts } }],
    },
  };
}

function apakahErrorBolehFallback(err) {
  // D1: config tak lengkap (mis. API key absen) = layak fallback, bukan fatal.
  if (err?.perluFallbackProvider) return true;
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
    pesan.includes("network")
  );
}

function buatProviderOpenAiCompat(config) {
  const { label, baseUrl, apiKeyEnv, model: defaultModel, models, timeoutMs = 30000 } = config;

  const API_KEY = () => process.env[apiKeyEnv];
  // D1: JANGAN throw saat key absen. Adapter tetap dibuat supaya request bisa
  // fallback ke provider lain; error baru dilempar saat pemanggilan.
  const keyKosong = () => !String(API_KEY() || "").trim();

  async function panggilOpenAiCompat({ tools, systemInstruction, contents, modelIndex } = {}) {
    if (keyKosong()) {
      const err = new Error(`Provider ${label} tidak dapat dipakai: ${apiKeyEnv} belum di-set`);
      err.perluFallbackProvider = true;
      throw err;
    }
    const messages = konversiContentsKeMessages(systemInstruction, contents);
    const model = modelIndex !== undefined && models?.[modelIndex]
      ? models[modelIndex]
      : defaultModel;

    const body = {
      model,
      messages,
    };

    if (tools && tools.length) {
      body.tools = konversiToolsKeOpenAi(tools);
      body.parallel_tool_calls = true;
    }

    let res;
    const MAKS_RETRY = 1;
    let attempt = 0;
    let lastError = null;

    while (attempt <= MAKS_RETRY) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        res = await fetch(baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${API_KEY()}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok && res.status >= 500 && res.status < 600 && attempt < MAKS_RETRY) {
          await res.text().catch(() => "");
          lastError = new Error(`Provider ${label} error ${res.status}`);
          lastError.status = res.status;
          attempt += 1;
          continue;
        }

        lastError = null;
        break;
      } catch (err) {
        const errJaringan = new Error(`Gagal menghubungi provider ${label}: ${err.message}`);
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
      const err = new Error(`Provider ${label} error ${res.status}: ${teksError}`);
      err.status = res.status;
      throw err;
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      const errBody = new Error(`Respons ${label} bukan JSON (biasanya gangguan jaringan/proxy): ${err.message}`);
      errBody.isNetworkError = true;
      throw errBody;
    }

    return konversiResponKeGeminiShape(data, label);
  }

  return {
    panggilOpenAiCompat,
    apakahErrorBolehFallback,
    label,
  };
}

module.exports = {
  buatProviderOpenAiCompat,
};