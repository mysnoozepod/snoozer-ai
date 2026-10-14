function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function deadlineError({ timeoutMs, label }) {
  const error = new Error(`${label || "HTTP request"} exceeded its ${timeoutMs}ms deadline`);
  error.name = "RequestDeadlineError";
  error.code = "HTTP_DEADLINE_EXCEEDED";
  error.timeoutMs = timeoutMs;
  error.abortOrigin = "application_deadline";
  return error;
}

async function fetchWithDeadline(url, init = {}, options = {}) {
  const timeoutMs = boundedInt(options.timeoutMs, 30000, 1, 120000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const label = options.label || "HTTP request";
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is unavailable");

  const controller = new AbortController();
  const externalSignal = init.signal;
  let externalAbortListener = null;
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = deadlineError({ timeoutMs, label });
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  if (externalSignal) {
    externalAbortListener = () => controller.abort(externalSignal.reason);
    if (externalSignal.aborted) externalAbortListener();
    else externalSignal.addEventListener("abort", externalAbortListener, { once: true });
  }

  try {
    return await Promise.race([
      Promise.resolve(fetchImpl(url, { ...init, signal: controller.signal })),
      deadline,
    ]);
  } catch (error) {
    if (controller.signal.aborted && error?.code !== "HTTP_DEADLINE_EXCEEDED") {
      if (externalSignal?.aborted) {
        error.abortOrigin = error.abortOrigin || "caller_abort";
        error.code = error.code || "HTTP_CALLER_ABORTED";
      } else {
        const bounded = deadlineError({ timeoutMs, label });
        bounded.cause = error;
        throw bounded;
      }
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal && externalAbortListener) {
      externalSignal.removeEventListener("abort", externalAbortListener);
    }
  }
}

module.exports = {
  deadlineError,
  fetchWithDeadline,
};
