const PROJECT_FALLBACK_API_BASE =
  "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod";

let warnedFallback = false;

function normalizeStageBase(value) {
  let base = String(value || "").trim().replace(/\/+$/g, "");
  if (!base) return "";

  if (/\/ask-snoozer$/i.test(base)) {
    base = base.replace(/\/ask-snoozer$/i, "");
  }

  if (!/\/(prod|staging|dev)$/i.test(base)) {
    base += "/prod";
  }

  return base;
}

function readRuntimeApiBase() {
  const runtime = globalThis?.MySnoozePod?.apiBase || globalThis?.__SNOOZER_API_BASE__;
  return normalizeStageBase(runtime);
}

export function resolveApiBase() {
  const envCandidates = [
    import.meta.env.VITE_API_BASE,
    import.meta.env.VITE_API_GATEWAY_HOST,
    import.meta.env.VITE_API_BASE_URL,
    import.meta.env.VITE_API_URL,
    import.meta.env.VITE_SNOOZER_API,
  ];

  for (const candidate of envCandidates) {
    const normalized = normalizeStageBase(candidate);
    if (normalized) return normalized;
  }

  const runtime = readRuntimeApiBase();
  if (runtime) return runtime;

  const fallback = normalizeStageBase(PROJECT_FALLBACK_API_BASE);
  if (!warnedFallback && typeof console !== "undefined") {
    warnedFallback = true;
    console.warn("[api] using project fallback API base", fallback);
  }
  return fallback;
}

export function buildApiUrl(path = "") {
  const cleanPath = String(path || "").startsWith("/") ? path : `/${path}`;
  const base = resolveApiBase();
  return base ? `${base}${cleanPath}` : cleanPath;
}

export { PROJECT_FALLBACK_API_BASE };
