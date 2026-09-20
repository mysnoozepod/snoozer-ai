const axios = require("axios");
const { getIntegrationCredentials } = require("./integrationSecrets");

const FAST_MODEL = process.env.OPENAI_FAST_MODEL || "gpt-4o-mini";
const FINAL_MODEL = process.env.OPENAI_FINAL_MODEL || "gpt-4o";

const MODEL_TIMEOUT_MS = Math.max(1000, Number(process.env.MODEL_TIMEOUT_MS || 7000));
const OPENAI_REQUEST_CEILING_MS = Math.max(750, MODEL_TIMEOUT_MS - 1000);
const AXIOS_TIMEOUT_MS = Math.max(
  500,
  Math.min(OPENAI_REQUEST_CEILING_MS, Number(process.env.OPENAI_TIMEOUT_MS || 5500))
);
const FAST_TIMEOUT_MS = Math.max(
  500,
  Math.min(AXIOS_TIMEOUT_MS, Number(process.env.FAST_PATH_TIMEOUT_MS || AXIOS_TIMEOUT_MS))
);
const ADVISOR_COMPOSER_TIMEOUT_MS = Math.max(
  FAST_TIMEOUT_MS,
  Math.min(15000, Number(process.env.ADVISOR_COMPOSER_TIMEOUT_MS || 8000))
);
const MAX_TOTAL_MESSAGE_CHARS = Number(process.env.MAX_TOTAL_MESSAGE_CHARS || 60000);
const OPENAI_RUN_MAX_RETRIES = Math.min(
  1,
  Math.max(0, Number(process.env.OPENAI_RUN_MAX_RETRIES || 0))
);
const OPENAI_RUN_MAX_WAIT_MS = Math.min(
  500,
  Math.max(0, Number(process.env.OPENAI_RUN_MAX_WAIT_MS || 0))
);

const openai = axios.create({
  baseURL: "https://api.openai.com/v1",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: AXIOS_TIMEOUT_MS,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logEvent(event, data = {}) {
  try {
    console.log(
      JSON.stringify({
        source: "snoozer",
        event,
        ts: new Date().toISOString(),
        ...data,
      })
    );
  } catch {
    console.log(`[snoozer:${event}]`, data);
  }
}

function truncateForLog(value, max = 1400) {
  try {
    if (value === null || value === undefined) return value;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text.length <= max) return text;
    return text.slice(0, max) + `…(truncated ${text.length - max} chars)`;
  } catch {
    return "[unserializable]";
  }
}

function normalizeRole(role) {
  const normalized = String(role || "").trim();
  if (["system", "user", "assistant", "tool"].includes(normalized)) return normalized;
  return "user";
}

function safeStringContent(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return String(value);
  } catch {
    return "";
  }
}

function normalizeMessages(messages = [], reqId, { trim = true } = {}) {
  const out = [];
  let totalChars = 0;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message) continue;
    const role = normalizeRole(message.role);

    if (role === "tool") {
      const tool_call_id =
        typeof message.tool_call_id === "string" && message.tool_call_id.trim()
          ? message.tool_call_id.trim()
          : null;
      const cleaned = safeStringContent(message.content).trim();
      if (!cleaned) continue;
      if (!tool_call_id) {
        logEvent("openai.tool_message.missing_tool_call_id", {
          reqId,
          sample: truncateForLog({ role: "tool", content: cleaned.slice(0, 200) }, 500),
        });
        continue;
      }
      out.push({ role: "tool", tool_call_id, content: cleaned });
      totalChars += cleaned.length;
      continue;
    }

    if (role === "assistant") {
      const cleaned = safeStringContent(message.content).trim();
      const messageOut = { role: "assistant", content: cleaned };
      if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
        messageOut.tool_calls = message.tool_calls;
      }
      if (!cleaned && !messageOut.tool_calls) continue;
      out.push(messageOut);
      totalChars += cleaned.length;
      continue;
    }

    const cleaned = safeStringContent(message.content).trim();
    if (!cleaned) continue;
    out.push({ role, content: cleaned });
    totalChars += cleaned.length;
  }

  const hasToolBlocks =
    out.some((message) => message?.role === "tool") ||
    out.some(
      (message) =>
        message?.role === "assistant" &&
        Array.isArray(message?.tool_calls) &&
        message.tool_calls.length
    );
  if (!trim || hasToolBlocks) return out;

  if (totalChars > MAX_TOTAL_MESSAGE_CHARS) {
    const keep = [];
    let chars = 0;
    for (const message of out) {
      if (message.role === "system") {
        keep.push(message);
        chars += (message.content || "").length;
      }
    }
    const nonSystem = out.filter((message) => message.role !== "system");
    for (let index = nonSystem.length - 1; index >= 0; index -= 1) {
      const message = nonSystem[index];
      const length = message?.content?.length || 0;
      if (chars + length > MAX_TOTAL_MESSAGE_CHARS) break;
      keep.unshift(message);
      chars += length;
    }
    logEvent("openai.messages.trimmed", {
      reqId,
      beforeCount: out.length,
      afterCount: keep.length,
      beforeChars: totalChars,
      afterChars: chars,
      cap: MAX_TOTAL_MESSAGE_CHARS,
    });
    return keep;
  }

  return out;
}

