// Tiny API client with timeout + single smart retry for /ask-snoozer
// Requires: VITE_API_BASE in your .env (no trailing slash)
import { resolveApiBase } from "@/lib/apiBase";

const API_BASE = resolveApiBase();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function normalizeErr(e) {
  const msg = (e?.message?.toString?.() || String(e)).toLowerCase();
  let error_code = "internal_error";
  if (msg.includes("abort") || msg.includes("timeout")) error_code = "timeout";
  if (msg.includes("network") || msg.includes("dns") || msg.includes("failed"))
    error_code = "network_error";
  return {
    success: false,
    text: "Network hiccup reaching Snoozer. Please try again.",
    meta: { error: true, error_code },
  };
}

/**
 * POST /ask-snoozer with built-in timeout and one retry for rate_limited/network_error
 */
export async function askSnoozer(message, opts = {}) {
  const {
    timeoutMs = 3500,
    backoffMs = 500,
    retryOn = ["rate_limited", "network_error"],
    headers = {},
  } = opts;

  const url = `${API_BASE}/ask-snoozer`;

  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ message }),
  };

  try {
    const res = await fetchWithTimeout(url, init, timeoutMs);
    const json = await res.json();

    if (json?.success === false && json?.meta?.error_code && retryOn.includes(json.meta.error_code)) {
      await sleep(backoffMs);
      const res2 = await fetchWithTimeout(url, init, timeoutMs);
      return await res2.json();
    }
    return json;
  } catch (e) {
    const fail = normalizeErr(e);
    if (retryOn.includes("network_error")) {
      await sleep(backoffMs);
      try {
        const res2 = await fetchWithTimeout(url, init, timeoutMs);
        return await res2.json();
      } catch (e2) {
        return normalizeErr(e2);
      }
    }
    return fail;
  }
}
