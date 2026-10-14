const axios = require("axios");
const https = require("node:https");
const { getIntegrationCredentials } = require("./integrationSecrets");

const FAST_MODEL = process.env.OPENAI_FAST_MODEL || "gpt-6-luna";
const FINAL_MODEL = process.env.OPENAI_FINAL_MODEL || "gpt-6.1-sol";
const FAST_REASONING_EFFORT = process.env.OPENAI_FAST_REASONING_EFFORT || "low";
const FINAL_REASONING_EFFORT = process.env.OPENAI_FINAL_REASONING_EFFORT || "low";

const MODEL_TIMEOUT_MS = Math.max(1000, Number(process.env.MODEL_TIMEOUT_MS || 26000));
const OPENAI_REQUEST_CEILING_MS = Math.max(750, MODEL_TIMEOUT_MS - 1000);
const AXIOS_TIMEOUT_MS = Math.max(
  500,
  Math.min(OPENAI_REQUEST_CEILING_MS, Number(process.env.OPENAI_TIMEOUT_MS || 16000))
);
const FAST_TIMEOUT_MS = Math.max(
  500,
  Math.min(AXIOS_TIMEOUT_MS, Number(process.env.FAST_PATH_TIMEOUT_MS || 11000))
);
const ADVISOR_COMPOSER_TIMEOUT_MS = Math.max(
  FAST_TIMEOUT_MS,
  Math.min(20000, Number(process.env.ADVISOR_COMPOSER_TIMEOUT_MS || 14000))
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
const OPENAI_RESPONSE_RESERVE_MS = Math.max(
  1500,
  Math.min(5000, Number(process.env.OPENAI_RESPONSE_RESERVE_MS || 2500))
);
const OPENAI_MIN_RETRY_BUDGET_MS = Math.max(
  3000,
  Math.min(10000, Number(process.env.OPENAI_MIN_RETRY_BUDGET_MS || 7000))
);

const openaiAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 32,
  maxFreeSockets: 8,
  timeout: Math.max(5000, AXIOS_TIMEOUT_MS + 1000),
});

