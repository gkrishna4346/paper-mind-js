// LLM provider layer — Gemini, Anthropic Claude, or Hugging Face.
// Uses plain fetch against each REST API, so no provider SDKs are needed.

const env = process.env;
const KEYS = {
  gemini: env.GOOGLE_API_KEY || env.GEMINI_API_KEY,
  anthropic: env.ANTHROPIC_API_KEY,
  huggingface: env.HF_API_KEY || env.HUGGINGFACE_API_KEY,
};
const MODELS = {
  gemini: env.GEMINI_MODEL || "gemini-2.5-flash",
  anthropic: env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  huggingface: env.HF_MODEL || "meta-llama/Llama-3.3-70B-Instruct",
};

function pickProvider() {
  const forced = (env.LLM_PROVIDER || "").toLowerCase().trim();
  if (forced && KEYS[forced]) return forced;
  return ["gemini", "anthropic", "huggingface"].find((p) => KEYS[p]) || null;
}

export const PROVIDER = pickProvider();
export const MODEL = PROVIDER ? MODELS[PROVIDER] : null;

const TIMEOUT_MS = Number(env.LLM_TIMEOUT_MS || 60000);

async function post(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || data?.message || raw.slice(0, 300);
    const err = new Error(friendly(res.status, typeof detail === "string" ? detail : JSON.stringify(detail)));
    err.status = res.status;
    throw err;
  }
  return data;
}

function friendly(status, detail) {
  if (status === 401 || status === 403) return `The ${PROVIDER} API key was rejected (${status}). Check the key set on the server.`;
  if (status === 404) return `Model "${MODEL}" was not found for ${PROVIDER}. Check the model name on the server. (${detail})`;
  if (status === 429) return `The ${PROVIDER} API rate limit or quota was hit. Wait a minute and try again. (${detail})`;
  if (status >= 500) return `The ${PROVIDER} API is having trouble right now (${status}). Please try again shortly.`;
  return `${PROVIDER} API error ${status}: ${detail}`;
}

export async function askLLM(system, user, { maxTokens = 1200, temperature = 0.2 } = {}) {
  if (!PROVIDER) {
    throw new Error(
      "No LLM API key is configured on the server. Set GOOGLE_API_KEY, ANTHROPIC_API_KEY or HF_API_KEY in .env (or in Render's Environment tab) and restart."
    );
  }

  if (PROVIDER === "gemini") {
    const generationConfig = { maxOutputTokens: maxTokens, temperature };
    // 2.5 Flash "thinks" by default, which eats the output budget; Q&A over given context doesn't need it.
    if (/^gemini-2\.5-flash/.test(MODEL)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const data = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      { "x-goog-api-key": KEYS.gemini },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig,
      }
    );
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || "").join("").trim();
  }

  if (PROVIDER === "anthropic") {
    const data = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": KEYS.anthropic, "anthropic-version": "2023-06-01" },
      { model: MODEL, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: user }] }
    );
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }

  // Hugging Face Inference Providers — OpenAI-compatible router.
  const data = await post(
    "https://router.huggingface.co/v1/chat/completions",
    { Authorization: `Bearer ${KEYS.huggingface}` },
    {
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }
  );
  return (data?.choices?.[0]?.message?.content || "").trim();
}

export function providerStatus() {
  return {
    provider: PROVIDER,
    model: MODEL,
    keysFound: Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, Boolean(v)])),
  };
}