function summarizePayload(messages) {
  const msgCount = Array.isArray(messages) ? messages.length : 0;
  const chars = Array.isArray(messages)
    ? messages.reduce((sum, message) => sum + (message?.content?.length || 0), 0)
    : 0;
  const roles = Array.isArray(messages)
    ? messages.reduce((accumulator, message) => {
        const role = message?.role || "unknown";
        accumulator[role] = (accumulator[role] || 0) + 1;
        return accumulator;
      }, {})
    : {};
  return { msgCount, chars, roles };
}

async function callOpenAIChat({
  messages,
  reqId,
  model = FINAL_MODEL,
  maxTokens = 350,
  timeoutMs = FAST_TIMEOUT_MS,
}) {
  const { OPENAI_API_KEY: apiKey } = await getIntegrationCredentials("openai");
  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY missing");
    error.code = "OPENAI_KEY_MISSING";
    throw error;
  }

  let attempt = 0;
  for (;;) {
    try {
      const normalized = normalizeMessages(messages, reqId, { trim: true });
      const payload = {
        model,
        temperature: 0.2,
        max_tokens: Math.max(64, Math.min(800, Number(maxTokens) || 350)),
        messages: normalized,
      };
      logEvent("openai.start", {
        reqId,
        attempt,
        timeoutMs,
        ...summarizePayload(payload.messages),
      });
      const response = await openai.post("/chat/completions", payload, {
        timeout: timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = response.data || {};
      const message = data.choices?.[0]?.message || {};
      const usage = data.usage || {};
      logEvent("openai.ok", { reqId, usedTools: false });
      return {
        text: message.content || "",
        model: data.model || model,
        tokens: {
          prompt: usage.prompt_tokens ?? null,
          completion: usage.completion_tokens ?? null,
          total: usage.total_tokens ?? null,
        },
        raw: data,
      };
    } catch (error) {
      const status = error?.response?.status;
      const code = status || error?.code || "ERR";
      logEvent("openai.error.detail", {
        reqId,
        attempt,
        code,
        message: error?.message,
        response: truncateForLog(error?.response?.data),
      });
      const retriable =
        attempt < OPENAI_RUN_MAX_RETRIES &&
        (code === 429 ||
          (typeof code === "number" && code >= 500) ||
          ["ECONNRESET"].includes(code));
      logEvent(retriable ? "openai.retry" : "openai.fail", {
        reqId,
        attempt,
        code,
        msg: error?.message,
      });
      if (!retriable) throw error;
      attempt += 1;
      await sleep(Math.min(OPENAI_RUN_MAX_WAIT_MS, 500 + attempt * 300));
    }
  }
}

module.exports = {
  ADVISOR_COMPOSER_TIMEOUT_MS,
  FAST_MODEL,
  FAST_TIMEOUT_MS,
  FINAL_MODEL,
  MODEL_TIMEOUT_MS,
  callOpenAIChat,
};