const openai = axios.create({
  baseURL: "https://api.openai.com/v1",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: AXIOS_TIMEOUT_MS,
  httpsAgent: openaiAgent,
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

function classifyOpenAIError(error, { applicationAbort = false } = {}) {
  const status = Number(error?.response?.status) || null;
  const code = String(error?.code || "").trim() || null;
  const name = String(error?.name || "Error").trim() || "Error";
  if (applicationAbort || code === "OPENAI_DEADLINE_EXHAUSTED" || code === "ERR_CANCELED" || name === "AbortError") {
    return { kind: "application_deadline", transient: false, abortOrigin: "application_deadline", status, code, name };
  }
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
    return { kind: "sdk_timeout", transient: true, abortOrigin: "axios_timeout", status, code, name };
  }
  if (["ECONNRESET", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
    return { kind: "transport_interruption", transient: true, abortOrigin: null, status, code, name };
  }
  if (status === 429) return { kind: "upstream_rate_limit", transient: true, abortOrigin: null, status, code, name };
  if (status >= 500) return { kind: "upstream_server_error", transient: true, abortOrigin: null, status, code, name };
  if (status >= 400) return { kind: "upstream_request_error", transient: false, abortOrigin: null, status, code, name };
  return { kind: "unknown", transient: false, abortOrigin: null, status, code, name };
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

function extractResponseText(data = {}) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  return (Array.isArray(data.output) ? data.output : [])
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((content) => safeStringContent(content?.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractFunctionCalls(data = {}) {
  return (Array.isArray(data?.output) ? data.output : [])
    .filter((item) => item?.type === "function_call" && item?.name && item?.call_id)
    .map((item) => ({
      name: String(item.name),
      callId: String(item.call_id),
      arguments: item.arguments,
      raw: item,
    }));
}

function supportsReasoning(model = "") {
  return /^gpt-6(?:\.|-|$)/i.test(String(model || "").trim());
}

async function callOpenAIChat({
  messages,
  reqId,
  model = FINAL_MODEL,
  maxTokens = 350,
  timeoutMs = FAST_TIMEOUT_MS,
  reasoningEffort = null,
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
      const selectedReasoningEffort = reasoningEffort || (
        model === FAST_MODEL ? FAST_REASONING_EFFORT : FINAL_REASONING_EFFORT
      );
      const payload = {
        model,
        input: normalized,
        max_output_tokens: supportsReasoning(model)
          ? Math.max(1400, Math.min(2400, Number(maxTokens) || 350))
          : Math.max(64, Math.min(800, Number(maxTokens) || 350)),
      };
      if (supportsReasoning(model)) payload.reasoning = { effort: selectedReasoningEffort };
      else payload.temperature = 0.2;
      logEvent("openai.start", {
        reqId,
        attempt,
        timeoutMs,
        model,
        reasoningEffort: payload.reasoning?.effort || null,
        ...summarizePayload(payload.input),
      });
      const response = await openai.post("/responses", payload, {
        timeout: timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = response.data || {};
      const usage = data.usage || {};
      logEvent("openai.ok", { reqId, usedTools: false });
      return {
        text: extractResponseText(data),
        model: data.model || model,
        tokens: {
          prompt: usage.input_tokens ?? null,
          completion: usage.output_tokens ?? null,
          total: usage.total_tokens ?? null,
          reasoning: usage.output_tokens_details?.reasoning_tokens ?? null,
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

async function callOpenAIResponses({
  input,
  instructions = "",
  tools = [],
  text = null,
  reqId,
  model = FINAL_MODEL,
  maxOutputTokens = 2200,
  timeoutMs = AXIOS_TIMEOUT_MS,
  reasoningEffort = FINAL_REASONING_EFFORT,
  parallelToolCalls = true,
  store = false,
  deadlineAt = null,
  transport = openai,
  maxRetries = OPENAI_RUN_MAX_RETRIES,
  maxRetryWaitMs = OPENAI_RUN_MAX_WAIT_MS,
  telemetryContext = {},
}) {
  const { OPENAI_API_KEY: apiKey } = await getIntegrationCredentials("openai");
  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY missing");
    error.code = "OPENAI_KEY_MISSING";
    throw error;
  }
  const payload = {
    model,
    input: Array.isArray(input) ? input : safeStringContent(input),
    instructions: safeStringContent(instructions),
    max_output_tokens: Math.max(256, Math.min(6000, Number(maxOutputTokens) || 2200)),
    reasoning: { effort: reasoningEffort },
    store: Boolean(store),
    parallel_tool_calls: Boolean(parallelToolCalls),
  };
  if (Array.isArray(tools) && tools.length) payload.tools = tools;
  if (text && typeof text === "object") payload.text = text;
  if (!store && supportsReasoning(model)) payload.include = ["reasoning.encrypted_content"];
  logEvent("openai.responses.start", {
    reqId,
    model,
    reasoningEffort,
    timeoutMs,
    inputItemCount: Array.isArray(payload.input) ? payload.input.length : 1,
    toolCount: Array.isArray(payload.tools) ? payload.tools.length : 0,
    structuredOutput: Boolean(payload.text?.format),
  });
  let attempt = 0;
  for (;;) {
    const attemptStartedAt = Date.now();
    let applicationAbort = false;
    let deadlineTimer = null;
    try {
      const remainingMs = deadlineAt !== null && deadlineAt !== undefined && Number.isFinite(Number(deadlineAt))
        ? Number(deadlineAt) - Date.now()
        : null;
      if (remainingMs !== null && remainingMs <= OPENAI_RESPONSE_RESERVE_MS + 500) {
        const error = new Error("OpenAI Responses request deadline exhausted");
        error.code = "OPENAI_DEADLINE_EXHAUSTED";
        throw error;
      }
      const requestTimeoutMs = Math.max(500, Math.min(
          OPENAI_REQUEST_CEILING_MS,
          Number(timeoutMs) || AXIOS_TIMEOUT_MS,
          remainingMs === null ? Number.MAX_SAFE_INTEGER : remainingMs - OPENAI_RESPONSE_RESERVE_MS
        ));
      const controller = new AbortController();
      if (remainingMs !== null) {
        deadlineTimer = setTimeout(() => {
          applicationAbort = true;
          controller.abort(new Error("OpenAI application deadline reached"));
        }, Math.max(1, remainingMs - OPENAI_RESPONSE_RESERVE_MS));
        deadlineTimer.unref?.();
      }
      logEvent("openai.responses.attempt", {
        reqId,
        attempt,
        requestTimeoutMs,
        remainingMs,
        responseReserveMs: OPENAI_RESPONSE_RESERVE_MS,
        circuitState: telemetryContext.circuitState || null,
        verifiedRetrievalCompleted: telemetryContext.verifiedRetrievalCompleted === true,
      });
      const response = await transport.post("/responses", payload, {
        timeout: requestTimeoutMs,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (deadlineTimer) clearTimeout(deadlineTimer);
      const data = response.data || {};
      const usage = data.usage || {};
      const functionCalls = extractFunctionCalls(data);
      logEvent("openai.responses.ok", {
        reqId,
        attempt,
        model: data.model || model,
        responseId: data.id || null,
        modelRequestId: response.headers?.["x-request-id"] || response.headers?.["openai-request-id"] || null,
        elapsedMs: Date.now() - attemptStartedAt,
        toolCallCount: functionCalls.length,
        inputTokens: usage.input_tokens ?? null,
        outputTokens: usage.output_tokens ?? null,
        reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null,
      });
      return {
        id: data.id || null,
        text: extractResponseText(data),
        functionCalls,
        output: Array.isArray(data.output) ? data.output : [],
        model: data.model || model,
        tokens: {
          prompt: usage.input_tokens ?? null,
          cached: usage.input_tokens_details?.cached_tokens ?? null,
          completion: usage.output_tokens ?? null,
          total: usage.total_tokens ?? null,
          reasoning: usage.output_tokens_details?.reasoning_tokens ?? null,
        },
        raw: data,
      };
    } catch (error) {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      const classification = classifyOpenAIError(error, { applicationAbort });
      const status = classification.status;
      const code = status || classification.code || "ERR";
      const remainingMs = deadlineAt !== null && deadlineAt !== undefined && Number.isFinite(Number(deadlineAt))
        ? Number(deadlineAt) - Date.now()
        : null;
      const retryHasBudget = remainingMs === null || remainingMs >= OPENAI_MIN_RETRY_BUDGET_MS;
      const safeToRetry = telemetryContext.consequentialActionStarted !== true;
      const retriable = attempt < Math.max(0, Number(maxRetries) || 0) && retryHasBudget && safeToRetry && classification.transient;
      logEvent(retriable ? "openai.responses.retry" : "openai.responses.fail", {
        reqId,
        attempt,
        code,
        errorName: classification.name,
        errorKind: classification.kind,
        httpStatus: status,
        abortOrigin: classification.abortOrigin,
        model,
        elapsedMs: Date.now() - attemptStartedAt,
        remainingMs,
        configuredTimeoutMs: Number(timeoutMs) || AXIOS_TIMEOUT_MS,
        responseReserveMs: OPENAI_RESPONSE_RESERVE_MS,
        retryHasBudget,
        safeToRetry,
        retryDecision: retriable ? "retry" : "stop",
        circuitState: telemetryContext.circuitState || null,
        verifiedRetrievalCompleted: telemetryContext.verifiedRetrievalCompleted === true,
        recoveryResult: telemetryContext.recoveryResult || null,
        modelRequestId: error?.response?.headers?.["x-request-id"] || error?.response?.headers?.["openai-request-id"] || null,
        message: truncateForLog(error?.message, 240),
        response: truncateForLog(error?.response?.data, 800),
      });
      error.openaiFailure = {
        ...classification,
        attempt,
        elapsedMs: Date.now() - attemptStartedAt,
        remainingMs,
        retryDecision: retriable ? "retry" : "stop",
      };
      if (!retriable) throw error;
      attempt += 1;
      await sleep(Math.min(Math.max(0, Number(maxRetryWaitMs) || 0), 250 + attempt * 200));
    }
  }
}

module.exports = {
  ADVISOR_COMPOSER_TIMEOUT_MS,
  FAST_MODEL,
  FAST_REASONING_EFFORT,
  FAST_TIMEOUT_MS,
  FINAL_MODEL,
  FINAL_REASONING_EFFORT,
  MODEL_TIMEOUT_MS,
  OPENAI_MIN_RETRY_BUDGET_MS,
  OPENAI_RESPONSE_RESERVE_MS,
  callOpenAIChat,
  callOpenAIResponses,
  classifyOpenAIError,
  extractFunctionCalls,
  extractResponseText,
  supportsReasoning,
};
